import { timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
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

export const WORKFLOW_NAME = 'miakapp-auth-app-check-probe';
export const PROBE_ACCOUNT = `miakapp-staging-probe@${PROJECT_ID}.iam.gserviceaccount.com`;
export const FUNCTION_NAME = 'control-plane';
export const FUNCTION_URI = 'https://control-plane-aczhngqraq-od.a.run.app';
export const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
export const DESTINATION_PATH = '/v1/push-destinations';
export const SYNTHETIC_UID = 'miakapp-v4-staging-auth-probe-v1';
export const WORKLOAD_SOURCE_SHA256 = '86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358';
export const WORKLOAD_COMMIT = '60322c69c92b8ccf5f3d1bc87ba264a00e5dca05';
export const WORKLOAD_FUNCTION_REVISION = 'control-plane-00003-hum';
export const CUSTOM_ROLE_ID = 'miakapp.stagingAuthProbe';
export const CUSTOM_ROLE_NAME = `projects/${PROJECT_ID}/roles/${CUSTOM_ROLE_ID}`;
export const CUSTOM_ROLE_PERMISSIONS = Object.freeze([
  'firebase.clients.get',
  'firebaseappcheck.tokens.mint',
  'firebaseauth.users.get',
  'serviceusage.services.use',
]);
export const WORKFLOW_SOURCE = readFileSync(new URL('workflow.yaml', import.meta.url), 'utf8');
export const WORKFLOW_SOURCE_SHA256 = sha256(Buffer.from(WORKFLOW_SOURCE));

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const REVISION = /^[0-9a-z][0-9a-z-]{0,62}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export class StagingAuthProbeError extends Error {
  constructor(message = 'Staging Auth probe contract is invalid') {
    super(message);
    this.name = 'StagingAuthProbeError';
  }
}

function reject(message) {
  throw new StagingAuthProbeError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

export function createPrivateAuthProbeBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Auth probe bundle parent must be an absolute path');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  if (relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Auth probe bundle must remain outside the repository');
  }
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    reject('Auth probe bundle parent must be a real directory');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-auth-probe-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function authProbeApplyAuthorization(planBytes, repositoryCommit) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0 || !COMMIT.test(repositoryCommit)) {
    reject('Auth probe apply authorization inputs are invalid');
  }
  return `arm-auth-app-check-probe:${PROJECT_ID}:${sha256(planBytes)}:${repositoryCommit}`;
}

export function validateAuthProbeApplyAuthorization(value, planBytes, repositoryCommit) {
  if (!safeEqual(value, authProbeApplyAuthorization(planBytes, repositoryCommit))) {
    reject('Exact staging Auth probe apply authorization is missing or invalid');
  }
}

export function authProbeInvokeAuthorization(workflowRevision, repositoryCommit) {
  if (!REVISION.test(workflowRevision) || !COMMIT.test(repositoryCommit)) {
    reject('Auth probe invocation authorization inputs are invalid');
  }
  return [
    'invoke-auth-app-check-probe',
    PROJECT_ID,
    workflowRevision,
    WORKFLOW_SOURCE_SHA256,
    repositoryCommit,
  ].join(':');
}

export function validateAuthProbeInvokeAuthorization(value, workflowRevision, repositoryCommit) {
  if (!safeEqual(value, authProbeInvokeAuthorization(workflowRevision, repositoryCommit))) {
    reject('Exact staging Auth probe invocation authorization is missing or invalid');
  }
}

export function authProbeRetireAuthorization(planBytes, workflowRevision, repositoryCommit) {
  if (!Buffer.isBuffer(planBytes)
    || planBytes.byteLength === 0
    || !REVISION.test(workflowRevision)
    || !COMMIT.test(repositoryCommit)) {
    reject('Auth probe retirement authorization inputs are invalid');
  }
  return [
    'retire-auth-app-check-probe',
    PROJECT_ID,
    sha256(planBytes),
    workflowRevision,
    repositoryCommit,
  ].join(':');
}

export function validateAuthProbeRetireAuthorization(
  value,
  planBytes,
  workflowRevision,
  repositoryCommit,
) {
  if (!safeEqual(
    value,
    authProbeRetireAuthorization(planBytes, workflowRevision, repositoryCommit),
  )) {
    reject('Exact staging Auth probe retirement authorization is missing or invalid');
  }
}

export function authProbeRetirementRecoveryAuthorization(metadata) {
  if (!plainObject(metadata)) reject('Auth probe retirement recovery authorization metadata is invalid');
  const mutationBinding = {
    repository_commit: metadata.repository_commit,
    inventory_sha256: metadata.inventory_sha256,
    state_sha256: metadata.state_sha256,
    state_lineage_sha256: metadata.state_lineage_sha256,
    state_serial: metadata.state_serial,
    state_addresses: metadata.state_addresses,
    missing_temporaries: metadata.missing_temporaries,
    absent_remote_temporaries: metadata.absent_remote_temporaries,
    custom_role_state_action: metadata.custom_role_state_action,
    workflow_revision: metadata.workflow_revision,
  };
  return [
    'recover-auth-app-check-probe-retirement',
    PROJECT_ID,
    sha256(Buffer.from(canonicalJson(mutationBinding), 'utf8')),
    metadata.repository_commit,
  ].join(':');
}

export function validateAuthProbeRetirementRecoveryAuthorization(value, metadata) {
  if (!safeEqual(value, authProbeRetirementRecoveryAuthorization(metadata))) {
    reject('Exact Auth probe retirement recovery authorization is missing or invalid');
  }
}

export function buildAuthProbeRetirementRecoveryMetadata({
  repositoryCommit,
  createdAt,
  inventory,
}) {
  if (!COMMIT.test(repositoryCommit) || !plainObject(inventory)
    || !SHA256.test(inventory.sha256) || !SHA256.test(inventory.state_sha256)
    || !SHA256.test(inventory.state_lineage_sha256)
    || !Number.isSafeInteger(inventory.state_serial) || inventory.state_serial < 0
    || !Array.isArray(inventory.state_addresses)
    || !Array.isArray(inventory.missing_temporaries)
    || !Array.isArray(inventory.absent_remote_temporaries)
    || ![null, 'import', 'untaint'].includes(inventory.custom_role_state_action)) {
    reject('Auth probe retirement recovery metadata inputs are invalid');
  }
  const createdMilliseconds = timestamp(createdAt, 'created_at');
  const workflowRevision = inventory.live?.workflow?.revision ?? 'absent';
  if (!REVISION.test(workflowRevision)) reject('Auth probe recovery Workflow revision is invalid');
  return Object.freeze({
    schema: 'miakapp.staging-auth-probe-retirement-recovery/1',
    operation: 'recover-auth-app-check-probe-retirement',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(createdMilliseconds + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    terraform_version: TERRAFORM_VERSION,
    inventory_sha256: inventory.sha256,
    state_sha256: inventory.state_sha256,
    state_lineage_sha256: inventory.state_lineage_sha256,
    state_serial: inventory.state_serial,
    state_addresses: Object.freeze([...inventory.state_addresses]),
    missing_temporaries: Object.freeze([...inventory.missing_temporaries]),
    absent_remote_temporaries: Object.freeze([...inventory.absent_remote_temporaries]),
    custom_role_state_action: inventory.custom_role_state_action,
    workflow_revision: workflowRevision,
    private_bundle_committed: false,
    live_request_authorized: false,
  });
}

export function validateAuthProbeRetirementRecoveryMetadata(value, now = Date.now()) {
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
    'inventory_sha256',
    'state_sha256',
    'state_lineage_sha256',
    'state_serial',
    'state_addresses',
    'missing_temporaries',
    'absent_remote_temporaries',
    'custom_role_state_action',
    'workflow_revision',
    'private_bundle_committed',
    'live_request_authorized',
  ], 'Auth probe retirement recovery metadata');
  const allowedAddresses = new Set([
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    'google_project_iam_custom_role.auth_probe',
    'google_project_iam_member.auth_probe[0]',
    'google_service_account_iam_member.auth_probe_self_signer[0]',
    'google_workflows_workflow.auth_probe[0]',
    'terraform_data.auth_probe_guard',
  ]);
  const allowedTemporaries = new Set([
    'project_role_binding',
    'self_signer_binding',
    'workflow',
  ]);
  if (metadata.schema !== 'miakapp.staging-auth-probe-retirement-recovery/1'
    || metadata.operation !== 'recover-auth-app-check-probe-retirement'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.inventory_sha256)
    || !SHA256.test(metadata.state_sha256)
    || !SHA256.test(metadata.state_lineage_sha256)
    || !Number.isSafeInteger(metadata.state_serial) || metadata.state_serial < 0
    || !Array.isArray(metadata.state_addresses)
    || metadata.state_addresses.some((address) => !allowedAddresses.has(address))
    || !isDeepStrictEqual([...new Set(metadata.state_addresses)].sort(), metadata.state_addresses)
    || !Array.isArray(metadata.missing_temporaries)
    || !Array.isArray(metadata.absent_remote_temporaries)
    || (metadata.missing_temporaries.length === 0
      && metadata.absent_remote_temporaries.length === 0
      && metadata.custom_role_state_action === null)
    || metadata.missing_temporaries.some((name) => !allowedTemporaries.has(name))
    || !isDeepStrictEqual([...new Set(metadata.missing_temporaries)].sort(), metadata.missing_temporaries)
    || metadata.absent_remote_temporaries.some((name) => !allowedTemporaries.has(name))
    || !isDeepStrictEqual(
      [...new Set(metadata.absent_remote_temporaries)].sort(),
      metadata.absent_remote_temporaries,
    )
    || metadata.absent_remote_temporaries.some((name) => metadata.missing_temporaries.includes(name))
    || ![null, 'import', 'untaint'].includes(metadata.custom_role_state_action)
    || !REVISION.test(metadata.workflow_revision)
    || metadata.private_bundle_committed !== false
    || metadata.live_request_authorized !== false) {
    reject('Auth probe retirement recovery metadata does not match the reviewed operation');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Auth probe retirement recovery metadata is expired or not yet valid');
  }
  return metadata;
}

export function readAuthProbeRetirementRecoveryMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Auth probe retirement recovery metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Auth probe retirement recovery metadata is not canonical JSON');
  }
  return Object.freeze({
    bytes,
    value: validateAuthProbeRetirementRecoveryMetadata(value, now),
  });
}

export function buildAuthProbePlanMetadata({
  phase,
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  summary,
  workflowRevision = null,
}) {
  if (!['arm', 'retire'].includes(phase)
    || !COMMIT.test(repositoryCommit)
    || !Buffer.isBuffer(planBytes)
    || !Buffer.isBuffer(planJsonBytes)
    || !plainObject(summary)
    || (phase === 'arm' ? workflowRevision !== null : !REVISION.test(workflowRevision))) {
    reject('Auth probe plan metadata inputs are invalid');
  }
  const createdMilliseconds = timestamp(createdAt, 'created_at');
  return Object.freeze({
    schema: 'miakapp.staging-auth-probe-plan/1',
    phase,
    operation: phase === 'arm'
      ? 'temporarily-arm-private-auth-app-check-probe'
      : 'retire-private-auth-app-check-probe',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(createdMilliseconds + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    terraform_version: TERRAFORM_VERSION,
    terraform_plan_sha256: sha256(planBytes),
    terraform_plan_json_sha256: sha256(planJsonBytes),
    workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
    workflow_revision: workflowRevision,
    summary,
    private_bundle_committed: false,
    live_request_authorized: false,
  });
}

export function validateAuthProbePlanMetadata(value, expectedPhase, now = Date.now()) {
  const metadata = exactKeys(value, [
    'schema',
    'phase',
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
    'workflow_source_sha256',
    'workflow_revision',
    'summary',
    'private_bundle_committed',
    'live_request_authorized',
  ], 'Auth probe plan metadata');
  const expectedOperation = expectedPhase === 'arm'
    ? 'temporarily-arm-private-auth-app-check-probe'
    : 'retire-private-auth-app-check-probe';
  if (!['arm', 'retire'].includes(expectedPhase)
    || metadata.schema !== 'miakapp.staging-auth-probe-plan/1'
    || metadata.phase !== expectedPhase
    || metadata.operation !== expectedOperation
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || metadata.workflow_source_sha256 !== WORKFLOW_SOURCE_SHA256
    || (expectedPhase === 'arm' ? metadata.workflow_revision !== null : !REVISION.test(metadata.workflow_revision))
    || !plainObject(metadata.summary)
    || metadata.private_bundle_committed !== false
    || metadata.live_request_authorized !== false) {
    reject('Auth probe plan metadata does not match the reviewed operation');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Auth probe plan metadata is expired or not yet valid');
  }
  return metadata;
}

export function readAuthProbePlanMetadata(path, expectedPhase, now = Date.now()) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Auth probe plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Auth probe plan metadata is not canonical JSON');
  }
  return Object.freeze({
    bytes,
    value: validateAuthProbePlanMetadata(value, expectedPhase, now),
  });
}
