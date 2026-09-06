import { createHash, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  OPERATOR_USER_SHA256,
  PLAN_TTL_MILLISECONDS,
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

export const RELAY_SERVICES_V1_PROFILE_PATH = 'browser-relay-services/profile-v1.json';
export const RELAY_SERVICES_V1_PROFILE_SHA256 =
  'bc9b231cc9724f19a26ef5c3bbd6da6a69ec79b00cb976e77c73015d5db10db7';
export const RELAY_SERVICES_V2_PROFILE_PATH = 'browser-relay-services/profile-v2.json';
export const RELAY_SERVICES_V2_PROFILE_SHA256 =
  '26535e8c8b56d5a0a0875049a1e76aade4e1246b0808470ab4483bc01a2f48cb';
export const RELAY_SERVICES_PROFILE_PATH = 'browser-relay-services/profile.json';
export const RELAY_SERVICES_PROFILE_SHA256 =
  'a5bc737620e57aed5c7e828b4d558e3b246ba13edb40944a40febba6c14a9316';
export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
export const STATE_OBJECT = 'terraform/browser-relay-services/default.tfstate';
export const BOOTSTRAP_CLAIM_OBJECT =
  'terraform/browser-relay-services/operations/private-bootstrap-v1.json';
const MAXIMUM_PROFILE_BYTES = 16 * 1024;
const MAXIMUM_METADATA_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
]);
const FORBIDDEN_FIELD_NAMES = new Set([
  'access_token',
  'authorization',
  'cookie',
  'firebase_id_token',
  'home_key',
  'id_token',
  'password',
  'private_key',
  'refresh_token',
  'secret_value',
]);
export const RELAY_SERVICES_TERRAFORM_SOURCE_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'foundation.tf',
  'locals.tf',
  'main.tf',
  'outputs.tf',
  'providers.tf',
  'terraform-cli.tfrc',
  'variables.tf',
  'versions.tf',
]);
const root = dirname(fileURLToPath(import.meta.url));
const profilePath = join(root, 'profile.json');
const v1ProfilePath = join(root, 'profile-v1.json');
const v2ProfilePath = join(root, 'profile-v2.json');

const EXPECTED_PROFILE = Object.freeze({
  schema: 'miakapp.staging-relay-services-profile/3',
  state: 'private_bootstrap_entrypoint_prepared_not_executed',
  terraform_source_sha256: '8a9e1b5c37e1c25befccfd2b2eac838639a74901785c88e83521a2f897b9f746',
  project_id: 'miakapp-v4-staging',
  project_number: '1072737219170',
  region: 'europe-west9',
  state_backend: {
    bucket: 'miakapp-v4-staging-tfstate-1072737219170',
    prefix: 'terraform/browser-relay-services',
  },
  contracts: {
    historical_profile_path: RELAY_SERVICES_V1_PROFILE_PATH,
    historical_profile_sha256: RELAY_SERVICES_V1_PROFILE_SHA256,
    previous_profile_path: RELAY_SERVICES_V2_PROFILE_PATH,
    previous_profile_sha256: RELAY_SERVICES_V2_PROFILE_SHA256,
    relay_image_result_path: 'browser-relay-image/result-v2.json',
    relay_image_result_sha256:
      'dcf1ea4d63e9c7e13970d77c40dcc0ebc43215ffc6ffc3293ce28b78868e1649',
  },
  pins: {
    miakapp_server_commit: 'df10674e034f30eec80760f5ec94bc108cff026f',
    protocol_contract_commit: 'cc3bcd70fdb4b058f990ca2607693a2043faebaf',
    deployed_control_plane_commit: 'ba4fc9caed566fa39fc66371192fb1821b4232ff',
    deployed_control_plane_source_sha256: '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e',
  },
  image: {
    repository: 'europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp-server',
    digest: 'sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1',
    digest_reference:
      'europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp-server@sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1',
    config_digest:
      'sha256:344314bad3b6f6f1f280737b3d010cdcafb2ead6cf868c8b97e2c367401001a9',
    source_archive_sha256:
      '93fd720736453e3555be625bbb993194f48a5388821169c939674b04088f158e',
    source_object_generation: '1788648564283151',
    build_id: '70e25c75-3c30-497a-982a-f7bebe71c4ee',
    digest_required: true,
    mutable_tags_allowed: false,
    provenance_required: true,
  },
  runtime_identity: {
    account_id: 'miakapp-staging-relay',
    email: 'miakapp-staging-relay@miakapp-v4-staging.iam.gserviceaccount.com',
    project_roles: [],
    user_managed_keys_allowed: false,
  },
  control_plane: {
    issuer: 'https://control-plane-aczhngqraq-od.a.run.app',
    jwks_url: 'https://control-plane-aczhngqraq-od.a.run.app/.well-known/jwks.json',
  },
  application: {
    allowed_origin: 'https://miakapp-v4-staging.web.app',
    websocket_subprotocol: 'miakapp',
  },
  services: [
    {
      id: 'relay-a',
      name: 'miakapp-staging-relay-a',
      bootstrap_audience: 'wss://relay-a.bootstrap.invalid/ws',
      audience_pattern: '^wss://miakapp-staging-relay-a-[a-z0-9]{10}-od\\.a\\.run\\.app/ws$',
    },
    {
      id: 'relay-b',
      name: 'miakapp-staging-relay-b',
      bootstrap_audience: 'wss://relay-b.bootstrap.invalid/ws',
      audience_pattern: '^wss://miakapp-staging-relay-b-[a-z0-9]{10}-od\\.a\\.run\\.app/ws$',
    },
  ],
  cloud_run: {
    ingress: 'INGRESS_TRAFFIC_ALL',
    port: 3000,
    minimum_instances: 0,
    maximum_instances: 1,
    concurrency: 8,
    request_timeout_seconds: 900,
    cpu: '1',
    memory: '256Mi',
    cpu_idle: true,
    startup_cpu_boost: false,
    session_affinity: false,
    execution_environment: 'EXECUTION_ENVIRONMENT_GEN2',
    deletion_protection: false,
  },
  relay_runtime: {
    handshake_timeout: '5s',
    write_timeout: '5s',
    ping_interval: '30s',
    pong_timeout: '10s',
    declaration_timeout: '30s',
    disconnect_grace: '30s',
    shutdown_timeout: '10s',
  },
  admission: {
    maximum_queued_bytes_per_connection: 262144,
    maximum_connections: 8,
    maximum_connections_per_immediate_peer: 8,
    connection_attempts_per_minute_per_immediate_peer: 32,
    maximum_tracked_immediate_peers: 64,
    maximum_homes: 16,
    maximum_aggregate_queued_bytes: 4194304,
    trusted_client_address_source: 'immediate_tcp_peer',
    forwarded_client_headers_trusted: false,
  },
  phases: ['absent', 'private_bootstrap', 'private_ready', 'public_window'],
  operation: {
    phase: 'private_bootstrap',
    claim_bucket: STATE_BUCKET,
    claim_object: BOOTSTRAP_CLAIM_OBJECT,
    state_object: STATE_OBJECT,
    initial_state_generation: '1788655780811691',
    initial_state_size_bytes: 181,
    initial_state_sha256: '50686c3190e540e14c4546b8b9abc977ee9546af66899e1654a2b8d573024140',
    initial_state_serial: 1,
    initial_state_lineage_sha256:
      '3d99b2335a31d39b341036981987054211455d6ee4acd229cc0459cd0995807f',
    plan_ttl_seconds: 7200,
    maximum_terraform_creates: 4,
    maximum_relay_services: 2,
    maximum_public_iam_members: 0,
    maximum_live_requests: 0,
    maximum_monthly_increment_eur: 1,
    retry_authorized: false,
    destroy_authorized: false,
    public_invocation_authorized: false,
    hosting_release_authorized: false,
    persistent_credentials_authorized: false,
  },
  effects: {
    persistent_credentials: false,
    secret_mounts: false,
    database_access: false,
    vpc_connector: false,
    minimum_instances: false,
    public_iam_only_in_public_window: true,
  },
});

export class StagingRelayServicesProfileError extends Error {
  constructor(message = 'Staging relay-services profile is invalid') {
    super(message);
    this.name = 'StagingRelayServicesProfileError';
  }
}

function reject(message) {
  throw new StagingRelayServicesProfileError(message);
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

function safeEqual(actual, expected) {
  const actualBytes = Buffer.from(typeof actual === 'string' ? actual : '', 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes);
}

function rejectPrivateMaterial(value, path = 'profile') {
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
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELD_NAMES.has(key)) {
        reject(`${path}.${key} is a forbidden credential field`);
      }
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function relayServicesTerraformSourceSha256(rootPath) {
  const sourceDigests = Object.fromEntries(RELAY_SERVICES_TERRAFORM_SOURCE_FILES.map((name) => {
    const path = join(rootPath, name);
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0) {
      reject(`Terraform source ${name} must be a non-empty regular file`);
    }
    return [name, createHash('sha256').update(readFileSync(path)).digest('hex')];
  }));
  return createHash('sha256').update(JSON.stringify(sourceDigests)).digest('hex');
}

export function validateRelayServicesV1Profile(path = v1ProfilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Historical profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== RELAY_SERVICES_V1_PROFILE_SHA256) {
    reject('Historical profile digest has drifted');
  }
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    reject('Historical profile must be valid JSON');
  }
  rejectPrivateMaterial(profile, 'historical_profile');
  if (profile.schema !== 'miakapp.staging-relay-services-profile/1'
    || profile.state !== 'dormant_no_operator_entrypoint'
    || profile.terraform_source_sha256
      !== '0674bea2b9ba1985910484c71cafd55356996ab3991f6794339219a7fa237037'
    || profile.image?.digest !== undefined
    || profile.image?.repository
      !== 'europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp-server') {
    reject('Historical profile does not match the reviewed pre-image boundary');
  }
  return Object.freeze(profile);
}

export function validateRelayServicesV2Profile(path = v2ProfilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Previous profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_SERVICES_V2_PROFILE_SHA256) {
    reject('Previous profile digest has drifted');
  }
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Previous profile must be valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')) {
    reject('Previous profile is not canonical JSON');
  }
  rejectPrivateMaterial(profile, 'previous_profile');
  if (profile.schema !== 'miakapp.staging-relay-services-profile/2'
    || profile.state !== 'verified_image_bound_no_operator_entrypoint'
    || profile.terraform_source_sha256
      !== '8a9e1b5c37e1c25befccfd2b2eac838639a74901785c88e83521a2f897b9f746'
    || profile.image?.digest_reference !== EXPECTED_PROFILE.image.digest_reference
    || profile.operation !== undefined) {
    reject('Previous profile does not match the reviewed digest-bound boundary');
  }
  return Object.freeze(profile);
}

export function validateRelayServicesProfile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== RELAY_SERVICES_PROFILE_SHA256) reject('Profile digest has drifted');

  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    reject('Profile must be valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')) reject('Profile is not canonical JSON');
  rejectPrivateMaterial(profile);
  if (!isDeepStrictEqual(profile, EXPECTED_PROFILE)) reject('Profile does not match the reviewed relay-services boundary');
  if (relayServicesTerraformSourceSha256(dirname(path)) !== profile.terraform_source_sha256) {
    reject('Operational Terraform source digest has drifted');
  }
  return Object.freeze(profile);
}

export function bootstrapRelayVariables(profile = validateRelayServicesProfile()) {
  return Object.freeze({
    deployment_phase: 'private_bootstrap',
    relay_audiences: Object.freeze(Object.fromEntries(
      profile.services.map((service) => [service.id, service.bootstrap_audience]),
    )),
  });
}

export function validateBootstrapRelayVariables(value) {
  const profile = validateRelayServicesProfile();
  const variables = exactKeys(
    value,
    ['deployment_phase', 'relay_audiences'],
    'Relay-services bootstrap variables',
  );
  if (!isDeepStrictEqual(variables, bootstrapRelayVariables(profile))) {
    reject('Relay-services bootstrap variables do not match the reviewed private phase');
  }
  return Object.freeze(variables);
}

export function createPrivateRelayServicesBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Relay-services bundle parent must be absolute');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Relay-services bundle parent must be a real directory outside the repository');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-relay-bootstrap-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function privateRelayServicesBundle(path, repositoryRoot) {
  const bundle = realpathSync(resolve(path));
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, bundle);
  const entry = lstatSync(bundle);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Relay-services operation requires an exact private bundle directory');
  }
  return bundle;
}

export function relayServicesBootstrapAuthorization(
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit) || !SHA256.test(baselineSha256)) {
    reject('Relay-services bootstrap authorization inputs are invalid');
  }
  return [
    'apply-private-relay-bootstrap',
    PROJECT_ID,
    sha256(planBytes),
    baselineSha256,
    repositoryCommit,
  ].join(':');
}

export function validateRelayServicesBootstrapAuthorization(
  value,
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!safeEqual(
    value,
    relayServicesBootstrapAuthorization(planBytes, repositoryCommit, baselineSha256),
  )) {
    reject('Exact relay-services bootstrap authorization is missing or invalid');
  }
}

export function buildRelayServicesBootstrapPlanMetadata({
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  variablesBytes,
  baseline,
  summary,
}) {
  const profile = validateRelayServicesProfile();
  if (!COMMIT.test(repositoryCommit)
    || !Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !Buffer.isBuffer(planJsonBytes) || planJsonBytes.byteLength === 0
    || !Buffer.isBuffer(variablesBytes) || variablesBytes.byteLength === 0
    || !plainObject(baseline) || !plainObject(summary)) {
    reject('Relay-services bootstrap plan metadata inputs are invalid');
  }
  const created = canonicalTimestamp(createdAt, 'created_at');
  const baselineSha256 = sha256(Buffer.from(canonicalJson(baseline), 'utf8'));
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-bootstrap-plan/1',
    operation: 'deploy-private-browser-relay-bootstrap',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(created + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    profile_sha256: RELAY_SERVICES_PROFILE_SHA256,
    terraform_source_sha256: profile.terraform_source_sha256,
    terraform_version: TERRAFORM_VERSION,
    terraform_plan_sha256: sha256(planBytes),
    terraform_plan_json_sha256: sha256(planJsonBytes),
    terraform_variables_sha256: sha256(variablesBytes),
    baseline_sha256: baselineSha256,
    baseline,
    summary,
    maximum_monthly_increment_eur: profile.operation.maximum_monthly_increment_eur,
    public_invocation_authorized: false,
    hosting_release_authorized: false,
    live_requests_authorized: false,
    persistent_credentials_authorized: false,
    destroy_authorized: false,
    retry_authorized: false,
    private_bundle_committed: false,
  });
}

export function validateRelayServicesBootstrapPlanMetadata(value, now = Date.now()) {
  const profile = validateRelayServicesProfile();
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
    'profile_sha256',
    'terraform_source_sha256',
    'terraform_version',
    'terraform_plan_sha256',
    'terraform_plan_json_sha256',
    'terraform_variables_sha256',
    'baseline_sha256',
    'baseline',
    'summary',
    'maximum_monthly_increment_eur',
    'public_invocation_authorized',
    'hosting_release_authorized',
    'live_requests_authorized',
    'persistent_credentials_authorized',
    'destroy_authorized',
    'retry_authorized',
    'private_bundle_committed',
  ], 'Relay-services bootstrap plan metadata');
  if (metadata.schema !== 'miakapp.staging-browser-relay-services-bootstrap-plan/1'
    || metadata.operation !== 'deploy-private-browser-relay-bootstrap'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.profile_sha256 !== RELAY_SERVICES_PROFILE_SHA256
    || metadata.terraform_source_sha256 !== profile.terraform_source_sha256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || !SHA256.test(metadata.terraform_variables_sha256)
    || !SHA256.test(metadata.baseline_sha256)
    || !plainObject(metadata.baseline)
    || !plainObject(metadata.summary)
    || metadata.maximum_monthly_increment_eur
      !== profile.operation.maximum_monthly_increment_eur
    || metadata.public_invocation_authorized !== false
    || metadata.hosting_release_authorized !== false
    || metadata.live_requests_authorized !== false
    || metadata.persistent_credentials_authorized !== false
    || metadata.destroy_authorized !== false
    || metadata.retry_authorized !== false
    || metadata.private_bundle_committed !== false
    || sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8'))
      !== metadata.baseline_sha256) {
    reject('Relay-services bootstrap plan metadata does not match the reviewed operation');
  }
  const created = canonicalTimestamp(metadata.created_at, 'created_at');
  const expires = canonicalTimestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS
    || profile.operation.plan_ttl_seconds * 1_000 !== PLAN_TTL_MILLISECONDS
    || now < created - 60_000 || now > expires) {
    reject('Relay-services bootstrap plan metadata is expired or not yet valid');
  }
  return Object.freeze(metadata);
}

export function readRelayServicesBootstrapPlanMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, MAXIMUM_METADATA_BYTES);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay-services bootstrap plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Relay-services bootstrap plan metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateRelayServicesBootstrapPlanMetadata(value, now) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const profilePath = process.argv[2];
  if (process.argv.length !== 3 || profilePath === undefined) {
    console.error('Usage: node contract.mjs <relay-services-profile.json>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateRelayServicesProfile(profilePath);
      console.log(`Validated ${profile.schema} for ${profile.project_id}; the private bootstrap entrypoint is prepared but has not executed.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging relay-services profile is invalid');
      process.exitCode = 1;
    }
  }
}
