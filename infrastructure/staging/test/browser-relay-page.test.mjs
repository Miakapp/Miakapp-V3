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
  MAXIMUM_CHROMIUM_MILLISECONDS,
  MAXIMUM_RUNNER_MILLISECONDS,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
  StagingBrowserRelayPageError,
  validateBrowserRelayPageProfile,
  validatePagePrivateInput,
  validatePageSafeObservation,
} from '../browser-relay-page/contract.mjs';
import { validateBrowserRelayPageRoot } from '../browser-relay-page/guard.mjs';
import { createBrowserRelayPageHarness as createHarness } from './helpers/browser-relay-page-harness.mjs';

const CUSTOM_TOKEN = `${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;
const FIREBASE_ID_TOKEN = `${'d'.repeat(32)}.${'e'.repeat(32)}.${'f'.repeat(32)}`;

test('pins a dormant page host with two independent cleanup reserves and no authority', () => {
  const profile = validateBrowserRelayPageProfile();
  assert.equal(
    profile.state,
    'three_engine_dormant_scenario_host_implemented_not_wired_not_published_not_executed',
  );
  assert.equal(profile.page.three_engine_dormant_artifact_ci, true);
  assert.equal(profile.page.runner_compatible, false);
  assert.equal(profile.page.app_check_persistence, 'memory_only_indexeddb_blocked');
  assert.equal(profile.authority.hosting_publication_authorized, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(MAXIMUM_CHROMIUM_MILLISECONDS, 600_000);
  assert.equal(MAXIMUM_RUNNER_MILLISECONDS, 720_000);
  assert.equal(CALLBACK_CLEANUP_RESERVE_MILLISECONDS, 180_000);
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

async function readyHarness(options = {}) {
  const harness = createHarness(options);
  await harness.host.initialize(harness.privateInput());
  await harness.host.start();
  return harness;
}

function settleCallbacks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('cancels an in-flight Firebase initialization and disposes its late session exactly once', async () => {
  const harness = createHarness({ deferred: ['firebaseSession'] });
  const initialization = assert.rejects(
    harness.host.initialize(harness.privateInput()),
    StagingBrowserRelayPageError,
  );
  await harness.gates.firebaseSession.entered;
  const firstStop = harness.host.stop();
  const secondStop = harness.host.stop();
  harness.gates.firebaseSession.release();
  await initialization;
  assert.equal((await firstStop).state, 'stopped');
  assert.equal((await secondStop).state, 'stopped');
  assert.deepEqual(harness.cleanupCounts(), { signOuts: 1, disposals: 1 });
  assert.equal(harness.counts().clientStarts, 0);
  assert.equal(harness.counts().socketConnections, 0);
  await assert.rejects(harness.host.initialize(harness.privateInput()), StagingBrowserRelayPageError);
  await assert.rejects(harness.host.start(), StagingBrowserRelayPageError);
});

test('a rejected Firebase initialization cannot be initialized again', async () => {
  const harness = createHarness({ deferred: ['firebaseSession'] });
  const initialization = assert.rejects(
    harness.host.initialize(harness.privateInput()),
    StagingBrowserRelayPageError,
  );
  await harness.gates.firebaseSession.entered;
  harness.gates.firebaseSession.reject();
  await initialization;
  await assert.rejects(harness.host.initialize(harness.privateInput()), StagingBrowserRelayPageError);
  await assert.rejects(harness.host.start(), StagingBrowserRelayPageError);
  assert.equal(harness.counts().sessionCreations, 0);
  assert.equal(harness.counts().clientStarts, 0);
});

test('retains the page-global fence when Firebase initialization cleanup is uncertain', async () => {
  const first = createHarness({
    firebaseInitializationFailure: true,
    firebaseInitializationCleanupFailure: true,
  });
  await assert.rejects(
    first.host.initialize(first.privateInput()),
    StagingBrowserRelayPageError,
  );
  await assert.rejects(
    first.host.stop(),
    StagingBrowserRelayPageError,
  );
  assert.notEqual(first.global.WebSocket, first.nativeWebSocket);
  assert.equal(first.global.indexedDB, undefined);
  const replacement = createHarness({ global: first.global });
  await assert.rejects(
    replacement.host.initialize(replacement.privateInput()),
    StagingBrowserRelayPageError,
  );
});

test('bounds a stalled Firebase initialization and cleans a session that resolves late', {
  timeout: 4_000,
}, async () => {
  const harness = createHarness({ deferred: ['firebaseSession'] });
  const initialization = assert.rejects(
    harness.host.initialize(harness.privateInput()),
    StagingBrowserRelayPageError,
  );
  await harness.gates.firebaseSession.entered;
  const stopping = assert.rejects(harness.host.stop(), StagingBrowserRelayPageError);
  assert.equal(harness.host.observe().state, 'stopping');
  await initialization;
  await stopping;
  assert.equal(harness.host.observe().state, 'failed');
  harness.gates.firebaseSession.release();
  await settleCallbacks();
  assert.deepEqual(harness.cleanupCounts(), { signOuts: 1, disposals: 1 });
});

for (const deferred of ['clientStart', 'firebaseToken', 'appCheckToken']) {
  test(`stop fences a delayed ${deferred} without a late exchange or socket`, async () => {
    const harness = createHarness({ deferred: [deferred] });
    await harness.host.initialize(harness.privateInput());
    const starting = assert.rejects(harness.host.start(), StagingBrowserRelayPageError);
    await harness.gates[deferred].entered;
    const stopping = harness.host.stop();
    const duplicateStop = harness.host.stop();
    const lateCall = assert.rejects(harness.host.call(22), StagingBrowserRelayPageError);
    harness.gates[deferred].release();
    await starting;
    await lateCall;
    assert.equal((await stopping).state, 'stopped');
    assert.equal((await duplicateStop).state, 'stopped');
    assert.equal(harness.counts().credentialExchanges, 0);
    assert.equal(harness.counts().socketConnections, 0);
    assert.equal(harness.counts().activeSockets, 0);
    assert.equal(harness.counts().clientStops, 1);
    assert.equal(harness.counts().callStarts, 0);
    assert.deepEqual(harness.cleanupCounts(), { signOuts: 1, disposals: 1 });
    await assert.rejects(harness.host.resume(), StagingBrowserRelayPageError);
  });
}

test('serializes an overlapping suspend and resume without duplicate active sockets', async () => {
  const harness = await readyHarness({ deferred: ['clientStop'] });
  const suspending = harness.host.suspend();
  const duplicateSuspend = harness.host.suspend();
  assert.equal(duplicateSuspend, suspending);
  await harness.gates.clientStop.entered;
  assert.equal(harness.counts().activeSockets, 0);
  const resuming = harness.host.resume();
  const duplicateResume = harness.host.resume();
  assert.equal(duplicateResume, resuming);
  assert.equal(harness.counts().clientInstances, 1);
  harness.gates.clientStop.release();
  assert.equal((await suspending).state, 'suspended');
  assert.equal((await resuming).state, 'ready');
  assert.equal(harness.counts().clientInstances, 2);
  assert.equal(harness.counts().maximumActiveSockets, 1);
  const lifecycle = harness.host.observeLifecycle();
  assert.equal(lifecycle.suspensions, 1);
  assert.equal(lifecycle.resumptions, 1);
  await harness.host.stop();
});

test('ignores queued status, state and failure callbacks after terminal stop', async () => {
  const harness = await readyHarness();
  const callbacks = harness.captureCallbacks();
  await harness.host.stop();
  const observation = harness.host.observe();
  const lifecycle = harness.host.observeLifecycle();
  callbacks.status('ready');
  callbacks.state({ revision: 9, value: 99, stale: false });
  callbacks.failure({ kind: 'unavailable', outcome: 'outcome_unknown', message: FIREBASE_ID_TOKEN });
  assert.deepEqual(harness.host.observe(), observation);
  assert.deepEqual(harness.host.observeLifecycle(), lifecycle);
  assert.equal(JSON.stringify(lifecycle).includes(FIREBASE_ID_TOKEN), false);
});

for (const cleanupFailure of [
  'clientStopFailure', 'unsubscribeFailure', 'removeEventListenerFailure',
  'signOutFailure', 'disposeFailure',
]) {
  test(`the ${cleanupFailure} path remains terminal and never duplicates Firebase teardown`, async () => {
    const harness = await readyHarness({ [cleanupFailure]: true });
    await assert.rejects(harness.host.stop(), StagingBrowserRelayPageError);
    await assert.rejects(harness.host.stop(), StagingBrowserRelayPageError);
    await assert.rejects(harness.host.initialize(harness.privateInput()), StagingBrowserRelayPageError);
    await assert.rejects(harness.host.start(), StagingBrowserRelayPageError);
    assert.deepEqual(harness.cleanupCounts(), { signOuts: 1, disposals: 1 });
    assert.equal(harness.counts().clientStops, 1);
    assert.equal(harness.counts().activeSockets, 0);
    assert.notEqual(harness.global.WebSocket, harness.nativeWebSocket);
    assert.equal(harness.global.indexedDB, undefined);
  });
}

test('preserves a failed suspension cleanup as terminal uncertainty', async () => {
  const harness = await readyHarness({ clientStopFailure: true });
  await assert.rejects(harness.host.suspend(), StagingBrowserRelayPageError);
  await assert.rejects(harness.host.stop(), StagingBrowserRelayPageError);
  assert.equal(harness.host.observe().state, 'failed');
  assert.equal(harness.counts().clientStops, 1);
  assert.deepEqual(harness.cleanupCounts(), { signOuts: 1, disposals: 1 });
});

for (const deferredCleanup of ['signOut', 'dispose']) {
  test(`bounds a stalled Firebase ${deferredCleanup} cleanup`, { timeout: 4_000 }, async () => {
    const harness = await readyHarness({ deferred: [deferredCleanup] });
    const stopping = assert.rejects(harness.host.stop(), StagingBrowserRelayPageError);
    await harness.gates[deferredCleanup].entered;
    await stopping;
    assert.equal(harness.host.observe().state, 'failed');
    assert.deepEqual(harness.cleanupCounts(), { signOuts: 1, disposals: 1 });
    harness.gates[deferredCleanup].release();
  });
}

for (const [callOutcome, callFailureBeforeAcceptance] of [
  ['failed', false],
  ['failed', true],
  ['outcome_unknown', false],
  ['outcome_unknown', true],
]) {
  test(`records ${callOutcome} ${callFailureBeforeAcceptance ? 'before' : 'after'} acceptance without raw errors or replay`, async () => {
    const harness = await readyHarness({ callOutcome, callFailureBeforeAcceptance });
    let unhandled = 0;
    const countUnhandled = () => { unhandled += 1; };
    process.on('unhandledRejection', countUnhandled);
    try {
      assert.deepEqual(await harness.host.call(21), {
        schema: 'miakapp.staging-browser-relay-page-call-observation/1',
        state: 'failed',
        outcome: callOutcome,
      });
      await settleCallbacks();
      assert.equal(unhandled, 0);
      assert.equal(harness.counts().callStarts, 1);
      assert.deepEqual(harness.host.observeLifecycle().call_outcomes, [callOutcome]);
      assert.equal(JSON.stringify(harness.host.observeLifecycle()).includes('Offline typed'), false);
    } finally {
      process.off('unhandledRejection', countUnhandled);
      await harness.host.stop();
    }
  });
}

test('records an in-flight call as outcome_unknown when terminal stop masks its result', async () => {
  const harness = await readyHarness({ deferred: ['callResult'] });
  const call = harness.host.call(21);
  await harness.gates.callResult.entered;
  const stopping = harness.host.stop();
  assert.deepEqual(await call, {
    schema: 'miakapp.staging-browser-relay-page-call-observation/1',
    state: 'failed',
    outcome: 'outcome_unknown',
  });
  harness.gates.callResult.release();
  assert.equal((await stopping).state, 'stopped');
  assert.equal(harness.counts().callStarts, 1);
  assert.deepEqual(harness.host.observeLifecycle().call_outcomes, ['outcome_unknown']);
});

for (const malformedCall of ['callUntypedFailure', 'callInvalidResult']) {
  test(`records ${malformedCall} after dispatch as outcome_unknown`, async () => {
    const harness = await readyHarness({ [malformedCall]: true });
    assert.deepEqual(await harness.host.call(21), {
      schema: 'miakapp.staging-browser-relay-page-call-observation/1',
      state: 'failed',
      outcome: 'outcome_unknown',
    });
    assert.deepEqual(harness.host.observeLifecycle().call_outcomes, ['outcome_unknown']);
    await harness.host.stop();
  });
}

test('records immediate and transient SDK state subscriptions without retaining state payloads', async () => {
  const harness = await readyHarness();
  harness.emitState({ revision: 1, value: 20, stale: true });
  harness.emitState({ revision: 2, value: 21, stale: false });
  assert.deepEqual(harness.host.observeLifecycle().state_transitions, [
    { revision: 1, stale: false },
    { revision: 1, stale: true },
    { revision: 2, stale: false },
  ]);
  assert.equal(JSON.stringify(harness.host.observeLifecycle()).includes('acceptance.temperature'), false);
  await harness.host.stop();
});

test('filters untrusted events and serializes simulated lifecycle callbacks without claiming native BFCache proof', async () => {
  const harness = await readyHarness();
  harness.global.dispatchEvent({ type: 'pagehide', persisted: true, isTrusted: false });
  await settleCallbacks();
  assert.equal(harness.host.observe().state, 'ready');
  assert.deepEqual(harness.host.observeLifecycle().events, []);

  harness.global.dispatchEvent({ type: 'pagehide', persisted: true, isTrusted: true });
  harness.global.dispatchEvent({ type: 'pageshow', persisted: true, isTrusted: true });
  await settleCallbacks();
  assert.equal(harness.host.observe().state, 'ready');
  const lifecycle = harness.host.observeLifecycle();
  assert.deepEqual(lifecycle.events, [
    { event: 'pagehide', persisted: true },
    { event: 'pageshow', persisted: true },
  ]);
  assert.equal(lifecycle.suspensions, 1);
  assert.equal(lifecycle.resumptions, 1);
  assert.equal(harness.counts().maximumActiveSockets, 1);
  await harness.host.stop();
  assert.equal(harness.host.observeLifecycle().sign_outs, 1);
  assert.equal(harness.host.observeLifecycle().disposals, 1);
});

test('uses a fresh isolated host for a replacement identity in every supported browser', async () => {
  for (const browserName of ['chromium', 'firefox', 'webkit']) {
    const first = await readyHarness({ browserName, generation: 1 });
    await first.host.stop();
    const replacement = await readyHarness({ browserName, generation: 2 });
    assert.notEqual(first.privateInput().firebase_custom_token,
      replacement.privateInput().firebase_custom_token);
    assert.equal(replacement.host.observe().firebase_auth_sessions, 1);
    assert.deepEqual(replacement.host.observe().relay_ids, ['relay-b']);
    assert.equal(first.counts().activeSockets, 0);
    await replacement.host.stop();
    assert.deepEqual(first.cleanupCounts(), { signOuts: 1, disposals: 1 });
    assert.deepEqual(replacement.cleanupCounts(), { signOuts: 1, disposals: 1 });
  }
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
