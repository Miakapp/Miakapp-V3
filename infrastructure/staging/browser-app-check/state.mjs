import { isDeepStrictEqual } from 'node:util';

import {
  INITIAL_TERRAFORM_STATE,
  PROJECT_ID,
  TERRAFORM_VERSION,
  sha256,
} from './contract.mjs';

const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
const STATE_LINEAGE = '8193b94a-1d8f-4143-a878-29342f91c0e2';
const MAXIMUM_STATE_BYTES = 1024 * 1024;

function reject(message) {
  throw new Error(message);
}

async function storageRequest(url, accessToken, description) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Goog-User-Project': PROJECT_ID,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return reject(`${description} request failed`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200 || bytes.byteLength === 0
    || bytes.byteLength > MAXIMUM_STATE_BYTES) {
    reject(`${description} returned an unexpected response`);
  }
  return bytes;
}

export function validateInitialBrowserAppCheckState(metadata, bytes) {
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== 'object'
    || metadata.bucket !== STATE_BUCKET
    || metadata.name !== INITIAL_TERRAFORM_STATE.object
    || metadata.generation !== INITIAL_TERRAFORM_STATE.generation
    || metadata.size !== String(INITIAL_TERRAFORM_STATE.size_bytes)
    || !Buffer.isBuffer(bytes)
    || bytes.byteLength !== INITIAL_TERRAFORM_STATE.size_bytes
    || sha256(bytes) !== INITIAL_TERRAFORM_STATE.sha256) {
    reject('Browser App Check initial backend object does not match the reviewed generation');
  }
  let state;
  try {
    state = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check initial backend state is invalid JSON');
  }
  if (!isDeepStrictEqual(state, {
    version: 4,
    terraform_version: TERRAFORM_VERSION,
    serial: 1,
    lineage: STATE_LINEAGE,
    outputs: {},
    resources: [],
    check_results: null,
  })) {
    reject('Browser App Check initial backend state is not the reviewed canonical empty state');
  }
  return INITIAL_TERRAFORM_STATE;
}

export async function observeInitialBrowserAppCheckState(session) {
  if (session === null || Array.isArray(session) || typeof session !== 'object'
    || typeof session.accessToken !== 'string') {
    reject('Browser App Check state inventory requires a verified operator session');
  }
  const encodedObject = encodeURIComponent(INITIAL_TERRAFORM_STATE.object);
  const baseUrl = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodedObject}`;
  const [metadataBytes, stateBytes] = await Promise.all([
    storageRequest(baseUrl, session.accessToken, 'Browser App Check state metadata'),
    storageRequest(`${baseUrl}?alt=media`, session.accessToken, 'Browser App Check state content'),
  ]);
  let metadata;
  try {
    metadata = JSON.parse(metadataBytes.toString('utf8'));
  } catch {
    return reject('Browser App Check state metadata is invalid JSON');
  }
  return validateInitialBrowserAppCheckState(metadata, stateBytes);
}
