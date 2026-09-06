import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { FIREBASE_APP_ID } from '../browser-app-check/contract.mjs';
import { DEPLOYED_SOURCE_SHA256 } from '../browser-relay-edge/runtime.mjs';
import {
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
  HOME_ID,
  validateBrowserRelayPageProfile,
} from '../browser-relay-page/contract.mjs';
import {
  FIXTURE_PROFILE_SHA256,
  FIXTURE_SOURCE_SHA256,
  MIAKAPI_COMMIT,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  validateBrowserRelayFixtureProfile,
} from '../browser-relay-fixture/contract.mjs';

export const FIXTURE_CLOUD_PROFILE_PATH = 'browser-relay-fixture-cloud/profile.json';
export const FIXTURE_CLOUD_PROFILE_SHA256 =
  '217f897541fc53b9077066ad0105826bf8130f5727ff9094903b58f7549b9deb';
export const FIXTURE_CLOUD_IMPLEMENTATION_BASE_COMMIT =
  '0ac4852d0fc8985bf9b69fc63cfe39d5cbdc6571';
export const FIXTURE_CLOUD_SOURCE_SHA256 =
  'cc99b6e4aef08fb47c56a1e9303a3e71945b085939c30ef67ff2f7849795ef0d';
export const FIXTURE_SIGNER_SERVICE_ACCOUNT =
  'miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com';

const profilePath = new URL('profile.json', import.meta.url);
const cloudSourcePath = new URL('cloud.mjs', import.meta.url);
const expectedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\bmhk1_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}\b/u,
]);
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'api_key',
  'authorization',
  'custom_token',
  'firebase_custom_token',
  'firebase_id_token',
  'home_key_value',
  'id_token',
  'private_key',
  'raw_request',
  'raw_response',
  'refresh_token',
  'request_headers',
  'response_headers',
  'secret_value',
  'token',
]);

export class StagingBrowserRelayFixtureCloudContractError extends Error {
  constructor(message = 'Staging browser-relay fixture cloud profile is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayFixtureCloudContractError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayFixtureCloudContractError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, path) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
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
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is a forbidden private field`);
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateProfileValue(value) {
  rejectPrivateMaterial(value);
  const profile = exactKeys(value, [
    'authority',
    'cleanup',
    'credential_boundary',
    'evidence',
    'pins',
    'request_budget',
    'revision',
    'schema',
    'state',
    'target',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-fixture-cloud-profile/1',
    'profile.schema');
  exact(profile.revision, 2, 'profile.revision');
  exact(profile.state, 'closed_google_firebase_adapter_implemented_not_wired_not_executed',
    'profile.state');

  exactKeys(profile.target, [
    'cloud_compute_resources',
    'data_policy',
    'firebase_app_id',
    'home_id',
    'project_id',
    'project_number',
    'region',
    'signer_service_account',
    'unscheduled',
  ], 'profile.target');
  exact(profile.target.project_id, PROJECT_ID, 'profile.target.project_id');
  exact(profile.target.project_number, PROJECT_NUMBER, 'profile.target.project_number');
  exact(profile.target.region, REGION, 'profile.target.region');
  exact(profile.target.firebase_app_id, FIREBASE_APP_ID, 'profile.target.firebase_app_id');
  exact(profile.target.home_id, HOME_ID, 'profile.target.home_id');
  exact(profile.target.signer_service_account, FIXTURE_SIGNER_SERVICE_ACCOUNT,
    'profile.target.signer_service_account');
  exact(profile.target.data_policy, 'synthetic_only', 'profile.target.data_policy');
  exact(profile.target.cloud_compute_resources, 0, 'profile.target.cloud_compute_resources');
  exact(profile.target.unscheduled, true, 'profile.target.unscheduled');

  exactKeys(profile.pins, [
    'browser_relay_fixture_profile_sha256',
    'browser_relay_fixture_source_sha256',
    'browser_relay_page_profile_sha256',
    'cloud_source_sha256',
    'deployed_control_plane_source_sha256',
    'implementation_base_commit',
    'miakapi_commit',
  ], 'profile.pins');
  for (const field of ['implementation_base_commit', 'miakapi_commit']) {
    if (!COMMIT.test(profile.pins[field])) reject(`profile.pins.${field} is invalid`);
  }
  for (const field of [
    'browser_relay_fixture_profile_sha256',
    'browser_relay_fixture_source_sha256',
    'browser_relay_page_profile_sha256',
    'cloud_source_sha256',
    'deployed_control_plane_source_sha256',
  ]) {
    if (!SHA256.test(profile.pins[field])) reject(`profile.pins.${field} is invalid`);
  }
  exact(profile.pins.implementation_base_commit, FIXTURE_CLOUD_IMPLEMENTATION_BASE_COMMIT,
    'profile.pins.implementation_base_commit');
  exact(profile.pins.browser_relay_fixture_profile_sha256, FIXTURE_PROFILE_SHA256,
    'profile.pins.browser_relay_fixture_profile_sha256');
  exact(profile.pins.browser_relay_fixture_source_sha256, FIXTURE_SOURCE_SHA256,
    'profile.pins.browser_relay_fixture_source_sha256');
  exact(profile.pins.browser_relay_page_profile_sha256, BROWSER_RELAY_PAGE_PROFILE_SHA256,
    'profile.pins.browser_relay_page_profile_sha256');
  exact(profile.pins.deployed_control_plane_source_sha256, DEPLOYED_SOURCE_SHA256,
    'profile.pins.deployed_control_plane_source_sha256');
  exact(profile.pins.miakapi_commit, MIAKAPI_COMMIT, 'profile.pins.miakapi_commit');
  exact(profile.pins.cloud_source_sha256, FIXTURE_CLOUD_SOURCE_SHA256,
    'profile.pins.cloud_source_sha256');

  exactKeys(profile.credential_boundary, [
    'ambient_credentials',
    'firebase_custom_tokens',
    'firebase_identity_token',
    'firebase_refresh_token',
    'firebase_web_api_key',
    'home_key',
    'operator_oauth_access_token',
    'persistent_credentials',
    'raw_responses_retained',
    'service_account_private_keys',
  ], 'profile.credential_boundary');
  exact(profile.credential_boundary.ambient_credentials, false,
    'profile.credential_boundary.ambient_credentials');
  exact(profile.credential_boundary.persistent_credentials, false,
    'profile.credential_boundary.persistent_credentials');
  exact(profile.credential_boundary.service_account_private_keys, 0,
    'profile.credential_boundary.service_account_private_keys');
  exact(profile.credential_boundary.raw_responses_retained, false,
    'profile.credential_boundary.raw_responses_retained');

  exactKeys(profile.request_budget, [
    'control_plane_home_creations',
    'control_plane_home_key_creations',
    'control_plane_relay_rotations',
    'explicit_injected_transport',
    'firebase_identity_creations',
    'firebase_identity_binding_reads',
    'firebase_identity_deletions',
    'firestore_cleanup_commits',
    'maximum_inventory_cycles',
    'maximum_response_bytes',
    'maximum_signed_firebase_jwts',
    'mutation_retries',
    'paid_stress_tests',
    'request_timeout_seconds',
  ], 'profile.request_budget');
  exact(profile.request_budget, {
    explicit_injected_transport: true,
    request_timeout_seconds: 30,
    maximum_response_bytes: 65_536,
    maximum_inventory_cycles: 8,
    maximum_signed_firebase_jwts: 4,
    firebase_identity_creations: 1,
    firebase_identity_binding_reads: 1,
    control_plane_home_creations: 1,
    control_plane_home_key_creations: 1,
    control_plane_relay_rotations: 1,
    firestore_cleanup_commits: 1,
    firebase_identity_deletions: 1,
    mutation_retries: 0,
    paid_stress_tests: 0,
  }, 'profile.request_budget');

  exactKeys(profile.cleanup, [
    'coordinator_stop_required_before_data_cleanup',
    'final_absence_independently_observed',
    'firebase_identity_deleted_after_firestore',
    'firestore_delete_is_atomic',
    'firestore_update_time_preconditions',
    'fixed_schema_and_ownership_validation',
    'home_key_registry_must_be_complete',
    'home_ownership_cluster_must_be_complete',
    'initial_absence_required_before_mutation',
    'unknown_cleanup_outcome_is_observed_without_retry',
  ], 'profile.cleanup');
  if (Object.values(profile.cleanup).some((entry) => entry !== true)) {
    reject('profile.cleanup must retain every reviewed cleanup guarantee');
  }

  exactKeys(profile.authority, [
    'cloud_mutation_authorized_by_artifact',
    'hosting_publication_authorized',
    'iam_binding_mutation_authorized',
    'live_execution_authorized',
    'public_ingress_authorized',
  ], 'profile.authority');
  if (Object.values(profile.authority).some((entry) => entry !== false)) {
    reject('profile.authority must remain closed');
  }

  exactKeys(profile.evidence, [
    'credentials_committed',
    'live_cleanup_executions',
    'live_fixture_creations',
    'live_http_requests',
    'raw_cloud_responses_committed',
    'state',
  ], 'profile.evidence');
  exact(profile.evidence, {
    state: 'absent',
    live_http_requests: 0,
    live_fixture_creations: 0,
    live_cleanup_executions: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayFixtureCloudProfile() {
  validateBrowserRelayFixtureProfile();
  validateBrowserRelayPageProfile();
  if (lstatSync(profilePath).isSymbolicLink() || lstatSync(cloudSourcePath).isSymbolicLink()) {
    reject('Fixture cloud profile and source must be regular pinned files');
  }
  const profileBytes = readFileSync(profilePath);
  if (profileBytes.byteLength === 0 || profileBytes.byteLength > MAXIMUM_PROFILE_BYTES
    || sha256(profileBytes) !== FIXTURE_CLOUD_PROFILE_SHA256) {
    reject('Fixture cloud profile bytes differ from the reviewed artifact');
  }
  if (sha256(readFileSync(cloudSourcePath)) !== FIXTURE_CLOUD_SOURCE_SHA256) {
    reject('Fixture cloud source bytes differ from the reviewed artifact');
  }
  let value;
  try {
    value = JSON.parse(profileBytes.toString('utf8'));
  } catch {
    return reject('Fixture cloud profile is not valid JSON');
  }
  return validateProfileValue(value);
}
