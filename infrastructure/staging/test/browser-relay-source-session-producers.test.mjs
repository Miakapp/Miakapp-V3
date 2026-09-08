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
import process from 'node:process';
import test, { after } from 'node:test';

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
  createSourceAuthorityAdapterReadDescriptor,
} from '../browser-relay-source-authority-adapters/contract.mjs';
import {
  createBrowserRelaySourceAuthorityAdaptersForTest,
} from '../browser-relay-source-authority-adapters/testing.mjs';
import {
  SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE,
  SOURCE_SESSION_PRODUCERS_CLIENT_DESCRIPTOR_FIELDS,
  SOURCE_SESSION_PRODUCERS_CLIENT_FIELDS,
  SOURCE_SESSION_PRODUCERS_DISTINCT_KIND_COUNT,
  SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
  SOURCE_SESSION_PRODUCERS_OBSERVATIONS_PER_MATRIX,
  SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE,
  SOURCE_SESSION_PRODUCERS_SESSION_FIELDS,
  SOURCE_SESSION_PRODUCERS_SOURCE_ORDER,
  SOURCE_SESSION_PRODUCERS_STAGE_COUNT,
  StagingBrowserRelaySourceSessionProducerError,
  sourceSessionProducersDependencyContractsSha256,
  validateBrowserRelaySourceSessionProducersProfile,
} from '../browser-relay-source-session-producers/contract.mjs';
import {
  validateBrowserRelaySourceSessionProducersRoot,
} from '../browser-relay-source-session-producers/guard.mjs';
import {
  createBrowserRelaySourceSessions,
} from '../browser-relay-source-session-producers/producers.mjs';
import {
  createBrowserRelaySourceSessionsForTest,
} from '../browser-relay-source-session-producers/testing.mjs';
import {
  createBrowserRelaySourceTransports,
} from '../browser-relay-source-transports/transports.mjs';
import { fullIndependentFacts } from './helpers/browser-relay-evidence-fixture.mjs';

const PACKAGE_ROOT = new URL(
  '../browser-relay-source-session-producers/',
  import.meta.url,
);
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

function producerError(error) {
  assert.equal(error instanceof StagingBrowserRelaySourceSessionProducerError, true);
  assert.equal(error.name, 'StagingBrowserRelaySourceSessionProducerError');
  assert.equal(
    error.message,
    'Staging browser-relay source session producer failed closed',
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

function createClientHarness(hooks = {}) {
  const facts = fullIndependentFacts();
  const metrics = {
    observations: [],
    closes: [],
    closeSignals: [],
    releases: [],
  };
  const clients = Object.freeze(Object.fromEntries(
    SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.map((source) => [
      source,
      Object.freeze({
        async observe(descriptor) {
          metrics.observations.push({ source, descriptor });
          const result = await hooks.observe?.({ source, descriptor, metrics, facts });
          if (result?.handled === true) return result.value;
          return candidateObservation(facts, descriptor);
        },
        async close(signal) {
          metrics.closes.push(source);
          metrics.closeSignals.push({ source, signal });
          return hooks.close?.({ source, signal, metrics });
        },
      }),
    ]),
  ));
  return { clients, facts, metrics };
}

function controlledSessions(
  harness,
  now,
  controller = new AbortController(),
  runtimeHooks = {},
) {
  const expiresAt = now.value + SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const sessions = createBrowserRelaySourceSessionsForTest(
    harness.clients,
    {
      signal: controller.signal,
      expires_at_milliseconds: expiresAt,
    },
    {
      clock: () => now.value,
      set_timer(callback, milliseconds) {
        if (runtimeHooks.set_timer !== undefined) {
          return runtimeHooks.set_timer(callback, milliseconds);
        }
        return globalThis.setTimeout(callback, milliseconds);
      },
      clear_timer(handle) {
        if (runtimeHooks.clear_timer !== undefined) {
          return runtimeHooks.clear_timer(handle);
        }
        return globalThis.clearTimeout(handle);
      },
      client_released(source) {
        harness.metrics.releases.push(source);
        runtimeHooks.client_released?.(source);
      },
    },
  );
  return { controller, expiresAt, sessions };
}

function directDescriptor(source, cursor, signal) {
  const call = SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE[source][cursor];
  return createSourceAuthorityAdapterReadDescriptor(Object.freeze({
    source,
    browser: call.browser,
    case_id: call.case_id,
    kind: call.kind,
  }), signal);
}

async function completeSource(sessions, source, signal) {
  const observations = [];
  for (let cursor = 0;
    cursor < SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE[source].length;
    cursor += 1) {
    observations.push(await sessions[source].read(directDescriptor(source, cursor, signal)));
  }
  return observations;
}

async function completeSessions(sessions, signal) {
  const observations = [];
  for (const source of SOURCE_SESSION_PRODUCERS_SOURCE_ORDER) {
    observations.push(...await completeSource(sessions, source, signal));
  }
  return observations;
}

async function closeAllSessions(sessions, signal = new AbortController().signal) {
  return Promise.allSettled(
    SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.map((source) => sessions[source].close(signal)),
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

async function runCompleteTransportStack(harness, now, controller) {
  const { expiresAt, sessions } = controlledSessions(harness, now, controller);
  const authorities = createBrowserRelaySourceAuthorityAdaptersForTest(
    sessions,
    {
      signal: controller.signal,
      expires_at_milliseconds: expiresAt,
    },
    {
      clock: () => now.value,
      set_timer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
      clear_timer: (handle) => globalThis.clearTimeout(handle),
      session_released() {},
    },
  );
  const readers = createBrowserRelayAuthenticatedSourceReadersForTest(
    authorities,
    {
      signal: controller.signal,
      expires_at_milliseconds: expiresAt,
    },
    {
      clock: () => now.value,
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
    SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.map((source) => transports[source].close()),
  );
  return observations;
}

function copiedPackageRoot() {
  const parent = mkdtempSync(join(tmpdir(), 'miakapp-source-session-producers-'));
  temporaryRoots.add(parent);
  const root = join(parent, 'package');
  cpSync(PACKAGE_ROOT, root, { recursive: true });
  return new URL(`file://${root}/`);
}

test('all 22 stages and 43 observations cross the complete dormant stack', async () => {
  const now = { value: 1_800_000_000_000 };
  const harness = createClientHarness();
  const controller = new AbortController();
  const observations = await runCompleteTransportStack(harness, now, controller);

  assert.equal(SOURCE_SESSION_PRODUCERS_STAGE_COUNT, 22);
  assert.equal(SOURCE_SESSION_PRODUCERS_OBSERVATIONS_PER_MATRIX, 43);
  assert.equal(SOURCE_SESSION_PRODUCERS_DISTINCT_KIND_COUNT, 32);
  assert.equal(observations.length, 43);
  assert.equal(harness.metrics.observations.length, 43);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_SESSION_PRODUCERS_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...SOURCE_SESSION_PRODUCERS_SOURCE_ORDER].sort(),
  );

  for (const { source, descriptor } of harness.metrics.observations) {
    assert.equal(source, descriptor.source);
    assert.deepEqual(
      Reflect.ownKeys(descriptor).sort(),
      [...SOURCE_SESSION_PRODUCERS_CLIENT_DESCRIPTOR_FIELDS, 'toJSON'].sort(),
    );
    assert.deepEqual(Object.keys(descriptor), SOURCE_SESSION_PRODUCERS_CLIENT_DESCRIPTOR_FIELDS);
    assert.equal(Object.getPrototypeOf(descriptor), null);
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(descriptor.scope, SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE[source]);
    assert.equal(descriptor.signal instanceof AbortSignal, true);
    assert.equal(descriptor.signal.aborted, true);
    producerError(descriptor.signal.reason);
    assert.equal(Object.hasOwn(descriptor, 'operation_capability'), false);
    assert.equal(Object.hasOwn(descriptor, 'credentials'), false);
    assert.equal(Object.hasOwn(descriptor, 'target'), false);
    assert.throws(() => JSON.stringify(descriptor), producerError);
  }
});

test('production and testing factories expose exact isolated session surfaces', async () => {
  assert.equal(createBrowserRelaySourceSessions.length, 2);
  assert.equal(createBrowserRelaySourceSessionsForTest.length, 3);
  const expiresAt = Date.now() + 1_000;
  const harness = createClientHarness();
  const sessions = createBrowserRelaySourceSessions(harness.clients, {
    signal: new AbortController().signal,
    expires_at_milliseconds: expiresAt,
  });
  assert.deepEqual(Reflect.ownKeys(sessions), SOURCE_SESSION_PRODUCERS_SOURCE_ORDER);
  assert.equal(Object.isFrozen(sessions), true);
  assert.equal(new Set(Object.values(sessions)).size, SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.length);
  for (const source of SOURCE_SESSION_PRODUCERS_SOURCE_ORDER) {
    assert.deepEqual(Reflect.ownKeys(sessions[source]), SOURCE_SESSION_PRODUCERS_SESSION_FIELDS);
    assert.equal(Object.isFrozen(sessions[source]), true);
    assert.equal(sessions[source].source, source);
    assert.equal(sessions[source].scope, SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE[source]);
    assert.equal(sessions[source].expires_at_milliseconds, expiresAt);
  }
  const results = await closeAllSessions(sessions);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_SESSION_PRODUCERS_SOURCE_ORDER].sort(),
  );
});

test('construction is lazy and exact client, option, and runtime records fail closed', () => {
  const now = { value: 50_000 };
  const expiresAt = now.value + SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const factory = (clients, options = {
    signal: new AbortController().signal,
    expires_at_milliseconds: expiresAt,
  }, runtime = {
    clock: () => now.value,
    set_timer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clear_timer: (handle) => globalThis.clearTimeout(handle),
    client_released() {},
  }) => (
    createBrowserRelaySourceSessionsForTest(clients, options, runtime)
  );

  for (const mutate of [
    (clients) => { clients.extra = {}; },
    (clients) => { clients[Symbol('extra')] = {}; },
    (clients) => { clients.hosting = clients.firebase_app_check; },
    (clients) => { clients.kms = Object.freeze({ ...clients.kms, extra: true }); },
    (clients) => { clients.relay = { ...clients.relay }; },
    (clients) => {
      const client = { ...clients.control_plane };
      Object.defineProperty(client, 'observe', {
        enumerable: true,
        get() { throw new Error('getter must not run'); },
      });
      clients.control_plane = Object.freeze(client);
    },
  ]) {
    const harness = createClientHarness();
    const clients = { ...harness.clients };
    mutate(clients);
    assert.throws(() => factory(Object.freeze(clients)), producerError);
    assert.deepEqual(harness.metrics.observations, []);
    assert.deepEqual(harness.metrics.closes, []);
  }

  const mutableHarness = createClientHarness();
  assert.throws(() => factory({ ...mutableHarness.clients }), producerError);
  assert.deepEqual(mutableHarness.metrics.observations, []);
  assert.deepEqual(mutableHarness.metrics.closes, []);

  const validClients = () => createClientHarness().clients;
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
  ]) assert.throws(() => factory(validClients(), options), producerError);

  for (const runtime of [
    {},
    {
      clock: () => now.value,
      set_timer() {},
      clear_timer() {},
      client_released() {},
      extra: true,
    },
    { clock: now.value, set_timer() {}, clear_timer() {}, client_released() {} },
    { clock: () => now.value, set_timer: true, clear_timer() {}, client_released() {} },
    { clock: () => now.value, set_timer() {}, clear_timer: true, client_released() {} },
    { clock: () => now.value, set_timer() {}, clear_timer() {}, client_released: true },
    { clock: () => -1, set_timer() {}, clear_timer() {}, client_released() {} },
    { clock: () => 1.5, set_timer() {}, clear_timer() {}, client_released() {} },
  ]) assert.throws(() => factory(validClients(), undefined, runtime), producerError);

  const harness = createClientHarness();
  factory(harness.clients);
  assert.deepEqual(harness.metrics.observations, []);
  assert.deepEqual(harness.metrics.closes, []);
  assert.throws(() => factory(harness.clients), producerError);
});

test('construction uses one option snapshot and claims clients only after validation', async () => {
  const now = { value: 100_000 };
  const expiresAt = now.value + SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
  const root = new AbortController();
  let optionPrototypeReads = 0;
  const unstableOptions = new Proxy({}, {
    getPrototypeOf() {
      optionPrototypeReads += 1;
      if (optionPrototypeReads > 1) throw new Error('options were read twice');
      return Object.prototype;
    },
    ownKeys() {
      return ['signal', 'expires_at_milliseconds'];
    },
    getOwnPropertyDescriptor(_target, key) {
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: key === 'signal' ? root.signal : expiresAt,
      };
    },
  });
  const runtime = {
    clock: () => now.value,
    set_timer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clear_timer: (handle) => globalThis.clearTimeout(handle),
    client_released() {},
  };
  const snapshotHarness = createClientHarness();
  const snapshotSessions = createBrowserRelaySourceSessionsForTest(
    snapshotHarness.clients,
    unstableOptions,
    runtime,
  );
  assert.equal(optionPrototypeReads, 1);
  root.abort(new Error('private root abort'));
  await assert.rejects(
    snapshotSessions.hosting.read(
      directDescriptor('hosting', 0, new AbortController().signal),
    ),
    producerError,
  );
  assert.deepEqual(snapshotHarness.metrics.observations, []);
  await closeAllSessions(snapshotSessions);

  const retryHarness = createClientHarness();
  const retryRoot = new AbortController();
  const retryOptions = {
    signal: retryRoot.signal,
    expires_at_milliseconds: expiresAt,
  };
  let clockCalls = 0;
  assert.throws(() => createBrowserRelaySourceSessionsForTest(
    retryHarness.clients,
    retryOptions,
    {
      clock() {
        clockCalls += 1;
        if (clockCalls === 2) throw new Error('post-input validation failure');
        return now.value;
      },
      set_timer: runtime.set_timer,
      clear_timer: runtime.clear_timer,
      client_released() {},
    },
  ), producerError);
  const recoveredSessions = createBrowserRelaySourceSessionsForTest(
    retryHarness.clients,
    retryOptions,
    runtime,
  );
  const results = await closeAllSessions(recoveredSessions);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.deepEqual(
    [...retryHarness.metrics.closes].sort(),
    [...SOURCE_SESSION_PRODUCERS_SOURCE_ORDER].sort(),
  );
});

test('read descriptors are exact, canonical, and validated without invoking getters', async (t) => {
  for (const variant of [
    'extra',
    'symbol',
    'prototype',
    'getter',
    'wrong source',
    'skipped call',
    'extra argument',
  ]) {
    await t.test(variant, async () => {
      const now = { value: 100_000 };
      const harness = createClientHarness();
      const { sessions, controller } = controlledSessions(harness, now);
      const source = 'firebase_app_check';
      const expected = directDescriptor(source, 0, controller.signal);
      let candidate = expected;
      if (variant === 'extra') {
        candidate = Object.freeze(Object.assign(Object.create(null), expected, { extra: true }));
      } else if (variant === 'symbol') {
        candidate = Object.create(null, Object.getOwnPropertyDescriptors(expected));
        Object.defineProperty(candidate, Symbol('extra'), { value: true });
        Object.freeze(candidate);
      } else if (variant === 'prototype') {
        candidate = Object.freeze({ ...expected });
      } else if (variant === 'getter') {
        const descriptors = Object.getOwnPropertyDescriptors(expected);
        descriptors.kind = {
          configurable: false,
          enumerable: true,
          get() { throw new Error('getter must not run'); },
        };
        candidate = Object.freeze(Object.create(null, descriptors));
      } else if (variant === 'wrong source') {
        const descriptors = Object.getOwnPropertyDescriptors(expected);
        descriptors.source.value = 'hosting';
        candidate = Object.freeze(Object.create(null, descriptors));
      } else if (variant === 'skipped call') {
        candidate = directDescriptor(source, 1, controller.signal);
      }

      const task = variant === 'extra argument'
        ? sessions[source].read(candidate, 'extra')
        : sessions[source].read(candidate);
      await assert.rejects(task, producerError);
      const peer = directDescriptor('hosting', 0, controller.signal);
      await assert.rejects(sessions.hosting.read(peer), producerError);
      await closeAllSessions(sessions);
      assert.deepEqual(harness.metrics.observations, []);
    });
  }
});

test('call order is reserved before await and a source cannot overlap itself', async () => {
  const firstStarted = deferred();
  const firstRelease = deferred();
  let first = true;
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async observe({ descriptor, facts }) {
      if (first) {
        first = false;
        firstStarted.resolve();
        await firstRelease.promise;
      }
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
  });
  const { sessions, controller } = controlledSessions(harness, now);
  const calls = SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE.firebase_app_check;
  const active = sessions.firebase_app_check.read(
    directDescriptor('firebase_app_check', 0, controller.signal),
  );
  await firstStarted.promise;
  await assert.rejects(
    sessions.firebase_app_check.read(
      directDescriptor('firebase_app_check', 1, controller.signal),
    ),
    producerError,
  );
  firstRelease.resolve();
  await assert.rejects(withDeadline(active, 'poisoned overlapping read'), producerError);
  assert.equal(calls.length > 1, true);
  await closeAllSessions(sessions);
});

test('independent sources can dispatch concurrently', async () => {
  const releases = {
    firebase_app_check: deferred(),
    hosting: deferred(),
  };
  const started = {
    firebase_app_check: deferred(),
    hosting: deferred(),
  };
  const starts = [];
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async observe({ source, descriptor, facts }) {
      if (Object.hasOwn(releases, source)) {
        starts.push(source);
        started[source].resolve();
        await releases[source].promise;
      }
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
  });
  const { sessions, controller } = controlledSessions(harness, now);
  const appCheck = sessions.firebase_app_check.read(
    directDescriptor('firebase_app_check', 0, controller.signal),
  );
  const hosting = sessions.hosting.read(directDescriptor('hosting', 0, controller.signal));
  await Promise.all([
    withDeadline(started.firebase_app_check.promise, 'App Check concurrent dispatch'),
    withDeadline(started.hosting.promise, 'Hosting concurrent dispatch'),
  ]);
  assert.deepEqual([...starts].sort(), ['firebase_app_check', 'hosting']);
  releases.firebase_app_check.resolve();
  releases.hosting.resolve();
  await Promise.all([appCheck, hosting]);
  await closeAllSessions(sessions);
});

test('client errors, malformed output, private material, and semantic drift collapse', async () => {
  for (const observe of [
    () => { throw new TypeError('private synchronous cause'); },
    async () => Promise.reject(new Error('private asynchronous cause')),
    () => ({ handled: true, value: {} }),
    ({ descriptor, facts }) => ({
      handled: true,
      value: {
        ...candidateObservation(facts, descriptor),
        access_token: 'must-not-cross',
      },
    }),
  ]) {
    const now = { value: 100_000 };
    const harness = createClientHarness({ observe });
    const { sessions, controller } = controlledSessions(harness, now);
    await assert.rejects(
      sessions.coordinator.read(directDescriptor('coordinator', 0, controller.signal)),
      producerError,
    );
    await closeAllSessions(sessions);
  }
});

test('validated output is a copied frozen projection, never the client identity', async () => {
  let returned;
  const now = { value: 100_000 };
  const harness = createClientHarness({
    observe({ descriptor, facts }) {
      returned = candidateObservation(facts, descriptor);
      return { handled: true, value: returned };
    },
  });
  const { sessions, controller } = controlledSessions(harness, now);
  const output = await sessions.coordinator.read(
    directDescriptor('coordinator', 0, controller.signal),
  );
  assert.notEqual(output, returned);
  assert.equal(Object.isFrozen(output), true);
  const snapshot = structuredClone(output);
  returned[Object.keys(returned)[0]] = 'changed after return';
  assert.deepEqual(output, snapshot);
  await closeAllSessions(sessions);
});

test('root and request aborts suppress output and sanitize client-visible reasons', async (t) => {
  for (const boundary of ['root', 'request']) {
    await t.test(boundary, async () => {
      const started = deferred();
      const release = deferred();
      let clientSignal;
      const now = { value: 100_000 };
      const harness = createClientHarness({
        async observe({ descriptor, facts }) {
          clientSignal = descriptor.signal;
          started.resolve();
          await release.promise;
          return { handled: true, value: candidateObservation(facts, descriptor) };
        },
      });
      const root = new AbortController();
      const request = boundary === 'request' ? new AbortController() : root;
      const { sessions } = controlledSessions(harness, now, root);
      const active = sessions.firestore.read(
        directDescriptor('firestore', 0, request.signal),
      );
      await started.promise;
      const privateReason = Object.freeze({ private_key: 'must-not-cross' });
      if (boundary === 'root') root.abort(privateReason);
      else request.abort(privateReason);
      assert.equal(clientSignal.aborted, true);
      assert.notEqual(clientSignal.reason, privateReason);
      producerError(clientSignal.reason);
      await assert.rejects(
        sessions.hosting.read(
          directDescriptor('hosting', 0, new AbortController().signal),
        ),
        producerError,
      );
      release.resolve();
      await assert.rejects(withDeadline(active, `${boundary}-aborted read`), producerError);
      await closeAllSessions(sessions);
    });
  }
});

test('read dispatch rechecks abort, source close, and expiry in its final microtask', async (t) => {
  for (const boundary of ['root abort', 'request abort', 'source close', 'expiry']) {
    await t.test(boundary, async () => {
      const now = { value: 100_000 };
      const harness = createClientHarness();
      const root = new AbortController();
      const request = boundary === 'request abort' ? new AbortController() : root;
      const { sessions, expiresAt } = controlledSessions(harness, now, root);
      const active = sessions.coordinator.read(
        directDescriptor('coordinator', 0, request.signal),
      );
      await Promise.resolve();
      let closing;
      if (boundary === 'root abort') root.abort(new Error('private root reason'));
      if (boundary === 'request abort') request.abort(new Error('private request reason'));
      if (boundary === 'source close') {
        closing = sessions.coordinator.close(new AbortController().signal);
        void closing.catch(() => undefined);
      }
      if (boundary === 'expiry') now.value = expiresAt;
      await assert.rejects(withDeadline(active, `${boundary} pre-dispatch read`), producerError);
      assert.equal(harness.metrics.observations.length, 0);
      if (closing !== undefined) await assert.rejects(closing, producerError);
      await closeAllSessions(sessions);
    });
  }
});

test('expiry after dispatch suppresses otherwise valid output', async () => {
  const started = deferred();
  const release = deferred();
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async observe({ descriptor, facts }) {
      started.resolve();
      await release.promise;
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
  });
  const { sessions, controller, expiresAt } = controlledSessions(harness, now);
  const active = sessions.kms.read(directDescriptor('kms', 0, controller.signal));
  await started.promise;
  now.value = expiresAt;
  release.resolve();
  await assert.rejects(withDeadline(active, 'expired client read'), producerError);
  await closeAllSessions(sessions);
});

test('absolute expiry aborts the active client signal without false settlement', async () => {
  const started = deferred();
  const release = deferred();
  let clientSignal;
  let expiryTimer;
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async observe({ descriptor, facts }) {
      clientSignal = descriptor.signal;
      started.resolve();
      await release.promise;
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
  });
  const controlled = controlledSessions(harness, now, undefined, {
    set_timer(callback, milliseconds) {
      expiryTimer = { callback, milliseconds, cleared: false };
      return expiryTimer;
    },
    clear_timer(handle) {
      handle.cleared = true;
    },
  });
  const active = controlled.sessions.coordinator.read(
    directDescriptor('coordinator', 0, controlled.controller.signal),
  );
  await started.promise;
  assert.equal(
    expiryTimer.milliseconds,
    SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
  );
  now.value = controlled.expiresAt;
  expiryTimer.callback();
  assert.equal(clientSignal.aborted, true);
  producerError(clientSignal.reason);
  let settled = false;
  void active.finally(() => { settled = true; }).catch(() => undefined);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  await assert.rejects(
    controlled.sessions.hosting.read(
      directDescriptor('hosting', 0, controlled.controller.signal),
    ),
    producerError,
  );
  release.resolve();
  await assert.rejects(withDeadline(active, 'expired quarantined callback'), producerError);
  assert.equal(expiryTimer.cleared, true);
  await closeAllSessions(controlled.sessions);
});

test('close drains a finite late observation before invoking or releasing the client', async () => {
  const started = deferred();
  const release = deferred();
  let observationSettled = false;
  let closeSawSettledObservation = false;
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async observe({ descriptor, facts }) {
      started.resolve();
      await release.promise;
      observationSettled = true;
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
    close({ source }) {
      if (source === 'coordinator') closeSawSettledObservation = observationSettled;
    },
  });
  const { sessions, controller } = controlledSessions(harness, now);
  const active = sessions.coordinator.read(
    directDescriptor('coordinator', 0, controller.signal),
  );
  await started.promise;
  controller.abort(new Error('private abort reason'));
  const closing = sessions.coordinator.close(new AbortController().signal);
  void closing.catch(() => undefined);
  await Promise.resolve();
  assert.equal(harness.metrics.closes.includes('coordinator'), false);
  assert.equal(harness.metrics.releases.includes('coordinator'), false);
  release.resolve();
  await assert.rejects(withDeadline(active, 'late observation'), producerError);
  await assert.rejects(withDeadline(closing, 'drained client close'), producerError);
  assert.equal(closeSawSettledObservation, true);
  assert.equal(harness.metrics.closes.filter((source) => source === 'coordinator').length, 1);
  assert.equal(harness.metrics.releases.filter((source) => source === 'coordinator').length, 1);
  await closeAllSessions(sessions);
});

test('client cleanup signal is isolated from operation abort and shared poison', async () => {
  const closeStarted = deferred();
  const closeRelease = deferred();
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async close({ source, signal }) {
      if (source === 'coordinator') {
        closeStarted.resolve(signal);
        await closeRelease.promise;
      }
    },
  });
  const root = new AbortController();
  const { sessions } = controlledSessions(harness, now, root);
  await completeSource(sessions, 'coordinator', root.signal);
  const cleanup = new AbortController();
  const closing = sessions.coordinator.close(cleanup.signal);
  const clientSignal = await closeStarted.promise;
  root.abort(Object.freeze({ refresh_token: 'must-not-cross' }));
  await Promise.resolve();
  assert.equal(clientSignal.aborted, false);
  cleanup.abort(Object.freeze({ access_token: 'must-not-cross' }));
  assert.equal(clientSignal.aborted, true);
  producerError(clientSignal.reason);
  closeRelease.resolve();
  await assert.rejects(withDeadline(closing, 'isolated client close'), producerError);
  await closeAllSessions(sessions);
});

test('cleanup cancellation is sanitized and suppresses a successful client close', async () => {
  const closeStarted = deferred();
  const closeRelease = deferred();
  let clientSignal;
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async close({ source, signal }) {
      if (source === 'coordinator') {
        clientSignal = signal;
        closeStarted.resolve();
        await closeRelease.promise;
      }
    },
  });
  const { sessions, controller } = controlledSessions(harness, now);
  await completeSource(sessions, 'coordinator', controller.signal);
  const cleanup = new AbortController();
  const closing = sessions.coordinator.close(cleanup.signal);
  await closeStarted.promise;
  const privateReason = Object.freeze({ secret_value: 'must-not-cross' });
  cleanup.abort(privateReason);
  assert.equal(clientSignal.aborted, true);
  assert.notEqual(clientSignal.reason, privateReason);
  producerError(clientSignal.reason);
  closeRelease.resolve();
  await assert.rejects(withDeadline(closing, 'cancelled client close'), producerError);
  assert.equal(harness.metrics.releases.includes('coordinator'), true);
  await closeAllSessions(sessions);
});

test('cleanup cancellation never skips or falsely releases the client close', async (t) => {
  await t.test('already aborted before close remains retryable', async () => {
    const now = { value: 100_000 };
    const harness = createClientHarness();
    const { sessions, controller } = controlledSessions(harness, now);
    await completeSource(sessions, 'coordinator', controller.signal);
    const aborted = new AbortController();
    aborted.abort(new Error('private cleanup reason'));
    await assert.rejects(sessions.coordinator.close(aborted.signal), producerError);
    assert.equal(harness.metrics.closes.includes('coordinator'), false);
    assert.equal(harness.metrics.releases.includes('coordinator'), false);
    await assert.rejects(
      sessions.coordinator.close(new AbortController().signal),
      producerError,
    );
    assert.equal(
      harness.metrics.closes.filter((source) => source === 'coordinator').length,
      1,
    );
    assert.equal(
      harness.metrics.releases.filter((source) => source === 'coordinator').length,
      1,
    );
    await closeAllSessions(sessions);
  });

  await t.test('abort before callback dispatch still invokes close once', async () => {
    const now = { value: 100_000 };
    const harness = createClientHarness();
    const { sessions, controller } = controlledSessions(harness, now);
    await completeSource(sessions, 'coordinator', controller.signal);
    const cleanup = new AbortController();
    const closing = sessions.coordinator.close(cleanup.signal);
    cleanup.abort(new Error('private cleanup reason'));
    await assert.rejects(withDeadline(closing, 'pre-dispatch cleanup abort'), producerError);
    assert.equal(
      harness.metrics.closes.filter((source) => source === 'coordinator').length,
      1,
    );
    assert.equal(
      harness.metrics.releases.filter((source) => source === 'coordinator').length,
      1,
    );
    const [{ signal }] = harness.metrics.closeSignals.filter(
      ({ source }) => source === 'coordinator',
    );
    assert.equal(signal.aborted, true);
    producerError(signal.reason);
    await closeAllSessions(sessions);
  });
});

test('client callbacks cannot reenter session close', async (t) => {
  for (const target of ['observe close', 'close close']) {
    await t.test(target, async () => {
      let sessions;
      const now = { value: 100_000 };
      const hooks = target === 'observe close'
        ? {
            async observe({ descriptor, facts }) {
              await assert.rejects(
                sessions.firebase_app_check.close(new AbortController().signal),
                producerError,
              );
              return { handled: true, value: candidateObservation(facts, descriptor) };
            },
          }
        : {
            async close({ source }) {
              if (source === 'firebase_app_check') {
                await assert.rejects(
                  sessions.firebase_app_check.close(new AbortController().signal),
                  producerError,
                );
              }
            },
          };
      const harness = createClientHarness(hooks);
      const controlled = controlledSessions(harness, now);
      sessions = controlled.sessions;
      if (target === 'observe close') {
        await assert.rejects(
          sessions.firebase_app_check.read(
            directDescriptor('firebase_app_check', 0, controlled.controller.signal),
          ),
          producerError,
        );
      }
      const results = await closeAllSessions(sessions);
      assert.equal(results.every(({ status }) => status === 'rejected'), true);
    });
  }
});

test('foreign thenables preserve callback context for reentrant operations', async (t) => {
  for (const target of ['then getter peer read', 'then method same close']) {
    await t.test(target, async () => {
      let sessions;
      let reentrantTask;
      const now = { value: 100_000 };
      const base = createClientHarness();
      const coordinator = Object.freeze({
        observe(descriptor) {
          base.metrics.observations.push({ source: 'coordinator', descriptor });
          const observation = candidateObservation(base.facts, descriptor);
          const reenter = () => {
            reentrantTask = target === 'then getter peer read'
              ? sessions.hosting.read(
                  directDescriptor('hosting', 0, new AbortController().signal),
                )
              : sessions.coordinator.close(new AbortController().signal);
            return reentrantTask;
          };
          if (target === 'then getter peer read') {
            return Object.create(null, {
              then: {
                configurable: false,
                enumerable: true,
                get() {
                  const task = reenter();
                  return (resolve, rejectPromise) => task.then(
                    () => resolve(observation),
                    rejectPromise,
                  );
                },
              },
            });
          }
          return {
            then(resolve, rejectPromise) {
              reenter().then(() => resolve(observation), rejectPromise);
            },
          };
        },
        close(signal) {
          base.metrics.closes.push('coordinator');
          base.metrics.closeSignals.push({ source: 'coordinator', signal });
        },
      });
      const harness = {
        ...base,
        clients: Object.freeze({ ...base.clients, coordinator }),
      };
      const controlled = controlledSessions(harness, now);
      sessions = controlled.sessions;
      const active = sessions.coordinator.read(
        directDescriptor('coordinator', 0, controlled.controller.signal),
      );
      await assert.rejects(withDeadline(active, `${target} observation`), producerError);
      await assert.rejects(withDeadline(reentrantTask, `${target} reentry`), producerError);
      assert.equal(
        base.metrics.observations.some(({ source }) => source === 'hosting'),
        false,
      );
      await closeAllSessions(sessions);
    });
  }

  await t.test('client signal listener cannot read a peer during release', async () => {
    let sessions;
    let peerRead;
    const now = { value: 100_000 };
    const base = createClientHarness();
    const coordinator = Object.freeze({
      observe(descriptor) {
        base.metrics.observations.push({ source: 'coordinator', descriptor });
        descriptor.signal.addEventListener('abort', () => {
          peerRead = sessions.hosting.read(
            directDescriptor('hosting', 0, new AbortController().signal),
          );
        }, { once: true });
        return candidateObservation(base.facts, descriptor);
      },
      close(signal) {
        base.metrics.closes.push('coordinator');
        base.metrics.closeSignals.push({ source: 'coordinator', signal });
      },
    });
    const harness = {
      ...base,
      clients: Object.freeze({ ...base.clients, coordinator }),
    };
    const controlled = controlledSessions(harness, now);
    sessions = controlled.sessions;
    await assert.rejects(
      sessions.coordinator.read(
        directDescriptor('coordinator', 0, controlled.controller.signal),
      ),
      producerError,
    );
    await assert.rejects(withDeadline(peerRead, 'signal-listener peer read'), producerError);
    assert.equal(
      base.metrics.observations.some(({ source }) => source === 'hosting'),
      false,
    );
    await closeAllSessions(sessions);
  });

  await t.test('client close thenable cannot read a peer', async () => {
    let sessions;
    let peerRead;
    const now = { value: 100_000 };
    const base = createClientHarness();
    const coordinator = Object.freeze({
      observe(descriptor) {
        base.metrics.observations.push({ source: 'coordinator', descriptor });
        return candidateObservation(base.facts, descriptor);
      },
      close(signal) {
        base.metrics.closes.push('coordinator');
        base.metrics.closeSignals.push({ source: 'coordinator', signal });
        return {
          then(resolve, rejectPromise) {
            peerRead = sessions.hosting.read(
              directDescriptor('hosting', 0, new AbortController().signal),
            );
            peerRead.then(resolve, rejectPromise);
          },
        };
      },
    });
    const harness = {
      ...base,
      clients: Object.freeze({ ...base.clients, coordinator }),
    };
    const controlled = controlledSessions(harness, now);
    sessions = controlled.sessions;
    await completeSource(sessions, 'coordinator', controlled.controller.signal);
    await assert.rejects(
      withDeadline(
        sessions.coordinator.close(new AbortController().signal),
        'foreign close thenable',
      ),
      producerError,
    );
    await assert.rejects(withDeadline(peerRead, 'foreign close peer read'), producerError);
    assert.equal(
      base.metrics.observations.some(({ source }) => source === 'hosting'),
      false,
    );
    assert.equal(
      base.metrics.closes.filter((source) => source === 'coordinator').length,
      1,
    );
    await closeAllSessions(sessions);
  });
});

test('successful terminal close releases every captured client exactly once', async () => {
  const now = { value: 100_000 };
  const harness = createClientHarness();
  const { sessions, controller } = controlledSessions(harness, now);
  const observations = await completeSessions(sessions, controller.signal);
  assert.equal(observations.length, SOURCE_SESSION_PRODUCERS_OBSERVATIONS_PER_MATRIX);
  const results = await closeAllSessions(sessions);
  assert.equal(results.every(({ status }) => status === 'fulfilled'), true);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_SESSION_PRODUCERS_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...SOURCE_SESSION_PRODUCERS_SOURCE_ORDER].sort(),
  );
  assert.equal(new Set(harness.metrics.closes).size, 7);
  assert.equal(new Set(harness.metrics.releases).size, 7);
  const second = await closeAllSessions(sessions);
  assert.equal(second.every(({ status }) => status === 'rejected'), true);
  assert.equal(harness.metrics.closes.length, 7);
  assert.equal(harness.metrics.releases.length, 7);
});

test('duplicate close poisons peers after clearing the local client', async () => {
  const now = { value: 100_000 };
  const harness = createClientHarness();
  const { sessions, controller } = controlledSessions(harness, now);
  await completeSource(sessions, 'hosting', controller.signal);
  await sessions.hosting.close(new AbortController().signal);
  await assert.rejects(
    sessions.hosting.close(new AbortController().signal),
    producerError,
  );
  await assert.rejects(
    sessions.coordinator.read(directDescriptor('coordinator', 0, controller.signal)),
    producerError,
  );
  await closeAllSessions(sessions);
  assert.equal(harness.metrics.closes.filter((source) => source === 'hosting').length, 1);
  assert.equal(harness.metrics.releases.filter((source) => source === 'hosting').length, 1);
});

test('client close failures and unreviewed return values collapse after invocation', async () => {
  for (const close of [
    () => { throw new Error('private close cause'); },
    () => 'unexpected',
  ]) {
    const now = { value: 100_000 };
    const harness = createClientHarness({ close });
    const { sessions, controller } = controlledSessions(harness, now);
    await completeSessions(sessions, controller.signal);
    const results = await closeAllSessions(sessions);
    assert.equal(results.every(({ status }) => status === 'rejected'), true);
    assert.deepEqual(
      [...harness.metrics.closes].sort(),
      [...SOURCE_SESSION_PRODUCERS_SOURCE_ORDER].sort(),
    );
    assert.deepEqual(
      [...harness.metrics.releases].sort(),
      [...SOURCE_SESSION_PRODUCERS_SOURCE_ORDER].sort(),
    );
  }
});

test('an uncooperative observation remains quarantined until actual settlement', async () => {
  const started = deferred();
  const release = deferred();
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async observe({ descriptor, facts }) {
      started.resolve();
      await release.promise;
      return { handled: true, value: candidateObservation(facts, descriptor) };
    },
  });
  const { sessions, controller } = controlledSessions(harness, now);
  const active = sessions.coordinator.read(
    directDescriptor('coordinator', 0, controller.signal),
  );
  await started.promise;
  controller.abort();
  const closing = sessions.coordinator.close(new AbortController().signal);
  let closingSettled = false;
  void closing.finally(() => { closingSettled = true; }).catch(() => undefined);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(closingSettled, false);
  assert.equal(harness.metrics.closes.includes('coordinator'), false);
  assert.equal(harness.metrics.releases.includes('coordinator'), false);
  release.resolve();
  await assert.rejects(withDeadline(active, 'quarantined observation'), producerError);
  await assert.rejects(withDeadline(closing, 'converged observation close'), producerError);
  assert.equal(harness.metrics.closes.includes('coordinator'), true);
  assert.equal(harness.metrics.releases.includes('coordinator'), true);
  await closeAllSessions(sessions);
});

test('an uncooperative client close is not reported released before settlement', async () => {
  const closeStarted = deferred();
  const closeRelease = deferred();
  const released = deferred();
  const now = { value: 100_000 };
  const harness = createClientHarness({
    async close({ source }) {
      if (source === 'coordinator') {
        closeStarted.resolve();
        await closeRelease.promise;
      }
    },
  });
  const { sessions, controller } = controlledSessions(harness, now, undefined, {
    client_released(source) {
      if (source === 'coordinator') released.resolve();
    },
  });
  await completeSource(sessions, 'coordinator', controller.signal);
  const closing = sessions.coordinator.close(new AbortController().signal);
  await closeStarted.promise;
  let releasedEarly = false;
  void released.promise.then(() => { releasedEarly = true; });
  await Promise.resolve();
  assert.equal(releasedEarly, false);
  closeRelease.resolve();
  await withDeadline(closing, 'delayed client close');
  await withDeadline(released.promise, 'delayed client release');
  assert.equal(releasedEarly, true);
  await closeAllSessions(sessions);
});

test('terminal close releases strong client references', () => {
  const moduleUrl = new URL(
    '../browser-relay-source-session-producers/producers.mjs',
    import.meta.url,
  );
  const contractUrl = new URL(
    '../browser-relay-source-session-producers/contract.mjs',
    import.meta.url,
  );
  const script = `
    import { createBrowserRelaySourceSessions } from ${JSON.stringify(moduleUrl.href)};
    import {
      SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
      SOURCE_SESSION_PRODUCERS_SOURCE_ORDER,
    } from ${JSON.stringify(contractUrl.href)};
    const expiresAt = Date.now()
      + SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
    let clients = Object.freeze(Object.fromEntries(
      SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.map((source) => [
        source,
        Object.freeze({
          async observe() { throw new Error('unused'); },
          async close() {},
        }),
      ]),
    ));
    const reference = new WeakRef(clients.hosting);
    const sessions = createBrowserRelaySourceSessions(clients, {
      signal: new AbortController().signal,
      expires_at_milliseconds: expiresAt,
    });
    clients = undefined;
    await Promise.allSettled(
      Object.values(sessions).map((session) => session.close(new AbortController().signal)),
    );
    for (let index = 0; index < 20; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      globalThis.gc();
      void new Uint8Array(1024 * 1024);
    }
    if (reference.deref() !== undefined) throw new Error('closed producer retained client');
  `;
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', '--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test('fixed source scopes are deeply frozen and cannot be substituted', () => {
  assert.equal(Object.isFrozen(SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE), true);
  for (const source of SOURCE_SESSION_PRODUCERS_SOURCE_ORDER) {
    const scope = SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE[source];
    assert.equal(Object.isFrozen(scope), true);
    for (const value of Object.values(scope)) {
      if (value !== null && typeof value === 'object') assert.equal(Object.isFrozen(value), true);
    }
  }
});

test('profile, dependency digest, and structural guard validate the reviewed package', () => {
  assert.match(sourceSessionProducersDependencyContractsSha256(), /^[0-9a-f]{64}$/u);
  const profile = validateBrowserRelaySourceSessionProducersProfile();
  assert.equal(profile.producer.client_map_frozen, true);
  assert.equal(profile.producer.options_snapshotted_once, true);
  assert.equal(profile.producer.client_claim_after_output_validation, true);
  assert.equal(profile.producer.active_request_abort_poisons_shared, true);
  assert.equal(profile.producer.active_expiry_aborts_client_signal, true);
  assert.equal(profile.producer.expiry_timer_races_callback_settlement, false);
  assert.equal(profile.producer.callback_read_reentrancy_rejected, true);
  assert.equal(profile.producer.foreign_thenable_context_preserved, true);
  assert.equal(
    profile.producer.close_started_before_cleanup_abort_invoked_exactly_once,
    true,
  );
  assert.equal(profile.producer.production_timers_intrinsic, true);
  assert.equal(profile.compatibility.trusted_source_session_producers_present, true);
  assert.equal(profile.compatibility.concrete_live_source_clients_present, false);
  assert.equal(profile.compatibility.built_in_network_implementation_present, false);
  assert.equal(profile.compatibility.operation_case_adapter_wired, false);
  assert.equal(profile.evidence.live_execution_count, 0);
  assert.deepEqual(validateBrowserRelaySourceSessionProducersRoot(PACKAGE_ROOT), profile);
});

test('the structural guard rejects inventory, mode, import, source, and profile drift', () => {
  for (const attack of [
    (root) => writeFileSync(new URL('extra.mjs', root), 'export default true;\n'),
    (root) => symlinkSync('README.md', new URL('extra-link', root)),
    (root) => chmodSync(new URL('producers.mjs', root), 0o755),
    (root) => writeFileSync(
      new URL('producers.mjs', root),
      `${readFileSync(new URL('producers.mjs', root), 'utf8')}\nimport 'node:http';\n`,
    ),
    (root) => writeFileSync(
      new URL('internal.mjs', root),
      readFileSync(new URL('internal.mjs', root), 'utf8').replace(
        'const productionRuntime',
        'const fetch = globalThis.fetch;\nconst productionRuntime',
      ),
    ),
    (root) => {
      const profile = JSON.parse(readFileSync(new URL('profile.json', root), 'utf8'));
      profile.evidence.cloud_requests = 1;
      writeFileSync(new URL('profile.json', root), `${JSON.stringify(profile, null, 2)}\n`);
    },
  ]) {
    const root = copiedPackageRoot();
    attack(root);
    assert.throws(() => validateBrowserRelaySourceSessionProducersRoot(root));
  }
});

test('authority method matrix remains aligned with every producer call kind', () => {
  for (const source of SOURCE_SESSION_PRODUCERS_SOURCE_ORDER) {
    const kinds = [...new Set(
      SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE[source].map(({ kind }) => kind),
    )];
    assert.deepEqual(
      SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE[source],
      [...kinds, 'close'],
    );
  }
  assert.deepEqual(SOURCE_SESSION_PRODUCERS_CLIENT_FIELDS, ['observe', 'close']);
});
