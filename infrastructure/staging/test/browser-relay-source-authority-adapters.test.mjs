import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createAuthenticatedSourceReaderContext,
} from '../browser-relay-authenticated-source-readers/contract.mjs';
import {
  createBrowserRelayAuthenticatedSourceReadersForTest,
} from '../browser-relay-authenticated-source-readers/testing.mjs';
import {
  INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE,
  INDEPENDENT_CASE_ADAPTER_STAGE_ORDER,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE,
  SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE,
  SOURCE_AUTHORITY_ADAPTERS_DISTINCT_KIND_COUNT,
  SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_CLOSE_MILLISECONDS,
  SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
  SOURCE_AUTHORITY_ADAPTERS_OBSERVATIONS_PER_MATRIX,
  SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE,
  SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER,
  SOURCE_AUTHORITY_ADAPTERS_STAGE_COUNT,
  StagingBrowserRelaySourceAuthorityAdapterError,
  sourceAuthorityAdaptersDependencyContractsSha256,
  validateBrowserRelaySourceAuthorityAdaptersProfile,
} from '../browser-relay-source-authority-adapters/contract.mjs';
import {
  validateBrowserRelaySourceAuthorityAdaptersRoot,
} from '../browser-relay-source-authority-adapters/guard.mjs';
import {
  createBrowserRelaySourceAuthorityAdapters,
} from '../browser-relay-source-authority-adapters/adapters.mjs';
import {
  createBrowserRelaySourceAuthorityAdaptersForTest,
} from '../browser-relay-source-authority-adapters/testing.mjs';
import {
  createBrowserRelaySourceTransports,
} from '../browser-relay-source-transports/transports.mjs';
import { fullIndependentFacts } from './helpers/browser-relay-evidence-fixture.mjs';

const PACKAGE_ROOT = new URL(
  '../browser-relay-source-authority-adapters/',
  import.meta.url,
);
const READ_DESCRIPTOR_FIELDS = Object.freeze([
  'browser',
  'case_id',
  'kind',
  'signal',
  'source',
  'toJSON',
]);
const temporaryRoots = new Set();

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withDeadline(promise, label, milliseconds = 1_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`${label} did not settle within ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function adapterError(error) {
  assert.equal(error instanceof StagingBrowserRelaySourceAuthorityAdapterError, true);
  assert.equal(error.name, 'StagingBrowserRelaySourceAuthorityAdapterError');
  assert.equal(
    error.message,
    'Staging browser-relay source authority adapter failed closed',
  );
  return true;
}

function operationCapability() {
  const capability = () => {
    throw new Error('opaque');
  };
  Object.setPrototypeOf(capability, null);
  return Object.freeze(capability);
}

function candidateObservation(facts, descriptor) {
  const fact = facts[descriptor.browser][descriptor.source]
    .find(({ kind }) => kind === descriptor.kind);
  assert.notEqual(fact, undefined);
  return structuredClone(fact.observation);
}

function createSessionHarness(expiresAt, hooks = {}) {
  const facts = fullIndependentFacts();
  const metrics = {
    reads: [],
    closes: [],
    closeSignals: [],
    releases: [],
    timerDurations: [],
  };
  const sessions = Object.fromEntries(SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.map((source) => {
    const session = {
      source,
      scope: SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE[source],
      expires_at_milliseconds: expiresAt,
      async read(descriptor) {
        metrics.reads.push({ source, descriptor });
        const result = await hooks.read?.({ source, descriptor, metrics, facts });
        if (result?.handled === true) return result.value;
        return candidateObservation(facts, descriptor);
      },
      async close(signal) {
        metrics.closes.push(source);
        metrics.closeSignals.push(signal);
        return hooks.close?.({ source, signal, metrics });
      },
    };
    return [source, Object.freeze(session)];
  }));
  return { sessions, metrics, facts };
}

function testRuntime(harness, nowState, timerHooks = {}) {
  return {
    clock: () => nowState.value,
    set_timer(callback, milliseconds) {
      harness.metrics.timerDurations.push(milliseconds);
      if (timerHooks.set_timer !== undefined) {
        return timerHooks.set_timer(callback, milliseconds);
      }
      return globalThis.setTimeout(callback, milliseconds);
    },
    clear_timer(handle) {
      if (timerHooks.clear_timer !== undefined) {
        return timerHooks.clear_timer(handle);
      }
      return globalThis.clearTimeout(handle);
    },
    session_released(source) {
      harness.metrics.releases.push(source);
      timerHooks.session_released?.(source);
    },
  };
}

function controlledAdapters(
  harness,
  nowState,
  controller = new AbortController(),
  timerHooks = {},
) {
  const expiresAt = nowState.value
    + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  assert.equal(harness.sessions.firebase_app_check.expires_at_milliseconds, expiresAt);
  const authorities = createBrowserRelaySourceAuthorityAdaptersForTest(
    harness.sessions,
    {
      signal: controller.signal,
      expires_at_milliseconds: expiresAt,
    },
    testRuntime(harness, nowState, timerHooks),
  );
  return { authorities, controller, expiresAt };
}

function directContext(source, cursor, signal, capability) {
  const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source][cursor];
  return createAuthenticatedSourceReaderContext(Object.freeze({
    source,
    browser: call.browser,
    case_id: call.case_id,
    expected_kinds: Object.freeze([call.kind]),
    expected_observation_count: 1,
    signal,
    operation_capability: capability,
  }), call.kind, signal);
}

async function completeAuthorities(authorities, signal, capability = operationCapability()) {
  const observations = [];
  for (const source of SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER) {
    for (let cursor = 0;
      cursor < SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source].length;
      cursor += 1) {
      const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source][cursor];
      observations.push(await authorities[source][call.kind](
        directContext(source, cursor, signal, capability),
      ));
    }
  }
  return { capability, observations };
}

async function completeSourceAuthority(
  authorities,
  source,
  signal,
  capability = operationCapability(),
) {
  for (let cursor = 0;
    cursor < SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source].length;
    cursor += 1) {
    const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source][cursor];
    await authorities[source][call.kind](
      directContext(source, cursor, signal, capability),
    );
  }
  return capability;
}

async function closeAllAuthorities(authorities) {
  return Promise.allSettled(
    SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.map((source) => authorities[source].close()),
  );
}

function sourceScope(browser, caseId, signal, observations) {
  const scope = {
    browser,
    case_id: caseId,
    signal,
    async record(observation) {
      observations.push(observation);
      return true;
    },
  };
  Object.defineProperty(scope, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      throw new Error('not serializable');
    },
  });
  return Object.freeze(scope);
}

async function runCompleteTransportStack(harness, nowState, controller) {
  const { authorities } = controlledAdapters(harness, nowState, controller);
  const readers = createBrowserRelayAuthenticatedSourceReadersForTest(
    authorities,
    {
      signal: controller.signal,
      expires_at_milliseconds: nowState.value
        + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
    },
    {
      clock: () => nowState.value,
      authority_released() {},
    },
  );
  const transports = createBrowserRelaySourceTransports(readers, {
    signal: controller.signal,
  });
  const observations = [];
  for (const { browser, case_id: caseId } of INDEPENDENT_CASE_ADAPTER_STAGE_ORDER) {
    const sources = Object.keys(
      INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[`${caseId}/${browser}`],
    );
    await Promise.all(sources.map((source) => transports[source].execute(
      sourceScope(browser, caseId, controller.signal, observations),
    )));
  }
  await Promise.all(
    SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.map((source) => transports[source].close()),
  );
  return observations;
}

function copiedPackageRoot() {
  const parent = mkdtempSync(join(tmpdir(), 'miakapp-source-authority-adapters-'));
  temporaryRoots.add(parent);
  const root = join(parent, 'package');
  cpSync(PACKAGE_ROOT, root, { recursive: true });
  return new URL(`file://${root}/`);
}

function cloneFrozen(value) {
  if (value === null || typeof value !== 'object') return value;
  const clone = Array.isArray(value)
    ? value.map((entry) => cloneFrozen(entry))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneFrozen(entry)]));
  return Object.freeze(clone);
}

test('all 22 stages and 43 observations cross the complete dormant stack', async () => {
  const now = { value: 1_800_000_000_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt);
  const controller = new AbortController();
  const observations = await runCompleteTransportStack(harness, now, controller);

  assert.equal(SOURCE_AUTHORITY_ADAPTERS_STAGE_COUNT, 22);
  assert.equal(SOURCE_AUTHORITY_ADAPTERS_OBSERVATIONS_PER_MATRIX, 43);
  assert.equal(SOURCE_AUTHORITY_ADAPTERS_DISTINCT_KIND_COUNT, 32);
  assert.equal(observations.length, 43);
  assert.equal(harness.metrics.reads.length, 43);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER].sort(),
  );

  for (const { source, descriptor } of harness.metrics.reads) {
    assert.equal(source, descriptor.source);
    assert.deepEqual(Reflect.ownKeys(descriptor).sort(), [...READ_DESCRIPTOR_FIELDS].sort());
    assert.deepEqual(
      Object.keys(descriptor).sort(),
      READ_DESCRIPTOR_FIELDS.filter((field) => field !== 'toJSON').sort(),
    );
    assert.equal(Object.getPrototypeOf(descriptor), null);
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(descriptor.signal instanceof AbortSignal, true);
    assert.equal(descriptor.signal.aborted, true);
    adapterError(descriptor.signal.reason);
    assert.equal(Object.hasOwn(descriptor, 'operation_capability'), false);
    assert.throws(() => JSON.stringify(descriptor), adapterError);
  }
});

test('production and testing factories expose exact isolated authority surfaces', async () => {
  assert.equal(createBrowserRelaySourceAuthorityAdapters.length, 2);
  assert.equal(createBrowserRelaySourceAuthorityAdaptersForTest.length, 3);
  const expiresAt = Date.now() + 1_000;
  const harness = createSessionHarness(expiresAt);
  const authorities = createBrowserRelaySourceAuthorityAdapters(harness.sessions, {
    signal: new AbortController().signal,
    expires_at_milliseconds: expiresAt,
  });
  assert.deepEqual(Reflect.ownKeys(authorities), SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER);
  assert.equal(Object.isFrozen(authorities), true);
  for (const source of SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER) {
    assert.deepEqual(
      Reflect.ownKeys(authorities[source]),
      SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE[source],
    );
    assert.equal(Object.isFrozen(authorities[source]), true);
  }
  const results = await closeAllAuthorities(authorities);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.equal(harness.metrics.reads.length, 0);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER].sort(),
  );
});

test('session, scope, and option descriptors fail closed without invoking getters', () => {
  const now = { value: 50_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  for (const mutate of [
    (harness) => { harness.sessions.extra = {}; },
    (harness) => { harness.sessions[Symbol('extra')] = {}; },
    (harness) => { harness.sessions.hosting = harness.sessions.firebase_app_check; },
    (harness) => {
      harness.sessions.kms = Object.freeze({ ...harness.sessions.kms, extra: true });
    },
    (harness) => {
      harness.sessions.relay = Object.freeze({
        ...harness.sessions.relay,
        scope: SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE.hosting,
      });
    },
    (harness) => {
      harness.sessions.firestore = Object.freeze({
        ...harness.sessions.firestore,
        expires_at_milliseconds: expiresAt - 1,
      });
    },
    (harness) => {
      const session = { ...harness.sessions.control_plane };
      Object.defineProperty(session, 'read', {
        enumerable: true,
        get() { throw new Error('getter must not run'); },
      });
      harness.sessions.control_plane = Object.freeze(session);
    },
    (harness) => {
      harness.sessions.coordinator = { ...harness.sessions.coordinator };
    },
  ]) {
    const harness = createSessionHarness(expiresAt);
    mutate(harness);
    assert.throws(() => controlledAdapters(harness, now), adapterError);
    assert.equal(harness.metrics.reads.length, 0);
  }

  for (const options of [
    {},
    { signal: new AbortController().signal, expires_at_milliseconds: expiresAt, extra: true },
    { signal: {}, expires_at_milliseconds: expiresAt },
    { signal: new AbortController().signal, expires_at_milliseconds: now.value },
    {
      signal: new AbortController().signal,
      expires_at_milliseconds: expiresAt + 1,
    },
    { signal: new AbortController().signal, expires_at_milliseconds: expiresAt - 0.5 },
  ]) {
    const harness = createSessionHarness(expiresAt);
    assert.throws(
      () => createBrowserRelaySourceAuthorityAdaptersForTest(
        harness.sessions,
        options,
        testRuntime(harness, now),
      ),
      adapterError,
    );
  }

  const aborted = new AbortController();
  aborted.abort(Object.freeze({ private_material: 'must-not-cross' }));
  const harness = createSessionHarness(expiresAt);
  assert.throws(
    () => createBrowserRelaySourceAuthorityAdaptersForTest(
      harness.sessions,
      { signal: aborted.signal, expires_at_milliseconds: expiresAt },
      testRuntime(harness, now),
    ),
    adapterError,
  );
});

test('session identities are globally single-operation and runtimes are exact', async () => {
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt);
  const first = controlledAdapters(harness, now);
  assert.throws(() => controlledAdapters(harness, now), adapterError);
  await closeAllAuthorities(first.authorities);
  assert.throws(() => controlledAdapters(harness, now), adapterError);

  for (const runtime of [
    {},
    {
      clock: () => now.value,
      set_timer() {},
      clear_timer() {},
      session_released() {},
      extra: true,
    },
    { clock: now.value, set_timer() {}, clear_timer() {}, session_released() {} },
    { clock: () => now.value, set_timer: true, clear_timer() {}, session_released() {} },
    { clock: () => now.value, set_timer() {}, clear_timer: true, session_released() {} },
    { clock: () => now.value, set_timer() {}, clear_timer() {}, session_released: true },
    { clock: () => -1, set_timer() {}, clear_timer() {}, session_released() {} },
    { clock: () => 1.5, set_timer() {}, clear_timer() {}, session_released() {} },
  ]) {
    const candidate = createSessionHarness(expiresAt);
    assert.throws(
      () => createBrowserRelaySourceAuthorityAdaptersForTest(
        candidate.sessions,
        { signal: new AbortController().signal, expires_at_milliseconds: expiresAt },
        runtime,
      ),
      adapterError,
    );
  }
});

test('the first call binds one operation capability across all sources', async () => {
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt);
  const { authorities, controller } = controlledAdapters(harness, now);
  const firstCapability = operationCapability();
  const secondCapability = operationCapability();
  const appCheckCall = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.firebase_app_check[0];
  await authorities.firebase_app_check[appCheckCall.kind](
    directContext('firebase_app_check', 0, controller.signal, firstCapability),
  );
  const hostingCall = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.hosting[0];
  await assert.rejects(
    authorities.hosting[hostingCall.kind](
      directContext('hosting', 0, controller.signal, secondCapability),
    ),
    adapterError,
  );
  const results = await closeAllAuthorities(authorities);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
});

test('kind order is reserved before await and source calls cannot overlap', async () => {
  const pending = deferred();
  let first = true;
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt, {
    async read({ descriptor, facts }) {
      if (first) {
        first = false;
        await pending.promise;
      }
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
  });
  const { authorities, controller } = controlledAdapters(harness, now);
  const capability = operationCapability();
  const calls = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.firebase_app_check;
  const active = authorities.firebase_app_check[calls[0].kind](
    directContext('firebase_app_check', 0, controller.signal, capability),
  );
  await Promise.resolve();
  await assert.rejects(
    authorities.firebase_app_check[calls[1].kind](
      directContext('firebase_app_check', 1, controller.signal, capability),
    ),
    adapterError,
  );
  pending.resolve();
  await assert.rejects(withDeadline(active, 'poisoned active session read'), adapterError);
  await closeAllAuthorities(authorities);
});

test('wrong methods, contexts, and argument counts poison the complete set', async (t) => {
  for (const variant of ['wrong method', 'wrong browser', 'extra argument']) {
    await t.test(variant, async () => {
      const now = { value: 100_000 };
      const expiresAt = now.value
        + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
      const harness = createSessionHarness(expiresAt);
      const { authorities, controller } = controlledAdapters(harness, now);
      const capability = operationCapability();
      const source = 'firebase_app_check';
      const calls = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source];
      if (variant === 'wrong method') {
        await assert.rejects(
          authorities[source][calls[1].kind](
            directContext(source, 0, controller.signal, capability),
          ),
          adapterError,
        );
      } else if (variant === 'wrong browser') {
        const context = directContext(source, 0, controller.signal, capability);
        const descriptors = Object.getOwnPropertyDescriptors(context);
        descriptors.browser.value = 'firefox';
        const wrong = Object.create(null, descriptors);
        Object.freeze(wrong);
        await assert.rejects(authorities[source][calls[0].kind](wrong), adapterError);
      } else {
        await assert.rejects(
          authorities[source][calls[0].kind](
            directContext(source, 0, controller.signal, capability),
            'extra',
          ),
          adapterError,
        );
      }
      const other = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.hosting[0];
      await assert.rejects(
        authorities.hosting[other.kind](
          directContext('hosting', 0, controller.signal, capability),
        ),
        adapterError,
      );
      await closeAllAuthorities(authorities);
      assert.equal(harness.metrics.reads.length, 0);
    });
  }
});

test('session callback failures, private material, and semantic drift collapse', async () => {
  for (const read of [
    () => { throw new TypeError('private synchronous cause'); },
    async () => Promise.reject(new Error('private asynchronous cause')),
    () => ({ handled: true, value: {} }),
    ({ descriptor, facts }) => ({
      handled: true,
      value: {
        ...candidateObservation(facts, descriptor),
        raw_response: 'forbidden',
      },
    }),
  ]) {
    const now = { value: 100_000 };
    const expiresAt = now.value
      + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
    const harness = createSessionHarness(expiresAt, { read });
    const { authorities, controller } = controlledAdapters(harness, now);
    const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.coordinator[0];
    await assert.rejects(
      authorities.coordinator[call.kind](
        directContext('coordinator', 0, controller.signal, operationCapability()),
      ),
      adapterError,
    );
    await closeAllAuthorities(authorities);
  }
});

test('validated output is a copied frozen projection, never the session identity', async () => {
  let returned;
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt, {
    read({ descriptor, facts }) {
      returned = candidateObservation(facts, descriptor);
      return { handled: true, value: returned };
    },
  });
  const { authorities, controller } = controlledAdapters(harness, now);
  const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.coordinator[0];
  const output = await authorities.coordinator[call.kind](
    directContext('coordinator', 0, controller.signal, operationCapability()),
  );
  assert.notEqual(output, returned);
  assert.equal(Object.isFrozen(output), true);
  const snapshot = structuredClone(output);
  returned[Object.keys(returned)[0]] = 'changed after return';
  assert.deepEqual(output, snapshot);
  await closeAllAuthorities(authorities);
});

test('root abort during read suppresses output and sanitizes the reason', async () => {
  const pending = deferred();
  let sessionSignal;
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt, {
    async read({ descriptor, facts }) {
      sessionSignal = descriptor.signal;
      await pending.promise;
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
  });
  const controller = new AbortController();
  const { authorities } = controlledAdapters(harness, now, controller);
  const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.firestore[0];
  const active = authorities.firestore[call.kind](
    directContext('firestore', 0, controller.signal, operationCapability()),
  );
  await Promise.resolve();
  await Promise.resolve();
  const privateReason = Object.freeze({ private_key: 'must-not-cross' });
  controller.abort(privateReason);
  assert.equal(sessionSignal.aborted, true);
  assert.notEqual(sessionSignal.reason, privateReason);
  adapterError(sessionSignal.reason);
  pending.resolve();
  await assert.rejects(withDeadline(active, 'root-aborted source read'), adapterError);
  await closeAllAuthorities(authorities);
});

test('read dispatch rechecks abort, source close, and expiry in its final microtask', async (t) => {
  for (const boundary of ['root abort', 'request abort', 'source close', 'expiry']) {
    await t.test(boundary, async () => {
      const now = { value: 100_000 };
      const expiresAt = now.value
        + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
      const harness = createSessionHarness(expiresAt);
      const rootController = new AbortController();
      const requestController = boundary === 'request abort'
        ? new AbortController()
        : rootController;
      const { authorities } = controlledAdapters(harness, now, rootController);
      const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.coordinator[0];
      const active = authorities.coordinator[call.kind](
        directContext(
          'coordinator',
          0,
          requestController.signal,
          operationCapability(),
        ),
      );

      // performRead has crossed its outer checks and queued the session callback.
      await Promise.resolve();
      let closing;
      if (boundary === 'root abort') rootController.abort(new Error('private root reason'));
      if (boundary === 'request abort') {
        requestController.abort(new Error('private request reason'));
      }
      if (boundary === 'source close') {
        closing = authorities.coordinator.close();
        void closing.catch(() => undefined);
      }
      if (boundary === 'expiry') now.value = expiresAt;

      await assert.rejects(withDeadline(active, `${boundary} pre-dispatch read`), adapterError);
      assert.equal(harness.metrics.reads.length, 0);
      if (closing !== undefined) await assert.rejects(closing, adapterError);
      await closeAllAuthorities(authorities);
    });
  }
});

test('expiry during settlement suppresses otherwise valid source output', async () => {
  const pending = deferred();
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt, {
    async read({ descriptor, facts }) {
      await pending.promise;
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
  });
  const { authorities, controller } = controlledAdapters(harness, now);
  const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.kms[0];
  const active = authorities.kms[call.kind](
    directContext('kms', 0, controller.signal, operationCapability()),
  );
  await Promise.resolve();
  now.value = expiresAt;
  pending.resolve();
  await assert.rejects(withDeadline(active, 'expired source read'), adapterError);
  await closeAllAuthorities(authorities);
});

test('read timeout is bounded and permanently poisons all adapters', async () => {
  const timerCallbacks = [];
  const readRelease = deferred();
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt, {
    async read() {
      await readRelease.promise;
    },
  });
  const { authorities, controller } = controlledAdapters(harness, now, undefined, {
    set_timer(callback) {
      timerCallbacks.push(callback);
      return Object.freeze({ index: timerCallbacks.length });
    },
    clear_timer() {},
  });
  const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.hosting[0];
  const active = authorities.hosting[call.kind](
    directContext('hosting', 0, controller.signal, operationCapability()),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timerCallbacks.length, 1);
  timerCallbacks[0]();
  await assert.rejects(withDeadline(active, 'timed-out source read'), adapterError);
  const peer = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.coordinator[0];
  await assert.rejects(
    authorities.coordinator[peer.kind](
      directContext('coordinator', 0, controller.signal, operationCapability()),
    ),
    adapterError,
  );
  readRelease.resolve();
  await closeAllAuthorities(authorities);
});

test('close drains a late timed-out read before invoking or releasing its session', async () => {
  const timers = [];
  const readStarted = deferred();
  const readRelease = deferred();
  let readSettled = false;
  let closeSawSettledRead = false;
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt, {
    async read({ descriptor, facts }) {
      readStarted.resolve();
      await readRelease.promise;
      readSettled = true;
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
    close({ source }) {
      if (source === 'coordinator') closeSawSettledRead = readSettled;
    },
  });
  const { authorities, controller } = controlledAdapters(
    harness,
    now,
    undefined,
    {
      set_timer(callback, milliseconds) {
        const timer = { callback, milliseconds, cleared: false };
        timers.push(timer);
        return timer;
      },
      clear_timer(timer) {
        timer.cleared = true;
      },
    },
  );
  const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.coordinator[0];
  const active = authorities.coordinator[call.kind](
    directContext('coordinator', 0, controller.signal, operationCapability()),
  );
  await readStarted.promise;
  const readTimer = timers.at(-1);
  readTimer.callback();
  await assert.rejects(withDeadline(active, 'timed-out finite read'), adapterError);

  const closing = authorities.coordinator.close();
  void closing.catch(() => undefined);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.metrics.closes.includes('coordinator'), false);
  assert.equal(harness.metrics.releases.includes('coordinator'), false);

  readRelease.resolve();
  await assert.rejects(withDeadline(closing, 'drained timed-out read close'), adapterError);
  assert.equal(closeSawSettledRead, true);
  assert.equal(harness.metrics.closes.filter((source) => source === 'coordinator').length, 1);
  assert.equal(harness.metrics.releases.filter((source) => source === 'coordinator').length, 1);
  await closeAllAuthorities(authorities);
});

test('uncooperative timed-out read quarantines close without overlap or release', async () => {
  const timers = [];
  const readStarted = deferred();
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt, {
    async read() {
      readStarted.resolve();
      await new Promise(() => {});
    },
  });
  const { authorities, controller } = controlledAdapters(
    harness,
    now,
    undefined,
    {
      set_timer(callback, milliseconds) {
        const timer = { callback, milliseconds, cleared: false };
        timers.push(timer);
        return timer;
      },
      clear_timer(timer) {
        timer.cleared = true;
      },
    },
  );
  const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.coordinator[0];
  const active = authorities.coordinator[call.kind](
    directContext('coordinator', 0, controller.signal, operationCapability()),
  );
  await readStarted.promise;
  timers.at(-1).callback();
  await assert.rejects(withDeadline(active, 'uncooperative timed-out read'), adapterError);

  const closing = authorities.coordinator.close();
  await Promise.resolve();
  const publicCloseTimer = timers.at(-1);
  publicCloseTimer.callback();
  await assert.rejects(withDeadline(closing, 'quarantined source close'), adapterError);
  assert.equal(publicCloseTimer.cleared, true);
  assert.equal(harness.metrics.closes.includes('coordinator'), false);
  assert.equal(harness.metrics.releases.includes('coordinator'), false);
});

test('root abort and expiry during session close suppress successful settlement', async (t) => {
  for (const boundary of ['abort', 'expiry']) {
    await t.test(boundary, async () => {
      const closeStarted = deferred();
      const closeRelease = deferred();
      const now = { value: 100_000 };
      const expiresAt = now.value
        + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
      const harness = createSessionHarness(expiresAt, {
        async close({ source, signal }) {
          if (source === 'coordinator') {
            closeStarted.resolve(signal);
            await closeRelease.promise;
          }
        },
      });
      const controller = new AbortController();
      const { authorities } = controlledAdapters(harness, now, controller);
      await completeSourceAuthority(
        authorities,
        'coordinator',
        controller.signal,
      );
      const closing = authorities.coordinator.close();
      const closeSignal = await closeStarted.promise;
      let closingSettled = false;
      void closing.finally(() => { closingSettled = true; }).catch(() => undefined);
      if (boundary === 'abort') {
        const privateReason = Object.freeze({ access_token: 'must-not-cross' });
        controller.abort(privateReason);
      } else {
        now.value = expiresAt;
      }
      await Promise.resolve();
      assert.equal(closeSignal.aborted, false);
      assert.equal(closingSettled, false);
      assert.equal(harness.metrics.releases.includes('coordinator'), false);
      closeRelease.resolve();
      await assert.rejects(
        withDeadline(closing, `${boundary} source close`),
        adapterError,
      );
      assert.equal(closeSignal.aborted, true);
      adapterError(closeSignal.reason);
      assert.equal(harness.metrics.releases.includes('coordinator'), true);
      await closeAllAuthorities(authorities);
    });
  }
});

test('close timeout is bounded, revokes its signal, and clears the captured session', async () => {
  const timers = [];
  const closeStarted = deferred();
  const closeRelease = deferred();
  const sessionReleased = deferred();
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt, {
    async close({ source, signal }) {
      if (source === 'coordinator') {
        closeStarted.resolve(signal);
        await closeRelease.promise;
      }
    },
  });
  const timerHooks = {
    set_timer(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clear_timer(timer) {
      timer.cleared = true;
    },
    session_released(source) {
      if (source === 'coordinator') sessionReleased.resolve();
    },
  };
  const { authorities, controller } = controlledAdapters(
    harness,
    now,
    undefined,
    timerHooks,
  );
  await completeSourceAuthority(authorities, 'coordinator', controller.signal);
  const closing = authorities.coordinator.close();
  const closeSignal = await closeStarted.promise;
  const [publicCloseTimer, sessionCloseTimer] = timers.slice(-2);
  assert.equal(
    publicCloseTimer.milliseconds,
    SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_CLOSE_MILLISECONDS,
  );
  assert.equal(
    sessionCloseTimer.milliseconds,
    SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_CLOSE_MILLISECONDS,
  );
  publicCloseTimer.callback();
  sessionCloseTimer.callback();
  await assert.rejects(withDeadline(closing, 'timed-out source close'), adapterError);
  assert.equal(publicCloseTimer.cleared, true);
  assert.equal(sessionCloseTimer.cleared, false);
  assert.equal(closeSignal.aborted, true);
  adapterError(closeSignal.reason);
  assert.deepEqual(harness.metrics.releases, []);
  closeRelease.resolve();
  await withDeadline(sessionReleased.promise, 'late session release');
  assert.equal(sessionCloseTimer.cleared, true);
  assert.deepEqual(harness.metrics.releases, ['coordinator']);
  await closeAllAuthorities(authorities);
  assert.equal(harness.metrics.closes.filter((source) => source === 'coordinator').length, 1);
  assert.equal(harness.metrics.releases.filter((source) => source === 'coordinator').length, 1);
});

test('session callbacks cannot reenter read or close', async (t) => {
  for (const target of ['read close', 'close close']) {
    await t.test(target, async () => {
      let authorities;
      const now = { value: 100_000 };
      const expiresAt = now.value
        + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
      const hooks = target === 'read close'
        ? {
            async read({ descriptor, facts }) {
              await assert.rejects(authorities.firebase_app_check.close(), adapterError);
              return { handled: true, value: candidateObservation(facts, descriptor) };
            },
          }
        : {
            async close({ source }) {
              if (source === 'firebase_app_check') {
                await assert.rejects(authorities.firebase_app_check.close(), adapterError);
              }
            },
          };
      const harness = createSessionHarness(expiresAt, hooks);
      const controlled = controlledAdapters(harness, now);
      authorities = controlled.authorities;
      if (target === 'read close') {
        const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.firebase_app_check[0];
        await assert.rejects(
          authorities.firebase_app_check[call.kind](
            directContext(
              'firebase_app_check',
              0,
              controlled.controller.signal,
              operationCapability(),
            ),
          ),
          adapterError,
        );
      }
      const results = await closeAllAuthorities(authorities);
      assert.equal(results.every(({ status }) => status === 'rejected'), true);
    });
  }
});

test('successful terminal close releases every captured session exactly once', async () => {
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt);
  const { authorities, controller } = controlledAdapters(harness, now);
  await completeAuthorities(authorities, controller.signal);
  const results = await closeAllAuthorities(authorities);
  assert.equal(results.every(({ status }) => status === 'fulfilled'), true);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER].sort(),
  );
  assert.equal(new Set(harness.metrics.closes).size, 7);
  assert.equal(new Set(harness.metrics.releases).size, 7);
  const second = await closeAllAuthorities(authorities);
  assert.equal(second.every(({ status }) => status === 'rejected'), true);
  assert.equal(harness.metrics.closes.length, 7);
  assert.equal(harness.metrics.releases.length, 7);
});

test('terminal close releases strong session references', () => {
  const moduleUrl = new URL(
    '../browser-relay-source-authority-adapters/adapters.mjs',
    import.meta.url,
  );
  const contractUrl = new URL(
    '../browser-relay-source-authority-adapters/contract.mjs',
    import.meta.url,
  );
  const script = `
    import { createBrowserRelaySourceAuthorityAdapters } from ${JSON.stringify(moduleUrl.href)};
    import {
      SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
      SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE,
      SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER,
    } from ${JSON.stringify(contractUrl.href)};
    const expiresAt = Date.now()
      + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
    let sessions = Object.fromEntries(SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.map((source) => [
      source,
      Object.freeze({
        source,
        scope: SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE[source],
        expires_at_milliseconds: expiresAt,
        async read() { throw new Error('unused'); },
        async close() {},
      }),
    ]));
    const reference = new WeakRef(sessions.hosting);
    const authorities = createBrowserRelaySourceAuthorityAdapters(
      sessions,
      {
        signal: new AbortController().signal,
        expires_at_milliseconds: expiresAt,
      },
    );
    sessions = undefined;
    await Promise.allSettled(Object.values(authorities).map((authority) => authority.close()));
    for (let index = 0; index < 20; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      globalThis.gc();
      void new Uint8Array(1024 * 1024);
    }
    if (reference.deref() !== undefined) throw new Error('closed adapter retained session');
  `;
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', '--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test('duplicate source close poisons peers after clearing the local session', async () => {
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const harness = createSessionHarness(expiresAt);
  const { authorities, controller } = controlledAdapters(harness, now);
  const capability = operationCapability();
  const source = 'hosting';
  for (let cursor = 0;
    cursor < SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source].length;
    cursor += 1) {
    const call = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source][cursor];
    await authorities[source][call.kind](
      directContext(source, cursor, controller.signal, capability),
    );
  }
  await authorities[source].close();
  await assert.rejects(authorities[source].close(), adapterError);
  const peer = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE.coordinator[0];
  await assert.rejects(
    authorities.coordinator[peer.kind](
      directContext('coordinator', 0, controller.signal, capability),
    ),
    adapterError,
  );
  await closeAllAuthorities(authorities);
  assert.equal(harness.metrics.closes.filter((entry) => entry === source).length, 1);
  assert.equal(harness.metrics.releases.filter((entry) => entry === source).length, 1);
});

test('session close failures and unreviewed return values collapse after invocation', async () => {
  for (const close of [
    () => { throw new Error('private close cause'); },
    () => 'unexpected',
  ]) {
    const now = { value: 100_000 };
    const expiresAt = now.value
      + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
    const harness = createSessionHarness(expiresAt, { close });
    const { authorities, controller } = controlledAdapters(harness, now);
    await completeAuthorities(authorities, controller.signal);
    const results = await closeAllAuthorities(authorities);
    assert.equal(results.every(({ status }) => status === 'rejected'), true);
    assert.deepEqual(
      [...harness.metrics.closes].sort(),
      [...SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER].sort(),
    );
    assert.deepEqual(
      [...harness.metrics.releases].sort(),
      [...SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER].sort(),
    );
  }
});

test('fixed source scopes are deeply frozen and cannot be substituted', () => {
  assert.equal(Object.isFrozen(SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE), true);
  for (const source of SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER) {
    const scope = SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE[source];
    assert.equal(Object.isFrozen(scope), true);
    for (const value of Object.values(scope)) {
      if (value !== null && typeof value === 'object') assert.equal(Object.isFrozen(value), true);
    }
  }
  const clone = cloneFrozen(SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE.relay);
  assert.deepEqual(clone, SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE.relay);
  assert.notEqual(clone, SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE.relay);
});

test('profile, dependency pins, guard, and CLI validate the dormant package', () => {
  assert.match(sourceAuthorityAdaptersDependencyContractsSha256(), /^[0-9a-f]{64}$/u);
  const profile = validateBrowserRelaySourceAuthorityAdaptersProfile();
  assert.equal(
    profile.state,
    'closed_concrete_source_authority_adapters_trusted_session_producers_implemented_not_live_not_wired_not_executed',
  );
  assert.equal(profile.adapter.stage_count, 22);
  assert.equal(profile.adapter.observations_per_matrix, 43);
  assert.equal(profile.adapter.distinct_kind_count, 32);
  assert.equal(profile.adapter.operation_capability_omitted_from_read_descriptor, true);
  assert.equal(profile.adapter.abort_and_expiry_rechecked_at_dispatch, true);
  assert.equal(profile.adapter.bounded_read_and_close_wrapper_settlement, true);
  assert.equal(profile.adapter.close_cleanup_independent_of_operation_cancellation, true);
  assert.equal(profile.adapter.terminal_started_callbacks_settled, true);
  assert.equal(profile.adapter.terminal_adapter_session_references_cleared, true);
  assert.equal(profile.compatibility.concrete_source_authority_adapters_present, true);
  assert.equal(profile.compatibility.source_session_producers_present, true);
  assert.equal(profile.compatibility.network_implementation_present, false);
  assert.equal(profile.compatibility.operation_case_adapter_wired, false);
  assert.equal(
    profile.compatibility.uncooperative_same_process_session_forced_termination,
    false,
  );
  assert.equal(Object.values(profile.authority).every((value) => value === false), true);
  assert.equal(validateBrowserRelaySourceAuthorityAdaptersRoot(PACKAGE_ROOT).schema,
    profile.schema);
  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL(
      '../browser-relay-source-authority-adapters/guard.mjs',
      import.meta.url,
    )),
    fileURLToPath(new URL('../browser-relay-source-authority-adapters/', import.meta.url)),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /concrete source authority adapters remain dormant/u);
});

test('guard rejects inventory, symlink, executable, import, runtime, and profile drift', () => {
  for (const mutate of [
    (root) => writeFileSync(new URL('extra.txt', root), 'extra\n'),
    (root) => {
      rmSync(new URL('README.md', root));
      symlinkSync('profile.json', new URL('README.md', root));
    },
    (root) => chmodSync(new URL('adapters.mjs', root), 0o755),
    (root) => writeFileSync(
      new URL('adapters.mjs', root),
      "import process from 'node:process';\nvoid process.env;\n",
    ),
    (root) => writeFileSync(
      new URL('internal.mjs', root),
      "import {} from './contract.mjs';\nvoid fetch;\n",
    ),
    (root) => {
      const profile = JSON.parse(readFileSync(new URL('profile.json', root), 'utf8'));
      profile.authority.built_in_network_clients_authorized = true;
      writeFileSync(new URL('profile.json', root), `${JSON.stringify(profile, null, 2)}\n`);
    },
  ]) {
    const root = copiedPackageRoot();
    mutate(root);
    assert.throws(() => validateBrowserRelaySourceAuthorityAdaptersRoot(root));
  }
});
