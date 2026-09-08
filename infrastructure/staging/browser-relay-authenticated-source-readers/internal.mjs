import { AsyncLocalStorage } from 'node:async_hooks';

import {
  AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE,
  AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER,
  StagingBrowserRelayAuthenticatedSourceReaderError,
  createAuthenticatedSourceReaderContext,
  validateAuthenticatedSourceReaderFactoryInputs,
  validateAuthenticatedSourceReaderObservation,
  validateAuthenticatedSourceReaderRequest,
  validateAuthenticatedSourceReaderRuntime,
} from './contract.mjs';

const INTRINSIC_DATE_NOW = Date.now.bind(Date);
const INTRINSIC_ABORT = AbortController.prototype.abort;
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const claimedAuthorities = new WeakSet();
const callbackContext = new AsyncLocalStorage();

const productionRuntime = Object.freeze({
  clock: INTRINSIC_DATE_NOW,
  authority_released() {},
});

function failure() {
  return new StagingBrowserRelayAuthenticatedSourceReaderError();
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
    value = runtime.methods.clock();
  } catch {
    return reject();
  }
  if (!Number.isSafeInteger(value) || value < 0) reject();
  return value;
}

function claimAuthorities(authorities) {
  for (const source of AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER) {
    if (claimedAuthorities.has(authorities[source].identity)) reject();
  }
  for (const source of AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER) {
    claimedAuthorities.add(authorities[source].identity);
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

function linkedStageSignal(shared, requestSignal, controller) {
  const disposers = [];
  const abort = () => {
    try { abortController(controller); } catch {
      poisonShared(shared);
    }
  };
  try {
    for (const signal of new Set([shared.rootSignal, requestSignal])) {
      disposers.push(subscribeToAbort(signal, abort));
    }
  } catch {
    for (const dispose of disposers.splice(0)) {
      try { dispose(); } catch {}
    }
    return poisonAndReject(shared);
  }
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      let failed = false;
      for (const dispose of disposers.splice(0)) {
        try { dispose(); } catch {
          failed = true;
        }
      }
      if (failed) reject();
    },
  });
}

function bindOperationCapability(shared, capability) {
  if (shared.operationCapability === undefined) {
    shared.operationCapability = capability;
  } else if (shared.operationCapability !== capability) {
    poisonAndReject(shared);
  }
}

function terminalSharedClose(shared) {
  shared.closedProviders += 1;
  if (shared.closedProviders !== AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.length) return;
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

function readerResult(done, observation) {
  return done
    ? Object.freeze({ done: true })
    : Object.freeze({ done: false, observation });
}

function createStageReader(providerState, request) {
  const controller = new AbortController();
  const signalLink = linkedStageSignal(providerState.shared, request.signal, controller);
  const state = {
    provider: providerState,
    shared: providerState.shared,
    runtime: providerState.runtime,
    request,
    controller,
    signal: signalLink.signal,
    signalLink,
    cursor: 0,
    eofEmitted: false,
    lifecycle: 'open',
    active: undefined,
  };
  state.shared.controllers.add(controller);

  async function performNext() {
    try {
      if (state.lifecycle !== 'open') poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime, state.signal);
      if (state.cursor === state.request.expected_kinds.length) {
        if (state.eofEmitted) poisonAndReject(state.shared);
        state.eofEmitted = true;
        return readerResult(true);
      }
      const kind = state.request.expected_kinds[state.cursor];
      state.cursor += 1; // Reserve before invoking or awaiting the authority.
      const context = createAuthenticatedSourceReaderContext(
        state.request,
        kind,
        state.signal,
      );
      let value;
      try {
        value = await callbackContext.run(
          state.shared.callbackToken,
          () => state.provider.authority.methods[kind](context),
        );
      } catch {
        return poisonAndReject(state.shared);
      }
      if (state.lifecycle !== 'open') poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime, state.signal);
      const observation = validateAuthenticatedSourceReaderObservation(
        value,
        state.request,
        kind,
      );
      checkShared(state.shared, state.runtime, state.signal);
      return readerResult(false, observation);
    } catch {
      poisonShared(state.shared);
      throw failure();
    }
  }

  function next() {
    if (arguments.length !== 0 || state.lifecycle !== 'open'
      || state.active !== undefined || state.eofEmitted) {
      poisonShared(state.shared);
      return Promise.reject(failure());
    }
    const task = Promise.resolve().then(performNext);
    state.active = task;
    void task.finally(() => {
      if (state.active === task) state.active = undefined;
    }).catch(() => undefined);
    return task;
  }

  async function performClose() {
    const wasPoisoned = state.shared.poisoned;
    const completed = state.eofEmitted;
    state.lifecycle = 'closing';
    try { abortController(state.controller); } catch {
      poisonShared(state.shared);
    }
    if (state.active !== undefined) await Promise.allSettled([state.active]);
    let cleanupFailed = false;
    try { state.signalLink.dispose(); } catch {
      cleanupFailed = true;
      poisonShared(state.shared);
    }
    state.lifecycle = 'closed';
    state.shared.controllers.delete(state.controller);
    if (state.provider.activeReader === reader) state.provider.activeReader = undefined;
    state.request = undefined;
    state.controller = undefined;
    state.signal = undefined;
    state.signalLink = undefined;
    state.active = undefined;
    state.provider = undefined;
    state.runtime = undefined;
    const shared = state.shared;
    if ((!completed && !wasPoisoned) || cleanupFailed) {
      poisonShared(shared);
      throw failure();
    }
    return undefined;
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

  const reader = Object.freeze({ next, close });
  return reader;
}

function createSourceProvider(source, authority, shared, runtime) {
  const state = {
    source,
    authority,
    shared,
    runtime,
    cursor: 0,
    lifecycle: 'open',
    activeReader: undefined,
  };

  function openStage(requestValue) {
    try {
      if (arguments.length !== 1 || state.lifecycle !== 'open'
        || state.activeReader !== undefined) poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime);
      const request = validateAuthenticatedSourceReaderRequest(
        requestValue,
        state.source,
        state.cursor,
      );
      bindOperationCapability(state.shared, request.operation_capability);
      checkShared(state.shared, state.runtime, request.signal);
      state.cursor += 1;
      const reader = createStageReader(state, request);
      state.activeReader = reader;
      return reader;
    } catch {
      poisonShared(state.shared);
      throw failure();
    }
  }

  async function performClose() {
    const shared = state.shared;
    const runtime = state.runtime;
    const source = state.source;
    const completed = state.cursor
      === AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE[state.source].length;
    if ((!completed || state.activeReader !== undefined) && !shared.poisoned) {
      poisonShared(shared);
    }
    state.lifecycle = 'closing';
    let closeFailed = false;
    if (state.activeReader !== undefined) {
      try {
        await state.activeReader.close();
      } catch {
        closeFailed = true;
        poisonShared(shared);
      }
    }
    try { checkShared(shared, runtime); } catch {
      closeFailed = true;
    }
    try {
      const value = await callbackContext.run(
        shared.callbackToken,
        () => state.authority.methods.close(),
      );
      if (value !== undefined) reject();
    } catch {
      closeFailed = true;
      poisonShared(shared);
    }
    try { checkShared(shared, runtime); } catch {
      closeFailed = true;
    }
    state.lifecycle = 'closed';
    state.authority = undefined;
    state.activeReader = undefined;
    try { runtime.methods.authority_released(source); } catch {
      closeFailed = true;
      poisonShared(shared);
    }
    state.runtime = undefined;
    state.source = undefined;
    terminalSharedClose(shared);
    if (!completed || closeFailed || shared.poisoned) throw failure();
    return undefined;
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

  const provider = Object.freeze({ openStage, close });
  return provider;
}

function createReaders(authorityValue, optionsValue, runtimeValue) {
  let shared;
  try {
    const runtime = validateAuthenticatedSourceReaderRuntime(runtimeValue);
    const now = clockMilliseconds(runtime);
    const inputs = validateAuthenticatedSourceReaderFactoryInputs(
      authorityValue,
      optionsValue,
      now,
    );
    claimAuthorities(inputs.authorities);
    shared = {
      rootSignal: inputs.signal,
      expiresAt: inputs.expires_at_milliseconds,
      operationCapability: undefined,
      callbackToken: Object.freeze(Object.create(null)),
      controllers: new Set(),
      poisoned: signalAborted(inputs.signal),
      terminal: false,
      closedProviders: 0,
    };
    const providers = Object.fromEntries(
      AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.map((source) => [
        source,
        createSourceProvider(source, inputs.authorities[source], shared, runtime),
      ]),
    );
    return Object.freeze(providers);
  } catch {
    poisonShared(shared);
    throw failure();
  }
}

export function createBrowserRelayAuthenticatedSourceReadersInternal(
  authorityValue,
  optionsValue,
) {
  return createReaders(authorityValue, optionsValue, productionRuntime);
}

export function createBrowserRelayAuthenticatedSourceReadersForTestInternal(
  authorityValue,
  optionsValue,
  runtimeValue,
) {
  return createReaders(authorityValue, optionsValue, runtimeValue);
}
