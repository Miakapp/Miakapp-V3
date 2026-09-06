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
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
  TARGET_ORIGIN,
} from '../browser-relay-page/boundary.mjs';
import {
  STATE_EXPECTATION_SCHEMA,
  STATE_PATH,
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
import {
  REPLACEMENT_SYNTHETIC_UID,
  SCENARIO_ABSENCE_SCHEMA,
} from '../browser-relay-scenario-fixture/contract.mjs';
import {
  createSyntheticBrowserRelayScenarioFixture,
} from '../browser-relay-scenario-fixture/fixture.mjs';
import {
  createGoogleBrowserRelayScenarioReplacementDependencies,
} from '../browser-relay-scenario-fixture-cloud/cloud.mjs';

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
  const coordinatorConfigurations = [];
  const coordinatorUpdates = [];
  const identityExchangeResponses = [];
  const state = {
    user: false,
    replacementUser: false,
    home: false,
    key: false,
    relay: RELAY_A_URL,
    keyUsed: false,
    foreignPublicOnly: false,
  };
  let signingCalls = 0;
  let commitCalls = 0;
  let deleteCalls = 0;
  const identities = [{
    uid: SYNTHETIC_UID,
    stateKey: 'user',
    customTokenPrefix: 'custom',
    idToken: jwt('firebase-identity'),
  }];
  if (options.scenario === true) {
    identities.push({
      uid: REPLACEMENT_SYNTHETIC_UID,
      stateKey: 'replacementUser',
      customTokenPrefix: 'replacement-custom',
      idToken: jwt('replacement-firebase-identity'),
    });
  }

  function identityForUid(uid) {
    const identity = identities.find((entry) => entry.uid === uid);
    assert.ok(identity, 'Fake transport only serves the fixed fixture identities');
    return identity;
  }

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

  function firebaseUserLookup(uid) {
    const identity = identityForUid(uid);
    const kind = 'identitytoolkit#GetAccountInfoResponse';
    if (!state[identity.stateKey]) {
      return options.omitAbsentUsers === true ? { kind } : { kind, users: [] };
    }
    return {
      kind,
      users: [{
        localId: uid,
        createdAt: '1788693600000',
        customAuth: true,
        disabled: false,
        emailVerified: false,
        lastLoginAt: '1788693600000',
        providerUserInfo: [],
      }],
    };
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
      if (options.prerequisiteFailure === 'web-config') {
        throw new Error(jwt('private-prerequisite-error'));
      }
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
      if (options.prerequisiteFailure === 'signing') {
        throw new Error(jwt('private-prerequisite-error'));
      }
      const body = JSON.parse(init.body);
      const payload = JSON.parse(body.payload);
      assert.equal(payload.iss, SIGNER_SERVICE_ACCOUNT);
      assert.equal(payload.sub, SIGNER_SERVICE_ACCOUNT);
      const identity = identityForUid(payload.uid);
      assert.equal(payload.exp - payload.iat, 3_600);
      const sequence = payload.claims.miakapp_staging_acceptance_sequence;
      assert.deepEqual(payload.claims, {
        ...(payload.uid === REPLACEMENT_SYNTHETIC_UID
          ? { miakapp_staging_acceptance_identity: 'replacement' }
          : {}),
        miakapp_staging_acceptance_sequence: sequence,
      });
      return jsonResponse({
        keyId: `key-${sequence}`,
        signedJwt: jwt(`${identity.customTokenPrefix}-${sequence}`),
      });
    }

    if (url.pathname === '/v1/accounts:signInWithCustomToken') {
      assert.equal(url.searchParams.get('key'), WEB_API_KEY);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, undefined);
      const body = JSON.parse(init.body);
      const identity = identities.find((entry) => body.token === jwt(`${entry.customTokenPrefix}-0`));
      assert.ok(identity, 'Fake exchange only accepts a fixed identity creation token');
      assert.deepEqual(body, {
        token: jwt(`${identity.customTokenPrefix}-0`),
        returnSecureToken: true,
      });
      state[identity.stateKey] = true;
      const value = {
        kind: 'identitytoolkit#VerifyCustomTokenResponse',
        idToken: identity.idToken,
        refreshToken: `refresh-${'r'.repeat(64)}`,
        expiresIn: '3600',
        isNewUser: true,
        ...options.exchangeOverrides,
      };
      identityExchangeResponses.push(value);
      return jsonResponse(value);
    }

    if (url.pathname === '/v1/accounts:lookup') {
      assert.equal(url.origin, 'https://identitytoolkit.googleapis.com');
      assert.deepEqual([...url.searchParams.keys()], ['key']);
      assert.equal(url.searchParams.get('key'), WEB_API_KEY);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, undefined);
      const body = JSON.parse(init.body);
      const identity = identities.find((entry) => entry.idToken === body.idToken);
      assert.ok(identity, 'Fake public lookup authenticates a fixed fixture identity token');
      assert.deepEqual(body, { idToken: identity.idToken });
      if (options.identityBindingFailure === 'network') {
        throw new Error(options.privateLookupError);
      }
      if (options.identityBindingFailure === 'http') {
        return jsonResponse({ error: { message: options.privateLookupError } }, 403);
      }
      return jsonResponse(Object.hasOwn(options, 'identityBindingResponse')
        ? options.identityBindingResponse
        : firebaseUserLookup(identity.uid));
    }

    if (url.href === `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`) {
      const body = JSON.parse(init.body);
      const identity = identityForUid(body.localId?.[0]);
      assert.deepEqual(body, { localId: [identity.uid] });
      return jsonResponse(firebaseUserLookup(identity.uid));
    }

    if (url.href === `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`) {
      deleteCalls += 1;
      const body = JSON.parse(init.body);
      const identity = identityForUid(body.localId);
      assert.deepEqual(body, { localId: identity.uid });
      state[identity.stateKey] = false;
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
      async set(value) {
        coordinatorCalls.push('state:set');
        coordinatorUpdates.push(value);
        return { outcome: 'applied' };
      },
    },
    configure(value) {
      coordinatorCalls.push('configure');
      coordinatorConfigurations.push(value);
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
    coordinatorConfigurations,
    coordinatorUpdates,
    identityExchangeResponses,
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

function requestCount(harness, pathname) {
  return harness.calls.filter(({ url }) => new URL(url).pathname === pathname).length;
}

function assertIdentityRequestBudget(harness, bindingReads = 1) {
  assert.equal(harness.signingCalls, 1);
  assert.equal(requestCount(harness, '/v1/accounts:signInWithCustomToken'), 1);
  assert.equal(requestCount(harness, '/v1/accounts:lookup'), bindingReads);
  assert.equal(harness.calls.filter(({ url }) => (
    new URL(url).origin === 'https://firebase.googleapis.com'
  )).length, 1);
}

async function assertCreationRemainsClosed(dependencies, harness) {
  const priorCalls = harness.calls.length;
  await assert.rejects(
    dependencies.createFirebaseIdentity({ uid: SYNTHETIC_UID }),
    /identity creation is single-use/u,
  );
  await assert.rejects(dependencies.createHome({
    firebase_id_token: jwt('firebase-identity'),
    home_id: HOME_ID,
    icon: 'house',
    name: HOME_NAME,
    relay_url: RELAY_A_URL,
  }), /Home creation is outside the reviewed sequence/u);
  await assert.rejects(dependencies.issueFirebaseCustomToken({
    browser: BROWSER_ORDER[0],
    sequence: 1,
    signal: undefined,
    uid: SYNTHETIC_UID,
  }), /custom-token issuance is outside the reviewed sequence/u);
  assert.equal(harness.calls.length, priorCalls);
  assert.equal(harness.state.home, false);
  assert.equal(harness.state.key, false);
  assert.equal(harness.calls.some(({ url }) => url.startsWith(CONTROL_PLANE_ORIGIN)), false);
}

test('pins one dormant Google/Firebase fixture adapter without live authority', () => {
  const profile = validateBrowserRelayFixtureCloudProfile();
  assert.equal(profile.state,
    'closed_google_firebase_adapter_implemented_not_wired_not_executed');
  assert.equal(profile.target.home_id, HOME_ID);
  assert.equal(profile.request_budget.maximum_signed_firebase_jwts, 4);
  assert.equal(profile.request_budget.firebase_identity_binding_reads, 1);
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

test('accepts omitted users during an absent Firebase inventory', async () => {
  const harness = fixtureCloudHarness({ omitAbsentUsers: true });
  const dependencies = createDependencies(harness);
  assert.equal((await dependencies.verifyFixtureAbsent()).firebase_auth_users, 0);
  assert.equal(harness.signingCalls, 0);
  assert.equal(requestCount(harness, '/v1/accounts:lookup'), 0);
});

test('accepts the optional matching exchange UID only after an authenticated identity lookup', async () => {
  const harness = fixtureCloudHarness({ exchangeOverrides: { localId: SYNTHETIC_UID } });
  const fixture = createSyntheticBrowserRelayFixture(createDependencies(harness));
  assert.equal(await fixture.create(), true);
  assertIdentityRequestBudget(harness);
  assert.equal(await fixture.remove(), true);
  assert.equal(harness.deleteCalls, 1);
});

test('rejects a caller-selected UID before signing or exchanging a custom token', async () => {
  const harness = fixtureCloudHarness();
  const dependencies = createDependencies(harness);
  await dependencies.verifyFixtureAbsent();
  const priorCalls = harness.calls.length;
  await assert.rejects(
    dependencies.createFirebaseIdentity({ uid: 'not-the-synthetic-uid' }),
    /create_firebase_identity\.uid has drifted/u,
  );
  assert.equal(harness.calls.length, priorCalls);
  assert.equal(harness.signingCalls, 0);
});

test('does not gain cleanup authority from a failed creation prerequisite before exchange dispatch', async () => {
  for (const prerequisiteFailure of ['web-config', 'signing']) {
    for (const userAppears of [true, false]) {
      const harness = fixtureCloudHarness({ prerequisiteFailure });
      const dependencies = createDependencies(harness);
      await dependencies.verifyFixtureAbsent();
      await assert.rejects(
        dependencies.createFirebaseIdentity({ uid: SYNTHETIC_UID }),
        (error) => error instanceof StagingBrowserRelayFixtureCloudError
          && /operation must not be retried/u.test(error.message)
          && !error.message.includes(jwt('private-prerequisite-error')),
      );
      await assertCreationRemainsClosed(dependencies, harness);
      assert.equal(requestCount(harness, '/v1/accounts:signInWithCustomToken'), 0);
      assert.equal(requestCount(harness, '/v1/accounts:lookup'), 0);
      assert.equal(harness.signingCalls, 1);

      harness.state.user = userAppears;
      const cleanup = dependencies.removeFixture({
        uid: SYNTHETIC_UID,
        firebase_id_token: undefined,
        home_id: HOME_ID,
        home_key_id: undefined,
      });
      if (userAppears) {
        await assert.rejects(cleanup, /without a dispatched creation exchange/u);
      } else {
        assert.equal(await cleanup, true);
      }
      assert.equal(harness.state.user, userAppears);
      assert.equal(harness.deleteCalls, 0);
      assert.equal(harness.commitCalls, 0);
      assert.equal(requestCount(harness, '/v1/accounts:signInWithCustomToken'), 0);
      assert.equal(requestCount(harness, '/v1/accounts:lookup'), 0);
      assert.equal(harness.signingCalls, 1);
    }
  }
});

for (const [name, exchangeOverrides] of [
  ['mismatched optional UID', { localId: 'not-the-synthetic-uid' }],
  ['null optional UID', { localId: null }],
  ['malformed ID token', { idToken: 'not-a-jwt' }],
]) {
  test(`rejects an exchange with ${name} without a binding lookup or further mutation`, async () => {
    const harness = fixtureCloudHarness({ exchangeOverrides });
    const dependencies = createDependencies(harness);
    const fixture = createSyntheticBrowserRelayFixture(dependencies);
    await assert.rejects(fixture.create(), /reviewed cleanup is required/u);
    await assertCreationRemainsClosed(dependencies, harness);
    assertIdentityRequestBudget(harness, 0);
    assert.equal(await fixture.remove(), true);
    assert.equal(harness.deleteCalls, 1);
    assert.equal(harness.commitCalls, 0);
    assertIdentityRequestBudget(harness, 0);
  });
}

for (const [name, identityBindingResponse] of [
  ['a different UID', { users: [{ localId: 'not-the-synthetic-uid' }] }],
  ['a missing UID', { users: [{}] }],
  ['an omitted user list', {}],
  ['an empty user list', { users: [] }],
  ['more than one user', { users: [{ localId: SYNTHETIC_UID }, { localId: SYNTHETIC_UID }] }],
  ['a null response', null],
  ['a non-synthetic profile', { users: [{ localId: SYNTHETIC_UID, email: 'fixture@example.invalid' }] }],
  ['a disabled profile', { users: [{ localId: SYNTHETIC_UID, disabled: true }] }],
  ['a linked provider', { users: [{ localId: SYNTHETIC_UID, providerUserInfo: [{}] }] }],
]) {
  test(`refuses Home creation when authenticated lookup returns ${name}`, async () => {
    const harness = fixtureCloudHarness({ identityBindingResponse });
    const dependencies = createDependencies(harness);
    const fixture = createSyntheticBrowserRelayFixture(dependencies);
    await assert.rejects(fixture.create(), /reviewed cleanup is required/u);
    await assertCreationRemainsClosed(dependencies, harness);
    assertIdentityRequestBudget(harness);
    assert.equal(await fixture.remove(), true);
    assert.equal(harness.deleteCalls, 1);
    assert.equal(harness.commitCalls, 0);
    assertIdentityRequestBudget(harness);
  });
}

for (const identityBindingFailure of ['network', 'http']) {
  test(`sanitizes ${identityBindingFailure} identity lookup failure and permits bounded cleanup`, async () => {
    const privateLookupError = `Bearer ${jwt('private-lookup-error')}`;
    const harness = fixtureCloudHarness({ identityBindingFailure, privateLookupError });
    const dependencies = createDependencies(harness);
    await dependencies.verifyFixtureAbsent();
    await assert.rejects(
      dependencies.createFirebaseIdentity({ uid: SYNTHETIC_UID }),
      (error) => error instanceof StagingBrowserRelayFixtureCloudError
        && /Firebase identity token lookup/u.test(error.message)
        && !error.message.includes(privateLookupError)
        && !error.message.includes(jwt('firebase-identity'))
        && !error.message.includes(WEB_API_KEY)
        && !error.message.includes(OPERATOR_TOKEN),
    );
    await assertCreationRemainsClosed(dependencies, harness);
    assertIdentityRequestBudget(harness);
    assert.equal(await dependencies.removeFixture({
      uid: SYNTHETIC_UID,
      firebase_id_token: undefined,
      home_id: HOME_ID,
      home_key_id: undefined,
    }), true);
    assert.equal(harness.state.user, false);
    assert.equal(harness.deleteCalls, 1);
    assert.equal(harness.commitCalls, 0);
    assertIdentityRequestBudget(harness);
  });
}

test('refuses creation and cleanup mutation when exchange reports a preexisting identity', async () => {
  const harness = fixtureCloudHarness({ exchangeOverrides: { isNewUser: false } });
  const dependencies = createDependencies(harness);
  const fixture = createSyntheticBrowserRelayFixture(dependencies);
  await assert.rejects(fixture.create(), /reviewed cleanup is required/u);
  await assertCreationRemainsClosed(dependencies, harness);
  assertIdentityRequestBudget(harness, 0);
  await assert.rejects(dependencies.removeFixture({
    uid: SYNTHETIC_UID,
    firebase_id_token: undefined,
    home_id: HOME_ID,
    home_key_id: undefined,
  }), /identity reported as preexisting/u);
  assert.equal(harness.deleteCalls, 0);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.state.user, true);
  assertIdentityRequestBudget(harness, 0);
});

test('drives the closed fixture lifecycle and converges every cloud domain to absence', async () => {
  const harness = fixtureCloudHarness();
  const fixture = createSyntheticBrowserRelayFixture(createDependencies(harness));
  assert.equal(await fixture.create(), true);
  assertIdentityRequestBudget(harness);
  const exchangeIndex = harness.calls.findIndex(({ url }) => (
    new URL(url).pathname === '/v1/accounts:signInWithCustomToken'
  ));
  const bindingIndex = harness.calls.findIndex(({ url }) => (
    new URL(url).pathname === '/v1/accounts:lookup'
  ));
  const homeIndex = harness.calls.findIndex(({ url }) => url === `${CONTROL_PLANE_ORIGIN}/v1/homes`);
  assert.ok(exchangeIndex < bindingIndex && bindingIndex < homeIndex);
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
  assert.equal(requestCount(harness, '/v1/accounts:signInWithCustomToken'), 1);
  assert.equal(requestCount(harness, '/v1/accounts:lookup'), 1);
  assert.equal(harness.state.user, false);
  assert.equal(harness.state.home, false);
  assert.equal(harness.state.key, false);
  assert.deepEqual(harness.coordinatorCalls, ['configure', 'start', 'stop']);
  assert.equal(harness.calls.some(({ init }) => init.credentials !== 'omit'), false);
});

test('composes the real scenario controller and both Google adapters through an offline two-identity lifecycle', async () => {
  const harness = fixtureCloudHarness({ scenario: true });
  const session = { accessToken: OPERATOR_TOKEN };
  const baseDependencies = createGoogleBrowserRelayFixtureDependencies(
    session,
    harness.implementations,
  );
  const replacementDependencies = createGoogleBrowserRelayScenarioReplacementDependencies(
    session,
    { clock: harness.implementations.clock, fetch: harness.implementations.fetch },
  );
  const fixture = createSyntheticBrowserRelayScenarioFixture(
    baseDependencies,
    replacementDependencies,
  );
  assert.equal(harness.calls.length, 0);
  const closedOutputs = { created: await fixture.create() };
  assert.equal(closedOutputs.created, true);
  assert.equal(harness.state.user, true);
  assert.equal(harness.state.replacementUser, true);
  assert.equal(harness.coordinatorConfigurations.length, 1);
  assert.deepEqual(harness.coordinatorConfigurations[0].stateAccess, [
    { userId: SYNTHETIC_UID, patterns: ['acceptance.*'] },
    { userId: REPLACEMENT_SYNTHETIC_UID, patterns: ['acceptance.*'] },
  ]);
  closedOutputs.initialState = fixture.stateExpectation();
  assert.deepEqual(closedOutputs.initialState, {
    schema: STATE_EXPECTATION_SCHEMA,
    path: STATE_PATH,
    revision: 1,
    value: 20,
  });

  const privateInputs = [];
  for (const [browser, generation, marker] of [
    ['chromium', 1, 'custom-1'],
    ['chromium', 2, 'replacement-custom-2'],
    ['firefox', 1, 'custom-2'],
    ['webkit', 1, 'custom-3'],
  ]) {
    const input = await fixture.privateInput(browser, generation);
    assert.deepEqual(input, {
      schema: PAGE_PRIVATE_INPUT_SCHEMA,
      browser,
      firebase_custom_token: jwt(marker),
    });
    privateInputs.push(input);
  }
  assert.equal(new Set(privateInputs.map((value) => value.firebase_custom_token)).size, 4);
  closedOutputs.updatedState = await fixture.setTemperature(21);
  assert.deepEqual(closedOutputs.updatedState, {
    schema: STATE_EXPECTATION_SCHEMA,
    path: STATE_PATH,
    revision: 2,
    value: 21,
  });
  assert.deepEqual(harness.coordinatorUpdates, [[{ path: STATE_PATH, value: 21 }]]);
  harness.state.keyUsed = true;
  closedOutputs.rotated = await fixture.rotateRelayToB();
  assert.equal(closedOutputs.rotated, true);
  assert.equal(harness.state.relay, RELAY_B_URL);
  closedOutputs.stopped = await fixture.stop();
  assert.equal(closedOutputs.stopped, true);
  closedOutputs.removed = await fixture.remove();
  const expectedAbsence = {
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
  assert.deepEqual(closedOutputs.removed, expectedAbsence);

  const finalObservationStart = harness.calls.length;
  closedOutputs.absence = await fixture.verifyAbsent();
  assert.deepEqual(closedOutputs.absence, expectedAbsence);
  const finalObservation = harness.calls.slice(finalObservationStart);
  assert.equal(finalObservation.length, 7);
  assert.deepEqual(finalObservation.filter(({ url }) => (
    new URL(url).pathname === `/v1/projects/${PROJECT_ID}/accounts:lookup`
  )).map(({ init }) => JSON.parse(init.body).localId), [
    [SYNTHETIC_UID],
    [REPLACEMENT_SYNTHETIC_UID],
  ]);
  assert.equal(harness.state.user, false);
  assert.equal(harness.state.replacementUser, false);
  assert.equal(harness.state.home, false);
  assert.equal(harness.state.key, false);
  assert.deepEqual(harness.coordinatorCalls, ['configure', 'start', 'state:set', 'stop']);

  const signedPayloads = harness.calls.filter(({ url }) => (
    new URL(url).origin === 'https://iamcredentials.googleapis.com'
  )).map(({ init }) => JSON.parse(JSON.parse(init.body).payload));
  assert.deepEqual(signedPayloads.map(({ uid, claims }) => (
    [uid, claims.miakapp_staging_acceptance_sequence]
  )), [
    [SYNTHETIC_UID, 0],
    [REPLACEMENT_SYNTHETIC_UID, 0],
    [SYNTHETIC_UID, 1],
    [REPLACEMENT_SYNTHETIC_UID, 2],
    [SYNTHETIC_UID, 2],
    [SYNTHETIC_UID, 3],
  ]);
  assert.equal(harness.signingCalls, 6);
  assert.equal(requestCount(harness, '/v1/accounts:signInWithCustomToken'), 2);
  assert.equal(requestCount(harness, '/v1/accounts:lookup'), 2);
  assert.equal(harness.identityExchangeResponses.length, 2);
  assert.deepEqual(harness.identityExchangeResponses.map(({ idToken }) => idToken), [
    jwt('firebase-identity'),
    jwt('replacement-firebase-identity'),
  ]);
  for (const response of harness.identityExchangeResponses) {
    assert.deepEqual(Object.keys(response).sort(), [
      'expiresIn', 'idToken', 'isNewUser', 'kind', 'refreshToken',
    ]);
  }
  assert.equal(harness.deleteCalls, 2);
  assert.deepEqual(harness.calls.filter(({ url }) => (
    new URL(url).pathname === `/v1/projects/${PROJECT_ID}/accounts:delete`
  )).map(({ init }) => JSON.parse(init.body)), [
    { localId: REPLACEMENT_SYNTHETIC_UID },
    { localId: SYNTHETIC_UID },
  ]);
  assert.equal(harness.commitCalls, 1);
  const commits = harness.calls.filter(({ url }) => new URL(url).pathname.endsWith('documents:commit'));
  assert.equal(commits.length, 1);
  assert.equal(JSON.parse(commits[0].init.body).writes.length, 5);

  const serializedClosedOutputs = JSON.stringify(closedOutputs);
  for (const privateMaterial of [
    OPERATOR_TOKEN,
    WEB_API_KEY,
    HOME_KEY,
    jwt('custom-0'),
    jwt('replacement-custom-0'),
    ...privateInputs.map(({ firebase_custom_token }) => firebase_custom_token),
    ...harness.identityExchangeResponses.flatMap(({ idToken, refreshToken }) => [idToken, refreshToken]),
  ]) {
    assert.equal(serializedClosedOutputs.includes(privateMaterial), false);
  }
  assert.doesNotMatch(serializedClosedOutputs, /firebase_custom_token|firebase_id_token|idToken|refreshToken|accessToken/u);
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
