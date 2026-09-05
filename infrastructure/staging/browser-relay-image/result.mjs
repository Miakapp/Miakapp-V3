import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  RELAY_IMAGE_PROFILE_SHA256,
  canonicalJson,
  sha256,
  validateRelayImageProfile,
} from './contract.mjs';

export const RELAY_IMAGE_V1_RESULT_PATH = 'browser-relay-image/result-v1.json';
export const RELAY_IMAGE_V1_RESULT_SHA256 =
  'c24b5cc5fe3a48a6a35365e6c404734aaf657832af8ce16c7a67c1c8e94ec1a9';

const root = dirname(fileURLToPath(import.meta.url));
const resultPath = join(root, 'result-v1.json');
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

export function validateRelayImageV1Result(path = resultPath) {
  validateRelayImageProfile();
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
    || result.profile_sha256 !== RELAY_IMAGE_PROFILE_SHA256
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
