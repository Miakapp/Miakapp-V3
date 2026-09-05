import { isDeepStrictEqual } from 'node:util';

import {
  RELAY_IMAGE_PROFILE_SHA256,
  buildCloudBuildRequest,
  canonicalJson,
  cloudBuildRequestCommitment,
  sha256,
  validateRelayImageProfile,
} from './contract.mjs';
import { googleRelayImageRequest } from './inventory.mjs';

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BUILD_ID = /^[0-9a-f-]{16,64}$/u;
const GENERATION = /^[1-9][0-9]*$/u;
const OPERATION_NAME = /^[A-Za-z0-9_.\/-]{16,512}$/u;
const MAXIMUM_BUILD_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_CONFIG_BYTES = 4 * 1024 * 1024;
const MANIFEST_TYPES = Object.freeze([
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
]);

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function parseJson(bytes, description) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
    reject(`${description} returned an empty response`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
}

function validSession(session) {
  if (!plainObject(session) || typeof session.accessToken !== 'string'
    || session.accessToken.length < 20 || /\s/u.test(session.accessToken)) {
    reject('Relay image cloud operation requires a verified operator session');
  }
  return session;
}

function validSourceReceipt(receipt) {
  const profile = validateRelayImageProfile();
  if (!plainObject(receipt) || receipt.bucket !== profile.source.source_bucket
    || receipt.object !== profile.source.source_object
    || !GENERATION.test(receipt.generation ?? '')
    || receipt.size_bytes !== profile.source.archive_bytes
    || receipt.sha256 !== profile.source.archive_sha256) {
    reject('Relay image source receipt is invalid');
  }
  return receipt;
}

export async function uploadRelayImageSource(
  session,
  archive,
  fetchImplementation = globalThis.fetch,
) {
  validSession(session);
  const profile = validateRelayImageProfile();
  if (!Buffer.isBuffer(archive) || archive.byteLength !== profile.source.archive_bytes
    || sha256(archive) !== profile.source.archive_sha256) {
    reject('Relay image source upload requires the exact reviewed archive');
  }
  const url = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${profile.source.source_bucket}/o`,
  );
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', profile.source.source_object);
  url.searchParams.set('ifGenerationMatch', '0');
  url.searchParams.set('fields', 'bucket,name,generation,size');
  const response = await googleRelayImageRequest(url, session.accessToken, {
    method: 'POST',
    body: archive,
    contentType: 'application/gzip',
    description: 'Relay image immutable source upload',
    fetchImplementation,
    maximumResponseBytes: 64 * 1024,
  });
  const value = parseJson(response.bytes, 'Relay image immutable source upload');
  if (!plainObject(value) || value.bucket !== profile.source.source_bucket
    || value.name !== profile.source.source_object
    || !GENERATION.test(value.generation ?? '')
    || value.size !== String(archive.byteLength)) {
    reject('Relay image source upload response is malformed');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-source-receipt/1',
    bucket: profile.source.source_bucket,
    object: profile.source.source_object,
    generation: value.generation,
    size_bytes: archive.byteLength,
    sha256: profile.source.archive_sha256,
    deletion_authorized: false,
  });
}

function validateOperationName(value) {
  const profile = validateRelayImageProfile();
  if (typeof value !== 'string' || !OPERATION_NAME.test(value)
    || (!value.split('/').includes(profile.project.project_id)
      && !value.split('/').includes(profile.project.project_number))
    || profile.project.forbidden_project_ids.some((project) => value.split('/').includes(project))) {
    reject('Cloud Build operation name is invalid or foreign');
  }
  return value;
}

function buildFromOperation(operation) {
  if (!plainObject(operation)) reject('Cloud Build operation response is malformed');
  return operation.response ?? operation.metadata?.build;
}

function validateInitialOperation(value) {
  validateOperationName(value?.name);
  if (value.error !== undefined) reject('Cloud Build submission returned an operation error');
  const build = buildFromOperation(value);
  if (build !== undefined && (!plainObject(build) || !BUILD_ID.test(build.id ?? ''))) {
    reject('Cloud Build submission returned an invalid build identity');
  }
  return value;
}

export async function submitRelayImageBuild(
  session,
  sourceReceipt,
  expectedRequestCommitment,
  fetchImplementation = globalThis.fetch,
) {
  validSession(session);
  validSourceReceipt(sourceReceipt);
  const profile = validateRelayImageProfile();
  const request = buildCloudBuildRequest(sourceReceipt.generation);
  if (cloudBuildRequestCommitment(request) !== expectedRequestCommitment) {
    reject('Cloud Build request differs from the reviewed plan commitment');
  }
  const endpoint = `https://cloudbuild.googleapis.com/v1/projects/${profile.project.project_id}`
    + `/locations/${profile.project.region}/builds`;
  const response = await googleRelayImageRequest(endpoint, session.accessToken, {
    method: 'POST',
    body: Buffer.from(canonicalJson(request), 'utf8'),
    description: 'Relay image one-shot Cloud Build submission',
    fetchImplementation,
    maximumResponseBytes: MAXIMUM_BUILD_RESPONSE_BYTES,
    timeoutMilliseconds: 60_000,
  });
  const operation = validateInitialOperation(
    parseJson(response.bytes, 'Relay image one-shot Cloud Build submission'),
  );
  return Object.freeze({ operation, request });
}

function operationUrl(name) {
  validateOperationName(name);
  const profile = validateRelayImageProfile();
  return `https://${profile.project.region}-cloudbuild.googleapis.com/v1/${name}`;
}

function operationStatus(operation) {
  const build = buildFromOperation(operation);
  return typeof build?.status === 'string' ? build.status : 'QUEUED';
}

export async function waitForRelayImageBuild(session, initialOperation, options = {}) {
  validSession(session);
  let operation = validateInitialOperation(initialOperation);
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const onStatus = options.onStatus ?? (() => {});
  if (typeof fetchImplementation !== 'function' || typeof sleep !== 'function'
    || typeof onStatus !== 'function') {
    reject('Cloud Build polling dependencies are invalid');
  }
  const profile = validateRelayImageProfile();
  const deadline = Date.now() + (profile.build.timeout_seconds + 90) * 1_000;
  let lastStatus;
  for (let attempt = 0; attempt < 330 && Date.now() <= deadline; attempt += 1) {
    const status = operationStatus(operation);
    if (status !== lastStatus) {
      onStatus(status);
      lastStatus = status;
    }
    if (operation.done === true) {
      if (operation.error !== undefined) reject('Relay image Cloud Build failed');
      if (!plainObject(operation.response)) reject('Completed Cloud Build response is missing');
      return Object.freeze({ operation, build: operation.response });
    }
    if (attempt !== 0) await sleep(3_000);
    const response = await googleRelayImageRequest(
      operationUrl(operation.name),
      session.accessToken,
      {
        description: 'Relay image Cloud Build operation polling',
        fetchImplementation,
        maximumResponseBytes: MAXIMUM_BUILD_RESPONSE_BYTES,
      },
    );
    const next = parseJson(response.bytes, 'Relay image Cloud Build operation polling');
    if (next.name !== operation.name) reject('Cloud Build operation identity changed while polling');
    operation = validateInitialOperation(next);
  }
  reject('Relay image Cloud Build exceeded its bounded polling window');
}

function validateStep(actual, expected, description) {
  if (!plainObject(actual) || actual.name !== expected.name || actual.id !== expected.id
    || !isDeepStrictEqual(actual.args, expected.args)
    || (expected.entrypoint !== undefined && actual.entrypoint !== expected.entrypoint)
    || (expected.waitFor !== undefined && !isDeepStrictEqual(actual.waitFor, expected.waitFor))
    || actual.status !== 'SUCCESS') {
    reject(`${description} differs from the exact successful step`);
  }
}

function validateSourceProvenance(value, sourceReceipt) {
  if (!plainObject(value)
    || !isDeepStrictEqual(value.resolvedStorageSource, {
      bucket: sourceReceipt.bucket,
      object: sourceReceipt.object,
      generation: sourceReceipt.generation,
    })
    || !plainObject(value.fileHashes)) {
    reject('Cloud Build source provenance does not resolve the exact source generation');
  }
  const entries = Object.entries(value.fileHashes);
  const expectedKey = `gs://${sourceReceipt.bucket}/${sourceReceipt.object}#${sourceReceipt.generation}`;
  if (entries.length !== 1 || entries[0][0] !== expectedKey
    || !plainObject(entries[0][1])
    || !Array.isArray(entries[0][1].fileHash)
    || entries[0][1].fileHash.length < 1 || entries[0][1].fileHash.length > 2
    || entries[0][1].fileHash.some((hash) => !plainObject(hash)
      || !isDeepStrictEqual(Object.keys(hash).sort(), ['type', 'value'])
      || !['SHA256', 'MD5'].includes(hash.type)
      || typeof hash.value !== 'string')) {
    reject('Cloud Build source provenance hash differs from the reviewed archive');
  }
  const hashes = entries[0][1].fileHash;
  const sha256Hashes = hashes.filter(({ type }) => type === 'SHA256');
  const md5Hashes = hashes.filter(({ type }) => type === 'MD5');
  if (sha256Hashes.length !== 1 || md5Hashes.length > 1) {
    reject('Cloud Build source provenance hash differs from the reviewed archive');
  }
  const decodeHash = ({ value }, expectedBytes) => {
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(value)) return null;
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/u, '');
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
    const decoded = Buffer.from(padded, 'base64');
    if (decoded.byteLength !== expectedBytes
      || decoded.toString('base64').replace(/=+$/u, '') !== normalized) return null;
    return decoded;
  };
  const observedSha256 = decodeHash(sha256Hashes[0], 32);
  if (observedSha256 === null
    || !observedSha256.equals(Buffer.from(sourceReceipt.sha256, 'hex'))
    || (md5Hashes.length === 1 && decodeHash(md5Hashes[0], 16) === null)) {
    reject('Cloud Build source provenance hash differs from the reviewed archive');
  }
}

export function validateCompletedRelayImageBuild(build, sourceReceipt) {
  validSourceReceipt(sourceReceipt);
  const profile = validateRelayImageProfile();
  const expected = buildCloudBuildRequest(sourceReceipt.generation);
  if (!plainObject(build) || !BUILD_ID.test(build.id ?? '')) {
    reject('Completed Cloud Build identity is invalid');
  }
  const expectedBuildNames = [profile.project.project_id, profile.project.project_number]
    .map((project) => `projects/${project}/locations/${profile.project.region}/builds/${build.id}`);
  if (build.projectId !== profile.project.project_id
    || !expectedBuildNames.includes(build.name)
    || build.status !== 'SUCCESS'
    || build.serviceAccount !== profile.build.service_account
    || !isDeepStrictEqual(build.tags, [profile.build.build_tag])
    || !isDeepStrictEqual(build.source?.storageSource, expected.source.storageSource)
    || build.timeout !== expected.timeout
    || build.queueTtl !== expected.queueTtl
    || !plainObject(build.options)
    || build.options.machineType !== profile.build.machine_type
    || build.options.logging !== profile.build.logging
    || !isDeepStrictEqual(build.options.sourceProvenanceHash, [profile.build.source_provenance_hash])
    || build.options.requestedVerifyOption !== profile.build.requested_verify_option
    || !Array.isArray(build.steps) || build.steps.length !== expected.steps.length) {
    reject('Completed Cloud Build differs from the exact reviewed build');
  }
  expected.steps.forEach((step, index) => validateStep(
    build.steps[index],
    step,
    `Cloud Build step ${step.id}`,
  ));
  validateSourceProvenance(build.sourceProvenance, sourceReceipt);
  const builderDigest = profile.build.builder_image.split('@')[1];
  const stepImages = build.results?.buildStepImages;
  if (!plainObject(build.results)
    || !Array.isArray(stepImages) || stepImages.length !== expected.steps.length
    || stepImages[0] !== builderDigest
    || stepImages.slice(1).some((digest) => !['', builderDigest].includes(digest))
    || !Array.isArray(build.results.images) || build.results.images.length !== 1
    || build.results.images[0].name !== profile.image.tag_reference
    || !SHA256_DIGEST.test(build.results.images[0].digest ?? '')) {
    reject('Cloud Build result does not identify the exact builder and image digest');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-build-receipt/1',
    build_id: build.id,
    status: 'SUCCESS',
    source_generation: sourceReceipt.generation,
    source_sha256: sourceReceipt.sha256,
    builder_digest: builderDigest,
    image_tag_reference: profile.image.tag_reference,
    image_digest: build.results.images[0].digest,
    image_digest_reference:
      `${profile.image.repository}/${profile.image.name}@${build.results.images[0].digest}`,
    requested_verify_option: profile.build.requested_verify_option,
    source_provenance_hash: profile.build.source_provenance_hash,
  });
}

function validateDescriptor(value, description) {
  if (!plainObject(value) || !SHA256_DIGEST.test(value.digest ?? '')
    || !Number.isSafeInteger(value.size) || value.size < 1) {
    reject(`${description} descriptor is invalid`);
  }
  return value;
}

function header(response, name) {
  const value = response.headers?.get?.(name);
  return typeof value === 'string' ? value.split(';')[0].trim() : '';
}

export async function inspectPublishedRelayImage(
  session,
  buildReceipt,
  fetchImplementation = globalThis.fetch,
) {
  validSession(session);
  const profile = validateRelayImageProfile();
  if (!plainObject(buildReceipt)
    || buildReceipt.image_tag_reference !== profile.image.tag_reference
    || !SHA256_DIGEST.test(buildReceipt.image_digest ?? '')) {
    reject('Published relay image inspection requires the exact build receipt');
  }
  const imagePath = `${profile.project.project_id}/miakapp-control-plane/${profile.image.name}`;
  const manifestUrl = `https://${profile.project.region}-docker.pkg.dev/v2/${imagePath}`
    + `/manifests/${profile.image.tag}`;
  const manifestResponse = await googleRelayImageRequest(manifestUrl, session.accessToken, {
    accept: MANIFEST_TYPES.join(', '),
    description: 'Published relay image manifest',
    fetchImplementation,
    maximumResponseBytes: MAXIMUM_MANIFEST_BYTES,
  });
  const manifestDigest = header(manifestResponse, 'docker-content-digest');
  const contentType = header(manifestResponse, 'content-type');
  if (manifestDigest !== buildReceipt.image_digest || !MANIFEST_TYPES.includes(contentType)
    || sha256(manifestResponse.bytes) !== manifestDigest.slice('sha256:'.length)) {
    reject('Published relay image manifest digest or media type differs from Cloud Build');
  }
  const manifest = parseJson(manifestResponse.bytes, 'Published relay image manifest');
  if (!plainObject(manifest) || manifest.schemaVersion !== 2
    || manifest.mediaType !== contentType || !Array.isArray(manifest.layers)
    || manifest.layers.length === 0) {
    reject('Published relay image manifest is malformed');
  }
  const configDescriptor = validateDescriptor(manifest.config, 'Relay image config');
  const layers = manifest.layers.map((layer, index) => validateDescriptor(
    layer,
    `Relay image layer ${index}`,
  ));
  const compressedBytes = configDescriptor.size
    + layers.reduce((total, layer) => total + layer.size, 0);
  if (compressedBytes > profile.image.maximum_compressed_bytes) {
    reject('Published relay image exceeds the reviewed compressed-size boundary');
  }
  const configUrl = `https://${profile.project.region}-docker.pkg.dev/v2/${imagePath}`
    + `/blobs/${configDescriptor.digest}`;
  const configResponse = await googleRelayImageRequest(configUrl, session.accessToken, {
    accept: 'application/octet-stream',
    description: 'Published relay image config',
    fetchImplementation,
    maximumResponseBytes: MAXIMUM_CONFIG_BYTES,
    redirect: 'follow',
  });
  if (configResponse.bytes.byteLength !== configDescriptor.size
    || sha256(configResponse.bytes) !== configDescriptor.digest.slice('sha256:'.length)) {
    reject('Published relay image config differs from its immutable descriptor');
  }
  const image = parseJson(configResponse.bytes, 'Published relay image config');
  const imageConfig = image.config;
  if (!plainObject(image) || image.os !== profile.image.expected_os
    || image.architecture !== profile.image.expected_architecture
    || !plainObject(imageConfig)
    || imageConfig.User !== profile.image.expected_user
    || !isDeepStrictEqual(imageConfig.Entrypoint, profile.image.expected_entrypoint)
    || !isDeepStrictEqual(Object.keys(imageConfig.ExposedPorts ?? {}).sort(),
      [...profile.image.expected_exposed_ports].sort())
    || !isDeepStrictEqual(imageConfig.Labels, profile.image.labels)
    || (imageConfig.Env ?? []).some((entry) => /^MIAKAPP_/u.test(entry)
      || /-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u.test(entry))) {
    reject('Published relay image runtime config differs from the reviewed image boundary');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-publication/1',
    tag_reference: profile.image.tag_reference,
    digest: manifestDigest,
    digest_reference: `${profile.image.repository}/${profile.image.name}@${manifestDigest}`,
    manifest_media_type: contentType,
    manifest_sha256: manifestDigest.slice('sha256:'.length),
    config_digest: configDescriptor.digest,
    compressed_bytes: compressedBytes,
    layers: layers.length,
    os: image.os,
    architecture: image.architecture,
    user: imageConfig.User,
    entrypoint: Object.freeze([...imageConfig.Entrypoint]),
    exposed_ports: Object.freeze(Object.keys(imageConfig.ExposedPorts).sort()),
    labels: Object.freeze({ ...imageConfig.Labels }),
  });
}

export function buildRelayImageResult({
  repositoryCommit,
  metadataSha256,
  claimReceipt,
  sourceReceipt,
  operationName,
  buildReceipt,
  publication,
  observedAt,
}) {
  const profile = validateRelayImageProfile();
  if (!/^[0-9a-f]{40}$/u.test(repositoryCommit ?? '')
    || !/^[0-9a-f]{64}$/u.test(metadataSha256 ?? '')
    || !plainObject(claimReceipt) || !plainObject(sourceReceipt)
    || !plainObject(buildReceipt) || !plainObject(publication)
    || buildReceipt.image_digest !== publication.digest
    || sourceReceipt.sha256 !== profile.source.archive_sha256
    || !OPERATION_NAME.test(operationName ?? '')
    || typeof observedAt !== 'string' || new Date(Date.parse(observedAt)).toISOString() !== observedAt) {
    reject('Relay image result inputs are invalid');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-result/1',
    state: 'private_image_built_verified_not_deployed',
    project_id: profile.project.project_id,
    project_number: profile.project.project_number,
    region: profile.project.region,
    repository_commit: repositoryCommit,
    profile_sha256: RELAY_IMAGE_PROFILE_SHA256,
    metadata_sha256: metadataSha256,
    observed_at: observedAt,
    source: Object.freeze({
      repository: profile.source.repository,
      commit: profile.source.commit,
      tree: profile.source.tree,
      archive_sha256: sourceReceipt.sha256,
      archive_bytes: sourceReceipt.size_bytes,
      object_generation: sourceReceipt.generation,
    }),
    claim: Object.freeze({
      generation: claimReceipt.generation,
      sha256: claimReceipt.sha256,
      maximum_builds: 1,
      retry_authorized: false,
      deletion_authorized: false,
    }),
    build: Object.freeze({
      operation_name_sha256: sha256(Buffer.from(operationName, 'utf8')),
      id: buildReceipt.build_id,
      status: buildReceipt.status,
      builder_digest: buildReceipt.builder_digest,
      requested_verify_option: buildReceipt.requested_verify_option,
      source_provenance_hash: buildReceipt.source_provenance_hash,
    }),
    image: publication,
    effects: Object.freeze({
      cloud_run_services_created: 0,
      public_ingress_created: false,
      iam_bindings_created: 0,
      persistent_credentials_created: 0,
      container_scanning_enabled: false,
      stress_test_executed: false,
    }),
  });
}
