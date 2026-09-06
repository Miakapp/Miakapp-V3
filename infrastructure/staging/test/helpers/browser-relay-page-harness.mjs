import { createBrowserRelayPageHost } from '../../browser-relay-page/runtime.mjs';
import {
  HOME_ID,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
} from '../../browser-relay-page/boundary.mjs';

const STATE_PATH = 'acceptance.temperature';

function token(a, b, c) {
  return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
}

function check(condition) {
  if (!condition) throw new Error('Offline page harness boundary is invalid');
}

function listeners() {
  const entries = new Set();
  return {
    subscribe(listener) { entries.add(listener); return () => entries.delete(listener); },
    emit(value) { for (const listener of [...entries]) listener(value); },
    capture() { return [...entries]; },
  };
}

function fakeGlobal(options) {
  const events = new Map();
  return {
    indexedDB: Object.freeze({ open() {} }),
    addEventListener(type, listener) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      events.get(type)?.delete(listener);
      if (options.removeEventListenerFailure) {
        throw new Error('Offline listener removal failure');
      }
    },
    dispatchEvent(event) {
      for (const listener of [...(events.get(event.type) ?? [])]) listener(event);
      return true;
    },
  };
}

function gate(held) {
  let resolveEntered;
  let release;
  let reject;
  const entered = new Promise((resolve) => { resolveEntered = resolve; });
  const waiting = new Promise((resolve, rejectPromise) => {
    release = resolve;
    reject = () => rejectPromise(new Error('Offline deferred boundary failed'));
  });
  waiting.catch(() => undefined);
  if (!held) release();
  return Object.freeze({
    entered,
    release,
    reject,
    wait() { resolveEntered(); return waiting; },
  });
}

function failure(outcome, code = 2000) {
  return Object.assign(new Error('Offline typed call failure'), {
    kind: 'unavailable', outcome, code, retryable: false,
  });
}

function snapshot({ revision, value, stale }) {
  return Object.freeze({
    epoch: new Uint8Array(16),
    revision,
    values: Object.freeze({ [STATE_PATH]: value }),
    stale,
  });
}

export function createBrowserRelayPageHarness(options = {}) {
  const browserName = options.browserName ?? 'chromium';
  const generation = options.generation ?? 1;
  check(['chromium', 'firefox', 'webkit'].includes(browserName));
  check(generation === 1 || generation === 2);
  const customToken = generation === 1 ? token('a', 'b', 'c') : token('u', 'v', 'w');
  const firebaseToken = generation === 1 ? token('d', 'e', 'f') : token('x', 'y', 'z');
  const appCheckToken = token('g', 'h', 'i');
  const accessToken = token('j', 'k', 'l');
  const global = options.global ?? fakeGlobal(options);
  const nativeIndexedDB = global.indexedDB;
  const calls = [];
  const counters = {
    clientInstances: 0, sessionCreations: 0, firebaseTokenRequests: 0,
    appCheckTokenRequests: 0, credentialExchanges: 0, clientStarts: 0,
    clientStops: 0, callStarts: 0, socketConnections: 0, activeSockets: 0,
    maximumActiveSockets: 0, framesSent: 0, signOuts: 0, disposals: 0,
  };
  const gates = Object.freeze(Object.fromEntries([
    'firebaseSession', 'firebaseToken', 'appCheckToken', 'clientStart', 'clientStop',
    'callAccepted', 'callResult', 'signOut', 'dispose',
  ].map((name) => [name, gate(options.deferred?.includes(name) === true)])));
  let now = 1_000;
  let selected;

  function unsubscribe(remove) {
    return () => {
      remove();
      if (options.unsubscribeFailure) throw new Error('Offline unsubscribe failure');
    };
  }

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    #events = new Map();
    readyState = MockWebSocket.OPEN;

    constructor(url) {
      check(url === RELAY_A_URL || url === RELAY_B_URL);
      counters.socketConnections += 1;
      counters.activeSockets += 1;
      counters.maximumActiveSockets = Math.max(counters.maximumActiveSockets, counters.activeSockets);
    }

    addEventListener(type, listener) {
      if (!this.#events.has(type)) this.#events.set(type, new Set());
      this.#events.get(type).add(listener);
    }

    removeEventListener(type, listener) { this.#events.get(type)?.delete(listener); }

    send() { counters.framesSent += 1; }

    close() {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      counters.activeSockets -= 1;
      for (const listener of this.#events.get('close') ?? []) listener({ code: 1000 });
      this.#events.clear();
    }
  }
  global.WebSocket = MockWebSocket;

  const host = createBrowserRelayPageHost({
    global,
    now: options.now ?? (() => now),
    async fetch() {
      calls.push('exchange');
      counters.credentialExchanges += 1;
      return new Response('{}', {
        status: 200,
        headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
      });
    },
    async createFirebaseSession(input, browser) {
      check(input === customToken && browser === browserName && global.indexedDB === undefined);
      await gates.firebaseSession.wait();
      if (options.firebaseInitializationFailure) {
        const error = new Error('Offline Firebase initialization failure');
        Object.defineProperty(error, 'cleanupFailed', {
          value: options.firebaseInitializationCleanupFailure === true,
        });
        throw error;
      }
      counters.sessionCreations += 1;
      return {
        async getFirebaseIdToken() {
          counters.firebaseTokenRequests += 1;
          await gates.firebaseToken.wait();
          return firebaseToken;
        },
        async getAppCheckToken() {
          counters.appCheckTokenRequests += 1;
          await gates.appCheckToken.wait();
          return appCheckToken;
        },
        async signOut() {
          counters.signOuts += 1;
          await gates.signOut.wait();
          if (options.signOutFailure) throw new Error('Offline sign-out failure');
        },
        async dispose() {
          counters.disposals += 1;
          await gates.dispose.wait();
          if (options.disposeFailure) throw new Error('Offline disposal failure');
        },
      };
    },
    createCredentialProvider(providerOptions) {
      return {
        async getCredential(request) {
          const firebase = await providerOptions.getFirebaseIdToken(request);
          const appCheck = await providerOptions.getAppCheckToken(request);
          await providerOptions.fetch(providerOptions.exchangeEndpoint, {
            method: 'POST',
            headers: { authorization: `Bearer ${firebase}`, 'x-firebase-appcheck': appCheck },
            body: '{}', cache: 'no-store', credentials: 'omit', redirect: 'error',
          });
          return {
            relayUrl: generation === 1 && counters.clientInstances === 1 ? RELAY_A_URL : RELAY_B_URL,
            accessToken,
            expiresAtMs: Date.now() + 300_000,
          };
        },
      };
    },
    createBrowserClient({ credentialProvider }) {
      counters.clientInstances += 1;
      const instance = counters.clientInstances;
      const statuses = listeners();
      const failures = listeners();
      const states = listeners();
      const controller = new AbortController();
      let current;
      let socket;
      let stopped = false;
      let stopPromise;
      selected = { statuses, failures, states, update(value) { current = snapshot(value); states.emit(current); } };
      return {
        state: {
          snapshot: () => current,
          subscribe(listener) {
            const remove = states.subscribe(listener);
            if (current !== undefined) listener(current);
            return unsubscribe(remove);
          },
        },
        calls: {
          start({ arguments: argumentsValue }) {
            counters.callStarts += 1;
            if (options.callUntypedFailure) throw new Error('Offline untyped call failure');
            const outcome = options.callOutcome ?? 'applied';
            const beforeAcceptance = options.callFailureBeforeAcceptance === true;
            const callFailure = failure(outcome === 'outcome_unknown'
              ? 'outcome_unknown'
              : beforeAcceptance ? 'not_dispatched' : 'accepted');
            const accepted = beforeAcceptance
              ? Promise.reject(callFailure)
              : gates.callAccepted.wait();
            const result = gates.callResult.wait().then(() => {
              if (options.callInvalidResult) return { accepted: false, arguments: argumentsValue };
              if (outcome !== 'applied') throw callFailure;
              return { accepted: true, arguments: argumentsValue };
            });
            accepted.catch(() => undefined);
            result.catch(() => undefined);
            return { localId: `call:${counters.callStarts}`, accepted, result, cancel() {} };
          },
        },
        errors: { subscribe: (listener) => unsubscribe(failures.subscribe(listener)) },
        subscribe: (listener) => unsubscribe(statuses.subscribe(listener)),
        async start() {
          counters.clientStarts += 1;
          statuses.emit({ current: 'connecting' });
          await gates.clientStart.wait();
          if (stopped) throw failure('not_dispatched');
          const credential = await credentialProvider.getCredential({
            homeId: HOME_ID,
            reason: instance === 1 ? 'initial' : 'reconnect',
            signal: controller.signal,
          });
          if (stopped || controller.signal.aborted) throw failure('not_dispatched');
          socket = new global.WebSocket(credential.relayUrl, 'miakapp');
          socket.send(new TextEncoder().encode(
            options.leakSourceCredential === true ? firebaseToken : credential.accessToken,
          ));
          current = snapshot({ revision: instance, value: 19 + instance, stale: false });
          states.emit(current);
          statuses.emit({ current: 'ready' });
          return { enrolled: true, coordinators: [{ name: 'acceptance' }] };
        },
        stop() {
          if (stopPromise !== undefined) return stopPromise;
          counters.clientStops += 1;
          stopped = true;
          controller.abort();
          statuses.emit({ current: 'stopping' });
          if (current !== undefined && !current.stale) {
            current = Object.freeze({ ...current, stale: true });
            states.emit(current);
          }
          socket?.close();
          stopPromise = gates.clientStop.wait().then(() => {
            statuses.emit({ current: 'stopped' });
            if (options.clientStopFailure) throw new Error('Offline client stop failure');
          });
          return stopPromise;
        },
      };
    },
  });

  return Object.freeze({
    host, global, gates, calls, nativeIndexedDB, nativeWebSocket: MockWebSocket,
    privateInput: () => Object.freeze({
      schema: PAGE_PRIVATE_INPUT_SCHEMA, browser: browserName, firebase_custom_token: customToken,
    }),
    advance(milliseconds) { now += milliseconds; },
    cleanupCounts: () => ({ signOuts: counters.signOuts, disposals: counters.disposals }),
    counts: () => Object.freeze({ ...counters }),
    emitState(value) { selected?.update(value); },
    emitFailure(value) { selected?.failures.emit(value); },
    captureCallbacks() {
      const state = selected?.states.capture() ?? [];
      const status = selected?.statuses.capture() ?? [];
      const errors = selected?.failures.capture() ?? [];
      return Object.freeze({
        state(value) { for (const listener of state) listener(snapshot(value)); },
        status(current) { for (const listener of status) listener({ current }); },
        failure(value) { for (const listener of errors) listener(value); },
      });
    },
  });
}
