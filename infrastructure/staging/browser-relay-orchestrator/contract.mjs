import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';
import {
  MONITORING_PREFLIGHT_RESULT_SHA256,
  MONITORING_PROFILE_SHA256,
  validateBrowserRelayMonitoringProfile,
  validateMonitoringPreflightResult,
} from '../browser-relay-monitoring/contract.mjs';
import {
  ROLLBACK_PREFLIGHT_RESULT_SHA256,
  ROLLBACK_PROFILE_SHA256,
  RELAY_PRIVATE_READY_INVENTORY_SHA256,
  validateBrowserRelayRollbackProfile,
  validateRollbackPreflightResult,
} from '../browser-relay-rollback/contract.mjs';
import {
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  validateBrowserRelayRunnerProfile,
} from '../browser-relay-runner/contract.mjs';
import {
  RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
  RELAY_SERVICES_PROFILE_SHA256,
  STATE_BUCKET,
  validateRelayServicesPrivateReadyResult,
  validateRelayServicesProfile,
} from '../browser-relay-services/contract.mjs';
import { validateBrowserRelayEdgeRoot } from '../browser-relay-edge/guard.mjs';

export { BROWSER_RELAY_PLAN_SHA256 };

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const ORCHESTRATOR_PROFILE_PATH = 'browser-relay-orchestrator/profile.json';
export const ORCHESTRATOR_PROFILE_SHA256 =
  '76b4e6bc718e44d71ee4b5f19376e3ec7df28d304384c2736294f1874349a6da';
export const ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT =
  'fb8291d79ca381c253b1237ea99bf8b0930bada7';
export const ORCHESTRATOR_CLAIM_BUCKET = STATE_BUCKET;
export const ORCHESTRATOR_CLAIM_OBJECT =
  'browser-relay/operations/acceptance-v1.json';
export const ORCHESTRATOR_PREFLIGHT_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-orchestrator-preflight-result/1';
export const ORCHESTRATOR_CLAIM_SCHEMA =
  'miakapp.staging-browser-relay-orchestrator-claim/1';
export const ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA =
  'miakapp.staging-browser-relay-orchestrator-claim-receipt/1';
export const MAXIMUM_PUBLIC_WINDOW_MILLISECONDS = 1_200_000;
export const MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS = 900_000;

const profilePath = new URL('profile.json', import.meta.url);
const expectedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
const MAXIMUM_FILE_BYTES = 32 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
]);
const FORBIDDEN_FIELD_NAMES = new Set([
  'access_token',
  'app_check_token',
  'authorization',
  'cookie',
  'email',
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
  'secret_value',
  'token',
  'trace_context',
  'video',
  'websocket_frame',
]);
const FORBIDDEN_FIELD_NAMES_NORMALIZED = new Set(
  [...FORBIDDEN_FIELD_NAMES].map((name) => name.replaceAll('_', '')),
);
const EDGE_SOURCE_DIGESTS = Object.freeze({
  'cloud.mjs': '1cfe0dba18bcf74bcec1fda1956f7ee72a0b4f7928a9c569ae6e76872425a2df',
  'guard.mjs': '86bea41832a21a44f0376f89332bfa9a897f2e8728b4696dd2bbcb50d9034b68',
  'inventory.mjs': '006618acf57791367f49bc52c3d683c1cdcc3b301e65c738569f6ac5f076f83c',
  'runtime.mjs': '7a446e63faeefd1e269f80422ca9d4fe244fb71256e5e48cc3bef65a235ba880',
  'window.mjs': 'b7ee57a47b6b4663b0f3356fc09d11efb98e288c9adfb851912ed53f8b00be50',
});
const SATISFIED_PRECONDITIONS = Object.freeze([
  'PIN-01',
  'SIGNING-01',
  'APP-CHECK-01',
  'ROTATION-ENTRY-01',
  'RELAY-01',
  'RUNNER-01',
  'MONITORING-01',
  'ROLLBACK-01',
]);

export class StagingBrowserRelayOrchestratorError extends Error {
  constructor(message = 'Staging browser-relay orchestrator contract is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayOrchestratorError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayOrchestratorError(message);
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

export function rejectOrchestratorPrivateMaterial(value, path = 'value') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains credential material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      rejectOrchestratorPrivateMaterial(entry, `${path}[${index}]`)
    ));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
      if (FORBIDDEN_FIELD_NAMES.has(key)
        || FORBIDDEN_FIELD_NAMES_NORMALIZED.has(normalizedKey)) {
        reject(`${path}.${key} is forbidden`);
      }
      rejectOrchestratorPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function validateDependencyPins(pins) {
  exactKeys(pins, [
    'implementation_base_commit',
    'browser_relay_plan_sha256',
    'runner_profile_sha256',
    'monitoring_profile_sha256',
    'monitoring_preflight_result_sha256',
    'rollback_profile_sha256',
    'rollback_preflight_result_sha256',
    'relay_services_profile_sha256',
    'relay_services_private_ready_result_sha256',
    'relay_services_live_inventory_sha256',
    'edge_cloud_sha256',
    'edge_guard_sha256',
    'edge_inventory_sha256',
    'edge_runtime_sha256',
    'edge_window_sha256',
  ], 'profile.pins');
  if (!COMMIT.test(pins.implementation_base_commit)) {
    reject('profile.pins.implementation_base_commit is not a full commit');
  }
  for (const [key, value] of Object.entries(pins)) {
    if (key !== 'implementation_base_commit' && !SHA256.test(value)) {
      reject(`profile.pins.${key} is not a SHA-256 digest`);
    }
  }
  exact(pins.implementation_base_commit, ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
    'profile.pins.implementation_base_commit');
  exact(pins.browser_relay_plan_sha256, BROWSER_RELAY_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256');
  exact(pins.runner_profile_sha256, BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    'profile.pins.runner_profile_sha256');
  exact(pins.monitoring_profile_sha256, MONITORING_PROFILE_SHA256,
    'profile.pins.monitoring_profile_sha256');
  exact(pins.monitoring_preflight_result_sha256, MONITORING_PREFLIGHT_RESULT_SHA256,
    'profile.pins.monitoring_preflight_result_sha256');
  exact(pins.rollback_profile_sha256, ROLLBACK_PROFILE_SHA256,
    'profile.pins.rollback_profile_sha256');
  exact(pins.rollback_preflight_result_sha256, ROLLBACK_PREFLIGHT_RESULT_SHA256,
    'profile.pins.rollback_preflight_result_sha256');
  exact(pins.relay_services_profile_sha256, RELAY_SERVICES_PROFILE_SHA256,
    'profile.pins.relay_services_profile_sha256');
  exact(pins.relay_services_private_ready_result_sha256,
    RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    'profile.pins.relay_services_private_ready_result_sha256');
  exact(pins.relay_services_live_inventory_sha256, RELAY_PRIVATE_READY_INVENTORY_SHA256,
    'profile.pins.relay_services_live_inventory_sha256');
  for (const [name, digest] of Object.entries(EDGE_SOURCE_DIGESTS)) {
    const field = `edge_${name.replace('.mjs', '')}_sha256`;
    exact(pins[field], digest, `profile.pins.${field}`);
    const bytes = readFileSync(new URL(`../browser-relay-edge/${name}`, import.meta.url));
    exact(sha256(bytes), digest, `browser-relay-edge/${name}`);
  }
}

function validateDependencies(profile) {
  const plan = validateBrowserRelayPlan(
    new URL('../browser-relay/plan.json', import.meta.url),
  );
  exact(plan.revision, 12, 'browser-relay plan revision');
  exact(
    plan.preconditions.filter(({ state }) => state === 'satisfied').map(({ id }) => id),
    SATISFIED_PRECONDITIONS,
    'browser-relay satisfied preconditions',
  );
  exact(
    plan.preconditions.filter(({ state }) => state === 'open').map(({ id }) => id),
    ['EDGE-01'],
    'browser-relay open precondition',
  );
  exact(profile.preflight.required_satisfied_preconditions, SATISFIED_PRECONDITIONS,
    'profile.preflight.required_satisfied_preconditions');
  exact(profile.preflight.required_open_precondition, 'EDGE-01',
    'profile.preflight.required_open_precondition');
  validateBrowserRelayRunnerProfile();
  validateBrowserRelayMonitoringProfile();
  validateMonitoringPreflightResult();
  validateBrowserRelayRollbackProfile();
  validateRollbackPreflightResult();
  validateRelayServicesProfile();
  validateRelayServicesPrivateReadyResult();
  validateBrowserRelayEdgeRoot(new URL('../browser-relay-edge/', import.meta.url));
}

export function validateBrowserRelayOrchestratorProfile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1
    || entry.size > MAXIMUM_FILE_BYTES) {
    reject('Orchestrator profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  exact(sha256(bytes), ORCHESTRATOR_PROFILE_SHA256, 'orchestrator profile digest');
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Orchestrator profile must be valid JSON');
  }
  if (canonicalJson(profile) !== bytes.toString('utf8')) {
    reject('Orchestrator profile is not canonical JSON');
  }
  rejectOrchestratorPrivateMaterial(profile, 'profile');
  exact(profile, expectedProfile, 'profile');
  exactKeys(profile, [
    'schema', 'revision', 'state', 'target', 'pins', 'claim', 'preflight',
    'execution', 'recovery', 'evidence',
  ], 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-orchestrator-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(profile.state, 'closed_single_use_edge_orchestrator_implemented_not_preflighted',
    'profile.state');
  exact(profile.target, {
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    cloud_compute_resources: 0,
    unscheduled: true,
    cloud_mutation_authorized_by_profile: false,
    public_ingress_authorized_by_profile: false,
    acceptance_execution_authorized_by_profile: false,
  }, 'profile.target');
  validateDependencyPins(profile.pins);
  exact(profile.claim, {
    bucket: ORCHESTRATOR_CLAIM_BUCKET,
    object: ORCHESTRATOR_CLAIM_OBJECT,
    if_generation_match: 0,
    maximum_creations: 1,
    claim_precedes_first_cloud_mutation: true,
    baseline_reobserved_after_claim: true,
    ambiguous_creation_allows_execution: false,
    retained: true,
    retry_authorized: false,
    deletion_authorized: false,
  }, 'profile.claim');
  exact(profile.preflight, {
    required_satisfied_preconditions: SATISFIED_PRECONDITIONS,
    required_open_precondition: 'EDGE-01',
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
    result_schema: ORCHESTRATOR_PREFLIGHT_RESULT_SCHEMA,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
  }, 'profile.preflight');
  exact(profile.execution, {
    entrypoint: 'in_process_library_only',
    separate_exact_authorization_required: true,
    maximum_claim_creations: 1,
    maximum_edge_window_executions: 1,
    maximum_public_window_milliseconds: MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
    maximum_callback_execution_milliseconds: MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS,
    maximum_callback_invocations: 1,
    stages: [
      'validate_exact_authorization_and_pins',
      'observe_atomic_claim_absence',
      'observe_canonical_private_baseline',
      'create_atomic_single_use_claim',
      'reobserve_unchanged_canonical_private_baseline',
      'run_one_bounded_edge_window',
      'verify_canonical_private_postflight',
    ],
    allowed_edge_states: [
      'canonical_private',
      'edge_private',
      'edge_ingress_ready',
      'edge_public',
    ],
    callback_result_boundary: 'closed_sanitized_aggregate_only',
    credentials_persisted: false,
    raw_cloud_responses_persisted: false,
    browser_diagnostics_persisted: false,
  }, 'profile.execution');
  exact(profile.recovery, {
    automatic_edge_rollback: true,
    public_invoker_removed_before_private_ingress: true,
    private_ingress_restored_before_canonical_runtime: true,
    iam_independent_emergency_ingress_closure: true,
    ambiguous_claim_stops_before_edge_mutation: true,
    postflight_required_after_window_failure: true,
    required_final_state: 'canonical_private',
  }, 'profile.recovery');
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

export function validateOrchestratorPreflightResultValue(value) {
  rejectOrchestratorPrivateMaterial(value, 'preflight_result');
  const result = exactKeys(value, [
    'schema', 'state', 'project_id', 'project_number', 'region', 'observed_at',
    'implementation_commit', 'profile_sha256', 'browser_relay_plan_sha256',
    'claim_bucket', 'claim_object', 'claim_state', 'control_plane_state',
    'control_plane_revision', 'control_plane_ingress',
    'control_plane_public_invokers', 'relay_phase', 'relay_services',
    'relay_public_invokers', 'relay_service_account_user_managed_keys',
    'relay_inventory_sha256', 'runner_route_present', 'runner_route_status',
    'firebase_auth_users', 'application_fixture_collections',
    'temporary_iam_bindings', 'minimum_instances', 'terraform_convergence',
    'terraform_managed_resource_noops', 'monitoring_preflight_result_sha256',
    'rollback_preflight_result_sha256', 'cloud_mutations',
    'public_ingress_changes', 'acceptance_executions',
    'credential_material_retained', 'raw_cloud_responses_retained',
    'terraform_plan_retained',
  ], 'preflight_result');
  exact(result.schema, ORCHESTRATOR_PREFLIGHT_RESULT_SCHEMA, 'preflight_result.schema');
  exact(result.state, 'single_use_edge_orchestrator_preflight_succeeded_private_and_unclaimed',
    'preflight_result.state');
  exact(result.project_id, PROJECT_ID, 'preflight_result.project_id');
  exact(result.project_number, PROJECT_NUMBER, 'preflight_result.project_number');
  exact(result.region, REGION, 'preflight_result.region');
  canonicalTimestamp(result.observed_at, 'preflight_result.observed_at');
  if (!COMMIT.test(result.implementation_commit)) {
    reject('preflight_result.implementation_commit is not a full commit');
  }
  exact(result.profile_sha256, ORCHESTRATOR_PROFILE_SHA256,
    'preflight_result.profile_sha256');
  exact(result.browser_relay_plan_sha256, BROWSER_RELAY_PLAN_SHA256,
    'preflight_result.browser_relay_plan_sha256');
  exact(result.claim_bucket, ORCHESTRATOR_CLAIM_BUCKET,
    'preflight_result.claim_bucket');
  exact(result.claim_object, ORCHESTRATOR_CLAIM_OBJECT,
    'preflight_result.claim_object');
  exact(result.claim_state, 'absent', 'preflight_result.claim_state');
  exact(result.control_plane_state, 'canonical_private',
    'preflight_result.control_plane_state');
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
  exact(result.monitoring_preflight_result_sha256, MONITORING_PREFLIGHT_RESULT_SHA256,
    'preflight_result.monitoring_preflight_result_sha256');
  exact(result.rollback_preflight_result_sha256, ROLLBACK_PREFLIGHT_RESULT_SHA256,
    'preflight_result.rollback_preflight_result_sha256');
  for (const field of [
    'credential_material_retained', 'raw_cloud_responses_retained',
    'terraform_plan_retained',
  ]) exact(result[field], false, `preflight_result.${field}`);
  if (typeof result.control_plane_revision !== 'string'
    || !/^control-plane-[0-9]{5}-[a-z]{3}$/u.test(result.control_plane_revision)) {
    reject('preflight_result.control_plane_revision is invalid');
  }
  return Object.freeze(result);
}

export function validateClaimTimestamp(value, path) {
  return canonicalTimestamp(value, path);
}

export function validateClaimInteger(value, minimum, maximum, path) {
  return boundedInteger(value, minimum, maximum, path);
}
