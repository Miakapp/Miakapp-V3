import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_ORDER,
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  BROWSER_RELAY_TARGET_URL,
  ENGINE_RESULT_SCHEMA,
  StagingBrowserRelayRunnerError,
  buildClosedRunnerResult,
  validateBrowserRelayRunnerProfile,
  validateEngineResult,
} from '../browser-relay-runner/contract.mjs';
import {
  runThreeEngineBrowserRelayAcceptance,
  validatePlaywrightDiagnosticEnvironment,
} from '../browser-relay-runner/driver.mjs';
import { validateBrowserRelayRunnerRoot } from '../browser-relay-runner/guard.mjs';

const profile = JSON.parse(readFileSync(
  new URL('../browser-relay-runner/profile.json', import.meta.url),
  'utf8',
));

function counters(overrides = {}) {
  return {
    app_check_assessments: 0,
    control_plane_exchanges: 0,
    kms_signatures: 0,
    firestore_writes: 0,
    maximum_active_websockets: 1,
    source_credentials_on_websocket: 0,
    browser_credential_persistence_events: 0,
    physical_call_replays: 0,
    ...overrides,
  };
}

function engineResult(browser, overrides = {}) {
  return {
    schema: ENGINE_RESULT_SCHEMA,
    browser,
    state: 'succeeded',
    assertions: Object.fromEntries(profile.assertions[browser].map((name) => [name, true])),
    counters: counters(browser === 'chromium' ? {
      app_check_assessments: 3,
      control_plane_exchanges: 7,
      kms_signatures: 7,
      firestore_writes: 12,
    } : {}),
    duration_milliseconds: browser === 'chromium' ? 120_000 : 15_000,
    public_key_ids: browser === 'chromium' ? ['1', '2'] : [],
    revision_ids: browser === 'chromium' ? [
      'control-plane-00010-vop',
      'miakapp-staging-relay-a-00002-tst',
      'miakapp-staging-relay-b-00002-tst',
    ] : [],
    stable_outcome_classes: browser === 'chromium'
      ? ['accepted', 'applied', 'failed', 'outcome_unknown', 'stale']
      : ['accepted'],
    ...overrides,
  };
}

function mockEngines(results, calls, receivedInputs) {
  return Object.fromEntries(BROWSER_ORDER.map((browser) => [browser, {
    async launch(options) {
      calls.push(`${browser}:launch:${JSON.stringify(options)}`);
      return {
        async newContext(contextOptions) {
          calls.push(`${browser}:context:${contextOptions.serviceWorkers}`);
          return {
            async newPage() {
              calls.push(`${browser}:page`);
              return {
                async goto(url, optionsValue) {
                  calls.push(`${browser}:goto:${url}:${optionsValue.timeout}`);
                },
                async evaluate(_callback, argument) {
                  calls.push(`${browser}:evaluate`);
                  receivedInputs.push(argument.input);
                  return results[browser];
                },
              };
            },
            async close() { calls.push(`${browser}:context:close`); },
          };
        },
        async close() { calls.push(`${browser}:browser:close`); },
      };
    },
  }]));
}

test('pins a dormant three-engine profile with closed output and no execution authority', () => {
  const validated = validateBrowserRelayRunnerProfile();
  assert.equal(validated.state, 'three_engine_closed_runner_implemented_not_executed');
  assert.deepEqual(validated.execution.browser_order, BROWSER_ORDER);
  assert.equal(validated.execution.maximum_invocations, 3);
  assert.equal(validated.execution.maximum_total_milliseconds, 840_000);
  assert.deepEqual(validated.execution.browser_deadlines_milliseconds, {
    chromium: 720_000,
    firefox: 60_000,
    webkit: 60_000,
  });
  assert.equal(validated.target.live_execution_authorized_by_profile, false);
  assert.equal(validated.evidence.live_execution_count, 0);
  assert.match(BROWSER_RELAY_RUNNER_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
});

test('rejects Playwright protocol or inspector diagnostics before private input exists', () => {
  assert.equal(validatePlaywrightDiagnosticEnvironment({}), true);
  assert.equal(validatePlaywrightDiagnosticEnvironment({ DEBUG: 'app:*' }), true);
  assert.throws(
    () => validatePlaywrightDiagnosticEnvironment({ DEBUG: 'app:*,pw:protocol' }),
    /diagnostics must be disabled/u,
  );
  assert.throws(
    () => validatePlaywrightDiagnosticEnvironment({ PWDEBUG: '1' }),
    /diagnostics must be disabled/u,
  );
});

test('runs Chromium, Firefox and WebKit sequentially and returns only closed aggregates', async () => {
  const calls = [];
  const receivedInputs = [];
  const results = Object.fromEntries(BROWSER_ORDER.map((browser) => [
    browser,
    engineResult(browser),
  ]));
  const engines = mockEngines(results, calls, receivedInputs);
  const privateMarker = 'private-input-must-not-leave-process-boundary';
  const instants = [1_000, 1_001, 1_002, 1_003, 181_000];
  const output = await runThreeEngineBrowserRelayAcceptance(
    engines,
    async (browser) => ({ browser, privateMarker }),
    {
      clock: () => instants.shift(),
      setTimer: () => 17,
      clearTimer: () => {},
    },
  );
  assert.equal(output.state, 'succeeded_closed_output');
  assert.equal(output.browser_invocations, 3);
  assert.equal(output.assertions_passed, 40);
  assert.equal(output.assertions_failed, 0);
  assert.equal(output.counters.maximum_active_websockets, 1);
  assert.equal(output.counters.app_check_assessments, 3);
  assert.deepEqual(output.public_key_ids, ['1', '2']);
  assert.deepEqual(output.browser_order, BROWSER_ORDER);
  assert.equal(JSON.stringify(output).includes(privateMarker), false);
  assert.equal(receivedInputs.length, 3);
  assert.deepEqual(calls.filter((entry) => entry.includes(':launch:')), [
    'chromium:launch:{"headless":true}',
    'firefox:launch:{"headless":true}',
    'webkit:launch:{"headless":true}',
  ]);
  for (let index = 0; index < BROWSER_ORDER.length - 1; index += 1) {
    assert.ok(
      calls.indexOf(`${BROWSER_ORDER[index]}:browser:close`)
        < calls.indexOf(`${BROWSER_ORDER[index + 1]}:launch:{"headless":true}`),
    );
  }
  assert.ok(calls.includes(`chromium:goto:${BROWSER_RELAY_TARGET_URL}:30000`));
});

test('rejects false assertions, private output, unknown fields and aggregate budget drift', () => {
  const falseAssertion = engineResult('firefox');
  falseAssertion.assertions.firefox_initial_session_and_teardown = false;
  assert.throws(() => validateEngineResult(falseAssertion, 'firefox'), /has drifted/u);

  const privateOutput = engineResult('webkit');
  privateOutput.token = 'must-never-be-returned';
  assert.throws(() => validateEngineResult(privateOutput, 'webkit'), /forbidden output/u);

  const unknown = engineResult('chromium');
  unknown.debug = true;
  assert.throws(() => validateEngineResult(unknown, 'chromium'), /reviewed fields/u);

  const excessive = BROWSER_ORDER.map((browser) => engineResult(browser, {
    counters: counters({ app_check_assessments: 6 }),
  }));
  assert.throws(() => buildClosedRunnerResult(excessive, 200_000), /outside its reviewed bound/u);
});

test('collapses browser and private-input failures without retaining arbitrary diagnostics', async () => {
  const calls = [];
  const receivedInputs = [];
  const results = Object.fromEntries(BROWSER_ORDER.map((browser) => [
    browser,
    engineResult(browser),
  ]));
  results.chromium = { token: 'eyJprivate.private.private' };
  await assert.rejects(
    runThreeEngineBrowserRelayAcceptance(
      mockEngines(results, calls, receivedInputs),
      async () => ({ secret: 'private' }),
    ),
    (error) => error instanceof StagingBrowserRelayRunnerError
      && error.message === 'Browser-relay chromium invocation failed before a closed result'
      && !error.message.includes('eyJprivate'),
  );
  assert.ok(calls.includes('chromium:context:close'));
  assert.ok(calls.includes('chromium:browser:close'));

  await assert.rejects(
    runThreeEngineBrowserRelayAcceptance(
      mockEngines(results, [], []),
      async () => { throw new Error('Bearer private-value'); },
    ),
    (error) => error instanceof StagingBrowserRelayRunnerError
      && error.message === 'Private input provisioning failed for chromium'
      && !error.message.includes('Bearer'),
  );
});

test('rejects invalid engine maps and oversized private input before page navigation', async () => {
  await assert.rejects(
    runThreeEngineBrowserRelayAcceptance({}, async () => ({})),
    /Chromium, Firefox and WebKit/u,
  );
  const calls = [];
  await assert.rejects(
    runThreeEngineBrowserRelayAcceptance(
      mockEngines(Object.fromEntries(BROWSER_ORDER.map((browser) => [
        browser,
        engineResult(browser),
      ])), calls, []),
      async () => ({ value: 'x'.repeat(65_536) }),
    ),
    /Private input provisioning failed/u,
  );
  assert.deepEqual(calls, []);
});

test('closes the active context and browser when an engine reaches its deadline', async () => {
  const calls = [];
  let deadlineCallback;
  const engines = {
    chromium: {
      async launch() {
        calls.push('launch');
        return {
          async newContext() {
            calls.push('context');
            return {
              async newPage() {
                return {
                  async goto() {},
                  async evaluate() {
                    calls.push('evaluate');
                    return new Promise(() => {});
                  },
                };
              },
              async close() { calls.push('context:close'); },
            };
          },
          async close() { calls.push('browser:close'); },
        };
      },
    },
    firefox: { launch: async () => assert.fail('Firefox must not launch after timeout') },
    webkit: { launch: async () => assert.fail('WebKit must not launch after timeout') },
  };
  const execution = runThreeEngineBrowserRelayAcceptance(
    engines,
    async () => ({ private: true }),
    {
      setTimer(callback) {
        deadlineCallback = callback;
        return 23;
      },
      clearTimer: () => {},
      maximumBrowserMilliseconds: 1,
    },
  );
  while (!calls.includes('evaluate')) await new Promise((resolve) => setImmediate(resolve));
  deadlineCallback();
  await assert.rejects(
    execution,
    /chromium invocation failed before a closed result/u,
  );
  assert.ok(calls.includes('context:close'));
  assert.ok(calls.includes('browser:close'));
});

test('fails closed when the owning browser cannot be closed', async () => {
  const results = Object.fromEntries(BROWSER_ORDER.map((browser) => [
    browser,
    engineResult(browser),
  ]));
  const engines = mockEngines(results, [], []);
  engines.chromium.launch = async () => ({
    async newContext() {
      return {
        async newPage() {
          return {
            async goto() {},
            async evaluate() { return results.chromium; },
          };
        },
        async close() {},
      };
    },
    async close() { throw new Error('arbitrary private diagnostic'); },
  });
  await assert.rejects(
    runThreeEngineBrowserRelayAcceptance(engines, async () => ({ private: true })),
    (error) => error instanceof StagingBrowserRelayRunnerError
      && error.message === 'Browser-relay chromium cleanup did not converge'
      && !error.message.includes('arbitrary'),
  );
});

test('guards the exact dormant runner package and rejects executable or extra files', () => {
  const names = ['README.md', 'contract.mjs', 'driver.mjs', 'guard.mjs', 'profile.json'];
  validateBrowserRelayRunnerRoot(new URL('../browser-relay-runner/', import.meta.url));

  const extraRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-runner-extra-'));
  for (const name of names) {
    copyFileSync(new URL(`../browser-relay-runner/${name}`, import.meta.url), join(extraRoot, name));
    chmodSync(join(extraRoot, name), 0o600);
  }
  writeFileSync(join(extraRoot, 'apply.sh'), '#!/bin/sh\n');
  assert.throws(
    () => validateBrowserRelayRunnerRoot(new URL(`file://${extraRoot}/`)),
    /reviewed file inventory/u,
  );

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-runner-symlink-'));
  for (const name of names.filter((name) => name !== 'driver.mjs')) {
    copyFileSync(new URL(`../browser-relay-runner/${name}`, import.meta.url), join(symlinkRoot, name));
    chmodSync(join(symlinkRoot, name), 0o600);
  }
  symlinkSync(join(symlinkRoot, 'contract.mjs'), join(symlinkRoot, 'driver.mjs'));
  assert.throws(
    () => validateBrowserRelayRunnerRoot(new URL(`file://${symlinkRoot}/`)),
    /regular files/u,
  );
});
