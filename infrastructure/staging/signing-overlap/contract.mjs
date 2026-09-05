import { spawnSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const KEY_RING = PROJECT_ID;
export const KEY_ID = 'access-token-signing';
export const KEY_NAME =
  `projects/${PROJECT_ID}/locations/${REGION}/keyRings/${KEY_RING}/cryptoKeys/${KEY_ID}`;
export const VERSION_1_NAME = `${KEY_NAME}/cryptoKeyVersions/1`;
export const VERSION_2_NAME = `${KEY_NAME}/cryptoKeyVersions/2`;
export const STATE_BUCKET = `${PROJECT_ID}-tfstate-${PROJECT_NUMBER}`;
export const GATE_CLAIM_OBJECT =
  'terraform/signing-overlap/operations/version-2-create-gate.json';
export const ATTEMPT_CLAIM_OBJECT =
  'terraform/signing-overlap/operations/version-2-create-attempt.json';
export const OPERATOR_USER_SHA256 =
  'd1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c';
export const RUNTIME_CONFIG_SHA256 =
  '20be750358ffbc2136bab26bca6338b430ea6480ae9874f3fe5e7132c5e0db10';
export const DEPLOYED_REPOSITORY_COMMIT = 'e42cdd70f812580a6070f0e850daa04dbe0cee42';
export const SIGNING_OVERLAP_PLAN_SHA256 =
  '0bf8ef54a508e93cab1f61c6e8f70c5f52d01e85da37d6fadd69efdb1ca636f1';
export const PLAN_TTL_MILLISECONDS = 2 * 60 * 60 * 1_000;

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_PRIVATE_FILE_BYTES = 4 * 1024 * 1024;
const FORBIDDEN_ENVIRONMENT_NAMES = new Set([
  'ALL_PROXY',
  'FIREBASE_TOKEN',
  'GCLOUD_KEYFILE_JSON',
  'GCLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_CREDENTIALS',
  'GOOGLE_CLOUD_KEYFILE_JSON',
  'GOOGLE_CREDENTIALS',
  'GRPC_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NO_PROXY',
  'XDG_CONFIG_HOME',
  'all_proxy',
  'grpc_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
]);
const PRIVATE_MATERIAL = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
];
const FORBIDDEN_FIELD_NAMES = new Set([
  'access_token',
  'authorization',
  'cookie',
  'id_token',
  'password',
  'private_key',
  'refresh_token',
  'secret_value',
]);
const reviewedPlan = JSON.parse(
  readFileSync(new URL('plan.json', import.meta.url), 'utf8'),
);

export class StagingSigningOverlapError extends Error {
  constructor(message = 'Staging signing-overlap contract is invalid') {
    super(message);
    this.name = 'StagingSigningOverlapError';
  }
}

function reject(message) {
  throw new StagingSigningOverlapError(message);
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

function rejectPrivateMaterial(value, path = 'value') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains credential material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELD_NAMES.has(key)) {
        reject(`${path}.${key} is a forbidden credential field`);
      }
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateSigningOverlapPlanValue(value) {
  rejectPrivateMaterial(value, 'plan');
  const plan = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'key',
    'baseline',
    'mutation',
    'coordination',
    'rollout',
    'cost',
  ], 'Signing-overlap plan');
  const target = exactKeys(plan.target, [
    'project_id',
    'project_number',
    'region',
    'data_policy',
    'forbidden_project_ids',
    'public_ingress_authorized',
    'live_request_authorized',
  ], 'Signing-overlap target');
  const key = exactKeys(plan.key, [
    'name',
    'purpose',
    'algorithm',
    'protection_level',
    'destroy_scheduled_duration',
    'automatic_rotation',
    'expected_existing_version',
    'expected_created_version',
    'maximum_versions_after_creation',
  ], 'Signing-overlap key');
  const baseline = exactKeys(plan.baseline, [
    'reviewed_repository_commit',
    'deployed_repository_commit',
    'runtime_config_sha256',
    'runtime_schema',
    'current_kid',
    'published_kids',
    'kms_version_count',
    'control_plane_ingress',
    'control_plane_unauthenticated_invokers',
  ], 'Signing-overlap baseline');
  const mutation = exactKeys(plan.mutation, [
    'operation',
    'transport',
    'maximum_kms_version_creations',
    'maximum_coordination_objects_created',
    'automatic_retry',
    'created_version_enabled',
    'existing_version_changed',
    'runtime_changed_by_creation',
    'terraform_state_changed_by_creation',
    'key_version_managed_outside_terraform',
  ], 'Signing-overlap mutation');
  const coordination = exactKeys(plan.coordination, [
    'bucket',
    'gate_object',
    'attempt_object',
    'creation_precondition',
    'claims_contain_credentials',
    'claims_are_deleted_by_driver',
    'attempt_claim_is_irreversible_boundary',
  ], 'Signing-overlap coordination');
  const rollout = exactKeys(plan.rollout, [
    'stages',
    'prepublication_seconds',
    'retiring_key_retention_seconds',
    'maximum_published_keys',
    'republish_removed_private_key',
    'version_1_destruction_authorized',
  ], 'Signing-overlap rollout');
  const cost = exactKeys(plan.cost, [
    'currency',
    'maximum_incremental_monthly_usd',
    'pricing_checked_on',
    'pricing_source',
    'key_admin_operations_free',
    'stress_test',
  ], 'Signing-overlap cost');
  if (plan.schema !== 'miakapp.staging-signing-overlap-plan/1'
    || plan.revision !== 1
    || plan.state !== 'reviewed_key_version_absent'
    || target.project_id !== PROJECT_ID
    || target.project_number !== PROJECT_NUMBER
    || target.region !== REGION
    || target.data_policy !== 'synthetic_only'
    || !isDeepStrictEqual(target.forbidden_project_ids, [
      'demo-miakapp-v4',
      'miakapp-3',
      'miakapp-v4',
    ])
    || target.public_ingress_authorized !== false
    || target.live_request_authorized !== false
    || key.name !== KEY_NAME
    || key.purpose !== 'ASYMMETRIC_SIGN'
    || key.algorithm !== 'EC_SIGN_ED25519'
    || key.protection_level !== 'SOFTWARE'
    || key.destroy_scheduled_duration !== '2592000s'
    || key.automatic_rotation !== false
    || key.expected_existing_version !== VERSION_1_NAME
    || key.expected_created_version !== VERSION_2_NAME
    || key.maximum_versions_after_creation !== 2
    || baseline.reviewed_repository_commit !== '8f098afb40f82aa4511f3a911a4357cb7e51da8e'
    || baseline.deployed_repository_commit !== DEPLOYED_REPOSITORY_COMMIT
    || baseline.runtime_config_sha256 !== RUNTIME_CONFIG_SHA256
    || baseline.runtime_schema !== 'miakapp.production-runtime/2'
    || baseline.current_kid !== 'staging-access-token-v1'
    || !isDeepStrictEqual(baseline.published_kids, ['staging-access-token-v1'])
    || baseline.kms_version_count !== 1
    || baseline.control_plane_ingress !== 'ALLOW_INTERNAL_ONLY'
    || baseline.control_plane_unauthenticated_invokers !== 0
    || mutation.operation !== 'create-second-signing-key-version'
    || mutation.transport !== 'single_direct_rest_post'
    || mutation.maximum_kms_version_creations !== 1
    || mutation.maximum_coordination_objects_created !== 2
    || mutation.automatic_retry !== false
    || mutation.created_version_enabled !== true
    || mutation.existing_version_changed !== false
    || mutation.runtime_changed_by_creation !== false
    || mutation.terraform_state_changed_by_creation !== false
    || mutation.key_version_managed_outside_terraform !== true
    || coordination.bucket !== STATE_BUCKET
    || coordination.gate_object !== GATE_CLAIM_OBJECT
    || coordination.attempt_object !== ATTEMPT_CLAIM_OBJECT
    || coordination.creation_precondition !== 'ifGenerationMatch=0'
    || coordination.claims_contain_credentials !== false
    || coordination.claims_are_deleted_by_driver !== false
    || coordination.attempt_claim_is_irreversible_boundary !== true
    || !isDeepStrictEqual(rollout.stages, [
      'create_version_2_without_runtime_change',
      'prepublish_versions_1_and_2_with_version_1_current',
      'observe_prepublication_for_at_least_60_seconds',
      'activate_version_2_while_retaining_version_1',
      'retain_version_1_for_at_least_330_seconds',
      'retire_version_1_only_after_acceptance',
    ])
    || rollout.prepublication_seconds !== 60
    || rollout.retiring_key_retention_seconds !== 330
    || rollout.maximum_published_keys !== 2
    || rollout.republish_removed_private_key !== false
    || rollout.version_1_destruction_authorized !== false
    || cost.currency !== 'USD'
    || cost.maximum_incremental_monthly_usd !== 0.06
    || cost.pricing_checked_on !== '2026-09-05'
    || cost.pricing_source !== 'https://cloud.google.com/security/products/security-key-management'
    || cost.key_admin_operations_free !== true
    || cost.stress_test !== false) {
    reject('Signing-overlap plan violates the closed staging safety boundary');
  }
  if (!isDeepStrictEqual(value, reviewedPlan)) {
    reject('Signing-overlap plan has drifted from the reviewed value');
  }
  return Object.freeze(value);
}

export function validateSigningOverlapPlan(path = new URL('plan.json', import.meta.url)) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024
    || sha256(bytes) !== SIGNING_OVERLAP_PLAN_SHA256) {
    reject('Signing-overlap plan digest does not match the reviewed bytes');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Signing-overlap plan is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Signing-overlap plan is not canonical JSON');
  }
  return validateSigningOverlapPlanValue(value);
}

export function assertSafeEnvironment(environment, allowedName) {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || value.length === 0) continue;
    if (FORBIDDEN_ENVIRONMENT_NAMES.has(name)
      || name.startsWith('GOOGLE_')
      || name.startsWith('CLOUDSDK_')
      || name.startsWith('TF_')
      || (name.startsWith('FIREBASE_') && name !== 'FIREBASE_CLI_DISABLE_UPDATE_CHECK')
      || (name.startsWith('MIAKAPP_') && name !== allowedName)) {
      reject(`Environment override ${name} is forbidden for signing-overlap execution`);
    }
  }
  if (typeof environment.HOME !== 'string' || environment.HOME.length === 0
    || typeof environment.PATH !== 'string' || environment.PATH.length === 0) {
    reject('Signing-overlap execution requires the normal local HOME and PATH');
  }
}

export function childEnvironment(environment = process.env) {
  const selected = {};
  for (const name of [
    'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER',
  ]) {
    if (typeof environment[name] === 'string' && environment[name].length !== 0) {
      selected[name] = environment[name];
    }
  }
  selected.CI = '1';
  return Object.freeze(selected);
}

function command(commandName, args, repositoryRoot) {
  const result = spawnSync(commandName, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: childEnvironment(),
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    reject(`${commandName} state could not be verified`);
  }
  return result.stdout.trim();
}

export function verifyExactMain(repositoryRoot, expectedCommit) {
  if (command('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot) !== '') {
    reject('Signing-overlap execution requires a clean repository');
  }
  const head = command('git', ['rev-parse', 'HEAD'], repositoryRoot);
  const main = command('git', ['rev-parse', 'origin/main'], repositoryRoot);
  if (!COMMIT.test(head) || head !== main || (expectedCommit !== undefined && head !== expectedCommit)) {
    reject('Signing-overlap execution requires the exact reviewed origin/main commit');
  }
  return head;
}

export function verifiedOperatorEmail(repositoryRoot) {
  const email = command('gcloud', ['config', 'get-value', 'account', '--quiet'], repositoryRoot);
  if (!EMAIL.test(email) || email !== email.toLowerCase()
    || sha256(Buffer.from(email, 'utf8')) !== OPERATOR_USER_SHA256) {
    reject('The active Google user does not match the reviewed staging operator');
  }
  return email;
}

export function createPrivateBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Private bundle parent must be an absolute path');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Signing-overlap bundle parent must be a real directory outside the repository');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-signing-overlap-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function writePrivateFile(path, bytes, mode = 0o600) {
  writeFileSync(path, bytes, { flag: 'wx', mode });
  chmodSync(path, mode);
}

export function readPrivateFile(path, maximumBytes = MAXIMUM_PRIVATE_FILE_BYTES) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || (typeof process.getuid === 'function' && entry.uid !== process.getuid())) {
    reject('Signing-overlap private bundle contains an invalid file');
  }
  return readFileSync(path);
}

function claimAbsence(object) {
  return Object.freeze({
    schema: 'miakapp.staging-signing-overlap-claim-observation/1',
    bucket: STATE_BUCKET,
    object,
    state: 'absent',
  });
}

export function buildKeyVersionPlanMetadata({ repositoryCommit, createdAt, baseline }) {
  if (!COMMIT.test(repositoryCommit) || !plainObject(baseline)) {
    reject('Signing-key plan metadata inputs are invalid');
  }
  rejectPrivateMaterial(baseline, 'baseline');
  const created = canonicalTimestamp(createdAt, 'created_at');
  return Object.freeze({
    schema: 'miakapp.staging-signing-key-version-plan/1',
    operation: 'create-second-signing-key-version',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(created + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    reviewed_plan_sha256: SIGNING_OVERLAP_PLAN_SHA256,
    baseline_sha256: sha256(Buffer.from(canonicalJson(baseline), 'utf8')),
    baseline,
    claims_before: Object.freeze({
      gate: claimAbsence(GATE_CLAIM_OBJECT),
      attempt: claimAbsence(ATTEMPT_CLAIM_OBJECT),
    }),
    expected_created_version: VERSION_2_NAME,
    maximum_kms_version_creations: 1,
    maximum_coordination_objects_created: 2,
    maximum_incremental_monthly_usd: 0.06,
    automatic_retry_authorized: false,
    public_ingress_authorized: false,
    live_request_authorized: false,
    private_bundle_committed: false,
  });
}

export function validateKeyVersionPlanMetadata(value, now = Date.now()) {
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
    'reviewed_plan_sha256',
    'baseline_sha256',
    'baseline',
    'claims_before',
    'expected_created_version',
    'maximum_kms_version_creations',
    'maximum_coordination_objects_created',
    'maximum_incremental_monthly_usd',
    'automatic_retry_authorized',
    'public_ingress_authorized',
    'live_request_authorized',
    'private_bundle_committed',
  ], 'Signing-key plan metadata');
  if (metadata.schema !== 'miakapp.staging-signing-key-version-plan/1'
    || metadata.operation !== 'create-second-signing-key-version'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit ?? '')
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.reviewed_plan_sha256 !== SIGNING_OVERLAP_PLAN_SHA256
    || !SHA256.test(metadata.baseline_sha256 ?? '')
    || !plainObject(metadata.baseline)
    || metadata.baseline_sha256 !== sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8'))
    || metadata.expected_created_version !== VERSION_2_NAME
    || metadata.maximum_kms_version_creations !== 1
    || metadata.maximum_coordination_objects_created !== 2
    || metadata.maximum_incremental_monthly_usd !== 0.06
    || metadata.automatic_retry_authorized !== false
    || metadata.public_ingress_authorized !== false
    || metadata.live_request_authorized !== false
    || metadata.private_bundle_committed !== false) {
    reject('Signing-key plan metadata does not match the reviewed operation');
  }
  const created = canonicalTimestamp(metadata.created_at, 'created_at');
  const expires = canonicalTimestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Signing-key plan metadata is expired or not yet valid');
  }
  const claims = exactKeys(metadata.claims_before, ['gate', 'attempt'], 'Claim baseline');
  if (!isDeepStrictEqual(claims.gate, claimAbsence(GATE_CLAIM_OBJECT))
    || !isDeepStrictEqual(claims.attempt, claimAbsence(ATTEMPT_CLAIM_OBJECT))) {
    reject('Signing-key claim baseline is not exactly absent');
  }
  rejectPrivateMaterial(metadata, 'metadata');
  return Object.freeze(metadata);
}

export function readKeyVersionPlanMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Signing-key plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Signing-key plan metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateKeyVersionPlanMetadata(value, now) });
}

export function keyVersionAuthorization(metadataBytes, repositoryCommit) {
  if (!Buffer.isBuffer(metadataBytes) || metadataBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit)) {
    reject('Signing-key authorization inputs are invalid');
  }
  return `create-second-signing-key-version:${PROJECT_ID}:${sha256(metadataBytes)}:${repositoryCommit}`;
}

export function validateKeyVersionAuthorization(value, metadataBytes, repositoryCommit) {
  const expected = Buffer.from(keyVersionAuthorization(metadataBytes, repositoryCommit), 'utf8');
  const actual = Buffer.from(typeof value === 'string' ? value : '', 'utf8');
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    reject('Exact signing-key creation authorization is missing or invalid');
  }
}
