import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  OPERATOR_USER_SHA256,
  PROJECT_ID,
} from '../workload/contract.mjs';

export const OPERATOR_AUTHORITY_SOURCE_PROFILE_PATH =
  'browser-relay-operator-authority-source/profile.json';
export const OPERATOR_AUTHORITY_SOURCE_PROFILE_SHA256 =
  'e02dcdd241056f1ab7ffeea2019eff8f3fe7180c0d1affabd92f4bef8d05a29e';
export const OPERATOR_AUTHORITY_SOURCE_IMPLEMENTATION_BASE_COMMIT =
  '353a003a33c4f582eaaee13fedca83a63a85db03';
export const OPERATOR_AUTHORITY_SOURCE_USERINFO_URL =
  'https://openidconnect.googleapis.com/v1/userinfo';
export const OPERATOR_AUTHORITY_SOURCE_MAXIMUM_AUTHORITY_BYTES = 16 * 1024;
export const OPERATOR_AUTHORITY_SOURCE_MAXIMUM_COMMAND_OUTPUT_BYTES = 64 * 1024;
export const OPERATOR_AUTHORITY_SOURCE_MAXIMUM_RESPONSE_BYTES = 64 * 1024;
export const OPERATOR_AUTHORITY_SOURCE_MAXIMUM_RESULT_BYTES = 128 * 1024;
export const OPERATOR_AUTHORITY_SOURCE_COMMAND_TIMEOUT_MILLISECONDS = 30_000;
export const OPERATOR_AUTHORITY_SOURCE_REQUEST_TIMEOUT_MILLISECONDS = 30_000;
export const OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS = 25 * 60 * 1_000;

const expectedProfile = JSON.parse(readFileSync(new URL('profile.json', import.meta.url), 'utf8'));
const PROFILE_PATH = new URL('profile.json', import.meta.url);
const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_KEY = /^[a-z][a-z0-9_]{0,63}$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
]);
const FORBIDDEN_FIELDS = new Set([
  'access_token', 'authorization', 'credential', 'email', 'header', 'headers',
  'id_token', 'password', 'private_key', 'raw_request', 'raw_response',
  'refresh_token', 'secret', 'secret_value', 'token',
]);
const ERROR_CODES = new Set([
  'aborted', 'already_consumed', 'callback_failed', 'closed', 'command_failed',
  'invalid_configuration', 'invalid_principal', 'invalid_result',
  'invalid_token', 'principal_request_failed', 'window_expired',
]);

export class StagingBrowserRelayOperatorAuthoritySourceError extends Error {
  constructor(code = 'invalid_configuration') {
    if (!ERROR_CODES.has(code)) code = 'invalid_configuration';
    super(`Staging browser-relay operator authority source failed: ${code}`);
    this.name = 'StagingBrowserRelayOperatorAuthoritySourceError';
    this.code = code;
  }
}

export function rejectOperatorAuthoritySource(code) {
  throw new StagingBrowserRelayOperatorAuthoritySourceError(code);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  return value;
}

function exact(value, expected) {
  if (!isDeepStrictEqual(value, expected)) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function rejectPrivateMaterial(value, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > 2_048) rejectOperatorAuthoritySource('invalid_result');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) rejectOperatorAuthoritySource('invalid_result');
    return;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > 16 * 1024
      || PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      rejectOperatorAuthoritySource('invalid_result');
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 512) rejectOperatorAuthoritySource('invalid_result');
    value.forEach((entry) => rejectPrivateMaterial(entry, state));
    return;
  }
  if (!plainObject(value)) rejectOperatorAuthoritySource('invalid_result');
  for (const [key, entry] of Object.entries(value)) {
    if (!SAFE_KEY.test(key) || FORBIDDEN_FIELDS.has(key)) {
      rejectOperatorAuthoritySource('invalid_result');
    }
    rejectPrivateMaterial(entry, state);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function cloneOperatorAuthorityCallbackResult(value, authorityText = undefined) {
  rejectPrivateMaterial(value);
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    rejectOperatorAuthoritySource('invalid_result');
  }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') === 0
    || Buffer.byteLength(serialized, 'utf8') > OPERATOR_AUTHORITY_SOURCE_MAXIMUM_RESULT_BYTES
    || (typeof authorityText === 'string' && serialized.includes(authorityText))) {
    rejectOperatorAuthoritySource('invalid_result');
  }
  return deepFreeze(JSON.parse(serialized));
}

function validateProfileValue(profile) {
  exact(profile, expectedProfile);
  exactKeys(profile, [
    'schema', 'revision', 'state', 'target', 'pins', 'commands', 'bounds',
    'lifecycle', 'limitations', 'compatibility', 'authority', 'evidence',
  ]);
  exact(profile.schema, 'miakapp.staging-browser-relay-operator-authority-source-profile/1');
  exact(profile.revision, 1);
  exact(profile.target.project_id, PROJECT_ID);
  exact(profile.target.principal_endpoint, OPERATOR_AUTHORITY_SOURCE_USERINFO_URL);
  exact(profile.pins.operator_identity_sha256, OPERATOR_USER_SHA256);
  exact(profile.pins.authority_channel_maximum_bytes,
    OPERATOR_AUTHORITY_SOURCE_MAXIMUM_AUTHORITY_BYTES);
  exact(profile.bounds.maximum_command_output_bytes,
    OPERATOR_AUTHORITY_SOURCE_MAXIMUM_COMMAND_OUTPUT_BYTES);
  exact(profile.bounds.maximum_principal_response_bytes,
    OPERATOR_AUTHORITY_SOURCE_MAXIMUM_RESPONSE_BYTES);
  exact(profile.bounds.maximum_callback_result_bytes,
    OPERATOR_AUTHORITY_SOURCE_MAXIMUM_RESULT_BYTES);
  exact(profile.bounds.maximum_local_authority_window_seconds,
    OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS / 1_000);
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || !SHA256.test(profile.pins.operator_identity_sha256)
    || profile.authority.real_credential_acquisition_authorized_by_artifact !== false
    || profile.authority.external_network_authorized_by_artifact !== false
    || profile.authority.cloud_requests_authorized_by_artifact !== false
    || profile.authority.cloud_mutations_authorized_by_artifact !== false
    || profile.authority.hosting_publication_authorized_by_artifact !== false
    || profile.authority.live_execution_authorized_by_artifact !== false
    || profile.evidence.real_credentials_acquired !== 0
    || profile.evidence.live_principal_requests !== 0
    || profile.evidence.cloud_requests !== 0
    || profile.evidence.cloud_mutations !== 0
    || profile.evidence.hosting_publications !== 0
    || profile.evidence.live_execution_count !== 0
    || profile.evidence.incremental_cost_eur !== 0) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  return Object.freeze(profile);
}

export function validateBrowserRelayOperatorAuthoritySourceProfile(path = PROFILE_PATH) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size < 1 || entry.size > MAXIMUM_PROFILE_BYTES) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== OPERATOR_AUTHORITY_SOURCE_PROFILE_SHA256) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes.toString('utf8')) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  return validateProfileValue(value);
}
