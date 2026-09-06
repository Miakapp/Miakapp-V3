import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_V11_PLAN_SHA256,
  validateBrowserRelayV11Plan,
} from '../browser-relay/contract.mjs';
import {
  MONITORING_PREFLIGHT_RESULT_SHA256,
  validateMonitoringPreflightResult,
} from '../browser-relay-monitoring/contract.mjs';
import {
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  validateBrowserRelayRunnerProfile,
} from '../browser-relay-runner/contract.mjs';
import {
  RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
  RELAY_SERVICES_PROFILE_SHA256,
  RELAY_SERVICES_V5_PROFILE_SHA256,
  privateReadyRelayVariables,
  validateRelayServicesPrivateReadyResult,
  validateRelayServicesProfile,
  validateRelayServicesV5Profile,
} from '../browser-relay-services/contract.mjs';

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const HOSTING_ORIGIN = 'https://miakapp-v4-staging.web.app';
export const RUNNER_PATH = '/__acceptance/browser-relay/';
export const RUNNER_URL = `${HOSTING_ORIGIN}${RUNNER_PATH}`;
export const ROLLBACK_PROFILE_PATH = 'browser-relay-rollback/profile.json';
export const ROLLBACK_PROFILE_SHA256 =
  'b3517720cb3874f040601d6dfcc7b0ecaf385c16d6b4299c102e2001f8bf18e7';
export const ROLLBACK_IMPLEMENTATION_COMMIT =
  '0fd0d05ee31f84d42cf69cc6f5cead9cbcad79be';
export const ROLLBACK_PREFLIGHT_RESULT_PATH =
  'browser-relay-rollback/preflight-result-v1.json';
export const ROLLBACK_PREFLIGHT_RESULT_SHA256 =
  'e8ceb2164be946d4edebfe2f08d8a3b230dcf9d2a05d9410738e751775950cd3';
export const ROLLBACK_PREFLIGHT_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-rollback-preflight-result/1';
export const RELAY_PRIVATE_READY_INVENTORY_SHA256 =
  '421338fec676c1fccd0e6747d3e8837d4151b147c95b343172639800779b64d1';

const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CONTROL_PLANE_REVISION = /^control-plane-[0-9]{5}-[a-z]{3}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
]);
const FORBIDDEN_FIELD_NAMES = new Set([
  'access_token',
  'authorization',
  'cookie',
  'email',
  'execution_identifier',
  'firebase_uid',
  'home_traffic',
  'id_token',
  'password',
  'private_key',
  'raw_cloud_response',
  'refresh_token',
  'request_headers',
  'response_headers',
  'secret_value',
  'terraform_state',
  'token',
  'trace_context',
  'websocket_frame',
]);
const EDGE_DEPENDENCIES = Object.freeze({
  'cloud.mjs': '1cfe0dba18bcf74bcec1fda1956f7ee72a0b4f7928a9c569ae6e76872425a2df',
  'inventory.mjs': '006618acf57791367f49bc52c3d683c1cdcc3b301e65c738569f6ac5f076f83c',
  'runtime.mjs': '7a446e63faeefd1e269f80422ca9d4fe244fb71256e5e48cc3bef65a235ba880',
  'window.mjs': 'b7ee57a47b6b4663b0f3356fc09d11efb98e288c9adfb851912ed53f8b00be50',
});
const ROLLBACK_STEPS = Object.freeze([
  'remove_acceptance_runner_route',
  'stop_browser_and_coordinator_without_replay',
  'remove_public_relay_invokers_and_restore_private_ready_relay_phase',
  'restore_private_control_plane_ingress_and_invoker_policy',
  'delete_synthetic_fixtures_and_temporary_bindings',
  'verify_zero_unexpected_traffic_and_zero_change_plans',
]);
const EXPECTED_RELAY_RESOURCES = Object.freeze({
  'google_cloud_run_v2_service.relay["relay-a"]': 'google_cloud_run_v2_service',
  'google_cloud_run_v2_service.relay["relay-b"]': 'google_cloud_run_v2_service',
  'google_service_account.relay["runtime"]': 'google_service_account',
  'terraform_data.deployment_guard["active"]': 'terraform_data',
});
const TECHNICAL_COLLECTIONS = Object.freeze([
  'controlAdmissionBuckets',
  'controlAdmissionState',
  'controlAudit',
]);
const profilePath = new URL('profile.json', import.meta.url);
const resultPath = new URL('preflight-result-v1.json', import.meta.url);
const expectedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
const expectedResult = JSON.parse(readFileSync(resultPath, 'utf8'));

export class StagingBrowserRelayRollbackError extends Error {
  constructor(message = 'Staging browser-relay rollback contract is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayRollbackError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayRollbackError(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
}

function exactKeys(value, keys, path) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(`${path} is outside its reviewed bound`);
  }
  return value;
}

function canonicalTimestamp(value, path) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)
    || !Number.isFinite(Date.parse(value))) {
    reject(`${path} is not a canonical UTC timestamp`);
  }
  return value;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function rejectRollbackPrivateMaterial(value, path = 'value') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains credential material`);
    }
    if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|$)|@miakapp-v4\./u.test(value)) {
      reject(`${path} contains a forbidden project target`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectRollbackPrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELD_NAMES.has(key)) reject(`${path}.${key} is forbidden output`);
      rejectRollbackPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function validateEdgeDependencies(profile) {
  const pinByFile = {
    'cloud.mjs': profile.pins.edge_cloud_sha256,
    'inventory.mjs': profile.pins.edge_inventory_sha256,
    'runtime.mjs': profile.pins.edge_runtime_sha256,
    'window.mjs': profile.pins.edge_window_sha256,
  };
  for (const [name, expectedDigest] of Object.entries(EDGE_DEPENDENCIES)) {
    const path = new URL(`../browser-relay-edge/${name}`, import.meta.url);
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1
      || sha256(readFileSync(path)) !== expectedDigest
      || pinByFile[name] !== expectedDigest) {
      reject(`profile.pins browser-relay edge ${name} has drifted`);
    }
  }
}

export function validateBrowserRelayRollbackProfile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Rollback profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== ROLLBACK_PROFILE_SHA256) reject('Rollback profile digest has drifted');
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Rollback profile must be valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')) {
    reject('Rollback profile is not canonical JSON');
  }
  rejectRollbackPrivateMaterial(profile, 'profile');
  exact(profile, expectedProfile, 'profile');
  exactKeys(profile, [
    'schema', 'revision', 'state', 'target', 'pins', 'rollback', 'preflight',
    'required_final_state', 'output', 'evidence',
  ], 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-rollback-profile/1', 'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(profile.state, 'closed_rollback_preflight_implemented_not_observed', 'profile.state');
  exact(profile.target.project_id, PROJECT_ID, 'profile.target.project_id');
  exact(profile.target.project_number, PROJECT_NUMBER, 'profile.target.project_number');
  exact(profile.target.region, REGION, 'profile.target.region');
  exact(profile.target.hosting_origin, HOSTING_ORIGIN, 'profile.target.hosting_origin');
  exact(profile.target.cloud_compute_resources, 0, 'profile.target.cloud_compute_resources');
  exact(profile.target.unscheduled, true, 'profile.target.unscheduled');
  for (const field of [
    'cloud_mutation_authorized_by_profile',
    'public_ingress_authorized_by_profile',
    'acceptance_execution_authorized_by_profile',
  ]) exact(profile.target[field], false, `profile.target.${field}`);
  if (!COMMIT.test(profile.pins.implementation_base_commit)) {
    reject('profile.pins.implementation_base_commit is not a full commit');
  }
  for (const [key, value] of Object.entries(profile.pins)) {
    if (key !== 'implementation_base_commit' && !SHA256.test(value)) {
      reject(`profile.pins.${key} is not a SHA-256 digest`);
    }
  }
  exact(profile.pins.browser_relay_plan_sha256, BROWSER_RELAY_V11_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256');
  exact(profile.pins.monitoring_preflight_result_sha256, MONITORING_PREFLIGHT_RESULT_SHA256,
    'profile.pins.monitoring_preflight_result_sha256');
  exact(profile.pins.runner_profile_sha256, BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    'profile.pins.runner_profile_sha256');
  exact(profile.pins.relay_services_profile_sha256, RELAY_SERVICES_PROFILE_SHA256,
    'profile.pins.relay_services_profile_sha256');
  exact(profile.pins.relay_services_converged_profile_sha256,
    RELAY_SERVICES_V5_PROFILE_SHA256,
    'profile.pins.relay_services_converged_profile_sha256');
  exact(profile.pins.relay_services_private_ready_result_sha256,
    RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    'profile.pins.relay_services_private_ready_result_sha256');
  validateEdgeDependencies(profile);

  const plan = validateBrowserRelayV11Plan(
    new URL('../browser-relay/plan-v11.json', import.meta.url),
  );
  validateMonitoringPreflightResult();
  validateBrowserRelayRunnerProfile();
  validateRelayServicesProfile();
  validateRelayServicesV5Profile();
  validateRelayServicesPrivateReadyResult();
  exact(profile.rollback.ordered_steps, ROLLBACK_STEPS, 'profile.rollback.ordered_steps');
  exact(profile.rollback.ordered_steps, plan.rollback.ordered_steps,
    'profile.rollback plan steps');
  exact(profile.required_final_state, plan.rollback.required_final_state,
    'profile.required_final_state');
  exact(profile.rollback.maximum_edge_observation_attempts, 3,
    'profile.rollback.maximum_edge_observation_attempts');
  exact(profile.rollback.maximum_public_window_seconds,
    plan.budgets.maximum_public_window_seconds,
    'profile.rollback.maximum_public_window_seconds');
  exact(profile.rollback.maximum_callback_execution_seconds, 900,
    'profile.rollback.maximum_callback_execution_seconds');
  exact(profile.preflight.expected_technical_root_collections, TECHNICAL_COLLECTIONS,
    'profile.preflight.expected_technical_root_collections');
  exact(profile.preflight.maximum_root_collections, TECHNICAL_COLLECTIONS.length,
    'profile.preflight.maximum_root_collections');
  exact(profile.preflight.runner_path, RUNNER_PATH, 'profile.preflight.runner_path');
  exact(profile.preflight.maximum_plan_creates, 0, 'profile.preflight.maximum_plan_creates');
  exact(profile.preflight.maximum_plan_updates, 0, 'profile.preflight.maximum_plan_updates');
  exact(profile.preflight.maximum_plan_deletes, 0, 'profile.preflight.maximum_plan_deletes');
  exact(profile.preflight.maximum_plan_replacements, 0,
    'profile.preflight.maximum_plan_replacements');
  exact(profile.output.preflight_result_schema, ROLLBACK_PREFLIGHT_RESULT_SCHEMA,
    'profile.output.preflight_result_schema');
  exact(profile.evidence, {
    state: 'absent',
    live_preflight_count: 0,
    result_path: null,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
    terraform_plan_committed: false,
  }, 'profile.evidence');
  return Object.freeze(profile);
}

export function summarizeRelayTerraformNoChangePlan(value) {
  if (!plainObject(value)
    || value.format_version !== '1.2'
    || value.terraform_version !== '1.11.3'
    || !plainObject(value.variables)
    || !Array.isArray(value.resource_changes)
    || !plainObject(value.output_changes)
    || (value.resource_drift !== undefined
      && (!Array.isArray(value.resource_drift) || value.resource_drift.length !== 0))
    || value.errored === true) {
    reject('Relay private-ready Terraform plan is malformed or contains drift');
  }
  const plannedSurface = JSON.stringify({
    variables: value.variables,
    resource_changes: value.resource_changes,
    resource_drift: value.resource_drift ?? [],
    output_changes: value.output_changes,
  });
  if (PRIVATE_MATERIAL.some((pattern) => pattern.test(plannedSurface))
    || /"(?:allUsers|allAuthenticatedUsers)"|\bmiakapp-3\b|projects\/miakapp-v4(?:\/|$)|@miakapp-v4\./u
      .test(plannedSurface)) {
    reject('Relay private-ready Terraform plan contains a credential or forbidden target');
  }
  const expectedVariables = privateReadyRelayVariables();
  exact(value.variables.deployment_phase?.value, expectedVariables.deployment_phase,
    'terraform_plan.variables.deployment_phase');
  exact(value.variables.relay_audiences?.value, expectedVariables.relay_audiences,
    'terraform_plan.variables.relay_audiences');
  const resources = value.resource_changes.map((change) => {
    if (!plainObject(change) || !plainObject(change.change)
      || change.mode !== 'managed' || typeof change.address !== 'string'
      || EXPECTED_RELAY_RESOURCES[change.address] !== change.type
      || !isDeepStrictEqual(change.change.actions, ['no-op'])) {
      reject('Relay private-ready Terraform resource plan is not an exact no-op');
    }
    return change.address;
  }).sort();
  exact(resources, Object.keys(EXPECTED_RELAY_RESOURCES).sort(),
    'terraform_plan resource addresses');
  exact(Object.keys(value.output_changes), ['staging_browser_relays'],
    'terraform_plan output names');
  exact(value.output_changes.staging_browser_relays?.actions, ['no-op'],
    'terraform_plan staging_browser_relays actions');
  return Object.freeze({
    state: 'no_changes',
    terraform_version: value.terraform_version,
    managed_resource_noops: resources.length,
    output_noops: 1,
    creates: 0,
    updates: 0,
    deletes: 0,
    replacements: 0,
    raw_plan_retained: false,
  });
}

export function validateRollbackCloudObservation(value) {
  rejectRollbackPrivateMaterial(value, 'observation');
  const observation = exactKeys(value, [
    'schema', 'project_id', 'project_number', 'region', 'observed_at',
    'implementation_commit', 'control_plane', 'relays', 'hosting',
    'application_data', 'iam', 'terraform', 'effects',
  ], 'observation');
  exact(observation.schema,
    'miakapp.staging-browser-relay-rollback-cloud-observation/1',
    'observation.schema');
  exact(observation.project_id, PROJECT_ID, 'observation.project_id');
  exact(observation.project_number, PROJECT_NUMBER, 'observation.project_number');
  exact(observation.region, REGION, 'observation.region');
  canonicalTimestamp(observation.observed_at, 'observation.observed_at');
  if (!COMMIT.test(observation.implementation_commit)) {
    reject('observation.implementation_commit is not a full commit');
  }
  exact(observation.control_plane.state, 'canonical_private',
    'observation.control_plane.state');
  if (!CONTROL_PLANE_REVISION.test(observation.control_plane.revision)) {
    reject('observation.control_plane.revision is invalid');
  }
  exact(observation.control_plane.ingress, 'ALLOW_INTERNAL_ONLY',
    'observation.control_plane.ingress');
  exact(observation.control_plane.unauthenticated_invokers, 0,
    'observation.control_plane.unauthenticated_invokers');
  exact(observation.control_plane.minimum_instances, 0,
    'observation.control_plane.minimum_instances');
  exact(observation.relays.phase, 'private_ready', 'observation.relays.phase');
  exact(observation.relays.services, 2, 'observation.relays.services');
  exact(observation.relays.public_invokers, 0, 'observation.relays.public_invokers');
  exact(observation.relays.service_account_user_managed_keys, 0,
    'observation.relays.service_account_user_managed_keys');
  exact(observation.relays.minimum_instances, 0, 'observation.relays.minimum_instances');
  exact(observation.relays.inventory_sha256, RELAY_PRIVATE_READY_INVENTORY_SHA256,
    'observation.relays.inventory_sha256');
  exact(observation.hosting.site_disabled, true, 'observation.hosting.site_disabled');
  boundedInteger(observation.hosting.versions, 6, 6, 'observation.hosting.versions');
  exact(observation.hosting.deleted_versions, observation.hosting.versions,
    'observation.hosting.deleted_versions');
  boundedInteger(observation.hosting.releases, 6, 6, 'observation.hosting.releases');
  exact(observation.hosting.runner_route_status, 404,
    'observation.hosting.runner_route_status');
  exact(observation.application_data.firebase_auth_users, 0,
    'observation.application_data.firebase_auth_users');
  exact(observation.application_data.technical_root_collections, TECHNICAL_COLLECTIONS,
    'observation.application_data.technical_root_collections');
  exact(observation.application_data.application_fixture_collections, 0,
    'observation.application_data.application_fixture_collections');
  exact(observation.iam.temporary_acceptance_bindings, 0,
    'observation.iam.temporary_acceptance_bindings');
  exact(observation.iam.unexpected_public_project_bindings, 0,
    'observation.iam.unexpected_public_project_bindings');
  exact(observation.terraform, {
    state: 'no_changes',
    terraform_version: '1.11.3',
    managed_resource_noops: 4,
    output_noops: 1,
    creates: 0,
    updates: 0,
    deletes: 0,
    replacements: 0,
    raw_plan_retained: false,
  }, 'observation.terraform');
  exact(observation.effects, {
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credentials_retained: false,
    raw_cloud_responses_retained: false,
  }, 'observation.effects');
  return Object.freeze(observation);
}

export function buildRollbackPreflightResult(value) {
  const observation = validateRollbackCloudObservation(value);
  const profile = validateBrowserRelayRollbackProfile();
  return Object.freeze({
    schema: ROLLBACK_PREFLIGHT_RESULT_SCHEMA,
    state: 'rollback_target_preflighted_private_and_converged',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: observation.observed_at,
    implementation_commit: observation.implementation_commit,
    profile_sha256: ROLLBACK_PROFILE_SHA256,
    browser_relay_plan_sha256: profile.pins.browser_relay_plan_sha256,
    control_plane_state: observation.control_plane.state,
    control_plane_revision: observation.control_plane.revision,
    control_plane_ingress: observation.control_plane.ingress,
    control_plane_public_invokers: observation.control_plane.unauthenticated_invokers,
    relay_phase: observation.relays.phase,
    relay_services: observation.relays.services,
    relay_public_invokers: observation.relays.public_invokers,
    relay_service_account_user_managed_keys:
      observation.relays.service_account_user_managed_keys,
    relay_inventory_sha256: observation.relays.inventory_sha256,
    runner_route_present: false,
    runner_route_status: observation.hosting.runner_route_status,
    firebase_auth_users: observation.application_data.firebase_auth_users,
    application_fixture_collections:
      observation.application_data.application_fixture_collections,
    temporary_iam_bindings: observation.iam.temporary_acceptance_bindings,
    minimum_instances: Math.max(
      observation.control_plane.minimum_instances,
      observation.relays.minimum_instances,
    ),
    terraform_convergence: observation.terraform.state,
    terraform_managed_resource_noops: observation.terraform.managed_resource_noops,
    rollback_steps: profile.rollback.ordered_steps.length,
    cloud_mutations: observation.effects.cloud_mutations,
    public_ingress_changes: observation.effects.public_ingress_changes,
    acceptance_executions: observation.effects.acceptance_executions,
    credential_material_retained: observation.effects.credentials_retained,
    raw_cloud_responses_retained: observation.effects.raw_cloud_responses_retained,
    terraform_plan_retained: observation.terraform.raw_plan_retained,
  });
}

export function validateRollbackPreflightResult(path = resultPath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Rollback preflight result must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== ROLLBACK_PREFLIGHT_RESULT_SHA256) {
    reject('Rollback preflight result digest has drifted');
  }
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Rollback preflight result must be valid JSON');
  }
  if (canonicalJson(result) !== bytes.toString('utf8')) {
    reject('Rollback preflight result is not canonical JSON');
  }
  rejectRollbackPrivateMaterial(result, 'preflight_result');
  exactKeys(result, [
    'schema', 'state', 'project_id', 'project_number', 'region', 'observed_at',
    'implementation_commit', 'profile_sha256', 'browser_relay_plan_sha256',
    'control_plane_state', 'control_plane_revision', 'control_plane_ingress',
    'control_plane_public_invokers', 'relay_phase', 'relay_services',
    'relay_public_invokers', 'relay_service_account_user_managed_keys',
    'relay_inventory_sha256', 'runner_route_present', 'runner_route_status',
    'firebase_auth_users', 'application_fixture_collections',
    'temporary_iam_bindings', 'minimum_instances', 'terraform_convergence',
    'terraform_managed_resource_noops', 'rollback_steps', 'cloud_mutations',
    'public_ingress_changes', 'acceptance_executions',
    'credential_material_retained', 'raw_cloud_responses_retained',
    'terraform_plan_retained',
  ], 'preflight_result');
  canonicalTimestamp(result.observed_at, 'preflight_result.observed_at');
  exact(result, expectedResult, 'preflight_result');
  exact(result.schema, ROLLBACK_PREFLIGHT_RESULT_SCHEMA, 'preflight_result.schema');
  exact(result.state, 'rollback_target_preflighted_private_and_converged',
    'preflight_result.state');
  exact(result.project_id, PROJECT_ID, 'preflight_result.project_id');
  exact(result.project_number, PROJECT_NUMBER, 'preflight_result.project_number');
  exact(result.region, REGION, 'preflight_result.region');
  exact(result.implementation_commit, ROLLBACK_IMPLEMENTATION_COMMIT,
    'preflight_result.implementation_commit');
  exact(result.profile_sha256, ROLLBACK_PROFILE_SHA256,
    'preflight_result.profile_sha256');
  exact(result.browser_relay_plan_sha256, BROWSER_RELAY_V11_PLAN_SHA256,
    'preflight_result.browser_relay_plan_sha256');
  exact(result.control_plane_state, 'canonical_private',
    'preflight_result.control_plane_state');
  exact(result.control_plane_revision, 'control-plane-00010-vop',
    'preflight_result.control_plane_revision');
  exact(result.control_plane_ingress, 'ALLOW_INTERNAL_ONLY',
    'preflight_result.control_plane_ingress');
  exact(result.control_plane_public_invokers, 0,
    'preflight_result.control_plane_public_invokers');
  exact(result.relay_phase, 'private_ready', 'preflight_result.relay_phase');
  exact(result.relay_services, 2, 'preflight_result.relay_services');
  exact(result.relay_public_invokers, 0, 'preflight_result.relay_public_invokers');
  exact(result.relay_service_account_user_managed_keys, 0,
    'preflight_result.relay_service_account_user_managed_keys');
  exact(result.relay_inventory_sha256, RELAY_PRIVATE_READY_INVENTORY_SHA256,
    'preflight_result.relay_inventory_sha256');
  exact(result.runner_route_present, false, 'preflight_result.runner_route_present');
  exact(result.runner_route_status, 404, 'preflight_result.runner_route_status');
  for (const field of [
    'firebase_auth_users', 'application_fixture_collections',
    'temporary_iam_bindings', 'minimum_instances', 'cloud_mutations',
    'public_ingress_changes', 'acceptance_executions',
  ]) exact(result[field], 0, `preflight_result.${field}`);
  exact(result.terraform_convergence, 'no_changes',
    'preflight_result.terraform_convergence');
  exact(result.terraform_managed_resource_noops, 4,
    'preflight_result.terraform_managed_resource_noops');
  exact(result.rollback_steps, ROLLBACK_STEPS.length, 'preflight_result.rollback_steps');
  for (const field of [
    'credential_material_retained', 'raw_cloud_responses_retained',
    'terraform_plan_retained',
  ]) exact(result[field], false, `preflight_result.${field}`);
  validateBrowserRelayRollbackProfile();
  validateBrowserRelayV11Plan();
  return Object.freeze(result);
}
