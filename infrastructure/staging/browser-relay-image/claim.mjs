import { isDeepStrictEqual } from 'node:util';

import {
  RELAY_IMAGE_PROFILE_SHA256,
  canonicalJson,
  sha256,
  validateRelayImageProfile,
} from './contract.mjs';
import { googleRelayImageRequest } from './inventory.mjs';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function timestamp(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)
    || new Date(Date.parse(value)).toISOString() !== value) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  return Date.parse(value);
}

export function buildRelayImageClaim(metadataBytes, metadata, attemptedAt) {
  const profile = validateRelayImageProfile();
  if (!Buffer.isBuffer(metadataBytes) || metadataBytes.byteLength === 0
    || !plainObject(metadata)
    || metadata.schema !== 'miakapp.staging-browser-relay-image-plan/2'
    || metadata.project_id !== profile.project.project_id
    || metadata.profile_sha256 !== RELAY_IMAGE_PROFILE_SHA256
    || !/^[0-9a-f]{40}$/u.test(metadata.repository_commit ?? '')
    || !/^[0-9a-f]{64}$/u.test(metadata.baseline_sha256 ?? '')) {
    reject('Relay image operation claim inputs are invalid');
  }
  const attempted = timestamp(attemptedAt, 'attempted_at');
  const created = timestamp(metadata.created_at, 'metadata.created_at');
  const expires = timestamp(metadata.expires_at, 'metadata.expires_at');
  if (attempted < created || attempted > expires) {
    reject('Relay image operation claim is outside the saved-plan validity window');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-claim/2',
    operation: 'recover-private-browser-relay-image-verification',
    bucket: profile.operation.claim_bucket,
    object: profile.operation.claim_object,
    project_id: profile.project.project_id,
    repository_commit: metadata.repository_commit,
    metadata_sha256: sha256(metadataBytes),
    profile_sha256: RELAY_IMAGE_PROFILE_SHA256,
    baseline_sha256: metadata.baseline_sha256,
    source_archive_sha256: profile.source.archive_sha256,
    source_object_generation: profile.source.object_generation,
    v1_result_sha256: profile.contracts.v1_result_sha256,
    image_tag_reference: profile.image.tag_reference,
    attempted_at: attemptedAt,
    expires_at: metadata.expires_at,
    maximum_builds: 1,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export function validateRelayImageClaim(value, metadataBytes, metadata) {
  if (!plainObject(value)) reject('Relay image operation claim is invalid');
  const expected = buildRelayImageClaim(metadataBytes, metadata, value.attempted_at);
  if (!isDeepStrictEqual(value, expected)) {
    reject('Relay image operation claim differs from the exact reviewed attempt');
  }
  return Object.freeze(value);
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Relay image operation claim creation returned invalid JSON');
  }
}

export async function createRelayImageClaim(
  session,
  metadataBytes,
  metadata,
  attemptedAt,
  fetchImplementation = globalThis.fetch,
) {
  const profile = validateRelayImageProfile();
  const claim = buildRelayImageClaim(metadataBytes, metadata, attemptedAt);
  const bytes = Buffer.from(canonicalJson(claim), 'utf8');
  const url = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${profile.operation.claim_bucket}/o`,
  );
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', profile.operation.claim_object);
  url.searchParams.set('ifGenerationMatch', '0');
  url.searchParams.set('fields', 'bucket,name,generation,size');
  const response = await googleRelayImageRequest(url, session.accessToken, {
    method: 'POST',
    body: bytes,
    contentType: 'application/json; charset=utf-8',
    description: 'Relay image atomic operation claim creation',
    fetchImplementation,
    maximumResponseBytes: 64 * 1024,
  });
  const value = parseJson(response.bytes);
  if (!plainObject(value) || value.bucket !== profile.operation.claim_bucket
    || value.name !== profile.operation.claim_object
    || !/^[1-9][0-9]*$/u.test(value.generation ?? '')
    || value.size !== String(bytes.byteLength)) {
    reject('Relay image operation claim response is malformed');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-image-claim-receipt/2',
    bucket: profile.operation.claim_bucket,
    object: profile.operation.claim_object,
    generation: value.generation,
    size_bytes: bytes.byteLength,
    sha256: sha256(bytes),
    attempted_at: attemptedAt,
    retry_authorized: false,
    deletion_authorized: false,
  });
}
