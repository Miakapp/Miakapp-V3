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
  StagingBrowserRelayPlanError,
  validateBrowserRelayPlan,
  validateBrowserRelayPlanValue,
} from '../browser-relay/contract.mjs';
import { validateBrowserRelayRoot } from '../browser-relay/guard.mjs';

const planPath = new URL('../browser-relay/plan.json', import.meta.url);
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

test('accepts the rebased browser-relay design without claiming live evidence', () => {
  const validated = validateBrowserRelayPlan(planPath);
  assert.equal(validated.schema, 'miakapp.staging-browser-relay-plan/1');
  assert.equal(validated.revision, 5);
  assert.equal(validated.state, 'rebased_reviewed_not_deployed');
  assert.equal(validated.target.project_id, 'miakapp-v4-staging');
  assert.equal(validated.target.cloud_mutation_authorized_by_document, false);
  assert.equal(validated.target.public_ingress_currently_active, false);
  assert.equal(validated.target.acceptance_executed, false);
  assert.equal(validated.evidence.state, 'absent');
  assert.deepEqual(validated.evidence.completed_case_ids, []);
  assert.match(BROWSER_RELAY_PLAN_SHA256, /^[0-9a-f]{64}$/u);
});

test('pins a reversible scale-to-zero topology and a bounded public window', () => {
  const validated = validateBrowserRelayPlanValue(plan());
  assert.equal(validated.topology.profile, 'temporary_public_provider_endpoints');
  assert.equal(validated.topology.relays.length, 2);
  assert.equal(validated.topology.relays.every((relay) => (
    relay.minimum_instances === 0
    && relay.maximum_instances === 1
    && relay.runtime_iam_roles.length === 0
    && relay.endpoint_before_apply === null
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
  assert.equal(validated.baseline.control_plane.current_signing_key_version, 2);
  assert.equal(validated.baseline.control_plane.overlap_schema_supported_by_source, true);
  assert.equal(validated.baseline.app_check.browser_provider_inventory, 'readable_registered_recaptcha_enterprise');
  assert.equal(validated.baseline.app_check.browser_attestation_validated, true);
  assert.equal(validated.baseline.application_data.firebase_auth_users, 0);
  assert.equal(validated.baseline.application_data.application_fixture_collections, 0);
  assert.deepEqual(
    validated.preconditions.filter(({ state }) => state === 'satisfied').map(({ id }) => id),
    ['PIN-01', 'SIGNING-01', 'APP-CHECK-01'],
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
  assert.equal(validated.signing_rotation.state, 'two_key_runtime_ready_rehearsal_entry_pending');
  assert.equal(validated.signing_rotation.baseline_current_version, 2);
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
  rejects((candidate) => { candidate.baseline.control_plane.current_signing_key_version = 1; });
  rejects((candidate) => { candidate.baseline.control_plane.overlap_schema_supported_by_source = false; });
  rejects((candidate) => { candidate.baseline.app_check.browser_attestation_validated = false; });
  rejects((candidate) => { candidate.baseline.application_data.firebase_auth_users = 1; });
  rejects((candidate) => { candidate.baseline.application_data.application_fixture_collections = 1; });
  rejects((candidate) => { candidate.evidence.state = 'succeeded'; });
  rejects((candidate) => { candidate.evidence.completed_case_ids.push('LIVE-01'); });
});

test('rejects fixed-cost, scale, duration, volume and free-tier drift', () => {
  rejects((candidate) => { candidate.topology.fixed_cost_services.app_engine = true; });
  rejects((candidate) => { candidate.topology.fixed_cost_services.external_load_balancer = true; });
  rejects((candidate) => { candidate.topology.relays[0].runtime_iam_roles.push('roles/viewer'); });
  rejects((candidate) => { candidate.topology.relays[0].minimum_instances = 1; });
  rejects((candidate) => { candidate.topology.relays[0].maximum_instances = 2; });
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
  rejects((candidate) => { candidate.preconditions[3].state = 'satisfied'; });
  rejects((candidate) => { candidate.preconditions.pop(); });
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
  rejects((candidate) => { candidate.rollback.required_final_state.relay_services = 1; });
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
  for (const name of ['README.md', 'contract.mjs', 'guard.mjs', 'plan.json', 'validate.mjs']) {
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
  for (const name of ['README.md', 'contract.mjs', 'guard.mjs', 'plan.json', 'validate.mjs']) {
    copyFileSync(new URL(`../browser-relay/${name}`, import.meta.url), join(executableRoot, name));
    chmodSync(join(executableRoot, name), name === 'validate.mjs' ? 0o700 : 0o600);
  }
  assert.throws(
    () => validateBrowserRelayRoot(new URL(`file://${executableRoot}/`)),
    /must not be executable/u,
  );

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-symlink-'));
  for (const name of ['README.md', 'contract.mjs', 'guard.mjs', 'plan.json']) {
    copyFileSync(new URL(`../browser-relay/${name}`, import.meta.url), join(symlinkRoot, name));
    chmodSync(join(symlinkRoot, name), 0o600);
  }
  symlinkSync(join(symlinkRoot, 'contract.mjs'), join(symlinkRoot, 'validate.mjs'));
  assert.throws(
    () => validateBrowserRelayRoot(new URL(`file://${symlinkRoot}/`)),
    /must be a regular file/u,
  );
});
