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

export const WORKFLOW_NAME = 'miakapp-user-relay-probe';
export const PROBE_ACCOUNT = `miakapp-staging-probe@${PROJECT_ID}.iam.gserviceaccount.com`;
export const VERIFIER_ACCOUNT = `miakapp-staging-verifier@${PROJECT_ID}.iam.gserviceaccount.com`;
export const VERIFIER_SERVICE_NAME = 'miakapp-user-relay-verifier';
export const VERIFIER_SERVICE_URI = `https://${VERIFIER_SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app`;
export const FUNCTION_NAME = 'control-plane';
export const FUNCTION_URI = 'https://control-plane-aczhngqraq-od.a.run.app';
export const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
export const DESTINATION_PATH = '/v1/user-relay-tokens:exchange';
export const CLOUD_ASSET_SERVICE = 'cloudasset.googleapis.com';
export const SYNTHETIC_UID = 'miakapp-v4-staging-user-relay-probe-v1';
export const SYNTHETIC_HOME_ID = 'miakapp-v4-staging-user-relay-probe-v1';
export const SYNTHETIC_OWNER_UID = 'miakapp-v4-staging-user-relay-owner-v1';
export const WORKLOAD_SOURCE_SHA256 = '6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e';
export const WORKLOAD_COMMIT = '022f10e2dc15f32a8a6679b38ce7f1a04582e450';
export const WORKLOAD_FUNCTION_REVISION = 'control-plane-00004-yis';
export const WORKLOAD_IMAGE = 'europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp--v4--staging__europe--west9__control--plane@sha256:a650ae228afd9443e1bf0090b5b1e6e9203d08d8de5e24a894701d82a5db4503';
export const CAPABILITY_EXPIRY = '2026-09-06T18:00:00Z';
export const GENERATION_2_CAPABILITY_EXPIRY = '2026-09-06T12:00:00Z';
export const RETIRED_CAPABILITY_EXPIRY = '2026-09-06T06:00:00Z';
export const CUSTOM_ROLE_ID = 'miakapp.stagingUserRelayAuthProbe3';
export const CUSTOM_ROLE_NAME = `projects/${PROJECT_ID}/roles/${CUSTOM_ROLE_ID}`;
export const CUSTOM_ROLE_PERMISSIONS = Object.freeze([
  'firebase.clients.get',
  'firebaseappcheck.tokens.mint',
  'firebaseauth.users.get',
  'serviceusage.services.use',
]);
export const SIGNER_ROLE_ID = 'miakapp.stagingUserRelaySigner3';
export const SIGNER_ROLE_NAME = `projects/${PROJECT_ID}/roles/${SIGNER_ROLE_ID}`;
export const SIGNER_ROLE_PERMISSIONS = Object.freeze([
  'iam.serviceAccounts.getOpenIdToken',
  'iam.serviceAccounts.signJwt',
]);
export const FIRESTORE_ROLE_ID = 'miakapp.stagingUserRelayFirestore3';
export const FIRESTORE_ROLE_NAME = `projects/${PROJECT_ID}/roles/${FIRESTORE_ROLE_ID}`;
export const FIRESTORE_ROLE_PERMISSIONS = Object.freeze([
  'datastore.entities.create',
  'datastore.entities.delete',
  'datastore.entities.get',
  'datastore.entities.update',
]);
export const RETIRED_CUSTOM_ROLE_ID = 'miakapp.stagingAuthProbe';
export const RETIRED_CUSTOM_ROLE_NAME = `projects/${PROJECT_ID}/roles/${RETIRED_CUSTOM_ROLE_ID}`;
export const RETIRED_SIGNER_ROLE_ID = 'miakapp.stagingProbeSigner';
export const RETIRED_SIGNER_ROLE_NAME = `projects/${PROJECT_ID}/roles/${RETIRED_SIGNER_ROLE_ID}`;
export const RETIRED_FIRESTORE_ROLE_ID = 'miakapp.stagingProbeFirestore';
export const RETIRED_FIRESTORE_ROLE_NAME = `projects/${PROJECT_ID}/roles/${RETIRED_FIRESTORE_ROLE_ID}`;
export const GENERATION_2_CUSTOM_ROLE_ID = 'miakapp.stagingUserRelayAuthProbe2';
export const GENERATION_2_CUSTOM_ROLE_NAME = `projects/${PROJECT_ID}/roles/${GENERATION_2_CUSTOM_ROLE_ID}`;
export const GENERATION_2_SIGNER_ROLE_ID = 'miakapp.stagingUserRelaySigner2';
export const GENERATION_2_SIGNER_ROLE_NAME = `projects/${PROJECT_ID}/roles/${GENERATION_2_SIGNER_ROLE_ID}`;
export const GENERATION_2_FIRESTORE_ROLE_ID = 'miakapp.stagingUserRelayFirestore2';
export const GENERATION_2_FIRESTORE_ROLE_NAME = `projects/${PROJECT_ID}/roles/${GENERATION_2_FIRESTORE_ROLE_ID}`;
export const WORKFLOW_SOURCE = readFileSync(new URL('workflow.yaml', import.meta.url), 'utf8');
export const WORKFLOW_SOURCE_SHA256 = sha256(Buffer.from(WORKFLOW_SOURCE));
export const VERIFIER_SOURCE = readFileSync(new URL('verifier.mjs', import.meta.url), 'utf8');
export const VERIFIER_SOURCE_SHA256 = sha256(Buffer.from(VERIFIER_SOURCE));

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
  return `arm-user-relay-probe:${PROJECT_ID}:${sha256(planBytes)}:${repositoryCommit}`;
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
    'invoke-user-relay-probe',
    PROJECT_ID,
    workflowRevision,
    WORKFLOW_SOURCE_SHA256,
    VERIFIER_SOURCE_SHA256,
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
    'retire-user-relay-probe',
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
    recovery_phase: metadata.recovery_phase,
    inventory_sha256: metadata.inventory_sha256,
    state_sha256: metadata.state_sha256,
    state_lineage_sha256: metadata.state_lineage_sha256,
    state_serial: metadata.state_serial,
    state_addresses: metadata.state_addresses,
    missing_temporaries: metadata.missing_temporaries,
    absent_remote_temporaries: metadata.absent_remote_temporaries,
    persistent_state_actions: metadata.persistent_state_actions,
    deleted_custom_roles: metadata.deleted_custom_roles,
    guard_state_status: metadata.guard_state_status,
    guard_state_action: metadata.guard_state_action,
    retirement_finalization_required: metadata.retirement_finalization_required,
    workflow_revision: metadata.workflow_revision,
  };
  return [
    'recover-user-relay-probe-retirement',
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
    || !Array.isArray(inventory.persistent_state_actions)
    || !isDeepStrictEqual(inventory.deleted_custom_roles, [])
    || !['cloud_asset_api_prerequisite', 'full']
      .includes(inventory.recovery_phase)
    || typeof inventory.guard_state_status !== 'string'
    || typeof inventory.retirement_finalization_required !== 'boolean'
    || (inventory.guard_state_action !== null && !plainObject(inventory.guard_state_action))) {
    reject('Auth probe retirement recovery metadata inputs are invalid');
  }
  const createdMilliseconds = timestamp(createdAt, 'created_at');
  const workflowRevision = inventory.live?.workflow?.revision ?? 'absent';
  if (!REVISION.test(workflowRevision)) reject('Auth probe recovery Workflow revision is invalid');
  return Object.freeze({
    schema: 'miakapp.staging-auth-probe-retirement-recovery/1',
    operation: 'recover-user-relay-probe-retirement',
    recovery_phase: inventory.recovery_phase,
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
    persistent_state_actions: Object.freeze(inventory.persistent_state_actions.map((entry) => Object.freeze({ ...entry }))),
    deleted_custom_roles: Object.freeze(inventory.deleted_custom_roles.map((entry) => Object.freeze({ ...entry }))),
    guard_state_status: inventory.guard_state_status,
    guard_state_action: inventory.guard_state_action === null
      ? null
      : Object.freeze({ ...inventory.guard_state_action }),
    retirement_finalization_required: inventory.retirement_finalization_required,
    workflow_revision: workflowRevision,
    private_bundle_committed: false,
    live_request_authorized: false,
  });
}

export function validateAuthProbeRetirementRecoveryMetadata(value, now = Date.now()) {
  const metadata = exactKeys(value, [
    'schema',
    'operation',
    'recovery_phase',
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
    'persistent_state_actions',
    'deleted_custom_roles',
    'guard_state_status',
    'guard_state_action',
    'retirement_finalization_required',
    'workflow_revision',
    'private_bundle_committed',
    'live_request_authorized',
  ], 'Auth probe retirement recovery metadata');
  const allowedAddresses = new Set([
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    'google_cloud_run_v2_service.auth_probe_verifier[0]',
    'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]',
    'google_project_iam_custom_role.auth_probe_generation_3',
    'google_project_iam_custom_role.auth_probe_firestore_generation_3',
    'google_project_iam_custom_role.auth_probe_signer_generation_3',
    'google_project_iam_custom_role.auth_probe_generation_1',
    'google_project_iam_custom_role.auth_probe_firestore_generation_1',
    'google_project_iam_custom_role.auth_probe_signer_generation_1',
    'google_project_iam_custom_role.auth_probe_generation_2',
    'google_project_iam_custom_role.auth_probe_firestore_generation_2',
    'google_project_iam_custom_role.auth_probe_signer_generation_2',
    'google_project_iam_member.auth_probe[0]',
    'google_project_iam_member.auth_probe_firestore[0]',
    'google_project_service.auth_probe_asset_inventory',
    'google_service_account.auth_probe_verifier',
    'google_service_account_iam_member.auth_probe_self_signer[0]',
    'google_workflows_workflow.auth_probe[0]',
    'terraform_data.auth_probe_guard',
  ]);
  const allowedTemporaries = new Set([
    'firestore_role_binding',
    'project_role_binding',
    'self_signer_binding',
    'verifier_invoker_binding',
    'verifier_service',
    'workflow',
  ]);
  const finalizationStateAddresses = [
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    'google_project_iam_custom_role.auth_probe_generation_3',
    'google_project_iam_custom_role.auth_probe_firestore_generation_3',
    'google_project_iam_custom_role.auth_probe_signer_generation_3',
    'google_project_iam_custom_role.auth_probe_generation_1',
    'google_project_iam_custom_role.auth_probe_firestore_generation_1',
    'google_project_iam_custom_role.auth_probe_signer_generation_1',
    'google_project_iam_custom_role.auth_probe_generation_2',
    'google_project_iam_custom_role.auth_probe_firestore_generation_2',
    'google_project_iam_custom_role.auth_probe_signer_generation_2',
    'google_project_service.auth_probe_asset_inventory',
    'google_service_account.auth_probe_verifier',
    'terraform_data.auth_probe_guard',
  ].sort();
  const persistentImportIds = Object.freeze({
    'google_project_iam_custom_role.auth_probe_generation_3': CUSTOM_ROLE_NAME,
    'google_project_iam_custom_role.auth_probe_firestore_generation_3': FIRESTORE_ROLE_NAME,
    'google_project_iam_custom_role.auth_probe_signer_generation_3': SIGNER_ROLE_NAME,
    'google_project_iam_custom_role.auth_probe_generation_1': RETIRED_CUSTOM_ROLE_NAME,
    'google_project_iam_custom_role.auth_probe_firestore_generation_1': RETIRED_FIRESTORE_ROLE_NAME,
    'google_project_iam_custom_role.auth_probe_signer_generation_1': RETIRED_SIGNER_ROLE_NAME,
    'google_project_iam_custom_role.auth_probe_generation_2': GENERATION_2_CUSTOM_ROLE_NAME,
    'google_project_iam_custom_role.auth_probe_firestore_generation_2': GENERATION_2_FIRESTORE_ROLE_NAME,
    'google_project_iam_custom_role.auth_probe_signer_generation_2': GENERATION_2_SIGNER_ROLE_NAME,
    'google_project_service.auth_probe_asset_inventory': `${PROJECT_ID}/${CLOUD_ASSET_SERVICE}`,
    'google_service_account.auth_probe_verifier': `projects/${PROJECT_ID}/serviceAccounts/${VERIFIER_ACCOUNT}`,
  });
  const guardActions = Object.freeze({
    absent: 'create',
    current: null,
    previous: 'update',
    tainted_current: 'untaint',
    tainted_previous: 'untaint_then_update',
  });
  const expectedGuardAction = guardActions[metadata.guard_state_status];
  if (metadata.schema !== 'miakapp.staging-auth-probe-retirement-recovery/1'
    || metadata.operation !== 'recover-user-relay-probe-retirement'
    || !['cloud_asset_api_prerequisite', 'full']
      .includes(metadata.recovery_phase)
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
    || !Array.isArray(metadata.persistent_state_actions)
    || !Array.isArray(metadata.deleted_custom_roles)
    || typeof metadata.retirement_finalization_required !== 'boolean'
    || expectedGuardAction === undefined
    || (metadata.recovery_phase === 'cloud_asset_api_prerequisite'
      ? metadata.guard_state_action !== null
      : (expectedGuardAction === null
      ? metadata.guard_state_action !== null
      : (!plainObject(metadata.guard_state_action)
        || !isDeepStrictEqual(Object.keys(metadata.guard_state_action).sort(), ['action', 'address'])
        || metadata.guard_state_action.address !== 'terraform_data.auth_probe_guard'
        || metadata.guard_state_action.action !== expectedGuardAction)))
    || (metadata.guard_state_status === 'absent') === metadata.state_addresses.includes('terraform_data.auth_probe_guard')
    || (metadata.missing_temporaries.length === 0
      && metadata.absent_remote_temporaries.length === 0
      && metadata.persistent_state_actions.length === 0
      && metadata.guard_state_action === null
      && !metadata.retirement_finalization_required)
    || metadata.missing_temporaries.some((name) => !allowedTemporaries.has(name))
    || !isDeepStrictEqual([...new Set(metadata.missing_temporaries)].sort(), metadata.missing_temporaries)
    || metadata.absent_remote_temporaries.some((name) => !allowedTemporaries.has(name))
    || !isDeepStrictEqual(
      [...new Set(metadata.absent_remote_temporaries)].sort(),
      metadata.absent_remote_temporaries,
    )
    || metadata.absent_remote_temporaries.some((name) => metadata.missing_temporaries.includes(name))
    || metadata.persistent_state_actions.some((entry) => {
      if (!plainObject(entry) || persistentImportIds[entry.address] !== entry.import_id) return true;
      if (['enable_import', 'enable_reimport'].includes(entry.action)) {
        if (entry.address !== 'google_project_service.auth_probe_asset_inventory'
          || !isDeepStrictEqual(Object.keys(entry).sort(), ['action', 'address', 'import_id'])) {
          return true;
        }
        return (entry.action === 'enable_import')
          === metadata.state_addresses.includes(entry.address);
      }
      if (!isDeepStrictEqual(Object.keys(entry).sort(), ['action', 'address', 'import_id'])
        || !['create', 'import', 'recreate', 'untaint'].includes(entry.action)) return true;
      return ['create', 'import'].includes(entry.action)
        ? metadata.state_addresses.includes(entry.address)
        : !metadata.state_addresses.includes(entry.address);
    })
    || !isDeepStrictEqual(
      [...new Set(metadata.persistent_state_actions.map((entry) => entry.address))].sort(),
      metadata.persistent_state_actions.map((entry) => entry.address),
    )
    || !isDeepStrictEqual(metadata.deleted_custom_roles, [])
    || (metadata.retirement_finalization_required
      && (metadata.recovery_phase !== 'full'
        || metadata.missing_temporaries.length !== 0
        || metadata.absent_remote_temporaries.length !== 0
        || metadata.persistent_state_actions.length !== 0
        || metadata.guard_state_status !== 'current'
        || metadata.guard_state_action !== null
        || metadata.workflow_revision !== 'absent'
        || !isDeepStrictEqual(metadata.state_addresses, finalizationStateAddresses)))
    || (metadata.recovery_phase === 'cloud_asset_api_prerequisite'
      && (!isDeepStrictEqual(metadata.missing_temporaries, [])
        || !isDeepStrictEqual(metadata.absent_remote_temporaries, [])
        || metadata.deleted_custom_roles.length !== 0
        || metadata.retirement_finalization_required
        || metadata.persistent_state_actions.length !== 1
        || metadata.persistent_state_actions[0]?.address !== 'google_project_service.auth_probe_asset_inventory'
        || !['enable_import', 'enable_reimport'].includes(metadata.persistent_state_actions[0]?.action)))
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
      ? 'temporarily-arm-private-user-relay-probe'
      : 'retire-private-user-relay-probe',
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
    verifier_source_sha256: VERIFIER_SOURCE_SHA256,
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
    'verifier_source_sha256',
    'workflow_revision',
    'summary',
    'private_bundle_committed',
    'live_request_authorized',
  ], 'Auth probe plan metadata');
  const expectedOperation = expectedPhase === 'arm'
    ? 'temporarily-arm-private-user-relay-probe'
    : 'retire-private-user-relay-probe';
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
    || metadata.verifier_source_sha256 !== VERIFIER_SOURCE_SHA256
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
