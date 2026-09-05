import { isDeepStrictEqual } from 'node:util';

import {
  PROJECT_ID,
  canonicalJson,
  sha256,
} from './contract.mjs';

export const BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET =
  'miakapp-v4-staging-tfstate-1072737219170';
export const BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT =
  'terraform/browser-app-check/operations/recaptcha-key-create-attempt.json';

const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exactKeys(value, keys, description) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${description} must contain exactly the reviewed fields`);
  }
  return value;
}

function canonicalTimestamp(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

function validateSession(session) {
  if (!plainObject(session) || typeof session.accessToken !== 'string'
    || session.accessToken.length < 20 || /\s/u.test(session.accessToken)) {
    reject('Browser App Check key attempt claim requires a verified operator session');
  }
  return session;
}

function validateFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    reject('Browser App Check key attempt claim requires an HTTP transport');
  }
  return fetchImpl;
}

function requestHeaders(accessToken, contentType = false) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-User-Project': PROJECT_ID,
    ...(contentType ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
  };
}

async function request(fetchImpl, url, options, description) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return reject(`${description} request outcome is unknown`);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    return reject(`${description} response could not be read`);
  }
  if (bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    reject(`${description} response is too large`);
  }
  return Object.freeze({ status: response.status, bytes });
}

function metadataUrl(generation) {
  const encodedObject = encodeURIComponent(BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT);
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET}/o/${encodedObject}`,
  );
  if (generation !== undefined) url.searchParams.set('generation', generation);
  url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

function mediaUrl(generation) {
  const url = metadataUrl(generation);
  url.searchParams.delete('fields');
  url.searchParams.set('alt', 'media');
  return url;
}

function uploadUrl() {
  const url = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET}/o`,
  );
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT);
  url.searchParams.set('ifGenerationMatch', '0');
  url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

function parseJson(bytes, description) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
    reject(`${description} returned an empty response`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
}

function validateStorageMetadata(value, expectedSize) {
  if (!plainObject(value)
    || value.bucket !== BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET
    || value.name !== BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT
    || !/^\d+$/u.test(value.generation ?? '')
    || value.generation === '0'
    || value.size !== String(expectedSize)) {
    reject('Browser App Check key attempt claim metadata is malformed');
  }
  return value;
}

export function browserAppCheckKeyAttemptClaimAbsence() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-key-attempt-claim-observation/1',
    bucket: BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT,
    state: 'absent',
  });
}

export async function observeBrowserAppCheckKeyAttemptClaimAbsent(
  session,
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const observed = await request(
    transport,
    metadataUrl(),
    { headers: requestHeaders(operator.accessToken) },
    'Browser App Check key attempt claim observation',
  );
  if (observed.status === 404) return browserAppCheckKeyAttemptClaimAbsence();
  if (observed.status === 200) {
    reject('The global browser App Check key attempt claim already exists');
  }
  reject('Browser App Check key attempt claim observation returned an unexpected response');
}

export function buildBrowserAppCheckKeyAttemptClaim(metadata, attemptedAt) {
  if (!plainObject(metadata)
    || metadata.project_id !== PROJECT_ID
    || !COMMIT.test(metadata.repository_commit ?? '')
    || !SHA256.test(metadata.terraform_plan_sha256 ?? '')
    || !SHA256.test(metadata.baseline_sha256 ?? '')) {
    reject('Browser App Check key attempt claim inputs are invalid');
  }
  const attempted = canonicalTimestamp(attemptedAt, 'attempted_at');
  const created = canonicalTimestamp(metadata.created_at, 'metadata.created_at');
  const expires = canonicalTimestamp(metadata.expires_at, 'metadata.expires_at');
  if (attempted < created || attempted > expires) {
    reject('Browser App Check key attempt claim is outside the saved-plan validity window');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-key-attempt-claim/1',
    operation: 'create-domain-restricted-score-key',
    bucket: BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT,
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    attempted_at: attemptedAt,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export function validateBrowserAppCheckKeyAttemptClaim(value, metadata) {
  const claim = exactKeys(value, [
    'schema',
    'operation',
    'bucket',
    'object',
    'project_id',
    'repository_commit',
    'terraform_plan_sha256',
    'baseline_sha256',
    'attempted_at',
    'retry_authorized',
    'deletion_authorized',
  ], 'Browser App Check key attempt claim');
  const expected = buildBrowserAppCheckKeyAttemptClaim(metadata, claim.attempted_at);
  if (!isDeepStrictEqual(claim, expected)) {
    reject('Browser App Check key attempt claim does not match the reviewed operation');
  }
  return Object.freeze(claim);
}

function buildReceipt(storageMetadata, claimBytes, metadata) {
  const claim = validateBrowserAppCheckKeyAttemptClaim(
    parseJson(claimBytes, 'Browser App Check key attempt claim content'),
    metadata,
  );
  if (canonicalJson(claim) !== claimBytes.toString('utf8')) {
    reject('Browser App Check key attempt claim content is not canonical JSON');
  }
  const stored = validateStorageMetadata(storageMetadata, claimBytes.byteLength);
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-key-attempt-claim-receipt/1',
    bucket: stored.bucket,
    object: stored.name,
    generation: stored.generation,
    size_bytes: claimBytes.byteLength,
    sha256: sha256(claimBytes),
    repository_commit: claim.repository_commit,
    terraform_plan_sha256: claim.terraform_plan_sha256,
    baseline_sha256: claim.baseline_sha256,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

export function validateBrowserAppCheckKeyAttemptClaimReceipt(value, metadata) {
  const receipt = exactKeys(value, [
    'schema',
    'bucket',
    'object',
    'generation',
    'size_bytes',
    'sha256',
    'repository_commit',
    'terraform_plan_sha256',
    'baseline_sha256',
    'retry_authorized',
    'deletion_authorized',
    'raw_contents_committed',
  ], 'Browser App Check key attempt claim receipt');
  if (receipt.schema !== 'miakapp.staging-browser-app-check-key-attempt-claim-receipt/1'
    || receipt.bucket !== BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET
    || receipt.object !== BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT
    || !/^\d+$/u.test(receipt.generation ?? '')
    || receipt.generation === '0'
    || !Number.isSafeInteger(receipt.size_bytes)
    || receipt.size_bytes <= 0
    || receipt.size_bytes > MAXIMUM_RESPONSE_BYTES
    || !SHA256.test(receipt.sha256 ?? '')
    || receipt.repository_commit !== metadata.repository_commit
    || receipt.terraform_plan_sha256 !== metadata.terraform_plan_sha256
    || receipt.baseline_sha256 !== metadata.baseline_sha256
    || receipt.retry_authorized !== false
    || receipt.deletion_authorized !== false
    || receipt.raw_contents_committed !== false) {
    reject('Browser App Check key attempt claim receipt does not match the reviewed operation');
  }
  return Object.freeze(receipt);
}

async function readClaimGeneration(session, storageMetadata, metadata, fetchImpl) {
  const stored = validateStorageMetadata(storageMetadata, Number(storageMetadata.size));
  const observed = await request(
    fetchImpl,
    mediaUrl(stored.generation),
    { headers: requestHeaders(session.accessToken) },
    'Browser App Check key attempt claim content verification',
  );
  if (observed.status !== 200 || observed.bytes.byteLength !== Number(stored.size)) {
    reject('Browser App Check key attempt claim content verification returned an unexpected response');
  }
  return buildReceipt(stored, observed.bytes, metadata);
}

export async function createBrowserAppCheckKeyAttemptClaim(
  session,
  metadata,
  attemptedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const claim = buildBrowserAppCheckKeyAttemptClaim(metadata, attemptedAt);
  const claimBytes = Buffer.from(canonicalJson(claim), 'utf8');
  const created = await request(
    transport,
    uploadUrl(),
    {
      method: 'POST',
      headers: requestHeaders(operator.accessToken, true),
      body: claimBytes,
    },
    'Atomic browser App Check key attempt claim creation',
  );
  if (created.status === 412) {
    reject('The global browser App Check key attempt claim was already acquired');
  }
  if (created.status !== 200) {
    reject('Atomic browser App Check key attempt claim creation returned an unexpected response');
  }
  const storageMetadata = validateStorageMetadata(
    parseJson(created.bytes, 'Atomic browser App Check key attempt claim creation'),
    claimBytes.byteLength,
  );
  const receipt = await readClaimGeneration(operator, storageMetadata, metadata, transport);
  if (receipt.sha256 !== sha256(claimBytes)) {
    reject('Browser App Check key attempt claim read-back does not match the exact created bytes');
  }
  return receipt;
}

export async function observeBrowserAppCheckKeyAttemptClaim(
  session,
  metadata,
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const observed = await request(
    transport,
    metadataUrl(),
    { headers: requestHeaders(operator.accessToken) },
    'Browser App Check key attempt claim recovery observation',
  );
  if (observed.status === 404) {
    reject('The global browser App Check key attempt claim is absent');
  }
  if (observed.status !== 200) {
    reject('Browser App Check key attempt claim recovery observation returned an unexpected response');
  }
  const storageMetadata = parseJson(
    observed.bytes,
    'Browser App Check key attempt claim recovery metadata',
  );
  return readClaimGeneration(operator, storageMetadata, metadata, transport);
}

export async function observePinnedBrowserAppCheckKeyAttemptClaim(
  session,
  expectedReceipt,
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const expected = exactKeys(expectedReceipt, [
    'schema',
    'bucket',
    'object',
    'generation',
    'size_bytes',
    'sha256',
    'repository_commit',
    'terraform_plan_sha256',
    'baseline_sha256',
    'retry_authorized',
    'deletion_authorized',
    'raw_contents_committed',
  ], 'Pinned browser App Check key attempt claim receipt');
  if (expected.schema !== 'miakapp.staging-browser-app-check-key-attempt-claim-receipt/1'
    || expected.bucket !== BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET
    || expected.object !== BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT
    || !/^\d+$/u.test(expected.generation ?? '')
    || !Number.isSafeInteger(expected.size_bytes) || expected.size_bytes <= 0
    || expected.size_bytes > MAXIMUM_RESPONSE_BYTES
    || !SHA256.test(expected.sha256 ?? '')
    || !COMMIT.test(expected.repository_commit ?? '')
    || !SHA256.test(expected.terraform_plan_sha256 ?? '')
    || !SHA256.test(expected.baseline_sha256 ?? '')
    || expected.retry_authorized !== false
    || expected.deletion_authorized !== false
    || expected.raw_contents_committed !== false) {
    reject('Pinned browser App Check key attempt claim receipt is malformed');
  }
  const observed = await request(
    transport,
    metadataUrl(expected.generation),
    { headers: requestHeaders(operator.accessToken) },
    'Pinned browser App Check key attempt claim metadata observation',
  );
  if (observed.status !== 200) {
    reject('Pinned browser App Check key attempt claim metadata is absent');
  }
  const stored = validateStorageMetadata(
    parseJson(observed.bytes, 'Pinned browser App Check key attempt claim metadata'),
    expected.size_bytes,
  );
  if (stored.generation !== expected.generation) {
    reject('Pinned browser App Check key attempt claim generation has drifted');
  }
  const content = await request(
    transport,
    mediaUrl(expected.generation),
    { headers: requestHeaders(operator.accessToken) },
    'Pinned browser App Check key attempt claim content observation',
  );
  if (content.status !== 200 || content.bytes.byteLength !== expected.size_bytes
    || sha256(content.bytes) !== expected.sha256) {
    reject('Pinned browser App Check key attempt claim content has drifted');
  }
  return Object.freeze(expected);
}
