import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_V13_PLAN_SHA256 as BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayV13Plan,
} from '../browser-relay/contract.mjs';
import {
  MONITORING_PREFLIGHT_RESULT_SHA256,
  MONITORING_PROFILE_SHA256,
  evaluateMonitoringSample,
  validateBrowserRelayMonitoringProfile,
  validateMonitoringPreflightResult,
} from '../browser-relay-monitoring/contract.mjs';
import {
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
  ORCHESTRATOR_PROFILE_SHA256,
  validateBrowserRelayOrchestratorProfile,
  validateOrchestratorPreflightResult,
} from '../browser-relay-orchestrator/contract.mjs';
import {
  RELAY_PRIVATE_READY_INVENTORY_SHA256,
  ROLLBACK_PREFLIGHT_RESULT_SHA256,
  ROLLBACK_PROFILE_SHA256,
  validateBrowserRelayRollbackProfile,
  validateRollbackPreflightResult,
} from '../browser-relay-rollback/contract.mjs';
import {
  BROWSER_ORDER,
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  MAXIMUM_TOTAL_MILLISECONDS,
  RUNNER_RESULT_SCHEMA,
  validateBrowserRelayRunnerProfile,
} from '../browser-relay-runner/contract.mjs';
import {
  RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
  validateRelayServicesPrivateReadyResult,
} from '../browser-relay-services/contract.mjs';

export { BROWSER_RELAY_PLAN_SHA256 };

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const OPERATION_PROFILE_PATH = 'browser-relay-operation/profile.json';
export const OPERATION_PROFILE_SHA256 =
  'd1ff776c48c0aade724fc31a8d44c7e68fe5c81919eab7030998962017801a73';
export const OPERATION_IMPLEMENTATION_BASE_COMMIT =
  'b82e152334a0bb30f6dcdbbe32abe44349bd9542';
export const OPERATION_IMPLEMENTATION_COMMIT =
  'ae21e4922d3f70fffe9218cd975f180faca486f0';
export const OPERATION_SOURCE_SHA256 =
  '4ced79f80aa55fdfb1892b6d34187bb7d158b0205ba92ab3b7fabc28d0fb77b3';
export const OPERATION_PREFLIGHT_RESULT_PATH =
  'browser-relay-operation/preflight-result-v1.json';
export const OPERATION_PREFLIGHT_RESULT_SHA256 =
  'e3e7e6fab86b1cd777be94b9a9d2c215698d1ab842c92bfd54b6f4ff7d15e436';
export const OPERATION_PREFLIGHT_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-operation-preflight-result/1';
export const WINDOW_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-operation-window-result/1';
export const OPERATION_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-operation-result/1';
export const MATRIX_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-operation-matrix-result/1';
export const MAXIMUM_PUBLIC_WINDOW_MILLISECONDS = 1_200_000;
export const MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS = 900_000;

const profilePath = new URL('profile.json', import.meta.url);
const preflightResultPath = new URL('preflight-result-v1.json', import.meta.url);
const expectedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const MAXIMUM_RESULT_BYTES = 64 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REVISION = /^(?:control-plane|miakapp-staging-relay-[ab])-[0-9]{5}-[a-z]{3}$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
]);
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'app_check_token',
  'authorization',
  'browser_storage',
  'cookie',
  'custom_token',
  'email',
  'execution_identifier',
  'firebase_id_token',
  'firebase_uid',
  'har',
  'home_traffic',
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
  'trace_context',
  'video',
  'websocket_frame',
]);
const NORMALIZED_FORBIDDEN_FIELDS = new Set(
  [...FORBIDDEN_FIELDS].map((field) => field.replaceAll('_', '')),
);
const BOOLEAN_ABSENCE_FIELDS = new Set(['har', 'video', 'websocket_frame']);
const LIVE_CASE_IDS = Object.freeze(Array.from(
  { length: 12 },
  (_, index) => `LIVE-${String(index + 1).padStart(2, '0')}`,
));
const WINDOW_CASE_IDS = Object.freeze(LIVE_CASE_IDS.slice(1, 11));
const OUTCOME_CLASSES = Object.freeze([
  'accepted',
  'applied',
  'failed',
  'outcome_unknown',
  'stale',
]);
const COUNTER_MAXIMUMS = Object.freeze({
  app_check_assessments: 16,
  control_plane_exchanges: 16,
  kms_signatures: 16,
  firestore_writes: 64,
  maximum_active_websockets: 1,
  source_credentials_on_websocket: 0,
  browser_credential_persistence_events: 0,
  physical_call_replays: 0,
});
const WINDOW_STAGES = Object.freeze([
  'observe_pristine_edge_public_baseline',
  'create_synthetic_fixture',
  'publish_acceptance_runner',
  'verify_acceptance_runner',
  'sample_monitoring_before_matrix',
  'open_two_relays_public_last',
  'execute_matrix_once',
  'sample_monitoring_after_matrix',
  'remove_acceptance_runner_first',
  'stop_browser_and_coordinator_sessions',
  'restore_two_relays_private_ready',
  'verify_window_cleanup',
]);

export class StagingBrowserRelayOperationError extends Error {
  constructor(message = 'Staging browser-relay live operation is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayOperationError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayOperationError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    reject(`${path} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    reject(`${path} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function rejectOperationPrivateMaterial(value, path = 'value') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains credential material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectOperationPrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
      if ((FORBIDDEN_FIELDS.has(key) || NORMALIZED_FORBIDDEN_FIELDS.has(normalized))
        && !(BOOLEAN_ABSENCE_FIELDS.has(key) && entry === false)) {
        reject(`${path}.${key} is forbidden`);
      }
      rejectOperationPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function validateDependencies(profile) {
  const plan = validateBrowserRelayV13Plan(
    new URL('../browser-relay/plan-v13.json', import.meta.url),
  );
  exact(plan.revision, 13, 'browser-relay plan revision');
  exact(plan.target.cloud_mutation_authorized_by_document, false,
    'browser-relay plan mutation authority');
  exact(plan.target.public_ingress_currently_active, false,
    'browser-relay plan public ingress');
  exact(plan.target.acceptance_executed, false, 'browser-relay plan acceptance state');
  exact(plan.preconditions.map(({ state }) => state), Array(9).fill('satisfied'),
    'browser-relay plan preconditions');
  exact(plan.matrix.map(({ id }) => id), LIVE_CASE_IDS, 'browser-relay plan case IDs');
  exact(plan.matrix.map(({ state }) => state), Array(12).fill('pending'),
    'browser-relay plan matrix state');
  validateBrowserRelayOrchestratorProfile();
  validateOrchestratorPreflightResult();
  validateBrowserRelayRunnerProfile();
  validateBrowserRelayMonitoringProfile();
  validateMonitoringPreflightResult();
  validateBrowserRelayRollbackProfile();
  validateRollbackPreflightResult();
  validateRelayServicesPrivateReadyResult();
  exact(profile.pins.browser_relay_plan_sha256, BROWSER_RELAY_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256');
  exact(profile.pins.orchestrator_profile_sha256, ORCHESTRATOR_PROFILE_SHA256,
    'profile.pins.orchestrator_profile_sha256');
  exact(profile.pins.orchestrator_preflight_result_sha256,
    ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    'profile.pins.orchestrator_preflight_result_sha256');
  exact(profile.pins.runner_profile_sha256, BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    'profile.pins.runner_profile_sha256');
  exact(profile.pins.monitoring_profile_sha256, MONITORING_PROFILE_SHA256,
    'profile.pins.monitoring_profile_sha256');
  exact(profile.pins.monitoring_preflight_result_sha256,
    MONITORING_PREFLIGHT_RESULT_SHA256,
    'profile.pins.monitoring_preflight_result_sha256');
  exact(profile.pins.rollback_profile_sha256, ROLLBACK_PROFILE_SHA256,
    'profile.pins.rollback_profile_sha256');
  exact(profile.pins.rollback_preflight_result_sha256,
    ROLLBACK_PREFLIGHT_RESULT_SHA256,
    'profile.pins.rollback_preflight_result_sha256');
  exact(profile.pins.relay_services_private_ready_result_sha256,
    RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    'profile.pins.relay_services_private_ready_result_sha256');
  exact(
    sha256(readFileSync(new URL('../browser-relay-orchestrator/orchestrator.mjs', import.meta.url))),
    profile.pins.orchestrator_source_sha256,
    'browser-relay orchestrator source',
  );
  exact(
    sha256(readFileSync(new URL('../browser-relay-runner/driver.mjs', import.meta.url))),
    profile.pins.runner_source_sha256,
    'browser-relay runner source',
  );
  exact(
    sha256(readFileSync(new URL('operation.mjs', import.meta.url))),
    profile.pins.operation_source_sha256,
    'browser-relay operation source',
  );
  exact(profile.budgets, {
    maximum_projected_incremental_milli_eur:
      plan.budgets.planned_incremental_upper_bound_eur * 1000,
    maximum_cloud_builds: plan.budgets.maximum_cloud_builds,
    maximum_recaptcha_assessments: plan.budgets.maximum_recaptcha_assessments,
    maximum_control_plane_exchanges: plan.budgets.maximum_control_plane_exchanges,
    maximum_kms_signatures: plan.budgets.maximum_kms_signatures,
    maximum_firestore_writes: plan.budgets.maximum_firestore_writes,
    maximum_relay_services: plan.budgets.maximum_relay_services,
    maximum_instances_per_service: plan.budgets.maximum_instances_per_service,
    maximum_total_relay_instance_seconds: plan.budgets.maximum_total_relay_instance_seconds,
    maximum_control_plane_public_instance_seconds:
      plan.budgets.maximum_control_plane_public_instance_seconds,
    stress_test: false,
  }, 'profile.budgets');
  exact(profile.output.allowed_observations, plan.evidence.allowed_observations,
    'profile.output.allowed_observations');
  exact(profile.output.forbidden_observations, plan.evidence.forbidden_observations,
    'profile.output.forbidden_observations');
}

export function validateBrowserRelayOperationProfile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Live-operation profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  exact(sha256(bytes), OPERATION_PROFILE_SHA256, 'live-operation profile digest');
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Live-operation profile must be valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')) {
    reject('Live-operation profile is not canonical JSON');
  }
  rejectOperationPrivateMaterial(profile, 'profile');
  exact(profile, expectedProfile, 'profile');
  exactKeys(profile, [
    'schema', 'revision', 'state', 'target', 'pins', 'execution', 'budgets',
    'preflight', 'recovery', 'output', 'evidence',
  ], 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-operation-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(profile.state,
    'closed_single_use_live_operation_envelope_preflight_implemented_not_run',
    'profile.state');
  exact(profile.target, {
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
    cloud_mutation_authorized_by_profile: false,
    public_ingress_authorized_by_profile: false,
    acceptance_execution_authorized_by_profile: false,
  }, 'profile.target');
  exactKeys(profile.pins, [
    'implementation_base_commit', 'browser_relay_plan_sha256',
    'orchestrator_profile_sha256', 'orchestrator_preflight_result_sha256',
    'orchestrator_source_sha256', 'runner_profile_sha256', 'runner_source_sha256',
    'monitoring_profile_sha256', 'monitoring_preflight_result_sha256',
    'rollback_profile_sha256', 'rollback_preflight_result_sha256',
    'relay_services_private_ready_result_sha256', 'operation_source_sha256',
  ], 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)) {
    reject('profile.pins.implementation_base_commit is not a full commit');
  }
  exact(profile.pins.implementation_base_commit, OPERATION_IMPLEMENTATION_BASE_COMMIT,
    'profile.pins.implementation_base_commit');
  for (const [key, value] of Object.entries(profile.pins)) {
    if (key !== 'implementation_base_commit' && !SHA256.test(value)) {
      reject(`profile.pins.${key} is not a SHA-256 digest`);
    }
  }
  exact(profile.pins.operation_source_sha256, OPERATION_SOURCE_SHA256,
    'profile.pins.operation_source_sha256');
  exact(profile.preflight, {
    required_observations: [
      'atomic_claim_absent',
      'control_plane_canonical_private',
      'relay_services_exact_private_ready',
      'relay_inventory_matches_pinned_result',
      'relay_service_account_keyless',
      'hosting_runner_route_absent',
      'firebase_auth_users_zero',
      'application_fixture_collections_zero',
      'temporary_acceptance_iam_bindings_zero',
      'fixed_minimum_instances_zero',
      'relay_private_ready_terraform_plan_has_zero_changes',
    ],
    maximum_age_seconds: 900,
    result_schema: OPERATION_PREFLIGHT_RESULT_SCHEMA,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
  }, 'profile.preflight');
  exact(profile.execution, {
    entrypoint: 'in_process_library_only',
    separate_exact_authorization_required: true,
    maximum_operation_executions: 1,
    maximum_claim_creations: 1,
    maximum_edge_window_executions: 1,
    maximum_matrix_executions: 1,
    maximum_browser_invocations: 3,
    maximum_public_window_milliseconds: MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
    maximum_callback_execution_milliseconds: MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS,
    relay_public_transition_is_last_before_matrix: true,
    outer_stages: [
      'run_claimed_edge_orchestrator',
      'remove_synthetic_fixtures_after_canonical_edge',
      'remove_temporary_bindings_after_canonical_edge',
      'verify_complete_canonical_private_cleanup',
    ],
    window_stages: WINDOW_STAGES,
    credentials_persisted: false,
    raw_cloud_responses_persisted: false,
    browser_diagnostics_persisted: false,
  }, 'profile.execution');
  exact(profile.recovery, {
    window_cleanup_always_attempted: true,
    window_cleanup_order: [
      'remove_acceptance_runner',
      'stop_browser_and_coordinator_sessions',
      'restore_two_relays_private_ready',
      'verify_window_cleanup',
    ],
    edge_rollback_owned_by_orchestrator: true,
    post_edge_cleanup_always_attempted: true,
    post_edge_cleanup_order: [
      'remove_synthetic_fixtures',
      'remove_temporary_bindings',
      'verify_complete_canonical_private_cleanup',
    ],
    cleanup_failures_are_never_masked: true,
    required_final_state:
      'canonical_private_relays_private_runner_absent_fixtures_absent',
  }, 'profile.recovery');
  exact(profile.output.matrix_result_schema, MATRIX_RESULT_SCHEMA,
    'profile.output.matrix_result_schema');
  exact(profile.output.window_result_schema, WINDOW_RESULT_SCHEMA,
    'profile.output.window_result_schema');
  exact(profile.output.operation_result_schema, OPERATION_RESULT_SCHEMA,
    'profile.output.operation_result_schema');
  exact(profile.evidence, {
    state: 'absent',
    live_preflight_count: 0,
    live_execution_count: 0,
    claim_creations: 0,
    result_path: null,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
    browser_diagnostics_committed: false,
  }, 'profile.evidence');
  validateDependencies(profile);
  return Object.freeze(profile);
}

export function validateOperationPreflightResultValue(value) {
  rejectOperationPrivateMaterial(value, 'operation_preflight_result');
  validateClosedSize(value, 'operation_preflight_result');
  const result = exactKeys(value, [
    'schema', 'state', 'project_id', 'project_number', 'region', 'observed_at',
    'implementation_commit', 'profile_sha256', 'operation_source_sha256',
    'browser_relay_plan_sha256', 'orchestrator_profile_sha256',
    'orchestrator_preflight_result_sha256', 'claim_bucket', 'claim_object',
    'claim_state', 'control_plane_state', 'control_plane_revision',
    'control_plane_ingress', 'control_plane_public_invokers', 'relay_phase',
    'relay_services', 'relay_public_invokers',
    'relay_service_account_user_managed_keys', 'relay_inventory_sha256',
    'runner_route_present', 'runner_route_status', 'firebase_auth_users',
    'application_fixture_collections', 'temporary_iam_bindings',
    'minimum_instances', 'terraform_convergence',
    'terraform_managed_resource_noops', 'cloud_mutations',
    'public_ingress_changes', 'acceptance_executions',
    'credential_material_retained', 'raw_cloud_responses_retained',
    'terraform_plan_retained',
  ], 'operation_preflight_result');
  exact(result.schema, OPERATION_PREFLIGHT_RESULT_SCHEMA,
    'operation_preflight_result.schema');
  exact(result.state,
    'single_use_live_operation_preflight_succeeded_private_and_unclaimed',
    'operation_preflight_result.state');
  exact(result.project_id, PROJECT_ID, 'operation_preflight_result.project_id');
  exact(result.project_number, PROJECT_NUMBER, 'operation_preflight_result.project_number');
  exact(result.region, REGION, 'operation_preflight_result.region');
  canonicalTimestamp(result.observed_at, 'operation_preflight_result.observed_at');
  if (!COMMIT.test(result.implementation_commit)) {
    reject('operation_preflight_result.implementation_commit is not a full commit');
  }
  exact(result.profile_sha256, OPERATION_PROFILE_SHA256,
    'operation_preflight_result.profile_sha256');
  exact(result.operation_source_sha256, OPERATION_SOURCE_SHA256,
    'operation_preflight_result.operation_source_sha256');
  exact(result.browser_relay_plan_sha256, BROWSER_RELAY_PLAN_SHA256,
    'operation_preflight_result.browser_relay_plan_sha256');
  exact(result.orchestrator_profile_sha256, ORCHESTRATOR_PROFILE_SHA256,
    'operation_preflight_result.orchestrator_profile_sha256');
  exact(result.orchestrator_preflight_result_sha256,
    ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    'operation_preflight_result.orchestrator_preflight_result_sha256');
  exact(result.claim_bucket, ORCHESTRATOR_CLAIM_BUCKET,
    'operation_preflight_result.claim_bucket');
  exact(result.claim_object, ORCHESTRATOR_CLAIM_OBJECT,
    'operation_preflight_result.claim_object');
  exact(result.claim_state, 'absent', 'operation_preflight_result.claim_state');
  exact(result.control_plane_state, 'canonical_private',
    'operation_preflight_result.control_plane_state');
  if (typeof result.control_plane_revision !== 'string'
    || !REVISION.test(result.control_plane_revision)
    || !result.control_plane_revision.startsWith('control-plane-')) {
    reject('operation_preflight_result.control_plane_revision is invalid');
  }
  exact(result.control_plane_ingress, 'ALLOW_INTERNAL_ONLY',
    'operation_preflight_result.control_plane_ingress');
  exact(result.control_plane_public_invokers, 0,
    'operation_preflight_result.control_plane_public_invokers');
  exact(result.relay_phase, 'private_ready', 'operation_preflight_result.relay_phase');
  exact(result.relay_services, 2, 'operation_preflight_result.relay_services');
  exact(result.relay_public_invokers, 0,
    'operation_preflight_result.relay_public_invokers');
  exact(result.relay_service_account_user_managed_keys, 0,
    'operation_preflight_result.relay_service_account_user_managed_keys');
  exact(result.relay_inventory_sha256, RELAY_PRIVATE_READY_INVENTORY_SHA256,
    'operation_preflight_result.relay_inventory_sha256');
  exact(result.runner_route_present, false,
    'operation_preflight_result.runner_route_present');
  exact(result.runner_route_status, 404, 'operation_preflight_result.runner_route_status');
  for (const field of [
    'firebase_auth_users', 'application_fixture_collections',
    'temporary_iam_bindings', 'minimum_instances',
  ]) exact(result[field], 0, `operation_preflight_result.${field}`);
  exact(result.terraform_convergence, 'no_changes',
    'operation_preflight_result.terraform_convergence');
  exact(result.terraform_managed_resource_noops, 4,
    'operation_preflight_result.terraform_managed_resource_noops');
  for (const field of ['cloud_mutations', 'public_ingress_changes', 'acceptance_executions']) {
    exact(result[field], 0, `operation_preflight_result.${field}`);
  }
  for (const field of [
    'credential_material_retained', 'raw_cloud_responses_retained',
    'terraform_plan_retained',
  ]) exact(result[field], false, `operation_preflight_result.${field}`);
  return Object.freeze({ ...result });
}

export function validateOperationPreflightResult(path = preflightResultPath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1
    || entry.size > MAXIMUM_RESULT_BYTES) {
    reject('Operation preflight result must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  exact(sha256(bytes), OPERATION_PREFLIGHT_RESULT_SHA256,
    'operation preflight result digest');
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Operation preflight result must be valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Operation preflight result is not canonical JSON');
  }
  const result = validateOperationPreflightResultValue(value);
  exact(result.implementation_commit, OPERATION_IMPLEMENTATION_COMMIT,
    'operation_preflight_result.implementation_commit');
  return result;
}

export function validateWindowBaseline(value) {
  rejectOperationPrivateMaterial(value, 'window_baseline');
  const baseline = exactKeys(value, [
    'schema', 'state', 'control_plane_public_invokers', 'relay_phase',
    'relay_services', 'relay_public_invokers', 'runner_route_present',
    'firebase_auth_users', 'application_fixture_collections',
    'temporary_iam_bindings', 'current_signing_key_version',
    'published_signing_key_versions',
  ], 'window_baseline');
  exact(baseline, {
    schema: 'miakapp.staging-browser-relay-operation-window-baseline/1',
    state: 'edge_public_pristine',
    control_plane_public_invokers: 1,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    runner_route_present: false,
    firebase_auth_users: 0,
    application_fixture_collections: 0,
    temporary_iam_bindings: 0,
    current_signing_key_version: 1,
    published_signing_key_versions: [1, 2],
  }, 'window_baseline');
  return Object.freeze({ ...baseline });
}

export function validateWindowCleanup(value) {
  rejectOperationPrivateMaterial(value, 'window_cleanup');
  const cleanup = exactKeys(value, [
    'schema', 'state', 'control_plane_public_invokers', 'relay_phase',
    'relay_services', 'relay_public_invokers', 'runner_route_present',
    'active_browser_sessions', 'active_coordinator_sessions',
  ], 'window_cleanup');
  exact(cleanup, {
    schema: 'miakapp.staging-browser-relay-operation-window-cleanup/1',
    state: 'edge_public_window_clean',
    control_plane_public_invokers: 1,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    runner_route_present: false,
    active_browser_sessions: 0,
    active_coordinator_sessions: 0,
  }, 'window_cleanup');
  return Object.freeze({ ...cleanup });
}

export function validateFinalCleanup(value) {
  rejectOperationPrivateMaterial(value, 'final_cleanup');
  const cleanup = exactKeys(value, [
    'schema', 'state', 'control_plane_state', 'control_plane_public_invokers',
    'relay_phase', 'relay_services', 'relay_public_invokers',
    'runner_route_present', 'active_browser_sessions',
    'active_coordinator_sessions', 'firebase_auth_users', 'synthetic_homes',
    'application_fixture_collections', 'temporary_iam_bindings',
    'minimum_instances', 'terraform_convergence',
  ], 'final_cleanup');
  exact(cleanup, {
    schema: 'miakapp.staging-browser-relay-operation-final-cleanup/1',
    state: 'canonical_private_fully_clean',
    control_plane_state: 'canonical_private',
    control_plane_public_invokers: 0,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    runner_route_present: false,
    active_browser_sessions: 0,
    active_coordinator_sessions: 0,
    firebase_auth_users: 0,
    synthetic_homes: 0,
    application_fixture_collections: 0,
    temporary_iam_bindings: 0,
    minimum_instances: 0,
    terraform_convergence: 'no_changes',
  }, 'final_cleanup');
  return Object.freeze({ ...cleanup });
}

function sortedUniqueStrings(value, maximum, path, allowed = null) {
  if (!Array.isArray(value) || value.length > maximum
    || value.some((entry) => typeof entry !== 'string')
    || new Set(value).size !== value.length) {
    reject(`${path} must be a bounded unique string array`);
  }
  const order = allowed ?? [...value].sort();
  const sorted = [...value].sort((left, right) => order.indexOf(left) - order.indexOf(right));
  if (!isDeepStrictEqual(value, sorted)
    || (allowed !== null && value.some((entry) => !allowed.includes(entry)))) {
    reject(`${path} contains an unknown or unordered value`);
  }
  return Object.freeze([...value]);
}

export function validateClosedRunnerResult(value) {
  rejectOperationPrivateMaterial(value, 'runner_result');
  const result = exactKeys(value, [
    'schema', 'state', 'browser_order', 'browser_invocations',
    'assertions_passed', 'assertions_failed', 'duration_milliseconds',
    'counters', 'public_key_ids', 'revision_ids', 'stable_outcome_classes',
    'recordings', 'browser_credentials_persisted', 'engine_results',
  ], 'runner_result');
  exact(result.schema, RUNNER_RESULT_SCHEMA, 'runner_result.schema');
  exact(result.state, 'succeeded_closed_output', 'runner_result.state');
  exact(result.browser_order, BROWSER_ORDER, 'runner_result.browser_order');
  exact(result.browser_invocations, 3, 'runner_result.browser_invocations');
  exact(result.assertions_passed, 40, 'runner_result.assertions_passed');
  exact(result.assertions_failed, 0, 'runner_result.assertions_failed');
  boundedInteger(result.duration_milliseconds, 0, MAXIMUM_TOTAL_MILLISECONDS,
    'runner_result.duration_milliseconds');
  exactKeys(result.counters, Object.keys(COUNTER_MAXIMUMS), 'runner_result.counters');
  for (const [key, maximum] of Object.entries(COUNTER_MAXIMUMS)) {
    boundedInteger(result.counters[key], 0, maximum, `runner_result.counters.${key}`);
  }
  exact(sortedUniqueStrings(result.public_key_ids, 2, 'runner_result.public_key_ids', ['1', '2']),
    ['1', '2'], 'runner_result.public_key_ids');
  const revisions = sortedUniqueStrings(result.revision_ids, 8, 'runner_result.revision_ids');
  if (revisions.length < 3 || revisions.some((revision) => !REVISION.test(revision))
    || !revisions.some((revision) => revision.startsWith('control-plane-'))
    || !revisions.some((revision) => revision.startsWith('miakapp-staging-relay-a-'))
    || !revisions.some((revision) => revision.startsWith('miakapp-staging-relay-b-'))) {
    reject('runner_result.revision_ids does not prove all three services');
  }
  exact(
    sortedUniqueStrings(
      result.stable_outcome_classes,
      OUTCOME_CLASSES.length,
      'runner_result.stable_outcome_classes',
      OUTCOME_CLASSES,
    ),
    OUTCOME_CLASSES,
    'runner_result.stable_outcome_classes',
  );
  exact(result.recordings, {
    trace: false,
    har: false,
    video: false,
    screenshot: false,
    websocket_frame: false,
    browser_console: false,
  }, 'runner_result.recordings');
  exact(result.browser_credentials_persisted, false,
    'runner_result.browser_credentials_persisted');
  if (!Array.isArray(result.engine_results) || result.engine_results.length !== 3) {
    reject('runner_result.engine_results must contain three closed results');
  }
  result.engine_results.forEach((engine, index) => {
    exactKeys(engine, [
      'browser', 'state', 'assertions_passed', 'assertions_failed',
      'duration_milliseconds',
    ], `runner_result.engine_results[${index}]`);
    exact(engine.browser, BROWSER_ORDER[index],
      `runner_result.engine_results[${index}].browser`);
    exact(engine.state, 'succeeded', `runner_result.engine_results[${index}].state`);
    exact(engine.assertions_passed, index === 0 ? 36 : 2,
      `runner_result.engine_results[${index}].assertions_passed`);
    exact(engine.assertions_failed, 0,
      `runner_result.engine_results[${index}].assertions_failed`);
    boundedInteger(engine.duration_milliseconds, 0, index === 0 ? 720_000 : 60_000,
      `runner_result.engine_results[${index}].duration_milliseconds`);
  });
  return result;
}

export function buildClosedMatrixResult(value) {
  const runner = validateClosedRunnerResult(value);
  return Object.freeze({
    schema: MATRIX_RESULT_SCHEMA,
    state: 'succeeded_closed_output',
    browser_order: runner.browser_order,
    browser_invocations: runner.browser_invocations,
    assertions_passed: runner.assertions_passed,
    assertions_failed: runner.assertions_failed,
    duration_milliseconds: runner.duration_milliseconds,
    counters: Object.freeze({ ...runner.counters }),
    public_key_ids: Object.freeze([...runner.public_key_ids]),
    revision_ids: Object.freeze([...runner.revision_ids]),
    stable_outcome_classes: Object.freeze([...runner.stable_outcome_classes]),
    browser_credentials_persisted: false,
  });
}

export function validateClosedMatrixResult(value) {
  rejectOperationPrivateMaterial(value, 'matrix_result');
  const result = exactKeys(value, [
    'schema', 'state', 'browser_order', 'browser_invocations',
    'assertions_passed', 'assertions_failed', 'duration_milliseconds',
    'counters', 'public_key_ids', 'revision_ids', 'stable_outcome_classes',
    'browser_credentials_persisted',
  ], 'matrix_result');
  exact(result.schema, MATRIX_RESULT_SCHEMA, 'matrix_result.schema');
  exact(result.state, 'succeeded_closed_output', 'matrix_result.state');
  exact(result.browser_order, BROWSER_ORDER, 'matrix_result.browser_order');
  exact(result.browser_invocations, 3, 'matrix_result.browser_invocations');
  exact(result.assertions_passed, 40, 'matrix_result.assertions_passed');
  exact(result.assertions_failed, 0, 'matrix_result.assertions_failed');
  boundedInteger(result.duration_milliseconds, 0, MAXIMUM_TOTAL_MILLISECONDS,
    'matrix_result.duration_milliseconds');
  exactKeys(result.counters, Object.keys(COUNTER_MAXIMUMS), 'matrix_result.counters');
  for (const [key, maximum] of Object.entries(COUNTER_MAXIMUMS)) {
    boundedInteger(result.counters[key], 0, maximum, `matrix_result.counters.${key}`);
  }
  exact(sortedUniqueStrings(result.public_key_ids, 2, 'matrix_result.public_key_ids', ['1', '2']),
    ['1', '2'], 'matrix_result.public_key_ids');
  const revisions = sortedUniqueStrings(result.revision_ids, 8, 'matrix_result.revision_ids');
  if (revisions.length < 3 || revisions.some((revision) => !REVISION.test(revision))
    || !revisions.some((revision) => revision.startsWith('control-plane-'))
    || !revisions.some((revision) => revision.startsWith('miakapp-staging-relay-a-'))
    || !revisions.some((revision) => revision.startsWith('miakapp-staging-relay-b-'))) {
    reject('matrix_result.revision_ids does not prove all three services');
  }
  exact(
    sortedUniqueStrings(
      result.stable_outcome_classes,
      OUTCOME_CLASSES.length,
      'matrix_result.stable_outcome_classes',
      OUTCOME_CLASSES,
    ),
    OUTCOME_CLASSES,
    'matrix_result.stable_outcome_classes',
  );
  exact(result.browser_credentials_persisted, false,
    'matrix_result.browser_credentials_persisted');
  return result;
}

export function evaluateOperationMonitoringSample(value) {
  let result;
  try {
    result = evaluateMonitoringSample(value);
  } catch {
    return reject('Live-operation monitoring sample was rejected');
  }
  if (result.state !== 'within_reviewed_bounds'
    || !Array.isArray(result.stop_reasons) || result.stop_reasons.length !== 0) {
    reject('Live-operation monitoring requires stop and rollback');
  }
  return result;
}

function validateClosedSize(value, path) {
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return reject(`${path} is not closed JSON`);
  }
  if (bytes < 2 || bytes > MAXIMUM_RESULT_BYTES) {
    reject(`${path} exceeds the closed JSON boundary`);
  }
}

export function validateOperationWindowResult(value) {
  rejectOperationPrivateMaterial(value, 'window_result');
  validateClosedSize(value, 'window_result');
  const result = exactKeys(value, [
    'schema', 'state', 'baseline', 'monitoring_samples', 'matrix_result',
    'window_cleanup', 'matrix_executions', 'browser_invocations',
    'completed_case_ids', 'credentials_retained',
    'raw_cloud_responses_retained', 'browser_diagnostics_retained',
  ], 'window_result');
  exact(result.schema, WINDOW_RESULT_SCHEMA, 'window_result.schema');
  exact(result.state, 'matrix_succeeded_window_clean', 'window_result.state');
  validateWindowBaseline(result.baseline);
  if (!Array.isArray(result.monitoring_samples) || result.monitoring_samples.length !== 2
    || result.monitoring_samples.some((entry) => entry?.state !== 'within_reviewed_bounds'
      || entry?.phase !== 'public_window'
      || !Array.isArray(entry?.stop_reasons) || entry.stop_reasons.length !== 0)) {
    reject('window_result.monitoring_samples must contain two passing public-window samples');
  }
  validateClosedMatrixResult(result.matrix_result);
  validateWindowCleanup(result.window_cleanup);
  exact(result.matrix_executions, 1, 'window_result.matrix_executions');
  exact(result.browser_invocations, 3, 'window_result.browser_invocations');
  exact(result.completed_case_ids, WINDOW_CASE_IDS, 'window_result.completed_case_ids');
  for (const field of [
    'credentials_retained', 'raw_cloud_responses_retained', 'browser_diagnostics_retained',
  ]) exact(result[field], false, `window_result.${field}`);
  return result;
}

export function validateOperationResult(value) {
  rejectOperationPrivateMaterial(value, 'operation_result');
  validateClosedSize(value, 'operation_result');
  const result = exactKeys(value, [
    'schema', 'state', 'claim_creations', 'edge_window_executions',
    'matrix_executions', 'browser_invocations', 'public_window_milliseconds',
    'maximum_public_window_milliseconds', 'rollback_reconciled_failures',
    'completed_case_ids', 'window_result', 'final_cleanup',
    'credentials_retained', 'raw_cloud_responses_retained',
    'browser_diagnostics_retained',
  ], 'operation_result');
  exact(result.schema, OPERATION_RESULT_SCHEMA, 'operation_result.schema');
  exact(result.state, 'completed_once_fully_clean', 'operation_result.state');
  exact(result.claim_creations, 1, 'operation_result.claim_creations');
  exact(result.edge_window_executions, 1, 'operation_result.edge_window_executions');
  exact(result.matrix_executions, 1, 'operation_result.matrix_executions');
  exact(result.browser_invocations, 3, 'operation_result.browser_invocations');
  boundedInteger(result.public_window_milliseconds, 0, MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
    'operation_result.public_window_milliseconds');
  exact(result.maximum_public_window_milliseconds, MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
    'operation_result.maximum_public_window_milliseconds');
  boundedInteger(result.rollback_reconciled_failures, 0, 32,
    'operation_result.rollback_reconciled_failures');
  exact(result.completed_case_ids, LIVE_CASE_IDS, 'operation_result.completed_case_ids');
  validateOperationWindowResult(result.window_result);
  validateFinalCleanup(result.final_cleanup);
  for (const field of [
    'credentials_retained', 'raw_cloud_responses_retained', 'browser_diagnostics_retained',
  ]) exact(result[field], false, `operation_result.${field}`);
  return result;
}

export const operationCaseIds = LIVE_CASE_IDS;
export const operationWindowCaseIds = WINDOW_CASE_IDS;
