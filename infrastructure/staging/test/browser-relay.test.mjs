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

import {
  BROWSER_RELAY_PLAN_SHA256,
  BROWSER_RELAY_V10_PLAN_SHA256,
  BROWSER_RELAY_V11_PLAN_SHA256,
  BROWSER_RELAY_V12_PLAN_SHA256,
  BROWSER_RELAY_V13_PLAN_SHA256,
  BROWSER_RELAY_V8_PLAN_SHA256,
  BROWSER_RELAY_V9_PLAN_SHA256,
  StagingBrowserRelayPlanError,
  validateBrowserRelayPlan,
  validateBrowserRelayPlanValue,
  validateBrowserRelayV10Plan,
  validateBrowserRelayV11Plan,
  validateBrowserRelayV12Plan,
  validateBrowserRelayV13Plan,
  validateBrowserRelayV8Plan,
  validateBrowserRelayV9Plan,
} from '../browser-relay/contract.mjs';
import { validateBrowserRelayRoot } from '../browser-relay/guard.mjs';

const planPath = new URL('../browser-relay/plan.json', import.meta.url);
const v10PlanPath = new URL('../browser-relay/plan-v10.json', import.meta.url);
const v11PlanPath = new URL('../browser-relay/plan-v11.json', import.meta.url);
const v12PlanPath = new URL('../browser-relay/plan-v12.json', import.meta.url);
const v13PlanPath = new URL('../browser-relay/plan-v13.json', import.meta.url);
const v8PlanPath = new URL('../browser-relay/plan-v8.json', import.meta.url);
const v9PlanPath = new URL('../browser-relay/plan-v9.json', import.meta.url);
const planFixture = JSON.parse(readFileSync(planPath, 'utf8'));

function plan() {
  return structuredClone(planFixture);
}

function rejects(mutator, pattern = /drifted|invalid|must|reviewed|credential/u) {
  const candidate = plan();
  mutator(candidate);
  assert.throws(
    () => validateBrowserRelayPlanValue(candidate),
    (error) => error instanceof StagingBrowserRelayPlanError && pattern.test(error.message),
  );
}

test('accepts the operation-preflighted browser design without claiming matrix evidence', () => {
  const validated = validateBrowserRelayPlan(planPath);
  assert.equal(validated.schema, 'miakapp.staging-browser-relay-plan/1');
  assert.equal(validated.revision, 14);
  assert.equal(
    validated.state,
    'operation_preflighted_edge_orchestrator_preflighted_rollback_preflighted_monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed',
  );
  assert.equal(validated.target.project_id, 'miakapp-v4-staging');
  assert.equal(validated.target.cloud_mutation_authorized_by_document, false);
  assert.equal(validated.target.public_ingress_currently_active, false);
  assert.equal(validated.target.acceptance_executed, false);
  assert.equal(validated.pins.relay_services_profile_sha256, 'd47449d0b175b47ac0fdde5e0eb80c8b5d0eb43e4ac9a8af091c51f9aa4c390a');
  assert.equal(validated.pins.relay_services_converged_profile_sha256, '41392c96d68bf749c59757bc76d34a69e6eb407efa50b14f61b937c4f5a9b576');
  assert.equal(validated.pins.relay_services_private_ready_result_sha256, '27ee42c11af83f4e0133a6002540096b74d18ceb78a281e4fbd7c38b53cea4be');
  assert.equal(validated.pins.relay_services_live_inventory_sha256, '421338fec676c1fccd0e6747d3e8837d4151b147c95b343172639800779b64d1');
  assert.equal(validated.pins.browser_relay_runner_profile_sha256, '72b688ccd577f7b40b21d9f874bbca555324eaec1fbf2acbc87dee35cf83a536');
  assert.equal(validated.pins.browser_relay_monitoring_profile_sha256, 'df5d04aa28658a6b0b2bd59087dd60a1d837f271bb85da00823e2d2e39b2e661');
  assert.equal(validated.pins.browser_relay_monitoring_preflight_result_sha256, '618e074b9e4e9b6a532b2ecbfc87614ff5b382f9632397c4e86d111272425f64');
  assert.equal(validated.pins.browser_relay_rollback_profile_sha256, 'b3517720cb3874f040601d6dfcc7b0ecaf385c16d6b4299c102e2001f8bf18e7');
  assert.equal(validated.pins.browser_relay_rollback_preflight_result_sha256, 'e8ceb2164be946d4edebfe2f08d8a3b230dcf9d2a05d9410738e751775950cd3');
  assert.equal(validated.pins.browser_relay_orchestrator_profile_sha256, '76b4e6bc718e44d71ee4b5f19376e3ec7df28d304384c2736294f1874349a6da');
  assert.equal(validated.pins.browser_relay_orchestrator_preflight_result_sha256, '5ccbbab4edcc92820dbcf09ac592fdc7c57ebc277bd5c1f8a64a5fb9422f6e9e');
  assert.equal(validated.pins.browser_relay_operation_profile_sha256, 'd1ff776c48c0aade724fc31a8d44c7e68fe5c81919eab7030998962017801a73');
  assert.equal(validated.pins.browser_relay_operation_preflight_result_sha256, 'e3e7e6fab86b1cd777be94b9a9d2c215698d1ab842c92bfd54b6f4ff7d15e436');
  assert.equal(validated.preconditions.every(({ state }) => state === 'satisfied'), true);
  assert.equal(validated.evidence.state, 'absent');
  assert.deepEqual(validated.evidence.completed_case_ids, []);
  assert.match(BROWSER_RELAY_PLAN_SHA256, /^[0-9a-f]{64}$/u);
});

test('preserves the byte-exact revision-13 plan consumed by the operation preflight', () => {
  const historical = validateBrowserRelayV13Plan(v13PlanPath);
  assert.equal(historical.revision, 13);
  assert.equal(
    historical.state,
    'edge_orchestrator_preflighted_rollback_preflighted_monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed',
  );
  assert.equal(historical.preconditions.every(({ state }) => state === 'satisfied'), true);
  assert.equal(
    Object.hasOwn(historical.pins, 'browser_relay_operation_preflight_result_sha256'),
    false,
  );
  assert.equal(
    BROWSER_RELAY_V13_PLAN_SHA256,
    'a74a130f3946c7beaca8c2f019f36b1641f1fa47e4c8b63c24754892a18d702a',
  );
});

test('preserves the byte-exact revision-12 plan consumed by the edge preflight', () => {
  const historical = validateBrowserRelayV12Plan(v12PlanPath);
  assert.equal(historical.revision, 12);
  assert.equal(
    historical.state,
    'rollback_preflighted_monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed',
  );
  assert.equal(
    historical.preconditions.find(({ id }) => id === 'ROLLBACK-01').state,
    'satisfied',
  );
  assert.equal(
    historical.preconditions.find(({ id }) => id === 'EDGE-01').state,
    'open',
  );
  assert.equal(
    BROWSER_RELAY_V12_PLAN_SHA256,
    'b279f69cb91e8b20a96b3b45986cdc7f627f354eb541c881714bfcf0c38f2a20',
  );
});

test('preserves the byte-exact revision-11 plan consumed by the rollback preflight', () => {
  const historical = validateBrowserRelayV11Plan(v11PlanPath);
  assert.equal(historical.revision, 11);
  assert.equal(
    historical.state,
    'monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed',
  );
  assert.equal(
    historical.preconditions.find(({ id }) => id === 'MONITORING-01').state,
    'satisfied',
  );
  assert.equal(
    historical.preconditions.find(({ id }) => id === 'ROLLBACK-01').state,
    'open',
  );
  assert.equal(
    BROWSER_RELAY_V11_PLAN_SHA256,
    '607fd1cf84c56c5becf870b6ca38b3721ab7cc5ec750f7374363f5ae2cc63fe6',
  );
});

test('preserves the byte-exact revision-10 plan consumed by the monitoring preflight', () => {
  const historical = validateBrowserRelayV10Plan(v10PlanPath);
  assert.equal(historical.revision, 10);
  assert.equal(
    historical.state,
    'runner_implemented_private_relays_ready_plan_rebased_not_deployed',
  );
  assert.equal(
    historical.preconditions.find(({ id }) => id === 'RUNNER-01').state,
    'satisfied',
  );
  assert.equal(
    historical.preconditions.find(({ id }) => id === 'MONITORING-01').state,
    'open',
  );
  assert.equal(
    BROWSER_RELAY_V10_PLAN_SHA256,
    '614493a6ffd1c8c45044585368ae21eefa82afb65f031d2fd4e9028b215098da',
  );
});

test('preserves the byte-exact revision-9 plan consumed by the runner package', () => {
  const historical = validateBrowserRelayV9Plan(v9PlanPath);
  assert.equal(historical.revision, 9);
  assert.equal(historical.state, 'private_relays_ready_plan_rebased_not_deployed');
  assert.equal(
    historical.preconditions.find(({ id }) => id === 'RUNNER-01').state,
    'open',
  );
  assert.equal(
    BROWSER_RELAY_V9_PLAN_SHA256,
    'bdf2cea284b1031a2a78e3ab029a733cad5e68efde8e9e01c5230e01fe8333dc',
  );
});

test('preserves the byte-exact revision-8 plan used by the relay image operation', () => {
  const historical = validateBrowserRelayV8Plan(v8PlanPath);
  assert.equal(historical.revision, 8);
  assert.equal(historical.state, 'relay_process_admission_merged_root_reviewed_not_deployed');
  assert.equal(
    BROWSER_RELAY_V8_PLAN_SHA256,
    '4a5c13999d9f7f328b1b8b867bbd86d4c5e80cb980d9eb1324028ea0e5785343',
  );
});

test('pins a reversible scale-to-zero topology and a bounded public window', () => {
  const validated = validateBrowserRelayPlanValue(plan());
  assert.equal(validated.topology.profile, 'temporary_public_provider_endpoints');
  assert.equal(validated.topology.relays.length, 2);
  assert.equal(validated.topology.relays.every((relay) => (
    relay.minimum_instances === 0
    && relay.maximum_instances === 1
    && relay.runtime_iam_roles.length === 0
    && relay.private_ready_generation === 2
    && relay.private_ready_audience.startsWith('wss://miakapp-staging-relay-')
    && relay.public_invoker_before_window === false
    && relay.unauthenticated_invoker_during_window === true
    && relay.memory_mib === 512
    && relay.maximum_connections === 8
    && relay.maximum_connections_per_immediate_peer === 8
    && relay.maximum_aggregate_queued_bytes === 4194304
    && relay.forwarded_client_headers_trusted === false
  )), true);
  assert.equal(validated.topology.runner.cloud_compute_resources, 0);
  assert.equal(validated.topology.runner.unscheduled, true);
  assert.equal(validated.topology.runner.maximum_invocations, 3);
  assert.equal(Object.values(validated.topology.fixed_cost_services).every((entry) => entry === false), true);
  assert.equal(validated.budgets.maximum_public_window_seconds, 1200);
  assert.equal(validated.budgets.maximum_acceptance_executions, 1);
  assert.equal(validated.budgets.planned_incremental_upper_bound_eur, 1);
  assert.equal(validated.budgets.authorized_monthly_incremental_eur, 5);
  assert.equal(validated.budgets.free_tier_assumed, false);
  assert.equal(validated.budgets.stress_test, false);
  assert.equal(validated.baseline.control_plane.runtime_schema, 'miakapp.production-runtime/2');
  assert.equal(validated.baseline.control_plane.security_schema, 'miakapp.production-security/2');
  assert.equal(validated.baseline.control_plane.published_signing_keys, 2);
  assert.equal(validated.baseline.control_plane.current_signing_key_version, 1);
  assert.equal(validated.baseline.control_plane.overlap_schema_supported_by_source, true);
  assert.equal(validated.baseline.control_plane.network_profile, 'canonical');
  assert.equal(validated.baseline.control_plane.browser_relay_edge_profile_supported_by_source, true);
  assert.equal(validated.baseline.app_check.browser_provider_inventory, 'readable_registered_recaptcha_enterprise');
  assert.equal(validated.baseline.app_check.browser_attestation_validated, true);
  assert.equal(validated.baseline.application_data.firebase_auth_users, 0);
  assert.equal(validated.baseline.application_data.application_fixture_collections, 0);
  assert.deepEqual(validated.baseline.cloud_run_services, [
    'control-plane', 'miakapp-staging-relay-a', 'miakapp-staging-relay-b',
  ]);
  assert.equal(validated.baseline.relay_services, 2);
  assert.equal(validated.baseline.relay_service_account_present, true);
  assert.deepEqual(
    validated.preconditions.filter(({ state }) => state === 'satisfied').map(({ id }) => id),
    ['PIN-01', 'SIGNING-01', 'APP-CHECK-01', 'ROTATION-ENTRY-01', 'EDGE-01', 'RELAY-01',
      'RUNNER-01', 'MONITORING-01', 'ROLLBACK-01'],
  );
});

test('pins all pending matrix rows and routine signing-key timing', () => {
  const validated = validateBrowserRelayPlanValue(plan());
  assert.deepEqual(
    validated.matrix.map(({ id }) => id),
    Array.from({ length: 12 }, (_, index) => `LIVE-${String(index + 1).padStart(2, '0')}`),
  );
  assert.equal(validated.matrix.every(({ state, maximum_runs }) => (
    state === 'pending' && maximum_runs === 1
  )), true);
  assert.equal(validated.signing_rotation.state, 'rehearsal_entry_converged_version_1_current');
  assert.equal(validated.signing_rotation.baseline_current_version, 1);
  assert.deepEqual(validated.signing_rotation.baseline_published_versions, [1, 2]);
  assert.equal(validated.signing_rotation.rehearsal_entry_current_version, 1);
  assert.equal(validated.signing_rotation.acceptance_target_current_version, 2);
  assert.equal(validated.signing_rotation.prepublication_seconds, 60);
  assert.equal(validated.signing_rotation.retiring_key_retention_seconds, 330);
  assert.equal(validated.signing_rotation.new_kms_version_required, false);
  assert.equal(validated.signing_rotation.version_recreation_allowed, false);
  assert.equal(validated.signing_rotation.republish_removed_private_key, false);
});

test('rejects target, evidence and public-baseline escalation', () => {
  rejects((candidate) => { candidate.target.project_id = 'miakapp-v4'; });
  rejects((candidate) => { candidate.target.forbidden_project_ids.pop(); });
  rejects((candidate) => { candidate.target.cloud_mutation_authorized_by_document = true; });
  rejects((candidate) => { candidate.target.public_ingress_currently_active = true; });
  rejects((candidate) => { candidate.target.acceptance_executed = true; });
  rejects((candidate) => { candidate.baseline.control_plane.ingress = 'ALLOW_ALL'; });
  rejects((candidate) => { candidate.baseline.control_plane.unauthenticated_invokers = 1; });
  rejects((candidate) => { candidate.baseline.control_plane.runtime_schema = 'miakapp.production-runtime/1'; });
  rejects((candidate) => { candidate.baseline.control_plane.published_signing_keys = 1; });
  rejects((candidate) => { candidate.baseline.control_plane.current_signing_key_version = 2; });
  rejects((candidate) => { candidate.baseline.control_plane.overlap_schema_supported_by_source = false; });
  rejects((candidate) => { candidate.baseline.control_plane.network_profile = 'staging-browser-relay-acceptance'; });
  rejects((candidate) => { candidate.baseline.control_plane.browser_relay_edge_profile_supported_by_source = false; });
  rejects((candidate) => { candidate.baseline.app_check.browser_attestation_validated = false; });
  rejects((candidate) => { candidate.baseline.application_data.firebase_auth_users = 1; });
  rejects((candidate) => { candidate.baseline.application_data.application_fixture_collections = 1; });
  rejects((candidate) => { candidate.baseline.relay_services = 0; });
  rejects((candidate) => { candidate.baseline.relay_service_account_present = false; });
  rejects((candidate) => { candidate.evidence.state = 'succeeded'; });
  rejects((candidate) => { candidate.evidence.completed_case_ids.push('LIVE-01'); });
});

test('rejects fixed-cost, scale, duration, volume and free-tier drift', () => {
  rejects((candidate) => { candidate.topology.fixed_cost_services.app_engine = true; });
  rejects((candidate) => { candidate.topology.fixed_cost_services.external_load_balancer = true; });
  rejects((candidate) => { candidate.topology.relays[0].runtime_iam_roles.push('roles/viewer'); });
  rejects((candidate) => { candidate.topology.relays[0].minimum_instances = 1; });
  rejects((candidate) => { candidate.topology.relays[0].maximum_instances = 2; });
  rejects((candidate) => { candidate.topology.relays[0].private_ready_generation = 1; });
  rejects((candidate) => { candidate.topology.relays[0].public_invoker_before_window = true; });
  rejects((candidate) => { candidate.topology.relays[0].memory_mib = 256; });
  rejects((candidate) => { candidate.topology.relays[0].maximum_connections = 9; });
  rejects((candidate) => { candidate.topology.relays[0].maximum_connections_per_immediate_peer = 9; });
  rejects((candidate) => { candidate.topology.relays[0].maximum_aggregate_queued_bytes = 4194305; });
  rejects((candidate) => { candidate.topology.relays[0].forwarded_client_headers_trusted = true; });
  rejects((candidate) => { candidate.topology.runner.cloud_compute_resources = 1; });
  rejects((candidate) => { candidate.topology.runner.maximum_invocations = 4; });
  rejects((candidate) => { candidate.budgets.maximum_public_window_seconds = 1201; });
  rejects((candidate) => { candidate.budgets.maximum_acceptance_executions = 2; });
  rejects((candidate) => { candidate.budgets.maximum_kms_signatures = 17; });
  rejects((candidate) => { candidate.budgets.planned_incremental_upper_bound_eur = 6; });
  rejects((candidate) => { candidate.budgets.free_tier_assumed = true; });
  rejects((candidate) => { candidate.budgets.stress_test = true; });
});

test('rejects omitted blockers, reordered cases and false key-rotation claims', () => {
  rejects((candidate) => { candidate.preconditions[3].state = 'open'; });
  rejects((candidate) => { candidate.preconditions.pop(); });
  rejects((candidate) => { candidate.preconditions[5].state = 'open'; });
  rejects((candidate) => { candidate.preconditions[6].state = 'open'; });
  rejects((candidate) => { candidate.preconditions[7].state = 'open'; });
  rejects((candidate) => { candidate.preconditions[8].state = 'open'; });
  rejects((candidate) => { candidate.matrix.reverse(); });
  rejects((candidate) => { candidate.matrix[4].state = 'succeeded'; });
  rejects((candidate) => { candidate.matrix[4].maximum_runs = 2; });
  rejects((candidate) => { candidate.signing_rotation.state = 'ready'; });
  rejects((candidate) => { candidate.signing_rotation.prepublication_seconds = 59; });
  rejects((candidate) => { candidate.signing_rotation.retiring_key_retention_seconds = 329; });
  rejects((candidate) => { candidate.signing_rotation.rehearsal_entry_current_version = 2; });
  rejects((candidate) => { candidate.signing_rotation.new_kms_version_required = true; });
  rejects((candidate) => { candidate.signing_rotation.version_recreation_allowed = true; });
  rejects((candidate) => { candidate.signing_rotation.republish_removed_private_key = true; });
});

test('rejects rollback weakening, unknown fields and credential material', () => {
  rejects((candidate) => { candidate.rollback.ordered_steps.shift(); });
  rejects((candidate) => { candidate.rollback.required_final_state.relay_services = 0; });
  rejects((candidate) => { candidate.rollback.required_final_state.relay_phase = 'absent'; });
  rejects((candidate) => { candidate.rollback.required_final_state.relay_public_invokers = 1; });
  rejects((candidate) => { candidate.rollback.required_final_state.miakapp_3_touched = true; });
  rejects((candidate) => { candidate.unreviewed = true; });
  rejects((candidate) => { candidate.access_token = 'Bearer should-never-be-here'; }, /credential/u);
  rejects((candidate) => {
    candidate.pins.miakapp_v3_commit = 'eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.c2lnbmF0dXJl';
  }, /credential/u);
});

test('guards the exact non-executable browser-relay package inventory', () => {
  validateBrowserRelayRoot(new URL('../browser-relay/', import.meta.url));

  const root = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-root-'));
  for (const name of ['README.md', 'contract.mjs', 'guard.mjs', 'plan-v8.json', 'plan-v9.json', 'plan-v10.json', 'plan-v11.json', 'plan-v12.json', 'plan-v13.json', 'plan.json', 'validate.mjs']) {
    copyFileSync(new URL(`../browser-relay/${name}`, import.meta.url), join(root, name));
    chmodSync(join(root, name), 0o600);
  }
  writeFileSync(join(root, 'deploy.sh'), '#!/bin/sh\n');
  assert.throws(
    () => validateBrowserRelayRoot(new URL(`file://${root}/`)),
    /reviewed file inventory/u,
  );
});

test('rejects symlinked or executable package entries', () => {
  const executableRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-executable-'));
  for (const name of ['README.md', 'contract.mjs', 'guard.mjs', 'plan-v8.json', 'plan-v9.json', 'plan-v10.json', 'plan-v11.json', 'plan-v12.json', 'plan-v13.json', 'plan.json', 'validate.mjs']) {
    copyFileSync(new URL(`../browser-relay/${name}`, import.meta.url), join(executableRoot, name));
    chmodSync(join(executableRoot, name), name === 'validate.mjs' ? 0o700 : 0o600);
  }
  assert.throws(
    () => validateBrowserRelayRoot(new URL(`file://${executableRoot}/`)),
    /must not be executable/u,
  );

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-symlink-'));
  for (const name of ['README.md', 'contract.mjs', 'guard.mjs', 'plan-v8.json', 'plan-v9.json', 'plan-v10.json', 'plan-v11.json', 'plan-v12.json', 'plan-v13.json', 'plan.json']) {
    copyFileSync(new URL(`../browser-relay/${name}`, import.meta.url), join(symlinkRoot, name));
    chmodSync(join(symlinkRoot, name), 0o600);
  }
  symlinkSync(join(symlinkRoot, 'contract.mjs'), join(symlinkRoot, 'validate.mjs'));
  assert.throws(
    () => validateBrowserRelayRoot(new URL(`file://${symlinkRoot}/`)),
    /must be a regular file/u,
  );
});
