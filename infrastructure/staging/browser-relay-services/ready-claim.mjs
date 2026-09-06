import { isDeepStrictEqual } from 'node:util';

import {
  BOOTSTRAP_CLAIM_OBJECT,
  PRIVATE_READY_CLAIM_OBJECT,
  PROJECT_ID,
  RECOVERY_CLAIM_OBJECT,
  RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256,
  RELAY_SERVICES_PROFILE_SHA256,
  STATE_BUCKET,
  canonicalJson,
  sha256,
  validateRelayServicesPrivateReadyPlanMetadata,
  validateRelayServicesProfile,
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
    reject('Relay private-ready claim requires a verified operator session');
  }
  return session;
}

function validateFetch(fetchImplementation) {
  if (typeof fetchImplementation !== 'function') {
    reject('Relay private-ready claim requires an HTTP transport');
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
  if (bytes.byteLength > MAXIMUM_RESPONSE_BYTES) reject(`${description} response is too large`);
  return Object.freeze({ status: response.status, bytes });
}

function objectUrl(object, generation, media = false) {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(object)}`,
  );
  if (generation !== undefined) url.searchParams.set('generation', generation);
  if (media) {
    url.searchParams.set('alt', 'media');
  } else {
    url.searchParams.set('fields', 'bucket,name,generation,size');
  }
  return url;
}

function uploadUrl() {
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${STATE_BUCKET}/o`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', PRIVATE_READY_CLAIM_OBJECT);
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
    reject('Relay private-ready claim storage metadata is malformed');
  }
  return value;
}

export function relayPrivateReadyClaimAbsence() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: PRIVATE_READY_CLAIM_OBJECT,
    state: 'absent',
  });
}

export async function observeRelayPrivateReadyClaimAbsent(
  session,
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const observed = await request(
    transport,
    objectUrl(PRIVATE_READY_CLAIM_OBJECT),
    { headers: headers(operator.accessToken) },
    'Relay private-ready claim observation',
  );
  if (observed.status === 404) return relayPrivateReadyClaimAbsence();
  if (observed.status === 200) reject('The global relay private-ready claim already exists');
  reject('Relay private-ready claim observation returned an unexpected response');
}

async function observePinnedClaim(
  session,
  fetchImplementation,
  { object, generation, sizeBytes, digest, description },
) {
  const metadataResponse = await request(
    fetchImplementation,
    objectUrl(object, generation),
    { headers: headers(session.accessToken) },
    `${description} metadata`,
  );
  if (metadataResponse.status !== 200) reject(`${description} is absent`);
  const metadata = validateStorageMetadata(
    parseJson(metadataResponse.bytes, `${description} metadata`),
    object,
    sizeBytes,
  );
  if (metadata.generation !== generation) reject(`${description} generation has drifted`);
  const content = await request(
    fetchImplementation,
    objectUrl(object, generation, true),
    { headers: headers(session.accessToken) },
    `${description} content`,
  );
  if (content.status !== 200 || content.bytes.byteLength !== sizeBytes
    || sha256(content.bytes) !== digest) {
    reject(`${description} content has drifted`);
  }
  return Object.freeze({ object, generation, size_bytes: sizeBytes, sha256: digest });
}

export async function observePinnedPrivateReadyPrerequisiteClaims(
  session,
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const profile = validateRelayServicesProfile();
  const [bootstrap, memoryRecovery] = await Promise.all([
    observePinnedClaim(operator, transport, {
      object: BOOTSTRAP_CLAIM_OBJECT,
      generation: profile.operation.original_claim_generation,
      sizeBytes: profile.operation.original_claim_size_bytes,
      digest: profile.operation.original_claim_sha256,
      description: 'Pinned original relay bootstrap claim',
    }),
    observePinnedClaim(operator, transport, {
      object: RECOVERY_CLAIM_OBJECT,
      generation: profile.operation.memory_recovery_claim_generation,
      sizeBytes: profile.operation.memory_recovery_claim_size_bytes,
      digest: profile.operation.memory_recovery_claim_sha256,
      description: 'Pinned relay memory-recovery claim',
    }),
  ]);
  return Object.freeze({ bootstrap, memory_recovery: memoryRecovery });
}

export function buildRelayPrivateReadyClaim(metadataBytes, metadata, attemptedAt) {
  if (!Buffer.isBuffer(metadataBytes) || metadataBytes.byteLength === 0) {
    reject('Relay private-ready metadata bytes are invalid');
  }
  const checked = validateRelayServicesPrivateReadyPlanMetadata(metadata);
  const profile = validateRelayServicesProfile();
  const attempted = canonicalTimestamp(attemptedAt, 'attempted_at');
  const created = canonicalTimestamp(checked.created_at, 'metadata.created_at');
  const expires = canonicalTimestamp(checked.expires_at, 'metadata.expires_at');
  if (attempted < created || attempted > expires) {
    reject('Relay private-ready claim is outside the saved-plan validity window');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-private-ready-claim/1',
    operation: 'transition-private-browser-relays-to-assigned-audiences',
    bucket: STATE_BUCKET,
    object: PRIVATE_READY_CLAIM_OBJECT,
    project_id: PROJECT_ID,
    repository_commit: checked.repository_commit,
    metadata_sha256: sha256(metadataBytes),
    profile_sha256: RELAY_SERVICES_PROFILE_SHA256,
    memory_recovery_failure_sha256: RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256,
    original_claim_generation: checked.original_claim_generation,
    original_claim_sha256: checked.original_claim_sha256,
    memory_recovery_claim_generation: checked.memory_recovery_claim_generation,
    memory_recovery_claim_sha256: checked.memory_recovery_claim_sha256,
    terraform_plan_sha256: checked.terraform_plan_sha256,
    baseline_sha256: checked.baseline_sha256,
    attempted_at: attemptedAt,
    expires_at: checked.expires_at,
    maximum_terraform_creates: profile.operation.maximum_terraform_creates,
    maximum_terraform_updates: profile.operation.maximum_terraform_updates,
    maximum_terraform_deletes: profile.operation.maximum_terraform_deletes,
    maximum_cloud_run_service_updates: profile.operation.maximum_cloud_run_service_updates,
    maximum_relay_services: profile.operation.maximum_relay_services,
    public_invocation_authorized: false,
    live_requests_authorized: false,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export function validateRelayPrivateReadyClaim(value, metadataBytes, metadata) {
  const claim = exactKeys(value, [
    'schema', 'operation', 'bucket', 'object', 'project_id', 'repository_commit',
    'metadata_sha256', 'profile_sha256', 'memory_recovery_failure_sha256',
    'original_claim_generation', 'original_claim_sha256',
    'memory_recovery_claim_generation', 'memory_recovery_claim_sha256',
    'terraform_plan_sha256', 'baseline_sha256', 'attempted_at', 'expires_at',
    'maximum_terraform_creates', 'maximum_terraform_updates',
    'maximum_terraform_deletes', 'maximum_cloud_run_service_updates',
    'maximum_relay_services', 'public_invocation_authorized',
    'live_requests_authorized', 'retry_authorized', 'deletion_authorized',
  ], 'Relay private-ready claim');
  const expected = buildRelayPrivateReadyClaim(metadataBytes, metadata, claim.attempted_at);
  if (!isDeepStrictEqual(claim, expected)) {
    reject('Relay private-ready claim does not match the exact reviewed operation');
  }
  return Object.freeze(claim);
}

function buildReceipt(storageMetadata, claimBytes, metadataBytes, metadata) {
  const claim = validateRelayPrivateReadyClaim(
    parseJson(claimBytes, 'Relay private-ready claim content'),
    metadataBytes,
    metadata,
  );
  if (canonicalJson(claim) !== claimBytes.toString('utf8')) {
    reject('Relay private-ready claim content is not canonical JSON');
  }
  const stored = validateStorageMetadata(
    storageMetadata,
    PRIVATE_READY_CLAIM_OBJECT,
    claimBytes.byteLength,
  );
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-private-ready-claim-receipt/1',
    bucket: stored.bucket,
    object: stored.name,
    generation: stored.generation,
    size_bytes: claimBytes.byteLength,
    sha256: sha256(claimBytes),
    repository_commit: claim.repository_commit,
    metadata_sha256: claim.metadata_sha256,
    profile_sha256: claim.profile_sha256,
    memory_recovery_failure_sha256: claim.memory_recovery_failure_sha256,
    original_claim_generation: claim.original_claim_generation,
    original_claim_sha256: claim.original_claim_sha256,
    memory_recovery_claim_generation: claim.memory_recovery_claim_generation,
    memory_recovery_claim_sha256: claim.memory_recovery_claim_sha256,
    terraform_plan_sha256: claim.terraform_plan_sha256,
    baseline_sha256: claim.baseline_sha256,
    attempted_at: claim.attempted_at,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

export function validateRelayPrivateReadyClaimReceipt(value, metadataBytes, metadata) {
  const receipt = exactKeys(value, [
    'schema', 'bucket', 'object', 'generation', 'size_bytes', 'sha256',
    'repository_commit', 'metadata_sha256', 'profile_sha256',
    'memory_recovery_failure_sha256', 'original_claim_generation',
    'original_claim_sha256', 'memory_recovery_claim_generation',
    'memory_recovery_claim_sha256', 'terraform_plan_sha256', 'baseline_sha256',
    'attempted_at', 'retry_authorized', 'deletion_authorized', 'raw_contents_committed',
  ], 'Relay private-ready claim receipt');
  const checked = validateRelayServicesPrivateReadyPlanMetadata(metadata);
  if (receipt.schema
      !== 'miakapp.staging-browser-relay-services-private-ready-claim-receipt/1'
    || receipt.bucket !== STATE_BUCKET || receipt.object !== PRIVATE_READY_CLAIM_OBJECT
    || !/^[1-9][0-9]*$/u.test(receipt.generation ?? '')
    || !Number.isSafeInteger(receipt.size_bytes) || receipt.size_bytes <= 0
    || receipt.size_bytes > MAXIMUM_RESPONSE_BYTES || !SHA256.test(receipt.sha256 ?? '')
    || !COMMIT.test(receipt.repository_commit ?? '')
    || receipt.repository_commit !== checked.repository_commit
    || receipt.metadata_sha256 !== sha256(metadataBytes)
    || receipt.profile_sha256 !== RELAY_SERVICES_PROFILE_SHA256
    || receipt.memory_recovery_failure_sha256
      !== RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256
    || receipt.original_claim_generation !== checked.original_claim_generation
    || receipt.original_claim_sha256 !== checked.original_claim_sha256
    || receipt.memory_recovery_claim_generation !== checked.memory_recovery_claim_generation
    || receipt.memory_recovery_claim_sha256 !== checked.memory_recovery_claim_sha256
    || receipt.terraform_plan_sha256 !== checked.terraform_plan_sha256
    || receipt.baseline_sha256 !== checked.baseline_sha256
    || typeof receipt.attempted_at !== 'string' || receipt.retry_authorized !== false
    || receipt.deletion_authorized !== false || receipt.raw_contents_committed !== false) {
    reject('Relay private-ready claim receipt does not match the reviewed operation');
  }
  return Object.freeze(receipt);
}

async function readClaimGeneration(session, storageMetadata, metadataBytes, metadata, transport) {
  const stored = validateStorageMetadata(
    storageMetadata,
    PRIVATE_READY_CLAIM_OBJECT,
    Number(storageMetadata.size),
  );
  const observed = await request(
    transport,
    objectUrl(PRIVATE_READY_CLAIM_OBJECT, stored.generation, true),
    { headers: headers(session.accessToken) },
    'Relay private-ready claim content verification',
  );
  if (observed.status !== 200 || observed.bytes.byteLength !== Number(stored.size)) {
    reject('Relay private-ready claim content verification returned an unexpected response');
  }
  return buildReceipt(stored, observed.bytes, metadataBytes, metadata);
}

export async function createRelayPrivateReadyClaim(
  session,
  metadataBytes,
  metadata,
  attemptedAt = new Date().toISOString(),
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const claim = buildRelayPrivateReadyClaim(metadataBytes, metadata, attemptedAt);
  const claimBytes = Buffer.from(canonicalJson(claim), 'utf8');
  const created = await request(
    transport,
    uploadUrl(),
    {
      method: 'POST',
      headers: headers(operator.accessToken, true),
      body: claimBytes,
    },
    'Atomic relay private-ready claim creation',
  );
  if (created.status === 412) reject('The global relay private-ready claim was already acquired');
  if (created.status !== 200) {
    reject('Atomic relay private-ready claim creation returned an unexpected response');
  }
  const storageMetadata = validateStorageMetadata(
    parseJson(created.bytes, 'Atomic relay private-ready claim creation'),
    PRIVATE_READY_CLAIM_OBJECT,
    claimBytes.byteLength,
  );
  return readClaimGeneration(operator, storageMetadata, metadataBytes, metadata, transport);
}

export async function observePinnedRelayPrivateReadyClaim(
  session,
  receipt,
  metadataBytes,
  metadata,
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const checked = validateRelayPrivateReadyClaimReceipt(receipt, metadataBytes, metadata);
  const response = await request(
    transport,
    objectUrl(PRIVATE_READY_CLAIM_OBJECT, checked.generation),
    { headers: headers(operator.accessToken) },
    'Pinned relay private-ready claim metadata',
  );
  if (response.status !== 200) reject('Pinned relay private-ready claim is absent');
  const observed = await readClaimGeneration(
    operator,
    parseJson(response.bytes, 'Pinned relay private-ready claim metadata'),
    metadataBytes,
    metadata,
    transport,
  );
  if (!isDeepStrictEqual(observed, checked)) {
    reject('Pinned relay private-ready claim has drifted');
  }
  return Object.freeze(observed);
}
