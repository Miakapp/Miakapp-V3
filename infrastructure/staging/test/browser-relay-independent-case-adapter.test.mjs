import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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
import * as productionAdapter from '../browser-relay-independent-case-adapter/adapter.mjs';
import {
  INDEPENDENT_CASE_ADAPTER_BROWSER_LIFECYCLE_METHODS,
  INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS,
  INDEPENDENT_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
  INDEPENDENT_CASE_ADAPTER_OBSERVATIONS_PER_MATRIX,
  INDEPENDENT_CASE_ADAPTER_OBSERVER_METHODS,
  INDEPENDENT_CASE_ADAPTER_OBSERVER_SCOPE_FIELDS,
  INDEPENDENT_CASE_ADAPTER_PROFILE_SHA256,
  INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER,
  StagingBrowserRelayIndependentCaseAdapterError,
  independentCaseAdapterDependencyContractsSha256,
  validateBrowserRelayIndependentCaseAdapterProfile,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  validateBrowserRelayIndependentCaseAdapterRoot,
} from '../browser-relay-independent-case-adapter/guard.mjs';
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
  chromiumPageFacts,
  fullIndependentFacts,
  pageProjection,
  secondaryPageFacts,
} from './helpers/browser-relay-evidence-fixture.mjs';
import {
  createDeterministicIndependentSourceHarness,
} from './helpers/browser-relay-independent-source-harness.mjs';

const ADAPTER_ROOT = new URL('../browser-relay-independent-case-adapter/', import.meta.url);
const PACKAGE_FILES = Object.freeze([
  'README.md',
  'adapter.mjs',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'testing.mjs',
]);
const STATE_EXPECTATION_SCHEMA =
  'miakapp.staging-browser-relay-fixture-state-expectation/1';
const REMAINING_ADAPTER_METHODS = Object.freeze([
  'startBrowser',
  'execute',
  'closePage',
  'closeBrowser',
  'close',
]);

function token(character) {
  return `${character.repeat(32)}.${character.repeat(32)}.${character.repeat(32)}`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function caseScope(caseId, browser, signal) {
  const scope = {
    browser,
    case_id: caseId,
    record() { return true; },
    signal,
  };
  Object.defineProperty(scope, 'toJSON', {
    enumerable: false,
    value() { throw new Error('Test case scope must not serialize'); },
  });
  return Object.freeze(scope);
}

function withRemainingAdapterOverrides(components, overrides) {
  const base = components.remainingAdapter;
  return Object.freeze({
    ...components,
    remainingAdapter: Object.freeze(Object.fromEntries(
      REMAINING_ADAPTER_METHODS.map((method) => [
        method,
        overrides[method] ?? ((...args) => base[method](...args)),
      ]),
    )),
  });
}

async function withDeadline(promise, label, milliseconds = 5_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

function createChromiumScenarioRunner(harness) {
  return async (dependencies, port, options) => {
    const facts = chromiumPageFacts();
    const record = async (sequence) => {
      harness.clock.setAtLeastMilliseconds(
        harness.browserStarts.chromium + facts[sequence - 1].elapsed_milliseconds,
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
    await record(6);
    await control('relay_handoff_stale');
    await record(7);
    await control('relay_b_ready');
    await record(8);
    await control('relay_b_state');
    await record(9);
    await control('relay_b_call');
    await record(10);
    await control('failed_call');
    await control('uncertain_call');
    await record(11);
    await control('relay_b_recovered');
    await record(12);
    for (let sequence = 13; sequence <= 15; sequence += 1) await record(sequence);
    await dependencies.openPage(2, options.signal);
    await dependencies.privateInputProvider('chromium', 2, options.signal);
    for (let sequence = 16; sequence <= 18; sequence += 1) await record(sequence);
    harness.trace.push('chromium:scenario-closed');
    return closedChromiumScenarioResult();
  };
}

function cloneObservers(base, overrides = {}) {
  return Object.fromEntries(INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER.map((source) => {
    const override = overrides[source] ?? {};
    return [source, {
      execute: override.execute ?? base[source].execute,
      close: override.close ?? base[source].close,
    }];
  }));
}

function successHarness({ observerOverrides = {}, lifecycleOverrides = {} } = {}) {
  const clock = controlledAdvancingClock();
  const trace = [];
  const browserStarts = { chromium: undefined, firefox: undefined, webkit: undefined };
  const pages = {};
  const independent = createDeterministicIndependentSourceHarness({
    browserStarts,
    clock,
    trace,
  });
  const sourceObservers = cloneObservers(independent.sourceObservers, observerOverrides);
  const browserLifecycle = {
    startBrowser: lifecycleOverrides.startBrowser ?? independent.browserLifecycle.startBrowser,
    closeBrowser: lifecycleOverrides.closeBrowser ?? independent.browserLifecycle.closeBrowser,
    close: lifecycleOverrides.close ?? independent.browserLifecycle.close,
  };
  const harness = {
    browserStarts,
    clock,
    independent,
    pages,
    trace,
  };
  harness.components = {
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
    sourceObservers,
    browserLifecycle,
  };
  harness.scenarioRunner = createChromiumScenarioRunner(harness);
  harness.schedulerRunner = (adapter, options) => runBrowserRelayCaseScheduleForTest(
    () => {
      trace.push('session:create');
      const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
      browserStarts.chromium = clock.lastMilliseconds();
      return session;
    },
    adapter,
    options,
  );
  harness.chromiumCaseRunner = (components, options) => (
    runBrowserRelayChromiumCaseScheduleForTesting(
      harness.schedulerRunner,
      harness.scenarioRunner,
      components,
      options,
    )
  );
  harness.secondaryCaseRunner = (components, options) => (
    runBrowserRelaySecondaryCaseScheduleForTesting(
      harness.chromiumCaseRunner,
      runBrowserRelayPlaywrightBridge,
      components,
      options,
    )
  );
  harness.run = (options) => runBrowserRelayIndependentCaseScheduleForTesting(
    harness.secondaryCaseRunner,
    harness.components,
    options,
  );
  return harness;
}

test('loads the exact production adapter entrypoint', () => {
  assert.deepEqual(Object.keys(productionAdapter), [
    'runBrowserRelayIndependentCaseSchedule',
  ]);
  assert.equal(typeof productionAdapter.runBrowserRelayIndependentCaseSchedule, 'function');
});

test('pins the dormant source-only composition with every live authority closed', () => {
  const profile = validateBrowserRelayIndependentCaseAdapterProfile();
  assert.equal(
    independentCaseAdapterDependencyContractsSha256(),
    INDEPENDENT_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
  );
  assert.deepEqual(profile.composition.component_fields,
    INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS);
  assert.deepEqual(profile.composition.source_order, INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER);
  assert.deepEqual(profile.composition.observer_methods,
    INDEPENDENT_CASE_ADAPTER_OBSERVER_METHODS);
  assert.deepEqual(profile.composition.browser_lifecycle_methods,
    INDEPENDENT_CASE_ADAPTER_BROWSER_LIFECYCLE_METHODS);
  assert.deepEqual(profile.composition.observer_scope_fields,
    INDEPENDENT_CASE_ADAPTER_OBSERVER_SCOPE_FIELDS);
  assert.equal(profile.composition.observations_per_matrix,
    INDEPENDENT_CASE_ADAPTER_OBSERVATIONS_PER_MATRIX);
  assert.equal(profile.composition.cross_source_total_order_imposed, false);
  assert.equal(profile.composition.page_close_calls_expected, 0);
  assert.equal(
    profile.composition.source_scopes_revoked_after_observer_settlement,
    true,
  );
  assert.equal(profile.composition.adapter_transitions_nonoverlapping, true);
  assert.equal(profile.composition.browser_lifecycle_state_tracked, true);
  assert.equal(profile.composition.cleanup_convergence_required_for_result, true);
  assert.equal(profile.compatibility.independent_source_composition_present, true);
  assert.equal(profile.compatibility.genuine_live_source_adapters_present, false);
  assert.equal(profile.compatibility.durable_claim_binding_present, false);
  assert.ok(Object.values(profile.authority).every((value) => value === false));
  assert.match(INDEPENDENT_CASE_ADAPTER_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
});

test('composes all forty-three source observations into one closed result', async () => {
  const harness = successHarness();
  const result = await harness.run();
  assert.equal(result.schema, 'miakapp.staging-browser-relay-runner-result/1');
  assert.equal(result.state, 'succeeded_closed_output');
  assert.equal(result.assertions_passed, 40);
  assert.equal(result.assertions_failed, 0);
  assert.equal(harness.independent.observedCalls.length, 43);
  assert.ok(Object.values(harness.independent.observerCloseCalls)
    .every((calls) => calls === 1));
  assert.equal(harness.independent.browserLifecycleCloseCalls(), 1);
  const lifecycleClose = harness.trace.indexOf('lifecycle:close');
  assert.ok(lifecycleClose >= 0);
  for (const source of INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER) {
    assert.ok(harness.trace.indexOf(`observer:${source}:close`) < lifecycleClose);
  }
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
  const firestore = harness.trace.indexOf(
    'observer:firestore:LIVE-06/chromium:authoritative_route_transition',
  );
  const controlPlane = harness.trace.indexOf(
    'observer:control_plane:LIVE-06/chromium:atomic_credential_reuse',
  );
  assert.ok(firestore >= 0 && firestore < controlPlane);
});

test('attenuates each observer to one revocable observation-only scope', async () => {
  let retained;
  const harness = successHarness({
    observerOverrides: {
      hosting: {
        async execute(scope) {
          retained = scope;
          assert.deepEqual(Reflect.ownKeys(scope).sort(), [
            ...INDEPENDENT_CASE_ADAPTER_OBSERVER_SCOPE_FIELDS,
            'toJSON',
          ].sort());
          assert.equal('source' in scope, false);
          assert.equal('kind' in scope, false);
          assert.equal('sequence' in scope, false);
          assert.equal('elapsed_milliseconds' in scope, false);
          return harness.independent.sourceObservers.hosting.execute(scope);
        },
      },
    },
  });
  await harness.run();
  assert.throws(
    () => retained.record({}),
    StagingBrowserRelayIndependentCaseAdapterError,
  );
});

test('revokes one observer scope as soon as that observer settles', async () => {
  const appCheckSettled = deferred();
  const hostingStarted = deferred();
  const releaseHosting = deferred();
  let retainedScope;
  const harness = successHarness({
    observerOverrides: {
      firebase_app_check: {
        async execute(scope) {
          if (scope.case_id === 'LIVE-02') retainedScope = scope;
          await harness.independent.sourceObservers.firebase_app_check.execute(scope);
          if (scope.case_id === 'LIVE-02') appCheckSettled.resolve();
        },
      },
      hosting: {
        async execute(scope) {
          await harness.independent.sourceObservers.hosting.execute(scope);
          if (scope.case_id === 'LIVE-02') {
            hostingStarted.resolve();
            await releaseHosting.promise;
          }
        },
      },
    },
  });
  const execution = harness.run();
  try {
    await withDeadline(
      Promise.all([appCheckSettled.promise, hostingStarted.promise]),
      'independent observer settlement',
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.throws(
      () => retainedScope.record({}),
      (error) => error instanceof StagingBrowserRelayIndependentCaseAdapterError
        && error.message === 'Independent source scope is no longer active',
    );
  } finally {
    releaseHosting.resolve();
  }
  await assert.rejects(execution, StagingBrowserRelayIndependentCaseAdapterError);
});

test('rejects serialization, missing observations and caller-owned fact metadata', async (t) => {
  await t.test('serialization', async () => {
    const harness = successHarness({
      observerOverrides: {
        hosting: {
          execute(scope) {
            JSON.stringify(scope);
          },
        },
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
    assert.equal(harness.independent.browserLifecycleCloseCalls(), 1);
  });

  await t.test('missing observation', async () => {
    const harness = successHarness({
      observerOverrides: { hosting: { async execute() {} } },
    });
    await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
  });

  await t.test('full fact supplied as observation', async () => {
    const harness = successHarness({
      observerOverrides: {
        hosting: {
          execute(scope) {
            scope.record(fullIndependentFacts().chromium.hosting[0]);
          },
        },
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
  });
});

test('rejects excessive observations and unreviewed observer completion values', async (t) => {
  await t.test('excess observation', async () => {
    const harness = successHarness({
      observerOverrides: {
        hosting: {
          async execute(scope) {
            await harness.independent.sourceObservers.hosting.execute(scope);
            scope.record(fullIndependentFacts().chromium.hosting[1].observation);
          },
        },
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
  });

  await t.test('completion value', async () => {
    const harness = successHarness({
      observerOverrides: {
        hosting: {
          async execute(scope) {
            await harness.independent.sourceObservers.hosting.execute(scope);
            return true;
          },
        },
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
  });
});

test('does not invoke later observers after a synchronous sibling failure', async () => {
  let hostingExecuteCalls = 0;
  const harness = successHarness({
    observerOverrides: {
      firebase_app_check: {
        execute() { throw new Error('private synchronous observer failure'); },
      },
      hosting: {
        execute() {
          hostingExecuteCalls += 1;
        },
      },
    },
  });
  await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
  assert.equal(hostingExecuteCalls, 0);
});

test('rejects source order, stage order and browser-lifecycle drift', async (t) => {
  await t.test('out-of-order source observation', async () => {
    const harness = successHarness({
      observerOverrides: {
        hosting: {
          execute(scope) {
            scope.record(fullIndependentFacts().chromium.hosting[1].observation);
          },
        },
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
  });

  await t.test('browser start order', async () => {
    const harness = successHarness();
    const controller = new AbortController();
    await assert.rejects(
      runBrowserRelayIndependentCaseScheduleForTesting(
        ({ remainingAdapter }) => (
          remainingAdapter.startBrowser('firefox', controller.signal)
        ),
        harness.components,
      ),
      StagingBrowserRelayIndependentCaseAdapterError,
    );
  });

  await t.test('case stage order', async () => {
    const harness = successHarness();
    const controller = new AbortController();
    const wrongStage = {
      browser: 'chromium',
      case_id: 'LIVE-03',
      record() { return true; },
      signal: controller.signal,
    };
    Object.defineProperty(wrongStage, 'toJSON', {
      enumerable: false,
      value() { throw new Error('scope must not serialize'); },
    });
    await assert.rejects(
      runBrowserRelayIndependentCaseScheduleForTesting(
        async ({ remainingAdapter }) => {
          await remainingAdapter.startBrowser('chromium', controller.signal);
          await remainingAdapter.execute(wrongStage);
        },
        harness.components,
      ),
      StagingBrowserRelayIndependentCaseAdapterError,
    );
  });

  await t.test('browser lifecycle completion value', async () => {
    const harness = successHarness();
    const controller = new AbortController();
    await assert.rejects(
      runBrowserRelayIndependentCaseScheduleForTesting(
        ({ remainingAdapter }) => (
          remainingAdapter.startBrowser('chromium', controller.signal)
        ),
        {
          ...harness.components,
          browserLifecycle: {
            startBrowser() { return true; },
            closeBrowser() {},
            close() {},
          },
        },
      ),
      StagingBrowserRelayIndependentCaseAdapterError,
    );
  });
});

test('rejects overlapping lifecycle and case transitions before duplicate work', async (t) => {
  await t.test('duplicate browser start', async () => {
    const harness = successHarness();
    const runner = (components, options) => {
      const base = components.remainingAdapter;
      let attacked = false;
      return harness.secondaryCaseRunner(withRemainingAdapterOverrides(components, {
        startBrowser(browser, signal) {
          if (!attacked && browser === 'chromium') {
            attacked = true;
            return Promise.all([
              base.startBrowser(browser, signal),
              base.startBrowser(browser, signal),
            ]).then(() => undefined);
          }
          return base.startBrowser(browser, signal);
        },
      }), options);
    };
    await assert.rejects(
      runBrowserRelayIndependentCaseScheduleForTesting(runner, harness.components),
      StagingBrowserRelayIndependentCaseAdapterError,
    );
    assert.equal(
      harness.trace.filter((entry) => entry === 'lifecycle:startBrowser:chromium').length,
      1,
    );
  });

  await t.test('case execution during browser start', async () => {
    const harness = successHarness();
    const runner = (components, options) => {
      const base = components.remainingAdapter;
      let attacked = false;
      return harness.secondaryCaseRunner(withRemainingAdapterOverrides(components, {
        startBrowser(browser, signal) {
          if (!attacked && browser === 'chromium') {
            attacked = true;
            return Promise.all([
              base.startBrowser(browser, signal),
              base.execute(caseScope('LIVE-02', 'chromium', signal)),
            ]).then(() => undefined);
          }
          return base.startBrowser(browser, signal);
        },
      }), options);
    };
    await assert.rejects(
      runBrowserRelayIndependentCaseScheduleForTesting(runner, harness.components),
      StagingBrowserRelayIndependentCaseAdapterError,
    );
    assert.equal(
      harness.trace.filter((entry) => (
        entry === 'observer:firebase_app_check:execute:LIVE-02/chromium'
      )).length,
      0,
    );
  });

  await t.test('duplicate browser close', async () => {
    const harness = successHarness();
    const runner = (components, options) => {
      const base = components.remainingAdapter;
      let attacked = false;
      return harness.secondaryCaseRunner(withRemainingAdapterOverrides(components, {
        closeBrowser(browser, signal) {
          if (!attacked && browser === 'firefox') {
            attacked = true;
            return Promise.all([
              base.closeBrowser(browser, signal),
              base.closeBrowser(browser, signal),
            ]).then(() => undefined);
          }
          return base.closeBrowser(browser, signal);
        },
      }), options);
    };
    await assert.rejects(
      runBrowserRelayIndependentCaseScheduleForTesting(runner, harness.components),
      StagingBrowserRelayIndependentCaseAdapterError,
    );
    assert.equal(
      harness.trace.filter((entry) => entry === 'lifecycle:closeBrowser:firefox').length,
      1,
    );
  });

  await t.test('browser close during case execution', async () => {
    const harness = successHarness();
    const runner = (components, options) => {
      const base = components.remainingAdapter;
      let attacked = false;
      return harness.secondaryCaseRunner(withRemainingAdapterOverrides(components, {
        execute(scope) {
          const execution = base.execute(scope);
          if (!attacked && scope.case_id === 'LIVE-10' && scope.browser === 'firefox') {
            attacked = true;
            return Promise.all([
              execution,
              base.closeBrowser('firefox', scope.signal),
            ]).then(() => undefined);
          }
          return execution;
        },
      }), options);
    };
    await assert.rejects(
      runBrowserRelayIndependentCaseScheduleForTesting(runner, harness.components),
      StagingBrowserRelayIndependentCaseAdapterError,
    );
    assert.equal(
      harness.trace.filter((entry) => entry === 'lifecycle:closeBrowser:firefox').length,
      0,
    );
  });
});

test('aborts and drains an active source observer before any terminal close', async () => {
  const started = deferred();
  const release = deferred();
  const controller = new AbortController();
  let abortObserved = false;
  const harness = successHarness({
    observerOverrides: {
      hosting: {
        async execute(scope) {
          started.resolve();
          await new Promise((resolve) => {
            if (scope.signal.aborted) resolve();
            else scope.signal.addEventListener('abort', resolve, { once: true });
          });
          abortObserved = true;
          await release.promise;
          throw new Error('private observer failure');
        },
      },
    },
  });
  let settled = false;
  const execution = harness.run({ signal: controller.signal });
  execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await withDeadline(started.promise, 'independent observer start');
    controller.abort();
    for (let attempt = 0; attempt < 100 && !abortObserved; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(abortObserved, true);
    assert.equal(settled, false);
    assert.equal(harness.independent.browserLifecycleCloseCalls(), 0);
    assert.ok(Object.values(harness.independent.observerCloseCalls)
      .every((calls) => calls === 0));
  } finally {
    release.resolve();
  }
  await assert.rejects(execution, StagingBrowserRelayIndependentCaseAdapterError);
  assert.equal(harness.independent.browserLifecycleCloseCalls(), 1);
});

test('drains an active browser lifecycle task before terminal close', async () => {
  const lifecycleStarted = deferred();
  const closeRequested = deferred();
  const releaseLifecycle = deferred();
  const harness = successHarness({
    lifecycleOverrides: {
      async startBrowser(browser) {
        if (browser === 'chromium') {
          lifecycleStarted.resolve();
          await releaseLifecycle.promise;
        }
      },
    },
  });
  const runner = async ({ remainingAdapter }) => {
    const controller = new AbortController();
    const lifecycle = remainingAdapter.startBrowser('chromium', controller.signal);
    await lifecycleStarted.promise;
    const cleanup = remainingAdapter.close();
    closeRequested.resolve();
    await Promise.allSettled([lifecycle, cleanup]);
    return { schema: 'miakapp.staging-browser-relay-runner-result/1' };
  };
  const execution = runBrowserRelayIndependentCaseScheduleForTesting(
    runner,
    harness.components,
  );
  try {
    await withDeadline(closeRequested.promise, 'browser lifecycle close request');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.independent.browserLifecycleCloseCalls(), 0);
  } finally {
    releaseLifecycle.resolve();
  }
  await assert.rejects(execution, StagingBrowserRelayIndependentCaseAdapterError);
  assert.equal(harness.independent.browserLifecycleCloseCalls(), 1);
});

test('fails closed when observer or browser lifecycle cleanup does not converge', async (t) => {
  await t.test('observer close', async () => {
    const harness = successHarness({
      observerOverrides: {
        hosting: { close() { throw new Error('private observer cleanup failure'); } },
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
    assert.equal(harness.independent.browserLifecycleCloseCalls(), 1);
  });

  await t.test('lifecycle close', async () => {
    const harness = successHarness({
      lifecycleOverrides: {
        close() { throw new Error('private lifecycle cleanup failure'); },
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelayIndependentCaseAdapterError);
  });

  await t.test('swallowed observer-close rejection', async () => {
    const harness = successHarness({
      observerOverrides: {
        hosting: { close() { throw new Error('private observer cleanup failure'); } },
      },
    });
    const swallowingRunner = async (components, options) => {
      try {
        return await harness.secondaryCaseRunner(components, options);
      } catch {
        return { schema: 'miakapp.staging-browser-relay-runner-result/1' };
      }
    };
    await assert.rejects(
      runBrowserRelayIndependentCaseScheduleForTesting(
        swallowingRunner,
        harness.components,
      ),
      StagingBrowserRelayIndependentCaseAdapterError,
    );
  });
});

test('rejects page closure and malformed component ownership', async () => {
  const controller = new AbortController();
  const harness = successHarness();
  await assert.rejects(
    runBrowserRelayIndependentCaseScheduleForTesting(
      async (components) => {
        await components.remainingAdapter.startBrowser('chromium', controller.signal);
        await components.remainingAdapter.closePage('chromium', controller.signal);
      },
      harness.components,
    ),
    StagingBrowserRelayIndependentCaseAdapterError,
  );

  await assert.rejects(
    runBrowserRelayIndependentCaseScheduleForTesting(
      harness.secondaryCaseRunner,
      { ...harness.components, extra: true },
    ),
    StagingBrowserRelayIndependentCaseAdapterError,
  );
  await assert.rejects(
    runBrowserRelayIndependentCaseScheduleForTesting(
      harness.secondaryCaseRunner,
      {
        ...harness.components,
        sourceObservers: { ...harness.components.sourceObservers, extra: {} },
      },
    ),
    StagingBrowserRelayIndependentCaseAdapterError,
  );
});

test('guards exact package inventory, imports and source-only authority', () => {
  validateBrowserRelayIndependentCaseAdapterRoot(ADAPTER_ROOT);
  const mutations = [
    (root) => writeFileSync(join(root, 'unreviewed.mjs'), 'export default true;\n'),
    (root) => {
      const path = join(root, 'adapter.mjs');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        '../browser-relay-secondary-case-adapter/adapter.mjs',
        '../browser-relay-secondary-case-adapter/testing.mjs',
      ));
    },
    (root) => {
      const path = join(root, 'internal.mjs');
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n// fetch('https://example.test')\n`);
    },
    (root) => {
      const path = join(root, 'internal.mjs');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        'accepted !== true',
        'accepted === false',
      ));
    },
  ];
  for (const mutate of mutations) {
    const root = mkdtempSync(join(tmpdir(), 'miakapp-independent-case-adapter-'));
    try {
      for (const name of PACKAGE_FILES) copyFileSync(new URL(name, ADAPTER_ROOT), join(root, name));
      mutate(root);
      assert.throws(
        () => validateBrowserRelayIndependentCaseAdapterRoot(new URL(`file://${root}/`)),
        /inventory|imports|authority|safety boundary/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('rejects profile drift and keeps testing code out of production', () => {
  const root = mkdtempSync(join(tmpdir(), 'miakapp-independent-case-profile-'));
  try {
    for (const name of PACKAGE_FILES) copyFileSync(new URL(name, ADAPTER_ROOT), join(root, name));
    const profilePath = join(root, 'profile.json');
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    profile.authority.live_execution_authorized = true;
    writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    assert.throws(
      () => validateBrowserRelayIndependentCaseAdapterRoot(new URL(`file://${root}/`)),
      /authority/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(readFileSync(new URL(
    '../browser-relay-independent-case-adapter/adapter.mjs',
    import.meta.url,
  ), 'utf8').includes('ForTesting'), false);
});
