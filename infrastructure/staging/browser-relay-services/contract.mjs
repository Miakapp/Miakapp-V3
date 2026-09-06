import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

export const RELAY_SERVICES_V1_PROFILE_PATH = 'browser-relay-services/profile-v1.json';
export const RELAY_SERVICES_V1_PROFILE_SHA256 =
  'bc9b231cc9724f19a26ef5c3bbd6da6a69ec79b00cb976e77c73015d5db10db7';
export const RELAY_SERVICES_PROFILE_PATH = 'browser-relay-services/profile.json';
export const RELAY_SERVICES_PROFILE_SHA256 =
  '26535e8c8b56d5a0a0875049a1e76aade4e1246b0808470ab4483bc01a2f48cb';
const MAXIMUM_PROFILE_BYTES = 16 * 1024;
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

const EXPECTED_PROFILE = Object.freeze({
  schema: 'miakapp.staging-relay-services-profile/2',
  state: 'verified_image_bound_no_operator_entrypoint',
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
  rejectPrivateMaterial(profile);
  if (!isDeepStrictEqual(profile, EXPECTED_PROFILE)) reject('Profile does not match the reviewed relay-services boundary');
  if (relayServicesTerraformSourceSha256(dirname(path)) !== profile.terraform_source_sha256) {
    reject('Operational Terraform source digest has drifted');
  }
  return Object.freeze(profile);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const profilePath = process.argv[2];
  if (process.argv.length !== 3 || profilePath === undefined) {
    console.error('Usage: node contract.mjs <relay-services-profile.json>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateRelayServicesProfile(profilePath);
      console.log(`Validated ${profile.schema} for ${profile.project_id}; the verified image is digest-bound and no cloud operation is exposed.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging relay-services profile is invalid');
      process.exitCode = 1;
    }
  }
}
