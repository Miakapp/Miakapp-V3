import { isDeepStrictEqual } from 'node:util';

import {
  TARGET_URL,
  validatePageLifecycleObservation,
  validatePagePrivateInput,
  validatePageSafeObservation,
} from '../browser-relay-page/contract.mjs';
import { validatePlaywrightDiagnosticEnvironment } from '../browser-relay-runner/driver.mjs';
import {
  MAXIMUM_SECONDARY_BRIDGE_MILLISECONDS,
  PAGE_FACT_SCHEMA,
  StagingBrowserRelayPlaywrightBridgeError,
  buildBlockedPlaywrightBridgeResult,
  buildClosedPlaywrightBridgeResult,
  validateBridgeElapsed,
  validateBrowserRelayPlaywrightBridgeProfile,
} from './contract.mjs';

const SECONDARY_BROWSERS = Object.freeze(['firefox', 'webkit']);
const SECONDARY_PHASES = Object.freeze([
  Object.freeze({ action: 'initialize', phase: 'initial_initialized' }),
  Object.freeze({ action: 'start', phase: 'initial_ready' }),
  Object.freeze({ action: 'stop', phase: 'signed_out_stopped' }),
]);
const MAXIMUM_CLEANUP_MILLISECONDS = 2_000;
const OPTION_FIELDS = Object.freeze([
  'clearTimer',
  'clock',
  'environment',
  'maximumMilliseconds',
  'setTimer',
  'signal',
]);

function reject(message) {
  throw new StagingBrowserRelayPlaywrightBridgeError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, path) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function validateSignal(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object'
    || typeof value.aborted !== 'boolean'
    || typeof value.addEventListener !== 'function'
    || typeof value.removeEventListener !== 'function') {
    reject('Bridge abort signal is invalid');
  }
  return value;
}

function validateDependencies(value) {
  const dependencies = exactKeys(value, [
    'openPage',
    'privateInputProvider',
    'receiptProducerFactory',
  ], 'bridge dependencies');
  for (const field of Object.keys(dependencies)) {
    if (typeof dependencies[field] !== 'function') {
      reject(`Bridge dependency ${field} is invalid`);
    }
  }
  return dependencies;
}

function validateOptions(value) {
  if (!plainObject(value)
    || Object.keys(value).some((key) => !OPTION_FIELDS.includes(key))) {
    reject('Bridge options exceed the reviewed boundary');
  }
  const options = value;
  const clock = options.clock ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const maximumMilliseconds = options.maximumMilliseconds
    ?? MAXIMUM_SECONDARY_BRIDGE_MILLISECONDS;
  if (typeof clock !== 'function' || typeof setTimer !== 'function'
    || typeof clearTimer !== 'function'
    || !Number.isSafeInteger(maximumMilliseconds)
    || maximumMilliseconds <= 0
    || maximumMilliseconds > MAXIMUM_SECONDARY_BRIDGE_MILLISECONDS) {
    reject('Bridge timing options exceed the reviewed bounds');
  }
  validateSignal(options.signal);
  try {
    validatePlaywrightDiagnosticEnvironment(process.env);
    if (options.environment !== undefined) {
      validatePlaywrightDiagnosticEnvironment(options.environment);
    }
  } catch {
    reject('Bridge diagnostic environment is invalid');
  }
  return Object.freeze({
    clock,
    setTimer,
    clearTimer,
    maximumMilliseconds,
    signal: options.signal,
  });
}

function instant(clock) {
  let value;
  try {
    value = clock();
  } catch {
    return reject('Bridge clock returned an invalid instant');
  }
  if (!Number.isSafeInteger(value) || value < 0) reject('Bridge clock returned an invalid instant');
  return value;
}

function validatePage(value) {
  if (value === null || typeof value !== 'object'
    || typeof value.evaluate !== 'function'
    || typeof value.close !== 'function'
    || typeof value.url !== 'function'
    || value.url() !== TARGET_URL) {
    reject('Bridge page boundary is invalid');
  }
  return value;
}

function validateProducer(value) {
  if (value === null || typeof value !== 'object'
    || typeof value.record !== 'function'
    || typeof value.close !== 'function'
    || typeof value.abort !== 'function') {
    reject('Bridge receipt producer boundary is invalid');
  }
  return value;
}

async function closePage(page, timing) {
  if (page === undefined) return true;
  let timer;
  let timerCreated = false;
  let pageClosed = false;
  let timerCleared = true;
  try {
    pageClosed = await Promise.race([
      Promise.resolve().then(() => page.close()).then(() => true, () => false),
      new Promise((resolve) => {
        timer = timing.setTimer(() => resolve(false), MAXIMUM_CLEANUP_MILLISECONDS);
        timerCreated = true;
      }),
    ]);
  } catch {
    pageClosed = false;
  } finally {
    if (timerCreated) {
      try {
        timing.clearTimer(timer);
      } catch {
        timerCleared = false;
      }
    }
  }
  return pageClosed && timerCleared;
}

async function invokePage(page, action, argument) {
  let currentUrl;
  try {
    currentUrl = page.url();
  } catch {
    return reject('Bridge page URL could not be verified');
  }
  if (currentUrl !== TARGET_URL) reject('Bridge page left the reviewed target');
  const raw = await page.evaluate(async ({
    expectedTargetUrl,
    selectedAction,
    selectedArgument,
  }) => {
    if (globalThis.location?.href !== expectedTargetUrl) return { state: 'failed' };
    const api = globalThis.miakappBrowserRelayPage;
    if (api === null || typeof api !== 'object'
      || typeof api.initialize !== 'function'
      || typeof api.start !== 'function'
      || typeof api.observe !== 'function'
      || typeof api.observeLifecycle !== 'function'
      || typeof api.stop !== 'function') {
      return { state: 'failed' };
    }
    try {
      if (selectedAction === 'initialize') await api.initialize(selectedArgument);
      else if (selectedAction === 'start') await api.start();
      else if (selectedAction === 'stop') await api.stop();
      else return { state: 'failed' };
      return {
        state: 'completed',
        observation: api.observe(),
        lifecycle_observation: api.observeLifecycle(),
      };
    } catch {
      return { state: 'failed' };
    }
  }, {
    expectedTargetUrl: TARGET_URL,
    selectedAction: action,
    selectedArgument: argument,
  });
  if (!plainObject(raw) || raw.state !== 'completed') {
    reject('Bridge page action failed at the closed boundary');
  }
  exactKeys(raw, ['state', 'observation', 'lifecycle_observation'], 'page action result');
  return Object.freeze({
    observation: validatePageSafeObservation(raw.observation),
    lifecycle: validatePageLifecycleObservation(raw.lifecycle_observation),
  });
}

function fact(browser, sequence, phase, elapsed, checkpoint) {
  return Object.freeze({
    schema: PAGE_FACT_SCHEMA,
    browser,
    sequence,
    phase,
    page_instance: 1,
    input_generation: 1,
    identity_generation: 1,
    elapsed_milliseconds: validateBridgeElapsed(elapsed),
    observation: checkpoint.observation,
    lifecycle_observation: checkpoint.lifecycle,
    state_observation: null,
    call_observation: null,
    lifecycle_event: null,
  });
}

async function runSecondary(browser, dependenciesValue, timing) {
  const dependencies = validateDependencies(dependenciesValue);
  let page;
  let privateInput;
  let producer;
  let pageCloseTask;
  let timer;
  let timerCreated = false;
  let abortHandler;
  let expired = false;
  const startedAt = instant(timing.clock);
  let lastInstant = startedAt;
  const requestPageClose = () => {
    if (page === undefined) return Promise.resolve(true);
    if (pageCloseTask === undefined) pageCloseTask = closePage(page, timing);
    return pageCloseTask;
  };
  const ensureActive = () => {
    if (expired || timing.signal?.aborted === true) {
      reject('Bridge operation is outside its reviewed lifetime');
    }
    const now = instant(timing.clock);
    if (now < lastInstant) reject('Bridge clock moved backwards');
    lastInstant = now;
    const elapsed = now - startedAt;
    if (elapsed > timing.maximumMilliseconds) {
      expired = true;
      reject('Bridge operation exceeded its reviewed lifetime');
    }
    return elapsed;
  };
  const operation = (async () => {
    ensureActive();
    page = await dependencies.openPage(browser, timing.signal);
    if (expired || timing.signal?.aborted === true) {
      await requestPageClose();
      reject('Bridge page arrived outside its reviewed lifetime');
    }
    ensureActive();
    validatePage(page);
    producer = validateProducer(dependencies.receiptProducerFactory(browser));
    ensureActive();
    privateInput = validatePagePrivateInput(
      await dependencies.privateInputProvider(browser, 1, timing.signal),
    );
    if (expired || timing.signal?.aborted === true) {
      privateInput = undefined;
      reject('Bridge private input arrived outside its reviewed lifetime');
    }
    ensureActive();
    for (let index = 0; index < SECONDARY_PHASES.length; index += 1) {
      ensureActive();
      const { action, phase } = SECONDARY_PHASES[index];
      const checkpoint = await invokePage(
        page,
        action,
        action === 'initialize' ? privateInput : null,
      );
      if (action === 'initialize') privateInput = undefined;
      const elapsed = ensureActive();
      producer.record(fact(
        browser,
        index + 1,
        phase,
        elapsed,
        checkpoint,
      ));
    }
    ensureActive();
    if (!await requestPageClose()) reject('Bridge page cleanup did not converge');
    ensureActive();
    const receipt = producer.close();
    producer = undefined;
    const result = buildClosedPlaywrightBridgeResult(browser, receipt);
    ensureActive();
    return result;
  })();
  operation.catch(() => undefined);
  const deadline = new Promise((_, rejectDeadline) => {
    try {
      timer = timing.setTimer(() => {
        expired = true;
        requestPageClose().catch(() => undefined);
        rejectDeadline(new StagingBrowserRelayPlaywrightBridgeError('bridge deadline'));
      }, timing.maximumMilliseconds);
      timerCreated = true;
    } catch {
      expired = true;
      rejectDeadline(new StagingBrowserRelayPlaywrightBridgeError('bridge deadline setup'));
    }
  });
  const aborted = new Promise((_, rejectAbort) => {
    if (timing.signal === undefined) return;
    abortHandler = () => {
      expired = true;
      requestPageClose().catch(() => undefined);
      rejectAbort(new StagingBrowserRelayPlaywrightBridgeError('bridge aborted'));
    };
    try {
      timing.signal.addEventListener('abort', abortHandler, { once: true });
    } catch {
      abortHandler = undefined;
      expired = true;
      rejectAbort(new StagingBrowserRelayPlaywrightBridgeError('bridge abort setup'));
    }
  });
  try {
    return await Promise.race([operation, deadline, aborted]);
  } catch {
    expired = true;
    try {
      Promise.resolve(producer?.abort()).catch(() => undefined);
    } catch {}
    return reject(`Browser-relay ${browser} bridge failed before a closed receipt`);
  } finally {
    expired = true;
    privateInput = undefined;
    let boundaryCleanupConverged = true;
    if (timerCreated) {
      try {
        timing.clearTimer(timer);
      } catch {
        boundaryCleanupConverged = false;
      }
    }
    if (abortHandler !== undefined) {
      try {
        timing.signal.removeEventListener('abort', abortHandler);
      } catch {
        boundaryCleanupConverged = false;
      }
    }
    let pageCleanupConverged = false;
    try {
      pageCleanupConverged = await requestPageClose();
    } catch {}
    if (!boundaryCleanupConverged || !pageCleanupConverged) {
      reject(`Browser-relay ${browser} bridge cleanup did not converge`);
    }
  }
}

export async function runBrowserRelayPlaywrightBridge(
  browser,
  dependencies = {},
  options = {},
) {
  validateBrowserRelayPlaywrightBridgeProfile();
  const timing = validateOptions(options);
  if (browser === 'chromium') return buildBlockedPlaywrightBridgeResult();
  if (!SECONDARY_BROWSERS.includes(browser)) reject('Bridge browser is not reviewed');
  return runSecondary(browser, dependencies, timing);
}
