import { timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  OPERATOR_USER_SHA256,
  PLAN_TTL_MILLISECONDS,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  TERRAFORM_VERSION,
  canonicalJson,
  readPrivateFile,
  sha256,
} from './contract.mjs';

export const API_PREREQUISITE_TERRAFORM_STATE = Object.freeze({
  schema: 'miakapp.staging-browser-app-check-state/1',
  object: 'terraform/browser-app-check/default.tfstate',
  generation: '1788591686695870',
  size_bytes: 11057,
  sha256: '4c2ac56a22e2ba11e6a4dd5c195910c1a0f1e749a009660294ea05bcd8c48aa7',
  terraform_version: TERRAFORM_VERSION,
  serial: 3,
  lineage_sha256: 'f6640c6c40b21a544f3ddc3ee8005f8a1d9d2eaa19dd79ba5fca5709394d9601',
  managed_resources: 2,
  data_resources: 2,
  outputs: 1,
  tainted_resources: 0,
});

export const KEY_PREREQUISITE_TERRAFORM_STATE = Object.freeze({
  schema: 'miakapp.staging-browser-app-check-state/1',
  object: 'terraform/browser-app-check/default.tfstate',
  generation: '1788596623837355',
  size_bytes: 14139,
  sha256: '954c7c6ea4187ee59764cca2d4fb0cf359cc8a580dc1f12d96cad46ae2741f9f',
  terraform_version: TERRAFORM_VERSION,
  serial: 4,
  lineage_sha256: 'f6640c6c40b21a544f3ddc3ee8005f8a1d9d2eaa19dd79ba5fca5709394d9601',
  managed_resources: 3,
  data_resources: 2,
  outputs: 1,
  tainted_resources: 0,
  recaptcha_key_name_sha256: '997f375ee6db0535dd3934dcc6ffb941f10efd5516e29b27c4caa6b8157851fb',
});

export const KEY_PREREQUISITE_ATTEMPT_CLAIM = Object.freeze({
  schema: 'miakapp.staging-browser-app-check-key-attempt-claim-receipt/1',
  bucket: 'miakapp-v4-staging-tfstate-1072737219170',
  object: 'terraform/browser-app-check/operations/recaptcha-key-create-attempt.json',
  generation: '1788596614949831',
  size_bytes: 665,
  sha256: 'da1e5792f5026f3d5f599d8b6ceb6590be8985a841b3f2c614014979d0871afc',
  repository_commit: 'ec541acce307d32f2816097065f7bff1e3f0f7d0',
  terraform_plan_sha256: 'dd45c80ed38dbe5e681713442ddaa02e1dc78d2a3ce6f9365b7bbc04f96e248b',
  baseline_sha256: '2c48ce0b837881e148a0aa9b9dd42eea66905bf96c41655424ee326fade5d75e',
  retry_authorized: false,
  deletion_authorized: false,
  raw_contents_committed: false,
});

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
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

function timestamp(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

function safeEqual(actual, expected) {
  const actualBytes = Buffer.from(typeof actual === 'string' ? actual : '', 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes);
}

export function browserAppCheckKeyAuthorization(planBytes, repositoryCommit, baselineSha256) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit) || !SHA256.test(baselineSha256)) {
    reject('Browser App Check key authorization inputs are invalid');
  }
  return [
    'create-browser-app-check-recaptcha-key',
    PROJECT_ID,
    sha256(planBytes),
    baselineSha256,
    repositoryCommit,
  ].join(':');
}

export function validateBrowserAppCheckKeyAuthorization(
  value,
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!safeEqual(
    value,
    browserAppCheckKeyAuthorization(planBytes, repositoryCommit, baselineSha256),
  )) {
    reject('Exact browser App Check key authorization is missing or invalid');
  }
}

export function buildBrowserAppCheckKeyPlanMetadata({
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  summary,
  baseline,
}) {
  if (!COMMIT.test(repositoryCommit) || !Buffer.isBuffer(planBytes)
    || !Buffer.isBuffer(planJsonBytes) || !plainObject(summary) || !plainObject(baseline)) {
    reject('Browser App Check key plan metadata inputs are invalid');
  }
  const created = timestamp(createdAt, 'created_at');
  const baselineSha256 = sha256(Buffer.from(canonicalJson(baseline), 'utf8'));
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-key-plan/1',
    operation: 'create-domain-restricted-score-key',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(created + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    terraform_version: TERRAFORM_VERSION,
    terraform_plan_sha256: sha256(planBytes),
    terraform_plan_json_sha256: sha256(planJsonBytes),
    baseline_sha256: baselineSha256,
    baseline,
    summary,
    global_attempt_claim_creation_authorized: true,
    global_attempt_claim_deletion_authorized: false,
    recaptcha_key_creation_authorized: true,
    recaptcha_key_deletion_authorized: false,
    app_check_registration_authorized: false,
    app_check_enforcement_authorized: false,
    debug_token_creation_authorized: false,
    browser_request_authorized: false,
    assessment_creation_authorized: false,
    public_ingress_authorized: false,
    fixed_cost_service_authorized: false,
    private_bundle_committed: false,
  });
}

export function validateBrowserAppCheckKeyPlanMetadata(value, now = Date.now()) {
  const metadata = exactKeys(value, [
    'schema',
    'operation',
    'project_id',
    'project_number',
    'region',
    'repository_commit',
    'created_at',
    'expires_at',
    'operator_user_sha256',
    'terraform_version',
    'terraform_plan_sha256',
    'terraform_plan_json_sha256',
    'baseline_sha256',
    'baseline',
    'summary',
    'global_attempt_claim_creation_authorized',
    'global_attempt_claim_deletion_authorized',
    'recaptcha_key_creation_authorized',
    'recaptcha_key_deletion_authorized',
    'app_check_registration_authorized',
    'app_check_enforcement_authorized',
    'debug_token_creation_authorized',
    'browser_request_authorized',
    'assessment_creation_authorized',
    'public_ingress_authorized',
    'fixed_cost_service_authorized',
    'private_bundle_committed',
  ], 'Browser App Check key plan metadata');
  if (metadata.schema !== 'miakapp.staging-browser-app-check-key-plan/1'
    || metadata.operation !== 'create-domain-restricted-score-key'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || !SHA256.test(metadata.baseline_sha256)
    || !plainObject(metadata.baseline)
    || !plainObject(metadata.summary)
    || metadata.global_attempt_claim_creation_authorized !== true
    || metadata.global_attempt_claim_deletion_authorized !== false
    || metadata.recaptcha_key_creation_authorized !== true
    || metadata.recaptcha_key_deletion_authorized !== false
    || metadata.app_check_registration_authorized !== false
    || metadata.app_check_enforcement_authorized !== false
    || metadata.debug_token_creation_authorized !== false
    || metadata.browser_request_authorized !== false
    || metadata.assessment_creation_authorized !== false
    || metadata.public_ingress_authorized !== false
    || metadata.fixed_cost_service_authorized !== false
    || metadata.private_bundle_committed !== false
    || sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8')) !== metadata.baseline_sha256) {
    reject('Browser App Check key plan metadata does not match the reviewed operation');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Browser App Check key plan metadata is expired or not yet valid');
  }
  return metadata;
}

export function readBrowserAppCheckKeyPlanMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check key plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser App Check key plan metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateBrowserAppCheckKeyPlanMetadata(value, now) });
}
