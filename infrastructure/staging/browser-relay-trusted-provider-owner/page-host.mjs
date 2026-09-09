import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CHROMIUM_SCENARIO_AWAY_URL,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  CONTROL_PLANE_ORIGIN,
  TARGET_ORIGIN,
  TARGET_URL,
} from '../browser-relay-page/contract.mjs';
import {
  TRUSTED_PROVIDER_OWNER_BROWSER_ORDER,
  rejectTrustedProviderOwner,
} from './contract.mjs';

const ENTRY_URL = `${TARGET_ORIGIN}/browser-relay-trusted-provider-owner/offline-page-entry.mjs`;
export const EXTERNAL_REQUEST_PROBE_URL =
  `${CONTROL_PLANE_ORIGIN}/browser-relay-trusted-provider-owner/offline-egress-probe`;
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  'img-src data:',
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  'worker-src blob:',
].join('; ');
const HOSTING_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});
const DOCUMENT_SOURCE = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="referrer" content="no-referrer"><link rel="icon" href="data:,">'
  + '<title>Miakapp trusted provider owner offline page</title></head><body>'
  + '<script type="module" src="/browser-relay-trusted-provider-owner/'
  + 'offline-page-entry.mjs"></script></body></html>';
const AWAY_SOURCE = readFileSync(
  new URL('../browser-relay-chromium-scenario/away.html', import.meta.url),
);
const MODULE_BYTES = Object.freeze({
  [`${TARGET_ORIGIN}/browser-relay-page/runtime.mjs`]: readFileSync(
    new URL('../browser-relay-page/runtime.mjs', import.meta.url),
  ),
  [`${TARGET_ORIGIN}/browser-relay-page/boundary.mjs`]: readFileSync(
    new URL('../browser-relay-page/boundary.mjs', import.meta.url),
  ),
});

function reject() {
  return rejectTrustedProviderOwner();
}

function offlinePageEntry(createBrowserRelayPageHost, boundary) {
  const STATE_PATH = 'acceptance.temperature';
  const BOOTSTRAP_NAME = 'miakappTrustedProviderOwnerPageBootstrap';
  const bootstrap = globalThis[BOOTSTRAP_NAME];
  delete globalThis[BOOTSTRAP_NAME];
  const browsers = ['chromium', 'firefox', 'webkit'];
  if (bootstrap === null || typeof bootstrap !== 'object'
    || !browsers.includes(bootstrap.browser)
    || (bootstrap.identity_generation !== 1 && bootstrap.identity_generation !== 2)) {
    throw new Error('Offline trusted provider page bootstrap is invalid');
  }
  const browserName = bootstrap.browser;
  const identityGeneration = bootstrap.identity_generation;

  function token(a, b, c) {
    return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
  }

  function check(condition) {
    if (!condition) throw new Error('Offline trusted provider page boundary is invalid');
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
      check(url === boundary.RELAY_A_URL || url === boundary.RELAY_B_URL);
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
  let route = browserName === 'chromium' && identityGeneration === 1
    ? 'relay-a'
    : 'relay-b';
  let authoritativeRevision = 1;
  let authoritativeValue = 20;
  let nextCallOutcome = 'applied';
  let activeClient;
  let clientInstances = 0;

  function relayUrl() {
    return route === 'relay-a' ? boundary.RELAY_A_URL : boundary.RELAY_B_URL;
  }

  const host = createBrowserRelayPageHost({
    global: globalThis,
    now: () => performance.now(),
    async fetch() {
      return new Response('{}', {
        status: 200,
        headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
      });
    },
    async createFirebaseSession(customToken, browser) {
      check(customToken === expectedCustomToken && browser === browserName);
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
      check(homeId === boundary.HOME_ID);
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
          homeId: boundary.HOME_ID,
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
          for (const status of ['connecting', 'authenticating', 'synchronizing']) {
            statuses.emit({ current: status });
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
            homeId: boundary.HOME_ID,
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
  Object.defineProperty(globalThis, 'miakappBrowserRelayPage', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: pageApi,
  });

  if (browserName === 'chromium') {
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
          case 'authoritative_state': return stateControl(1, 20);
          case 'patched_state':
            authoritativeRevision = 2;
            authoritativeValue = 21;
            activeClient.updateState(2, 21, false);
            return stateControl(2, 21);
          case 'initial_call': return callControl(21);
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
          case 'relay_b_state': return stateControl(3, 22);
          case 'relay_b_call': return callControl(22);
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
          default: throw new Error('Offline Chromium scenario phase is invalid');
        }
      },
    });
    Object.defineProperty(globalThis, 'miakappChromiumScenarioControl', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: phaseControl,
    });
  }
}

const ENTRY_SOURCE = Buffer.from([
  "import { createBrowserRelayPageHost } from '../browser-relay-page/runtime.mjs';",
  "import * as boundary from '../browser-relay-page/boundary.mjs';",
  `(${offlinePageEntry.toString()})(createBrowserRelayPageHost, boundary);`,
  '',
].join('\n'));

function response(url) {
  if (url === TARGET_URL) {
    return { body: DOCUMENT_SOURCE, type: 'text/html; charset=utf-8' };
  }
  if (url === CHROMIUM_SCENARIO_AWAY_URL) {
    return { body: AWAY_SOURCE, type: 'text/html; charset=utf-8' };
  }
  if (url === ENTRY_URL) {
    return { body: ENTRY_SOURCE, type: 'text/javascript; charset=utf-8' };
  }
  const body = MODULE_BYTES[url];
  return body === undefined ? undefined : { body, type: 'text/javascript; charset=utf-8' };
}

export function createBrowserRelayTrustedProviderPageHost() {
  if (arguments.length !== 0) reject();
  const contexts = new Set();
  const counts = new Map();
  let server;
  let port;
  let startTask;
  let rejectedRequests = 0;
  let closed = false;

  function count(url) {
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }

  async function start() {
    if (arguments.length !== 0 || closed) reject();
    if (startTask !== undefined) return startTask;
    startTask = (async () => {
      let certificateRoot;
      try {
        const temporaryRoot = realpathSync.native(tmpdir());
        certificateRoot = realpathSync.native(
          mkdtempSync(join(temporaryRoot, 'miakapp-owner-loopback-tls-')),
        );
        if (!certificateRoot.startsWith(`${temporaryRoot}/`)) reject();
        const keyPath = join(certificateRoot, 'key.pem');
        const certificatePath = join(certificateRoot, 'certificate.pem');
        execFileSync('/usr/bin/openssl', [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-sha256',
          '-days',
          '1',
          '-subj',
          '/CN=miakapp-v4-staging.web.app',
          '-addext',
          'subjectAltName=DNS:miakapp-v4-staging.web.app',
          '-keyout',
          keyPath,
          '-out',
          certificatePath,
        ], {
          env: Object.create(null),
          stdio: 'ignore',
          timeout: 10_000,
        });
        server = createServer({
          cert: readFileSync(certificatePath),
          key: readFileSync(keyPath),
        }, (request, responseValue) => {
          try {
            const remote = request.socket.remoteAddress;
            const url = new URL(request.url ?? '', TARGET_ORIGIN).href;
            const selected = request.method === 'GET'
              && request.headers.host === new URL(TARGET_ORIGIN).host
              && (remote === '127.0.0.1' || remote === '::ffff:127.0.0.1')
              ? response(url)
              : undefined;
            if (selected === undefined) {
              rejectedRequests += 1;
              responseValue.writeHead(404, {
                ...HOSTING_HEADERS,
                'Content-Type': 'text/plain; charset=utf-8',
              });
              responseValue.end('Not found');
              return;
            }
            count(url);
            responseValue.writeHead(200, {
              ...HOSTING_HEADERS,
              'Content-Type': selected.type,
            });
            responseValue.end(selected.body);
          } catch {
            rejectedRequests += 1;
            responseValue.destroy();
          }
        });
        await new Promise((resolve, rejectStart) => {
          server.once('error', rejectStart);
          server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (address === null || typeof address === 'string'
          || address.address !== '127.0.0.1'
          || !Number.isSafeInteger(address.port) || address.port < 1) reject();
        port = address.port;
        return port;
      } catch {
        try { server?.closeAllConnections(); } catch {}
        try { server?.close(); } catch {}
        server = undefined;
        port = undefined;
        reject();
      } finally {
        if (certificateRoot !== undefined) {
          try { rmSync(certificateRoot, { force: true, recursive: true }); } catch { reject(); }
        }
      }
    })();
    return startTask;
  }

  async function install(context, browser, identityGeneration) {
    if (arguments.length !== 3 || closed || contexts.has(context)
      || !TRUSTED_PROVIDER_OWNER_BROWSER_ORDER.includes(browser)
      || (identityGeneration !== 1 && identityGeneration !== 2)
      || (browser !== 'chromium' && identityGeneration !== 1)
      || context === null || typeof context !== 'object'
      || typeof context.route !== 'function' || typeof context.addInitScript !== 'function') {
      reject();
    }
    await context.addInitScript(({ name, value }) => {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: false,
        writable: false,
        value,
      });
    }, {
      name: 'miakappTrustedProviderOwnerPageBootstrap',
      value: { browser, identity_generation: identityGeneration },
    });
    if (browser !== 'chromium') {
      await context.route('**/*', async (route) => {
        try {
          const request = route.request();
          const url = request.url();
          const selected = request.method() === 'GET' ? response(url) : undefined;
          if (selected === undefined) {
            rejectedRequests += 1;
            await route.abort('blockedbyclient');
            return;
          }
          count(url);
          await route.fulfill({
            status: 200,
            body: selected.body,
            headers: { ...HOSTING_HEADERS, 'Content-Type': selected.type },
          });
        } catch {
          reject();
        }
      });
    }
    contexts.add(context);
    return true;
  }

  function diagnostics() {
    if (arguments.length !== 0) reject();
    return Object.freeze({
      installed_contexts: contexts.size,
      loopback_port: port,
      rejected_requests: rejectedRequests,
      served_requests: [...counts.values()].reduce((sum, value) => sum + value, 0),
    });
  }

  async function close() {
    if (arguments.length !== 0) reject();
    if (closed) return undefined;
    closed = true;
    let converged = true;
    if (server !== undefined) {
      try { server.closeAllConnections(); } catch { converged = false; }
      try {
        await new Promise((resolve) => server.close((error) => {
          if (error !== undefined) converged = false;
          resolve();
        }));
      } catch {
        converged = false;
      }
    }
    server = undefined;
    port = undefined;
    contexts.clear();
    counts.clear();
    if (!converged) reject();
    return undefined;
  }

  return Object.freeze({ start, install, diagnostics, close });
}
