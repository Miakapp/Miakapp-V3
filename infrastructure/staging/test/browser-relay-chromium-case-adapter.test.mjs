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
  FACT_KINDS_BY_STAGE,
} from '../browser-relay-case-scheduler/contract.mjs';
import {
  runBrowserRelayCaseScheduleForTest,
} from '../browser-relay-case-scheduler/testing.mjs';
import {
  CHROMIUM_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
  CHROMIUM_CASE_ADAPTER_FIXTURE_METHODS,
  CHROMIUM_CASE_ADAPTER_PROFILE_SHA256,
  CHROMIUM_CASE_ADAPTER_STAGE_ORDER,
  CHROMIUM_CONTROL_STAGE_BY_PHASE,
  CHROMIUM_PAGE_STAGE_BY_SEQUENCE,
  StagingBrowserRelayChromiumCaseAdapterError,
  chromiumCaseAdapterDependencyContractsSha256,
  validateBrowserRelayChromiumCaseAdapterProfile,
} from '../browser-relay-chromium-case-adapter/contract.mjs';
import {
  validateBrowserRelayChromiumCaseAdapterRoot,
} from '../browser-relay-chromium-case-adapter/guard.mjs';
import {
  runBrowserRelayChromiumCaseScheduleForTesting,
} from '../browser-relay-chromium-case-adapter/testing.mjs';
import {
  CHROMIUM_SCENARIO_RESULT_SCHEMA,
  CONTROL_PHASE_ORDER,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  createBrowserRelayEvidenceSessionForTest,
} from '../browser-relay-evidence-session/testing.mjs';
import {
  createBrowserRelayPageReceiptProducer,
} from '../browser-relay-page-receipt/producer.mjs';
import {
  chromiumPageFacts,
  fullIndependentFacts,
  independentProjection,
  pageProjection,
  secondaryPageFacts,
} from './helpers/browser-relay-evidence-fixture.mjs';

const ADAPTER_ROOT = new URL('../browser-relay-chromium-case-adapter/', import.meta.url);
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Timed out waiting for the Chromium composition checkpoint');
}

function controlledAdvancingClock() {
  const origin = 30_000_000_000n;
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

function fixtureQueues() {
  const independent = fullIndependentFacts();
  return Object.fromEntries(['chromium', 'firefox', 'webkit'].map((browser) => [
    browser,
    {
      browser_page: browser === 'chromium'
        ? chromiumPageFacts()
        : secondaryPageFacts(browser),
      ...independent[browser],
    },
  ]));
}

function recordRemainingStage(scope, harness) {
  const stageKey = `${scope.case_id}/${scope.browser}`;
  const records = [];
  let stableOrder = 0;
  for (const [source, expectedKinds] of Object.entries(FACT_KINDS_BY_STAGE[stageKey])) {
    if (scope.browser === 'chromium' && source === 'browser_page') continue;
    const start = harness.cursors[scope.browser][source];
    const values = harness.queues[scope.browser][source]
      .slice(start, start + expectedKinds.length);
    assert.deepEqual(values.map((value) => (
      source === 'browser_page' ? value.phase : value.kind
    )), expectedKinds);
    for (const value of values) {
      records.push({
        elapsed: value.elapsed_milliseconds,
        order: stableOrder += 1,
        projection: source === 'browser_page'
          ? pageProjection(value)
          : independentProjection(value),
        source,
      });
    }
    harness.cursors[scope.browser][source] += expectedKinds.length;
  }
  const browserStart = harness.browserStarts[scope.browser] ?? 0;
  records.sort((left, right) => left.elapsed - right.elapsed || left.order - right.order);
  for (const record of records) {
    harness.clock.setAtLeastMilliseconds(browserStart + record.elapsed);
    assert.equal(scope.record(record.source, record.projection), true);
  }
}

function createReadyFixture(trace, overrides = {}) {
  let revision = 1;
  let temperature = 20;
  const expectation = () => Object.freeze({
    schema: STATE_EXPECTATION_SCHEMA,
    path: 'acceptance.temperature',
    revision,
    value: temperature,
  });
  return {
    stateExpectation() {
      trace.push('fixture:stateExpectation');
      return overrides.stateExpectation?.() ?? expectation();
    },
    async setTemperature(value) {
      trace.push(`fixture:setTemperature:${value}`);
      if (overrides.setTemperature !== undefined) return overrides.setTemperature(value);
      revision += 1;
      temperature = value;
      return expectation();
    },
    async privateInput(browser, identityGeneration, signal) {
      trace.push(`fixture:privateInput:${browser}:${identityGeneration}`);
      if (overrides.privateInput !== undefined) {
        return overrides.privateInput(browser, identityGeneration, signal);
      }
      return Object.freeze({ browser, identity_generation: identityGeneration });
    },
    async rotateRelayToB() {
      trace.push('fixture:rotateRelayToB');
      return overrides.rotateRelayToB?.() ?? true;
    },
  };
}

function createRemainingAdapter(harness, overrides = {}) {
  return {
    async startBrowser(browser, signal) {
      harness.trace.push(`remaining:startBrowser:${browser}`);
      harness.clock.advanceMilliseconds();
      harness.browserStarts[browser] = harness.clock.lastMilliseconds();
      if (overrides.startBrowser !== undefined) {
        return overrides.startBrowser(browser, signal);
      }
    },
    async execute(scope) {
      harness.trace.push(`remaining:execute:${scope.case_id}/${scope.browser}`);
      harness.retainedScopes.push(scope);
      if (overrides.execute !== undefined) {
        return overrides.execute(scope, () => recordRemainingStage(scope, harness));
      }
      recordRemainingStage(scope, harness);
    },
    async closePage(browser, signal) {
      harness.trace.push(`remaining:closePage:${browser}`);
      harness.clock.advanceMilliseconds();
      if (overrides.closePage !== undefined) return overrides.closePage(browser, signal);
    },
    async closeBrowser(browser, signal) {
      harness.trace.push(`remaining:closeBrowser:${browser}`);
      harness.clock.advanceMilliseconds();
      if (overrides.closeBrowser !== undefined) return overrides.closeBrowser(browser, signal);
    },
    async close() {
      harness.remainingCloseCalls += 1;
      harness.trace.push('remaining:close');
      if (overrides.close !== undefined) return overrides.close();
    },
  };
}

function createScenarioRunner(harness, overrides = {}) {
  return async (dependencies, port, options) => {
    harness.trace.push('scenario:start');
    if (overrides.runner !== undefined) {
      return overrides.runner(dependencies, port, options);
    }
    const facts = chromiumPageFacts();
    const signal = options.signal;
    const record = async (sequence) => {
      harness.clock.setAtLeastMilliseconds(
        harness.browserStarts.chromium + facts[sequence - 1].elapsed_milliseconds,
      );
      harness.trace.push(`scenario:projection:${sequence}`);
      const accepted = await port.record(pageProjection(facts[sequence - 1]), signal);
      harness.trace.push(`scenario:projection-ack:${sequence}`);
      assert.equal(accepted, true);
    };
    await dependencies.openPage(1, signal);
    await dependencies.privateInputProvider('chromium', 1, signal);
    await record(1);
    await record(2);
    const controls = async (phase) => {
      const value = await dependencies.controlPhase(phase, signal);
      harness.controlResults.push({ phase, value });
    };
    await controls('authoritative_state');
    await record(3);
    await controls('patched_state');
    await record(4);
    await controls('initial_call');
    await record(5);
    await controls('same_relay_reauthenticated');
    await record(6);
    await controls('relay_handoff_stale');
    await record(7);
    await controls('relay_b_ready');
    await record(8);
    await controls('relay_b_state');
    await record(9);
    await controls('relay_b_call');
    await record(10);
    await controls('failed_call');
    await controls('uncertain_call');
    await record(11);
    await controls('relay_b_recovered');
    await record(12);
    for (let sequence = 13; sequence <= 15; sequence += 1) await record(sequence);
    await dependencies.openPage(2, signal);
    await dependencies.privateInputProvider('chromium', 2, signal);
    for (let sequence = 16; sequence <= 18; sequence += 1) await record(sequence);
    harness.trace.push('scenario:closed');
    return overrides.result?.() ?? closedChromiumScenarioResult();
  };
}

function successHarness({ fixture = {}, remaining = {}, scenario = {} } = {}) {
  const clock = controlledAdvancingClock();
  const queues = fixtureQueues();
  const harness = {
    browserStarts: { chromium: undefined, firefox: undefined, webkit: undefined },
    clock,
    controlResults: [],
    cursors: Object.fromEntries(Object.entries(queues).map(([browser, sources]) => [
      browser,
      Object.fromEntries(Object.keys(sources).map((source) => [source, 0])),
    ])),
    queues,
    remainingCloseCalls: 0,
    retainedScopes: [],
    trace: [],
  };
  const components = {
    fixture: createReadyFixture(harness.trace, fixture),
    openChromiumPage: async (pageInstance) => {
      harness.trace.push(`openChromiumPage:${pageInstance}`);
      return Object.freeze({ pageInstance });
    },
    prepareChromiumPhase: async (phase) => {
      harness.trace.push(`prepareChromiumPhase:${phase}`);
    },
    remainingAdapter: createRemainingAdapter(harness, remaining),
  };
  harness.components = components;
  harness.scenarioRunner = createScenarioRunner(harness, scenario);
  harness.sessionFactory = () => {
    harness.trace.push('session:create');
    const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
    harness.browserStarts.chromium = clock.lastMilliseconds();
    return session;
  };
  harness.schedulerRunner = (adapter, options) => runBrowserRelayCaseScheduleForTest(
    harness.sessionFactory,
    adapter,
    options,
  );
  return harness;
}

test('pins the dormant Chromium composition with every live authority closed', () => {
  const profile = validateBrowserRelayChromiumCaseAdapterProfile();
  assert.equal(
    chromiumCaseAdapterDependencyContractsSha256(),
    CHROMIUM_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
  );
  assert.deepEqual(profile.composition.stage_order, CHROMIUM_CASE_ADAPTER_STAGE_ORDER);
  assert.deepEqual(
    profile.composition.chromium_page_stage_by_sequence,
    CHROMIUM_PAGE_STAGE_BY_SEQUENCE,
  );
  assert.deepEqual(
    profile.composition.chromium_control_stage_by_phase,
    CHROMIUM_CONTROL_STAGE_BY_PHASE,
  );
  assert.equal(profile.composition.fact_12_acknowledgement_waits_for_case, 'LIVE-09');
  assert.equal(profile.composition.remaining_chromium_page_source_blocked, true);
  assert.equal(profile.composition.fixture_lifecycle_methods_granted, false);
  assert.equal(profile.composition.cancellation_rechecked_before_external_action, true);
  assert.equal(profile.composition.global_close_drains_remaining_tasks, true);
  assert.equal(profile.compatibility.case_scheduler_composed, true);
  assert.equal(profile.compatibility.complete_chromium_page_scenario_composed, true);
  assert.equal(profile.compatibility.independent_live_source_adapters_present, false);
  assert.equal(profile.compatibility.secondary_live_browser_drivers_present, false);
  assert.ok(Object.values(profile.authority).every((value) => value === false));
  for (const digest of [
    CHROMIUM_CASE_ADAPTER_PROFILE_SHA256,
    CHROMIUM_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
  ]) assert.match(digest, /^[0-9a-f]{64}$/u);
});

test('composes the real scheduler into one closed 40-assertion result', async () => {
  const harness = successHarness();
  const result = await runBrowserRelayChromiumCaseScheduleForTesting(
    harness.schedulerRunner,
    harness.scenarioRunner,
    harness.components,
  );
  assert.equal(result.schema, 'miakapp.staging-browser-relay-runner-result/1');
  assert.equal(result.state, 'succeeded_closed_output');
  assert.equal(result.assertions_passed, 40);
  assert.equal(result.assertions_failed, 0);
  assert.equal(harness.remainingCloseCalls, 1);
  assert.deepEqual(
    harness.controlResults.map(({ phase }) => phase),
    CONTROL_PHASE_ORDER,
  );
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith('fixture:setTemperature')),
    ['fixture:setTemperature:21', 'fixture:setTemperature:23'],
  );
  assert.equal(
    harness.trace.filter((entry) => entry === 'fixture:rotateRelayToB').length,
    1,
  );
  assert.deepEqual(
    Object.keys(harness.components.fixture).sort(),
    [...CHROMIUM_CASE_ADAPTER_FIXTURE_METHODS].sort(),
  );
  assert.ok(!harness.trace.includes('remaining:closePage:chromium'));
  assert.ok(
    harness.trace.indexOf('remaining:execute:LIVE-09/chromium')
      < harness.trace.indexOf('scenario:projection-ack:12'),
    'fact 12 must remain backpressured until LIVE-09 is active',
  );
  assert.ok(
    harness.trace.indexOf('scenario:closed')
      < harness.trace.indexOf('remaining:startBrowser:firefox'),
    'native Chromium page closure must precede the secondary browser span',
  );
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith('remaining:closeBrowser')),
    [
      'remaining:closeBrowser:firefox',
      'remaining:closeBrowser:webkit',
      'remaining:closeBrowser:chromium',
    ],
  );
});

test('rejects any remaining-adapter attempt to steal Chromium page provenance', async () => {
  const harness = successHarness({
    remaining: {
      execute(scope, fill) {
        if (scope.case_id === 'LIVE-04' && scope.browser === 'chromium') {
          scope.record('browser_page', pageProjection(chromiumPageFacts()[0]));
        }
        fill();
      },
    },
  });
  await assert.rejects(
    runBrowserRelayChromiumCaseScheduleForTesting(
      harness.schedulerRunner,
      harness.scenarioRunner,
      harness.components,
    ),
    StagingBrowserRelayChromiumCaseAdapterError,
  );

  assert.equal(harness.remainingCloseCalls, 1);
});

test('revokes and makes every remaining-adapter scope non-serializable', async () => {
  let retained;
  const harness = successHarness({
    remaining: {
      execute(scope, fill) {
        assert.throws(() => JSON.stringify(scope), /cannot be serialized/u);
        if (scope.case_id === 'LIVE-02') retained = scope;
        if (scope.case_id === 'LIVE-03') {
          assert.throws(
            () => retained.record('control_plane', { observation: {} }),
            /no longer active/u,
          );
        }
        fill();
      },
    },
  });
  await assert.rejects(
    runBrowserRelayChromiumCaseScheduleForTesting(
      harness.schedulerRunner,
      harness.scenarioRunner,
      harness.components,
    ),
    StagingBrowserRelayChromiumCaseAdapterError,
  );
  assert.equal(harness.remainingCloseCalls, 1);
});

test('collapses malformed components and scenario results before exposure', async () => {
  const malformed = successHarness();
  await assert.rejects(
    runBrowserRelayChromiumCaseScheduleForTesting(
      malformed.schedulerRunner,
      malformed.scenarioRunner,
      { ...malformed.components, extra: true },
    ),
    StagingBrowserRelayChromiumCaseAdapterError,
  );

  const overbroadFixture = successHarness();
  overbroadFixture.components.fixture.create = async () => true;
  await assert.rejects(
    runBrowserRelayChromiumCaseScheduleForTesting(
      overbroadFixture.schedulerRunner,
      overbroadFixture.scenarioRunner,
      overbroadFixture.components,
    ),
    StagingBrowserRelayChromiumCaseAdapterError,
  );

  const descriptorTrap = {
    getOwnPropertyDescriptor() {
      throw new Error('private reflection failure');
    },
  };
  await assert.rejects(
    runBrowserRelayChromiumCaseScheduleForTesting(
      malformed.schedulerRunner,
      malformed.scenarioRunner,
      new Proxy(malformed.components, descriptorTrap),
    ),
    StagingBrowserRelayChromiumCaseAdapterError,
  );
  await assert.rejects(
    runBrowserRelayChromiumCaseScheduleForTesting(
      malformed.schedulerRunner,
      malformed.scenarioRunner,
      malformed.components,
      new Proxy({ signal: undefined }, descriptorTrap),
    ),
    StagingBrowserRelayChromiumCaseAdapterError,
  );

  const resultDrift = successHarness({
    scenario: {
      result: () => ({ schema: CHROMIUM_SCENARIO_RESULT_SCHEMA }),
    },
  });
  await assert.rejects(
    runBrowserRelayChromiumCaseScheduleForTesting(
      resultDrift.schedulerRunner,
      resultDrift.scenarioRunner,
      resultDrift.components,
    ),
    /failed before a closed result/u,
  );
  assert.equal(resultDrift.remainingCloseCalls, 1);
});

test('fails closed on premature, wrong, extra, and failing native scenarios', async (t) => {
  const cases = [
    {
      name: 'native failure',
      configure(harness) {
        harness.scenarioRunner = async () => {
          throw new Error('private native failure');
        };
      },
    },
    {
      name: 'premature close',
      configure(harness) {
        harness.scenarioRunner = async () => closedChromiumScenarioResult();
      },
    },
    {
      name: 'wrong first projection',
      configure(harness) {
        harness.scenarioRunner = async (_dependencies, port, options) => {
          await port.record(pageProjection(chromiumPageFacts()[12]), options.signal);
          return closedChromiumScenarioResult();
        };
      },
    },
    {
      name: 'extra projection',
      configure(harness) {
        const completeScenario = harness.scenarioRunner;
        harness.scenarioRunner = async (...arguments_) => {
          const result = await completeScenario(...arguments_);
          await arguments_[1].record(
            pageProjection(chromiumPageFacts()[0]),
            arguments_[2].signal,
          );
          return result;
        };
      },
    },
  ];
  for (const scenarioCase of cases) {
    await t.test(scenarioCase.name, async () => {
      const harness = successHarness();
      scenarioCase.configure(harness);
      await assert.rejects(
        runBrowserRelayChromiumCaseScheduleForTesting(
          harness.schedulerRunner,
          harness.scenarioRunner,
          harness.components,
        ),
        StagingBrowserRelayChromiumCaseAdapterError,
      );
      assert.equal(harness.remainingCloseCalls, 1);
    });
  }
});

test('aborts and drains an in-flight native scenario before global close returns', async () => {
  const started = deferred();
  const cleanup = deferred();
  const controller = new AbortController();
  const harness = successHarness({
    scenario: {
      async runner(_dependencies, _port, options) {
        started.resolve();
        await new Promise((resolve) => options.signal.addEventListener('abort', resolve, {
          once: true,
        }));
        harness.trace.push('scenario:abort-observed');
        await cleanup.promise;
        harness.trace.push('scenario:abort-drained');
        throw new Error('private native failure');
      },
    },
  });
  let settled = false;
  const execution = runBrowserRelayChromiumCaseScheduleForTesting(
    harness.schedulerRunner,
    harness.scenarioRunner,
    harness.components,
    { signal: controller.signal },
  );
  execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await withDeadline(started.promise, 'native scenario start');
    controller.abort();
    await waitFor(() => harness.trace.includes('scenario:abort-observed'));
    assert.equal(settled, false);
    assert.equal(harness.remainingCloseCalls, 0);
  } finally {
    controller.abort();
    cleanup.resolve();
  }
  await assert.rejects(execution, /failed before a closed result/u);
  assert.equal(harness.remainingCloseCalls, 1);
  assert.ok(
    harness.trace.indexOf('scenario:abort-drained')
      < harness.trace.indexOf('remaining:close'),
  );
});

test('drains an in-flight delegated stage before closing the remaining adapter', async () => {
  const started = deferred();
  const cleanup = deferred();
  const controller = new AbortController();
  const harness = successHarness({
    remaining: {
      async execute(scope, fill) {
        fill();
        if (scope.case_id !== 'LIVE-04' || scope.browser !== 'chromium') return;
        started.resolve();
        await new Promise((resolve) => {
          if (scope.signal.aborted) resolve();
          else scope.signal.addEventListener('abort', resolve, { once: true });
        });
        harness.trace.push('remaining:abort-observed');
        await cleanup.promise;
        harness.trace.push('remaining:abort-drained');
      },
    },
  });
  let settled = false;
  const execution = runBrowserRelayChromiumCaseScheduleForTesting(
    harness.schedulerRunner,
    harness.scenarioRunner,
    harness.components,
    { signal: controller.signal },
  );
  execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await withDeadline(started.promise, 'delegated stage start');
    controller.abort();
    await waitFor(() => harness.trace.includes('remaining:abort-observed'));
    assert.equal(settled, false);
    assert.equal(harness.remainingCloseCalls, 0);
  } finally {
    controller.abort();
    cleanup.resolve();
  }
  await assert.rejects(execution, /failed before a closed result/u);
  assert.equal(harness.remainingCloseCalls, 1);
  assert.ok(
    harness.trace.indexOf('remaining:abort-drained')
      < harness.trace.indexOf('remaining:close'),
  );
});

test('does not start a fixture mutation after cancellation during phase preparation', async () => {
  const started = deferred();
  const release = deferred();
  const controller = new AbortController();
  const harness = successHarness();
  harness.components.prepareChromiumPhase = async (phase) => {
    harness.trace.push(`prepareChromiumPhase:${phase}`);
    if (phase === 'patched_state') {
      started.resolve();
      await release.promise;
    }
  };
  const execution = runBrowserRelayChromiumCaseScheduleForTesting(
    harness.schedulerRunner,
    harness.scenarioRunner,
    harness.components,
    { signal: controller.signal },
  );
  try {
    await withDeadline(started.promise, 'phase preparation start');
    controller.abort();
  } finally {
    controller.abort();
    release.resolve();
  }
  await assert.rejects(execution, /failed before a closed result/u);
  assert.ok(!harness.trace.includes('fixture:setTemperature:21'));
  assert.equal(harness.remainingCloseCalls, 1);
});

test('fails the whole composition when remaining cleanup does not converge', async () => {
  const harness = successHarness({
    remaining: {
      close() { throw new Error('private cleanup failure'); },
    },
  });
  await assert.rejects(
    runBrowserRelayChromiumCaseScheduleForTesting(
      harness.schedulerRunner,
      harness.scenarioRunner,
      harness.components,
    ),
    /failed before a closed result/u,
  );
  assert.equal(harness.remainingCloseCalls, 1);
});

test('guards the exact package inventory, imports and dormant authority', () => {
  validateBrowserRelayChromiumCaseAdapterRoot(ADAPTER_ROOT);
  const mutations = [
    (root) => writeFileSync(join(root, 'unreviewed.mjs'), 'export default true;\n'),
    (root) => {
      const path = join(root, 'adapter.mjs');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        '../browser-relay-case-scheduler/scheduler.mjs',
        '../browser-relay-case-scheduler/testing.mjs',
      ));
    },
    (root) => {
      const path = join(root, 'internal.mjs');
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n// fetch('https://example.test')\n`);
    },
    (root) => {
      const path = join(root, 'internal.mjs');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        "source === 'browser_page'",
        "source === 'unreviewed_page'",
      ));
    },
  ];
  for (const mutate of mutations) {
    const root = mkdtempSync(join(tmpdir(), 'miakapp-chromium-case-adapter-'));
    try {
      for (const name of PACKAGE_FILES) copyFileSync(new URL(name, ADAPTER_ROOT), join(root, name));
      mutate(root);
      assert.throws(
        () => validateBrowserRelayChromiumCaseAdapterRoot(new URL(`file://${root}/`)),
        /inventory|imports|authority|safety boundary/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
