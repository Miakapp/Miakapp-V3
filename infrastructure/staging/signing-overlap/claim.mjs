import { isDeepStrictEqual } from 'node:util';

import {
  ATTEMPT_CLAIM_OBJECT,
  GATE_CLAIM_OBJECT,
  PROJECT_ID,
  SIGNING_OVERLAP_PLAN_SHA256,
  STATE_BUCKET,
  VERSION_2_NAME,
  canonicalJson,
  sha256,
  validateKeyVersionPlanMetadata,
} from './contract.mjs';

const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CLAIM_OBJECTS = Object.freeze({
  gate: GATE_CLAIM_OBJECT,
  attempt: ATTEMPT_CLAIM_OBJECT,
});

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

function validateStage(stage) {
  if (!Object.hasOwn(CLAIM_OBJECTS, stage)) reject('Signing-overlap claim stage is invalid');
  return stage;
}

function validateSession(session) {
  if (!plainObject(session) || typeof session.accessToken !== 'string'
    || session.accessToken.length < 20 || /\s/u.test(session.accessToken)) {
    reject('Signing-overlap claim requires a verified operator session');
  }
  return session;
}

function validateFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') reject('Signing-overlap claim requires an HTTP transport');
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
  if (bytes.byteLength > MAXIMUM_RESPONSE_BYTES) reject(`${description} response is too large`);
  return Object.freeze({ status: response.status, bytes });
}

function metadataUrl(stage, generation) {
  const object = CLAIM_OBJECTS[validateStage(stage)];
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(object)}`,
  );
  if (generation !== undefined) url.searchParams.set('generation', generation);
  url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

function mediaUrl(stage, generation) {
  const url = metadataUrl(stage, generation);
  url.searchParams.delete('fields');
  url.searchParams.set('alt', 'media');
  return url;
}

function uploadUrl(stage) {
  const object = CLAIM_OBJECTS[validateStage(stage)];
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${STATE_BUCKET}/o`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', object);
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

function validateStorageMetadata(value, stage, expectedSize) {
  const object = CLAIM_OBJECTS[validateStage(stage)];
  if (!plainObject(value)
    || value.bucket !== STATE_BUCKET
    || value.name !== object
    || !/^\d+$/u.test(value.generation ?? '')
    || value.generation === '0'
    || value.size !== String(expectedSize)) {
    reject('Signing-overlap claim storage metadata is malformed');
  }
  return value;
}

export function signingClaimAbsence(stage) {
  const selected = validateStage(stage);
  return Object.freeze({
    schema: 'miakapp.staging-signing-overlap-claim-observation/1',
    bucket: STATE_BUCKET,
    object: CLAIM_OBJECTS[selected],
    state: 'absent',
  });
}

export async function observeSigningClaimAbsent(session, stage, fetchImpl = globalThis.fetch) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const selected = validateStage(stage);
  const observed = await request(
    transport,
    metadataUrl(selected),
    { headers: requestHeaders(operator.accessToken) },
    `Signing-overlap ${selected} claim observation`,
  );
  if (observed.status === 404) return signingClaimAbsence(selected);
  if (observed.status === 200) reject(`The global signing-overlap ${selected} claim already exists`);
  reject(`Signing-overlap ${selected} claim observation returned an unexpected response`);
}

function validateGateReceiptReference(value) {
  if (!plainObject(value)
    || value.stage !== 'gate'
    || value.bucket !== STATE_BUCKET
    || value.object !== GATE_CLAIM_OBJECT
    || !/^\d+$/u.test(value.generation ?? '')
    || !SHA256.test(value.sha256 ?? '')) {
    reject('Signing-overlap attempt claim requires the exact gate claim receipt');
  }
  return value;
}

export function buildSigningClaim(stage, metadata, claimedAt, gateReceipt) {
  const selected = validateStage(stage);
  const checked = validateKeyVersionPlanMetadata(metadata);
  const claimed = canonicalTimestamp(claimedAt, 'claimed_at');
  const created = canonicalTimestamp(checked.created_at, 'metadata.created_at');
  const expires = canonicalTimestamp(checked.expires_at, 'metadata.expires_at');
  if (claimed < created || claimed > expires) {
    reject('Signing-overlap claim is outside the plan validity window');
  }
  const lineage = selected === 'attempt'
    ? (() => {
      const receipt = validateSigningClaimReceipt(gateReceipt, 'gate', checked);
      return {
        gate_claim_generation: receipt.generation,
        gate_claim_sha256: receipt.sha256,
      };
    })()
    : {};
  return Object.freeze({
    schema: `miakapp.staging-signing-overlap-${selected}-claim/1`,
    operation: 'create-second-signing-key-version',
    stage: selected,
    bucket: STATE_BUCKET,
    object: CLAIM_OBJECTS[selected],
    project_id: PROJECT_ID,
    repository_commit: checked.repository_commit,
    reviewed_plan_sha256: SIGNING_OVERLAP_PLAN_SHA256,
    baseline_sha256: checked.baseline_sha256,
    expected_created_version: VERSION_2_NAME,
    ...lineage,
    claimed_at: claimedAt,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export function validateSigningClaim(value, stage, metadata, gateReceipt) {
  const selected = validateStage(stage);
  const keys = [
    'schema',
    'operation',
    'stage',
    'bucket',
    'object',
    'project_id',
    'repository_commit',
    'reviewed_plan_sha256',
    'baseline_sha256',
    'expected_created_version',
    ...(selected === 'attempt' ? ['gate_claim_generation', 'gate_claim_sha256'] : []),
    'claimed_at',
    'retry_authorized',
    'deletion_authorized',
  ];
  const claim = exactKeys(value, keys, `Signing-overlap ${selected} claim`);
  const expected = buildSigningClaim(selected, metadata, claim.claimed_at, gateReceipt);
  if (!isDeepStrictEqual(claim, expected)) {
    reject(`Signing-overlap ${selected} claim does not match the reviewed operation`);
  }
  return Object.freeze(claim);
}

function buildReceipt(stage, storageMetadata, claimBytes, metadata, gateReceipt) {
  const selected = validateStage(stage);
  const claim = validateSigningClaim(
    parseJson(claimBytes, `Signing-overlap ${selected} claim content`),
    selected,
    metadata,
    gateReceipt,
  );
  if (canonicalJson(claim) !== claimBytes.toString('utf8')) {
    reject(`Signing-overlap ${selected} claim content is not canonical JSON`);
  }
  const stored = validateStorageMetadata(storageMetadata, selected, claimBytes.byteLength);
  return Object.freeze({
    schema: `miakapp.staging-signing-overlap-${selected}-claim-receipt/1`,
    stage: selected,
    bucket: stored.bucket,
    object: stored.name,
    generation: stored.generation,
    size_bytes: claimBytes.byteLength,
    sha256: sha256(claimBytes),
    repository_commit: claim.repository_commit,
    baseline_sha256: claim.baseline_sha256,
    expected_created_version: claim.expected_created_version,
    ...(selected === 'attempt' ? {
      gate_claim_generation: claim.gate_claim_generation,
      gate_claim_sha256: claim.gate_claim_sha256,
    } : {}),
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

export function validateSigningClaimReceipt(value, stage, metadata, gateReceipt) {
  const selected = validateStage(stage);
  const keys = [
    'schema',
    'stage',
    'bucket',
    'object',
    'generation',
    'size_bytes',
    'sha256',
    'repository_commit',
    'baseline_sha256',
    'expected_created_version',
    ...(selected === 'attempt' ? ['gate_claim_generation', 'gate_claim_sha256'] : []),
    'retry_authorized',
    'deletion_authorized',
    'raw_contents_committed',
  ];
  const receipt = exactKeys(value, keys, `Signing-overlap ${selected} claim receipt`);
  if (receipt.schema !== `miakapp.staging-signing-overlap-${selected}-claim-receipt/1`
    || receipt.stage !== selected
    || receipt.bucket !== STATE_BUCKET
    || receipt.object !== CLAIM_OBJECTS[selected]
    || !/^\d+$/u.test(receipt.generation ?? '')
    || receipt.generation === '0'
    || !Number.isSafeInteger(receipt.size_bytes)
    || receipt.size_bytes <= 0
    || receipt.size_bytes > MAXIMUM_RESPONSE_BYTES
    || !SHA256.test(receipt.sha256 ?? '')
    || !COMMIT.test(receipt.repository_commit ?? '')
    || receipt.repository_commit !== metadata.repository_commit
    || receipt.baseline_sha256 !== metadata.baseline_sha256
    || receipt.expected_created_version !== VERSION_2_NAME
    || receipt.retry_authorized !== false
    || receipt.deletion_authorized !== false
    || receipt.raw_contents_committed !== false) {
    reject(`Signing-overlap ${selected} claim receipt is malformed`);
  }
  if (selected === 'attempt') {
    const gate = validateGateReceiptReference(gateReceipt);
    if (receipt.gate_claim_generation !== gate.generation
      || receipt.gate_claim_sha256 !== gate.sha256) {
      reject('Signing-overlap attempt claim receipt is not bound to the gate claim');
    }
  }
  return Object.freeze(receipt);
}

async function readClaimGeneration(session, stage, storageMetadata, metadata, gateReceipt, fetchImpl) {
  const stored = validateStorageMetadata(
    storageMetadata,
    stage,
    Number(storageMetadata.size),
  );
  const observed = await request(
    fetchImpl,
    mediaUrl(stage, stored.generation),
    { headers: requestHeaders(session.accessToken) },
    `Signing-overlap ${stage} claim content verification`,
  );
  if (observed.status !== 200 || observed.bytes.byteLength !== Number(stored.size)) {
    reject(`Signing-overlap ${stage} claim content verification returned an unexpected response`);
  }
  return buildReceipt(stage, stored, observed.bytes, metadata, gateReceipt);
}

export async function createSigningClaim(
  session,
  stage,
  metadata,
  gateReceipt,
  claimedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const selected = validateStage(stage);
  const claim = buildSigningClaim(selected, metadata, claimedAt, gateReceipt);
  const claimBytes = Buffer.from(canonicalJson(claim), 'utf8');
  const created = await request(
    transport,
    uploadUrl(selected),
    {
      method: 'POST',
      headers: requestHeaders(operator.accessToken, true),
      body: claimBytes,
    },
    `Atomic signing-overlap ${selected} claim creation`,
  );
  if (created.status === 412) reject(`The global signing-overlap ${selected} claim was already acquired`);
  if (created.status !== 200) {
    reject(`Atomic signing-overlap ${selected} claim creation returned an unexpected response`);
  }
  const stored = validateStorageMetadata(
    parseJson(created.bytes, `Atomic signing-overlap ${selected} claim creation`),
    selected,
    claimBytes.byteLength,
  );
  const receipt = await readClaimGeneration(
    operator,
    selected,
    stored,
    metadata,
    gateReceipt,
    transport,
  );
  if (receipt.sha256 !== sha256(claimBytes)) {
    reject(`Signing-overlap ${selected} claim read-back differs from the created bytes`);
  }
  return receipt;
}

export async function observePinnedSigningClaim(
  session,
  stage,
  expectedReceipt,
  metadata,
  gateReceipt,
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const selected = validateStage(stage);
  const expected = validateSigningClaimReceipt(
    expectedReceipt,
    selected,
    metadata,
    gateReceipt,
  );
  const observed = await request(
    transport,
    metadataUrl(selected, expected.generation),
    { headers: requestHeaders(operator.accessToken) },
    `Pinned signing-overlap ${selected} claim metadata observation`,
  );
  if (observed.status !== 200) reject(`Pinned signing-overlap ${selected} claim is absent`);
  const stored = validateStorageMetadata(
    parseJson(observed.bytes, `Pinned signing-overlap ${selected} claim metadata`),
    selected,
    expected.size_bytes,
  );
  if (stored.generation !== expected.generation) {
    reject(`Pinned signing-overlap ${selected} claim generation has drifted`);
  }
  const content = await request(
    transport,
    mediaUrl(selected, expected.generation),
    { headers: requestHeaders(operator.accessToken) },
    `Pinned signing-overlap ${selected} claim content observation`,
  );
  if (content.status !== 200 || content.bytes.byteLength !== expected.size_bytes
    || sha256(content.bytes) !== expected.sha256) {
    reject(`Pinned signing-overlap ${selected} claim content has drifted`);
  }
  return Object.freeze(expected);
}
