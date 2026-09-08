import { AsyncLocalStorage } from 'node:async_hooks';

import {
  TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE,
  TRUSTED_SOURCE_COMPOSITION_OUTPUT_FIELDS,
  TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE,
  TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER,
  StagingBrowserRelayTrustedSourceCompositionError,
  createTrustedSourceProviderContext,
  createTrustedSourceReceipt,
  validateBrowserRelayTrustedSourceCompositionProfile,
  validateTrustedSourceAcquireDescriptor,
  validateTrustedSourceCompositionInputs,
  validateTrustedSourceCompositionRuntime,
} from './contract.mjs';

const INTRINSIC_ABORT = AbortController.prototype.abort;
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const claimedProviders = new WeakSet();
const callbackContext = new AsyncLocalStorage();
const ROOT_GATED_OPERATION_METHODS = Object.freeze([
  'validateAuthorization',
  'observeClaimAbsent',
  'observeWindowBaseline',
  'createSyntheticFixture',
  'publishRunner',
  'verifyRunner',
  'sampleMonitoring',
  'openRelaysPublic',
]);
const EDGE_CLIENT_METHODS = Object.freeze([
  'observe',
  'setRuntimeProfile',
  'setIngress',
  'setPublicInvoker',
  'closeIngress',
]);

function failure() {
  return new StagingBrowserRelayTrustedSourceCompositionError();
}

function reject() {
  throw failure();
}

function signalAborted(signal) {
  try {
    return ABORTED_GETTER.call(signal);
  } catch {
    return reject();
  }
}

function abortController(controller) {
  try {
    if (!signalAborted(controller.signal)) {
      Reflect.apply(INTRINSIC_ABORT, controller, [failure()]);
    }
  } catch {
    return reject();
  }
}

function clockMilliseconds(runtime) {
  let now;
  try {
    now = runtime.clock();
  } catch {
    return reject();
  }
  if (!Number.isSafeInteger(now) || now < 0) reject();
  return now;
}

function subscribeRootAbort(signal, controller) {
  let subscribed = false;
  const listener = () => {
    try { abortController(controller); } catch {}
  };
  try {
    if (signalAborted(signal)) reject();
    Reflect.apply(INTRINSIC_ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }]);
    subscribed = true;
    if (signalAborted(signal)) listener();
  } catch {
    if (subscribed) {
      try {
        Reflect.apply(INTRINSIC_REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
      } catch {}
    }
    return reject();
  }
  return () => {
    if (!subscribed) return;
    subscribed = false;
    try {
      Reflect.apply(INTRINSIC_REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
    } catch {
      return reject();
    }
  };
}

function claimProviderIdentities(providers) {
  for (const source of TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER) {
    if (claimedProviders.has(providers[source].identity)) reject();
  }
  for (const source of TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER) {
    claimedProviders.add(providers[source].identity);
  }
}

function createTrustedAuthority(source, provider, expiresAt, runtime, callbackToken) {
  const state = {
    source,
    identity: provider.identity,
    methods: provider.methods,
    cursor: 0,
    active: false,
    lifecycle: 'open',
    runtime,
    callbackToken,
  };

  async function acquire(descriptorValue) {
    let context;
    let providerContext;
    let observation;
    try {
      if (arguments.length !== 1 || state.lifecycle !== 'open' || state.active) reject();
      context = validateTrustedSourceAcquireDescriptor(
        descriptorValue,
        state.source,
        state.cursor,
      );
      if (signalAborted(context.signal)) reject();
      state.cursor += 1;
      state.active = true;
      providerContext = createTrustedSourceProviderContext(context);
      observation = await callbackContext.run(
        state.callbackToken,
        () => state.methods[context.kind](providerContext),
      );
      if (state.lifecycle !== 'open' || signalAborted(context.signal)) reject();
      return createTrustedSourceReceipt(context, observation);
    } catch {
      throw failure();
    } finally {
      state.active = false;
      context = undefined;
      providerContext = undefined;
      observation = undefined;
    }
  }

  async function close(signal) {
    if (arguments.length !== 1 || state.lifecycle !== 'open' || state.active) throw failure();
    try {
      state.lifecycle = 'closing';
      if (signalAborted(signal)) reject();
      const result = await callbackContext.run(
        state.callbackToken,
        () => state.methods.close(signal),
      );
      if (result !== undefined || signalAborted(signal)) reject();
    } catch {
      throw failure();
    } finally {
      const sourceName = state.source;
      const identity = state.identity;
      const runtimeState = state.runtime;
      state.lifecycle = 'closed';
      state.source = undefined;
      state.identity = undefined;
      state.methods = undefined;
      state.cursor = undefined;
      state.runtime = undefined;
      state.callbackToken = undefined;
      try {
        runtimeState.provider_released(sourceName, identity);
      } catch {
        throw failure();
      }
    }
    return undefined;
  }

  return Object.freeze({
    source,
    scope: TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE[source],
    expires_at_milliseconds: expiresAt,
    acquire,
    close,
  });
}

function wrapObserver(observer) {
  let underlying = observer;
  let closeTask;
  const wrapped = Object.freeze({
    execute(scope) {
      if (arguments.length !== 1 || underlying === undefined || closeTask !== undefined) {
        return Promise.reject(failure());
      }
      try {
        return Promise.resolve(underlying.execute(scope)).catch(() => {
          throw failure();
        });
      } catch {
        return Promise.reject(failure());
      }
    },
    close() {
      if (arguments.length !== 0) return Promise.reject(failure());
      if (closeTask !== undefined) return closeTask;
      const captured = underlying;
      closeTask = Promise.resolve().then(() => captured.close()).then(
        (value) => {
          underlying = undefined;
          if (value !== undefined) throw failure();
          return undefined;
        },
        () => {
          underlying = undefined;
          throw failure();
        },
      );
      return closeTask;
    },
  });
  return wrapped;
}

function exactObserverMap(observers) {
  try {
    if (!Object.isFrozen(observers)) reject();
    const keys = Reflect.ownKeys(observers);
    if (keys.length !== TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length
      || keys.some((key) => typeof key !== 'string')
      || TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.some((source) => !keys.includes(source))) reject();
    return Object.freeze(Object.fromEntries(
      TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => {
        const observer = observers[source];
        if (observer === null || typeof observer !== 'object'
          || typeof observer.execute !== 'function' || typeof observer.close !== 'function') reject();
        return [source, wrapObserver(observer)];
      }),
    ));
  } catch {
    return reject();
  }
}

async function settleCloseTasks(tasks) {
  const results = await Promise.allSettled(tasks);
  if (results.some((result) => result.status === 'rejected'
    || (result.status === 'fulfilled' && result.value !== undefined))) reject();
}

function bindEdgeClientToRootSignal(edgeClient, signal) {
  const methods = Object.fromEntries(EDGE_CLIENT_METHODS.map((name) => {
    const candidate = edgeClient?.[name];
    if (typeof candidate !== 'function') reject();
    return [name, (...args) => Reflect.apply(candidate, edgeClient, args)];
  }));

  async function guardedTransition(method, cleanupTransition, args) {
    if (!cleanupTransition && signalAborted(signal)) reject();
    const result = await methods[method](...args);
    if (!cleanupTransition && signalAborted(signal)) reject();
    return result;
  }

  return Object.freeze({
    observe: methods.observe,
    setRuntimeProfile(...args) {
      return guardedTransition('setRuntimeProfile', args[1] === 'canonical', args);
    },
    setIngress(...args) {
      return guardedTransition('setIngress', args[1] === 'ALLOW_INTERNAL_ONLY', args);
    },
    setPublicInvoker(...args) {
      return guardedTransition('setPublicInvoker', args[1] === false, args);
    },
    closeIngress: methods.closeIngress,
  });
}

function bindOperationToRootSignal(operation, signal) {
  const bounded = { ...operation };
  for (const name of ROOT_GATED_OPERATION_METHODS) {
    const method = operation[name];
    bounded[name] = async (...args) => {
      if (signalAborted(signal)) reject();
      const result = await method(...args);
      if (signalAborted(signal)) reject();
      return result;
    };
  }
  const acquireClaim = operation.acquireClaim;
  bounded.acquireClaim = (...args) => {
    if (signalAborted(signal)) return Promise.reject(failure());
    try {
      return Promise.resolve(acquireClaim(...args)).catch(() => {
        throw failure();
      });
    } catch {
      return Promise.reject(failure());
    }
  };
  bounded.edgeClient = bindEdgeClientToRootSignal(operation.edgeClient, signal);
  return Object.freeze(bounded);
}

export function createBrowserRelayTrustedSourceCompositionInternal(
  rootValue,
  optionsValue,
  runtimeValue,
) {
  let runtime;
  let inputs;
  let authorities;
  let callbackToken = Object.freeze(Object.create(null));
  try {
    validateBrowserRelayTrustedSourceCompositionProfile();
    runtime = validateTrustedSourceCompositionRuntime(runtimeValue);
    inputs = validateTrustedSourceCompositionInputs(
      rootValue,
      optionsValue,
      clockMilliseconds(runtime),
    );
    if (signalAborted(inputs.signal)) reject();
    claimProviderIdentities(inputs.providers);
    authorities = Object.freeze(Object.fromEntries(
      TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => [
        source,
        createTrustedAuthority(
          source,
          inputs.providers[source],
          inputs.expires_at_milliseconds,
          runtime,
          callbackToken,
        ),
      ]),
    ));
  } catch {
    runtime = undefined;
    inputs = undefined;
    authorities = undefined;
    throw failure();
  }

  const controller = new AbortController();
  let disposeRootAbort;
  let operation = inputs.operation;
  let matrix = inputs.matrix;
  let providerMap = inputs.providers;
  let authorityMap = authorities;
  let observerMap;
  let cleanupMap = authorityMap;
  let cleanupNeedsSignal = true;
  let rawExecuteTask;
  let executeTask;
  let graphCloseTask;
  let closeTask;
  let lifecycle = 'ready';
  let dispatchClose;
  const dispatchedCloseTask = new Promise((resolve) => {
    dispatchClose = resolve;
  }).then(() => closeOwnedSources());

  try {
    disposeRootAbort = subscribeRootAbort(inputs.signal, controller);
  } catch {
    operation = undefined;
    matrix = undefined;
    providerMap = undefined;
    authorityMap = undefined;
    inputs = undefined;
    runtime = undefined;
    throw failure();
  }
  inputs = undefined;
  authorities = undefined;

  function createChain() {
    if (authorityMap === undefined || observerMap !== undefined
      || lifecycle !== 'running' || signalAborted(controller.signal)) reject();
    const options = Object.freeze({ signal: controller.signal });
    const expiresAt = authorityMap[TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER[0]]
      .expires_at_milliseconds;
    const expiringOptions = Object.freeze({
      signal: controller.signal,
      expires_at_milliseconds: expiresAt,
    });
    const clients = runtime.create_source_clients(authorityMap, options);
    cleanupMap = clients;
    cleanupNeedsSignal = true;
    authorityMap = undefined;
    providerMap = undefined;
    const sessions = runtime.create_source_sessions(clients, expiringOptions);
    cleanupMap = sessions;
    cleanupNeedsSignal = true;
    const kindAuthorities = runtime.create_authority_adapters(sessions, expiringOptions);
    cleanupMap = kindAuthorities;
    cleanupNeedsSignal = false;
    const readers = runtime.create_authenticated_readers(kindAuthorities, expiringOptions);
    cleanupMap = readers;
    cleanupNeedsSignal = false;
    const transports = runtime.create_source_transports(readers, options);
    cleanupMap = transports;
    cleanupNeedsSignal = false;
    observerMap = exactObserverMap(transports);
    cleanupMap = observerMap;
    return Object.freeze({
      ...matrix,
      sourceObservers: observerMap,
    });
  }

  function closeOwnedSources() {
    if (cleanupMap === undefined) return Promise.resolve();
    const owned = cleanupMap;
    const withSignal = cleanupNeedsSignal;
    cleanupMap = undefined;
    cleanupNeedsSignal = undefined;
    authorityMap = undefined;
    providerMap = undefined;
    const cleanup = withSignal ? new AbortController() : undefined;
    return settleCloseTasks(TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => (
      Promise.resolve().then(() => (
        withSignal ? owned[source].close(cleanup.signal) : owned[source].close()
      ))
    ))).finally(() => {
      if (cleanup !== undefined) {
        try { abortController(cleanup); } catch {}
      }
    });
  }

  function beginGraphClose() {
    if (graphCloseTask !== undefined) return graphCloseTask;
    lifecycle = 'closing';
    try { abortController(controller); } catch {}
    graphCloseTask = dispatchedCloseTask.then(
      () => undefined,
      () => { throw failure(); },
    ).finally(() => {
      providerMap = undefined;
      authorityMap = undefined;
      observerMap = undefined;
      cleanupMap = undefined;
      cleanupNeedsSignal = undefined;
    });
    const dispatch = dispatchClose;
    dispatchClose = undefined;
    dispatch();
    return graphCloseTask;
  }

  function beginClose() {
    if (closeTask !== undefined) return closeTask;
    const cleanup = beginGraphClose();
    const running = rawExecuteTask;
    closeTask = Promise.allSettled(running === undefined ? [cleanup] : [cleanup, running]).then(
      ([cleanupResult]) => {
        if (cleanupResult.status === 'rejected' || cleanupResult.value !== undefined) reject();
        return undefined;
      },
      () => { throw failure(); },
    ).finally(() => {
      let failed = false;
      try { disposeRootAbort?.(); } catch {
        failed = true;
      }
      disposeRootAbort = undefined;
      operation = undefined;
      matrix = undefined;
      providerMap = undefined;
      authorityMap = undefined;
      observerMap = undefined;
      cleanupMap = undefined;
      cleanupNeedsSignal = undefined;
      runtime = undefined;
      rawExecuteTask = undefined;
      executeTask = undefined;
      graphCloseTask = undefined;
      callbackToken = undefined;
      lifecycle = 'closed';
      if (failed) throw failure();
    });
    return closeTask;
  }

  async function performExecute() {
    let result;
    try {
      const completeMatrix = createChain();
      const boundedOperation = bindOperationToRootSignal(operation, controller.signal);
      result = await callbackContext.run(callbackToken, () => runtime.run_operation_case(
        Object.freeze({
          operation: boundedOperation,
          matrix: completeMatrix,
        }),
      ));
      if (signalAborted(controller.signal)) reject();
    } catch {
      throw failure();
    }
    return result;
  }

  const output = Object.freeze({
    execute() {
      if (arguments.length !== 0 || lifecycle !== 'ready' || executeTask !== undefined) {
        try { void beginClose().catch(() => undefined); } catch {}
        return Promise.reject(failure());
      }
      lifecycle = 'running';
      rawExecuteTask = Promise.resolve().then(performExecute);
      executeTask = rawExecuteTask.then(
        async (result) => {
          await beginClose();
          return result;
        },
        async () => {
          try { await beginClose(); } catch {}
          throw failure();
        },
      );
      return executeTask;
    },
    close() {
      if (arguments.length !== 0) return Promise.reject(failure());
      if (callbackToken !== undefined && callbackContext.getStore() === callbackToken) {
        try { void beginClose().catch(() => undefined); } catch {}
        return Promise.reject(failure());
      }
      return beginClose();
    },
  });
  if (!Object.isFrozen(output)
    || Reflect.ownKeys(output).length !== TRUSTED_SOURCE_COMPOSITION_OUTPUT_FIELDS.length) reject();
  return output;
}
