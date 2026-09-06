import assert from 'node:assert/strict';
import {
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
  HOME_ID,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
} from '../browser-relay-page/boundary.mjs';
import {
  ABSENCE_SCHEMA,
  STATE_PATH,
  SYNTHETIC_UID,
} from '../browser-relay-fixture/contract.mjs';
import {
  REPLACEMENT_ABSENCE_SCHEMA,
  REPLACEMENT_IDENTITY_SCHEMA,
  REPLACEMENT_SYNTHETIC_UID,
  SCENARIO_ABSENCE_SCHEMA,
  SCENARIO_FIXTURE_PROFILE_SHA256,
  SCENARIO_FIXTURE_SOURCE_SHA256,
  SCENARIO_INPUT_ORDER,
  StagingBrowserRelayScenarioFixtureError,
  rejectScenarioFixturePrivateMaterial,
  validateBrowserRelayScenarioFixtureProfile,
  validateReplacementAbsence,
  validateReplacementIdentity,
  validateScenarioAbsence,
} from '../browser-relay-scenario-fixture/contract.mjs';
import { createSyntheticBrowserRelayScenarioFixture } from '../browser-relay-scenario-fixture/fixture.mjs';
import { validateBrowserRelayScenarioFixtureRoot } from '../browser-relay-scenario-fixture/guard.mjs';

const HOME_KEY_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const HOME_KEY = `mhk1_${HOME_KEY_ID}_${'B'.repeat(43)}`;

function jwt(marker) {
  return `${'a'.repeat(24)}.${marker.padEnd(24, 'b')}.${'c'.repeat(32)}`;
}

function baseAbsence(overrides = {}) {
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

function replacementAbsence(overrides = {}) {
  return {
    schema: REPLACEMENT_ABSENCE_SCHEMA,
    state: 'absent',
    firebase_auth_users: 0,
    ...overrides,
  };
}

function expectedScenarioAbsence() {
  return {
    schema: SCENARIO_ABSENCE_SCHEMA,
    state: 'absent',
    firebase_auth_users: 0,
    public_homes: 0,
    private_homes: 0,
    home_key_records: 0,
    home_key_indexes: 0,
    control_owners: 0,
    active_coordinator_sessions: 0,
  };
}

function harness(options = {}) {
  const calls = [];
  const pageTokens = [];
  let configured;
  let basePresent = false;
  let replacementPresent = options.replacementInitiallyPresent === true;
  let baseTokenSequence = 0;
  const coordinator = {
    state: {
      async set() {
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
    async stop({ deadlineMs }) {
      calls.push(`coordinator:stop:${deadlineMs}`);
    },
  };
  const baseDependencies = {
    async verifyFixtureAbsent() {
      calls.push('base:verify-absent');
      return basePresent ? baseAbsence({ public_homes: 1 }) : baseAbsence();
    },
    async createFirebaseIdentity({ uid }) {
      assert.equal(uid, SYNTHETIC_UID);
      calls.push('base:identity:create');
      basePresent = true;
      return { uid: SYNTHETIC_UID, id_token: jwt('base-identity') };
    },
    async createHome(input) {
      assert.equal(input.home_id, HOME_ID);
      assert.equal(input.relay_url, RELAY_A_URL);
      calls.push('base:home:create');
      return { home_id: HOME_ID, relay_url: RELAY_A_URL };
    },
    async createHomeKey() {
      calls.push('base:home-key:create');
      return { key_id: HOME_KEY_ID, home_key: HOME_KEY };
    },
    createHomeKeyAccessTokenProvider() {
      calls.push('base:provider:create');
      return { async getAccessToken() {} };
    },
    createCoordinator() {
      calls.push('base:coordinator:create');
      return coordinator;
    },
    async issueFirebaseCustomToken({ uid, browser, sequence }) {
      assert.equal(uid, SYNTHETIC_UID);
      baseTokenSequence += 1;
      calls.push(`base:token:${browser}:${sequence}`);
      const token = jwt(`base-${browser}-${baseTokenSequence}`);
      pageTokens.push(token);
      return token;
    },
    async patchHomeRelay(input) {
      assert.equal(input.home_id, HOME_ID);
      assert.equal(input.relay_url, RELAY_B_URL);
      calls.push('base:relay:rotate');
      return { home_id: HOME_ID, relay_url: RELAY_B_URL };
    },
    async removeFixture({ uid, home_id: homeId }) {
      assert.equal(uid, SYNTHETIC_UID);
      assert.equal(homeId, HOME_ID);
      calls.push('base:remove');
      basePresent = false;
      return true;
    },
  };
  const replacementDependencies = {
    async verifyReplacementIdentityAbsent({ uid }) {
      assert.equal(uid, REPLACEMENT_SYNTHETIC_UID);
      calls.push('replacement:verify-absent');
      return replacementPresent
        ? replacementAbsence({ firebase_auth_users: 1 })
        : replacementAbsence();
    },
    async createReplacementIdentity({ uid }) {
      assert.equal(uid, REPLACEMENT_SYNTHETIC_UID);
      calls.push('replacement:create');
      replacementPresent = options.replacementCreationOutcomeUnknown === true
        ? false
        : true;
      if (options.replacementCreationOutcomeUnknown === true) throw new Error('private');
      return { schema: REPLACEMENT_IDENTITY_SCHEMA, state: 'created' };
    },
    async issueReplacementFirebaseCustomToken(input) {
      assert.deepEqual({
        uid: input.uid,
        browser: input.browser,
        identity_generation: input.identity_generation,
        matrix_sequence: input.matrix_sequence,
      }, {
        uid: REPLACEMENT_SYNTHETIC_UID,
        browser: 'chromium',
        identity_generation: 2,
        matrix_sequence: 2,
      });
      calls.push('replacement:token:chromium:2');
      const token = options.reusePrimaryToken === true ? pageTokens[0] : jwt('replacement-chromium');
      pageTokens.push(token);
      return token;
    },
    async removeReplacementIdentity({ uid }) {
      assert.equal(uid, REPLACEMENT_SYNTHETIC_UID);
      calls.push('replacement:remove');
      if (options.replacementRemovalFails === true) return false;
      replacementPresent = false;
      return true;
    },
  };
  return {
    baseDependencies,
    calls,
    get configured() { return configured; },
    pageTokens,
    replacementDependencies,
  };
}

test('pins the dormant four-input two-identity scenario fixture', () => {
  const profile = validateBrowserRelayScenarioFixtureProfile();
  assert.equal(
    profile.state,
    'closed_four_input_two_identity_controller_implemented_cloud_extension_not_wired_not_executed',
  );
  assert.equal(profile.scenario.firebase_identities, 2);
  assert.equal(profile.scenario.page_private_inputs, 4);
  assert.deepEqual(profile.scenario.page_private_input_order, SCENARIO_INPUT_ORDER);
  assert.equal(profile.compatibility.fixture_capacity_satisfied, true);
  assert.equal(profile.compatibility.replacement_cloud_adapter_present, false);
  assert.equal(profile.authority.cloud_mutation_authorized, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.match(SCENARIO_FIXTURE_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(SCENARIO_FIXTURE_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
});

test('creates a genuine replacement identity and emits four exact ordered private inputs', async () => {
  const value = harness();
  const fixture = createSyntheticBrowserRelayScenarioFixture(
    value.baseDependencies,
    value.replacementDependencies,
  );
  assert.equal(await fixture.create(), true);
  assert.deepEqual(value.calls.slice(0, 4), [
    'replacement:verify-absent',
    'base:verify-absent',
    'base:identity:create',
    'base:home:create',
  ]);
  assert.deepEqual(value.configured.state, { [STATE_PATH]: 20 });
  assert.deepEqual(value.configured.stateAccess, [
    { userId: SYNTHETIC_UID, patterns: ['acceptance.*'] },
    { userId: REPLACEMENT_SYNTHETIC_UID, patterns: ['acceptance.*'] },
  ]);

  const inputs = [];
  for (const expected of SCENARIO_INPUT_ORDER) {
    inputs.push(await fixture.privateInput(
      expected.browser,
      expected.identity_generation,
    ));
  }
  assert.deepEqual(inputs.map(({ schema, browser }) => ({ schema, browser })), [
    { schema: PAGE_PRIVATE_INPUT_SCHEMA, browser: 'chromium' },
    { schema: PAGE_PRIVATE_INPUT_SCHEMA, browser: 'chromium' },
    { schema: PAGE_PRIVATE_INPUT_SCHEMA, browser: 'firefox' },
    { schema: PAGE_PRIVATE_INPUT_SCHEMA, browser: 'webkit' },
  ]);
  assert.equal(new Set(inputs.map((input) => input.firebase_custom_token)).size, 4);
  assert.deepEqual(value.calls.filter((entry) => entry.includes(':token:')), [
    'base:token:chromium:1',
    'replacement:token:chromium:2',
    'base:token:firefox:2',
    'base:token:webkit:3',
  ]);

  assert.equal(await fixture.rotateRelayToB(), true);
  assert.deepEqual(await fixture.remove(), expectedScenarioAbsence());
  const stopIndex = value.calls.indexOf('coordinator:stop:2000');
  const replacementRemovalIndex = value.calls.indexOf('replacement:remove');
  const baseRemovalIndex = value.calls.indexOf('base:remove');
  assert.ok(stopIndex >= 0 && stopIndex < replacementRemovalIndex);
  assert.ok(replacementRemovalIndex < baseRemovalIndex);
  assert.deepEqual(await fixture.verifyAbsent(), expectedScenarioAbsence());
});

test('requires independent replacement absence before the base fixture can mutate', async () => {
  const value = harness({ replacementInitiallyPresent: true });
  const fixture = createSyntheticBrowserRelayScenarioFixture(
    value.baseDependencies,
    value.replacementDependencies,
  );
  await assert.rejects(fixture.create(), /initial absence could not be proven/u);
  assert.deepEqual(value.calls, ['replacement:verify-absent']);
  await assert.rejects(fixture.remove(), /not authorized/u);
});

test('turns an unknown replacement creation outcome into cleanup without retry', async () => {
  const value = harness({ replacementCreationOutcomeUnknown: true });
  const fixture = createSyntheticBrowserRelayScenarioFixture(
    value.baseDependencies,
    value.replacementDependencies,
  );
  await assert.rejects(fixture.create(), /reviewed cleanup is required/u);
  assert.deepEqual(await fixture.remove(), expectedScenarioAbsence());
  assert.equal(value.calls.filter((entry) => entry === 'replacement:create').length, 1);
  assert.equal(value.calls.filter((entry) => entry === 'replacement:remove').length, 1);
  assert.equal(value.calls.filter((entry) => entry === 'base:remove').length, 1);
});

test('rejects input reordering and fails closed on cross-identity token reuse', async () => {
  const value = harness({ reusePrimaryToken: true });
  const fixture = createSyntheticBrowserRelayScenarioFixture(
    value.baseDependencies,
    value.replacementDependencies,
  );
  await fixture.create();
  await assert.rejects(
    fixture.privateInput('chromium', 2),
    /outside the reviewed sequence/u,
  );
  await fixture.privateInput('chromium', 1);
  await assert.rejects(
    fixture.privateInput('chromium', 2),
    /closed boundary/u,
  );
  await assert.rejects(
    fixture.privateInput('firefox', 1),
    /not ready/u,
  );
  assert.deepEqual(await fixture.remove(), expectedScenarioAbsence());
});

test('attempts the base cleanup even when replacement removal does not converge', async () => {
  const value = harness({ replacementRemovalFails: true });
  const fixture = createSyntheticBrowserRelayScenarioFixture(
    value.baseDependencies,
    value.replacementDependencies,
  );
  await fixture.create();
  await assert.rejects(fixture.remove(), /did not converge/u);
  assert.equal(value.calls.filter((entry) => entry === 'replacement:remove').length, 1);
  assert.equal(value.calls.filter((entry) => entry === 'base:remove').length, 1);
});

test('validates only closed absence and identity observations', () => {
  assert.deepEqual(validateReplacementAbsence(replacementAbsence()), replacementAbsence());
  assert.deepEqual(validateReplacementIdentity({
    schema: REPLACEMENT_IDENTITY_SCHEMA,
    state: 'created',
  }), {
    schema: REPLACEMENT_IDENTITY_SCHEMA,
    state: 'created',
  });
  assert.deepEqual(validateScenarioAbsence(expectedScenarioAbsence()), expectedScenarioAbsence());
  assert.throws(
    () => validateReplacementAbsence(replacementAbsence({ firebase_auth_users: 1 })),
    StagingBrowserRelayScenarioFixtureError,
  );
  assert.throws(
    () => rejectScenarioFixturePrivateMaterial({ token: jwt('private') }),
    /forbidden/u,
  );
  assert.throws(
    () => rejectScenarioFixturePrivateMaterial({ detail: `Bearer ${'a'.repeat(30)}` }),
    /private material/u,
  );
});

test('rejects profile drift and a symlinked package root', () => {
  const directory = mkdtempSync(join(tmpdir(), 'miakapp-scenario-fixture-'));
  const profile = join(directory, 'profile.json');
  copyFileSync(
    new URL('../browser-relay-scenario-fixture/profile.json', import.meta.url),
    profile,
  );
  const drifted = JSON.parse(readFileSync(profile, 'utf8'));
  drifted.authority.cloud_mutation_authorized = true;
  writeFileSync(profile, `${JSON.stringify(drifted, null, 2)}\n`);
  assert.throws(
    () => validateBrowserRelayScenarioFixtureProfile(profile),
    /digest has drifted/u,
  );
  const link = `${directory}-link`;
  symlinkSync(directory, link);
  assert.throws(
    () => validateBrowserRelayScenarioFixtureRoot(link),
    /real directory/u,
  );
});
