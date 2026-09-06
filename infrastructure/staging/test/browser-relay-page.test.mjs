import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildBrowserRelayPageArtifact,
  readAndVerifyBrowserRelayPageArtifact,
  validateBrowserRelayPageBuildDependencies,
} from '../browser-relay-page/artifact.mjs';
import {
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
  CALLBACK_CLEANUP_RESERVE_MILLISECONDS,
  EDGE_ROLLBACK_RESERVE_MILLISECONDS,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
  StagingBrowserRelayPageError,
  validateBrowserRelayPageProfile,
  validatePagePrivateInput,
  validatePageSafeObservation,
} from '../browser-relay-page/contract.mjs';
import { validateBrowserRelayPageRoot } from '../browser-relay-page/guard.mjs';
import { createBrowserRelayPageHost } from '../browser-relay-page/runtime.mjs';

const CUSTOM_TOKEN = `${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;
const FIREBASE_ID_TOKEN = `${'d'.repeat(32)}.${'e'.repeat(32)}.${'f'.repeat(32)}`;
const APP_CHECK_TOKEN = `${'g'.repeat(32)}.${'h'.repeat(32)}.${'i'.repeat(32)}`;
const ACCESS_TOKEN = `${'j'.repeat(32)}.${'k'.repeat(32)}.${'l'.repeat(32)}`;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  #listeners = new Map();
  readyState = MockWebSocket.OPEN;

  constructor(url) {
    this.url = String(url);
  }

  addEventListener(name, listener) {
    const listeners = this.#listeners.get(name) ?? [];
    listeners.push(listener);
    this.#listeners.set(name, listeners);
  }

  removeEventListener(name, listener) {
    this.#listeners.set(name, (this.#listeners.get(name) ?? []).filter((item) => item !== listener));
  }

  send(value) {
    this.lastSent = value;
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    for (const listener of this.#listeners.get('close') ?? []) listener({ code: 1000 });
  }
}

function createHarness(options = {}) {
  const nativeIndexedDB = Object.freeze({ open: () => {} });
  const global = { WebSocket: MockWebSocket, indexedDB: nativeIndexedDB };
  const calls = [];
  let clientCount = 0;
  let now = 1_000;
  let signOuts = 0;
  let disposals = 0;
  const host = createBrowserRelayPageHost({
    global,
    now: () => now,
    fetch: async (input, init) => {
      calls.push(`fetch:${input}:${init.method}`);
      return new Response('{}', {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          pragma: 'no-cache',
        },
      });
    },
    async createFirebaseSession(customToken, browser) {
      assert.equal(customToken, CUSTOM_TOKEN);
      assert.equal(browser, 'chromium');
      assert.equal(global.indexedDB, undefined);
      return {
        async getFirebaseIdToken() { return FIREBASE_ID_TOKEN; },
        async getAppCheckToken() { return APP_CHECK_TOKEN; },
        async signOut() { signOuts += 1; },
        async dispose() { disposals += 1; },
      };
    },
    createCredentialProvider(providerOptions) {
      return {
        async getCredential(request) {
          const firebaseToken = await providerOptions.getFirebaseIdToken(request);
          const appCheckToken = await providerOptions.getAppCheckToken(request);
          await providerOptions.fetch(providerOptions.exchangeEndpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${firebaseToken}`,
              'x-firebase-appcheck': appCheckToken,
            },
            body: '{}',
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
          });
          return {
            relayUrl: clientCount === 1 ? RELAY_A_URL : RELAY_B_URL,
            accessToken: ACCESS_TOKEN,
            expiresAtMs: Date.now() + 300_000,
          };
        },
      };
    },
    createBrowserClient({ credentialProvider }) {
      clientCount += 1;
      const instance = clientCount;
      let socket;
      let lifecycleListener = () => {};
      let failureListener = () => {};
      return {
        state: {
          snapshot: () => ({
            revision: instance,
            stale: false,
            values: { 'acceptance.temperature': 19 + instance },
          }),
        },
        calls: {
          start({ arguments: argumentsValue }) {
            return {
              accepted: Promise.resolve(),
              result: Promise.resolve({ accepted: true, arguments: argumentsValue }),
            };
          },
        },
        errors: {
          subscribe(listener) {
            failureListener = listener;
            return () => { failureListener = () => {}; };
          },
        },
        subscribe(listener) {
          lifecycleListener = listener;
          return () => { lifecycleListener = () => {}; };
        },
        async start() {
          lifecycleListener({ current: 'connecting' });
          const controller = new AbortController();
          const credential = await credentialProvider.getCredential({
            homeId: 'miakapp-v4-staging-browser-relay-v1',
            reason: instance === 1 ? 'initial' : 'reconnect',
            signal: controller.signal,
          });
          socket = new global.WebSocket(credential.relayUrl, 'miakapp');
          socket.send(new TextEncoder().encode(
            options.leakSourceCredential === true ? FIREBASE_ID_TOKEN : credential.accessToken,
          ));
          lifecycleListener({ current: 'ready' });
          if (options.failure !== undefined) failureListener(options.failure);
          return { enrolled: true, coordinators: [{ name: 'acceptance' }] };
        },
        async stop() {
          lifecycleListener({ current: 'stopping' });
          socket?.close();
          lifecycleListener({ current: 'stopped' });
        },
      };
    },
  });
  return {
    calls,
    global,
    host,
    nativeIndexedDB,
    nativeWebSocket: MockWebSocket,
    advance(milliseconds) { now += milliseconds; },
    cleanupCounts: () => ({ signOuts, disposals }),
  };
}

test('pins a dormant page host with two independent cleanup reserves and no authority', () => {
  const profile = validateBrowserRelayPageProfile();
  assert.equal(
    profile.state,
    'closed_page_host_and_artifact_implemented_not_wired_not_published_not_executed',
  );
  assert.equal(profile.page.runner_compatible, false);
  assert.equal(profile.page.app_check_persistence, 'memory_only_indexeddb_blocked');
  assert.equal(profile.authority.hosting_publication_authorized, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(CALLBACK_CLEANUP_RESERVE_MILLISECONDS, 300_000);
  assert.equal(EDGE_ROLLBACK_RESERVE_MILLISECONDS, 300_000);
  assert.match(BROWSER_RELAY_PAGE_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
});

test('keeps private input closed and rejects credential-bearing observations', () => {
  const input = validatePagePrivateInput({
    schema: PAGE_PRIVATE_INPUT_SCHEMA,
    browser: 'chromium',
    firebase_custom_token: CUSTOM_TOKEN,
  });
  assert.equal(input.firebase_custom_token, CUSTOM_TOKEN);
  assert.throws(
    () => validatePagePrivateInput({ ...input, extra: true }),
    /exactly the reviewed fields/u,
  );
  assert.throws(
    () => validatePageSafeObservation({ firebase_id_token: FIREBASE_ID_TOKEN }),
    /forbidden output/u,
  );
});

test('runs two sequential ephemeral clients and returns only bounded semantic facts', async () => {
  const harness = createHarness();
  const input = {
    schema: PAGE_PRIVATE_INPUT_SCHEMA,
    browser: 'chromium',
    firebase_custom_token: CUSTOM_TOKEN,
  };
  const initialized = await harness.host.initialize(input);
  assert.equal(initialized.state, 'initialized');
  assert.notEqual(harness.global.WebSocket, harness.nativeWebSocket);
  assert.equal(harness.global.indexedDB, undefined);

  const ready = await harness.host.start();
  assert.equal(ready.state, 'ready');
  assert.equal(ready.control_plane_exchanges, 1);
  assert.equal(ready.websocket_connections, 1);
  assert.equal(ready.maximum_active_websockets, 1);
  assert.equal(ready.source_credentials_on_websocket, 0);
  assert.deepEqual(ready.relay_ids, ['relay-a']);
  assert.equal(JSON.stringify(ready).includes(CUSTOM_TOKEN), false);
  assert.equal(JSON.stringify(ready).includes(FIREBASE_ID_TOKEN), false);

  assert.deepEqual(harness.host.observeState({
    path: 'acceptance.temperature',
    revision: 1,
    value: 20,
  }), {
    schema: 'miakapp.staging-browser-relay-page-state-observation/1',
    state: 'matched',
    revision: 1,
    stale: false,
  });
  assert.equal((await harness.host.call(21)).outcome, 'applied');

  const suspended = await harness.host.suspend();
  assert.equal(suspended.state, 'suspended');
  assert.equal(suspended.active_websockets, 0);
  const resumed = await harness.host.resume();
  assert.equal(resumed.state, 'ready');
  assert.equal(resumed.client_instances, 2);
  assert.equal(resumed.control_plane_exchanges, 2);
  assert.equal(resumed.websocket_connections, 2);
  assert.equal(resumed.maximum_active_websockets, 1);
  assert.deepEqual(resumed.relay_ids, ['relay-a', 'relay-b']);

  harness.advance(1_000);
  const stopped = await harness.host.stop();
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.active_websockets, 0);
  assert.equal(stopped.firebase_auth_sessions, 1);
  assert.deepEqual(harness.cleanupCounts(), { signOuts: 1, disposals: 1 });
  assert.equal(harness.global.WebSocket, harness.nativeWebSocket);
  assert.equal(harness.global.indexedDB, harness.nativeIndexedDB);
  assert.equal(harness.calls.length, 2);
});

test('fails closed when a Firebase source credential reaches a WebSocket', async () => {
  const harness = createHarness({ leakSourceCredential: true });
  await harness.host.initialize({
    schema: PAGE_PRIVATE_INPUT_SCHEMA,
    browser: 'chromium',
    firebase_custom_token: CUSTOM_TOKEN,
  });
  await assert.rejects(harness.host.start(), StagingBrowserRelayPageError);
  await assert.rejects(harness.host.stop(), StagingBrowserRelayPageError);
  assert.equal(harness.global.WebSocket, harness.nativeWebSocket);
  assert.equal(harness.global.indexedDB, harness.nativeIndexedDB);
  assert.deepEqual(harness.cleanupCounts(), { signOuts: 1, disposals: 1 });
});

test('builds exactly one HTML and one JavaScript file without private input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-page-'));
  const metadata = await buildBrowserRelayPageArtifact(root, {
    apiKey: `AIza${'A'.repeat(35)}`,
    appId: '1:1072737219170:web:5053ca93bf25d7373cd73b',
    authDomain: 'miakapp-v4-staging.firebaseapp.com',
    messagingSenderId: '1072737219170',
    projectId: 'miakapp-v4-staging',
    storageBucket: 'miakapp-v4-staging.firebasestorage.app',
  }, 'A'.repeat(32));
  assert.equal(metadata.file_count, 2);
  assert.ok(metadata.total_content_bytes > 100_000);
  assert.equal(metadata.files.some((file) => file.path.endsWith('.map')), false);
  const files = readAndVerifyBrowserRelayPageArtifact(root, metadata);
  assert.equal(files.length, 2);
  assert.equal(files.some((file) => file.raw.includes(Buffer.from(CUSTOM_TOKEN))), false);
  assert.throws(
    () => readAndVerifyBrowserRelayPageArtifact(root, {
      ...metadata,
      files: metadata.files.map((file, index) => (
        index === 0 ? { ...file, gzip_sha256: '../profile.json' } : file
      )),
    }),
    /file metadata is invalid/u,
  );

  const javascript = metadata.files.find((file) => file.path.endsWith('.js'));
  const localPath = join(root, 'artifact', javascript.path.split('/').slice(-2).join('/'));
  chmodSync(localPath, 0o600);
  const tampered = readFileSync(localPath);
  tampered[0] ^= 1;
  writeFileSync(localPath, tampered, { flag: 'w', mode: 0o600 });
  chmodSync(localPath, 0o400);
  assert.throws(
    () => readAndVerifyBrowserRelayPageArtifact(root, metadata),
    /differ from reviewed metadata/u,
  );
});

test('guards exact source, vendor and dependency inventories', () => {
  validateBrowserRelayPageRoot(new URL('../browser-relay-page/', import.meta.url));
  assert.equal(validateBrowserRelayPageBuildDependencies({
    dependencies: { firebase: '12.18.0' },
    devDependencies: { vite: '8.2.2' },
  }), true);
  assert.throws(
    () => validateBrowserRelayPageBuildDependencies({
      dependencies: { firebase: '^12.18.0' },
      devDependencies: { vite: '8.2.2' },
    }),
    /not exactly pinned/u,
  );
});
