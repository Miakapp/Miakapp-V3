import { timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  OPERATOR_USER_SHA256,
  PLAN_TTL_MILLISECONDS,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  childEnvironment,
  readPrivateFile,
  sha256,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from '../workload/contract.mjs';

export {
  OPERATOR_USER_SHA256,
  PLAN_TTL_MILLISECONDS,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  childEnvironment,
  readPrivateFile,
  sha256,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
};

export const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
export const FIREBASE_APP_NAME = `projects/${PROJECT_ID}/webApps/${FIREBASE_APP_ID}`;
export const FIREBASE_APP_CONFIG_NAME = `projects/${PROJECT_NUMBER}/apps/${FIREBASE_APP_ID}/recaptchaEnterpriseConfig`;
export const FIREBASE_APP_DISPLAY_NAME = 'Miakapp V4 Staging Web';
export const HOSTING_DOMAIN = 'miakapp-v4-staging.web.app';
export const RECAPTCHA_API = 'recaptchaenterprise.googleapis.com';
export const RECAPTCHA_DISPLAY_NAME = 'Miakapp V4 staging browser App Check';
export const INTENDED_TOKEN_TTL = '3600s';
export const DEFAULT_RISK_SCORE = 0.5;
export const INITIAL_TERRAFORM_STATE = Object.freeze({
  schema: 'miakapp.staging-browser-app-check-state/1',
  object: 'terraform/browser-app-check/default.tfstate',
  generation: '1788588916588868',
  size_bytes: 181,
  sha256: '7f80cac767df4b54265a6e72ae6660d252ea6d247f506d1640f4ac9792dc3137',
  terraform_version: TERRAFORM_VERSION,
  serial: 1,
  lineage_sha256: 'f6640c6c40b21a544f3ddc3ee8005f8a1d9d2eaa19dd79ba5fca5709394d9601',
  managed_resources: 0,
  data_resources: 0,
  outputs: 0,
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

export function createPrivateBrowserAppCheckBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Browser App Check bundle parent must be absolute');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Browser App Check bundle parent must be a private directory outside the repository');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-browser-app-check-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function privateBrowserAppCheckBundle(path, repositoryRoot) {
  const bundle = realpathSync(resolve(path));
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, bundle);
  const entry = lstatSync(bundle);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Browser App Check operation requires an exact private bundle directory');
  }
  return bundle;
}

export function browserAppCheckApiAuthorization(planBytes, repositoryCommit, baselineSha256) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit) || !SHA256.test(baselineSha256)) {
    reject('Browser App Check API authorization inputs are invalid');
  }
  return [
    'enable-browser-app-check-prerequisite-api',
    PROJECT_ID,
    sha256(planBytes),
    baselineSha256,
    repositoryCommit,
  ].join(':');
}

export function validateBrowserAppCheckApiAuthorization(
  value,
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!safeEqual(
    value,
    browserAppCheckApiAuthorization(planBytes, repositoryCommit, baselineSha256),
  )) {
    reject('Exact browser App Check prerequisite API authorization is missing or invalid');
  }
}

export function buildBrowserAppCheckApiPlanMetadata({
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  summary,
  baseline,
}) {
  if (!COMMIT.test(repositoryCommit) || !Buffer.isBuffer(planBytes)
    || !Buffer.isBuffer(planJsonBytes) || !plainObject(summary) || !plainObject(baseline)) {
    reject('Browser App Check API plan metadata inputs are invalid');
  }
  const created = timestamp(createdAt, 'created_at');
  const baselineSha256 = sha256(Buffer.from(canonicalJson(baseline), 'utf8'));
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-api-plan/1',
    operation: 'enable-recaptcha-enterprise-api-only',
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
    recaptcha_key_creation_authorized: false,
    app_check_registration_authorized: false,
    app_check_enforcement_authorized: false,
    debug_token_creation_authorized: false,
    public_ingress_authorized: false,
    private_bundle_committed: false,
  });
}

export function validateBrowserAppCheckApiPlanMetadata(value, now = Date.now()) {
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
    'recaptcha_key_creation_authorized',
    'app_check_registration_authorized',
    'app_check_enforcement_authorized',
    'debug_token_creation_authorized',
    'public_ingress_authorized',
    'private_bundle_committed',
  ], 'Browser App Check API plan metadata');
  if (metadata.schema !== 'miakapp.staging-browser-app-check-api-plan/1'
    || metadata.operation !== 'enable-recaptcha-enterprise-api-only'
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
    || metadata.recaptcha_key_creation_authorized !== false
    || metadata.app_check_registration_authorized !== false
    || metadata.app_check_enforcement_authorized !== false
    || metadata.debug_token_creation_authorized !== false
    || metadata.public_ingress_authorized !== false
    || metadata.private_bundle_committed !== false
    || sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8')) !== metadata.baseline_sha256) {
    reject('Browser App Check API plan metadata does not match the reviewed operation');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Browser App Check API plan metadata is expired or not yet valid');
  }
  return metadata;
}

export function readBrowserAppCheckApiPlanMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check API plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser App Check API plan metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateBrowserAppCheckApiPlanMetadata(value, now) });
}
