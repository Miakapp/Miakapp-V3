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
  AUTHENTICATED_SOURCE_READERS_AUTHORITY_METHODS_BY_SOURCE,
  AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE,
  AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
  AUTHENTICATED_SOURCE_READERS_OBSERVATIONS_PER_MATRIX,
  AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER,
  AUTHENTICATED_SOURCE_READERS_STAGE_COUNT,
  StagingBrowserRelayAuthenticatedSourceReaderError,
  authenticatedSourceReadersDependencyContractsSha256,
  validateBrowserRelayAuthenticatedSourceReadersProfile,
} from '../browser-relay-authenticated-source-readers/contract.mjs';
import {
  validateBrowserRelayAuthenticatedSourceReadersRoot,
} from '../browser-relay-authenticated-source-readers/guard.mjs';
import {
  createBrowserRelayAuthenticatedSourceReaders,
} from '../browser-relay-authenticated-source-readers/readers.mjs';
import {
  createBrowserRelayAuthenticatedSourceReadersForTest,
} from '../browser-relay-authenticated-source-readers/testing.mjs';
import {
  INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE,
  INDEPENDENT_CASE_ADAPTER_STAGE_ORDER,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  createBrowserRelaySourceTransports,
} from '../browser-relay-source-transports/transports.mjs';
import { fullIndependentFacts } from './helpers/browser-relay-evidence-fixture.mjs';

const PACKAGE_ROOT = new URL(
  '../browser-relay-authenticated-source-readers/',
  import.meta.url,
);
const CONTEXT_FIELDS = Object.freeze([
  'browser',
  'case_id',
  'kind',
  'operation_capability',
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

function packageError(error) {
  assert.equal(error instanceof StagingBrowserRelayAuthenticatedSourceReaderError, true);
  assert.equal(error.name, 'StagingBrowserRelayAuthenticatedSourceReaderError');
  assert.equal(
    error.message,
    'Staging browser-relay authenticated source reader failed closed',
  );
  return true;
}

function createAuthorityHarness(hooks = {}) {
  const facts = fullIndependentFacts();
  const metrics = {
    calls: [],
    closes: [],
    contexts: [],
    releases: [],
  };
  const authorities = Object.fromEntries(
    AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.map((source) => {
      const authority = {};
      for (const method of AUTHENTICATED_SOURCE_READERS_AUTHORITY_METHODS_BY_SOURCE[source]) {
        if (method === 'close') {
          authority.close = async function close() {
            metrics.closes.push(source);
            return hooks.close?.({ source, metrics });
          };
        } else {
          authority[method] = async function read(context) {
            metrics.calls.push({ source, method });
            metrics.contexts.push(context);
            const result = await hooks.call?.({ source, method, context, metrics, facts });
            if (result?.handled === true) return result.value;
            const fact = facts[context.browser][source].find(({ kind }) => kind === method);
            assert.notEqual(fact, undefined);
            return structuredClone(fact.observation);
          };
        }
      }
      return [source, authority];
    }),
  );
  return { authorities, metrics, facts };
}

function testRuntime(harness, nowState) {
  const releases = harness.metrics.releases;
  return {
    clock: () => nowState.value,
    authority_released(source) {
      releases.push(source);
    },
  };
}

function controlledReaders(harness, nowState, controller = new AbortController()) {
  const readers = createBrowserRelayAuthenticatedSourceReadersForTest(
    harness.authorities,
    {
      signal: controller.signal,
      expires_at_milliseconds: nowState.value
        + AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
    },
    testRuntime(harness, nowState),
  );
  return { readers, controller };
}

function operationCapability() {
  const capability = () => {
    throw new Error('opaque');
  };
  Object.setPrototypeOf(capability, null);
  return Object.freeze(capability);
}

function stageRequest(source, index, signal, capability = operationCapability()) {
  const invocation = AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE[source][index];
  return Object.freeze({
    source,
    browser: invocation.browser,
    case_id: invocation.case_id,
    expected_kinds: invocation.expected_kinds,
    expected_observation_count: invocation.expected_kinds.length,
    signal,
    operation_capability: capability,
  });
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

async function runCompleteSchedule(readers, signal) {
  const transports = createBrowserRelaySourceTransports(readers, { signal });
  const observations = [];
  for (const { browser, case_id: caseId } of INDEPENDENT_CASE_ADAPTER_STAGE_ORDER) {
    const sources = Object.keys(
      INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[`${caseId}/${browser}`],
    );
    await Promise.all(sources.map((source) => transports[source].execute(
      sourceScope(browser, caseId, signal, observations),
    )));
  }
  await Promise.all(
    AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.map((source) => transports[source].close()),
  );
  return observations;
}

async function closeAllProviders(readers) {
  return Promise.allSettled(
    AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.map((source) => readers[source].close()),
  );
}

async function completeSource(readers, source, signal, capability = operationCapability()) {
  for (let index = 0;
    index < AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE[source].length;
    index += 1) {
    const request = stageRequest(source, index, signal, capability);
    const reader = readers[source].openStage(request);
    for (let observation = 0;
      observation < request.expected_observation_count;
      observation += 1) {
      assert.equal((await reader.next()).done, false);
    }
    assert.deepEqual(await reader.next(), { done: true });
    await reader.close();
  }
  return capability;
}

function copiedPackageRoot() {
  const parent = mkdtempSync(join(tmpdir(), 'miakapp-authenticated-readers-'));
  temporaryRoots.add(parent);
  const root = join(parent, 'package');
  cpSync(PACKAGE_ROOT, root, { recursive: true });
  return new URL(`file://${root}/`);
}

test('all 22 stages and 43 observations flow through exact attenuated authority methods', async () => {
  const now = { value: 1_800_000_000_000 };
  const harness = createAuthorityHarness();
  const { readers, controller } = controlledReaders(harness, now);
  const observations = await runCompleteSchedule(readers, controller.signal);

  assert.equal(AUTHENTICATED_SOURCE_READERS_STAGE_COUNT, 22);
  assert.equal(AUTHENTICATED_SOURCE_READERS_OBSERVATIONS_PER_MATRIX, 43);
  assert.equal(observations.length, 43);
  assert.equal(harness.metrics.calls.length, 43);
  assert.equal(harness.metrics.contexts.length, 43);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER].sort(),
  );
  const capabilities = new Set();
  for (const context of harness.metrics.contexts) {
    assert.deepEqual(Reflect.ownKeys(context).sort(), [...CONTEXT_FIELDS].sort());
    assert.deepEqual(Object.keys(context).sort(), CONTEXT_FIELDS.filter(
      (field) => field !== 'toJSON',
    ).sort());
    assert.equal(Object.getPrototypeOf(context), null);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(context.signal instanceof AbortSignal, true);
    assert.throws(() => JSON.stringify(context), packageError);
    assert.throws(() => structuredClone(context));
    capabilities.add(context.operation_capability);
  }
  assert.equal(capabilities.size, 1);
});

test('production and testing factories have exact isolated surfaces', async () => {
  assert.equal(createBrowserRelayAuthenticatedSourceReaders.length, 2);
  assert.equal(createBrowserRelayAuthenticatedSourceReadersForTest.length, 3);
  const harness = createAuthorityHarness();
  const controller = new AbortController();
  const readers = createBrowserRelayAuthenticatedSourceReaders(harness.authorities, {
    signal: controller.signal,
    expires_at_milliseconds: Date.now() + 1_000,
  });
  assert.deepEqual(
    Reflect.ownKeys(readers),
    AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER,
  );
  assert.equal(Object.isFrozen(readers), true);
  for (const reader of Object.values(readers)) {
    assert.deepEqual(Reflect.ownKeys(reader), ['openStage', 'close']);
    assert.equal(Object.isFrozen(reader), true);
  }
  await closeAllProviders(readers);
  assert.equal(harness.metrics.calls.length, 0);
});

test('authority and options descriptors fail closed without invoking any getter', () => {
  const now = { value: 50_000 };
  for (const mutate of [
    (harness) => { harness.authorities.extra = {}; },
    (harness) => { harness.authorities[Symbol('extra')] = {}; },
    (harness) => {
      Object.defineProperty(harness.authorities.firebase_app_check, 'provider_assessment', {
        enumerable: true,
        get() { throw new Error('getter must not run'); },
      });
    },
    (harness) => { harness.authorities.hosting = harness.authorities.firebase_app_check; },
    (harness) => { harness.authorities.firestore.extra = () => {}; },
    (harness) => { harness.authorities.kms.close = 'not a method'; },
  ]) {
    const harness = createAuthorityHarness();
    mutate(harness);
    assert.throws(
      () => controlledReaders(harness, now),
      packageError,
    );
    assert.equal(harness.metrics.calls.length, 0);
  }

  for (const options of [
    {},
    { signal: new AbortController().signal, expires_at_milliseconds: 50_001, extra: true },
    { signal: {}, expires_at_milliseconds: 50_001 },
    { signal: new AbortController().signal, expires_at_milliseconds: 50_000 },
    {
      signal: new AbortController().signal,
      expires_at_milliseconds: 50_000
        + AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS + 1,
    },
    { signal: new AbortController().signal, expires_at_milliseconds: 50_000.5 },
  ]) {
    const harness = createAuthorityHarness();
    assert.throws(
      () => createBrowserRelayAuthenticatedSourceReadersForTest(
        harness.authorities,
        options,
        testRuntime(harness, now),
      ),
      packageError,
    );
  }
});

test('authority identities are single-operation and runtime clocks are exact', async () => {
  const now = { value: 50_000 };
  const harness = createAuthorityHarness();
  const first = controlledReaders(harness, now);
  assert.throws(() => controlledReaders(harness, now), packageError);
  await closeAllProviders(first.readers);
  assert.throws(() => controlledReaders(harness, now), packageError);

  for (const runtime of [
    {},
    { clock: () => now.value, authority_released() {}, extra: true },
    { clock: now.value, authority_released() {} },
    { clock: () => now.value, authority_released: true },
    { clock: () => -1, authority_released() {} },
    { clock: () => 1.5, authority_released() {} },
    {
      authority_released() {},
      get clock() { throw new Error('getter'); },
    },
  ]) {
    const candidate = createAuthorityHarness();
    assert.throws(
      () => createBrowserRelayAuthenticatedSourceReadersForTest(
        candidate.authorities,
        {
          signal: new AbortController().signal,
          expires_at_milliseconds: now.value + 1,
        },
        runtime,
      ),
      packageError,
    );
  }
});

test('stage requests are canonical and one operation capability is bound globally', async () => {
  const now = { value: 100_000 };
  const harness = createAuthorityHarness();
  const { readers, controller } = controlledReaders(harness, now);
  const capability = operationCapability();
  const first = stageRequest('firebase_app_check', 0, controller.signal, capability);
  const reader = readers.firebase_app_check.openStage(first);
  assert.equal((await reader.next()).done, false);

  const otherCapability = operationCapability();
  assert.throws(
    () => readers.hosting.openStage(
      stageRequest('hosting', 0, controller.signal, otherCapability),
    ),
    packageError,
  );
  await reader.close();
  const results = await closeAllProviders(readers);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
});

test('wrong, mutable, accessor, symbolic, and excess stage requests poison all providers', async () => {
  for (const requestFactory of [
    (base) => ({ ...base }),
    (base) => Object.freeze({ ...base, source: 'hosting' }),
    (base) => Object.freeze({ ...base, case_id: 'LIVE-99' }),
    (base) => Object.freeze({ ...base, expected_kinds: [...base.expected_kinds] }),
    (base) => Object.freeze({ ...base, extra: true }),
    (base) => {
      const value = { ...base };
      Object.defineProperty(value, 'source', { enumerable: true, get() { return base.source; } });
      return Object.freeze(value);
    },
    (base) => Object.freeze({ ...base, [Symbol('extra')]: true }),
  ]) {
    const now = { value: 100_000 };
    const harness = createAuthorityHarness();
    const { readers, controller } = controlledReaders(harness, now);
    const request = requestFactory(stageRequest(
      'firebase_app_check',
      0,
      controller.signal,
    ));
    assert.throws(() => readers.firebase_app_check.openStage(request), packageError);
    assert.throws(
      () => readers.hosting.openStage(stageRequest('hosting', 0, controller.signal)),
      packageError,
    );
    await closeAllProviders(readers);
    assert.equal(harness.metrics.calls.length, 0);
  }
});

test('reader calls are lazy, reserved before await, and cannot overlap', async () => {
  const pending = deferred();
  let first = true;
  const harness = createAuthorityHarness({
    async call({ facts, context, source, method }) {
      if (first) {
        first = false;
        await pending.promise;
      }
      const fact = facts[context.browser][source].find(({ kind }) => kind === method);
      return { handled: true, value: structuredClone(fact.observation) };
    },
  });
  const now = { value: 100_000 };
  const { readers, controller } = controlledReaders(harness, now);
  const reader = readers.firebase_app_check.openStage(
    stageRequest('firebase_app_check', 0, controller.signal),
  );
  assert.equal(harness.metrics.calls.length, 0);
  const active = reader.next();
  await Promise.resolve();
  assert.equal(harness.metrics.calls.length, 1);
  await assert.rejects(reader.next(), packageError);
  pending.resolve();
  await assert.rejects(withDeadline(active, 'poisoned active read'), packageError);
  await reader.close();
  await closeAllProviders(readers);
});

test('authority callbacks cannot reenter reader or provider close', async (t) => {
  for (const target of ['reader', 'provider']) {
    await t.test(target, async () => {
      let readers;
      let reader;
      const harness = createAuthorityHarness({
        async call() {
          const closing = target === 'reader' ? reader.close() : readers.hosting.close();
          await assert.rejects(closing, packageError);
          return { handled: false };
        },
      });
      const now = { value: 100_000 };
      const controlled = controlledReaders(harness, now);
      readers = controlled.readers;
      reader = readers.hosting.openStage(
        stageRequest('hosting', 0, controlled.controller.signal),
      );
      await assert.rejects(
        withDeadline(reader.next(), `${target} close reentry`),
        packageError,
      );
      await withDeadline(reader.close(), `${target} close reentry reader cleanup`);
      await withDeadline(closeAllProviders(readers), `${target} close reentry cleanup`);
    });
  }

  await t.test('authority close', async () => {
    let readers;
    const harness = createAuthorityHarness({
      async close({ source }) {
        if (source === 'hosting') {
          await assert.rejects(readers.hosting.close(), packageError);
        }
      },
    });
    const now = { value: 100_000 };
    const controlled = controlledReaders(harness, now);
    readers = controlled.readers;
    await completeSource(readers, 'hosting', controlled.controller.signal);
    await assert.rejects(
      withDeadline(readers.hosting.close(), 'authority close reentry'),
      packageError,
    );
    await withDeadline(closeAllProviders(readers), 'authority close reentry cleanup');
  });
});

test('EOF is singular and every post-EOF read poisons the shared operation', async () => {
  const now = { value: 100_000 };
  const harness = createAuthorityHarness();
  const { readers, controller } = controlledReaders(harness, now);
  const request = stageRequest('hosting', 0, controller.signal);
  const reader = readers.hosting.openStage(request);
  for (let index = 0; index < request.expected_observation_count; index += 1) {
    const result = await reader.next();
    assert.deepEqual(Reflect.ownKeys(result).sort(), ['done', 'observation']);
    assert.equal(result.done, false);
    assert.equal(Object.isFrozen(result), true);
  }
  assert.deepEqual(await reader.next(), { done: true });
  await assert.rejects(reader.next(), packageError);
  await reader.close();
  await assert.rejects(reader.close(), packageError);
  const results = await closeAllProviders(readers);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
});

test('duplicate reader and provider closes poison peers after local reference cleanup', async (t) => {
  await t.test('reader close', async () => {
    const now = { value: 100_000 };
    const harness = createAuthorityHarness();
    const { readers, controller } = controlledReaders(harness, now);
    const capability = operationCapability();
    const request = stageRequest('hosting', 0, controller.signal, capability);
    const reader = readers.hosting.openStage(request);
    for (let index = 0; index < request.expected_observation_count; index += 1) {
      assert.equal((await reader.next()).done, false);
    }
    assert.deepEqual(await reader.next(), { done: true });
    await reader.close();
    await assert.rejects(reader.close(), packageError);
    assert.throws(
      () => readers.coordinator.openStage(
        stageRequest('coordinator', 0, controller.signal, capability),
      ),
      packageError,
    );
    await closeAllProviders(readers);
  });

  await t.test('provider close', async () => {
    const now = { value: 100_000 };
    const harness = createAuthorityHarness();
    const { readers, controller } = controlledReaders(harness, now);
    const capability = await completeSource(readers, 'hosting', controller.signal);
    await readers.hosting.close();
    await assert.rejects(readers.hosting.close(), packageError);
    assert.throws(
      () => readers.coordinator.openStage(
        stageRequest('coordinator', 0, controller.signal, capability),
      ),
      packageError,
    );
    await closeAllProviders(readers);
  });
});

test('premature reader and provider close fail closed but still clean captured authorities', async () => {
  const now = { value: 100_000 };
  const harness = createAuthorityHarness();
  const { readers, controller } = controlledReaders(harness, now);
  const reader = readers.relay.openStage(stageRequest('relay', 0, controller.signal));
  await assert.rejects(reader.close(), packageError);
  const results = await closeAllProviders(readers);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER].sort(),
  );
});

test('terminal close reports every authority release exactly once', async () => {
  const now = { value: 100_000 };
  const harness = createAuthorityHarness();
  const { readers } = controlledReaders(harness, now);
  await closeAllProviders(readers);
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER].sort(),
  );
  assert.equal(new Set(harness.metrics.releases).size, 7);
  await closeAllProviders(readers);
  assert.equal(harness.metrics.releases.length, 7);
});

test('synchronous, asynchronous, semantic, and private-material failures collapse and poison', async () => {
  for (const call of [
    () => { throw new TypeError('private cause'); },
    async () => Promise.reject(new Error('private async cause')),
    () => ({ handled: true, value: {} }),
    ({ facts, context, source, method }) => {
      const fact = facts[context.browser][source].find(({ kind }) => kind === method);
      return {
        handled: true,
        value: { ...structuredClone(fact.observation), raw_response: 'forbidden' },
      };
    },
  ]) {
    const harness = createAuthorityHarness({ call });
    const now = { value: 100_000 };
    const { readers, controller } = controlledReaders(harness, now);
    const reader = readers.firebase_app_check.openStage(
      stageRequest('firebase_app_check', 0, controller.signal),
    );
    await assert.rejects(reader.next(), packageError);
    assert.throws(
      () => readers.hosting.openStage(stageRequest('hosting', 0, controller.signal)),
      packageError,
    );
    await reader.close();
    await closeAllProviders(readers);
  }
});

test('validated outputs are copied frozen projections, never authority return identities', async () => {
  let returned;
  const harness = createAuthorityHarness({
    call({ facts, context, source, method }) {
      const fact = facts[context.browser][source].find(({ kind }) => kind === method);
      returned = structuredClone(fact.observation);
      return { handled: true, value: returned };
    },
  });
  const now = { value: 100_000 };
  const { readers, controller } = controlledReaders(harness, now);
  const reader = readers.coordinator.openStage(
    stageRequest('coordinator', 0, controller.signal),
  );
  const result = await reader.next();
  assert.notEqual(result.observation, returned);
  assert.equal(Object.isFrozen(result.observation), true);
  const snapshot = structuredClone(result.observation);
  const firstKey = Object.keys(returned)[0];
  returned[firstKey] = 'changed after return';
  assert.deepEqual(result.observation, snapshot);
  assert.deepEqual(await reader.next(), { done: true });
  await reader.close();
  await closeAllProviders(readers);
});

test('abort before open and during settlement suppresses output and sanitizes reasons', async () => {
  {
    const harness = createAuthorityHarness();
    const now = { value: 100_000 };
    const controller = new AbortController();
    const { readers } = controlledReaders(harness, now, controller);
    controller.abort();
    assert.throws(
      () => readers.firestore.openStage(stageRequest('firestore', 0, controller.signal)),
      packageError,
    );
    await closeAllProviders(readers);
    assert.equal(harness.metrics.calls.length, 0);
  }

  for (const abortedBoundary of ['root', 'request']) {
    const pending = deferred();
    let context;
    const harness = createAuthorityHarness({
      async call({ facts, context: authorityContext, source, method }) {
        context = authorityContext;
        await pending.promise;
        const fact = facts[authorityContext.browser][source]
          .find(({ kind }) => kind === method);
        return { handled: true, value: structuredClone(fact.observation) };
      },
    });
    const now = { value: 100_000 };
    const rootController = new AbortController();
    const requestController = new AbortController();
    const { readers } = controlledReaders(harness, now, rootController);
    const reader = readers.firestore.openStage(
      stageRequest('firestore', 0, requestController.signal),
    );
    const active = reader.next();
    await Promise.resolve();
    const privateReason = Object.freeze({ access_token: 'must-not-cross' });
    const controller = abortedBoundary === 'root' ? rootController : requestController;
    controller.abort(privateReason);
    assert.notEqual(context.signal, rootController.signal);
    assert.notEqual(context.signal, requestController.signal);
    assert.equal(context.signal.aborted, true);
    assert.notEqual(context.signal.reason, privateReason);
    packageError(context.signal.reason);
    pending.resolve();
    await assert.rejects(
      withDeadline(active, `${abortedBoundary}-aborted authority read`),
      packageError,
    );
    await reader.close();
    await closeAllProviders(readers);
  }
});

test('expiry before and during acquisition is checked against absolute test time', async () => {
  {
    const now = { value: 100_000 };
    const harness = createAuthorityHarness();
    const { readers, controller } = controlledReaders(harness, now);
    now.value += AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS;
    assert.throws(
      () => readers.kms.openStage(stageRequest('kms', 0, controller.signal)),
      packageError,
    );
    await closeAllProviders(readers);
  }

  {
    const pending = deferred();
    const now = { value: 100_000 };
    const harness = createAuthorityHarness({
      async call({ facts, context, source, method }) {
        await pending.promise;
        const fact = facts[context.browser][source].find(({ kind }) => kind === method);
        return { handled: true, value: structuredClone(fact.observation) };
      },
    });
    const { readers, controller } = controlledReaders(harness, now);
    const reader = readers.kms.openStage(stageRequest('kms', 0, controller.signal));
    const active = reader.next();
    await Promise.resolve();
    now.value += AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS;
    pending.resolve();
    await assert.rejects(withDeadline(active, 'expired authority read'), packageError);
    await reader.close();
    await closeAllProviders(readers);
  }
});

test('provider close checks abort and expiry after the authority callback settles', async (t) => {
  for (const boundary of ['abort', 'expiry']) {
    await t.test(boundary, async () => {
      const pending = deferred();
      const now = { value: 100_000 };
      const harness = createAuthorityHarness({
        async close({ source }) {
          if (source === 'hosting') await pending.promise;
        },
      });
      const controller = new AbortController();
      const { readers } = controlledReaders(harness, now, controller);
      await completeSource(readers, 'hosting', controller.signal);
      const closing = readers.hosting.close();
      await Promise.resolve();
      if (boundary === 'abort') {
        controller.abort(Object.freeze({ private_key: 'must-not-cross' }));
      } else {
        now.value += AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS;
      }
      pending.resolve();
      await assert.rejects(
        withDeadline(closing, `${boundary} during authority close`),
        packageError,
      );
      await closeAllProviders(readers);
    });
  }
});

test('authority close failures and unreviewed close values collapse after exact invocation', async () => {
  for (const close of [
    () => { throw new Error('private close failure'); },
    () => 'unexpected',
  ]) {
    const now = { value: 100_000 };
    const harness = createAuthorityHarness({ close });
    const { readers } = controlledReaders(harness, now);
    const results = await closeAllProviders(readers);
    assert.equal(results.every(({ status }) => status === 'rejected'), true);
    assert.deepEqual(
      [...harness.metrics.closes].sort(),
      [...AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER].sort(),
    );
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      packageError(result.reason);
    }
  }
});

test('profile, dependency pins, guard, and CLI validate the closed package', () => {
  assert.match(authenticatedSourceReadersDependencyContractsSha256(), /^[0-9a-f]{64}$/u);
  const profile = validateBrowserRelayAuthenticatedSourceReadersProfile();
  assert.equal(
    profile.state,
    'closed_authenticated_kind_attenuated_source_readers_implemented_not_live_adapted_not_wired_not_executed',
  );
  assert.equal(profile.reader.stage_count, 22);
  assert.equal(profile.reader.observations_per_matrix, 43);
  assert.equal(profile.reader.maximum_authority_lifetime_milliseconds, 1_800_000);
  assert.equal(profile.reader.caller_abort_reason_sanitized, true);
  assert.equal(profile.reader.callback_close_reentrancy_rejected, true);
  assert.equal(profile.reader.testing_authority_release_probe_present, true);
  assert.equal(profile.compatibility.network_implementation_present, false);
  assert.equal(profile.compatibility.operation_case_adapter_wired, false);
  assert.equal(Object.values(profile.authority).every((value) => value === false), true);
  assert.equal(validateBrowserRelayAuthenticatedSourceReadersRoot(PACKAGE_ROOT).schema,
    profile.schema);
  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL(
      '../browser-relay-authenticated-source-readers/guard.mjs',
      import.meta.url,
    )),
    fileURLToPath(new URL('../browser-relay-authenticated-source-readers/', import.meta.url)),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /authenticated source readers remain dormant/u);
});

test('guard rejects inventory, symlink, executable, import, runtime, and profile drift', () => {
  for (const mutate of [
    (root) => writeFileSync(new URL('extra.txt', root), 'extra\n'),
    (root) => {
      rmSync(new URL('README.md', root));
      symlinkSync('profile.json', new URL('README.md', root));
    },
    (root) => chmodSync(new URL('readers.mjs', root), 0o755),
    (root) => writeFileSync(
      new URL('readers.mjs', root),
      "import process from 'node:process';\nvoid process.env;\n",
    ),
    (root) => writeFileSync(
      new URL('internal.mjs', root),
      "import {} from './contract.mjs';\nvoid fetch;\n",
    ),
    (root) => {
      const profile = JSON.parse(
        readFileSync(new URL('profile.json', root), 'utf8'),
      );
      profile.authority.network_requests_authorized = true;
      writeFileSync(new URL('profile.json', root), `${JSON.stringify(profile, null, 2)}\n`);
    },
  ]) {
    const root = copiedPackageRoot();
    mutate(root);
    assert.throws(
      () => validateBrowserRelayAuthenticatedSourceReadersRoot(root),
    );
  }
});
