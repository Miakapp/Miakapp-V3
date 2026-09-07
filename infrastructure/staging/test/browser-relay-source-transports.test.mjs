import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import {
  INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE,
  INDEPENDENT_CASE_ADAPTER_STAGE_ORDER,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  runBrowserRelayIndependentCaseScheduleForTesting,
} from '../browser-relay-independent-case-adapter/testing.mjs';
import {
  INDEPENDENT_SOURCE_FACT_SCHEMA,
  validateIndependentSourceFact,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  SOURCE_TRANSPORTS_DEPENDENCY_CONTRACTS_SHA256,
  SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE,
  SOURCE_TRANSPORTS_OBSERVATIONS_PER_MATRIX,
  SOURCE_TRANSPORTS_PROFILE_SHA256,
  SOURCE_TRANSPORTS_SOURCE_ORDER,
  SOURCE_TRANSPORTS_STAGE_COUNT,
  StagingBrowserRelaySourceTransportError,
  sourceTransportDependencyContractsSha256,
  validateBrowserRelaySourceTransportsProfile,
} from '../browser-relay-source-transports/contract.mjs';
import {
  validateBrowserRelaySourceTransportsRoot,
} from '../browser-relay-source-transports/guard.mjs';
import {
  createBrowserRelaySourceTransportsForTest,
} from '../browser-relay-source-transports/testing.mjs';
import {
  createBrowserRelaySourceTransports,
} from '../browser-relay-source-transports/transports.mjs';
import { fullIndependentFacts } from './helpers/browser-relay-evidence-fixture.mjs';

const PACKAGE_ROOT = new URL('../browser-relay-source-transports/', import.meta.url);
const PACKAGE_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'testing.mjs',
  'transports.mjs',
]);
const REQUEST_FIELDS = Object.freeze([
  'browser',
  'case_id',
  'expected_kinds',
  'expected_observation_count',
  'operation_capability',
  'signal',
  'source',
]);
const actualRuntime = Object.freeze({
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
});
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const temporaryPackageRoots = new Set();

after(() => {
  for (const root of temporaryPackageRoots) rmSync(root, { recursive: true, force: true });
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

function sourceKey(browser, source) {
  return `${browser}/${source}`;
}

function createProviderHarness(hooks = {}) {
  const facts = fullIndependentFacts();
  const providerCursors = new Map();
  const metrics = {
    opens: [],
    reads: 0,
    readerCloses: 0,
    providerCloses: 0,
    capabilities: new Set(),
  };

  const providers = Object.fromEntries(SOURCE_TRANSPORTS_SOURCE_ORDER.map((source) => {
    const provider = {
      async openStage(request) {
        metrics.opens.push(request);
        metrics.capabilities.add(request.operation_capability);
        assert.deepEqual(Reflect.ownKeys(request).sort(), [...REQUEST_FIELDS].sort());
        assert.equal(Object.isFrozen(request), true);
        assert.equal(Object.isFrozen(request.expected_kinds), true);
        assert.equal(request.source, source);
        assert.equal(request.expected_observation_count, request.expected_kinds.length);
        assert.equal(typeof request.operation_capability, 'function');
        assert.equal(Object.isFrozen(request.operation_capability), true);
        assert.equal(Object.getPrototypeOf(request.operation_capability), null);
        assert.equal(Object.hasOwn(request.operation_capability, 'prototype'), false);
        assert.throws(() => { request.operation_capability.private = 'forbidden'; });
        assert.throws(() => Object.defineProperty(
          request.operation_capability,
          'private',
          { value: 'forbidden' },
        ));
        assert.throws(() => Object.setPrototypeOf(request.operation_capability, {}));
        assert.equal(Object.hasOwn(request.operation_capability, 'private'), false);
        assert.throws(() => structuredClone(request));
        const override = await hooks.openStage?.({ request, source, metrics });
        if (override !== undefined) return override;
        const key = sourceKey(request.browser, source);
        const cursor = providerCursors.get(key) ?? 0;
        const stageFacts = facts[request.browser][source].slice(
          cursor,
          cursor + request.expected_observation_count,
        );
        assert.deepEqual(
          stageFacts.map(({ kind }) => kind),
          request.expected_kinds,
        );
        providerCursors.set(key, cursor + stageFacts.length);
        let index = 0;
        return {
          async next() {
            metrics.reads += 1;
            const hookResult = await hooks.next?.({
              request,
              source,
              metrics,
              index,
              stageFacts,
            });
            if (hookResult !== undefined) {
              index += 1;
              return hookResult;
            }
            if (index === stageFacts.length) {
              index += 1;
              return { done: true };
            }
            const observation = structuredClone(stageFacts[index].observation);
            index += 1;
            return { done: false, observation };
          },
          async close() {
            metrics.readerCloses += 1;
            await hooks.readerClose?.({ request, source, metrics });
          },
        };
      },
      async close() {
        metrics.providerCloses += 1;
        await hooks.providerClose?.({ source, metrics });
      },
    };
    return [source, provider];
  }));
  return { providers, metrics, facts };
}

function sourceFactRecorder(facts) {
  const cursors = new Map();
  const observations = [];
  return {
    observations,
    scope(browser, caseId, source, signal, recordHook) {
      const scope = {
        browser,
        case_id: caseId,
        signal,
        async record(observation) {
          await recordHook?.(observation);
          const key = sourceKey(browser, source);
          const cursor = cursors.get(key) ?? 0;
          const expected = facts[browser][source][cursor];
          validateIndependentSourceFact({
            schema: INDEPENDENT_SOURCE_FACT_SCHEMA,
            browser,
            source,
            sequence: cursor + 1,
            kind: expected.kind,
            elapsed_milliseconds: expected.elapsed_milliseconds,
            observation,
          }, browser, source, cursor + 1);
          cursors.set(key, cursor + 1);
          observations.push({ browser, case_id: caseId, source, observation });
          return true;
        },
      };
      Object.defineProperty(scope, 'toJSON', {
        configurable: false,
        enumerable: false,
        writable: false,
        value() {
          throw new Error('Source transport scope cannot be serialized');
        },
      });
      return Object.freeze(scope);
    },
  };
}

async function runCompleteSourceSchedule(transports, harness, signal) {
  const recorder = sourceFactRecorder(harness.facts);
  for (const { browser, case_id: caseId } of INDEPENDENT_CASE_ADAPTER_STAGE_ORDER) {
    const sources = Object.keys(INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[`${caseId}/${browser}`]);
    await Promise.all(sources.map((source) => transports[source].execute(
      recorder.scope(browser, caseId, source, signal),
    )));
  }
  await Promise.all(SOURCE_TRANSPORTS_SOURCE_ORDER.map((source) => transports[source].close()));
  return recorder.observations;
}

async function closeAll(transports) {
  return Promise.allSettled(
    SOURCE_TRANSPORTS_SOURCE_ORDER.map((source) => transports[source].close()),
  );
}

function firstScope(harness, source, signal, hook) {
  const invocation = SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE[source][0];
  return sourceFactRecorder(harness.facts).scope(
    invocation.browser,
    invocation.case_id,
    source,
    signal,
    hook,
  );
}

function copyPackage(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryPackageRoots.add(root);
  for (const name of PACKAGE_FILES) copyFileSync(new URL(name, PACKAGE_ROOT), join(root, name));
  return root;
}

test('profile fixes seven genuine dormant transports and the complete fact capacity', () => {
  const profile = validateBrowserRelaySourceTransportsProfile();
  assert.equal(profile.transport.source_order.length, 7);
  assert.equal(profile.transport.stage_count, SOURCE_TRANSPORTS_STAGE_COUNT);
  assert.equal(profile.transport.observations_per_matrix, SOURCE_TRANSPORTS_OBSERVATIONS_PER_MATRIX);
  assert.equal(profile.transport.observations_per_matrix, 43);
  assert.equal(profile.compatibility.genuine_source_transport_adapters_present, true);
  assert.equal(profile.compatibility.trusted_live_source_readers_present, false);
  assert.equal(profile.compatibility.network_implementation_present, false);
  assert.deepEqual(new Set(Object.values(profile.authority)), new Set([false]));
  assert.equal(profile.evidence.live_source_observations, 0);
  assert.equal(profile.evidence.incremental_monthly_cost_eur, 0);
  assert.equal(sourceTransportDependencyContractsSha256(),
    SOURCE_TRANSPORTS_DEPENDENCY_CONTRACTS_SHA256);
  assert.match(SOURCE_TRANSPORTS_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
});

test('production transports pull all 43 observations through the canonical stage schedule', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  assert.deepEqual(Object.keys(transports), SOURCE_TRANSPORTS_SOURCE_ORDER);
  assert.equal(Object.isFrozen(transports), true);
  for (const source of SOURCE_TRANSPORTS_SOURCE_ORDER) {
    assert.deepEqual(Object.keys(transports[source]), ['execute', 'close']);
    assert.equal(Object.isFrozen(transports[source]), true);
  }
  const observations = await runCompleteSourceSchedule(transports, harness, controller.signal);
  assert.equal(observations.length, 43);
  assert.equal(harness.metrics.opens.length, SOURCE_TRANSPORTS_STAGE_COUNT);
  assert.equal(harness.metrics.readerCloses, SOURCE_TRANSPORTS_STAGE_COUNT);
  assert.equal(harness.metrics.providerCloses, SOURCE_TRANSPORTS_SOURCE_ORDER.length);
  assert.equal(harness.metrics.capabilities.size, 1);
  assert.equal(harness.metrics.opens.every(({ signal }) => signal.aborted), true);
});

test('production transports accept scopes created by the actual independent adapter', async () => {
  const transportController = new AbortController();
  const scheduleController = new AbortController();
  const harness = createProviderHarness();
  const sourceObservers = createBrowserRelaySourceTransports(harness.providers, {
    signal: transportController.signal,
  });
  let projected = 0;
  const caseScope = ({ browser, case_id: caseId }) => {
    const scope = {
      browser,
      case_id: caseId,
      signal: scheduleController.signal,
      record(_source, projection) {
        assert.deepEqual(Reflect.ownKeys(projection), ['observation']);
        projected += 1;
        return true;
      },
    };
    Object.defineProperty(scope, 'toJSON', {
      configurable: false,
      enumerable: false,
      writable: false,
      value() {
        throw new Error('Case scope cannot be serialized');
      },
    });
    return Object.freeze(scope);
  };
  const components = {
    fixture: Object.freeze({}),
    async openChromiumPage() {},
    async openSecondaryPage() {},
    async prepareChromiumPhase() {},
    sourceObservers,
    browserLifecycle: {
      async startBrowser() {},
      async closeBrowser() {},
      async close() {},
    },
  };
  const runner = async ({ remainingAdapter }) => {
    await remainingAdapter.startBrowser('chromium', scheduleController.signal);
    for (const stage of INDEPENDENT_CASE_ADAPTER_STAGE_ORDER.slice(0, 8)) {
      await remainingAdapter.execute(caseScope(stage));
    }
    await remainingAdapter.startBrowser('firefox', scheduleController.signal);
    await remainingAdapter.execute(caseScope(INDEPENDENT_CASE_ADAPTER_STAGE_ORDER[8]));
    await remainingAdapter.closeBrowser('firefox', scheduleController.signal);
    await remainingAdapter.startBrowser('webkit', scheduleController.signal);
    await remainingAdapter.execute(caseScope(INDEPENDENT_CASE_ADAPTER_STAGE_ORDER[9]));
    await remainingAdapter.closeBrowser('webkit', scheduleController.signal);
    await remainingAdapter.execute(caseScope(INDEPENDENT_CASE_ADAPTER_STAGE_ORDER[10]));
    await remainingAdapter.closeBrowser('chromium', scheduleController.signal);
    await remainingAdapter.close();
    return { schema: 'miakapp.staging-browser-relay-runner-result/1' };
  };
  const result = await runBrowserRelayIndependentCaseScheduleForTesting(
    runner,
    components,
  );
  assert.equal(result.schema, 'miakapp.staging-browser-relay-runner-result/1');
  assert.equal(projected, SOURCE_TRANSPORTS_OBSERVATIONS_PER_MATRIX);
  assert.equal(harness.metrics.opens.length, SOURCE_TRANSPORTS_STAGE_COUNT);
  assert.equal(harness.metrics.providerCloses, SOURCE_TRANSPORTS_SOURCE_ORDER.length);
});

test('reader pulls await downstream record backpressure', async () => {
  const blocked = deferred();
  const controller = new AbortController();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransportsForTest(
    harness.providers,
    { signal: controller.signal },
    actualRuntime,
  );
  let records = 0;
  const execution = transports.firebase_app_check.execute(firstScope(
    harness,
    'firebase_app_check',
    controller.signal,
    async () => {
      records += 1;
      if (records === 1) await blocked.promise;
    },
  ));
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(harness.metrics.reads, 1);
  assert.equal(records, 1);
  blocked.resolve();
  await execution;
  assert.equal(records, 5);
  assert.equal(harness.metrics.reads, 6);
  await closeAll(transports);
});

test('an early EOF poisons the whole operation and closes the acquired reader once', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness({
    next({ index }) {
      if (index === 0) return { done: true };
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  await assert.rejects(
    transports.hosting.execute(firstScope(harness, 'hosting', controller.signal)),
    StagingBrowserRelaySourceTransportError,
  );
  await assert.rejects(
    transports.firebase_app_check.execute(
      firstScope(harness, 'firebase_app_check', controller.signal),
    ),
    StagingBrowserRelaySourceTransportError,
  );
  assert.equal(harness.metrics.readerCloses, 1);
  const results = await closeAll(transports);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('an excess value in place of EOF fails closed without a late record', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness({
    next({ index, stageFacts }) {
      if (index === stageFacts.length) {
        return { done: false, observation: structuredClone(stageFacts[0].observation) };
      }
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  const recorder = sourceFactRecorder(harness.facts);
  const invocation = SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE.hosting[0];
  await assert.rejects(transports.hosting.execute(recorder.scope(
    invocation.browser,
    invocation.case_id,
    'hosting',
    controller.signal,
  )), StagingBrowserRelaySourceTransportError);
  assert.equal(recorder.observations.length, 2);
  assert.equal(harness.metrics.readerCloses, 1);
  await closeAll(transports);
});

test('private material is rejected before downstream record', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness({
    next({ index }) {
      if (index === 0) return { done: false, observation: { token: 'private' } };
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  let records = 0;
  await assert.rejects(transports.hosting.execute(firstScope(
    harness,
    'hosting',
    controller.signal,
    () => { records += 1; },
  )), StagingBrowserRelaySourceTransportError);
  assert.equal(records, 0);
  await closeAll(transports);
});

test('source order and non-overlap are permanent protocol boundaries', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  const wrong = { ...firstScope(harness, 'hosting', controller.signal), case_id: 'LIVE-03' };
  await assert.rejects(
    transports.hosting.execute(wrong),
    StagingBrowserRelaySourceTransportError,
  );
  await assert.rejects(
    transports.hosting.execute(firstScope(harness, 'hosting', controller.signal)),
    StagingBrowserRelaySourceTransportError,
  );
  await closeAll(transports);
});

test('a concurrent execute poisons an otherwise valid pending stage', async () => {
  const opening = deferred();
  const openStarted = deferred();
  const controller = new AbortController();
  const harness = createProviderHarness({
    openStage({ source }) {
      if (source === 'hosting') {
        openStarted.resolve();
        return opening.promise;
      }
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  const scope = firstScope(harness, 'hosting', controller.signal);
  const first = transports.hosting.execute(scope);
  await openStarted.promise;
  await assert.rejects(
    transports.hosting.execute(scope),
    StagingBrowserRelaySourceTransportError,
  );
  opening.reject(new Error('provider failure detail'));
  await assert.rejects(first, StagingBrowserRelaySourceTransportError);
  await closeAll(transports);
});

test('provider and reader identities cannot cross operation or stage boundaries', async () => {
  const firstController = new AbortController();
  const harness = createProviderHarness();
  const first = createBrowserRelaySourceTransports(harness.providers, {
    signal: firstController.signal,
  });
  assert.throws(() => createBrowserRelaySourceTransports(harness.providers, {
    signal: new AbortController().signal,
  }), StagingBrowserRelaySourceTransportError);
  await closeAll(first);

  const duplicateHarness = createProviderHarness();
  const sharedFacts = duplicateHarness.facts.chromium.hosting;
  let sharedIndex = 0;
  const sharedReader = {
    async next() {
      if (sharedIndex === sharedFacts.length) {
        sharedIndex += 1;
        return { done: true };
      }
      const observation = structuredClone(sharedFacts[sharedIndex].observation);
      sharedIndex += 1;
      return { done: false, observation };
    },
    close: async () => undefined,
  };
  duplicateHarness.providers.hosting.openStage = async () => sharedReader;
  duplicateHarness.providers.firebase_app_check.openStage = async () => sharedReader;
  const secondController = new AbortController();
  const second = createBrowserRelaySourceTransports(duplicateHarness.providers, {
    signal: secondController.signal,
  });
  await second.hosting.execute(firstScope(
    duplicateHarness,
    'hosting',
    secondController.signal,
  ));
  await assert.rejects(
    second.firebase_app_check.execute(firstScope(
      duplicateHarness,
      'firebase_app_check',
      secondController.signal,
    )),
    StagingBrowserRelaySourceTransportError,
  );
  await closeAll(second);
});

test('abort during open settles execute first and closes a finite late reader', async () => {
  const opening = deferred();
  const openStarted = deferred();
  let lateReaderCloses = 0;
  const controller = new AbortController();
  const harness = createProviderHarness({
    openStage({ source }) {
      if (source === 'hosting') {
        openStarted.resolve();
        return opening.promise;
      }
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  const execution = transports.hosting.execute(
    firstScope(harness, 'hosting', controller.signal),
  );
  await openStarted.promise;
  controller.abort(new Error('external detail'));
  await assert.rejects(execution, (error) => (
    error instanceof StagingBrowserRelaySourceTransportError
      && !error.message.includes('external detail')
  ));
  const closing = closeAll(transports);
  opening.resolve({
    next: async () => ({ done: true }),
    close: async () => { lateReaderCloses += 1; },
  });
  await closing;
  assert.equal(lateReaderCloses, 1);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('an already-aborted operation never acquires a stage and closes all providers', async () => {
  const controller = new AbortController();
  controller.abort();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  await assert.rejects(
    transports.hosting.execute(firstScope(harness, 'hosting', controller.signal)),
    StagingBrowserRelaySourceTransportError,
  );
  assert.equal(harness.metrics.opens.length, 0);
  await closeAll(transports);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('active factory and scope cancellation ignore hostile signal property shadows', async (t) => {
  for (const boundary of ['factory', 'scope']) {
    await t.test(boundary, async () => {
      const factoryController = new AbortController();
      const scopeController = new AbortController();
      const hostileController = boundary === 'factory'
        ? factoryController
        : scopeController;
      const reading = deferred();
      const nextStarted = deferred();
      Object.defineProperties(hostileController.signal, {
        aborted: { configurable: true, value: false },
        addEventListener: { configurable: true, value() {} },
        removeEventListener: { configurable: true, value() {} },
      });
      const harness = createProviderHarness({
        next({ source, index }) {
          if (source === 'hosting' && index === 0) {
            nextStarted.resolve();
            return reading.promise;
          }
          return undefined;
        },
      });
      const transports = createBrowserRelaySourceTransports(harness.providers, {
        signal: factoryController.signal,
      });
      const execution = transports.hosting.execute(firstScope(
        harness,
        'hosting',
        scopeController.signal,
      ));
      await nextStarted.promise;
      hostileController.abort();
      try {
        await assert.rejects(
          withDeadline(execution, `${boundary} shadowed-signal abort`),
          StagingBrowserRelaySourceTransportError,
        );
      } finally {
        reading.resolve({ done: true });
        await closeAll(transports);
      }
      assert.equal(harness.metrics.providerCloses, 7);
    });
  }
});

test('provider tampering cannot hide request-signal cancellation', async () => {
  const reading = deferred();
  const nextStarted = deferred();
  const controller = new AbortController();
  let retainedSignal;
  const harness = createProviderHarness({
    openStage({ request, source }) {
      if (source === 'hosting') {
        retainedSignal = request.signal;
        Object.defineProperties(request.signal, {
          aborted: { configurable: true, value: false },
          addEventListener: { configurable: true, value() {} },
          removeEventListener: { configurable: true, value() {} },
        });
      }
      return undefined;
    },
    next({ source, index }) {
      if (source === 'hosting' && index === 0) {
        nextStarted.resolve();
        return reading.promise;
      }
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  const execution = transports.hosting.execute(
    firstScope(harness, 'hosting', controller.signal),
  );
  await nextStarted.promise;
  controller.abort();
  try {
    await assert.rejects(
      withDeadline(execution, 'shadowed request-signal abort'),
      StagingBrowserRelaySourceTransportError,
    );
  } finally {
    reading.resolve({ done: true });
    await closeAll(transports);
  }
  assert.equal(abortedGetter.call(retainedSignal), true);
});

test('abort during record suppresses all subsequent reads and records', async () => {
  const blocked = deferred();
  const controller = new AbortController();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  let records = 0;
  const execution = transports.firebase_app_check.execute(firstScope(
    harness,
    'firebase_app_check',
    controller.signal,
    async () => {
      records += 1;
      await blocked.promise;
    },
  ));
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(execution, StagingBrowserRelaySourceTransportError);
  blocked.resolve();
  await closeAll(transports);
  assert.equal(records, 1);
  assert.equal(harness.metrics.reads, 1);
});

test('abort in the read-to-record continuation gap suppresses the record callback', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness({
    next({ source, index, stageFacts }) {
      if (source !== 'hosting' || index !== 0) return undefined;
      const observation = new Proxy(structuredClone(stageFacts[0].observation), {
        getPrototypeOf(target) {
          controller.abort();
          return Object.getPrototypeOf(target);
        },
      });
      return { done: false, observation };
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  let records = 0;
  await assert.rejects(
    transports.hosting.execute(firstScope(
      harness,
      'hosting',
      controller.signal,
      () => { records += 1; },
    )),
    StagingBrowserRelaySourceTransportError,
  );
  assert.equal(records, 0);
  await closeAll(transports);
});

test('abort during next settles promptly, suppresses the late value and drains it on close', async () => {
  const reading = deferred();
  const controller = new AbortController();
  const harness = createProviderHarness({
    next({ source, index }) {
      if (source === 'hosting' && index === 0) return reading.promise;
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  let records = 0;
  const execution = transports.hosting.execute(firstScope(
    harness,
    'hosting',
    controller.signal,
    () => { records += 1; },
  ));
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  controller.abort(new Error('external abort detail'));
  try {
    await assert.rejects(
      withDeadline(execution, 'abort during next'),
      StagingBrowserRelaySourceTransportError,
    );
  } finally {
    reading.resolve({ done: true });
    await closeAll(transports);
  }
  assert.equal(records, 0);
  assert.equal(harness.metrics.readerCloses, 1);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('abort during reader close settles promptly and drains the finite close operation', async () => {
  const closeStarted = deferred();
  const closeRelease = deferred();
  const controller = new AbortController();
  const harness = createProviderHarness({
    readerClose({ source }) {
      if (source === 'hosting') {
        closeStarted.resolve();
        return closeRelease.promise;
      }
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  const execution = transports.hosting.execute(
    firstScope(harness, 'hosting', controller.signal),
  );
  await closeStarted.promise;
  controller.abort();
  try {
    await assert.rejects(
      withDeadline(execution, 'abort during reader close'),
      StagingBrowserRelaySourceTransportError,
    );
  } finally {
    closeRelease.resolve();
    await closeAll(transports);
  }
  assert.equal(harness.metrics.readerCloses, 1);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('record reentrancy permanently poisons the active source operation', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  let scope;
  let nested;
  scope = firstScope(harness, 'hosting', controller.signal, async () => {
    if (nested === undefined) {
      nested = transports.hosting.execute(scope);
      await assert.rejects(nested, StagingBrowserRelaySourceTransportError);
    }
  });
  await assert.rejects(
    transports.hosting.execute(scope),
    StagingBrowserRelaySourceTransportError,
  );
  await assert.rejects(
    transports.hosting.execute(scope),
    StagingBrowserRelaySourceTransportError,
  );
  await closeAll(transports);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('close reentry from active callbacks rejects without a promise cycle', async (t) => {
  for (const callbackName of ['openStage', 'next', 'record', 'readerClose']) {
    await t.test(callbackName, async () => {
      const controller = new AbortController();
      let transports;
      const reenter = async () => {
        await assert.rejects(
          transports.hosting.close(),
          StagingBrowserRelaySourceTransportError,
        );
      };
      const harness = createProviderHarness({
        async openStage({ source }) {
          if (callbackName === 'openStage' && source === 'hosting') await reenter();
          return undefined;
        },
        async next({ source, index }) {
          if (callbackName === 'next' && source === 'hosting' && index === 0) await reenter();
          return undefined;
        },
        async readerClose({ source }) {
          if (callbackName === 'readerClose' && source === 'hosting') await reenter();
        },
      });
      transports = createBrowserRelaySourceTransports(harness.providers, {
        signal: controller.signal,
      });
      const recordHook = callbackName === 'record' ? reenter : undefined;
      await assert.rejects(
        withDeadline(
          transports.hosting.execute(firstScope(
            harness,
            'hosting',
            controller.signal,
            recordHook,
          )),
          `close reentry from ${callbackName}`,
        ),
        StagingBrowserRelaySourceTransportError,
      );
      await withDeadline(closeAll(transports), `cleanup after ${callbackName} close reentry`);
      assert.equal(harness.metrics.providerCloses, 7);
    });
  }
});

test('provider-close reentry poisons an otherwise complete source close', async () => {
  const controller = new AbortController();
  let transports;
  const harness = createProviderHarness({
    async providerClose({ source }) {
      if (source === 'hosting') {
        await assert.rejects(
          transports.hosting.close(),
          StagingBrowserRelaySourceTransportError,
        );
      }
    },
  });
  transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  await transports.hosting.execute(firstScope(harness, 'hosting', controller.signal));
  await assert.rejects(
    withDeadline(transports.hosting.close(), 'provider-close reentry'),
    StagingBrowserRelaySourceTransportError,
  );
  await closeAll(transports);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('premature close is permanent and still closes every provider exactly once', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  await assert.rejects(transports.hosting.close(), StagingBrowserRelaySourceTransportError);
  await assert.rejects(
    transports.hosting.execute(firstScope(harness, 'hosting', controller.signal)),
    StagingBrowserRelaySourceTransportError,
  );
  const results = await closeAll(transports);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('provider errors and cleanup errors never escape verbatim', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness({
    openStage() {
      throw new Error('secret-provider-detail');
    },
    providerClose() {
      throw new Error('secret-cleanup-detail');
    },
  });
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  await assert.rejects(
    transports.hosting.execute(firstScope(harness, 'hosting', controller.signal)),
    (error) => error instanceof StagingBrowserRelaySourceTransportError
      && !error.message.includes('secret-provider-detail'),
  );
  const results = await closeAll(transports);
  assert.equal(results.every(({ status, reason }) => (
    status === 'rejected'
      && reason instanceof StagingBrowserRelaySourceTransportError
      && !reason.message.includes('secret-cleanup-detail')
  )), true);
});

test('reader cleanup errors and malformed provider thenables remain generic', async () => {
  const readerController = new AbortController();
  const readerHarness = createProviderHarness({
    readerClose() {
      throw new Error('secret-reader-cleanup-detail');
    },
  });
  const readerTransports = createBrowserRelaySourceTransports(readerHarness.providers, {
    signal: readerController.signal,
  });
  await assert.rejects(
    readerTransports.hosting.execute(
      firstScope(readerHarness, 'hosting', readerController.signal),
    ),
    (error) => error instanceof StagingBrowserRelaySourceTransportError
      && !error.message.includes('secret-reader-cleanup-detail'),
  );
  await closeAll(readerTransports);

  const thenableController = new AbortController();
  const thenableHarness = createProviderHarness();
  thenableHarness.providers.hosting.openStage = () => Object.defineProperty({}, 'then', {
    get() {
      throw new Error('secret-thenable-detail');
    },
  });
  const thenableTransports = createBrowserRelaySourceTransports(thenableHarness.providers, {
    signal: thenableController.signal,
  });
  await assert.rejects(
    thenableTransports.hosting.execute(
      firstScope(thenableHarness, 'hosting', thenableController.signal),
    ),
    (error) => error instanceof StagingBrowserRelaySourceTransportError
      && !error.message.includes('secret-thenable-detail'),
  );
  await closeAll(thenableTransports);
});

test('descriptor accessors and extra fields fail before provider acquisition', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  assert.throws(() => createBrowserRelaySourceTransports({
    ...harness.providers,
    get hosting() {
      throw new Error('getter detail');
    },
  }, { signal: controller.signal }), StagingBrowserRelaySourceTransportError);

  const cleanHarness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(cleanHarness.providers, {
    signal: controller.signal,
  });
  await assert.rejects(transports.hosting.execute({
    ...firstScope(cleanHarness, 'hosting', controller.signal),
    extra: true,
  }), StagingBrowserRelaySourceTransportError);
  assert.equal(cleanHarness.metrics.opens.length, 0);
  await closeAll(transports);
});

test('hostile factory Proxies, symbol keys and signals fail with generic branded errors', () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  const assertBranded = (callback) => assert.throws(callback, (error) => (
    error instanceof StagingBrowserRelaySourceTransportError
      && !error.message.includes('private-proxy-detail')
  ));

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assertBranded(() => createBrowserRelaySourceTransports(
    revoked.proxy,
    { signal: controller.signal },
  ));

  assertBranded(() => createBrowserRelaySourceTransports({
    ...harness.providers,
    [Symbol('unreviewed')]: true,
  }, { signal: controller.signal }));

  assertBranded(() => createBrowserRelaySourceTransports(new Proxy({}, {
    getPrototypeOf() {
      throw new Error('private-proxy-detail');
    },
  }), { signal: controller.signal }));

  const hostileSignal = new Proxy(controller.signal, {
    getPrototypeOf() {
      throw new Error('private-proxy-detail');
    },
  });
  assertBranded(() => createBrowserRelaySourceTransports(
    harness.providers,
    { signal: hostileSignal },
  ));
});

test('provider, option, reader and result records require exact data descriptors', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  const options = {};
  Object.defineProperty(options, 'signal', {
    enumerable: true,
    get() {
      throw new Error('option getter must not run');
    },
  });
  assert.throws(
    () => createBrowserRelaySourceTransports(harness.providers, options),
    StagingBrowserRelaySourceTransportError,
  );
  assert.throws(() => createBrowserRelaySourceTransports({
    ...harness.providers,
    hosting: { ...harness.providers.hosting, extra: true },
  }, { signal: controller.signal }), StagingBrowserRelaySourceTransportError);

  const readerHarness = createProviderHarness({
    openStage({ source }) {
      if (source !== 'hosting') return undefined;
      return {
        next: async () => ({ done: true }),
        close: async () => undefined,
        extra: true,
      };
    },
  });
  const readerTransports = createBrowserRelaySourceTransports(readerHarness.providers, {
    signal: controller.signal,
  });
  await assert.rejects(
    readerTransports.hosting.execute(
      firstScope(readerHarness, 'hosting', controller.signal),
    ),
    StagingBrowserRelaySourceTransportError,
  );
  await closeAll(readerTransports);

  const resultHarness = createProviderHarness({
    next({ source, index, stageFacts }) {
      if (source === 'hosting' && index === 0) {
        return {
          done: false,
          observation: structuredClone(stageFacts[0].observation),
          extra: true,
        };
      }
      return undefined;
    },
  });
  const resultTransports = createBrowserRelaySourceTransports(resultHarness.providers, {
    signal: new AbortController().signal,
  });
  let records = 0;
  await assert.rejects(
    resultTransports.hosting.execute(firstScope(
      resultHarness,
      'hosting',
      controller.signal,
      () => { records += 1; },
    )),
    StagingBrowserRelaySourceTransportError,
  );
  assert.equal(records, 0);
  await closeAll(resultTransports);
});

test('the production entrypoint ignores a caller-supplied runtime seam', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  let injectedCalls = 0;
  const injectedRuntime = {
    setTimeout() {
      injectedCalls += 1;
      throw new Error('production must not use an injected timer');
    },
    clearTimeout() {
      injectedCalls += 1;
    },
  };
  const transports = createBrowserRelaySourceTransports(
    harness.providers,
    { signal: controller.signal },
    injectedRuntime,
  );
  await transports.hosting.execute(firstScope(harness, 'hosting', controller.signal));
  await closeAll(transports);
  assert.equal(createBrowserRelaySourceTransports.length, 2);
  assert.equal(injectedCalls, 0);
});

test('controlled timeout aborts acquisition and drains a finite late settlement', async () => {
  const opening = deferred();
  const timers = [];
  const runtime = {
    setTimeout(callback) {
      const timer = { callback, cleared: false };
      timers.push(timer);
      queueMicrotask(callback);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
  };
  const controller = new AbortController();
  const harness = createProviderHarness({
    openStage({ source }) {
      return source === 'hosting' ? opening.promise : undefined;
    },
  });
  const transports = createBrowserRelaySourceTransportsForTest(
    harness.providers,
    { signal: controller.signal },
    runtime,
  );
  const execution = transports.hosting.execute(
    firstScope(harness, 'hosting', controller.signal),
  );
  await assert.rejects(execution, StagingBrowserRelaySourceTransportError);
  const closing = closeAll(transports);
  opening.resolve({ next: async () => ({ done: true }), close: async () => undefined });
  await closing;
  assert.equal(timers.length > 0, true);
  assert.equal(timers.every(({ cleared }) => cleared), true);
});

test('provider-close timeout waits for its finite late settlement before returning', async () => {
  const providerCloseStarted = deferred();
  const providerCloseRelease = deferred();
  const runtime = {
    setTimeout(callback) {
      const timer = { cleared: false };
      queueMicrotask(callback);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
  };
  const controller = new AbortController();
  const harness = createProviderHarness({
    providerClose({ source }) {
      if (source === 'hosting') {
        providerCloseStarted.resolve();
        return providerCloseRelease.promise;
      }
      return undefined;
    },
  });
  const transports = createBrowserRelaySourceTransportsForTest(
    harness.providers,
    { signal: controller.signal },
    runtime,
  );
  const cleanup = closeAll(transports);
  let settled = false;
  void cleanup.then(() => { settled = true; });
  await providerCloseStarted.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  providerCloseRelease.resolve();
  const results = await withDeadline(cleanup, 'finite late provider close');
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('successful providers close once and repeated source close is rejected', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  await runCompleteSourceSchedule(transports, harness, controller.signal);
  await assert.rejects(transports.hosting.close(), StagingBrowserRelaySourceTransportError);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('closed transports release strong provider references', () => {
  const moduleUrl = new URL('../browser-relay-source-transports/transports.mjs', import.meta.url);
  const contractUrl = new URL('../browser-relay-source-transports/contract.mjs', import.meta.url);
  const script = `
    import { createBrowserRelaySourceTransports } from ${JSON.stringify(moduleUrl.href)};
    import { SOURCE_TRANSPORTS_SOURCE_ORDER } from ${JSON.stringify(contractUrl.href)};
    let providers = Object.fromEntries(SOURCE_TRANSPORTS_SOURCE_ORDER.map((source) => [source, {
      async openStage() { throw new Error('unused'); },
      async close() {},
    }]));
    const reference = new WeakRef(providers.hosting);
    const transports = createBrowserRelaySourceTransports(
      providers,
      { signal: new AbortController().signal },
    );
    providers = undefined;
    await Promise.allSettled(Object.values(transports).map((transport) => transport.close()));
    for (let index = 0; index < 20; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      globalThis.gc();
      void new Uint8Array(1024 * 1024);
    }
    if (reference.deref() !== undefined) throw new Error('closed transport retained provider');
  `;
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', '--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test('duplicate close poisons peer sources before their next acquisition', async () => {
  const controller = new AbortController();
  const harness = createProviderHarness();
  const transports = createBrowserRelaySourceTransports(harness.providers, {
    signal: controller.signal,
  });
  await transports.hosting.execute(firstScope(harness, 'hosting', controller.signal));
  await transports.hosting.close();
  assert.equal(harness.metrics.opens.length, 1);
  await assert.rejects(transports.hosting.close(), StagingBrowserRelaySourceTransportError);
  await assert.rejects(
    transports.control_plane.execute(
      firstScope(harness, 'control_plane', controller.signal),
    ),
    StagingBrowserRelaySourceTransportError,
  );
  assert.equal(harness.metrics.opens.length, 1);
  await closeAll(transports);
  assert.equal(harness.metrics.providerCloses, 7);
});

test('package guard accepts only the reviewed source-only root', () => {
  const profile = validateBrowserRelaySourceTransportsRoot(PACKAGE_ROOT);
  assert.equal(profile.schema, 'miakapp.staging-browser-relay-source-transports-profile/1');
});

test('package guard rejects extra, linked, executable, network and target drift', () => {
  const extraRoot = copyPackage('miakapp-source-transports-extra-');
  writeFileSync(join(extraRoot, 'extra.txt'), 'extra\n');
  assert.throws(() => validateBrowserRelaySourceTransportsRoot(
    new URL(`file://${extraRoot}/`),
  ));

  const linkRoot = copyPackage('miakapp-source-transports-link-');
  rmSync(join(linkRoot, 'README.md'));
  symlinkSync(join(linkRoot, 'contract.mjs'), join(linkRoot, 'README.md'));
  assert.throws(() => validateBrowserRelaySourceTransportsRoot(
    new URL(`file://${linkRoot}/`),
  ));

  const executableRoot = copyPackage('miakapp-source-transports-exec-');
  chmodSync(join(executableRoot, 'transports.mjs'), 0o755);
  assert.throws(() => validateBrowserRelaySourceTransportsRoot(
    new URL(`file://${executableRoot}/`),
  ));

  const profileRoot = copyPackage('miakapp-source-transports-profile-');
  const profile = JSON.parse(readFileSync(join(profileRoot, 'profile.json'), 'utf8'));
  profile.authority.network_requests_authorized = true;
  writeFileSync(join(profileRoot, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);
  assert.throws(() => validateBrowserRelaySourceTransportsRoot(
    new URL(`file://${profileRoot}/`),
  ));

  for (const name of ['contract.mjs', 'guard.mjs', 'internal.mjs']) {
    const root = copyPackage(`miakapp-source-transports-digest-${name}-`);
    writeFileSync(
      join(root, name),
      `${readFileSync(join(root, name), 'utf8')}\n// digest drift\n`,
    );
    assert.throws(() => validateBrowserRelaySourceTransportsRoot(
      new URL(`file://${root}/`),
    ));
  }

  for (const [name, injected] of [
    ['network', '\nconst drift = fetch;\n'],
    ['target', '\nconst drift = "miakapp-3";\n'],
    ['dynamic', '\nconst drift = import("node:fs");\n'],
    ['credential', '\nconst drift = "ya29.private-credential-literal";\n'],
  ]) {
    const root = copyPackage(`miakapp-source-transports-${name}-`);
    writeFileSync(join(root, 'transports.mjs'),
      `${readFileSync(join(root, 'transports.mjs'), 'utf8')}${injected}`);
    assert.throws(() => validateBrowserRelaySourceTransportsRoot(
      new URL(`file://${root}/`),
    ));
  }
});
