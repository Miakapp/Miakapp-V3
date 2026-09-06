import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';

import {
  buildMonitoringQueryUrl,
  observeMonitoringPreflight,
} from '../browser-relay-monitoring/cloud.mjs';
import {
  APPROVED_BILLING_ACCOUNT_SHA256,
  BROWSER_RELAY_V10_PLAN_SHA256,
  MONITORING_IMPLEMENTATION_COMMIT,
  MONITORING_PREFLIGHT_RESULT_SHA256,
  MONITORING_PROFILE_SHA256,
  SAMPLE_RESULT_SCHEMA,
  StagingBrowserRelayMonitoringError,
  buildMonitoringPreflightResult,
  evaluateMonitoringSample,
  validateBrowserRelayMonitoringProfile,
  validateMonitoringCloudObservation,
  validateMonitoringPreflightResult,
} from '../browser-relay-monitoring/contract.mjs';
import {
  validateBrowserRelayMonitoringRoot,
} from '../browser-relay-monitoring/guard.mjs';

const profile = JSON.parse(readFileSync(
  new URL('../browser-relay-monitoring/profile.json', import.meta.url),
  'utf8',
));

function cloudObservation(overrides = {}) {
  return {
    schema: 'miakapp.staging-browser-relay-monitoring-cloud-observation/1',
    project_id: 'miakapp-v4-staging',
    project_number: '1072737219170',
    region: 'europe-west9',
    observed_at: '2026-09-06T08:00:00.000Z',
    private_boundary: {
      control_plane_state: 'canonical_private',
      control_plane_revision: 'control-plane-00010-vop',
      control_plane_public_invokers: 0,
      relay_phase: 'private_ready',
      relay_services: 2,
      relay_public_invokers: 0,
    },
    metric_descriptors: globalThis.structuredClone(profile.observation.metric_descriptors),
    queries: profile.observation.queries.map((query, index) => ({
      id: query.id,
      metric_type: query.metric_type,
      state: 'readable',
      query_interval_seconds: 300,
      query_view: 'HEADERS',
      series_headers_observed: index,
      raw_points_retained: false,
    })),
    billing_budget: {
      state: 'configured',
      matching_budgets: 1,
      billing_account_sha256: APPROVED_BILLING_ACCOUNT_SHA256,
      resource_name_sha256: '1'.repeat(64),
      display_name: 'Miakapp V4 staging monthly',
      project_number: '1072737219170',
      currency: 'EUR',
      amount_units: 10,
      calendar_period: 'MONTH',
      credit_types_treatment: 'INCLUDE_ALL_CREDITS',
      thresholds: [0.2, 0.5, 1],
      spend_basis: 'CURRENT_SPEND',
      project_level_recipients: true,
      raw_resource_name_retained: false,
    },
    raw_retention: {
      metric_points: false,
      time_series: false,
      budget_resource_name: false,
      api_errors: false,
    },
    ...overrides,
  };
}

function sample(overrides = {}) {
  return {
    schema: 'miakapp.staging-browser-relay-monitoring-sample/1',
    phase: 'public_window',
    acceptance_executions: 1,
    browser_invocations: 3,
    cloud_builds: 0,
    control_plane_exchanges: 16,
    control_plane_public_instance_seconds: 1200,
    credential_or_private_traffic_diagnostics: 0,
    firebase_or_app_check_tokens_on_websocket: 0,
    firestore_writes: 64,
    identity_or_audience_binding_failures: 0,
    kms_signatures: 16,
    maximum_instances_per_service: 1,
    persistent_iam_mutations: 0,
    projected_incremental_milli_eur: 1000,
    public_window_seconds: 1200,
    recaptcha_assessments: 16,
    relay_services: 2,
    rollback_precondition_failures: 0,
    total_relay_instance_seconds: 2400,
    unexpected_project_mutations: 0,
    ...overrides,
  };
}

test('pins a dormant monitoring profile with six allowlisted read-only queries', () => {
  const validated = validateBrowserRelayMonitoringProfile();
  assert.equal(validated.state, 'closed_monitoring_contract_implemented_not_observed');
  assert.equal(validated.observation.metric_descriptors.length, 6);
  assert.equal(validated.observation.queries.length, 6);
  assert.equal(validated.observation.query_view, 'HEADERS');
  assert.equal(validated.observation.query_interval_seconds, 300);
  assert.equal(validated.target.cloud_compute_resources, 0);
  assert.equal(validated.target.cloud_mutation_authorized_by_profile, false);
  assert.equal(validated.target.public_ingress_authorized_by_profile, false);
  assert.equal(validated.evidence.live_preflight_count, 0);
  assert.equal(validated.pins.browser_relay_plan_sha256, BROWSER_RELAY_V10_PLAN_SHA256);
  assert.match(MONITORING_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
});

test('builds exact header-only Cloud Run queries without mixed label operators', () => {
  const url = buildMonitoringQueryUrl(
    profile.observation.queries[0],
    '2026-09-06T07:55:00.000Z',
    '2026-09-06T08:00:00.000Z',
  );
  assert.equal(url.searchParams.get('view'), 'HEADERS');
  assert.equal(url.searchParams.get('pageSize'), '100');
  assert.equal(url.searchParams.get('interval.startTime'), '2026-09-06T07:55:00.000Z');
  assert.match(url.searchParams.get('filter'), /resource\.labels\.location = "europe-west9"/u);
  assert.match(url.searchParams.get('filter'), /resource\.labels\.service_name = one_of\(/u);
  assert.doesNotMatch(url.searchParams.get('filter'), / OR resource\.labels/u);
  assert.throws(
    () => buildMonitoringQueryUrl(
      { ...profile.observation.queries[0], resource_type: 'global' },
      '2026-09-06T07:55:00.000Z',
      '2026-09-06T08:00:00.000Z',
    ),
    /reviewed allowlist/u,
  );
});

test('builds a closed preflight result only at the exact private boundary', () => {
  const observation = validateMonitoringCloudObservation(cloudObservation());
  const result = buildMonitoringPreflightResult(observation);
  assert.equal(result.state, 'allowlisted_monitoring_observed_at_private_boundary');
  assert.equal(result.implementation_commit, MONITORING_IMPLEMENTATION_COMMIT);
  assert.equal(result.control_plane_state, 'canonical_private');
  assert.equal(result.control_plane_public_invokers, 0);
  assert.equal(result.relay_phase, 'private_ready');
  assert.equal(result.relay_public_invokers, 0);
  assert.equal(result.metric_descriptors_observed, 6);
  assert.equal(result.allowlisted_queries_succeeded, 6);
  assert.equal(result.series_headers_observed, 15);
  assert.equal(result.budget_amount_eur, 10);
  assert.deepEqual(result.budget_thresholds_eur, [2, 5, 10]);
  assert.equal(result.cloud_mutations, 0);
  assert.equal(result.raw_cloud_responses_retained, false);
});

test('pins the exact sanitized successful live monitoring preflight', () => {
  const result = validateMonitoringPreflightResult();
  assert.equal(result.implementation_commit, MONITORING_IMPLEMENTATION_COMMIT);
  assert.equal(result.browser_relay_plan_sha256, BROWSER_RELAY_V10_PLAN_SHA256);
  assert.equal(result.control_plane_public_invokers, 0);
  assert.equal(result.relay_public_invokers, 0);
  assert.equal(result.metric_descriptors_observed, 6);
  assert.equal(result.allowlisted_queries_succeeded, 6);
  assert.equal(result.cloud_mutations, 0);
  assert.equal(result.acceptance_executions, 0);
  assert.match(MONITORING_PREFLIGHT_RESULT_SHA256, /^[0-9a-f]{64}$/u);
});

test('rejects descriptor, budget, boundary, pagination and private-output drift', () => {
  const descriptor = cloudObservation();
  descriptor.metric_descriptors[0].metric_kind = 'GAUGE';
  assert.throws(
    () => validateMonitoringCloudObservation(descriptor),
    StagingBrowserRelayMonitoringError,
  );

  const budget = cloudObservation();
  budget.billing_budget.thresholds = [0.5, 1];
  assert.throws(() => validateMonitoringCloudObservation(budget), /billing_budget/u);

  const boundary = cloudObservation();
  boundary.private_boundary.control_plane_public_invokers = 1;
  assert.throws(() => validateMonitoringCloudObservation(boundary), /public_invokers/u);

  const unbounded = cloudObservation();
  unbounded.queries[0].series_headers_observed = 101;
  assert.throws(() => validateMonitoringCloudObservation(unbounded), /reviewed bound/u);

  const privateField = cloudObservation();
  privateField.token = 'must-not-be-retained';
  assert.throws(() => validateMonitoringCloudObservation(privateField), /forbidden/u);
});

test('accepts exact budget edges and emits deterministic stop-and-rollback reasons', () => {
  const safe = evaluateMonitoringSample(sample());
  assert.equal(safe.schema, SAMPLE_RESULT_SCHEMA);
  assert.equal(safe.state, 'within_reviewed_bounds');
  assert.deepEqual(safe.stop_reasons, []);

  const stopped = evaluateMonitoringSample(sample({
    public_window_seconds: 1201,
    recaptcha_assessments: 17,
    relay_services: 1,
    firebase_or_app_check_tokens_on_websocket: 1,
    persistent_iam_mutations: 1,
  }));
  assert.equal(stopped.state, 'stop_and_rollback_required');
  assert.deepEqual(stopped.stop_reasons, [
    'public_window_limit',
    'recaptcha_assessment_limit',
    'relay_service_count_drift',
    'firebase_or_app_check_tokens_on_websocket',
    'persistent_iam_mutations',
  ]);
  assert.equal(stopped.observations.public_window_seconds, 1201);
});

test('rejects unknown, negative and credential-shaped sample input', () => {
  assert.throws(() => evaluateMonitoringSample({ ...sample(), debug: 1 }), /reviewed fields/u);
  assert.throws(() => evaluateMonitoringSample(sample({ kms_signatures: -1 })), /reviewed bound/u);
  assert.throws(
    () => evaluateMonitoringSample({ ...sample(), token: 'eyJprivate.private.private' }),
    /forbidden|credential/u,
  );
});

test('rejects an unapproved billing account before any cloud request', async () => {
  let requests = 0;
  await assert.rejects(
    observeMonitoringPreflight({
      accessToken: 'synthetic-ephemeral-access-token',
      billingAccountId: 'AAAAAA-BBBBBB-CCCCCC',
    }, {
      fetchImplementation: async () => {
        requests += 1;
        throw new Error('must not run');
      },
    }),
    /approved ephemeral operator session/u,
  );
  assert.equal(requests, 0);
});

test('guards the exact dormant package and rejects extras, executables and symlinks', () => {
  const names = [
    'README.md', 'cloud.mjs', 'contract.mjs', 'guard.mjs',
    'preflight-result-v1.json', 'profile.json',
  ];
  validateBrowserRelayMonitoringRoot(
    new URL('../browser-relay-monitoring/', import.meta.url),
  );

  const extraRoot = mkdtempSync(join(tmpdir(), 'miakapp-monitoring-extra-'));
  for (const name of names) {
    copyFileSync(
      new URL(`../browser-relay-monitoring/${name}`, import.meta.url),
      join(extraRoot, name),
    );
    chmodSync(join(extraRoot, name), 0o600);
  }
  writeFileSync(join(extraRoot, 'run.sh'), '#!/bin/sh\n');
  assert.throws(
    () => validateBrowserRelayMonitoringRoot(new URL(`file://${extraRoot}/`)),
    /reviewed file inventory/u,
  );

  const executableRoot = mkdtempSync(join(tmpdir(), 'miakapp-monitoring-executable-'));
  for (const name of names) {
    copyFileSync(
      new URL(`../browser-relay-monitoring/${name}`, import.meta.url),
      join(executableRoot, name),
    );
    chmodSync(join(executableRoot, name), name === 'cloud.mjs' ? 0o700 : 0o600);
  }
  assert.throws(
    () => validateBrowserRelayMonitoringRoot(new URL(`file://${executableRoot}/`)),
    /must not be executable/u,
  );

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-monitoring-symlink-'));
  for (const name of names.filter((name) => name !== 'README.md')) {
    copyFileSync(
      new URL(`../browser-relay-monitoring/${name}`, import.meta.url),
      join(symlinkRoot, name),
    );
    chmodSync(join(symlinkRoot, name), 0o600);
  }
  symlinkSync(new URL('../browser-relay-monitoring/README.md', import.meta.url),
    join(symlinkRoot, 'README.md'));
  assert.throws(
    () => validateBrowserRelayMonitoringRoot(new URL(`file://${symlinkRoot}/`)),
    /regular files only/u,
  );
});
