import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { FIREBASE_APP_ID } from '../browser-app-check/contract.mjs';
import {
  FIXTURE_CLOUD_PROFILE_SHA256,
  FIXTURE_CLOUD_SOURCE_SHA256,
  FIXTURE_SIGNER_SERVICE_ACCOUNT,
  validateBrowserRelayFixtureCloudProfile,
} from '../browser-relay-fixture-cloud/contract.mjs';
import {
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
} from '../browser-relay-fixture/contract.mjs';
import {
  REPLACEMENT_SYNTHETIC_UID,
  SCENARIO_FIXTURE_PROFILE_SHA256,
  SCENARIO_FIXTURE_SOURCE_SHA256,
  validateBrowserRelayScenarioFixtureProfile,
} from '../browser-relay-scenario-fixture/contract.mjs';

export const SCENARIO_FIXTURE_CLOUD_PROFILE_PATH =
  'browser-relay-scenario-fixture-cloud/profile.json';
export const SCENARIO_FIXTURE_CLOUD_PROFILE_SHA256 =
  '8d7eda17657d30734dc81c5dc4fa33c77bd0a06405e4baa183f9e49d34c5a689';
export const SCENARIO_FIXTURE_CLOUD_IMPLEMENTATION_BASE_COMMIT =
  'c28f6ae3f12f09ed9078fd167e25eaeaadd770b6';
export const SCENARIO_FIXTURE_CLOUD_SOURCE_SHA256 =
  'a4da72dcd1e4b245b79325655e603b9ccb8937ca868c824f640ecc188dade97d';
export const SCENARIO_FIXTURE_CLOUD_MAXIMUM_INVENTORY_CYCLES = 6;
export const SCENARIO_FIXTURE_CLOUD_MAXIMUM_SIGNED_JWTS = 2;

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
]);
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'authorization',
  'custom_token',
  'firebase_custom_token',
  'firebase_id_token',
  'id_token',
  'password',
  'private_key',
  'raw_request',
  'raw_response',
  'refresh_token',
  'request_headers',
  'response_headers',
  'secret_value',
  'token',
]);

export class StagingBrowserRelayScenarioFixtureCloudError extends Error {
  constructor(message = 'Staging browser-relay scenario fixture cloud adapter is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayScenarioFixtureCloudError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayScenarioFixtureCloudError(message);
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

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function rejectScenarioFixtureCloudPrivateMaterial(value, path = 'output') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains private material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectScenarioFixtureCloudPrivateMaterial(
      entry,
      `${path}[${index}]`,
    ));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is forbidden`);
      rejectScenarioFixtureCloudPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function regularPinnedFile(path, maximumBytes, expectedSha256, description) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || sha256(readFileSync(path)) !== expectedSha256) {
    reject(`${description} differs from the reviewed regular file`);
  }
}

function validateProfileValue(value) {
  rejectScenarioFixtureCloudPrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'credential_boundary',
    'request_budget',
    'cleanup',
    'compatibility',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema,
    'miakapp.staging-browser-relay-scenario-fixture-cloud-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_replacement_identity_google_firebase_adapter_implemented_not_wired_not_executed',
    'profile.state',
  );
  exact(profile.target, {
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    firebase_app_id: FIREBASE_APP_ID,
    replacement_synthetic_uid: REPLACEMENT_SYNTHETIC_UID,
    signer_service_account: FIXTURE_SIGNER_SERVICE_ACCOUNT,
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  }, 'profile.target');
  exact(profile.pins, {
    implementation_base_commit: SCENARIO_FIXTURE_CLOUD_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_fixture_cloud_profile_sha256: FIXTURE_CLOUD_PROFILE_SHA256,
    browser_relay_fixture_cloud_source_sha256: FIXTURE_CLOUD_SOURCE_SHA256,
    browser_relay_scenario_fixture_profile_sha256: SCENARIO_FIXTURE_PROFILE_SHA256,
    browser_relay_scenario_fixture_source_sha256: SCENARIO_FIXTURE_SOURCE_SHA256,
    cloud_source_sha256: SCENARIO_FIXTURE_CLOUD_SOURCE_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) {
    reject('profile.pins contains an invalid immutable identifier');
  }
  exact(profile.credential_boundary, {
    operator_oauth_access_token: 'injected_ephemeral_memory_only',
    firebase_web_api_key: 'fetched_once_memory_only',
    replacement_identity_bootstrap: 'custom_token_exchanged_then_discarded',
    replacement_page_custom_token: 'returned_once_to_closed_scenario_controller',
    firebase_refresh_token: 'validated_then_discarded',
    service_account_private_keys: 0,
    ambient_credentials: false,
    persistent_credentials: false,
    raw_responses_retained: false,
  }, 'profile.credential_boundary');
  exact(profile.request_budget, {
    explicit_injected_transport: true,
    request_timeout_seconds: 30,
    maximum_response_bytes: 65_536,
    maximum_inventory_cycles: SCENARIO_FIXTURE_CLOUD_MAXIMUM_INVENTORY_CYCLES,
    maximum_signed_firebase_jwts: SCENARIO_FIXTURE_CLOUD_MAXIMUM_SIGNED_JWTS,
    maximum_signing_window_seconds: 1_200,
    firebase_identity_creations: 1,
    firebase_identity_binding_reads: 1,
    firebase_page_custom_tokens: 1,
    firebase_identity_deletions: 1,
    mutation_retries: 0,
    paid_stress_tests: 0,
  }, 'profile.request_budget');
  exact(profile.cleanup, {
    initial_absence_required_before_mutation: true,
    fixed_synthetic_profile_validation: true,
    unknown_creation_outcome_observed_without_retry: true,
    unknown_deletion_outcome_observed_without_retry: true,
    firebase_identity_deleted_once: true,
    final_absence_independently_observed: true,
  }, 'profile.cleanup');
  exact(profile.compatibility, {
    scenario_fixture_private_inputs: 4,
    scenario_fixture_identity_generations: 2,
    replacement_cloud_adapter_present: true,
    fixture_capacity_satisfied: true,
    identity_generation_capacity_satisfied: true,
    page_timing_capacity_satisfied: true,
    page_host_api_scenario_complete: false,
    playwright_bridge_present: true,
    aggregator_wired: false,
  }, 'profile.compatibility');
  if (Object.values(profile.authority).some((entry) => entry !== false)) {
    reject('profile.authority must remain closed');
  }
  exact(profile.evidence, {
    state: 'absent',
    live_http_requests: 0,
    live_replacement_identity_creations: 0,
    live_page_custom_tokens_issued: 0,
    live_replacement_identity_deletions: 0,
    live_execution_count: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  }, 'profile.evidence');
  validateBrowserRelayFixtureCloudProfile();
  validateBrowserRelayScenarioFixtureProfile();
  return Object.freeze(profile);
}

export function validateBrowserRelayScenarioFixtureCloudProfile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Scenario fixture cloud profile must be one bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== SCENARIO_FIXTURE_CLOUD_PROFILE_SHA256) {
    reject('Scenario fixture cloud profile digest has drifted');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Scenario fixture cloud profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('Scenario fixture cloud profile is not canonical JSON');
  }
  regularPinnedFile(
    new URL('cloud.mjs', path instanceof URL ? path : pathToFileURL(path)),
    48 * 1024,
    SCENARIO_FIXTURE_CLOUD_SOURCE_SHA256,
    'Scenario fixture cloud source',
  );
  return validateProfileValue(value);
}
