import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_PLAN_SHA256,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
  ORCHESTRATOR_CLAIM_SCHEMA,
  ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
  ORCHESTRATOR_PROFILE_SHA256,
  PROJECT_ID,
  canonicalJson,
  sha256,
  validateBrowserRelayOrchestratorProfile,
  validateClaimTimestamp,
} from './contract.mjs';

const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const CLAIM_VALIDITY_MILLISECONDS = 30 * 60 * 1000;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, path) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function validateSession(value) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value), ['accessToken'])
    || typeof value.accessToken !== 'string'
    || value.accessToken.length < 20
    || value.accessToken.length > 16 * 1024
    || /\s/u.test(value.accessToken)) {
    reject('Orchestrator claim requires a verified ephemeral operator session');
  }
  return value;
}

function validateTransport(value) {
  if (typeof value !== 'function') reject('Orchestrator claim requires an HTTP transport');
  return value;
}

function requestHeaders(accessToken, contentType = false) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-User-Project': PROJECT_ID,
    ...(contentType ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
  };
}

function objectUrl(generation, media = false) {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${ORCHESTRATOR_CLAIM_BUCKET}/o/${encodeURIComponent(ORCHESTRATOR_CLAIM_OBJECT)}`,
  );
  if (generation !== undefined) url.searchParams.set('generation', generation);
  if (media) url.searchParams.set('alt', 'media');
  else url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

function uploadUrl() {
  const url = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${ORCHESTRATOR_CLAIM_BUCKET}/o`,
  );
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', ORCHESTRATOR_CLAIM_OBJECT);
  url.searchParams.set('ifGenerationMatch', '0');
  url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

async function request(fetchImplementation, url, options, description) {
  let response;
  try {
    response = await fetchImplementation(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return reject(`${description} outcome is unknown; execution must stop without retry`);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    return reject(`${description} response is unreadable`);
  }
  if (bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    reject(`${description} response is too large`);
  }
  return Object.freeze({ status: response.status, bytes });
}

function parseJson(bytes, description) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 2) {
    reject(`${description} returned an empty response`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
}

function validateStorageMetadata(value, expectedSize) {
  if (!Number.isSafeInteger(expectedSize)
    || expectedSize < 1
    || expectedSize > MAXIMUM_RESPONSE_BYTES
    || !plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [
      'bucket', 'generation', 'name', 'size',
    ])
    || value.bucket !== ORCHESTRATOR_CLAIM_BUCKET
    || value.name !== ORCHESTRATOR_CLAIM_OBJECT
    || !/^[1-9][0-9]*$/u.test(value.generation ?? '')
    || value.size !== String(expectedSize)) {
    reject('Orchestrator claim storage metadata is malformed');
  }
  return value;
}

export function orchestratorClaimAbsence() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-orchestrator-claim-observation/1',
    bucket: ORCHESTRATOR_CLAIM_BUCKET,
    object: ORCHESTRATOR_CLAIM_OBJECT,
    state: 'absent',
  });
}

export async function observeOrchestratorClaimAbsent(
  sessionValue,
  fetchImplementation = globalThis.fetch,
) {
  const session = validateSession(sessionValue);
  const transport = validateTransport(fetchImplementation);
  const response = await request(
    transport,
    objectUrl(),
    { method: 'GET', headers: requestHeaders(session.accessToken) },
    'Orchestrator claim observation',
  );
  if (response.status === 404) return orchestratorClaimAbsence();
  if (response.status === 200) reject('The global orchestrator claim already exists');
  return reject('Orchestrator claim observation returned an unexpected response');
}

export function buildOrchestratorClaim(attemptedAt) {
  const profile = validateBrowserRelayOrchestratorProfile();
  const attempted = validateClaimTimestamp(attemptedAt, 'claim.attempted_at');
  const expiresAt = new Date(attempted + CLAIM_VALIDITY_MILLISECONDS).toISOString();
  return Object.freeze({
    schema: ORCHESTRATOR_CLAIM_SCHEMA,
    operation: 'run-one-bounded-browser-relay-edge-window',
    bucket: ORCHESTRATOR_CLAIM_BUCKET,
    object: ORCHESTRATOR_CLAIM_OBJECT,
    project_id: PROJECT_ID,
    repository_commit: ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
    profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    attempted_at: attemptedAt,
    expires_at: expiresAt,
    maximum_claim_creations: profile.claim.maximum_creations,
    maximum_edge_window_executions: profile.execution.maximum_edge_window_executions,
    maximum_public_window_milliseconds: MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
    claim_precedes_first_cloud_mutation: true,
    baseline_reobserved_after_claim: true,
    separate_exact_authorization_required: true,
    profile_authorizes_execution: false,
    ambiguous_creation_allows_execution: false,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export function validateOrchestratorClaim(value) {
  const claim = exactKeys(value, [
    'schema', 'operation', 'bucket', 'object', 'project_id',
    'repository_commit', 'profile_sha256', 'browser_relay_plan_sha256',
    'attempted_at', 'expires_at', 'maximum_claim_creations',
    'maximum_edge_window_executions', 'maximum_public_window_milliseconds',
    'claim_precedes_first_cloud_mutation', 'baseline_reobserved_after_claim',
    'separate_exact_authorization_required', 'profile_authorizes_execution',
    'ambiguous_creation_allows_execution', 'retry_authorized',
    'deletion_authorized',
  ], 'Orchestrator claim');
  const expected = buildOrchestratorClaim(claim.attempted_at);
  if (!isDeepStrictEqual(claim, expected)) {
    reject('Orchestrator claim does not match the reviewed single-use operation');
  }
  validateClaimTimestamp(claim.expires_at, 'claim.expires_at');
  return Object.freeze(claim);
}

function buildReceipt(storageMetadata, claimBytes) {
  const claim = validateOrchestratorClaim(parseJson(claimBytes, 'Orchestrator claim content'));
  if (canonicalJson(claim) !== claimBytes.toString('utf8')) {
    reject('Orchestrator claim content is not canonical JSON');
  }
  const stored = validateStorageMetadata(storageMetadata, claimBytes.byteLength);
  return Object.freeze({
    schema: ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
    bucket: stored.bucket,
    object: stored.name,
    generation: stored.generation,
    size_bytes: claimBytes.byteLength,
    sha256: sha256(claimBytes),
    repository_commit: claim.repository_commit,
    profile_sha256: claim.profile_sha256,
    browser_relay_plan_sha256: claim.browser_relay_plan_sha256,
    attempted_at: claim.attempted_at,
    expires_at: claim.expires_at,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

export function validateOrchestratorClaimReceipt(value) {
  const receipt = exactKeys(value, [
    'schema', 'bucket', 'object', 'generation', 'size_bytes', 'sha256',
    'repository_commit', 'profile_sha256', 'browser_relay_plan_sha256',
    'attempted_at', 'expires_at', 'retry_authorized', 'deletion_authorized',
    'raw_contents_committed',
  ], 'Orchestrator claim receipt');
  if (receipt.schema !== ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA
    || receipt.bucket !== ORCHESTRATOR_CLAIM_BUCKET
    || receipt.object !== ORCHESTRATOR_CLAIM_OBJECT
    || !/^[1-9][0-9]*$/u.test(receipt.generation ?? '')
    || !Number.isSafeInteger(receipt.size_bytes)
    || receipt.size_bytes < 1
    || receipt.size_bytes > MAXIMUM_RESPONSE_BYTES
    || !/^[0-9a-f]{64}$/u.test(receipt.sha256 ?? '')
    || receipt.repository_commit !== ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT
    || receipt.profile_sha256 !== ORCHESTRATOR_PROFILE_SHA256
    || receipt.browser_relay_plan_sha256 !== BROWSER_RELAY_PLAN_SHA256
    || receipt.retry_authorized !== false
    || receipt.deletion_authorized !== false
    || receipt.raw_contents_committed !== false) {
    reject('Orchestrator claim receipt differs from the reviewed boundary');
  }
  const attempted = validateClaimTimestamp(receipt.attempted_at, 'receipt.attempted_at');
  const expires = validateClaimTimestamp(receipt.expires_at, 'receipt.expires_at');
  const expectedClaimBytes = Buffer.from(
    canonicalJson(buildOrchestratorClaim(receipt.attempted_at)),
    'utf8',
  );
  if (expires - attempted !== CLAIM_VALIDITY_MILLISECONDS
    || receipt.expires_at
      !== new Date(attempted + CLAIM_VALIDITY_MILLISECONDS).toISOString()
    || receipt.size_bytes !== expectedClaimBytes.byteLength
    || receipt.sha256 !== sha256(expectedClaimBytes)) {
    reject('Orchestrator claim receipt validity has drifted');
  }
  return Object.freeze(receipt);
}

async function readClaimGeneration(session, metadata, transport) {
  const stored = validateStorageMetadata(metadata, Number(metadata.size));
  const response = await request(
    transport,
    objectUrl(stored.generation, true),
    { method: 'GET', headers: requestHeaders(session.accessToken) },
    'Orchestrator claim content verification',
  );
  if (response.status !== 200 || response.bytes.byteLength !== Number(stored.size)) {
    reject('Orchestrator claim content verification returned an unexpected response');
  }
  return buildReceipt(stored, response.bytes);
}

export async function createAtomicOrchestratorClaim(
  sessionValue,
  attemptedAt,
  fetchImplementation = globalThis.fetch,
) {
  const session = validateSession(sessionValue);
  const transport = validateTransport(fetchImplementation);
  const claimBytes = Buffer.from(canonicalJson(buildOrchestratorClaim(attemptedAt)), 'utf8');
  const response = await request(
    transport,
    uploadUrl(),
    {
      method: 'POST',
      headers: requestHeaders(session.accessToken, true),
      body: claimBytes,
    },
    'Atomic orchestrator claim creation',
  );
  if (response.status === 412) reject('The global orchestrator claim was already acquired');
  if (response.status !== 200) {
    reject('Atomic orchestrator claim creation returned an unexpected response');
  }
  const metadata = validateStorageMetadata(
    parseJson(response.bytes, 'Atomic orchestrator claim creation'),
    claimBytes.byteLength,
  );
  return readClaimGeneration(session, metadata, transport);
}

export async function observePinnedOrchestratorClaim(
  sessionValue,
  receiptValue,
  fetchImplementation = globalThis.fetch,
) {
  const session = validateSession(sessionValue);
  const receipt = validateOrchestratorClaimReceipt(receiptValue);
  const transport = validateTransport(fetchImplementation);
  const response = await request(
    transport,
    objectUrl(receipt.generation),
    { method: 'GET', headers: requestHeaders(session.accessToken) },
    'Pinned orchestrator claim metadata',
  );
  if (response.status !== 200) reject('Pinned orchestrator claim is absent');
  const observed = await readClaimGeneration(
    session,
    parseJson(response.bytes, 'Pinned orchestrator claim metadata'),
    transport,
  );
  if (!isDeepStrictEqual(observed, receipt)) {
    reject('Pinned orchestrator claim has drifted');
  }
  return Object.freeze(observed);
}
