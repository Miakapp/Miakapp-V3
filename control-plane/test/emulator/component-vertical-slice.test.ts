import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

import { loadEmulatorConfig } from '../../src/config.js';
import { parseHomeKey } from '../../src/crypto.js';
import { type ComponentRequirements } from '../../src/types.js';
import {
  RANDOM_SUBJECT_ATTEMPTS,
  reserveAdmissionSubjects,
} from './admission-fixture.js';
import {
  ALLOWED_ORIGIN,
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
  readonly error: { readonly code: string };
}

interface KeyResponse {
  readonly home_key: string;
}

interface AccessResponse {
  readonly access_token: string;
  readonly key: { readonly id: string };
}

interface UploadResponse {
  readonly schema: 'miakapp.component-upload/1';
  readonly upload_id: string;
  readonly upload_url: string;
  readonly upload_token: string;
  readonly expires_at: string;
}

interface UploadStatusResponse {
  readonly schema: 'miakapp.component-upload-status/1';
  readonly upload_id: string;
  readonly status: 'awaiting_upload' | 'delivered' | 'finalized';
  readonly release: string;
  readonly abi: 'miakapp.component/1';
  readonly sha256: string;
  readonly size: number;
  readonly requires: ComponentRequirements;
  readonly expires_at: string;
}

interface ReleaseResponse {
  readonly schema: 'miakapp.component-release/1';
  readonly release: string;
  readonly abi: 'miakapp.component/1';
  readonly sha256: string;
  readonly size: number;
  readonly requires: ComponentRequirements;
  readonly finalized_at: string;
}

interface PointerResponse {
  readonly schema: 'miakapp.component-pointer/1';
  readonly home_id: string;
  readonly generation: number;
  readonly release: string;
  readonly abi: 'miakapp.component/1';
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
  readonly requires: ComponentRequirements;
}

type PublisherAuthorization =
  | { readonly token: string }
  | { readonly accessToken: string }
  | { readonly homeKey: string };

const HOME_ID = 'component-home';
const REQUIREMENTS: ComponentRequirements = Object.freeze({
  state_read: Object.freeze(['global.temperature']),
  event_subscribe: Object.freeze(['motion.changed']),
  event_publish: Object.freeze([]),
  call: Object.freeze(['lighting.set']),
  presentation: Object.freeze([]),
});
const admin = initializeApp({
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`,
}, 'control-plane-component-emulator-tests');
const firestore = getFirestore(admin);
const config = loadEmulatorConfig({
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: PROJECT_ID,
} as NodeJS.ProcessEnv);
const bucket = getStorage(admin).bucket(config.componentBucket);
let rules: RulesTestEnvironment;
let owner: EmulatorUser;
let stranger: EmulatorUser;
let userSequence = 0;

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url');
}

async function errorCode(response: Response): Promise<string> {
  return (await jsonResponse<ErrorResponse>(response)).error.code;
}

async function createHome(): Promise<void> {
  const response = await apiRequest('POST', '/v1/homes', {
    token: owner.idToken,
    body: {
      home_id: HOME_ID,
      name: 'Component Home',
      icon: 'house',
      relay_url: 'wss://component-relay.example.test/ws',
    },
  });
  expect(response.status).toBe(201);
}

async function createKey(scopes: readonly string[] = ['components:publish']): Promise<string> {
  for (let attempt = 0; attempt < RANDOM_SUBJECT_ATTEMPTS; attempt += 1) {
    const response = await apiRequest('POST', `/v1/homes/${HOME_ID}/home-keys`, {
      token: owner.idToken,
      body: { label: 'Component publisher', scopes },
    });
    expect(response.status).toBe(201);
    const homeKey = (await jsonResponse<KeyResponse>(response)).home_key;
    if (reserveAdmissionSubjects([{
      budget: 'access.exchange.key',
      subject: parseHomeKey(homeKey).keyId,
    }])) return homeKey;
  }
  throw new Error('Could not create a collision-free component Home Key fixture');
}

async function exchange(homeKey: string, purpose: 'components' | 'push' = 'components'): Promise<AccessResponse> {
  const response = await apiRequest('POST', '/v1/access-tokens:exchange', {
    homeKey,
    body: { purpose },
  });
  expect(response.status).toBe(200);
  return jsonResponse<AccessResponse>(response);
}

async function issueUpload(
  authorization: PublisherAuthorization,
  bytes: Uint8Array,
  release: string,
  declaredDigest = digest(bytes),
  declaredSize = bytes.byteLength,
  declaredAbi = 'miakapp.component/1',
): Promise<{ readonly response: Response; readonly upload?: UploadResponse }> {
  for (let attempt = 0; attempt < RANDOM_SUBJECT_ATTEMPTS; attempt += 1) {
    const response = await apiRequest('POST', `/v1/homes/${HOME_ID}/component-uploads`, {
      ...authorization,
      body: {
        release,
        abi: declaredAbi,
        sha256: declaredDigest,
        size: declaredSize,
        requires: REQUIREMENTS,
      },
    });
    if (!response.ok) return Object.freeze({ response });
    const upload = await jsonResponse<UploadResponse>(response.clone());
    if (reserveAdmissionSubjects([{
      budget: 'component.upload.delivery.upload',
      subject: upload.upload_id,
    }])) return Object.freeze({ response, upload });
    await response.body?.cancel();
  }
  throw new Error('Could not issue a collision-free component upload fixture');
}

async function deliver(upload: UploadResponse, bytes: Uint8Array, headers?: Readonly<Record<string, string>>): Promise<Response> {
  return apiRequest('PUT', `/v1/component-uploads/${upload.upload_id}`, {
    accessToken: upload.upload_token,
    rawBytes: bytes,
    contentType: 'application/javascript; charset=utf-8',
    ...(headers === undefined ? {} : { headers }),
  });
}

async function finalize(
  authorization: PublisherAuthorization,
  uploadId: string,
): Promise<Response> {
  return apiRequest('POST', `/v1/homes/${HOME_ID}/component-uploads/${uploadId}:finalize`, {
    ...authorization,
    body: {},
  });
}

async function publish(
  authorization: PublisherAuthorization,
  bytes: Uint8Array,
  release: string,
): Promise<ReleaseResponse> {
  const issued = await issueUpload(authorization, bytes, release);
  expect(issued.response.status).toBe(201);
  if (issued.upload === undefined) throw new Error('Upload was not issued');
  expect((await deliver(issued.upload, bytes)).status).toBe(204);
  const response = await finalize(authorization, issued.upload.upload_id);
  expect(response.status).toBe(200);
  return jsonResponse<ReleaseResponse>(response);
}

async function activate(
  authorization: PublisherAuthorization,
  sha256: string,
  expectedGeneration: number,
  generation: number,
): Promise<Response> {
  return apiRequest('POST', `/v1/homes/${HOME_ID}/component-releases:activate`, {
    ...authorization,
    body: {
      sha256,
      expected_generation: expectedGeneration,
      generation,
    },
  });
}

async function artifactRequest(publicUrl: string, options: Parameters<typeof apiRequest>[2] = {}): Promise<Response> {
  const url = new URL(publicUrl);
  const base = new URL(config.componentArtifactBaseUrl);
  expect(url.origin).toBe(base.origin);
  expect(url.search).toBe('');
  expect(url.hash).toBe('');
  expect(url.pathname.startsWith(`${base.pathname}/`)).toBe(true);
  return apiRequest('GET', url.pathname, options);
}

beforeAll(async () => {
  rules = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      ...parseHost(FIRESTORE_HOST),
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      ...parseHost(STORAGE_HOST),
      rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  userSequence += 1;
  await clearFirestore(firestore);
  const [files] = await bucket.getFiles();
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  owner = await signUp(`component-owner-${userSequence}@example.test`);
  stranger = await signUp(`component-stranger-${userSequence}@example.test`);
  await createHome();
});

afterAll(async () => {
  await rules.cleanup();
  await deleteApp(admin);
});

describe('component publication vertical slice', () => {
  test('selects one publisher profile and stores only a one-use verifier', async () => {
    const bytes = Buffer.from('self.onmessage = () => self.postMessage("owner");\n');
    const key = await createKey(['components:publish', 'push:send']);
    const componentAccess = await exchange(key);
    const pushAccess = await exchange(key, 'push');

    const directKey = await issueUpload({ homeKey: key }, bytes, '2026-09-01.direct-key');
    expect(directKey.response.status).toBe(401);
    expect(await errorCode(directKey.response)).toBe('invalid_access_token');

    const wrongAudience = await issueUpload(
      { accessToken: pushAccess.access_token },
      bytes,
      '2026-09-01.push-token',
    );
    expect(wrongAudience.response.status).toBe(401);
    expect(await errorCode(wrongAudience.response)).toBe('invalid_access_token');

    const invalidAbi = await issueUpload(
      { accessToken: componentAccess.access_token },
      bytes,
      '2026-09-01.invalid-abi',
      digest(bytes),
      bytes.byteLength,
      'miakapp.component/2',
    );
    expect(invalidAbi.response.status).toBe(400);
    expect(await errorCode(invalidAbi.response)).toBe('invalid_request');
    const zeroSize = await issueUpload(
      { accessToken: componentAccess.access_token },
      bytes,
      '2026-09-01.zero-size',
      digest(bytes),
      0,
    );
    expect(zeroSize.response.status).toBe(400);
    expect(await errorCode(zeroSize.response)).toBe('invalid_request');
    const oversized = await issueUpload(
      { accessToken: componentAccess.access_token },
      bytes,
      '2026-09-01.oversized',
      digest(bytes),
      2_097_153,
    );
    expect(oversized.response.status).toBe(413);
    expect(await errorCode(oversized.response)).toBe('limit_exceeded');

    const foreignOwner = await issueUpload({ token: stranger.idToken }, bytes, '2026-09-01.foreign');
    expect(foreignOwner.response.status).toBe(403);
    expect(await errorCode(foreignOwner.response)).toBe('not_home_owner');

    const staleOwner = await issueUpload(
      { token: await staleAuthenticationToken(owner) },
      bytes,
      '2026-09-01.stale',
    );
    expect(staleOwner.response.status).toBe(401);
    expect(await errorCode(staleOwner.response)).toBe('recent_authentication_required');

    const issued = await issueUpload({ accessToken: componentAccess.access_token }, bytes, '2026-09-01.1');
    expect(issued.response.status).toBe(201);
    if (issued.upload === undefined) throw new Error('Upload was not issued');
    expect(issued.upload).toEqual({
      schema: 'miakapp.component-upload/1',
      upload_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      upload_url: `https://control.example.test/v1/component-uploads/${issued.upload.upload_id}`,
      upload_token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expires_at: expect.any(String),
    });
    expect(new URL(issued.upload.upload_url).search).toBe('');

    const privateRecord = (await firestore.collection('controlHomes').doc(HOME_ID)
      .collection('componentUploads').doc(issued.upload.upload_id).get()).data();
    const indexRecord = (await firestore.collection('componentUploadIndex')
      .doc(issued.upload.upload_id).get()).data();
    if (privateRecord === undefined
      || !(privateRecord.created_at instanceof Timestamp)
      || !(privateRecord.expires_at instanceof Timestamp)) {
      throw new Error('Private upload timing evidence missing');
    }
    expect(privateRecord.expires_at.toMillis() - privateRecord.created_at.toMillis()).toBe(900_000);
    expect(new Date(issued.upload.expires_at).getTime()).toBe(privateRecord.expires_at.toMillis());
    expect(privateRecord).toEqual(expect.objectContaining({
      capability_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      publisher_kind: 'access_token',
      publisher_id: componentAccess.key.id,
      status: 'awaiting_upload',
    }));
    expect(JSON.stringify({ privateRecord, indexRecord })).not.toContain(issued.upload.upload_token);
    expect(JSON.stringify({ privateRecord, indexRecord })).not.toContain(issued.upload.upload_url);

    const awaitingResponse = await apiRequest(
      'GET',
      `/v1/homes/${HOME_ID}/component-uploads/${issued.upload.upload_id}`,
      { accessToken: componentAccess.access_token },
    );
    expect(awaitingResponse.status).toBe(200);
    const awaiting = await jsonResponse<UploadStatusResponse>(awaitingResponse);
    expect(awaiting).toEqual({
      schema: 'miakapp.component-upload-status/1',
      upload_id: issued.upload.upload_id,
      status: 'awaiting_upload',
      release: '2026-09-01.1',
      abi: 'miakapp.component/1',
      sha256: digest(bytes),
      size: bytes.byteLength,
      requires: REQUIREMENTS,
      expires_at: issued.upload.expires_at,
    });
    expect(JSON.stringify(awaiting)).not.toContain(issued.upload.upload_token);
    expect(JSON.stringify(awaiting)).not.toContain(issued.upload.upload_url);

    const badEncoding = await deliver(issued.upload, bytes, { 'Content-Encoding': 'gzip' });
    expect(badEncoding.status).toBe(400);
    await badEncoding.body?.cancel();
    expect((await deliver(issued.upload, bytes)).status).toBe(204);
    const replay = await deliver(issued.upload, bytes);
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe('invalid_upload_capability');

    const expiring = await issueUpload(
      { accessToken: componentAccess.access_token },
      bytes,
      '2026-09-01.expired',
    );
    expect(expiring.response.status).toBe(201);
    if (expiring.upload === undefined) throw new Error('Expiring upload was not issued');
    const pastNow = Date.now();
    const pastCreated = Timestamp.fromMillis(pastNow - 1_200_000);
    const pastExpiry = Timestamp.fromMillis(pastNow - 300_000);
    await Promise.all([
      firestore.collection('controlHomes').doc(HOME_ID).collection('componentUploads')
        .doc(expiring.upload.upload_id).update({ created_at: pastCreated, expires_at: pastExpiry }),
      firestore.collection('componentUploadIndex').doc(expiring.upload.upload_id)
        .update({ created_at: pastCreated }),
    ]);
    const expired = await deliver(expiring.upload, bytes);
    expect(expired.status).toBe(401);
    expect(await errorCode(expired)).toBe('invalid_upload_capability');

    const overlong = await issueUpload(
      { accessToken: componentAccess.access_token },
      bytes,
      '2026-09-01.overlong',
    );
    expect(overlong.response.status).toBe(201);
    if (overlong.upload === undefined) throw new Error('Overlong upload was not issued');
    const overlongRef = firestore.collection('controlHomes').doc(HOME_ID)
      .collection('componentUploads').doc(overlong.upload.upload_id);
    const overlongSnapshot = await overlongRef.get();
    const overlongCreated = overlongSnapshot.get('created_at');
    if (!(overlongCreated instanceof Timestamp)) throw new Error('Overlong upload creation time missing');
    await overlongRef.update({
      expires_at: Timestamp.fromMillis(overlongCreated.toMillis() + 900_001),
    });
    const overlongDelivery = await deliver(overlong.upload, bytes);
    expect(overlongDelivery.status).toBe(503);
    expect(await errorCode(overlongDelivery)).toBe('temporarily_unavailable');

    const future = await issueUpload(
      { accessToken: componentAccess.access_token },
      bytes,
      '2026-09-01.future',
    );
    expect(future.response.status).toBe(201);
    if (future.upload === undefined) throw new Error('Future upload was not issued');
    const futureCreated = Timestamp.fromMillis(Date.now() + 60_000);
    await Promise.all([
      firestore.collection('controlHomes').doc(HOME_ID).collection('componentUploads')
        .doc(future.upload.upload_id).update({
          created_at: futureCreated,
          expires_at: Timestamp.fromMillis(futureCreated.toMillis() + 900_000),
        }),
      firestore.collection('componentUploadIndex').doc(future.upload.upload_id)
        .update({ created_at: futureCreated }),
    ]);
    const futureDelivery = await deliver(future.upload, bytes);
    expect(futureDelivery.status).toBe(401);
    expect(await errorCode(futureDelivery)).toBe('invalid_upload_capability');
  });

  test('derives finalization from Storage read-back and reconciles uncertain outcomes', async () => {
    const bytes = Buffer.from('self.onmessage = () => self.postMessage("verified");\n');
    const wrongBytes = Buffer.from('self.onmessage = () => self.postMessage("altered!");\n');
    const firstKey = await createKey();
    const secondKey = await createKey();
    const firstAccess = await exchange(firstKey);
    const secondAccess = await exchange(secondKey);
    const firstAuth = { accessToken: firstAccess.access_token } as const;

    const mismatched = await issueUpload(firstAuth, wrongBytes, '2026-09-01.mismatch', digest(bytes));
    expect(mismatched.response.status).toBe(201);
    if (mismatched.upload === undefined) throw new Error('Mismatched upload was not issued');
    expect((await deliver(mismatched.upload, wrongBytes)).status).toBe(204);
    const mismatchFinalize = await finalize(firstAuth, mismatched.upload.upload_id);
    expect(mismatchFinalize.status).toBe(422);
    expect(await errorCode(mismatchFinalize)).toBe('invalid_artifact');

    const wrongSize = await issueUpload(
      firstAuth,
      bytes,
      '2026-09-01.size-mismatch',
      digest(bytes),
      bytes.byteLength + 1,
    );
    expect(wrongSize.response.status).toBe(201);
    if (wrongSize.upload === undefined) throw new Error('Size-mismatched upload was not issued');
    expect((await deliver(wrongSize.upload, bytes)).status).toBe(204);
    const wrongSizeFinalize = await finalize(firstAuth, wrongSize.upload.upload_id);
    expect(wrongSizeFinalize.status).toBe(422);
    expect(await errorCode(wrongSizeFinalize)).toBe('invalid_artifact');

    const invalidBytes = Buffer.from('export default 1;\n');
    const invalid = await issueUpload(firstAuth, invalidBytes, '2026-09-01.invalid');
    expect(invalid.response.status).toBe(201);
    if (invalid.upload === undefined) throw new Error('Invalid upload was not issued');
    expect((await deliver(invalid.upload, invalidBytes)).status).toBe(204);
    const invalidFinalize = await finalize(firstAuth, invalid.upload.upload_id);
    expect(invalidFinalize.status).toBe(422);
    expect(await errorCode(invalidFinalize)).toBe('invalid_artifact');

    const interruptedBytes = Buffer.from('self.onmessage = () => self.postMessage("interrupted");\n');
    const interrupted = await issueUpload(firstAuth, interruptedBytes, '2026-09-01.interrupted');
    expect(interrupted.response.status).toBe(201);
    if (interrupted.upload === undefined) throw new Error('Interrupted upload was not issued');
    expect((await deliver(interrupted.upload, interruptedBytes)).status).toBe(204);
    const interruptedIndexRef = firestore.collection('componentUploadIndex')
      .doc(interrupted.upload.upload_id);
    await interruptedIndexRef.update({ status: 'awaiting_upload' });
    const interruptedFinalize = await finalize(firstAuth, interrupted.upload.upload_id);
    expect(interruptedFinalize.status).toBe(503);
    expect(await errorCode(interruptedFinalize)).toBe('temporarily_unavailable');
    const interruptedDigest = digest(interruptedBytes);
    const interruptedUrl = `${config.componentArtifactBaseUrl}/${interruptedDigest}.js`;
    const interruptedFile = bucket.file(`components/${interruptedDigest}.js`);
    expect((await interruptedFile.exists())[0]).toBe(true);
    expect((await firestore.collection('componentArtifacts')
      .doc(`${interruptedDigest}.js`).get()).exists).toBe(false);
    expect((await firestore.collection('controlHomes').doc(HOME_ID)
      .collection('componentReleases').doc(interruptedDigest).get()).exists).toBe(false);
    const publicBeforeCommit = await artifactRequest(interruptedUrl);
    expect(publicBeforeCommit.status).toBe(422);
    expect(await errorCode(publicBeforeCommit)).toBe('invalid_artifact');
    const anonymousBeforeCommit = rules.unauthenticatedContext();
    await assertFails(getBytes(ref(
      anonymousBeforeCommit.storage(`gs://${config.componentBucket}`),
      `components/${interruptedDigest}.js`,
    )));
    await interruptedIndexRef.update({ status: 'delivered' });
    const interruptedRetry = await finalize(firstAuth, interrupted.upload.upload_id);
    expect(interruptedRetry.status).toBe(200);
    expect((await firestore.collection('componentArtifacts')
      .doc(`${interruptedDigest}.js`).get()).data()).toEqual({
      schema: 'miakapp.component-artifact-publication/1',
      artifact: `${interruptedDigest}.js`,
      sha256: interruptedDigest,
      public_url: interruptedUrl,
      published_at: expect.any(Timestamp),
    });
    await assertFails(getBytes(ref(
      anonymousBeforeCommit.storage(`gs://${config.componentBucket}`),
      `components/${interruptedDigest}.js`,
    )));
    const publicAfterCommit = await artifactRequest(interruptedUrl);
    expect(publicAfterCommit.status).toBe(200);
    expect(Buffer.from(await publicAfterCommit.arrayBuffer())).toEqual(interruptedBytes);
    expect(publicAfterCommit.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(publicAfterCommit.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');
    expect(publicAfterCommit.headers.get('ETag')).toBe(`"${interruptedDigest}"`);
    expect(publicAfterCommit.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);

    const issued = await issueUpload(firstAuth, bytes, '2026-09-01.verified');
    expect(issued.response.status).toBe(201);
    if (issued.upload === undefined) throw new Error('Verified upload was not issued');
    expect((await deliver(issued.upload, bytes)).status).toBe(204);

    const uploadRef = firestore.collection('controlHomes').doc(HOME_ID)
      .collection('componentUploads').doc(issued.upload.upload_id);
    const uploadIndexRef = firestore.collection('componentUploadIndex').doc(issued.upload.upload_id);
    await Promise.all([
      uploadRef.update({ status: 'delivery_reserved', delivered_at: null }),
      uploadIndexRef.update({ status: 'delivery_reserved' }),
    ]);
    const reconciledResponse = await apiRequest(
      'GET',
      `/v1/homes/${HOME_ID}/component-uploads/${issued.upload.upload_id}`,
      firstAuth,
    );
    expect(reconciledResponse.status).toBe(200);
    const reconciled = await jsonResponse<UploadStatusResponse>(reconciledResponse);
    expect(reconciled).toEqual({
      schema: 'miakapp.component-upload-status/1',
      upload_id: issued.upload.upload_id,
      status: 'delivered',
      release: '2026-09-01.verified',
      abi: 'miakapp.component/1',
      sha256: digest(bytes),
      size: bytes.byteLength,
      requires: REQUIREMENTS,
      expires_at: issued.upload.expires_at,
    });
    expect(JSON.stringify(reconciled)).not.toContain(issued.upload.upload_token);
    expect(JSON.stringify(reconciled)).not.toContain(issued.upload.upload_url);
    expect((await uploadRef.get()).get('status')).toBe('delivered');

    const mismatchPublisher = await finalize(
      { accessToken: secondAccess.access_token },
      issued.upload.upload_id,
    );
    expect(mismatchPublisher.status).toBe(403);
    expect(await errorCode(mismatchPublisher)).toBe('publisher_mismatch');

    const refreshedAccess = await exchange(firstKey);
    expect(refreshedAccess.key.id).toBe(firstAccess.key.id);
    const finalizedResponse = await finalize(
      { accessToken: refreshedAccess.access_token },
      issued.upload.upload_id,
    );
    expect(finalizedResponse.status).toBe(200);
    const finalized = await jsonResponse<ReleaseResponse>(finalizedResponse);
    expect(finalized).toEqual({
      schema: 'miakapp.component-release/1',
      release: '2026-09-01.verified',
      abi: 'miakapp.component/1',
      sha256: digest(bytes),
      size: bytes.byteLength,
      requires: REQUIREMENTS,
      finalized_at: expect.any(String),
    });

    const inspected = await apiRequest(
      'GET',
      `/v1/homes/${HOME_ID}/component-releases/${digest(bytes)}`,
      { accessToken: refreshedAccess.access_token },
    );
    expect(inspected.status).toBe(200);
    expect(await jsonResponse<ReleaseResponse>(inspected)).toEqual(finalized);
    const publishedFile = bucket.file(`components/${digest(bytes)}.js`);
    const [published] = await publishedFile.download();
    expect(published).toEqual(bytes);
    const [publishedMetadata] = await publishedFile.getMetadata();
    expect(publishedMetadata.contentType).toBe('application/javascript; charset=utf-8');
    expect(publishedMetadata.cacheControl).toBe('private, no-store');
    expect(publishedMetadata.metadata).toEqual({
      schema: 'miakapp.component-artifact/1',
      sha256: digest(bytes),
    });

    const direct = await issueUpload(
      { accessToken: refreshedAccess.access_token },
      bytes,
      '2026-09-01.verified',
    );
    expect(direct.response.status).toBe(201);
    if (direct.upload === undefined) throw new Error('Direct-reconciliation upload was not issued');
    expect((await deliver(direct.upload, bytes)).status).toBe(204);
    const directRef = firestore.collection('controlHomes').doc(HOME_ID)
      .collection('componentUploads').doc(direct.upload.upload_id);
    const directIndexRef = firestore.collection('componentUploadIndex').doc(direct.upload.upload_id);
    await Promise.all([
      directRef.update({ status: 'delivery_reserved', delivered_at: null }),
      directIndexRef.update({ status: 'delivery_reserved' }),
    ]);
    const directFinalize = await finalize(
      { accessToken: refreshedAccess.access_token },
      direct.upload.upload_id,
    );
    expect(directFinalize.status).toBe(200);
    expect(await jsonResponse<ReleaseResponse>(directFinalize)).toEqual(finalized);
    const directStatusResponse = await apiRequest(
      'GET',
      `/v1/homes/${HOME_ID}/component-uploads/${direct.upload.upload_id}`,
      { accessToken: refreshedAccess.access_token },
    );
    expect(directStatusResponse.status).toBe(200);
    const directStatus = await jsonResponse<UploadStatusResponse>(directStatusResponse);
    expect(directStatus).toEqual({
      schema: 'miakapp.component-upload-status/1',
      upload_id: direct.upload.upload_id,
      status: 'finalized',
      release: '2026-09-01.verified',
      abi: 'miakapp.component/1',
      sha256: digest(bytes),
      size: bytes.byteLength,
      requires: REQUIREMENTS,
      expires_at: direct.upload.expires_at,
    });
    expect(JSON.stringify(directStatus)).not.toContain(direct.upload.upload_token);
    expect(JSON.stringify(directStatus)).not.toContain(direct.upload.upload_url);
    const directRecord = (await directRef.get()).data();
    expect(directRecord?.delivered_at).toBeInstanceOf(Timestamp);
    expect(directRecord?.finalized_at).toBeInstanceOf(Timestamp);
  });

  test('activates by CAS, blocks quarantine, rolls back, and enforces client Rules', async () => {
    const firstBytes = Buffer.from('self.release = "first";\n');
    const secondBytes = Buffer.from('self.release = "second";\n');
    const key = await createKey();
    const access = await exchange(key);
    const authorization = { accessToken: access.access_token } as const;
    const first = await publish(authorization, firstBytes, '2026-09-01.first');
    const second = await publish(authorization, secondBytes, '2026-09-01.second');

    const firstMarkerRef = firestore.collection('componentArtifacts').doc(`${first.sha256}.js`);
    const firstMarker = (await firstMarkerRef.get()).data();
    if (firstMarker === undefined) throw new Error('Publication marker missing');
    await firstMarkerRef.delete();
    const markerlessInspection = await apiRequest(
      'GET',
      `/v1/homes/${HOME_ID}/component-releases/${first.sha256}`,
      authorization,
    );
    expect(markerlessInspection.status).toBe(503);
    expect(await errorCode(markerlessInspection)).toBe('temporarily_unavailable');
    const markerlessActivation = await activate(authorization, first.sha256, 0, 1);
    expect(markerlessActivation.status).toBe(503);
    expect(await errorCode(markerlessActivation)).toBe('temporarily_unavailable');
    expect((await artifactRequest(`${config.componentArtifactBaseUrl}/${first.sha256}.js`)).status).toBe(422);
    await firstMarkerRef.set(firstMarker);

    const activatedFirst = await activate(authorization, first.sha256, 0, 1);
    expect(activatedFirst.status).toBe(200);
    const firstPointer = await jsonResponse<PointerResponse>(activatedFirst);
    expect(firstPointer).toEqual({
      schema: 'miakapp.component-pointer/1',
      home_id: HOME_ID,
      generation: 1,
      release: first.release,
      abi: 'miakapp.component/1',
      url: `${config.componentArtifactBaseUrl}/${first.sha256}.js`,
      sha256: first.sha256,
      size: first.size,
      requires: REQUIREMENTS,
    });

    const stale = await activate(authorization, second.sha256, 0, 2);
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe('generation_conflict');
    const contenders = await Promise.all([
      activate(authorization, second.sha256, 1, 2),
      activate(authorization, second.sha256, 1, 3),
    ]);
    expect(contenders.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = contenders.find((response) => response.status === 200);
    const loser = contenders.find((response) => response.status === 409);
    if (winner === undefined || loser === undefined) throw new Error('CAS race did not resolve uniquely');
    expect(await errorCode(loser)).toBe('generation_conflict');
    const activeGeneration = (await jsonResponse<PointerResponse>(winner)).generation;
    expect([2, 3]).toContain(activeGeneration);

    await firestore.collection('componentQuarantine').doc(second.sha256).set({
      schema: 'miakapp.component-quarantine/1',
      sha256: second.sha256,
      quarantined_at: Timestamp.now(),
    });
    const quarantined = await activate(
      authorization,
      second.sha256,
      activeGeneration,
      activeGeneration + 1,
    );
    expect(quarantined.status).toBe(403);
    expect(await errorCode(quarantined)).toBe('digest_quarantined');

    const rollback = await activate(
      authorization,
      first.sha256,
      activeGeneration,
      activeGeneration + 1,
    );
    expect(rollback.status).toBe(200);
    expect((await jsonResponse<PointerResponse>(rollback)).generation).toBe(activeGeneration + 1);

    const anonymous = rules.unauthenticatedContext();
    const authenticated = rules.authenticatedContext(owner.userId);
    await assertFails(getDoc(doc(anonymous.firestore(), 'components', HOME_ID)));
    await assertSucceeds(getDoc(doc(authenticated.firestore(), 'components', HOME_ID)));
    await assertFails(getDoc(doc(
      authenticated.firestore(),
      'controlHomes',
      HOME_ID,
      'componentReleases',
      first.sha256,
    )));
    await assertFails(getDoc(doc(authenticated.firestore(), 'componentQuarantine', second.sha256)));
    const privateObject = ref(
      anonymous.storage(`gs://${config.componentBucket}`),
      `components/${first.sha256}.js`,
    );
    await assertFails(getBytes(privateObject));
    const artifact = await artifactRequest(firstPointer.url);
    expect(artifact.status).toBe(200);
    expect(Buffer.from(await artifact.arrayBuffer())).toEqual(firstBytes);
    expect(artifact.headers.get('Content-Length')).toBe(String(firstBytes.byteLength));
    expect(artifact.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(artifact.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');
    expect(artifact.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(artifact.headers.get('ETag')).toBe(`"${first.sha256}"`);
    expect((await artifactRequest(firstPointer.url, { accessToken: access.access_token })).status).toBe(400);
    expect((await artifactRequest(firstPointer.url, { appCheckToken: 'forbidden' })).status).toBe(400);
    expect((await artifactRequest(firstPointer.url, { pushProof: 'forbidden' })).status).toBe(400);
    expect((await artifactRequest(firstPointer.url, { headers: { Range: 'bytes=0-3' } })).status).toBe(400);
    await assertFails(getBytes(ref(
      authenticated.storage(`gs://${config.componentBucket}`),
      `component-staging/${Buffer.alloc(16).toString('base64url')}.js`,
    )));
    await assertFails(uploadBytes(privateObject, Buffer.from('overwrite')));
  });

  test('keeps CORS and cookie rejection on the capability endpoint', async () => {
    const bytes = Buffer.from('self.answer = 42;\n');
    const issued = await issueUpload({ token: owner.idToken }, bytes, '2026-09-01.owner');
    expect(issued.response.status).toBe(201);
    if (issued.upload === undefined) throw new Error('Owner upload was not issued');
    const cookie = await apiRequest('PUT', `/v1/component-uploads/${issued.upload.upload_id}`, {
      accessToken: issued.upload.upload_token,
      rawBytes: bytes,
      contentType: 'application/javascript; charset=utf-8',
      cookie: 'session=forbidden',
    });
    expect(cookie.status).toBe(400);
    const origin = await apiRequest('PUT', `/v1/component-uploads/${issued.upload.upload_id}`, {
      accessToken: issued.upload.upload_token,
      rawBytes: bytes,
      contentType: 'application/javascript; charset=utf-8',
      origin: 'https://attacker.example.test',
    });
    expect(origin.status).toBe(400);
    const accepted = await deliver(issued.upload, bytes);
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });
});
