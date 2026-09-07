import { addAbortListener } from 'node:events';
import { isDeepStrictEqual } from 'node:util';

import {
  INDEPENDENT_SOURCE_FACT_SCHEMA,
  FACT_ORDER_BY_BROWSER,
  validateIndependentSourceFact,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  INDEPENDENT_CASE_ADAPTER_BROWSER_CLOSE_ORDER,
  INDEPENDENT_CASE_ADAPTER_BROWSER_LIFECYCLE_METHODS,
  INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS,
  INDEPENDENT_CASE_ADAPTER_OBSERVER_METHODS,
  INDEPENDENT_CASE_ADAPTER_RUNNER_RESULT_SCHEMA,
  INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE,
  INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER,
  INDEPENDENT_CASE_ADAPTER_STAGE_ORDER,
  INDEPENDENT_CASE_ADAPTER_START_ORDER,
  StagingBrowserRelayIndependentCaseAdapterError,
  validateBrowserRelayIndependentCaseAdapterProfile,
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

function reject(message = 'Independent case-adapter composition failed closed') {
  throw new StagingBrowserRelayIndependentCaseAdapterError(message);
}

function independentCaseError(error) {
  try {
    return error instanceof StagingBrowserRelayIndependentCaseAdapterError;
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
    if (independentCaseError(error)) throw error;
    return reject(`${path} validation failed closed`);
  }
}

function validateSignal(value, path) {
  try {
    if (!(value instanceof AbortSignal)) reject(`${path} is not a genuine AbortSignal`);
    ABORTED_GETTER.call(value);
    return value;
  } catch (error) {
    if (independentCaseError(error)) throw error;
    return reject(`${path} is not a genuine AbortSignal`);
  }
}

function signalAborted(signal) {
  try {
    return ABORTED_GETTER.call(signal);
  } catch {
    return reject('Independent case-adapter cancellation boundary failed closed');
  }
}

function validateOptions(value) {
  try {
    if (!exactOwnKeys(value, []) && !exactOwnKeys(value, ['signal'])) {
      reject('Independent case-adapter options differ from the reviewed boundary');
    }
    if (Reflect.ownKeys(value).length === 0) return Object.freeze({});
    const descriptor = Object.getOwnPropertyDescriptor(value, 'signal');
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      reject('Independent case-adapter options require one direct abort signal');
    }
    if (descriptor.value === undefined) return Object.freeze({ signal: undefined });
    return Object.freeze({ signal: validateSignal(descriptor.value, 'External abort signal') });
  } catch (error) {
    if (independentCaseError(error)) throw error;
    return reject('Independent case-adapter options validation failed closed');
  }
}

function validateComponents(value) {
  try {
    if (!exactOwnKeys(value, INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS)) {
      reject('Independent case-adapter components differ from the reviewed boundary');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS.some((field) => (
      !descriptors[field]?.enumerable || !Object.hasOwn(descriptors[field], 'value')
    ))) reject('Independent case-adapter components must be direct enumerable fields');
    for (const field of ['openChromiumPage', 'openSecondaryPage', 'prepareChromiumPhase']) {
      if (typeof descriptors[field].value !== 'function') {
        reject(`Independent case-adapter ${field} component is invalid`);
      }
    }
    const observerValues = descriptors.sourceObservers.value;
    if (!exactOwnKeys(observerValues, INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER)) {
      reject('Independent source observer ownership differs from the reviewed sources');
    }
    const observerDescriptors = Object.getOwnPropertyDescriptors(observerValues);
    const sourceObservers = Object.freeze(Object.fromEntries(
      INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER.map((source) => {
        const descriptor = observerDescriptors[source];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          reject('Independent source observers must be direct enumerable fields');
        }
        return [source, bindMethods(
          descriptor.value,
          INDEPENDENT_CASE_ADAPTER_OBSERVER_METHODS,
          `Independent ${source} observer`,
        )];
      }),
    ));
    return Object.freeze({
      fixture: descriptors.fixture.value,
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
      sourceObservers,
      browserLifecycle: bindMethods(
        descriptors.browserLifecycle.value,
        INDEPENDENT_CASE_ADAPTER_BROWSER_LIFECYCLE_METHODS,
        'Independent browser lifecycle',
      ),
    });
  } catch (error) {
    if (independentCaseError(error)) throw error;
    return reject('Independent case-adapter component validation failed closed');
  }
}

function validateCaseScope(value, scheduleSignal) {
  try {
    if (!exactOwnKeys(value, CASE_SCOPE_FIELDS)) {
      reject('Independent case-adapter received an invalid case scope');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of ['browser', 'case_id', 'record', 'signal']) {
      if (!descriptors[field]?.enumerable || !Object.hasOwn(descriptors[field], 'value')) {
        reject('Independent case-adapter scope fields must be direct and enumerable');
      }
    }
    if (descriptors.toJSON?.enumerable !== false
      || !Object.hasOwn(descriptors.toJSON ?? {}, 'value')
      || typeof descriptors.toJSON.value !== 'function'
      || typeof descriptors.browser.value !== 'string'
      || typeof descriptors.case_id.value !== 'string'
      || typeof descriptors.record.value !== 'function'
      || descriptors.signal.value !== scheduleSignal) {
      reject('Independent case-adapter case scope has drifted');
    }
    return Object.freeze({
      browser: descriptors.browser.value,
      case_id: descriptors.case_id.value,
      record: Function.prototype.bind.call(descriptors.record.value, value),
      signal: descriptors.signal.value,
    });
  } catch (error) {
    if (independentCaseError(error)) throw error;
    return reject('Independent case-adapter scope validation failed closed');
  }
}

function validateRunnerResult(value) {
  try {
    const descriptor = plainObject(value)
      ? Object.getOwnPropertyDescriptor(value, 'schema')
      : undefined;
    if (!Object.hasOwn(descriptor ?? {}, 'value')
      || descriptor.value !== INDEPENDENT_CASE_ADAPTER_RUNNER_RESULT_SCHEMA) {
      reject('Independent case-adapter runner returned an invalid closed result');
    }
    return value;
  } catch (error) {
    if (independentCaseError(error)) throw error;
    return reject('Independent case-adapter result validation failed closed');
  }
}

function nonSerializable(target, onViolation) {
  Object.defineProperty(target, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      onViolation();
      reject('Independent source scopes cannot be serialized');
    },
  });
  return Object.freeze(target);
}

function createComposition(components) {
  const controller = new AbortController();
  let scheduleSignal;
  let scheduleAbortSubscription;
  let activeStage;
  let stageIndex = 0;
  let startIndex = 0;
  let browserCloseIndex = 0;
  let activeTransition;
  let operationFailed = false;
  let closed = false;
  let cleanupConverged = false;
  let closeTask;
  let browserLifecycleCloseCalls = 0;
  const browserStarted = Object.fromEntries(
    INDEPENDENT_CASE_ADAPTER_START_ORDER.map((browser) => [browser, false]),
  );
  const browserClosed = Object.fromEntries(
    INDEPENDENT_CASE_ADAPTER_START_ORDER.map((browser) => [browser, false]),
  );
  const firstStageIndex = Object.fromEntries(
    INDEPENDENT_CASE_ADAPTER_START_ORDER.map((browser) => [
      browser,
      INDEPENDENT_CASE_ADAPTER_STAGE_ORDER.findIndex((stage) => stage.browser === browser),
    ]),
  );
  const completedStageIndex = Object.fromEntries(
    INDEPENDENT_CASE_ADAPTER_START_ORDER.map((browser) => [
      browser,
      INDEPENDENT_CASE_ADAPTER_STAGE_ORDER.reduce(
        (last, stage, index) => (stage.browser === browser ? index + 1 : last),
        0,
      ),
    ]),
  );
  const observerCloseCalls = Object.fromEntries(
    INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER.map((source) => [source, 0]),
  );
  const cursors = Object.fromEntries(Object.entries(FACT_ORDER_BY_BROWSER).map(
    ([browser, sources]) => [browser, Object.fromEntries(
      Object.keys(sources).map((source) => [source, 0]),
    )],
  ));
  const inFlightObserverTasks = new Set();
  const inFlightLifecycleTasks = new Set();

  function requestAbort() {
    if (!controller.signal.aborted) {
      try {
        controller.abort(new StagingBrowserRelayIndependentCaseAdapterError(
          'Independent case-adapter composition was aborted',
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
        scheduleAbortSubscription = addAbortListener(signal, requestAbort);
      } catch {
        return reject('Independent case-adapter abort subscription failed closed');
      }
    } else if (signal !== scheduleSignal) {
      reject('Independent case-adapter scheduler signal identity changed');
    }
    if (signalAborted(signal) || signalAborted(controller.signal)) {
      reject('Independent case-adapter operation is outside its reviewed lifetime');
    }
    return signal;
  }

  function trackTask(tasks, task) {
    tasks.add(task);
    task.then(
      () => tasks.delete(task),
      () => tasks.delete(task),
    );
    return task;
  }

  async function drainTasks(tasks) {
    while (tasks.size > 0) await Promise.allSettled([...tasks]);
  }

  async function invokeBrowserLifecycle(method, ...arguments_) {
    const task = trackTask(inFlightLifecycleTasks, (async () => {
      let value;
      try {
        value = await components.browserLifecycle[method](...arguments_);
      } catch {
        return reject(`Independent browser lifecycle ${method} failed closed`);
      }
      if (value !== undefined) {
        reject(`Independent browser lifecycle ${method} returned an unreviewed value`);
      }
    })());
    await task;
  }

  function createSourceScope(stage, source, kinds) {
    const capability = Symbol(`${stage.case_id}/${stage.browser}/${source}`);
    let activeCapability = capability;
    let count = 0;

    function requireScope() {
      requireActive(`Independent ${source} observation`);
      if (activeCapability !== capability || activeStage !== stage) {
        fail();
        reject('Independent source scope is no longer active');
      }
    }

    const scope = nonSerializable({
      browser: stage.browser,
      case_id: stage.case_id,
      signal: controller.signal,
      record(observation) {
        if (arguments.length !== 1) {
          fail();
          reject('Independent source record requires exactly one observation');
        }
        requireScope();
        if (count >= kinds.length) {
          fail();
          reject('Independent source emitted too many stage observations');
        }
        const sequence = cursors[stage.browser][source] + 1;
        const kind = kinds[count];
        if (FACT_ORDER_BY_BROWSER[stage.browser][source]?.[sequence - 1] !== kind) {
          fail();
          reject('Independent source observation order has drifted');
        }
        let fact;
        try {
          fact = validateIndependentSourceFact({
            schema: INDEPENDENT_SOURCE_FACT_SCHEMA,
            browser: stage.browser,
            source,
            sequence,
            kind,
            elapsed_milliseconds: 0,
            observation,
          }, stage.browser, source, sequence);
        } catch {
          fail();
          return reject('Independent source emitted an invalid reviewed observation');
        }
        let accepted;
        try {
          accepted = stage.scope.record(source, Object.freeze({
            observation: fact.observation,
          }));
        } catch {
          fact = undefined;
          fail();
          return reject('Independent source projection failed closed');
        }
        fact = undefined;
        if (accepted !== true) {
          fail();
          reject('Independent source projection was not accepted');
        }
        count += 1;
        cursors[stage.browser][source] += 1;
        return true;
      },
    }, fail);

    return Object.freeze({
      scope,
      complete() {
        requireScope();
        if (count !== kinds.length) {
          fail();
          reject('Independent source stage closed before every observation arrived');
        }
        return true;
      },
      revoke() {
        activeCapability = undefined;
        return true;
      },
    });
  }

  function invokeObserver(stage, source, kinds) {
    requireActive(`Independent ${source} observer`);
    const capability = createSourceScope(stage, source, kinds);
    const task = trackTask(inFlightObserverTasks, (async () => {
      try {
        const value = await components.sourceObservers[source].execute(capability.scope);
        if (value !== undefined) {
          reject(`Independent ${source} observer returned an unreviewed value`);
        }
        capability.complete();
      } catch {
        fail();
        return reject(`Independent ${source} observer failed closed`);
      } finally {
        capability.revoke();
      }
    })());
    task.catch(() => undefined);
    return task;
  }

  async function settleStage(tasks) {
    const outcomes = await Promise.allSettled(tasks);
    if (outcomes.some(({ status }) => status === 'rejected')) {
      reject('Independent source stage failed before settlement');
    }
  }

  async function perform(method, operation) {
    requireActive(`Independent case-adapter ${method}`);
    if (activeTransition !== undefined) {
      fail();
      reject('Independent case-adapter transitions cannot overlap');
    }
    const transition = Symbol(method);
    activeTransition = transition;
    try {
      await operation();
      requireActive(`Independent case-adapter ${method}`);
      return undefined;
    } catch {
      fail();
      return reject(`Independent case-adapter ${method} failed closed`);
    } finally {
      if (activeTransition === transition) activeTransition = undefined;
    }
  }

  function browserSourcesComplete(browser) {
    return Object.entries(FACT_ORDER_BY_BROWSER[browser]).every(([source, kinds]) => (
      cursors[browser][source] === kinds.length
    ));
  }

  function priorBrowsersClosed(browser) {
    return INDEPENDENT_CASE_ADAPTER_BROWSER_CLOSE_ORDER.every((candidate) => (
      completedStageIndex[candidate] > firstStageIndex[browser]
      || browserClosed[candidate]
    ));
  }

  const adapter = Object.freeze({
    async startBrowser(browser, signalValue) {
      return perform('startBrowser', async () => {
        requireScheduleSignal(signalValue);
        if (INDEPENDENT_CASE_ADAPTER_START_ORDER[startIndex] !== browser
          || browserStarted[browser] !== false
          || stageIndex !== firstStageIndex[browser]
          || !priorBrowsersClosed(browser)) {
          reject('Independent case-adapter browser-start order has drifted');
        }
        await invokeBrowserLifecycle('startBrowser', browser, controller.signal);
        browserStarted[browser] = true;
        startIndex += 1;
      });
    },

    async execute(scopeValue) {
      return perform('execute', async () => {
        if (activeStage !== undefined) reject('Independent source stages cannot overlap');
        if (scheduleSignal === undefined) reject('Independent browser lifecycle was not started');
        const scope = validateCaseScope(scopeValue, scheduleSignal);
        const expected = INDEPENDENT_CASE_ADAPTER_STAGE_ORDER[stageIndex];
        if (expected === undefined
          || expected.case_id !== scope.case_id
          || expected.browser !== scope.browser
          || browserStarted[scope.browser] !== true
          || browserClosed[scope.browser] !== false) {
          reject('Independent case-adapter stage order has drifted');
        }
        const stage = Object.freeze({
          browser: scope.browser,
          case_id: scope.case_id,
          scope,
        });
        activeStage = stage;
        try {
          const sources = INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[
            `${scope.case_id}/${scope.browser}`
          ];
          await settleStage(Object.entries(sources).map(([source, kinds]) => (
            invokeObserver(stage, source, kinds)
          )));
          stageIndex += 1;
        } finally {
          if (activeStage === stage) activeStage = undefined;
        }
      });
    },

    async closePage() {
      fail();
      return reject('Independent case adapter cannot own browser-page closure');
    },

    async closeBrowser(browser, signalValue) {
      return perform('closeBrowser', async () => {
        requireScheduleSignal(signalValue);
        if (INDEPENDENT_CASE_ADAPTER_BROWSER_CLOSE_ORDER[browserCloseIndex] !== browser
          || browserStarted[browser] !== true
          || browserClosed[browser] !== false
          || stageIndex !== completedStageIndex[browser]
          || !browserSourcesComplete(browser)) {
          reject('Independent case-adapter browser-close order has drifted');
        }
        await invokeBrowserLifecycle('closeBrowser', browser, controller.signal);
        browserClosed[browser] = true;
        browserCloseIndex += 1;
      });
    },

    async close() {
      if (closeTask === undefined) {
        closeTask = (async () => {
          const normalCompletion = !operationFailed
            && activeTransition === undefined
            && activeStage === undefined
            && stageIndex === INDEPENDENT_CASE_ADAPTER_STAGE_ORDER.length
            && startIndex === INDEPENDENT_CASE_ADAPTER_START_ORDER.length
            && browserCloseIndex === INDEPENDENT_CASE_ADAPTER_BROWSER_CLOSE_ORDER.length
            && Object.values(browserStarted).every((value) => value === true)
            && Object.values(browserClosed).every((value) => value === true)
            && Object.keys(FACT_ORDER_BY_BROWSER).every(browserSourcesComplete);
          requestAbort();
          await drainTasks(inFlightObserverTasks);
          await drainTasks(inFlightLifecycleTasks);
          const observerOutcomes = await Promise.allSettled(
            INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER.map(async (source) => {
              observerCloseCalls[source] += 1;
              const value = await components.sourceObservers[source].close();
              if (value !== undefined) {
                reject(`Independent ${source} observer close returned an unreviewed value`);
              }
            }),
          );
          browserLifecycleCloseCalls += 1;
          let browserLifecycleClosed = false;
          try {
            browserLifecycleClosed = await components.browserLifecycle.close() === undefined;
          } catch {}
          let abortListenerDetached = true;
          if (scheduleAbortSubscription !== undefined) {
            try {
              const dispose = scheduleAbortSubscription[Symbol.dispose];
              if (typeof dispose !== 'function') abortListenerDetached = false;
              else dispose.call(scheduleAbortSubscription);
            } catch {
              abortListenerDetached = false;
            }
            scheduleAbortSubscription = undefined;
          }
          activeStage = undefined;
          closed = true;
          if ((!normalCompletion && !operationFailed)
            || observerOutcomes.some(({ status }) => status === 'rejected')
            || !browserLifecycleClosed || !abortListenerDetached) {
            operationFailed = true;
            reject('Independent case-adapter cleanup did not converge');
          }
          cleanupConverged = true;
        })();
      }
      await closeTask;
      return undefined;
    },
  });

  return Object.freeze({
    adapter,
    closed: () => closed,
    completed: () => closed && cleanupConverged && !operationFailed
      && stageIndex === INDEPENDENT_CASE_ADAPTER_STAGE_ORDER.length
      && startIndex === INDEPENDENT_CASE_ADAPTER_START_ORDER.length
      && browserCloseIndex === INDEPENDENT_CASE_ADAPTER_BROWSER_CLOSE_ORDER.length
      && Object.values(browserStarted).every((value) => value === true)
      && Object.values(browserClosed).every((value) => value === true)
      && browserLifecycleCloseCalls === 1
      && Object.values(observerCloseCalls).every((calls) => calls === 1)
      && Object.keys(FACT_ORDER_BY_BROWSER).every(browserSourcesComplete),
    close: () => adapter.close(),
  });
}

export async function runBrowserRelayIndependentCaseScheduleWithRunner(
  secondaryCaseRunnerValue,
  componentsValue,
  optionsValue = {},
) {
  if (arguments.length < 2 || arguments.length > 3
    || typeof secondaryCaseRunnerValue !== 'function') {
    reject('Independent case-adapter internal runner requires its exact boundaries');
  }
  validateBrowserRelayIndependentCaseAdapterProfile();
  const components = validateComponents(componentsValue);
  const options = validateOptions(optionsValue);
  const composition = createComposition(components);
  const secondaryComponents = Object.freeze({
    fixture: components.fixture,
    openChromiumPage: components.openChromiumPage,
    openSecondaryPage: components.openSecondaryPage,
    prepareChromiumPhase: components.prepareChromiumPhase,
    remainingAdapter: composition.adapter,
  });
  try {
    const result = validateRunnerResult(
      await secondaryCaseRunnerValue(secondaryComponents, options),
    );
    if (!composition.closed() || !composition.completed()) {
      reject('Independent case-adapter runner returned before terminal closure');
    }
    return result;
  } catch {
    try { await composition.close(); } catch {}
    return reject('Independent case-adapter composition failed before a closed result');
  }
}
