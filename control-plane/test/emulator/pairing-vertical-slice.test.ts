import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  getFirestore,
  type DocumentReference,
  type Firestore,
  type ReadOnlyTransactionOptions,
  type ReadWriteTransactionOptions,
  type Transaction,
} from 'firebase-admin/firestore';

import { loadEmulatorConfig } from '../../src/config.js';
import { ApiError } from '../../src/errors.js';
import { normalizePairingCode, pairingCodeLookup } from '../../src/pairing-code.js';
import { ControlPlaneStore } from '../../src/store.js';
import { HOME_KEY_PATTERN, SYSTEM_CLOCK, type Clock, type FirebasePrincipal } from '../../src/types.js';
import { loadAccessTokenFixture, type AccessTokenFixture } from '../../../control-plane-contract/typescript/src/profile.js';
import { RANDOM_SUBJECT_ATTEMPTS, reserveAdmissionSubjects } from './admission-fixture.js';
import {
  PROJECT_ID,
  AUTH_HOST,
  apiRequest,
  clearFirestore,
  jsonResponse,
  signUp,
  staleAuthenticationToken,
  type EmulatorUser,
} from './helpers.js';

interface PairingCodeResponse {
  readonly schema: 'miakapp.pairing-code/1';
  readonly code: string;
  readonly home_id: string;
  readonly access: 'full_home';
  readonly scopes: string[];
  readonly expires_at: string;
  readonly redeem_endpoint: string;
}

interface RedeemResponse {
  readonly home_key: string;
  readonly home_id: string;
  readonly key_id: string;
  readonly issuer: string;
}

interface ErrorResponse {
  readonly error: { readonly code: string };
}

const HOME_ID = 'pairing-home';
const FULL_SCOPES = ['relay:coordinator', 'relay:cli', 'push:send', 'components:publish'];
const admin = initializeApp({ projectId: PROJECT_ID }, 'control-plane-pairing-tests');
const firestore = getFirestore(admin);
const config = loadEmulatorConfig({ FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: PROJECT_ID } as NodeJS.ProcessEnv);
const pepper = config.homeKeyPepperForVersion(config.verifierKeyVersion) as Uint8Array;
let owner: EmulatorUser;
let stranger: EmulatorUser;
let fixture: AccessTokenFixture;

function principal(user: EmulatorUser): FirebasePrincipal {
  const now = Math.floor(Date.now() / 1_000);
  return Object.freeze({ userId: user.userId, verifiedEmail: null, authenticatedAt: now, expiresAt: now + 3_600 });
}

function lookupFor(code: string): string {
  return pairingCodeLookup(normalizePairingCode(code), pepper);
}

async function errorCode(response: Response): Promise<string> {
  return (await jsonResponse<ErrorResponse>(response)).error.code;
}

async function createHome(user: EmulatorUser = owner, homeId = HOME_ID): Promise<void> {
  const response = await apiRequest('POST', '/v1/homes', {
    token: user.idToken,
    body: { home_id: homeId, name: 'Pairing Home', icon: 'house', relay_url: fixture.deployment.relay_audience },
  });
  expect(response.status).toBe(201);
}

function issueBody(homeId = HOME_ID): Record<string, string> {
  return { access: 'full_home', confirmation: `grant-full-home-access:${homeId}` };
}

/** Issues a code whose fixed admission bucket cannot be shared with another fixture. */
async function issueCode(homeId = HOME_ID): Promise<PairingCodeResponse> {
  for (let attempt = 0; attempt < RANDOM_SUBJECT_ATTEMPTS; attempt += 1) {
    const response = await apiRequest('POST', `/v1/homes/${homeId}/pairing-codes`, {
      token: owner.idToken,
      body: issueBody(homeId),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await jsonResponse<PairingCodeResponse>(response);
    if (reserveAdmissionSubjects([{ budget: 'pairing.redeem.code', subject: lookupFor(body.code) }])) return body;
  }
  throw new Error('Could not issue a collision-free pairing code fixture');
}

async function redeem(code: string, label = 'Synthetic agent'): Promise<Response> {
  return apiRequest('POST', '/v1/pairing/redeem', { body: { code, label } });
}

async function exchange(homeKey: string, body: Record<string, string>): Promise<Response> {
  return apiRequest('POST', '/v1/access-tokens:exchange', { homeKey, body });
}

async function readCode(code: string): Promise<Record<string, unknown> | undefined> {
  return (await firestore.collection('controlPairingCodes').doc(lookupFor(code)).get()).data();
}

async function everyDocument(): Promise<string> {
  const pending: DocumentReference[] = [];
  const collections = await firestore.listCollections();
  const lines: string[] = [];
  for (const collection of collections) pending.push(...await collection.listDocuments());
  while (pending.length > 0) {
    const reference = pending.pop() as DocumentReference;
    const snapshot = await reference.get();
    if (snapshot.exists) lines.push(`${reference.path} ${JSON.stringify(snapshot.data())}`);
    for (const child of await reference.listCollections()) pending.push(...await child.listDocuments());
  }
  return lines.join('\n');
}

function storeWith(database: Firestore = firestore, clock: Clock = SYSTEM_CLOCK): ControlPlaneStore {
  return new ControlPlaneStore(database, config, clock);
}

/**
 * Commits the first transaction, then runs the same update function again as
 * if the commit acknowledgement had been lost and the client retried.
 */
function firestoreWithLostCommitAcknowledgement(base: Firestore): Firestore {
  let calls = 0;
  const runTransaction = async <T>(
    updateFunction: (transaction: Transaction) => Promise<T>,
    options?: ReadWriteTransactionOptions | ReadOnlyTransactionOptions,
  ): Promise<T> => {
    calls += 1;
    if (calls === 1) await base.runTransaction(updateFunction, options);
    return base.runTransaction(updateFunction, options);
  };
  return new Proxy(base, {
    get(target, property) {
      if (property === 'runTransaction') return runTransaction;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

beforeAll(async () => {
  [owner, stranger, fixture] = await Promise.all([
    signUp('pairing-owner@example.test'),
    signUp('pairing-stranger@example.test'),
    loadAccessTokenFixture(),
  ]);
});

beforeEach(async () => {
  await clearFirestore(firestore);
});

afterAll(async () => {
  await deleteApp(admin);
});

describe('Firebase Emulator browser-to-agent pairing', () => {
  test.each(['disabled', 'deleted', 'revoked'] as const)(
    'rejects an already-issued owner token after the account is %s', async (state) => {
      const account = await signUp(`pairing-${state}@example.test`);
      // Auth emulator tokens are unsigned. Make authentication precede the
      // revocation clock without waiting for a wall-clock second boundary.
      const segments = account.idToken.split('.');
      const claims = JSON.parse(Buffer.from(segments[1] as string, 'base64url').toString('utf8'));
      claims.auth_time -= 10;
      segments[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
      // The emulator checks revocation even when the SDK flag is omitted.
      // Keep the fixture initially valid, then exercise real SDK invalidation.
      const setup = await fetch(
        `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=synthetic-key`,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
          body: JSON.stringify({ localId: account.userId, validSince: String(claims.auth_time - 1) }),
        },
      );
      expect(setup.ok).toBe(true);
      const user = { ...account, idToken: segments.join('.') };
      await createHome(user);
      expect((await apiRequest('GET', '/v1/homes', { token: user.idToken })).status).toBe(200);

      const auth = getAuth(admin);
      if (state === 'disabled') await auth.updateUser(user.userId, { disabled: true });
      else if (state === 'deleted') await auth.deleteUser(user.userId);
      else await auth.revokeRefreshTokens(user.userId);

      for (const response of [
        await apiRequest('GET', '/v1/homes', { token: user.idToken }),
        await apiRequest('POST', `/v1/homes/${HOME_ID}/pairing-codes`, {
          token: user.idToken, body: issueBody(),
        }),
      ]) {
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await errorCode(response)).toBe('invalid_firebase_token');
      }
      expect((await firestore.collection('controlPairingCodes').get()).size).toBe(0);
      expect((await apiRequest('GET', '/v1/homes', { token: owner.idToken })).status).toBe(200);
    },
  );

  test('lists only the homes an account administers', async () => {
    await createHome();
    const mine = await apiRequest('GET', '/v1/homes', { token: owner.idToken });
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toBe('no-store');
    const body = await jsonResponse<{ schema: string; homes: Array<{ home_id: string }> }>(mine);
    expect(body.schema).toBe('miakapp.home-list/1');
    expect(body.homes.map((home) => home.home_id)).toEqual([HOME_ID]);

    const theirs = await apiRequest('GET', '/v1/homes', { token: stranger.idToken });
    expect(await jsonResponse<{ homes: unknown[] }>(theirs)).toEqual({ schema: 'miakapp.home-list/1', homes: [] });
  });

  test('issues codes only to the owner, freshly signed in, for a confirmed home', async () => {
    await createHome();
    const notOwner = await apiRequest('POST', `/v1/homes/${HOME_ID}/pairing-codes`, {
      token: stranger.idToken,
      body: issueBody(),
    });
    expect(notOwner.status).toBe(403);
    expect(await errorCode(notOwner)).toBe('not_home_owner');

    const stale = await apiRequest('POST', `/v1/homes/${HOME_ID}/pairing-codes`, {
      token: await staleAuthenticationToken(owner),
      body: issueBody(),
    });
    expect(stale.status).toBe(401);
    expect(await errorCode(stale)).toBe('recent_authentication_required');

    const unconfirmed = await apiRequest('POST', `/v1/homes/${HOME_ID}/pairing-codes`, {
      token: owner.idToken,
      body: { access: 'full_home', confirmation: 'grant-full-home-access:another-home' },
    });
    expect(unconfirmed.status).toBe(400);

    const missing = await apiRequest('POST', '/v1/homes/missing-home/pairing-codes', {
      token: owner.idToken,
      body: issueBody('missing-home'),
    });
    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe('home_not_found');
    expect((await firestore.collection('controlPairingCodes').get()).size).toBe(0);

    const issued = await issueCode();
    expect(issued.code).toMatch(/^MIAK(-[0-9A-HJKMNP-TV-Z]{5}){5}$/);
    expect(issued.home_id).toBe(HOME_ID);
    expect(issued.scopes).toEqual(FULL_SCOPES);
    expect(issued.redeem_endpoint).toBe(`${config.issuer}/v1/pairing/redeem`);
    const lifetime = Date.parse(issued.expires_at) - Date.now();
    expect(lifetime).toBeGreaterThan(9 * 60 * 1_000);
    expect(lifetime).toBeLessThanOrEqual(10 * 60 * 1_000);
    expect(await readCode(issued.code)).toMatchObject({
      status: 'pending',
      home_id: HOME_ID,
      created_by: owner.userId,
      key_id: null,
    });
  });

  test('redeems a code exactly once into a fresh, full, revocable key for that home', async () => {
    await createHome();
    const existingKey = await apiRequest('POST', `/v1/homes/${HOME_ID}/home-keys`, {
      token: owner.idToken,
      body: { label: 'Existing coordinator', scopes: ['relay:coordinator'] },
    });
    expect(existingKey.status).toBe(201);
    const existing = await jsonResponse<{ key: { key_id: string }; home_key: string }>(existingKey);
    const issued = await issueCode();

    const response = await redeem(issued.code.toLowerCase().replaceAll('-', ' '), 'Molted agent');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const paired = await jsonResponse<RedeemResponse>(response);
    expect(Object.keys(paired).sort()).toEqual(['home_id', 'home_key', 'issuer', 'key_id']);
    expect(paired.home_id).toBe(HOME_ID);
    expect(paired.issuer).toBe(config.issuer);
    expect(HOME_KEY_PATTERN.exec(paired.home_key)?.[1]).toBe(paired.key_id);
    expect(paired.key_id).not.toBe(existing.key.key_id);
    expect(reserveAdmissionSubjects([{ budget: 'access.exchange.key', subject: paired.key_id }])).toBe(true);

    expect(await readCode(issued.code)).toMatchObject({ status: 'redeemed', key_id: paired.key_id });
    const replay = await redeem(issued.code);
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe('invalid_pairing_code');

    const listed = await apiRequest('GET', `/v1/homes/${HOME_ID}/home-keys`, { token: owner.idToken });
    const keys = (await jsonResponse<{ keys: Array<{ key_id: string; label: string; scopes: string[]; revoked_at: string | null }> }>(listed)).keys;
    expect(keys).toHaveLength(2);
    expect(keys.find((key) => key.key_id === paired.key_id)).toMatchObject({
      label: 'Molted agent',
      scopes: FULL_SCOPES,
      revoked_at: null,
    });

    for (const body of [
      { purpose: 'components' },
      { purpose: 'push' },
      { purpose: 'relay', role: 'cli', reason: 'initial' },
      { purpose: 'relay', role: 'coordinator', coordinator_name: 'agent', reason: 'initial' },
    ]) {
      expect((await exchange(paired.home_key, body)).status).toBe(200);
    }

    const revoked = await apiRequest('DELETE', `/v1/homes/${HOME_ID}/home-keys/${paired.key_id}`, {
      token: owner.idToken,
    });
    expect(revoked.status).toBe(204);
    const afterRevocation = await exchange(paired.home_key, { purpose: 'components' });
    expect(afterRevocation.status).toBe(401);
    expect(await errorCode(afterRevocation)).toBe('invalid_home_key');
    // Revoking the paired key leaves the owner's other keys alone.
    expect((await exchange(existing.home_key, {
      purpose: 'relay',
      role: 'coordinator',
      coordinator_name: 'automation',
      reason: 'initial',
    })).status).toBe(200);
  }, 30_000);

  test('lets exactly one of many concurrent redemptions commit', async () => {
    await createHome();
    const issued = await issueCode();
    const store = storeWith();
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) => store.redeemPairingCode(issued.code, `Racer ${index}`)),
    );
    const winners = results.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(ApiError);
        expect((result.reason as ApiError).code).toBe('invalid_pairing_code');
      }
    }
    const home = (await firestore.collection('controlHomes').doc(HOME_ID).get()).data();
    expect(home).toMatchObject({ active_key_count: 1, retained_key_count: 1 });

    const second = await issueCode();
    const responses = await Promise.all(Array.from({ length: 3 }, () => redeem(second.code)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401, 401]);
    expect((await firestore.collection('controlHomes').doc(HOME_ID).get()).data()).toMatchObject({
      active_key_count: 2,
    });
  }, 60_000);

  test('redeems nothing once the ten minutes have passed', async () => {
    await createHome();
    const issued = await issueCode();
    const expiresAt = Date.parse(issued.expires_at);
    const late = storeWith(firestore, { now: () => expiresAt });
    await expect(late.redeemPairingCode(issued.code, 'Late agent')).rejects.toMatchObject({
      code: 'invalid_pairing_code',
    });
    const justInTime = storeWith(firestore, { now: () => expiresAt - 1 });
    await expect(justInTime.redeemPairingCode(issued.code, 'Punctual agent')).resolves.toMatchObject({
      home_id: HOME_ID,
    });
  });

  test('re-checks ownership at redemption and leaves the code unspent on failure', async () => {
    await createHome();
    const issued = await issueCode();
    const homeRef = firestore.collection('controlHomes').doc(HOME_ID);
    await homeRef.update({ owner_uid: stranger.userId });
    await expect(storeWith().redeemPairingCode(issued.code, 'Agent')).rejects.toMatchObject({
      code: 'invalid_pairing_code',
    });
    await homeRef.update({ owner_uid: owner.userId });

    // A key creation that cannot commit takes the code's transition with it.
    await homeRef.update({ retained_key_count: 7 });
    await expect(storeWith().redeemPairingCode(issued.code, 'Agent')).rejects.toMatchObject({
      code: 'temporarily_unavailable',
    });
    expect(await readCode(issued.code)).toMatchObject({ status: 'pending', key_id: null });
    await homeRef.update({ retained_key_count: 0 });
    await expect(storeWith().redeemPairingCode(issued.code, 'Agent')).resolves.toMatchObject({ home_id: HOME_ID });
  });

  test('replays a lost commit acknowledgement into the same single key', async () => {
    await createHome();
    const issued = await issueCode();
    const paired = await storeWith(firestoreWithLostCommitAcknowledgement(firestore))
      .redeemPairingCode(issued.code, 'Agent');
    expect(await readCode(issued.code)).toMatchObject({ status: 'redeemed', key_id: paired.key_id });
    const keys = await storeWith().listHomeKeys(principal(owner), HOME_ID);
    expect(keys.map((key) => key.key_id)).toEqual([paired.key_id]);
    expect(reserveAdmissionSubjects([{ budget: 'access.exchange.key', subject: paired.key_id }])).toBe(true);
    expect((await exchange(paired.home_key, { purpose: 'components' })).status).toBe(200);
  });

  test('throttles guessing per source and per code', async () => {
    await createHome();
    const guess = 'MIAK-00000-00000-00000-00000-00000';
    expect(reserveAdmissionSubjects([{ budget: 'pairing.redeem.code', subject: lookupFor(guess) }])).toBe(true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await redeem(guess);
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe('invalid_pairing_code');
    }
    const sameCode = await redeem(guess);
    expect(sameCode.status).toBe(429);
    expect(Number(sameCode.headers.get('retry-after'))).toBeGreaterThan(0);

    for (let attempt = 6; attempt < 20; attempt += 1) {
      expect((await redeem('not-a-code')).status).toBe(401);
    }
    const sourceLimited = await redeem('MIAK-11111-11111-11111-11111-11111');
    expect(sourceLimited.status).toBe(429);
    expect(await errorCode(sourceLimited)).toBe('rate_limited');
  }, 30_000);

  test('stores and audits neither the code nor the key', async () => {
    await createHome();
    const issued = await issueCode();
    const response = await redeem(issued.code, 'Agent');
    const paired = await jsonResponse<RedeemResponse>(response);
    await redeem(issued.code, 'Agent');
    const secret = HOME_KEY_PATTERN.exec(paired.home_key)?.[2] as string;
    const persisted = await everyDocument();
    expect(persisted).toContain('controlPairingCodes/');
    expect(persisted).toContain('controlAudit/');
    expect(persisted).not.toContain(normalizePairingCode(issued.code));
    expect(persisted).not.toContain(issued.code);
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain(paired.home_key);
  });
});
