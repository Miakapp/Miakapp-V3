import { addAbortListener } from 'node:events';
import { isDeepStrictEqual } from 'node:util';

import {
  validateBrowserRelayPageFact,
} from '../browser-relay-page-receipt/contract.mjs';
import {
  createBrowserRelayPageReceiptProducer,
} from '../browser-relay-page-receipt/producer.mjs';
import {
  validatePlaywrightBridgeResult,
} from '../browser-relay-playwright-bridge/contract.mjs';
import {
  RUNNER_RESULT_SCHEMA,
} from '../browser-relay-runner/contract.mjs';
import {
  SECONDARY_CASE_ADAPTER_BROWSER_CLOSE_ORDER,
  SECONDARY_CASE_ADAPTER_BROWSERS,
  SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS,
  SECONDARY_CASE_ADAPTER_FIXTURE_METHODS,
  SECONDARY_CASE_ADAPTER_INPUT_ORDER,
  SECONDARY_CASE_ADAPTER_PAGE_CLOSE_ORDER,
  SECONDARY_CASE_ADAPTER_PAGE_FACTS_PER_BROWSER,
  SECONDARY_CASE_ADAPTER_PAGE_PROJECTION_FIELDS,
  SECONDARY_CASE_ADAPTER_REMAINING_METHODS,
  SECONDARY_CASE_ADAPTER_STAGE_ORDER,
  SECONDARY_CASE_ADAPTER_START_ORDER,
  StagingBrowserRelaySecondaryCaseAdapterError,
  validateBrowserRelaySecondaryCaseAdapterProfile,
} from './contract.mjs';

const CASE_SCOPE_FIELDS = Object.freeze([
  'browser',
  'case_id',
  'record',
  'signal',
  'toJSON',
]);
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;

function reject(message = 'Secondary case-adapter composition failed closed') {
  throw new StagingBrowserRelaySecondaryCaseAdapterError(message);
}

function secondaryError(error) {
  try {
    return error instanceof StagingBrowserRelaySecondaryCaseAdapterError;
  } catch {
    return false;
  }
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
    if (secondaryError(error)) throw error;
    return reject(`${path} validation failed closed`);
  }
}

function validateSignal(value, path) {
  try {
    if (!(value instanceof AbortSignal)) reject(`${path} is not a genuine AbortSignal`);
    ABORTED_GETTER.call(value);
    return value;
  } catch (error) {
    if (secondaryError(error)) throw error;
    return reject(`${path} is not a genuine AbortSignal`);
  }
}

function signalAborted(signal) {
  try {
    return ABORTED_GETTER.call(signal);
  } catch {
    return reject('Secondary case-adapter cancellation boundary failed closed');
  }
}

function validateOptions(value) {
  try {
    if (!exactOwnKeys(value, []) && !exactOwnKeys(value, ['signal'])) {
      reject('Secondary case-adapter options differ from the reviewed boundary');
    }
    if (Reflect.ownKeys(value).length === 0) return Object.freeze({});
    const descriptor = Object.getOwnPropertyDescriptor(value, 'signal');
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      reject('Secondary case-adapter options require one direct abort signal');
    }
    if (descriptor.value === undefined) return Object.freeze({ signal: undefined });
    return Object.freeze({ signal: validateSignal(descriptor.value, 'External abort signal') });
  } catch (error) {
    if (secondaryError(error)) throw error;
    return reject('Secondary case-adapter options validation failed closed');
  }
}

function validateComponents(value) {
  try {
    if (!exactOwnKeys(value, SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS)) {
      reject('Secondary case-adapter components differ from the reviewed boundary');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS.some((field) => (
      !descriptors[field]?.enumerable || !Object.hasOwn(descriptors[field], 'value')
    ))) reject('Secondary case-adapter components must be direct enumerable fields');
    const fixture = bindMethods(
      descriptors.fixture.value,
      SECONDARY_CASE_ADAPTER_FIXTURE_METHODS,
      'Shared scenario fixture',
    );
    const remainingAdapter = bindMethods(
      descriptors.remainingAdapter.value,
      SECONDARY_CASE_ADAPTER_REMAINING_METHODS,
      'Independent remaining case adapter',
    );
    for (const field of [
      'openChromiumPage',
      'openSecondaryPage',
      'prepareChromiumPhase',
    ]) {
      if (typeof descriptors[field].value !== 'function') {
        reject(`Secondary case-adapter ${field} component is invalid`);
      }
    }
    return Object.freeze({
      fixture,
      openChromiumPage: Function.prototype.bind.call(
        descriptors.openChromiumPage.value,
        value,
      ),
      openSecondaryPage: Function.prototype.bind.call(
        descriptors.openSecondaryPage.value,
        value,
      ),
      prepareChromiumPhase: Function.prototype.bind.call(
        descriptors.prepareChromiumPhase.value,
        value,
      ),
      remainingAdapter,
    });
  } catch (error) {
    if (secondaryError(error)) throw error;
    return reject('Secondary case-adapter component validation failed closed');
  }
}

function validateCaseScope(value, scheduleSignal) {
  try {
    if (!exactOwnKeys(value, CASE_SCOPE_FIELDS)) {
      reject('Secondary case-adapter received an invalid case scope');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of ['browser', 'case_id', 'record', 'signal']) {
      if (!descriptors[field]?.enumerable || !Object.hasOwn(descriptors[field], 'value')) {
        reject('Secondary case-adapter case scope fields must be direct and enumerable');
      }
    }
    if (descriptors.toJSON?.enumerable !== false
      || !Object.hasOwn(descriptors.toJSON ?? {}, 'value')
      || typeof descriptors.toJSON.value !== 'function'
      || typeof descriptors.case_id.value !== 'string'
      || typeof descriptors.browser.value !== 'string'
      || typeof descriptors.record.value !== 'function'
      || descriptors.signal.value !== scheduleSignal) {
      reject('Secondary case-adapter case scope has drifted');
    }
    return Object.freeze({
      browser: descriptors.browser.value,
      case_id: descriptors.case_id.value,
      record: Function.prototype.bind.call(descriptors.record.value, value),
      signal: descriptors.signal.value,
    });
  } catch (error) {
    if (secondaryError(error)) throw error;
    return reject('Secondary case-adapter case scope validation failed closed');
  }
}

function validateRunnerResult(value) {
  try {
    const descriptor = plainObject(value)
      ? Object.getOwnPropertyDescriptor(value, 'schema')
      : undefined;
    if (!Object.hasOwn(descriptor ?? {}, 'value')
      || descriptor.value !== RUNNER_RESULT_SCHEMA) {
      reject('Secondary case-adapter scheduler returned an invalid closed result');
    }
    return value;
  } catch (error) {
    if (secondaryError(error)) throw error;
    return reject('Secondary case-adapter result validation failed closed');
  }
}

function nonSerializable(target, onViolation) {
  Object.defineProperty(target, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      onViolation();
      reject('Secondary case-adapter capabilities cannot be serialized');
    },
  });
  return Object.freeze(target);
}

function createComposition(components, bridgeRunner) {
  const controller = new AbortController();
  let scheduleSignal;
  let scheduleAbortSubscription;
  let activeStage;
  let stageIndex = 0;
  let startIndex = 0;
  let pageCloseIndex = 0;
  let browserCloseIndex = 0;
  let nextSecondaryInputIndex = 0;
  let operationFailed = false;
  let closed = false;
  let closeTask;
  let remainingCloseCalls = 0;
  const inFlightBridgeTasks = new Set();
  const inFlightDependencyTasks = new Set();
  const inFlightRemainingTasks = new Set();
  const bridges = Object.fromEntries(SECONDARY_CASE_ADAPTER_BROWSERS.map((browser) => [
    browser,
    {
      started: false,
      pageRequested: false,
      pageResolved: false,
      producerCreated: false,
      privateInputRequested: false,
      projectionCount: 0,
      producerClosed: false,
      resultClosed: false,
      pageCloseAcknowledged: false,
      task: undefined,
    },
  ]));

  function requestAbort() {
    if (!controller.signal.aborted) {
      try {
        controller.abort(new StagingBrowserRelaySecondaryCaseAdapterError(
          'Secondary case-adapter composition was aborted',
        ));
      } catch {}
    }
  }

  function fail() {
    operationFailed = true;
    requestAbort();
  }

  function requireActive(path) {
    if (closed || operationFailed || signalAborted(controller.signal)) {
      reject(`${path} is outside the reviewed operation lifetime`);
    }
  }

  function requireScheduleSignal(value) {
    const signal = validateSignal(value, 'Scheduler abort signal');
    if (scheduleSignal === undefined) {
      scheduleSignal = signal;
      try {
        scheduleAbortSubscription = addAbortListener(signal, fail);
      } catch {
        return reject('Secondary case-adapter abort subscription failed closed');
      }
    } else if (signal !== scheduleSignal) {
      reject('Secondary case-adapter scheduler signal identity changed');
    }
    if (signalAborted(signal) || signalAborted(controller.signal)) {
      reject('Secondary case-adapter operation is outside its reviewed lifetime');
    }
    return signal;
  }

  async function invokeRemaining(method, ...arguments_) {
    const task = (async () => {
      let value;
      try {
        value = await components.remainingAdapter[method](...arguments_);
      } catch {
        return reject(`Independent remaining adapter ${method} failed closed`);
      }
      if (value !== undefined) {
        reject(`Independent remaining adapter ${method} returned an unreviewed value`);
      }
    })();
    inFlightRemainingTasks.add(task);
    try {
      await task;
    } finally {
      inFlightRemainingTasks.delete(task);
    }
  }

  async function drainTasks(tasks) {
    while (tasks.size > 0) await Promise.allSettled([...tasks]);
  }

  function trackDependency(task) {
    inFlightDependencyTasks.add(task);
    task.then(
      () => inFlightDependencyTasks.delete(task),
      () => inFlightDependencyTasks.delete(task),
    );
    return task;
  }

  async function closeLatePage(page) {
    try {
      const close = page?.close;
      if (typeof close !== 'function') return false;
      await Reflect.apply(close, page, []);
      return true;
    } catch {
      return false;
    }
  }

  function attenuateScope(stage) {
    let active = true;
    const scope = nonSerializable({
      browser: stage.browser,
      case_id: stage.case_id,
      signal: controller.signal,
      record(source, projection) {
        if (!active) {
          fail();
          reject('Independent remaining-adapter scope is no longer active');
        }
        requireActive('Independent source projection');
        if (source === 'browser_page') {
          fail();
          reject('Independent remaining adapter cannot record browser-page evidence');
        }
        let accepted;
        try {
          accepted = stage.scope.record(source, projection);
        } catch {
          fail();
          return reject('Independent source projection failed closed');
        }
        if (accepted !== true) {
          fail();
          reject('Independent source projection was not accepted');
        }
        return true;
      },
    }, fail);
    return Object.freeze({
      scope,
      revoke() { active = false; },
    });
  }

  function projectionFromFact(fact) {
    return Object.freeze(Object.fromEntries(
      SECONDARY_CASE_ADAPTER_PAGE_PROJECTION_FIELDS.map((field) => [field, fact[field]]),
    ));
  }

  function createProjectedProducer(browser, stage, state) {
    if (state.producerCreated || !state.pageResolved || activeStage !== stage) {
      reject('Secondary bridge receipt producer was requested outside its reviewed order');
    }
    state.producerCreated = true;
    const producer = createBrowserRelayPageReceiptProducer(browser);
    let producerState = 'collecting';
    return Object.freeze({
      record(factValue) {
        requireActive('Secondary page projection');
        if (activeStage !== stage || producerState !== 'collecting'
          || state.projectionCount >= SECONDARY_CASE_ADAPTER_PAGE_FACTS_PER_BROWSER) {
          fail();
          reject('Secondary bridge emitted a page fact outside its reviewed partition');
        }
        let fact;
        try {
          fact = validateBrowserRelayPageFact(
            factValue,
            browser,
            state.projectionCount + 1,
          );
          if (producer.record(fact) !== true) {
            reject('Secondary bridge receipt producer did not accept its page fact');
          }
        } catch {
          fail();
          return reject('Secondary bridge page fact failed closed before projection');
        }
        let accepted;
        try {
          accepted = stage.scope.record('browser_page', projectionFromFact(fact));
        } catch {
          fail();
          try { producer.abort(); } catch {}
          producerState = 'failed';
          return reject('Secondary page projection was rejected by its active case scope');
        }
        if (accepted !== true) {
          fail();
          try { producer.abort(); } catch {}
          producerState = 'failed';
          reject('Secondary page projection was not accepted');
        }
        state.projectionCount += 1;
        fact = undefined;
        return true;
      },

      close() {
        requireActive('Secondary bridge receipt closure');
        if (activeStage !== stage || producerState !== 'collecting'
          || state.projectionCount !== SECONDARY_CASE_ADAPTER_PAGE_FACTS_PER_BROWSER) {
          fail();
          reject('Secondary bridge receipt closed outside its reviewed partition');
        }
        let receipt;
        try {
          receipt = producer.close();
        } catch {
          fail();
          return reject('Secondary bridge receipt failed before closure');
        }
        producerState = 'closed';
        state.producerClosed = true;
        return receipt;
      },

      abort() {
        if (producerState === 'closed') {
          reject('Secondary bridge receipt cannot abort after closure');
        }
        if (producerState !== 'aborted') {
          try {
            if (producer.abort() !== true) reject('Secondary bridge receipt abort did not close');
          } catch {
            producerState = 'failed';
            return reject('Secondary bridge receipt abort failed closed');
          }
          producerState = 'aborted';
        }
        return true;
      },
    });
  }

  function bridgeDependencies(browser, stage, state) {
    return Object.freeze({
      async openPage(requestedBrowser, signalValue) {
        requireActive('Secondary page acquisition');
        const signal = validateSignal(signalValue, 'Secondary page acquisition signal');
        if (signal !== controller.signal || requestedBrowser !== browser
          || activeStage !== stage || state.pageRequested) {
          fail();
          reject('Secondary page acquisition order has drifted');
        }
        state.pageRequested = true;
        return trackDependency((async () => {
          let page;
          try {
            page = await components.openSecondaryPage(browser, signal);
          } catch {
            fail();
            return reject('Secondary page acquisition failed closed');
          }
          if (closed || operationFailed || signalAborted(controller.signal)) {
            const cleanupConverged = await closeLatePage(page);
            fail();
            if (!cleanupConverged) {
              reject('Late secondary page cleanup did not converge');
            }
            reject('Secondary page arrived outside the reviewed operation lifetime');
          }
          state.pageResolved = true;
          return page;
        })());
      },

      async privateInputProvider(requestedBrowser, identityGeneration, signalValue) {
        requireActive('Secondary private-input acquisition');
        const signal = validateSignal(signalValue, 'Secondary private-input signal');
        const expected = SECONDARY_CASE_ADAPTER_INPUT_ORDER[nextSecondaryInputIndex];
        if (signal !== controller.signal || activeStage !== stage
          || requestedBrowser !== browser || identityGeneration !== 1
          || expected?.browser !== browser || expected.identity_generation !== 1
          || !state.producerCreated || state.privateInputRequested) {
          fail();
          reject('Secondary private-input acquisition order has drifted');
        }
        state.privateInputRequested = true;
        const input = await trackDependency((async () => {
          let value;
          try {
            value = await components.fixture.privateInput(browser, 1, signal);
          } catch {
            fail();
            return reject('Secondary fixture private input failed closed');
          }
          requireActive('Secondary private-input acquisition');
          return value;
        })());
        nextSecondaryInputIndex += 1;
        return input;
      },

      receiptProducerFactory(requestedBrowser) {
        requireActive('Secondary receipt producer acquisition');
        if (requestedBrowser !== browser || activeStage !== stage) {
          fail();
          reject('Secondary receipt producer browser has drifted');
        }
        return createProjectedProducer(browser, stage, state);
      },
    });
  }

  function startBridge(browser, stage) {
    const state = bridges[browser];
    if (state === undefined || state.started || stage.case_id !== 'LIVE-10'
      || stage.browser !== browser || activeStage !== stage) {
      reject('Secondary bridge start is outside its reviewed stage');
    }
    state.started = true;
    const task = Promise.resolve()
      .then(() => bridgeRunner(
        browser,
        bridgeDependencies(browser, stage, state),
        Object.freeze({ signal: controller.signal }),
      ))
      .then((resultValue) => {
        const result = validatePlaywrightBridgeResult(resultValue, browser);
        if (result.state !== 'receipt_closed' || !state.pageRequested
          || !state.pageResolved || !state.producerCreated
          || !state.privateInputRequested
          || state.projectionCount !== SECONDARY_CASE_ADAPTER_PAGE_FACTS_PER_BROWSER
          || !state.producerClosed) {
          reject('Secondary bridge closed before every composed action completed');
        }
        state.resultClosed = true;
        return undefined;
      })
      .catch(() => {
        fail();
        return reject(`Secondary ${browser} bridge failed at the composition boundary`);
      });
    state.task = task;
    inFlightBridgeTasks.add(task);
    task.finally(() => inFlightBridgeTasks.delete(task)).catch(() => undefined);
    task.catch(() => undefined);
    return task;
  }

  async function settleStage(tasks) {
    const guarded = tasks.map((task) => Promise.resolve(task).catch((error) => {
      fail();
      throw error;
    }));
    const outcomes = await Promise.allSettled(guarded);
    if (outcomes.some(({ status }) => status === 'rejected')) {
      reject('Secondary case-adapter stage work failed before settlement');
    }
  }

  async function perform(method, operation) {
    requireActive(`Secondary case-adapter ${method}`);
    try {
      await operation();
      return undefined;
    } catch {
      fail();
      return reject(`Secondary case-adapter ${method} failed closed`);
    }
  }

  const adapter = Object.freeze({
    async startBrowser(browser, signalValue) {
      return perform('startBrowser', async () => {
        requireScheduleSignal(signalValue);
        if (SECONDARY_CASE_ADAPTER_START_ORDER[startIndex] !== browser) {
          reject('Secondary case-adapter browser-start order has drifted');
        }
        await invokeRemaining('startBrowser', browser, controller.signal);
        startIndex += 1;
      });
    },

    async execute(scopeValue) {
      return perform('execute', async () => {
        if (activeStage !== undefined) reject('Secondary case-adapter stages cannot overlap');
        if (scheduleSignal === undefined) reject('Secondary case-adapter browser was not started');
        const scope = validateCaseScope(scopeValue, scheduleSignal);
        const expected = SECONDARY_CASE_ADAPTER_STAGE_ORDER[stageIndex];
        if (expected === undefined
          || expected.case_id !== scope.case_id
          || expected.browser !== scope.browser) {
          reject('Secondary case-adapter stage order has drifted');
        }
        const stage = {
          browser: scope.browser,
          case_id: scope.case_id,
          scope,
        };
        const delegated = attenuateScope(stage);
        activeStage = stage;
        const tasks = [invokeRemaining('execute', delegated.scope)];
        if (SECONDARY_CASE_ADAPTER_BROWSERS.includes(scope.browser)) {
          tasks.push(startBridge(scope.browser, stage));
        }
        try {
          await settleStage(tasks);
          if (SECONDARY_CASE_ADAPTER_BROWSERS.includes(scope.browser)) {
            const state = bridges[scope.browser];
            if (!state.resultClosed
              || state.projectionCount !== SECONDARY_CASE_ADAPTER_PAGE_FACTS_PER_BROWSER) {
              reject('Secondary page stage completed without its exact projection partition');
            }
          }
          stageIndex += 1;
        } finally {
          delegated.revoke();
          if (activeStage === stage) activeStage = undefined;
        }
      });
    },

    async closePage(browser, signalValue) {
      return perform('closePage', async () => {
        requireScheduleSignal(signalValue);
        if (SECONDARY_CASE_ADAPTER_PAGE_CLOSE_ORDER[pageCloseIndex] !== browser) {
          reject('Secondary case-adapter page-close order has drifted');
        }
        const state = bridges[browser];
        if (state === undefined || !state.resultClosed || !state.producerClosed
          || state.pageCloseAcknowledged || state.task === undefined) {
          reject('Secondary page closure was not proven by its bridge result');
        }
        await state.task;
        state.pageCloseAcknowledged = true;
        pageCloseIndex += 1;
      });
    },

    async closeBrowser(browser, signalValue) {
      return perform('closeBrowser', async () => {
        requireScheduleSignal(signalValue);
        if (SECONDARY_CASE_ADAPTER_BROWSER_CLOSE_ORDER[browserCloseIndex] !== browser) {
          reject('Secondary case-adapter browser-close order has drifted');
        }
        if (SECONDARY_CASE_ADAPTER_BROWSERS.includes(browser)
          && !bridges[browser].pageCloseAcknowledged) {
          reject('Secondary browser cannot close before its page closure is proven');
        }
        await invokeRemaining('closeBrowser', browser, controller.signal);
        browserCloseIndex += 1;
      });
    },

    async close() {
      if (closeTask === undefined) {
        closeTask = (async () => {
          const normalCompletion = !operationFailed
            && stageIndex === SECONDARY_CASE_ADAPTER_STAGE_ORDER.length
            && startIndex === SECONDARY_CASE_ADAPTER_START_ORDER.length
            && pageCloseIndex === SECONDARY_CASE_ADAPTER_PAGE_CLOSE_ORDER.length
            && browserCloseIndex === SECONDARY_CASE_ADAPTER_BROWSER_CLOSE_ORDER.length
            && nextSecondaryInputIndex === SECONDARY_CASE_ADAPTER_INPUT_ORDER.length
            && SECONDARY_CASE_ADAPTER_BROWSERS.every((browser) => (
              bridges[browser].resultClosed
              && bridges[browser].producerClosed
              && bridges[browser].pageCloseAcknowledged
            ));
          requestAbort();
          await drainTasks(inFlightBridgeTasks);
          await drainTasks(inFlightDependencyTasks);
          await drainTasks(inFlightRemainingTasks);
          remainingCloseCalls += 1;
          let remainingClosed = false;
          try {
            remainingClosed = await components.remainingAdapter.close() === undefined;
          } catch {}
          if (scheduleAbortSubscription !== undefined) {
            try {
              scheduleAbortSubscription[Symbol.dispose]?.();
            } catch {
              remainingClosed = false;
            }
            scheduleAbortSubscription = undefined;
          }
          activeStage = undefined;
          closed = true;
          if (!remainingClosed || (!normalCompletion && !operationFailed)) {
            reject('Secondary case-adapter cleanup did not converge');
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
      && stageIndex === SECONDARY_CASE_ADAPTER_STAGE_ORDER.length
      && startIndex === SECONDARY_CASE_ADAPTER_START_ORDER.length
      && pageCloseIndex === SECONDARY_CASE_ADAPTER_PAGE_CLOSE_ORDER.length
      && browserCloseIndex === SECONDARY_CASE_ADAPTER_BROWSER_CLOSE_ORDER.length
      && nextSecondaryInputIndex === SECONDARY_CASE_ADAPTER_INPUT_ORDER.length
      && remainingCloseCalls === 1
      && SECONDARY_CASE_ADAPTER_BROWSERS.every((browser) => (
        bridges[browser].projectionCount === SECONDARY_CASE_ADAPTER_PAGE_FACTS_PER_BROWSER
        && bridges[browser].resultClosed
        && bridges[browser].producerClosed
        && bridges[browser].pageCloseAcknowledged
      )),
    close: () => adapter.close(),
  });
}

export async function runBrowserRelaySecondaryCaseScheduleWithRunners(
  chromiumCaseRunnerValue,
  bridgeRunnerValue,
  componentsValue,
  optionsValue = {},
) {
  if (arguments.length < 3 || arguments.length > 4
    || typeof chromiumCaseRunnerValue !== 'function'
    || typeof bridgeRunnerValue !== 'function') {
    reject('Secondary case-adapter internal runner requires its exact boundaries');
  }
  validateBrowserRelaySecondaryCaseAdapterProfile();
  const components = validateComponents(componentsValue);
  const options = validateOptions(optionsValue);
  const composition = createComposition(components, bridgeRunnerValue);
  const chromiumComponents = Object.freeze({
    fixture: components.fixture,
    openChromiumPage: components.openChromiumPage,
    prepareChromiumPhase: components.prepareChromiumPhase,
    remainingAdapter: composition.adapter,
  });
  try {
    const result = validateRunnerResult(
      await chromiumCaseRunnerValue(chromiumComponents, options),
    );
    if (!composition.closed() || !composition.completed()) {
      reject('Secondary case-adapter runner returned before terminal closure');
    }
    return result;
  } catch {
    try { await composition.close(); } catch {}
    return reject('Secondary case-adapter composition failed before a closed result');
  }
}
