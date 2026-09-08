import { AsyncLocalStorage } from 'node:async_hooks';

import {
  SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE,
  SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE,
  SOURCE_SESSION_PRODUCERS_SOURCE_ORDER,
  StagingBrowserRelaySourceSessionProducerError,
  createSourceSessionProducerClientDescriptor,
  validateSourceSessionProducerFactoryInputs,
  validateSourceSessionProducerObservation,
  validateSourceSessionProducerReadDescriptor,
  validateSourceSessionProducerRuntime,
  validateSourceSessionProducerSessions,
  validateSourceSessionProducerSignal,
} from './contract.mjs';

const INTRINSIC_DATE_NOW = Date.now.bind(Date);
const INTRINSIC_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const INTRINSIC_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const INTRINSIC_ABORT = AbortController.prototype.abort;
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const claimedClients = new WeakSet();
const callbackContext = new AsyncLocalStorage();

const productionRuntime = Object.freeze({
  clock: INTRINSIC_DATE_NOW,
  set_timer: (callback, milliseconds) => INTRINSIC_SET_TIMEOUT(callback, milliseconds),
  clear_timer: (handle) => INTRINSIC_CLEAR_TIMEOUT(handle),
  client_released() {},
});

function failure() {
  return new StagingBrowserRelaySourceSessionProducerError();
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

function abortOwnedController(shared, controller) {
  if (shared?.callbackToken === undefined) return abortController(controller);
  return callbackContext.run(shared.callbackToken, () => abortController(controller));
}

function clockMilliseconds(runtime) {
  let value;
  try {
    value = runtime.clock();
  } catch {
    return reject();
  }
  if (!Number.isSafeInteger(value) || value < 0) reject();
  return value;
}

function claimClients(clients) {
  for (const source of SOURCE_SESSION_PRODUCERS_SOURCE_ORDER) {
    if (claimedClients.has(clients[source].identity)) reject();
  }
  for (const source of SOURCE_SESSION_PRODUCERS_SOURCE_ORDER) {
    claimedClients.add(clients[source].identity);
  }
}

function poisonShared(shared) {
  if (shared === undefined) return;
  shared.poisoned = true;
  for (const controller of shared.controllers) {
    try { abortOwnedController(shared, controller); } catch {}
  }
}

function poisonAndReject(shared) {
  poisonShared(shared);
  return reject();
}

function checkShared(shared, runtime, signal) {
  if (shared === undefined || shared.terminal || shared.poisoned
    || signalAborted(shared.rootSignal)
    || (signal !== undefined && signalAborted(signal))
    || clockMilliseconds(runtime) >= shared.expiresAt) {
    return poisonAndReject(shared);
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
    return reject();
  }
  return function disposeAbortSubscription() {
    try {
      if (subscribed) {
        Reflect.apply(INTRINSIC_REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
      }
    } catch {
      return reject();
    } finally {
      subscribed = false;
      signal = undefined;
      listener = undefined;
    }
    return undefined;
  };
}

function linkedObservationSignal(shared, sourceState, requestSignal) {
  const controller = new AbortController();
  const disposers = [];
  let expiryTimer;
  let expiryTimerStarted = false;
  const abort = () => {
    try { abortOwnedController(shared, controller); } catch {
      poisonShared(shared);
    }
    poisonShared(shared);
  };
  shared.controllers.add(controller);
  sourceState.controllers.add(controller);
  try {
    for (const signal of new Set([
      shared.rootSignal,
      sourceState.signal,
      requestSignal,
    ])) {
      disposers.push(subscribeToAbort(signal, abort));
    }
    checkShared(shared, sourceState.runtime, controller.signal);
    const remainingMilliseconds = shared.expiresAt - clockMilliseconds(sourceState.runtime);
    if (!Number.isSafeInteger(remainingMilliseconds) || remainingMilliseconds <= 0) reject();
    expiryTimer = sourceState.runtime.set_timer(
      () => poisonShared(shared),
      remainingMilliseconds,
    );
    expiryTimerStarted = true;
  } catch {
    if (expiryTimerStarted) {
      try { sourceState.runtime.clear_timer(expiryTimer); } catch {}
    }
    for (const dispose of disposers.splice(0)) {
      try { dispose(); } catch {}
    }
    shared.controllers.delete(controller);
    sourceState.controllers.delete(controller);
    try { abortOwnedController(shared, controller); } catch {}
    expiryTimer = undefined;
    return poisonAndReject(shared);
  }
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      let failed = false;
      try { abortOwnedController(shared, controller); } catch {
        failed = true;
      }
      if (expiryTimerStarted) {
        try { sourceState.runtime.clear_timer(expiryTimer); } catch {
          failed = true;
        }
      }
      for (const dispose of disposers.splice(0)) {
        try { dispose(); } catch {
          failed = true;
        }
      }
      shared.controllers.delete(controller);
      sourceState.controllers.delete(controller);
      expiryTimer = undefined;
      expiryTimerStarted = false;
      if (failed) reject();
    },
  });
}

function isolatedCleanupSignal(shared, requestSignal) {
  const controller = new AbortController();
  let dispose;
  const abort = () => {
    try { abortOwnedController(shared, controller); } catch {}
  };
  try {
    dispose = subscribeToAbort(requestSignal, abort);
  } catch {
    try { abortOwnedController(shared, controller); } catch {}
    return reject();
  }
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      let failed = false;
      try { dispose(); } catch {
        failed = true;
      }
      try { abortOwnedController(shared, controller); } catch {
        failed = true;
      }
      dispose = undefined;
      if (failed) reject();
    },
  });
}

function trackPendingCallback(sourceState, callbackTask) {
  const settlement = Promise.resolve(callbackTask).then(
    () => undefined,
    () => undefined,
  );
  sourceState.pending.add(settlement);
  void settlement.finally(() => sourceState.pending?.delete(settlement));
  return callbackTask;
}

async function settlePendingCallbacks(sourceState) {
  while (sourceState.pending.size > 0) {
    await Promise.allSettled([...sourceState.pending]);
  }
}

function terminalSharedClose(shared) {
  shared.closedSources += 1;
  if (shared.closedSources !== SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.length) return;
  let cleanupFailed = false;
  for (const controller of shared.controllers) {
    try { abortOwnedController(shared, controller); } catch {
      cleanupFailed = true;
    }
  }
  shared.controllers.clear();
  try { shared.disposeRootAbort?.(); } catch {
    cleanupFailed = true;
  }
  shared.disposeRootAbort = undefined;
  shared.callbackToken = undefined;
  shared.rootSignal = undefined;
  shared.expiresAt = undefined;
  shared.terminal = true;
  if (cleanupFailed) {
    shared.poisoned = true;
    reject();
  }
}

function createSourceSession(source, client, shared, runtime) {
  const sourceController = new AbortController();
  const state = {
    source,
    client,
    shared,
    runtime,
    signal: sourceController.signal,
    sourceController,
    controllers: new Set(),
    cursor: 0,
    lifecycle: 'open',
    active: undefined,
    pending: new Set(),
  };
  shared.controllers.add(sourceController);

  async function performRead(descriptorValue) {
    let context;
    let link;
    let clientDescriptor;
    let callbackTask;
    try {
      if (state.lifecycle !== 'open') poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime);
      context = validateSourceSessionProducerReadDescriptor(
        descriptorValue,
        state.source,
        state.cursor,
      );
      checkShared(state.shared, state.runtime, context.signal);
      state.cursor += 1; // Reserve before invoking or awaiting the injected source client.
      link = linkedObservationSignal(state.shared, state, context.signal);
      clientDescriptor = createSourceSessionProducerClientDescriptor(context, link.signal);
      callbackTask = trackPendingCallback(state, Promise.resolve().then(() => {
        if (state.lifecycle !== 'open') poisonAndReject(state.shared);
        checkShared(state.shared, state.runtime, link.signal);
        return callbackContext.run(state.shared.callbackToken, () => (
          Promise.resolve(state.client.observe(clientDescriptor))
        ));
      }));
      const value = await callbackTask;
      if (state.lifecycle !== 'open') poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime, context.signal);
      const observation = validateSourceSessionProducerObservation(value, context);
      checkShared(state.shared, state.runtime, context.signal);
      return observation;
    } catch {
      poisonShared(state.shared);
      throw failure();
    } finally {
      let cleanupFailed = false;
      try { link?.dispose(); } catch {
        cleanupFailed = true;
      }
      context = undefined;
      link = undefined;
      clientDescriptor = undefined;
      callbackTask = undefined;
      if (cleanupFailed || state.shared?.poisoned) poisonAndReject(state.shared);
    }
  }

  function startRead(descriptor) {
    if (state.lifecycle !== 'open' || state.active !== undefined) {
      poisonShared(state.shared);
      return Promise.reject(failure());
    }
    const task = Promise.resolve().then(() => performRead(descriptor));
    state.active = task;
    void task.finally(() => {
      if (state.active === task) state.active = undefined;
    }).catch(() => undefined);
    return task;
  }

  async function closeCapturedClient(cleanupSignal) {
    let link;
    let callbackTask;
    let closeFailed = false;
    try {
      link = isolatedCleanupSignal(state.shared, cleanupSignal);
      callbackTask = trackPendingCallback(state, Promise.resolve().then(() => (
        callbackContext.run(state.shared.callbackToken, () => (
          Promise.resolve(state.client.close(link.signal))
        ))
      )));
      const value = await callbackTask;
      if (value !== undefined || signalAborted(link.signal)) reject();
    } catch {
      closeFailed = true;
      poisonShared(state.shared);
    } finally {
      callbackTask = undefined;
      try { link?.dispose(); } catch {
        closeFailed = true;
        poisonShared(state.shared);
      }
      link = undefined;
    }
    return closeFailed;
  }

  function finalizeClose(sharedState, runtimeState, sourceName, completed, cleanupFailed) {
    let closeFailed = cleanupFailed;
    try {
      if (signalAborted(sharedState.rootSignal)
        || clockMilliseconds(runtimeState) >= sharedState.expiresAt) {
        closeFailed = true;
        poisonShared(sharedState);
      }
    } catch {
      closeFailed = true;
      poisonShared(sharedState);
    }
    if (state.pending.size !== 0) {
      closeFailed = true;
      poisonShared(sharedState);
    }
    for (const controller of state.controllers) {
      try { abortOwnedController(sharedState, controller); } catch {
        closeFailed = true;
      }
      sharedState.controllers.delete(controller);
    }
    state.controllers.clear();
    sharedState.controllers.delete(state.sourceController);
    state.lifecycle = 'closed';
    state.client = undefined;
    state.active = undefined;
    state.signal = undefined;
    state.sourceController = undefined;
    state.cursor = undefined;
    state.pending.clear();
    state.pending = undefined;
    try { runtimeState.client_released(sourceName); } catch {
      closeFailed = true;
      poisonShared(sharedState);
    }
    state.runtime = undefined;
    state.source = undefined;
    try { terminalSharedClose(sharedState); } catch {
      closeFailed = true;
      poisonShared(sharedState);
    }
    if (!completed || closeFailed || sharedState.poisoned) throw failure();
    return undefined;
  }

  async function performClose(cleanupSignal) {
    const sharedState = state.shared;
    const runtimeState = state.runtime;
    const sourceName = state.source;
    const completed = state.cursor === SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE[sourceName].length;
    if (!completed && !sharedState.poisoned) poisonShared(sharedState);
    state.lifecycle = 'closing';
    for (const controller of state.controllers) {
      try { abortOwnedController(sharedState, controller); } catch {
        poisonShared(sharedState);
      }
    }
    try { abortOwnedController(sharedState, state.sourceController); } catch {
      poisonShared(sharedState);
    }
    let cleanupFailed = false;
    try {
      if (state.active !== undefined) await Promise.allSettled([state.active]);
      await settlePendingCallbacks(state);
      cleanupFailed = await closeCapturedClient(cleanupSignal);
      await settlePendingCallbacks(state);
    } catch {
      cleanupFailed = true;
      poisonShared(sharedState);
    }
    return finalizeClose(
      sharedState,
      runtimeState,
      sourceName,
      completed,
      cleanupFailed,
    );
  }

  const session = Object.freeze({
    source,
    scope: SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE[source],
    expires_at_milliseconds: shared.expiresAt,
    read(descriptor) {
      if (state.shared?.callbackToken !== undefined
        && callbackContext.getStore() === state.shared.callbackToken) {
        poisonShared(state.shared);
        return Promise.reject(failure());
      }
      if (arguments.length !== 1) {
        poisonShared(state.shared);
        return Promise.reject(failure());
      }
      return startRead(descriptor);
    },
    close(signal) {
      if (state.shared?.callbackToken !== undefined
        && callbackContext.getStore() === state.shared.callbackToken) {
        poisonShared(state.shared);
        return Promise.reject(failure());
      }
      if (arguments.length !== 1 || state.lifecycle !== 'open') {
        poisonShared(state.shared);
        return Promise.reject(failure());
      }
      try {
        validateSourceSessionProducerSignal(signal);
        if (signalAborted(signal)) reject();
      } catch {
        poisonShared(state.shared);
        return Promise.reject(failure());
      }
      return performClose(signal);
    },
  });
  client = undefined;
  shared = undefined;
  runtime = undefined;
  source = undefined;
  return session;
}

function createSessions(clientsValue, optionsValue, runtimeValue) {
  let shared;
  try {
    const runtime = validateSourceSessionProducerRuntime(runtimeValue);
    const now = clockMilliseconds(runtime);
    const inputs = validateSourceSessionProducerFactoryInputs(clientsValue, optionsValue, now);
    if (signalAborted(inputs.signal)) reject();
    const canonicalOptions = Object.freeze({
      signal: inputs.signal,
      expires_at_milliseconds: inputs.expires_at_milliseconds,
    });
    shared = {
      rootSignal: inputs.signal,
      expiresAt: inputs.expires_at_milliseconds,
      callbackToken: Object.freeze(Object.create(null)),
      controllers: new Set(),
      disposeRootAbort: undefined,
      poisoned: false,
      terminal: false,
      closedSources: 0,
    };
    shared.disposeRootAbort = subscribeToAbort(shared.rootSignal, () => poisonShared(shared));
    checkShared(shared, runtime);
    const sessions = Object.freeze(Object.fromEntries(
      SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.map((source) => [
        source,
        createSourceSession(source, inputs.clients[source], shared, runtime),
      ]),
    ));
    const validatedSessions = validateSourceSessionProducerSessions(
      sessions,
      canonicalOptions,
      now,
    );
    checkShared(shared, runtime);
    claimClients(inputs.clients);
    return validatedSessions;
  } catch {
    poisonShared(shared);
    try { shared?.disposeRootAbort?.(); } catch {}
    if (shared !== undefined) shared.disposeRootAbort = undefined;
    throw failure();
  }
}

export function createBrowserRelaySourceSessionsInternal(clientsValue, optionsValue) {
  return createSessions(clientsValue, optionsValue, productionRuntime);
}

export function createBrowserRelaySourceSessionsForTestInternal(
  clientsValue,
  optionsValue,
  runtimeValue,
) {
  return createSessions(clientsValue, optionsValue, runtimeValue);
}
