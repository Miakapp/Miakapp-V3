import { createBrowserRelayPageHost } from '../../browser-relay-page/runtime.mjs';
import {
  HOME_ID,
  RELAY_A_URL,
  RELAY_B_URL,
} from '../../browser-relay-page/boundary.mjs';

const STATE_PATH = 'acceptance.temperature';
const BOOTSTRAP_NAME = 'miakappChromiumScenarioGeneration';
const bootstrap = globalThis[BOOTSTRAP_NAME];
delete globalThis[BOOTSTRAP_NAME];
if (bootstrap !== 1 && bootstrap !== 2) {
  throw new Error('Offline Chromium scenario bootstrap is invalid');
}
const identityGeneration = bootstrap;

function token(a, b, c) {
  return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
}

function check(condition) {
  if (!condition) throw new Error('Offline Chromium scenario boundary is invalid');
}

function subscriptions() {
  const listeners = new Set();
  return Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(value) {
      for (const listener of [...listeners]) listener(value);
    },
  });
}

function stateSnapshot(revision, value, stale) {
  return Object.freeze({
    epoch: new Uint8Array(16),
    revision,
    values: Object.freeze({ [STATE_PATH]: value }),
    stale,
  });
}

function typedFailure(outcome) {
  return Object.assign(new Error('Offline typed call failure'), {
    kind: outcome === 'failed' ? 'internal' : 'unavailable',
    outcome,
    code: 2000,
    retryable: false,
  });
}

class OfflineWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = OfflineWebSocket.OPEN;

  constructor(url) {
    super();
    check(url === RELAY_A_URL || url === RELAY_B_URL);
  }

  send() {}

  close() {
    if (this.readyState === OfflineWebSocket.CLOSED) return;
    this.readyState = OfflineWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
  }
}

globalThis.WebSocket = OfflineWebSocket;

const expectedCustomToken = identityGeneration === 1
  ? token('a', 'b', 'c')
  : token('u', 'v', 'w');
const firebaseToken = identityGeneration === 1
  ? token('d', 'e', 'f')
  : token('x', 'y', 'z');
const appCheckToken = token('g', 'h', 'i');
const relayToken = token('j', 'k', 'l');
let route = identityGeneration === 1 ? 'relay-a' : 'relay-b';
let authoritativeRevision = 1;
let authoritativeValue = 20;
let nextCallOutcome = 'applied';
let activeClient;
let clientInstances = 0;
let host;

function relayUrl() {
  return route === 'relay-a' ? RELAY_A_URL : RELAY_B_URL;
}

host = createBrowserRelayPageHost({
  global: globalThis,
  now: () => performance.now(),
  async fetch() {
    return new Response('{}', {
      status: 200,
      headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
    });
  },
  async createFirebaseSession(customToken, browser) {
    check(customToken === expectedCustomToken && browser === 'chromium');
    return Object.freeze({
      async getFirebaseIdToken() { return firebaseToken; },
      async getAppCheckToken() { return appCheckToken; },
      async signOut() {},
      async dispose() {},
    });
  },
  createCredentialProvider(options) {
    return Object.freeze({
      async getCredential(request) {
        const firebase = await options.getFirebaseIdToken(request);
        const appCheck = await options.getAppCheckToken(request);
        await options.fetch(options.exchangeEndpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${firebase}`,
            'x-firebase-appcheck': appCheck,
          },
          body: '{}',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: request?.signal,
        });
        return Object.freeze({
          relayUrl: relayUrl(),
          accessToken: relayToken,
          expiresAtMs: Date.now() + 300_000,
        });
      },
    });
  },
  createBrowserClient({ homeId, credentialProvider }) {
    check(homeId === HOME_ID);
    clientInstances += 1;
    const ordinal = clientInstances;
    const statuses = subscriptions();
    const failures = subscriptions();
    const states = subscriptions();
    let current;
    let socket;
    let stopped = false;

    const emitState = (revision, value, stale) => {
      current = stateSnapshot(revision, value, stale);
      states.emit(current);
    };
    const connect = async (reason) => {
      const credential = await credentialProvider.getCredential({
        homeId: HOME_ID,
        reason,
        signal: new AbortController().signal,
      });
      socket = new globalThis.WebSocket(credential.relayUrl, 'miakapp');
      socket.send(new TextEncoder().encode(credential.accessToken));
    };
    const client = {
      state: {
        snapshot: () => current,
        subscribe(listener) {
          const remove = states.subscribe(listener);
          if (current !== undefined) listener(current);
          return remove;
        },
      },
      errors: { subscribe: (listener) => failures.subscribe(listener) },
      subscribe: (listener) => statuses.subscribe(listener),
      calls: {
        start({ arguments: argumentsValue }) {
          const outcome = nextCallOutcome;
          nextCallOutcome = 'applied';
          if (outcome === 'outcome_unknown') {
            statuses.emit({ current: 'reconnecting' });
            if (current !== undefined) {
              emitState(current.revision, current.values[STATE_PATH], true);
            }
            socket?.close();
          }
          if (outcome === 'applied') {
            return Object.freeze({
              localId: 'offline-call',
              accepted: Promise.resolve(),
              result: Promise.resolve({ accepted: true, arguments: argumentsValue }),
              cancel() {},
            });
          }
          const failure = typedFailure(outcome);
          failures.emit(failure);
          const result = Promise.reject(failure);
          result.catch(() => undefined);
          return Object.freeze({
            localId: 'offline-call',
            accepted: Promise.resolve(),
            result,
            cancel() {},
          });
        },
      },
      async start() {
        check(!stopped);
        for (const currentStatus of ['connecting', 'authenticating', 'synchronizing']) {
          statuses.emit({ current: currentStatus });
        }
        await connect(ordinal === 1 ? 'initial' : 'reconnect');
        emitState(authoritativeRevision, authoritativeValue, false);
        statuses.emit({ current: 'ready' });
        return { enrolled: true, coordinators: [{ name: 'acceptance' }] };
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        statuses.emit({ current: 'stopping' });
        if (current !== undefined && current.stale === false) {
          emitState(current.revision, current.values[STATE_PATH], true);
        }
        socket?.close();
        statuses.emit({ current: 'stopped' });
      },
      updateState(revision, value, stale) { emitState(revision, value, stale); },
      async reauthenticateSameRelay() {
        statuses.emit({ current: 'authenticating' });
        await credentialProvider.getCredential({
          homeId: HOME_ID,
          reason: 'renewal',
          signal: new AbortController().signal,
        });
        statuses.emit({ current: 'ready' });
      },
      async handoffStale() {
        statuses.emit({ current: 'reconnecting' });
        if (current !== undefined) emitState(current.revision, current.values[STATE_PATH], true);
        socket?.close();
        route = 'relay-b';
        await connect('renewal');
      },
      relayReady(revision, value) {
        emitState(revision, value, false);
        statuses.emit({ current: 'ready' });
      },
      async recover(revision, value) {
        await connect('reconnect');
        emitState(revision, value, false);
        statuses.emit({ current: 'ready' });
      },
    };
    activeClient = client;
    return client;
  },
});

const pageApi = Object.freeze({
  initialize: (input) => host.initialize(input),
  start: () => host.start(),
  observe: () => host.observe(),
  observeLifecycle: () => host.observeLifecycle(),
  observeState: (expected) => host.observeState(expected),
  call: (target) => host.call(target),
  suspend: () => host.suspend(),
  resume: () => host.resume(),
  stop: () => host.stop(),
});

const stateControl = (revision, value) => Object.freeze({
  schema: 'miakapp.staging-browser-relay-chromium-state-control/1',
  state_expectation: Object.freeze({ path: STATE_PATH, revision, value }),
});
const callControl = (callTarget) => Object.freeze({
  schema: 'miakapp.staging-browser-relay-chromium-call-control/1',
  call_target: callTarget,
});

const phaseControl = Object.freeze({
  async phase(step) {
    check(identityGeneration === 1);
    switch (step) {
      case 'authoritative_state':
        return stateControl(1, 20);
      case 'patched_state':
        authoritativeRevision = 2;
        authoritativeValue = 21;
        activeClient.updateState(2, 21, false);
        return stateControl(2, 21);
      case 'initial_call':
        return callControl(21);
      case 'same_relay_reauthenticated':
        await activeClient.reauthenticateSameRelay();
        return undefined;
      case 'relay_handoff_stale':
        await activeClient.handoffStale();
        return undefined;
      case 'relay_b_ready':
        authoritativeRevision = 3;
        authoritativeValue = 22;
        activeClient.relayReady(3, 22);
        return undefined;
      case 'relay_b_state':
        return stateControl(3, 22);
      case 'relay_b_call':
        return callControl(22);
      case 'failed_call':
        nextCallOutcome = 'failed';
        return callControl(23);
      case 'uncertain_call':
        nextCallOutcome = 'outcome_unknown';
        return callControl(24);
      case 'relay_b_recovered':
        authoritativeRevision = 4;
        authoritativeValue = 23;
        await activeClient.recover(4, 23);
        return stateControl(4, 23);
      default:
        throw new Error('Offline Chromium scenario phase is invalid');
    }
  },
});

Object.defineProperty(globalThis, 'miakappBrowserRelayPage', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: pageApi,
});
Object.defineProperty(globalThis, 'miakappChromiumScenarioControl', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: phaseControl,
});
