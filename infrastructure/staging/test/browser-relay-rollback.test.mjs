import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';

import {
  observeRollbackApplicationData,
  observeRollbackIamBoundary,
  observeRollbackPreflight,
} from '../browser-relay-rollback/cloud.mjs';
import {
  RELAY_PRIVATE_READY_INVENTORY_SHA256,
  ROLLBACK_PROFILE_SHA256,
  buildRollbackPreflightResult,
  summarizeRelayTerraformNoChangePlan,
  validateBrowserRelayRollbackProfile,
  validateRollbackCloudObservation,
} from '../browser-relay-rollback/contract.mjs';
import {
  validateBrowserRelayRollbackRoot,
} from '../browser-relay-rollback/guard.mjs';

const IMPLEMENTATION_COMMIT = '1'.repeat(40);
const OBSERVED_AT = '2026-09-06T07:00:00.000Z';

function terraformPlan() {
  const resource = (address, type) => ({
    address,
    mode: 'managed',
    type,
    change: { actions: ['no-op'] },
  });
  return {
    format_version: '1.2',
    terraform_version: '1.11.3',
    variables: {
      deployment_phase: { value: 'private_ready' },
      relay_audiences: {
        value: {
          'relay-a': 'wss://miakapp-staging-relay-a-aczhngqraq-od.a.run.app/ws',
          'relay-b': 'wss://miakapp-staging-relay-b-aczhngqraq-od.a.run.app/ws',
        },
      },
    },
    resource_changes: [
      resource(
        'google_cloud_run_v2_service.relay["relay-a"]',
        'google_cloud_run_v2_service',
      ),
      resource(
        'google_cloud_run_v2_service.relay["relay-b"]',
        'google_cloud_run_v2_service',
      ),
      resource('google_service_account.relay["runtime"]', 'google_service_account'),
      resource('terraform_data.deployment_guard["active"]', 'terraform_data'),
    ],
    output_changes: {
      staging_browser_relays: { actions: ['no-op'] },
    },
  };
}

function privateBoundary() {
  return {
    control_plane: {
      state: 'canonical_private',
      revision: 'control-plane-00010-vop',
      ingress: 'ALLOW_INTERNAL_ONLY',
      unauthenticated_invokers: 0,
      minimum_instances: 0,
    },
    relays: {
      phase: 'private_ready',
      services: 2,
      public_invokers: 0,
      service_account_user_managed_keys: 0,
      minimum_instances: 0,
      inventory_sha256: RELAY_PRIVATE_READY_INVENTORY_SHA256,
    },
  };
}

function hosting() {
  return {
    site_disabled: true,
    versions: 6,
    deleted_versions: 6,
    releases: 6,
    runner_route_status: 404,
  };
}

function applicationData() {
  return {
    firebase_auth_users: 0,
    technical_root_collections: [
      'controlAdmissionBuckets',
      'controlAdmissionState',
      'controlAudit',
    ],
    application_fixture_collections: 0,
  };
}

function iam() {
  return {
    temporary_acceptance_bindings: 0,
    unexpected_public_project_bindings: 0,
  };
}

function cloudObservation() {
  return {
    schema: 'miakapp.staging-browser-relay-rollback-cloud-observation/1',
    project_id: 'miakapp-v4-staging',
    project_number: '1072737219170',
    region: 'europe-west9',
    observed_at: OBSERVED_AT,
    implementation_commit: IMPLEMENTATION_COMMIT,
    ...privateBoundary(),
    hosting: hosting(),
    application_data: applicationData(),
    iam: iam(),
    terraform: summarizeRelayTerraformNoChangePlan(terraformPlan()),
    effects: {
      cloud_mutations: 0,
      public_ingress_changes: 0,
      acceptance_executions: 0,
      credentials_retained: false,
      raw_cloud_responses_retained: false,
    },
  };
}

function jsonResponse(value) {
  return new globalThis.Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('pins the dormant rollback contract to plan revision 11 and exact dependencies', () => {
  const profile = validateBrowserRelayRollbackProfile();
  assert.equal(profile.state, 'closed_rollback_preflight_implemented_not_observed');
  assert.equal(profile.pins.browser_relay_plan_sha256,
    '607fd1cf84c56c5becf870b6ca38b3721ab7cc5ec750f7374363f5ae2cc63fe6');
  assert.equal(ROLLBACK_PROFILE_SHA256,
    'b3517720cb3874f040601d6dfcc7b0ecaf385c16d6b4299c102e2001f8bf18e7');
  assert.equal(profile.rollback.ordered_steps.length, 6);
  assert.equal(profile.required_final_state.terraform_convergence, 'no_changes');
  assert.equal(profile.evidence.live_preflight_count, 0);
});

test('accepts only the exact zero-change private-ready Terraform plan', () => {
  assert.deepEqual(summarizeRelayTerraformNoChangePlan(terraformPlan()), {
    state: 'no_changes',
    terraform_version: '1.11.3',
    managed_resource_noops: 4,
    output_noops: 1,
    creates: 0,
    updates: 0,
    deletes: 0,
    replacements: 0,
    raw_plan_retained: false,
  });
  const changed = globalThis.structuredClone(terraformPlan());
  changed.resource_changes[0].change.actions = ['update'];
  assert.throws(() => summarizeRelayTerraformNoChangePlan(changed), /exact no-op/u);
  const publicPlan = globalThis.structuredClone(terraformPlan());
  publicPlan.resource_changes[0].change.after = { member: 'allUsers' };
  assert.throws(() => summarizeRelayTerraformNoChangePlan(publicPlan), /forbidden target/u);
  const drifted = globalThis.structuredClone(terraformPlan());
  drifted.resource_drift = [{ address: 'unexpected' }];
  assert.throws(() => summarizeRelayTerraformNoChangePlan(drifted), /contains drift/u);
});

test('builds only the closed rollback preflight result', () => {
  const observation = validateRollbackCloudObservation(cloudObservation());
  const result = buildRollbackPreflightResult(observation);
  assert.equal(result.state, 'rollback_target_preflighted_private_and_converged');
  assert.equal(result.control_plane_state, 'canonical_private');
  assert.equal(result.relay_phase, 'private_ready');
  assert.equal(result.runner_route_present, false);
  assert.equal(result.terraform_convergence, 'no_changes');
  assert.equal(result.rollback_steps, 6);
  assert.equal(result.cloud_mutations, 0);
  assert.equal(result.credential_material_retained, false);

  const publicEdge = cloudObservation();
  publicEdge.control_plane.unauthenticated_invokers = 1;
  assert.throws(() => buildRollbackPreflightResult(publicEdge), /unauthenticated_invokers/u);
  const fixture = cloudObservation();
  fixture.application_data.application_fixture_collections = 1;
  assert.throws(() => buildRollbackPreflightResult(fixture), /application_fixture_collections/u);
  const credential = cloudObservation();
  credential.access_token = 'not-allowed';
  assert.throws(() => buildRollbackPreflightResult(credential), /forbidden output/u);
});

test('composes the four read-only observers with one no-change plan', async () => {
  const result = await observeRollbackPreflight(
    { accessToken: 'test-ephemeral-access-token-value' },
    {
      implementationCommit: IMPLEMENTATION_COMMIT,
      terraformPlan: terraformPlan(),
      fetchImplementation: async () => { throw new Error('network should be injected'); },
      clock: () => Date.parse(OBSERVED_AT),
      privateBoundaryObserver: async () => privateBoundary(),
      hostingObserver: async () => hosting(),
      applicationDataObserver: async () => applicationData(),
      iamObserver: async () => iam(),
    },
  );
  assert.equal(result.observed_at, OBSERVED_AT);
  assert.equal(result.implementation_commit, IMPLEMENTATION_COMMIT);
  assert.equal(result.public_ingress_changes, 0);
  assert.equal(result.acceptance_executions, 0);
  assert.equal(result.terraform_plan_retained, false);
});

test('uses only one GET and one read-only POST for application data', async () => {
  const requests = [];
  const result = await observeRollbackApplicationData(
    { accessToken: 'test-ephemeral-access-token-value' },
    async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('accounts:batchGet')) return jsonResponse({});
      if (String(url).includes('documents:listCollectionIds')) {
        return jsonResponse({ collectionIds: [
          'controlAudit',
          'controlAdmissionState',
          'controlAdmissionBuckets',
        ] });
      }
      throw new Error('unexpected request');
    },
  );
  assert.deepEqual(result, applicationData());
  assert.deepEqual(requests.map(({ options }) => options.method), ['GET', 'POST']);
  assert.equal(requests.every(({ options }) => options.headers['X-Goog-User-Project']
    === 'miakapp-v4-staging'), true);
});

test('rejects temporary or public project IAM while retaining no policy details', async () => {
  const session = { accessToken: 'test-ephemeral-access-token-value' };
  const closed = await observeRollbackIamBoundary(
    session,
    async () => jsonResponse({ bindings: [{
      role: 'roles/viewer',
      members: ['serviceAccount:example@miakapp-v4-staging.iam.gserviceaccount.com'],
    }] }),
  );
  assert.deepEqual(closed, iam());
  await assert.rejects(
    observeRollbackIamBoundary(session, async () => jsonResponse({ bindings: [{
      role: 'roles/viewer',
      members: ['serviceAccount:example@miakapp-v4-staging.iam.gserviceaccount.com'],
      condition: { title: 'temporary_browser_relay_acceptance_fixture' },
    }] })),
    /closed rollback target/u,
  );
  await assert.rejects(
    observeRollbackIamBoundary(session, async () => jsonResponse({ bindings: [{
      role: 'roles/viewer',
      members: ['allUsers'],
    }] })),
    /closed rollback target/u,
  );
});

test('guards the exact dormant package and rejects extras, executables and symlinks', () => {
  const names = ['README.md', 'cloud.mjs', 'contract.mjs', 'guard.mjs', 'profile.json'];
  validateBrowserRelayRollbackRoot(new URL('../browser-relay-rollback/', import.meta.url));

  const extraRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-rollback-extra-'));
  for (const name of names) {
    copyFileSync(new URL(`../browser-relay-rollback/${name}`, import.meta.url), join(extraRoot, name));
    chmodSync(join(extraRoot, name), 0o600);
  }
  writeFileSync(join(extraRoot, 'apply.sh'), '#!/bin/sh\n');
  assert.throws(
    () => validateBrowserRelayRollbackRoot(new URL(`file://${extraRoot}/`)),
    /reviewed file inventory/u,
  );

  const executableRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-rollback-exec-'));
  for (const name of names) {
    copyFileSync(new URL(`../browser-relay-rollback/${name}`, import.meta.url), join(executableRoot, name));
    chmodSync(join(executableRoot, name), name === 'cloud.mjs' ? 0o700 : 0o600);
  }
  assert.throws(
    () => validateBrowserRelayRollbackRoot(new URL(`file://${executableRoot}/`)),
    /must not be executable/u,
  );

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-rollback-link-'));
  for (const name of names.filter((name) => name !== 'profile.json')) {
    copyFileSync(new URL(`../browser-relay-rollback/${name}`, import.meta.url), join(symlinkRoot, name));
    chmodSync(join(symlinkRoot, name), 0o600);
  }
  symlinkSync(new URL('../browser-relay-rollback/profile.json', import.meta.url),
    join(symlinkRoot, 'profile.json'));
  assert.throws(
    () => validateBrowserRelayRollbackRoot(new URL(`file://${symlinkRoot}/`)),
    /regular files only/u,
  );
});
