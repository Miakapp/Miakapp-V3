import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
  RELAY_SERVICES_PROFILE_SHA256,
  RELAY_SERVICES_V5_PROFILE_SHA256,
} from '../browser-relay-services/contract.mjs';
import {
  MONITORING_IMPLEMENTATION_COMMIT,
  MONITORING_PREFLIGHT_RESULT_SHA256,
  MONITORING_PROFILE_SHA256,
} from '../browser-relay-monitoring/contract.mjs';
import { BROWSER_RELAY_RUNNER_PROFILE_SHA256 } from '../browser-relay-runner/contract.mjs';
import { BROWSER_RELAY_PAGE_V2_PROFILE_SHA256 } from '../browser-relay-page/contract.mjs';

export const BROWSER_RELAY_V8_PLAN_SHA256 = '4a5c13999d9f7f328b1b8b867bbd86d4c5e80cb980d9eb1324028ea0e5785343';
export const BROWSER_RELAY_V8_PLAN_PATH = 'browser-relay/plan-v8.json';
export const BROWSER_RELAY_V9_PLAN_SHA256 = 'bdf2cea284b1031a2a78e3ab029a733cad5e68efde8e9e01c5230e01fe8333dc';
export const BROWSER_RELAY_V9_PLAN_PATH = 'browser-relay/plan-v9.json';
export const BROWSER_RELAY_V10_PLAN_SHA256 = '614493a6ffd1c8c45044585368ae21eefa82afb65f031d2fd4e9028b215098da';
export const BROWSER_RELAY_V10_PLAN_PATH = 'browser-relay/plan-v10.json';
export const BROWSER_RELAY_V11_PLAN_SHA256 = '607fd1cf84c56c5becf870b6ca38b3721ab7cc5ec750f7374363f5ae2cc63fe6';
export const BROWSER_RELAY_V11_PLAN_PATH = 'browser-relay/plan-v11.json';
export const BROWSER_RELAY_V12_PLAN_SHA256 = 'b279f69cb91e8b20a96b3b45986cdc7f627f354eb541c881714bfcf0c38f2a20';
export const BROWSER_RELAY_V12_PLAN_PATH = 'browser-relay/plan-v12.json';
export const BROWSER_RELAY_V13_PLAN_SHA256 = 'a74a130f3946c7beaca8c2f019f36b1641f1fa47e4c8b63c24754892a18d702a';
export const BROWSER_RELAY_V13_PLAN_PATH = 'browser-relay/plan-v13.json';
export const BROWSER_RELAY_V14_PLAN_SHA256 = 'dbf0e73a20875353f28466b4fe1edcb8e8d1fc6604d979002b36a7610c36aa9a';
export const BROWSER_RELAY_V14_PLAN_PATH = 'browser-relay/plan-v14.json';
export const BROWSER_RELAY_PLAN_SHA256 = '6c7661d9be861e4f8d13ccd5d2fd0f3eaa34ea2b4d7af2e9b41d1867d6c37211';
export const BROWSER_RELAY_PLAN_PATH = 'browser-relay/plan.json';
export const BROWSER_RELAY_PAGE_CI_MERGE_COMMIT =
  'f8918874a0860ae3ae95ec03185169d4fc6bee77';

const MAXIMUM_PLAN_BYTES = 20 * 1024;
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
    'relay_services_profile_sha256',
    'relay_services_converged_profile_sha256',
    'relay_services_private_ready_result_sha256',
    'relay_services_live_inventory_sha256',
    'browser_relay_runner_profile_sha256',
    'browser_relay_page_profile_sha256',
    'browser_relay_monitoring_profile_sha256',
    'browser_relay_monitoring_preflight_result_sha256',
    'browser_relay_rollback_profile_sha256',
    'browser_relay_rollback_preflight_result_sha256',
    'browser_relay_orchestrator_profile_sha256',
    'browser_relay_orchestrator_preflight_result_sha256',
    'browser_relay_operation_profile_sha256',
    'browser_relay_operation_preflight_result_sha256',
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
  for (const field of [
    'relay_services_profile_sha256',
    'relay_services_converged_profile_sha256',
    'relay_services_private_ready_result_sha256',
    'relay_services_live_inventory_sha256',
    'browser_relay_runner_profile_sha256',
    'browser_relay_page_profile_sha256',
    'browser_relay_monitoring_profile_sha256',
    'browser_relay_monitoring_preflight_result_sha256',
    'browser_relay_rollback_profile_sha256',
    'browser_relay_rollback_preflight_result_sha256',
    'browser_relay_orchestrator_profile_sha256',
    'browser_relay_orchestrator_preflight_result_sha256',
    'browser_relay_operation_profile_sha256',
    'browser_relay_operation_preflight_result_sha256',
  ]) {
    if (!SHA256.test(pins[field])) reject(`pins.${field} must be a SHA-256 digest`);
  }
  exact(
    pins.relay_services_profile_sha256,
    RELAY_SERVICES_PROFILE_SHA256,
    'pins.relay_services_profile_sha256',
  );
  exact(
    pins.relay_services_converged_profile_sha256,
    RELAY_SERVICES_V5_PROFILE_SHA256,
    'pins.relay_services_converged_profile_sha256',
  );
  exact(
    pins.relay_services_private_ready_result_sha256,
    RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    'pins.relay_services_private_ready_result_sha256',
  );
  exact(
    pins.relay_services_live_inventory_sha256,
    '421338fec676c1fccd0e6747d3e8837d4151b147c95b343172639800779b64d1',
    'pins.relay_services_live_inventory_sha256',
  );
  exact(
    pins.browser_relay_runner_profile_sha256,
    BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    'pins.browser_relay_runner_profile_sha256',
  );
  exact(
    pins.browser_relay_page_profile_sha256,
    BROWSER_RELAY_PAGE_V2_PROFILE_SHA256,
    'pins.browser_relay_page_profile_sha256',
  );
  exact(
    pins.browser_relay_monitoring_profile_sha256,
    MONITORING_PROFILE_SHA256,
    'pins.browser_relay_monitoring_profile_sha256',
  );
  exact(
    pins.browser_relay_monitoring_preflight_result_sha256,
    MONITORING_PREFLIGHT_RESULT_SHA256,
    'pins.browser_relay_monitoring_preflight_result_sha256',
  );
  exact(
    pins.miakapp_v3_commit,
    BROWSER_RELAY_PAGE_CI_MERGE_COMMIT,
    'pins.miakapp_v3_commit',
  );
  exact(
    pins.browser_relay_rollback_profile_sha256,
    'b3517720cb3874f040601d6dfcc7b0ecaf385c16d6b4299c102e2001f8bf18e7',
    'pins.browser_relay_rollback_profile_sha256',
  );
  exact(
    pins.browser_relay_rollback_preflight_result_sha256,
    'e8ceb2164be946d4edebfe2f08d8a3b230dcf9d2a05d9410738e751775950cd3',
    'pins.browser_relay_rollback_preflight_result_sha256',
  );
  exact(
    pins.browser_relay_orchestrator_profile_sha256,
    '76b4e6bc718e44d71ee4b5f19376e3ec7df28d304384c2736294f1874349a6da',
    'pins.browser_relay_orchestrator_profile_sha256',
  );
  exact(
    pins.browser_relay_orchestrator_preflight_result_sha256,
    '5ccbbab4edcc92820dbcf09ac592fdc7c57ebc277bd5c1f8a64a5fb9422f6e9e',
    'pins.browser_relay_orchestrator_preflight_result_sha256',
  );
  exact(
    pins.browser_relay_operation_profile_sha256,
    'd1ff776c48c0aade724fc31a8d44c7e68fe5c81919eab7030998962017801a73',
    'pins.browser_relay_operation_profile_sha256',
  );
  exact(
    pins.browser_relay_operation_preflight_result_sha256,
    'e3e7e6fab86b1cd777be94b9a9d2c215698d1ab842c92bfd54b6f4ff7d15e436',
    'pins.browser_relay_operation_preflight_result_sha256',
  );
  exact(pins, expectedPlan.pins, 'pins');
}

function validateBaseline(value) {
  const baseline = exactKeys(value, [
    'observed_at',
    'control_plane',
    'hosting',
    'app_check',
    'signing_keys',
    'application_data',
    'cloud_run_services',
    'relay_services',
    'relay_service_account_present',
    'browser_runner_present',
    'app_engine_application_present',
  ], 'baseline');
  exact(baseline, expectedPlan.baseline, 'baseline');
  exact(baseline.control_plane.ingress, 'ALLOW_INTERNAL_ONLY', 'baseline.control_plane.ingress');
  exact(baseline.control_plane.unauthenticated_invokers, 0, 'baseline.control_plane.unauthenticated_invokers');
  exact(baseline.control_plane.runtime_schema, 'miakapp.production-runtime/2', 'baseline.control_plane.runtime_schema');
  exact(baseline.control_plane.security_schema, 'miakapp.production-security/2', 'baseline.control_plane.security_schema');
  exact(baseline.control_plane.runtime_config_sha256, 'c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37', 'baseline.control_plane.runtime_config_sha256');
  exact(baseline.control_plane.published_signing_keys, 2, 'baseline.control_plane.published_signing_keys');
  exact(baseline.control_plane.current_signing_key_version, 1, 'baseline.control_plane.current_signing_key_version');
  exact(baseline.control_plane.overlap_schema_supported_by_source, true, 'baseline.control_plane.overlap_schema_supported_by_source');
  exact(baseline.control_plane.network_profile, 'canonical', 'baseline.control_plane.network_profile');
  exact(baseline.control_plane.browser_relay_edge_profile_supported_by_source, true, 'baseline.control_plane.browser_relay_edge_profile_supported_by_source');
  exact(baseline.hosting.site_disabled, true, 'baseline.hosting.site_disabled');
  exact(baseline.hosting.all_versions_deleted, true, 'baseline.hosting.all_versions_deleted');
  exact(baseline.hosting.browser_relay_route_status, 404, 'baseline.hosting.browser_relay_route_status');
  exact(baseline.app_check.service_enforcement_records, 0, 'baseline.app_check.service_enforcement_records');
  exact(baseline.app_check.debug_tokens, 0, 'baseline.app_check.debug_tokens');
  exact(baseline.app_check.browser_attestation_validated, true, 'baseline.app_check.browser_attestation_validated');
  exact(baseline.signing_keys.enabled_versions, [1, 2], 'baseline.signing_keys.enabled_versions');
  exact(baseline.application_data.firebase_auth_users, 0, 'baseline.application_data.firebase_auth_users');
  exact(baseline.application_data.application_fixture_collections, 0, 'baseline.application_data.application_fixture_collections');
  exact(baseline.cloud_run_services, [
    'control-plane', 'miakapp-staging-relay-a', 'miakapp-staging-relay-b',
  ], 'baseline.cloud_run_services');
  exact(baseline.relay_services, 2, 'baseline.relay_services');
  exact(baseline.relay_service_account_present, true, 'baseline.relay_service_account_present');
  exact(baseline.browser_runner_present, false, 'baseline.browser_runner_present');
  exact(baseline.app_engine_application_present, false, 'baseline.app_engine_application_present');
}

function validateRelay(value, expected, path) {
  const relay = exactKeys(value, [
    'id',
    'service_name',
    'private_ready_audience',
    'private_ready_generation',
    'endpoint_source',
    'websocket_path',
    'health_path',
    'ingress',
    'public_invoker_before_window',
    'unauthenticated_invoker_during_window',
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
    'maximum_queued_bytes_per_connection',
    'maximum_connections',
    'maximum_connections_per_immediate_peer',
    'connection_attempts_per_minute_per_immediate_peer',
    'maximum_tracked_immediate_peers',
    'maximum_homes',
    'maximum_aggregate_queued_bytes',
    'trusted_client_address_source',
    'forwarded_client_headers_trusted',
  ], path);
  exact(relay, expected, path);
  if (!/^wss:\/\/miakapp-staging-relay-[ab]-[a-z0-9]{10}-od\.a\.run\.app\/ws$/u
    .test(relay.private_ready_audience)) {
    reject(`${path}.private_ready_audience is not an assigned staging relay audience`);
  }
  exact(relay.private_ready_generation, 2, `${path}.private_ready_generation`);
  exact(relay.runtime_iam_roles, [], `${path}.runtime_iam_roles`);
  exact(relay.minimum_instances, 0, `${path}.minimum_instances`);
  exact(relay.maximum_instances, 1, `${path}.maximum_instances`);
  exact(relay.public_invoker_before_window, false, `${path}.public_invoker_before_window`);
  exact(
    relay.unauthenticated_invoker_during_window,
    true,
    `${path}.unauthenticated_invoker_during_window`,
  );
  exact(relay.application_authentication, 'audience_bound_relay_user_hello', `${path}.application_authentication`);
  exact(relay.maximum_queued_bytes_per_connection, 262144, `${path}.maximum_queued_bytes_per_connection`);
  exact(relay.maximum_connections, 8, `${path}.maximum_connections`);
  exact(relay.maximum_connections_per_immediate_peer, 8, `${path}.maximum_connections_per_immediate_peer`);
  exact(relay.connection_attempts_per_minute_per_immediate_peer, 32, `${path}.connection_attempts_per_minute_per_immediate_peer`);
  exact(relay.maximum_tracked_immediate_peers, 64, `${path}.maximum_tracked_immediate_peers`);
  exact(relay.maximum_homes, 16, `${path}.maximum_homes`);
  exact(relay.maximum_aggregate_queued_bytes, 4194304, `${path}.maximum_aggregate_queued_bytes`);
  exact(relay.trusted_client_address_source, 'immediate_tcp_peer', `${path}.trusted_client_address_source`);
  exact(relay.forwarded_client_headers_trusted, false, `${path}.forwarded_client_headers_trusted`);
  exact(relay.memory_mib, 512, `${path}.memory_mib`);
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
  if (!Array.isArray(value) || value.length !== 9) {
    reject('preconditions must contain exactly nine entries');
  }
  value.forEach((entry, index) => {
    exactKeys(entry, ['id', 'state', 'requirement'], `preconditions[${index}]`);
    exact(entry, expectedPlan.preconditions[index], `preconditions[${index}]`);
  });
  exact(value.filter(({ state }) => state === 'satisfied').map(({ id }) => id), [
    'PIN-01', 'SIGNING-01', 'APP-CHECK-01', 'ROTATION-ENTRY-01', 'EDGE-01', 'RELAY-01',
    'RUNNER-01', 'MONITORING-01', 'ROLLBACK-01',
  ], 'satisfied preconditions');
  exact(value.filter(({ state }) => state === 'open').length, 0, 'open precondition count');
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
    'baseline_current_version',
    'baseline_published_versions',
    'rehearsal_entry_current_version',
    'rehearsal_entry_published_versions',
    'acceptance_target_current_version',
    'acceptance_target_published_versions',
    'published_keys_before',
    'published_keys_during_overlap',
    'published_keys_after_retirement',
    'new_kms_version_required',
    'version_recreation_allowed',
    'prior_key_after_retirement',
    'ordinary_rollback',
    'republish_removed_private_key',
  ], 'signing_rotation');
  exact(rotation, expectedPlan.signing_rotation, 'signing_rotation');
  exact(rotation.state, 'rehearsal_entry_converged_version_1_current', 'signing_rotation.state');
  exact(rotation.token_lease_seconds, 300, 'signing_rotation.token_lease_seconds');
  exact(rotation.prepublication_seconds, 60, 'signing_rotation.prepublication_seconds');
  exact(rotation.retiring_key_retention_seconds, 330, 'signing_rotation.retiring_key_retention_seconds');
  exact(rotation.baseline_current_version, 1, 'signing_rotation.baseline_current_version');
  exact(rotation.baseline_published_versions, [1, 2], 'signing_rotation.baseline_published_versions');
  exact(rotation.rehearsal_entry_current_version, 1, 'signing_rotation.rehearsal_entry_current_version');
  exact(rotation.rehearsal_entry_published_versions, [1, 2], 'signing_rotation.rehearsal_entry_published_versions');
  exact(rotation.acceptance_target_current_version, 2, 'signing_rotation.acceptance_target_current_version');
  exact(rotation.acceptance_target_published_versions, [1, 2], 'signing_rotation.acceptance_target_published_versions');
  exact(rotation.published_keys_before, 2, 'signing_rotation.published_keys_before');
  exact(rotation.published_keys_during_overlap, 2, 'signing_rotation.published_keys_during_overlap');
  exact(rotation.new_kms_version_required, false, 'signing_rotation.new_kms_version_required');
  exact(rotation.version_recreation_allowed, false, 'signing_rotation.version_recreation_allowed');
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
  exact(rollback.state, 'preflighted_not_executed', 'rollback.state');
  exact(rollback.required_final_state.control_plane_ingress, 'ALLOW_INTERNAL_ONLY', 'rollback.required_final_state.control_plane_ingress');
  exact(rollback.required_final_state.control_plane_unauthenticated_invokers, 0, 'rollback.required_final_state.control_plane_unauthenticated_invokers');
  exact(rollback.required_final_state.relay_services, 2, 'rollback.required_final_state.relay_services');
  exact(rollback.required_final_state.relay_phase, 'private_ready', 'rollback.required_final_state.relay_phase');
  exact(rollback.required_final_state.relay_public_invokers, 0, 'rollback.required_final_state.relay_public_invokers');
  exact(rollback.required_final_state.relay_service_account_user_managed_keys, 0, 'rollback.required_final_state.relay_service_account_user_managed_keys');
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
  exact(plan.revision, 15, 'plan.revision');
  exact(
    plan.state,
    'page_three_engine_ci_pinned_operation_preflighted_edge_orchestrator_preflighted_rollback_preflighted_monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed',
    'plan.state',
  );
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

export function validateBrowserRelayV14Plan(
  path = new URL('plan-v14.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PLAN_BYTES) {
    reject('historical revision-14 plan must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== BROWSER_RELAY_V14_PLAN_SHA256) {
    reject('historical revision-14 plan digest has drifted');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('historical revision-14 plan is not valid JSON');
  }
  if (`${JSON.stringify(plan, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('historical revision-14 plan is not in exact canonical JSON form');
  }
  rejectPrivateMaterial(plan);
  if (plan.schema !== 'miakapp.staging-browser-relay-plan/1'
    || plan.revision !== 14
    || plan.state
      !== 'operation_preflighted_edge_orchestrator_preflighted_rollback_preflighted_monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed'
    || plan.target?.project_id !== 'miakapp-v4-staging'
    || plan.target?.cloud_mutation_authorized_by_document !== false
    || plan.target?.public_ingress_currently_active !== false
    || plan.target?.acceptance_executed !== false
    || plan.pins?.miakapp_v3_commit
      !== 'ae21e4922d3f70fffe9218cd975f180faca486f0'
    || plan.pins?.browser_relay_operation_profile_sha256
      !== 'd1ff776c48c0aade724fc31a8d44c7e68fe5c81919eab7030998962017801a73'
    || plan.pins?.browser_relay_operation_preflight_result_sha256
      !== 'e3e7e6fab86b1cd777be94b9a9d2c215698d1ab842c92bfd54b6f4ff7d15e436'
    || Object.hasOwn(plan.pins ?? {}, 'browser_relay_page_profile_sha256')
    || !plan.preconditions?.every(({ state }) => state === 'satisfied')
    || !plan.matrix?.every(({ state }) => state === 'pending')
    || plan.evidence?.state !== 'absent'
    || plan.evidence?.completed_case_ids?.length !== 0) {
    reject('historical revision-14 plan boundary has drifted');
  }
  return Object.freeze(plan);
}

export function validateBrowserRelayV13Plan(
  path = new URL('plan-v13.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PLAN_BYTES) {
    reject('historical revision-13 plan must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== BROWSER_RELAY_V13_PLAN_SHA256) {
    reject('historical revision-13 plan digest has drifted');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('historical revision-13 plan is not valid JSON');
  }
  if (`${JSON.stringify(plan, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('historical revision-13 plan is not in exact canonical JSON form');
  }
  rejectPrivateMaterial(plan);
  if (plan.schema !== 'miakapp.staging-browser-relay-plan/1'
    || plan.revision !== 13
    || plan.state
      !== 'edge_orchestrator_preflighted_rollback_preflighted_monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed'
    || plan.target?.project_id !== 'miakapp-v4-staging'
    || plan.target?.cloud_mutation_authorized_by_document !== false
    || plan.target?.public_ingress_currently_active !== false
    || plan.target?.acceptance_executed !== false
    || plan.pins?.miakapp_v3_commit
      !== '6995856fc5cfd64a06176c83e9d24bc93558e05b'
    || plan.pins?.browser_relay_orchestrator_profile_sha256
      !== '76b4e6bc718e44d71ee4b5f19376e3ec7df28d304384c2736294f1874349a6da'
    || plan.pins?.browser_relay_orchestrator_preflight_result_sha256
      !== '5ccbbab4edcc92820dbcf09ac592fdc7c57ebc277bd5c1f8a64a5fb9422f6e9e'
    || Object.hasOwn(plan.pins ?? {}, 'browser_relay_operation_profile_sha256')
    || Object.hasOwn(
      plan.pins ?? {},
      'browser_relay_operation_preflight_result_sha256',
    )
    || !plan.preconditions?.every(({ state }) => state === 'satisfied')
    || !plan.matrix?.every(({ state }) => state === 'pending')
    || plan.evidence?.state !== 'absent'
    || plan.evidence?.completed_case_ids?.length !== 0) {
    reject('historical revision-13 plan boundary has drifted');
  }
  return Object.freeze(plan);
}

export function validateBrowserRelayV12Plan(
  path = new URL('plan-v12.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PLAN_BYTES) {
    reject('historical revision-12 plan must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== BROWSER_RELAY_V12_PLAN_SHA256) {
    reject('historical revision-12 plan digest has drifted');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('historical revision-12 plan is not valid JSON');
  }
  if (`${JSON.stringify(plan, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('historical revision-12 plan is not in exact canonical JSON form');
  }
  rejectPrivateMaterial(plan);
  const edgePrecondition = plan.preconditions?.find(({ id }) => id === 'EDGE-01');
  const rollbackPrecondition = plan.preconditions?.find(
    ({ id }) => id === 'ROLLBACK-01',
  );
  if (plan.schema !== 'miakapp.staging-browser-relay-plan/1'
    || plan.revision !== 12
    || plan.state
      !== 'rollback_preflighted_monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed'
    || plan.target?.project_id !== 'miakapp-v4-staging'
    || plan.target?.cloud_mutation_authorized_by_document !== false
    || plan.target?.public_ingress_currently_active !== false
    || plan.target?.acceptance_executed !== false
    || plan.pins?.miakapp_v3_commit
      !== '0fd0d05ee31f84d42cf69cc6f5cead9cbcad79be'
    || plan.pins?.browser_relay_rollback_profile_sha256
      !== 'b3517720cb3874f040601d6dfcc7b0ecaf385c16d6b4299c102e2001f8bf18e7'
    || plan.pins?.browser_relay_rollback_preflight_result_sha256
      !== 'e8ceb2164be946d4edebfe2f08d8a3b230dcf9d2a05d9410738e751775950cd3'
    || Object.hasOwn(plan.pins ?? {}, 'browser_relay_orchestrator_profile_sha256')
    || Object.hasOwn(
      plan.pins ?? {},
      'browser_relay_orchestrator_preflight_result_sha256',
    )
    || edgePrecondition?.state !== 'open'
    || rollbackPrecondition?.state !== 'satisfied'
    || plan.preconditions?.filter(({ state }) => state === 'open').length !== 1
    || plan.rollback?.state !== 'preflighted_not_executed'
    || !plan.matrix?.every(({ state }) => state === 'pending')
    || plan.evidence?.state !== 'absent'
    || plan.evidence?.completed_case_ids?.length !== 0) {
    reject('historical revision-12 plan boundary has drifted');
  }
  return Object.freeze(plan);
}

export function validateBrowserRelayV11Plan(
  path = new URL('plan-v11.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PLAN_BYTES) {
    reject('historical revision-11 plan must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== BROWSER_RELAY_V11_PLAN_SHA256) {
    reject('historical revision-11 plan digest has drifted');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('historical revision-11 plan is not valid JSON');
  }
  if (`${JSON.stringify(plan, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('historical revision-11 plan is not in exact canonical JSON form');
  }
  rejectPrivateMaterial(plan);
  const monitoringPrecondition = plan.preconditions?.find(
    ({ id }) => id === 'MONITORING-01',
  );
  const rollbackPrecondition = plan.preconditions?.find(
    ({ id }) => id === 'ROLLBACK-01',
  );
  if (plan.schema !== 'miakapp.staging-browser-relay-plan/1'
    || plan.revision !== 11
    || plan.state
      !== 'monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed'
    || plan.target?.project_id !== 'miakapp-v4-staging'
    || plan.target?.cloud_mutation_authorized_by_document !== false
    || plan.target?.public_ingress_currently_active !== false
    || plan.target?.acceptance_executed !== false
    || plan.pins?.miakapp_v3_commit !== MONITORING_IMPLEMENTATION_COMMIT
    || plan.pins?.browser_relay_monitoring_profile_sha256 !== MONITORING_PROFILE_SHA256
    || plan.pins?.browser_relay_monitoring_preflight_result_sha256
      !== MONITORING_PREFLIGHT_RESULT_SHA256
    || Object.hasOwn(plan.pins ?? {}, 'browser_relay_rollback_profile_sha256')
    || Object.hasOwn(plan.pins ?? {}, 'browser_relay_rollback_preflight_result_sha256')
    || monitoringPrecondition?.state !== 'satisfied'
    || rollbackPrecondition?.state !== 'open'
    || plan.preconditions?.filter(({ state }) => state === 'open').length !== 2
    || plan.rollback?.state !== 'designed_not_executed'
    || !plan.matrix?.every(({ state }) => state === 'pending')
    || plan.evidence?.state !== 'absent'
    || plan.evidence?.completed_case_ids?.length !== 0) {
    reject('historical revision-11 plan boundary has drifted');
  }
  return Object.freeze(plan);
}

export function validateBrowserRelayV10Plan(
  path = new URL('plan-v10.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PLAN_BYTES) {
    reject('historical revision-10 plan must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== BROWSER_RELAY_V10_PLAN_SHA256) {
    reject('historical revision-10 plan digest has drifted');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('historical revision-10 plan is not valid JSON');
  }
  if (`${JSON.stringify(plan, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('historical revision-10 plan is not in exact canonical JSON form');
  }
  rejectPrivateMaterial(plan);
  const runnerPrecondition = plan.preconditions?.find(({ id }) => id === 'RUNNER-01');
  const monitoringPrecondition = plan.preconditions?.find(({ id }) => id === 'MONITORING-01');
  if (plan.schema !== 'miakapp.staging-browser-relay-plan/1'
    || plan.revision !== 10
    || plan.state !== 'runner_implemented_private_relays_ready_plan_rebased_not_deployed'
    || plan.target?.project_id !== 'miakapp-v4-staging'
    || plan.target?.cloud_mutation_authorized_by_document !== false
    || plan.target?.public_ingress_currently_active !== false
    || plan.target?.acceptance_executed !== false
    || plan.pins?.miakapp_v3_commit
      !== '11aa803d14add26c286a5885d1c5370a33d6c6d6'
    || plan.pins?.browser_relay_runner_profile_sha256
      !== BROWSER_RELAY_RUNNER_PROFILE_SHA256
    || Object.hasOwn(plan.pins ?? {}, 'browser_relay_monitoring_profile_sha256')
    || Object.hasOwn(plan.pins ?? {}, 'browser_relay_monitoring_preflight_result_sha256')
    || runnerPrecondition?.state !== 'satisfied'
    || monitoringPrecondition?.state !== 'open'
    || plan.preconditions?.filter(({ state }) => state === 'open').length !== 3
    || !plan.matrix?.every(({ state }) => state === 'pending')
    || plan.evidence?.state !== 'absent'
    || plan.evidence?.completed_case_ids?.length !== 0) {
    reject('historical revision-10 plan boundary has drifted');
  }
  return Object.freeze(plan);
}

export function validateBrowserRelayV9Plan(
  path = new URL('plan-v9.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PLAN_BYTES) {
    reject('historical revision-9 plan must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== BROWSER_RELAY_V9_PLAN_SHA256) {
    reject('historical revision-9 plan digest has drifted');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('historical revision-9 plan is not valid JSON');
  }
  if (`${JSON.stringify(plan, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('historical revision-9 plan is not in exact canonical JSON form');
  }
  rejectPrivateMaterial(plan);
  const runnerPrecondition = plan.preconditions?.find(({ id }) => id === 'RUNNER-01');
  if (plan.schema !== 'miakapp.staging-browser-relay-plan/1'
    || plan.revision !== 9
    || plan.state !== 'private_relays_ready_plan_rebased_not_deployed'
    || plan.target?.project_id !== 'miakapp-v4-staging'
    || plan.target?.cloud_mutation_authorized_by_document !== false
    || plan.target?.public_ingress_currently_active !== false
    || plan.target?.acceptance_executed !== false
    || plan.pins?.miakapp_v3_commit
      !== '790aff87a1af8730a06b8f1c3b089b6f6e13c7cf'
    || Object.hasOwn(plan.pins ?? {}, 'browser_relay_runner_profile_sha256')
    || runnerPrecondition?.state !== 'open'
    || plan.preconditions?.filter(({ state }) => state === 'open').length !== 4
    || !plan.matrix?.every(({ state }) => state === 'pending')
    || plan.evidence?.state !== 'absent'
    || plan.evidence?.completed_case_ids?.length !== 0) {
    reject('historical revision-9 plan boundary has drifted');
  }
  return Object.freeze(plan);
}

export function validateBrowserRelayV8Plan(
  path = new URL('plan-v8.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PLAN_BYTES) {
    reject('historical revision-8 plan must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== BROWSER_RELAY_V8_PLAN_SHA256) {
    reject('historical revision-8 plan digest has drifted');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('historical revision-8 plan is not valid JSON');
  }
  if (`${JSON.stringify(plan, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('historical revision-8 plan is not in exact canonical JSON form');
  }
  rejectPrivateMaterial(plan);
  if (plan.schema !== 'miakapp.staging-browser-relay-plan/1'
    || plan.revision !== 8
    || plan.state !== 'relay_process_admission_merged_root_reviewed_not_deployed'
    || plan.target?.project_id !== 'miakapp-v4-staging'
    || plan.target?.cloud_mutation_authorized_by_document !== false
    || plan.target?.public_ingress_currently_active !== false
    || plan.target?.acceptance_executed !== false
    || plan.pins?.relay_services_profile_sha256
      !== 'bc9b231cc9724f19a26ef5c3bbd6da6a69ec79b00cb976e77c73015d5db10db7') {
    reject('historical revision-8 plan boundary has drifted');
  }
  return Object.freeze(plan);
}
