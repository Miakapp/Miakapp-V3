import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { pathToFileURL } from 'node:url';

import {
  CHROMIUM_SCENARIO_AWAY_URL,
  CHROMIUM_SCENARIO_RESULT_SCHEMA,
  CONTROL_PHASE_ORDER,
  StagingBrowserRelayChromiumScenarioError,
  validateBrowserRelayChromiumScenarioProfile,
  validateChromiumScenarioControlResult,
  validateChromiumScenarioResult,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  runBrowserRelayChromiumScenarioInternal as runTrustedBrowserRelayChromiumScenarioInternal,
  runBrowserRelayChromiumScenarioInternalForTesting as runBrowserRelayChromiumScenarioInternal,
} from '../browser-relay-chromium-scenario/internal.mjs';
import { runBrowserRelayChromiumScenario } from '../browser-relay-chromium-scenario/scenario.mjs';
import {
  runBrowserRelayChromiumScenarioForTesting,
  runBrowserRelayChromiumScenarioWithPageProjectionPortForTesting,
} from '../browser-relay-chromium-scenario/testing.mjs';
import { validateBrowserRelayChromiumScenarioRoot } from '../browser-relay-chromium-scenario/guard.mjs';
import { TARGET_URL } from '../browser-relay-page/contract.mjs';
import { chromiumPageFacts } from './helpers/browser-relay-evidence-fixture.mjs';

const SCENARIO_ROOT = new URL('../browser-relay-chromium-scenario/', import.meta.url);
const SCENARIO_FILES = Object.freeze([
  'README.md',
  'away.html',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile-v1.json',
  'profile.json',
  'scenario.mjs',
  'testing.mjs',
]);

function token(a, b, c) {
  return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
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

function pageProjectionPort(record) {
  const port = { record };
  Object.defineProperty(port, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      throw new Error('Chromium scenario page-projection ports cannot be serialized');
    },
  });
  return Object.freeze(port);
}

function projectPageFact(fact) {
  return {
    call_observation: fact.call_observation,
    lifecycle_event: fact.lifecycle_event,
    lifecycle_observation: fact.lifecycle_observation,
    observation: fact.observation,
    state_observation: fact.state_observation,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Timed out waiting for the deterministic scenario checkpoint');
}

function actionResult(fact, override) {
  return {
    state: 'completed',
    observation: fact.observation,
    lifecycle_observation: fact.lifecycle_observation,
    action_result: override !== undefined
      ? override
      : (fact.state_observation ?? fact.call_observation),
  };
}

function createCdp(facts, events, requests, mutations = {}) {
  const listeners = new Map();
  let historyReads = 0;
  let detached = 0;
  let detachFailuresRemaining = mutations.detachFailures
    ?? (mutations.detachFailure ? Number.POSITIVE_INFINITY : 0);
  const targetEntry = { id: 10, url: TARGET_URL };
  const awayEntry = { id: 11, url: CHROMIUM_SCENARIO_AWAY_URL };
  return {
    detachCalls: () => detached,
    listenerCount: (name) => listeners.get(name)?.size ?? 0,
    on(name, listener) {
      if (mutations.listenerFailure === name) throw new Error('raw listener failure');
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    off(name, listener) { listeners.get(name)?.delete(listener); },
    async detach() {
      detached += 1;
      if (detachFailuresRemaining > 0) {
        detachFailuresRemaining -= 1;
        throw new Error('raw detach failure');
      }
    },
    async send(method, parameters) {
      events.push(method);
      if (method === 'Page.enable') return {};
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'main', url: TARGET_URL } } };
      }
      if (method === 'Page.getNavigationHistory') {
        historyReads += 1;
        if (mutations.lateDuplicateRestore && historyReads === 3) {
          for (const listener of listeners.get('Page.frameNavigated') ?? []) {
            listener({
              frame: { id: 'main', url: TARGET_URL },
              type: 'BackForwardCacheRestore',
            });
          }
        }
        if (historyReads === 1) return { currentIndex: 0, entries: [targetEntry] };
        if (historyReads === 2) {
          return { currentIndex: 1, entries: [targetEntry, awayEntry] };
        }
        return { currentIndex: 0, entries: [targetEntry, awayEntry] };
      }
      if (method === 'Page.navigateToHistoryEntry') {
        assert.equal(parameters.entryId, 10);
        if (mutations.bfcacheNotUsed) {
          for (const listener of listeners.get('Page.backForwardCacheNotUsed') ?? []) {
            listener({ notRestoredExplanations: [{ reason: 'discarded' }] });
          }
        } else {
          const type = mutations.normalRestore ? 'Navigation' : 'BackForwardCacheRestore';
          for (const listener of listeners.get('Page.frameNavigated') ?? []) {
            listener({ frame: { id: 'main', url: TARGET_URL }, type });
            if (mutations.duplicateRestore) {
              listener({ frame: { id: 'main', url: TARGET_URL }, type });
            }
          }
        }
        return {};
      }
      if (method === 'Runtime.evaluate') {
        const serialized = parameters.expression.match(/\)\((\{.*\})\)$/su)?.[1];
        assert.notEqual(serialized, undefined);
        requests.push(JSON.parse(serialized));
        if (parameters.expression.includes('"selectedOperation":"witness"')) {
          if (mutations.lateBfcacheNotUsed) {
            for (const listener of listeners.get('Page.backForwardCacheNotUsed') ?? []) {
              listener({ notRestoredExplanations: [{ reason: 'discarded' }] });
            }
          }
          return {
            result: {
              value: mutations.missingWitness
                ? { state: 'failed' }
                : {
                  state: 'completed',
                  pagehide: {
                    event: facts[12].lifecycle_event,
                    observation: facts[12].observation,
                    lifecycle_observation: facts[12].lifecycle_observation,
                  },
                  pageshow: {
                    event: facts[13].lifecycle_event,
                    observation: facts[13].observation,
                    lifecycle_observation: facts[13].lifecycle_observation,
                  },
                },
            },
          };
        }
        if (parameters.expression.includes('"selectedOperation":"observeState"')) {
          return { result: { value: actionResult(facts[13]) } };
        }
        if (parameters.expression.includes('"selectedOperation":"stop"')) {
          return { result: { value: actionResult(facts[14], null) } };
        }
      }
      throw new Error('raw unexpected CDP command');
    },
  };
}

function createPage(pageInstance, facts, order, mutations = {}) {
  let url = mutations.url ?? TARGET_URL;
  let closeCalls = 0;
  let closed = false;
  let closeFailuresRemaining = mutations.closeFailures
    ?? (mutations.closeFailure ? Number.POSITIVE_INFINITY : 0);
  let rejectPendingAction;
  const cdpEvents = [];
  const cdpRequests = [];
  const pageActions = [];
  const cdp = pageInstance === 1
    ? createCdp(facts, cdpEvents, cdpRequests, mutations)
    : undefined;
  const tracing = {
    _harRecorders: new Map(mutations.harRecording ? [['har', {}]] : []),
    _isTracing: mutations.tracingActive ?? false,
  };
  if (mutations.activeHarId) tracing._harId = 'active-har';
  const context = {
    _connection: {
      _callbacks: new Map(mutations.pendingCallback !== undefined
        ? [[1, mutations.pendingCallback]]
        : (mutations.pendingCaptureTransition
          ? [[1, { type: 'Tracing', method: 'tracingStartChunk' }]]
          : [])),
      _tracingCount: mutations.connectionTracingCount
        ?? (mutations.tracingActive ? 1 : 0),
      async sendMessageToServer() { return undefined; },
    },
    _logger: mutations.loggerActive ? {} : undefined,
    _options: mutations.recordVideo ? { recordVideo: {} } : {},
    tracing,
    async newCDPSession(selected) {
      assert.equal(selected, page);
      order.push(`page:${pageInstance}:newCDPSession`);
      if (mutations.pendingCdpSession) return new Promise(() => {});
      if (mutations.cdpSessionGate !== undefined) return mutations.cdpSessionGate;
      return cdp;
    },
  };
  const queues = pageInstance === 1
    ? {
      initialize: [actionResult(facts[0], null)],
      start: [actionResult(facts[1], null)],
      observeState: [
        actionResult(facts[2]),
        actionResult(facts[3]),
        actionResult(facts[6]),
        actionResult(facts[8]),
        actionResult(facts[10]),
        actionResult(facts[11]),
      ],
      callApplied: [actionResult(facts[4]), actionResult(facts[9])],
      observe: [actionResult(facts[5], null), actionResult(facts[7], null)],
      callFailed: [actionResult(facts[9], {
        schema: 'miakapp.staging-browser-relay-page-call-observation/1',
        state: 'failed',
        outcome: 'failed',
      })],
      callUncertain: [actionResult(facts[10], {
        schema: 'miakapp.staging-browser-relay-page-call-observation/1',
        state: 'failed',
        outcome: 'outcome_unknown',
      })],
    }
    : {
      initialize: [actionResult(facts[15], null)],
      start: [actionResult(facts[16], null)],
      stop: [actionResult(facts[17], null)],
    };
  const evaluatePage = async (_callback, parameters) => {
    if (parameters.witnessName !== undefined) {
      order.push(`page:${pageInstance}:witness`);
      return mutations.witnessInstallFailure ? false : true;
    }
    const selected = parameters.selectedAction;
    pageActions.push({ action: selected, argument: parameters.selectedArgument });
    order.push(`page:${pageInstance}:${selected}`);
    if (mutations.pendingAction === selected) {
      return new Promise((_, rejectAction) => { rejectPendingAction = rejectAction; });
    }
    const result = queues[selected]?.shift();
    if (result === undefined) throw new Error('raw unexpected page action');
    return result;
  };
  const page = {
    captureContext: context,
    cdp,
    cdpEvents,
    cdpRequests,
    pageActions,
    closeCalls: () => closeCalls,
    isClosed: () => closed,
    url: () => url,
    context: () => context,
    video: () => (mutations.recordVideo ? {} : null),
    async goto(destination) {
      order.push(`page:${pageInstance}:goto`);
      assert.equal(destination, CHROMIUM_SCENARIO_AWAY_URL);
      url = destination;
      return null;
    },
    evaluate: evaluatePage,
    async close() {
      closeCalls += 1;
      order.push(`page:${pageInstance}:close`);
      if (closeFailuresRemaining > 0) {
        closeFailuresRemaining -= 1;
        throw new Error('raw close failure');
      }
      closed = true;
      rejectPendingAction?.(new Error('raw page closed'));
    },
  };
  const frame = Object.assign(Object.create({
    async evaluate(pageFunction, parameters) {
      const apiZone = {};
      this._instrumentation.onApiCallBegin?.(apiZone, {
        method: 'evaluateExpression',
        params: parameters,
        type: 'Frame',
      });
      try {
        return await evaluatePage(pageFunction, parameters);
      } finally {
        this._instrumentation.onApiCallEnd?.(apiZone);
      }
    },
  }), {
    _connection: context._connection,
    _instrumentation: {
      onApiCallBegin(_apiZone, call) {
        mutations.instrumentationObserver?.(call.params);
      },
      onApiCallEnd() {},
    },
    _logger: undefined,
    _page: page,
    _type: 'Frame',
  });
  page._mainFrame = frame;
  if (mutations.instrumentationObserver !== undefined) {
    frame._instrumentation.onApiCallBegin({}, {
      method: 'evaluateExpression',
      params: { harmless_probe: true },
      type: 'Frame',
    });
  }
  if (mutations.pageEvaluateObserver !== undefined) {
    const evaluate = page.evaluate;
    page.evaluate = (...parameters) => {
      mutations.pageEvaluateObserver(parameters[1]);
      return evaluate(...parameters);
    };
  }
  return page;
}

function scenarioFixture(mutations = {}) {
  const facts = chromiumPageFacts();
  const order = [];
  const pages = [];
  let now = 1_000;
  let inputRequests = 0;
  const controls = {
    authoritative_state: {
      schema: 'miakapp.staging-browser-relay-chromium-state-control/1',
      state_expectation: { path: 'acceptance.temperature', revision: 1, value: 20 },
    },
    patched_state: {
      schema: 'miakapp.staging-browser-relay-chromium-state-control/1',
      state_expectation: { path: 'acceptance.temperature', revision: 2, value: 21 },
    },
    initial_call: {
      schema: 'miakapp.staging-browser-relay-chromium-call-control/1', call_target: 21,
    },
    same_relay_reauthenticated: undefined,
    relay_handoff_stale: undefined,
    relay_b_ready: undefined,
    relay_b_state: {
      schema: 'miakapp.staging-browser-relay-chromium-state-control/1',
      state_expectation: { path: 'acceptance.temperature', revision: 3, value: 22 },
    },
    relay_b_call: {
      schema: 'miakapp.staging-browser-relay-chromium-call-control/1', call_target: 22,
    },
    failed_call: {
      schema: 'miakapp.staging-browser-relay-chromium-call-control/1', call_target: 23,
    },
    uncertain_call: {
      schema: 'miakapp.staging-browser-relay-chromium-call-control/1', call_target: 24,
    },
    relay_b_recovered: {
      schema: 'miakapp.staging-browser-relay-chromium-state-control/1',
      state_expectation: { path: 'acceptance.temperature', revision: 4, value: 23 },
    },
  };
  return {
    controls,
    order,
    pages,
    inputRequests: () => inputRequests,
    timing: {
      clock: () => now,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      maximumMilliseconds: 600_000,
    },
    dependencies: {
      async openPage(pageInstance) {
        order.push(`open:${pageInstance}`);
        if (mutations.reuseFirstPage && pageInstance === 2) return pages[0];
        const page = createPage(pageInstance, facts, order, mutations);
        pages.push(page);
        return page;
      },
      async privateInputProvider(browser, identityGeneration) {
        order.push(`input:${identityGeneration}`);
        assert.equal(browser, 'chromium');
        inputRequests += 1;
        return {
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser,
          firebase_custom_token: identityGeneration === 1
            ? token('a', 'b', 'c') : token('u', 'v', 'w'),
        };
      },
      async controlPhase(phase) {
        order.push(`control:${phase}`);
        if (phase === 'same_relay_reauthenticated' || phase === 'relay_handoff_stale') {
          now += 240_000;
        }
        if (mutations.controlPhase === phase) throw new Error('raw control failure');
        if (mutations.extraControl === phase) return { ...controls[phase], extra: true };
        return controls[phase];
      },
    },
  };
}

test('drives all 18 Chromium phases through two pages into the actual closed receipt', async () => {
  const fixture = scenarioFixture();
  const result = await runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
    signal: undefined,
    timing: fixture.timing,
  });
  assert.equal(result.schema, CHROMIUM_SCENARIO_RESULT_SCHEMA);
  assert.equal(result.state, 'receipt_closed');
  assert.equal(result.private_inputs_requested, 2);
  assert.equal(result.page_instances, 2);
  assert.equal(result.native_bfcache_restores, 1);
  assert.equal(Object.keys(result.receipt.assertions).length, 14);
  assert.ok(Object.values(result.receipt.assertions).every(Boolean));
  assert.deepEqual(result.receipt.stable_outcome_classes, [
    'accepted', 'applied', 'failed', 'outcome_unknown', 'stale',
  ]);
  assert.equal(fixture.inputRequests(), 2);
  assert.deepEqual(
    fixture.order.filter((entry) => entry.startsWith('control:')),
    CONTROL_PHASE_ORDER.map((phase) => `control:${phase}`),
  );
  assert.equal(fixture.pages[0].closeCalls(), 1);
  assert.equal(fixture.pages[0].cdp.detachCalls(), 1);
  assert.equal(fixture.pages[1].closeCalls(), 1);
  assert.ok(
    fixture.order.indexOf('page:1:close') < fixture.order.indexOf('open:2'),
    'the first identity must be terminal and closed before replacement',
  );
  assert.deepEqual(fixture.pages[0].cdpEvents, [
    'Page.enable',
    'Page.getFrameTree',
    'Page.getNavigationHistory',
    'Page.getNavigationHistory',
    'Page.navigateToHistoryEntry',
    'Runtime.evaluate',
    'Page.getNavigationHistory',
    'Runtime.evaluate',
    'Runtime.evaluate',
  ]);
  assert.deepEqual(fixture.pages[0].pageActions, [
    { action: 'initialize', argument: {
      schema: 'miakapp.staging-browser-relay-page-input/1',
      browser: 'chromium',
      firebase_custom_token: token('a', 'b', 'c'),
    } },
    { action: 'start', argument: null },
    { action: 'observeState', argument: fixture.controls.authoritative_state.state_expectation },
    { action: 'observeState', argument: fixture.controls.patched_state.state_expectation },
    { action: 'callApplied', argument: 21 },
    { action: 'observe', argument: null },
    { action: 'observeState', argument: fixture.controls.patched_state.state_expectation },
    { action: 'observe', argument: null },
    { action: 'observeState', argument: fixture.controls.relay_b_state.state_expectation },
    { action: 'callApplied', argument: 22 },
    { action: 'callFailed', argument: 23 },
    { action: 'callUncertain', argument: 24 },
    { action: 'observeState', argument: fixture.controls.relay_b_state.state_expectation },
    { action: 'observeState', argument: fixture.controls.relay_b_recovered.state_expectation },
  ]);
  assert.deepEqual(fixture.pages[1].pageActions, [
    { action: 'initialize', argument: {
      schema: 'miakapp.staging-browser-relay-page-input/1',
      browser: 'chromium',
      firebase_custom_token: token('u', 'v', 'w'),
    } },
    { action: 'start', argument: null },
    { action: 'stop', argument: null },
  ]);
  assert.deepEqual(
    fixture.pages[0].cdpRequests.map(({ selectedOperation, selectedArgument }) => ({
      selectedOperation,
      selectedArgument,
    })),
    [
      { selectedOperation: 'witness', selectedArgument: null },
      {
        selectedOperation: 'observeState',
        selectedArgument: fixture.controls.relay_b_recovered.state_expectation,
      },
      { selectedOperation: 'stop', selectedArgument: null },
    ],
  );
});

test('projects all 18 reviewed page facts through the explicit testing port', async () => {
  const fixture = scenarioFixture();
  const projections = [];
  const signals = [];
  const port = pageProjectionPort((projection, signal) => {
    projections.push(projection);
    signals.push(signal);
    return true;
  });
  assert.throws(() => JSON.stringify(port), /cannot be serialized/u);
  const result = await runBrowserRelayChromiumScenarioWithPageProjectionPortForTesting(
    fixture.dependencies,
    port,
    { ...fixture.timing, signal: undefined },
  );
  assert.equal(result.state, 'receipt_closed');
  assert.deepEqual(projections, chromiumPageFacts().map(projectPageFact));
  assert.equal(signals.length, 18);
  assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  assert.equal(new Set(signals).size, 1);
  assert.equal(signals[0].aborted, true);
});

test('backpressures browser work until each page projection is accepted', async () => {
  const fixture = scenarioFixture();
  const gate = deferred();
  const projections = [];
  const execution = runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
    pageProjectionPort: pageProjectionPort((projection) => {
      projections.push(projection);
      return projections.length === 12 ? gate.promise : true;
    }),
    signal: undefined,
    timing: fixture.timing,
  });
  await waitFor(() => projections.length === 12);
  assert.deepEqual(fixture.pages[0].cdpEvents, []);
  assert.equal(fixture.pages.length, 1);
  gate.resolve(true);
  const result = await execution;
  assert.equal(result.state, 'receipt_closed');
  assert.equal(projections.length, 18);
});

test('fails closed on an invalid or rejecting page-projection port', async () => {
  {
    const fixture = scenarioFixture();
    await assert.rejects(
      runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
        pageProjectionPort: { record() { return true; } },
        signal: undefined,
        timing: fixture.timing,
      }),
      /page-projection port is invalid/u,
    );
    assert.deepEqual(fixture.order, []);
  }
  for (const response of [
    () => false,
    () => Promise.reject(new Error('raw projection failure')),
  ]) {
    const fixture = scenarioFixture();
    await assert.rejects(
      runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
        pageProjectionPort: pageProjectionPort(response),
        signal: undefined,
        timing: fixture.timing,
      }),
      /failed before a closed receipt/u,
    );
    assert.equal(fixture.pages[0].isClosed(), true);
  }

  {
    const fixture = scenarioFixture();
    const options = {
      pageProjectionPort: pageProjectionPort(() => true),
      signal: undefined,
      timing: fixture.timing,
    };
    Object.defineProperty(options, Symbol('unreviewed'), {
      enumerable: true,
      value: true,
    });
    await assert.rejects(
      runBrowserRelayChromiumScenarioInternal(fixture.dependencies, options),
      /options must contain the reviewed fields/u,
    );
    assert.deepEqual(fixture.order, []);
  }
});

test('rejects unreviewed controller evidence before it can become a page fact', async () => {
  const fixture = scenarioFixture({ extraControl: 'authoritative_state' });
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(fixture.pages[0].closeCalls(), 1);
  assert.equal(fixture.inputRequests(), 1);
});

test('requires both positive native BFCache witnesses and closes on browser rejection', async () => {
  for (const mutation of [
    { normalRestore: true },
    { duplicateRestore: true },
    { bfcacheNotUsed: true },
    { lateBfcacheNotUsed: true },
    { lateDuplicateRestore: true },
    { missingWitness: true },
  ]) {
    const fixture = scenarioFixture(mutation);
    await assert.rejects(
      runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
        signal: undefined,
        timing: fixture.timing,
      }),
      StagingBrowserRelayChromiumScenarioError,
    );
    assert.equal(fixture.pages[0].closeCalls(), 1);
    assert.equal(fixture.inputRequests(), 1);
  }
});

test('aborts a pending page action and owns cleanup without exposing partial results', async () => {
  const fixture = scenarioFixture({ pendingAction: 'start' });
  const controller = new AbortController();
  const execution = runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
    signal: controller.signal,
    timing: fixture.timing,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(execution, /failed before a closed receipt/u);
  assert.equal(fixture.pages[0].closeCalls(), 1);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('retries transient cleanup while an aborted page action is still pending', async () => {
  const fixture = scenarioFixture({ pendingAction: 'start', closeFailures: 1 });
  const controller = new AbortController();
  const execution = runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
    signal: controller.signal,
    timing: fixture.timing,
  });
  await waitFor(() => fixture.order.includes('page:1:start'));
  controller.abort();
  await assert.rejects(execution, /failed before a closed receipt/u);
  assert.equal(fixture.pages[0].closeCalls(), 2);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('rejects a pre-aborted run before invoking any injected dependency', async () => {
  const fixture = scenarioFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
      signal: controller.signal,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  assert.deepEqual(fixture.order, []);
  assert.equal(fixture.inputRequests(), 0);
});

test('awaits and retries a cooperative late page cleanup before returning cancellation', async () => {
  const fixture = scenarioFixture();
  const pageGate = deferred();
  const delayedPage = createPage(1, chromiumPageFacts(), fixture.order, { closeFailures: 1 });
  let openCalls = 0;
  let settled = false;
  const controller = new AbortController();
  const execution = runBrowserRelayChromiumScenarioInternal({
    ...fixture.dependencies,
    async openPage() {
      openCalls += 1;
      return pageGate.promise;
    },
  }, { signal: controller.signal, timing: fixture.timing });
  execution.then(() => { settled = true; }, () => { settled = true; });
  await waitFor(() => openCalls === 1);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  pageGate.resolve(delayedPage);
  await assert.rejects(execution, /failed before a closed receipt/u);
  assert.equal(delayedPage.closeCalls(), 2);
  assert.equal(delayedPage.isClosed(), true);
  assert.equal(fixture.inputRequests(), 0);
});

test('fails cleanup convergence when a late page remains open after every retry', async () => {
  const fixture = scenarioFixture();
  const pageGate = deferred();
  const delayedPage = createPage(1, chromiumPageFacts(), fixture.order, { closeFailure: true });
  const controller = new AbortController();
  let openCalls = 0;
  const execution = runBrowserRelayChromiumScenarioInternal({
    ...fixture.dependencies,
    async openPage() {
      openCalls += 1;
      return pageGate.promise;
    },
  }, { signal: controller.signal, timing: fixture.timing });
  await waitFor(() => openCalls === 1);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  pageGate.resolve(delayedPage);
  await assert.rejects(execution, /cleanup did not converge/u);
  assert.equal(delayedPage.closeCalls(), 4);
  assert.equal(delayedPage.isClosed(), false);
});

test('awaits and retries a cooperative late CDP cleanup before returning cancellation', async () => {
  const cdpGate = deferred();
  const fixture = scenarioFixture({
    cdpSessionGate: cdpGate.promise,
    detachFailures: 1,
  });
  const controller = new AbortController();
  let settled = false;
  const execution = runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
    signal: controller.signal,
    timing: fixture.timing,
  });
  execution.then(() => { settled = true; }, () => { settled = true; });
  await waitFor(() => fixture.order.includes('page:1:newCDPSession'));
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  cdpGate.resolve(fixture.pages[0].cdp);
  await assert.rejects(execution, /failed before a closed receipt/u);
  assert.equal(fixture.pages[0].cdp.detachCalls(), 2);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('fails cleanup convergence when a late CDP session remains attached after every retry', async () => {
  const cdpGate = deferred();
  const fixture = scenarioFixture({
    cdpSessionGate: cdpGate.promise,
    detachFailure: true,
  });
  const controller = new AbortController();
  const execution = runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
    signal: controller.signal,
    timing: fixture.timing,
  });
  await waitFor(() => fixture.order.includes('page:1:newCDPSession'));
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  cdpGate.resolve(fixture.pages[0].cdp);
  await assert.rejects(execution, /cleanup did not converge/u);
  assert.equal(fixture.pages[0].cdp.detachCalls(), 4);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('awaits an invoked private-input dependency before returning cancellation', async () => {
  const fixture = scenarioFixture();
  const inputGate = deferred();
  let inputStarted = false;
  let settled = false;
  const controller = new AbortController();
  const execution = runBrowserRelayChromiumScenarioInternal({
    ...fixture.dependencies,
    async privateInputProvider() {
      inputStarted = true;
      return inputGate.promise;
    },
  }, { signal: controller.signal, timing: fixture.timing });
  execution.then(() => { settled = true; }, () => { settled = true; });
  await waitFor(() => inputStarted);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  inputGate.resolve({
    schema: 'miakapp.staging-browser-relay-page-input/1',
    browser: 'chromium',
    firebase_custom_token: token('a', 'b', 'c'),
  });
  await assert.rejects(execution, /failed before a closed receipt/u);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('awaits an invoked control dependency before returning cancellation', async () => {
  const fixture = scenarioFixture();
  const controlGate = deferred();
  let controlStarted = false;
  let settled = false;
  const controller = new AbortController();
  const execution = runBrowserRelayChromiumScenarioInternal({
    ...fixture.dependencies,
    async controlPhase(phase) {
      assert.equal(phase, 'authoritative_state');
      controlStarted = true;
      return controlGate.promise;
    },
  }, { signal: controller.signal, timing: fixture.timing });
  execution.then(() => { settled = true; }, () => { settled = true; });
  await waitFor(() => controlStarted);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  controlGate.resolve(fixture.controls.authoritative_state);
  await assert.rejects(execution, /failed before a closed receipt/u);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('protected external cancellation cannot be suppressed by an earlier listener', async () => {
  const fixture = scenarioFixture({ pendingAction: 'start' });
  const controller = new AbortController();
  controller.signal.addEventListener('abort', (event) => event.stopImmediatePropagation());
  const execution = runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
    signal: controller.signal,
    timing: fixture.timing,
  });
  await waitFor(() => fixture.order.includes('page:1:start'));
  controller.abort();
  await assert.rejects(execution, /failed before a closed receipt/u);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('deadline cancellation closes the active page and drains its operation', async () => {
  const fixture = scenarioFixture({ pendingAction: 'start' });
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
      signal: undefined,
      timing: { ...fixture.timing, maximumMilliseconds: 1 },
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('bounds never-settling injected and CDP dependencies after deadline cancellation', async () => {
  const cases = [
    {
      name: 'openPage',
      dependencies(fixture) {
        return { ...fixture.dependencies, async openPage() { return new Promise(() => {}); } };
      },
    },
    {
      name: 'privateInputProvider',
      dependencies(fixture) {
        return {
          ...fixture.dependencies,
          async privateInputProvider() { return new Promise(() => {}); },
        };
      },
    },
    {
      name: 'controlPhase',
      dependencies(fixture) {
        return { ...fixture.dependencies, async controlPhase() { return new Promise(() => {}); } };
      },
    },
    {
      name: 'newCDPSession',
      fixture: () => scenarioFixture({ pendingCdpSession: true }),
      dependencies: (fixture) => fixture.dependencies,
    },
  ];
  for (const entry of cases) {
    const fixture = entry.fixture?.() ?? scenarioFixture();
    const timing = {
      ...fixture.timing,
      maximumMilliseconds: 1,
      setTimer: (callback, milliseconds) => setTimeout(callback, Math.min(milliseconds, 5)),
    };
    let guard;
    try {
      await assert.rejects(
        Promise.race([
          runBrowserRelayChromiumScenarioInternal(entry.dependencies(fixture), {
            signal: undefined,
            timing,
          }),
          new Promise((_, rejectTimeout) => {
            guard = setTimeout(
              () => rejectTimeout(new Error(`unbounded ${entry.name} dependency`)),
              250,
            );
          }),
        ]),
        /failed before a closed receipt|cleanup did not converge/u,
      );
    } finally {
      clearTimeout(guard);
    }
    assert.ok(fixture.pages.every((page) => page.isClosed()), entry.name);
  }
});

test('rejects Playwright diagnostics before page or private-input acquisition', async () => {
  const previousDebug = process.env.DEBUG;
  const previousPwDebug = process.env.PWDEBUG;
  const previousDebugFile = process.env.DEBUG_FILE;
  try {
    for (const [name, value] of [
      ['DEBUG', 'pw:protocol'],
      ['DEBUG', '*'],
      ['PWDEBUG', '0'],
      ['DEBUG_FILE', '/tmp/playwright.log'],
    ]) {
      delete process.env.DEBUG;
      delete process.env.PWDEBUG;
      delete process.env.DEBUG_FILE;
      process.env[name] = value;
      const fixture = scenarioFixture();
      await assert.rejects(
        runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
          signal: undefined,
          timing: fixture.timing,
        }),
        /diagnostic environment/u,
      );
      assert.deepEqual(fixture.order, []);
      assert.equal(fixture.inputRequests(), 0);
    }
  } finally {
    if (previousDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = previousDebug;
    if (previousPwDebug === undefined) delete process.env.PWDEBUG;
    else process.env.PWDEBUG = previousPwDebug;
    if (previousDebugFile === undefined) delete process.env.DEBUG_FILE;
    else process.env.DEBUG_FILE = previousDebugFile;
  }
});

test('rejects Playwright diagnostics latched before the scenario module loads', () => {
  const internalUrl = new URL(
    '../browser-relay-chromium-scenario/internal.mjs',
    import.meta.url,
  ).href;
  for (const [name, value] of [
    ['DEBUG', 'pw:protocol'],
    ['PWDEBUG', '1'],
    ['DEBUG_FILE', '/dev/null'],
  ]) {
    const source = `
      process.env[${JSON.stringify(name)}] = ${JSON.stringify(value)};
      await import('playwright');
      delete process.env[${JSON.stringify(name)}];
      const { runBrowserRelayChromiumScenarioInternal } = await import(
        ${JSON.stringify(internalUrl)}
      );
      let calls = 0;
      const dependency = () => { calls += 1; };
      let diagnosticRejected = false;
      try {
        await runBrowserRelayChromiumScenarioInternal({
          controlPhase: dependency,
          openPage: dependency,
          privateInputProvider: dependency,
        }, {
          signal: undefined,
          timing: {
            clearTimer: clearTimeout,
            clock: () => 0,
            maximumMilliseconds: 1,
            setTimer: setTimeout,
          },
        });
      } catch (error) {
        diagnosticRejected = error instanceof Error
          && error.message.includes('diagnostic environment');
      }
      if (!diagnosticRejected || calls !== 0) {
        throw new Error('latched diagnostic state was not rejected before dependencies');
      }
    `;
    const childEnvironment = { ...process.env };
    delete childEnvironment.DEBUG;
    delete childEnvironment.PWDEBUG;
    delete childEnvironment.DEBUG_FILE;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', source],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: childEnvironment,
        timeout: 10_000,
      },
    );
    assert.equal(
      result.status,
      0,
      `${name}: ${result.stderr || result.stdout || result.error?.message}`,
    );
  }
});

test('rejects active Playwright trace, HAR, video and logger capture before private input', async () => {
  for (const [name, mutation] of [
    ['context trace', { tracingActive: true }],
    ['connection trace', { connectionTracingCount: 1 }],
    ['pending trace transition', { pendingCaptureTransition: true }],
    ['pending context CDP transition', {
      pendingCallback: { type: 'BrowserContext', method: 'newCDPSession' },
    }],
    ['pending browser CDP transition', {
      pendingCallback: { type: 'Browser', method: 'newBrowserCDPSession' },
    }],
    ['pending navigation transition', {
      pendingCallback: { type: 'Frame', method: 'goto' },
    }],
    ['pending network subscription', {
      pendingCallback: { type: 'Page', method: 'updateSubscription' },
    }],
    ['HAR recorder', { harRecording: true }],
    ['HAR identifier', { activeHarId: true }],
    ['video recorder', { recordVideo: true }],
    ['API logger', { loggerActive: true }],
  ]) {
    const fixture = scenarioFixture(mutation);
    await assert.rejects(
      runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
        signal: undefined,
        timing: fixture.timing,
      }),
      /failed before a closed receipt/u,
      name,
    );
    assert.equal(fixture.inputRequests(), 0, name);
    assert.equal(fixture.pages[0].isClosed(), true, name);
  }
});

test('blocks and latches a capture transition attempted while private input is live', async () => {
  const fixture = scenarioFixture();
  let captureAttempt;
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      ...fixture.dependencies,
      async privateInputProvider() {
        captureAttempt = Promise.resolve().then(() => (
          fixture.pages[0].captureContext._connection.sendMessageToServer(
            fixture.pages[0].captureContext.tracing,
            'tracingStartChunk',
            {},
            {},
          )
        ));
        captureAttempt.catch(() => undefined);
        return {
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser: 'chromium',
          firebase_custom_token: token('a', 'b', 'c'),
        };
      },
    }, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  await assert.rejects(captureAttempt, /capture transition was blocked/u);
  assert.equal(fixture.pages[0].pageActions.length, 0);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('rechecks Playwright capture state after private input acquisition', async () => {
  const fixture = scenarioFixture();
  let inputRequests = 0;
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      ...fixture.dependencies,
      async privateInputProvider() {
        inputRequests += 1;
        fixture.pages[0].captureContext.tracing._isTracing = true;
        fixture.pages[0].captureContext._connection._tracingCount = 1;
        return {
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser: 'chromium',
          firebase_custom_token: token('a', 'b', 'c'),
        };
      },
    }, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(inputRequests, 1);
  assert.equal(fixture.pages[0].pageActions.length, 0);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('shields private arguments from caller instrumentation and page wrappers', async () => {
  const instrumentedParameters = [];
  const wrappedParameters = [];
  const fixture = scenarioFixture({
    instrumentationObserver(parameters) { instrumentedParameters.push(parameters); },
    pageEvaluateObserver(parameters) { wrappedParameters.push(parameters); },
  });
  const result = await runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
    signal: undefined,
    timing: fixture.timing,
  });
  assert.equal(result.state, 'receipt_closed');
  assert.deepEqual(instrumentedParameters, [
    { harmless_probe: true },
    { harmless_probe: true },
  ]);
  assert.equal(wrappedParameters.length, 0);
  for (const parameters of [...instrumentedParameters, ...wrappedParameters]) {
    const serialized = JSON.stringify(parameters);
    assert.equal(serialized.includes(token('a', 'b', 'c')), false);
    assert.equal(serialized.includes(token('u', 'v', 'w')), false);
  }
});

test('keeps synthetic page doubles outside the production Playwright boundary', async () => {
  const fixture = scenarioFixture();
  await assert.rejects(
    runTrustedBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(fixture.inputRequests(), 0);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('fails closed when the main-frame instrumentation lease drifts', async () => {
  const fixture = scenarioFixture();
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      ...fixture.dependencies,
      async privateInputProvider() {
        Object.defineProperty(fixture.pages[0]._mainFrame, '_instrumentation', {
          configurable: true,
          enumerable: true,
          value: { onApiCallBegin() {}, onApiCallEnd() {} },
          writable: true,
        });
        return {
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser: 'chromium',
          firebase_custom_token: token('a', 'b', 'c'),
        };
      },
    }, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt|cleanup did not converge/u,
  );
  assert.equal(fixture.pages[0].pageActions.length, 0);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('validates closed control and public result shapes', () => {
  assert.throws(
    () => validateChromiumScenarioControlResult('initial_call', {
      schema: 'miakapp.staging-browser-relay-chromium-call-control/1',
      call_target: 20,
      token: token('x', 'y', 'z'),
    }),
    /forbidden|private material|reviewed fields/u,
  );
  assert.throws(
    () => validateChromiumScenarioResult({ schema: CHROMIUM_SCENARIO_RESULT_SCHEMA }),
    StagingBrowserRelayChromiumScenarioError,
  );
});

test('pins the dormant profile and keeps production timing separate from testing', () => {
  const profile = validateBrowserRelayChromiumScenarioProfile();
  assert.equal(profile.revision, 2);
  assert.equal(profile.scenario.page_fact_order.length, 18);
  assert.equal(profile.scenario.control_phase_order.length, 11);
  assert.equal(
    profile.scenario.page_lifecycle_event_schema,
    'miakapp.staging-browser-relay-page-lifecycle-event/2',
  );
  assert.equal(profile.bfcache.dual_positive_witness_required, true);
  assert.equal(profile.lifecycle.injected_dependency_abort_race, true);
  assert.equal(profile.lifecycle.injected_dependency_drain_bounded, true);
  assert.equal(profile.lifecycle.latched_playwright_diagnostics_rejected, true);
  assert.equal(profile.lifecycle.playwright_capture_rechecked_around_private_input, true);
  assert.equal(profile.lifecycle.playwright_capture_protocol_lease_required, true);
  assert.equal(profile.lifecycle.playwright_pending_capture_transition_rejected, true);
  assert.equal(profile.lifecycle.playwright_instrumentation_lease_required, true);
  assert.equal(profile.lifecycle.playwright_page_factory_provenance_required, true);
  assert.equal(profile.lifecycle.playwright_network_observer_lease_required, true);
  assert.equal(profile.lifecycle.playwright_unowned_cdp_rejected, true);
  assert.equal(profile.lifecycle.playwright_cdp_factory_provenance_required, true);
  assert.equal(profile.lifecycle.playwright_cdp_channel_identity_lease_required, true);
  assert.equal(profile.lifecycle.playwright_core_debug_logger_lease_required, true);
  assert.equal(profile.lifecycle.playwright_frame_prototype_pinned, true);
  assert.equal(profile.lifecycle.playwright_channel_identity_lease_required, true);
  assert.equal(profile.lifecycle.playwright_channel_owner_helpers_pinned, true);
  assert.equal(profile.lifecycle.playwright_transport_callback_pinned, true);
  assert.equal(profile.lifecycle.caller_owned_page_evaluate_bypassed, true);
  assert.equal(profile.lifecycle.caller_owned_page_close_bypassed, true);
  assert.equal(profile.lifecycle.playwright_native_page_close_verified, true);
  assert.equal(profile.lifecycle.playwright_trace_har_video_logger_rejected, true);
  assert.equal(profile.lifecycle.late_browser_resource_cleanup_attached, true);
  assert.equal(profile.lifecycle.late_browser_resource_cleanup_retried, true);
  assert.equal(profile.lifecycle.trusted_runtime_mutex_required, true);
  assert.equal(profile.lifecycle.trusted_runtime_cleanup_poison_latched, true);
  assert.equal(profile.lifecycle.page_projection_backpressure_required, true);
  assert.equal(profile.lifecycle.page_projection_abort_race, true);
  assert.equal(profile.lifecycle.page_projection_failure_closed, true);
  assert.equal(profile.trust_boundary.same_realm_hostile_code_supported, false);
  assert.equal(profile.trust_boundary.playwright_connection_exclusive_during_run, true);
  assert.equal(
    profile.trust_boundary.isolated_process_required_before_untrusted_live_wiring,
    true,
  );
  assert.equal(
    profile.output.confidentiality_scope,
    'scenario_output_projection_port_and_diagnostics_only',
  );
  assert.equal(profile.output.reviewed_page_projections_exposed_to_explicit_port, true);
  assert.equal(profile.compatibility.complete_chromium_page_scenario, true);
  assert.equal(profile.compatibility.case_scheduler_projection_port_compatible, true);
  assert.equal(profile.compatibility.case_scheduler_wired, false);
  assert.equal(profile.compatibility.live_operation_wired, false);
  assert.ok(Object.values(profile.authority).every((value) => value === false));
  const productionSource = readFileSync(new URL(
    '../browser-relay-chromium-scenario/scenario.mjs', import.meta.url,
  ), 'utf8');
  assert.match(productionSource, /process\.hrtime\.bigint\(\)/u);
  assert.doesNotMatch(productionSource, /\.\/testing\.mjs|ForTesting/u);
  assert.throws(
    () => runBrowserRelayChromiumScenario({}, { clock: Date.now }),
    /options exceed the reviewed boundary/u,
  );
  assert.throws(
    () => runBrowserRelayChromiumScenarioForTesting({}, {
      clock: Date.now,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    }),
    /exact testing boundary/u,
  );
});

test('closes an invalid acquired page before requesting private input', async () => {
  const fixture = scenarioFixture({ url: 'about:blank' });
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(fixture.pages[0].closeCalls(), 1);
  assert.equal(fixture.inputRequests(), 0);
});

test('requires two distinct owned page instances', async () => {
  const fixture = scenarioFixture({ reuseFirstPage: true });
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(fixture.pages.length, 1);
  assert.equal(fixture.pages[0].closeCalls(), 1);
  assert.equal(fixture.pages[0].isClosed(), true);
  assert.equal(fixture.inputRequests(), 1);
});

test('retries a transient terminal page-close failure during final cleanup', async () => {
  const fixture = scenarioFixture({ closeFailures: 1 });
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(fixture.pages[0].closeCalls(), 2);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('removes a partially installed CDP listener after installation failure', async () => {
  const fixture = scenarioFixture({ listenerFailure: 'Page.backForwardCacheNotUsed' });
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
      signal: undefined,
      timing: fixture.timing,
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(fixture.pages[0].cdp.listenerCount('Page.frameNavigated'), 0);
  assert.equal(fixture.pages[0].isClosed(), true);
});

test('fails closed when terminal page cleanup or the phase controller fails', async () => {
  for (const mutation of [
    { closeFailure: true },
    { controlPhase: 'relay_b_ready' },
    { witnessInstallFailure: true },
    { detachFailure: true },
  ]) {
    const fixture = scenarioFixture(mutation);
    await assert.rejects(
      runBrowserRelayChromiumScenarioInternal(fixture.dependencies, {
        signal: undefined,
        timing: fixture.timing,
      }),
      StagingBrowserRelayChromiumScenarioError,
    );
    assert.equal(
      fixture.pages[0].closeCalls(),
      mutation.closeFailure ? 5 : 1,
    );
  }
});

test('guards the exact source-only package inventory and reviewed imports', () => {
  validateBrowserRelayChromiumScenarioRoot(SCENARIO_ROOT);
  const mutations = [
    (root) => writeFileSync(join(root, 'unreviewed.mjs'), 'export default true;\n'),
    (root) => {
      const path = join(root, 'scenario.mjs');
      writeFileSync(path, readFileSync(path, 'utf8').replace("'node:util'", "'node:path'"));
    },
    (root) => {
      const path = join(root, 'internal.mjs');
      writeFileSync(path, readFileSync(path, 'utf8').replace("'Page.enable'", "'Page.disable'"));
    },
    (root) => {
      const path = join(root, 'testing.mjs');
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n// process.argv\n`);
    },
    (root) => {
      const path = join(root, 'contract.mjs');
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n// projects/miakapp-v4\n`);
    },
    (root) => {
      const path = join(root, 'contract.mjs');
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n// ${token('eyJ', 'r', 's')}\n`);
    },
  ];
  for (const mutate of mutations) {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'miakapp-chromium-scenario-'));
    try {
      for (const name of SCENARIO_FILES) {
        copyFileSync(new URL(name, SCENARIO_ROOT), join(temporaryRoot, name));
      }
      mutate(temporaryRoot);
      assert.throws(
        () => validateBrowserRelayChromiumScenarioRoot(pathToFileURL(`${temporaryRoot}/`)),
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
});
