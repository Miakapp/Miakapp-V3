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
  validateBrowserRelayPageProfile,
} from '../browser-relay-page/contract.mjs';

export const FIXTURE_PROFILE_PATH = 'browser-relay-fixture/profile.json';
export const FIXTURE_PROFILE_SHA256 =
  'cf9f75e8f385e386c695751b43258d792f8fe104aa7ec80c6e3471a21ac04047';
export const FIXTURE_IMPLEMENTATION_BASE_COMMIT =
  '338c241f3420b456de1a30509c7144422122da48';
export const FIXTURE_SOURCE_SHA256 =
  '339cd223822dba232e1bacf263e6632669788c5a44bca39ea297cb8f47fbe838';
export const MIAKAPI_COMMIT = 'a798a746847ba3d5c16128a08b33353269e770a4';
export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const SYNTHETIC_UID = 'miakapp-v4-staging-browser-relay-v1';
export const COORDINATOR_NAME = 'miakapp-v4-staging-acceptance';
export const STATE_PATH = 'acceptance.temperature';
export const FUNCTION_NAME = 'acceptance.set';
export const ABSENCE_SCHEMA = 'miakapp.staging-browser-relay-fixture-absence/1';
export const STATE_EXPECTATION_SCHEMA =
  'miakapp.staging-browser-relay-fixture-state-expectation/1';

const profilePath = new URL('profile.json', import.meta.url);
const fixtureSourcePath = new URL('fixture.mjs', import.meta.url);
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
  'authorization',
  'custom_token',
  'email',
  'firebase_custom_token',
  'firebase_id_token',
  'firebase_uid',
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
  'uid',
]);

export class StagingBrowserRelayFixtureError extends Error {
  constructor(message = 'Staging browser-relay fixture boundary is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayFixtureError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayFixtureError(message);
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

function boundedInteger(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(`${path} is outside its reviewed bound`);
  }
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function rejectFixturePrivateMaterial(value, path = 'output') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains credential material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectFixturePrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is forbidden output`);
      rejectFixturePrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function validateFixtureAbsence(value) {
  rejectFixturePrivateMaterial(value);
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
  ], 'fixture_absence');
  exact(result.schema, ABSENCE_SCHEMA, 'fixture_absence.schema');
  exact(result.state, 'absent', 'fixture_absence.state');
  for (const field of [
    'firebase_auth_users',
    'public_homes',
    'private_homes',
    'home_key_records',
    'home_key_indexes',
    'control_owners',
    'active_coordinator_sessions',
  ]) exact(result[field], 0, `fixture_absence.${field}`);
  return Object.freeze({ ...result });
}

export function validateStateExpectation(value) {
  rejectFixturePrivateMaterial(value);
  const result = exactKeys(value, [
    'schema',
    'path',
    'revision',
    'value',
  ], 'state_expectation');
  exact(result.schema, STATE_EXPECTATION_SCHEMA, 'state_expectation.schema');
  exact(result.path, STATE_PATH, 'state_expectation.path');
  boundedInteger(result.revision, 1, 64, 'state_expectation.revision');
  boundedInteger(result.value, -100, 200, 'state_expectation.value');
  return Object.freeze({ ...result });
}

function validateProfileValue(value) {
  rejectFixturePrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'fixture',
    'lifecycle',
    'private_material',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-fixture-profile/1', 'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_single_fixture_controller_implemented_not_wired_not_executed',
    'profile.state',
  );
  exactKeys(profile.target, [
    'project_id',
    'project_number',
    'region',
    'home_id',
    'data_policy',
    'cloud_compute_resources',
    'unscheduled',
  ], 'profile.target');
  exact(profile.target.project_id, PROJECT_ID, 'profile.target.project_id');
  exact(profile.target.project_number, PROJECT_NUMBER, 'profile.target.project_number');
  exact(profile.target.region, REGION, 'profile.target.region');
  exact(profile.target.home_id, HOME_ID, 'profile.target.home_id');
  exact(profile.target.data_policy, 'synthetic_only', 'profile.target.data_policy');
  exact(profile.target.cloud_compute_resources, 0, 'profile.target.cloud_compute_resources');
  exact(profile.target.unscheduled, true, 'profile.target.unscheduled');
  exactKeys(profile.pins, [
    'implementation_base_commit',
    'browser_relay_plan_sha256',
    'browser_relay_page_profile_sha256',
    'miakapi_commit',
    'fixture_source_sha256',
  ], 'profile.pins');
  for (const field of ['implementation_base_commit', 'miakapi_commit']) {
    if (!COMMIT.test(profile.pins[field])) reject(`profile.pins.${field} is invalid`);
  }
  for (const field of [
    'browser_relay_plan_sha256',
    'browser_relay_page_profile_sha256',
    'fixture_source_sha256',
  ]) {
    if (!SHA256.test(profile.pins[field])) reject(`profile.pins.${field} is invalid`);
  }
  exact(profile.pins.implementation_base_commit, FIXTURE_IMPLEMENTATION_BASE_COMMIT,
    'profile.pins.implementation_base_commit');
  exact(profile.pins.browser_relay_plan_sha256, BROWSER_RELAY_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256');
  exact(profile.pins.browser_relay_page_profile_sha256, BROWSER_RELAY_PAGE_PROFILE_SHA256,
    'profile.pins.browser_relay_page_profile_sha256');
  exact(profile.pins.miakapi_commit, MIAKAPI_COMMIT, 'profile.pins.miakapi_commit');
  exact(profile.pins.fixture_source_sha256, FIXTURE_SOURCE_SHA256,
    'profile.pins.fixture_source_sha256');
  exactKeys(profile.fixture, [
    'coordinator_name',
    'initial_state',
    'state_access_pattern',
    'function_name',
    'function_argument',
    'function_minimum',
    'function_maximum',
    'home_name',
    'home_icon',
    'home_key_label',
    'home_key_scopes',
    'initial_relay',
    'rotation_relay',
    'browser_order',
    'maximum_browser_custom_tokens',
    'custom_token_reuse',
    'coordinator_sessions',
    'maximum_function_calls',
    'duplicate_idempotency_mutations',
  ], 'profile.fixture');
  exact(profile.fixture.coordinator_name, COORDINATOR_NAME,
    'profile.fixture.coordinator_name');
  exact(profile.fixture.initial_state, { path: STATE_PATH, value: 20, revision: 1 },
    'profile.fixture.initial_state');
  exact(profile.fixture.state_access_pattern, 'acceptance.*',
    'profile.fixture.state_access_pattern');
  exact(profile.fixture.function_name, FUNCTION_NAME, 'profile.fixture.function_name');
  exact(profile.fixture.function_argument, 'target', 'profile.fixture.function_argument');
  exact(profile.fixture.function_minimum, -100, 'profile.fixture.function_minimum');
  exact(profile.fixture.function_maximum, 200, 'profile.fixture.function_maximum');
  exact(profile.fixture.home_name, 'Miakapp V4 staging browser relay',
    'profile.fixture.home_name');
  exact(profile.fixture.home_icon, 'house', 'profile.fixture.home_icon');
  exact(profile.fixture.home_key_label, 'Browser relay acceptance coordinator',
    'profile.fixture.home_key_label');
  exact(profile.fixture.home_key_scopes, ['relay:coordinator'],
    'profile.fixture.home_key_scopes');
  exact(profile.fixture.initial_relay, 'relay-a', 'profile.fixture.initial_relay');
  exact(profile.fixture.rotation_relay, 'relay-b', 'profile.fixture.rotation_relay');
  exact(profile.fixture.browser_order, BROWSER_ORDER, 'profile.fixture.browser_order');
  exact(profile.fixture.maximum_browser_custom_tokens, 3,
    'profile.fixture.maximum_browser_custom_tokens');
  exact(profile.fixture.custom_token_reuse, false, 'profile.fixture.custom_token_reuse');
  exact(profile.fixture.coordinator_sessions, 1, 'profile.fixture.coordinator_sessions');
  exact(profile.fixture.maximum_function_calls, 8,
    'profile.fixture.maximum_function_calls');
  exact(profile.fixture.duplicate_idempotency_mutations, 0,
    'profile.fixture.duplicate_idempotency_mutations');
  for (const [field, expected] of Object.entries({
    preexisting_fixture_must_be_absent: true,
    cleanup_authority_requires_observed_initial_absence: true,
    creation_retries: 0,
    relay_rotation_retries: 0,
    custom_token_issuance_retries: 0,
    coordinator_stop_precedes_data_cleanup: true,
    cleanup_is_idempotent: true,
    final_absence_must_be_observed: true,
    unknown_mutation_outcome_requires_cleanup: true,
  })) exact(profile.lifecycle[field], expected, `profile.lifecycle.${field}`);
  exact(profile.private_material.firebase_identity_token, 'memory_only',
    'profile.private_material.firebase_identity_token');
  exact(profile.private_material.firebase_custom_tokens, 'memory_only_one_per_browser',
    'profile.private_material.firebase_custom_tokens');
  exact(profile.private_material.coordinator_credential, 'memory_only_coordinator_provider',
    'profile.private_material.coordinator_credential');
  for (const field of [
    'raw_api_responses_retained',
    'private_values_in_closed_results',
    'arbitrary_dependency_errors_propagated',
  ]) exact(profile.private_material[field], false, `profile.private_material.${field}`);
  exact(profile.output.absence_schema, ABSENCE_SCHEMA, 'profile.output.absence_schema');
  exact(profile.output.state_expectation_schema, STATE_EXPECTATION_SCHEMA,
    'profile.output.state_expectation_schema');
  exact(profile.output.allowed_observations, [
    'bounded_counts',
    'synthetic_state_expectation',
    'stable_lifecycle_state',
  ], 'profile.output.allowed_observations');
  exact(profile.output.forbidden_observations, [
    'email',
    'firebase_uid',
    'home_key',
    'raw_request_or_response',
    'token',
  ], 'profile.output.forbidden_observations');
  for (const field of [
    'cloud_mutation_authorized',
    'public_ingress_authorized',
    'hosting_publication_authorized',
    'live_execution_authorized',
  ]) exact(profile.authority[field], false, `profile.authority.${field}`);
  exact(profile.evidence.state, 'absent', 'profile.evidence.state');
  for (const field of [
    'live_fixture_creations',
    'live_custom_tokens_issued',
    'live_coordinator_sessions',
    'live_cleanup_executions',
  ]) exact(profile.evidence[field], 0, `profile.evidence.${field}`);
  exact(profile.evidence.credentials_committed, false,
    'profile.evidence.credentials_committed');
  exact(profile.evidence.raw_cloud_responses_committed, false,
    'profile.evidence.raw_cloud_responses_committed');
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayPageProfile();
  return Object.freeze(profile);
}

export function validateBrowserRelayFixtureProfile(path = profilePath) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAXIMUM_PROFILE_BYTES) {
    reject('Browser-relay fixture profile must be one bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== FIXTURE_PROFILE_SHA256) {
    reject('Browser-relay fixture profile digest has drifted');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser-relay fixture profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('Browser-relay fixture profile is not canonical JSON');
  }
  const fixtureStat = lstatSync(fixtureSourcePath);
  if (!fixtureStat.isFile() || fixtureStat.isSymbolicLink()
    || sha256(readFileSync(fixtureSourcePath)) !== FIXTURE_SOURCE_SHA256) {
    reject('Browser-relay fixture source digest has drifted');
  }
  return validateProfileValue(value);
}
