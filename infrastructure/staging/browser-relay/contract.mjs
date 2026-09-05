import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const BROWSER_RELAY_PLAN_SHA256 = '900bee3c4ba365bcf76da2e0c2d1510c1dc8921d1f32c99847c94a19f301ede5';
export const BROWSER_RELAY_PLAN_PATH = 'browser-relay/plan.json';

const MAXIMUM_PLAN_BYTES = 16 * 1024;
const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PRIVATE_MATERIAL = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
];
const FORBIDDEN_FIELD_NAMES = new Set([
  'access_token',
  'app_check_token',
  'authorization',
  'cookie',
  'firebase_id_token',
  'home_key',
  'id_token',
  'password',
  'private_key',
  'refresh_token',
  'request_headers',
  'response_headers',
  'secret_value',
]);

const expectedPlan = JSON.parse(
  readFileSync(new URL('plan.json', import.meta.url), 'utf8'),
);

export class StagingBrowserRelayPlanError extends Error {
  constructor(message = 'Staging browser-relay plan is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayPlanError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayPlanError(message);
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

function rejectPrivateMaterial(value, path = 'plan') {
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
      if (FORBIDDEN_FIELD_NAMES.has(key)) reject(`${path}.${key} is a credential field`);
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function validateTarget(value) {
  const target = exactKeys(value, [
    'project_id',
    'project_number',
    'region',
    'data_policy',
    'forbidden_project_ids',
    'cloud_mutation_authorized_by_document',
    'public_ingress_currently_active',
    'acceptance_executed',
  ], 'target');
  exact(target.project_id, 'miakapp-v4-staging', 'target.project_id');
  exact(target.project_number, '1072737219170', 'target.project_number');
  exact(target.region, 'europe-west9', 'target.region');
  exact(target.data_policy, 'synthetic_only', 'target.data_policy');
  exact(target.forbidden_project_ids, [
    'demo-miakapp-v4',
    'miakapp-3',
    'miakapp-v4',
  ], 'target.forbidden_project_ids');
  exact(target.cloud_mutation_authorized_by_document, false, 'target.cloud_mutation_authorized_by_document');
  exact(target.public_ingress_currently_active, false, 'target.public_ingress_currently_active');
  exact(target.acceptance_executed, false, 'target.acceptance_executed');
}

function validatePins(value) {
  const pins = exactKeys(value, [
    'miakapp_v3_commit',
    'deployed_control_plane_commit',
    'deployed_control_plane_source_sha256',
    'miakapi_commit',
    'miakapp_server_commit',
    'protocol_contract_commit',
    'node_version',
    'bun_version',
    'go_version',
    'playwright_version',
    'terraform_version',
  ], 'pins');
  for (const field of [
    'miakapp_v3_commit',
    'deployed_control_plane_commit',
    'miakapi_commit',
    'miakapp_server_commit',
    'protocol_contract_commit',
  ]) {
    if (!COMMIT.test(pins[field])) reject(`pins.${field} must be a full commit`);
  }
  if (!SHA256.test(pins.deployed_control_plane_source_sha256)) {
    reject('pins.deployed_control_plane_source_sha256 must be a SHA-256 digest');
  }
  exact(pins, expectedPlan.pins, 'pins');
}

function validateBaseline(value) {
  const baseline = exactKeys(value, [
    'observed_at',
    'control_plane',
    'hosting',
    'app_check',
    'cloud_run_services',
    'relay_services',
    'browser_runner_present',
    'app_engine_application_present',
  ], 'baseline');
  exact(baseline, expectedPlan.baseline, 'baseline');
  exact(baseline.control_plane.ingress, 'ALLOW_INTERNAL_ONLY', 'baseline.control_plane.ingress');
  exact(baseline.control_plane.unauthenticated_invokers, 0, 'baseline.control_plane.unauthenticated_invokers');
  exact(baseline.control_plane.runtime_schema, 'miakapp.production-runtime/1', 'baseline.control_plane.runtime_schema');
  exact(baseline.control_plane.security_schema, 'miakapp.production-security/1', 'baseline.control_plane.security_schema');
  exact(baseline.control_plane.published_signing_keys, 1, 'baseline.control_plane.published_signing_keys');
  exact(baseline.control_plane.overlap_schema_supported_by_source, true, 'baseline.control_plane.overlap_schema_supported_by_source');
  exact(baseline.relay_services, 0, 'baseline.relay_services');
  exact(baseline.browser_runner_present, false, 'baseline.browser_runner_present');
  exact(baseline.app_engine_application_present, false, 'baseline.app_engine_application_present');
  exact(baseline.app_check.browser_attestation_validated, false, 'baseline.app_check.browser_attestation_validated');
}

function validateRelay(value, expected, path) {
  const relay = exactKeys(value, [
    'id',
    'service_name',
    'endpoint_before_apply',
    'endpoint_source',
    'websocket_path',
    'health_path',
    'ingress',
    'unauthenticated_invoker',
    'application_authentication',
    'allowed_origin',
    'service_account',
    'runtime_iam_roles',
    'minimum_instances',
    'maximum_instances',
    'concurrency',
    'request_timeout_seconds',
    'cpu',
    'memory_mib',
    'cpu_idle',
  ], path);
  exact(relay, expected, path);
  exact(relay.endpoint_before_apply, null, `${path}.endpoint_before_apply`);
  exact(relay.runtime_iam_roles, [], `${path}.runtime_iam_roles`);
  exact(relay.minimum_instances, 0, `${path}.minimum_instances`);
  exact(relay.maximum_instances, 1, `${path}.maximum_instances`);
  exact(relay.unauthenticated_invoker, true, `${path}.unauthenticated_invoker`);
  exact(relay.application_authentication, 'audience_bound_relay_user_hello', `${path}.application_authentication`);
}

function validateTopology(value) {
  const topology = exactKeys(value, [
    'profile',
    'application',
    'control_plane_edge',
    'relays',
    'runner',
    'fixed_cost_services',
  ], 'topology');
  exact(topology.profile, 'temporary_public_provider_endpoints', 'topology.profile');
  exact(topology.application, expectedPlan.topology.application, 'topology.application');
  exact(topology.control_plane_edge, expectedPlan.topology.control_plane_edge, 'topology.control_plane_edge');
  exact(topology.control_plane_edge.maximum_public_window_seconds, 1200, 'topology.control_plane_edge.maximum_public_window_seconds');
  exact(topology.control_plane_edge.ingress_before, 'ALLOW_INTERNAL_ONLY', 'topology.control_plane_edge.ingress_before');
  exact(topology.control_plane_edge.ingress_during, 'ALLOW_ALL', 'topology.control_plane_edge.ingress_during');
  exact(topology.control_plane_edge.ingress_after, 'ALLOW_INTERNAL_ONLY', 'topology.control_plane_edge.ingress_after');
  exact(topology.control_plane_edge.unauthenticated_invokers_after, 0, 'topology.control_plane_edge.unauthenticated_invokers_after');
  if (!Array.isArray(topology.relays) || topology.relays.length !== 2) {
    reject('topology.relays must contain exactly two relays');
  }
  topology.relays.forEach((relay, index) => validateRelay(
    relay,
    expectedPlan.topology.relays[index],
    `topology.relays[${index}]`,
  ));
  exact(topology.runner, expectedPlan.topology.runner, 'topology.runner');
  exact(topology.runner.cloud_compute_resources, 0, 'topology.runner.cloud_compute_resources');
  exact(topology.runner.unscheduled, true, 'topology.runner.unscheduled');
  exact(topology.runner.maximum_invocations, 3, 'topology.runner.maximum_invocations');
  exact(Object.values(topology.fixed_cost_services).every((entry) => entry === false), true, 'topology.fixed_cost_services');
  exact(topology.fixed_cost_services, expectedPlan.topology.fixed_cost_services, 'topology.fixed_cost_services');
}

function validateBudgets(value) {
  const budgets = exactKeys(value, [
    'currency',
    'authorized_monthly_incremental_eur',
    'planned_incremental_upper_bound_eur',
    'free_tier_assumed',
    'stress_test',
    'maximum_public_window_seconds',
    'maximum_acceptance_executions',
    'maximum_cloud_builds',
    'maximum_browser_invocations',
    'maximum_recaptcha_assessments',
    'maximum_control_plane_exchanges',
    'maximum_kms_signatures',
    'maximum_firestore_writes',
    'maximum_relay_services',
    'maximum_instances_per_service',
    'maximum_total_relay_instance_seconds',
    'maximum_control_plane_public_instance_seconds',
    'stop_conditions',
  ], 'budgets');
  exact(budgets, expectedPlan.budgets, 'budgets');
  exact(budgets.currency, 'EUR', 'budgets.currency');
  exact(budgets.authorized_monthly_incremental_eur, 5, 'budgets.authorized_monthly_incremental_eur');
  exact(budgets.planned_incremental_upper_bound_eur, 1, 'budgets.planned_incremental_upper_bound_eur');
  exact(budgets.free_tier_assumed, false, 'budgets.free_tier_assumed');
  exact(budgets.stress_test, false, 'budgets.stress_test');
  exact(budgets.maximum_public_window_seconds, 1200, 'budgets.maximum_public_window_seconds');
  exact(budgets.maximum_acceptance_executions, 1, 'budgets.maximum_acceptance_executions');
  exact(budgets.maximum_relay_services, 2, 'budgets.maximum_relay_services');
  exact(budgets.maximum_instances_per_service, 1, 'budgets.maximum_instances_per_service');
}

function validatePreconditions(value) {
  if (!Array.isArray(value) || value.length !== 8) {
    reject('preconditions must contain exactly eight entries');
  }
  value.forEach((entry, index) => {
    exactKeys(entry, ['id', 'state', 'requirement'], `preconditions[${index}]`);
    exact(entry, expectedPlan.preconditions[index], `preconditions[${index}]`);
  });
  exact(value.filter(({ state }) => state === 'satisfied').map(({ id }) => id), ['PIN-01'], 'satisfied preconditions');
  exact(value.filter(({ state }) => state === 'open').length, 7, 'open precondition count');
}

function validateMatrix(value) {
  if (!Array.isArray(value) || value.length !== 12) {
    reject('matrix must contain exactly LIVE-01 through LIVE-12');
  }
  value.forEach((entry, index) => {
    exactKeys(entry, ['id', 'state', 'maximum_runs', 'assertions'], `matrix[${index}]`);
    exact(entry, expectedPlan.matrix[index], `matrix[${index}]`);
    exact(entry.id, `LIVE-${String(index + 1).padStart(2, '0')}`, `matrix[${index}].id`);
    exact(entry.state, 'pending', `matrix[${index}].state`);
    exact(entry.maximum_runs, 1, `matrix[${index}].maximum_runs`);
    if (!Array.isArray(entry.assertions) || entry.assertions.length < 3) {
      reject(`matrix[${index}].assertions is incomplete`);
    }
  });
}

function validateSigningRotation(value) {
  const rotation = exactKeys(value, [
    'state',
    'token_lease_seconds',
    'prepublication_seconds',
    'retiring_key_retention_seconds',
    'published_keys_before',
    'published_keys_during_overlap',
    'published_keys_after_retirement',
    'prior_key_after_retirement',
    'ordinary_rollback',
    'republish_removed_private_key',
  ], 'signing_rotation');
  exact(rotation, expectedPlan.signing_rotation, 'signing_rotation');
  exact(rotation.state, 'blocked_by_single_published_key_runtime_config', 'signing_rotation.state');
  exact(rotation.token_lease_seconds, 300, 'signing_rotation.token_lease_seconds');
  exact(rotation.prepublication_seconds, 60, 'signing_rotation.prepublication_seconds');
  exact(rotation.retiring_key_retention_seconds, 330, 'signing_rotation.retiring_key_retention_seconds');
  exact(rotation.published_keys_during_overlap, 2, 'signing_rotation.published_keys_during_overlap');
  exact(rotation.republish_removed_private_key, false, 'signing_rotation.republish_removed_private_key');
}

function validateEvidence(value) {
  const evidence = exactKeys(value, [
    'state',
    'committed_result_path',
    'completed_case_ids',
    'allowed_observations',
    'forbidden_observations',
  ], 'evidence');
  exact(evidence, expectedPlan.evidence, 'evidence');
  exact(evidence.state, 'absent', 'evidence.state');
  exact(evidence.committed_result_path, null, 'evidence.committed_result_path');
  exact(evidence.completed_case_ids, [], 'evidence.completed_case_ids');
}

function validateRollback(value) {
  const rollback = exactKeys(value, [
    'state',
    'ordered_steps',
    'required_final_state',
  ], 'rollback');
  exact(rollback, expectedPlan.rollback, 'rollback');
  exact(rollback.state, 'designed_not_executed', 'rollback.state');
  exact(rollback.required_final_state.control_plane_ingress, 'ALLOW_INTERNAL_ONLY', 'rollback.required_final_state.control_plane_ingress');
  exact(rollback.required_final_state.control_plane_unauthenticated_invokers, 0, 'rollback.required_final_state.control_plane_unauthenticated_invokers');
  exact(rollback.required_final_state.relay_services, 0, 'rollback.required_final_state.relay_services');
  exact(rollback.required_final_state.miakapp_3_touched, false, 'rollback.required_final_state.miakapp_3_touched');
}

export function validateBrowserRelayPlanValue(value) {
  rejectPrivateMaterial(value);
  const plan = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'baseline',
    'topology',
    'budgets',
    'preconditions',
    'matrix',
    'signing_rotation',
    'evidence',
    'rollback',
  ], 'plan');
  exact(plan.schema, 'miakapp.staging-browser-relay-plan/1', 'plan.schema');
  exact(plan.revision, 2, 'plan.revision');
  exact(plan.state, 'reviewed_not_deployed', 'plan.state');
  validateTarget(plan.target);
  validatePins(plan.pins);
  validateBaseline(plan.baseline);
  validateTopology(plan.topology);
  validateBudgets(plan.budgets);
  validatePreconditions(plan.preconditions);
  validateMatrix(plan.matrix);
  validateSigningRotation(plan.signing_rotation);
  validateEvidence(plan.evidence);
  validateRollback(plan.rollback);
  if (!isDeepStrictEqual(plan, expectedPlan)) reject('plan fields have drifted');
  return Object.freeze(plan);
}

export function validateBrowserRelayPlan(path) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PLAN_BYTES) {
    reject('plan must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== BROWSER_RELAY_PLAN_SHA256) {
    reject('plan digest does not match the reviewed design');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('plan is not valid JSON');
  }
  if (`${JSON.stringify(plan, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('plan is not in exact canonical JSON form');
  }
  return validateBrowserRelayPlanValue(plan);
}
