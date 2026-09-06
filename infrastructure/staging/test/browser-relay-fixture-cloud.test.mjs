import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_ORDER,
  CONTROL_PLANE_ORIGIN,
  HOME_ID,
  RELAY_A_URL,
  RELAY_B_URL,
  TARGET_ORIGIN,
} from '../browser-relay-page/boundary.mjs';
import {
  SYNTHETIC_UID,
} from '../browser-relay-fixture/contract.mjs';
import { createSyntheticBrowserRelayFixture } from '../browser-relay-fixture/fixture.mjs';
import {
  FIXTURE_CLOUD_PROFILE_SHA256,
  FIXTURE_CLOUD_SOURCE_SHA256,
  validateBrowserRelayFixtureCloudProfile,
} from '../browser-relay-fixture-cloud/contract.mjs';
import {
  SIGNER_SERVICE_ACCOUNT,
  StagingBrowserRelayFixtureCloudError,
  createGoogleBrowserRelayFixtureDependencies,
} from '../browser-relay-fixture-cloud/cloud.mjs';
import {
  validateBrowserRelayFixtureCloudRoot,
} from '../browser-relay-fixture-cloud/guard.mjs';

const PROJECT_ID = 'miakapp-v4-staging';
const PROJECT_NUMBER = '1072737219170';
const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
const DOCUMENT_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const FIRESTORE_PREFIX = `https://firestore.googleapis.com/v1/${DOCUMENT_ROOT}`;
const KEY_ID = Buffer.alloc(16, 1).toString('base64url');
const ISSUANCE_ID = Buffer.alloc(16, 2).toString('base64url');
const VERIFIER = Buffer.alloc(32, 3).toString('base64url');
const HOME_KEY = `mhk1_${KEY_ID}_${VERIFIER}`;
const CREATED_AT = '2026-09-06T11:20:00.000000Z';
const UPDATED_AT = '2026-09-06T11:20:01.000000Z';
const OPERATOR_TOKEN = `operator-${'o'.repeat(64)}`;
const WEB_API_KEY = `${'AI'}${'za'}${'A'.repeat(35)}`;
const HOME_NAME = 'Miakapp V4 staging browser relay';
const HOME_KEY_LABEL = 'Browser relay acceptance coordinator';

function jwt(marker) {
  const normalized = marker.replaceAll(/[^A-Za-z0-9_-]/gu, 'x');
  return `${'h'.repeat(24)}.${normalized.padEnd(32, 'p')}.${'s'.repeat(32)}`;
}

function stringValue(value) {
  return { stringValue: value };
}

function integerValue(value) {
  return { integerValue: String(value) };
}

function timestampValue(value) {
  return { timestampValue: value };
}

function nullValue() {
  return { nullValue: null };
}

function arrayValue(values) {
  return { arrayValue: { values: values.map(stringValue) } };
}

function document(path, fields, updateTime = UPDATED_AT) {
  return {
    name: `${DOCUMENT_ROOT}/${path}`,
    fields,
    createTime: CREATED_AT,
    updateTime,
  };
}

function controlHeaders(overrides = {}) {
  return {
    'Access-Control-Allow-Credentials': 'false',
    'Access-Control-Allow-Origin': TARGET_ORIGIN,
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Pragma: 'no-cache',
    ...overrides,
  };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function fixtureCloudHarness(options = {}) {
  const calls = [];
  const coordinatorCalls = [];
  const state = {
    user: false,
    home: false,
    key: false,
    relay: RELAY_A_URL,
    keyUsed: false,
    foreignPublicOnly: false,
  };
  let signingCalls = 0;
  let commitCalls = 0;
  let deleteCalls = 0;

  function publicHome() {
    if (!state.home && !state.foreignPublicOnly) return null;
    return document(`homes/${HOME_ID}`, {
      schema: stringValue('miakapp.home/1'),
      home_id: stringValue(HOME_ID),
      name: stringValue(state.foreignPublicOnly ? 'Foreign record' : HOME_NAME),
      icon: stringValue('house'),
      relay_url: stringValue(state.relay),
      created_at: timestampValue(CREATED_AT),
      updated_at: timestampValue(UPDATED_AT),
    });
  }

  function privateHome() {
    if (!state.home) return null;
    return document(`controlHomes/${HOME_ID}`, {
      schema: stringValue('miakapp.control-home/1'),
      home_id: stringValue(HOME_ID),
      owner_uid: stringValue(SYNTHETIC_UID),
      relay_url: stringValue(state.relay),
      active_key_count: integerValue(state.key ? 1 : 0),
      retained_key_count: integerValue(state.key ? 1 : 0),
      created_at: timestampValue(CREATED_AT),
      updated_at: timestampValue(UPDATED_AT),
    });
  }

  function owner() {
    if (!state.home) return null;
    return document(`controlOwners/${SYNTHETIC_UID}`, {
      schema: stringValue('miakapp.control-owner/1'),
      owner_uid: stringValue(SYNTHETIC_UID),
      owned_home_count: integerValue(1),
      updated_at: timestampValue(UPDATED_AT),
    });
  }

  function keyRecord() {
    if (!state.key) return null;
    return document(`controlHomes/${HOME_ID}/homeKeys/${KEY_ID}`, {
      schema: stringValue('miakapp.home-key-record/1'),
      key_id: stringValue(KEY_ID),
      home_id: stringValue(HOME_ID),
      verifier: stringValue(VERIFIER),
      verifier_key_version: stringValue('v1'),
      label: stringValue(HOME_KEY_LABEL),
      scopes: arrayValue(['relay:coordinator']),
      status: stringValue('active'),
      created_at: timestampValue(CREATED_AT),
      created_by: stringValue(SYNTHETIC_UID),
      revoked_at: nullValue(),
      last_used_at: state.keyUsed ? timestampValue(UPDATED_AT) : nullValue(),
      last_issuance_id: state.keyUsed ? stringValue(ISSUANCE_ID) : nullValue(),
    });
  }

  function keyIndex() {
    if (!state.key) return null;
    return document(`homeKeyIndex/${KEY_ID}`, {
      schema: stringValue('miakapp.home-key-index/1'),
      key_id: stringValue(KEY_ID),
      home_id: stringValue(HOME_ID),
      status: stringValue('active'),
      created_at: timestampValue(CREATED_AT),
    });
  }

  function currentDocument(name) {
    const values = [publicHome(), privateHome(), owner(), keyRecord(), keyIndex()];
    return values.find((value) => value?.name === name) ?? null;
  }

  async function fetchImplementation(input, init) {
    const url = new URL(String(input));
    calls.push({ url: url.href, init });
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.ok(init.signal instanceof AbortSignal);

    if (url.href.startsWith('https://firebase.googleapis.com/v1beta1/projects/-/webApps/')) {
      return jsonResponse({
        projectId: PROJECT_ID,
        appId: FIREBASE_APP_ID,
        authDomain: `${PROJECT_ID}.firebaseapp.com`,
        storageBucket: `${PROJECT_ID}.firebasestorage.app`,
        messagingSenderId: PROJECT_NUMBER,
        apiKey: WEB_API_KEY,
      });
    }

    if (url.href.startsWith('https://iamcredentials.googleapis.com/')) {
      signingCalls += 1;
      const body = JSON.parse(init.body);
      const payload = JSON.parse(body.payload);
      assert.equal(payload.iss, SIGNER_SERVICE_ACCOUNT);
      assert.equal(payload.sub, SIGNER_SERVICE_ACCOUNT);
      assert.equal(payload.uid, SYNTHETIC_UID);
      assert.equal(payload.exp - payload.iat, 3_600);
      const sequence = payload.claims.miakapp_staging_acceptance_sequence;
      return jsonResponse({ keyId: `key-${sequence}`, signedJwt: jwt(`custom-${sequence}`) });
    }

    if (url.pathname === '/v1/accounts:signInWithCustomToken') {
      assert.equal(url.searchParams.get('key'), WEB_API_KEY);
      const body = JSON.parse(init.body);
      assert.equal(body.token, jwt('custom-0'));
      assert.equal(body.returnSecureToken, true);
      state.user = true;
      return jsonResponse({
        kind: 'identitytoolkit#VerifyCustomTokenResponse',
        idToken: jwt('firebase-identity'),
        refreshToken: `refresh-${'r'.repeat(64)}`,
        expiresIn: '3600',
        isNewUser: true,
        localId: SYNTHETIC_UID,
      });
    }

    if (url.href === `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`) {
      assert.deepEqual(JSON.parse(init.body), { localId: [SYNTHETIC_UID] });
      return jsonResponse(state.user
        ? {
          kind: 'identitytoolkit#GetAccountInfoResponse',
          users: [{
            localId: SYNTHETIC_UID,
            createdAt: '1788693600000',
            customAuth: true,
            disabled: false,
            emailVerified: false,
            lastLoginAt: '1788693600000',
            providerUserInfo: [],
          }],
        }
        : { kind: 'identitytoolkit#GetAccountInfoResponse' });
    }

    if (url.href === `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`) {
      deleteCalls += 1;
      assert.deepEqual(JSON.parse(init.body), { localId: SYNTHETIC_UID });
      state.user = false;
      if (options.ambiguousDelete === true) throw new Error(`Bearer ${'private'.repeat(12)}`);
      return jsonResponse({});
    }

    if (url.href === `${CONTROL_PLANE_ORIGIN}/v1/homes`) {
      assert.equal(init.headers.Origin, TARGET_ORIGIN);
      assert.equal(init.headers.Authorization, `Bearer ${jwt('firebase-identity')}`);
      assert.deepEqual(JSON.parse(init.body), {
        home_id: HOME_ID,
        name: HOME_NAME,
        icon: 'house',
        relay_url: RELAY_A_URL,
      });
      state.home = true;
      return jsonResponse({
        schema: 'miakapp.home/1',
        home: {
          home_id: HOME_ID,
          name: HOME_NAME,
          icon: 'house',
          relay_url: RELAY_A_URL,
          created_at: CREATED_AT,
          updated_at: UPDATED_AT,
        },
      }, 201, controlHeaders(options.controlHeaderOverrides));
    }

    if (url.href === `${CONTROL_PLANE_ORIGIN}/v1/homes/${HOME_ID}/home-keys`) {
      assert.deepEqual(JSON.parse(init.body), {
        label: HOME_KEY_LABEL,
        scopes: ['relay:coordinator'],
      });
      state.key = true;
      return jsonResponse({
        schema: 'miakapp.home-key-created/1',
        key: {
          key_id: KEY_ID,
          label: HOME_KEY_LABEL,
          scopes: ['relay:coordinator'],
          created_at: CREATED_AT,
          revoked_at: null,
          last_used_at: null,
        },
        home_key: HOME_KEY,
      }, 201, controlHeaders());
    }

    if (url.href === `${CONTROL_PLANE_ORIGIN}/v1/homes/${HOME_ID}`) {
      assert.deepEqual(JSON.parse(init.body), { relay_url: RELAY_B_URL });
      state.relay = RELAY_B_URL;
      return jsonResponse({
        schema: 'miakapp.home/1',
        home: {
          home_id: HOME_ID,
          name: HOME_NAME,
          icon: 'house',
          relay_url: RELAY_B_URL,
          created_at: CREATED_AT,
          updated_at: UPDATED_AT,
        },
      }, 200, controlHeaders());
    }

    if (url.href === 'https://firestore.googleapis.com/v1/projects/miakapp-v4-staging/databases/(default)/documents:runQuery') {
      const body = JSON.parse(init.body);
      assert.equal(body.structuredQuery.where.fieldFilter.value.stringValue, HOME_ID);
      const index = keyIndex();
      return jsonResponse(index === null ? [{ readTime: UPDATED_AT }] : [{
        document: index,
        readTime: UPDATED_AT,
      }]);
    }

    if (url.href === 'https://firestore.googleapis.com/v1/projects/miakapp-v4-staging/databases/(default)/documents:commit') {
      commitCalls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.writes.length, state.key ? 5 : 3);
      for (const write of body.writes) {
        const current = currentDocument(write.delete);
        assert.ok(current);
        assert.equal(write.currentDocument.updateTime, current.updateTime);
      }
      const count = body.writes.length;
      state.home = false;
      state.key = false;
      if (options.ambiguousCommit === true) throw new Error(jwt('private-commit-error'));
      return jsonResponse({
        writeResults: Array.from({ length: count }, () => ({ updateTime: UPDATED_AT })),
        commitTime: UPDATED_AT,
      });
    }

    if (url.pathname.endsWith(`/controlHomes/${HOME_ID}/homeKeys`)) {
      assert.equal(url.searchParams.get('pageSize'), '2');
      const key = keyRecord();
      return jsonResponse(key === null ? {} : { documents: [key] });
    }

    if (url.href.startsWith(`${FIRESTORE_PREFIX}/`)) {
      const path = decodeURIComponent(url.href.slice(`${FIRESTORE_PREFIX}/`.length));
      const value = {
        [`homes/${HOME_ID}`]: publicHome(),
        [`controlHomes/${HOME_ID}`]: privateHome(),
        [`controlOwners/${SYNTHETIC_UID}`]: owner(),
      }[path];
      return value === null || value === undefined
        ? jsonResponse({ error: { code: 404, status: 'NOT_FOUND' } }, 404)
        : jsonResponse(value);
    }

    throw new Error(`Unexpected fake request: ${url.href}`);
  }

  const provider = { async getAccessToken() {} };
  const coordinator = {
    state: {
      async set() {
        coordinatorCalls.push('state:set');
        return { outcome: 'applied' };
      },
    },
    configure() {
      coordinatorCalls.push('configure');
    },
    async start() {
      coordinatorCalls.push('start');
      if (options.startFailure === true) throw new Error(jwt('private-start-error'));
      return { sessionId: 1, generation: 1, connectedAtMs: 1_788_693_600_000 };
    },
    async stop() {
      coordinatorCalls.push('stop');
    },
  };
  const implementations = {
    clock: () => 1_788_693_600_000,
    createCoordinator: () => coordinator,
    createHomeKeyAccessTokenProvider: (input) => {
      assert.equal(input.homeKey, HOME_KEY);
      return provider;
    },
    fetch: fetchImplementation,
  };
  return {
    calls,
    coordinatorCalls,
    implementations,
    state,
    get signingCalls() { return signingCalls; },
    get commitCalls() { return commitCalls; },
    get deleteCalls() { return deleteCalls; },
  };
}

function createDependencies(harness) {
  return createGoogleBrowserRelayFixtureDependencies(
    { accessToken: OPERATOR_TOKEN },
    harness.implementations,
  );
}

test('pins one dormant Google/Firebase fixture adapter without live authority', () => {
  const profile = validateBrowserRelayFixtureCloudProfile();
  assert.equal(profile.state,
    'closed_google_firebase_adapter_implemented_not_wired_not_executed');
  assert.equal(profile.target.home_id, HOME_ID);
  assert.equal(profile.request_budget.maximum_signed_firebase_jwts, 4);
  assert.equal(profile.cleanup.firestore_update_time_preconditions, true);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(profile.evidence.live_http_requests, 0);
  assert.match(FIXTURE_CLOUD_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(FIXTURE_CLOUD_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
});

test('constructs without I/O and rejects mutation before observed initial absence', async () => {
  const harness = fixtureCloudHarness();
  const dependencies = createDependencies(harness);
  assert.equal(harness.calls.length, 0);
  await assert.rejects(
    dependencies.createFirebaseIdentity({ uid: SYNTHETIC_UID }),
    (error) => error instanceof StagingBrowserRelayFixtureCloudError
      && error.message === 'Cloud mutation requires a proven initial absence boundary',
  );
  assert.equal(harness.calls.length, 0);
});

test('drives the closed fixture lifecycle and converges every cloud domain to absence', async () => {
  const harness = fixtureCloudHarness();
  const fixture = createSyntheticBrowserRelayFixture(createDependencies(harness));
  assert.equal(await fixture.create(), true);
  const privateInputs = [];
  for (const browser of BROWSER_ORDER) {
    privateInputs.push(await fixture.privateInput(browser));
  }
  assert.equal(new Set(privateInputs.map((value) => value.firebase_custom_token)).size, 3);
  harness.state.keyUsed = true;
  assert.equal(await fixture.rotateRelayToB(), true);
  assert.equal(await fixture.stop(), true);
  assert.equal(await fixture.remove(), true);
  assert.deepEqual(await fixture.verifyAbsent(), {
    schema: 'miakapp.staging-browser-relay-fixture-absence/1',
    state: 'absent',
    firebase_auth_users: 0,
    public_homes: 0,
    private_homes: 0,
    home_key_records: 0,
    home_key_indexes: 0,
    control_owners: 0,
    active_coordinator_sessions: 0,
  });
  assert.equal(harness.signingCalls, 4);
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.deleteCalls, 1);
  assert.equal(harness.state.user, false);
  assert.equal(harness.state.home, false);
  assert.equal(harness.state.key, false);
  assert.deepEqual(harness.coordinatorCalls, ['configure', 'start', 'stop']);
  assert.equal(harness.calls.some(({ init }) => init.credentials !== 'omit'), false);
});

test('observes ambiguous cleanup success without retrying either mutation', async () => {
  const harness = fixtureCloudHarness({ ambiguousCommit: true, ambiguousDelete: true });
  const fixture = createSyntheticBrowserRelayFixture(createDependencies(harness));
  await fixture.create();
  await fixture.stop();
  assert.equal(await fixture.remove(), true);
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.deleteCalls, 1);
  assert.equal(harness.state.user, false);
  assert.equal(harness.state.home, false);
});

test('refuses a preexisting fixture and performs no cloud mutation', async () => {
  const harness = fixtureCloudHarness();
  harness.state.home = true;
  harness.state.user = true;
  const fixture = createSyntheticBrowserRelayFixture(createDependencies(harness));
  await assert.rejects(fixture.create(), /initial absence could not be proven/u);
  assert.equal(harness.signingCalls, 0);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.deleteCalls, 0);
});

test('refuses a post-authorization foreign ownership cluster before delete', async () => {
  const harness = fixtureCloudHarness();
  const dependencies = createDependencies(harness);
  const initial = await dependencies.verifyFixtureAbsent();
  assert.equal(initial.public_homes, 0);
  harness.state.foreignPublicOnly = true;
  await assert.rejects(
    dependencies.removeFixture({
      uid: SYNTHETIC_UID,
      firebase_id_token: undefined,
      home_id: HOME_ID,
      home_key_id: undefined,
    }),
    /cleanup\.public_home\.name has drifted/u,
  );
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.deleteCalls, 0);
});

test('tracks a failed coordinator start conservatively until stop succeeds', async () => {
  const harness = fixtureCloudHarness({ startFailure: true });
  const fixture = createSyntheticBrowserRelayFixture(createDependencies(harness));
  await assert.rejects(fixture.create(), /reviewed cleanup is required/u);
  assert.equal(await fixture.remove(), true);
  assert.deepEqual(harness.coordinatorCalls, ['configure', 'start', 'stop']);
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.deleteCalls, 1);
});

test('collapses public-edge header drift and still permits reviewed cleanup', async () => {
  const privateValue = `Bearer ${'secret'.repeat(12)}`;
  const harness = fixtureCloudHarness({
    controlHeaderOverrides: { 'Cache-Control': `private, ${privateValue}` },
  });
  const fixture = createSyntheticBrowserRelayFixture(createDependencies(harness));
  await assert.rejects(
    fixture.create(),
    (error) => !error.message.includes(privateValue)
      && /reviewed cleanup is required/u.test(error.message),
  );
  assert.equal(await fixture.remove(), true);
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.deleteCalls, 1);
});

test('guards the exact dormant cloud-adapter package inventory', () => {
  const root = new URL('../browser-relay-fixture-cloud/', import.meta.url);
  assert.doesNotThrow(() => validateBrowserRelayFixtureCloudRoot(root));
  const sourceRoot = root.pathname;
  const executableRoot = mkdtempSync(join(tmpdir(), 'miakapp-fixture-cloud-exec-'));
  for (const file of ['README.md', 'cloud.mjs', 'contract.mjs', 'guard.mjs', 'profile.json']) {
    copyFileSync(join(sourceRoot, file), join(executableRoot, file));
  }
  chmodSync(join(executableRoot, 'cloud.mjs'), 0o755);
  assert.throws(
    () => validateBrowserRelayFixtureCloudRoot(new URL(`file://${executableRoot}/`)),
    /must not be executable/u,
  );
});
