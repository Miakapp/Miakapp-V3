import { addAbortListener } from 'node:events';
import { isDeepStrictEqual } from 'node:util';

import {
  CHROMIUM_SCENARIO_CALL_CONTROL_SCHEMA,
  CHROMIUM_SCENARIO_STATE_CONTROL_SCHEMA,
  CONTROL_PHASE_ORDER,
  rejectChromiumScenarioPrivateMaterial,
  validateChromiumScenarioResult,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  CHROMIUM_CASE_ADAPTER_BROWSER_CLOSE_ORDER,
  CHROMIUM_CASE_ADAPTER_COMPONENT_FIELDS,
  CHROMIUM_CASE_ADAPTER_FIXTURE_METHODS,
  CHROMIUM_CASE_ADAPTER_PAGE_CLOSE_ORDER,
  CHROMIUM_CASE_ADAPTER_PAGE_PROJECTION_FIELDS,
  CHROMIUM_CASE_ADAPTER_REMAINING_METHODS,
  CHROMIUM_CASE_ADAPTER_STAGE_ORDER,
  CHROMIUM_CASE_ADAPTER_START_ORDER,
  CHROMIUM_CONTROL_STAGE_BY_PHASE,
  CHROMIUM_PAGE_STAGE_BY_SEQUENCE,
  StagingBrowserRelayChromiumCaseAdapterError,
  validateBrowserRelayChromiumCaseAdapterProfile,
} from './contract.mjs';

const CASE_SCOPE_FIELDS = Object.freeze([
  'browser',
  'case_id',
  'record',
  'signal',
  'toJSON',
]);
const STATE_EXPECTATION_FIELDS = Object.freeze([
  'path',
  'revision',
  'schema',
  'value',
]);
const STATE_EXPECTATION_SCHEMA =
  'miakapp.staging-browser-relay-fixture-state-expectation/1';
const STATE_PATH = 'acceptance.temperature';
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;

function reject(message = 'Chromium case-adapter composition failed closed') {
  throw new StagingBrowserRelayChromiumCaseAdapterError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactOwnKeys(value, keys) {
  if (!plainObject(value)) return false;
  try {
    const actual = Reflect.ownKeys(value);
    return actual.every((key) => typeof key === 'string')
      && isDeepStrictEqual(actual.sort(), [...keys].sort());
  } catch {
    return false;
  }
}

function bindMethods(value, methods, path) {
  try {
    if (!exactOwnKeys(value, methods)) {
      reject(`${path} must contain exactly the reviewed methods`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (methods.some((method) => !descriptors[method]?.enumerable
      || !Object.hasOwn(descriptors[method], 'value')
      || typeof descriptors[method].value !== 'function')) {
      reject(`${path} methods must be direct enumerable functions`);
    }
    return Object.freeze(Object.fromEntries(methods.map((method) => [
      method,
      Function.prototype.bind.call(descriptors[method].value, value),
    ])));
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumCaseAdapterError) throw error;
    return reject(`${path} validation failed closed`);
  }
}

function validateSignal(value, path) {
  try {
    if (!(value instanceof AbortSignal)) reject(`${path} is not a genuine AbortSignal`);
    ABORTED_GETTER.call(value);
    return value;
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumCaseAdapterError) throw error;
    return reject(`${path} is not a genuine AbortSignal`);
  }
}

function signalAborted(signal) {
  try {
    return ABORTED_GETTER.call(signal);
  } catch {
    return reject('Chromium case-adapter cancellation boundary failed closed');
  }
}

function validateOptions(value) {
  try {
    if (!exactOwnKeys(value, []) && !exactOwnKeys(value, ['signal'])) {
      reject('Chromium case-adapter options differ from the reviewed boundary');
    }
    if (Reflect.ownKeys(value).length === 0) return Object.freeze({});
    const descriptor = Object.getOwnPropertyDescriptor(value, 'signal');
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      reject('Chromium case-adapter options require one direct abort signal');
    }
    if (descriptor.value === undefined) return Object.freeze({ signal: undefined });
    return Object.freeze({ signal: validateSignal(descriptor.value, 'External abort signal') });
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumCaseAdapterError) throw error;
    return reject('Chromium case-adapter options validation failed closed');
  }
}

function validateComponents(value) {
  try {
    if (!exactOwnKeys(value, CHROMIUM_CASE_ADAPTER_COMPONENT_FIELDS)) {
      reject('Chromium case-adapter components differ from the reviewed boundary');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (CHROMIUM_CASE_ADAPTER_COMPONENT_FIELDS.some((field) => (
      !descriptors[field]?.enumerable || !Object.hasOwn(descriptors[field], 'value')
    ))) reject('Chromium case-adapter components must be direct enumerable fields');
    const fixture = bindMethods(
      descriptors.fixture.value,
      CHROMIUM_CASE_ADAPTER_FIXTURE_METHODS,
      'Chromium scenario fixture',
    );
    const remainingAdapter = bindMethods(
      descriptors.remainingAdapter.value,
      CHROMIUM_CASE_ADAPTER_REMAINING_METHODS,
      'Remaining case adapter',
    );
    for (const field of ['openChromiumPage', 'prepareChromiumPhase']) {
      if (typeof descriptors[field].value !== 'function') {
        reject(`Chromium case-adapter ${field} component is invalid`);
      }
    }
    return Object.freeze({
      fixture,
      openChromiumPage: Function.prototype.bind.call(
        descriptors.openChromiumPage.value,
        value,
      ),
      prepareChromiumPhase: Function.prototype.bind.call(
        descriptors.prepareChromiumPhase.value,
        value,
      ),
      remainingAdapter,
    });
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumCaseAdapterError) throw error;
    return reject('Chromium case-adapter component validation failed closed');
  }
}

function validateCaseScope(value, scheduleSignal) {
  try {
    if (!exactOwnKeys(value, CASE_SCOPE_FIELDS)) {
      reject('Chromium case-adapter received an invalid case scope');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of ['browser', 'case_id', 'record', 'signal']) {
      if (!descriptors[field]?.enumerable || !Object.hasOwn(descriptors[field], 'value')) {
        reject('Chromium case-adapter case scope fields must be direct and enumerable');
      }
    }
    if (descriptors.toJSON?.enumerable !== false
      || !Object.hasOwn(descriptors.toJSON ?? {}, 'value')
      || typeof descriptors.toJSON.value !== 'function'
      || typeof descriptors.case_id.value !== 'string'
      || typeof descriptors.browser.value !== 'string'
      || typeof descriptors.record.value !== 'function'
      || descriptors.signal.value !== scheduleSignal) {
      reject('Chromium case-adapter case scope has drifted');
    }
    return Object.freeze({
      browser: descriptors.browser.value,
      case_id: descriptors.case_id.value,
      record: Function.prototype.bind.call(descriptors.record.value, value),
      signal: descriptors.signal.value,
    });
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumCaseAdapterError) throw error;
    return reject('Chromium case-adapter case scope validation failed closed');
  }
}

function validateStateExpectation(value) {
  try {
    if (!exactOwnKeys(value, STATE_EXPECTATION_FIELDS)) {
      reject('Chromium fixture state expectation has drifted');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (STATE_EXPECTATION_FIELDS.some((field) => !descriptors[field]?.enumerable
      || !Object.hasOwn(descriptors[field], 'value'))
      || descriptors.schema.value !== STATE_EXPECTATION_SCHEMA
      || descriptors.path.value !== STATE_PATH
      || !Number.isSafeInteger(descriptors.revision.value)
      || descriptors.revision.value < 1
      || descriptors.revision.value > 64
      || !Number.isSafeInteger(descriptors.value.value)
      || descriptors.value.value < -100
      || descriptors.value.value > 200) {
      reject('Chromium fixture state expectation is invalid');
    }
    return Object.freeze({
      path: descriptors.path.value,
      revision: descriptors.revision.value,
      value: descriptors.value.value,
    });
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumCaseAdapterError) throw error;
    return reject('Chromium fixture state expectation validation failed closed');
  }
}

function validateProjection(value) {
  try {
    rejectChromiumScenarioPrivateMaterial(value, 'chromium_page_projection');
    if (!exactOwnKeys(value, CHROMIUM_CASE_ADAPTER_PAGE_PROJECTION_FIELDS)) {
      reject('Chromium page projection differs from the reviewed fields');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (CHROMIUM_CASE_ADAPTER_PAGE_PROJECTION_FIELDS.some((field) => (
      !descriptors[field]?.enumerable || !Object.hasOwn(descriptors[field], 'value')
    ))) reject('Chromium page projection fields must be direct and enumerable');
    return Object.freeze(Object.fromEntries(
      CHROMIUM_CASE_ADAPTER_PAGE_PROJECTION_FIELDS.map((field) => [
        field,
        descriptors[field].value,
      ]),
    ));
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumCaseAdapterError) throw error;
    return reject('Chromium page projection validation failed closed');
  }
}

function validateRunnerResult(value) {
  try {
    const descriptor = plainObject(value)
      ? Object.getOwnPropertyDescriptor(value, 'schema')
      : undefined;
    if (!Object.hasOwn(descriptor ?? {}, 'value')
      || descriptor.value !== 'miakapp.staging-browser-relay-runner-result/1') {
      reject('Chromium case-adapter scheduler returned an invalid closed result');
    }
    return value;
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumCaseAdapterError) throw error;
    return reject('Chromium case-adapter result validation failed closed');
  }
}

function nonSerializable(target, onViolation) {
  Object.defineProperty(target, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      onViolation();
      reject('Chromium case-adapter capabilities cannot be serialized');
    },
  });
  return Object.freeze(target);
}

function createComposition(components, scenarioRunner) {
  const controller = new AbortController();
  const stageWaiters = new Set();
  let scheduleSignal;
  let scheduleAbortSubscription;
  let activeStage;
  let stageIndex = 0;
  let startIndex = 0;
  let pageCloseIndex = 0;
  let browserCloseIndex = 0;
  let nextProjectionIndex = 0;
  let nextControlIndex = 0;
  let nextPageInstance = 1;
  let nextInputGeneration = 1;
  let scenarioTask;
  let scenarioResult;
  let scenarioStarted = false;
  let chromiumPageClosed = false;
  let operationFailed = false;
  let closed = false;
  let closeTask;
  let remainingCloseCalls = 0;
  const inFlightRemainingTasks = new Set();

  function requestAbort() {
    if (!controller.signal.aborted) {
      try {
        controller.abort(new StagingBrowserRelayChromiumCaseAdapterError(
          'Chromium case-adapter composition was aborted',
        ));
      } catch {}
    }
  }

  function wakeStageWaiters() {
    for (const wake of [...stageWaiters]) wake();
  }

  function fail() {
    operationFailed = true;
    requestAbort();
    if (activeStage?.pageGate !== undefined) {
      activeStage.pageGate.reject(new StagingBrowserRelayChromiumCaseAdapterError(
        'Chromium page stage failed before completion',
      ));
    }
    wakeStageWaiters();
  }

  function requireScheduleSignal(value) {
    const signal = validateSignal(value, 'Scheduler abort signal');
    if (scheduleSignal === undefined) {
      scheduleSignal = signal;
      try {
        scheduleAbortSubscription = addAbortListener(signal, () => {
          requestAbort();
          wakeStageWaiters();
          if (activeStage?.pageGate !== undefined) {
            activeStage.pageGate.reject(new StagingBrowserRelayChromiumCaseAdapterError(
              'Chromium page stage was cancelled',
            ));
          }
        });
      } catch {
        return reject('Chromium case-adapter abort subscription failed closed');
      }
    } else if (signal !== scheduleSignal) {
      reject('Chromium case-adapter scheduler signal identity changed');
    }
    if (signalAborted(signal) || signalAborted(controller.signal)) {
      reject('Chromium case-adapter operation is outside its reviewed lifetime');
    }
    return signal;
  }

  function waitForStageChange(signal) {
    validateSignal(signal, 'Chromium scenario abort signal');
    if (signalAborted(signal) || signalAborted(controller.signal)) {
      return Promise.reject(new StagingBrowserRelayChromiumCaseAdapterError(
        'Chromium scenario stage wait was cancelled',
      ));
    }
    return new Promise((resolve, rejectWait) => {
      const subscriptions = [];
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        stageWaiters.delete(wake);
        for (const subscription of subscriptions) {
          try { subscription[Symbol.dispose]?.(); } catch {}
        }
        callback();
      };
      const wake = () => finish(resolve);
      const abort = () => finish(() => rejectWait(
        new StagingBrowserRelayChromiumCaseAdapterError(
          'Chromium scenario stage wait was cancelled',
        ),
      ));
      stageWaiters.add(wake);
      try {
        subscriptions.push(addAbortListener(controller.signal, abort));
        if (signal !== controller.signal) {
          subscriptions.push(addAbortListener(signal, abort));
        }
      } catch {
        finish(() => rejectWait(new StagingBrowserRelayChromiumCaseAdapterError(
          'Chromium scenario stage wait could not be protected',
        )));
      }
    });
  }

  async function waitForStage(caseId, browser, signal) {
    while (true) {
      if (signalAborted(signal) || signalAborted(controller.signal)) {
        reject('Chromium scenario stage wait was cancelled');
      }
      if (activeStage?.case_id === caseId && activeStage.browser === browser) {
        return activeStage;
      }
      await waitForStageChange(signal);
    }
  }

  function requireScenarioActive(signal, path) {
    validateSignal(signal, `${path} abort signal`);
    if (signalAborted(signal) || signalAborted(controller.signal)) {
      reject(`${path} is outside the reviewed operation lifetime`);
    }
  }

  async function invokeFixture(method, signal, ...arguments_) {
    requireScenarioActive(signal, `Chromium fixture ${method}`);
    let value;
    try {
      value = await components.fixture[method](...arguments_);
    } catch {
      return reject(`Chromium fixture ${method} failed closed`);
    }
    requireScenarioActive(signal, `Chromium fixture ${method}`);
    return value;
  }

  async function invokeRemaining(method, ...arguments_) {
    const task = (async () => {
      let value;
      try {
        value = await components.remainingAdapter[method](...arguments_);
      } catch {
        return reject(`Remaining case adapter ${method} failed closed`);
      }
      if (value !== undefined) {
        reject(`Remaining case adapter ${method} returned an unreviewed value`);
      }
    })();
    inFlightRemainingTasks.add(task);
    try {
      await task;
    } finally {
      inFlightRemainingTasks.delete(task);
    }
  }

  async function drainRemainingTasks() {
    while (inFlightRemainingTasks.size > 0) {
      await Promise.allSettled([...inFlightRemainingTasks]);
    }
  }

  function stateControl(expectationValue) {
    const expectation = validateStateExpectation(expectationValue);
    return Object.freeze({
      schema: CHROMIUM_SCENARIO_STATE_CONTROL_SCHEMA,
      state_expectation: expectation,
    });
  }

  function callControl(target) {
    return Object.freeze({
      schema: CHROMIUM_SCENARIO_CALL_CONTROL_SCHEMA,
      call_target: target,
    });
  }

  async function prepareControlPhase(phase, signal) {
    if (CONTROL_PHASE_ORDER[nextControlIndex] !== phase) {
      reject('Chromium control phase order has drifted at the composition boundary');
    }
    const caseId = CHROMIUM_CONTROL_STAGE_BY_PHASE[phase];
    if (caseId === undefined) reject('Chromium control phase is not composed');
    await waitForStage(caseId, 'chromium', signal);
    requireScenarioActive(signal, 'Chromium control preparation');
    let prepared;
    try {
      prepared = await components.prepareChromiumPhase(phase, signal);
    } catch {
      return reject('Chromium phase preparation failed closed');
    }
    if (prepared !== undefined) {
      reject('Chromium phase preparation returned unreviewed evidence');
    }
    requireScenarioActive(signal, 'Chromium control preparation');
    nextControlIndex += 1;
    switch (phase) {
      case 'authoritative_state':
        return stateControl(await invokeFixture('stateExpectation', signal));
      case 'patched_state':
        return stateControl(await invokeFixture('setTemperature', signal, 21));
      case 'initial_call':
        return callControl(21);
      case 'same_relay_reauthenticated':
        return undefined;
      case 'relay_handoff_stale': {
        const rotated = await invokeFixture('rotateRelayToB', signal);
        if (rotated !== true) reject('Chromium relay rotation did not complete');
        return undefined;
      }
      case 'relay_b_ready':
        return undefined;
      case 'relay_b_state':
        return stateControl(await invokeFixture('stateExpectation', signal));
      case 'relay_b_call':
        return callControl(22);
      case 'failed_call':
        return callControl(23);
      case 'uncertain_call':
        return callControl(24);
      case 'relay_b_recovered':
        return stateControl(await invokeFixture('setTemperature', signal, 23));
      default:
        return reject('Chromium control phase is not composed');
    }
  }

  async function openPage(pageInstance, signal) {
    const expectedStage = pageInstance === 1 ? 'LIVE-04' : 'LIVE-09';
    if (pageInstance !== nextPageInstance || pageInstance < 1 || pageInstance > 2) {
      reject('Chromium page acquisition order has drifted');
    }
    await waitForStage(expectedStage, 'chromium', signal);
    requireScenarioActive(signal, 'Chromium page acquisition');
    nextPageInstance += 1;
    try {
      return await components.openChromiumPage(pageInstance, signal);
    } catch {
      return reject('Chromium page acquisition failed closed');
    }
  }

  async function privateInputProvider(browser, identityGeneration, signal) {
    const expectedStage = identityGeneration === 1 ? 'LIVE-04' : 'LIVE-09';
    if (browser !== 'chromium'
      || identityGeneration !== nextInputGeneration
      || identityGeneration < 1
      || identityGeneration > 2) {
      reject('Chromium private-input order has drifted');
    }
    await waitForStage(expectedStage, browser, signal);
    requireScenarioActive(signal, 'Chromium private-input acquisition');
    nextInputGeneration += 1;
    return invokeFixture('privateInput', signal, browser, identityGeneration, signal);
  }

  async function recordProjection(projectionValue, signal) {
    validateSignal(signal, 'Chromium projection abort signal');
    const sequence = nextProjectionIndex + 1;
    const caseId = CHROMIUM_PAGE_STAGE_BY_SEQUENCE[nextProjectionIndex];
    if (caseId === undefined) reject('Chromium scenario emitted too many page projections');
    const projection = validateProjection(projectionValue);
    const stage = await waitForStage(caseId, 'chromium', signal);
    requireScenarioActive(signal, 'Chromium page projection');
    let accepted;
    try {
      accepted = stage.scope.record('browser_page', projection);
    } catch {
      return reject('Chromium page projection was rejected by its active case scope');
    }
    if (accepted !== true) reject('Chromium page projection was not accepted');
    requireScenarioActive(signal, 'Chromium page projection');
    nextProjectionIndex += 1;
    stage.pageCount += 1;
    if (stage.pageCount > stage.expectedPageCount) {
      reject('Chromium page stage received too many projections');
    }
    if (stage.pageCount === stage.expectedPageCount) stage.pageGate.resolve();
    if (sequence === 12) {
      await waitForStage('LIVE-09', 'chromium', signal);
    }
    return true;
  }

  const pageProjectionPort = nonSerializable({
    record: recordProjection,
  }, fail);

  function startScenario() {
    if (scenarioStarted) reject('Chromium scenario may be started only once');
    scenarioStarted = true;
    const dependencies = Object.freeze({
      controlPhase: prepareControlPhase,
      openPage,
      privateInputProvider,
    });
    scenarioTask = Promise.resolve()
      .then(() => scenarioRunner(
        dependencies,
        pageProjectionPort,
        Object.freeze({ signal: controller.signal }),
      ))
      .then((result) => {
        const reviewed = validateChromiumScenarioResult(result);
        if (nextProjectionIndex !== CHROMIUM_PAGE_STAGE_BY_SEQUENCE.length
          || nextControlIndex !== CONTROL_PHASE_ORDER.length
          || nextPageInstance !== 3
          || nextInputGeneration !== 3) {
          reject('Chromium scenario closed before every composed action completed');
        }
        scenarioResult = reviewed;
        return reviewed;
      })
      .catch(() => {
        fail();
        return reject('Chromium scenario failed at the composition boundary');
      });
    scenarioTask.catch(() => undefined);
  }

  function createPageGate() {
    let resolveGate;
    let rejectGate;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolveGate = resolvePromise;
      rejectGate = rejectPromise;
    });
    promise.catch(() => undefined);
    return Object.freeze({
      promise,
      resolve: resolveGate,
      reject: rejectGate,
    });
  }

  function attenuateScope(stage) {
    let active = true;
    const scope = nonSerializable({
      browser: stage.browser,
      case_id: stage.case_id,
      signal: stage.signal,
      record(source, projection) {
        if (!active) {
          fail();
          reject('Remaining case-adapter scope is no longer active');
        }
        if (stage.browser === 'chromium' && source === 'browser_page') {
          fail();
          reject('Remaining case adapter cannot record Chromium page evidence');
        }
        let accepted;
        try {
          accepted = stage.scope.record(source, projection);
        } catch {
          fail();
          return reject('Remaining source projection failed closed');
        }
        if (accepted !== true) {
          fail();
          reject('Remaining source projection was not accepted');
        }
        return true;
      },
    }, fail);
    return Object.freeze({
      scope,
      revoke() { active = false; },
    });
  }

  function expectedPageCount(caseId, browser) {
    if (browser !== 'chromium') return 0;
    return CHROMIUM_PAGE_STAGE_BY_SEQUENCE.filter((entry) => entry === caseId).length;
  }

  async function perform(method, operation) {
    if (closed || operationFailed || signalAborted(controller.signal)) {
      reject(`Chromium case-adapter ${method} is outside its reviewed lifetime`);
    }
    try {
      await operation();
      return undefined;
    } catch {
      fail();
      return reject(`Chromium case-adapter ${method} failed closed`);
    }
  }

  const adapter = Object.freeze({
    async startBrowser(browser, signalValue) {
      return perform('startBrowser', async () => {
        const signal = requireScheduleSignal(signalValue);
        if (CHROMIUM_CASE_ADAPTER_START_ORDER[startIndex] !== browser) {
          reject('Chromium case-adapter browser-start order has drifted');
        }
        await invokeRemaining('startBrowser', browser, signal);
        startIndex += 1;
      });
    },

    async execute(scopeValue) {
      return perform('execute', async () => {
        if (activeStage !== undefined) reject('Chromium case-adapter stages cannot overlap');
        if (scheduleSignal === undefined) reject('Chromium case-adapter browser was not started');
        const scope = validateCaseScope(scopeValue, scheduleSignal);
        const expected = CHROMIUM_CASE_ADAPTER_STAGE_ORDER[stageIndex];
        if (expected === undefined
          || expected.case_id !== scope.case_id
          || expected.browser !== scope.browser) {
          reject('Chromium case-adapter stage order has drifted');
        }
        const count = expectedPageCount(scope.case_id, scope.browser);
        const stage = {
          browser: scope.browser,
          case_id: scope.case_id,
          expectedPageCount: count,
          pageCount: 0,
          pageGate: count === 0 ? undefined : createPageGate(),
          scope,
          signal: scope.signal,
        };
        const delegated = attenuateScope(stage);
        activeStage = stage;
        wakeStageWaiters();
        if (scope.browser === 'chromium' && scope.case_id === 'LIVE-04') {
          startScenario();
        }
        const tasks = [invokeRemaining('execute', delegated.scope)];
        if (stage.pageGate !== undefined) tasks.push(stage.pageGate.promise);
        try {
          await Promise.all(tasks);
          if (stage.pageCount !== count) {
            reject('Chromium page stage completed without its exact projection partition');
          }
          stageIndex += 1;
        } finally {
          delegated.revoke();
          if (activeStage === stage) activeStage = undefined;
          wakeStageWaiters();
        }
      });
    },

    async closePage(browser, signalValue) {
      return perform('closePage', async () => {
        const signal = requireScheduleSignal(signalValue);
        if (CHROMIUM_CASE_ADAPTER_PAGE_CLOSE_ORDER[pageCloseIndex] !== browser) {
          reject('Chromium case-adapter page-close order has drifted');
        }
        if (browser === 'chromium') {
          if (scenarioTask === undefined) reject('Chromium scenario was never started');
          scenarioResult = await scenarioTask;
          validateChromiumScenarioResult(scenarioResult);
          chromiumPageClosed = true;
        } else {
          await invokeRemaining('closePage', browser, signal);
        }
        pageCloseIndex += 1;
      });
    },

    async closeBrowser(browser, signalValue) {
      return perform('closeBrowser', async () => {
        const signal = requireScheduleSignal(signalValue);
        if (CHROMIUM_CASE_ADAPTER_BROWSER_CLOSE_ORDER[browserCloseIndex] !== browser) {
          reject('Chromium case-adapter browser-close order has drifted');
        }
        await invokeRemaining('closeBrowser', browser, signal);
        browserCloseIndex += 1;
      });
    },

    async close() {
      if (closeTask === undefined) {
        closeTask = (async () => {
          const normalCompletion = !operationFailed
            && stageIndex === CHROMIUM_CASE_ADAPTER_STAGE_ORDER.length
            && startIndex === CHROMIUM_CASE_ADAPTER_START_ORDER.length
            && pageCloseIndex === CHROMIUM_CASE_ADAPTER_PAGE_CLOSE_ORDER.length
            && browserCloseIndex === CHROMIUM_CASE_ADAPTER_BROWSER_CLOSE_ORDER.length
            && scenarioResult !== undefined
            && chromiumPageClosed;
          requestAbort();
          if (activeStage?.pageGate !== undefined) {
            activeStage.pageGate.reject(new StagingBrowserRelayChromiumCaseAdapterError(
              'Chromium page stage was closed before completion',
            ));
          }
          wakeStageWaiters();
          if (scenarioTask !== undefined) {
            try { await scenarioTask; } catch {}
          }
          await drainRemainingTasks();
          remainingCloseCalls += 1;
          let remainingClosed = false;
          try {
            remainingClosed = await components.remainingAdapter.close() === undefined;
          } catch {}
          if (scheduleAbortSubscription !== undefined) {
            try { scheduleAbortSubscription[Symbol.dispose]?.(); } catch { remainingClosed = false; }
            scheduleAbortSubscription = undefined;
          }
          activeStage = undefined;
          closed = true;
          if (!remainingClosed || (!normalCompletion && !operationFailed)) {
            reject('Chromium case-adapter cleanup did not converge');
          }
        })();
      }
      await closeTask;
      return undefined;
    },
  });

  return Object.freeze({
    adapter,
    closed: () => closed,
    completed: () => closed && !operationFailed
      && stageIndex === CHROMIUM_CASE_ADAPTER_STAGE_ORDER.length
      && startIndex === CHROMIUM_CASE_ADAPTER_START_ORDER.length
      && pageCloseIndex === CHROMIUM_CASE_ADAPTER_PAGE_CLOSE_ORDER.length
      && browserCloseIndex === CHROMIUM_CASE_ADAPTER_BROWSER_CLOSE_ORDER.length
      && nextProjectionIndex === CHROMIUM_PAGE_STAGE_BY_SEQUENCE.length
      && remainingCloseCalls === 1
      && scenarioResult !== undefined
      && chromiumPageClosed,
    close: () => adapter.close(),
  });
}

export async function runBrowserRelayChromiumCaseScheduleWithRunners(
  schedulerRunnerValue,
  scenarioRunnerValue,
  componentsValue,
  optionsValue = {},
) {
  if (arguments.length < 3 || arguments.length > 4
    || typeof schedulerRunnerValue !== 'function'
    || typeof scenarioRunnerValue !== 'function') {
    reject('Chromium case-adapter internal runner requires its exact boundaries');
  }
  validateBrowserRelayChromiumCaseAdapterProfile();
  const components = validateComponents(componentsValue);
  const options = validateOptions(optionsValue);
  const composition = createComposition(components, scenarioRunnerValue);
  try {
    const result = validateRunnerResult(
      await schedulerRunnerValue(composition.adapter, options),
    );
    if (!composition.closed() || !composition.completed()) {
      reject('Chromium case-adapter scheduler returned before terminal closure');
    }
    return result;
  } catch {
    try { await composition.close(); } catch {}
    return reject('Chromium case-adapter composition failed before a closed result');
  }
}
