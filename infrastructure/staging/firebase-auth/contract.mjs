import { timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
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

export function createPrivateFirebaseAuthBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Firebase Auth bundle parent must be absolute');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Firebase Auth bundle parent must be a private directory outside the repository');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-firebase-auth-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function firebaseAuthApplyAuthorization(planBytes, repositoryCommit) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0 || !COMMIT.test(repositoryCommit)) {
    reject('Firebase Auth apply authorization inputs are invalid');
  }
  return `initialize-nondeletable-firebase-auth:${PROJECT_ID}:${sha256(planBytes)}:${repositoryCommit}`;
}

export function validateFirebaseAuthApplyAuthorization(value, planBytes, repositoryCommit) {
  if (!safeEqual(value, firebaseAuthApplyAuthorization(planBytes, repositoryCommit))) {
    reject('Exact non-deletable Firebase Auth initialization authorization is missing or invalid');
  }
}

export function firebaseAuthStateRecoveryAuthorization(metadata) {
  if (!plainObject(metadata)) reject('Firebase Auth state recovery authorization metadata is invalid');
  return [
    'recover-firebase-auth-state',
    PROJECT_ID,
    metadata.action,
    metadata.state_lineage_sha256,
    String(metadata.state_serial),
    metadata.state_sha256,
    metadata.live_config_sha256,
    metadata.repository_commit,
  ].join(':');
}

export function validateFirebaseAuthStateRecoveryAuthorization(value, metadata) {
  if (!safeEqual(value, firebaseAuthStateRecoveryAuthorization(metadata))) {
    reject('Exact Firebase Auth state recovery authorization is missing or invalid');
  }
}

export function buildFirebaseAuthStateRecoveryMetadata({
  repositoryCommit,
  createdAt,
  action,
  state,
  liveConfigSha256,
}) {
  if (!COMMIT.test(repositoryCommit) || !['import', 'untaint', 'reconcile'].includes(action)
    || !plainObject(state) || !SHA256.test(liveConfigSha256)) {
    reject('Firebase Auth state recovery metadata inputs are invalid');
  }
  const created = timestamp(createdAt, 'created_at');
  return Object.freeze({
    schema: 'miakapp.staging-firebase-auth-state-recovery/1',
    operation: 'recover-firebase-auth-state',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(created + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    terraform_version: TERRAFORM_VERSION,
    action,
    resource_address: 'google_identity_platform_config.firebase_auth',
    import_id: `projects/${PROJECT_ID}/config`,
    state_lineage_sha256: state.lineage_sha256,
    state_serial: state.serial,
    state_sha256: state.sha256,
    live_config_sha256: liveConfigSha256,
    irreversible_service_initialization: false,
    private_bundle_committed: false,
  });
}

export function validateFirebaseAuthStateRecoveryMetadata(value, now = Date.now()) {
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
    'action',
    'resource_address',
    'import_id',
    'state_lineage_sha256',
    'state_serial',
    'state_sha256',
    'live_config_sha256',
    'irreversible_service_initialization',
    'private_bundle_committed',
  ], 'Firebase Auth state recovery metadata');
  if (metadata.schema !== 'miakapp.staging-firebase-auth-state-recovery/1'
    || metadata.operation !== 'recover-firebase-auth-state'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !['import', 'untaint', 'reconcile'].includes(metadata.action)
    || metadata.resource_address !== 'google_identity_platform_config.firebase_auth'
    || metadata.import_id !== `projects/${PROJECT_ID}/config`
    || !SHA256.test(metadata.state_lineage_sha256)
    || !Number.isSafeInteger(metadata.state_serial) || metadata.state_serial < 0
    || !SHA256.test(metadata.state_sha256)
    || !SHA256.test(metadata.live_config_sha256)
    || metadata.irreversible_service_initialization !== false
    || metadata.private_bundle_committed !== false) {
    reject('Firebase Auth state recovery metadata does not match the reviewed operation');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Firebase Auth state recovery metadata is expired or not yet valid');
  }
  return metadata;
}

export function readFirebaseAuthStateRecoveryMetadata(path, now = Date.now()) {
  return readCanonicalMetadata(
    path,
    (value) => validateFirebaseAuthStateRecoveryMetadata(value, now),
    'Firebase Auth state recovery metadata',
  );
}

export function firebaseAuthReconciliationAuthorization(metadata) {
  if (!plainObject(metadata)) reject('Firebase Auth reconciliation authorization metadata is invalid');
  return [
    'reconcile-firebase-auth',
    PROJECT_ID,
    metadata.terraform_plan_sha256,
    metadata.state_sha256,
    metadata.live_config_sha256,
    metadata.repository_commit,
  ].join(':');
}

export function validateFirebaseAuthReconciliationAuthorization(value, metadata) {
  if (!safeEqual(value, firebaseAuthReconciliationAuthorization(metadata))) {
    reject('Exact Firebase Auth reconciliation authorization is missing or invalid');
  }
}

export function buildFirebaseAuthReconciliationMetadata({
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  summary,
  state,
  liveConfigSha256,
}) {
  if (!COMMIT.test(repositoryCommit) || !Buffer.isBuffer(planBytes)
    || !Buffer.isBuffer(planJsonBytes) || !plainObject(summary)
    || !plainObject(state) || !SHA256.test(liveConfigSha256)) {
    reject('Firebase Auth reconciliation metadata inputs are invalid');
  }
  const created = timestamp(createdAt, 'created_at');
  return Object.freeze({
    schema: 'miakapp.staging-firebase-auth-reconciliation/1',
    operation: 'reconcile-firebase-auth',
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
    state_lineage_sha256: state.lineage_sha256,
    state_serial: state.serial,
    state_sha256: state.sha256,
    live_config_sha256: liveConfigSha256,
    summary,
    irreversible_service_initialization: false,
    private_bundle_committed: false,
  });
}

export function validateFirebaseAuthReconciliationMetadata(value, now = Date.now()) {
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
    'state_lineage_sha256',
    'state_serial',
    'state_sha256',
    'live_config_sha256',
    'summary',
    'irreversible_service_initialization',
    'private_bundle_committed',
  ], 'Firebase Auth reconciliation metadata');
  if (metadata.schema !== 'miakapp.staging-firebase-auth-reconciliation/1'
    || metadata.operation !== 'reconcile-firebase-auth'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || !SHA256.test(metadata.state_lineage_sha256)
    || !Number.isSafeInteger(metadata.state_serial) || metadata.state_serial < 0
    || !SHA256.test(metadata.state_sha256)
    || !SHA256.test(metadata.live_config_sha256)
    || !plainObject(metadata.summary)
    || metadata.irreversible_service_initialization !== false
    || metadata.private_bundle_committed !== false) {
    reject('Firebase Auth reconciliation metadata does not match the reviewed operation');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Firebase Auth reconciliation metadata is expired or not yet valid');
  }
  return metadata;
}

export function readFirebaseAuthReconciliationMetadata(path, now = Date.now()) {
  return readCanonicalMetadata(
    path,
    (value) => validateFirebaseAuthReconciliationMetadata(value, now),
    'Firebase Auth reconciliation metadata',
  );
}

function readCanonicalMetadata(path, validate, description) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} is not valid JSON`);
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject(`${description} is not canonical JSON`);
  }
  return Object.freeze({ bytes, value: validate(value) });
}

export function buildFirebaseAuthPlanMetadata({
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  summary,
}) {
  if (!COMMIT.test(repositoryCommit) || !Buffer.isBuffer(planBytes)
    || !Buffer.isBuffer(planJsonBytes) || !plainObject(summary)) {
    reject('Firebase Auth plan metadata inputs are invalid');
  }
  const created = timestamp(createdAt, 'created_at');
  return Object.freeze({
    schema: 'miakapp.staging-firebase-auth-plan/1',
    operation: 'initialize-nondeletable-firebase-auth',
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
    summary,
    irreversible_service_initialization: true,
    private_bundle_committed: false,
  });
}

export function validateFirebaseAuthPlanMetadata(value, now = Date.now()) {
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
    'summary',
    'irreversible_service_initialization',
    'private_bundle_committed',
  ], 'Firebase Auth plan metadata');
  if (metadata.schema !== 'miakapp.staging-firebase-auth-plan/1'
    || metadata.operation !== 'initialize-nondeletable-firebase-auth'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || !plainObject(metadata.summary)
    || metadata.irreversible_service_initialization !== true
    || metadata.private_bundle_committed !== false) {
    reject('Firebase Auth plan metadata does not match the reviewed initialization');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Firebase Auth plan metadata is expired or not yet valid');
  }
  return metadata;
}

export function readFirebaseAuthPlanMetadata(path, now = Date.now()) {
  return readCanonicalMetadata(
    path,
    (value) => validateFirebaseAuthPlanMetadata(value, now),
    'Firebase Auth plan metadata',
  );
}
