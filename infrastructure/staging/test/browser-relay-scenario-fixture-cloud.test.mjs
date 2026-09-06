import assert from 'node:assert/strict';
import {
  chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FIREBASE_APP_ID } from '../browser-app-check/contract.mjs';
import { PROJECT_ID, PROJECT_NUMBER } from '../browser-relay-fixture/contract.mjs';
import { SIGNER_SERVICE_ACCOUNT } from '../browser-relay-fixture-cloud/cloud.mjs';
import {
  REPLACEMENT_ABSENCE_SCHEMA, REPLACEMENT_IDENTITY_SCHEMA, REPLACEMENT_SYNTHETIC_UID,
} from '../browser-relay-scenario-fixture/contract.mjs';
import {
  SCENARIO_FIXTURE_CLOUD_PROFILE_SHA256,
  SCENARIO_FIXTURE_CLOUD_SOURCE_SHA256,
  StagingBrowserRelayScenarioFixtureCloudError,
  validateBrowserRelayScenarioFixtureCloudProfile,
} from '../browser-relay-scenario-fixture-cloud/contract.mjs';
import {
  createGoogleBrowserRelayScenarioReplacementDependencies,
} from '../browser-relay-scenario-fixture-cloud/cloud.mjs';
import {
  validateBrowserRelayScenarioFixtureCloudRoot,
} from '../browser-relay-scenario-fixture-cloud/guard.mjs';

const UID_INPUT = Object.freeze({ uid: REPLACEMENT_SYNTHETIC_UID });
const START = 1_788_700_000_000;
const WINDOW = 20 * 60 * 1_000;
const OPERATOR_TOKEN = `operator-${'o'.repeat(64)}`;
const WEB_API_KEY = `${'AI'}${'za'}${'A'.repeat(35)}`;
const REFRESH_TOKEN = `refresh-${'r'.repeat(80)}`;
const ROOT = new URL('../browser-relay-scenario-fixture-cloud/', import.meta.url);
const FILES = ['README.md', 'cloud.mjs', 'contract.mjs', 'guard.mjs', 'profile.json'];
const URLS = {
  inventory: `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
  deletion: `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`,
  config: `https://firebase.googleapis.com/v1beta1/projects/-/webApps/${encodeURIComponent(FIREBASE_APP_ID)}/config`,
  signing: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SIGNER_SERVICE_ACCOUNT}:signJwt`,
  exchange: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
  binding: `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`,
};

function jwt(marker) {
  return `${'h'.repeat(24)}.${marker.padEnd(32, 'p')}.${'s'.repeat(32)}`;
}

function pageInput(overrides = {}) {
  return {
    ...UID_INPUT, browser: 'chromium', identity_generation: 2, matrix_sequence: 2,
    signal: undefined, ...overrides,
  };
}

function syntheticUser(overrides = {}) {
  return {
    localId: REPLACEMENT_SYNTHETIC_UID, createdAt: String(START), lastLoginAt: String(START),
    customAuth: true, disabled: false, emailVerified: false, providerUserInfo: [],
    ...overrides,
  };
}

function lookup(user) {
  return { kind: 'identitytoolkit#GetAccountInfoResponse', users: user ? [user] : [] };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function harness(respond) {
  const state = { now: START, user: null };
  const calls = [];
  const counts = Object.fromEntries(Object.keys(URLS).map((key) => [key, 0]));
  const session = { accessToken: OPERATOR_TOKEN };
  const implementations = {
    clock: () => state.now,
    async fetch(input, init) {
      const url = String(input);
      const kind = Object.keys(URLS).find((key) => URLS[key] === url);
      assert.ok(kind, 'Only fixed reviewed Google endpoints may be called');
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      calls.push({ kind, url, init, body });
      counts[kind] += 1;
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.method, kind === 'config' ? 'GET' : 'POST');
      const isPublic = kind === 'exchange' || kind === 'binding';
      assert.equal(init.headers.Authorization, isPublic ? undefined : `Bearer ${OPERATOR_TOKEN}`);
      assert.equal(init.headers['X-Goog-User-Project'], isPublic ? undefined : PROJECT_ID);
      assert.equal(init.headers['Cache-Control'], 'no-store');
      assert.equal(init.headers.Pragma, 'no-cache');
      if (kind === 'inventory') assert.deepEqual(body, { localId: [REPLACEMENT_SYNTHETIC_UID] });
      if (kind === 'deletion') assert.deepEqual(body, { localId: REPLACEMENT_SYNTHETIC_UID });
      if (kind === 'exchange') assert.deepEqual(body, { token: jwt('custom-0'), returnSecureToken: true });
      if (kind === 'binding') assert.deepEqual(body, { idToken: jwt('identity') });
      const payload = kind === 'signing' ? JSON.parse(body.payload) : undefined;
      if (payload) {
        assert.deepEqual(Object.keys(body), ['payload']);
        assert.equal(payload.uid, REPLACEMENT_SYNTHETIC_UID);
        assert.equal(payload.iss, SIGNER_SERVICE_ACCOUNT);
        assert.equal(payload.sub, SIGNER_SERVICE_ACCOUNT);
        assert.equal(payload.aud,
          'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
        assert.equal(payload.exp - payload.iat, 3_600);
        assert.equal(payload.claims.miakapp_staging_acceptance_identity, 'replacement');
        assert.ok([0, 2].includes(payload.claims.miakapp_staging_acceptance_sequence));
      }
      const defaultResponse = () => {
        if (kind === 'inventory' || kind === 'binding') return jsonResponse(lookup(state.user));
        if (kind === 'config') return jsonResponse({
          projectId: PROJECT_ID, appId: FIREBASE_APP_ID,
          authDomain: `${PROJECT_ID}.firebaseapp.com`,
          storageBucket: `${PROJECT_ID}.firebasestorage.app`,
          messagingSenderId: PROJECT_NUMBER, apiKey: WEB_API_KEY,
        });
        if (kind === 'signing') return jsonResponse({
          keyId: 'synthetic-key', signedJwt: jwt(`custom-${payload.claims.miakapp_staging_acceptance_sequence}`),
        });
        if (kind === 'exchange') {
          state.user = syntheticUser();
          return jsonResponse({
            kind: 'identitytoolkit#VerifyCustomTokenResponse', idToken: jwt('identity'),
            refreshToken: REFRESH_TOKEN, expiresIn: '3600', isNewUser: true,
          });
        }
        state.user = null;
        return new Response(null, { status: 200 });
      };
      const context = { kind, body, payload, init, state, counts, defaultResponse };
      return respond ? await respond(context) ?? defaultResponse() : defaultResponse();
    },
  };
  const dependencies = createGoogleBrowserRelayScenarioReplacementDependencies(session, implementations);
  return { calls, counts, state, session, implementations, dependencies };
}

async function create(h) {
  await h.dependencies.verifyReplacementIdentityAbsent(UID_INPUT);
  return h.dependencies.createReplacementIdentity(UID_INPUT);
}

async function rejectsPrivate(promise) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StagingBrowserRelayScenarioFixtureCloudError);
    assert.equal(error.cause, undefined);
    const serialized = `${error.stack}\n${JSON.stringify(error)}`;
    for (const secret of [OPERATOR_TOKEN, WEB_API_KEY, REFRESH_TOKEN, jwt('identity'), jwt('custom-0')]) {
      assert.equal(serialized.includes(secret), false);
    }
    return true;
  });
}

test('pins a dormant replacement adapter with closed authority and bounded budgets', () => {
  const profile = validateBrowserRelayScenarioFixtureCloudProfile();
  assert.equal(profile.target.replacement_synthetic_uid, REPLACEMENT_SYNTHETIC_UID);
  assert.equal(profile.request_budget.maximum_inventory_cycles, 6);
  assert.equal(profile.request_budget.maximum_signed_firebase_jwts, 2);
  assert.equal(profile.request_budget.maximum_response_bytes, 65_536);
  assert.equal(profile.request_budget.maximum_signing_window_seconds, 1_200);
  assert.equal(profile.request_budget.mutation_retries, 0);
  assert.ok(Object.values(profile.authority).every((value) => value === false));
  assert.equal(profile.evidence.live_http_requests, 0);
  assert.match(SCENARIO_FIXTURE_CLOUD_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(SCENARIO_FIXTURE_CLOUD_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
  assert.doesNotThrow(() => validateBrowserRelayScenarioFixtureCloudRoot(ROOT));
});

test('constructs without network I/O and requires initial absence before mutation', async () => {
  const h = harness();
  assert.ok(Object.isFrozen(h.dependencies));
  await rejectsPrivate(h.dependencies.createReplacementIdentity(UID_INPUT));
  await rejectsPrivate(h.dependencies.removeReplacementIdentity(UID_INPUT));
  await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
  assert.equal(h.calls.length, 0);
});

test('requires exact explicit session and implementation boundaries with a valid clock', () => {
  const implementations = { clock: () => START, fetch: () => assert.fail('No constructor network I/O') };
  for (const session of [undefined, {}, { accessToken: 'short' },
    { accessToken: `${OPERATOR_TOKEN}\n` }, { accessToken: OPERATOR_TOKEN, extra: true }]) {
    assert.throws(() => createGoogleBrowserRelayScenarioReplacementDependencies(session, implementations),
      StagingBrowserRelayScenarioFixtureCloudError);
  }
  for (const boundary of [{}, { ...implementations, extra: true },
    { ...implementations, clock: () => NaN }, { ...implementations, clock: () => -1 }]) {
    assert.throws(() => createGoogleBrowserRelayScenarioReplacementDependencies(
      { accessToken: OPERATOR_TOKEN }, boundary,
    ), StagingBrowserRelayScenarioFixtureCloudError);
  }
});

test('accepts Google exchange without localId, binds the ID token, signs once and deletes once', async () => {
  const h = harness();
  const identity = await create(h);
  assert.deepEqual(identity, { schema: REPLACEMENT_IDENTITY_SCHEMA, state: 'created' });
  assert.ok(Object.isFrozen(identity));
  assert.equal(await h.dependencies.issueReplacementFirebaseCustomToken(pageInput()), jwt('custom-2'));
  await rejectsPrivate(h.dependencies.createReplacementIdentity(UID_INPUT));
  await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
  assert.equal(await h.dependencies.removeReplacementIdentity(UID_INPUT), true);
  const absent = await h.dependencies.verifyReplacementIdentityAbsent(UID_INPUT);
  assert.deepEqual(absent, { schema: REPLACEMENT_ABSENCE_SCHEMA, state: 'absent', firebase_auth_users: 0 });
  assert.ok(Object.isFrozen(absent));
  assert.deepEqual(h.counts, { inventory: 4, deletion: 1, config: 1, signing: 2, exchange: 1, binding: 1 });
  assert.deepEqual(h.calls.filter(({ kind }) => kind === 'signing').map(({ body }) => (
    JSON.parse(body.payload).claims.miakapp_staging_acceptance_sequence
  )), [0, 2]);
});

test('accepts omitted absent users, refuses occupied UID, and limits inventory to six attempts', async () => {
  const omitted = harness(({ kind }) => kind === 'inventory' ? jsonResponse({ kind: 'identitytoolkit#GetAccountInfoResponse' }) : undefined);
  await omitted.dependencies.verifyReplacementIdentityAbsent(UID_INPUT);
  const occupied = harness();
  occupied.state.user = syntheticUser();
  await rejectsPrivate(occupied.dependencies.verifyReplacementIdentityAbsent(UID_INPUT));
  await rejectsPrivate(occupied.dependencies.createReplacementIdentity(UID_INPUT));
  assert.equal(occupied.counts.signing, 0);
  const bounded = harness();
  for (let index = 0; index < 6; index += 1) await bounded.dependencies.verifyReplacementIdentityAbsent(UID_INPUT);
  await rejectsPrivate(bounded.dependencies.verifyReplacementIdentityAbsent(UID_INPUT));
  assert.equal(bounded.counts.inventory, 6);
});

test('rejects changed request fields without consuming the valid page-token slot', async () => {
  const h = harness();
  await create(h);
  const before = h.calls.length;
  for (const overrides of [
    { uid: 'foreign-user' }, { browser: 'webkit' }, { identity_generation: 1 },
    { matrix_sequence: 1 }, { signal: {} }, { project_id: 'foreign-project' },
  ]) await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput(overrides)));
  await rejectsPrivate(h.dependencies.removeReplacementIdentity({ ...UID_INPUT, extra: true }));
  assert.equal(h.calls.length, before);
  assert.equal(await h.dependencies.issueReplacementFirebaseCustomToken(pageInput()), jwt('custom-2'));
});

test('requires fixed UID and synthetic profile from the public identity-binding lookup', async (t) => {
  for (const [name, response] of [
    ['empty', lookup(null)], ['wrong UID', lookup(syntheticUser({ localId: 'foreign-user' }))],
    ['email', lookup(syntheticUser({ email: 'synthetic@example.invalid' }))],
    ['provider', lookup(syntheticUser({ providerUserInfo: [{ providerId: 'password' }] }))],
  ]) await t.test(name, async () => {
    const h = harness(({ kind }) => kind === 'binding' ? jsonResponse(response) : undefined);
    await rejectsPrivate(create(h));
    await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
    assert.equal(h.counts.binding, 1);
    assert.equal(h.counts.signing, 1);
    await rejectsPrivate(h.dependencies.createReplacementIdentity(UID_INPUT));
  });
});

test('accepts an optional matching exchange localId and rejects a mismatched one before binding', async () => {
  for (const localId of [REPLACEMENT_SYNTHETIC_UID, 'foreign-user']) {
    const h = harness(async ({ kind, defaultResponse }) => {
      if (kind === 'exchange') return jsonResponse({ ...await defaultResponse().json(), localId });
    });
    if (localId === REPLACEMENT_SYNTHETIC_UID) {
      await create(h);
      assert.equal(h.counts.binding, 1);
    } else {
      await rejectsPrivate(create(h));
      assert.equal(h.counts.binding, 0);
    }
  }
});

test('explicit non-ownership blocks cleanup even when the exchange contains another invalid field', async (t) => {
  for (const extra of [{}, { unreviewed: true }]) await t.test(JSON.stringify(extra), async () => {
    const h = harness(async ({ kind, defaultResponse }) => {
      if (kind !== 'exchange') return undefined;
      const value = await defaultResponse().json();
      return jsonResponse({ ...value, isNewUser: false, ...extra });
    });
    await rejectsPrivate(create(h));
    await rejectsPrivate(h.dependencies.removeReplacementIdentity(UID_INPUT));
    assert.equal(h.counts.deletion, 0);
    assert.equal(h.counts.binding, 0);
  });
});

test('rejects malformed and duplicate signatures without retrying issuance', async (t) => {
  for (const [name, signedJwt] of [['malformed', 'invalid-token'], ['duplicate', jwt('custom-0')]]) await t.test(name, async () => {
    const h = harness(({ kind, counts }) => kind === 'signing' && counts.signing === 2
      ? jsonResponse({ keyId: 'synthetic-key', signedJwt }) : undefined);
    await create(h);
    await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
    await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
    assert.equal(h.counts.signing, 2);
  });
});

test('captures injected session and dependency references immutably', async () => {
  const h = harness();
  h.session.accessToken = `changed-${'c'.repeat(64)}`;
  h.implementations.clock = () => { throw new Error(OPERATOR_TOKEN); };
  h.implementations.fetch = () => { throw new Error('transport was rerouted'); };
  await create(h);
  assert.equal(await h.dependencies.issueReplacementFirebaseCustomToken(pageInput()), jwt('custom-2'));
  assert.equal(h.counts.signing, 2);
});

test('canceled page-token issuance is single-use and dispatches no request', async () => {
  const h = harness();
  await create(h);
  const controller = new AbortController();
  controller.abort(new Error(OPERATOR_TOKEN));
  await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput({ signal: controller.signal })));
  await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
  assert.equal(h.counts.signing, 1);
  assert.equal(await h.dependencies.removeReplacementIdentity(UID_INPUT), true);
});

test('enforces inclusive 20-minute signing window and monotonic time before and after signing', async (t) => {
  const atLimit = harness();
  await create(atLimit);
  atLimit.state.now = START + WINDOW;
  assert.equal(await atLimit.dependencies.issueReplacementFirebaseCustomToken(pageInput()), jwt('custom-2'));
  for (const [name, now, afterDispatch] of [
    ['late', START + WINDOW + 1, false], ['rollback', START - 1, false],
    ['late response', START + WINDOW + 1, true], ['rollback response', START - 1, true],
  ]) await t.test(name, async () => {
    const h = harness(({ kind, counts, state }) => {
      if (afterDispatch && kind === 'signing' && counts.signing === 2) state.now = now;
    });
    await create(h);
    if (!afterDispatch) h.state.now = now;
    await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
    assert.equal(h.counts.signing, afterDispatch ? 2 : 1);
    assert.equal(await h.dependencies.removeReplacementIdentity(UID_INPUT), true);
  });
});

test('rejects overlapping lifecycle calls and suppresses a canceled late token response', async () => {
  const entered = deferred();
  const release = deferred();
  const h = harness(async ({ kind, counts }) => {
    if (kind === 'signing' && counts.signing === 2) {
      entered.resolve();
      await release.promise;
    }
  });
  await create(h);
  const controller = new AbortController();
  const pending = rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput({ signal: controller.signal })));
  await entered.promise;
  for (const operation of [
    () => h.dependencies.verifyReplacementIdentityAbsent(UID_INPUT),
    () => h.dependencies.createReplacementIdentity(UID_INPUT),
    () => h.dependencies.issueReplacementFirebaseCustomToken(pageInput()),
    () => h.dependencies.removeReplacementIdentity(UID_INPUT),
  ]) await assert.rejects(operation(), /already in progress/u);
  controller.abort();
  release.resolve();
  await pending;
  assert.equal(h.counts.deletion, 0);
  assert.equal(await h.dependencies.removeReplacementIdentity(UID_INPUT), true);
});

test('observes unknown creation and deletion outcomes without retrying mutations', async () => {
  const h = harness(({ kind, defaultResponse }) => {
    if (kind === 'exchange' || kind === 'deletion') {
      defaultResponse();
      throw new Error(`${OPERATOR_TOKEN} ${REFRESH_TOKEN}`);
    }
  });
  await rejectsPrivate(create(h));
  assert.equal(await h.dependencies.removeReplacementIdentity(UID_INPUT), true);
  await rejectsPrivate(h.dependencies.createReplacementIdentity(UID_INPUT));
  await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
  assert.equal(h.counts.exchange, 1);
  assert.equal(h.counts.deletion, 1);
  h.state.user = syntheticUser();
  await rejectsPrivate(h.dependencies.removeReplacementIdentity(UID_INPUT));
  assert.equal(h.counts.deletion, 1);
});

test('uncertain deletion is re-observed, never retried, and permanently closes signing', async () => {
  const h = harness(({ kind }) => {
    if (kind === 'deletion') throw new Error(OPERATOR_TOKEN);
  });
  await create(h);
  await rejectsPrivate(h.dependencies.removeReplacementIdentity(UID_INPUT));
  await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
  await rejectsPrivate(h.dependencies.removeReplacementIdentity(UID_INPUT));
  h.state.user = null;
  assert.equal(await h.dependencies.removeReplacementIdentity(UID_INPUT), true);
  assert.equal(h.counts.deletion, 1);
  assert.equal(h.counts.signing, 1);
});

test('failed prerequisites cannot authorize deletion of a subsequently appearing identity', async () => {
  const h = harness(({ kind }) => kind === 'config' ? jsonResponse({ error: OPERATOR_TOKEN }, 403) : undefined);
  await rejectsPrivate(create(h));
  h.state.user = syntheticUser();
  await rejectsPrivate(h.dependencies.removeReplacementIdentity(UID_INPUT));
  assert.equal(h.counts.exchange, 0);
  assert.equal(h.counts.deletion, 0);
});

test('cleanup refuses foreign profile data and provider or claim changes', async (t) => {
  for (const fields of [
    { email: 'synthetic@example.invalid' }, { tenantId: 'foreign-tenant' }, { disabled: true },
    { emailVerified: true }, { customAuth: false }, { customAttributes: '{"role":"foreign"}' },
    { providerUserInfo: [{ providerId: 'password' }] }, { mfaInfo: [{}] },
  ]) await t.test(Object.keys(fields)[0], async () => {
    const h = harness();
    await create(h);
    h.state.user = syntheticUser(fields);
    await rejectsPrivate(h.dependencies.removeReplacementIdentity(UID_INPUT));
    await rejectsPrivate(h.dependencies.issueReplacementFirebaseCustomToken(pageInput()));
    assert.equal(h.counts.deletion, 0);
  });
});

test('bounds streamed responses even without Content-Length and sanitizes response errors', async () => {
  let canceled = false;
  const oversized = harness(({ kind }) => {
    if (kind !== 'inventory') return undefined;
    return new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(32_768)); },
      cancel() { canceled = true; },
    }));
  });
  await rejectsPrivate(oversized.dependencies.verifyReplacementIdentityAbsent(UID_INPUT));
  assert.equal(canceled, true);
  assert.equal(oversized.counts.inventory, 1);
  for (const response of [
    () => jsonResponse({ error: OPERATOR_TOKEN }, 403),
    () => new Response(OPERATOR_TOKEN),
    () => jsonResponse({}, 200, { 'Content-Length': '65537' }),
  ]) {
    const h = harness(({ kind }) => kind === 'inventory' ? response() : undefined);
    await rejectsPrivate(h.dependencies.verifyReplacementIdentityAbsent(UID_INPUT));
  }
});

test('guards copied package inventory, regular files, source/profile drift and symlink roots', async (t) => {
  for (const variant of ['extra', 'executable', 'source', 'profile', 'symlink-file', 'symlink-root']) {
    await t.test(variant, () => {
      const directory = mkdtempSync(join(tmpdir(), 'miakapp-replacement-cloud-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const root = pathToFileURL(`${directory}/`);
      for (const name of FILES) copyFileSync(new URL(name, ROOT), join(directory, name));
      assert.doesNotThrow(() => validateBrowserRelayScenarioFixtureCloudRoot(root));
      if (variant === 'extra') writeFileSync(join(directory, 'unexpected.txt'), 'extra\n');
      if (variant === 'executable') chmodSync(join(directory, 'cloud.mjs'), 0o755);
      if (variant === 'source') writeFileSync(join(directory, 'cloud.mjs'), `${readFileSync(new URL('cloud.mjs', ROOT), 'utf8')}\n`);
      if (variant === 'profile') writeFileSync(join(directory, 'profile.json'), `${readFileSync(new URL('profile.json', ROOT), 'utf8')}\n`);
      if (variant === 'symlink-file') {
        rmSync(join(directory, 'cloud.mjs'));
        symlinkSync(fileURLToPath(new URL('cloud.mjs', ROOT)), join(directory, 'cloud.mjs'));
      }
      if (variant === 'symlink-root') {
        symlinkSync(fileURLToPath(ROOT), join(directory, 'linked-root'));
        assert.throws(() => validateBrowserRelayScenarioFixtureCloudRoot(pathToFileURL(`${directory}/linked-root/`)));
      } else assert.throws(() => validateBrowserRelayScenarioFixtureCloudRoot(root));
    });
  }
});
