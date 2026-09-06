import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const MONITORING_PROFILE_PATH = 'browser-relay-monitoring/profile.json';
export const MONITORING_PROFILE_SHA256 =
  'df5d04aa28658a6b0b2bd59087dd60a1d837f271bb85da00823e2d2e39b2e661';
export const BROWSER_RELAY_V10_PLAN_SHA256 =
  '614493a6ffd1c8c45044585368ae21eefa82afb65f031d2fd4e9028b215098da';
export const APPROVED_BILLING_ACCOUNT_SHA256 =
  '4557923f1be719b78ee844b14bfa4654be3eb3fa785a2cb5a2624c3f85d12270';
export const PREFLIGHT_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-monitoring-preflight-result/1';
export const SAMPLE_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-monitoring-sample-result/1';

const profilePath = new URL('profile.json', import.meta.url);
const MAXIMUM_PROFILE_BYTES = 20 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const REVISION = /^control-plane-[0-9]{5}-[a-z]{3}$/u;
const ALLOWED_PHASES = Object.freeze(['preflight', 'public_window', 'rollback']);
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
  'billing_account_id',
  'cookie',
  'email',
  'execution_identifier',
  'firebase_id_token',
  'firebase_uid',
  'har',
  'home_traffic',
  'id_token',
  'password',
  'private_key',
  'raw_api_error',
  'raw_budget',
  'raw_metric_point',
  'raw_request',
  'raw_response',
  'raw_time_series',
  'refresh_token',
  'request_headers',
  'response_headers',
  'secret_value',
  'token',
  'trace_context',
  'video',
  'websocket_frame',
]);
const SAMPLE_COUNTERS = Object.freeze([
  'acceptance_executions',
  'browser_invocations',
  'cloud_builds',
  'control_plane_exchanges',
  'control_plane_public_instance_seconds',
  'credential_or_private_traffic_diagnostics',
  'firebase_or_app_check_tokens_on_websocket',
  'firestore_writes',
  'identity_or_audience_binding_failures',
  'kms_signatures',
  'maximum_instances_per_service',
  'persistent_iam_mutations',
  'projected_incremental_milli_eur',
  'public_window_seconds',
  'recaptcha_assessments',
  'relay_services',
  'rollback_precondition_failures',
  'total_relay_instance_seconds',
  'unexpected_project_mutations',
]);
const STOP_CHECKS = Object.freeze([
  ['public_window_seconds', 'maximum_public_window_seconds', 'public_window_limit'],
  ['acceptance_executions', 'maximum_acceptance_executions', 'acceptance_execution_limit'],
  ['cloud_builds', 'maximum_cloud_builds', 'cloud_build_limit'],
  ['browser_invocations', 'maximum_browser_invocations', 'browser_invocation_limit'],
  ['recaptcha_assessments', 'maximum_recaptcha_assessments', 'recaptcha_assessment_limit'],
  ['control_plane_exchanges', 'maximum_control_plane_exchanges', 'control_plane_exchange_limit'],
  ['kms_signatures', 'maximum_kms_signatures', 'kms_signature_limit'],
  ['firestore_writes', 'maximum_firestore_writes', 'firestore_write_limit'],
  ['maximum_instances_per_service', 'maximum_instances_per_service', 'instance_limit'],
  ['total_relay_instance_seconds', 'maximum_total_relay_instance_seconds',
    'relay_instance_time_limit'],
  ['control_plane_public_instance_seconds', 'maximum_control_plane_public_instance_seconds',
    'control_plane_public_time_limit'],
  ['projected_incremental_milli_eur', 'maximum_projected_incremental_milli_eur',
    'projected_cost_limit'],
]);

export class StagingBrowserRelayMonitoringError extends Error {
  constructor(message = 'Staging browser-relay monitoring is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayMonitoringError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayMonitoringError(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
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

function timestamp(value, path) {
  let normalized;
  try {
    normalized = typeof value === 'string' ? new Date(value).toISOString() : null;
  } catch {
    normalized = null;
  }
  if (normalized !== value) {
    reject(`${path} must be a canonical timestamp`);
  }
  return value;
}

function rejectPrivateMaterial(value, path = 'value') {
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
      if (FORBIDDEN_FIELD_NAMES.has(key)) reject(`${path}.${key} is forbidden`);
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateProfileSemantics(profile) {
  exactKeys(profile, [
    'schema', 'revision', 'state', 'target', 'pins', 'observation', 'enforcement',
    'output', 'evidence',
  ], 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-monitoring-profile/1', 'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(profile.state, 'closed_monitoring_contract_implemented_not_observed', 'profile.state');
  exactKeys(profile.target, [
    'project_id', 'project_number', 'region', 'cloud_compute_resources', 'unscheduled',
    'cloud_mutation_authorized_by_profile', 'public_ingress_authorized_by_profile',
    'acceptance_execution_authorized_by_profile',
  ], 'profile.target');
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
  exactKeys(profile.pins, [
    'implementation_base_commit', 'browser_relay_plan_sha256',
    'approved_billing_account_sha256',
  ], 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)) {
    reject('profile.pins.implementation_base_commit is not a full commit');
  }
  exact(profile.pins.implementation_base_commit,
    'bbeab5c4bbb7557722be0fbb2c45df100a16dd9c',
    'profile.pins.implementation_base_commit');
  exact(profile.pins.browser_relay_plan_sha256, BROWSER_RELAY_V10_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256');
  exact(profile.pins.approved_billing_account_sha256, APPROVED_BILLING_ACCOUNT_SHA256,
    'profile.pins.approved_billing_account_sha256');
  for (const field of ['browser_relay_plan_sha256', 'approved_billing_account_sha256']) {
    if (!SHA256.test(profile.pins[field])) reject(`profile.pins.${field} is not a SHA-256 digest`);
  }

  const observation = exactKeys(profile.observation, [
    'query_interval_seconds', 'query_view', 'maximum_series_headers_per_query',
    'metric_descriptors', 'queries', 'billing_budget', 'raw_metric_points_retained',
    'raw_time_series_retained', 'raw_budget_resource_name_retained',
    'raw_api_errors_retained',
  ], 'profile.observation');
  exact(observation.query_interval_seconds, 300, 'profile.observation.query_interval_seconds');
  exact(observation.query_view, 'HEADERS', 'profile.observation.query_view');
  exact(observation.maximum_series_headers_per_query, 100,
    'profile.observation.maximum_series_headers_per_query');
  if (!Array.isArray(observation.metric_descriptors)
    || observation.metric_descriptors.length !== 6
    || !Array.isArray(observation.queries) || observation.queries.length !== 6) {
    reject('profile.observation must contain exactly six descriptors and queries');
  }
  const descriptorTypes = observation.metric_descriptors.map((entry, index) => {
    exactKeys(entry, ['type', 'metric_kind', 'value_type', 'unit', 'resource_types', 'labels'],
      `profile.observation.metric_descriptors[${index}]`);
    return entry.type;
  });
  if (new Set(descriptorTypes).size !== 6) reject('profile metric descriptors contain duplicates');
  observation.queries.forEach((entry, index) => {
    exactKeys(entry, ['id', 'metric_type', 'resource_type', 'service_names'],
      `profile.observation.queries[${index}]`);
    if (!descriptorTypes.includes(entry.metric_type)
      || !Array.isArray(entry.service_names)
      || entry.service_names.some((name) => typeof name !== 'string')) {
      reject(`profile.observation.queries[${index}] is not descriptor-bound`);
    }
  });
  exact(observation.queries.map(({ id }) => id), [
    'cloud_run_requests', 'cloud_run_instances', 'cloud_run_billable_time',
    'kms_peak_qps', 'firestore_writes', 'recaptcha_assessments',
  ], 'profile observation query order');
  exact(observation.queries.slice(0, 3).map(({ service_names: names }) => names), [
    ['control-plane', 'miakapp-staging-relay-a', 'miakapp-staging-relay-b'],
    ['control-plane', 'miakapp-staging-relay-a', 'miakapp-staging-relay-b'],
    ['control-plane', 'miakapp-staging-relay-a', 'miakapp-staging-relay-b'],
  ], 'profile Cloud Run service allowlist');
  exactKeys(observation.billing_budget, [
    'display_name', 'currency', 'amount_units', 'calendar_period',
    'credit_types_treatment', 'thresholds', 'spend_basis', 'project_level_recipients',
  ], 'profile.observation.billing_budget');
  exact(observation.billing_budget, {
    display_name: 'Miakapp V4 staging monthly',
    currency: 'EUR',
    amount_units: 10,
    calendar_period: 'MONTH',
    credit_types_treatment: 'INCLUDE_ALL_CREDITS',
    thresholds: [0.2, 0.5, 1],
    spend_basis: 'CURRENT_SPEND',
    project_level_recipients: true,
  }, 'profile.observation.billing_budget');
  for (const field of [
    'raw_metric_points_retained', 'raw_time_series_retained',
    'raw_budget_resource_name_retained', 'raw_api_errors_retained',
  ]) exact(observation[field], false, `profile.observation.${field}`);

  const enforcement = exactKeys(profile.enforcement, [
    'maximum_public_window_seconds', 'maximum_acceptance_executions',
    'maximum_cloud_builds', 'maximum_browser_invocations',
    'maximum_recaptcha_assessments', 'maximum_control_plane_exchanges',
    'maximum_kms_signatures', 'maximum_firestore_writes', 'required_relay_services',
    'maximum_instances_per_service', 'maximum_total_relay_instance_seconds',
    'maximum_control_plane_public_instance_seconds',
    'maximum_projected_incremental_milli_eur', 'required_zero_counters',
  ], 'profile.enforcement');
  exact(enforcement, {
    maximum_public_window_seconds: 1200,
    maximum_acceptance_executions: 1,
    maximum_cloud_builds: 4,
    maximum_browser_invocations: 3,
    maximum_recaptcha_assessments: 16,
    maximum_control_plane_exchanges: 16,
    maximum_kms_signatures: 16,
    maximum_firestore_writes: 64,
    required_relay_services: 2,
    maximum_instances_per_service: 1,
    maximum_total_relay_instance_seconds: 2400,
    maximum_control_plane_public_instance_seconds: 1200,
    maximum_projected_incremental_milli_eur: 1000,
    required_zero_counters: [
      'credential_or_private_traffic_diagnostics',
      'firebase_or_app_check_tokens_on_websocket',
      'identity_or_audience_binding_failures',
      'rollback_precondition_failures',
      'unexpected_project_mutations',
      'persistent_iam_mutations',
    ],
  }, 'profile.enforcement');
  exact(profile.output, {
    preflight_result_schema: PREFLIGHT_RESULT_SCHEMA,
    sample_result_schema: SAMPLE_RESULT_SCHEMA,
    allowed_observations: ['bounded_counts', 'durations', 'revision_ids',
      'stable_outcome_classes'],
    forbidden_observations: ['browser_storage', 'email', 'execution_identifier',
      'firebase_uid', 'har', 'home_traffic', 'raw_request_or_response', 'token',
      'trace_context', 'video', 'websocket_frame'],
  }, 'profile.output');
  exact(profile.evidence, {
    state: 'absent',
    live_preflight_count: 0,
    result_path: null,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  }, 'profile.evidence');
  return profile;
}

export function validateBrowserRelayMonitoringProfile(path = profilePath) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Monitoring profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== MONITORING_PROFILE_SHA256) {
    reject('Monitoring profile digest has drifted');
  }
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Monitoring profile must be valid JSON');
  }
  rejectPrivateMaterial(profile, 'profile');
  return Object.freeze(validateProfileSemantics(profile));
}

export function validateMonitoringCloudObservation(value) {
  rejectPrivateMaterial(value, 'observation');
  const profile = validateBrowserRelayMonitoringProfile();
  const observation = exactKeys(value, [
    'schema', 'project_id', 'project_number', 'region', 'observed_at',
    'private_boundary', 'metric_descriptors', 'queries', 'billing_budget',
    'raw_retention',
  ], 'observation');
  exact(observation.schema, 'miakapp.staging-browser-relay-monitoring-cloud-observation/1',
    'observation.schema');
  exact(observation.project_id, PROJECT_ID, 'observation.project_id');
  exact(observation.project_number, PROJECT_NUMBER, 'observation.project_number');
  exact(observation.region, REGION, 'observation.region');
  timestamp(observation.observed_at, 'observation.observed_at');
  exactKeys(observation.private_boundary, [
    'control_plane_state', 'control_plane_revision', 'control_plane_public_invokers',
    'relay_phase', 'relay_services', 'relay_public_invokers',
  ], 'observation.private_boundary');
  exact(observation.private_boundary.control_plane_state, 'canonical_private',
    'observation.private_boundary.control_plane_state');
  if (!REVISION.test(observation.private_boundary.control_plane_revision)) {
    reject('observation.private_boundary.control_plane_revision is invalid');
  }
  exact(observation.private_boundary.control_plane_public_invokers, 0,
    'observation.private_boundary.control_plane_public_invokers');
  exact(observation.private_boundary.relay_phase, 'private_ready',
    'observation.private_boundary.relay_phase');
  exact(observation.private_boundary.relay_services, 2,
    'observation.private_boundary.relay_services');
  exact(observation.private_boundary.relay_public_invokers, 0,
    'observation.private_boundary.relay_public_invokers');
  exact(observation.metric_descriptors, profile.observation.metric_descriptors,
    'observation.metric_descriptors');
  if (!Array.isArray(observation.queries)
    || observation.queries.length !== profile.observation.queries.length) {
    reject('observation.queries must contain exactly the allowlisted queries');
  }
  observation.queries.forEach((query, index) => {
    exactKeys(query, [
      'id', 'metric_type', 'state', 'query_interval_seconds', 'query_view',
      'series_headers_observed', 'raw_points_retained',
    ], `observation.queries[${index}]`);
    exact(query.id, profile.observation.queries[index].id,
      `observation.queries[${index}].id`);
    exact(query.metric_type, profile.observation.queries[index].metric_type,
      `observation.queries[${index}].metric_type`);
    exact(query.state, 'readable', `observation.queries[${index}].state`);
    exact(query.query_interval_seconds, profile.observation.query_interval_seconds,
      `observation.queries[${index}].query_interval_seconds`);
    exact(query.query_view, profile.observation.query_view,
      `observation.queries[${index}].query_view`);
    boundedInteger(query.series_headers_observed, 0,
      profile.observation.maximum_series_headers_per_query,
      `observation.queries[${index}].series_headers_observed`);
    exact(query.raw_points_retained, false,
      `observation.queries[${index}].raw_points_retained`);
  });
  const budget = exactKeys(observation.billing_budget, [
    'state', 'matching_budgets', 'billing_account_sha256', 'resource_name_sha256',
    'display_name', 'project_number', 'currency', 'amount_units', 'calendar_period',
    'credit_types_treatment', 'thresholds', 'spend_basis',
    'project_level_recipients', 'raw_resource_name_retained',
  ], 'observation.billing_budget');
  if (!SHA256.test(budget.resource_name_sha256)) {
    reject('observation.billing_budget.resource_name_sha256 is invalid');
  }
  exact(budget, {
    state: 'configured',
    matching_budgets: 1,
    billing_account_sha256: APPROVED_BILLING_ACCOUNT_SHA256,
    resource_name_sha256: budget.resource_name_sha256,
    display_name: profile.observation.billing_budget.display_name,
    project_number: PROJECT_NUMBER,
    currency: profile.observation.billing_budget.currency,
    amount_units: profile.observation.billing_budget.amount_units,
    calendar_period: profile.observation.billing_budget.calendar_period,
    credit_types_treatment: profile.observation.billing_budget.credit_types_treatment,
    thresholds: profile.observation.billing_budget.thresholds,
    spend_basis: profile.observation.billing_budget.spend_basis,
    project_level_recipients: true,
    raw_resource_name_retained: false,
  }, 'observation.billing_budget');
  exact(observation.raw_retention, {
    metric_points: false,
    time_series: false,
    budget_resource_name: false,
    api_errors: false,
  }, 'observation.raw_retention');
  return Object.freeze(observation);
}

export function buildMonitoringPreflightResult(value) {
  const observation = validateMonitoringCloudObservation(value);
  const profile = validateBrowserRelayMonitoringProfile();
  const result = {
    schema: PREFLIGHT_RESULT_SCHEMA,
    state: 'allowlisted_monitoring_observed_at_private_boundary',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: observation.observed_at,
    profile_sha256: MONITORING_PROFILE_SHA256,
    browser_relay_plan_sha256: profile.pins.browser_relay_plan_sha256,
    control_plane_state: observation.private_boundary.control_plane_state,
    control_plane_revision: observation.private_boundary.control_plane_revision,
    control_plane_public_invokers: 0,
    relay_phase: observation.private_boundary.relay_phase,
    relay_services: observation.private_boundary.relay_services,
    relay_public_invokers: 0,
    metric_descriptors_observed: observation.metric_descriptors.length,
    allowlisted_queries_succeeded: observation.queries.length,
    series_headers_observed: observation.queries
      .reduce((total, query) => total + query.series_headers_observed, 0),
    budget_state: observation.billing_budget.state,
    budget_amount_eur: observation.billing_budget.amount_units,
    budget_thresholds_eur: observation.billing_budget.thresholds
      .map((threshold) => threshold * observation.billing_budget.amount_units),
    budget_project_level_recipients: observation.billing_budget.project_level_recipients,
    billing_account_sha256: observation.billing_budget.billing_account_sha256,
    budget_resource_name_sha256: observation.billing_budget.resource_name_sha256,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credential_material_retained: false,
    raw_cloud_responses_retained: false,
  };
  rejectPrivateMaterial(result, 'result');
  return Object.freeze(result);
}

export function evaluateMonitoringSample(value) {
  rejectPrivateMaterial(value, 'sample');
  const profile = validateBrowserRelayMonitoringProfile();
  const sample = exactKeys(value, ['schema', 'phase', ...SAMPLE_COUNTERS], 'sample');
  exact(sample.schema, 'miakapp.staging-browser-relay-monitoring-sample/1', 'sample.schema');
  if (!ALLOWED_PHASES.includes(sample.phase)) reject('sample.phase is invalid');
  for (const counter of SAMPLE_COUNTERS) {
    boundedInteger(sample[counter], 0, Number.MAX_SAFE_INTEGER, `sample.${counter}`);
  }
  const reasons = [];
  for (const [counter, maximum, reason] of STOP_CHECKS) {
    if (sample[counter] > profile.enforcement[maximum]) reasons.push(reason);
  }
  if (sample.relay_services !== profile.enforcement.required_relay_services) {
    reasons.push('relay_service_count_drift');
  }
  for (const counter of profile.enforcement.required_zero_counters) {
    if (sample[counter] !== 0) reasons.push(counter);
  }
  const result = {
    schema: SAMPLE_RESULT_SCHEMA,
    state: reasons.length === 0 ? 'within_reviewed_bounds' : 'stop_and_rollback_required',
    phase: sample.phase,
    stop_reasons: Object.freeze(reasons),
    observations: Object.freeze(Object.fromEntries(
      SAMPLE_COUNTERS.map((counter) => [counter, sample[counter]]),
    )),
  };
  rejectPrivateMaterial(result, 'sample_result');
  return Object.freeze(result);
}
