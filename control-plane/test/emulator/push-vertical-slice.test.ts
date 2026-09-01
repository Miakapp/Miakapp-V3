import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createPrivateKey, sign, type JsonWebKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import {
  apiRequest,
  clearFirestore,
  jsonResponse,
  PROJECT_ID,
  signUp,
  type EmulatorUser,
} from './helpers.js';

interface ErrorResponse {
  readonly error: { readonly code: string };
}

interface SyntheticFixture {
  readonly test_only_private_keys: {
    readonly firebase: JsonWebKey & {
      readonly kid: string;
      readonly n: string;
      readonly e: string;
      readonly d: string;
      readonly p: string;
      readonly q: string;
      readonly dp: string;
      readonly dq: string;
      readonly qi: string;
    };
  };
}

interface ChallengeResponse {
  readonly schema: 'miakapp.push-challenge/1';
  readonly challenge_id: string;
  readonly expires_at: string;
}

interface DestinationMetadata {
  readonly destination_id: string;
  readonly provider: 'fcm';
  readonly created_at: string;
  readonly updated_at: string;
}

interface DestinationResponse {
  readonly schema: 'miakapp.push-destination-created/1';
  readonly destination: DestinationMetadata;
}

interface GrantMetadata {
  readonly grant_id: string;
  readonly home_id: string;
  readonly destination_id: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
}

interface GrantResponse {
  readonly schema: 'miakapp.push-grant/1';
  readonly grant: GrantMetadata;
}

interface KeyResponse {
  readonly home_key: string;
}

interface AccessResponse {
  readonly access_token: string;
}

const APP_ID = '1:1234567890:web:0123456789abcdef';
const APP_CHECK_ISSUER = 'https://firebaseappcheck.googleapis.com/1234567890';
const APP_CHECK_AUDIENCE = 'projects/1234567890';
const fixture = JSON.parse(readFileSync(
  new URL('../../../control-plane-contract/fixtures/v1/access-tokens.json', import.meta.url),
  'utf8',
)) as SyntheticFixture;
const admin = initializeApp({ projectId: PROJECT_ID }, 'control-plane-push-emulator-tests');
const firestore = getFirestore(admin);
let owner: EmulatorUser;
let stranger: EmulatorUser;

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function appCheckToken(
  appId = APP_ID,
  issuedAt = Math.floor(Date.now() / 1_000),
  expiresAt = issuedAt + 3_600,
): string {
  const privateKey = fixture.test_only_private_keys.firebase;
  const header = base64urlJson({ alg: 'RS256', kid: privateKey.kid, typ: 'JWT' });
  const claims = base64urlJson({
    iss: APP_CHECK_ISSUER,
    aud: [APP_CHECK_AUDIENCE],
    sub: appId,
    iat: issuedAt,
    exp: expiresAt,
  });
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${claims}`, 'ascii'),
    createPrivateKey({ key: privateKey, format: 'jwk' }),
  ).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

async function errorCode(response: Response): Promise<string> {
  return (await jsonResponse<ErrorResponse>(response)).error.code;
}

async function createHome(homeId: string): Promise<void> {
  const response = await apiRequest('POST', '/v1/homes', {
    token: owner.idToken,
    body: {
      home_id: homeId,
      name: `Home ${homeId}`,
      icon: 'house',
      relay_url: `wss://${homeId}.example.test/ws`,
    },
  });
  expect(response.status).toBe(201);
}

async function createPushKey(homeId: string): Promise<string> {
  const response = await apiRequest('POST', `/v1/homes/${homeId}/home-keys`, {
    token: owner.idToken,
    body: { label: 'Push key', scopes: ['push:send'] },
  });
  expect(response.status).toBe(201);
  return (await jsonResponse<KeyResponse>(response)).home_key;
}

async function exchangePushToken(homeKey: string): Promise<string> {
  const response = await apiRequest('POST', '/v1/access-tokens:exchange', {
    homeKey,
    body: { purpose: 'push' },
  });
  expect(response.status).toBe(200);
  return (await jsonResponse<AccessResponse>(response)).access_token;
}

async function issueChallenge(fid: string, token = owner.idToken): Promise<ChallengeResponse> {
  const response = await apiRequest('POST', '/v1/push-destinations:challenge', {
    token,
    appCheckToken: appCheckToken(),
    body: { provider: 'fcm', fid },
  });
  expect(response.status).toBe(202);
  const challenge = await jsonResponse<ChallengeResponse>(response);
  expect(challenge).toEqual({
    schema: 'miakapp.push-challenge/1',
    challenge_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    expires_at: expect.any(String),
  });
  expect(JSON.stringify(challenge)).not.toContain(fid);
  return challenge;
}

async function challengeSecret(challengeId: string): Promise<string> {
  const deliveries = await firestore.collection('emulatorPushDeliveries').get();
  const record = deliveries.docs.find((document) => (
    document.get('delivery_type') === 'challenge'
    && document.get('payload.challenge_id') === challengeId
  ));
  const secret = record?.get('payload.challenge_secret');
  if (typeof secret !== 'string') throw new Error('Synthetic challenge delivery was not recorded');
  return secret;
}

async function completeChallenge(
  challenge: ChallengeResponse,
  token = owner.idToken,
): Promise<{ readonly response: Response; readonly proof: string }> {
  const proof = `${challenge.challenge_id}.${await challengeSecret(challenge.challenge_id)}`;
  const response = await apiRequest('POST', '/v1/push-destinations:complete', {
    token,
    appCheckToken: appCheckToken(),
    pushProof: proof,
    body: {},
  });
  return Object.freeze({ response, proof });
}

async function registerDestination(fid: string): Promise<DestinationMetadata> {
  const completion = await completeChallenge(await issueChallenge(fid));
  expect(completion.response.status).toBe(201);
  const payload = await jsonResponse<DestinationResponse>(completion.response);
  expect(payload).toEqual({
    schema: 'miakapp.push-destination-created/1',
    destination: {
      destination_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      provider: 'fcm',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    },
  });
  expect(JSON.stringify(payload)).not.toContain(fid);
  return payload.destination;
}

async function createGrant(homeId: string, destinationId: string): Promise<GrantMetadata> {
  const response = await apiRequest('POST', `/v1/homes/${homeId}/push-grants`, {
    token: owner.idToken,
    body: { destination_id: destinationId },
  });
  expect(response.status).toBe(201);
  const payload = await jsonResponse<GrantResponse>(response);
  expect(payload).toEqual({
    schema: 'miakapp.push-grant/1',
    grant: {
      grant_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      home_id: homeId,
      destination_id: destinationId,
      created_at: expect.any(String),
      expires_at: expect.any(String),
      revoked_at: null,
    },
  });
  return payload.grant;
}

function seededGrantId(index: number): string {
  if (index === 1) return Buffer.from([...Array(15).fill(0), 1]).toString('base64url');
  if (index === 2) return Buffer.from([104, ...Array(15).fill(0)]).toString('base64url');
  return Buffer.alloc(16, index).toString('base64url');
}

async function seedFullGrantRegistry(homeId: string, destinationId: string): Promise<void> {
  const ownerRef = firestore.collection('controlHomes').doc(homeId)
    .collection('pushGrantOwners').doc(owner.userId);
  const baseTime = Date.now() - 60_000;
  const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1_000);
  for (let start = 0; start < 256; start += 200) {
    const batch = firestore.batch();
    for (let index = start; index < Math.min(start + 200, 256); index += 1) {
      const grantId = seededGrantId(index);
      const createdAt = Timestamp.fromMillis(baseTime + (index === 2 ? 1 : index));
      const status = index <= 1 ? 'active' : 'revoked';
      const storedDestinationId = index === 1 ? seededGrantId(255) : destinationId;
      const record = {
        schema: 'miakapp.push-grant-record/1',
        grant_id: grantId,
        home_id: homeId,
        owner_uid: owner.userId,
        destination_id: storedDestinationId,
        status,
        created_at: createdAt,
        expires_at: expiresAt,
        revoked_at: status === 'active' ? null : createdAt,
      };
      batch.create(ownerRef.collection('grants').doc(grantId), record);
      batch.create(firestore.collection('pushGrantIndex').doc(grantId), {
        schema: 'miakapp.push-grant-index/1',
        grant_id: grantId,
        home_id: homeId,
        owner_uid: owner.userId,
        destination_id: storedDestinationId,
        status,
        created_at: createdAt,
      });
    }
    await batch.commit();
  }
  await ownerRef.set({
    schema: 'miakapp.push-grant-owner/1',
    owner_uid: owner.userId,
    home_id: homeId,
    retained_grant_count: 256,
    updated_at: Timestamp.now(),
  });
}

beforeAll(async () => {
  [owner, stranger] = await Promise.all([
    signUp('push-owner@example.test'),
    signUp('push-stranger@example.test'),
  ]);
});

beforeEach(clearFirestore);

afterAll(async () => {
  await deleteApp(admin);
});

describe('Firebase Emulator FID-to-semantic-push vertical slice', () => {
  test('proves one FID, creates consent, attenuates a Home Key, and sends without exposing delivery data', async () => {
    await createHome('push-home');
    const homeKey = await createPushKey('push-home');
    const fid = 'csyntheticInstallation01';

    const noCredentials = await apiRequest('POST', '/v1/push-destinations:challenge', {
      body: { provider: 'fcm', fid },
    });
    expect(noCredentials.status).toBe(401);
    expect(await errorCode(noCredentials)).toBe('invalid_firebase_token');

    const noAppCheck = await apiRequest('POST', '/v1/push-destinations:challenge', {
      token: owner.idToken,
      body: { provider: 'fcm', fid },
    });
    expect(noAppCheck.status).toBe(401);
    expect(await errorCode(noAppCheck)).toBe('invalid_app_check_token');

    const destination = await registerDestination(fid);
    expect(destination).toEqual({
      destination_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      provider: 'fcm',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(JSON.stringify(destination)).not.toContain(fid);

    const privateDestination = await firestore.collection('users').doc(owner.userId)
      .collection('pushDestinations').doc(destination.destination_id).get();
    expect(privateDestination.get('fid')).toBe(fid);
    expect(privateDestination.get('fid_fingerprint')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(privateDestination.get('verified_app_id')).toBe(APP_ID);
    const challengeRecord = (await firestore.collection('users').doc(owner.userId)
      .collection('pushChallenges').limit(1).get()).docs[0]!;
    const rawChallengeSecret = await challengeSecret(challengeRecord.id);
    expect(challengeRecord.get('proof_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(challengeRecord.data())).not.toContain(rawChallengeSecret);
    expect(JSON.stringify(privateDestination.data())).not.toContain(rawChallengeSecret);

    const listed = await apiRequest('GET', '/v1/push-destinations', {
      token: owner.idToken,
      appCheckToken: appCheckToken(),
    });
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain(fid);
    expect(JSON.parse(listedText)).toEqual({
      schema: 'miakapp.push-destination-list/1',
      destinations: [destination],
    });

    const grant = await createGrant('push-home', destination.destination_id);
    expect(grant.home_id).toBe('push-home');
    expect(grant.destination_id).toBe(destination.destination_id);
    expect(grant.revoked_at).toBeNull();
    const listedGrants = await apiRequest('GET', '/v1/homes/push-home/push-grants', {
      token: owner.idToken,
    });
    expect(listedGrants.status).toBe(200);
    expect(await jsonResponse<{
      readonly schema: 'miakapp.push-grant-list/1';
      readonly grants: readonly GrantMetadata[];
    }>(listedGrants)).toEqual({
      schema: 'miakapp.push-grant-list/1',
      grants: [grant],
    });
    const directHomeKey = await apiRequest('POST', '/v1/push', {
      accessToken: homeKey,
      body: { grant_id: grant.grant_id, title: 'No', body: 'A Home Key is not a resource token' },
    });
    expect(directHomeKey.status).toBe(401);
    expect(await errorCode(directHomeKey)).toBe('invalid_access_token');
    const pushToken = await exchangePushToken(homeKey);
    const html = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: grant.grant_id, title: '<b>Unsafe</b>', body: 'No markup' },
    });
    expect(html.status).toBe(400);
    expect(await errorCode(html)).toBe('invalid_request');
    const sent = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: {
        grant_id: grant.grant_id,
        title: 'Synthetic alert',
        body: 'A synthetic sensor needs attention.',
        tag: 'sensor-alert',
      },
    });
    expect(sent.status).toBe(202);
    expect(await jsonResponse<{ readonly schema: string; readonly request_id: string }>(sent)).toEqual({
      schema: 'miakapp.push-accepted/1',
      request_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    });
    const deliveries = await firestore.collection('emulatorPushDeliveries').get();
    const semantic = deliveries.docs.filter((document) => (
      document.get('delivery_type') === 'semantic_notification'
    ));
    expect(semantic).toHaveLength(1);
    expect(semantic[0]?.data()).toMatchObject({
      schema: 'miakapp.emulator-push-delivery/1',
      provider: 'fcm',
      fid,
      payload: {
        grant_id: grant.grant_id,
        notification: {
          title: 'Synthetic alert',
          body: 'A synthetic sensor needs attention.',
          tag: 'sensor-alert',
        },
      },
    });

    await createHome('other-home');
    const otherToken = await exchangePushToken(await createPushKey('other-home'));
    const crossHome = await apiRequest('POST', '/v1/push', {
      accessToken: otherToken,
      body: { grant_id: grant.grant_id, title: 'No', body: 'Cross-home denial' },
    });
    expect(crossHome.status).toBe(403);
    expect(await errorCode(crossHome)).toBe('invalid_push_grant');
  });

  test('denies an otherwise valid grant only after its expiration', async () => {
    await createHome('expiry-home');
    const pushToken = await exchangePushToken(await createPushKey('expiry-home'));
    const destination = await registerDestination('cexpiryInstallation001');
    const grant = await createGrant('expiry-home', destination.destination_id);

    const beforeExpiry = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: grant.grant_id, title: 'Before', body: 'Grant is active' },
    });
    expect(beforeExpiry.status).toBe(202);

    const ownerRef = firestore.collection('controlHomes').doc('expiry-home')
      .collection('pushGrantOwners').doc(owner.userId);
    const createdAt = Timestamp.fromMillis(Date.now() - 60_000);
    await Promise.all([
      ownerRef.collection('grants').doc(grant.grant_id).update({
        created_at: createdAt,
        expires_at: Timestamp.fromMillis(Date.now() - 1),
      }),
      firestore.collection('pushGrantIndex').doc(grant.grant_id).update({
        created_at: createdAt,
      }),
    ]);

    const afterExpiry = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: grant.grant_id, title: 'After', body: 'Grant is expired' },
    });
    expect(afterExpiry.status).toBe(403);
    expect(await errorCode(afterExpiry)).toBe('invalid_push_grant');
    const semanticDeliveries = await firestore.collection('emulatorPushDeliveries')
      .where('delivery_type', '==', 'semantic_notification').get();
    expect(semanticDeliveries.size).toBe(1);
  });

  test('rejects wrong-principal, expired, malformed, and replayed destination proofs uniformly', async () => {
    const challenge = await issueChallenge('cproofInstallation0001');
    const secret = await challengeSecret(challenge.challenge_id);

    const malformed = await apiRequest('POST', '/v1/push-destinations:complete', {
      token: owner.idToken,
      appCheckToken: appCheckToken(),
      pushProof: `${challenge.challenge_id}.invalid`,
      body: {},
    });
    expect(malformed.status).toBe(401);
    expect(await errorCode(malformed)).toBe('invalid_destination_proof');

    const foreign = await apiRequest('POST', '/v1/push-destinations:complete', {
      token: stranger.idToken,
      appCheckToken: appCheckToken(),
      pushProof: `${challenge.challenge_id}.${secret}`,
      body: {},
    });
    expect(foreign.status).toBe(401);
    expect(await errorCode(foreign)).toBe('invalid_destination_proof');

    const wrong = await apiRequest('POST', '/v1/push-destinations:complete', {
      token: owner.idToken,
      appCheckToken: appCheckToken(),
      pushProof: `${challenge.challenge_id}.${'A'.repeat(43)}`,
      body: {},
    });
    expect(wrong.status).toBe(401);
    expect(await errorCode(wrong)).toBe('invalid_destination_proof');

    const completed = await apiRequest('POST', '/v1/push-destinations:complete', {
      token: owner.idToken,
      appCheckToken: appCheckToken(),
      pushProof: `${challenge.challenge_id}.${secret}`,
      body: {},
    });
    expect(completed.status).toBe(201);
    const replayed = await apiRequest('POST', '/v1/push-destinations:complete', {
      token: owner.idToken,
      appCheckToken: appCheckToken(),
      pushProof: `${challenge.challenge_id}.${secret}`,
      body: {},
    });
    expect(replayed.status).toBe(401);
    expect(await errorCode(replayed)).toBe('invalid_destination_proof');

    const expired = await issueChallenge('cexpiredInstallation01');
    await firestore.collection('users').doc(owner.userId).collection('pushChallenges')
      .doc(expired.challenge_id).update({ expires_at: Timestamp.fromMillis(Date.now() - 1) });
    const expiredCompletion = await completeChallenge(expired);
    expect(expiredCompletion.response.status).toBe(401);
    expect(await errorCode(expiredCompletion.response)).toBe('invalid_destination_proof');

    const afterExpiry = await issueChallenge('cpruningInstallation01');
    const [expiredRecord, replacementRecord] = await Promise.all([
      firestore.collection('users').doc(owner.userId).collection('pushChallenges')
        .doc(expired.challenge_id).get(),
      firestore.collection('users').doc(owner.userId).collection('pushChallenges')
        .doc(afterExpiry.challenge_id).get(),
    ]);
    expect(expiredRecord.exists).toBe(false);
    expect(replacementRecord.exists).toBe(true);
  });

  test('linearizes concurrent completion so one proof creates exactly one destination', async () => {
    const challenge = await issueChallenge('cconcurrentInstall0001');
    const proof = `${challenge.challenge_id}.${await challengeSecret(challenge.challenge_id)}`;
    const attempts = await Promise.all(Array.from({ length: 2 }, () => (
      apiRequest('POST', '/v1/push-destinations:complete', {
        token: owner.idToken,
        appCheckToken: appCheckToken(),
        pushProof: proof,
        body: {},
      })
    )));
    expect(attempts.map((response) => response.status).sort()).toEqual([201, 401]);
    const [destinations, ownerState] = await Promise.all([
      firestore.collection('users').doc(owner.userId).collection('pushDestinations').get(),
      firestore.collection('controlPushOwners').doc(owner.userId).get(),
    ]);
    expect(destinations.size).toBe(1);
    expect(ownerState.get('active_destination_count')).toBe(1);
  });

  test('enforces challenge and destination ceilings at the exact boundary', async () => {
    for (let index = 0; index < 3; index += 1) {
      await issueChallenge(`challenge-fid-${index}`);
    }
    const concurrentBoundary = await Promise.all([3, 4].map((index) => (
      apiRequest('POST', '/v1/push-destinations:challenge', {
        token: owner.idToken,
        appCheckToken: appCheckToken(),
        body: { provider: 'fcm', fid: `challenge-fid-${index}` },
      })
    )));
    expect(concurrentBoundary.map((response) => response.status).sort()).toEqual([202, 413]);
    const boundaryDenial = concurrentBoundary.find((response) => response.status === 413);
    if (boundaryDenial === undefined) throw new Error('Concurrent challenge admission did not reject one request');
    expect(await errorCode(boundaryDenial)).toBe('limit_exceeded');
    expect((await firestore.collection('users').doc(owner.userId).collection('pushChallenges').get()).size)
      .toBe(4);
    const challengeOverflow = await apiRequest('POST', '/v1/push-destinations:challenge', {
      token: owner.idToken,
      appCheckToken: appCheckToken(),
      body: { provider: 'fcm', fid: 'challenge-fid-overflow' },
    });
    expect(challengeOverflow.status).toBe(413);
    expect(await errorCode(challengeOverflow)).toBe('limit_exceeded');

    await clearFirestore();
    for (let index = 0; index < 16; index += 1) {
      await registerDestination(`destination-fid-${String(index).padStart(2, '0')}`);
    }
    const overflowChallenge = await issueChallenge('destination-fid-overflow');
    const overflow = await completeChallenge(overflowChallenge);
    expect(overflow.response.status).toBe(413);
    expect(await errorCode(overflow.response)).toBe('limit_exceeded');
    const privateDestinations = await firestore.collection('users').doc(owner.userId)
      .collection('pushDestinations').get();
    expect(privateDestinations.size).toBe(16);
  });

  test('renews and revokes grants uniformly, and destination deletion immediately removes authority', async () => {
    await createHome('grant-home');
    const pushToken = await exchangePushToken(await createPushKey('grant-home'));
    const destination = await registerDestination('cgrantInstallation001');
    const first = await createGrant('grant-home', destination.destination_id);
    const replacement = await createGrant('grant-home', destination.destination_id);
    expect(replacement.grant_id).not.toBe(first.grant_id);

    const oldDenied = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: first.grant_id, title: 'Old', body: 'Revoked by renewal' },
    });
    expect(oldDenied.status).toBe(403);
    expect(await errorCode(oldDenied)).toBe('invalid_push_grant');

    const replacementAccepted = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: replacement.grant_id, title: 'New', body: 'Current consent' },
    });
    expect(replacementAccepted.status).toBe(202);

    const foreignRevoke = await apiRequest(
      'DELETE',
      `/v1/homes/grant-home/push-grants/${replacement.grant_id}`,
      { token: stranger.idToken },
    );
    expect(foreignRevoke.status).toBe(204);
    const afterForeignRevoke = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: replacement.grant_id, title: 'Still active', body: 'Foreign delete was inert' },
    });
    expect(afterForeignRevoke.status).toBe(202);

    const absentRevoke = await apiRequest(
      'DELETE',
      `/v1/homes/grant-home/push-grants/${seededGrantId(200)}`,
      { token: owner.idToken },
    );
    expect(absentRevoke.status).toBe(204);
    const revoked = await apiRequest(
      'DELETE',
      `/v1/homes/grant-home/push-grants/${replacement.grant_id}`,
      { token: owner.idToken },
    );
    expect(revoked.status).toBe(204);
    const repeatedRevoke = await apiRequest(
      'DELETE',
      `/v1/homes/grant-home/push-grants/${replacement.grant_id}`,
      { token: owner.idToken },
    );
    expect(repeatedRevoke.status).toBe(204);
    const afterRevoke = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: replacement.grant_id, title: 'No', body: 'Revoked consent' },
    });
    expect(afterRevoke.status).toBe(403);

    const third = await createGrant('grant-home', destination.destination_id);
    const foreignDestinationDelete = await apiRequest(
      'DELETE',
      `/v1/push-destinations/${destination.destination_id}`,
      { token: stranger.idToken, appCheckToken: appCheckToken() },
    );
    expect(foreignDestinationDelete.status).toBe(204);
    const absentDestinationDelete = await apiRequest(
      'DELETE',
      `/v1/push-destinations/${seededGrantId(201)}`,
      { token: owner.idToken, appCheckToken: appCheckToken() },
    );
    expect(absentDestinationDelete.status).toBe(204);
    const afterForeignDestinationDelete = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: third.grant_id, title: 'Still active', body: 'Foreign delete was inert' },
    });
    expect(afterForeignDestinationDelete.status).toBe(202);
    const deleted = await apiRequest('DELETE', `/v1/push-destinations/${destination.destination_id}`, {
      token: owner.idToken,
      appCheckToken: appCheckToken(),
    });
    expect(deleted.status).toBe(204);
    const repeatedDelete = await apiRequest('DELETE', `/v1/push-destinations/${destination.destination_id}`, {
      token: owner.idToken,
      appCheckToken: appCheckToken(),
    });
    expect(repeatedDelete.status).toBe(204);
    const afterDestinationDelete = await apiRequest('POST', '/v1/push', {
      accessToken: pushToken,
      body: { grant_id: third.grant_id, title: 'No', body: 'Destination removed' },
    });
    expect(afterDestinationDelete.status).toBe(403);
    expect(await errorCode(afterDestinationDelete)).toBe('invalid_push_grant');
  });

  test('bounds the 256-record grant list, compacts byte-wise, and fails closed on counter drift', async () => {
    const retentionHomeId = `h${'a'.repeat(62)}`;
    await createHome(retentionHomeId);
    const destination = await registerDestination('cretentionInstallation1');
    await seedFullGrantRegistry(retentionHomeId, destination.destination_id);

    const maximumList = await apiRequest('GET', `/v1/homes/${retentionHomeId}/push-grants`, {
      token: owner.idToken,
    });
    expect(maximumList.status).toBe(200);
    const maximumListText = await maximumList.text();
    expect(Buffer.byteLength(maximumListText, 'utf8')).toBeGreaterThan(64 * 1_024);
    expect(Buffer.byteLength(maximumListText, 'utf8')).toBeLessThanOrEqual(96 * 1_024);
    expect((JSON.parse(maximumListText) as { readonly grants: readonly unknown[] }).grants).toHaveLength(256);

    const replacement = await createGrant(retentionHomeId, destination.destination_id);
    const ownerRef = firestore.collection('controlHomes').doc(retentionHomeId)
      .collection('pushGrantOwners').doc(owner.userId);
    const [ownerState, grants, oldActive, invalidatedGrant] = await Promise.all([
      ownerRef.get(),
      ownerRef.collection('grants').get(),
      ownerRef.collection('grants').doc(seededGrantId(0)).get(),
      ownerRef.collection('grants').doc(seededGrantId(1)).get(),
    ]);
    expect(ownerState.get('retained_grant_count')).toBe(256);
    expect(grants.size).toBe(256);
    expect(oldActive.get('status')).toBe('revoked');
    expect(invalidatedGrant.exists).toBe(false);
    expect(grants.docs.filter((document) => document.get('status') === 'active').map((document) => document.id))
      .toEqual([replacement.grant_id]);

    const expiredCreatedAt = Timestamp.fromMillis(Date.now() - 120_000);
    await Promise.all([
      ownerRef.collection('grants').doc(replacement.grant_id).update({
        created_at: expiredCreatedAt,
        expires_at: Timestamp.fromMillis(Date.now() - 1),
      }),
      firestore.collection('pushGrantIndex').doc(replacement.grant_id).update({
        created_at: expiredCreatedAt,
      }),
    ]);
    const afterExpiredPredecessor = await createGrant(retentionHomeId, destination.destination_id);
    const [expiredGrant, expiredIndex, afterExpiryGrants] = await Promise.all([
      ownerRef.collection('grants').doc(replacement.grant_id).get(),
      firestore.collection('pushGrantIndex').doc(replacement.grant_id).get(),
      ownerRef.collection('grants').get(),
    ]);
    expect(expiredGrant.exists).toBe(false);
    expect(expiredIndex.exists).toBe(false);
    expect(afterExpiryGrants.size).toBe(256);
    expect(afterExpiryGrants.docs
      .filter((document) => document.get('status') === 'active')
      .map((document) => document.id))
      .toEqual([afterExpiredPredecessor.grant_id]);

    await ownerRef.update({ retained_grant_count: 255 });
    const malformed = await apiRequest('POST', `/v1/homes/${retentionHomeId}/push-grants`, {
      token: owner.idToken,
      body: { destination_id: destination.destination_id },
    });
    expect(malformed.status).toBe(503);
    expect(await errorCode(malformed)).toBe('temporarily_unavailable');
    expect((await ownerRef.collection('grants').get()).size).toBe(256);
  });
});
