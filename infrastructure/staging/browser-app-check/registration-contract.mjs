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
import { KEY_PREREQUISITE_TERRAFORM_STATE } from './key-contract.mjs';

export const APP_CHECK_REGISTRATION_OPERATION =
  'register-nondeletable-browser-app-check-provider';
export const APP_CHECK_REGISTRATION_TTL = '3600s';
export const RECAPTCHA_KEY_RESOURCE_NAME_SHA256 =
  KEY_PREREQUISITE_TERRAFORM_STATE.recaptcha_key_name_sha256;
export const APP_CHECK_SITE_KEY_SHA256 =
  '8a76f0f2cc0e0b002ed66c7f7d01ac28a6d44cb74ad2d33c3a7b0f0203e58546';

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

export function browserAppCheckRegistrationAuthorization(
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit) || !SHA256.test(baselineSha256)) {
    reject('Browser App Check registration authorization inputs are invalid');
  }
  return [
    APP_CHECK_REGISTRATION_OPERATION,
    PROJECT_ID,
    sha256(planBytes),
    baselineSha256,
    repositoryCommit,
  ].join(':');
}

export function validateBrowserAppCheckRegistrationAuthorization(
  value,
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!safeEqual(
    value,
    browserAppCheckRegistrationAuthorization(planBytes, repositoryCommit, baselineSha256),
  )) {
    reject('Exact non-deletable browser App Check registration authorization is missing or invalid');
  }
}

export function buildBrowserAppCheckRegistrationPlanMetadata({
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  summary,
  baseline,
}) {
  if (!COMMIT.test(repositoryCommit) || !Buffer.isBuffer(planBytes)
    || !Buffer.isBuffer(planJsonBytes) || !plainObject(summary) || !plainObject(baseline)) {
    reject('Browser App Check registration plan metadata inputs are invalid');
  }
  const created = timestamp(createdAt, 'created_at');
  const baselineSha256 = sha256(Buffer.from(canonicalJson(baseline), 'utf8'));
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-plan/1',
    operation: APP_CHECK_REGISTRATION_OPERATION,
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
    global_provider_attempt_claim_creation_authorized: true,
    global_provider_attempt_claim_deletion_authorized: false,
    recaptcha_api_change_authorized: false,
    recaptcha_key_creation_authorized: false,
    recaptcha_key_update_authorized: false,
    recaptcha_key_deletion_authorized: false,
    app_check_registration_authorized: true,
    app_check_registration_deletion_authorized: false,
    app_check_enforcement_authorized: false,
    debug_token_creation_authorized: false,
    browser_request_authorized: false,
    assessment_creation_authorized: false,
    public_ingress_authorized: false,
    fixed_cost_service_authorized: false,
    irreversible_app_check_registration: true,
    private_bundle_committed: false,
  });
}

export function validateBrowserAppCheckRegistrationPlanMetadata(value, now = Date.now()) {
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
    'global_provider_attempt_claim_creation_authorized',
    'global_provider_attempt_claim_deletion_authorized',
    'recaptcha_api_change_authorized',
    'recaptcha_key_creation_authorized',
    'recaptcha_key_update_authorized',
    'recaptcha_key_deletion_authorized',
    'app_check_registration_authorized',
    'app_check_registration_deletion_authorized',
    'app_check_enforcement_authorized',
    'debug_token_creation_authorized',
    'browser_request_authorized',
    'assessment_creation_authorized',
    'public_ingress_authorized',
    'fixed_cost_service_authorized',
    'irreversible_app_check_registration',
    'private_bundle_committed',
  ], 'Browser App Check registration plan metadata');
  if (metadata.schema !== 'miakapp.staging-browser-app-check-registration-plan/1'
    || metadata.operation !== APP_CHECK_REGISTRATION_OPERATION
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
    || metadata.global_provider_attempt_claim_creation_authorized !== true
    || metadata.global_provider_attempt_claim_deletion_authorized !== false
    || metadata.recaptcha_api_change_authorized !== false
    || metadata.recaptcha_key_creation_authorized !== false
    || metadata.recaptcha_key_update_authorized !== false
    || metadata.recaptcha_key_deletion_authorized !== false
    || metadata.app_check_registration_authorized !== true
    || metadata.app_check_registration_deletion_authorized !== false
    || metadata.app_check_enforcement_authorized !== false
    || metadata.debug_token_creation_authorized !== false
    || metadata.browser_request_authorized !== false
    || metadata.assessment_creation_authorized !== false
    || metadata.public_ingress_authorized !== false
    || metadata.fixed_cost_service_authorized !== false
    || metadata.irreversible_app_check_registration !== true
    || metadata.private_bundle_committed !== false
    || sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8')) !== metadata.baseline_sha256) {
    reject('Browser App Check registration plan metadata does not match the reviewed operation');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Browser App Check registration plan metadata is expired or not yet valid');
  }
  return metadata;
}

function parseBrowserAppCheckRegistrationPlanMetadata(path) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check registration plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser App Check registration plan metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value });
}

export function readBrowserAppCheckRegistrationPlanMetadata(path, now = Date.now()) {
  const { bytes, value } = parseBrowserAppCheckRegistrationPlanMetadata(path);
  return Object.freeze({
    bytes,
    value: validateBrowserAppCheckRegistrationPlanMetadata(value, now),
  });
}

export function readBrowserAppCheckRegistrationPlanMetadataForRecovery(path) {
  const { bytes, value } = parseBrowserAppCheckRegistrationPlanMetadata(path);
  return Object.freeze({
    bytes,
    value: validateBrowserAppCheckRegistrationPlanMetadata(
      value,
      Date.parse(value.created_at),
    ),
  });
}
