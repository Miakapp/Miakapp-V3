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
export const RELAY_SERVICES_V3_PROFILE_PATH = 'browser-relay-services/profile-v3.json';
export const RELAY_SERVICES_V3_PROFILE_SHA256 =
  'a5bc737620e57aed5c7e828b4d558e3b246ba13edb40944a40febba6c14a9316';
export const RELAY_SERVICES_V4_PROFILE_PATH = 'browser-relay-services/profile-v4.json';
export const RELAY_SERVICES_V4_PROFILE_SHA256 =
  '0f8b966a7bf412156a83b0ddc76996abc6b49c28d81cda0f3e4d2b1c16912733';
export const RELAY_SERVICES_BOOTSTRAP_FAILURE_PATH =
  'browser-relay-services/bootstrap-failure-v1.json';
export const RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256 =
  'd98eb890376d5ec0b87ad91ffc88ca93eb206794d9c0d799b4fa7f0817f9a540';
export const RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_PATH =
  'browser-relay-services/memory-recovery-failure-v1.json';
export const RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256 =
  '5c41533a7b6a684e38abd9e8dd7d94d0f4e21cdd3bd9edf076821cca191932f7';
export const RELAY_SERVICES_PROFILE_PATH = 'browser-relay-services/profile.json';
export const RELAY_SERVICES_PROFILE_SHA256 =
  '41392c96d68bf749c59757bc76d34a69e6eb407efa50b14f61b937c4f5a9b576';
export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
export const STATE_OBJECT = 'terraform/browser-relay-services/default.tfstate';
export const BOOTSTRAP_CLAIM_OBJECT =
  'terraform/browser-relay-services/operations/private-bootstrap-v1.json';
export const RECOVERY_CLAIM_OBJECT =
  'terraform/browser-relay-services/operations/private-bootstrap-memory-recovery-v1.json';
export const PRIVATE_READY_CLAIM_OBJECT =
  'terraform/browser-relay-services/operations/private-ready-v1.json';
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
const v3ProfilePath = join(root, 'profile-v3.json');
const v4ProfilePath = join(root, 'profile-v4.json');
const bootstrapFailurePath = join(root, 'bootstrap-failure-v1.json');
const memoryRecoveryFailurePath = join(root, 'memory-recovery-failure-v1.json');

const EXPECTED_V3_PROFILE = Object.freeze({
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

const EXPECTED_V4_PROFILE = Object.freeze({
  ...EXPECTED_V3_PROFILE,
  schema: 'miakapp.staging-relay-services-profile/4',
  state: 'private_bootstrap_memory_recovery_entrypoint_prepared_not_executed',
  contracts: {
    historical_profile_path: RELAY_SERVICES_V1_PROFILE_PATH,
    historical_profile_sha256: RELAY_SERVICES_V1_PROFILE_SHA256,
    digest_bound_profile_path: RELAY_SERVICES_V2_PROFILE_PATH,
    digest_bound_profile_sha256: RELAY_SERVICES_V2_PROFILE_SHA256,
    previous_profile_path: RELAY_SERVICES_V3_PROFILE_PATH,
    previous_profile_sha256: RELAY_SERVICES_V3_PROFILE_SHA256,
    bootstrap_failure_path: RELAY_SERVICES_BOOTSTRAP_FAILURE_PATH,
    bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    relay_image_result_path: EXPECTED_V3_PROFILE.contracts.relay_image_result_path,
    relay_image_result_sha256: EXPECTED_V3_PROFILE.contracts.relay_image_result_sha256,
  },
  cloud_run: {
    ...EXPECTED_V3_PROFILE.cloud_run,
    memory: '512Mi',
  },
  operation: {
    phase: 'private_bootstrap',
    kind: 'recover_partial_bootstrap_memory',
    claim_bucket: STATE_BUCKET,
    claim_object: RECOVERY_CLAIM_OBJECT,
    original_claim_object: BOOTSTRAP_CLAIM_OBJECT,
    original_claim_generation: '1788658024634812',
    original_claim_size_bytes: 999,
    original_claim_sha256:
      '92b94cce96d70d9d55482ae4612f2192cd4686d8d5ee160270cbeb2d74773ac4',
    state_object: STATE_OBJECT,
    initial_state_generation: '1788658040492801',
    initial_state_size_bytes: 9527,
    initial_state_sha256:
      'c703ae655eb8b6292ae73ffa76d0746809190e312311fa5171e7bf5977fc27fc',
    initial_state_serial: 2,
    initial_state_lineage_sha256:
      '3d99b2335a31d39b341036981987054211455d6ee4acd229cc0459cd0995807f',
    plan_ttl_seconds: 7200,
    maximum_terraform_creates: 2,
    maximum_terraform_updates: 1,
    maximum_terraform_deletes: 0,
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
});

const EXPECTED_PROFILE = Object.freeze({
  ...EXPECTED_V4_PROFILE,
  schema: 'miakapp.staging-relay-services-profile/5',
  state: 'private_ready_transition_entrypoint_prepared_not_executed',
  terraform_source_sha256: '1e588bb43b8dd2cd97f564dc3e5b68b462f8a0eab81a3d72fac8dd4b6647721f',
  contracts: {
    historical_profile_path: RELAY_SERVICES_V1_PROFILE_PATH,
    historical_profile_sha256: RELAY_SERVICES_V1_PROFILE_SHA256,
    digest_bound_profile_path: RELAY_SERVICES_V2_PROFILE_PATH,
    digest_bound_profile_sha256: RELAY_SERVICES_V2_PROFILE_SHA256,
    bootstrap_profile_path: RELAY_SERVICES_V3_PROFILE_PATH,
    bootstrap_profile_sha256: RELAY_SERVICES_V3_PROFILE_SHA256,
    memory_recovery_profile_path: RELAY_SERVICES_V4_PROFILE_PATH,
    memory_recovery_profile_sha256: RELAY_SERVICES_V4_PROFILE_SHA256,
    bootstrap_failure_path: RELAY_SERVICES_BOOTSTRAP_FAILURE_PATH,
    bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    memory_recovery_failure_path: RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_PATH,
    memory_recovery_failure_sha256: RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256,
    relay_image_result_path: EXPECTED_V4_PROFILE.contracts.relay_image_result_path,
    relay_image_result_sha256: EXPECTED_V4_PROFILE.contracts.relay_image_result_sha256,
  },
  services: [
    {
      ...EXPECTED_V4_PROFILE.services[0],
      assigned_uri: 'https://miakapp-staging-relay-a-aczhngqraq-od.a.run.app',
      ready_audience: 'wss://miakapp-staging-relay-a-aczhngqraq-od.a.run.app/ws',
    },
    {
      ...EXPECTED_V4_PROFILE.services[1],
      assigned_uri: 'https://miakapp-staging-relay-b-aczhngqraq-od.a.run.app',
      ready_audience: 'wss://miakapp-staging-relay-b-aczhngqraq-od.a.run.app/ws',
    },
  ],
  operation: {
    phase: 'private_ready',
    kind: 'transition_private_relays_to_assigned_audiences',
    claim_bucket: STATE_BUCKET,
    claim_object: PRIVATE_READY_CLAIM_OBJECT,
    original_claim_object: BOOTSTRAP_CLAIM_OBJECT,
    original_claim_generation: '1788658024634812',
    original_claim_size_bytes: 999,
    original_claim_sha256:
      '92b94cce96d70d9d55482ae4612f2192cd4686d8d5ee160270cbeb2d74773ac4',
    memory_recovery_claim_object: RECOVERY_CLAIM_OBJECT,
    memory_recovery_claim_generation: '1788661237671763',
    memory_recovery_claim_size_bytes: 1375,
    memory_recovery_claim_sha256:
      '9f8d46aea073062fce6334dcb8c5b3f128d880624878908e4c9b09db06ed61b1',
    state_object: STATE_OBJECT,
    initial_state_generation: '1788661250283535',
    initial_state_size_bytes: 37259,
    initial_state_sha256:
      'a91d739f31a01854183b98a8fdc36c58365d166d8c721471ca12b27251596e76',
    initial_state_serial: 3,
    initial_state_lineage_sha256:
      '3d99b2335a31d39b341036981987054211455d6ee4acd229cc0459cd0995807f',
    plan_ttl_seconds: 7200,
    maximum_terraform_creates: 0,
    maximum_terraform_updates: 3,
    maximum_terraform_deletes: 0,
    maximum_cloud_run_service_updates: 2,
    maximum_relay_services: 2,
    maximum_public_iam_members: 0,
    maximum_live_requests: 0,
    maximum_monthly_increment_eur: 0,
    retry_authorized: false,
    destroy_authorized: false,
    public_invocation_authorized: false,
    hosting_release_authorized: false,
    persistent_credentials_authorized: false,
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
    || profile.image?.digest_reference !== EXPECTED_V3_PROFILE.image.digest_reference
    || profile.operation !== undefined) {
    reject('Previous profile does not match the reviewed digest-bound boundary');
  }
  return Object.freeze(profile);
}

export function validateRelayServicesV3Profile(path = v3ProfilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Consumed bootstrap profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_SERVICES_V3_PROFILE_SHA256) {
    reject('Consumed bootstrap profile digest has drifted');
  }
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Consumed bootstrap profile must be valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')) {
    reject('Consumed bootstrap profile is not canonical JSON');
  }
  rejectPrivateMaterial(profile, 'consumed_bootstrap_profile');
  if (!isDeepStrictEqual(profile, EXPECTED_V3_PROFILE)) {
    reject('Consumed bootstrap profile does not match the reviewed v3 boundary');
  }
  return Object.freeze(profile);
}

export function validateRelayServicesV4Profile(path = v4ProfilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Consumed memory-recovery profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_SERVICES_V4_PROFILE_SHA256) {
    reject('Consumed memory-recovery profile digest has drifted');
  }
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Consumed memory-recovery profile must be valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')) {
    reject('Consumed memory-recovery profile is not canonical JSON');
  }
  rejectPrivateMaterial(profile, 'consumed_memory_recovery_profile');
  if (!isDeepStrictEqual(profile, EXPECTED_V4_PROFILE)) {
    reject('Consumed memory-recovery profile does not match the reviewed v4 boundary');
  }
  return Object.freeze(profile);
}

export function validateRelayServicesBootstrapFailure(path = bootstrapFailurePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Bootstrap failure evidence must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256) {
    reject('Bootstrap failure evidence digest has drifted');
  }
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Bootstrap failure evidence must be valid JSON');
  }
  if (canonicalJson(result) !== bytes.toString('utf8')) {
    reject('Bootstrap failure evidence is not canonical JSON');
  }
  rejectPrivateMaterial(result, 'bootstrap_failure');
  exactKeys(result, [
    'schema', 'state', 'project_id', 'project_number', 'region', 'observed_at',
    'repository_commit', 'profile_sha256', 'metadata_sha256', 'terraform_plan_sha256',
    'baseline_sha256', 'claim', 'failure', 'terraform_state', 'effects', 'recovery',
  ], 'Bootstrap failure evidence');
  exactKeys(result.claim, [
    'object', 'generation', 'size_bytes', 'sha256', 'attempted_at', 'retry_authorized',
    'deletion_authorized', 'raw_contents_committed',
  ], 'Bootstrap failure claim');
  exactKeys(result.failure, [
    'category', 'api_status', 'field', 'requested_memory', 'minimum_memory',
    'execution_environment',
  ], 'Bootstrap failure cause');
  exactKeys(result.terraform_state, [
    'object', 'generation', 'size_bytes', 'sha256', 'terraform_version', 'serial',
    'lineage_sha256', 'resource_addresses', 'output_names',
  ], 'Bootstrap failure Terraform state');
  exactKeys(result.effects, [
    'terraform_guard_created', 'runtime_identity_created',
    'runtime_identity_user_managed_keys', 'runtime_identity_project_roles',
    'relay_services_created', 'public_iam_members_created', 'live_requests_by_driver',
    'hosting_releases', 'persistent_credentials_created', 'stress_test_executed',
  ], 'Bootstrap failure effects');
  exactKeys(result.recovery, [
    'original_plan_replay_authorized', 'original_claim_deletion_authorized',
    'separate_recovery_required',
  ], 'Bootstrap failure recovery boundary');
  if (result.schema !== 'miakapp.staging-browser-relay-services-bootstrap-attempt-result/1'
    || result.state !== 'failed_gen2_memory_requirement_partial_state_reconciled'
    || result.project_id !== PROJECT_ID || result.project_number !== PROJECT_NUMBER
    || result.region !== REGION || canonicalTimestamp(result.observed_at, 'observed_at') < 0
    || result.repository_commit !== 'c213d18760d371839a37bf4680ff85c9534ad43b'
    || result.profile_sha256 !== RELAY_SERVICES_V3_PROFILE_SHA256
    || result.metadata_sha256
      !== 'be2b2f7fe6c5a8717e020136047139b6bf86a0e5f7367ec398576df30ebdd28c'
    || result.terraform_plan_sha256
      !== 'da2c30b3e9fa7eef8c32ca8bcb44b8e2d9116bc4167449d059bd61ff6900221e'
    || result.baseline_sha256
      !== 'fdbce7203496d20768a4c4668262b3fdea262af22ed48ad02d36eed9f04c2413'
    || !isDeepStrictEqual(result.claim, {
      object: BOOTSTRAP_CLAIM_OBJECT,
      generation: '1788658024634812',
      size_bytes: 999,
      sha256: '92b94cce96d70d9d55482ae4612f2192cd4686d8d5ee160270cbeb2d74773ac4',
      attempted_at: '2026-09-06T01:27:04.584Z',
      retry_authorized: false,
      deletion_authorized: false,
      raw_contents_committed: false,
    })
    || !isDeepStrictEqual(result.failure, {
      category: 'cloud_run_gen2_memory_below_minimum',
      api_status: 400,
      field: 'template.containers.resources.limits.memory',
      requested_memory: '256Mi',
      minimum_memory: '512Mi',
      execution_environment: 'EXECUTION_ENVIRONMENT_GEN2',
    })
    || !isDeepStrictEqual(result.terraform_state, {
      object: STATE_OBJECT,
      generation: '1788658040492801',
      size_bytes: 9527,
      sha256: 'c703ae655eb8b6292ae73ffa76d0746809190e312311fa5171e7bf5977fc27fc',
      terraform_version: TERRAFORM_VERSION,
      serial: 2,
      lineage_sha256: '3d99b2335a31d39b341036981987054211455d6ee4acd229cc0459cd0995807f',
      resource_addresses: [
        'data.terraform_remote_state.workload[0]',
        'google_service_account.relay["runtime"]',
        'terraform_data.deployment_guard["active"]',
      ],
      output_names: [],
    })
    || !isDeepStrictEqual(result.effects, {
      terraform_guard_created: true,
      runtime_identity_created: true,
      runtime_identity_user_managed_keys: 0,
      runtime_identity_project_roles: 0,
      relay_services_created: 0,
      public_iam_members_created: 0,
      live_requests_by_driver: 0,
      hosting_releases: 0,
      persistent_credentials_created: 0,
      stress_test_executed: false,
    })
    || !isDeepStrictEqual(result.recovery, {
      original_plan_replay_authorized: false,
      original_claim_deletion_authorized: false,
      separate_recovery_required: true,
    })) {
    reject('Bootstrap failure evidence does not match the reconciled attempt');
  }
  return Object.freeze(result);
}

export function validateRelayServicesMemoryRecoveryFailure(path = memoryRecoveryFailurePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Memory-recovery failure evidence must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256) {
    reject('Memory-recovery failure evidence digest has drifted');
  }
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Memory-recovery failure evidence must be valid JSON');
  }
  if (canonicalJson(result) !== bytes.toString('utf8')) {
    reject('Memory-recovery failure evidence is not canonical JSON');
  }
  rejectPrivateMaterial(result, 'memory_recovery_failure');
  exactKeys(result, [
    'schema', 'state', 'project_id', 'project_number', 'region', 'observed_at',
    'repository_commit', 'profile_sha256', 'metadata_sha256', 'terraform_plan_sha256',
    'terraform_plan_json_sha256', 'baseline_sha256', 'claim', 'failure',
    'terraform_state', 'relays', 'effects', 'reconciliation',
  ], 'Memory-recovery failure evidence');
  if (result.schema
      !== 'miakapp.staging-browser-relay-services-memory-recovery-attempt-result/1'
    || result.state
      !== 'private_services_created_provider_default_drift_reconciliation_required'
    || result.project_id !== PROJECT_ID || result.project_number !== PROJECT_NUMBER
    || result.region !== REGION || canonicalTimestamp(result.observed_at, 'observed_at') < 0
    || result.repository_commit !== '20df3c92b02e06e7ebab574f0e7d70e2d85188aa'
    || result.profile_sha256 !== RELAY_SERVICES_V4_PROFILE_SHA256
    || result.metadata_sha256
      !== 'a76b9efb02a2b11fe618fd96e49bc831cd0441874c2c8a84bf7f7160905be755'
    || result.terraform_plan_sha256
      !== '41c90aaed50091627579797053d98e954dd8a6830d8d3c9f8b7178bb44d10831'
    || result.terraform_plan_json_sha256
      !== 'e678dd2bdf7de766602ce4b2849f1a82f7ce6901e17e9bc10a27c69aec619b11'
    || result.baseline_sha256
      !== '468977250bd5d59036c28c493e6cf8f07e64bb667589da838cf7d75c891deabe'
    || result.claim?.object !== RECOVERY_CLAIM_OBJECT
    || result.claim?.generation !== '1788661237671763'
    || result.claim?.size_bytes !== 1375
    || result.claim?.sha256
      !== '9f8d46aea073062fce6334dcb8c5b3f128d880624878908e4c9b09db06ed61b1'
    || result.claim?.retry_authorized !== false
    || result.claim?.deletion_authorized !== false
    || result.failure?.category
      !== 'cloud_run_binary_authorization_false_not_round_tripped'
    || result.failure?.stage !== 'post_apply_convergence_plan'
    || result.failure?.planned_creates !== 0
    || result.failure?.planned_updates !== 2
    || result.failure?.planned_deletes !== 0
    || result.terraform_state?.generation !== '1788661250283535'
    || result.terraform_state?.sha256
      !== 'a91d739f31a01854183b98a8fdc36c58365d166d8c721471ca12b27251596e76'
    || result.terraform_state?.serial !== 3
    || !Array.isArray(result.relays) || result.relays.length !== 2
    || result.relays.some((relay) => relay.ready !== true || relay.reconciling !== false
      || relay.memory !== '512Mi' || relay.minimum_instances !== 0
      || relay.maximum_instances !== 1 || relay.public_iam_members !== 0)
    || result.effects?.relay_services_created !== 2
    || result.effects?.public_iam_members_created !== 0
    || result.effects?.live_requests_by_driver !== 0
    || result.effects?.persistent_credentials_created !== 0
    || result.reconciliation?.original_plan_replay_authorized !== false
    || result.reconciliation?.memory_recovery_plan_replay_authorized !== false
    || result.reconciliation?.claim_deletion_authorized !== false
    || result.reconciliation?.private_ready_transition_required !== true) {
    reject('Memory-recovery failure evidence does not match the reconciled attempt');
  }
  return Object.freeze(result);
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
  validateRelayServicesV3Profile();
  validateRelayServicesV4Profile();
  validateRelayServicesBootstrapFailure();
  validateRelayServicesMemoryRecoveryFailure();
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

export function privateReadyRelayVariables(profile = validateRelayServicesProfile()) {
  return Object.freeze({
    deployment_phase: 'private_ready',
    relay_audiences: Object.freeze(Object.fromEntries(
      profile.services.map((service) => [service.id, service.ready_audience]),
    )),
  });
}

export function validatePrivateReadyRelayVariables(value) {
  const variables = exactKeys(
    value,
    ['deployment_phase', 'relay_audiences'],
    'Relay-services private-ready variables',
  );
  if (!isDeepStrictEqual(variables, privateReadyRelayVariables())) {
    reject('Relay-services private-ready variables do not match the assigned service URIs');
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

export function createPrivateRelayServicesRecoveryBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Relay-services recovery bundle parent must be absolute');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Relay-services recovery bundle parent must be a real directory outside the repository');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-relay-recovery-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function createPrivateRelayServicesReadyBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Relay-services private-ready bundle parent must be absolute');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Relay-services private-ready bundle parent must be a real directory outside the repository');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-relay-private-ready-'));
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
  const profile = validateRelayServicesV3Profile();
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
    profile_sha256: RELAY_SERVICES_V3_PROFILE_SHA256,
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
  const profile = validateRelayServicesV3Profile();
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
    || metadata.profile_sha256 !== RELAY_SERVICES_V3_PROFILE_SHA256
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

export function relayServicesRecoveryAuthorization(
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit) || !SHA256.test(baselineSha256)) {
    reject('Relay-services recovery authorization inputs are invalid');
  }
  return [
    'apply-private-relay-memory-recovery',
    PROJECT_ID,
    sha256(planBytes),
    baselineSha256,
    repositoryCommit,
  ].join(':');
}

export function validateRelayServicesRecoveryAuthorization(
  value,
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!safeEqual(
    value,
    relayServicesRecoveryAuthorization(planBytes, repositoryCommit, baselineSha256),
  )) {
    reject('Exact relay-services recovery authorization is missing or invalid');
  }
}

export function buildRelayServicesRecoveryPlanMetadata({
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  variablesBytes,
  baseline,
  summary,
}) {
  const profile = validateRelayServicesV4Profile();
  const failure = validateRelayServicesBootstrapFailure();
  if (!COMMIT.test(repositoryCommit)
    || !Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !Buffer.isBuffer(planJsonBytes) || planJsonBytes.byteLength === 0
    || !Buffer.isBuffer(variablesBytes) || variablesBytes.byteLength === 0
    || !plainObject(baseline) || !plainObject(summary)) {
    reject('Relay-services recovery plan metadata inputs are invalid');
  }
  const created = canonicalTimestamp(createdAt, 'created_at');
  const baselineSha256 = sha256(Buffer.from(canonicalJson(baseline), 'utf8'));
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-memory-recovery-plan/1',
    operation: 'recover-private-browser-relay-bootstrap-memory',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(created + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    profile_sha256: RELAY_SERVICES_V4_PROFILE_SHA256,
    bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    original_claim_generation: failure.claim.generation,
    original_claim_sha256: failure.claim.sha256,
    terraform_source_sha256: profile.terraform_source_sha256,
    terraform_version: TERRAFORM_VERSION,
    terraform_plan_sha256: sha256(planBytes),
    terraform_plan_json_sha256: sha256(planJsonBytes),
    terraform_variables_sha256: sha256(variablesBytes),
    baseline_sha256: baselineSha256,
    baseline,
    summary,
    maximum_monthly_increment_eur: profile.operation.maximum_monthly_increment_eur,
    maximum_terraform_creates: profile.operation.maximum_terraform_creates,
    maximum_terraform_updates: profile.operation.maximum_terraform_updates,
    maximum_terraform_deletes: profile.operation.maximum_terraform_deletes,
    public_invocation_authorized: false,
    hosting_release_authorized: false,
    live_requests_authorized: false,
    persistent_credentials_authorized: false,
    destroy_authorized: false,
    retry_authorized: false,
    private_bundle_committed: false,
  });
}

export function validateRelayServicesRecoveryPlanMetadata(value, now = Date.now()) {
  const profile = validateRelayServicesV4Profile();
  const failure = validateRelayServicesBootstrapFailure();
  const metadata = exactKeys(value, [
    'schema', 'operation', 'project_id', 'project_number', 'region', 'repository_commit',
    'created_at', 'expires_at', 'operator_user_sha256', 'profile_sha256',
    'bootstrap_failure_sha256', 'original_claim_generation', 'original_claim_sha256',
    'terraform_source_sha256', 'terraform_version', 'terraform_plan_sha256',
    'terraform_plan_json_sha256', 'terraform_variables_sha256', 'baseline_sha256',
    'baseline', 'summary', 'maximum_monthly_increment_eur', 'maximum_terraform_creates',
    'maximum_terraform_updates', 'maximum_terraform_deletes',
    'public_invocation_authorized', 'hosting_release_authorized',
    'live_requests_authorized', 'persistent_credentials_authorized',
    'destroy_authorized', 'retry_authorized', 'private_bundle_committed',
  ], 'Relay-services recovery plan metadata');
  if (metadata.schema !== 'miakapp.staging-browser-relay-services-memory-recovery-plan/1'
    || metadata.operation !== 'recover-private-browser-relay-bootstrap-memory'
    || metadata.project_id !== PROJECT_ID || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.profile_sha256 !== RELAY_SERVICES_V4_PROFILE_SHA256
    || metadata.bootstrap_failure_sha256 !== RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256
    || metadata.original_claim_generation !== failure.claim.generation
    || metadata.original_claim_sha256 !== failure.claim.sha256
    || metadata.terraform_source_sha256 !== profile.terraform_source_sha256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || !SHA256.test(metadata.terraform_variables_sha256)
    || !SHA256.test(metadata.baseline_sha256)
    || !plainObject(metadata.baseline) || !plainObject(metadata.summary)
    || metadata.maximum_monthly_increment_eur
      !== profile.operation.maximum_monthly_increment_eur
    || metadata.maximum_terraform_creates !== profile.operation.maximum_terraform_creates
    || metadata.maximum_terraform_updates !== profile.operation.maximum_terraform_updates
    || metadata.maximum_terraform_deletes !== profile.operation.maximum_terraform_deletes
    || metadata.public_invocation_authorized !== false
    || metadata.hosting_release_authorized !== false
    || metadata.live_requests_authorized !== false
    || metadata.persistent_credentials_authorized !== false
    || metadata.destroy_authorized !== false || metadata.retry_authorized !== false
    || metadata.private_bundle_committed !== false
    || sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8'))
      !== metadata.baseline_sha256) {
    reject('Relay-services recovery plan metadata does not match the reviewed operation');
  }
  const created = canonicalTimestamp(metadata.created_at, 'created_at');
  const expires = canonicalTimestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS
    || profile.operation.plan_ttl_seconds * 1_000 !== PLAN_TTL_MILLISECONDS
    || now < created - 60_000 || now > expires) {
    reject('Relay-services recovery plan metadata is expired or not yet valid');
  }
  return Object.freeze(metadata);
}

export function readRelayServicesRecoveryPlanMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, MAXIMUM_METADATA_BYTES);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay-services recovery plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Relay-services recovery plan metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateRelayServicesRecoveryPlanMetadata(value, now) });
}

export function relayServicesPrivateReadyAuthorization(
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit) || !SHA256.test(baselineSha256)) {
    reject('Relay-services private-ready authorization inputs are invalid');
  }
  return [
    'apply-private-relay-ready',
    PROJECT_ID,
    sha256(planBytes),
    baselineSha256,
    repositoryCommit,
  ].join(':');
}

export function validateRelayServicesPrivateReadyAuthorization(
  value,
  planBytes,
  repositoryCommit,
  baselineSha256,
) {
  if (!safeEqual(
    value,
    relayServicesPrivateReadyAuthorization(planBytes, repositoryCommit, baselineSha256),
  )) {
    reject('Exact relay-services private-ready authorization is missing or invalid');
  }
}

export function buildRelayServicesPrivateReadyPlanMetadata({
  repositoryCommit,
  createdAt,
  planBytes,
  planJsonBytes,
  variablesBytes,
  baseline,
  summary,
}) {
  const profile = validateRelayServicesProfile();
  const recoveryFailure = validateRelayServicesMemoryRecoveryFailure();
  if (!COMMIT.test(repositoryCommit)
    || !Buffer.isBuffer(planBytes) || planBytes.byteLength === 0
    || !Buffer.isBuffer(planJsonBytes) || planJsonBytes.byteLength === 0
    || !Buffer.isBuffer(variablesBytes) || variablesBytes.byteLength === 0
    || !plainObject(baseline) || !plainObject(summary)) {
    reject('Relay-services private-ready plan metadata inputs are invalid');
  }
  const created = canonicalTimestamp(createdAt, 'created_at');
  const baselineSha256 = sha256(Buffer.from(canonicalJson(baseline), 'utf8'));
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-private-ready-plan/1',
    operation: 'transition-private-browser-relays-to-assigned-audiences',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(created + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    profile_sha256: RELAY_SERVICES_PROFILE_SHA256,
    bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    memory_recovery_failure_sha256: RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256,
    original_claim_generation: profile.operation.original_claim_generation,
    original_claim_sha256: profile.operation.original_claim_sha256,
    memory_recovery_claim_generation: recoveryFailure.claim.generation,
    memory_recovery_claim_sha256: recoveryFailure.claim.sha256,
    terraform_source_sha256: profile.terraform_source_sha256,
    terraform_version: TERRAFORM_VERSION,
    terraform_plan_sha256: sha256(planBytes),
    terraform_plan_json_sha256: sha256(planJsonBytes),
    terraform_variables_sha256: sha256(variablesBytes),
    baseline_sha256: baselineSha256,
    baseline,
    summary,
    maximum_monthly_increment_eur: profile.operation.maximum_monthly_increment_eur,
    maximum_terraform_creates: profile.operation.maximum_terraform_creates,
    maximum_terraform_updates: profile.operation.maximum_terraform_updates,
    maximum_terraform_deletes: profile.operation.maximum_terraform_deletes,
    maximum_cloud_run_service_updates: profile.operation.maximum_cloud_run_service_updates,
    public_invocation_authorized: false,
    hosting_release_authorized: false,
    live_requests_authorized: false,
    persistent_credentials_authorized: false,
    destroy_authorized: false,
    retry_authorized: false,
    private_bundle_committed: false,
  });
}

export function validateRelayServicesPrivateReadyPlanMetadata(value, now = Date.now()) {
  const profile = validateRelayServicesProfile();
  const recoveryFailure = validateRelayServicesMemoryRecoveryFailure();
  const metadata = exactKeys(value, [
    'schema', 'operation', 'project_id', 'project_number', 'region', 'repository_commit',
    'created_at', 'expires_at', 'operator_user_sha256', 'profile_sha256',
    'bootstrap_failure_sha256', 'memory_recovery_failure_sha256',
    'original_claim_generation', 'original_claim_sha256',
    'memory_recovery_claim_generation', 'memory_recovery_claim_sha256',
    'terraform_source_sha256', 'terraform_version', 'terraform_plan_sha256',
    'terraform_plan_json_sha256', 'terraform_variables_sha256', 'baseline_sha256',
    'baseline', 'summary', 'maximum_monthly_increment_eur', 'maximum_terraform_creates',
    'maximum_terraform_updates', 'maximum_terraform_deletes',
    'maximum_cloud_run_service_updates', 'public_invocation_authorized',
    'hosting_release_authorized', 'live_requests_authorized',
    'persistent_credentials_authorized', 'destroy_authorized', 'retry_authorized',
    'private_bundle_committed',
  ], 'Relay-services private-ready plan metadata');
  if (metadata.schema !== 'miakapp.staging-browser-relay-services-private-ready-plan/1'
    || metadata.operation !== 'transition-private-browser-relays-to-assigned-audiences'
    || metadata.project_id !== PROJECT_ID || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.profile_sha256 !== RELAY_SERVICES_PROFILE_SHA256
    || metadata.bootstrap_failure_sha256 !== RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256
    || metadata.memory_recovery_failure_sha256
      !== RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256
    || metadata.original_claim_generation !== profile.operation.original_claim_generation
    || metadata.original_claim_sha256 !== profile.operation.original_claim_sha256
    || metadata.memory_recovery_claim_generation !== recoveryFailure.claim.generation
    || metadata.memory_recovery_claim_sha256 !== recoveryFailure.claim.sha256
    || metadata.terraform_source_sha256 !== profile.terraform_source_sha256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || !SHA256.test(metadata.terraform_variables_sha256)
    || !SHA256.test(metadata.baseline_sha256)
    || !plainObject(metadata.baseline) || !plainObject(metadata.summary)
    || metadata.maximum_monthly_increment_eur
      !== profile.operation.maximum_monthly_increment_eur
    || metadata.maximum_terraform_creates !== profile.operation.maximum_terraform_creates
    || metadata.maximum_terraform_updates !== profile.operation.maximum_terraform_updates
    || metadata.maximum_terraform_deletes !== profile.operation.maximum_terraform_deletes
    || metadata.maximum_cloud_run_service_updates
      !== profile.operation.maximum_cloud_run_service_updates
    || metadata.public_invocation_authorized !== false
    || metadata.hosting_release_authorized !== false
    || metadata.live_requests_authorized !== false
    || metadata.persistent_credentials_authorized !== false
    || metadata.destroy_authorized !== false || metadata.retry_authorized !== false
    || metadata.private_bundle_committed !== false
    || sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8'))
      !== metadata.baseline_sha256) {
    reject('Relay-services private-ready metadata does not match the reviewed operation');
  }
  const created = canonicalTimestamp(metadata.created_at, 'created_at');
  const expires = canonicalTimestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS
    || profile.operation.plan_ttl_seconds * 1_000 !== PLAN_TTL_MILLISECONDS
    || now < created - 60_000 || now > expires) {
    reject('Relay-services private-ready plan metadata is expired or not yet valid');
  }
  return Object.freeze(metadata);
}

export function readRelayServicesPrivateReadyPlanMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, MAXIMUM_METADATA_BYTES);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay-services private-ready metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Relay-services private-ready metadata is not canonical JSON');
  }
  return Object.freeze({
    bytes,
    value: validateRelayServicesPrivateReadyPlanMetadata(value, now),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const profilePath = process.argv[2];
  if (process.argv.length !== 3 || profilePath === undefined) {
    console.error('Usage: node contract.mjs <relay-services-profile.json>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateRelayServicesProfile(profilePath);
      console.log(`Validated ${profile.schema} for ${profile.project_id}; two private relays exist and the exact private-ready reconciliation is prepared but has not executed.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging relay-services profile is invalid');
      process.exitCode = 1;
    }
  }
}
