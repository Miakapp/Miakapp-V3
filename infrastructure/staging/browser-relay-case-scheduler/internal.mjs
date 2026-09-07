import { addAbortListener } from 'node:events';

import {
  CASE_SCHEDULER_RUNNER_RESULT_SCHEMA,
  RECORD_COUNTS_BY_STAGE,
  SCHEDULE_ACTIONS,
  StagingBrowserRelayCaseSchedulerError,
  validateBrowserRelayCaseSchedulerProfile,
} from './contract.mjs';

const ADAPTER_METHODS = Object.freeze([
  'startBrowser',
  'execute',
  'closePage',
  'closeBrowser',
  'close',
]);
const SESSION_METHODS = Object.freeze([
  'port',
  'startBrowser',
  'closePage',
  'finishBrowser',
  'close',
  'abort',
]);
const SCOPE_FIELDS = Object.freeze(['case_id', 'browser', 'signal', 'record']);
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;

function reject(message) {
  throw new StagingBrowserRelayCaseSchedulerError(message);
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
      && JSON.stringify(actual.sort()) === JSON.stringify([...keys].sort());
  } catch {
    return false;
  }
}

function schedulerError(error) {
  try {
    return error instanceof StagingBrowserRelayCaseSchedulerError;
  } catch {
    return false;
  }
}

function validateAdapter(value) {
  try {
    if (!exactOwnKeys(value, ADAPTER_METHODS)) {
      reject('Case scheduler adapter must contain exactly the reviewed methods');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (ADAPTER_METHODS.some((name) => (
      !Object.hasOwn(descriptors[name], 'value')
      || typeof descriptors[name].value !== 'function'
    ))) {
      reject('Case scheduler adapter methods must be direct functions');
    }
    return Object.freeze(Object.fromEntries(ADAPTER_METHODS.map((name) => [
      name,
      Function.prototype.bind.call(descriptors[name].value, value),
    ])));
  } catch (error) {
    if (schedulerError(error)) throw error;
    return reject('Case scheduler adapter validation failed closed');
  }
}

function validateAbortSignal(signal) {
  if (signal === undefined) return undefined;
  try {
    if (!(signal instanceof AbortSignal)) {
      reject('Case scheduler external abort signal is invalid');
    }
    ABORTED_GETTER.call(signal);
    return signal;
  } catch (error) {
    if (schedulerError(error)) throw error;
    return reject('Case scheduler external abort signal is invalid');
  }
}

function validateOptions(value) {
  try {
    if (!exactOwnKeys(value, []) && !exactOwnKeys(value, ['signal'])) {
      reject('Case scheduler options differ from the reviewed fields');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'signal');
    if (descriptor !== undefined
      && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) {
      reject('Case scheduler options must contain a direct abort signal');
    }
    return Object.freeze({ signal: validateAbortSignal(descriptor?.value) });
  } catch (error) {
    if (schedulerError(error)) throw error;
    return reject('Case scheduler options validation failed closed');
  }
}

function validateSessionFactory(value) {
  if (typeof value !== 'function') reject('Case scheduler requires one evidence session factory');
  return value;
}

function validateSession(value) {
  try {
    if (!exactOwnKeys(value, [...SESSION_METHODS, 'toJSON'])) {
      reject('Evidence session factory returned an invalid capability');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (SESSION_METHODS.some((name) => (
      !Object.hasOwn(descriptors[name], 'value')
      || typeof descriptors[name].value !== 'function'
    )) || descriptors.toJSON?.enumerable !== false
      || typeof descriptors.toJSON?.value !== 'function') {
      reject('Evidence session factory returned an invalid capability');
    }
    return Object.freeze(Object.fromEntries(SESSION_METHODS.map((name) => [
      name,
      Function.prototype.bind.call(descriptors[name].value, value),
    ])));
  } catch (error) {
    if (schedulerError(error)) throw error;
    return reject('Evidence session factory validation failed closed');
  }
}

function nonSerializable(target, onViolation) {
  Object.defineProperty(target, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      onViolation();
      reject('Case scheduler scopes cannot be serialized');
    },
  });
  return Object.freeze(target);
}

function validatePort(value) {
  try {
    if (!exactOwnKeys(value, ['record', 'toJSON'])) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (!Object.hasOwn(descriptors.record, 'value')
      || typeof descriptors.record.value !== 'function'
      || descriptors.toJSON?.enumerable !== false
      || typeof descriptors.toJSON?.value !== 'function') return undefined;
    return Object.freeze({
      record: Function.prototype.bind.call(descriptors.record.value, value),
    });
  } catch {
    return undefined;
  }
}

function createCaseScope(session, stage, signal) {
  const stageKey = `${stage.case_id}/${stage.browser}`;
  const expectedCounts = RECORD_COUNTS_BY_STAGE[stageKey];
  const counts = Object.fromEntries(Object.keys(expectedCounts).map((source) => [source, 0]));
  const ports = new Map();
  const capability = Symbol(stageKey);
  let activeCapability = capability;
  let violated = false;

  function violate(message) {
    violated = true;
    reject(message);
  }

  function requireActive() {
    if (activeCapability !== capability) {
      reject('Case scheduler scope is no longer active');
    }
  }

  const scope = nonSerializable({
    case_id: stage.case_id,
    browser: stage.browser,
    signal,
    record(source, projection) {
      requireActive();
      if (arguments.length !== 2 || !Object.hasOwn(expectedCounts, source)) {
        return violate('Case scheduler scope rejected an unreviewed source');
      }
      if (counts[source] >= expectedCounts[source]) {
        return violate('Case scheduler scope received too many source projections');
      }
      let port = ports.get(source);
      if (port === undefined) {
        try {
          port = validatePort(session.port(stage.browser, source));
        } catch {
          return violate('Case scheduler could not acquire its reviewed evidence port');
        }
        if (port === undefined) {
          return violate('Evidence session returned an invalid source port');
        }
        ports.set(source, port);
      }
      let accepted;
      try {
        accepted = port.record(projection);
      } catch {
        return violate('Case scheduler source projection failed closed');
      }
      if (accepted !== true) {
        return violate('Evidence session did not accept its source projection');
      }
      counts[source] += 1;
      return true;
    },
  }, () => {
    violated = true;
  });

  return Object.freeze({
    scope,
    complete() {
      requireActive();
      if (violated || Object.entries(expectedCounts).some(([source, count]) => (
        counts[source] !== count
      ))) {
        violate('Case scheduler stage completed without every reviewed projection');
      }
      return true;
    },
    revoke() {
      activeCapability = undefined;
      ports.clear();
      return true;
    },
  });
}

function abortSessionQuietly(session) {
  if (session === undefined) return;
  try {
    session.abort();
  } catch {}
}

function invokeSessionTransition(session, method, browser) {
  let result;
  try {
    result = browser === undefined ? session[method]() : session[method](browser);
  } catch {
    return reject('Case scheduler evidence transition failed closed');
  }
  if (result !== true) reject('Case scheduler evidence transition did not close');
  return true;
}

function signalAborted(signal) {
  if (signal === undefined) return false;
  try {
    return ABORTED_GETTER.call(signal);
  } catch {
    return reject('Case scheduler external abort signal failed closed');
  }
}

function validateClosedResult(value) {
  try {
    const descriptor = plainObject(value)
      ? Object.getOwnPropertyDescriptor(value, 'schema')
      : undefined;
    if (!Object.hasOwn(descriptor ?? {}, 'value')
      || descriptor.value !== CASE_SCHEDULER_RUNNER_RESULT_SCHEMA) {
      reject('Case scheduler evidence session returned an invalid closed result');
    }
    return value;
  } catch (error) {
    if (schedulerError(error)) throw error;
    return reject('Case scheduler evidence session result validation failed closed');
  }
}

export async function runBrowserRelayCaseScheduleWithSessionFactory(
  sessionFactoryValue,
  adapterValue,
  optionsValue = {},
) {
  if (arguments.length < 2 || arguments.length > 3) {
    reject('Internal case scheduler requires its exact reviewed inputs');
  }
  validateBrowserRelayCaseSchedulerProfile();
  const sessionFactory = validateSessionFactory(sessionFactoryValue);
  const adapter = validateAdapter(adapterValue);
  const options = validateOptions(optionsValue);
  const controller = new AbortController();
  let session;
  let sessionClosed = false;
  let closeTask;
  let externalAbortSubscription;
  let result;

  function startAdapterClose() {
    if (closeTask === undefined) {
      closeTask = Promise.resolve()
        .then(() => adapter.close())
        .then(
          (value) => Object.freeze({ ok: value === undefined }),
          () => Object.freeze({ ok: false }),
        );
    }
    return closeTask;
  }

  function requestAbort() {
    if (!controller.signal.aborted) {
      try {
        controller.abort(new StagingBrowserRelayCaseSchedulerError(
          'Browser-relay case schedule was aborted',
        ));
      } catch {}
    }
  }

  function requireActive() {
    if (controller.signal.aborted || signalAborted(options.signal)) {
      requestAbort();
      reject('Browser-relay case schedule was aborted before closure');
    }
  }

  function detachExternalAbort() {
    if (externalAbortSubscription === undefined) return true;
    const subscription = externalAbortSubscription;
    externalAbortSubscription = undefined;
    try {
      const dispose = subscription[Symbol.dispose];
      if (typeof dispose !== 'function') return false;
      dispose.call(subscription);
      return true;
    } catch {
      requestAbort();
      return false;
    }
  }

  async function invokeAdapter(method, ...args) {
    requireActive();
    let value;
    try {
      value = await adapter[method](...args);
    } catch {
      return reject(`Case scheduler adapter ${method} failed closed`);
    }
    requireActive();
    if (value !== undefined) {
      reject(`Case scheduler adapter ${method} returned an unreviewed value`);
    }
  }

  async function executeStage(stage) {
    const capability = createCaseScope(session, stage, controller.signal);
    try {
      await invokeAdapter('execute', capability.scope);
      capability.complete();
    } finally {
      capability.revoke();
    }
  }

  async function closePage(browser) {
    await invokeAdapter('closePage', browser, controller.signal);
    invokeSessionTransition(session, 'closePage', browser);
  }

  async function closeBrowser(browser) {
    await invokeAdapter('closeBrowser', browser, controller.signal);
    invokeSessionTransition(session, 'finishBrowser', browser);
  }

  async function invokeAction(action) {
    switch (action.type) {
      case 'start_browser':
        await invokeAdapter('startBrowser', action.browser, controller.signal);
        if (action.starts_session_span) {
          invokeSessionTransition(session, 'startBrowser', action.browser);
        }
        return;
      case 'create_session':
        requireActive();
        try {
          session = validateSession(sessionFactory());
        } catch (error) {
          if (schedulerError(error)) throw error;
          return reject('Evidence session factory failed before scheduling');
        }
        return;
      case 'execute_stage':
        await executeStage(action.stage);
        return;
      case 'close_page':
        await closePage(action.browser);
        return;
      case 'close_browser':
        await closeBrowser(action.browser);
        return;
      case 'close_adapter': {
        const closeOutcome = await startAdapterClose();
        if (!closeOutcome.ok) reject('Case scheduler adapter close failed closed');
        requireActive();
        return;
      }
      case 'close_session':
        requireActive();
        if (!detachExternalAbort()) {
          reject('Case scheduler external abort listener cleanup failed closed');
        }
        requireActive();
        try {
          result = session.close();
        } catch {
          return reject('Case scheduler evidence session failed before closure');
        }
        sessionClosed = true;
        result = validateClosedResult(result);
        return;
      default:
        return reject('Case scheduler action plan contains an unreviewed action');
    }
  }

  try {
    if (options.signal !== undefined) {
      try {
        externalAbortSubscription = addAbortListener(options.signal, requestAbort);
      } catch {
        return reject('Case scheduler external abort listener failed closed');
      }
    }
    requireActive();
    for (const action of SCHEDULE_ACTIONS) await invokeAction(action);
    if (result === undefined || !sessionClosed) {
      reject('Case scheduler action plan ended without a closed result');
    }
    return result;
  } catch (error) {
    requestAbort();
    const listenerDetached = detachExternalAbort();
    const closeOutcome = await startAdapterClose();
    if (!sessionClosed) abortSessionQuietly(session);
    if (schedulerError(error) && closeOutcome.ok && listenerDetached) {
      throw error;
    }
    return reject('Browser-relay case schedule failed before a closed result');
  } finally {
    detachExternalAbort();
  }
}
