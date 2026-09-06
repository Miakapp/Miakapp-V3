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
  HOME_ID,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
} from '../browser-relay-page/boundary.mjs';
import {
  ABSENCE_SCHEMA,
  FIXTURE_PROFILE_SHA256,
  FIXTURE_SOURCE_SHA256,
  STATE_EXPECTATION_SCHEMA,
  STATE_PATH,
  SYNTHETIC_UID,
  StagingBrowserRelayFixtureError,
  rejectFixturePrivateMaterial,
  validateBrowserRelayFixtureProfile,
  validateFixtureAbsence,
  validateStateExpectation,
} from '../browser-relay-fixture/contract.mjs';
import { createSyntheticBrowserRelayFixture } from '../browser-relay-fixture/fixture.mjs';
import { validateBrowserRelayFixtureRoot } from '../browser-relay-fixture/guard.mjs';

const HOME_KEY_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const HOME_KEY = `mhk1_${HOME_KEY_ID}_${'B'.repeat(43)}`;

function jwt(marker) {
  return `${'a'.repeat(24)}.${marker.padEnd(24, 'b')}.${'c'.repeat(32)}`;
}

function absence(overrides = {}) {
  return {
    schema: ABSENCE_SCHEMA,
    state: 'absent',
    firebase_auth_users: 0,
    public_homes: 0,
    private_homes: 0,
    home_key_records: 0,
    home_key_indexes: 0,
    control_owners: 0,
    active_coordinator_sessions: 0,
    ...overrides,
  };
}

function fixtureHarness(overrides = {}) {
  const calls = [];
  const mutations = [];
  const privateValues = {};
  let configured;
  let tokenAttempt = 0;
  const coordinator = {
    state: {
      async set(value) {
        mutations.push(value);
        return { outcome: 'applied' };
      },
    },
    configure(value) {
      configured = value;
      calls.push('coordinator:configure');
    },
    async start() {
      calls.push('coordinator:start');
      return { sessionId: 1, generation: 1, connectedAtMs: 1_788_700_000_000 };
    },
    async stop(value) {
      calls.push(`coordinator:stop:${value.deadlineMs}`);
    },
  };
  const base = {
    async verifyFixtureAbsent() {
      calls.push('fixture:verify-absent');
      return absence();
    },
    async createFirebaseIdentity(input) {
      calls.push('identity:create');
      assert.deepEqual(input, { uid: SYNTHETIC_UID });
      privateValues.identityToken = jwt('identity');
      return { uid: SYNTHETIC_UID, id_token: privateValues.identityToken };
    },
    async createHome(input) {
      calls.push('home:create');
      privateValues.createHomeInput = input;
      return { home_id: HOME_ID, relay_url: RELAY_A_URL };
    },
    async createHomeKey(input) {
      calls.push('home-key:create');
      privateValues.createHomeKeyInput = input;
      return { key_id: HOME_KEY_ID, home_key: HOME_KEY };
    },
    createHomeKeyAccessTokenProvider(options) {
      calls.push('provider:create');
      privateValues.providerOptions = options;
      return { async getAccessToken() {} };
    },
    createCoordinator(options) {
      calls.push('coordinator:create');
      privateValues.coordinatorOptions = options;
      return coordinator;
    },
    async issueFirebaseCustomToken(input) {
      tokenAttempt += 1;
      calls.push(`token:${input.browser}:${input.sequence}`);
      return jwt(`${input.browser}-${tokenAttempt}`);
    },
    async patchHomeRelay(input) {
      calls.push('home:rotate');
      privateValues.patchHomeInput = input;
      return { home_id: HOME_ID, relay_url: RELAY_B_URL };
    },
    async removeFixture(input) {
      calls.push('fixture:remove');
      privateValues.removeInput = input;
      return true;
    },
  };
  const dependencies = { ...base, ...overrides };
  return {
    calls,
    coordinator,
    dependencies,
    get configured() { return configured; },
    mutations,
    privateValues,
  };
}

test('pins one dormant synthetic fixture controller without live authority', () => {
  const profile = validateBrowserRelayFixtureProfile();
  assert.equal(profile.state, 'closed_single_fixture_controller_implemented_not_wired_not_executed');
  assert.equal(profile.target.home_id, HOME_ID);
  assert.deepEqual(profile.fixture.browser_order, BROWSER_ORDER);
  assert.equal(profile.fixture.maximum_browser_custom_tokens, 3);
  assert.equal(profile.lifecycle.cleanup_authority_requires_observed_initial_absence, true);
  assert.equal(profile.authority.cloud_mutation_authorized, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(profile.evidence.live_fixture_creations, 0);
  assert.match(FIXTURE_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(FIXTURE_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
});

test('creates, drives and removes the fixed fixture while keeping private values closed', async () => {
  const harness = fixtureHarness();
  const fixture = createSyntheticBrowserRelayFixture(harness.dependencies);
  assert.equal(await fixture.create(), true);
  assert.deepEqual(harness.calls.slice(0, 8), [
    'fixture:verify-absent',
    'identity:create',
    'home:create',
    'home-key:create',
    'provider:create',
    'coordinator:create',
    'coordinator:configure',
    'coordinator:start',
  ]);
  assert.equal(harness.privateValues.createHomeInput.firebase_id_token,
    harness.privateValues.identityToken);
  assert.equal(harness.privateValues.createHomeInput.home_id, HOME_ID);
  assert.equal(harness.privateValues.createHomeInput.relay_url, RELAY_A_URL);
  assert.deepEqual(harness.privateValues.createHomeKeyInput.scopes, ['relay:coordinator']);
  assert.equal(harness.privateValues.providerOptions.homeKey, HOME_KEY);
  assert.equal(harness.privateValues.coordinatorOptions.name,
    'miakapp-v4-staging-acceptance');
  assert.deepEqual(harness.configured.state, { [STATE_PATH]: 20 });
  assert.deepEqual(harness.configured.stateAccess, [{
    userId: SYNTHETIC_UID,
    patterns: ['acceptance.*'],
  }]);
  assert.deepEqual(harness.configured.events, []);
  assert.deepEqual(harness.configured.eventAccess, []);
  assert.deepEqual(fixture.stateExpectation(), {
    schema: STATE_EXPECTATION_SCHEMA,
    path: STATE_PATH,
    revision: 1,
    value: 20,
  });

  const callResult = await harness.configured.functions['acceptance.set']({
    source: { kind: 'user', id: SYNTHETIC_UID },
    arguments: { target: 21 },
    idempotencyKey: 'acceptance-21',
  });
  assert.deepEqual(callResult, { accepted: true, arguments: { target: 21 } });
  assert.deepEqual(await harness.configured.functions['acceptance.set']({
    source: { kind: 'user', id: SYNTHETIC_UID },
    arguments: { target: 21 },
    idempotencyKey: 'acceptance-21',
  }), callResult);
  assert.equal(harness.mutations.length, 1);
  assert.deepEqual(fixture.stateExpectation(), {
    schema: STATE_EXPECTATION_SCHEMA,
    path: STATE_PATH,
    revision: 2,
    value: 21,
  });
  assert.deepEqual(await fixture.setTemperature(22), {
    schema: STATE_EXPECTATION_SCHEMA,
    path: STATE_PATH,
    revision: 3,
    value: 22,
  });

  const privateInputs = [];
  for (const browser of BROWSER_ORDER) {
    privateInputs.push(await fixture.privateInput(browser));
  }
  assert.deepEqual(privateInputs.map(({ schema, browser }) => ({ schema, browser })),
    BROWSER_ORDER.map((browser) => ({ schema: PAGE_PRIVATE_INPUT_SCHEMA, browser })));
  assert.equal(new Set(privateInputs.map(({ firebase_custom_token: token }) => token)).size, 3);

  assert.equal(await fixture.rotateRelayToB(), true);
  assert.equal(harness.privateValues.patchHomeInput.firebase_id_token,
    harness.privateValues.identityToken);
  assert.equal(harness.privateValues.patchHomeInput.relay_url, RELAY_B_URL);
  assert.equal(await fixture.stop(), true);
  assert.equal(await fixture.remove(), true);
  assert.equal(harness.privateValues.removeInput.uid, SYNTHETIC_UID);
  assert.equal(harness.privateValues.removeInput.firebase_id_token,
    harness.privateValues.identityToken);
  assert.equal(harness.privateValues.removeInput.home_key_id, HOME_KEY_ID);
  assert.deepEqual(await fixture.verifyAbsent(), absence());
  assert.equal(await fixture.remove(), true);
  assert.equal(harness.calls.filter((entry) => entry === 'fixture:remove').length, 1);
  assert.equal(JSON.stringify(await fixture.verifyAbsent()).includes(HOME_KEY), false);
});

test('refuses creation and deletion when initial absence is not proven', async () => {
  let mutations = 0;
  const harness = fixtureHarness({
    async verifyFixtureAbsent() {
      return absence({ public_homes: 1 });
    },
    async createFirebaseIdentity() {
      mutations += 1;
      throw new Error('must not run');
    },
    async removeFixture() {
      mutations += 1;
      return true;
    },
  });
  const fixture = createSyntheticBrowserRelayFixture(harness.dependencies);
  await assert.rejects(
    fixture.create(),
    (error) => error instanceof StagingBrowserRelayFixtureError
      && error.message === 'Synthetic fixture initial absence could not be proven',
  );
  await assert.rejects(fixture.remove(), /not authorized without initial absence/u);
  assert.equal(mutations, 0);
});

test('retains cleanup authority across partial and ambiguous creation failures', async () => {
  const privateFailure = `Bearer ${'secret'.repeat(12)}`;
  const harness = fixtureHarness({
    async createHome() {
      harness.calls.push('home:create:unknown');
      throw new Error(privateFailure);
    },
  });
  const fixture = createSyntheticBrowserRelayFixture(harness.dependencies);
  await assert.rejects(
    fixture.create(),
    (error) => error instanceof StagingBrowserRelayFixtureError
      && error.message === 'Synthetic fixture creation failed; reviewed cleanup is required'
      && !error.message.includes(privateFailure),
  );
  assert.equal(await fixture.remove(), true);
  assert.ok(harness.calls.includes('fixture:remove'));
  assert.equal(harness.privateValues.removeInput.uid, SYNTHETIC_UID);
  assert.equal(harness.privateValues.removeInput.home_key_id, undefined);
});

test('stops a coordinator whose start failed before removing fixture data', async () => {
  const harness = fixtureHarness();
  harness.coordinator.start = async () => {
    harness.calls.push('coordinator:start:failed');
    throw new Error(jwt('private-start-failure'));
  };
  const fixture = createSyntheticBrowserRelayFixture(harness.dependencies);
  await assert.rejects(fixture.create(), /reviewed cleanup is required/u);
  assert.equal(await fixture.remove(), true);
  assert.ok(
    harness.calls.indexOf('coordinator:stop:2000') < harness.calls.indexOf('fixture:remove'),
  );
});

test('enforces browser order and poisons the run after custom-token reuse', async () => {
  let attempts = 0;
  let firstToken;
  const harness = fixtureHarness({
    async issueFirebaseCustomToken(input) {
      attempts += 1;
      if (attempts <= 2) {
        firstToken ??= jwt('duplicate-token');
        return firstToken;
      }
      return jwt(`${input.browser}-fresh`);
    },
  });
  const fixture = createSyntheticBrowserRelayFixture(harness.dependencies);
  await fixture.create();
  await assert.rejects(fixture.privateInput('firefox'), /reviewed sequence/u);
  await fixture.privateInput('chromium');
  await assert.rejects(fixture.privateInput('firefox'), /reuse was detected/u);
  await assert.rejects(fixture.privateInput('firefox'), /reviewed sequence/u);
  await fixture.remove();
});

test('collapses pre-issued cancellation without calling the token dependency', async () => {
  let tokenCalls = 0;
  const harness = fixtureHarness({
    async issueFirebaseCustomToken() {
      tokenCalls += 1;
      return jwt('must-not-be-issued');
    },
  });
  const fixture = createSyntheticBrowserRelayFixture(harness.dependencies);
  await fixture.create();
  const controller = new AbortController();
  controller.abort(new Error(`Bearer ${'private'.repeat(12)}`));
  await assert.rejects(
    fixture.privateInput('chromium', controller.signal),
    (error) => error instanceof StagingBrowserRelayFixtureError
      && error.message === 'Synthetic custom-token issuance was cancelled for chromium'
      && !error.message.includes('Bearer'),
  );
  assert.equal(tokenCalls, 0);
  await fixture.remove();
});

test('rejects foreign callers and malformed state without invoking the coordinator', async () => {
  const harness = fixtureHarness();
  const fixture = createSyntheticBrowserRelayFixture(harness.dependencies);
  await fixture.create();
  await assert.rejects(
    harness.configured.functions['acceptance.set']({
      source: { kind: 'user', id: 'foreign-user' },
      arguments: { target: 19 },
      idempotencyKey: 'acceptance-19',
    }),
    /invalid caller boundary/u,
  );
  await assert.rejects(
    harness.configured.functions['acceptance.set']({
      source: { kind: 'user', id: SYNTHETIC_UID },
      arguments: { target: 201 },
      idempotencyKey: 'acceptance-201',
    }),
    /invalid caller boundary/u,
  );
  assert.deepEqual(harness.mutations, []);
  await fixture.remove();
});

test('validates only closed absence and state-expectation outputs', () => {
  assert.deepEqual(validateFixtureAbsence(absence()), absence());
  assert.throws(
    () => validateFixtureAbsence(absence({ home_key_indexes: 1 })),
    /has drifted/u,
  );
  assert.deepEqual(validateStateExpectation({
    schema: STATE_EXPECTATION_SCHEMA,
    path: STATE_PATH,
    revision: 4,
    value: -5,
  }), {
    schema: STATE_EXPECTATION_SCHEMA,
    path: STATE_PATH,
    revision: 4,
    value: -5,
  });
  assert.throws(
    () => validateStateExpectation({
      schema: STATE_EXPECTATION_SCHEMA,
      path: STATE_PATH,
      revision: 4,
      value: 201,
    }),
    /outside its reviewed bound/u,
  );
  assert.throws(
    () => rejectFixturePrivateMaterial({ firebase_custom_token: jwt('private') }),
    /forbidden output/u,
  );
  assert.throws(
    () => rejectFixturePrivateMaterial({ detail: HOME_KEY }),
    /credential material/u,
  );
});

test('guards the exact dormant fixture package inventory', () => {
  const root = new URL('../browser-relay-fixture/', import.meta.url);
  assert.doesNotThrow(() => validateBrowserRelayFixtureRoot(root));

  const sourceRoot = root.pathname;
  const extraRoot = mkdtempSync(join(tmpdir(), 'miakapp-fixture-extra-'));
  for (const file of ['README.md', 'contract.mjs', 'fixture.mjs', 'guard.mjs', 'profile.json']) {
    copyFileSync(join(sourceRoot, file), join(extraRoot, file));
  }
  writeFileSync(join(extraRoot, 'live-cli.mjs'), 'process.exit(0);\n');
  assert.throws(
    () => validateBrowserRelayFixtureRoot(new URL(`file://${extraRoot}/`)),
    /file inventory/u,
  );

  const executableRoot = mkdtempSync(join(tmpdir(), 'miakapp-fixture-exec-'));
  for (const file of ['README.md', 'contract.mjs', 'fixture.mjs', 'guard.mjs', 'profile.json']) {
    copyFileSync(join(sourceRoot, file), join(executableRoot, file));
  }
  chmodSync(join(executableRoot, 'fixture.mjs'), 0o755);
  assert.throws(
    () => validateBrowserRelayFixtureRoot(new URL(`file://${executableRoot}/`)),
    /must not be executable/u,
  );

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-fixture-link-'));
  for (const file of ['README.md', 'contract.mjs', 'guard.mjs', 'profile.json']) {
    copyFileSync(join(sourceRoot, file), join(symlinkRoot, file));
  }
  symlinkSync(join(sourceRoot, 'fixture.mjs'), join(symlinkRoot, 'fixture.mjs'));
  assert.throws(
    () => validateBrowserRelayFixtureRoot(new URL(`file://${symlinkRoot}/`)),
    /regular files only/u,
  );

  const source = readFileSync(join(sourceRoot, 'fixture.mjs'), 'utf8');
  assert.equal(source.includes('process.argv'), false);
  assert.equal(source.includes('child_process'), false);
});
