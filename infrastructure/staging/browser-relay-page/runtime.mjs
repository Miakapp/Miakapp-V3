import {
  BROWSER_ORDER,
  CONTROL_PLANE_EXCHANGE_ENDPOINT,
  HOME_ID,
  PAGE_OBSERVATION_SCHEMA,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
  StagingBrowserRelayPageError,
  validatePagePrivateInput,
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
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const encoder = new TextEncoder();

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
    || typeof dependencies.global.WebSocket !== 'function') {
    reject('Page WebSocket dependency is invalid');
  }
  return dependencies;
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

function installWebSocketBoundary(globalObject, sourceCredentials, boundary) {
  const NativeWebSocket = globalObject.WebSocket;
  class ObservedWebSocket extends NativeWebSocket {
    #closed = false;

    constructor(url, protocols) {
      const canonical = typeof url === 'string' ? url : String(url);
      const id = relayId(canonical);
      if (protocols === undefined) super(url);
      else super(url, protocols);
      boundary.websocketConnections += 1;
      boundary.activeWebsockets += 1;
      boundary.maximumActiveWebsockets = Math.max(
        boundary.maximumActiveWebsockets,
        boundary.activeWebsockets,
      );
      boundary.relayIds.push(id);
      this.addEventListener('close', () => {
        if (this.#closed) return;
        this.#closed = true;
        boundary.activeWebsockets = Math.max(0, boundary.activeWebsockets - 1);
      }, { once: true });
    }

    send(value) {
      const bytes = outboundBytes(value);
      if (bytes !== undefined
        && sourceCredentials.some((credential) => includesBytes(bytes, credential))) {
        boundary.sourceCredentialsOnWebsocket += 1;
      }
      return super.send(value);
    }
  }
  globalObject.WebSocket = ObservedWebSocket;
  return () => {
    if (globalObject.WebSocket === ObservedWebSocket) globalObject.WebSocket = NativeWebSocket;
  };
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
  if (!Number.isSafeInteger(value) || value < 0 || value > 600_000) {
    reject('Page observation duration is outside the reviewed bound');
  }
  return value;
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
  let browser;
  let client;
  let firebase;
  let restorePersistence;
  let restoreWebSocket;
  let startedAt;
  let state = 'dormant';

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

  function createClient() {
    if (firebase === undefined || restoreWebSocket === undefined) reject('Page host is not initialized');
    const provider = dependencies.createCredentialProvider({
      exchangeEndpoint: CONTROL_PLANE_EXCHANGE_ENDPOINT,
      async getFirebaseIdToken(request) {
        boundary.firebaseTokenRequests += 1;
        currentSourceCredentials.firebase = retainCredential(
          sourceCredentials,
          await firebase.getFirebaseIdToken(request.signal),
        );
        return currentSourceCredentials.firebase;
      },
      async getAppCheckToken(request) {
        boundary.appCheckTokenRequests += 1;
        currentSourceCredentials.appCheck = retainCredential(
          sourceCredentials,
          await firebase.getAppCheckToken(request.signal),
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
        const response = await dependencies.fetch(input, init);
        boundary.controlPlaneExchanges += 1;
        boundary.exchangeCacheConformant &&= response.headers.get('cache-control') === 'no-store'
          && response.headers.get('pragma') === 'no-cache';
        return response;
      },
    });
    client = validateClient(dependencies.createBrowserClient({
      homeId: HOME_ID,
      credentialProvider: provider,
    }));
    boundary.clientInstances += 1;
    client.subscribe((event) => {
      if (CLIENT_STATUSES.has(event?.current)) {
        recordBounded(boundary.clientStatuses, event.current);
      }
    });
    client.errors.subscribe((failure) => {
      recordBounded(boundary.failureClasses, stableFailure(failure));
    });
    return client;
  }

  async function stopClient() {
    if (client === undefined) return;
    const selected = client;
    client = undefined;
    try {
      await selected.stop({ deadlineMs: 2_000 });
    } catch {
      reject('Browser client cleanup did not converge');
    }
  }

  async function startClient() {
    if (state !== 'initialized' && state !== 'suspended') {
      reject('Page host cannot start from its current state');
    }
    if (client === undefined) createClient();
    try {
      const ready = await client.start();
      if (ready?.enrolled !== true
        || !Array.isArray(ready.coordinators)
        || ready.coordinators.length !== 1) {
        reject('Browser client did not reach the reviewed ready state');
      }
      state = 'ready';
      return observation();
    } catch {
      state = 'failed';
      reject('Browser client start failed');
    }
  }

  return Object.freeze({
    async initialize(privateInputValue) {
      if (state !== 'dormant') reject('Page host may initialize only once');
      const privateInput = validatePagePrivateInput(privateInputValue);
      browser = privateInput.browser;
      startedAt = dependencies.now();
      try {
        restorePersistence = installBrowserPersistenceBoundary(dependencies.global);
        restoreWebSocket = installWebSocketBoundary(
          dependencies.global,
          sourceCredentials,
          boundary,
        );
        retainCredential(sourceCredentials, privateInput.firebase_custom_token);
        firebase = validateFirebaseSession(await dependencies.createFirebaseSession(
          privateInput.firebase_custom_token,
          browser,
        ));
        boundary.firebaseAuthSessions = 1;
        boundary.appCheckInstances = 1;
        state = 'initialized';
        createClient();
        return observation();
      } catch {
        if (firebase !== undefined) {
          await Promise.resolve().then(() => firebase.signOut()).catch(() => {});
          await Promise.resolve().then(() => firebase.dispose()).catch(() => {});
          firebase = undefined;
        }
        try {
          restoreWebSocket?.();
        } catch {}
        restoreWebSocket = undefined;
        try {
          restorePersistence?.();
        } catch {}
        restorePersistence = undefined;
        clearCredentialBytes(sourceCredentials);
        currentSourceCredentials.appCheck = undefined;
        currentSourceCredentials.firebase = undefined;
        state = 'failed';
        reject('Page host initialization failed');
      }
    },

    async start() {
      return startClient();
    },

    observe() {
      if (state === 'dormant') reject('Page host has not initialized');
      return observation();
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
      try {
        const handle = client.calls.start({
          function: 'acceptance.set',
          arguments: { target },
          timeoutMs: 5_000,
          idempotencyKey: `acceptance-${target}`,
        });
        await handle.accepted;
        const result = await handle.result;
        if (result?.accepted !== true
          || !plainObject(result.arguments)
          || JSON.stringify(Object.keys(result.arguments)) !== JSON.stringify(['target'])
          || result.arguments.target !== target) {
          reject('Synthetic call result is invalid');
        }
        return Object.freeze({
          schema: 'miakapp.staging-browser-relay-page-call-observation/1',
          state: 'completed',
          outcome: 'applied',
        });
      } catch {
        reject('Synthetic browser call failed');
      }
    },

    async suspend() {
      if (state !== 'ready') reject('Page host can suspend only from ready');
      await stopClient();
      state = 'suspended';
      return observation();
    },

    async resume() {
      if (state !== 'suspended') reject('Page host can resume only from suspended');
      return startClient();
    },

    async stop() {
      if (state === 'stopped') return observation();
      const cleanupFailures = [];
      try {
        await stopClient();
      } catch {
        cleanupFailures.push('client');
      }
      if (firebase !== undefined) {
        try {
          await firebase.signOut();
        } catch {
          cleanupFailures.push('sign-out');
        }
        try {
          await firebase.dispose();
        } catch {
          cleanupFailures.push('firebase');
        }
        firebase = undefined;
      }
      clearCredentialBytes(sourceCredentials);
      currentSourceCredentials.appCheck = undefined;
      currentSourceCredentials.firebase = undefined;
      try {
        restoreWebSocket?.();
      } catch {
        cleanupFailures.push('websocket-boundary');
      }
      restoreWebSocket = undefined;
      try {
        restorePersistence?.();
      } catch {
        cleanupFailures.push('persistence-boundary');
      }
      restorePersistence = undefined;
      state = cleanupFailures.length === 0 ? 'stopped' : 'failed';
      const result = observation();
      if (cleanupFailures.length > 0) reject('Page host cleanup did not converge');
      return result;
    },
  });
}

export const browserRelayPagePrivateInputSchema = PAGE_PRIVATE_INPUT_SCHEMA;
export const browserRelayPageBrowsers = BROWSER_ORDER;
