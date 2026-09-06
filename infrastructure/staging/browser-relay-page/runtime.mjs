import {
  BROWSER_ORDER,
  CONTROL_PLANE_EXCHANGE_ENDPOINT,
  HOME_ID,
  MAXIMUM_RUNNER_MILLISECONDS,
  PAGE_LIFECYCLE_OBSERVATION_SCHEMA,
  PAGE_OBSERVATION_SCHEMA,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
  StagingBrowserRelayPageError,
  validatePagePrivateInput,
  validatePageLifecycleObservation,
  validatePageSafeObservation,
} from './boundary.mjs';

const CLIENT_STATUSES = new Set([
  'idle',
  'connecting',
  'authenticating',
  'synchronizing',
  'ready',
  'reconnecting',
  'draining',
  'stopping',
  'stopped',
]);
const FAILURE_KINDS = new Set([
  'protocol',
  'authentication',
  'authorization',
  'conflict',
  'invalid_lifecycle',
  'unavailable',
  'cancelled',
  'internal',
]);
const FAILURE_OUTCOMES = new Set([
  'not_dispatched',
  'accepted',
  'applied',
  'failed',
  'outcome_unknown',
]);
const MAXIMUM_RETAINED_EVENTS = 64;
const MAXIMUM_SOURCE_TOKEN_BYTES = 16 * 1024;
const MAXIMUM_RETAINED_SOURCE_CREDENTIALS = 33;
const CLEANUP_DEADLINE_MILLISECONDS = 2_000;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const encoder = new TextEncoder();
const activePageHosts = new WeakSet();

function reject(message) {
  throw new StagingBrowserRelayPageError(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exactKeys(value, keys, description) {
  if (!plainObject(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    reject(`${description} must contain exactly the reviewed fields`);
  }
  return value;
}

function validateDependencies(value) {
  const dependencies = exactKeys(value, [
    'createBrowserClient',
    'createCredentialProvider',
    'createFirebaseSession',
    'fetch',
    'global',
    'now',
  ], 'Page dependencies');
  for (const key of [
    'createBrowserClient',
    'createCredentialProvider',
    'createFirebaseSession',
    'fetch',
    'now',
  ]) {
    if (typeof dependencies[key] !== 'function') reject(`Page dependency ${key} is invalid`);
  }
  if (!plainObject(dependencies.global)
    || typeof dependencies.global.WebSocket !== 'function'
    || typeof dependencies.global.addEventListener !== 'function'
    || typeof dependencies.global.removeEventListener !== 'function') {
    reject('Page browser dependencies are invalid');
  }
  return Object.freeze({ ...dependencies });
}

function sourceToken(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAXIMUM_SOURCE_TOKEN_BYTES
    || !TOKEN.test(value)) {
    reject('Firebase source credential has an invalid closed shape');
  }
  return value;
}

function includesBytes(haystack, needle) {
  if (!(haystack instanceof Uint8Array) || needle.length === 0 || haystack.length < needle.length) {
    return false;
  }
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

function outboundBytes(value) {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

function relayId(value) {
  if (value === RELAY_A_URL) return 'relay-a';
  if (value === RELAY_B_URL) return 'relay-b';
  return reject('Browser attempted an unreviewed relay URL');
}

function installBrowserPersistenceBoundary(globalObject) {
  const descriptor = Object.getOwnPropertyDescriptor(globalObject, 'indexedDB');
  try {
    Object.defineProperty(globalObject, 'indexedDB', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      writable: false,
      value: undefined,
    });
  } catch {
    reject('Browser credential persistence boundary could not be installed');
  }
  if (globalObject.indexedDB !== undefined) {
    reject('Browser credential persistence boundary did not close');
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    try {
      if (descriptor === undefined) delete globalObject.indexedDB;
      else Object.defineProperty(globalObject, 'indexedDB', descriptor);
    } catch {
      reject('Browser credential persistence boundary could not be restored');
    }
  };
}

function installWebSocketBoundary(globalObject, sourceCredentials, boundary, canConnect) {
  const NativeWebSocket = globalObject.WebSocket;
  const sockets = new Set();
  let resolveClosed;
  let closedPromise;
  class ObservedWebSocket extends NativeWebSocket {
    #closed = false;

    constructor(url, protocols) {
      const canonical = typeof url === 'string' ? url : String(url);
      const id = relayId(canonical);
      if (!canConnect() || boundary.activeWebsockets !== 0 || boundary.websocketConnections >= 4) {
        reject('Browser connection is outside the active page lifecycle');
      }
      if (protocols === undefined) super(url);
      else super(url, protocols);
      boundary.websocketConnections += 1;
      boundary.activeWebsockets += 1;
      boundary.maximumActiveWebsockets = Math.max(
        boundary.maximumActiveWebsockets,
        boundary.activeWebsockets,
      );
      boundary.relayIds.push(id);
      sockets.add(this);
      this.addEventListener('close', () => {
        if (this.#closed) return;
        this.#closed = true;
        sockets.delete(this);
        boundary.activeWebsockets = Math.max(0, boundary.activeWebsockets - 1);
        if (sockets.size === 0) {
          resolveClosed?.();
          resolveClosed = undefined;
          closedPromise = undefined;
        }
      }, { once: true });
    }

    send(value) {
      if (!canConnect()) reject('Browser send is outside the active page lifecycle');
      const bytes = outboundBytes(value);
      if (bytes !== undefined
        && sourceCredentials.some((credential) => includesBytes(bytes, credential))) {
        boundary.sourceCredentialsOnWebsocket += 1;
        reject('A source credential crossed the browser WebSocket boundary');
      }
      return super.send(value);
    }
  }
  globalObject.WebSocket = ObservedWebSocket;
  return Object.freeze({
    close() {
      if (sockets.size === 0) return Promise.resolve();
      if (closedPromise === undefined) {
        closedPromise = new Promise((resolve) => { resolveClosed = resolve; });
      }
      const pending = closedPromise;
      for (const socket of sockets) socket.close();
      return pending;
    },
    restore() {
      if (globalObject.WebSocket === ObservedWebSocket) globalObject.WebSocket = NativeWebSocket;
    },
  });
}

function validateFirebaseSession(value) {
  const session = exactKeys(value, [
    'dispose',
    'getAppCheckToken',
    'getFirebaseIdToken',
    'signOut',
  ], 'Firebase session');
  for (const key of Object.keys(session)) {
    if (typeof session[key] !== 'function') reject(`Firebase session ${key} is invalid`);
  }
  return session;
}

function validateClient(value) {
  if (!plainObject(value)
    || typeof value.start !== 'function'
    || typeof value.stop !== 'function'
    || typeof value.subscribe !== 'function'
    || !plainObject(value.errors)
    || typeof value.errors.subscribe !== 'function'
    || !plainObject(value.state)
    || typeof value.state.snapshot !== 'function'
    || typeof value.state.subscribe !== 'function'
    || !plainObject(value.calls)
    || typeof value.calls.start !== 'function') {
    reject('MiakAPI browser client boundary is invalid');
  }
  return value;
}

function stableFailure(value) {
  const kind = FAILURE_KINDS.has(value?.kind) ? value.kind : 'internal';
  const outcome = FAILURE_OUTCOMES.has(value?.outcome) ? value.outcome : 'outcome_unknown';
  return `${kind}:${outcome}`;
}

function recordBounded(target, value) {
  if (target.length < MAXIMUM_RETAINED_EVENTS) target.push(value);
}

function clearCredentialBytes(credentials) {
  for (const credential of credentials) credential.fill(0);
  credentials.splice(0, credentials.length);
}

function retainCredential(credentials, value) {
  const token = sourceToken(value);
  if (credentials.length >= MAXIMUM_RETAINED_SOURCE_CREDENTIALS) {
    reject('Page source-credential observation budget was exceeded');
  }
  credentials.push(encoder.encode(token));
  return token;
}

function duration(startedAt, now) {
  const value = Math.round(now() - startedAt);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_RUNNER_MILLISECONDS) {
    reject('Page observation duration is outside the reviewed bound');
  }
  return value;
}

function abortable(promise, signal) {
  return new Promise((resolve, rejectAbort) => {
    const abort = () => rejectAbort(new StagingBrowserRelayPageError('Page operation was cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, rejectAbort).finally(() => {
      signal.removeEventListener('abort', abort);
    });
    if (signal.aborted) abort();
  });
}

async function boundedCleanup(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, rejectTimeout) => {
        timer = setTimeout(() => rejectTimeout(
          new StagingBrowserRelayPageError('Page cleanup exceeded its deadline'),
        ), CLEANUP_DEADLINE_MILLISECONDS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createBrowserRelayPageHost(dependenciesValue) {
  const dependencies = validateDependencies(dependenciesValue);
  const sourceCredentials = [];
  const currentSourceCredentials = {
    appCheck: undefined,
    firebase: undefined,
  };
  const boundary = {
    appCheckTokenRequests: 0,
    appCheckInstances: 0,
    browserCredentialPersistenceEvents: 0,
    clientInstances: 0,
    clientStatuses: [],
    controlPlaneExchanges: 0,
    exchangeCacheConformant: true,
    failureClasses: [],
    firebaseAuthSessions: 0,
    firebaseTokenRequests: 0,
    maximumActiveWebsockets: 0,
    activeWebsockets: 0,
    relayIds: [],
    sourceCredentialsOnWebsocket: 0,
    websocketConnections: 0,
  };
  const lifecycle = {
    callOutcomes: [],
    disposals: 0,
    events: [],
    resumptions: 0,
    signOuts: 0,
    stateTransitions: [],
    suspensions: 0,
  };
  let browser;
  let client;
  let clientCleanupUncertain = false;
  let clientController;
  let clientGeneration = 0;
  let clientStopTask;
  let clientSubscriptions = [];
  let firebase;
  let initializeController;
  let initializationCleanupUncertain = false;
  let initializeRequested = false;
  let lifecycleCleanupUncertain = false;
  let lifecycleHandlers;
  let operationTail = Promise.resolve();
  let pendingFirebaseSession;
  let restorePersistence;
  let restoreWebSocket;
  let resumePromise;
  let stopPromise;
  let suspendPromise;
  let terminalRequested = false;
  let startedAt;
  let state = 'dormant';

  function serialize(operation) {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  }

  function observation() {
    const relayIds = [...new Set(boundary.relayIds)];
    return validatePageSafeObservation({
      schema: PAGE_OBSERVATION_SCHEMA,
      browser,
      state,
      client_instances: boundary.clientInstances,
      firebase_auth_sessions: boundary.firebaseAuthSessions,
      app_check_instances: boundary.appCheckInstances,
      firebase_token_requests: boundary.firebaseTokenRequests,
      app_check_token_requests: boundary.appCheckTokenRequests,
      control_plane_exchanges: boundary.controlPlaneExchanges,
      exchange_cache_conformant: boundary.exchangeCacheConformant,
      websocket_connections: boundary.websocketConnections,
      active_websockets: boundary.activeWebsockets,
      maximum_active_websockets: boundary.maximumActiveWebsockets,
      source_credentials_on_websocket: boundary.sourceCredentialsOnWebsocket,
      browser_credential_persistence_events: boundary.browserCredentialPersistenceEvents,
      relay_ids: relayIds,
      client_statuses: [...boundary.clientStatuses],
      failure_classes: [...boundary.failureClasses],
      duration_milliseconds: startedAt === undefined ? 0 : duration(startedAt, dependencies.now),
    });
  }

  function lifecycleObservation() {
    return validatePageLifecycleObservation({
      schema: PAGE_LIFECYCLE_OBSERVATION_SCHEMA,
      browser,
      events: lifecycle.events.map((event) => ({ ...event })),
      suspensions: lifecycle.suspensions,
      resumptions: lifecycle.resumptions,
      sign_outs: lifecycle.signOuts,
      disposals: lifecycle.disposals,
      state_transitions: lifecycle.stateTransitions.map((entry) => ({ ...entry })),
      call_outcomes: [...lifecycle.callOutcomes],
    });
  }

  function recordState(snapshot) {
    if (Number.isSafeInteger(snapshot?.revision)
      && snapshot.revision >= 0
      && typeof snapshot.stale === 'boolean') {
      recordBounded(lifecycle.stateTransitions, {
        revision: snapshot.revision,
        stale: snapshot.stale,
      });
    }
  }

  function createClient() {
    if (firebase === undefined || restoreWebSocket === undefined) reject('Page host is not initialized');
    if (boundary.clientInstances >= 4) reject('Page client instance budget was exceeded');
    const generation = clientGeneration + 1;
    clientGeneration = generation;
    const controller = new AbortController();
    clientController = controller;
    clientStopTask = undefined;
    const activeSignal = (requestSignal) => (
      requestSignal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, requestSignal])
    );
    const ensureActive = () => {
      if (terminalRequested
        || generation !== clientGeneration
        || controller.signal.aborted) {
        reject('Browser client operation is outside the active page lifecycle');
      }
    };
    const provider = dependencies.createCredentialProvider({
      exchangeEndpoint: CONTROL_PLANE_EXCHANGE_ENDPOINT,
      async getFirebaseIdToken(request) {
        boundary.firebaseTokenRequests += 1;
        ensureActive();
        const signal = activeSignal(request?.signal);
        const value = await abortable(firebase.getFirebaseIdToken(signal), signal);
        ensureActive();
        currentSourceCredentials.firebase = retainCredential(
          sourceCredentials,
          value,
        );
        return currentSourceCredentials.firebase;
      },
      async getAppCheckToken(request) {
        boundary.appCheckTokenRequests += 1;
        ensureActive();
        const signal = activeSignal(request?.signal);
        const value = await abortable(firebase.getAppCheckToken(signal), signal);
        ensureActive();
        currentSourceCredentials.appCheck = retainCredential(
          sourceCredentials,
          value,
        );
        return currentSourceCredentials.appCheck;
      },
      async fetch(input, init) {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        const headers = new Headers(init?.headers);
        const requestIsConformant = url === CONTROL_PLANE_EXCHANGE_ENDPOINT
          && init?.method === 'POST'
          && init?.cache === 'no-store'
          && init?.credentials === 'omit'
          && init?.redirect === 'error'
          && headers.get('authorization') === `Bearer ${currentSourceCredentials.firebase}`
          && headers.get('x-firebase-appcheck')
            === currentSourceCredentials.appCheck;
        if (!requestIsConformant) reject('Credential exchange crossed an invalid source boundary');
        ensureActive();
        const signal = activeSignal(init?.signal);
        const response = await abortable(
          dependencies.fetch(input, { ...init, signal }),
          signal,
        );
        ensureActive();
        boundary.controlPlaneExchanges += 1;
        boundary.exchangeCacheConformant &&= response.headers.get('cache-control') === 'no-store'
          && response.headers.get('pragma') === 'no-cache';
        return response;
      },
    });
    const selected = validateClient(dependencies.createBrowserClient({
      homeId: HOME_ID,
      credentialProvider: provider,
    }));
    client = selected;
    boundary.clientInstances += 1;
    clientSubscriptions = [];
    try {
      clientSubscriptions.push(selected.subscribe((event) => {
        if (client === selected
          && generation === clientGeneration
          && CLIENT_STATUSES.has(event?.current)) {
          recordBounded(boundary.clientStatuses, event.current);
        }
      }));
      clientSubscriptions.push(selected.errors.subscribe((failure) => {
        if (client === selected && generation === clientGeneration) {
          recordBounded(boundary.failureClasses, stableFailure(failure));
        }
      }));
      clientSubscriptions.push(selected.state.subscribe((snapshot) => {
        if (client === selected && generation === clientGeneration) recordState(snapshot);
      }));
      if (clientSubscriptions.some((unsubscribe) => typeof unsubscribe !== 'function')) {
        throw new StagingBrowserRelayPageError('Browser client subscription cleanup is invalid');
      }
    } catch {
      releaseClientSubscriptions();
      controller.abort();
      client = undefined;
      clientGeneration += 1;
      reject('Browser client subscription cleanup is invalid');
    }
    return selected;
  }

  function releaseClientSubscriptions() {
    const subscriptions = clientSubscriptions;
    clientSubscriptions = [];
    let failed = false;
    for (const unsubscribe of subscriptions) {
      try {
        unsubscribe();
      } catch {
        failed = true;
      }
    }
    return failed;
  }

  function requestClientStop() {
    if (client === undefined || clientStopTask !== undefined) return clientStopTask;
    const selected = client;
    clientController.abort();
    let selectedStop;
    let socketsClosed;
    try {
      selectedStop = Promise.resolve(selected.stop({ deadlineMs: 2_000 }));
    } catch (error) {
      selectedStop = Promise.reject(error);
    }
    try {
      socketsClosed = Promise.resolve(restoreWebSocket?.close());
    } catch (error) {
      socketsClosed = Promise.reject(error);
    }
    client = undefined;
    clientGeneration += 1;
    const subscriptionsClosed = releaseClientSubscriptions()
      ? Promise.reject(new StagingBrowserRelayPageError(
        'Browser client subscriptions did not close cleanly',
      ))
      : Promise.resolve();
    clientStopTask = Promise.allSettled([
      selectedStop, socketsClosed, subscriptionsClosed,
    ]).then((results) => {
      if (results.some(({ status }) => status === 'rejected')) {
        throw new StagingBrowserRelayPageError('Browser client cleanup did not converge');
      }
    });
    clientStopTask.catch(() => { clientCleanupUncertain = true; });
    return clientStopTask;
  }

  async function stopClient() {
    const task = requestClientStop();
    if (task === undefined) return;
    try {
      await boundedCleanup(task);
    } catch {
      clientCleanupUncertain = true;
      reject('Browser client cleanup did not converge');
    } finally {
      clientStopTask = undefined;
      currentSourceCredentials.appCheck = undefined;
      currentSourceCredentials.firebase = undefined;
    }
    if (boundary.activeWebsockets !== 0) reject('Browser WebSocket cleanup did not converge');
  }

  async function startClient() {
    if (state !== 'initialized' && state !== 'suspended') {
      reject('Page host cannot start from its current state');
    }
    const previousState = state;
    const selected = client ?? createClient();
    const generation = clientGeneration;
    const signal = clientController.signal;
    try {
      const ready = await abortable(selected.start(), signal);
      if (selected !== client || generation !== clientGeneration || terminalRequested) {
        reject('Browser client start was cancelled');
      }
      if (ready?.enrolled !== true
        || !Array.isArray(ready.coordinators)
        || ready.coordinators.length !== 1) {
        reject('Browser client did not reach the reviewed ready state');
      }
      state = 'ready';
      return observation();
    } catch {
      if (signal.aborted || terminalRequested || generation !== clientGeneration) {
        if (!terminalRequested) state = previousState;
        reject('Browser client start was cancelled');
      }
      state = 'failed';
      requestClientStop();
      reject('Browser client start failed');
    }
  }

  async function cleanupFirebaseSession(session, cleanupFailures) {
    try {
      await boundedCleanup(Promise.resolve().then(() => session.signOut()));
      lifecycle.signOuts = 1;
    } catch {
      cleanupFailures.push('sign-out');
    }
    try {
      await boundedCleanup(Promise.resolve().then(() => session.dispose()));
      lifecycle.disposals = 1;
    } catch {
      cleanupFailures.push('firebase');
    }
  }

  function cleanupLateFirebaseSession(sessionPromise) {
    Promise.resolve(sessionPromise).then(async (value) => {
      let session;
      try {
        session = validateFirebaseSession(value);
      } catch {
        return;
      }
      boundary.firebaseAuthSessions = 1;
      boundary.appCheckInstances = 1;
      const ignoredFailures = [];
      await cleanupFirebaseSession(session, ignoredFailures);
    }).catch(() => undefined);
  }

  async function cleanupFirebase(cleanupFailures) {
    if (firebase === undefined && pendingFirebaseSession !== undefined) {
      const pending = pendingFirebaseSession;
      try {
        firebase = validateFirebaseSession(await boundedCleanup(pending));
        boundary.firebaseAuthSessions = 1;
        boundary.appCheckInstances = 1;
      } catch (error) {
        if (error?.cleanupFailed !== false) cleanupFailures.push('firebase-session');
        cleanupLateFirebaseSession(pending);
      }
      pendingFirebaseSession = undefined;
    }
    if (firebase === undefined) return;
    await cleanupFirebaseSession(firebase, cleanupFailures);
    firebase = undefined;
  }

  function removeLifecycleHandlers() {
    if (lifecycleHandlers === undefined) return false;
    let failed = false;
    try {
      dependencies.global.removeEventListener('pagehide', lifecycleHandlers.pagehide);
    } catch {
      failed = true;
    }
    try {
      dependencies.global.removeEventListener('pageshow', lifecycleHandlers.pageshow);
    } catch {
      failed = true;
    }
    if (!failed) lifecycleHandlers = undefined;
    return failed;
  }

  async function suspendTransition() {
    try {
      await stopClient();
    } catch {
      state = 'failed';
      reject('Page host suspension did not converge');
    }
    if (terminalRequested) reject('Page host suspension was cancelled');
    state = 'suspended';
    lifecycle.suspensions += 1;
    return observation();
  }

  function requestSuspend() {
    if (suspendPromise !== undefined) return suspendPromise;
    if (terminalRequested || state !== 'ready') {
      return Promise.reject(new StagingBrowserRelayPageError(
        'Page host can suspend only from ready',
      ));
    }
    requestClientStop();
    suspendPromise = serialize(suspendTransition);
    suspendPromise.then(
      () => { suspendPromise = undefined; },
      () => { suspendPromise = undefined; },
    );
    return suspendPromise;
  }

  function requestResume() {
    if (resumePromise !== undefined) return resumePromise;
    if (terminalRequested
      || (state !== 'suspended' && clientStopTask === undefined)) {
      return Promise.reject(new StagingBrowserRelayPageError(
        'Page host can resume only from suspended',
      ));
    }
    resumePromise = serialize(async () => {
      if (terminalRequested || state !== 'suspended') {
        reject('Page host can resume only from suspended');
      }
      const result = await startClient();
      lifecycle.resumptions += 1;
      return result;
    });
    resumePromise.then(
      () => { resumePromise = undefined; },
      () => { resumePromise = undefined; },
    );
    return resumePromise;
  }

  async function stopTransition() {
    const cleanupFailures = [];
    if (clientCleanupUncertain) cleanupFailures.push('prior-client');
    if (initializationCleanupUncertain) cleanupFailures.push('prior-initialization');
    if (lifecycleCleanupUncertain) cleanupFailures.push('lifecycle-handlers');
    try {
      await stopClient();
    } catch {
      cleanupFailures.push('client');
    }
    await cleanupFirebase(cleanupFailures);
    clearCredentialBytes(sourceCredentials);
    currentSourceCredentials.appCheck = undefined;
    currentSourceCredentials.firebase = undefined;
    if (cleanupFailures.length === 0) {
      try {
        restoreWebSocket?.restore();
        restoreWebSocket = undefined;
      } catch {
        cleanupFailures.push('websocket-boundary');
      }
    }
    if (cleanupFailures.length === 0) {
      try {
        restorePersistence?.();
        restorePersistence = undefined;
      } catch {
        cleanupFailures.push('persistence-boundary');
      }
    }
    state = cleanupFailures.length === 0 ? 'stopped' : 'failed';
    if (cleanupFailures.length === 0) activePageHosts.delete(dependencies.global);
    const result = observation();
    if (cleanupFailures.length > 0) reject('Page host cleanup did not converge');
    return result;
  }

  function requestStop() {
    if (!initializeRequested) {
      return Promise.reject(new StagingBrowserRelayPageError('Page host has not initialized'));
    }
    if (stopPromise !== undefined) return stopPromise;
    terminalRequested = true;
    state = 'stopping';
    initializeController.abort();
    lifecycleCleanupUncertain ||= removeLifecycleHandlers();
    requestClientStop();
    stopPromise = serialize(stopTransition);
    return stopPromise;
  }

  function installLifecycleHandlers() {
    const pagehide = (event) => {
      if (event?.isTrusted !== true || terminalRequested) return;
      recordBounded(lifecycle.events, {
        event: 'pagehide',
        persisted: event.persisted === true,
      });
      if (event.persisted === true && state === 'ready') {
        requestSuspend().catch(() => undefined);
      } else {
        requestStop().catch(() => undefined);
      }
    };
    const pageshow = (event) => {
      if (event?.isTrusted !== true || terminalRequested) return;
      recordBounded(lifecycle.events, {
        event: 'pageshow',
        persisted: event.persisted === true,
      });
      if (event.persisted === true) requestResume().catch(() => undefined);
    };
    lifecycleHandlers = Object.freeze({ pagehide, pageshow });
    try {
      dependencies.global.addEventListener('pagehide', pagehide);
      dependencies.global.addEventListener('pageshow', pageshow);
    } catch {
      removeLifecycleHandlers();
      reject('Page lifecycle handlers could not be installed');
    }
  }

  async function initializeTransition(privateInput) {
    try {
      if (initializeController.signal.aborted || terminalRequested) {
        reject('Page host initialization was cancelled');
      }
      restorePersistence = installBrowserPersistenceBoundary(dependencies.global);
      restoreWebSocket = installWebSocketBoundary(
        dependencies.global,
        sourceCredentials,
        boundary,
        () => client !== undefined && clientController?.signal.aborted === false
          && !terminalRequested,
      );
      installLifecycleHandlers();
      retainCredential(sourceCredentials, privateInput.firebase_custom_token);
      pendingFirebaseSession = Promise.resolve(dependencies.createFirebaseSession(
        privateInput.firebase_custom_token,
        browser,
        initializeController.signal,
      ));
      firebase = validateFirebaseSession(await abortable(
        pendingFirebaseSession,
        initializeController.signal,
      ));
      pendingFirebaseSession = undefined;
      if (initializeController.signal.aborted || terminalRequested) {
        reject('Page host initialization was cancelled');
      }
      boundary.firebaseAuthSessions = 1;
      boundary.appCheckInstances = 1;
      state = 'initialized';
      createClient();
      return observation();
    } catch (error) {
      if (terminalRequested) reject('Page host initialization was cancelled');
      pendingFirebaseSession = undefined;
      const cleanupFailures = [];
      if (error?.cleanupFailed === true) cleanupFailures.push('firebase-session');
      await cleanupFirebase(cleanupFailures);
      if (removeLifecycleHandlers()) cleanupFailures.push('lifecycle-handlers');
      if (cleanupFailures.length === 0) {
        try {
          restoreWebSocket?.restore();
          restoreWebSocket = undefined;
        } catch {
          cleanupFailures.push('websocket-boundary');
        }
      }
      if (cleanupFailures.length === 0) {
        try {
          restorePersistence?.();
          restorePersistence = undefined;
        } catch {
          cleanupFailures.push('persistence-boundary');
        }
      }
      clearCredentialBytes(sourceCredentials);
      state = 'failed';
      initializationCleanupUncertain = cleanupFailures.length > 0;
      if (cleanupFailures.length === 0) activePageHosts.delete(dependencies.global);
      reject('Page host initialization failed');
    }
  }

  return Object.freeze({
    initialize(privateInputValue) {
      if (initializeRequested) {
        return Promise.reject(new StagingBrowserRelayPageError(
          'Page host may initialize only once',
        ));
      }
      const privateInput = validatePagePrivateInput(privateInputValue);
      if (activePageHosts.has(dependencies.global)) {
        return Promise.reject(new StagingBrowserRelayPageError(
          'Page global already owns an active relay host',
        ));
      }
      activePageHosts.add(dependencies.global);
      initializeRequested = true;
      browser = privateInput.browser;
      startedAt = dependencies.now();
      initializeController = new AbortController();
      return serialize(() => initializeTransition(privateInput));
    },

    start() {
      if (terminalRequested || state !== 'initialized') {
        return Promise.reject(new StagingBrowserRelayPageError(
          'Page host cannot start from its current state',
        ));
      }
      return serialize(startClient);
    },

    observe() {
      if (!initializeRequested) reject('Page host has not initialized');
      return observation();
    },

    observeLifecycle() {
      if (!initializeRequested) reject('Page host has not initialized');
      return lifecycleObservation();
    },

    observeState(expectedValue) {
      if (state !== 'ready' || client === undefined) reject('Page host is not ready');
      const expected = exactKeys(expectedValue, ['path', 'revision', 'value'], 'State expectation');
      if (expected.path !== 'acceptance.temperature'
        || !Number.isSafeInteger(expected.revision) || expected.revision < 0
        || !Number.isSafeInteger(expected.value) || expected.value < -100 || expected.value > 200) {
        reject('State expectation is outside the synthetic fixture boundary');
      }
      const snapshot = client.state.snapshot();
      return Object.freeze({
        schema: 'miakapp.staging-browser-relay-page-state-observation/1',
        state: snapshot !== undefined
          && snapshot.stale === false
          && snapshot.revision === expected.revision
          && snapshot.values?.[expected.path] === expected.value
          ? 'matched'
          : 'pending',
        revision: snapshot?.revision ?? 0,
        stale: snapshot?.stale ?? true,
      });
    },

    async call(target) {
      if (state !== 'ready' || client === undefined) reject('Page host is not ready');
      if (!Number.isSafeInteger(target) || target < -100 || target > 200) {
        reject('Synthetic call target is invalid');
      }
      const selected = client;
      const signal = clientController.signal;
      let dispatchAttempted = false;
      try {
        dispatchAttempted = true;
        const handle = selected.calls.start({
          function: 'acceptance.set',
          arguments: { target },
          timeoutMs: 5_000,
          idempotencyKey: `acceptance-${target}`,
        });
        if (!plainObject(handle) || typeof handle.cancel !== 'function') {
          reject('Synthetic call handle is invalid');
        }
        const resultPromise = Promise.resolve(handle.result);
        resultPromise.catch(() => undefined);
        await abortable(Promise.resolve(handle.accepted), signal);
        const result = await abortable(resultPromise, signal);
        if (selected !== client || signal.aborted || terminalRequested) {
          reject('Synthetic call completed outside the active lifecycle');
        }
        if (result?.accepted !== true
          || !plainObject(result.arguments)
          || JSON.stringify(Object.keys(result.arguments)) !== JSON.stringify(['target'])
          || result.arguments.target !== target) {
          reject('Synthetic call result is invalid');
        }
        recordBounded(lifecycle.callOutcomes, 'applied');
        return Object.freeze({
          schema: 'miakapp.staging-browser-relay-page-call-observation/1',
          state: 'completed',
          outcome: 'applied',
        });
      } catch (error) {
        const knownFailure = error?.outcome === 'not_dispatched'
          || error?.outcome === 'accepted'
          || error?.outcome === 'failed';
        const outcome = error?.outcome === 'outcome_unknown'
          || error?.outcome === 'applied'
          || (dispatchAttempted && !knownFailure)
          ? 'outcome_unknown'
          : 'failed';
        recordBounded(boundary.failureClasses, stableFailure(error));
        recordBounded(lifecycle.callOutcomes, outcome);
        return Object.freeze({
          schema: 'miakapp.staging-browser-relay-page-call-observation/1',
          state: 'failed',
          outcome,
        });
      }
    },

    suspend: requestSuspend,
    resume: requestResume,
    stop: requestStop,
  });
}

export const browserRelayPagePrivateInputSchema = PAGE_PRIVATE_INPUT_SCHEMA;
export const browserRelayPageBrowsers = BROWSER_ORDER;
