import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';
import {
  BROWSER_ORDER,
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
  HOME_ID,
  PAGE_PRIVATE_INPUT_SCHEMA,
  validateBrowserRelayPageProfile,
} from '../browser-relay-page/contract.mjs';
import {
  FIXTURE_PROFILE_SHA256,
  FIXTURE_SOURCE_SHA256,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  SYNTHETIC_UID,
  validateBrowserRelayFixtureProfile,
} from '../browser-relay-fixture/contract.mjs';
import {
  FIXTURE_CLOUD_PROFILE_SHA256,
  validateBrowserRelayFixtureCloudProfile,
} from '../browser-relay-fixture-cloud/contract.mjs';
import {
  PAGE_RECEIPT_PROFILE_SHA256,
  REQUIRED_MATRIX_PRIVATE_INPUTS,
  validateBrowserRelayPageReceiptProfile,
} from '../browser-relay-page-receipt/contract.mjs';

export const SCENARIO_FIXTURE_PROFILE_PATH =
  'browser-relay-scenario-fixture/profile.json';
export const SCENARIO_FIXTURE_PROFILE_SHA256 =
  '910478fdb175dcae2cff8307f340748a3d2347f31f3e0384f3e0689a7cf264f4';
export const SCENARIO_FIXTURE_IMPLEMENTATION_BASE_COMMIT =
  '168d9ae8d1cf6e31af92fce220a77ab2878effd4';
export const SCENARIO_FIXTURE_SOURCE_SHA256 =
  '6324e8156f987a32b112135a0bbaef2766b63e16f8b81b1e0a526816c7f132bf';
export const REPLACEMENT_SYNTHETIC_UID =
  'miakapp-v4-staging-browser-relay-replacement-v1';
export const REPLACEMENT_ABSENCE_SCHEMA =
  'miakapp.staging-browser-relay-replacement-absence/1';
export const REPLACEMENT_IDENTITY_SCHEMA =
  'miakapp.staging-browser-relay-replacement-identity/1';
export const SCENARIO_ABSENCE_SCHEMA =
  'miakapp.staging-browser-relay-scenario-absence/1';

export const SCENARIO_INPUT_ORDER = Object.freeze([
  Object.freeze({ browser: 'chromium', identity_generation: 1 }),
  Object.freeze({ browser: 'chromium', identity_generation: 2 }),
  Object.freeze({ browser: 'firefox', identity_generation: 1 }),
  Object.freeze({ browser: 'webkit', identity_generation: 1 }),
]);

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const fixturePath = new URL('fixture.mjs', import.meta.url);
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
  'authorization',
  'cookie',
  'firebase_custom_token',
  'firebase_id_token',
  'home_key',
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

export class StagingBrowserRelayScenarioFixtureError extends Error {
  constructor(message = 'Staging browser-relay scenario fixture is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayScenarioFixtureError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayScenarioFixtureError(message);
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

export function rejectScenarioFixturePrivateMaterial(value, path = 'output') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains private material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectScenarioFixturePrivateMaterial(
      entry,
      `${path}[${index}]`,
    ));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is forbidden`);
      rejectScenarioFixturePrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function validateReplacementAbsence(value) {
  rejectScenarioFixturePrivateMaterial(value, 'replacement_absence');
  const result = exactKeys(value, [
    'schema',
    'state',
    'firebase_auth_users',
  ], 'replacement_absence');
  exact(result.schema, REPLACEMENT_ABSENCE_SCHEMA, 'replacement_absence.schema');
  exact(result.state, 'absent', 'replacement_absence.state');
  exact(result.firebase_auth_users, 0, 'replacement_absence.firebase_auth_users');
  return Object.freeze({ ...result });
}

export function validateReplacementIdentity(value) {
  rejectScenarioFixturePrivateMaterial(value, 'replacement_identity');
  const result = exactKeys(value, ['schema', 'state'], 'replacement_identity');
  exact(result.schema, REPLACEMENT_IDENTITY_SCHEMA, 'replacement_identity.schema');
  exact(result.state, 'created', 'replacement_identity.state');
  return Object.freeze({ ...result });
}

export function validateScenarioAbsence(value) {
  rejectScenarioFixturePrivateMaterial(value, 'scenario_absence');
  const result = exactKeys(value, [
    'schema',
    'state',
    'firebase_auth_users',
    'public_homes',
    'private_homes',
    'home_key_records',
    'home_key_indexes',
    'control_owners',
    'active_coordinator_sessions',
  ], 'scenario_absence');
  exact(result.schema, SCENARIO_ABSENCE_SCHEMA, 'scenario_absence.schema');
  exact(result.state, 'absent', 'scenario_absence.state');
  for (const field of [
    'firebase_auth_users',
    'public_homes',
    'private_homes',
    'home_key_records',
    'home_key_indexes',
    'control_owners',
    'active_coordinator_sessions',
  ]) exact(result[field], 0, `scenario_absence.${field}`);
  return Object.freeze({ ...result });
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
  rejectScenarioFixturePrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'scenario',
    'lifecycle',
    'private_material',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-scenario-fixture-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_four_input_two_identity_controller_implemented_cloud_extension_not_wired_not_executed',
    'profile.state',
  );
  exact(profile.target, {
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    home_id: HOME_ID,
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  }, 'profile.target');
  exact(profile.pins, {
    implementation_base_commit: SCENARIO_FIXTURE_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    browser_relay_page_profile_sha256: BROWSER_RELAY_PAGE_PROFILE_SHA256,
    browser_relay_fixture_profile_sha256: FIXTURE_PROFILE_SHA256,
    browser_relay_fixture_source_sha256: FIXTURE_SOURCE_SHA256,
    browser_relay_fixture_cloud_profile_sha256: FIXTURE_CLOUD_PROFILE_SHA256,
    browser_relay_page_receipt_profile_sha256: PAGE_RECEIPT_PROFILE_SHA256,
    fixture_source_sha256: SCENARIO_FIXTURE_SOURCE_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) {
    reject('profile.pins contains an invalid immutable identifier');
  }
  exact(profile.scenario, {
    primary_synthetic_uid: SYNTHETIC_UID,
    replacement_synthetic_uid: REPLACEMENT_SYNTHETIC_UID,
    firebase_identities: 2,
    homes: 1,
    coordinators: 1,
    coordinator_state_access_users: 2,
    page_private_input_schema: PAGE_PRIVATE_INPUT_SCHEMA,
    page_private_input_order: SCENARIO_INPUT_ORDER,
    page_private_inputs: REQUIRED_MATRIX_PRIVATE_INPUTS,
    primary_identity_page_inputs: 3,
    replacement_identity_page_inputs: 1,
    custom_token_reuse: false,
    replacement_identity_calls: 0,
  }, 'profile.scenario');
  exact(profile.lifecycle, {
    both_identities_absent_before_mutation: true,
    cleanup_authority_requires_independent_initial_absence: true,
    replacement_identity_creation_retries: 0,
    replacement_custom_token_retries: 0,
    coordinator_stop_precedes_all_data_cleanup: true,
    both_identities_absent_after_cleanup: true,
    unknown_replacement_mutation_outcome_requires_cleanup: true,
    cleanup_attempts_both_ownership_domains: true,
  }, 'profile.lifecycle');
  exact(profile.private_material, {
    primary_controller_credentials: 'delegated_memory_only',
    replacement_identity_bootstrap: 'injected_memory_only',
    page_custom_tokens: 'memory_only_one_per_input',
    retained_page_token_digests: 4,
    raw_dependency_responses_retained: false,
    private_values_in_closed_results: false,
    arbitrary_dependency_errors_propagated: false,
  }, 'profile.private_material');
  exact(profile.compatibility, {
    page_receipt_required_private_inputs: REQUIRED_MATRIX_PRIVATE_INPUTS,
    scenario_fixture_private_inputs: REQUIRED_MATRIX_PRIVATE_INPUTS,
    fixture_capacity_satisfied: true,
    page_receipt_required_identity_generations: 2,
    scenario_fixture_identity_generations: 2,
    identity_generation_capacity_satisfied: true,
    current_cloud_adapter_firebase_identities: 1,
    replacement_cloud_adapter_present: false,
    page_timing_capacity_satisfied: false,
    page_host_api_scenario_complete: false,
    playwright_bridge_present: false,
    aggregator_wired: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    replacement_absence_schema: REPLACEMENT_ABSENCE_SCHEMA,
    replacement_identity_schema: REPLACEMENT_IDENTITY_SCHEMA,
    scenario_absence_schema: SCENARIO_ABSENCE_SCHEMA,
    allowed_observations: [
      'bounded_counts',
      'stable_lifecycle_state',
      'synthetic_state_expectation',
    ],
    forbidden_observations: [
      'email',
      'firebase_uid',
      'home_key',
      'raw_request_or_response',
      'token',
    ],
  }, 'profile.output');
  if (Object.values(profile.authority).some((entry) => entry !== false)) {
    reject('profile.authority must remain closed');
  }
  exact(profile.evidence, {
    state: 'absent',
    live_fixture_creations: 0,
    live_replacement_identities: 0,
    live_page_custom_tokens_issued: 0,
    live_cleanup_executions: 0,
    cloud_mutations: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  }, 'profile.evidence');
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayPageProfile();
  validateBrowserRelayFixtureProfile();
  validateBrowserRelayFixtureCloudProfile();
  validateBrowserRelayPageReceiptProfile();
  return Object.freeze(profile);
}

export function validateBrowserRelayScenarioFixtureProfile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Browser-relay scenario fixture profile must be one bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== SCENARIO_FIXTURE_PROFILE_SHA256) {
    reject('Browser-relay scenario fixture profile digest has drifted');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser-relay scenario fixture profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('Browser-relay scenario fixture profile is not canonical JSON');
  }
  regularPinnedFile(
    fixturePath,
    32 * 1024,
    SCENARIO_FIXTURE_SOURCE_SHA256,
    'Browser-relay scenario fixture source',
  );
  return validateProfileValue(value);
}
