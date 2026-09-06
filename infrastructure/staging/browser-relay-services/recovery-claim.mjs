import { isDeepStrictEqual } from 'node:util';

import {
  BOOTSTRAP_CLAIM_OBJECT,
  PROJECT_ID,
  RECOVERY_CLAIM_OBJECT,
  RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
  RELAY_SERVICES_PROFILE_SHA256,
  STATE_BUCKET,
  canonicalJson,
  sha256,
  validateRelayServicesBootstrapFailure,
  validateRelayServicesProfile,
  validateRelayServicesRecoveryPlanMetadata,
} from './contract.mjs';

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
    reject('Relay recovery claim requires a verified operator session');
  }
  return session;
}

function validateFetch(fetchImplementation) {
  if (typeof fetchImplementation !== 'function') {
    reject('Relay recovery claim requires an HTTP transport');
  }
  return fetchImplementation;
}

function headers(accessToken, contentType = false) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-User-Project': PROJECT_ID,
    ...(contentType ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
  };
}

async function request(fetchImplementation, url, options, description) {
  let response;
  try {
    response = await fetchImplementation(url, {
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

function metadataUrl(object, generation) {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(object)}`,
  );
  if (generation !== undefined) url.searchParams.set('generation', generation);
  url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

function mediaUrl(object, generation) {
  const url = metadataUrl(object, generation);
  url.searchParams.delete('fields');
  url.searchParams.set('alt', 'media');
  return url;
}

function uploadUrl() {
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${STATE_BUCKET}/o`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', RECOVERY_CLAIM_OBJECT);
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

function validateStorageMetadata(value, object, expectedSize) {
  if (!plainObject(value) || value.bucket !== STATE_BUCKET || value.name !== object
    || !/^[1-9][0-9]*$/u.test(value.generation ?? '')
    || value.size !== String(expectedSize)) {
    reject('Relay recovery claim storage metadata is malformed');
  }
  return value;
}

export function relayRecoveryClaimAbsence() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: RECOVERY_CLAIM_OBJECT,
    state: 'absent',
  });
}

export async function observeRelayRecoveryClaimAbsent(
  session,
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const observed = await request(
    transport,
    metadataUrl(RECOVERY_CLAIM_OBJECT),
    { headers: headers(operator.accessToken) },
    'Relay recovery claim observation',
  );
  if (observed.status === 404) return relayRecoveryClaimAbsence();
  if (observed.status === 200) reject('The global relay recovery claim already exists');
  reject('Relay recovery claim observation returned an unexpected response');
}

export async function observePinnedOriginalRelayBootstrapClaim(
  session,
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const profile = validateRelayServicesProfile();
  const failure = validateRelayServicesBootstrapFailure();
  const observed = await request(
    transport,
    metadataUrl(BOOTSTRAP_CLAIM_OBJECT, failure.claim.generation),
    { headers: headers(operator.accessToken) },
    'Pinned original relay bootstrap claim metadata',
  );
  if (observed.status !== 200) reject('Pinned original relay bootstrap claim is absent');
  const stored = validateStorageMetadata(
    parseJson(observed.bytes, 'Pinned original relay bootstrap claim metadata'),
    BOOTSTRAP_CLAIM_OBJECT,
    failure.claim.size_bytes,
  );
  if (stored.generation !== failure.claim.generation
    || stored.generation !== profile.operation.original_claim_generation) {
    reject('Pinned original relay bootstrap claim generation has drifted');
  }
  const content = await request(
    transport,
    mediaUrl(BOOTSTRAP_CLAIM_OBJECT, stored.generation),
    { headers: headers(operator.accessToken) },
    'Pinned original relay bootstrap claim content',
  );
  if (content.status !== 200 || content.bytes.byteLength !== failure.claim.size_bytes
    || sha256(content.bytes) !== failure.claim.sha256
    || failure.claim.sha256 !== profile.operation.original_claim_sha256) {
    reject('Pinned original relay bootstrap claim content has drifted');
  }
  return Object.freeze({
    object: BOOTSTRAP_CLAIM_OBJECT,
    generation: stored.generation,
    size_bytes: content.bytes.byteLength,
    sha256: sha256(content.bytes),
  });
}

export function buildRelayRecoveryClaim(metadataBytes, metadata, attemptedAt) {
  if (!Buffer.isBuffer(metadataBytes) || metadataBytes.byteLength === 0) {
    reject('Relay recovery claim metadata bytes are invalid');
  }
  const checked = validateRelayServicesRecoveryPlanMetadata(metadata);
  const profile = validateRelayServicesProfile();
  const attempted = canonicalTimestamp(attemptedAt, 'attempted_at');
  const created = canonicalTimestamp(checked.created_at, 'metadata.created_at');
  const expires = canonicalTimestamp(checked.expires_at, 'metadata.expires_at');
  if (attempted < created || attempted > expires) {
    reject('Relay recovery claim is outside the saved-plan validity window');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-memory-recovery-claim/1',
    operation: 'recover-private-browser-relay-bootstrap-memory',
    bucket: STATE_BUCKET,
    object: RECOVERY_CLAIM_OBJECT,
    project_id: PROJECT_ID,
    repository_commit: checked.repository_commit,
    metadata_sha256: sha256(metadataBytes),
    profile_sha256: RELAY_SERVICES_PROFILE_SHA256,
    bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    original_claim_generation: checked.original_claim_generation,
    original_claim_sha256: checked.original_claim_sha256,
    terraform_plan_sha256: checked.terraform_plan_sha256,
    baseline_sha256: checked.baseline_sha256,
    attempted_at: attemptedAt,
    expires_at: checked.expires_at,
    maximum_terraform_creates: profile.operation.maximum_terraform_creates,
    maximum_terraform_updates: profile.operation.maximum_terraform_updates,
    maximum_terraform_deletes: profile.operation.maximum_terraform_deletes,
    maximum_relay_services: profile.operation.maximum_relay_services,
    public_invocation_authorized: false,
    live_requests_authorized: false,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export function validateRelayRecoveryClaim(value, metadataBytes, metadata) {
  const claim = exactKeys(value, [
    'schema', 'operation', 'bucket', 'object', 'project_id', 'repository_commit',
    'metadata_sha256', 'profile_sha256', 'bootstrap_failure_sha256',
    'original_claim_generation', 'original_claim_sha256', 'terraform_plan_sha256',
    'baseline_sha256', 'attempted_at', 'expires_at', 'maximum_terraform_creates',
    'maximum_terraform_updates', 'maximum_terraform_deletes', 'maximum_relay_services',
    'public_invocation_authorized', 'live_requests_authorized', 'retry_authorized',
    'deletion_authorized',
  ], 'Relay recovery claim');
  const expected = buildRelayRecoveryClaim(metadataBytes, metadata, claim.attempted_at);
  if (!isDeepStrictEqual(claim, expected)) {
    reject('Relay recovery claim does not match the exact reviewed operation');
  }
  return Object.freeze(claim);
}

function buildReceipt(storageMetadata, claimBytes, metadataBytes, metadata) {
  const claim = validateRelayRecoveryClaim(
    parseJson(claimBytes, 'Relay recovery claim content'),
    metadataBytes,
    metadata,
  );
  if (canonicalJson(claim) !== claimBytes.toString('utf8')) {
    reject('Relay recovery claim content is not canonical JSON');
  }
  const stored = validateStorageMetadata(
    storageMetadata,
    RECOVERY_CLAIM_OBJECT,
    claimBytes.byteLength,
  );
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-memory-recovery-claim-receipt/1',
    bucket: stored.bucket,
    object: stored.name,
    generation: stored.generation,
    size_bytes: claimBytes.byteLength,
    sha256: sha256(claimBytes),
    repository_commit: claim.repository_commit,
    metadata_sha256: claim.metadata_sha256,
    profile_sha256: claim.profile_sha256,
    bootstrap_failure_sha256: claim.bootstrap_failure_sha256,
    original_claim_generation: claim.original_claim_generation,
    original_claim_sha256: claim.original_claim_sha256,
    terraform_plan_sha256: claim.terraform_plan_sha256,
    baseline_sha256: claim.baseline_sha256,
    attempted_at: claim.attempted_at,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

export function validateRelayRecoveryClaimReceipt(value, metadataBytes, metadata) {
  const receipt = exactKeys(value, [
    'schema', 'bucket', 'object', 'generation', 'size_bytes', 'sha256',
    'repository_commit', 'metadata_sha256', 'profile_sha256',
    'bootstrap_failure_sha256', 'original_claim_generation', 'original_claim_sha256',
    'terraform_plan_sha256', 'baseline_sha256', 'attempted_at', 'retry_authorized',
    'deletion_authorized', 'raw_contents_committed',
  ], 'Relay recovery claim receipt');
  const checked = validateRelayServicesRecoveryPlanMetadata(metadata);
  if (receipt.schema
      !== 'miakapp.staging-browser-relay-services-memory-recovery-claim-receipt/1'
    || receipt.bucket !== STATE_BUCKET || receipt.object !== RECOVERY_CLAIM_OBJECT
    || !/^[1-9][0-9]*$/u.test(receipt.generation ?? '')
    || !Number.isSafeInteger(receipt.size_bytes) || receipt.size_bytes <= 0
    || receipt.size_bytes > MAXIMUM_RESPONSE_BYTES || !SHA256.test(receipt.sha256 ?? '')
    || !COMMIT.test(receipt.repository_commit ?? '')
    || receipt.repository_commit !== checked.repository_commit
    || receipt.metadata_sha256 !== sha256(metadataBytes)
    || receipt.profile_sha256 !== RELAY_SERVICES_PROFILE_SHA256
    || receipt.bootstrap_failure_sha256 !== RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256
    || receipt.original_claim_generation !== checked.original_claim_generation
    || receipt.original_claim_sha256 !== checked.original_claim_sha256
    || receipt.terraform_plan_sha256 !== checked.terraform_plan_sha256
    || receipt.baseline_sha256 !== checked.baseline_sha256
    || typeof receipt.attempted_at !== 'string' || receipt.retry_authorized !== false
    || receipt.deletion_authorized !== false || receipt.raw_contents_committed !== false) {
    reject('Relay recovery claim receipt does not match the reviewed operation');
  }
  return Object.freeze(receipt);
}

async function readClaimGeneration(
  session,
  storageMetadata,
  metadataBytes,
  metadata,
  fetchImplementation,
) {
  const stored = validateStorageMetadata(
    storageMetadata,
    RECOVERY_CLAIM_OBJECT,
    Number(storageMetadata.size),
  );
  const observed = await request(
    fetchImplementation,
    mediaUrl(RECOVERY_CLAIM_OBJECT, stored.generation),
    { headers: headers(session.accessToken) },
    'Relay recovery claim content verification',
  );
  if (observed.status !== 200 || observed.bytes.byteLength !== Number(stored.size)) {
    reject('Relay recovery claim content verification returned an unexpected response');
  }
  return buildReceipt(stored, observed.bytes, metadataBytes, metadata);
}

export async function createRelayRecoveryClaim(
  session,
  metadataBytes,
  metadata,
  attemptedAt = new Date().toISOString(),
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const claim = buildRelayRecoveryClaim(metadataBytes, metadata, attemptedAt);
  const claimBytes = Buffer.from(canonicalJson(claim), 'utf8');
  const created = await request(
    transport,
    uploadUrl(),
    {
      method: 'POST',
      headers: headers(operator.accessToken, true),
      body: claimBytes,
    },
    'Atomic relay recovery claim creation',
  );
  if (created.status === 412) reject('The global relay recovery claim was already acquired');
  if (created.status !== 200) {
    reject('Atomic relay recovery claim creation returned an unexpected response');
  }
  const stored = validateStorageMetadata(
    parseJson(created.bytes, 'Atomic relay recovery claim creation'),
    RECOVERY_CLAIM_OBJECT,
    claimBytes.byteLength,
  );
  const receipt = await readClaimGeneration(
    operator,
    stored,
    metadataBytes,
    metadata,
    transport,
  );
  if (receipt.sha256 !== sha256(claimBytes)) {
    reject('Relay recovery claim read-back differs from the created bytes');
  }
  return receipt;
}

export async function observePinnedRelayRecoveryClaim(
  session,
  expectedReceipt,
  metadataBytes,
  metadata,
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const expected = validateRelayRecoveryClaimReceipt(
    expectedReceipt,
    metadataBytes,
    metadata,
  );
  const observed = await request(
    transport,
    metadataUrl(RECOVERY_CLAIM_OBJECT, expected.generation),
    { headers: headers(operator.accessToken) },
    'Pinned relay recovery claim metadata observation',
  );
  if (observed.status !== 200) reject('Pinned relay recovery claim metadata is absent');
  const stored = validateStorageMetadata(
    parseJson(observed.bytes, 'Pinned relay recovery claim metadata'),
    RECOVERY_CLAIM_OBJECT,
    expected.size_bytes,
  );
  if (stored.generation !== expected.generation) {
    reject('Pinned relay recovery claim generation has drifted');
  }
  const content = await request(
    transport,
    mediaUrl(RECOVERY_CLAIM_OBJECT, expected.generation),
    { headers: headers(operator.accessToken) },
    'Pinned relay recovery claim content observation',
  );
  if (content.status !== 200 || content.bytes.byteLength !== expected.size_bytes
    || sha256(content.bytes) !== expected.sha256) {
    reject('Pinned relay recovery claim content has drifted');
  }
  return Object.freeze(expected);
}
