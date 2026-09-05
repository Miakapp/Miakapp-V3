import { isDeepStrictEqual } from 'node:util';

import {
  DEFAULT_RISK_SCORE,
  FIREBASE_APP_CONFIG_NAME,
  FIREBASE_APP_ID,
  OPERATOR_USER_SHA256,
  PROJECT_ID,
  canonicalJson,
  readPrivateFile,
  sha256,
} from './contract.mjs';
import {
  APP_CHECK_REGISTRATION_OPERATION,
  APP_CHECK_REGISTRATION_TTL,
  APP_CHECK_SITE_KEY_SHA256,
  RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
} from './registration-contract.mjs';
import {
  KEY_PREREQUISITE_TERRAFORM_STATE,
} from './key-contract.mjs';

export const BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET =
  'miakapp-v4-staging-tfstate-1072737219170';
export const BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT =
  'terraform/browser-app-check/operations/app-check-registration-attempt.json';
export const BROWSER_APP_CHECK_PROVIDER_ATTEMPT_BUCKET =
  BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET;
export const BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT =
  'terraform/browser-app-check/operations/app-check-provider-attempt.json';

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
    reject('Browser App Check registration claim requires a verified operator session');
  }
  return session;
}

function validateFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    reject('Browser App Check registration claim requires an HTTP transport');
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

function metadataUrl(generation, object = BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT) {
  const encodedObject = encodeURIComponent(object);
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET}/o/${encodedObject}`,
  );
  if (generation !== undefined) url.searchParams.set('generation', generation);
  url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

function mediaUrl(generation, object = BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT) {
  const url = metadataUrl(generation, object);
  url.searchParams.delete('fields');
  url.searchParams.set('alt', 'media');
  return url;
}

function uploadUrl(object = BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT) {
  const url = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET}/o`,
  );
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

function validateStorageMetadata(
  value,
  expectedSize,
  expectedObject = BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT,
) {
  if (!plainObject(value)
    || value.bucket !== BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET
    || value.name !== expectedObject
    || !/^\d+$/u.test(value.generation ?? '')
    || value.generation === '0'
    || value.size !== String(expectedSize)) {
    reject('Browser App Check registration claim metadata is malformed');
  }
  return value;
}

export function browserAppCheckRegistrationAttemptClaimAbsence() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-attempt-claim-observation/1',
    bucket: BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT,
    state: 'absent',
  });
}

export async function observeBrowserAppCheckRegistrationAttemptClaimAbsent(
  session,
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const observed = await request(
    transport,
    metadataUrl(),
    { headers: requestHeaders(operator.accessToken) },
    'Browser App Check registration claim observation',
  );
  if (observed.status === 404) return browserAppCheckRegistrationAttemptClaimAbsence();
  if (observed.status === 200) {
    reject('The global browser App Check registration claim already exists');
  }
  reject('Browser App Check registration claim observation returned an unexpected response');
}

export function buildBrowserAppCheckRegistrationAttemptClaim(metadata, attemptedAt) {
  if (!plainObject(metadata)
    || metadata.operation !== APP_CHECK_REGISTRATION_OPERATION
    || metadata.project_id !== PROJECT_ID
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || !COMMIT.test(metadata.repository_commit ?? '')
    || !SHA256.test(metadata.terraform_plan_sha256 ?? '')
    || !SHA256.test(metadata.baseline_sha256 ?? '')
    || metadata.expires_at === undefined
    || metadata.baseline?.terraform_state?.generation
      !== KEY_PREREQUISITE_TERRAFORM_STATE.generation
    || metadata.summary?.app_check_site_key_sha256 !== APP_CHECK_SITE_KEY_SHA256
    || metadata.summary?.app_check_token_ttl !== APP_CHECK_REGISTRATION_TTL
    || metadata.summary?.app_check_minimum_valid_score !== DEFAULT_RISK_SCORE) {
    reject('Browser App Check registration claim inputs are invalid');
  }
  const attempted = canonicalTimestamp(attemptedAt, 'attempted_at');
  const created = canonicalTimestamp(metadata.created_at, 'metadata.created_at');
  const expires = canonicalTimestamp(metadata.expires_at, 'metadata.expires_at');
  if (attempted < created || attempted > expires) {
    reject('Browser App Check registration claim is outside the saved-plan validity window');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-attempt-claim/1',
    operation: APP_CHECK_REGISTRATION_OPERATION,
    bucket: BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT,
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    operator_user_sha256: OPERATOR_USER_SHA256,
    expires_at: metadata.expires_at,
    firebase_app_id: FIREBASE_APP_ID,
    app_check_config_name: FIREBASE_APP_CONFIG_NAME,
    recaptcha_key_resource_name_sha256: RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
    app_check_site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
    app_check_token_ttl: APP_CHECK_REGISTRATION_TTL,
    app_check_minimum_valid_score: DEFAULT_RISK_SCORE,
    terraform_state_generation: KEY_PREREQUISITE_TERRAFORM_STATE.generation,
    attempted_at: attemptedAt,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export function validateBrowserAppCheckRegistrationAttemptClaim(value, metadata) {
  const claim = exactKeys(value, [
    'schema',
    'operation',
    'bucket',
    'object',
    'project_id',
    'repository_commit',
    'terraform_plan_sha256',
    'baseline_sha256',
    'operator_user_sha256',
    'expires_at',
    'firebase_app_id',
    'app_check_config_name',
    'recaptcha_key_resource_name_sha256',
    'app_check_site_key_sha256',
    'app_check_token_ttl',
    'app_check_minimum_valid_score',
    'terraform_state_generation',
    'attempted_at',
    'retry_authorized',
    'deletion_authorized',
  ], 'Browser App Check registration claim');
  const expected = buildBrowserAppCheckRegistrationAttemptClaim(metadata, claim.attempted_at);
  if (!isDeepStrictEqual(claim, expected)) {
    reject('Browser App Check registration claim does not match the reviewed operation');
  }
  return Object.freeze(claim);
}

function buildReceipt(storageMetadata, claimBytes, metadata) {
  const claim = validateBrowserAppCheckRegistrationAttemptClaim(
    parseJson(claimBytes, 'Browser App Check registration claim content'),
    metadata,
  );
  if (canonicalJson(claim) !== claimBytes.toString('utf8')) {
    reject('Browser App Check registration claim content is not canonical JSON');
  }
  const stored = validateStorageMetadata(storageMetadata, claimBytes.byteLength);
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-attempt-claim-receipt/1',
    bucket: stored.bucket,
    object: stored.name,
    generation: stored.generation,
    size_bytes: claimBytes.byteLength,
    sha256: sha256(claimBytes),
    repository_commit: claim.repository_commit,
    terraform_plan_sha256: claim.terraform_plan_sha256,
    baseline_sha256: claim.baseline_sha256,
    operator_user_sha256: claim.operator_user_sha256,
    expires_at: claim.expires_at,
    firebase_app_id: claim.firebase_app_id,
    app_check_config_name: claim.app_check_config_name,
    recaptcha_key_resource_name_sha256: claim.recaptcha_key_resource_name_sha256,
    app_check_site_key_sha256: claim.app_check_site_key_sha256,
    app_check_token_ttl: claim.app_check_token_ttl,
    app_check_minimum_valid_score: claim.app_check_minimum_valid_score,
    terraform_state_generation: claim.terraform_state_generation,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

export function validateBrowserAppCheckRegistrationAttemptClaimReceipt(value, metadata) {
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
    'operator_user_sha256',
    'expires_at',
    'firebase_app_id',
    'app_check_config_name',
    'recaptcha_key_resource_name_sha256',
    'app_check_site_key_sha256',
    'app_check_token_ttl',
    'app_check_minimum_valid_score',
    'terraform_state_generation',
    'retry_authorized',
    'deletion_authorized',
    'raw_contents_committed',
  ], 'Browser App Check registration claim receipt');
  if (receipt.schema !== 'miakapp.staging-browser-app-check-registration-attempt-claim-receipt/1'
    || receipt.bucket !== BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET
    || receipt.object !== BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT
    || !/^\d+$/u.test(receipt.generation ?? '')
    || receipt.generation === '0'
    || !Number.isSafeInteger(receipt.size_bytes)
    || receipt.size_bytes <= 0
    || receipt.size_bytes > MAXIMUM_RESPONSE_BYTES
    || !SHA256.test(receipt.sha256 ?? '')
    || receipt.repository_commit !== metadata.repository_commit
    || receipt.terraform_plan_sha256 !== metadata.terraform_plan_sha256
    || receipt.baseline_sha256 !== metadata.baseline_sha256
    || receipt.operator_user_sha256 !== OPERATOR_USER_SHA256
    || receipt.expires_at !== metadata.expires_at
    || receipt.firebase_app_id !== FIREBASE_APP_ID
    || receipt.app_check_config_name !== FIREBASE_APP_CONFIG_NAME
    || receipt.recaptcha_key_resource_name_sha256 !== RECAPTCHA_KEY_RESOURCE_NAME_SHA256
    || receipt.app_check_site_key_sha256 !== APP_CHECK_SITE_KEY_SHA256
    || receipt.app_check_token_ttl !== APP_CHECK_REGISTRATION_TTL
    || receipt.app_check_minimum_valid_score !== DEFAULT_RISK_SCORE
    || receipt.terraform_state_generation !== KEY_PREREQUISITE_TERRAFORM_STATE.generation
    || receipt.retry_authorized !== false
    || receipt.deletion_authorized !== false
    || receipt.raw_contents_committed !== false) {
    reject('Browser App Check registration claim receipt does not match the reviewed operation');
  }
  return Object.freeze(receipt);
}

export function readBrowserAppCheckRegistrationAttemptClaimReceipt(path, metadata) {
  const bytes = readPrivateFile(path, MAXIMUM_RESPONSE_BYTES);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check registration claim receipt is invalid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser App Check registration claim receipt is not canonical JSON');
  }
  return Object.freeze({
    bytes,
    value: validateBrowserAppCheckRegistrationAttemptClaimReceipt(value, metadata),
  });
}

async function readClaimGeneration(session, storageMetadata, metadata, fetchImpl) {
  const stored = validateStorageMetadata(storageMetadata, Number(storageMetadata.size));
  const observed = await request(
    fetchImpl,
    mediaUrl(stored.generation),
    { headers: requestHeaders(session.accessToken) },
    'Browser App Check registration claim content verification',
  );
  if (observed.status !== 200 || observed.bytes.byteLength !== Number(stored.size)) {
    reject('Browser App Check registration claim verification returned an unexpected response');
  }
  return buildReceipt(stored, observed.bytes, metadata);
}

export async function createBrowserAppCheckRegistrationAttemptClaim(
  session,
  metadata,
  attemptedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const claim = buildBrowserAppCheckRegistrationAttemptClaim(metadata, attemptedAt);
  const claimBytes = Buffer.from(canonicalJson(claim), 'utf8');
  const created = await request(
    transport,
    uploadUrl(),
    {
      method: 'POST',
      headers: requestHeaders(operator.accessToken, true),
      body: claimBytes,
    },
    'Atomic browser App Check registration claim creation',
  );
  if (created.status === 412) {
    reject('The global browser App Check registration claim was already acquired');
  }
  if (created.status !== 200) {
    reject('Atomic browser App Check registration claim creation returned an unexpected response');
  }
  const storageMetadata = validateStorageMetadata(
    parseJson(created.bytes, 'Atomic browser App Check registration claim creation'),
    claimBytes.byteLength,
  );
  const receipt = await readClaimGeneration(operator, storageMetadata, metadata, transport);
  if (receipt.sha256 !== sha256(claimBytes)) {
    reject('Browser App Check registration claim read-back does not match the created bytes');
  }
  return receipt;
}

export async function observeBrowserAppCheckRegistrationAttemptClaim(
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
    'Browser App Check registration claim recovery observation',
  );
  if (observed.status === 404) {
    reject('The global browser App Check registration claim is absent');
  }
  if (observed.status !== 200) {
    reject('Browser App Check registration claim recovery returned an unexpected response');
  }
  return readClaimGeneration(
    operator,
    parseJson(observed.bytes, 'Browser App Check registration claim recovery metadata'),
    metadata,
    transport,
  );
}

export function browserAppCheckProviderAttemptClaimAbsence() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-provider-attempt-claim-observation/1',
    bucket: BROWSER_APP_CHECK_PROVIDER_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
    state: 'absent',
  });
}

export function buildBrowserAppCheckProviderAttemptClaim(
  metadata,
  registrationClaim,
  startedAt,
) {
  const checkedRegistrationClaim =
    validateBrowserAppCheckRegistrationAttemptClaimReceipt(registrationClaim, metadata);
  canonicalTimestamp(startedAt, 'started_at');
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-provider-attempt-claim/1',
    operation: 'start-browser-app-check-provider-registration',
    bucket: BROWSER_APP_CHECK_PROVIDER_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    registration_claim_generation: checkedRegistrationClaim.generation,
    registration_claim_sha256: checkedRegistrationClaim.sha256,
    operator_user_sha256: OPERATOR_USER_SHA256,
    firebase_app_id: FIREBASE_APP_ID,
    app_check_config_name: FIREBASE_APP_CONFIG_NAME,
    recaptcha_key_resource_name_sha256: RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
    app_check_site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
    app_check_token_ttl: APP_CHECK_REGISTRATION_TTL,
    app_check_minimum_valid_score: DEFAULT_RISK_SCORE,
    terraform_state_generation: KEY_PREREQUISITE_TERRAFORM_STATE.generation,
    started_at: startedAt,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export function validateBrowserAppCheckProviderAttemptClaim(
  value,
  metadata,
  registrationClaim,
) {
  const claim = exactKeys(value, [
    'schema', 'operation', 'bucket', 'object', 'project_id', 'repository_commit',
    'terraform_plan_sha256', 'baseline_sha256', 'registration_claim_generation',
    'registration_claim_sha256', 'operator_user_sha256', 'firebase_app_id',
    'app_check_config_name', 'recaptcha_key_resource_name_sha256',
    'app_check_site_key_sha256', 'app_check_token_ttl',
    'app_check_minimum_valid_score', 'terraform_state_generation', 'started_at',
    'retry_authorized', 'deletion_authorized',
  ], 'Browser App Check provider attempt claim');
  const expected = buildBrowserAppCheckProviderAttemptClaim(
    metadata,
    registrationClaim,
    claim.started_at,
  );
  if (!isDeepStrictEqual(claim, expected)) {
    reject('Browser App Check provider attempt claim does not match the reviewed operation');
  }
  return Object.freeze(claim);
}

function buildProviderAttemptReceipt(storageMetadata, claimBytes, metadata, registrationClaim) {
  const claim = validateBrowserAppCheckProviderAttemptClaim(
    parseJson(claimBytes, 'Browser App Check provider attempt claim content'),
    metadata,
    registrationClaim,
  );
  if (canonicalJson(claim) !== claimBytes.toString('utf8')) {
    reject('Browser App Check provider attempt claim content is not canonical JSON');
  }
  const stored = validateStorageMetadata(
    storageMetadata,
    claimBytes.byteLength,
    BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
  );
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-provider-attempt-claim-receipt/1',
    bucket: stored.bucket,
    object: stored.name,
    generation: stored.generation,
    size_bytes: claimBytes.byteLength,
    sha256: sha256(claimBytes),
    repository_commit: claim.repository_commit,
    terraform_plan_sha256: claim.terraform_plan_sha256,
    baseline_sha256: claim.baseline_sha256,
    registration_claim_generation: claim.registration_claim_generation,
    registration_claim_sha256: claim.registration_claim_sha256,
    operator_user_sha256: claim.operator_user_sha256,
    firebase_app_id: claim.firebase_app_id,
    app_check_config_name: claim.app_check_config_name,
    recaptcha_key_resource_name_sha256: claim.recaptcha_key_resource_name_sha256,
    app_check_site_key_sha256: claim.app_check_site_key_sha256,
    app_check_token_ttl: claim.app_check_token_ttl,
    app_check_minimum_valid_score: claim.app_check_minimum_valid_score,
    terraform_state_generation: claim.terraform_state_generation,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

export function validateBrowserAppCheckProviderAttemptClaimReceipt(
  value,
  metadata,
  registrationClaim,
) {
  const receipt = exactKeys(value, [
    'schema', 'bucket', 'object', 'generation', 'size_bytes', 'sha256',
    'repository_commit', 'terraform_plan_sha256', 'baseline_sha256',
    'registration_claim_generation', 'registration_claim_sha256',
    'operator_user_sha256', 'firebase_app_id', 'app_check_config_name',
    'recaptcha_key_resource_name_sha256', 'app_check_site_key_sha256',
    'app_check_token_ttl', 'app_check_minimum_valid_score',
    'terraform_state_generation', 'retry_authorized', 'deletion_authorized',
    'raw_contents_committed',
  ], 'Browser App Check provider attempt claim receipt');
  const checkedRegistrationClaim =
    validateBrowserAppCheckRegistrationAttemptClaimReceipt(registrationClaim, metadata);
  if (receipt.schema !== 'miakapp.staging-browser-app-check-provider-attempt-claim-receipt/1'
    || receipt.bucket !== BROWSER_APP_CHECK_PROVIDER_ATTEMPT_BUCKET
    || receipt.object !== BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT
    || !/^\d+$/u.test(receipt.generation ?? '') || receipt.generation === '0'
    || !Number.isSafeInteger(receipt.size_bytes) || receipt.size_bytes <= 0
    || receipt.size_bytes > MAXIMUM_RESPONSE_BYTES
    || !SHA256.test(receipt.sha256 ?? '')
    || receipt.repository_commit !== metadata.repository_commit
    || receipt.terraform_plan_sha256 !== metadata.terraform_plan_sha256
    || receipt.baseline_sha256 !== metadata.baseline_sha256
    || receipt.registration_claim_generation !== checkedRegistrationClaim.generation
    || receipt.registration_claim_sha256 !== checkedRegistrationClaim.sha256
    || receipt.operator_user_sha256 !== OPERATOR_USER_SHA256
    || receipt.firebase_app_id !== FIREBASE_APP_ID
    || receipt.app_check_config_name !== FIREBASE_APP_CONFIG_NAME
    || receipt.recaptcha_key_resource_name_sha256 !== RECAPTCHA_KEY_RESOURCE_NAME_SHA256
    || receipt.app_check_site_key_sha256 !== APP_CHECK_SITE_KEY_SHA256
    || receipt.app_check_token_ttl !== APP_CHECK_REGISTRATION_TTL
    || receipt.app_check_minimum_valid_score !== DEFAULT_RISK_SCORE
    || receipt.terraform_state_generation !== KEY_PREREQUISITE_TERRAFORM_STATE.generation
    || receipt.retry_authorized !== false
    || receipt.deletion_authorized !== false
    || receipt.raw_contents_committed !== false) {
    reject('Browser App Check provider attempt claim receipt does not match the reviewed operation');
  }
  return Object.freeze(receipt);
}

export function readBrowserAppCheckProviderAttemptClaimReceipt(
  path,
  metadata,
  registrationClaim,
) {
  const bytes = readPrivateFile(path, MAXIMUM_RESPONSE_BYTES);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check provider attempt claim receipt is invalid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser App Check provider attempt claim receipt is not canonical JSON');
  }
  return Object.freeze({
    bytes,
    value: validateBrowserAppCheckProviderAttemptClaimReceipt(
      value,
      metadata,
      registrationClaim,
    ),
  });
}

async function readProviderAttemptClaimGeneration(
  session,
  storageMetadata,
  metadata,
  registrationClaim,
  fetchImpl,
) {
  const stored = validateStorageMetadata(
    storageMetadata,
    Number(storageMetadata.size),
    BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
  );
  const observed = await request(
    fetchImpl,
    mediaUrl(stored.generation, BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT),
    { headers: requestHeaders(session.accessToken) },
    'Browser App Check provider attempt claim content verification',
  );
  if (observed.status !== 200 || observed.bytes.byteLength !== Number(stored.size)) {
    reject('Browser App Check provider attempt claim verification returned an unexpected response');
  }
  return buildProviderAttemptReceipt(
    stored,
    observed.bytes,
    metadata,
    registrationClaim,
  );
}

export async function observeBrowserAppCheckProviderAttemptClaimState(
  session,
  metadata,
  registrationClaim,
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  validateBrowserAppCheckRegistrationAttemptClaimReceipt(registrationClaim, metadata);
  const observed = await request(
    transport,
    metadataUrl(undefined, BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT),
    { headers: requestHeaders(operator.accessToken) },
    'Browser App Check provider attempt claim observation',
  );
  if (observed.status === 404) return browserAppCheckProviderAttemptClaimAbsence();
  if (observed.status !== 200) {
    reject('Browser App Check provider attempt claim observation returned an unexpected response');
  }
  return readProviderAttemptClaimGeneration(
    operator,
    parseJson(observed.bytes, 'Browser App Check provider attempt claim metadata'),
    metadata,
    registrationClaim,
    transport,
  );
}

export async function observeBrowserAppCheckProviderAttemptClaimAbsent(
  session,
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const observed = await request(
    transport,
    metadataUrl(undefined, BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT),
    { headers: requestHeaders(operator.accessToken) },
    'Browser App Check provider attempt claim absence observation',
  );
  if (observed.status === 404) return browserAppCheckProviderAttemptClaimAbsence();
  if (observed.status === 200) {
    reject('The global browser App Check provider attempt claim already exists');
  }
  reject('Browser App Check provider attempt claim absence returned an unexpected response');
}

export async function observeBrowserAppCheckProviderAttemptClaim(
  session,
  metadata,
  registrationClaim,
  fetchImpl = globalThis.fetch,
) {
  const observed = await observeBrowserAppCheckProviderAttemptClaimState(
    session,
    metadata,
    registrationClaim,
    fetchImpl,
  );
  if (observed.state === 'absent') {
    reject('The global browser App Check provider attempt claim is absent');
  }
  return validateBrowserAppCheckProviderAttemptClaimReceipt(
    observed,
    metadata,
    registrationClaim,
  );
}

export async function createBrowserAppCheckProviderAttemptClaim(
  session,
  metadata,
  registrationClaim,
  startedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImpl);
  const claim = buildBrowserAppCheckProviderAttemptClaim(
    metadata,
    registrationClaim,
    startedAt,
  );
  const claimBytes = Buffer.from(canonicalJson(claim), 'utf8');
  const created = await request(
    transport,
    uploadUrl(BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT),
    {
      method: 'POST',
      headers: requestHeaders(operator.accessToken, true),
      body: claimBytes,
    },
    'Atomic browser App Check provider attempt claim creation',
  );
  if (created.status === 412) {
    reject('The global browser App Check provider attempt claim was already acquired');
  }
  if (created.status !== 200) {
    reject('Atomic browser App Check provider attempt claim creation returned an unexpected response');
  }
  const storageMetadata = validateStorageMetadata(
    parseJson(created.bytes, 'Atomic browser App Check provider attempt claim creation'),
    claimBytes.byteLength,
    BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
  );
  const receipt = await readProviderAttemptClaimGeneration(
    operator,
    storageMetadata,
    metadata,
    registrationClaim,
    transport,
  );
  if (receipt.sha256 !== sha256(claimBytes)) {
    reject('Browser App Check provider attempt claim read-back does not match the created bytes');
  }
  return receipt;
}
