import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type Firestore,
  type ReadOnlyTransactionOptions,
  type ReadWriteTransactionOptions,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';

import { loadEmulatorConfig } from '../../src/config.js';
import { AccessTokenSigner } from '../../src/crypto.js';
import { ApiError, type ApiErrorCode } from '../../src/errors.js';
import {
  ControlPlaneStore,
  type AccessTokenIssuer,
  type HomeKeyGenerator,
} from '../../src/store.js';
import {
  ACCESS_SCOPES,
  HOME_KEY_PATTERN,
  SYSTEM_CLOCK,
  type AccessGrant,
  type AccessScope,
  type EmulatorDeploymentConfig,
  type FirebasePrincipal,
} from '../../src/types.js';
import type {
  AccessProfile,
  AccessTokenFixture,
} from '../../../control-plane-contract/typescript/src/profile.js';
import { loadAccessTokenFixture } from '../../../control-plane-contract/typescript/src/profile.js';
import { verifyMiakappAccessToken } from '../../../control-plane-contract/typescript/src/token.js';
import {
  RANDOM_SUBJECT_ATTEMPTS,
  reserveAdmissionSubjects,
} from './admission-fixture.js';
import {
  ALLOWED_ORIGIN,
  API_BASE,
  FIRESTORE_HOST,
  PROJECT_ID,
  STORAGE_HOST,
  apiRequest,
  clearFirestore,
  jsonResponse,
  parseHost,
  signUp,
  staleAuthenticationToken,
  type EmulatorUser,
} from './helpers.js';

interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly request_id: string;
  };
}

interface CreatedKeyResponse {
  readonly schema: 'miakapp.home-key-created/1';
  readonly key: {
    readonly key_id: string;
    readonly label: string;
    readonly scopes: string[];
    readonly created_at: string;
    readonly revoked_at: string | null;
    readonly last_used_at: string | null;
  };
  readonly home_key: string;
}

interface AccessResponse {
  readonly schema: 'miakapp.access-token/1';
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_at_ms: number;
  readonly relay_url?: string;
  readonly key: { readonly id: string; readonly label: string };
}

interface DiscoveryResponse {
  readonly schema: 'miakapp.control-plane-discovery/1';
  readonly issuer: string;
  readonly jwks_uri: string;
  readonly exchange_endpoint: string;
  readonly push_audience: string;
  readonly components_audience: string;
}

interface ProfileCase {
  readonly profile: AccessProfile;
  readonly scope: AccessScope;
  readonly body: Record<string, string>;
  readonly role: 'coordinator' | 'cli' | null;
  readonly coordinatorName: string | null;
}

const admin = initializeApp({ projectId: PROJECT_ID }, 'control-plane-emulator-tests');
const firestore = getFirestore(admin);
const emulatorEnvironment = {
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: PROJECT_ID,
} as NodeJS.ProcessEnv;
const config = loadEmulatorConfig(emulatorEnvironment);
const signer = new AccessTokenSigner(config);
let owner: EmulatorUser;
let stranger: EmulatorUser;
let fixture: AccessTokenFixture;
let rules: RulesTestEnvironment | undefined;

function ownerPrincipal(): FirebasePrincipal {
  const now = Math.floor(Date.now() / 1_000);
  return Object.freeze({ userId: owner.userId, authenticatedAt: now, expiresAt: now + 3_600 });
}

async function createHome(homeId = 'synthetic-home', relayUrl?: string): Promise<void> {
  const created = await apiRequest('POST', '/v1/homes', {
    token: owner.idToken,
    body: {
      home_id: homeId,
      name: 'Synthetic Home',
      icon: 'house',
      relay_url: relayUrl ?? fixture.deployment.relay_audience,
    },
  });
  expect(created.status).toBe(201);
}

async function createHomeKey(
  scopes: readonly string[] = ACCESS_SCOPES,
  homeId = 'synthetic-home',
): Promise<CreatedKeyResponse> {
  for (let attempt = 0; attempt < RANDOM_SUBJECT_ATTEMPTS; attempt += 1) {
    const created = await apiRequest('POST', `/v1/homes/${homeId}/home-keys`, {
      token: owner.idToken,
      body: { label: 'Synthetic key', scopes },
    });
    expect(created.status).toBe(201);
    const payload = await jsonResponse<CreatedKeyResponse>(created);
    const parsed = parseCreatedHomeKey(payload.home_key);
    if (payload.key.key_id !== parsed.keyId) throw new Error('Created Home Key identifier is inconsistent');
    if (reserveAdmissionSubjects([{
      budget: 'access.exchange.key',
      subject: parsed.keyId,
    }])) return payload;
  }
  throw new Error('Could not create a collision-free Home Key fixture');
}

function parseCreatedHomeKey(value: string): { readonly keyId: string; readonly secret: string } {
  const match = HOME_KEY_PATTERN.exec(value);
  const keyId = match?.[1];
  const secret = match?.[2];
  if (keyId === undefined || secret === undefined) throw new Error('Created Home Key is malformed');
  return Object.freeze({ keyId, secret });
}

async function expectApiError(promise: Promise<unknown>, code: ApiErrorCode): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
  }
}

function decodedClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (payload === undefined) throw new Error('Access token has no payload');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function configWithPeppers(
  currentVersion: string,
  peppers: Readonly<Record<string, Uint8Array>>,
): EmulatorDeploymentConfig {
  return Object.freeze({
    ...config,
    verifierKeyVersion: currentVersion,
    homeKeyPepperForVersion: (version: string) => {
      const pepper = peppers[version];
      return pepper === undefined ? undefined : new Uint8Array(pepper);
    },
  });
}

function firestoreWithForcedReservationRetry(base: Firestore): {
  readonly database: Firestore;
  readonly replayCount: () => number;
} {
  let transactionCalls = 0;
  let replays = 0;
  const forcedAbort = new Error('synthetic forced transaction abort');
  const runTransaction = async <T>(
    updateFunction: (transaction: Transaction) => Promise<T>,
    options?: ReadWriteTransactionOptions | ReadOnlyTransactionOptions,
  ): Promise<T> => {
    transactionCalls += 1;
    if (transactionCalls === 1) {
      try {
        await base.runTransaction(async (transaction) => {
          await updateFunction(transaction);
          throw forcedAbort;
        }, options);
      } catch (error) {
        if (error !== forcedAbort) throw error;
      }
      replays += 1;
    }
    return base.runTransaction(updateFunction, options);
  };
  const database = new Proxy(base, {
    get(target, property) {
      if (property === 'runTransaction') return runTransaction;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return Object.freeze({ database, replayCount: () => replays });
}

class GatedIssuer implements AccessTokenIssuer {
  readonly grants: AccessGrant[] = [];
  readonly started: Promise<void>;
  #releaseFirst: (() => void) | undefined;
  #startFirst: (() => void) | undefined;

  constructor(readonly delegate: AccessTokenSigner) {
    this.started = new Promise((resolve) => { this.#startFirst = resolve; });
  }

  async sign(grant: AccessGrant) {
    this.grants.push(grant);
    if (this.grants.length === 1) {
      this.#startFirst?.();
      await new Promise<void>((resolve) => { this.#releaseFirst = resolve; });
    }
    return this.delegate.sign(grant);
  }

  release(): void {
    this.#releaseFirst?.();
  }
}

beforeAll(async () => {
  [owner, stranger, fixture] = await Promise.all([
    signUp('owner@example.test'),
    signUp('stranger@example.test'),
    loadAccessTokenFixture(),
  ]);
});

beforeEach(async () => {
  await clearFirestore(firestore);
});

afterAll(async () => {
  await rules?.cleanup();
  await deleteApp(admin);
});

describe('Firebase Emulator owner-to-access-token vertical slice', () => {
  test('publishes closed discovery and JWKS documents', async () => {
    const discovery = await apiRequest('GET', '/.well-known/miakapp-control-plane');
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get('cache-control')).toBe('public, max-age=300, must-revalidate');
    expect(await jsonResponse<DiscoveryResponse>(discovery)).toEqual({
      schema: 'miakapp.control-plane-discovery/1',
      issuer: fixture.deployment.issuer,
      jwks_uri: fixture.deployment.jwks_uri,
      exchange_endpoint: fixture.deployment.exchange_endpoint,
      push_audience: fixture.deployment.push_audience,
      components_audience: fixture.deployment.components_audience,
    });

    const jwks = await apiRequest('GET', '/.well-known/jwks.json');
    expect(jwks.status).toBe(200);
    expect(jwks.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
    const body = await jsonResponse<{ keys: { kid: string; d?: string }[] }>(jwks);
    expect(body.keys).toHaveLength(1);
    const activated = fixture.rotation.transitions.find((transition) => transition.phase === 'activated');
    if (activated === undefined) throw new Error('Synthetic fixture has no activated signing key');
    expect(body.keys[0]?.kid).toBe(activated.signing_kid);
    expect(body.keys[0]?.d).toBeUndefined();
  });

  test('creates both home records atomically and rejects unauthenticated, ambiguous, and duplicate requests', async () => {
    const input = {
      home_id: 'synthetic-home',
      name: 'Synthetic Home',
      icon: 'house',
      relay_url: fixture.deployment.relay_audience,
    };
    const unauthenticated = await apiRequest('POST', '/v1/homes', { body: input });
    expect(unauthenticated.status).toBe(401);
    expect((await jsonResponse<ErrorResponse>(unauthenticated)).error.code).toBe('invalid_firebase_token');

    const duplicateJson = await apiRequest('POST', '/v1/homes', {
      token: owner.idToken,
      rawBody: '{"home_id":"synthetic-home","home_id":"other-home","name":"Synthetic Home","icon":"house","relay_url":"wss://relay.example.test/ws"}',
    });
    expect(duplicateJson.status).toBe(400);

    const created = await apiRequest('POST', '/v1/homes', { token: owner.idToken, body: input });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    expect(created.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    const createdBody = await jsonResponse<{ schema: string; home: Record<string, unknown> }>(created);
    expect(createdBody.schema).toBe('miakapp.home/1');
    expect(createdBody.home.home_id).toBe('synthetic-home');
    expect(createdBody.home.owner).toBeUndefined();

    const [publicHome, privateHome] = await Promise.all([
      firestore.collection('homes').doc('synthetic-home').get(),
      firestore.collection('controlHomes').doc('synthetic-home').get(),
    ]);
    expect(publicHome.exists).toBe(true);
    expect(publicHome.get('owner_uid')).toBeUndefined();
    expect(privateHome.get('owner_uid')).toBe(owner.userId);

    const duplicate = await apiRequest('POST', '/v1/homes', { token: owner.idToken, body: input });
    expect(duplicate.status).toBe(409);
    expect((await jsonResponse<ErrorResponse>(duplicate)).error.code).toBe('home_exists');

    const raceInput = { ...input, home_id: 'transaction-race' };
    const race = await Promise.all([
      apiRequest('POST', '/v1/homes', { token: owner.idToken, body: raceInput }),
      apiRequest('POST', '/v1/homes', { token: owner.idToken, body: raceInput }),
    ]);
    expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  test('derives recent ownership and keeps every fixed-length Home Key component out of storage', async () => {
    await createHome();
    const foreign = await apiRequest('POST', '/v1/homes/synthetic-home/home-keys', {
      token: stranger.idToken,
      body: { label: 'Forbidden key', scopes: ['relay:coordinator'] },
    });
    expect(foreign.status).toBe(403);
    expect((await jsonResponse<ErrorResponse>(foreign)).error.code).toBe('not_home_owner');

    const stale = await apiRequest('POST', '/v1/homes/synthetic-home/home-keys', {
      token: await staleAuthenticationToken(owner),
      body: { label: 'Stale key', scopes: ['relay:coordinator'] },
    });
    expect(stale.status).toBe(401);
    expect((await jsonResponse<ErrorResponse>(stale)).error.code).toBe('recent_authentication_required');

    const body = await createHomeKey();
    expect(body.schema).toBe('miakapp.home-key-created/1');
    const parsed = parseCreatedHomeKey(body.home_key);
    expect(body.key.key_id).toBe(parsed.keyId);

    const [record, index] = await Promise.all([
      firestore.collection('controlHomes').doc('synthetic-home').collection('homeKeys').doc(body.key.key_id).get(),
      firestore.collection('homeKeyIndex').doc(body.key.key_id).get(),
    ]);
    const persisted = JSON.stringify({ record: record.data(), index: index.data() });
    expect(record.get('verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record.get('secret')).toBeUndefined();
    expect(record.get('home_key')).toBeUndefined();
    expect(persisted).not.toContain(body.home_key);
    expect(persisted).not.toContain(parsed.secret);

    const listed = await apiRequest('GET', '/v1/homes/synthetic-home/home-keys', { token: owner.idToken });
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain('verifier');
    expect(listedText).not.toContain(body.home_key);
    const listedBody = JSON.parse(listedText) as { schema: string; keys: unknown[] };
    expect(listedBody.schema).toBe('miakapp.home-key-list/1');
    expect(listedBody.keys).toHaveLength(1);
  });

  test('attenuates an all-scope key into four independently verified resource leases', async () => {
    await createHome();
    const created = await createHomeKey();
    const limited = await createHomeKey(['relay:coordinator']);
    const deniedScope = await apiRequest('POST', '/v1/access-tokens:exchange', {
      homeKey: limited.home_key,
      body: { purpose: 'push' },
    });
    expect(deniedScope.status).toBe(403);
    expect((await jsonResponse<ErrorResponse>(deniedScope)).error.code).toBe('insufficient_scope');

    const cases: readonly ProfileCase[] = [
      {
        profile: 'coordinator',
        scope: 'relay:coordinator',
        body: { purpose: 'relay', role: 'coordinator', coordinator_name: 'automation', reason: 'initial' },
        role: 'coordinator',
        coordinatorName: 'automation',
      },
      {
        profile: 'cli',
        scope: 'relay:cli',
        body: { purpose: 'relay', role: 'cli', reason: 'initial' },
        role: 'cli',
        coordinatorName: null,
      },
      {
        profile: 'push',
        scope: 'push:send',
        body: { purpose: 'push' },
        role: null,
        coordinatorName: null,
      },
      {
        profile: 'components',
        scope: 'components:publish',
        body: { purpose: 'components' },
        role: null,
        coordinatorName: null,
      },
    ];
    const issued: { readonly response: AccessResponse; readonly profile: AccessProfile }[] = [];
    for (const profileCase of cases) {
      const exchanged = await apiRequest('POST', '/v1/access-tokens:exchange', {
        homeKey: created.home_key,
        body: profileCase.body,
      });
      expect(exchanged.status, profileCase.profile).toBe(200);
      const access = await jsonResponse<AccessResponse>(exchanged);
      const verificationFixture = { ...fixture, now: Math.floor(Date.now() / 1_000) };
      const identity = verifyMiakappAccessToken(
        access.access_token,
        verificationFixture,
        profileCase.profile,
        fixture.key_sets.rotated.keys,
      );
      expect(identity, profileCase.profile).toEqual({
        home_id: 'synthetic-home',
        principal_id: 'synthetic-home',
        client_id: created.key.key_id,
        scope: profileCase.scope,
        expires_at: access.expires_at_ms / 1_000,
        role: profileCase.role,
        coordinator_name: profileCase.coordinatorName,
      });
      expect(access.relay_url, profileCase.profile).toBe(
        profileCase.profile === 'coordinator' || profileCase.profile === 'cli'
          ? fixture.deployment.relay_audience
          : undefined,
      );
      issued.push({ response: access, profile: profileCase.profile });
    }

    const absentId = Buffer.alloc(16, 6).toString('base64url');
    const absent = await apiRequest('DELETE', `/v1/homes/synthetic-home/home-keys/${absentId}`, {
      token: owner.idToken,
    });
    expect(absent.status).toBe(204);
    const revoked = await apiRequest(
      'DELETE',
      `/v1/homes/synthetic-home/home-keys/${created.key.key_id}`,
      { token: owner.idToken },
    );
    expect(revoked.status).toBe(204);
    const repeated = await apiRequest(
      'DELETE',
      `/v1/homes/synthetic-home/home-keys/${created.key.key_id}`,
      { token: owner.idToken },
    );
    expect(repeated.status).toBe(204);

    const denied = await apiRequest('POST', '/v1/access-tokens:exchange', {
      homeKey: created.home_key,
      body: { purpose: 'relay', role: 'coordinator', coordinator_name: 'automation', reason: 'reauth' },
    });
    expect(denied.status).toBe(401);
    const deniedText = await denied.text();
    expect(deniedText).not.toContain(created.home_key);
    expect((JSON.parse(deniedText) as ErrorResponse).error.code).toBe('invalid_home_key');

    for (const entry of issued) {
      expect(() => verifyMiakappAccessToken(
        entry.response.access_token,
        { ...fixture, now: Math.floor(Date.now() / 1_000) },
        entry.profile,
        fixture.key_sets.rotated.keys,
      )).not.toThrow();
    }
  });

  test('keeps CORS closed, rejects cookies, and applies owner patch semantics', async () => {
    await createHome();
    const forbiddenOrigin = await apiRequest('PATCH', '/v1/homes/synthetic-home', {
      token: owner.idToken,
      origin: 'https://attacker.example.test',
      body: { name: 'Renamed' },
    });
    expect(forbiddenOrigin.status).toBe(400);
    expect(forbiddenOrigin.headers.get('access-control-allow-origin')).toBeNull();

    const cookie = await apiRequest('PATCH', '/v1/homes/synthetic-home', {
      token: owner.idToken,
      cookie: 'session=forbidden',
      body: { name: 'Renamed' },
    });
    expect(cookie.status).toBe(400);

    const patched = await apiRequest('PATCH', '/v1/homes/synthetic-home', {
      token: owner.idToken,
      body: { name: 'Renamed Home', relay_url: 'wss://relay-two.example.test/ws' },
    });
    expect(patched.status).toBe(200);
    const body = await jsonResponse<{ home: { name: string; relay_url: string } }>(patched);
    expect(body.home).toEqual(expect.objectContaining({
      name: 'Renamed Home',
      relay_url: 'wss://relay-two.example.test/ws',
    }));
  });

  test('enforces the client Firestore and separate Storage authority boundaries', async () => {
    await createHome();
    const firestoreAddress = parseHost(FIRESTORE_HOST);
    const storageAddress = parseHost(STORAGE_HOST);
    rules ??= await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        ...firestoreAddress,
        rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      },
      storage: {
        ...storageAddress,
        rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8'),
      },
    });
    const anonymous = rules.unauthenticatedContext();
    const authenticated = rules.authenticatedContext(owner.userId);
    await assertSucceeds(getDoc(doc(anonymous.firestore(), 'homes', 'synthetic-home')));
    await assertFails(setDoc(doc(authenticated.firestore(), 'homes', 'client-home'), { name: 'forbidden' }));
    await assertFails(getDoc(doc(authenticated.firestore(), 'controlHomes', 'synthetic-home')));
    await assertFails(getDoc(doc(authenticated.firestore(), 'homeKeyIndex', 'AAAAAAAAAAAAAAAAAAAAAA')));
    await assertFails(getDoc(doc(
      authenticated.firestore(),
      'users',
      owner.userId,
      'pushChallenges',
      'AAAAAAAAAAAAAAAAAAAAAA',
    )));
    await assertFails(getDoc(doc(
      authenticated.firestore(),
      'users',
      owner.userId,
      'pushDestinations',
      'AAAAAAAAAAAAAAAAAAAAAA',
    )));
    await assertFails(getDoc(doc(authenticated.firestore(), 'controlPushOwners', owner.userId)));
    await assertFails(getDoc(doc(authenticated.firestore(), 'pushGrantIndex', 'AAAAAAAAAAAAAAAAAAAAAA')));
    await assertFails(getDoc(doc(authenticated.firestore(), 'emulatorPushDeliveries', 'synthetic-delivery')));
    await assertFails(uploadString(
      ref(authenticated.storage(`gs://${PROJECT_ID}.appspot.com`), 'forbidden.txt'),
      'forbidden',
    ));
  });

  test('enforces the exact home/key ceilings and safely compacts concurrent revoked replacements', async () => {
    let generatedKeyIndex = 0;
    const keyGenerator: HomeKeyGenerator = () => {
      const index = generatedKeyIndex;
      generatedKeyIndex += 1;
      const keyBytes = Buffer.alloc(16);
      if (index === 0) keyBytes[15] = 1;
      else if (index === 1) keyBytes[0] = 104;
      else keyBytes.writeUInt32BE(index + 1, 12);
      const secretBytes = Buffer.alloc(32);
      secretBytes.writeUInt32BE(index + 1, 28);
      const keyId = keyBytes.toString('base64url');
      return Object.freeze({
        keyId,
        value: `mhk1_${keyId}_${secretBytes.toString('base64url')}`,
      });
    };
    const store = new ControlPlaneStore(firestore, config, SYSTEM_CLOCK, keyGenerator);
    const principal = ownerPrincipal();
    for (let index = 1; index <= 16; index += 1) {
      await store.createHome(principal, {
        homeId: `quota-home-${String(index).padStart(2, '0')}`,
        name: `Quota Home ${index}`,
        icon: 'house',
        relayUrl: fixture.deployment.relay_audience,
      });
    }
    const ownerRef = firestore.collection('controlOwners').doc(principal.userId);
    await ownerRef.update({ owned_home_count: 15 });
    await expectApiError(store.createHome(principal, {
      homeId: 'quota-home-17',
      name: 'Quota Home 17',
      icon: 'house',
      relayUrl: fixture.deployment.relay_audience,
    }), 'temporarily_unavailable');
    expect((await firestore.collection('controlHomes').doc('quota-home-17').get()).exists).toBe(false);
    await ownerRef.update({ owned_home_count: 16 });
    await expectApiError(store.createHome(principal, {
      homeId: 'quota-home-17',
      name: 'Quota Home 17',
      icon: 'house',
      relayUrl: fixture.deployment.relay_audience,
    }), 'limit_exceeded');

    const homeId = 'quota-home-01';
    const keys = [];
    for (let index = 0; index < 64; index += 1) {
      keys.push(await store.createHomeKey(principal, homeId, `Key ${index}`, ['relay:coordinator']));
    }
    const first = keys[0];
    const second = keys[1];
    const active = keys[2];
    if (first === undefined || second === undefined || active === undefined) throw new Error('Boundary keys missing');
    const tiedCreatedAt = Timestamp.fromMillis(Date.now() - 60_000);
    await Promise.all([
      firestore.collection('controlHomes').doc(homeId).collection('homeKeys')
        .doc(first.metadata.key_id).update({ created_at: tiedCreatedAt }),
      firestore.collection('controlHomes').doc(homeId).collection('homeKeys')
        .doc(second.metadata.key_id).update({ created_at: tiedCreatedAt }),
      firestore.collection('homeKeyIndex').doc(first.metadata.key_id).update({ created_at: tiedCreatedAt }),
      firestore.collection('homeKeyIndex').doc(second.metadata.key_id).update({ created_at: tiedCreatedAt }),
    ]);
    const tiedIds = (await store.listHomeKeys(principal, homeId))
      .map((key) => key.key_id)
      .filter((id) => id === first.metadata.key_id || id === second.metadata.key_id);
    expect(tiedIds).toEqual([first.metadata.key_id, second.metadata.key_id].sort((left, right) => (
      Buffer.compare(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'))
    )));
    const quotaHomeRef = firestore.collection('controlHomes').doc(homeId);
    await quotaHomeRef.update({ active_key_count: 63, retained_key_count: 63 });
    await expectApiError(
      store.createHomeKey(principal, homeId, 'Undercounted key', ['relay:coordinator']),
      'temporarily_unavailable',
    );
    expect((await quotaHomeRef.collection('homeKeys').get()).size).toBe(64);
    await quotaHomeRef.update({ active_key_count: 64, retained_key_count: 64 });
    await expectApiError(
      store.createHomeKey(principal, homeId, 'Key 65', ['relay:coordinator']),
      'limit_exceeded',
    );

    await Promise.all([
      store.revokeHomeKey(principal, homeId, first.metadata.key_id),
      store.revokeHomeKey(principal, homeId, second.metadata.key_id),
    ]);

    const firstRef = firestore.collection('controlHomes').doc(homeId)
      .collection('homeKeys').doc(first.metadata.key_id);
    await firstRef.update({ key_id: active.metadata.key_id });
    await expectApiError(
      store.createHomeKey(principal, homeId, 'Malformed compaction', ['relay:coordinator']),
      'temporarily_unavailable',
    );
    expect((await firestore.collection('controlHomes').doc(homeId)
      .collection('homeKeys').doc(active.metadata.key_id).get()).exists).toBe(true);
    await firstRef.update({ key_id: first.metadata.key_id });

    const replacements = await Promise.all([
      store.createHomeKey(principal, homeId, 'Replacement A', ['relay:coordinator']),
      store.createHomeKey(principal, homeId, 'Replacement B', ['relay:coordinator']),
    ]);
    const listed = await store.listHomeKeys(principal, homeId);
    expect(listed).toHaveLength(64);
    expect(listed.every((key) => key.revoked_at === null)).toBe(true);
    expect(listed.map((key) => key.key_id)).not.toContain(first.metadata.key_id);
    expect(listed.map((key) => key.key_id)).not.toContain(second.metadata.key_id);
    expect(listed.map((key) => key.key_id)).toEqual(expect.arrayContaining(
      replacements.map((replacement) => replacement.metadata.key_id),
    ));
    const [firstIndex, secondIndex, privateHome] = await Promise.all([
      firestore.collection('homeKeyIndex').doc(first.metadata.key_id).get(),
      firestore.collection('homeKeyIndex').doc(second.metadata.key_id).get(),
      firestore.collection('controlHomes').doc(homeId).get(),
    ]);
    expect(firstIndex.exists).toBe(false);
    expect(secondIndex.exists).toBe(false);
    expect(privateHome.get('active_key_count')).toBe(64);
    expect(privateHome.get('retained_key_count')).toBe(64);
  }, 30_000);

  test('uses the persisted pepper version and recognizes an exact ambiguous-commit retry', async () => {
    const oldPepper = new Uint8Array(32).fill(11);
    const newPepper = new Uint8Array(32).fill(12);
    const oldConfig = configWithPeppers('pepper-v1', { 'pepper-v1': oldPepper });
    const fixedKeyId = Buffer.alloc(16, 13).toString('base64url');
    const fixedSecret = Buffer.alloc(32, 14).toString('base64url');
    const generator: HomeKeyGenerator = () => Object.freeze({
      keyId: fixedKeyId,
      value: `mhk1_${fixedKeyId}_${fixedSecret}`,
    });
    const oldStore = new ControlPlaneStore(firestore, oldConfig, SYSTEM_CLOCK, generator);
    const principal = ownerPrincipal();
    await oldStore.createHome(principal, {
      homeId: 'rotated-home',
      name: 'Rotated Home',
      icon: 'house',
      relayUrl: fixture.deployment.relay_audience,
    });
    const first = await oldStore.createHomeKey(
      principal,
      'rotated-home',
      'Stable attempt',
      ['relay:coordinator'],
    );
    const replayed = await oldStore.createHomeKey(
      principal,
      'rotated-home',
      'Stable attempt',
      ['relay:coordinator'],
    );
    expect(replayed).toEqual(first);
    const privateHome = await firestore.collection('controlHomes').doc('rotated-home').get();
    expect(privateHome.get('active_key_count')).toBe(1);
    expect(privateHome.get('retained_key_count')).toBe(1);

    const rotatedConfig = configWithPeppers('pepper-v2', {
      'pepper-v1': oldPepper,
      'pepper-v2': newPepper,
    });
    const rotatedStore = new ControlPlaneStore(firestore, rotatedConfig, SYSTEM_CLOCK);
    const issued = await rotatedStore.exchangeHomeKey(
      first.homeKey,
      { purpose: 'relay', role: 'coordinator', coordinatorName: 'rotation', reason: 'reauth' },
      new AccessTokenSigner(rotatedConfig),
    );
    expect(issued.grant.clientId).toBe(fixedKeyId);

    const missingOldPepper = configWithPeppers('pepper-v2', { 'pepper-v2': newPepper });
    await expectApiError(new ControlPlaneStore(firestore, missingOldPepper, SYSTEM_CLOCK)
      .exchangeHomeKey(
        first.homeKey,
        { purpose: 'relay', role: 'coordinator', coordinatorName: 'rotation', reason: 'reauth' },
        new AccessTokenSigner(missingOldPepper),
      ), 'temporarily_unavailable');
  });

  test('fails closed instead of hiding a malformed live key from its owner', async () => {
    const store = new ControlPlaneStore(firestore, config, SYSTEM_CLOCK);
    const principal = ownerPrincipal();
    await store.createHome(principal, {
      homeId: 'malformed-home',
      name: 'Malformed Home',
      icon: 'house',
      relayUrl: fixture.deployment.relay_audience,
    });
    const created = await store.createHomeKey(
      principal,
      'malformed-home',
      'Malformed state',
      ['relay:coordinator'],
    );
    await firestore.collection('controlHomes').doc('malformed-home')
      .collection('homeKeys').doc(created.metadata.key_id)
      .update({ created_at: FieldValue.delete() });
    await expectApiError(store.listHomeKeys(principal, 'malformed-home'), 'temporarily_unavailable');
    await expectApiError(store.exchangeHomeKey(
      created.homeKey,
      { purpose: 'relay', role: 'coordinator', coordinatorName: 'malformed', reason: 'initial' },
      signer,
    ), 'temporarily_unavailable');
  });

  test('signs exactly once when reservation transaction work is replayed', async () => {
    const baseStore = new ControlPlaneStore(firestore, config, SYSTEM_CLOCK);
    const principal = ownerPrincipal();
    await baseStore.createHome(principal, {
      homeId: 'retry-home',
      name: 'Retry Home',
      icon: 'house',
      relayUrl: fixture.deployment.relay_audience,
    });
    const created = await baseStore.createHomeKey(
      principal,
      'retry-home',
      'Retry key',
      ['relay:coordinator'],
    );
    const forced = firestoreWithForcedReservationRetry(firestore);
    const retryingStore = new ControlPlaneStore(forced.database, config, SYSTEM_CLOCK);
    let signatures = 0;
    const countingIssuer: AccessTokenIssuer = {
      sign(grant) {
        signatures += 1;
        return signer.sign(grant);
      },
    };
    const exchanged = await retryingStore.exchangeHomeKey(
      created.homeKey,
      { purpose: 'relay', role: 'coordinator', coordinatorName: 'retry', reason: 'initial' },
      countingIssuer,
    );
    expect(exchanged.grant.clientId).toBe(created.metadata.key_id);
    expect(forced.replayCount()).toBe(1);
    expect(signatures).toBe(1);
    const record = await firestore.collection('controlHomes').doc('retry-home')
      .collection('homeKeys').doc(created.metadata.key_id).get();
    expect(record.get('last_used_at')).toBeDefined();
    expect(record.get('last_issuance_id')).toBe(exchanged.grant.tokenId);
    expect(decodedClaims(exchanged.signed.token).jti).toBe(exchanged.grant.tokenId);
  });

  test('linearizes one token reservation before concurrent revoke and relay changes', async () => {
    const store = new ControlPlaneStore(firestore, config, SYSTEM_CLOCK);
    const principal = ownerPrincipal();
    await store.createHome(principal, {
      homeId: 'race-home',
      name: 'Race Home',
      icon: 'house',
      relayUrl: fixture.deployment.relay_audience,
    });
    const revokedKey = await store.createHomeKey(
      principal,
      'race-home',
      'Revocation race',
      ['relay:coordinator'],
    );
    const revokeIssuer = new GatedIssuer(signer);
    const exchangeDuringRevoke = store.exchangeHomeKey(
      revokedKey.homeKey,
      { purpose: 'relay', role: 'coordinator', coordinatorName: 'race', reason: 'reauth' },
      revokeIssuer,
    );
    await revokeIssuer.started;
    const revocation = store.revokeHomeKey(principal, 'race-home', revokedKey.metadata.key_id);
    await revocation;
    revokeIssuer.release();
    const issuedBeforeRevoke = await exchangeDuringRevoke;
    expect(revokeIssuer.grants).toHaveLength(1);
    expect(decodedClaims(issuedBeforeRevoke.signed.token).jti).toBe(issuedBeforeRevoke.grant.tokenId);
    await expectApiError(store.exchangeHomeKey(
      revokedKey.homeKey,
      { purpose: 'relay', role: 'coordinator', coordinatorName: 'race', reason: 'reauth' },
      signer,
    ), 'invalid_home_key');

    const relayKey = await store.createHomeKey(
      principal,
      'race-home',
      'Relay race',
      ['relay:coordinator'],
    );
    const relayIssuer = new GatedIssuer(signer);
    const exchangeDuringPatch = store.exchangeHomeKey(
      relayKey.homeKey,
      { purpose: 'relay', role: 'coordinator', coordinatorName: 'race', reason: 'reconnect' },
      relayIssuer,
    );
    await relayIssuer.started;
    const nextRelay = 'wss://relay-race-two.example.test/ws';
    const patch = store.patchHome(principal, 'race-home', { relayUrl: nextRelay });
    await patch;
    relayIssuer.release();
    const issuedBeforePatch = await exchangeDuringPatch;
    expect(relayIssuer.grants).toHaveLength(1);
    expect(issuedBeforePatch.grant.audience).toBe(fixture.deployment.relay_audience);
    expect(decodedClaims(issuedBeforePatch.signed.token).aud).toBe(fixture.deployment.relay_audience);

    const retried = await store.exchangeHomeKey(
      relayKey.homeKey,
      { purpose: 'relay', role: 'coordinator', coordinatorName: 'race', reason: 'reconnect' },
      signer,
    );
    expect(retried.grant.audience).toBe(nextRelay);
    expect(decodedClaims(retried.signed.token).aud).toBe(nextRelay);
  });
});

test('the Functions URL is bound to the exact demo project', () => {
  expect(API_BASE).toContain(`/${PROJECT_ID}/`);
});
