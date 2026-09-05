import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  sha256,
  validateRelayImageProfile,
} from './contract.mjs';
import { validateRelayServicesProfile } from '../browser-relay-services/contract.mjs';
import { observeDeployedWorkload } from '../workload/inventory.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_OBJECT_BYTES = 1024 * 1024;
const GENERATION = /^[1-9][0-9]*$/u;
const BUILD_ID = /^[0-9a-f-]{16,64}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
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

function validateSession(session) {
  if (!plainObject(session) || typeof session.accessToken !== 'string'
    || session.accessToken.length < 20 || /\s/u.test(session.accessToken)) {
    reject('Relay image inventory requires a verified operator session');
  }
  return session;
}

async function responseBytes(response, description, maximumBytes = MAXIMUM_RESPONSE_BYTES) {
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    return reject(`${description} response could not be read`);
  }
  if (bytes.byteLength > maximumBytes) reject(`${description} response is too large`);
  return bytes;
}

export async function googleRelayImageRequest(url, accessToken, options = {}) {
  if (typeof accessToken !== 'string' || accessToken.length < 20 || /\s/u.test(accessToken)) {
    reject('Relay image Google request requires a valid short-lived token');
  }
  let response;
  if (![undefined, 'error', 'follow'].includes(options.redirect)) {
    reject('Relay image Google request redirect policy is invalid');
  }
  try {
    response = await (options.fetchImplementation ?? fetch)(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: options.accept ?? 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Goog-User-Project': validateRelayImageProfile().project.project_id,
        ...(options.body === undefined ? {} : {
          'Content-Type': options.contentType ?? 'application/json; charset=utf-8',
        }),
        ...(options.headers ?? {}),
      },
      body: options.body,
      redirect: options.redirect ?? 'error',
      signal: AbortSignal.timeout(options.timeoutMilliseconds ?? 30_000),
    });
  } catch {
    return reject(`${options.description ?? 'Relay image Google'} request outcome is unknown`);
  }
  const description = options.description ?? 'Relay image Google';
  const bytes = await responseBytes(
    response,
    description,
    options.maximumResponseBytes ?? MAXIMUM_RESPONSE_BYTES,
  );
  const acceptedStatuses = options.acceptedStatuses ?? [200];
  if (!acceptedStatuses.includes(response.status)) {
    reject(`${description} returned an unexpected response`);
  }
  return Object.freeze({ status: response.status, bytes, headers: response.headers });
}

function parseJson(bytes, description, allowEmpty = false) {
  if (!Buffer.isBuffer(bytes) || (!allowEmpty && bytes.byteLength === 0)) {
    reject(`${description} returned an empty response`);
  }
  if (bytes.byteLength === 0) return {};
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
}

async function jsonRequest(url, session, options = {}) {
  const response = await googleRelayImageRequest(url, session.accessToken, options);
  return Object.freeze({
    ...response,
    value: parseJson(response.bytes, options.description ?? 'Relay image Google', true),
  });
}

function storageMetadataUrl(bucket, object, generation) {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`,
  );
  if (generation !== undefined) url.searchParams.set('generation', generation);
  url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

function absentObject(bucket, object) {
  return Object.freeze({ state: 'absent', bucket, object });
}

export async function observeRelayImageObject(
  session,
  bucket,
  object,
  fetchImplementation = globalThis.fetch,
) {
  validateSession(session);
  const metadata = await jsonRequest(storageMetadataUrl(bucket, object), session, {
    acceptedStatuses: [200, 404],
    description: `Relay image object ${object} metadata`,
    fetchImplementation,
    maximumResponseBytes: 64 * 1024,
  });
  if (metadata.status === 404) return absentObject(bucket, object);
  const value = metadata.value;
  const size = Number(value.size);
  if (!plainObject(value) || value.bucket !== bucket || value.name !== object
    || !GENERATION.test(value.generation ?? '') || !Number.isSafeInteger(size)
    || size < 1 || size > MAXIMUM_OBJECT_BYTES || String(size) !== value.size) {
    reject(`Relay image object ${object} metadata is malformed`);
  }
  const mediaUrl = storageMetadataUrl(bucket, object, value.generation);
  mediaUrl.searchParams.delete('fields');
  mediaUrl.searchParams.set('alt', 'media');
  const media = await googleRelayImageRequest(mediaUrl, session.accessToken, {
    acceptedStatuses: [200],
    description: `Relay image object ${object} bytes`,
    fetchImplementation,
    maximumResponseBytes: MAXIMUM_OBJECT_BYTES,
  });
  if (media.bytes.byteLength !== size) reject(`Relay image object ${object} size changed`);
  return Object.freeze({
    state: 'present',
    bucket,
    object,
    generation: value.generation,
    size_bytes: size,
    sha256: sha256(media.bytes),
  });
}

async function observeCloudRunServices(session, fetchImplementation) {
  const profile = validateRelayImageProfile();
  const url = new URL(
    `https://run.googleapis.com/v2/projects/${profile.project.project_id}/locations/${profile.project.region}/services`,
  );
  url.searchParams.set('pageSize', '100');
  const { value } = await jsonRequest(url, session, {
    description: 'Cloud Run service inventory',
    fetchImplementation,
  });
  if (!plainObject(value) || (value.services !== undefined && !Array.isArray(value.services))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')
    || (value.unreachable !== undefined && value.unreachable.length !== 0)) {
    reject('Cloud Run service inventory is malformed or incomplete');
  }
  const prefix = `projects/${profile.project.project_id}/locations/${profile.project.region}/services/`;
  const services = (value.services ?? []).map((service) => {
    if (!plainObject(service) || typeof service.name !== 'string'
      || !service.name.startsWith(prefix) || service.name.slice(prefix.length).includes('/')) {
      reject('Cloud Run service inventory contains a foreign service');
    }
    return service.name.slice(prefix.length);
  }).sort();
  if (new Set(services).size !== services.length) reject('Cloud Run service inventory is duplicated');
  return Object.freeze(services);
}

async function observeRelayPackage(session, fetchImplementation) {
  const profile = validateRelayImageProfile();
  const name = `projects/${profile.project.project_id}/locations/${profile.project.region}`
    + `/repositories/miakapp-control-plane/packages/${profile.image.name}`;
  const response = await jsonRequest(
    `https://artifactregistry.googleapis.com/v1/${name}`,
    session,
    {
      acceptedStatuses: [200, 404],
      description: 'Relay image Artifact Registry package inventory',
      fetchImplementation,
    },
  );
  if (response.status === 404) return Object.freeze({ state: 'absent', name });
  if (!plainObject(response.value) || response.value.name !== name) {
    reject('Relay image Artifact Registry package inventory is malformed');
  }
  return Object.freeze({ state: 'present', name });
}

async function observeRelayImageTag(session, fetchImplementation) {
  const profile = validateRelayImageProfile();
  const imagePath = `${profile.project.project_id}/miakapp-control-plane/${profile.image.name}`;
  const url = `https://${profile.project.region}-docker.pkg.dev/v2/${imagePath}`
    + `/manifests/${profile.image.tag}`;
  const response = await googleRelayImageRequest(url, session.accessToken, {
    accept: MANIFEST_TYPES.join(', '),
    acceptedStatuses: [200, 404],
    description: 'Relay image v2 tag inventory',
    fetchImplementation,
    maximumResponseBytes: MAXIMUM_OBJECT_BYTES,
  });
  if (response.status === 404) {
    return Object.freeze({ state: 'absent', tag_reference: profile.image.tag_reference });
  }
  const digest = response.headers?.get?.('docker-content-digest')?.split(';')[0].trim();
  const contentType = response.headers?.get?.('content-type')?.split(';')[0].trim();
  if (!SHA256_DIGEST.test(digest ?? '') || !MANIFEST_TYPES.includes(contentType ?? '')
    || sha256(response.bytes) !== digest.slice('sha256:'.length)) {
    reject('Relay image v2 tag inventory is malformed');
  }
  return Object.freeze({
    state: 'present',
    tag_reference: profile.image.tag_reference,
    digest,
  });
}

async function observeServiceState(session, service, fetchImplementation) {
  const profile = validateRelayImageProfile();
  const name = `projects/${profile.project.project_number}/services/${service}`;
  const { value } = await jsonRequest(
    `https://serviceusage.googleapis.com/v1/${name}`,
    session,
    {
      description: `Relay image prerequisite ${service}`,
      fetchImplementation,
    },
  );
  if (!plainObject(value) || value.name !== name || value.config?.name !== service
    || !['ENABLED', 'DISABLED'].includes(value.state)) {
    reject(`Relay image prerequisite ${service} inventory is malformed`);
  }
  return Object.freeze({ service, state: value.state });
}

async function observeMatchingBuilds(session, buildTag, fetchImplementation) {
  const profile = validateRelayImageProfile();
  const url = new URL(
    `https://cloudbuild.googleapis.com/v1/projects/${profile.project.project_id}`
      + `/locations/${profile.project.region}/builds`,
  );
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('filter', `tags=${buildTag}`);
  const { value } = await jsonRequest(url, session, {
    description: 'Relay image Cloud Build inventory',
    fetchImplementation,
  });
  if (!plainObject(value) || (value.builds !== undefined && !Array.isArray(value.builds))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')) {
    reject('Relay image Cloud Build inventory is malformed or incomplete');
  }
  const builds = (value.builds ?? []).map((build) => {
    if (!plainObject(build) || !BUILD_ID.test(build.id ?? '')
      || build.projectId !== profile.project.project_id
      || !Array.isArray(build.tags) || !build.tags.includes(buildTag)
      || typeof build.status !== 'string') {
      reject('Relay image Cloud Build inventory contains a malformed build');
    }
    return Object.freeze({ id: build.id, status: build.status });
  }).sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze(builds);
}

export async function observeRelayImageInventory(session, options = {}) {
  validateSession(session);
  const profile = validateRelayImageProfile();
  const relayProfile = validateRelayServicesProfile(
    fileURLToPath(new URL('../browser-relay-services/profile.json', import.meta.url)),
  );
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const workloadObserver = options.observeWorkload ?? observeDeployedWorkload;
  const objectObserver = options.observeObject ?? observeRelayImageObject;
  if (typeof objectObserver !== 'function') reject('Relay image object observer is invalid');
  const workload = workloadObserver({
    repositoryRoot,
    repositoryCommit: relayProfile.pins.deployed_control_plane_commit,
    sourceArchiveSha256: relayProfile.pins.deployed_control_plane_source_sha256,
    observedAt: '1970-01-01T00:00:00.000Z',
    ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
  });
  const [
    cloudRunServices,
    relayPackage,
    imageTag,
    sourceObject,
    priorOperationClaim,
    operationClaim,
    priorMatchingBuilds,
    matchingBuilds,
    containerAnalysisApi,
    containerScanningApi,
  ] =
    await Promise.all([
      observeCloudRunServices(session, fetchImplementation),
      observeRelayPackage(session, fetchImplementation),
      observeRelayImageTag(session, fetchImplementation),
      objectObserver(
        session,
        profile.source.source_bucket,
        profile.source.source_object,
        fetchImplementation,
      ),
      objectObserver(
        session,
        profile.operation.claim_bucket,
        profile.recovery.v1_claim_object,
        fetchImplementation,
      ),
      objectObserver(
        session,
        profile.operation.claim_bucket,
        profile.operation.claim_object,
        fetchImplementation,
      ),
      observeMatchingBuilds(session, 'miakapp-relay-image-v1', fetchImplementation),
      observeMatchingBuilds(session, profile.build.build_tag, fetchImplementation),
      observeServiceState(
        session,
        profile.prerequisites.container_analysis_api,
        fetchImplementation,
      ),
      observeServiceState(
        session,
        profile.prerequisites.container_scanning_api,
        fetchImplementation,
      ),
    ]);
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-inventory/2',
    project_id: profile.project.project_id,
    project_number: profile.project.project_number,
    region: profile.project.region,
    deployed_workload: workload,
    cloud_run_services: cloudRunServices,
    relay_package: relayPackage,
    image_tag: imageTag,
    source_object: sourceObject,
    prior_operation_claim: priorOperationClaim,
    operation_claim: operationClaim,
    prior_matching_builds: priorMatchingBuilds,
    matching_builds: matchingBuilds,
    container_analysis_api: containerAnalysisApi,
    container_scanning_api: containerScanningApi,
  });
}

export function validateRelayImageBaseline(value) {
  const profile = validateRelayImageProfile();
  if (!plainObject(value)
    || value.schema !== 'miakapp.staging-browser-relay-image-inventory/2'
    || value.project_id !== profile.project.project_id
    || value.project_number !== profile.project.project_number
    || value.region !== profile.project.region
    || !plainObject(value.deployed_workload)
    || !isDeepStrictEqual(value.cloud_run_services, ['control-plane'])
    || !isDeepStrictEqual(value.relay_package, {
      state: 'present',
      name: `projects/${profile.project.project_id}/locations/${profile.project.region}`
        + `/repositories/miakapp-control-plane/packages/${profile.image.name}`,
    })
    || !isDeepStrictEqual(value.image_tag, {
      state: 'absent',
      tag_reference: profile.image.tag_reference,
    })
    || !isDeepStrictEqual(value.source_object, {
      state: 'present',
      bucket: profile.source.source_bucket,
      object: profile.source.source_object,
      generation: profile.source.object_generation,
      size_bytes: profile.source.archive_bytes,
      sha256: profile.source.archive_sha256,
    })
    || !isDeepStrictEqual(value.prior_operation_claim, {
      state: 'present',
      bucket: profile.operation.claim_bucket,
      object: profile.recovery.v1_claim_object,
      generation: profile.recovery.v1_claim_generation,
      size_bytes: 1030,
      sha256: profile.recovery.v1_claim_sha256,
    })
    || !isDeepStrictEqual(value.operation_claim, absentObject(
      profile.operation.claim_bucket,
      profile.operation.claim_object,
    ))
    || !isDeepStrictEqual(value.prior_matching_builds, [{
      id: profile.recovery.v1_build_id,
      status: profile.recovery.v1_build_status,
    }])
    || !isDeepStrictEqual(value.container_analysis_api, {
      service: profile.prerequisites.container_analysis_api,
      state: 'ENABLED',
    })
    || !isDeepStrictEqual(value.container_scanning_api, {
      service: profile.prerequisites.container_scanning_api,
      state: 'DISABLED',
    })
    || !isDeepStrictEqual(value.matching_builds, [])) {
    reject('Relay image baseline differs from the reviewed v2 recovery state');
  }
  return Object.freeze(value);
}

export function sameRelayImageBaseline(left, right) {
  validateRelayImageBaseline(left);
  validateRelayImageBaseline(right);
  return isDeepStrictEqual(left, right);
}

export function relayImageSourceReceipt(value) {
  const profile = validateRelayImageProfile();
  const baseline = validateRelayImageBaseline(value);
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-source-receipt/2',
    bucket: baseline.source_object.bucket,
    object: baseline.source_object.object,
    generation: baseline.source_object.generation,
    size_bytes: baseline.source_object.size_bytes,
    sha256: baseline.source_object.sha256,
    source_reused: true,
    upload_authorized: false,
    deletion_authorized: false,
    object_generation: profile.source.object_generation,
  });
}

function validateExpectedObject(actual, expected, description) {
  if (!plainObject(expected) || actual.state !== 'present'
    || actual.bucket !== expected.bucket || actual.object !== expected.object
    || actual.generation !== expected.generation
    || actual.size_bytes !== expected.size_bytes || actual.sha256 !== expected.sha256) {
    reject(`${description} differs from the exact created object`);
  }
}

export function normalizePreparedRelayImageInventory(inventory, expected = {}) {
  const profile = validateRelayImageProfile();
  const normalized = structuredClone(inventory);
  if (expected.claim !== undefined) {
    validateExpectedObject(inventory.operation_claim, expected.claim, 'Relay image operation claim');
    normalized.operation_claim = absentObject(
      profile.operation.claim_bucket,
      profile.operation.claim_object,
    );
  }
  if (expected.source !== undefined) {
    validateExpectedObject(inventory.source_object, expected.source, 'Relay image source object');
  }
  return Object.freeze(normalized);
}

export function validateFinalRelayImageInventory(inventory, baseline, expected) {
  const profile = validateRelayImageProfile();
  if (!plainObject(expected) || !plainObject(expected.claim) || !plainObject(expected.source)
    || !plainObject(expected.build)
    || expected.build.status !== 'SUCCESS'
    || !isDeepStrictEqual(inventory.relay_package, {
      state: 'present',
      name: `projects/${profile.project.project_id}/locations/${profile.project.region}`
        + `/repositories/miakapp-control-plane/packages/${profile.image.name}`,
    })
    || !isDeepStrictEqual(inventory.matching_builds, [{
      id: expected.build.build_id,
      status: 'SUCCESS',
    }])
    || !isDeepStrictEqual(inventory.image_tag, {
      state: 'present',
      tag_reference: profile.image.tag_reference,
      digest: expected.build.image_digest,
    })) {
    reject('Final relay image package or build inventory differs from the unique operation');
  }
  const normalized = structuredClone(normalizePreparedRelayImageInventory(inventory, {
    claim: expected.claim,
    source: expected.source,
  }));
  normalized.relay_package = structuredClone(baseline.relay_package);
  normalized.image_tag = structuredClone(baseline.image_tag);
  normalized.matching_builds = [];
  if (!sameRelayImageBaseline(normalized, baseline)) {
    reject('Unrelated staging state changed during the relay image build');
  }
  return Object.freeze(inventory);
}

export function relayImageBaselineSha256(value) {
  validateRelayImageBaseline(value);
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}
