import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CASE_SCHEDULER_DEPENDENCY_CONTRACTS_SHA256,
  CASE_SCHEDULER_INTERNAL_SOURCE_SHA256,
  CASE_SCHEDULER_PROFILE_SHA256,
  CASE_SCHEDULER_SOURCE_SHA256,
  CASE_SCHEDULER_TESTING_SOURCE_SHA256,
  FACT_KINDS_BY_STAGE,
  RECORD_COUNTS_BY_STAGE,
  SCHEDULE_ACTIONS,
  STAGE_ORDER,
  StagingBrowserRelayCaseSchedulerError,
  browserRelayCaseSchedulerDependencyContractsSha256,
  validateBrowserRelayCaseSchedulerProfile,
} from '../browser-relay-case-scheduler/contract.mjs';
import {
  validateBrowserRelayCaseSchedulerRoot,
} from '../browser-relay-case-scheduler/guard.mjs';
import {
  runBrowserRelayCaseSchedule,
} from '../browser-relay-case-scheduler/scheduler.mjs';
import {
  runBrowserRelayCaseScheduleForTest,
} from '../browser-relay-case-scheduler/testing.mjs';
import {
  createBrowserRelayEvidenceSessionForTest,
} from '../browser-relay-evidence-session/testing.mjs';
import {
  INDEPENDENT_SOURCES_BY_BROWSER,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  chromiumPageFacts,
  fullIndependentFacts,
  independentProjection,
  pageProjection,
  secondaryPageFacts,
} from './helpers/browser-relay-evidence-fixture.mjs';

const SCHEDULER_ROOT = new URL('../browser-relay-case-scheduler/', import.meta.url);
const PACKAGE_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'scheduler.mjs',
  'testing.mjs',
]);
const EXPECTED_FACT_KINDS_BY_STAGE = Object.freeze({
  'LIVE-02/chromium': {
    firebase_app_check: [
      'provider_assessment',
      'valid_verification',
      'missing_token_denial',
      'invalid_token_denial',
      'verification_mode',
    ],
    hosting: ['management_site_configuration', 'served_sdk_configuration'],
  },
  'LIVE-03/chromium': {
    control_plane: [
      'cors_preflight',
      'foreign_origin_denial',
      'source_uid_admission',
      'authenticated_cache_policy',
    ],
  },
  'LIVE-04/chromium': {
    browser_page: [
      'initial_initialized',
      'initial_ready',
      'authoritative_state',
      'patched_state',
      'initial_call',
    ],
  },
  'LIVE-05/chromium': {
    browser_page: ['same_relay_reauthenticated'],
    control_plane: [
      'version_2_jwk_published',
      'version_1_last_issuance',
      'version_2_first_issuance',
    ],
    relay: ['version_2_existing_socket'],
  },
  'LIVE-06/chromium': {
    browser_page: [
      'relay_handoff_stale',
      'relay_b_ready',
      'relay_b_state',
      'relay_b_call',
    ],
    control_plane: ['atomic_credential_reuse'],
    firestore: ['authoritative_route_transition'],
  },
  'LIVE-07/chromium': {
    relay: [
      'wrong_audience_denial',
      'wrong_home_denial',
      'wrong_role_denial',
      'unknown_kid_refresh',
    ],
  },
  'LIVE-08/chromium': {
    browser_page: ['failed_and_uncertain_calls', 'relay_b_recovered'],
    relay: ['disconnect_reconnect_resync'],
    coordinator: ['physical_call_delivery'],
  },
  'LIVE-09/chromium': {
    browser_page: [
      'pagehide_suspended',
      'pageshow_restored',
      'signed_out_stopped',
      'replacement_initialized',
      'replacement_ready',
      'replacement_stopped',
    ],
  },
  'LIVE-10/firefox': {
    browser_page: ['initial_initialized', 'initial_ready', 'signed_out_stopped'],
    firebase_app_check: ['provider_assessment', 'valid_verification'],
    control_plane: ['exchange_summary'],
    relay: ['version_2_session', 'revision_summary'],
    kms: ['signature_summary'],
  },
  'LIVE-10/webkit': {
    browser_page: ['initial_initialized', 'initial_ready', 'signed_out_stopped'],
    firebase_app_check: ['provider_assessment', 'valid_verification'],
    control_plane: ['exchange_summary'],
    relay: ['version_2_session', 'revision_summary'],
    kms: ['signature_summary'],
  },
  'LIVE-11/chromium': {
    control_plane: [
      'version_1_jwk_retained',
      'version_1_jwk_removed',
      'exchange_summary',
    ],
    relay: ['new_session_version_2', 'revision_summary'],
    kms: ['signature_summary', 'version_1_lifecycle'],
    firestore: ['operation_write_summary'],
  },
});

function controlledAdvancingClock() {
  const origin = 20_000_000_000n;
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

function recordFixtureStage(scope, queues, cursors, clock, browserStarts) {
  const stageKey = `${scope.case_id}/${scope.browser}`;
  const records = [];
  let stableOrder = 0;
  for (const [source, expectedFacts] of Object.entries(
    EXPECTED_FACT_KINDS_BY_STAGE[stageKey],
  )) {
    const start = cursors[scope.browser][source];
    const values = queues[scope.browser][source].slice(start, start + expectedFacts.length);
    assert.deepEqual(values.map((value) => (
      source === 'browser_page' ? value.phase : value.kind
    )), expectedFacts);
    for (const value of values) {
      records.push({
        elapsed: value.elapsed_milliseconds,
        order: stableOrder += 1,
        source,
        projection: source === 'browser_page'
          ? pageProjection(value)
          : independentProjection(value),
      });
    }
    cursors[scope.browser][source] += expectedFacts.length;
  }
  if (scope.browser !== 'chromium' && browserStarts[scope.browser] === undefined) {
    browserStarts[scope.browser] = clock.lastMilliseconds();
  }
  const browserStart = browserStarts[scope.browser] ?? 0;
  records.sort((left, right) => left.elapsed - right.elapsed || left.order - right.order);
  for (const record of records) {
    clock.setAtLeastMilliseconds(browserStart + record.elapsed);
    assert.equal(scope.record(record.source, record.projection), true);
  }
}

function actualSuccessHarness(overrides = {}) {
  const clock = controlledAdvancingClock();
  const queues = fixtureQueues();
  const cursors = Object.fromEntries(Object.entries(queues).map(([browser, sources]) => [
    browser,
    Object.fromEntries(Object.keys(sources).map((source) => [source, 0])),
  ]));
  const browserStarts = { chromium: undefined, firefox: undefined, webkit: undefined };
  const trace = [];
  const retainedScopes = [];
  let closeCalls = 0;
  const adapter = {
    async startBrowser(browser) {
      trace.push(`startBrowser:${browser}`);
      clock.advanceMilliseconds();
      if (overrides.startBrowser !== undefined) return overrides.startBrowser(browser);
    },
    async execute(scope) {
      trace.push(`execute:${scope.case_id}/${scope.browser}`);
      retainedScopes.push(scope);
      if (overrides.execute !== undefined) return overrides.execute(
        scope,
        () => recordFixtureStage(scope, queues, cursors, clock, browserStarts),
      );
      recordFixtureStage(scope, queues, cursors, clock, browserStarts);
    },
    async closePage(browser) {
      trace.push(`closePage:${browser}`);
      clock.advanceMilliseconds();
      if (overrides.closePage !== undefined) return overrides.closePage(browser);
    },
    async closeBrowser(browser) {
      trace.push(`closeBrowser:${browser}`);
      clock.advanceMilliseconds();
      if (overrides.closeBrowser !== undefined) return overrides.closeBrowser(browser);
    },
    async close() {
      closeCalls += 1;
      trace.push('close');
      if (overrides.close !== undefined) return overrides.close();
    },
  };
  return {
    adapter,
    browserStarts,
    clock,
    closeCalls: () => closeCalls,
    cursors,
    queues,
    retainedScopes,
    sessionFactory: () => {
      trace.push('sessionCreate');
      const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
      browserStarts.chromium = clock.lastMilliseconds();
      return session;
    },
    trace,
  };
}

function fakeCapability(value) {
  Object.defineProperty(value, 'toJSON', {
    enumerable: false,
    value() { throw new Error('not serializable'); },
  });
  return value;
}

function fakeSession(trace = [], overrides = {}) {
  let state = 'collecting';
  return fakeCapability({
    port(browser, source) {
      trace.push(`port:${browser}/${source}`);
      return fakeCapability({
        record() {
          if (state !== 'collecting') throw new Error('revoked');
          return true;
        },
      });
    },
    startBrowser(browser) {
      trace.push(`sessionStartBrowser:${browser}`);
      if (overrides.startBrowser !== undefined) return overrides.startBrowser(browser);
      return true;
    },
    closePage(browser) {
      trace.push(`sessionClosePage:${browser}`);
      if (overrides.closePage !== undefined) return overrides.closePage(browser);
      return true;
    },
    finishBrowser(browser) {
      trace.push(`finishBrowser:${browser}`);
      if (overrides.finishBrowser !== undefined) return overrides.finishBrowser(browser);
      return true;
    },
    close() {
      trace.push('sessionClose');
      if (overrides.close !== undefined) return overrides.close();
      state = 'closed';
      return {
        schema: 'miakapp.staging-browser-relay-runner-result/1',
        state: 'succeeded_closed_output',
      };
    },
    abort() {
      trace.push('sessionAbort');
      state = 'aborted';
      return true;
    },
  });
}

function fillScope(scope) {
  const counts = RECORD_COUNTS_BY_STAGE[`${scope.case_id}/${scope.browser}`];
  for (const [source, count] of Object.entries(counts)) {
    for (let index = 0; index < count; index += 1) {
      scope.record(source, { projection: index });
    }
  }
}

function fakeAdapter(overrides = {}) {
  const trace = overrides.trace ?? [];
  let closeCalls = 0;
  return {
    adapter: {
      async startBrowser(browser, signal) {
        trace.push(`startBrowser:${browser}`);
        if (overrides.startBrowser !== undefined) return overrides.startBrowser(browser, signal);
      },
      async execute(scope) {
        trace.push(`execute:${scope.case_id}/${scope.browser}`);
        if (overrides.execute !== undefined) return overrides.execute(scope);
        fillScope(scope);
      },
      async closePage(browser, signal) {
        trace.push(`closePage:${browser}`);
        if (overrides.closePage !== undefined) return overrides.closePage(browser, signal);
      },
      async closeBrowser(browser, signal) {
        trace.push(`closeBrowser:${browser}`);
        if (overrides.closeBrowser !== undefined) return overrides.closeBrowser(browser, signal);
      },
      async close() {
        closeCalls += 1;
        trace.push('close');
        if (overrides.close !== undefined) return overrides.close();
      },
    },
    closeCalls: () => closeCalls,
    trace,
  };
}

test('pins a dormant exact scheduler with no live authority', () => {
  const profile = validateBrowserRelayCaseSchedulerProfile();
  assert.equal(
    browserRelayCaseSchedulerDependencyContractsSha256(),
    CASE_SCHEDULER_DEPENDENCY_CONTRACTS_SHA256,
  );
  assert.deepEqual(profile.schedule.stage_order, STAGE_ORDER);
  assert.deepEqual(FACT_KINDS_BY_STAGE, EXPECTED_FACT_KINDS_BY_STAGE);
  assert.deepEqual(profile.schedule.fact_kinds_by_stage, EXPECTED_FACT_KINDS_BY_STAGE);
  assert.deepEqual(profile.schedule.record_counts_by_stage, RECORD_COUNTS_BY_STAGE);
  assert.deepEqual(profile.schedule.action_plan, SCHEDULE_ACTIONS);
  assert.equal(profile.schedule.exact_fact_kind_partition, true);
  assert.equal(profile.schedule.exact_record_partition, true);
  assert.equal(profile.schedule.cross_source_total_order_imposed, false);
  assert.equal(profile.schedule.adapter_start_precedes_session_boundary, true);
  assert.equal(profile.schedule.external_abort_listener_protected, true);
  assert.equal(profile.schedule.adapter_methods_receive_internal_abort_signal, true);
  assert.equal(profile.schedule.adapter_close_once, true);
  assert.equal(profile.schedule.adapter_close_after_invoked_work_settles, true);
  assert.equal(profile.compatibility.evidence_session_production_entrypoint_only, true);
  assert.equal(profile.compatibility.durable_claim_binding_present, false);
  assert.equal(profile.compatibility.live_source_adapters_present, false);
  assert.equal(profile.compatibility.callback_resolution_proves_resource_closure, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(profile.evidence.live_execution_count, 0);
  for (const value of [
    CASE_SCHEDULER_PROFILE_SHA256,
    CASE_SCHEDULER_SOURCE_SHA256,
    CASE_SCHEDULER_INTERNAL_SOURCE_SHA256,
    CASE_SCHEDULER_TESTING_SOURCE_SHA256,
  ]) assert.match(value, /^[0-9a-f]{64}$/u);
});

test('runs the exact interleaved schedule and returns only the closed runner result', async () => {
  const harness = actualSuccessHarness();
  const result = await runBrowserRelayCaseScheduleForTest(
    harness.sessionFactory,
    harness.adapter,
  );
  assert.equal(result.schema, 'miakapp.staging-browser-relay-runner-result/1');
  assert.equal(result.state, 'succeeded_closed_output');
  assert.equal(result.assertions_passed, 40);
  assert.deepEqual(harness.trace, [
    'startBrowser:chromium',
    'sessionCreate',
    'execute:LIVE-02/chromium',
    'execute:LIVE-03/chromium',
    'execute:LIVE-04/chromium',
    'execute:LIVE-05/chromium',
    'execute:LIVE-06/chromium',
    'execute:LIVE-07/chromium',
    'execute:LIVE-08/chromium',
    'execute:LIVE-09/chromium',
    'closePage:chromium',
    'startBrowser:firefox',
    'execute:LIVE-10/firefox',
    'closePage:firefox',
    'closeBrowser:firefox',
    'startBrowser:webkit',
    'execute:LIVE-10/webkit',
    'closePage:webkit',
    'closeBrowser:webkit',
    'execute:LIVE-11/chromium',
    'closeBrowser:chromium',
    'close',
  ]);
  assert.equal(harness.closeCalls(), 1);
  for (const [browser, sources] of Object.entries(harness.queues)) {
    for (const [source, values] of Object.entries(sources)) {
      assert.equal(harness.cursors[browser][source], values.length);
    }
  }
  assert.equal(Object.isFrozen(harness.retainedScopes[0]), true);
  assert.deepEqual(Object.keys(harness.retainedScopes[0]), [
    'case_id',
    'browser',
    'signal',
    'record',
  ]);
  assert.throws(
    () => harness.retainedScopes[0].record('firebase_app_check', {}),
    /scope is no longer active/u,
  );
});

test('closes each physical adapter boundary before its evidence transition', async () => {
  const trace = [];
  const harness = fakeAdapter({ trace });
  await runBrowserRelayCaseScheduleForTest(
    () => {
      trace.push('sessionCreate');
      return fakeSession(trace);
    },
    harness.adapter,
  );
  assert.ok(trace.indexOf('startBrowser:chromium') < trace.indexOf('sessionCreate'));
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    assert.ok(trace.indexOf(`closePage:${browser}`) < trace.indexOf(`sessionClosePage:${browser}`));
  }
  for (const browser of ['firefox', 'webkit']) {
    assert.ok(trace.indexOf(`startBrowser:${browser}`)
      < trace.indexOf(`sessionStartBrowser:${browser}`));
  }
  for (const browser of ['firefox', 'webkit', 'chromium']) {
    assert.ok(trace.indexOf(`closeBrowser:${browser}`) < trace.indexOf(`finishBrowser:${browser}`));
  }
  assert.ok(trace.indexOf('close') < trace.indexOf('sessionClose'));
  assert.equal(harness.closeCalls(), 1);
});

test('rejects incomplete, extra, disallowed and serialized case scopes', async (context) => {
  const cases = [
    {
      name: 'incomplete',
      execute() {},
      error: /without every reviewed projection/u,
    },
    {
      name: 'extra',
      execute(scope) {
        fillScope(scope);
        const source = Object.keys(RECORD_COUNTS_BY_STAGE[`${scope.case_id}/${scope.browser}`])[0];
        scope.record(source, {});
      },
      error: /adapter execute failed closed/u,
    },
    {
      name: 'disallowed',
      execute(scope) { scope.record('kms', {}); },
      error: /adapter execute failed closed/u,
    },
    {
      name: 'serialized',
      execute(scope) { JSON.stringify(scope); },
      error: /adapter execute failed closed/u,
    },
  ];
  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const trace = [];
      const harness = fakeAdapter({ trace, execute: entry.execute });
      await assert.rejects(
        runBrowserRelayCaseScheduleForTest(() => fakeSession(trace), harness.adapter),
        entry.error,
      );
      assert.equal(harness.closeCalls(), 1);
      assert.equal(trace.includes('sessionAbort'), true);
      assert.equal(trace.some((value) => value === 'execute:LIVE-03/chromium'), false);
    });
  }
});

test('rejects adapter-provided values and collapses raw adapter failures', async (context) => {
  for (const entry of [
    {
      name: 'value',
      execute(scope) { fillScope(scope); return { result: 'forged' }; },
      error: /returned an unreviewed value/u,
    },
    {
      name: 'raw failure',
      execute() { throw new Error('secret adapter response'); },
      error: /adapter execute failed closed/u,
    },
  ]) {
    await context.test(entry.name, async () => {
      const harness = fakeAdapter({ execute: entry.execute });
      await assert.rejects(
        runBrowserRelayCaseScheduleForTest(() => fakeSession(), harness.adapter),
        (error) => {
          assert.match(error.message, entry.error);
          assert.doesNotMatch(error.message, /secret|forged/u);
          return true;
        },
      );
      assert.equal(harness.closeCalls(), 1);
    });
  }
});

test('fails closed when a page, browser or global adapter closure does not converge', async (context) => {
  for (const entry of [
    {
      name: 'page rejection',
      overrides: { closePage() { throw new Error('raw page'); } },
      error: /adapter closePage failed closed/u,
    },
    {
      name: 'browser value',
      overrides: { closeBrowser() { return true; } },
      error: /adapter closeBrowser returned an unreviewed value/u,
    },
    {
      name: 'global rejection',
      overrides: { close() { throw new Error('raw close'); } },
      error: /schedule failed before a closed result/u,
    },
  ]) {
    await context.test(entry.name, async () => {
      const trace = [];
      const harness = fakeAdapter({ trace, ...entry.overrides });
      await assert.rejects(
        runBrowserRelayCaseScheduleForTest(() => fakeSession(trace), harness.adapter),
        entry.error,
      );
      assert.equal(harness.closeCalls(), 1);
      assert.equal(trace.includes('sessionAbort'), true);
      assert.equal(trace.includes('sessionClose'), false);
    });
  }
});

test('fails closed when the evidence factory or a root transition fails', async (context) => {
  const cases = [
    {
      name: 'factory',
      factory() { throw new Error('secret factory failure'); },
      error: /factory failed before scheduling/u,
      later: 'sessionAbort',
    },
    {
      name: 'secondary start',
      overrides: { startBrowser() { return false; } },
      error: /transition did not close/u,
      later: 'execute:LIVE-10/firefox',
    },
    {
      name: 'page close',
      overrides: { closePage() { throw new Error('secret page transition'); } },
      error: /transition failed closed/u,
      later: 'startBrowser:firefox',
    },
    {
      name: 'browser close',
      overrides: { finishBrowser() { return false; } },
      error: /transition did not close/u,
      later: 'startBrowser:webkit',
    },
    {
      name: 'session close',
      overrides: { close() { throw new Error('secret session result'); } },
      error: /session failed before closure/u,
      later: undefined,
    },
  ];
  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const trace = [];
      const harness = fakeAdapter({ trace });
      await assert.rejects(
        runBrowserRelayCaseScheduleForTest(
          entry.factory ?? (() => fakeSession(trace, entry.overrides)),
          harness.adapter,
        ),
        (error) => {
          assert.match(error.message, entry.error);
          assert.doesNotMatch(error.message, /secret/u);
          return true;
        },
      );
      assert.equal(harness.closeCalls(), 1);
      if (entry.later !== undefined) assert.equal(trace.includes(entry.later), false);
      assert.equal(trace.includes('sessionClose') && entry.name !== 'session close', false);
      assert.equal(trace.includes('sessionAbort'), entry.name !== 'factory');
    });
  }
});

test('signals active work, awaits it, then closes once after an external abort', async () => {
  const trace = [];
  const controller = new AbortController();
  let executeSettled = false;
  const harness = fakeAdapter({
    trace,
    async execute(scope) {
      controller.abort(new Error('private abort reason'));
      assert.equal(scope.signal.aborted, true);
      await Promise.resolve();
      executeSettled = true;
    },
    async close() {
      assert.equal(executeSettled, true);
      trace.push('close-after-execute');
    },
  });
  await assert.rejects(
    runBrowserRelayCaseScheduleForTest(
      () => fakeSession(trace),
      harness.adapter,
      { signal: controller.signal },
    ),
    (error) => {
      assert.equal(executeSettled, true);
      assert.doesNotMatch(error.message, /private abort reason/u);
      return /aborted before closure/u.test(error.message);
    },
  );
  assert.equal(harness.closeCalls(), 1);
  assert.equal(trace.includes('sessionAbort'), true);
  assert.ok(trace.indexOf('close-after-execute') > trace.indexOf('execute:LIVE-02/chromium'));
  assert.equal(trace.some((value) => value === 'execute:LIVE-03/chromium'), false);
});

test('uses global close as a final barrier after abort-time startup settles', async () => {
  const controller = new AbortController();
  let browserResourceOpen = false;
  let startupSettled = false;
  let sessionFactoryCalls = 0;
  const harness = fakeAdapter({
    async startBrowser(browser, signal) {
      assert.equal(browser, 'chromium');
      assert.equal(signal instanceof AbortSignal, true);
      controller.abort(new Error('private startup abort'));
      await Promise.resolve();
      browserResourceOpen = true;
      startupSettled = true;
    },
    async close() {
      assert.equal(startupSettled, true);
      browserResourceOpen = false;
    },
  });
  await assert.rejects(
    runBrowserRelayCaseScheduleForTest(
      () => { sessionFactoryCalls += 1; return fakeSession(); },
      harness.adapter,
      { signal: controller.signal },
    ),
    /aborted before closure/u,
  );
  assert.equal(sessionFactoryCalls, 0);
  assert.equal(browserResourceOpen, false);
  assert.equal(harness.closeCalls(), 1);
});

test('observes abort even when an earlier listener stops immediate propagation', async () => {
  const controller = new AbortController();
  controller.signal.addEventListener('abort', (event) => event.stopImmediatePropagation());
  let internalSignalAborted = false;
  const harness = fakeAdapter({
    async execute(scope) {
      controller.abort(new Error('private blocked abort'));
      await Promise.resolve();
      internalSignalAborted = scope.signal.aborted;
    },
  });
  await assert.rejects(
    runBrowserRelayCaseScheduleForTest(
      () => fakeSession(),
      harness.adapter,
      { signal: controller.signal },
    ),
    /aborted before closure/u,
  );
  assert.equal(internalSignalAborted, true);
  assert.equal(harness.closeCalls(), 1);
});

test('rejects an already-aborted signal before creating the evidence session', async () => {
  const controller = new AbortController();
  controller.abort('private reason');
  let sessionFactoryCalls = 0;
  const harness = fakeAdapter();
  await assert.rejects(
    runBrowserRelayCaseScheduleForTest(
      () => { sessionFactoryCalls += 1; return fakeSession(); },
      harness.adapter,
      { signal: controller.signal },
    ),
    /aborted before closure/u,
  );
  assert.equal(sessionFactoryCalls, 0);
  assert.equal(harness.closeCalls(), 1);
});

test('validates exact adapters, options, factories and session capabilities', async () => {
  const harness = fakeAdapter();
  await assert.rejects(
    runBrowserRelayCaseScheduleForTest(undefined, harness.adapter),
    /requires one evidence session factory/u,
  );
  await assert.rejects(
    runBrowserRelayCaseScheduleForTest(() => ({}), harness.adapter),
    /invalid capability/u,
  );
  await assert.rejects(
    runBrowserRelayCaseScheduleForTest(() => fakeSession(), {
      startBrowser() {}, execute() {}, closePage() {}, closeBrowser() {}, close() {}, extra() {},
    }),
    /exactly the reviewed methods/u,
  );
  await assert.rejects(
    runBrowserRelayCaseScheduleForTest(() => fakeSession(), harness.adapter, { clock: Date.now }),
    /options differ from the reviewed fields/u,
  );
  assert.throws(
    () => runBrowserRelayCaseSchedule(),
    /accepts only an adapter/u,
  );
});

test('sanitizes hostile boundary reflection and accepts only native abort signals', async (context) => {
  const harness = fakeAdapter();
  const cases = [
    {
      name: 'adapter proxy',
      adapter: new Proxy(harness.adapter, {
        getPrototypeOf() { throw new Error('secret adapter proxy'); },
      }),
      options: {},
      error: /exactly the reviewed methods/u,
    },
    {
      name: 'symbol adapter field',
      adapter: Object.assign(harness.adapter, { [Symbol('hidden')]: true }),
      options: {},
      error: /exactly the reviewed methods/u,
    },
    {
      name: 'options proxy',
      adapter: fakeAdapter().adapter,
      options: new Proxy({}, {
        getPrototypeOf() { throw new Error('secret options proxy'); },
      }),
      error: /options differ from the reviewed fields/u,
    },
    {
      name: 'signal accessor',
      adapter: fakeAdapter().adapter,
      options: Object.defineProperty({}, 'signal', {
        enumerable: true,
        get() { throw new Error('secret signal accessor'); },
      }),
      error: /direct abort signal/u,
    },
    {
      name: 'duck typed signal',
      adapter: fakeAdapter().adapter,
      options: {
        signal: {
          aborted: false,
          addEventListener() {},
          removeEventListener() { throw new Error('secret listener removal'); },
        },
      },
      error: /external abort signal is invalid/u,
    },
    {
      name: 'hostile native signal proxy',
      adapter: fakeAdapter().adapter,
      options: {
        signal: new Proxy(new AbortController().signal, {
          get(target, key, receiver) {
            if (key === 'addEventListener') throw new Error('secret native signal trap');
            return Reflect.get(target, key, receiver);
          },
        }),
      },
      error: /external abort listener failed closed/u,
    },
  ];
  for (const entry of cases) {
    await context.test(entry.name, async () => {
      await assert.rejects(
        runBrowserRelayCaseScheduleForTest(() => fakeSession(), entry.adapter, entry.options),
        (error) => {
          assert.match(error.message, entry.error);
          assert.doesNotMatch(error.message, /secret/u);
          return true;
        },
      );
    });
  }
});

test('pins the exact package and production-only evidence-session import', async (context) => {
  validateBrowserRelayCaseSchedulerRoot(SCHEDULER_ROOT);
  function copiedPackage() {
    const directory = mkdtempSync(join(tmpdir(), 'miakapp-case-scheduler-'));
    for (const name of PACKAGE_FILES) {
      copyFileSync(new URL(name, SCHEDULER_ROOT), join(directory, name));
    }
    return directory;
  }
  await context.test('inventory', () => {
    const directory = copiedPackage();
    writeFileSync(join(directory, 'unexpected.mjs'), 'export default true;\n');
    assert.throws(
      () => validateBrowserRelayCaseSchedulerRoot(new URL(`file://${directory}/`)),
      /reviewed inventory/u,
    );
  });
  for (const entry of [
    {
      name: 'comment-separated dynamic import',
      source: "\nvoid import/* hidden */('node:https');\n",
    },
    {
      name: 'comment-separated side-effect import',
      source: "\nimport/* hidden */'node:https';\n",
    },
    {
      name: 'same-line side-effect import',
      source: "\nexport {}; import'node:https';\n",
    },
    {
      name: 'unspaced from import',
      source: "\nimport { request } from'node:https';\n",
    },
  ]) {
    await context.test(entry.name, () => {
      const directory = copiedPackage();
      const path = join(directory, 'testing.mjs');
      writeFileSync(path, `${readFileSync(path, 'utf8')}${entry.source}`);
      assert.throws(
        () => validateBrowserRelayCaseSchedulerRoot(new URL(`file://${directory}/`)),
        /source-only allowlist/u,
      );
    });
  }
});
