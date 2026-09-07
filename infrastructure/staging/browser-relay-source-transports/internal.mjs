import { AsyncLocalStorage } from 'node:async_hooks';

import {
  SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE,
  SOURCE_TRANSPORTS_READ_TIMEOUT_MILLISECONDS,
  SOURCE_TRANSPORTS_SOURCE_ORDER,
  StagingBrowserRelaySourceTransportError,
  validateSourceTransportFactoryInputs,
  validateSourceTransportReadResult,
  validateSourceTransportReader,
  validateSourceTransportRuntime,
  validateSourceTransportScope,
} from './contract.mjs';

const intrinsicSetTimeout = globalThis.setTimeout.bind(globalThis);
const intrinsicClearTimeout = globalThis.clearTimeout.bind(globalThis);
const INTRINSIC_ABORT_SIGNAL_ANY = AbortSignal.any;
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const claimedProviders = new WeakSet();
const claimedReaders = new WeakSet();
const callbackContext = new AsyncLocalStorage();
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;

const productionRuntime = Object.freeze({
  setTimeout: intrinsicSetTimeout,
  clearTimeout: intrinsicClearTimeout,
});

function failure(message = 'Staging browser-relay source transport failed closed') {
  return new StagingBrowserRelaySourceTransportError(message);
}

function reject(message) {
  throw failure(message);
}

function signalAborted(signal) {
  try {
    return ABORTED_GETTER.call(signal);
  } catch {
    return reject('Source transport cancellation boundary failed closed');
  }
}

function abortController(controller, reason = failure()) {
  if (!signalAborted(controller.signal)) controller.abort(reason);
}

function disposeAbortSubscription(subscription) {
  try {
    const dispose = subscription?.[Symbol.dispose];
    if (typeof dispose !== 'function') reject('Abort subscription is not disposable');
    Reflect.apply(dispose, subscription, []);
  } catch (error) {
    if (error instanceof StagingBrowserRelaySourceTransportError) throw error;
    return reject('Abort subscription disposal failed closed');
  }
}

function subscribeToAbort(signalValue, listenerValue) {
  let signal = signalValue;
  let listener = listenerValue;
  let subscribed = false;
  try {
    if (signalAborted(signal)) {
      listener();
    } else {
      Reflect.apply(INTRINSIC_ADD_EVENT_LISTENER, signal, [
        'abort',
        listener,
        { once: true },
      ]);
      subscribed = true;
      if (signalAborted(signal)) listener();
    }
  } catch {
    signal = undefined;
    listener = undefined;
    return reject('Source transport abort subscription failed closed');
  }
  return Object.freeze({
    [Symbol.dispose]() {
      if (subscribed) {
        try {
          Reflect.apply(INTRINSIC_REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
        } catch {
          return reject('Source transport abort subscription cleanup failed closed');
        }
      }
      subscribed = false;
      signal = undefined;
      listener = undefined;
      return undefined;
    },
  });
}

function claimProviders(providers) {
  for (const source of SOURCE_TRANSPORTS_SOURCE_ORDER) {
    if (claimedProviders.has(providers[source].identity)) {
      reject('Source transport provider is already bound to an operation');
    }
  }
  for (const source of SOURCE_TRANSPORTS_SOURCE_ORDER) {
    claimedProviders.add(providers[source].identity);
  }
}

function claimReader(reader) {
  if (claimedReaders.has(reader.identity)) {
    reject('Source stage reader is already bound to a stage');
  }
  claimedReaders.add(reader.identity);
  return reader;
}

function track(state, promise) {
  const settled = Promise.resolve(promise).then(
    () => undefined,
    () => undefined,
  );
  state.pending.add(settled);
  void settled.finally(() => state.pending?.delete(settled));
  return promise;
}

function abortError() {
  return failure('Source transport operation was cancelled');
}

function linkAbortSignals(signals) {
  const controller = new AbortController();
  const subscriptions = [];
  const abort = () => {
    try {
      abortController(controller, abortError());
    } catch {}
  };
  try {
    if (signals.some(signalAborted)) {
      abort();
    } else {
      const upstream = Reflect.apply(INTRINSIC_ABORT_SIGNAL_ANY, AbortSignal, [signals]);
      subscriptions.push(subscribeToAbort(upstream, abort));
    }
    if (signals.some(signalAborted)) abort();
  } catch {
    for (const subscription of subscriptions.splice(0)) {
      try { disposeAbortSubscription(subscription); } catch {}
    }
    abort();
    return reject('Source transport abort linkage failed closed');
  }
  const interrupted = interruption(controller.signal);
  return Object.freeze({
    controller,
    interrupted,
    dispose() {
      let failed = false;
      try {
        interrupted.remove();
      } catch {
        failed = true;
      }
      for (const subscription of subscriptions.splice(0)) {
        try {
          disposeAbortSubscription(subscription);
        } catch {
          failed = true;
        }
      }
      if (failed) reject('Source transport abort linkage cleanup failed closed');
    },
  });
}

function interruption(signal) {
  let subscription;
  const promise = new Promise((_resolve, rejectPromise) => {
    const abort = () => rejectPromise(abortError());
    try {
      subscription = subscribeToAbort(signal, abort);
    } catch {
      rejectPromise(failure('Source transport abort subscription failed closed'));
    }
  });
  void promise.catch(() => undefined);
  return Object.freeze({
    promise,
    remove() {
      if (subscription !== undefined) {
        const current = subscription;
        subscription = undefined;
        disposeAbortSubscription(current);
      }
    },
  });
}

async function bounded(
  state,
  runtime,
  callback,
  signal,
  onTimeout = () => {},
  startAfterAbort = false,
  linkedInterruption,
) {
  const operation = track(state, Promise.resolve().then(() => {
    if (!startAfterAbort && signal !== undefined && signalAborted(signal)) {
      throw abortError();
    }
    return callbackContext.run(state.callbackToken, callback);
  }));
  const ownsInterruption = signal !== undefined && linkedInterruption === undefined;
  const interrupted = signal === undefined
    ? undefined
    : (linkedInterruption ?? interruption(signal));
  let timer;
  let timerStarted = false;
  const timedOut = new Promise((_resolve, rejectPromise) => {
    timer = runtime.methods.setTimeout(() => {
      try {
        onTimeout();
      } finally {
        rejectPromise(failure('Source transport operation timed out'));
      }
    }, SOURCE_TRANSPORTS_READ_TIMEOUT_MILLISECONDS);
    timerStarted = true;
  });
  try {
    const value = await Promise.race([
      operation,
      timedOut,
      ...(interrupted === undefined ? [] : [interrupted.promise]),
    ]);
    if (signal !== undefined && signalAborted(signal)) throw abortError();
    return value;
  } finally {
    if (ownsInterruption) interrupted.remove();
    if (timerStarted) runtime.methods.clearTimeout(timer);
  }
}

async function settleTracked(state) {
  while (state.pending.size > 0) {
    await Promise.allSettled([...state.pending]);
  }
}

function operationCapability() {
  const capability = () => {
    throw failure('Source transport operation capability is opaque');
  };
  Object.setPrototypeOf(capability, null);
  return Object.freeze(capability);
}

function stageRequest(source, scope, signal, capability) {
  return Object.freeze({
    source,
    browser: scope.browser,
    case_id: scope.case_id,
    expected_kinds: scope.expected_kinds,
    expected_observation_count: scope.expected_kinds.length,
    signal,
    operation_capability: capability,
  });
}

async function closeReader(
  state,
  runtime,
  reader,
  signal,
  stageController,
  linkedInterruption,
) {
  if (reader.closeStarted) return;
  reader.closeStarted = true;
  const value = await bounded(
    state,
    runtime,
    () => reader.value.methods.close(),
    signal,
    () => {
      if (stageController !== undefined) {
        abortController(stageController, failure('Source stage reader close timed out'));
      }
    },
    true,
    linkedInterruption,
  );
  if (value !== undefined) reject('Source stage reader close returned an unreviewed value');
}

async function closeLateReader(state, runtime, value) {
  try {
    const reader = {
      value: claimReader(validateSourceTransportReader(value)),
      closeStarted: false,
    };
    await closeReader(state, runtime, reader);
  } catch {
    state.shared.poison();
  }
}

async function openReader(
  state,
  runtime,
  provider,
  request,
  signal,
  stageController,
  linkedInterruption,
) {
  const opening = track(state, Promise.resolve().then(() => {
    if (signalAborted(signal)) throw abortError();
    return callbackContext.run(
      state.callbackToken,
      () => provider.methods.openStage(request),
    );
  }));
  let value;
  try {
    value = await bounded(
      state,
      runtime,
      () => opening,
      signal,
      () => abortController(stageController, failure('Source stage opening timed out')),
      false,
      linkedInterruption,
    );
  } catch (error) {
    const cleanup = Promise.resolve(opening).then(
      (lateValue) => closeLateReader(state, runtime, lateValue),
      () => undefined,
    );
    track(state, cleanup);
    throw error;
  }
  return {
    value: claimReader(validateSourceTransportReader(value)),
    closeStarted: false,
  };
}

async function readResult(
  state,
  runtime,
  reader,
  signal,
  stageController,
  expectDone,
  linkedInterruption,
) {
  const value = await bounded(
    state,
    runtime,
    () => reader.value.methods.next(),
    signal,
    () => abortController(stageController, failure('Source stage read timed out')),
    false,
    linkedInterruption,
  );
  return validateSourceTransportReadResult(value, expectDone);
}

async function recordObservation(
  state,
  runtime,
  scope,
  signal,
  stageController,
  observation,
  linkedInterruption,
) {
  const accepted = await bounded(
    state,
    runtime,
    () => scope.record(observation),
    signal,
    () => abortController(stageController, failure('Source observation recording timed out')),
    false,
    linkedInterruption,
  );
  if (accepted !== true) reject('Source observation was not accepted');
}

function terminateStage(stage) {
  abortController(stage.controller, failure('Source transport stage has ended'));
  stage.dispose();
}

function poisonShared(shared) {
  shared.poisoned = true;
  if (shared.rootLink !== undefined) {
    try { abortController(shared.rootLink.controller, failure()); } catch {}
  }
}

function closeSharedSource(shared) {
  shared.closedSources += 1;
  if (shared.closedSources !== SOURCE_TRANSPORTS_SOURCE_ORDER.length) return true;
  let converged = true;
  const rootLink = shared.rootLink;
  try {
    if (rootLink !== undefined) {
      abortController(rootLink.controller, failure('Source transport operation has ended'));
      rootLink.dispose();
    }
  } catch {
    converged = false;
    shared.poisoned = true;
  } finally {
    shared.capability = undefined;
    shared.callbackToken = undefined;
    shared.rootLink = undefined;
  }
  return converged;
}

function poisonSharedMethod() {
  poisonShared(this);
}

function closeSharedSourceMethod() {
  return closeSharedSource(this);
}

function createSourceTransport(source, authority) {
  const state = {
    shared: authority.shared,
    provider: authority.provider,
    runtime: authority.runtime,
    cursor: 0,
    lifecycle: 'open',
    active: undefined,
    pending: new Set(),
    controller: new AbortController(),
    callbackToken: authority.shared.callbackToken,
  };
  authority.shared = undefined;
  authority.provider = undefined;
  authority.runtime = undefined;

  function poison() {
    state.shared?.poison();
    if (state.lifecycle === 'open') state.lifecycle = 'poisoned';
    if (state.controller !== undefined) {
      try { abortController(state.controller, failure()); } catch {}
    }
  }

  async function performExecute(scopeValue) {
    let stage;
    let reader;
    try {
      if (state.lifecycle !== 'open' || state.shared.poisoned) {
        reject('Source transport is not open');
      }
      const scope = validateSourceTransportScope(scopeValue, source, state.cursor);
      stage = linkAbortSignals([
        state.shared.rootLink.controller.signal,
        state.controller.signal,
        scope.signal,
      ]);
      if (signalAborted(stage.controller.signal)) throw abortError();
      const request = stageRequest(
        source,
        scope,
        stage.controller.signal,
        state.shared.capability,
      );
      reader = await openReader(
        state,
        state.runtime,
        state.provider,
        request,
        stage.controller.signal,
        stage.controller,
        stage.interrupted,
      );
      for (let index = 0; index < scope.expected_kinds.length; index += 1) {
        const result = await readResult(
          state,
          state.runtime,
          reader,
          stage.controller.signal,
          stage.controller,
          false,
          stage.interrupted,
        );
        await recordObservation(
          state,
          state.runtime,
          scope,
          stage.controller.signal,
          stage.controller,
          result.observation,
          stage.interrupted,
        );
      }
      await readResult(
        state,
        state.runtime,
        reader,
        stage.controller.signal,
        stage.controller,
        true,
        stage.interrupted,
      );
      await closeReader(
        state,
        state.runtime,
        reader,
        stage.controller.signal,
        stage.controller,
        stage.interrupted,
      );
      state.cursor += 1;
      return undefined;
    } catch {
      poison();
      throw failure();
    } finally {
      let cleanupFailed = false;
      if (reader !== undefined && !reader.closeStarted) {
        try {
          await closeReader(
            state,
            state.runtime,
            reader,
            stage?.controller.signal,
            stage?.controller,
            stage?.interrupted,
          );
        } catch {
          cleanupFailed = true;
        }
      }
      if (stage !== undefined) {
        try {
          terminateStage(stage);
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) {
        poison();
        throw failure();
      }
    }
  }

  function execute(scopeValue) {
    if (arguments.length !== 1 || state.lifecycle !== 'open' || state.shared.poisoned) {
      poison();
      return Promise.reject(failure('Source transport execution is outside its lifetime'));
    }
    if (state.active !== undefined) {
      poison();
      return Promise.reject(failure('Source transport executions cannot overlap'));
    }
    const task = performExecute(scopeValue);
    state.active = task;
    void task.finally(() => {
      if (state.active === task) state.active = undefined;
    }).catch(() => undefined);
    return task;
  }

  async function performClose() {
    const shared = state.shared;
    const completed = state.cursor === SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE[source].length;
    if (!completed && state.lifecycle === 'open'
      && !signalAborted(shared.rootLink.controller.signal)) poison();
    state.lifecycle = 'closing';
    abortController(state.controller, failure('Source transport is closing'));
    let closeFailed = false;
    try {
      if (state.active !== undefined) await Promise.allSettled([state.active]);
      await settleTracked(state);
      const value = await bounded(
        state,
        state.runtime,
        () => state.provider.methods.close(),
      );
      if (value !== undefined) reject('Source transport provider close returned an unreviewed value');
    } catch {
      closeFailed = true;
      shared.poison();
    }
    await settleTracked(state);
    if (shared.poisoned) closeFailed = true;
    state.lifecycle = 'closed';
    state.active = undefined;
    state.provider = undefined;
    state.runtime = undefined;
    state.controller = undefined;
    state.callbackToken = undefined;
    state.pending.clear();
    state.pending = undefined;
    const sharedConverged = shared.sourceClosed();
    if (!completed || closeFailed || !sharedConverged) throw failure();
    return undefined;
  }

  function close() {
    if (state.callbackToken !== undefined
      && callbackContext.getStore() === state.callbackToken) {
      poison();
      return Promise.reject(failure('Source transport cannot close from an active callback'));
    }
    if (state.lifecycle === 'closed' || state.lifecycle === 'closing') {
      state.shared?.poison();
      return Promise.reject(failure('Source transport may close exactly once'));
    }
    return performClose();
  }

  return Object.freeze({ execute, close });
}

function createTransports(providerValue, optionsValue, runtimeValue) {
  let rootLink;
  try {
    const inputs = validateSourceTransportFactoryInputs(providerValue, optionsValue);
    const runtime = validateSourceTransportRuntime(runtimeValue);
    rootLink = linkAbortSignals([inputs.signal]);
    try {
      claimProviders(inputs.providers);
    } catch (error) {
      rootLink.dispose();
      rootLink = undefined;
      throw error;
    }
    const shared = {
      capability: operationCapability(),
      callbackToken: Symbol('source-transport-operation'),
      rootLink,
      poisoned: signalAborted(rootLink.controller.signal),
      closedSources: 0,
      poison: poisonSharedMethod,
      sourceClosed: closeSharedSourceMethod,
    };
    return Object.freeze(Object.fromEntries(SOURCE_TRANSPORTS_SOURCE_ORDER.map((source) => [
      source,
      createSourceTransport(source, {
        provider: inputs.providers[source],
        runtime,
        shared,
      }),
    ])));
  } catch {
    if (rootLink !== undefined) {
      try { rootLink.dispose(); } catch {}
    }
    throw failure();
  }
}

export function createBrowserRelaySourceTransportsInternal(providerValue, optionsValue) {
  return createTransports(providerValue, optionsValue, productionRuntime);
}

export function createBrowserRelaySourceTransportsForTestInternal(
  providerValue,
  optionsValue,
  runtimeValue,
) {
  return createTransports(providerValue, optionsValue, runtimeValue);
}
