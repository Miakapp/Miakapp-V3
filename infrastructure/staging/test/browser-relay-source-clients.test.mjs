import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createSourceAuthorityAdapterReadDescriptor,
} from '../browser-relay-source-authority-adapters/contract.mjs';
import {
  SOURCE_CLIENTS_ACQUIRE_DESCRIPTOR_FIELDS,
  SOURCE_CLIENTS_AUTHORITY_FIELDS,
  SOURCE_CLIENTS_CALLS_BY_SOURCE,
  SOURCE_CLIENTS_CLIENT_DESCRIPTOR_FIELDS,
  SOURCE_CLIENTS_CLIENT_FIELDS,
  SOURCE_CLIENTS_DISTINCT_KIND_COUNT,
  SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
  SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX,
  SOURCE_CLIENTS_RECEIPT_FIELDS,
  SOURCE_CLIENTS_SCOPES_BY_SOURCE,
  SOURCE_CLIENTS_SOURCE_ORDER,
  SOURCE_CLIENTS_STAGE_COUNT,
  SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND,
  StagingBrowserRelaySourceClientError,
  SOURCE_CLIENTS_DEPENDENCY_CONTRACTS_SHA256,
  sourceClientsDependencyContractsSha256,
  validateBrowserRelaySourceClientsProfile,
} from '../browser-relay-source-clients/contract.mjs';
import {
  createBrowserRelaySourceClients,
} from '../browser-relay-source-clients/clients.mjs';
import {
  createBrowserRelaySourceClientsForTest,
} from '../browser-relay-source-clients/testing.mjs';
import {
  validateBrowserRelaySourceClientsRoot,
} from '../browser-relay-source-clients/guard.mjs';
import {
  createSourceSessionProducerClientDescriptor,
} from '../browser-relay-source-session-producers/contract.mjs';
import {
  createBrowserRelaySourceSessionsForTest,
} from '../browser-relay-source-session-producers/testing.mjs';
import { fullIndependentFacts } from './helpers/browser-relay-evidence-fixture.mjs';

const PACKAGE_ROOT = new URL('../browser-relay-source-clients/', import.meta.url);
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

function clientError(error) {
  assert.equal(error instanceof StagingBrowserRelaySourceClientError, true);
  assert.equal(error.name, 'StagingBrowserRelaySourceClientError');
  assert.equal(error.message, 'Staging browser-relay source client failed closed');
  return true;
}

function protocolRecord(fields, ErrorType = StagingBrowserRelaySourceClientError) {
  const value = Object.create(null);
  for (const [key, entry] of Object.entries(fields)) {
    Object.defineProperty(value, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: entry,
    });
  }
  Object.defineProperty(value, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() { throw new ErrorType(); },
  });
  return Object.freeze(value);
}

function copiedPackageRoot() {
  const parent = mkdtempSync(join(tmpdir(), 'miakapp-source-clients-'));
  temporaryRoots.add(parent);
  const root = join(parent, 'package');
  cpSync(PACKAGE_ROOT, root, { recursive: true });
  return new URL(`file://${root}/`);
}

function candidateObservation(facts, descriptor) {
  const fact = facts[descriptor.browser][descriptor.source]
    .find(({ kind }) => kind === descriptor.kind);
  assert.notEqual(fact, undefined);
  return structuredClone(fact.observation);
}

function receiptFor(descriptor, observation) {
  return protocolRecord({
    source: descriptor.source,
    scope: descriptor.scope,
    browser: descriptor.browser,
    case_id: descriptor.case_id,
    kind: descriptor.kind,
    target: descriptor.target,
    request_capability: descriptor.request_capability,
    observation,
  });
}

function createAuthorityHarness({
  hooks = {},
  now = { value: 1_800_000_000_000 },
  expiresAt = now.value + SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
} = {}) {
  const facts = fullIndependentFacts();
  const metrics = {
    acquisitions: [],
    closes: [],
    closeSignals: [],
    releases: [],
  };
  const authorities = Object.freeze(Object.fromEntries(
    SOURCE_CLIENTS_SOURCE_ORDER.map((source) => [
      source,
      Object.freeze({
        source,
        scope: SOURCE_CLIENTS_SCOPES_BY_SOURCE[source],
        expires_at_milliseconds: expiresAt,
        async acquire(descriptor) {
          metrics.acquisitions.push({ source, descriptor });
          const result = await hooks.acquire?.({
            source,
            descriptor,
            facts,
            metrics,
            receipt: (observation = candidateObservation(facts, descriptor)) => (
              receiptFor(descriptor, observation)
            ),
          });
          if (result?.handled === true) return result.value;
          return receiptFor(descriptor, candidateObservation(facts, descriptor));
        },
        async close(signal) {
          metrics.closes.push(source);
          metrics.closeSignals.push({ source, signal });
          return hooks.close?.({ source, signal, metrics });
        },
      }),
    ]),
  ));
  return { authorities, expiresAt, facts, metrics, now };
}

function controlledClients(
  harness,
  controller = new AbortController(),
  runtimeHooks = {},
) {
  const clients = createBrowserRelaySourceClientsForTest(
    harness.authorities,
    { signal: controller.signal },
    {
      clock() {
        if (runtimeHooks.clock !== undefined) return runtimeHooks.clock();
        return harness.now.value;
      },
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
      authority_released(source) {
        harness.metrics.releases.push(source);
        runtimeHooks.authority_released?.(source);
      },
    },
  );
  return { clients, controller };
}

function replaceAuthority(harness, source, overrides) {
  harness.authorities = Object.freeze({
    ...harness.authorities,
    [source]: Object.freeze({
      ...harness.authorities[source],
      ...overrides,
    }),
  });
  return harness;
}

function clientDescriptor(source, cursor, signal) {
  const call = SOURCE_CLIENTS_CALLS_BY_SOURCE[source][cursor];
  return createSourceSessionProducerClientDescriptor(Object.freeze({
    source,
    browser: call.browser,
    case_id: call.case_id,
    kind: call.kind,
  }), signal);
}

async function completeClient(clients, source, signal) {
  const observations = [];
  for (let cursor = 0; cursor < SOURCE_CLIENTS_CALLS_BY_SOURCE[source].length; cursor += 1) {
    observations.push(await clients[source].observe(clientDescriptor(source, cursor, signal)));
  }
  return observations;
}

async function completeClients(clients, signal) {
  const observations = [];
  for (const source of SOURCE_CLIENTS_SOURCE_ORDER) {
    observations.push(...await completeClient(clients, source, signal));
  }
  return observations;
}

async function closeAllClients(clients, signal = new AbortController().signal) {
  return Promise.allSettled(
    SOURCE_CLIENTS_SOURCE_ORDER.map((source) => clients[source].close(signal)),
  );
}

async function completeSessionStack(harness, controller) {
  const { clients } = controlledClients(harness, controller);
  const sessions = createBrowserRelaySourceSessionsForTest(
    clients,
    {
      signal: controller.signal,
      expires_at_milliseconds: harness.expiresAt,
    },
    {
      clock: () => harness.now.value,
      set_timer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
      clear_timer: (handle) => globalThis.clearTimeout(handle),
      client_released() {},
    },
  );
  const observations = [];
  for (const source of SOURCE_CLIENTS_SOURCE_ORDER) {
    for (let cursor = 0; cursor < SOURCE_CLIENTS_CALLS_BY_SOURCE[source].length; cursor += 1) {
      const call = SOURCE_CLIENTS_CALLS_BY_SOURCE[source][cursor];
      const descriptor = createSourceAuthorityAdapterReadDescriptor(Object.freeze({
        source,
        browser: call.browser,
        case_id: call.case_id,
        kind: call.kind,
      }), controller.signal);
      observations.push(await sessions[source].read(descriptor));
    }
  }
  const closes = await Promise.allSettled(
    SOURCE_CLIENTS_SOURCE_ORDER.map((source) => (
      sessions[source].close(new AbortController().signal)
    )),
  );
  return { closes, observations, sessions };
}

test('all 22 stages and 43 observations cross clients into source sessions', async () => {
  const harness = createAuthorityHarness();
  const controller = new AbortController();
  const { closes, observations } = await completeSessionStack(harness, controller);

  assert.equal(SOURCE_CLIENTS_STAGE_COUNT, 22);
  assert.equal(SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX, 43);
  assert.equal(SOURCE_CLIENTS_DISTINCT_KIND_COUNT, 32);
  assert.equal(observations.length, 43);
  assert.equal(harness.metrics.acquisitions.length, 43);
  assert.equal(closes.every(({ status }) => status === 'fulfilled'), true);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_CLIENTS_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...SOURCE_CLIENTS_SOURCE_ORDER].sort(),
  );

  const capabilities = new Set();
  for (const { source, descriptor } of harness.metrics.acquisitions) {
    assert.deepEqual(
      Reflect.ownKeys(descriptor).sort(),
      [...SOURCE_CLIENTS_ACQUIRE_DESCRIPTOR_FIELDS, 'toJSON'].sort(),
    );
    assert.deepEqual(Object.keys(descriptor), SOURCE_CLIENTS_ACQUIRE_DESCRIPTOR_FIELDS);
    assert.equal(Object.getPrototypeOf(descriptor), null);
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(descriptor.source, source);
    assert.equal(descriptor.scope, SOURCE_CLIENTS_SCOPES_BY_SOURCE[source]);
    assert.equal(
      descriptor.target,
      SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND[source][descriptor.kind],
    );
    assert.equal(Object.getPrototypeOf(descriptor.request_capability), null);
    assert.equal(Object.isFrozen(descriptor.request_capability), true);
    assert.equal(descriptor.signal instanceof AbortSignal, true);
    assert.equal(descriptor.signal.aborted, true);
    clientError(descriptor.signal.reason);
    assert.throws(() => descriptor.request_capability(), clientError);
    assert.throws(() => JSON.stringify(descriptor), clientError);
    capabilities.add(descriptor.request_capability);
  }
  assert.equal(capabilities.size, 43);
});

test('production and testing factories expose exact lazy client surfaces', async () => {
  assert.equal(createBrowserRelaySourceClients.length, 2);
  assert.equal(createBrowserRelaySourceClientsForTest.length, 3);
  const harness = createAuthorityHarness({
    now: { value: Date.now() },
    expiresAt: Date.now() + 1_000,
  });
  const clients = createBrowserRelaySourceClients(harness.authorities, {
    signal: new AbortController().signal,
  });
  assert.deepEqual(Reflect.ownKeys(clients), SOURCE_CLIENTS_SOURCE_ORDER);
  assert.equal(Object.isFrozen(clients), true);
  assert.equal(new Set(Object.values(clients)).size, SOURCE_CLIENTS_SOURCE_ORDER.length);
  for (const source of SOURCE_CLIENTS_SOURCE_ORDER) {
    assert.deepEqual(Reflect.ownKeys(clients[source]), SOURCE_CLIENTS_CLIENT_FIELDS);
    assert.equal(Object.isFrozen(clients[source]), true);
  }
  assert.deepEqual(harness.metrics.acquisitions, []);
  assert.deepEqual(harness.metrics.closes, []);
  const results = await closeAllClients(clients);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_CLIENTS_SOURCE_ORDER].sort(),
  );
});

test('exact authority, option, expiry, and runtime records fail closed', () => {
  const factory = (harness, authorities = harness.authorities, options = {
    signal: new AbortController().signal,
  }, runtime = {
    clock: () => harness.now.value,
    set_timer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clear_timer: (handle) => globalThis.clearTimeout(handle),
    authority_released() {},
  }) => createBrowserRelaySourceClientsForTest(authorities, options, runtime);

  for (const mutate of [
    (authorities) => { authorities.extra = {}; },
    (authorities) => { authorities[Symbol('extra')] = {}; },
    (authorities) => { authorities.hosting = authorities.firebase_app_check; },
    (authorities) => {
      const authority = { ...authorities.firestore };
      delete authority.close;
      authorities.firestore = Object.freeze(authority);
    },
    (authorities) => {
      authorities.coordinator = Object.freeze({
        ...authorities.coordinator,
        source: 'relay',
      });
    },
    (authorities) => {
      authorities.relay = Object.freeze({
        ...authorities.relay,
        scope: { ...authorities.relay.scope },
      });
    },
    (authorities) => {
      authorities.firestore = Object.freeze({
        ...authorities.firestore,
        expires_at_milliseconds: authorities.firestore.expires_at_milliseconds - 1,
      });
    },
    (authorities) => {
      authorities.kms = Object.freeze({ ...authorities.kms, extra: true });
    },
    (authorities) => { authorities.relay = { ...authorities.relay }; },
    (authorities) => {
      const authority = { ...authorities.control_plane };
      Object.defineProperty(authority, 'acquire', {
        enumerable: true,
        get() { throw new Error('getter must not run'); },
      });
      authorities.control_plane = Object.freeze(authority);
    },
  ]) {
    const harness = createAuthorityHarness();
    const authorities = { ...harness.authorities };
    mutate(authorities);
    assert.throws(() => factory(harness, Object.freeze(authorities)), clientError);
    assert.deepEqual(harness.metrics.acquisitions, []);
    assert.deepEqual(harness.metrics.closes, []);
  }

  const mutableHarness = createAuthorityHarness();
  assert.throws(() => factory(mutableHarness, { ...mutableHarness.authorities }), clientError);
  for (const options of [
    {},
    { signal: new AbortController().signal, extra: true },
    { signal: {} },
  ]) {
    const harness = createAuthorityHarness();
    assert.throws(() => factory(harness, harness.authorities, options), clientError);
  }
  for (const runtime of [
    {},
    {
      clock() { return 1; },
      set_timer() { return 1; },
      clear_timer() {},
      authority_released() {},
      extra: true,
    },
    { clock: 1, set_timer() {}, clear_timer() {}, authority_released() {} },
    { clock() { return 1; }, set_timer: true, clear_timer() {}, authority_released() {} },
    { clock() { return 1; }, set_timer() {}, clear_timer: true, authority_released() {} },
    { clock() { return 1; }, set_timer() {}, clear_timer() {}, authority_released: true },
    { clock() { return -1; }, set_timer() {}, clear_timer() {}, authority_released() {} },
    { clock() { return 1.5; }, set_timer() {}, clear_timer() {}, authority_released() {} },
  ]) {
    const harness = createAuthorityHarness();
    assert.throws(
      () => factory(harness, harness.authorities, undefined, runtime),
      clientError,
    );
  }
  for (const expiresAt of [
    1_800_000_000_000,
    1_800_000_000_000 + SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS + 1,
    1_800_000_000_000 + 0.5,
  ]) {
    const harness = createAuthorityHarness({ expiresAt });
    assert.throws(() => factory(harness), clientError);
  }
});

test('construction rejects proxy inputs and claims authorities only after final checks', async () => {
  const snapshotHarness = createAuthorityHarness();
  let optionPrototypeReads = 0;
  const unstableOptions = new Proxy({}, {
    getPrototypeOf() {
      optionPrototypeReads += 1;
      return Object.prototype;
    },
    ownKeys() {
      return ['signal'];
    },
    getOwnPropertyDescriptor() {
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: new AbortController().signal,
      };
    },
  });
  assert.throws(
    () => createBrowserRelaySourceClientsForTest(
      snapshotHarness.authorities,
      unstableOptions,
      {
        clock: () => snapshotHarness.now.value,
        set_timer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
        clear_timer: (handle) => globalThis.clearTimeout(handle),
        authority_released(source) { snapshotHarness.metrics.releases.push(source); },
      },
    ),
    clientError,
  );
  assert.equal(optionPrototypeReads, 0);
  assert.deepEqual(snapshotHarness.metrics.acquisitions, []);
  await closeAllClients(controlledClients(snapshotHarness).clients);

  for (const target of ['authority map', 'authority record']) {
    const proxyHarness = createAuthorityHarness();
    let trapCalls = 0;
    const traps = {
      getPrototypeOf(value) {
        trapCalls += 1;
        return Reflect.getPrototypeOf(value);
      },
      isExtensible(value) {
        trapCalls += 1;
        return Reflect.isExtensible(value);
      },
    };
    let authorities = proxyHarness.authorities;
    if (target === 'authority map') {
      authorities = new Proxy(authorities, traps);
    } else {
      authorities = Object.freeze({
        ...authorities,
        hosting: new Proxy(authorities.hosting, traps),
      });
    }
    assert.throws(
      () => createBrowserRelaySourceClientsForTest(
        authorities,
        { signal: new AbortController().signal },
        {
          clock: () => proxyHarness.now.value,
          set_timer: (callback, milliseconds) => globalThis.setTimeout(
            callback,
            milliseconds,
          ),
          clear_timer: (handle) => globalThis.clearTimeout(handle),
          authority_released() {},
        },
      ),
      clientError,
    );
    assert.equal(trapCalls, 0);
    await closeAllClients(controlledClients(proxyHarness).clients);
  }

  const retryHarness = createAuthorityHarness();
  let clockCalls = 0;
  assert.throws(() => createBrowserRelaySourceClientsForTest(
    retryHarness.authorities,
    { signal: new AbortController().signal },
    {
      clock() {
        clockCalls += 1;
        if (clockCalls === 2) throw new Error('post-input validation failure');
        return retryHarness.now.value;
      },
      set_timer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
      clear_timer: (handle) => globalThis.clearTimeout(handle),
      authority_released() {},
    },
  ), clientError);
  const recovered = controlledClients(retryHarness).clients;
  const results = await closeAllClients(recovered);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.deepEqual(
    [...retryHarness.metrics.closes].sort(),
    [...SOURCE_CLIENTS_SOURCE_ORDER].sort(),
  );
});

test('authority identities are distinct, single-use, and claimed only after validation', async () => {
  const harness = createAuthorityHarness();
  const { clients } = controlledClients(harness);
  assert.throws(() => controlledClients(harness), clientError);
  await closeAllClients(clients);

  const retry = createAuthorityHarness();
  const invalid = { ...retry.authorities };
  invalid.hosting = Object.freeze({ ...invalid.hosting, extra: true });
  assert.throws(
    () => createBrowserRelaySourceClientsForTest(
      Object.freeze(invalid),
      { signal: new AbortController().signal },
      {
        clock: () => retry.now.value,
        set_timer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
        clear_timer: (handle) => globalThis.clearTimeout(handle),
        authority_released() {},
      },
    ),
    clientError,
  );
  const recovered = controlledClients(retry).clients;
  await closeAllClients(recovered);
});

test('client descriptors are exact, canonical, ordered, and getter-free', async (t) => {
  for (const variant of [
    'extra',
    'symbol',
    'prototype',
    'getter',
    'wrong scope',
    'wrong source',
    'skipped call',
    'extra argument',
  ]) {
    await t.test(variant, async () => {
      const harness = createAuthorityHarness();
      const { clients, controller } = controlledClients(harness);
      const source = 'firebase_app_check';
      const expected = clientDescriptor(source, 0, controller.signal);
      let candidate = expected;
      if (variant === 'extra') {
        candidate = protocolRecord({ ...expected, extra: true });
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
      } else if (variant === 'wrong scope') {
        candidate = protocolRecord({ ...expected, scope: { ...expected.scope } });
      } else if (variant === 'wrong source') {
        candidate = protocolRecord({ ...expected, source: 'hosting' });
      } else if (variant === 'skipped call') {
        candidate = clientDescriptor(source, 1, controller.signal);
      }
      const task = variant === 'extra argument'
        ? clients[source].observe(candidate, 'extra')
        : clients[source].observe(candidate);
      await assert.rejects(task, clientError);
      await assert.rejects(
        clients.hosting.observe(clientDescriptor('hosting', 0, controller.signal)),
        clientError,
      );
      await closeAllClients(clients);
      assert.deepEqual(harness.metrics.acquisitions, []);
    });
  }
});

test('proxy records are rejected before traps and nested validation cannot reenter peers', async (t) => {
  await t.test('descriptor proxy', async () => {
    const harness = createAuthorityHarness();
    const { clients, controller } = controlledClients(harness);
    let trapCalls = 0;
    let peer;
    const descriptor = new Proxy(clientDescriptor('coordinator', 0, controller.signal), {
      getPrototypeOf(target) {
        trapCalls += 1;
        peer = clients.hosting.observe(clientDescriptor('hosting', 0, controller.signal));
        return Reflect.getPrototypeOf(target);
      },
    });
    await assert.rejects(clients.coordinator.observe(descriptor), clientError);
    assert.equal(trapCalls, 0);
    assert.equal(peer, undefined);
    assert.deepEqual(harness.metrics.acquisitions, []);
    await closeAllClients(clients);
  });

  await t.test('receipt proxy', async () => {
    let trapCalls = 0;
    let peer;
    let clients;
    let controller;
    const harness = createAuthorityHarness({
      hooks: {
        acquire({ descriptor, facts }) {
          const receipt = receiptFor(descriptor, candidateObservation(facts, descriptor));
          return {
            handled: true,
            value: new Proxy(receipt, {
              getPrototypeOf(target) {
                trapCalls += 1;
                peer = clients.hosting.observe(
                  clientDescriptor('hosting', 0, controller.signal),
                );
                return Reflect.getPrototypeOf(target);
              },
            }),
          };
        },
      },
    });
    controller = new AbortController();
    ({ clients } = controlledClients(harness, controller));
    await assert.rejects(
      clients.coordinator.observe(clientDescriptor('coordinator', 0, controller.signal)),
      clientError,
    );
    assert.equal(trapCalls, 0);
    assert.equal(peer, undefined);
    assert.equal(
      harness.metrics.acquisitions.some(({ source }) => source === 'hosting'),
      false,
    );
    await closeAllClients(clients);
  });

  await t.test('proxied observation', async () => {
    let trapCalls = 0;
    let peerObservation;
    let peerClose;
    let clients;
    let controller;
    const harness = createAuthorityHarness({
      hooks: {
        acquire({ descriptor, facts }) {
          const observation = candidateObservation(facts, descriptor);
          const proxiedObservation = new Proxy(observation, {
            getPrototypeOf(target) {
              trapCalls += 1;
              if (trapCalls === 1) {
                peerObservation = clients.hosting.observe(
                  clientDescriptor('hosting', 0, controller.signal),
                );
                peerClose = clients.hosting.close(new AbortController().signal);
              }
              return Reflect.getPrototypeOf(target);
            },
          });
          return {
            handled: true,
            value: receiptFor(descriptor, proxiedObservation),
          };
        },
      },
    });
    controller = new AbortController();
    ({ clients } = controlledClients(harness, controller));
    await assert.rejects(
      clients.coordinator.observe(clientDescriptor('coordinator', 0, controller.signal)),
      clientError,
    );
    assert.equal(trapCalls > 0, true);
    await assert.rejects(peerObservation, clientError);
    await assert.rejects(peerClose, clientError);
    assert.equal(
      harness.metrics.acquisitions.some(({ source }) => source === 'hosting'),
      false,
    );
    assert.equal(harness.metrics.closes.includes('hosting'), false);
    await closeAllClients(clients);
  });
});

test('call order is reserved before await and one source cannot overlap itself', async () => {
  const started = deferred();
  const release = deferred();
  let first = true;
  const harness = createAuthorityHarness({
    hooks: {
      async acquire({ descriptor, facts }) {
        if (first) {
          first = false;
          started.resolve();
          await release.promise;
        }
        return {
          handled: true,
          value: receiptFor(descriptor, candidateObservation(facts, descriptor)),
        };
      },
    },
  });
  const { clients, controller } = controlledClients(harness);
  const active = clients.firebase_app_check.observe(
    clientDescriptor('firebase_app_check', 0, controller.signal),
  );
  await started.promise;
  await assert.rejects(
    clients.firebase_app_check.observe(
      clientDescriptor('firebase_app_check', 1, controller.signal),
    ),
    clientError,
  );
  release.resolve();
  await assert.rejects(withDeadline(active, 'poisoned overlapping acquire'), clientError);
  await closeAllClients(clients);
});

test('independent sources can acquire concurrently', async () => {
  const releases = {
    firebase_app_check: deferred(),
    hosting: deferred(),
  };
  const started = {
    firebase_app_check: deferred(),
    hosting: deferred(),
  };
  const harness = createAuthorityHarness({
    hooks: {
      async acquire({ source, descriptor, facts }) {
        if (Object.hasOwn(releases, source)) {
          started[source].resolve();
          await releases[source].promise;
        }
        return {
          handled: true,
          value: receiptFor(descriptor, candidateObservation(facts, descriptor)),
        };
      },
    },
  });
  const { clients, controller } = controlledClients(harness);
  const appCheck = clients.firebase_app_check.observe(
    clientDescriptor('firebase_app_check', 0, controller.signal),
  );
  const hosting = clients.hosting.observe(clientDescriptor('hosting', 0, controller.signal));
  await Promise.all([
    withDeadline(started.firebase_app_check.promise, 'App Check concurrent acquire'),
    withDeadline(started.hosting.promise, 'Hosting concurrent acquire'),
  ]);
  releases.firebase_app_check.resolve();
  releases.hosting.resolve();
  await Promise.all([appCheck, hosting]);
  await closeAllClients(clients);
});

test('malformed, unbound, reused, and semantically invalid receipts collapse', async (t) => {
  const variants = {
    'plain object'({ descriptor, facts }) {
      return { ...receiptFor(descriptor, candidateObservation(facts, descriptor)) };
    },
    'missing field'({ descriptor, facts }) {
      const receipt = {
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
      };
      delete receipt.kind;
      return protocolRecord(receipt);
    },
    'extra field'({ descriptor, facts }) {
      return protocolRecord({
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
        extra: true,
      });
    },
    'symbol field'({ descriptor, facts }) {
      const receipt = receiptFor(descriptor, candidateObservation(facts, descriptor));
      const candidate = Object.create(null, Object.getOwnPropertyDescriptors(receipt));
      Object.defineProperty(candidate, Symbol('extra'), {
        configurable: false,
        enumerable: true,
        writable: false,
        value: true,
      });
      return Object.freeze(candidate);
    },
    'accessor field'({ descriptor, facts }) {
      const receipt = receiptFor(descriptor, candidateObservation(facts, descriptor));
      const descriptors = Object.getOwnPropertyDescriptors(receipt);
      descriptors.browser = {
        configurable: false,
        enumerable: true,
        get() { throw new Error('getter must not run'); },
      };
      return Object.freeze(Object.create(null, descriptors));
    },
    'malformed serializer'({ descriptor, facts }) {
      const receipt = receiptFor(descriptor, candidateObservation(facts, descriptor));
      const descriptors = Object.getOwnPropertyDescriptors(receipt);
      descriptors.toJSON.enumerable = true;
      return Object.freeze(Object.create(null, descriptors));
    },
    'wrong source'({ descriptor, facts }) {
      return protocolRecord({
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
        source: 'hosting',
      });
    },
    'wrong browser'({ descriptor, facts }) {
      return protocolRecord({
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
        browser: descriptor.browser === 'chromium' ? 'firefox' : 'chromium',
      });
    },
    'wrong case'({ descriptor, facts }) {
      return protocolRecord({
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
        case_id: 'LIVE-99',
      });
    },
    'wrong kind'({ descriptor, facts }) {
      return protocolRecord({
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
        kind: 'operation_write_summary',
      });
    },
    'cloned target'({ descriptor, facts }) {
      return protocolRecord({
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
        target: { ...descriptor.target },
      });
    },
    'foreign capability'({ descriptor, facts }) {
      const capability = () => {};
      Object.setPrototypeOf(capability, null);
      Object.freeze(capability);
      return protocolRecord({
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
        request_capability: capability,
      });
    },
    'wrong scope'({ descriptor, facts }) {
      return protocolRecord({
        ...receiptFor(descriptor, candidateObservation(facts, descriptor)),
        scope: { ...descriptor.scope },
      });
    },
    'private material'({ descriptor, facts }) {
      return receiptFor(descriptor, {
        ...candidateObservation(facts, descriptor),
        access_token: 'must-not-cross',
      });
    },
    'semantic drift'({ descriptor }) {
      return receiptFor(descriptor, {});
    },
  };
  for (const [name, malformed] of Object.entries(variants)) {
    await t.test(name, async () => {
      const harness = createAuthorityHarness({
        hooks: {
          acquire(context) {
            return { handled: true, value: malformed(context) };
          },
        },
      });
      const { clients, controller } = controlledClients(harness);
      await assert.rejects(
        clients.coordinator.observe(clientDescriptor('coordinator', 0, controller.signal)),
        clientError,
      );
      await closeAllClients(clients);
    });
  }

  let sharedReceipt;
  let calls = 0;
  const harness = createAuthorityHarness({
    hooks: {
      acquire({ descriptor, facts }) {
        calls += 1;
        if (calls === 1) {
          sharedReceipt = receiptFor(descriptor, candidateObservation(facts, descriptor));
        }
        return { handled: true, value: sharedReceipt };
      },
    },
  });
  const { clients, controller } = controlledClients(harness);
  await clients.firebase_app_check.observe(
    clientDescriptor('firebase_app_check', 0, controller.signal),
  );
  await assert.rejects(
    clients.firebase_app_check.observe(
      clientDescriptor('firebase_app_check', 1, controller.signal),
    ),
    clientError,
  );
  await closeAllClients(clients);
});

test('synchronous and asynchronous authority failures collapse and poison peers', async () => {
  for (const variant of ['synchronous', 'asynchronous']) {
    const harness = createAuthorityHarness();
    const acquire = variant === 'synchronous'
      ? function synchronousAcquire(descriptor) {
          harness.metrics.acquisitions.push({ source: 'coordinator', descriptor });
          throw new TypeError('private synchronous cause');
        }
      : async function asynchronousAcquire(descriptor) {
          harness.metrics.acquisitions.push({ source: 'coordinator', descriptor });
          throw new Error('private asynchronous cause');
        };
    replaceAuthority(harness, 'coordinator', {
      acquire,
    });
    const { clients, controller } = controlledClients(harness);
    await assert.rejects(
      clients.coordinator.observe(
        clientDescriptor('coordinator', 0, controller.signal),
      ),
      clientError,
    );
    await assert.rejects(
      clients.hosting.observe(clientDescriptor('hosting', 0, controller.signal)),
      clientError,
    );
    await closeAllClients(clients);
  }
});

test('validated output is a copied frozen projection without envelope material', async () => {
  let returned;
  const harness = createAuthorityHarness({
    hooks: {
      acquire({ descriptor, facts }) {
        returned = candidateObservation(facts, descriptor);
        return { handled: true, value: receiptFor(descriptor, returned) };
      },
    },
  });
  const { clients, controller } = controlledClients(harness);
  const output = await clients.coordinator.observe(
    clientDescriptor('coordinator', 0, controller.signal),
  );
  assert.notEqual(output, returned);
  assert.equal(Object.isFrozen(output), true);
  assert.deepEqual(Reflect.ownKeys(output).sort(), Reflect.ownKeys(returned).sort());
  assert.equal(Object.hasOwn(output, 'target'), false);
  assert.equal(Object.hasOwn(output, 'request_capability'), false);
  const snapshot = structuredClone(output);
  returned[Object.keys(returned)[0]] = 'changed after return';
  assert.deepEqual(output, snapshot);
  await closeAllClients(clients);
});

test('root and request aborts suppress output and sanitize authority-visible reasons', async (t) => {
  for (const boundary of ['root', 'request']) {
    await t.test(boundary, async () => {
      const started = deferred();
      const release = deferred();
      let acquireSignal;
      const harness = createAuthorityHarness({
        hooks: {
          async acquire({ descriptor, facts }) {
            acquireSignal = descriptor.signal;
            started.resolve();
            await release.promise;
            return {
              handled: true,
              value: receiptFor(descriptor, candidateObservation(facts, descriptor)),
            };
          },
        },
      });
      const root = new AbortController();
      const request = new AbortController();
      const { clients } = controlledClients(harness, root);
      const active = clients.coordinator.observe(
        clientDescriptor('coordinator', 0, request.signal),
      );
      await started.promise;
      (boundary === 'root' ? root : request).abort(new Error('private abort reason'));
      assert.equal(acquireSignal.aborted, true);
      clientError(acquireSignal.reason);
      release.resolve();
      await assert.rejects(withDeadline(active, `${boundary} aborted acquire`), clientError);
      await closeAllClients(clients);
    });
  }
});

test('acquire dispatch rechecks abort, source close, and expiry in its final microtask', async (t) => {
  for (const boundary of ['root abort', 'request abort', 'source close', 'expiry']) {
    await t.test(boundary, async () => {
      const harness = createAuthorityHarness();
      const root = new AbortController();
      const request = boundary === 'request abort' ? new AbortController() : root;
      const { clients } = controlledClients(harness, root);
      const active = clients.coordinator.observe(
        clientDescriptor('coordinator', 0, request.signal),
      );
      await Promise.resolve();
      let closing;
      if (boundary === 'root abort') root.abort(new Error('private root reason'));
      if (boundary === 'request abort') request.abort(new Error('private request reason'));
      if (boundary === 'source close') {
        closing = clients.coordinator.close(new AbortController().signal);
        void closing.catch(() => undefined);
      }
      if (boundary === 'expiry') harness.now.value = harness.expiresAt;
      await assert.rejects(
        withDeadline(active, `${boundary} pre-dispatch acquire`),
        clientError,
      );
      assert.deepEqual(harness.metrics.acquisitions, []);
      if (closing !== undefined) await assert.rejects(closing, clientError);
      await closeAllClients(clients);
    });
  }
});

test('expiry after dispatch suppresses a valid authority receipt', async () => {
  const started = deferred();
  const release = deferred();
  const now = { value: 100_000 };
  const harness = createAuthorityHarness({
    now,
    hooks: {
      async acquire({ descriptor, facts }) {
        started.resolve();
        await release.promise;
        return {
          handled: true,
          value: receiptFor(descriptor, candidateObservation(facts, descriptor)),
        };
      },
    },
  });
  const { clients, controller } = controlledClients(harness);
  const active = clients.coordinator.observe(
    clientDescriptor('coordinator', 0, controller.signal),
  );
  await started.promise;
  now.value = harness.expiresAt;
  release.resolve();
  await assert.rejects(withDeadline(active, 'expired acquire'), clientError);
  await closeAllClients(clients);
});

test('absolute expiry aborts a deferred authority without falsely settling or releasing it', async () => {
  const started = deferred();
  const release = deferred();
  let acquireSignal;
  let expiryCallback;
  const timerHandle = Object.freeze({ timer: 'authority-expiry' });
  const cleared = [];
  const now = { value: 100_000 };
  const harness = createAuthorityHarness({
    now,
    hooks: {
      async acquire({ descriptor, facts }) {
        acquireSignal = descriptor.signal;
        started.resolve();
        await release.promise;
        return {
          handled: true,
          value: receiptFor(descriptor, candidateObservation(facts, descriptor)),
        };
      },
    },
  });
  const { clients, controller } = controlledClients(harness, undefined, {
    set_timer(callback, milliseconds) {
      assert.equal(
        milliseconds,
        SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
      );
      expiryCallback = callback;
      return timerHandle;
    },
    clear_timer(handle) {
      cleared.push(handle);
    },
  });
  const active = clients.coordinator.observe(
    clientDescriptor('coordinator', 0, controller.signal),
  );
  const activeRejected = assert.rejects(
    withDeadline(active, 'absolute-expiry acquire'),
    clientError,
  );
  await started.promise;
  now.value = harness.expiresAt;
  expiryCallback();
  assert.equal(acquireSignal.aborted, true);
  clientError(acquireSignal.reason);

  const closing = clients.coordinator.close(new AbortController().signal);
  const closeRejected = assert.rejects(
    withDeadline(closing, 'absolute-expiry close'),
    clientError,
  );
  await Promise.resolve();
  assert.equal(harness.metrics.closes.includes('coordinator'), false);
  assert.equal(harness.metrics.releases.includes('coordinator'), false);
  assert.deepEqual(cleared, []);

  release.resolve();
  await activeRejected;
  await closeRejected;
  assert.deepEqual(cleared, [timerHandle]);
  assert.equal(harness.metrics.closes.includes('coordinator'), true);
  assert.equal(harness.metrics.releases.includes('coordinator'), true);
  await closeAllClients(clients);
});

test('expiry timer setup and cleanup failures poison before output', async (t) => {
  await t.test('setup failure prevents authority dispatch', async () => {
    const harness = createAuthorityHarness();
    const { clients, controller } = controlledClients(harness, undefined, {
      set_timer() {
        throw new Error('private timer setup failure');
      },
    });
    await assert.rejects(
      clients.coordinator.observe(clientDescriptor('coordinator', 0, controller.signal)),
      clientError,
    );
    assert.deepEqual(harness.metrics.acquisitions, []);
    await closeAllClients(clients);
  });

  await t.test('cleanup failure suppresses valid authority output', async () => {
    const harness = createAuthorityHarness();
    const { clients, controller } = controlledClients(harness, undefined, {
      set_timer() {
        return Object.freeze({ timer: 'cleanup-failure' });
      },
      clear_timer() {
        throw new Error('private timer cleanup failure');
      },
    });
    await assert.rejects(
      clients.coordinator.observe(clientDescriptor('coordinator', 0, controller.signal)),
      clientError,
    );
    assert.equal(harness.metrics.acquisitions.length, 1);
    await closeAllClients(clients);
  });
});

test('close drains an active authority callback before invocation and release', async () => {
  const started = deferred();
  const release = deferred();
  const harness = createAuthorityHarness({
    hooks: {
      async acquire({ source, descriptor, facts }) {
        if (source === 'coordinator') {
          started.resolve();
          await release.promise;
        }
        return {
          handled: true,
          value: receiptFor(descriptor, candidateObservation(facts, descriptor)),
        };
      },
    },
  });
  const { clients, controller } = controlledClients(harness);
  const active = clients.coordinator.observe(
    clientDescriptor('coordinator', 0, controller.signal),
  );
  await started.promise;
  const close = clients.coordinator.close(new AbortController().signal);
  await Promise.resolve();
  assert.equal(harness.metrics.closes.includes('coordinator'), false);
  assert.equal(harness.metrics.releases.includes('coordinator'), false);
  release.resolve();
  await assert.rejects(withDeadline(active, 'drained acquire'), clientError);
  await assert.rejects(withDeadline(close, 'draining close'), clientError);
  assert.equal(harness.metrics.closes.includes('coordinator'), true);
  assert.equal(harness.metrics.releases.includes('coordinator'), true);
  await closeAllClients(clients);
});

test('authority cleanup signal is isolated and cancellation is sanitized', async () => {
  const closeStarted = deferred();
  const closeRelease = deferred();
  const harness = createAuthorityHarness({
    hooks: {
      async close({ source, signal }) {
        if (source === 'coordinator') {
          closeStarted.resolve(signal);
          await closeRelease.promise;
        }
      },
    },
  });
  const root = new AbortController();
  const { clients } = controlledClients(harness, root);
  await completeClient(clients, 'coordinator', root.signal);
  const cleanup = new AbortController();
  const closing = clients.coordinator.close(cleanup.signal);
  const authoritySignal = await closeStarted.promise;

  root.abort(Object.freeze({ refresh_token: 'must-not-cross' }));
  await Promise.resolve();
  assert.equal(authoritySignal.aborted, false);

  const privateReason = Object.freeze({ access_token: 'must-not-cross' });
  cleanup.abort(privateReason);
  assert.equal(authoritySignal.aborted, true);
  assert.notEqual(authoritySignal.reason, privateReason);
  clientError(authoritySignal.reason);
  closeRelease.resolve();
  await assert.rejects(withDeadline(closing, 'cancelled authority close'), clientError);
  assert.equal(harness.metrics.releases.includes('coordinator'), true);
  await closeAllClients(clients);
});

test('cleanup cancellation never skips or falsely releases an authority', async (t) => {
  await t.test('already aborted cleanup remains retryable', async () => {
    const harness = createAuthorityHarness();
    const { clients, controller } = controlledClients(harness);
    await completeClient(clients, 'coordinator', controller.signal);
    const aborted = new AbortController();
    aborted.abort(new Error('private cleanup reason'));
    await assert.rejects(clients.coordinator.close(aborted.signal), clientError);
    assert.equal(harness.metrics.closes.includes('coordinator'), false);
    assert.equal(harness.metrics.releases.includes('coordinator'), false);
    await assert.rejects(
      clients.coordinator.close(new AbortController().signal),
      clientError,
    );
    assert.equal(
      harness.metrics.closes.filter((source) => source === 'coordinator').length,
      1,
    );
    assert.equal(
      harness.metrics.releases.filter((source) => source === 'coordinator').length,
      1,
    );
    await closeAllClients(clients);
  });

  await t.test('abort before callback dispatch still invokes close once', async () => {
    const harness = createAuthorityHarness();
    const { clients, controller } = controlledClients(harness);
    await completeClient(clients, 'coordinator', controller.signal);
    const cleanup = new AbortController();
    const closing = clients.coordinator.close(cleanup.signal);
    cleanup.abort(new Error('private cleanup reason'));
    await assert.rejects(
      withDeadline(closing, 'pre-dispatch cleanup abort'),
      clientError,
    );
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
    clientError(signal.reason);
    await closeAllClients(clients);
  });
});

test('successful terminal close releases every authority exactly once', async () => {
  const harness = createAuthorityHarness();
  const { clients, controller } = controlledClients(harness);
  const observations = await completeClients(clients, controller.signal);
  assert.equal(observations.length, SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX);
  const results = await closeAllClients(clients);
  assert.equal(results.every(({ status }) => status === 'fulfilled'), true);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...SOURCE_CLIENTS_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...SOURCE_CLIENTS_SOURCE_ORDER].sort(),
  );
  assert.equal(new Set(harness.metrics.closes).size, SOURCE_CLIENTS_SOURCE_ORDER.length);
  for (const { signal } of harness.metrics.closeSignals) {
    assert.equal(signal.aborted, true);
    clientError(signal.reason);
  }
});

test('a delayed authority close is not reported released before settlement', async () => {
  const closeStarted = deferred();
  const closeRelease = deferred();
  const harness = createAuthorityHarness({
    hooks: {
      async close({ source }) {
        if (source === 'coordinator') {
          closeStarted.resolve();
          await closeRelease.promise;
        }
      },
    },
  });
  const { clients, controller } = controlledClients(harness);
  await completeClient(clients, 'coordinator', controller.signal);
  const closing = clients.coordinator.close(new AbortController().signal);
  await closeStarted.promise;
  assert.equal(harness.metrics.releases.includes('coordinator'), false);
  closeRelease.resolve();
  await withDeadline(closing, 'delayed authority close');
  assert.equal(harness.metrics.releases.includes('coordinator'), true);
  await closeAllClients(clients);
});

test('authority close failures and unreviewed values collapse after release', async () => {
  for (const closeBehavior of [
    () => { throw new Error('private close failure'); },
    () => 'unexpected',
  ]) {
    const harness = createAuthorityHarness({
      hooks: {
        close({ source }) {
          if (source === 'coordinator') return closeBehavior();
          return undefined;
        },
      },
    });
    const { clients, controller } = controlledClients(harness);
    await completeClient(clients, 'coordinator', controller.signal);
    await assert.rejects(
      clients.coordinator.close(new AbortController().signal),
      clientError,
    );
    assert.equal(
      harness.metrics.closes.filter((source) => source === 'coordinator').length,
      1,
    );
    assert.equal(
      harness.metrics.releases.filter((source) => source === 'coordinator').length,
      1,
    );
    await assert.rejects(
      clients.hosting.observe(clientDescriptor('hosting', 0, controller.signal)),
      clientError,
    );
    await closeAllClients(clients);
  }
});

test('duplicate close poisons every peer after local authority release', async () => {
  const harness = createAuthorityHarness();
  const { clients, controller } = controlledClients(harness);
  await completeClient(clients, 'coordinator', controller.signal);
  await clients.coordinator.close(new AbortController().signal);
  await assert.rejects(
    clients.coordinator.close(new AbortController().signal),
    clientError,
  );
  await assert.rejects(
    clients.hosting.observe(clientDescriptor('hosting', 0, controller.signal)),
    clientError,
  );
  await closeAllClients(clients);
  assert.equal(
    harness.metrics.closes.filter((source) => source === 'coordinator').length,
    1,
  );
  assert.equal(
    harness.metrics.releases.filter((source) => source === 'coordinator').length,
    1,
  );
});

test('authority callbacks cannot reenter observe or close', async (t) => {
  for (const operation of ['observe', 'close']) {
    await t.test(operation, async () => {
      let clients;
      let controller;
      let reentrant;
      const harness = createAuthorityHarness({
        hooks: {
          async acquire({ descriptor, facts }) {
            reentrant = operation === 'observe'
              ? clients.hosting.observe(clientDescriptor('hosting', 0, controller.signal))
              : clients.hosting.close(new AbortController().signal);
            await assert.rejects(reentrant, clientError);
            return {
              handled: true,
              value: receiptFor(descriptor, candidateObservation(facts, descriptor)),
            };
          },
        },
      });
      controller = new AbortController();
      ({ clients } = controlledClients(harness, controller));
      await assert.rejects(
        clients.coordinator.observe(clientDescriptor('coordinator', 0, controller.signal)),
        clientError,
      );
      await closeAllClients(clients);
      await assert.rejects(reentrant, clientError);
    });
  }
});

test('foreign acquire thenables preserve callback context for reentrant operations', async (t) => {
  for (const target of ['then getter peer observe', 'then method same close']) {
    await t.test(target, async () => {
      let clients;
      let controller;
      let reentrantTask;
      const harness = createAuthorityHarness();
      replaceAuthority(harness, 'coordinator', {
        acquire(descriptor) {
          harness.metrics.acquisitions.push({ source: 'coordinator', descriptor });
          const receipt = receiptFor(
            descriptor,
            candidateObservation(harness.facts, descriptor),
          );
          const reenter = () => {
            reentrantTask = target === 'then getter peer observe'
              ? clients.hosting.observe(clientDescriptor('hosting', 0, controller.signal))
              : clients.coordinator.close(new AbortController().signal);
            return reentrantTask;
          };
          if (target === 'then getter peer observe') {
            return Object.create(null, {
              then: {
                configurable: false,
                enumerable: true,
                get() {
                  const task = reenter();
                  return (resolve, rejectPromise) => task.then(
                    () => resolve(receipt),
                    rejectPromise,
                  );
                },
              },
            });
          }
          return {
            then(resolve, rejectPromise) {
              reenter().then(() => resolve(receipt), rejectPromise);
            },
          };
        },
      });
      controller = new AbortController();
      ({ clients } = controlledClients(harness, controller));
      const active = clients.coordinator.observe(
        clientDescriptor('coordinator', 0, controller.signal),
      );
      await assert.rejects(withDeadline(active, `${target} acquire`), clientError);
      await assert.rejects(withDeadline(reentrantTask, `${target} reentry`), clientError);
      assert.equal(
        harness.metrics.acquisitions.some(({ source }) => source === 'hosting'),
        false,
      );
      await closeAllClients(clients);
    });
  }
});

test('authority signal listeners cannot reenter a peer during release', async () => {
  let clients;
  let controller;
  let peerObservation;
  const harness = createAuthorityHarness();
  replaceAuthority(harness, 'coordinator', {
    acquire(descriptor) {
      harness.metrics.acquisitions.push({ source: 'coordinator', descriptor });
      descriptor.signal.addEventListener('abort', () => {
        peerObservation = clients.hosting.observe(
          clientDescriptor('hosting', 0, controller.signal),
        );
      }, { once: true });
      return receiptFor(
        descriptor,
        candidateObservation(harness.facts, descriptor),
      );
    },
  });
  controller = new AbortController();
  ({ clients } = controlledClients(harness, controller));
  await assert.rejects(
    clients.coordinator.observe(clientDescriptor('coordinator', 0, controller.signal)),
    clientError,
  );
  await assert.rejects(
    withDeadline(peerObservation, 'signal-listener peer observation'),
    clientError,
  );
  assert.equal(
    harness.metrics.acquisitions.some(({ source }) => source === 'hosting'),
    false,
  );
  await closeAllClients(clients);
});

test('a foreign authority-close thenable cannot reenter a peer client', async () => {
  let clients;
  let controller;
  let peerObservation;
  const harness = createAuthorityHarness();
  replaceAuthority(harness, 'coordinator', {
    close(signal) {
      harness.metrics.closes.push('coordinator');
      harness.metrics.closeSignals.push({ source: 'coordinator', signal });
      return {
        then(resolve, rejectPromise) {
          peerObservation = clients.hosting.observe(
            clientDescriptor('hosting', 0, controller.signal),
          );
          peerObservation.then(resolve, rejectPromise);
        },
      };
    },
  });
  controller = new AbortController();
  ({ clients } = controlledClients(harness, controller));
  await completeClient(clients, 'coordinator', controller.signal);
  await assert.rejects(
    withDeadline(
      clients.coordinator.close(new AbortController().signal),
      'foreign authority-close thenable',
    ),
    clientError,
  );
  await assert.rejects(
    withDeadline(peerObservation, 'foreign close peer observation'),
    clientError,
  );
  assert.equal(
    harness.metrics.acquisitions.some(({ source }) => source === 'hosting'),
    false,
  );
  assert.equal(
    harness.metrics.closes.filter((source) => source === 'coordinator').length,
    1,
  );
  assert.equal(
    harness.metrics.releases.filter((source) => source === 'coordinator').length,
    1,
  );
  await closeAllClients(clients);
});

test('terminal close releases strong authority references', () => {
  const moduleUrl = new URL(
    '../browser-relay-source-clients/clients.mjs',
    import.meta.url,
  );
  const contractUrl = new URL(
    '../browser-relay-source-clients/contract.mjs',
    import.meta.url,
  );
  const script = `
    import { createBrowserRelaySourceClients } from ${JSON.stringify(moduleUrl.href)};
    import {
      SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
      SOURCE_CLIENTS_SCOPES_BY_SOURCE,
      SOURCE_CLIENTS_SOURCE_ORDER,
    } from ${JSON.stringify(contractUrl.href)};
    const expiresAt = Date.now()
      + SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS;
    let authorities = Object.freeze(Object.fromEntries(
      SOURCE_CLIENTS_SOURCE_ORDER.map((source) => [
        source,
        Object.freeze({
          source,
          scope: SOURCE_CLIENTS_SCOPES_BY_SOURCE[source],
          expires_at_milliseconds: expiresAt,
          acquire() { throw new Error('unused'); },
          close() {},
        }),
      ]),
    ));
    const reference = new WeakRef(authorities.hosting);
    const clients = createBrowserRelaySourceClients(authorities, {
      signal: new AbortController().signal,
    });
    authorities = undefined;
    await Promise.allSettled(
      Object.values(clients).map((client) => client.close(new AbortController().signal)),
    );
    for (let index = 0; index < 20; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      globalThis.gc();
      void new Uint8Array(1024 * 1024);
    }
    if (reference.deref() !== undefined) throw new Error('closed client retained authority');
  `;
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', '--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test('fixed inventories remain deeply frozen and complete', () => {
  assert.deepEqual(Reflect.ownKeys(SOURCE_CLIENTS_SCOPES_BY_SOURCE), SOURCE_CLIENTS_SOURCE_ORDER);
  assert.deepEqual(
    Reflect.ownKeys(SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND),
    SOURCE_CLIENTS_SOURCE_ORDER,
  );
  assert.equal(Object.isFrozen(SOURCE_CLIENTS_SCOPES_BY_SOURCE), true);
  assert.equal(Object.isFrozen(SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND), true);
  assert.deepEqual(SOURCE_CLIENTS_AUTHORITY_FIELDS, [
    'source',
    'scope',
    'expires_at_milliseconds',
    'acquire',
    'close',
  ]);
  assert.deepEqual(SOURCE_CLIENTS_CLIENT_DESCRIPTOR_FIELDS, [
    'source',
    'scope',
    'browser',
    'case_id',
    'kind',
    'signal',
  ]);
  assert.deepEqual(SOURCE_CLIENTS_RECEIPT_FIELDS, [
    'source',
    'scope',
    'browser',
    'case_id',
    'kind',
    'target',
    'request_capability',
    'observation',
  ]);
  let total = 0;
  const kinds = new Set();
  for (const source of SOURCE_CLIENTS_SOURCE_ORDER) {
    assert.equal(Object.isFrozen(SOURCE_CLIENTS_SCOPES_BY_SOURCE[source]), true);
    assert.equal(Object.isFrozen(SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND[source]), true);
    for (const call of SOURCE_CLIENTS_CALLS_BY_SOURCE[source]) {
      assert.notEqual(SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND[source][call.kind], undefined);
      assert.equal(
        Object.isFrozen(SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND[source][call.kind]),
        true,
      );
      total += 1;
      kinds.add(`${source}/${call.kind}`);
    }
  }
  assert.equal(total, SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX);
  assert.equal(kinds.size, SOURCE_CLIENTS_DISTINCT_KIND_COUNT);
});

test('profile, dependency digest, and structural guard validate reviewed bytes', async () => {
  assert.equal(
    sourceClientsDependencyContractsSha256(),
    SOURCE_CLIENTS_DEPENDENCY_CONTRACTS_SHA256,
  );
  const profile = validateBrowserRelaySourceClientsProfile();
  assert.equal(profile.evidence.live_execution_count, 0);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(profile.compatibility.preexisting_async_resource_reentrancy_isolated, false);
  assert.deepEqual(await validateBrowserRelaySourceClientsRoot(PACKAGE_ROOT), profile);
});

test('the structural guard rejects inventory, import, runtime, and profile drift', async () => {
  for (const [mutate, expected] of [
    [
      (root) => writeFileSync(new URL('extra.mjs', root), 'export default true;\n'),
      /file inventory/u,
    ],
    [(root) => {
      const path = new URL('clients.mjs', root);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\nimport 'node:fs';\n`);
    }, /imports differ/u],
    [(root) => {
      const path = new URL('internal.mjs', root);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\nvoid fetch;\n`);
    }, /built-in live transport/u],
    [(root) => {
      const path = new URL('contract.mjs', root);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\nvoid fetch;\n`);
    }, /built-in live transport/u],
    [(root) => {
      const path = new URL('contract.mjs', root);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\nvoid globalThis['f' + 'etch'];\n`);
    }, /computed ambient authority/u],
    [(root) => {
      const path = new URL('contract.mjs', root);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\nvoid WebSocket;\n`);
    }, /built-in live transport/u],
    [(root) => {
      const path = new URL('contract.mjs', root);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\nvoid process.env;\n`);
    }, /ambient authority/u],
    [(root) => {
      const path = new URL('contract.mjs', root);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\nwriteFileSync('/tmp/never');\n`);
    }, /mutate the filesystem/u],
    [(root) => {
      const path = new URL('profile.json', root);
      const profile = JSON.parse(readFileSync(path, 'utf8'));
      profile.authority.live_execution_authorized = true;
      writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`);
    }, clientError],
  ]) {
    const root = copiedPackageRoot();
    mutate(root);
    await assert.rejects(validateBrowserRelaySourceClientsRoot(root), expected);
  }
});

test('the standalone guard rejects a hostile contract before import-time side effects', () => {
  const root = copiedPackageRoot();
  const contractPath = new URL('contract.mjs', root);
  const sentinel = join(fileURLToPath(root), 'guard-import-side-effect');
  const reviewedImport = "import { lstatSync, readFileSync } from 'node:fs';";
  const hostileImport = "import { lstatSync, readFileSync, writeFileSync } from 'node:fs';";
  const source = readFileSync(contractPath, 'utf8');
  assert.equal(source.includes(reviewedImport), true);
  writeFileSync(
    contractPath,
    `${source.replace(reviewedImport, hostileImport)}\nwriteFileSync(${JSON.stringify(sentinel)}, 'executed');\n`,
  );
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { validateBrowserRelaySourceClientsRoot } from ${JSON.stringify(new URL('guard.mjs', root).href)}; await validateBrowserRelaySourceClientsRoot(new URL(${JSON.stringify(root.href)}));`,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stderr, /bindings differ|mutate the filesystem/u);
  assert.equal(existsSync(sentinel), false);
});
