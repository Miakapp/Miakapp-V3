import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import {
  createBrowserRelayAuthenticatedSourceReaders,
} from '../browser-relay-authenticated-source-readers/readers.mjs';
import {
  runBrowserRelayCaseScheduleForTest,
} from '../browser-relay-case-scheduler/testing.mjs';
import {
  runBrowserRelayChromiumCaseScheduleForTesting,
} from '../browser-relay-chromium-case-adapter/testing.mjs';
import {
  CHROMIUM_SCENARIO_RESULT_SCHEMA,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  createBrowserRelayEvidenceSessionForTest,
} from '../browser-relay-evidence-session/testing.mjs';
import {
  INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE,
  INDEPENDENT_CASE_ADAPTER_STAGE_ORDER,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  runBrowserRelayIndependentCaseScheduleForTesting,
} from '../browser-relay-independent-case-adapter/testing.mjs';
import {
  createBrowserRelayPageReceiptProducer,
} from '../browser-relay-page-receipt/producer.mjs';
import {
  TARGET_URL,
} from '../browser-relay-page/contract.mjs';
import {
  runBrowserRelayPlaywrightBridge,
} from '../browser-relay-playwright-bridge/bridge.mjs';
import {
  runBrowserRelaySecondaryCaseScheduleForTesting,
} from '../browser-relay-secondary-case-adapter/testing.mjs';
import {
  createBrowserRelaySourceAuthorityAdapters,
} from '../browser-relay-source-authority-adapters/adapters.mjs';
import {
  createBrowserRelaySourceClients,
} from '../browser-relay-source-clients/clients.mjs';
import {
  createBrowserRelaySourceSessions,
} from '../browser-relay-source-session-producers/producers.mjs';
import {
  createBrowserRelaySourceTransports,
} from '../browser-relay-source-transports/transports.mjs';
import {
  createBrowserRelayTrustedSourceComposition,
} from '../browser-relay-trusted-source-composition/composition.mjs';
import {
  TRUSTED_SOURCE_COMPOSITION_DEPENDENCY_CONTRACTS_SHA256,
  TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE,
  TRUSTED_SOURCE_COMPOSITION_MATRIX_COMPONENT_FIELDS,
  TRUSTED_SOURCE_COMPOSITION_MAXIMUM_PROVIDER_LIFETIME_MILLISECONDS,
  TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX,
  TRUSTED_SOURCE_COMPOSITION_PROFILE_SHA256,
  TRUSTED_SOURCE_COMPOSITION_PROVIDER_CONTEXT_FIELDS,
  TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE,
  TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE,
  TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER,
  TRUSTED_SOURCE_COMPOSITION_STAGE_COUNT,
  TRUSTED_SOURCE_COMPOSITION_TARGETS_BY_SOURCE_AND_KIND,
  StagingBrowserRelayTrustedSourceCompositionError,
  createTrustedSourceProviderContext,
  createTrustedSourceReceipt,
  trustedSourceCompositionDependencyContractsSha256,
  validateBrowserRelayTrustedSourceCompositionProfile,
  validateTrustedSourceAcquireDescriptor,
} from '../browser-relay-trusted-source-composition/contract.mjs';
import {
  validateBrowserRelayTrustedSourceCompositionRoot,
} from '../browser-relay-trusted-source-composition/guard.mjs';
import {
  createBrowserRelayTrustedSourceCompositionForTesting,
} from '../browser-relay-trusted-source-composition/testing.mjs';
import {
  chromiumPageFacts,
  fullIndependentFacts,
  pageProjection,
  secondaryPageFacts,
} from './helpers/browser-relay-evidence-fixture.mjs';

const PACKAGE_ROOT = new URL(
  '../browser-relay-trusted-source-composition/',
  import.meta.url,
);
const NOW = Date.now();
const STATE_EXPECTATION_SCHEMA =
  'miakapp.staging-browser-relay-fixture-state-expectation/1';
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

function protocolRecord(fields) {
  const value = Object.create(null);
  for (const [field, entry] of Object.entries(fields)) {
    Object.defineProperty(value, field, {
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
    value() { throw new StagingBrowserRelayTrustedSourceCompositionError(); },
  });
  return Object.freeze(value);
}

function requestCapability() {
  const capability = () => {
    throw new StagingBrowserRelayTrustedSourceCompositionError();
  };
  Object.setPrototypeOf(capability, null);
  return Object.freeze(capability);
}

function acquireDescriptor(source, cursor, signal, overrides = {}) {
  const call = TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE[source][cursor];
  return protocolRecord({
    source,
    scope: TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE[source],
    browser: call.browser,
    case_id: call.case_id,
    kind: call.kind,
    target: TRUSTED_SOURCE_COMPOSITION_TARGETS_BY_SOURCE_AND_KIND[source][call.kind],
    signal,
    request_capability: requestCapability(),
    ...overrides,
  });
}

function compositionError(error) {
  assert.equal(error instanceof StagingBrowserRelayTrustedSourceCompositionError, true);
  assert.equal(error.name, 'StagingBrowserRelayTrustedSourceCompositionError');
  assert.equal(
    error.message,
    'Staging browser-relay trusted source composition failed closed',
  );
  assert.equal(error.message.includes('private'), false);
  assert.equal(error.message.includes('Bearer'), false);
  return true;
}

function candidateObservation(facts, source, browser, kind) {
  const fact = facts[browser][source].find((entry) => entry.kind === kind);
  assert.notEqual(fact, undefined);
  return structuredClone(fact.observation);
}

function providerHarness({ hooks = {}, expiresAt = NOW + 15 * 60_000 } = {}) {
  const facts = fullIndependentFacts();
  const metrics = {
    calls: [],
    closes: [],
    closeSignals: [],
    contexts: [],
    releases: [],
  };
  const providers = Object.freeze(Object.fromEntries(
    TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => {
      let cursor = 0;
      let provider;
      const methods = Object.fromEntries(
        TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE[source].map((kind) => [
          kind,
          async function observe(context) {
            assert.equal(this, provider);
            const expected = TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE[source][cursor];
            assert.equal(expected.kind, kind);
            assert.equal(expected.browser, context.browser);
            assert.equal(expected.case_id, context.case_id);
            cursor += 1;
            metrics.calls.push({ source, kind, browser: context.browser, case_id: context.case_id });
            metrics.contexts.push({ source, kind, context });
            const override = await hooks.observe?.({
              source,
              kind,
              context,
              metrics,
              facts,
            });
            if (override?.handled === true) return override.value;
            return candidateObservation(facts, source, context.browser, kind);
          },
        ]),
      );
      provider = Object.freeze({
        source,
        scope: TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE[source],
        expires_at_milliseconds: expiresAt,
        ...methods,
        async close(signal) {
          metrics.closes.push(source);
          metrics.closeSignals.push({ source, signal });
          return hooks.close?.({ source, signal, metrics });
        },
      });
      return [source, provider];
    }),
  ));
  return { facts, metrics, providers, expiresAt };
}

function token(character) {
  return `${character.repeat(32)}.${character.repeat(32)}.${character.repeat(32)}`;
}

function controlledAdvancingClock() {
  const origin = 70_000_000_000n;
  let elapsedNanoseconds = 0n;
  let lastNanoseconds = 0n;
  return {
    clock() {
      lastNanoseconds = elapsedNanoseconds;
      return origin + lastNanoseconds;
    },
    advanceMilliseconds(value = 1) {
      elapsedNanoseconds += BigInt(value) * 1_000_000n;
    },
    setAtLeastMilliseconds(value) {
      const candidate = BigInt(value) * 1_000_000n;
      if (candidate > elapsedNanoseconds) elapsedNanoseconds = candidate;
    },
    lastMilliseconds() {
      return Number(lastNanoseconds / 1_000_000n);
    },
  };
}

function closedChromiumScenarioResult() {
  const producer = createBrowserRelayPageReceiptProducer('chromium');
  for (const fact of chromiumPageFacts()) producer.record(fact);
  return Object.freeze({
    schema: CHROMIUM_SCENARIO_RESULT_SCHEMA,
    browser: 'chromium',
    state: 'receipt_closed',
    private_inputs_requested: 2,
    page_instances: 2,
    native_bfcache_restores: 1,
    receipt: producer.close(),
  });
}

function mockSecondaryPage(browser, trace) {
  const facts = secondaryPageFacts(browser);
  let closeCalls = 0;
  return {
    closeCalls: () => closeCalls,
    url: () => TARGET_URL,
    async evaluate(_callback, { selectedAction }) {
      const index = ['initialize', 'start', 'stop'].indexOf(selectedAction);
      assert.notEqual(index, -1);
      trace.push(`page:${browser}:${selectedAction}`);
      return {
        state: 'completed',
        observation: structuredClone(facts[index].observation),
        lifecycle_observation: structuredClone(facts[index].lifecycle_observation),
      };
    },
    async close() {
      closeCalls += 1;
      trace.push(`page:${browser}:closed`);
    },
  };
}

function createReadyFixture(trace) {
  let revision = 1;
  let temperature = 20;
  let tokenIndex = 0;
  const expectation = () => Object.freeze({
    schema: STATE_EXPECTATION_SCHEMA,
    path: 'acceptance.temperature',
    revision,
    value: temperature,
  });
  return {
    stateExpectation() {
      trace.push('fixture:stateExpectation');
      return expectation();
    },
    async setTemperature(value) {
      trace.push(`fixture:setTemperature:${value}`);
      revision += 1;
      temperature = value;
      return expectation();
    },
    async privateInput(browser, identityGeneration) {
      trace.push(`fixture:privateInput:${browser}:${identityGeneration}`);
      tokenIndex += 1;
      return Object.freeze({
        schema: 'miakapp.staging-browser-relay-page-input/1',
        browser,
        firebase_custom_token: token(String.fromCharCode(96 + tokenIndex)),
      });
    },
    async rotateRelayToB() {
      trace.push('fixture:rotateRelayToB');
      return true;
    },
  };
}

function createChromiumScenarioRunner({ browserStarts, clock, trace, waitForSources }) {
  return async (dependencies, port, options) => {
    const facts = chromiumPageFacts();
    const record = async (sequence) => {
      clock.setAtLeastMilliseconds(
        browserStarts.chromium + facts[sequence - 1].elapsed_milliseconds,
      );
      assert.equal(await port.record(pageProjection(facts[sequence - 1]), options.signal), true);
    };
    await dependencies.openPage(1, options.signal);
    await dependencies.privateInputProvider('chromium', 1, options.signal);
    await record(1);
    await record(2);
    const control = (phase) => dependencies.controlPhase(phase, options.signal);
    await control('authoritative_state');
    await record(3);
    await control('patched_state');
    await record(4);
    await control('initial_call');
    await record(5);
    await control('same_relay_reauthenticated');
    await waitForSources('LIVE-05');
    await record(6);
    await control('relay_handoff_stale');
    await waitForSources('LIVE-06');
    await record(7);
    await control('relay_b_ready');
    await record(8);
    await control('relay_b_state');
    await record(9);
    await control('relay_b_call');
    await record(10);
    await control('failed_call');
    await control('uncertain_call');
    await waitForSources('LIVE-08');
    await record(11);
    await control('relay_b_recovered');
    await record(12);
    for (let sequence = 13; sequence <= 15; sequence += 1) await record(sequence);
    await dependencies.openPage(2, options.signal);
    await dependencies.privateInputProvider('chromium', 2, options.signal);
    for (let sequence = 16; sequence <= 18; sequence += 1) await record(sequence);
    trace.push('chromium:scenario-closed');
    return closedChromiumScenarioResult();
  };
}

function createTimedSourceObservers(observers, { browserStarts, clock, facts }) {
  const cursors = Object.fromEntries(Object.entries(facts).map(([browser, sources]) => [
    browser,
    Object.fromEntries(Object.keys(sources).map((source) => [source, 0])),
  ]));
  const stages = new Map();
  let executions = 0;

  function stageState(browser, caseId) {
    const key = `${caseId}/${browser}`;
    let state = stages.get(key);
    if (state !== undefined) return state;
    let stableOrder = 0;
    const expected = [];
    for (const [source, kinds] of Object.entries(
      INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[key],
    )) {
      const start = cursors[browser][source];
      const sourceFacts = facts[browser][source].slice(start, start + kinds.length);
      assert.deepEqual(sourceFacts.map(({ kind }) => kind), kinds);
      for (const fact of sourceFacts) {
        expected.push({
          elapsed_milliseconds: fact.elapsed_milliseconds,
          kind: fact.kind,
          order: stableOrder += 1,
          source,
        });
      }
    }
    expected.sort((left, right) => (
      left.elapsed_milliseconds - right.elapsed_milliseconds || left.order - right.order
    ));
    state = { expected, index: 0, pending: new Map(), completion: deferred() };
    stages.set(key, state);
    if (expected.length === 0) state.completion.resolve();
    return state;
  }

  function driveStage(state, browser) {
    while (state.index < state.expected.length) {
      const next = state.expected[state.index];
      const pending = state.pending.get(next.source);
      if (pending === undefined || pending.kind !== next.kind) return;
      state.pending.delete(next.source);
      try {
        clock.setAtLeastMilliseconds(
          browserStarts[browser] + next.elapsed_milliseconds,
        );
        assert.equal(pending.scope.record(pending.observation), true);
        cursors[browser][next.source] += 1;
        state.index += 1;
        pending.resolve(true);
        if (state.index === state.expected.length) state.completion.resolve();
      } catch (error) {
        pending.reject(error);
        state.completion.reject(error);
      }
    }
  }

  const sourceObservers = Object.freeze(Object.fromEntries(
    TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => [source, Object.freeze({
      execute(scope) {
        executions += 1;
        const state = stageState(scope.browser, scope.case_id);
        const timedScope = {
          browser: scope.browser,
          case_id: scope.case_id,
          signal: scope.signal,
          record(observation) {
            const cursor = cursors[scope.browser][source];
            const fact = facts[scope.browser][source][cursor];
            assert.notEqual(fact, undefined);
            assert.deepEqual(observation, fact.observation);
            assert.equal(state.pending.has(source), false);
            const completion = deferred();
            state.pending.set(source, {
              ...completion,
              kind: fact.kind,
              observation,
              scope,
            });
            driveStage(state, scope.browser);
            return completion.promise;
          },
        };
        Object.defineProperty(timedScope, 'toJSON', {
          configurable: false,
          enumerable: false,
          writable: false,
          value() { throw new Error('Timed source scope cannot be serialized'); },
        });
        return observers[source].execute(Object.freeze(timedScope));
      },
      close() {
        return observers[source].close();
      },
    })]),
  ));

  return Object.freeze({
    assertComplete() {
      assert.equal(executions, TRUSTED_SOURCE_COMPOSITION_STAGE_COUNT);
      for (const [browser, sources] of Object.entries(facts)) {
        for (const [source, sourceFacts] of Object.entries(sources)) {
          assert.equal(cursors[browser][source], sourceFacts.length);
        }
      }
      for (const state of stages.values()) {
        assert.equal(state.index, state.expected.length);
        assert.equal(state.pending.size, 0);
      }
    },
    sourceObservers,
    waitForStage(caseId, browser = 'chromium') {
      return stageState(browser, caseId).completion.promise;
    },
  });
}

function completeMatrixHarness() {
  const browserStarts = { chromium: undefined, firefox: undefined, webkit: undefined };
  const clock = controlledAdvancingClock();
  const pages = {};
  const trace = [];
  let timedSources;
  let browserLifecycleCloseCalls = 0;
  const harness = providerHarness();
  const matrix = Object.freeze({
    fixture: createReadyFixture(trace),
    async openChromiumPage(pageInstance) {
      trace.push(`openChromiumPage:${pageInstance}`);
      return Object.freeze({ pageInstance });
    },
    async openSecondaryPage(browser) {
      trace.push(`openSecondaryPage:${browser}`);
      pages[browser] = mockSecondaryPage(browser, trace);
      return pages[browser];
    },
    async prepareChromiumPhase(phase) {
      trace.push(`prepareChromiumPhase:${phase}`);
    },
    browserLifecycle: Object.freeze({
      async startBrowser(browser) {
        trace.push(`lifecycle:startBrowser:${browser}`);
        clock.advanceMilliseconds();
        browserStarts[browser] = clock.lastMilliseconds();
      },
      async closeBrowser(browser) {
        trace.push(`lifecycle:closeBrowser:${browser}`);
        clock.advanceMilliseconds();
      },
      async close() {
        browserLifecycleCloseCalls += 1;
        trace.push('lifecycle:close');
      },
    }),
  });
  const scenarioRunner = createChromiumScenarioRunner({
    browserStarts,
    clock,
    trace,
    waitForSources(caseId) {
      return timedSources.waitForStage(caseId);
    },
  });
  const schedulerRunner = (adapter, options) => runBrowserRelayCaseScheduleForTest(
    () => {
      trace.push('session:create');
      const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
      browserStarts.chromium = clock.lastMilliseconds();
      return session;
    },
    adapter,
    options,
  );
  const chromiumCaseRunner = (components, options) => (
    runBrowserRelayChromiumCaseScheduleForTesting(
      schedulerRunner,
      scenarioRunner,
      components,
      options,
    )
  );
  const secondaryCaseRunner = (components, options) => (
    runBrowserRelaySecondaryCaseScheduleForTesting(
      chromiumCaseRunner,
      runBrowserRelayPlaywrightBridge,
      components,
      options,
    )
  );
  return {
    ...harness,
    browserLifecycleCloseCalls: () => browserLifecycleCloseCalls,
    matrix,
    pages,
    run(completeMatrix) {
      timedSources = createTimedSourceObservers(completeMatrix.sourceObservers, {
        browserStarts,
        clock,
        facts: harness.facts,
      });
      const timedMatrix = Object.freeze({
        ...completeMatrix,
        sourceObservers: timedSources.sourceObservers,
      });
      return runBrowserRelayIndependentCaseScheduleForTesting(
        secondaryCaseRunner,
        timedMatrix,
      ).then((result) => {
        timedSources.assertComplete();
        return result;
      });
    },
    trace,
  };
}

function operationComponents() {
  return Object.freeze({
    acquireClaim: async () => true,
    closeRelaysPrivateReady: async () => true,
    createSyntheticFixture: async () => true,
    edgeClient: Object.freeze({
      async observe() {},
      async setRuntimeProfile() {},
      async setIngress() {},
      async setPublicInvoker() {},
      async closeIngress() {},
    }),
    observeClaimAbsent: async () => true,
    observeWindowBaseline: async () => true,
    openRelaysPublic: async () => true,
    publishRunner: async () => true,
    removeRunner: async () => true,
    removeSyntheticFixture: async () => true,
    removeTemporaryBindings: async () => true,
    sampleMonitoring: async () => true,
    stopSessions: async () => true,
    validateAuthorization: async () => true,
    verifyFinalCleanup: async () => true,
    verifyRunner: async () => true,
    verifyWindowCleanup: async () => true,
  });
}

function matrixComponents() {
  return Object.freeze({
    fixture: Object.freeze({}),
    async openChromiumPage() {},
    async openSecondaryPage() {},
    async prepareChromiumPhase() {},
    browserLifecycle: Object.freeze({
      async startBrowser() {},
      async closeBrowser() {},
      async close() {},
    }),
  });
}

function rootFor(harness, overrides = {}) {
  return {
    providers: overrides.providers ?? harness.providers,
    operation: overrides.operation ?? operationComponents(),
    matrix: overrides.matrix ?? matrixComponents(),
    ...overrides.root,
  };
}

function recordScope(facts, records, cursors, source, browser, caseId, signal) {
  const scope = {
    browser,
    case_id: caseId,
    signal,
    async record(observation) {
      const key = `${browser}/${source}`;
      const cursor = cursors.get(key) ?? 0;
      const expected = facts[browser][source][cursor];
      assert.notEqual(expected, undefined);
      assert.deepEqual(observation, expected.observation);
      cursors.set(key, cursor + 1);
      records.push({ source, browser, case_id: caseId, kind: expected.kind });
      return true;
    },
  };
  Object.defineProperty(scope, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() { throw new Error('Test source scope cannot be serialized'); },
  });
  return Object.freeze(scope);
}

function canonicalOperationRunner(harness, result = Object.freeze({ state: 'offline_closed' })) {
  return async ({ matrix }) => {
    const controller = new AbortController();
    const records = [];
    const cursors = new Map();
    for (const { browser, case_id: caseId } of INDEPENDENT_CASE_ADAPTER_STAGE_ORDER) {
      const sources = Object.keys(
        INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[`${caseId}/${browser}`],
      );
      await Promise.all(sources.map((source) => matrix.sourceObservers[source].execute(
        recordScope(harness.facts, records, cursors, source, browser, caseId, controller.signal),
      )));
    }
    await Promise.all(TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => (
      matrix.sourceObservers[source].close()
    )));
    assert.equal(records.length, TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX);
    return result;
  };
}

function runtimeFor(harness, overrides = {}) {
  return {
    clock: () => NOW,
    create_source_clients: createBrowserRelaySourceClients,
    create_source_sessions: createBrowserRelaySourceSessions,
    create_authority_adapters: createBrowserRelaySourceAuthorityAdapters,
    create_authenticated_readers: createBrowserRelayAuthenticatedSourceReaders,
    create_source_transports: createBrowserRelaySourceTransports,
    run_operation_case: canonicalOperationRunner(harness),
    provider_released(source) {
      harness.metrics.releases.push(source);
    },
    ...overrides,
  };
}

function trackCloseMap(map, layer, closes) {
  return Object.freeze(Object.fromEntries(
    TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => {
      const original = map[source];
      return [source, Object.freeze({
        ...original,
        close(...args) {
          closes.push({ layer, source });
          return Reflect.apply(original.close, original, args);
        },
      })];
    }),
  ));
}

function createControlledComposition(harness, overrides = {}) {
  const controller = overrides.controller ?? new AbortController();
  const composition = createBrowserRelayTrustedSourceCompositionForTesting(
    rootFor(harness, overrides),
    { signal: controller.signal },
    runtimeFor(harness, overrides.runtime),
  );
  return { composition, controller };
}

function manualAuthorities(harness) {
  return Object.freeze(Object.fromEntries(
    TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => {
      let cursor = 0;
      const provider = harness.providers[source];
      return [source, Object.freeze({
        source,
        scope: TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE[source],
        expires_at_milliseconds: harness.expiresAt,
        async acquire(descriptor) {
          const context = validateTrustedSourceAcquireDescriptor(descriptor, source, cursor);
          cursor += 1;
          const providerContext = createTrustedSourceProviderContext(context);
          const observation = await provider[context.kind](providerContext);
          return createTrustedSourceReceipt(context, observation);
        },
        async close(signal) {
          return provider.close(signal);
        },
      })];
    }),
  ));
}

function manualObservers(harness, controller) {
  const clients = createBrowserRelaySourceClients(manualAuthorities(harness), {
    signal: controller.signal,
  });
  const expiringOptions = {
    signal: controller.signal,
    expires_at_milliseconds: harness.expiresAt,
  };
  const sessions = createBrowserRelaySourceSessions(clients, expiringOptions);
  const authorities = createBrowserRelaySourceAuthorityAdapters(sessions, expiringOptions);
  const readers = createBrowserRelayAuthenticatedSourceReaders(authorities, expiringOptions);
  return createBrowserRelaySourceTransports(readers, { signal: controller.signal });
}

async function runObservers(harness, observers, signal) {
  return canonicalOperationRunner(harness)({ matrix: { sourceObservers: observers }, signal });
}

function normalizedCalls(metrics) {
  return Object.fromEntries(TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => [
    source,
    metrics.calls.filter((call) => call.source === source).map((call) => ({
      browser: call.browser,
      case_id: call.case_id,
      kind: call.kind,
    })),
  ]));
}

function copiedPackageRoot() {
  const parent = mkdtempSync(join(tmpdir(), 'miakapp-trusted-source-composition-'));
  temporaryRoots.add(parent);
  const root = join(parent, 'package');
  cpSync(PACKAGE_ROOT, root, { recursive: true });
  return new URL(`file://${root}/`);
}

test('pins one dormant seven-provider composition with no live evidence', () => {
  const profile = validateBrowserRelayTrustedSourceCompositionProfile();
  assert.equal(
    trustedSourceCompositionDependencyContractsSha256(),
    TRUSTED_SOURCE_COMPOSITION_DEPENDENCY_CONTRACTS_SHA256,
  );
  assert.equal(profile.providers.source_order.length, 7);
  assert.equal(profile.composition.stage_count, TRUSTED_SOURCE_COMPOSITION_STAGE_COUNT);
  assert.equal(
    profile.composition.observations_per_matrix,
    TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX,
  );
  assert.equal(profile.lifecycle.strategy, 'differential_conformance');
  assert.equal(profile.compatibility.operation_case_adapter_wired, true);
  assert.equal(profile.compatibility.named_trusted_live_provider_capabilities_present, true);
  assert.equal(profile.compatibility.built_in_live_source_implementations_present, false);
  assert.equal(profile.evidence.live_execution_count, 0);
  assert.equal(profile.evidence.incremental_monthly_cost_eur, 0);
  assert.match(TRUSTED_SOURCE_COMPOSITION_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
});

test('constructs dormant and executes all 22 stages and 43 observations once', async () => {
  const harness = providerHarness();
  const { composition } = createControlledComposition(harness);
  assert.deepEqual(harness.metrics.calls, []);
  assert.deepEqual(harness.metrics.closes, []);
  assert.deepEqual(Reflect.ownKeys(composition), ['execute', 'close']);
  assert.equal(Object.isFrozen(composition), true);

  const result = await composition.execute();
  assert.deepEqual(result, { state: 'offline_closed' });
  assert.equal(harness.metrics.calls.length, TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX);
  assert.equal(harness.metrics.closes.length, TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length);
  assert.equal(harness.metrics.releases.length, TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
  for (const { context } of harness.metrics.contexts) {
    assert.deepEqual(Object.keys(context), TRUSTED_SOURCE_COMPOSITION_PROVIDER_CONTEXT_FIELDS);
    assert.deepEqual(
      Reflect.ownKeys(context).sort(),
      [...TRUSTED_SOURCE_COMPOSITION_PROVIDER_CONTEXT_FIELDS, 'toJSON'].sort(),
    );
    assert.equal(Object.getPrototypeOf(context), null);
    assert.equal(Object.isFrozen(context), true);
    assert.equal('source' in context, false);
    assert.equal('kind' in context, false);
    assert.equal('target' in context, false);
    assert.equal('request_capability' in context, false);
    assert.equal(context.signal.aborted, true);
    assert.throws(() => JSON.stringify(context), compositionError);
  }
  await composition.close();
  assert.equal(harness.metrics.closes.length, TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length);
});

test('executes the six production hard-wired factories through the real operation adapter', {
  timeout: 5_000,
}, async () => {
  const harness = providerHarness();
  let authorizationCalls = 0;
  const operation = Object.freeze({
    ...operationComponents(),
    async validateAuthorization() {
      authorizationCalls += 1;
      return false;
    },
  });
  const composition = createBrowserRelayTrustedSourceComposition(
    rootFor(harness, { operation }),
    { signal: new AbortController().signal },
  );

  await assert.rejects(composition.execute(), compositionError);
  assert.equal(authorizationCalls, 1);
  assert.deepEqual(harness.metrics.calls, []);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
});

test('closes the unchanged forty assertions through the complete offline composition', async () => {
  const harness = completeMatrixHarness();
  const { composition } = createControlledComposition(harness, {
    matrix: harness.matrix,
    runtime: {
      run_operation_case({ matrix }) {
        return harness.run(matrix);
      },
    },
  });

  const result = await composition.execute();
  assert.equal(result.schema, 'miakapp.staging-browser-relay-runner-result/1');
  assert.equal(result.state, 'succeeded_closed_output');
  assert.equal(result.assertions_passed, 40);
  assert.equal(result.assertions_failed, 0);
  assert.equal(harness.metrics.calls.length, TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX);
  assert.equal(harness.metrics.closes.length, TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length);
  assert.equal(harness.metrics.releases.length, TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length);
  assert.equal(harness.browserLifecycleCloseCalls(), 1);
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith('lifecycle:startBrowser:')),
    [
      'lifecycle:startBrowser:chromium',
      'lifecycle:startBrowser:firefox',
      'lifecycle:startBrowser:webkit',
    ],
  );
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith('lifecycle:closeBrowser:')),
    [
      'lifecycle:closeBrowser:firefox',
      'lifecycle:closeBrowser:webkit',
      'lifecycle:closeBrowser:chromium',
    ],
  );
  for (const browser of ['firefox', 'webkit']) {
    assert.equal(harness.pages[browser].closeCalls(), 1);
  }
});

test('matches the same five source factories assembled manually', async () => {
  const composedHarness = providerHarness();
  const { composition } = createControlledComposition(composedHarness);
  await composition.execute();

  const manualHarness = providerHarness();
  const controller = new AbortController();
  const observers = manualObservers(manualHarness, controller);
  await runObservers(manualHarness, observers, controller.signal);

  assert.deepEqual(normalizedCalls(composedHarness.metrics), normalizedCalls(manualHarness.metrics));
  assert.deepEqual(
    normalizedCalls(composedHarness.metrics),
    Object.fromEntries(TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => [
      source,
      TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE[source],
    ])),
  );
  assert.deepEqual(
    [...composedHarness.metrics.closes].sort(),
    [...manualHarness.metrics.closes].sort(),
  );
});

test('preserves provider, operation, matrix and runtime method receivers', async () => {
  const harness = providerHarness();
  let operation;
  let matrix;
  let runtime;
  operation = {
    ...operationComponents(),
    async validateAuthorization() {
      assert.equal(this, operation);
      return true;
    },
  };
  matrix = {
    ...matrixComponents(),
    async prepareChromiumPhase() {
      assert.equal(this, matrix);
    },
  };
  const canonical = canonicalOperationRunner(harness);
  runtime = {
    ...runtimeFor(harness),
    async run_operation_case(components) {
      assert.equal(this, runtime);
      assert.equal(await components.operation.validateAuthorization(), true);
      await components.matrix.prepareChromiumPhase('authoritative_state');
      return canonical(components);
    },
  };
  const composition = createBrowserRelayTrustedSourceCompositionForTesting(
    rootFor(harness, { operation, matrix }),
    { signal: new AbortController().signal },
    runtime,
  );
  await composition.execute();
  assert.equal(harness.metrics.calls.length, TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX);
});

test('closes every provider when the operation fails before matrix entry', async () => {
  const harness = providerHarness();
  const { composition } = createControlledComposition(harness, {
    runtime: {
      run_operation_case() {
        throw new Error('Bearer private operation failure');
      },
    },
  });
  await assert.rejects(composition.execute(), compositionError);
  assert.deepEqual(harness.metrics.calls, []);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
});

test('closes the highest completed owner after every partial factory failure', {
  timeout: 5_000,
}, async () => {
  const factories = [
    ['create_source_clients', createBrowserRelaySourceClients],
    ['create_source_sessions', createBrowserRelaySourceSessions],
    ['create_authority_adapters', createBrowserRelaySourceAuthorityAdapters],
    ['create_authenticated_readers', createBrowserRelayAuthenticatedSourceReaders],
    ['create_source_transports', createBrowserRelaySourceTransports],
  ];

  for (let failureIndex = 0; failureIndex < factories.length; failureIndex += 1) {
    const harness = providerHarness();
    const closes = [];
    const overrides = Object.fromEntries(factories.map(([name, factory], index) => [
      name,
      function sourceFactory(...args) {
        if (index === failureIndex) throw new Error(`private ${name} failure`);
        return trackCloseMap(Reflect.apply(factory, undefined, args), name, closes);
      },
    ]));
    const { composition } = createControlledComposition(harness, {
      runtime: {
        ...overrides,
        run_operation_case() {
          assert.fail('The operation must not start after a source factory failure');
        },
      },
    });

    await assert.rejects(composition.execute(), compositionError);
    for (let completedIndex = 0; completedIndex < failureIndex; completedIndex += 1) {
      const [name] = factories[completedIndex];
      assert.equal(
        closes.filter(({ layer }) => layer === name).length,
        TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length,
      );
    }
    assert.deepEqual(
      [...harness.metrics.closes].sort(),
      [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
    );
    assert.deepEqual(
      [...harness.metrics.releases].sort(),
      [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
    );
  }
});

test('supports clean close before execute and rejects provider reuse', async () => {
  const harness = providerHarness();
  const first = createControlledComposition(harness).composition;
  assert.throws(() => createControlledComposition(harness), compositionError);
  await first.close();
  assert.deepEqual(harness.metrics.calls, []);
  assert.equal(harness.metrics.closes.length, TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length);
  await first.close();
  assert.equal(harness.metrics.closes.length, TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length);
  await assert.rejects(first.execute(), compositionError);
});

test('rejects malformed provider, root, matrix, option and runtime records before callbacks', () => {
  const mutations = [
    (harness) => ({ ...rootFor(harness), extra: true }),
    (harness) => ({ ...rootFor(harness), matrix: { ...matrixComponents(), extra: true } }),
    (harness) => {
      const providers = { ...harness.providers };
      const { close: _close, ...missing } = providers.hosting;
      providers.hosting = Object.freeze(missing);
      return rootFor(harness, { providers: Object.freeze(providers) });
    },
    (harness) => {
      const providers = { ...harness.providers };
      providers.relay = Object.freeze({ ...providers.relay, extra: true });
      return rootFor(harness, { providers: Object.freeze(providers) });
    },
    (harness) => {
      const providers = { ...harness.providers };
      providers.firestore = Object.freeze({
        ...providers.firestore,
        expires_at_milliseconds: harness.expiresAt - 1,
      });
      return rootFor(harness, { providers: Object.freeze(providers) });
    },
    (harness) => rootFor(providerHarness({ expiresAt: NOW - 1 })),
    (harness) => rootFor(providerHarness({
      expiresAt: NOW + TRUSTED_SOURCE_COMPOSITION_MAXIMUM_PROVIDER_LIFETIME_MILLISECONDS + 1,
    })),
    (harness) => {
      const providers = { ...harness.providers, hosting: { ...harness.providers.hosting } };
      return rootFor(harness, { providers: Object.freeze(providers) });
    },
  ];
  for (const mutate of mutations) {
    const harness = providerHarness();
    assert.throws(
      () => createBrowserRelayTrustedSourceCompositionForTesting(
        mutate(harness),
        { signal: new AbortController().signal },
        runtimeFor(harness),
      ),
      compositionError,
    );
    assert.deepEqual(harness.metrics.calls, []);
    assert.deepEqual(harness.metrics.closes, []);
  }

  const optionHarness = providerHarness();
  assert.throws(() => createBrowserRelayTrustedSourceCompositionForTesting(
    rootFor(optionHarness),
    { signal: new AbortController().signal, extra: true },
    runtimeFor(optionHarness),
  ), compositionError);
  const runtimeHarness = providerHarness();
  assert.throws(() => createBrowserRelayTrustedSourceCompositionForTesting(
    rootFor(runtimeHarness),
    { signal: new AbortController().signal },
    { ...runtimeFor(runtimeHarness), fetch() {} },
  ), compositionError);
});

test('rejects accessors without invocation and enforces target, order and receipt semantics', () => {
  const harness = providerHarness();
  let getterCalls = 0;
  const hosting = { ...harness.providers.hosting };
  Object.defineProperty(hosting, 'close', {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return async () => undefined;
    },
  });
  const providers = Object.freeze({
    ...harness.providers,
    hosting: Object.freeze(hosting),
  });
  assert.throws(() => createBrowserRelayTrustedSourceCompositionForTesting(
    rootFor(harness, { providers }),
    { signal: new AbortController().signal },
    runtimeFor(harness),
  ), compositionError);
  assert.equal(getterCalls, 0);

  const signal = new AbortController().signal;
  const valid = acquireDescriptor('hosting', 0, signal);
  const context = validateTrustedSourceAcquireDescriptor(valid, 'hosting', 0);
  assert.equal(context.target, TRUSTED_SOURCE_COMPOSITION_TARGETS_BY_SOURCE_AND_KIND
    .hosting.management_site_configuration);
  assert.throws(
    () => validateTrustedSourceAcquireDescriptor(
      acquireDescriptor('hosting', 1, signal),
      'hosting',
      0,
    ),
    compositionError,
  );
  assert.throws(
    () => validateTrustedSourceAcquireDescriptor(
      acquireDescriptor('hosting', 0, signal, {
        target: structuredClone(
          TRUSTED_SOURCE_COMPOSITION_TARGETS_BY_SOURCE_AND_KIND
            .hosting.management_site_configuration,
        ),
      }),
      'hosting',
      0,
    ),
    compositionError,
  );
  assert.throws(
    () => validateTrustedSourceAcquireDescriptor(
      protocolRecord({ ...valid, extra: true }),
      'hosting',
      0,
    ),
    compositionError,
  );
  const observation = candidateObservation(
    harness.facts,
    'hosting',
    context.browser,
    context.kind,
  );
  const receipt = createTrustedSourceReceipt(context, observation);
  assert.equal(receipt.request_capability, valid.request_capability);
  assert.deepEqual(receipt.observation, observation);
  assert.throws(() => createTrustedSourceReceipt(context, {}), compositionError);
});

test('rejects proxy provider inputs before invoking their traps', () => {
  const harness = providerHarness();
  let traps = 0;
  const providers = new Proxy(harness.providers, {
    getPrototypeOf(target) {
      traps += 1;
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.throws(() => createBrowserRelayTrustedSourceCompositionForTesting(
    rootFor(harness, { providers }),
    { signal: new AbortController().signal },
    runtimeFor(harness),
  ), compositionError);
  assert.equal(traps, 0);
  assert.deepEqual(harness.metrics.calls, []);
});

test('sanitizes provider failure and drains a finite late settlement before release', {
  timeout: 5_000,
}, async () => {
  const started = deferred();
  const release = deferred();
  const harness = providerHarness({
    hooks: {
      async observe({ source, kind }) {
        if (source === 'firebase_app_check' && kind === 'provider_assessment') {
          started.resolve();
          await release.promise;
          throw new Error('Bearer private provider failure');
        }
        return undefined;
      },
    },
  });
  const { composition } = createControlledComposition(harness);
  const execution = composition.execute();
  await started.promise;
  const closing = composition.close();
  let closeSettled = false;
  void closing.finally(() => { closeSettled = true; }).catch(() => undefined);
  await Promise.resolve();
  assert.equal(closeSettled, false);
  release.resolve();
  await assert.rejects(execution, compositionError);
  await assert.rejects(closing, compositionError);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
});

test('rejects reentrant close while continuing terminal provider cleanup', {
  timeout: 5_000,
}, async () => {
  let composition;
  let reentrantClose;
  const harness = providerHarness({
    hooks: {
      async observe({ source, kind }) {
        if (source === 'firebase_app_check' && kind === 'provider_assessment') {
          reentrantClose = composition.close();
          await assert.rejects(reentrantClose, compositionError);
        }
        return undefined;
      },
    },
  });
  composition = createControlledComposition(harness).composition;

  await assert.rejects(composition.execute(), compositionError);
  await assert.rejects(composition.close(), compositionError);
  assert.deepEqual(
    [...harness.metrics.closes].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
});

test('waits for post-matrix operation settlement before close resolves', {
  timeout: 5_000,
}, async () => {
  const postMatrix = deferred();
  const releaseOperation = deferred();
  const harness = providerHarness();
  const canonical = canonicalOperationRunner(harness);
  const { composition } = createControlledComposition(harness, {
    runtime: {
      async run_operation_case(components) {
        const result = await canonical(components);
        postMatrix.resolve();
        await releaseOperation.promise;
        return result;
      },
    },
  });
  const execution = composition.execute();
  const executionRejected = assert.rejects(execution, compositionError);
  await postMatrix.promise;
  const closing = composition.close();
  let closeSettled = false;
  void closing.finally(() => { closeSettled = true; }).catch(() => undefined);
  await Promise.resolve();
  assert.equal(closeSettled, false);

  releaseOperation.resolve();
  await executionRejected;
  await closing;
  assert.equal(closeSettled, true);
});

test('blocks forward operation mutations after root cancellation but permits cleanup', {
  timeout: 5_000,
}, async () => {
  const runnerStarted = deferred();
  const continueRunner = deferred();
  let publicTransitions = 0;
  let fixtureCreations = 0;
  let cleanupCalls = 0;
  const harness = providerHarness();
  const operation = Object.freeze({
    ...operationComponents(),
    edgeClient: Object.freeze({
      ...operationComponents().edgeClient,
      async setPublicInvoker() {
        publicTransitions += 1;
      },
    }),
    async createSyntheticFixture() {
      fixtureCreations += 1;
      return true;
    },
    async closeRelaysPrivateReady() {
      cleanupCalls += 1;
      return true;
    },
  });
  const controller = new AbortController();
  const { composition } = createControlledComposition(harness, {
    controller,
    operation,
    runtime: {
      async run_operation_case({ operation: bounded }) {
        runnerStarted.resolve();
        await continueRunner.promise;
        let rejected = 0;
        try { await bounded.edgeClient.setPublicInvoker({}, true); } catch { rejected += 1; }
        try { await bounded.createSyntheticFixture({}); } catch { rejected += 1; }
        assert.equal(rejected, 2);
        assert.equal(await bounded.closeRelaysPrivateReady(), true);
        throw new Error('private cancelled operation');
      },
    },
  });
  const execution = composition.execute();
  await runnerStarted.promise;
  controller.abort(new Error('Bearer private abort reason'));
  continueRunner.resolve();

  await assert.rejects(execution, compositionError);
  assert.equal(publicTransitions, 0);
  assert.equal(fixtureCreations, 0);
  assert.equal(cleanupCalls, 1);
});

test('propagates sanitized caller cancellation', { timeout: 5_000 }, async () => {
  const started = deferred();
  const release = deferred();
  let providerSignal;
  const harness = providerHarness({
    hooks: {
      async observe({ source, kind, context }) {
        if (source === 'firebase_app_check' && kind === 'provider_assessment') {
          providerSignal = context.signal;
          started.resolve();
          await release.promise;
        }
        return undefined;
      },
    },
  });
  const controller = new AbortController();
  const { composition } = createControlledComposition(harness, { controller });
  const execution = composition.execute();
  await started.promise;
  controller.abort(new Error('Bearer private abort reason'));
  assert.equal(providerSignal.aborted, true);
  assert.equal(providerSignal.reason instanceof Error, true);
  assert.equal(providerSignal.reason.message.includes('Bearer'), false);
  release.resolve();
  await assert.rejects(execution, compositionError);
});

test('rejects concurrent execute and still completes cleanup', { timeout: 5_000 }, async () => {
  const started = deferred();
  const release = deferred();
  const harness = providerHarness({
    hooks: {
      async observe({ source, kind }) {
        if (source === 'firebase_app_check' && kind === 'provider_assessment') {
          started.resolve();
          await release.promise;
        }
        return undefined;
      },
    },
  });
  const { composition } = createControlledComposition(harness);
  const execution = composition.execute();
  await started.promise;
  await assert.rejects(composition.execute(), compositionError);
  release.resolve();
  await assert.rejects(execution, compositionError);
  assert.deepEqual(
    [...harness.metrics.releases].sort(),
    [...TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER].sort(),
  );
});

test('keeps production and testing entrypoints exact and separate', () => {
  assert.equal(createBrowserRelayTrustedSourceComposition.length, 2);
  assert.equal(createBrowserRelayTrustedSourceCompositionForTesting.length, 3);
  assert.throws(() => createBrowserRelayTrustedSourceComposition(), compositionError);
  assert.throws(
    () => createBrowserRelayTrustedSourceComposition({}, {}, {}),
    compositionError,
  );
  const production = readFileSync(
    new URL('../browser-relay-trusted-source-composition/composition.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(production.includes('./testing.mjs'), false);
  assert.equal(production.includes('ForTesting'), false);
});

test('guards the exact package and rejects an unreviewed runtime import', async () => {
  await validateBrowserRelayTrustedSourceCompositionRoot(PACKAGE_ROOT);
  const root = copiedPackageRoot();
  writeFileSync(new URL('apply.sh', root), '#!/bin/sh\n');
  await assert.rejects(
    validateBrowserRelayTrustedSourceCompositionRoot(root),
    /file inventory/u,
  );

  const importRoot = copiedPackageRoot();
  const productionPath = new URL('composition.mjs', importRoot);
  writeFileSync(
    productionPath,
    `${readFileSync(productionPath, 'utf8')}\nimport 'node:https';\n`,
  );
  await assert.rejects(
    validateBrowserRelayTrustedSourceCompositionRoot(importRoot),
    /static allowlist/u,
  );

  const ambientRoot = copiedPackageRoot();
  const internalPath = new URL('internal.mjs', ambientRoot);
  writeFileSync(
    internalPath,
    `${readFileSync(internalPath, 'utf8')}\nprocess.getBuiltinModule('http').get('http://127.0.0.1');\n`,
  );
  await assert.rejects(
    validateBrowserRelayTrustedSourceCompositionRoot(ambientRoot),
    /ambient authority/u,
  );
});
