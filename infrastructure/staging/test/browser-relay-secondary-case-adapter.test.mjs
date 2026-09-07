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
  TARGET_URL,
} from '../browser-relay-page/contract.mjs';
import {
  runBrowserRelayPlaywrightBridge,
} from '../browser-relay-playwright-bridge/bridge.mjs';
import * as productionAdapter from '../browser-relay-secondary-case-adapter/adapter.mjs';
import {
  SECONDARY_CASE_ADAPTER_BROWSERS,
  SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS,
  SECONDARY_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
  SECONDARY_CASE_ADAPTER_PAGE_PROJECTION_FIELDS,
  SECONDARY_CASE_ADAPTER_PROFILE_SHA256,
  StagingBrowserRelaySecondaryCaseAdapterError,
  secondaryCaseAdapterDependencyContractsSha256,
  validateBrowserRelaySecondaryCaseAdapterProfile,
} from '../browser-relay-secondary-case-adapter/contract.mjs';
import {
  validateBrowserRelaySecondaryCaseAdapterRoot,
} from '../browser-relay-secondary-case-adapter/guard.mjs';
import {
  runBrowserRelaySecondaryCaseScheduleForTesting,
} from '../browser-relay-secondary-case-adapter/testing.mjs';
import {
  chromiumPageFacts,
  fullIndependentFacts,
  independentProjection,
  pageProjection,
  secondaryPageFacts,
} from './helpers/browser-relay-evidence-fixture.mjs';

const ADAPTER_ROOT = new URL('../browser-relay-secondary-case-adapter/', import.meta.url);
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
  assert.fail('Timed out waiting for the secondary composition checkpoint');
}

function controlledAdvancingClock() {
  const origin = 40_000_000_000n;
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

function createReadyFixture(trace, overrides = {}) {
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
      tokenIndex += 1;
      return Object.freeze({
        schema: 'miakapp.staging-browser-relay-page-input/1',
        browser,
        firebase_custom_token: token(String.fromCharCode(96 + tokenIndex)),
      });
    },
    async rotateRelayToB() {
      trace.push('fixture:rotateRelayToB');
      return overrides.rotateRelayToB?.() ?? true;
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

function recordIndependentStage(scope, harness) {
  const stageKey = `${scope.case_id}/${scope.browser}`;
  const records = [];
  let stableOrder = 0;
  for (const [source, expectedKinds] of Object.entries(FACT_KINDS_BY_STAGE[stageKey])) {
    if (source === 'browser_page') continue;
    const start = harness.cursors[scope.browser][source];
    const values = harness.independent[scope.browser][source]
      .slice(start, start + expectedKinds.length);
    assert.deepEqual(values.map(({ kind }) => kind), expectedKinds);
    for (const value of values) {
      records.push({
        elapsed: value.elapsed_milliseconds,
        order: stableOrder += 1,
        projection: independentProjection(value),
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
        return overrides.execute(scope, () => recordIndependentStage(scope, harness));
      }
      recordIndependentStage(scope, harness);
    },
    async closePage(browser, signal) {
      harness.trace.push(`remaining:closePage:${browser}`);
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

function successHarness({ bridgeRunner, fixture = {}, remaining = {} } = {}) {
  const clock = controlledAdvancingClock();
  const independent = fullIndependentFacts();
  const trace = [];
  const pages = {};
  const harness = {
    browserStarts: { chromium: undefined, firefox: undefined, webkit: undefined },
    clock,
    cursors: Object.fromEntries(Object.entries(independent).map(([browser, sources]) => [
      browser,
      Object.fromEntries(Object.keys(sources).map((source) => [source, 0])),
    ])),
    independent,
    pages,
    remainingCloseCalls: 0,
    retainedScopes: [],
    trace,
  };
  harness.components = {
    fixture: createReadyFixture(trace, fixture),
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
    remainingAdapter: createRemainingAdapter(harness, remaining),
  };
  harness.scenarioRunner = createChromiumScenarioRunner(harness);
  harness.schedulerRunner = (adapter, options) => runBrowserRelayCaseScheduleForTest(
    () => {
      trace.push('session:create');
      const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
      harness.browserStarts.chromium = clock.lastMilliseconds();
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
  harness.bridgeRunner = bridgeRunner ?? runBrowserRelayPlaywrightBridge;
  harness.run = (options) => runBrowserRelaySecondaryCaseScheduleForTesting(
    harness.chromiumCaseRunner,
    harness.bridgeRunner,
    harness.components,
    options,
  );
  return harness;
}

test('loads the exact production adapter entrypoint', () => {
  assert.deepEqual(Object.keys(productionAdapter), [
    'runBrowserRelaySecondaryCaseSchedule',
  ]);
  assert.equal(typeof productionAdapter.runBrowserRelaySecondaryCaseSchedule, 'function');
});

test('pins the dormant secondary composition with every live authority closed', () => {
  const profile = validateBrowserRelaySecondaryCaseAdapterProfile();
  assert.equal(
    secondaryCaseAdapterDependencyContractsSha256(),
    SECONDARY_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
  );
  assert.deepEqual(profile.composition.component_fields,
    SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS);
  assert.deepEqual(profile.composition.secondary_browser_order,
    SECONDARY_CASE_ADAPTER_BROWSERS);
  assert.deepEqual(profile.composition.page_projection_fields,
    SECONDARY_CASE_ADAPTER_PAGE_PROJECTION_FIELDS);
  assert.equal(profile.composition.remaining_browser_page_source_blocked, true);
  assert.equal(profile.composition.session_owns_authoritative_fact_envelope, true);
  assert.equal(profile.composition.global_close_drains_dependency_tasks, true);
  assert.equal(profile.composition.late_secondary_page_cleanup_before_remaining_close, true);
  assert.equal(profile.compatibility.complete_three_browser_page_scenarios_composed, true);
  assert.equal(profile.compatibility.independent_live_source_adapters_present, false);
  assert.equal(profile.compatibility.secondary_live_browser_providers_present, false);
  assert.equal(profile.compatibility.dedicated_process_browser_driver_present, false);
  assert.ok(Object.values(profile.authority).every((value) => value === false));
  for (const digest of [
    SECONDARY_CASE_ADAPTER_PROFILE_SHA256,
    SECONDARY_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
  ]) assert.match(digest, /^[0-9a-f]{64}$/u);
});

test('composes both real bridge reducers into one closed 40-assertion schedule', async () => {
  const harness = successHarness();
  const result = await harness.run();
  assert.equal(result.schema, 'miakapp.staging-browser-relay-runner-result/1');
  assert.equal(result.state, 'succeeded_closed_output');
  assert.equal(result.assertions_passed, 40);
  assert.equal(result.assertions_failed, 0);
  assert.equal(harness.remainingCloseCalls, 1);
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith('fixture:privateInput')),
    [
      'fixture:privateInput:chromium:1',
      'fixture:privateInput:chromium:2',
      'fixture:privateInput:firefox:1',
      'fixture:privateInput:webkit:1',
    ],
  );
  for (const browser of SECONDARY_CASE_ADAPTER_BROWSERS) {
    assert.equal(harness.pages[browser].closeCalls(), 1);
    assert.deepEqual(
      harness.trace.filter((entry) => entry.startsWith(`page:${browser}:`)),
      [
        `page:${browser}:initialize`,
        `page:${browser}:start`,
        `page:${browser}:stop`,
        `page:${browser}:closed`,
      ],
    );
  }
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith('remaining:closePage')),
    [],
  );
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith('remaining:closeBrowser')),
    [
      'remaining:closeBrowser:firefox',
      'remaining:closeBrowser:webkit',
      'remaining:closeBrowser:chromium',
    ],
  );
  assert.ok(
    harness.trace.indexOf('page:firefox:closed')
      < harness.trace.indexOf('remaining:closeBrowser:firefox'),
  );
  assert.ok(
    harness.trace.indexOf('remaining:closeBrowser:firefox')
      < harness.trace.indexOf('openSecondaryPage:webkit'),
  );
});

test('blocks downstream page provenance theft and revokes retained scopes', async (t) => {
  await t.test('page theft', async () => {
    const harness = successHarness({
      remaining: {
        execute(scope, fill) {
          if (scope.case_id === 'LIVE-10') {
            scope.record('browser_page', pageProjection(secondaryPageFacts(scope.browser)[0]));
          }
          fill();
        },
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelaySecondaryCaseAdapterError);
    assert.equal(harness.remainingCloseCalls, 1);
  });

  await t.test('revoked scope', async () => {
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
    await assert.rejects(harness.run(), StagingBrowserRelaySecondaryCaseAdapterError);
    assert.equal(harness.remainingCloseCalls, 1);
  });
});

test('collapses malformed components and forged bridge closure', async () => {
  const malformed = successHarness();
  await assert.rejects(
    runBrowserRelaySecondaryCaseScheduleForTesting(
      malformed.chromiumCaseRunner,
      malformed.bridgeRunner,
      { ...malformed.components, extra: true },
    ),
    StagingBrowserRelaySecondaryCaseAdapterError,
  );
  assert.equal(malformed.remainingCloseCalls, 0);

  const descriptorTrap = {
    getOwnPropertyDescriptor() {
      throw new Error('private reflection failure');
    },
  };
  await assert.rejects(
    runBrowserRelaySecondaryCaseScheduleForTesting(
      malformed.chromiumCaseRunner,
      malformed.bridgeRunner,
      new Proxy(malformed.components, descriptorTrap),
    ),
    StagingBrowserRelaySecondaryCaseAdapterError,
  );

  const forged = successHarness({
    bridgeRunner: async (browser) => ({
      schema: 'miakapp.staging-browser-relay-playwright-bridge-result/1',
      browser,
      state: 'receipt_closed',
    }),
  });
  await assert.rejects(forged.run(), /failed before a closed result/u);
  assert.equal(forged.remainingCloseCalls, 1);
});

test('rejects incomplete and excessive bridge fact partitions', async (t) => {
  await t.test('no facts', async () => {
    const harness = successHarness({
      bridgeRunner: async (browser) => ({
        schema: 'miakapp.staging-browser-relay-playwright-bridge-result/1',
        browser,
        state: 'blocked',
        reason: 'none',
        private_inputs_requested: 0,
        receipt: null,
      }),
    });
    await assert.rejects(harness.run(), StagingBrowserRelaySecondaryCaseAdapterError);
    assert.equal(harness.remainingCloseCalls, 1);
  });

  await t.test('fourth fact', async () => {
    const harness = successHarness({
      bridgeRunner: async (browser, dependencies, options) => {
        await dependencies.openPage(browser, options.signal);
        const producer = dependencies.receiptProducerFactory(browser);
        await dependencies.privateInputProvider(browser, 1, options.signal);
        const facts = secondaryPageFacts(browser);
        producer.record(facts[0]);
        producer.record(facts[1]);
        producer.record(facts[2]);
        producer.record(facts[0]);
      },
    });
    await assert.rejects(harness.run(), StagingBrowserRelaySecondaryCaseAdapterError);
    assert.equal(harness.remainingCloseCalls, 1);
  });
});

test('aborts and drains an in-flight bridge before downstream close', async () => {
  const started = deferred();
  const release = deferred();
  const controller = new AbortController();
  const harness = successHarness({
    bridgeRunner: async (browser, _dependencies, options) => {
      if (browser !== 'firefox') return runBrowserRelayPlaywrightBridge(
        browser,
        _dependencies,
        options,
      );
      started.resolve();
      await new Promise((resolve) => {
        if (options.signal.aborted) resolve();
        else options.signal.addEventListener('abort', resolve, { once: true });
      });
      harness.trace.push('bridge:abort-observed');
      await release.promise;
      harness.trace.push('bridge:abort-drained');
      throw new Error('private bridge failure');
    },
  });
  let settled = false;
  const execution = harness.run({ signal: controller.signal });
  execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await withDeadline(started.promise, 'secondary bridge start');
    controller.abort();
    await waitFor(() => harness.trace.includes('bridge:abort-observed'));
    assert.equal(settled, false);
    assert.equal(harness.remainingCloseCalls, 0);
  } finally {
    controller.abort();
    release.resolve();
  }
  await assert.rejects(execution, /failed before a closed result/u);
  assert.equal(harness.remainingCloseCalls, 1);
  assert.ok(
    harness.trace.indexOf('bridge:abort-drained')
      < harness.trace.indexOf('remaining:close'),
  );
});

test('hands a late secondary page to the aborted bridge for ordered cleanup', async () => {
  const pageRequested = deferred();
  const bridgeSettled = deferred();
  const releasePage = deferred();
  const controller = new AbortController();
  const harness = successHarness();
  harness.components.openSecondaryPage = async (browser) => {
    harness.trace.push(`openSecondaryPage:${browser}`);
    harness.pages[browser] = mockSecondaryPage(browser, harness.trace);
    if (browser === 'firefox') {
      pageRequested.resolve();
      await releasePage.promise;
    }
    return harness.pages[browser];
  };
  harness.bridgeRunner = async (browser, dependencies, options) => {
    try {
      return await runBrowserRelayPlaywrightBridge(browser, dependencies, options);
    } finally {
      if (browser === 'firefox') bridgeSettled.resolve();
    }
  };
  let settled = false;
  const execution = harness.run({ signal: controller.signal });
  execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await withDeadline(pageRequested.promise, 'late secondary page request');
    controller.abort();
    await withDeadline(bridgeSettled.promise, 'aborted secondary bridge settlement');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(harness.remainingCloseCalls, 0);
    assert.equal(harness.pages.firefox.closeCalls(), 0);
  } finally {
    releasePage.resolve();
  }
  await assert.rejects(execution, /failed before a closed result/u);
  assert.equal(harness.pages.firefox.closeCalls(), 1);
  assert.equal(harness.remainingCloseCalls, 1);
  assert.ok(
    harness.trace.indexOf('page:firefox:closed')
      < harness.trace.indexOf('remaining:close'),
  );
});

test('drains a late private input after the bridge has rejected', async () => {
  const inputRequested = deferred();
  const bridgeSettled = deferred();
  const releaseInput = deferred();
  const controller = new AbortController();
  const harness = successHarness({
    fixture: {
      async privateInput(browser, identityGeneration) {
        if (browser === 'firefox') {
          inputRequested.resolve();
          await releaseInput.promise;
        }
        return Object.freeze({
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser,
          firebase_custom_token: token(String(identityGeneration)),
        });
      },
    },
  });
  harness.bridgeRunner = async (browser, dependencies, options) => {
    try {
      return await runBrowserRelayPlaywrightBridge(browser, dependencies, options);
    } finally {
      if (browser === 'firefox') bridgeSettled.resolve();
    }
  };
  let settled = false;
  const execution = harness.run({ signal: controller.signal });
  execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await withDeadline(inputRequested.promise, 'late secondary private input request');
    controller.abort();
    await withDeadline(bridgeSettled.promise, 'private-input bridge settlement');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(harness.remainingCloseCalls, 0);
  } finally {
    releaseInput.resolve();
  }
  await assert.rejects(execution, /failed before a closed result/u);
  assert.equal(harness.pages.firefox.closeCalls(), 1);
  assert.equal(harness.remainingCloseCalls, 1);
  assert.ok(
    harness.trace.indexOf('page:firefox:closed')
      < harness.trace.indexOf('remaining:close'),
  );
});

test('fails the whole composition when downstream cleanup does not converge', async () => {
  const harness = successHarness({
    remaining: {
      close() { throw new Error('private cleanup failure'); },
    },
  });
  await assert.rejects(harness.run(), /failed before a closed result/u);
  assert.equal(harness.remainingCloseCalls, 1);
});

test('guards exact package inventory, imports and source-only authority', () => {
  validateBrowserRelaySecondaryCaseAdapterRoot(ADAPTER_ROOT);
  const mutations = [
    (root) => writeFileSync(join(root, 'unreviewed.mjs'), 'export default true;\n'),
    (root) => {
      const path = join(root, 'adapter.mjs');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        '../browser-relay-chromium-case-adapter/adapter.mjs',
        '../browser-relay-chromium-case-adapter/testing.mjs',
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
    const root = mkdtempSync(join(tmpdir(), 'miakapp-secondary-case-adapter-'));
    try {
      for (const name of PACKAGE_FILES) copyFileSync(new URL(name, ADAPTER_ROOT), join(root, name));
      mutate(root);
      assert.throws(
        () => validateBrowserRelaySecondaryCaseAdapterRoot(new URL(`file://${root}/`)),
        /inventory|imports|authority|safety boundary/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('pins the complete Chromium control order used by the composed fake', () => {
  assert.deepEqual(CONTROL_PHASE_ORDER, [
    'authoritative_state',
    'patched_state',
    'initial_call',
    'same_relay_reauthenticated',
    'relay_handoff_stale',
    'relay_b_ready',
    'relay_b_state',
    'relay_b_call',
    'failed_call',
    'uncertain_call',
    'relay_b_recovered',
  ]);
});
