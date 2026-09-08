import { AsyncLocalStorage } from 'node:async_hooks';

import {
  SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE,
  SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE,
  SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_CLOSE_MILLISECONDS,
  SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS,
  SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER,
  StagingBrowserRelaySourceAuthorityAdapterError,
  createSourceAuthorityAdapterReadDescriptor,
  validateSourceAuthorityAdapterContext,
  validateSourceAuthorityAdapterFactoryInputs,
  validateSourceAuthorityAdapterObservation,
  validateSourceAuthorityAdapterRuntime,
} from './contract.mjs';

const INTRINSIC_DATE_NOW = Date.now.bind(Date);
const INTRINSIC_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const INTRINSIC_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const INTRINSIC_ABORT = AbortController.prototype.abort;
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const claimedSessions = new WeakSet();
const callbackContext = new AsyncLocalStorage();

const productionRuntime = Object.freeze({
  clock: INTRINSIC_DATE_NOW,
  set_timer: (callback, milliseconds) => INTRINSIC_SET_TIMEOUT(callback, milliseconds),
  clear_timer: (handle) => INTRINSIC_CLEAR_TIMEOUT(handle),
  session_released() {},
});

function failure() {
  return new StagingBrowserRelaySourceAuthorityAdapterError();
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
  let value;
  try {
    value = runtime.clock();
  } catch {
    return reject();
  }
  if (!Number.isSafeInteger(value) || value < 0) reject();
  return value;
}

function claimSessions(sessions) {
  for (const source of SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER) {
    if (claimedSessions.has(sessions[source].identity)) reject();
  }
  for (const source of SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER) {
    claimedSessions.add(sessions[source].identity);
  }
}

function poisonShared(shared) {
  if (shared === undefined) return;
  shared.poisoned = true;
  for (const controller of shared.controllers) {
    try { abortController(controller); } catch {}
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

function bindOperationCapability(shared, capability) {
  if (shared.operationCapability === undefined) {
    shared.operationCapability = capability;
  } else if (shared.operationCapability !== capability) {
    poisonAndReject(shared);
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

function linkedSignal(shared, sourceState, requestSignal) {
  const controller = new AbortController();
  const disposers = [];
  const abort = () => {
    try { abortController(controller); } catch {
      poisonShared(shared);
    }
  };
  try {
    for (const signal of new Set([
      shared.rootSignal,
      sourceState.signal,
      requestSignal,
    ])) {
      disposers.push(subscribeToAbort(signal, abort));
    }
  } catch {
    for (const dispose of disposers.splice(0)) {
      try { dispose(); } catch {}
    }
    return poisonAndReject(shared);
  }
  shared.controllers.add(controller);
  sourceState.controllers.add(controller);
  return Object.freeze({
    controller,
    signal: controller.signal,
    dispose() {
      let failed = false;
      try { abortController(controller); } catch {
        failed = true;
      }
      for (const dispose of disposers.splice(0)) {
        try { dispose(); } catch {
          failed = true;
        }
      }
      shared.controllers.delete(controller);
      sourceState.controllers.delete(controller);
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

async function invokeBounded(
  shared,
  sourceState,
  requestSignal,
  milliseconds,
  callback,
) {
  const link = linkedSignal(shared, sourceState, requestSignal);
  let timer;
  let disposeInterrupted;
  let callbackTask;
  try {
    const interrupted = new Promise((_, rejectPromise) => {
      disposeInterrupted = subscribeToAbort(link.signal, () => rejectPromise(failure()));
    });
    try {
      timer = sourceState.runtime.set_timer(() => {
        try { abortController(link.controller); } catch {
          poisonShared(shared);
        }
      }, milliseconds);
    } catch {
      return poisonAndReject(shared);
    }
    callbackTask = trackPendingCallback(sourceState, Promise.resolve().then(() => {
      if (sourceState.lifecycle !== 'open') poisonAndReject(shared);
      checkShared(shared, sourceState.runtime, link.signal);
      return callback(link.signal);
    }));
    return await Promise.race([callbackTask, interrupted]);
  } finally {
    let cleanupFailed = false;
    try {
      if (timer !== undefined) sourceState.runtime.clear_timer(timer);
    } catch {
      cleanupFailed = true;
    }
    try { disposeInterrupted?.(); } catch {
      cleanupFailed = true;
    }
    try { link.dispose(); } catch {
      cleanupFailed = true;
    }
    timer = undefined;
    disposeInterrupted = undefined;
    callbackTask = undefined;
    if (cleanupFailed) poisonAndReject(shared);
  }
}

function createDeadline(shared, runtime, milliseconds) {
  const controller = new AbortController();
  let disposed = false;
  let expired = false;
  let handle;
  let timerStarted = false;
  let rejectTimedOut;
  const timedOut = new Promise((_, rejectPromise) => {
    rejectTimedOut = rejectPromise;
  });
  void timedOut.catch(() => undefined);

  const expire = () => {
    if (disposed || expired) return;
    expired = true;
    try { abortController(controller); } catch {
      poisonShared(shared);
    }
    rejectTimedOut(failure());
  };
  try {
    handle = runtime.set_timer(expire, milliseconds);
    timerStarted = true;
  } catch {
    poisonShared(shared);
    expire();
  }

  return Object.freeze({
    signal: controller.signal,
    timed_out: timedOut,
    dispose() {
      if (disposed) return undefined;
      disposed = true;
      let failed = false;
      if (timerStarted) {
        try { runtime.clear_timer(handle); } catch {
          failed = true;
        }
      }
      try { abortController(controller); } catch {
        failed = true;
      }
      handle = undefined;
      rejectTimedOut = undefined;
      if (failed) return poisonAndReject(shared);
      return undefined;
    },
  });
}

function terminalSharedClose(shared) {
  shared.closedSources += 1;
  if (shared.closedSources !== SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.length) return;
  for (const controller of shared.controllers) {
    try { abortController(controller); } catch {
      shared.poisoned = true;
    }
  }
  shared.controllers.clear();
  shared.operationCapability = undefined;
  shared.callbackToken = undefined;
  shared.rootSignal = undefined;
  shared.expiresAt = undefined;
  shared.terminal = true;
}

function createSourceAuthority(source, session, shared, runtime) {
  const sourceController = new AbortController();
  const state = {
    source,
    session,
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

  async function performRead(contextValue, invokedKind) {
    let context;
    let descriptor;
    try {
      if (state.lifecycle !== 'open') poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime);
      context = validateSourceAuthorityAdapterContext(
        contextValue,
        state.source,
        state.cursor,
      );
      if (context.kind !== invokedKind) {
        poisonAndReject(state.shared);
      }
      bindOperationCapability(state.shared, context.operation_capability);
      checkShared(state.shared, state.runtime, context.signal);
      state.cursor += 1; // Reserve before invoking or awaiting the source session.
      let value;
      try {
        value = await invokeBounded(
          state.shared,
          state,
          context.signal,
          SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS,
          (signal) => {
            descriptor = createSourceAuthorityAdapterReadDescriptor(context, signal);
            return callbackContext.run(
              state.shared.callbackToken,
              () => state.session.read(descriptor),
            );
          },
        );
      } catch {
        return poisonAndReject(state.shared);
      }
      if (state.lifecycle !== 'open') poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime, context.signal);
      const observation = validateSourceAuthorityAdapterObservation(value, context);
      checkShared(state.shared, state.runtime, context.signal);
      return observation;
    } catch {
      poisonShared(state.shared);
      throw failure();
    } finally {
      context = undefined;
      descriptor = undefined;
    }
  }

  function startRead(context, invokedKind) {
    if (state.lifecycle !== 'open' || state.active !== undefined) {
      poisonShared(state.shared);
      return Promise.reject(failure());
    }
    const task = Promise.resolve().then(() => performRead(context, invokedKind));
    state.active = task;
    void task.finally(() => {
      if (state.active === task) state.active = undefined;
    }).catch(() => undefined);
    return task;
  }

  async function closeCapturedSession(sharedState, runtimeState) {
    const deadline = createDeadline(
      sharedState,
      runtimeState,
      SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_CLOSE_MILLISECONDS,
    );
    let callbackTask;
    let closeFailed = false;
    try {
      callbackTask = Promise.resolve().then(() => {
        if (signalAborted(deadline.signal)) reject();
        return callbackContext.run(
          sharedState.callbackToken,
          () => state.session.close(deadline.signal),
        );
      });
      void callbackTask.catch(() => undefined);
      try {
        const value = await Promise.race([callbackTask, deadline.timed_out]);
        if (value !== undefined) reject();
      } catch {
        closeFailed = true;
        poisonShared(sharedState);
      }
      await Promise.allSettled([callbackTask]);
    } finally {
      callbackTask = undefined;
      try { deadline.dispose(); } catch {
        closeFailed = true;
        poisonShared(sharedState);
      }
    }
    return closeFailed;
  }

  function finalizeClose(
    sharedState,
    runtimeState,
    sourceName,
    completed,
    cleanupFailed,
  ) {
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
      try { abortController(controller); } catch {
        closeFailed = true;
      }
      sharedState.controllers.delete(controller);
    }
    state.controllers.clear();
    sharedState.controllers.delete(state.sourceController);
    state.lifecycle = 'closed';
    state.session = undefined;
    state.active = undefined;
    state.signal = undefined;
    state.sourceController = undefined;
    state.cursor = undefined;
    state.pending.clear();
    state.pending = undefined;
    try { runtimeState.session_released(sourceName); } catch {
      closeFailed = true;
      poisonShared(sharedState);
    }
    state.runtime = undefined;
    state.source = undefined;
    terminalSharedClose(sharedState);
    if (!completed || closeFailed || sharedState.poisoned) throw failure();
    return undefined;
  }

  async function performClose() {
    const sharedState = state.shared;
    const runtimeState = state.runtime;
    const sourceName = state.source;
    const completed = state.cursor === SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[sourceName].length;
    if (!completed && !sharedState.poisoned) poisonShared(sharedState);
    state.lifecycle = 'closing';
    const publicDeadline = createDeadline(
      sharedState,
      runtimeState,
      SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_CLOSE_MILLISECONDS,
    );
    for (const controller of state.controllers) {
      try { abortController(controller); } catch {
        poisonShared(sharedState);
      }
    }
    try { abortController(state.sourceController); } catch {
      poisonShared(sharedState);
    }
    const cleanupTask = Promise.resolve().then(async () => {
      if (state.active !== undefined) await Promise.allSettled([state.active]);
      await settlePendingCallbacks(state);
      return closeCapturedSession(sharedState, runtimeState);
    });
    const complete = (cleanupFailed) => {
      let failed = cleanupFailed;
      try { publicDeadline.dispose(); } catch {
        failed = true;
        poisonShared(sharedState);
      }
      return finalizeClose(
        sharedState,
        runtimeState,
        sourceName,
        completed,
        failed,
      );
    };
    const terminalTask = cleanupTask.then(
      (cleanupFailed) => complete(cleanupFailed),
      () => complete(true),
    );
    void terminalTask.catch(() => undefined);
    try {
      return await Promise.race([terminalTask, publicDeadline.timed_out]);
    } catch {
      poisonShared(sharedState);
      throw failure();
    } finally {
      try { publicDeadline.dispose(); } catch {
        poisonShared(sharedState);
        throw failure();
      }
    }
  }

  function close() {
    if (state.shared?.callbackToken !== undefined
      && callbackContext.getStore() === state.shared.callbackToken) {
      poisonShared(state.shared);
      return Promise.reject(failure());
    }
    if (arguments.length !== 0 || state.lifecycle !== 'open') {
      poisonShared(state.shared);
      return Promise.reject(failure());
    }
    return performClose();
  }

  const authority = {};
  for (const method of SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE[source]) {
    if (method === 'close') {
      authority.close = close;
    } else {
      const methodRead = function sourceAuthorityRead(context) {
        if (arguments.length !== 1) {
          poisonShared(state.shared);
          return Promise.reject(failure());
        }
        return startRead(context, method);
      };
      authority[method] = methodRead;
    }
  }
  session = undefined;
  shared = undefined;
  runtime = undefined;
  source = undefined;
  return Object.freeze(authority);
}

function createAdapters(sessionsValue, optionsValue, runtimeValue) {
  let shared;
  try {
    const runtime = validateSourceAuthorityAdapterRuntime(runtimeValue);
    const now = clockMilliseconds(runtime);
    const inputs = validateSourceAuthorityAdapterFactoryInputs(
      sessionsValue,
      optionsValue,
      now,
    );
    if (signalAborted(inputs.signal)) reject();
    claimSessions(inputs.sessions);
    shared = {
      rootSignal: inputs.signal,
      expiresAt: inputs.expires_at_milliseconds,
      operationCapability: undefined,
      callbackToken: Object.freeze(Object.create(null)),
      controllers: new Set(),
      poisoned: false,
      terminal: false,
      closedSources: 0,
    };
    const authorities = Object.fromEntries(
      SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.map((source) => [
        source,
        createSourceAuthority(source, inputs.sessions[source], shared, runtime),
      ]),
    );
    return Object.freeze(authorities);
  } catch {
    poisonShared(shared);
    throw failure();
  }
}

export function createBrowserRelaySourceAuthorityAdaptersInternal(
  sessionsValue,
  optionsValue,
) {
  return createAdapters(sessionsValue, optionsValue, productionRuntime);
}

export function createBrowserRelaySourceAuthorityAdaptersForTestInternal(
  sessionsValue,
  optionsValue,
  runtimeValue,
) {
  return createAdapters(sessionsValue, optionsValue, runtimeValue);
}
