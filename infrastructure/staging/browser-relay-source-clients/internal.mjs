import { AsyncLocalStorage } from 'node:async_hooks';
import {
  clearTimeout as clearTimeoutIntrinsic,
  setTimeout as setTimeoutIntrinsic,
} from 'node:timers';

import {
  SOURCE_CLIENTS_CALLS_BY_SOURCE,
  SOURCE_CLIENTS_CLIENT_FIELDS,
  SOURCE_CLIENTS_SOURCE_ORDER,
  StagingBrowserRelaySourceClientError,
  createSourceClientAcquireDescriptor,
  validateSourceClientDescriptor,
  validateSourceClientFactoryInputs,
  validateSourceClientReceipt,
  validateSourceClientRuntime,
  validateSourceClientSignal,
} from './contract.mjs';

const INTRINSIC_DATE_NOW = Date.now.bind(Date);
const INTRINSIC_SET_TIMEOUT = setTimeoutIntrinsic;
const INTRINSIC_CLEAR_TIMEOUT = clearTimeoutIntrinsic;
const INTRINSIC_ABORT = AbortController.prototype.abort;
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const claimedAuthorities = new WeakSet();
const claimedReceipts = new WeakSet();
const callbackContext = new AsyncLocalStorage();

const productionRuntime = Object.freeze({
  clock: INTRINSIC_DATE_NOW,
  set_timer: (callback, milliseconds) => INTRINSIC_SET_TIMEOUT(callback, milliseconds),
  clear_timer: (handle) => INTRINSIC_CLEAR_TIMEOUT(handle),
  authority_released() {},
});

function failure() {
  return new StagingBrowserRelaySourceClientError();
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

function abortController(controller, shared) {
  try {
    if (!signalAborted(controller.signal)) {
      const invoke = () => Reflect.apply(INTRINSIC_ABORT, controller, [failure()]);
      if (shared?.callbackToken === undefined) invoke();
      else callbackContext.run(shared.callbackToken, invoke);
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

function poisonShared(shared) {
  if (shared === undefined) return;
  shared.poisoned = true;
  for (const controller of shared.controllers) {
    try { abortController(controller, shared); } catch {}
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

function linkedAcquireSignal(shared, sourceState, requestSignal) {
  const controller = new AbortController();
  const disposers = [];
  let expiryTimer;
  let expiryTimerStarted = false;
  const abort = () => {
    try { abortController(controller, shared); } catch {}
    poisonShared(shared);
  };
  shared.controllers.add(controller);
  sourceState.controllers.add(controller);
  try {
    for (const signal of new Set([shared.rootSignal, sourceState.signal, requestSignal])) {
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
    try { abortController(controller, shared); } catch {}
    expiryTimer = undefined;
    return poisonAndReject(shared);
  }
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      let failed = false;
      try { abortController(controller, shared); } catch {
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
    try { abortController(controller, shared); } catch {}
  };
  try {
    dispose = subscribeToAbort(requestSignal, abort);
  } catch {
    try { abortController(controller, shared); } catch {}
    return reject();
  }
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      let failed = false;
      try { dispose(); } catch {
        failed = true;
      }
      try { abortController(controller, shared); } catch {
        failed = true;
      }
      dispose = undefined;
      if (failed) reject();
    },
  });
}

function createRequestCapability() {
  const capability = () => {
    throw failure();
  };
  Object.setPrototypeOf(capability, null);
  return Object.freeze(capability);
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
  if (shared.closedSources !== SOURCE_CLIENTS_SOURCE_ORDER.length) return;
  let cleanupFailed = false;
  for (const controller of shared.controllers) {
    try { abortController(controller, shared); } catch {
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

function claimAuthorityIdentities(authorities) {
  for (const source of SOURCE_CLIENTS_SOURCE_ORDER) {
    if (claimedAuthorities.has(authorities[source].identity)) reject();
  }
  for (const source of SOURCE_CLIENTS_SOURCE_ORDER) {
    claimedAuthorities.add(authorities[source].identity);
  }
}

function validateClientMap(clients) {
  if (!Object.isFrozen(clients)
    || !isExactKeySet(clients, SOURCE_CLIENTS_SOURCE_ORDER)) reject();
  const identities = new Set();
  for (const source of SOURCE_CLIENTS_SOURCE_ORDER) {
    const client = clients[source];
    if (!Object.isFrozen(client) || !isExactKeySet(client, SOURCE_CLIENTS_CLIENT_FIELDS)
      || typeof client.observe !== 'function' || typeof client.close !== 'function'
      || identities.has(client)) reject();
    identities.add(client);
  }
  return clients;
}

function isExactKeySet(value, expected) {
  try {
    const keys = Reflect.ownKeys(value);
    return keys.every((key) => typeof key === 'string')
      && keys.length === expected.length
      && expected.every((key) => keys.includes(key));
  } catch {
    return false;
  }
}

function createSourceClient(source, authority, shared, runtime) {
  const sourceController = new AbortController();
  const state = {
    source,
    authority,
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

  async function performAcquire(descriptorValue) {
    let context;
    let link;
    let capability;
    let acquireDescriptor;
    let callbackTask;
    let receipt;
    try {
      if (state.lifecycle !== 'open') poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime);
      context = validateSourceClientDescriptor(descriptorValue, state.source, state.cursor);
      checkShared(state.shared, state.runtime, context.signal);
      state.cursor += 1; // Reserve before invoking or awaiting the ephemeral source authority.
      link = linkedAcquireSignal(state.shared, state, context.signal);
      capability = createRequestCapability();
      acquireDescriptor = createSourceClientAcquireDescriptor(context, link.signal, capability);
      callbackTask = trackPendingCallback(state, Promise.resolve().then(() => {
        if (state.lifecycle !== 'open') poisonAndReject(state.shared);
        checkShared(state.shared, state.runtime, link.signal);
        return callbackContext.run(state.shared.callbackToken, () => (
          Promise.resolve(state.authority.acquire(acquireDescriptor))
        ));
      }));
      receipt = await callbackTask;
      if (state.lifecycle !== 'open') poisonAndReject(state.shared);
      checkShared(state.shared, state.runtime, context.signal);
      if (receipt === null || typeof receipt !== 'object' || claimedReceipts.has(receipt)) reject();
      claimedReceipts.add(receipt);
      const observation = callbackContext.run(state.shared.callbackToken, () => (
        validateSourceClientReceipt(receipt, context, capability)
      ));
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
      capability = undefined;
      acquireDescriptor = undefined;
      callbackTask = undefined;
      receipt = undefined;
      if (cleanupFailed || state.shared?.poisoned) poisonAndReject(state.shared);
    }
  }

  function startAcquire(descriptor) {
    if (state.lifecycle !== 'open' || state.active !== undefined) {
      poisonShared(state.shared);
      return Promise.reject(failure());
    }
    const task = Promise.resolve().then(() => performAcquire(descriptor));
    state.active = task;
    void task.finally(() => {
      if (state.active === task) state.active = undefined;
    }).catch(() => undefined);
    return task;
  }

  async function closeCapturedAuthority(cleanupSignal) {
    let link;
    let callbackTask;
    let closeFailed = false;
    try {
      link = isolatedCleanupSignal(state.shared, cleanupSignal);
      callbackTask = trackPendingCallback(state, Promise.resolve().then(() => (
        callbackContext.run(state.shared.callbackToken, () => (
          Promise.resolve(state.authority.close(link.signal))
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
      try { abortController(controller, sharedState); } catch {
        closeFailed = true;
      }
      sharedState.controllers.delete(controller);
    }
    state.controllers.clear();
    sharedState.controllers.delete(state.sourceController);
    state.lifecycle = 'closed';
    state.authority = undefined;
    state.active = undefined;
    state.signal = undefined;
    state.sourceController = undefined;
    state.cursor = undefined;
    state.pending.clear();
    state.pending = undefined;
    try { runtimeState.authority_released(sourceName); } catch {
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
    const completed = state.cursor === SOURCE_CLIENTS_CALLS_BY_SOURCE[sourceName].length;
    if (!completed && !sharedState.poisoned) poisonShared(sharedState);
    for (const controller of state.controllers) {
      try { abortController(controller, sharedState); } catch {
        poisonShared(sharedState);
      }
    }
    try { abortController(state.sourceController, sharedState); } catch {
      poisonShared(sharedState);
    }
    let cleanupFailed = false;
    try {
      if (state.active !== undefined) await Promise.allSettled([state.active]);
      await settlePendingCallbacks(state);
      cleanupFailed = await closeCapturedAuthority(cleanupSignal);
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

  return Object.freeze({
    observe(descriptor) {
      if (state.shared?.callbackToken !== undefined
        && callbackContext.getStore() === state.shared.callbackToken) {
        poisonShared(state.shared);
        return Promise.reject(failure());
      }
      if (arguments.length !== 1) {
        poisonShared(state.shared);
        return Promise.reject(failure());
      }
      return startAcquire(descriptor);
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
        validateSourceClientSignal(signal);
        if (signalAborted(signal)) reject();
      } catch {
        poisonShared(state.shared);
        return Promise.reject(failure());
      }
      state.lifecycle = 'closing';
      const task = Promise.resolve().then(() => performClose(signal));
      return task;
    },
  });
}

function canonicalInputs(authoritiesValue, optionsValue, runtimeValue) {
  const runtime = validateSourceClientRuntime(runtimeValue);
  const now = clockMilliseconds(runtime);
  const inputs = validateSourceClientFactoryInputs(authoritiesValue, optionsValue, now);
  if (signalAborted(inputs.signal)) reject();
  return Object.freeze({ inputs, runtime });
}

function createClients(authoritiesValue, optionsValue, runtimeValue) {
  let canonical;
  let shared;
  try {
    canonical = canonicalInputs(authoritiesValue, optionsValue, runtimeValue);
    shared = {
      rootSignal: canonical.inputs.signal,
      expiresAt: canonical.inputs.expires_at_milliseconds,
      callbackToken: Object.freeze({}),
      controllers: new Set(),
      disposeRootAbort: undefined,
      closedSources: 0,
      poisoned: false,
      terminal: false,
    };
    const sharedState = shared;
    const rootAbort = () => poisonShared(sharedState);
    shared.disposeRootAbort = subscribeToAbort(shared.rootSignal, rootAbort);
    checkShared(shared, canonical.runtime);
    const clients = Object.freeze(Object.fromEntries(SOURCE_CLIENTS_SOURCE_ORDER.map((source) => [
      source,
      createSourceClient(
        source,
        canonical.inputs.authorities[source],
        shared,
        canonical.runtime,
      ),
    ])));
    validateClientMap(clients);
    checkShared(shared, canonical.runtime);
    claimAuthorityIdentities(canonical.inputs.authorities);
    canonical = undefined;
    return clients;
  } catch {
    poisonShared(shared);
    try { shared?.disposeRootAbort?.(); } catch {}
    if (shared !== undefined) shared.disposeRootAbort = undefined;
    canonical = undefined;
    throw failure();
  }
}

export function createBrowserRelaySourceClientsInternal(authorities, options) {
  return createClients(authorities, options, productionRuntime);
}

export function createBrowserRelaySourceClientsForTestInternal(authorities, options, runtime) {
  return createClients(authorities, options, runtime);
}
