import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { validateEngineResult } from '../browser-relay-runner/contract.mjs';
import { createBrowserRelayPageReceiptProducer } from '../browser-relay-page-receipt/producer.mjs';
import { TARGET_URL } from '../browser-relay-page/contract.mjs';
import { runBrowserRelayPlaywrightBridge } from '../browser-relay-playwright-bridge/bridge.mjs';
import {
  PLAYWRIGHT_BRIDGE_PROFILE_SHA256,
  StagingBrowserRelayPlaywrightBridgeError,
  validateBrowserRelayPlaywrightBridgeProfile,
  validatePlaywrightBridgeResult,
} from '../browser-relay-playwright-bridge/contract.mjs';
import { validateBrowserRelayPlaywrightBridgeRoot } from '../browser-relay-playwright-bridge/guard.mjs';

const READY_STATUSES = ['connecting', 'authenticating', 'synchronizing', 'ready'];
const BRIDGE_ROOT = new URL('../browser-relay-playwright-bridge/', import.meta.url);
const BRIDGE_FILES = Object.freeze([
  'README.md',
  'bridge.mjs',
  'contract.mjs',
  'guard.mjs',
  'profile.json',
]);

function token(a, b, c) {
  return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
}

function observation(browser, overrides = {}) {
  return {
    schema: 'miakapp.staging-browser-relay-page-observation/1',
    browser,
    state: 'initialized',
    client_instances: 1,
    firebase_auth_sessions: 1,
    app_check_instances: 1,
    firebase_token_requests: 0,
    app_check_token_requests: 0,
    control_plane_exchanges: 0,
    exchange_cache_conformant: true,
    websocket_connections: 0,
    active_websockets: 0,
    maximum_active_websockets: 0,
    source_credentials_on_websocket: 0,
    browser_credential_persistence_events: 0,
    relay_ids: [],
    client_statuses: [],
    failure_classes: [],
    duration_milliseconds: 0,
    ...overrides,
  };
}

function lifecycle(browser, overrides = {}) {
  return {
    schema: 'miakapp.staging-browser-relay-page-lifecycle-observation/1',
    browser,
    events: [],
    suspensions: 0,
    resumptions: 0,
    sign_outs: 0,
    disposals: 0,
    state_transitions: [],
    call_outcomes: [],
    ...overrides,
  };
}

function pageActionResults(browser) {
  const ready = observation(browser, {
    state: 'ready',
    firebase_token_requests: 1,
    app_check_token_requests: 1,
    control_plane_exchanges: 1,
    websocket_connections: 1,
    active_websockets: 1,
    maximum_active_websockets: 1,
    relay_ids: ['relay-b'],
    client_statuses: READY_STATUSES,
    duration_milliseconds: 10,
  });
  const readyLifecycle = lifecycle(browser, {
    state_transitions: [{ revision: 1, stale: false }],
  });
  return {
    initialize: {
      state: 'completed',
      observation: observation(browser),
      lifecycle_observation: lifecycle(browser),
    },
    start: {
      state: 'completed',
      observation: ready,
      lifecycle_observation: readyLifecycle,
    },
    stop: {
      state: 'completed',
      observation: {
        ...ready,
        state: 'stopped',
        active_websockets: 0,
        client_statuses: [...READY_STATUSES, 'stopping'],
        duration_milliseconds: 20,
      },
      lifecycle_observation: lifecycle(browser, {
        ...readyLifecycle,
        sign_outs: 1,
        disposals: 1,
      }),
    },
  };
}

function mockPage(browser, overrides = {}) {
  const actions = [];
  const results = pageActionResults(browser);
  let closeCalls = 0;
  return {
    actions,
    closeCalls: () => closeCalls,
    url: () => overrides.url ?? TARGET_URL,
    async evaluate(_callback, argument) {
      actions.push(argument.selectedAction);
      if (overrides.pendingAction === argument.selectedAction) return new Promise(() => {});
      return overrides.results?.[argument.selectedAction]
        ?? results[argument.selectedAction];
    },
    async close() {
      closeCalls += 1;
      if (overrides.closeFailure) throw new Error('Raw close failure');
    },
  };
}

function dependencies(browser, page, counts = {}) {
  counts.page = 0;
  counts.input = 0;
  counts.producer = 0;
  return {
    async openPage(requestedBrowser) {
      assert.equal(requestedBrowser, browser);
      counts.page += 1;
      return page;
    },
    async privateInputProvider(requestedBrowser, identityGeneration) {
      assert.equal(requestedBrowser, browser);
      assert.equal(identityGeneration, 1);
      counts.input += 1;
      return {
        schema: 'miakapp.staging-browser-relay-page-input/1',
        browser,
        firebase_custom_token: token('u', 'v', 'w'),
      };
    },
    receiptProducerFactory(requestedBrowser) {
      assert.equal(requestedBrowser, browser);
      counts.producer += 1;
      return createBrowserRelayPageReceiptProducer(browser);
    },
  };
}

test('blocks pinned Chromium before page, producer or private input acquisition', async () => {
  const calls = { page: 0, input: 0, producer: 0 };
  const blocked = await runBrowserRelayPlaywrightBridge('chromium', {
    async openPage() { calls.page += 1; },
    async privateInputProvider() { calls.input += 1; },
    receiptProducerFactory() { calls.producer += 1; },
  }, { environment: {} });
  assert.deepEqual(calls, { page: 0, input: 0, producer: 0 });
  assert.deepEqual(blocked, {
    schema: 'miakapp.staging-browser-relay-playwright-bridge-result/1',
    browser: 'chromium',
    state: 'blocked',
    reason: 'pinned_playwright_bfcache_unsupported',
    private_inputs_requested: 0,
    receipt: null,
  });
  assert.throws(() => validateEngineResult(blocked, 'chromium'));
});

test('drives phased Firefox and WebKit pages into actual closed receipt producers', async () => {
  for (const browser of ['firefox', 'webkit']) {
    const page = mockPage(browser);
    const counts = {};
    const result = await runBrowserRelayPlaywrightBridge(
      browser,
      dependencies(browser, page, counts),
      { environment: {}, clock: (() => {
        let now = 1_000;
        return () => { now += 10; return now; };
      })() },
    );
    assert.equal(result.state, 'receipt_closed');
    assert.equal(result.receipt.browser, browser);
    assert.equal(result.receipt.source, 'browser_page');
    assert.equal(result.receipt.counters.maximum_active_websockets, 1);
    assert.deepEqual(page.actions, ['initialize', 'start', 'stop']);
    assert.equal(page.closeCalls(), 1);
    assert.deepEqual(counts, { page: 1, input: 1, producer: 1 });
  }
});

test('fails closed, aborts collection and owns page cleanup on malformed page output', async () => {
  const page = mockPage('firefox', { results: { start: { state: 'failed' } } });
  const counts = {};
  await assert.rejects(
    runBrowserRelayPlaywrightBridge(
      'firefox',
      dependencies('firefox', page, counts),
      { environment: {} },
    ),
    /failed before a closed receipt/u,
  );
  assert.equal(page.closeCalls(), 1);
  assert.equal(counts.input, 1);
});

test('closes an invalid page before acquiring a producer or private input', async () => {
  const page = mockPage('firefox', { url: 'about:blank' });
  const counts = {};
  await assert.rejects(
    runBrowserRelayPlaywrightBridge(
      'firefox',
      dependencies('firefox', page, counts),
      { environment: {} },
    ),
    /failed before a closed receipt/u,
  );
  assert.equal(page.closeCalls(), 1);
  assert.deepEqual(counts, { page: 1, input: 0, producer: 0 });
});

test('refuses navigation away from the target after private input acquisition', async () => {
  let currentUrl = TARGET_URL;
  const page = mockPage('webkit');
  page.url = () => currentUrl;
  const counts = {};
  const bridgeDependencies = dependencies('webkit', page, counts);
  const providePrivateInput = bridgeDependencies.privateInputProvider;
  bridgeDependencies.privateInputProvider = async (...args) => {
    const input = await providePrivateInput(...args);
    currentUrl = 'about:blank';
    return input;
  };
  await assert.rejects(
    runBrowserRelayPlaywrightBridge(
      'webkit',
      bridgeDependencies,
      { environment: {} },
    ),
    /failed before a closed receipt/u,
  );
  assert.deepEqual(page.actions, []);
  assert.equal(page.closeCalls(), 1);
  assert.deepEqual(counts, { page: 1, input: 1, producer: 1 });
});

test('closes the owned page when a page action reaches the bridge deadline', async () => {
  const page = mockPage('webkit', { pendingAction: 'start' });
  await assert.rejects(
    runBrowserRelayPlaywrightBridge(
      'webkit',
      dependencies('webkit', page),
      { environment: {}, maximumMilliseconds: 1 },
    ),
    /failed before a closed receipt/u,
  );
  assert.equal(page.closeCalls(), 1);
});

test('closes a page that arrives after the deadline without acquiring private input', async () => {
  const page = mockPage('firefox');
  const counts = { page: 0, input: 0, producer: 0 };
  let resolvePage;
  let deadlineCallback;
  const delayedPage = new Promise((resolve) => { resolvePage = resolve; });
  const execution = runBrowserRelayPlaywrightBridge('firefox', {
    async openPage() {
      counts.page += 1;
      return delayedPage;
    },
    async privateInputProvider() {
      counts.input += 1;
      assert.fail('Private input must remain lazy after the deadline');
    },
    receiptProducerFactory() {
      counts.producer += 1;
      assert.fail('Receipt producer must remain lazy after the deadline');
    },
  }, {
    environment: {},
    maximumMilliseconds: 1,
    setTimer(callback) {
      deadlineCallback = callback;
      return 1;
    },
    clearTimer() {},
  });
  while (deadlineCallback === undefined) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  deadlineCallback();
  await assert.rejects(execution, /failed before a closed receipt/u);
  resolvePage(page);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.closeCalls(), 1);
  assert.deepEqual(counts, { page: 1, input: 0, producer: 0 });
});

test('fences a late page when deadline timer setup throws', async () => {
  const page = mockPage('firefox');
  const counts = { page: 0, input: 0, producer: 0 };
  let resolvePage;
  const delayedPage = new Promise((resolve) => { resolvePage = resolve; });
  const execution = runBrowserRelayPlaywrightBridge('firefox', {
    async openPage() {
      counts.page += 1;
      return delayedPage;
    },
    async privateInputProvider() {
      counts.input += 1;
      assert.fail('Private input must remain fenced after timer setup failure');
    },
    receiptProducerFactory() {
      counts.producer += 1;
      assert.fail('Receipt producer must remain fenced after timer setup failure');
    },
  }, {
    environment: {},
    setTimer() { throw new Error('Raw timer setup failure'); },
    clearTimer() {},
  });
  await assert.rejects(
    execution,
    (error) => error instanceof StagingBrowserRelayPlaywrightBridgeError
      && error.message === 'Browser-relay firefox bridge failed before a closed receipt'
      && !error.message.includes('Raw timer setup failure'),
  );
  resolvePage(page);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.closeCalls(), 1);
  assert.deepEqual(counts, { page: 1, input: 0, producer: 0 });
});

test('fences a late page when abort-listener setup throws', async () => {
  const page = mockPage('webkit');
  const counts = { page: 0, input: 0, producer: 0 };
  let resolvePage;
  const delayedPage = new Promise((resolve) => { resolvePage = resolve; });
  const signal = {
    aborted: false,
    addEventListener() { throw new Error('Raw listener setup failure'); },
    removeEventListener() {},
  };
  const execution = runBrowserRelayPlaywrightBridge('webkit', {
    async openPage() {
      counts.page += 1;
      return delayedPage;
    },
    async privateInputProvider() {
      counts.input += 1;
      assert.fail('Private input must remain fenced after listener setup failure');
    },
    receiptProducerFactory() {
      counts.producer += 1;
      assert.fail('Receipt producer must remain fenced after listener setup failure');
    },
  }, {
    environment: {},
    signal,
    setTimer() { return 1; },
    clearTimer() {},
  });
  await assert.rejects(
    execution,
    (error) => error instanceof StagingBrowserRelayPlaywrightBridgeError
      && error.message === 'Browser-relay webkit bridge failed before a closed receipt'
      && !error.message.includes('Raw listener setup failure'),
  );
  resolvePage(page);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.closeCalls(), 1);
  assert.deepEqual(counts, { page: 1, input: 0, producer: 0 });
});

test('enforces elapsed time even when the deadline timer has not fired', async () => {
  const page = mockPage('firefox');
  const instants = [0, 0, 0, 2];
  await assert.rejects(
    runBrowserRelayPlaywrightBridge(
      'firefox',
      dependencies('firefox', page),
      {
        environment: {},
        maximumMilliseconds: 1,
        clock() { return instants.shift() ?? 2; },
        setTimer() { return 1; },
        clearTimer() {},
      },
    ),
    /failed before a closed receipt/u,
  );
  assert.deepEqual(page.actions, []);
  assert.equal(page.closeCalls(), 1);
});

test('does not acquire private input after producer setup exhausts the lifetime', async () => {
  const page = mockPage('firefox');
  const counts = {};
  let now = 0;
  const bridgeDependencies = dependencies('firefox', page, counts);
  const createProducer = bridgeDependencies.receiptProducerFactory;
  bridgeDependencies.receiptProducerFactory = (...args) => {
    const producer = createProducer(...args);
    now = 2;
    return producer;
  };
  await assert.rejects(
    runBrowserRelayPlaywrightBridge('firefox', bridgeDependencies, {
      environment: {},
      maximumMilliseconds: 1,
      clock: () => now,
      setTimer() { return 1; },
      clearTimer() {},
    }),
    /failed before a closed receipt/u,
  );
  assert.deepEqual(page.actions, []);
  assert.equal(page.closeCalls(), 1);
  assert.deepEqual(counts, { page: 1, input: 0, producer: 1 });
});

test('does not start another page action after receipt recording exhausts the lifetime', async () => {
  const page = mockPage('webkit');
  let now = 0;
  const bridgeDependencies = dependencies('webkit', page);
  const createProducer = bridgeDependencies.receiptProducerFactory;
  bridgeDependencies.receiptProducerFactory = (...args) => {
    const producer = createProducer(...args);
    return {
      abort: () => producer.abort(),
      close: () => producer.close(),
      record(value) {
        const recorded = producer.record(value);
        now = 2;
        return recorded;
      },
    };
  };
  await assert.rejects(
    runBrowserRelayPlaywrightBridge('webkit', bridgeDependencies, {
      environment: {},
      maximumMilliseconds: 1,
      clock: () => now,
      setTimer() { return 1; },
      clearTimer() {},
    }),
    /failed before a closed receipt/u,
  );
  assert.deepEqual(page.actions, ['initialize']);
  assert.equal(page.closeCalls(), 1);
});

test('does not return a closed result after receipt closure exhausts the lifetime', async () => {
  const page = mockPage('firefox');
  let now = 0;
  const bridgeDependencies = dependencies('firefox', page);
  const createProducer = bridgeDependencies.receiptProducerFactory;
  bridgeDependencies.receiptProducerFactory = (...args) => {
    const producer = createProducer(...args);
    return {
      abort: () => producer.abort(),
      record: (value) => producer.record(value),
      close() {
        const receipt = producer.close();
        now = 2;
        return receipt;
      },
    };
  };
  await assert.rejects(
    runBrowserRelayPlaywrightBridge('firefox', bridgeDependencies, {
      environment: {},
      maximumMilliseconds: 1,
      clock: () => now,
      setTimer() { return 1; },
      clearTimer() {},
    }),
    /failed before a closed receipt/u,
  );
  assert.deepEqual(page.actions, ['initialize', 'start', 'stop']);
  assert.equal(page.closeCalls(), 1);
});

test('aborts an in-flight page action and closes the owned page', async () => {
  const page = mockPage('webkit', { pendingAction: 'start' });
  const controller = new AbortController();
  const execution = runBrowserRelayPlaywrightBridge(
    'webkit',
    dependencies('webkit', page),
    { environment: {}, signal: controller.signal },
  );
  while (!page.actions.includes('start')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  controller.abort();
  await assert.rejects(execution, /failed before a closed receipt/u);
  assert.equal(page.closeCalls(), 1);
});

test('fails closed without exposing diagnostics when page cleanup does not converge', async () => {
  const page = mockPage('firefox', { closeFailure: true });
  await assert.rejects(
    runBrowserRelayPlaywrightBridge(
      'firefox',
      dependencies('firefox', page),
      { environment: {} },
    ),
    (error) => error instanceof StagingBrowserRelayPlaywrightBridgeError
      && error.message === 'Browser-relay firefox bridge cleanup did not converge'
      && !error.message.includes('Raw close failure'),
  );
  assert.equal(page.closeCalls(), 1);
});

test('keeps cleanup exception-safe when timer cleanup throws', async () => {
  const page = mockPage('firefox');
  await assert.rejects(
    runBrowserRelayPlaywrightBridge(
      'firefox',
      dependencies('firefox', page),
      {
        environment: {},
        setTimer() { return 1; },
        clearTimer() { throw new Error('Raw timer cleanup failure'); },
      },
    ),
    (error) => error instanceof StagingBrowserRelayPlaywrightBridgeError
      && error.message === 'Browser-relay firefox bridge cleanup did not converge'
      && !error.message.includes('Raw timer cleanup failure'),
  );
  assert.equal(page.closeCalls(), 1);
});

test('keeps page cleanup independent when abort-listener removal throws', async () => {
  const page = mockPage('webkit');
  const signal = {
    aborted: false,
    addEventListener() {},
    removeEventListener() { throw new Error('Raw listener cleanup failure'); },
  };
  await assert.rejects(
    runBrowserRelayPlaywrightBridge(
      'webkit',
      dependencies('webkit', page),
      {
        environment: {},
        signal,
        setTimer() { return 1; },
        clearTimer() {},
      },
    ),
    (error) => error instanceof StagingBrowserRelayPlaywrightBridgeError
      && error.message === 'Browser-relay webkit bridge cleanup did not converge'
      && !error.message.includes('Raw listener cleanup failure'),
  );
  assert.equal(page.closeCalls(), 1);
});

test('rejects diagnostics and raw private material at the closed boundary', async () => {
  await assert.rejects(
    runBrowserRelayPlaywrightBridge('chromium', {}, {
      environment: { DEBUG: 'pw:api' },
    }),
    /diagnostic/u,
  );
  await assert.rejects(
    runBrowserRelayPlaywrightBridge('chromium', {}, {
      environment: {},
      unreviewed: true,
    }),
    /options exceed the reviewed boundary/u,
  );
  assert.throws(
    () => validatePlaywrightBridgeResult({
      schema: 'miakapp.staging-browser-relay-playwright-bridge-result/1',
      browser: 'chromium',
      state: 'blocked',
      reason: 'pinned_playwright_bfcache_unsupported',
      private_inputs_requested: 0,
      receipt: null,
      firebase_custom_token: token('a', 'b', 'c'),
    }, 'chromium'),
    /forbidden|private material/u,
  );
});

test('cannot mask unsafe process diagnostics with an injected environment', async () => {
  const hadPwdebug = Object.hasOwn(process.env, 'PWDEBUG');
  const previousPwdebug = process.env.PWDEBUG;
  process.env.PWDEBUG = '1';
  try {
    await assert.rejects(
      runBrowserRelayPlaywrightBridge('chromium', {}, { environment: {} }),
      /diagnostic/u,
    );
  } finally {
    if (hadPwdebug) process.env.PWDEBUG = previousPwdebug;
    else delete process.env.PWDEBUG;
  }
});

test('pins and guards the exact bridge package and Playwright capability contract', () => {
  const profile = validateBrowserRelayPlaywrightBridgeProfile();
  assert.equal(profile.compatibility.playwright_bfcache_testing_supported, false);
  assert.equal(profile.compatibility.chromium_blocked_before_page_or_private_input, true);
  assert.equal(profile.compatibility.firefox_receipt_transport_complete, true);
  assert.equal(profile.compatibility.webkit_receipt_transport_complete, true);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.match(PLAYWRIGHT_BRIDGE_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  validateBrowserRelayPlaywrightBridgeRoot(
    new URL('../browser-relay-playwright-bridge/', import.meta.url),
  );
  assert.throws(
    () => validatePlaywrightBridgeResult({}, 'safari'),
    StagingBrowserRelayPlaywrightBridgeError,
  );
});

test('guards copied bridge inventory, boundaries and real package roots', async (t) => {
  for (const variant of ['extra', 'executable', 'source', 'symlink-file', 'symlink-root']) {
    await t.test(variant, () => {
      const parent = mkdtempSync(join(tmpdir(), 'miakapp-playwright-bridge-'));
      t.after(() => rmSync(parent, { recursive: true, force: true }));
      const directory = join(parent, 'package');
      mkdirSync(directory);
      for (const name of BRIDGE_FILES) {
        copyFileSync(new URL(name, BRIDGE_ROOT), join(directory, name));
      }
      const root = pathToFileURL(`${directory}/`);
      assert.doesNotThrow(() => validateBrowserRelayPlaywrightBridgeRoot(root));
      if (variant === 'extra') writeFileSync(join(directory, 'unexpected.txt'), 'extra\n');
      if (variant === 'executable') chmodSync(join(directory, 'bridge.mjs'), 0o755);
      if (variant === 'source') {
        const source = readFileSync(join(directory, 'bridge.mjs'), 'utf8');
        writeFileSync(join(directory, 'bridge.mjs'), source.replace('page.close()', 'page.shutdown()'));
      }
      if (variant === 'symlink-file') {
        rmSync(join(directory, 'bridge.mjs'));
        symlinkSync(new URL('bridge.mjs', BRIDGE_ROOT), join(directory, 'bridge.mjs'));
      }
      if (variant === 'symlink-root') {
        const linkedRoot = join(parent, 'linked-root');
        symlinkSync(directory, linkedRoot);
        assert.throws(
          () => validateBrowserRelayPlaywrightBridgeRoot(pathToFileURL(`${linkedRoot}/`)),
          /real directory/u,
        );
      } else {
        assert.throws(() => validateBrowserRelayPlaywrightBridgeRoot(root));
      }
    });
  }
});
