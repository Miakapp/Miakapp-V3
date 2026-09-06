import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  RELAY_IMAGE_PROFILE_SHA256,
  canonicalJson,
  sha256,
} from './contract.mjs';

export const RELAY_IMAGE_V1_PROFILE_PATH = 'browser-relay-image/profile-v1.json';
export const RELAY_IMAGE_V1_PROFILE_SHA256 =
  '2afcfc7b5f0b9fb524a59bd81cd5dcd98f73bf58c2619640b6a42bbbd0958981';
export const RELAY_IMAGE_V1_RESULT_PATH = 'browser-relay-image/result-v1.json';
export const RELAY_IMAGE_V1_RESULT_SHA256 =
  'c24b5cc5fe3a48a6a35365e6c404734aaf657832af8ce16c7a67c1c8e94ec1a9';
export const RELAY_IMAGE_V2_RESULT_PATH = 'browser-relay-image/result-v2.json';
export const RELAY_IMAGE_V2_RESULT_SHA256 =
  'dcf1ea4d63e9c7e13970d77c40dcc0ebc43215ffc6ffc3293ce28b78868e1649';

const root = dirname(fileURLToPath(import.meta.url));
const profilePath = join(root, 'profile-v1.json');
const resultPath = join(root, 'result-v1.json');
const resultV2Path = join(root, 'result-v2.json');
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GENERATION = /^[1-9][0-9]*$/u;
const BUILD_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,9})?Z$/u;
const MAXIMUM_RESULT_BYTES = 16 * 1024;

function reject(message) {
  throw new Error(message);
}

export function rejectRelayImageV1Replay() {
  reject('Relay image build v1 is consumed and failed provenance verification; use a separately reviewed recovery operation');
}

export function rejectRelayImageV2Replay() {
  reject('Relay image build v2 is consumed and succeeded; its one-shot plan and apply entrypoints are permanently retired');
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

export function validateRelayImageV1Profile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_RESULT_BYTES) {
    reject('Relay image v1 profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_IMAGE_V1_PROFILE_SHA256) {
    reject('Relay image v1 profile digest has drifted');
  }
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay image v1 profile is not valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')
    || profile.schema !== 'miakapp.staging-browser-relay-image-profile/1'
    || profile.state !== 'reviewed_not_built'
    || profile.project?.project_id !== 'miakapp-v4-staging'
    || profile.operation?.claim_object !== 'operations/browser-relay-image-build-v1.json'
    || profile.build?.build_tag !== 'miakapp-relay-image-v1') {
    reject('Relay image v1 profile does not match the consumed build boundary');
  }
  return Object.freeze(profile);
}

export function validateRelayImageV1Result(path = resultPath) {
  validateRelayImageV1Profile();
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_RESULT_BYTES) {
    reject('Relay image v1 result must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_IMAGE_V1_RESULT_SHA256) {
    reject('Relay image v1 result digest has drifted');
  }
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay image v1 result is not valid JSON');
  }
  if (canonicalJson(result) !== bytes.toString('utf8')) {
    reject('Relay image v1 result is not canonical JSON');
  }
  exactKeys(result, [
    'schema',
    'state',
    'project_id',
    'project_number',
    'region',
    'observed_at',
    'repository_commit',
    'profile_sha256',
    'metadata_sha256',
    'source',
    'claim',
    'build',
    'image',
    'prerequisites',
    'effects',
  ], 'Relay image v1 result');
  const source = exactKeys(result.source, [
    'repository', 'commit', 'tree', 'archive_sha256', 'archive_bytes', 'object_generation',
  ], 'Relay image v1 source result');
  const claim = exactKeys(result.claim, [
    'generation', 'size_bytes', 'sha256', 'maximum_builds', 'retry_authorized',
    'deletion_authorized',
  ], 'Relay image v1 claim result');
  const build = exactKeys(result.build, [
    'id', 'operation_name_sha256', 'status', 'failure_category', 'created_at',
    'started_at', 'finished_at', 'builder_digest', 'requested_verify_option',
    'source_provenance_hash', 'source_sha256_observed', 'build_step_status',
    'smoke_step_status', 'image_push_observed', 'verified_provenance_created',
  ], 'Relay image v1 build result');
  const image = exactKeys(result.image, [
    'schema', 'tag_reference', 'digest', 'digest_reference', 'manifest_media_type',
    'manifest_sha256', 'config_digest', 'compressed_bytes', 'layers', 'os',
    'architecture', 'user', 'entrypoint', 'exposed_ports', 'labels',
    'deployment_authorized',
  ], 'Relay image v1 publication result');
  const prerequisites = exactKeys(result.prerequisites, [
    'cloud_build_service_agent_binding_present', 'container_analysis_api_enabled',
    'container_scanning_api_enabled',
  ], 'Relay image v1 prerequisites');
  const effects = exactKeys(result.effects, [
    'cloud_builds_submitted', 'cloud_run_services_created', 'public_ingress_created',
    'iam_bindings_created', 'persistent_credentials_created',
    'container_scanning_enabled', 'stress_test_executed',
  ], 'Relay image v1 effects');
  if (result.schema !== 'miakapp.staging-browser-relay-image-attempt-result/1'
    || result.state !== 'build_and_smoke_succeeded_verified_provenance_failed_not_deployable'
    || result.project_id !== 'miakapp-v4-staging'
    || result.project_number !== '1072737219170'
    || result.region !== 'europe-west9'
    || !TIMESTAMP.test(result.observed_at ?? '')
    || result.repository_commit !== '24448bc085504d44d710120fd8162c2dc2cb30b8'
    || result.profile_sha256 !== RELAY_IMAGE_V1_PROFILE_SHA256
    || !SHA256.test(result.metadata_sha256 ?? '')
    || source.repository !== 'https://github.com/Miakapp/Miakapp-Server.git'
    || source.commit !== 'df10674e034f30eec80760f5ec94bc108cff026f'
    || source.tree !== '0468ea08cd2d51b3e656c4adea9bb09b4a8a6ea1'
    || source.archive_sha256 !== '93fd720736453e3555be625bbb993194f48a5388821169c939674b04088f158e'
    || source.archive_bytes !== 53098
    || !GENERATION.test(source.object_generation ?? '')
    || !GENERATION.test(claim.generation ?? '')
    || !Number.isSafeInteger(claim.size_bytes) || claim.size_bytes < 1
    || !SHA256.test(claim.sha256 ?? '')
    || claim.maximum_builds !== 1 || claim.retry_authorized !== false
    || claim.deletion_authorized !== false
    || !BUILD_ID.test(build.id ?? '')
    || !SHA256.test(build.operation_name_sha256 ?? '')
    || build.status !== 'FAILURE'
    || build.failure_category !== 'container_analysis_metadata_api_disabled'
    || ![build.created_at, build.started_at, build.finished_at].every(
      (value) => TIMESTAMP.test(value ?? ''),
    )
    || build.builder_digest
      !== 'sha256:3d00b6c1a9b862621c30fc74d4f2abfc62bcbdee631ed3febd31e7edbdf6252c'
    || build.requested_verify_option !== 'VERIFIED'
    || build.source_provenance_hash !== 'SHA256'
    || build.source_sha256_observed !== true
    || build.build_step_status !== 'SUCCESS' || build.smoke_step_status !== 'SUCCESS'
    || build.image_push_observed !== true || build.verified_provenance_created !== false
    || image.schema !== 'miakapp.staging-browser-relay-image-publication/1'
    || !SHA256_DIGEST.test(image.digest ?? '')
    || image.manifest_sha256 !== image.digest.slice('sha256:'.length)
    || !SHA256_DIGEST.test(image.config_digest ?? '')
    || !Number.isSafeInteger(image.compressed_bytes) || image.compressed_bytes < 1
    || !Number.isSafeInteger(image.layers) || image.layers < 1
    || image.os !== 'linux' || image.architecture !== 'amd64' || image.user !== '65532'
    || !isDeepStrictEqual(image.entrypoint, ['/usr/local/bin/miakapp-server'])
    || !isDeepStrictEqual(image.exposed_ports, ['3000/tcp'])
    || image.deployment_authorized !== false
    || prerequisites.cloud_build_service_agent_binding_present !== true
    || prerequisites.container_analysis_api_enabled !== false
    || prerequisites.container_scanning_api_enabled !== false
    || effects.cloud_builds_submitted !== 1 || effects.cloud_run_services_created !== 0
    || effects.public_ingress_created !== false || effects.iam_bindings_created !== 0
    || effects.persistent_credentials_created !== 0
    || effects.container_scanning_enabled !== false || effects.stress_test_executed !== false) {
    reject('Relay image v1 result does not match the reviewed failed-attempt boundary');
  }
  return Object.freeze(result);
}

export function validateRelayImageV2Result(path = resultV2Path) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > MAXIMUM_RESULT_BYTES) {
    reject('Relay image v2 result must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== RELAY_IMAGE_V2_RESULT_SHA256) {
    reject('Relay image v2 result digest has drifted');
  }
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay image v2 result is not valid JSON');
  }
  if (canonicalJson(result) !== bytes.toString('utf8')) {
    reject('Relay image v2 result is not canonical JSON');
  }
  exactKeys(result, [
    'schema',
    'state',
    'project_id',
    'project_number',
    'region',
    'repository_commit',
    'profile_sha256',
    'metadata_sha256',
    'observed_at',
    'source',
    'claim',
    'build',
    'image',
    'recovery',
    'effects',
  ], 'Relay image v2 result');
  const source = exactKeys(result.source, [
    'repository', 'commit', 'tree', 'archive_sha256', 'archive_bytes', 'object_generation',
  ], 'Relay image v2 source result');
  const claim = exactKeys(result.claim, [
    'generation', 'sha256', 'maximum_builds', 'retry_authorized', 'deletion_authorized',
  ], 'Relay image v2 claim result');
  const build = exactKeys(result.build, [
    'operation_name_sha256', 'id', 'status', 'builder_digest',
    'requested_verify_option', 'source_provenance_hash',
  ], 'Relay image v2 build result');
  const image = exactKeys(result.image, [
    'schema', 'tag_reference', 'digest', 'digest_reference', 'manifest_media_type',
    'manifest_sha256', 'config_digest', 'compressed_bytes', 'layers', 'os',
    'architecture', 'user', 'entrypoint', 'exposed_ports', 'labels',
  ], 'Relay image v2 publication result');
  const recovery = exactKeys(result.recovery, [
    'v1_result_sha256', 'v1_build_id', 'v1_build_status', 'v1_image_digest',
    'source_reused', 'source_upload_performed',
  ], 'Relay image v2 recovery result');
  const effects = exactKeys(result.effects, [
    'recovery_builds_submitted', 'cloud_run_services_created', 'public_ingress_created',
    'iam_bindings_created', 'persistent_credentials_created',
    'container_analysis_enabled', 'container_scanning_enabled', 'stress_test_executed',
  ], 'Relay image v2 effects');
  const imageDigest =
    'sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1';
  const imageRepository =
    'europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp-server';
  if (result.schema !== 'miakapp.staging-browser-relay-image-result/2'
    || result.state !== 'private_image_recovered_verified_not_deployed'
    || result.project_id !== 'miakapp-v4-staging'
    || result.project_number !== '1072737219170'
    || result.region !== 'europe-west9'
    || result.repository_commit !== '5cd537484d341d429a269c8d72de979f3643b066'
    || result.profile_sha256 !== RELAY_IMAGE_PROFILE_SHA256
    || result.metadata_sha256
      !== '0a3376ba1dfeb31ab4b5fb68c8f31516938d6cf87c0446c8583b14b459efaa3e'
    || !TIMESTAMP.test(result.observed_at ?? '')
    || source.repository !== 'https://github.com/Miakapp/Miakapp-Server.git'
    || source.commit !== 'df10674e034f30eec80760f5ec94bc108cff026f'
    || source.tree !== '0468ea08cd2d51b3e656c4adea9bb09b4a8a6ea1'
    || source.archive_sha256
      !== '93fd720736453e3555be625bbb993194f48a5388821169c939674b04088f158e'
    || source.archive_bytes !== 53098
    || source.object_generation !== '1788648564283151'
    || claim.generation !== '1788652620212083'
    || claim.sha256 !== 'ac1f6a326b54306737f3e4d885f55aec4e43fe3ecf6144324e51e2199dca1b03'
    || claim.maximum_builds !== 1 || claim.retry_authorized !== false
    || claim.deletion_authorized !== false
    || build.operation_name_sha256
      !== '06805ae5a324a35b13963c1b5d6f30a839513c1e94b48eba845adca6582ecf19'
    || build.id !== '70e25c75-3c30-497a-982a-f7bebe71c4ee'
    || build.status !== 'SUCCESS'
    || build.builder_digest
      !== 'sha256:3d00b6c1a9b862621c30fc74d4f2abfc62bcbdee631ed3febd31e7edbdf6252c'
    || build.requested_verify_option !== 'VERIFIED'
    || build.source_provenance_hash !== 'SHA256'
    || image.schema !== 'miakapp.staging-browser-relay-image-publication/1'
    || image.tag_reference
      !== `${imageRepository}:source-df10674e034f30eec80760f5ec94bc108cff026f-verified-v2`
    || image.digest !== imageDigest
    || image.digest_reference !== `${imageRepository}@${imageDigest}`
    || image.manifest_media_type
      !== 'application/vnd.docker.distribution.manifest.v2+json'
    || image.manifest_sha256 !== imageDigest.slice('sha256:'.length)
    || image.config_digest
      !== 'sha256:344314bad3b6f6f1f280737b3d010cdcafb2ead6cf868c8b97e2c367401001a9'
    || image.compressed_bytes !== 4024536 || image.layers !== 13
    || image.os !== 'linux' || image.architecture !== 'amd64' || image.user !== '65532'
    || !isDeepStrictEqual(image.entrypoint, ['/usr/local/bin/miakapp-server'])
    || !isDeepStrictEqual(image.exposed_ports, ['3000/tcp'])
    || !isDeepStrictEqual(image.labels, {
      'com.miakapp.staging.source-archive-sha256':
        '93fd720736453e3555be625bbb993194f48a5388821169c939674b04088f158e',
      'com.miakapp.staging.source-tree': '0468ea08cd2d51b3e656c4adea9bb09b4a8a6ea1',
      'org.opencontainers.image.revision': 'df10674e034f30eec80760f5ec94bc108cff026f',
      'org.opencontainers.image.source': 'https://github.com/Miakapp/Miakapp-Server',
      'org.opencontainers.image.title': 'Miakapp Server',
      'org.opencontainers.image.vendor': 'Miakapp',
    })
    || recovery.v1_result_sha256 !== RELAY_IMAGE_V1_RESULT_SHA256
    || recovery.v1_build_id !== '171b3a0b-8c4e-4d3c-888f-aaba6504b3f3'
    || recovery.v1_build_status !== 'FAILURE'
    || recovery.v1_image_digest
      !== 'sha256:fb506072777eb8c59b117c36e8333f2ec7389ecc36ba14e937ba5b0519f1a535'
    || recovery.source_reused !== true || recovery.source_upload_performed !== false
    || effects.recovery_builds_submitted !== 1
    || effects.cloud_run_services_created !== 0
    || effects.public_ingress_created !== false || effects.iam_bindings_created !== 0
    || effects.persistent_credentials_created !== 0
    || effects.container_analysis_enabled !== true
    || effects.container_scanning_enabled !== false
    || effects.stress_test_executed !== false) {
    reject('Relay image v2 result does not match the verified recovery boundary');
  }
  return Object.freeze(result);
}
