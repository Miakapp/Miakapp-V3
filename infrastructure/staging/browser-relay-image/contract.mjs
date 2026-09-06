import { timingSafeEqual } from 'node:crypto';
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
  assertSafeWorkloadEnvironment,
  canonicalJson,
  readPrivateFile,
  sha256,
  writePrivateFile,
} from '../workload/contract.mjs';
import {
  BROWSER_RELAY_PLAN_SHA256,
} from '../browser-relay/contract.mjs';
import {
  RELAY_SERVICES_V1_PROFILE_SHA256,
  validateRelayServicesProfile,
} from '../browser-relay-services/contract.mjs';

export const RELAY_IMAGE_PROFILE_SHA256 =
  '6ab86de257a4e85d51a47d528240b3862a79120d1383bab6a9092011abd3f76b';
export const RELAY_IMAGE_PROFILE_PATH = 'browser-relay-image/profile.json';
export const RELAY_IMAGE_PLAN_TTL_MILLISECONDS = 2 * 60 * 60 * 1_000;

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, '../../..');
const profilePath = join(root, 'profile.json');
const relayServicesProfilePath = join(root, '../browser-relay-services/profile.json');
const expectedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TREE = /^[0-9a-f]{40}$/u;
const GENERATION = /^[1-9][0-9]*$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_PROFILE_BYTES = 16 * 1024;
const MAXIMUM_METADATA_BYTES = 256 * 1024;
const MAXIMUM_ARCHIVE_BYTES = 1024 * 1024;
const FORBIDDEN_ENVIRONMENT = [
  /^GIT_/u,
  /^SSH_/u,
  /^(?:ALL|HTTP|HTTPS|NO)_PROXY$/iu,
];
const PRIVATE_MATERIAL = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
];
const FORBIDDEN_FIELD_NAMES = new Set([
  'access_token',
  'app_check_token',
  'authorization',
  'cookie',
  'firebase_id_token',
  'home_key',
  'id_token',
  'password',
  'private_key',
  'refresh_token',
  'request_headers',
  'response_headers',
  'secret_value',
]);

export class StagingRelayImageError extends Error {
  constructor(message = 'Staging relay image contract is invalid') {
    super(message);
    this.name = 'StagingRelayImageError';
  }
}

function reject(message) {
  throw new StagingRelayImageError(message);
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

function rejectPrivateMaterial(value, path = 'relay image value') {
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

function shellSingleQuote(value) {
  if (typeof value !== 'string' || /[\0\r\n]/u.test(value)) {
    reject('Cloud Build smoke-test argument is invalid');
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function validateRelayImageProfile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Relay image profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_IMAGE_PROFILE_SHA256) {
    reject('Relay image profile digest has drifted');
  }
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay image profile is not valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')) {
    reject('Relay image profile is not canonical JSON');
  }
  rejectPrivateMaterial(profile);
  if (!isDeepStrictEqual(profile, expectedProfile)
    || profile.schema !== 'miakapp.staging-browser-relay-image-profile/2'
    || profile.state !== 'recovery_reviewed_not_built'
    || profile.project?.project_id !== 'miakapp-v4-staging'
    || profile.project?.project_number !== '1072737219170'
    || profile.project?.region !== 'europe-west9'
    || profile.contracts?.browser_relay_plan_sha256 !== BROWSER_RELAY_PLAN_SHA256
    || profile.contracts?.relay_services_profile_sha256 !== RELAY_SERVICES_V1_PROFILE_SHA256
    || profile.contracts?.v1_profile_sha256
      !== '2afcfc7b5f0b9fb524a59bd81cd5dcd98f73bf58c2619640b6a42bbbd0958981'
    || profile.contracts?.v1_result_sha256
      !== 'c24b5cc5fe3a48a6a35365e6c404734aaf657832af8ce16c7a67c1c8e94ec1a9'
    || !COMMIT.test(profile.source?.commit ?? '')
    || !TREE.test(profile.source?.tree ?? '')
    || !SHA256.test(profile.source?.archive_sha256 ?? '')
    || profile.source?.archive_bytes !== 53098
    || profile.source?.object_generation !== '1788648564283151'
    || !profile.build?.builder_image?.endsWith(
      '@sha256:3d00b6c1a9b862621c30fc74d4f2abfc62bcbdee631ed3febd31e7edbdf6252c',
    )
    || profile.build?.maximum_builds !== 1
    || profile.build?.requested_verify_option !== 'VERIFIED'
    || profile.build?.build_tag !== 'miakapp-relay-image-v2'
    || profile.image?.tag
      !== 'source-df10674e034f30eec80760f5ec94bc108cff026f-verified-v2'
    || profile.operation?.claim_object !== 'operations/browser-relay-image-build-v2.json'
    || profile.image?.digest_required_for_deployment !== true
    || profile.image?.maximum_compressed_bytes !== 32 * 1024 * 1024
    || profile.operation?.retry_authorized !== false
    || profile.operation?.source_upload_authorized !== false
    || profile.operation?.deletion_authorized !== false
    || profile.operation?.public_ingress_authorized !== false
    || profile.operation?.relay_service_creation_authorized !== false
    || profile.operation?.persistent_credentials_authorized !== false
    || profile.operation?.container_scanning_authorized !== false
    || profile.prerequisites?.container_analysis_api !== 'containeranalysis.googleapis.com'
    || profile.prerequisites?.container_analysis_api_enabled !== true
    || profile.prerequisites?.container_scanning_api !== 'containerscanning.googleapis.com'
    || profile.prerequisites?.container_scanning_api_enabled !== false
    || profile.prerequisites?.foundation_state_generation !== '1788650355101579'
    || profile.prerequisites?.foundation_state_sha256
      !== 'd02467774f19e3bbd0a596113d843e4dac99b14558c3655cd370104d3e04c32d'
    || profile.prerequisites?.foundation_state_serial !== 7
    || profile.prerequisites?.foundation_managed_resources !== 34
    || profile.recovery?.v1_claim_object !== 'operations/browser-relay-image-build-v1.json'
    || profile.recovery?.v1_claim_generation !== '1788648548612853'
    || profile.recovery?.v1_claim_sha256
      !== '323ef6f667d38c44b47ae1e674db6ed770f287a43238b99442360930106514cf'
    || profile.recovery?.v1_build_id !== '171b3a0b-8c4e-4d3c-888f-aaba6504b3f3'
    || profile.recovery?.v1_build_status !== 'FAILURE'
    || profile.recovery?.v1_image_digest
      !== 'sha256:fb506072777eb8c59b117c36e8333f2ec7389ecc36ba14e937ba5b0519f1a535'
    || profile.recovery?.source_reuse_required !== true
    || profile.recovery?.new_claim_required !== true
    || profile.recovery?.new_build_tag_required !== true
    || profile.recovery?.new_image_tag_required !== true
    || profile.cost?.maximum_incremental_eur !== 1
    || profile.cost?.stress_test !== false
    || profile.cost?.new_fixed_cost_services !== 0) {
    reject('Relay image profile does not match the reviewed boundary');
  }
  return Object.freeze(profile);
}

function relaySmokeEnvironment() {
  const profile = validateRelayServicesProfile(relayServicesProfilePath);
  return Object.freeze({
    MIAKAPP_ALLOWED_ORIGINS: profile.application.allowed_origin,
    MIAKAPP_CONNECTION_ATTEMPTS_PER_MINUTE:
      String(profile.admission.connection_attempts_per_minute_per_immediate_peer),
    MIAKAPP_CONTROL_PLANE_ISSUER: profile.control_plane.issuer,
    MIAKAPP_CONTROL_PLANE_JWKS_URL: profile.control_plane.jwks_url,
    MIAKAPP_DECLARATION_TIMEOUT: profile.relay_runtime.declaration_timeout,
    MIAKAPP_DISCONNECT_GRACE: profile.relay_runtime.disconnect_grace,
    MIAKAPP_HANDSHAKE_TIMEOUT: profile.relay_runtime.handshake_timeout,
    MIAKAPP_LISTEN_ADDRESS: `:${profile.cloud_run.port}`,
    MIAKAPP_MAX_AGGREGATE_QUEUED_BYTES:
      String(profile.admission.maximum_aggregate_queued_bytes),
    MIAKAPP_MAX_CONNECTIONS: String(profile.admission.maximum_connections),
    MIAKAPP_MAX_CONNECTIONS_PER_IP:
      String(profile.admission.maximum_connections_per_immediate_peer),
    MIAKAPP_MAX_HOMES: String(profile.admission.maximum_homes),
    MIAKAPP_MAX_QUEUED_BYTES:
      String(profile.admission.maximum_queued_bytes_per_connection),
    MIAKAPP_MAX_TRACKED_IPS:
      String(profile.admission.maximum_tracked_immediate_peers),
    MIAKAPP_PING_INTERVAL: profile.relay_runtime.ping_interval,
    MIAKAPP_PONG_TIMEOUT: profile.relay_runtime.pong_timeout,
    MIAKAPP_RELAY_AUDIENCE: profile.services[0].bootstrap_audience,
    MIAKAPP_SHUTDOWN_TIMEOUT: profile.relay_runtime.shutdown_timeout,
    MIAKAPP_WRITE_TIMEOUT: profile.relay_runtime.write_timeout,
  });
}

export function relayImageSmokeScript() {
  const profile = validateRelayImageProfile();
  const relayProfile = validateRelayServicesProfile(relayServicesProfilePath);
  const environment = Object.entries(relaySmokeEnvironment())
    .map(([name, value]) => `  --env ${shellSingleQuote(`${name}=${value}`)} \\`);
  return [
    'set -euo pipefail',
    "container='miakapp-relay-image-smoke'",
    'cleanup() {',
    '  docker rm -f miakapp-relay-image-smoke >/dev/null 2>&1 || true',
    '}',
    'trap cleanup EXIT',
    'docker run --detach --name miakapp-relay-image-smoke --network cloudbuild \\',
    '  --read-only --cap-drop ALL --security-opt no-new-privileges \\',
    '  --memory 256m --cpus 1 \\',
    ...environment,
    `  ${shellSingleQuote(profile.image.tag_reference)} >/dev/null`,
    `for _ in {1..${profile.build.smoke_test.maximum_attempts}}; do`,
    `  if curl --fail --silent --show-error --max-time ${profile.build.smoke_test.request_timeout_seconds} \\`,
    `    --output /workspace/relay-smoke-response http://miakapp-relay-image-smoke:${relayProfile.cloud_run.port}/ping \\`,
    `    && grep -Fxq ${shellSingleQuote(profile.build.smoke_test.expected_response)} /workspace/relay-smoke-response; then`,
    '    exit 0',
    '  fi',
    "  if ! docker inspect --format '{{.State.Running}}' miakapp-relay-image-smoke \\",
    "    | grep -Fxq 'true'; then",
    '    exit 1',
    '  fi',
    '  sleep 1',
    'done',
    'exit 1',
    '',
  ].join('\n');
}

export function buildCloudBuildRequest(sourceGeneration) {
  const profile = validateRelayImageProfile();
  if (!GENERATION.test(String(sourceGeneration))) {
    reject('Cloud Build source generation must be a positive decimal integer');
  }
  const buildArguments = [
    'build',
    '--pull',
    ...Object.entries(profile.image.labels)
      .map(([name, value]) => `--label=${name}=${value}`),
    `--tag=${profile.image.tag_reference}`,
    '.',
  ];
  return Object.freeze({
    source: Object.freeze({
      storageSource: Object.freeze({
        bucket: profile.source.source_bucket,
        object: profile.source.source_object,
        generation: String(sourceGeneration),
      }),
    }),
    steps: Object.freeze([
      Object.freeze({
        name: profile.build.builder_image,
        id: 'build',
        args: Object.freeze(buildArguments),
      }),
      Object.freeze({
        name: profile.build.builder_image,
        id: 'smoke',
        entrypoint: '/bin/bash',
        args: Object.freeze(['-ceu', relayImageSmokeScript()]),
        waitFor: Object.freeze(['build']),
      }),
    ]),
    images: Object.freeze([profile.image.tag_reference]),
    timeout: `${profile.build.timeout_seconds}s`,
    queueTtl: `${profile.build.queue_ttl_seconds}s`,
    options: Object.freeze({
      machineType: profile.build.machine_type,
      logging: profile.build.logging,
      sourceProvenanceHash: Object.freeze([profile.build.source_provenance_hash]),
      requestedVerifyOption: profile.build.requested_verify_option,
      substitutionOption: 'MUST_MATCH',
      dynamicSubstitutions: false,
      automapSubstitutions: false,
      enableStructuredLogging: true,
    }),
    serviceAccount: profile.build.service_account,
    tags: Object.freeze([profile.build.build_tag]),
  });
}

export function cloudBuildRequestCommitment(request) {
  if (!plainObject(request) || !plainObject(request.source?.storageSource)) {
    reject('Cloud Build request commitment input is invalid');
  }
  const normalized = structuredClone(request);
  normalized.source.storageSource.generation = '<source-generation>';
  return sha256(Buffer.from(canonicalJson(normalized), 'utf8'));
}

export function assertSafeRelayImageEnvironment(environment, allowedName) {
  assertSafeWorkloadEnvironment(environment, allowedName);
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && value.length !== 0
      && FORBIDDEN_ENVIRONMENT.some((pattern) => pattern.test(name))) {
      reject(`Environment override ${name} is forbidden for relay image execution`);
    }
  }
}

export function createRelayImageBundle(parentPath) {
  if (!isAbsolute(parentPath)) reject('Private relay image parent must be an absolute path');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Private relay image parent must be a real directory outside the repository');
  }
  const bundle = mkdtempSync(join(parent, 'miakapp-staging-relay-image-'));
  chmodSync(bundle, 0o700);
  return realpathSync(bundle);
}

export function existingRelayImageBundle(path) {
  const bundle = realpathSync(resolve(path));
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, bundle);
  const entry = lstatSync(bundle);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Relay image apply requires a private bundle outside the repository');
  }
  return bundle;
}

export function buildRelayImageMetadata({
  repositoryCommit,
  createdAt,
  baseline,
  archiveBytes,
}) {
  const profile = validateRelayImageProfile();
  if (!COMMIT.test(repositoryCommit) || !plainObject(baseline)
    || !Buffer.isBuffer(archiveBytes)
    || sha256(archiveBytes) !== profile.source.archive_sha256
    || archiveBytes.byteLength !== profile.source.archive_bytes) {
    reject('Relay image metadata inputs are invalid');
  }
  const created = canonicalTimestamp(createdAt, 'created_at');
  const request = buildCloudBuildRequest(profile.source.object_generation);
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-plan/2',
    operation: 'recover-private-browser-relay-image-verification',
    project_id: profile.project.project_id,
    project_number: profile.project.project_number,
    region: profile.project.region,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(created + RELAY_IMAGE_PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    profile_sha256: RELAY_IMAGE_PROFILE_SHA256,
    relay_source_commit: profile.source.commit,
    relay_source_tree: profile.source.tree,
    source_archive_sha256: profile.source.archive_sha256,
    source_archive_bytes: profile.source.archive_bytes,
    source_object_generation: profile.source.object_generation,
    v1_result_sha256: profile.contracts.v1_result_sha256,
    foundation_state_generation: profile.prerequisites.foundation_state_generation,
    container_analysis_api_enabled: true,
    container_scanning_api_enabled: false,
    source_upload_authorized: false,
    build_request_commitment_sha256: cloudBuildRequestCommitment(request),
    baseline_sha256: sha256(Buffer.from(canonicalJson(baseline), 'utf8')),
    baseline,
    maximum_builds: 1,
    retry_authorized: false,
    deletion_authorized: false,
    public_ingress_authorized: false,
    relay_service_creation_authorized: false,
    private_bundle_committed: false,
    credential_material_committed: false,
  });
}

export function validateRelayImageMetadata(value, now = Date.now()) {
  const profile = validateRelayImageProfile();
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
    'relay_source_commit',
    'relay_source_tree',
    'source_archive_sha256',
    'source_archive_bytes',
    'source_object_generation',
    'v1_result_sha256',
    'foundation_state_generation',
    'container_analysis_api_enabled',
    'container_scanning_api_enabled',
    'source_upload_authorized',
    'build_request_commitment_sha256',
    'baseline_sha256',
    'baseline',
    'maximum_builds',
    'retry_authorized',
    'deletion_authorized',
    'public_ingress_authorized',
    'relay_service_creation_authorized',
    'private_bundle_committed',
    'credential_material_committed',
  ], 'Relay image metadata');
  rejectPrivateMaterial(metadata, 'Relay image metadata');
  if (metadata.schema !== 'miakapp.staging-browser-relay-image-plan/2'
    || metadata.operation !== 'recover-private-browser-relay-image-verification'
    || metadata.project_id !== profile.project.project_id
    || metadata.project_number !== profile.project.project_number
    || metadata.region !== profile.project.region
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.profile_sha256 !== RELAY_IMAGE_PROFILE_SHA256
    || metadata.relay_source_commit !== profile.source.commit
    || metadata.relay_source_tree !== profile.source.tree
    || metadata.source_archive_sha256 !== profile.source.archive_sha256
    || metadata.source_archive_bytes !== profile.source.archive_bytes
    || metadata.source_object_generation !== profile.source.object_generation
    || metadata.v1_result_sha256 !== profile.contracts.v1_result_sha256
    || metadata.foundation_state_generation
      !== profile.prerequisites.foundation_state_generation
    || metadata.container_analysis_api_enabled !== true
    || metadata.container_scanning_api_enabled !== false
    || metadata.source_upload_authorized !== false
    || metadata.build_request_commitment_sha256
      !== cloudBuildRequestCommitment(buildCloudBuildRequest(profile.source.object_generation))
    || !SHA256.test(metadata.baseline_sha256)
    || !plainObject(metadata.baseline)
    || metadata.baseline_sha256
      !== sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8'))
    || metadata.maximum_builds !== 1
    || metadata.retry_authorized !== false
    || metadata.deletion_authorized !== false
    || metadata.public_ingress_authorized !== false
    || metadata.relay_service_creation_authorized !== false
    || metadata.private_bundle_committed !== false
    || metadata.credential_material_committed !== false) {
    reject('Relay image metadata does not match the reviewed operation');
  }
  const created = canonicalTimestamp(metadata.created_at, 'created_at');
  const expires = canonicalTimestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== RELAY_IMAGE_PLAN_TTL_MILLISECONDS
    || now < created - 60_000 || now > expires) {
    reject('Relay image metadata is expired or not yet valid');
  }
  return Object.freeze(metadata);
}

export function readRelayImageMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, MAXIMUM_METADATA_BYTES);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay image metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Relay image metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateRelayImageMetadata(value, now) });
}

export function readRelaySourceArchive(path) {
  const profile = validateRelayImageProfile();
  const bytes = readPrivateFile(path, MAXIMUM_ARCHIVE_BYTES);
  if (bytes.byteLength !== profile.source.archive_bytes
    || sha256(bytes) !== profile.source.archive_sha256) {
    reject('Private relay source archive differs from the reviewed bytes');
  }
  return bytes;
}

export function relayImageAuthorization(metadataBytes, repositoryCommit) {
  if (!Buffer.isBuffer(metadataBytes) || metadataBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit)) {
    reject('Relay image authorization inputs are invalid');
  }
  return `recover-private-relay-image:${expectedProfile.project.project_id}:${sha256(metadataBytes)}:${repositoryCommit}`;
}

export function validateRelayImageAuthorization(value, metadataBytes, repositoryCommit) {
  const expected = Buffer.from(relayImageAuthorization(metadataBytes, repositoryCommit), 'utf8');
  const actual = Buffer.from(typeof value === 'string' ? value : '', 'utf8');
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    reject('Exact staging relay image authorization is missing or invalid');
  }
}

export {
  canonicalJson,
  readPrivateFile,
  sha256,
  writePrivateFile,
};
