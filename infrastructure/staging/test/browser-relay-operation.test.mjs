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

import {
  PROBE_PRINCIPAL,
  normalizeEdgeInventory,
} from '../browser-relay-edge/inventory.mjs';
import {
  CONTROL_PLANE_URI,
  DEPLOYED_REPOSITORY_COMMIT,
  DEPLOYED_SOURCE_SHA256,
  EDGE_PROFILE,
  FUNCTION_NAME,
  RUN_SERVICE_NAME,
  runtimeJson,
} from '../browser-relay-edge/runtime.mjs';
import {
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
  ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
  ORCHESTRATOR_PROFILE_SHA256,
  canonicalJson as orchestratorCanonicalJson,
  sha256 as orchestratorSha256,
  validateOrchestratorPreflightResult,
} from '../browser-relay-orchestrator/contract.mjs';
import {
  buildOrchestratorClaim,
  orchestratorClaimAbsence,
} from '../browser-relay-orchestrator/claim.mjs';
import {
  OPERATION_IMPLEMENTATION_BASE_COMMIT,
  OPERATION_PREFLIGHT_RESULT_SCHEMA,
  OPERATION_PROFILE_SHA256,
  OPERATION_SOURCE_SHA256,
  StagingBrowserRelayOperationError,
  evaluateOperationMonitoringSample,
  rejectOperationPrivateMaterial,
  validateBrowserRelayOperationProfile,
  validateClosedRunnerResult,
  validateFinalCleanup,
  validateOperationPreflightResultValue,
  validateOperationResult,
  validateWindowBaseline,
  validateWindowCleanup,
} from '../browser-relay-operation/contract.mjs';
import { validateBrowserRelayOperationRoot } from '../browser-relay-operation/guard.mjs';
import { runSingleUseBrowserRelayOperation } from '../browser-relay-operation/operation.mjs';
import {
  buildOperationPreflightResult,
  observeOperationPreflight,
} from '../browser-relay-operation/preflight.mjs';
import { RUNNER_RESULT_SCHEMA } from '../browser-relay-runner/contract.mjs';

const START = Date.parse('2026-09-06T10:00:00.000Z');
const UPDATE_TIMES = Object.freeze([
  '2026-09-05T19:48:55.366699112Z',
  '2026-09-06T10:00:01.000000001Z',
  '2026-09-06T10:00:02.000000001Z',
  '2026-09-06T10:00:03.000000001Z',
]);

function functionFixture(options = {}) {
  const profile = options.profile ?? 'canonical';
  const ingress = options.ingress ?? 'ALLOW_INTERNAL_ONLY';
  const revision = options.revision ?? 'control-plane-00010-vop';
  const updateTime = options.updateTime ?? UPDATE_TIMES[0];
  return {
    name: FUNCTION_NAME,
    state: 'ACTIVE',
    environment: 'GEN_2',
    description: 'Private Miakapp V4 staging control plane.',
    labels: {
      environment: 'staging',
      'goog-terraform-provisioned': 'true',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
    },
    buildConfig: {
      runtime: 'nodejs22',
      entryPoint: 'controlPlane',
      dockerRepository:
        'projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane',
      serviceAccount:
        'projects/miakapp-v4-staging/serviceAccounts/miakapp-control-build@miakapp-v4-staging.iam.gserviceaccount.com',
      source: {
        storageSource: {
          bucket: 'gcf-v2-sources-1072737219170-europe-west9',
          object: 'control-plane/function-source.zip',
          generation: '1788637681094791',
        },
      },
    },
    serviceConfig: {
      service: RUN_SERVICE_NAME,
      uri: CONTROL_PLANE_URI,
      revision,
      ingressSettings: ingress,
      maxInstanceCount: 1,
      maxInstanceRequestConcurrency: 16,
      timeoutSeconds: 30,
      availableMemory: '256M',
      availableCpu: '1',
      allTrafficOnLatestRevision: true,
      serviceAccountEmail:
        'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
      environmentVariables: {
        LOG_EXECUTION_ID: 'true',
        MIAKAPP_DEPLOYMENT_COMMIT: DEPLOYED_REPOSITORY_COMMIT,
        MIAKAPP_RUNTIME_CONFIG_JSON: runtimeJson(profile),
        MIAKAPP_SOURCE_ARCHIVE_SHA256: DEPLOYED_SOURCE_SHA256,
      },
    },
    updateTime,
  };
}

function policyFixture(publicInvoker = false, etag = 'BwZanS3TQAE=') {
  return {
    version: 1,
    etag,
    bindings: [{
      role: 'roles/run.invoker',
      members: publicInvoker ? ['allUsers', PROBE_PRINCIPAL] : [PROBE_PRINCIPAL],
    }],
  };
}

function inventory(options = {}) {
  return normalizeEdgeInventory(
    functionFixture(options),
    policyFixture(options.publicInvoker, options.etag),
  );
}

function nextInventory(value, change = {}) {
  const profile = change.profile ?? value.function.runtime_profile;
  const ingress = change.ingress ?? value.function.ingress;
  const publicInvoker = change.publicInvoker ?? value.iam.unauthenticated_invokers === 1;
  const revisionNumber = Number(value.function.revision.slice(14, 19)) + 1;
  return inventory({
    profile,
    ingress,
    publicInvoker,
    revision: change.functionChanged === false
      ? value.function.revision
      : `control-plane-${String(revisionNumber).padStart(5, '0')}-opr`,
    updateTime: change.functionChanged === false
      ? value.function.update_time
      : UPDATE_TIMES[Math.min(revisionNumber - 10, UPDATE_TIMES.length - 1)],
    etag: change.iamChanged
      ? (value.iam.etag === 'BwZanS3TQAE=' ? 'BwZanS3TQAI=' : 'BwZanS3TQAM=')
      : value.iam.etag,
  });
}

function mockEdgeClient(initial = inventory()) {
  let current = initial;
  const calls = [];
  return {
    calls,
    current: () => current,
    async observe() {
      calls.push('edge:observe');
      return current;
    },
    async setRuntimeProfile(expected, profile) {
      assert.deepEqual(expected, current);
      calls.push(`edge:runtime:${profile}`);
      current = nextInventory(current, { profile });
      return current;
    },
    async setIngress(expected, ingress) {
      assert.deepEqual(expected, current);
      calls.push(`edge:ingress:${ingress}`);
      current = nextInventory(current, { ingress });
      return current;
    },
    async setPublicInvoker(expected, enabled) {
      assert.deepEqual(expected, current);
      calls.push(`edge:iam:${enabled ? 'public' : 'private'}`);
      current = nextInventory(current, {
        publicInvoker: enabled,
        functionChanged: false,
        iamChanged: true,
      });
      return current;
    },
    async closeIngress() {
      calls.push('edge:emergency-private');
      if (current.function.ingress === 'ALLOW_ALL') {
        current = nextInventory(current, { ingress: 'ALLOW_INTERNAL_ONLY' });
      }
      return current.function;
    },
  };
}

function claimReceipt(attemptedAt) {
  const claim = buildOrchestratorClaim(attemptedAt);
  const bytes = Buffer.from(orchestratorCanonicalJson(claim), 'utf8');
  return {
    schema: ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
    bucket: ORCHESTRATOR_CLAIM_BUCKET,
    object: ORCHESTRATOR_CLAIM_OBJECT,
    generation: '1788660000000001',
    size_bytes: bytes.byteLength,
    sha256: orchestratorSha256(bytes),
    repository_commit: ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
    profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    browser_relay_plan_sha256: claim.browser_relay_plan_sha256,
    attempted_at: claim.attempted_at,
    expires_at: claim.expires_at,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  };
}

function windowBaseline() {
  return {
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
  };
}

function windowCleanup() {
  return {
    schema: 'miakapp.staging-browser-relay-operation-window-cleanup/1',
    state: 'edge_public_window_clean',
    control_plane_public_invokers: 1,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    runner_route_present: false,
    active_browser_sessions: 0,
    active_coordinator_sessions: 0,
  };
}

function finalCleanup() {
  return {
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
  };
}

function monitoringSample(overrides = {}) {
  return {
    schema: 'miakapp.staging-browser-relay-monitoring-sample/1',
    phase: 'public_window',
    acceptance_executions: 1,
    browser_invocations: 3,
    cloud_builds: 0,
    control_plane_exchanges: 8,
    control_plane_public_instance_seconds: 600,
    credential_or_private_traffic_diagnostics: 0,
    firebase_or_app_check_tokens_on_websocket: 0,
    firestore_writes: 32,
    identity_or_audience_binding_failures: 0,
    kms_signatures: 8,
    maximum_instances_per_service: 1,
    persistent_iam_mutations: 0,
    projected_incremental_milli_eur: 100,
    public_window_seconds: 600,
    recaptcha_assessments: 8,
    relay_services: 2,
    rollback_precondition_failures: 0,
    total_relay_instance_seconds: 1200,
    unexpected_project_mutations: 0,
    ...overrides,
  };
}

function runnerResult() {
  return {
    schema: RUNNER_RESULT_SCHEMA,
    state: 'succeeded_closed_output',
    browser_order: ['chromium', 'firefox', 'webkit'],
    browser_invocations: 3,
    assertions_passed: 40,
    assertions_failed: 0,
    duration_milliseconds: 400_000,
    counters: {
      app_check_assessments: 8,
      control_plane_exchanges: 8,
      kms_signatures: 8,
      firestore_writes: 32,
      maximum_active_websockets: 1,
      source_credentials_on_websocket: 0,
      browser_credential_persistence_events: 0,
      physical_call_replays: 0,
    },
    public_key_ids: ['1', '2'],
    revision_ids: [
      'control-plane-00011-opr',
      'miakapp-staging-relay-a-00002-tst',
      'miakapp-staging-relay-b-00002-tst',
    ],
    stable_outcome_classes: [
      'accepted',
      'applied',
      'failed',
      'outcome_unknown',
      'stale',
    ],
    recordings: {
      trace: false,
      har: false,
      video: false,
      screenshot: false,
      websocket_frame: false,
      browser_console: false,
    },
    browser_credentials_persisted: false,
    engine_results: [
      {
        browser: 'chromium',
        state: 'succeeded',
        assertions_passed: 36,
        assertions_failed: 0,
        duration_milliseconds: 380_000,
      },
      {
        browser: 'firefox',
        state: 'succeeded',
        assertions_passed: 2,
        assertions_failed: 0,
        duration_milliseconds: 10_000,
      },
      {
        browser: 'webkit',
        state: 'succeeded',
        assertions_passed: 2,
        assertions_failed: 0,
        duration_milliseconds: 10_000,
      },
    ],
  };
}

function components(overrides = {}) {
  const calls = [];
  const edgeClient = mockEdgeClient();
  const value = {
    async validateAuthorization() {
      calls.push('authorization');
      return true;
    },
    async observeClaimAbsent() {
      calls.push('claim:observe');
      return orchestratorClaimAbsence();
    },
    async acquireClaim(attemptedAt) {
      calls.push('claim:create');
      return claimReceipt(attemptedAt);
    },
    edgeClient,
    async observeWindowBaseline() {
      calls.push('window:baseline');
      return windowBaseline();
    },
    async createSyntheticFixture() {
      calls.push('fixture:create');
      return true;
    },
    async publishRunner() {
      calls.push('runner:publish');
      return true;
    },
    async verifyRunner() {
      calls.push('runner:verify');
      return true;
    },
    async sampleMonitoring(stage) {
      calls.push(`monitoring:${stage}`);
      return monitoringSample(stage === 'before_matrix' ? {
        browser_invocations: 0,
        control_plane_exchanges: 0,
        firestore_writes: 0,
        kms_signatures: 0,
        recaptcha_assessments: 0,
      } : {});
    },
    async openRelaysPublic() {
      calls.push('relays:public');
      return true;
    },
    async executeBrowserMatrix() {
      calls.push('matrix:execute');
      return runnerResult();
    },
    async removeRunner() {
      calls.push('runner:remove');
      return true;
    },
    async stopSessions() {
      calls.push('sessions:stop');
      return true;
    },
    async closeRelaysPrivateReady() {
      calls.push('relays:private');
      return true;
    },
    async verifyWindowCleanup() {
      calls.push('window:verify-clean');
      return windowCleanup();
    },
    async removeSyntheticFixture() {
      assert.equal(edgeClient.current().state, 'canonical_private');
      calls.push('fixture:remove');
      return true;
    },
    async removeTemporaryBindings() {
      calls.push('bindings:remove');
      return true;
    },
    async verifyFinalCleanup() {
      calls.push('final:verify-clean');
      return finalCleanup();
    },
    ...overrides,
  };
  return { calls, edgeClient, value };
}

function clocks() {
  const values = [START, START + 1_000, START + 1_000, START + 1_125];
  return () => values.shift();
}

test('pins a dormant envelope to plan revision 13 and all closed prerequisites', () => {
  const profile = validateBrowserRelayOperationProfile();
  assert.equal(profile.revision, 1);
  assert.equal(profile.pins.implementation_base_commit, OPERATION_IMPLEMENTATION_BASE_COMMIT);
  assert.equal(profile.execution.maximum_operation_executions, 1);
  assert.equal(profile.execution.relay_public_transition_is_last_before_matrix, true);
  assert.equal(profile.target.cloud_mutation_authorized_by_profile, false);
  assert.equal(profile.preflight.cloud_mutations, 0);
  assert.equal(profile.evidence.live_execution_count, 0);
  assert.match(OPERATION_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(OPERATION_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
});

test('reduces one fresh orchestrator observation to the closed operation preflight', () => {
  const implementationCommit = 'a'.repeat(40);
  const orchestrator = {
    ...validateOrchestratorPreflightResult(),
    implementation_commit: implementationCommit,
  };
  const result = buildOperationPreflightResult({ implementationCommit, orchestrator });
  assert.equal(result.schema, OPERATION_PREFLIGHT_RESULT_SCHEMA);
  assert.equal(result.claim_state, 'absent');
  assert.equal(result.control_plane_state, 'canonical_private');
  assert.equal(result.relay_phase, 'private_ready');
  assert.equal(result.terraform_convergence, 'no_changes');
  assert.equal(result.cloud_mutations, 0);
  assert.equal(result.public_ingress_changes, 0);
  assert.equal(result.acceptance_executions, 0);
  assert.throws(
    () => validateOperationPreflightResultValue({ ...result, runner_route_present: true }),
    /runner_route_present/u,
  );
});

test('composes only one read-only orchestrator observer during operation preflight', async () => {
  const implementationCommit = 'b'.repeat(40);
  const calls = [];
  const result = await observeOperationPreflight(
    { accessToken: 'test-ephemeral-access-token-value' },
    {
      implementationCommit,
      terraformPlan: { planned_values: {} },
      orchestratorObserver: async (session, options) => {
        calls.push('orchestrator:observe');
        assert.equal(session.accessToken, 'test-ephemeral-access-token-value');
        assert.equal(options.implementationCommit, implementationCommit);
        assert.deepEqual(options.terraformPlan, { planned_values: {} });
        return {
          ...validateOrchestratorPreflightResult(),
          implementation_commit: implementationCommit,
        };
      },
    },
  );
  assert.deepEqual(calls, ['orchestrator:observe']);
  assert.equal(result.implementation_commit, implementationCommit);
  assert.equal(result.acceptance_executions, 0);
  await assert.rejects(
    observeOperationPreflight(
      { accessToken: 'test-ephemeral-access-token-value' },
      { implementationCommit, mutationAdapter: async () => true },
    ),
    /read-only boundary/u,
  );
});

test('runs one claimed matrix and preserves the exact two-level cleanup order', async () => {
  const fixture = components();
  const result = await runSingleUseBrowserRelayOperation(fixture.value, {
    clock: clocks(),
    setTimer: () => 17,
    clearTimer: () => {},
  });
  assert.equal(result.state, 'completed_once_fully_clean');
  assert.equal(result.claim_creations, 1);
  assert.equal(result.edge_window_executions, 1);
  assert.equal(result.matrix_executions, 1);
  assert.equal(result.browser_invocations, 3);
  assert.equal(result.public_window_milliseconds, 125);
  assert.equal(result.completed_case_ids.length, 12);
  assert.equal(result.window_result.completed_case_ids.length, 10);
  assert.equal(fixture.edgeClient.current().state, 'canonical_private');
  assert.deepEqual(fixture.calls, [
    'authorization',
    'claim:observe',
    'claim:create',
    'window:baseline',
    'fixture:create',
    'runner:publish',
    'runner:verify',
    'monitoring:before_matrix',
    'relays:public',
    'matrix:execute',
    'monitoring:after_matrix',
    'runner:remove',
    'sessions:stop',
    'relays:private',
    'window:verify-clean',
    'fixture:remove',
    'bindings:remove',
    'final:verify-clean',
  ]);
});

test('runs every cleanup stage after a matrix failure and reports no success', async () => {
  const fixture = components({
    async executeBrowserMatrix() {
      fixture.calls.push('matrix:execute');
      throw new Error('Bearer private-matrix-diagnostic');
    },
  });
  await assert.rejects(
    runSingleUseBrowserRelayOperation(fixture.value, {
      clock: clocks(),
      setTimer: () => 19,
      clearTimer: () => {},
    }),
    (error) => error instanceof StagingBrowserRelayOperationError
      && error.message === 'Live operation failed after verified complete cleanup'
      && !error.message.includes('Bearer'),
  );
  assert.equal(fixture.edgeClient.current().state, 'canonical_private');
  assert.deepEqual(fixture.calls.slice(-7), [
    'runner:remove',
    'sessions:stop',
    'relays:private',
    'window:verify-clean',
    'fixture:remove',
    'bindings:remove',
    'final:verify-clean',
  ]);
});

test('does not skip later cleanup stages when an earlier cleanup operation fails', async () => {
  const fixture = components({
    async removeRunner() {
      fixture.calls.push('runner:remove');
      return false;
    },
  });
  await assert.rejects(
    runSingleUseBrowserRelayOperation(fixture.value, {
      clock: clocks(),
      setTimer: () => 23,
      clearTimer: () => {},
    }),
    /failed after verified complete cleanup/u,
  );
  for (const call of [
    'sessions:stop',
    'relays:private',
    'window:verify-clean',
    'fixture:remove',
    'bindings:remove',
    'final:verify-clean',
  ]) assert.ok(fixture.calls.includes(call));
  assert.equal(fixture.edgeClient.current().state, 'canonical_private');
});

test('rejects before application cleanup when exact authorization fails', async () => {
  const fixture = components({
    async validateAuthorization() {
      fixture.calls.push('authorization');
      return false;
    },
  });
  await assert.rejects(
    runSingleUseBrowserRelayOperation(fixture.value),
    /before any application mutation/u,
  );
  assert.deepEqual(fixture.calls, ['authorization']);
  assert.deepEqual(fixture.edgeClient.calls, []);
});

test('rejects over-budget monitoring, private results and incomplete service evidence', () => {
  assert.throws(
    () => evaluateOperationMonitoringSample(monitoringSample({ recaptcha_assessments: 17 })),
    /stop and rollback/u,
  );
  assert.throws(
    () => rejectOperationPrivateMaterial({ customToken: 'private' }),
    /forbidden/u,
  );
  assert.throws(
    () => validateClosedRunnerResult({ ...runnerResult(), token: 'private' }),
    /forbidden/u,
  );
  const missingRelay = runnerResult();
  missingRelay.revision_ids = ['control-plane-00011-opr', 'miakapp-staging-relay-a-00002-tst'];
  assert.throws(() => validateClosedRunnerResult(missingRelay), /all three services/u);
});

test('validates only the exact pristine and cleanup summaries', () => {
  assert.equal(validateWindowBaseline(windowBaseline()).state, 'edge_public_pristine');
  assert.equal(validateWindowCleanup(windowCleanup()).state, 'edge_public_window_clean');
  assert.equal(validateFinalCleanup(finalCleanup()).state, 'canonical_private_fully_clean');
  assert.throws(
    () => validateWindowBaseline({ ...windowBaseline(), relay_public_invokers: 1 }),
    /has drifted/u,
  );
  assert.throws(
    () => validateFinalCleanup({ ...finalCleanup(), synthetic_homes: 1 }),
    /has drifted/u,
  );
  assert.throws(
    () => validateOperationResult({ state: 'unverified' }),
    /reviewed fields/u,
  );
});

test('requires the exact component inventory', async () => {
  const fixture = components();
  const { removeRunner: _removed, ...missing } = fixture.value;
  await assert.rejects(
    runSingleUseBrowserRelayOperation(missing),
    /exact closed component interface/u,
  );
  await assert.rejects(
    runSingleUseBrowserRelayOperation({ ...fixture.value, extra: async () => true }),
    /exact closed component interface/u,
  );
});

test('guards the exact dormant package and rejects extra, executable or linked entries', () => {
  const names = [
    'README.md', 'contract.mjs', 'guard.mjs', 'operation.mjs', 'preflight.mjs', 'profile.json',
  ];
  validateBrowserRelayOperationRoot(new URL('../browser-relay-operation/', import.meta.url));

  const extraRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-operation-extra-'));
  for (const name of names) {
    copyFileSync(new URL(`../browser-relay-operation/${name}`, import.meta.url), join(extraRoot, name));
  }
  writeFileSync(join(extraRoot, 'apply.sh'), '#!/bin/sh\n', { mode: 0o600 });
  assert.throws(
    () => validateBrowserRelayOperationRoot(new URL(`file://${extraRoot}/`)),
    /file inventory/u,
  );

  const executableRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-operation-exec-'));
  for (const name of names) {
    copyFileSync(new URL(`../browser-relay-operation/${name}`, import.meta.url),
      join(executableRoot, name));
  }
  chmodSync(join(executableRoot, 'operation.mjs'), 0o700);
  assert.throws(
    () => validateBrowserRelayOperationRoot(new URL(`file://${executableRoot}/`)),
    /must not be executable/u,
  );

  const linkRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-operation-link-'));
  for (const name of names.filter((name) => name !== 'README.md')) {
    copyFileSync(new URL(`../browser-relay-operation/${name}`, import.meta.url),
      join(linkRoot, name));
  }
  symlinkSync(new URL('../browser-relay-operation/README.md', import.meta.url),
    join(linkRoot, 'README.md'));
  assert.throws(
    () => validateBrowserRelayOperationRoot(new URL(`file://${linkRoot}/`)),
    /regular files only/u,
  );
});
