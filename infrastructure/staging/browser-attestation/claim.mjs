import {
  CLAIM_OBJECT,
  HOSTING_SITE,
  PROJECT_ID,
  PROJECT_NUMBER,
  STATE_BUCKET,
  canonicalJson,
  sha256,
} from './contract.mjs';
import { googleJsonRequest } from './inventory.mjs';

export function buildOperationClaim(metadataBytes, metadata) {
  if (!Buffer.isBuffer(metadataBytes) || metadataBytes.byteLength === 0) {
    throw new Error('Browser-attestation claim requires exact metadata bytes');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-attestation-claim/3',
    operation: 'attest-browser-app-check-and-disable-hosting-v3',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    hosting_site: HOSTING_SITE,
    repository_commit: metadata.repository_commit,
    metadata_sha256: sha256(metadataBytes),
    baseline_sha256: metadata.baseline_sha256,
    created_at: metadata.created_at,
    expires_at: metadata.expires_at,
    maximum_attestation_attempts: 1,
    retry_authorized: false,
    deletion_authorized: false,
  });
}

export async function createOperationClaim(session, metadataBytes, metadata, fetchImplementation) {
  const claim = buildOperationClaim(metadataBytes, metadata);
  const bytes = Buffer.from(canonicalJson(claim), 'utf8');
  const response = await googleJsonRequest(
    `https://storage.googleapis.com/upload/storage/v1/b/${STATE_BUCKET}/o?uploadType=media&name=${encodeURIComponent(CLAIM_OBJECT)}&ifGenerationMatch=0`,
    session.accessToken,
    {
      method: 'POST',
      body: bytes,
      contentType: 'application/json; charset=utf-8',
      description: 'Browser-attestation atomic operation claim creation',
      fetchImplementation,
    },
  );
  const value = response.value;
  if (value?.bucket !== STATE_BUCKET
    || value?.name !== CLAIM_OBJECT
    || !/^[1-9][0-9]*$/u.test(value?.generation ?? '')
    || value?.size !== String(bytes.byteLength)) {
    throw new Error('Browser-attestation operation claim response is malformed');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-attestation-claim-receipt/3',
    bucket: STATE_BUCKET,
    object: CLAIM_OBJECT,
    generation: value.generation,
    size_bytes: bytes.byteLength,
    sha256: sha256(bytes),
    repository_commit: metadata.repository_commit,
    metadata_sha256: sha256(metadataBytes),
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}
