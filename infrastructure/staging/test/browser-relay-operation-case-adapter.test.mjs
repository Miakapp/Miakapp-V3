import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
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
  INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  runBrowserRelayClaimBoundOperation,
} from '../browser-relay-operation-case-adapter/adapter.mjs';
import {
  OPERATION_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT,
  OPERATION_CASE_ADAPTER_PROFILE_SHA256,
  OPERATION_CASE_ADAPTER_RUNNER_RESULT_SCHEMA,
  OPERATION_CASE_ADAPTER_SOURCE_SHA256,
  StagingBrowserRelayOperationCaseAdapterError,
  operationCaseAdapterDependencyContractsSha256,
  validateBrowserRelayOperationCaseAdapterProfile,
} from '../browser-relay-operation-case-adapter/contract.mjs';
import {
  validateBrowserRelayOperationCaseAdapterRoot,
} from '../browser-relay-operation-case-adapter/guard.mjs';
import {
  runBrowserRelayClaimBoundOperationForTesting,
} from '../browser-relay-operation-case-adapter/testing.mjs';
import {
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
  ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
  ORCHESTRATOR_PROFILE_SHA256,
  canonicalJson as orchestratorCanonicalJson,
  sha256 as orchestratorSha256,
} from '../browser-relay-orchestrator/contract.mjs';
import {
  buildOrchestratorClaim,
  orchestratorClaimAbsence,
} from '../browser-relay-orchestrator/claim.mjs';
import {
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  OPERATION_RESULT_SCHEMA,
  buildClosedMatrixResult,
  evaluateOperationMonitoringSample,
  operationCaseIds,
  operationWindowCaseIds,
  validateOperationResult,
} from '../browser-relay-operation/contract.mjs';
import { runSingleUseBrowserRelayOperation } from '../browser-relay-operation/operation.mjs';

const START = Date.parse('2026-09-06T10:00:00.000Z');
const ATTEMPTED_AT = new Date(START).toISOString();
const PACKAGE_FILES = Object.freeze([
  'README.md',
  'adapter.mjs',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'testing.mjs',
]);

function functionFixture(options = {}) {
  const profile = options.profile ?? 'canonical';
  const ingress = options.ingress ?? 'ALLOW_INTERNAL_ONLY';
  const revision = options.revision ?? 'control-plane-00010-vop';
  const updateTime = options.updateTime ?? '2026-09-05T19:48:55.366699112Z';
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
      : `control-plane-${String(revisionNumber).padStart(5, '0')}-opc`,
    updateTime: change.functionChanged === false
      ? value.function.update_time
      : `2026-09-06T10:00:0${Math.min(revisionNumber - 9, 9)}.000000001Z`,
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

function claimReceipt(attemptedAt = ATTEMPTED_AT) {
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

function windowContext(overrides = {}) {
  return Object.freeze({
    signal: new AbortController().signal,
    opened_at_milliseconds: START + 1_000,
    deadline_milliseconds: START + 11_000,
    callback_deadline_milliseconds: START + 6_000,
    ...overrides,
  });
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
    schema: OPERATION_CASE_ADAPTER_RUNNER_RESULT_SCHEMA,
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
      'control-plane-00011-opc',
      'miakapp-staging-relay-a-00002-tst',
      'miakapp-staging-relay-b-00002-tst',
    ],
    stable_outcome_classes: ['accepted', 'applied', 'failed', 'outcome_unknown', 'stale'],
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

function closedOperationResult() {
  const before = evaluateOperationMonitoringSample(monitoringSample({
    browser_invocations: 0,
    control_plane_exchanges: 0,
    firestore_writes: 0,
    kms_signatures: 0,
    recaptcha_assessments: 0,
  }));
  const after = evaluateOperationMonitoringSample(monitoringSample());
  const windowResult = {
    schema: 'miakapp.staging-browser-relay-operation-window-result/1',
    state: 'matrix_succeeded_window_clean',
    baseline: windowBaseline(),
    monitoring_samples: [before, after],
    matrix_result: buildClosedMatrixResult(runnerResult()),
    window_cleanup: windowCleanup(),
    matrix_executions: 1,
    browser_invocations: 3,
    completed_case_ids: operationWindowCaseIds,
    credentials_retained: false,
    raw_cloud_responses_retained: false,
    browser_diagnostics_retained: false,
  };
  return validateOperationResult({
    schema: OPERATION_RESULT_SCHEMA,
    state: 'completed_once_fully_clean',
    claim_creations: 1,
    edge_window_executions: 1,
    matrix_executions: 1,
    browser_invocations: 3,
    public_window_milliseconds: 125,
    maximum_public_window_milliseconds: MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
    rollback_reconciled_failures: 0,
    completed_case_ids: operationCaseIds,
    window_result: windowResult,
    final_cleanup: finalCleanup(),
    credentials_retained: false,
    raw_cloud_responses_retained: false,
    browser_diagnostics_retained: false,
  });
}

function operationComponents(overrides = {}) {
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

function matrixComponents() {
  return {
    fixture: Object.freeze({ synthetic: true }),
    async openChromiumPage() {},
    async openSecondaryPage() {},
    async prepareChromiumPhase() {},
    sourceObservers: Object.freeze({}),
    browserLifecycle: Object.freeze({}),
  };
}

function productionFailureMatrix(trace) {
  return {
    fixture: {
      stateExpectation() {
        return Object.freeze({
          schema: 'miakapp.staging-browser-relay-fixture-state-expectation/1',
          path: 'acceptance.temperature',
          revision: 1,
          value: 20,
        });
      },
      async setTemperature() { return this.stateExpectation(); },
      async privateInput(browser) {
        return Object.freeze({
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser,
          firebase_custom_token: `${'p'.repeat(32)}.${'q'.repeat(32)}.${'r'.repeat(32)}`,
        });
      },
      async rotateRelayToB() { return true; },
    },
    async openChromiumPage(pageInstance) {
      trace.push(`matrix:openChromiumPage:${pageInstance}`);
      return Object.freeze({});
    },
    async openSecondaryPage(browser) {
      trace.push(`matrix:openSecondaryPage:${browser}`);
      return Object.freeze({});
    },
    async prepareChromiumPhase(phase) {
      trace.push(`matrix:prepareChromiumPhase:${phase}`);
    },
    sourceObservers: Object.fromEntries(
      INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER.map((source) => [source, {
        async execute() { trace.push(`matrix:observer:${source}:execute`); },
        async close() { trace.push(`matrix:observer:${source}:close`); },
      }]),
    ),
    browserLifecycle: {
      async startBrowser(browser) { trace.push(`matrix:browser:${browser}:start`); },
      async closeBrowser(browser) { trace.push(`matrix:browser:${browser}:close`); },
      async close() { trace.push('matrix:browser:lifecycle-close'); },
    },
  };
}

function composition(overrides = {}) {
  const operation = operationComponents(overrides.operation);
  return {
    operation,
    value: {
      operation: operation.value,
      matrix: overrides.matrix ?? matrixComponents(),
    },
  };
}

function clocks() {
  const values = [START, START + 1_000, START + 1_000, START + 1_125];
  return () => values.shift();
}

function fakeOperationRunner(callback) {
  return async (components) => {
    await callback(components);
    return closedOperationResult();
  };
}

async function runInjected(operationRunner, matrixRunner = async () => runnerResult(), value) {
  const fixture = value ?? composition().value;
  return runBrowserRelayClaimBoundOperationForTesting(
    operationRunner,
    matrixRunner,
    fixture,
  );
}

async function claimAndOpen(components, context = windowContext()) {
  await components.acquireClaim(ATTEMPTED_AT);
  await components.observeWindowBaseline(context);
  return context;
}

function assertClosedFailure(error) {
  return error instanceof StagingBrowserRelayOperationCaseAdapterError
    && !error.message.includes('Bearer')
    && !error.message.includes('private-diagnostic');
}

test('pins one dormant claim-bound production composition with no live authority', () => {
  const profile = validateBrowserRelayOperationCaseAdapterProfile();
  assert.equal(profile.revision, 1);
  assert.equal(profile.pins.implementation_base_commit,
    OPERATION_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT);
  assert.equal(profile.composition.maximum_claim_acquisitions, 1);
  assert.equal(profile.composition.maximum_window_entries, 1);
  assert.equal(profile.composition.maximum_matrix_invocations, 1);
  assert.equal(profile.composition.claim_receipt_single_snapshot_validated, true);
  assert.equal(profile.composition.claim_capability_private_to_composition, true);
  assert.equal(profile.composition.protocol_violation_permanently_poisoned, true);
  assert.equal(profile.composition.window_context_validated_before_application_mutation, true);
  assert.equal(profile.composition.exact_window_context_identity_preserved, true);
  assert.equal(profile.composition.production_intrinsic_timing_only, true);
  assert.equal(profile.compatibility.durable_claim_matrix_binding_present, true);
  assert.equal(profile.compatibility.live_operation_wired, false);
  assert.equal(profile.evidence.offline_production_failure_compositions, 1);
  assert.equal(profile.evidence.live_execution_count, 0);
  assert.equal(typeof operationCaseAdapterDependencyContractsSha256(), 'string');
  assert.match(OPERATION_CASE_ADAPTER_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(OPERATION_CASE_ADAPTER_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
  assert.equal(typeof runBrowserRelayClaimBoundOperation, 'function');
});

test('binds the real single-use operation to exactly one post-claim matrix', async () => {
  const fixture = composition();
  let matrixCalls = 0;
  const result = await runBrowserRelayClaimBoundOperationForTesting(
    runSingleUseBrowserRelayOperation,
    async (components, options) => {
      matrixCalls += 1;
      assert.deepEqual(Object.keys(components).sort(), [
        'browserLifecycle',
        'fixture',
        'openChromiumPage',
        'openSecondaryPage',
        'prepareChromiumPhase',
        'sourceObservers',
      ]);
      assert.deepEqual(Object.keys(options), ['signal']);
      assert.equal(options.signal instanceof AbortSignal, true);
      assert.equal(options.signal.aborted, false);
      assert.equal(Object.isFrozen(options), true);
      assert.equal(JSON.stringify(options), '{"signal":{}}');
      return runnerResult();
    },
    fixture.value,
    {
      clock: clocks(),
      setTimer: () => 17,
      clearTimer: () => {},
    },
  );
  assert.equal(result.state, 'completed_once_fully_clean');
  assert.equal(result.claim_creations, 1);
  assert.equal(result.matrix_executions, 1);
  assert.equal(matrixCalls, 1);
  assert.equal(fixture.operation.calls.indexOf('claim:create')
    < fixture.operation.calls.indexOf('window:baseline'), true);
  assert.deepEqual(fixture.operation.calls.slice(-7), [
    'runner:remove',
    'sessions:stop',
    'relays:private',
    'window:verify-clean',
    'fixture:remove',
    'bindings:remove',
    'final:verify-clean',
  ]);
  assert.equal(fixture.operation.edgeClient.current().state, 'canonical_private');
});

test('executes the production hard-wiring and closes a real matrix failure', async () => {
  const operation = operationComponents();
  const matrixTrace = [];
  await assert.rejects(
    runBrowserRelayClaimBoundOperation({
      operation: operation.value,
      matrix: productionFailureMatrix(matrixTrace),
    }),
    assertClosedFailure,
  );
  assert.ok(operation.calls.includes('claim:create'));
  assert.ok(operation.calls.includes('window:baseline'));
  assert.ok(operation.calls.includes('relays:public'));
  assert.deepEqual(operation.calls.slice(-7), [
    'runner:remove',
    'sessions:stop',
    'relays:private',
    'window:verify-clean',
    'fixture:remove',
    'bindings:remove',
    'final:verify-clean',
  ]);
  assert.ok(matrixTrace.includes('matrix:browser:chromium:start'));
  for (const source of INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER) {
    assert.equal(
      matrixTrace.filter((entry) => entry === `matrix:observer:${source}:close`).length,
      1,
    );
  }
  assert.ok(matrixTrace.includes('matrix:browser:lifecycle-close'));
  assert.equal(operation.edgeClient.current().state, 'canonical_private');
});

test('rejects an insufficient claim lifetime before any application mutation', async () => {
  const fixture = composition();
  const times = [
    START,
    START + 11 * 60 * 1_000,
    START + 11 * 60 * 1_000,
    START + 11 * 60 * 1_000 + 125,
  ];
  let matrixCalls = 0;
  await assert.rejects(
    runBrowserRelayClaimBoundOperationForTesting(
      runSingleUseBrowserRelayOperation,
      async () => {
        matrixCalls += 1;
        return runnerResult();
      },
      fixture.value,
      {
        clock: () => times.shift(),
        setTimer: () => 29,
        clearTimer: () => {},
      },
    ),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 0);
  for (const forbidden of [
    'window:baseline',
    'fixture:create',
    'runner:publish',
    'runner:verify',
    'relays:public',
  ]) assert.equal(fixture.operation.calls.includes(forbidden), false);
  assert.deepEqual(fixture.operation.calls.slice(-7), [
    'runner:remove',
    'sessions:stop',
    'relays:private',
    'window:verify-clean',
    'fixture:remove',
    'bindings:remove',
    'final:verify-clean',
  ]);
  assert.equal(fixture.operation.edgeClient.current().state, 'canonical_private');
});

test('forwards only the exact edge signal and never exposes claim lineage', async () => {
  const controller = new AbortController();
  let receivedOptions;
  let receivedComponents;
  const result = await runInjected(fakeOperationRunner(async (components) => {
    const context = windowContext({ signal: controller.signal });
    await claimAndOpen(components, context);
    await components.executeBrowserMatrix(context);
  }), async (components, options) => {
    receivedComponents = components;
    receivedOptions = options;
    return runnerResult();
  });
  assert.equal(result.state, 'completed_once_fully_clean');
  assert.equal(receivedOptions.signal, controller.signal);
  assert.deepEqual(Reflect.ownKeys(receivedOptions), ['signal']);
  assert.equal(JSON.stringify(receivedOptions), '{"signal":{}}');
  const serialized = JSON.stringify({ receivedComponents, receivedOptions, result });
  for (const forbidden of [
    '1788660000000001',
    'attempted_at',
    'expires_at',
    'claim_sha256',
    'repository_commit',
  ]) assert.equal(serialized.includes(forbidden), false);
});

test('requires the exact window context identity from entry through matrix execution', async () => {
  const context = windowContext();
  const replacement = Object.freeze({ ...context });
  let matrixCalls = 0;
  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      await claimAndOpen(components, context);
      await components.executeBrowserMatrix(replacement);
    }), async () => {
      matrixCalls += 1;
      return runnerResult();
    }),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 0);
});

test('rejects an early, duplicate or replayed matrix invocation', async () => {
  let matrixCalls = 0;
  const matrixRunner = async () => {
    matrixCalls += 1;
    return runnerResult();
  };
  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      await components.executeBrowserMatrix(windowContext());
    }), matrixRunner),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 0);

  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      const context = await claimAndOpen(components);
      await components.executeBrowserMatrix(context);
      await components.executeBrowserMatrix(context);
    }), matrixRunner),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 1);
});

test('revokes a concurrent matrix binding before a second entry can start', async () => {
  let settleFirst;
  let matrixCalls = 0;
  const first = new Promise((resolve) => {
    settleFirst = resolve;
  });
  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      const context = await claimAndOpen(components);
      const pending = components.executeBrowserMatrix(context);
      await assert.rejects(
        components.executeBrowserMatrix(context),
        assertClosedFailure,
      );
      settleFirst(runnerResult());
      await pending;
    }), async () => {
      matrixCalls += 1;
      return first;
    }),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 1);
});

test('poisons the whole operation when rejected protocol misuse is suppressed', async () => {
  let matrixCalls = 0;
  const matrixRunner = async () => {
    matrixCalls += 1;
    return runnerResult();
  };

  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      await assert.rejects(
        components.executeBrowserMatrix(windowContext()),
        assertClosedFailure,
      );
      const context = await claimAndOpen(components);
      await components.executeBrowserMatrix(context);
    }), matrixRunner),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 0);

  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      const context = await claimAndOpen(components);
      await components.executeBrowserMatrix(context);
      await assert.rejects(
        components.executeBrowserMatrix(context),
        assertClosedFailure,
      );
    }), matrixRunner),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 1);

  let resolveClaim;
  const delayed = composition({
    operation: {
      async acquireClaim(attemptedAt) {
        return new Promise((resolve) => {
          resolveClaim = () => resolve(claimReceipt(attemptedAt));
        });
      },
    },
  });
  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      const pending = components.acquireClaim(ATTEMPTED_AT);
      await assert.rejects(
        components.acquireClaim(ATTEMPTED_AT),
        assertClosedFailure,
      );
      resolveClaim();
      await pending;
      const context = windowContext();
      await components.observeWindowBaseline(context);
      await components.executeBrowserMatrix(context);
    }), matrixRunner, delayed.value),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 1);
});

test('permits only one direct canonical claim receipt for the exact attempt', async () => {
  let acquisitions = 0;
  const duplicate = composition({
    operation: {
      async acquireClaim(attemptedAt) {
        acquisitions += 1;
        return claimReceipt(attemptedAt);
      },
    },
  });
  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      await components.acquireClaim(ATTEMPTED_AT);
      await components.acquireClaim(ATTEMPTED_AT);
    }), undefined, duplicate.value),
    assertClosedFailure,
  );
  assert.equal(acquisitions, 1);

  for (const invalidReceipt of [
    { ...claimReceipt(), extra: true },
    { ...claimReceipt(), attempted_at: new Date(START + 1).toISOString() },
    { ...claimReceipt(), generation: '0' },
  ]) {
    const fixture = composition({
      operation: { async acquireClaim() { return invalidReceipt; } },
    });
    await assert.rejects(
      runInjected(fakeOperationRunner(async (components) => {
        await components.acquireClaim(ATTEMPTED_AT);
      }), undefined, fixture.value),
      assertClosedFailure,
    );
  }

  const accessorReceipt = claimReceipt();
  Object.defineProperty(accessorReceipt, 'generation', {
    enumerable: true,
    get() { throw new Error('Bearer private-diagnostic'); },
  });
  const accessorFixture = composition({
    operation: { async acquireClaim() { return accessorReceipt; } },
  });
  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      await components.acquireClaim(ATTEMPTED_AT);
    }), undefined, accessorFixture.value),
    assertClosedFailure,
  );
});

test('validates one immutable receipt snapshot instead of rereading a deceptive proxy', async () => {
  const receipt = claimReceipt();
  const forgedExpiry = new Date(START + 60 * 60 * 1_000).toISOString();
  const deceptiveReceipt = new Proxy(receipt, {
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      return property === 'expires_at'
        ? { ...descriptor, value: forgedExpiry }
        : descriptor;
    },
  });
  const fixture = composition({
    operation: { async acquireClaim() { return deceptiveReceipt; } },
  });
  let matrixCalls = 0;
  const opened = START + 31 * 60 * 1_000;
  const context = windowContext({
    opened_at_milliseconds: opened,
    deadline_milliseconds: opened + 10 * 60 * 1_000,
    callback_deadline_milliseconds: opened + 5 * 60 * 1_000,
  });
  await assert.rejects(
    runInjected(fakeOperationRunner(async (components) => {
      await components.acquireClaim(ATTEMPTED_AT);
      await components.observeWindowBaseline(context);
      await components.executeBrowserMatrix(context);
    }), async () => {
      matrixCalls += 1;
      return runnerResult();
    }, fixture.value),
    assertClosedFailure,
  );
  assert.equal(matrixCalls, 0);
});

test('rejects malformed, expired, oversized and aborted window contexts', async () => {
  const aborted = new AbortController();
  aborted.abort();
  const candidates = [
    {
      signal: new AbortController().signal,
      opened_at_milliseconds: START + 1_000,
      deadline_milliseconds: START + 11_000,
      callback_deadline_milliseconds: START + 6_000,
    },
    Object.freeze({ ...windowContext(), extra: true }),
    windowContext({ signal: {} }),
    windowContext({ signal: aborted.signal }),
    windowContext({ opened_at_milliseconds: START - 1 }),
    windowContext({ deadline_milliseconds: START + 1_800_001 }),
    windowContext({ callback_deadline_milliseconds: START + 11_001 }),
  ];
  for (const context of candidates) {
    let matrixCalls = 0;
    await assert.rejects(
      runInjected(fakeOperationRunner(async (components) => {
        await components.acquireClaim(ATTEMPTED_AT);
        await components.observeWindowBaseline(context);
      }), async () => {
        matrixCalls += 1;
        return runnerResult();
      }),
      assertClosedFailure,
    );
    assert.equal(matrixCalls, 0);
  }
});

test('fails closed on rejected or malformed matrix and operation results', async () => {
  const operationRunner = fakeOperationRunner(async (components) => {
    const context = await claimAndOpen(components);
    await components.executeBrowserMatrix(context);
  });
  await assert.rejects(
    runInjected(operationRunner, async () => {
      throw new Error('Bearer private-diagnostic');
    }),
    assertClosedFailure,
  );
  await assert.rejects(
    runInjected(operationRunner, async () => ({ state: 'partial', claim_sha256: 'private' })),
    assertClosedFailure,
  );
  await assert.rejects(
    runInjected(async (components) => {
      const context = await claimAndOpen(components);
      await components.executeBrowserMatrix(context);
      return { state: 'partial', generation: '1788660000000001' };
    }),
    assertClosedFailure,
  );
});

test('requires direct exact root and nested component records', async () => {
  const fixture = composition();
  const { removeRunner: _removed, ...missingOperation } = fixture.value.operation;
  for (const invalid of [
    { ...fixture.value, extra: true },
    { operation: missingOperation, matrix: fixture.value.matrix },
    { operation: fixture.value.operation, matrix: { ...fixture.value.matrix, extra: true } },
    { operation: fixture.value.operation, matrix: { ...fixture.value.matrix, openChromiumPage: 1 } },
  ]) {
    await assert.rejects(
      runInjected(async () => closedOperationResult(), undefined, invalid),
      assertClosedFailure,
    );
  }
  const accessorRoot = {};
  Object.defineProperties(accessorRoot, {
    operation: { enumerable: true, get() { throw new Error('private-diagnostic'); } },
    matrix: { enumerable: true, value: fixture.value.matrix },
  });
  await assert.rejects(
    runInjected(async () => closedOperationResult(), undefined, accessorRoot),
    assertClosedFailure,
  );
  const hostileProxy = new Proxy({}, {
    ownKeys() { throw new Error('Bearer private-diagnostic'); },
  });
  await assert.rejects(
    runInjected(async () => closedOperationResult(), undefined, hostileProxy),
    assertClosedFailure,
  );
  const exportedErrorProxy = new Proxy({}, {
    ownKeys() {
      throw new StagingBrowserRelayOperationCaseAdapterError(
        'Bearer caller-owned-private-diagnostic',
      );
    },
  });
  await assert.rejects(
    runInjected(async () => closedOperationResult(), undefined, exportedErrorProxy),
    assertClosedFailure,
  );
});

test('keeps production and testing entrypoints separate with exact arity', () => {
  assert.throws(
    () => runBrowserRelayClaimBoundOperation(),
    StagingBrowserRelayOperationCaseAdapterError,
  );
  assert.throws(
    () => runBrowserRelayClaimBoundOperation({}, {}),
    StagingBrowserRelayOperationCaseAdapterError,
  );
  assert.throws(
    () => runBrowserRelayClaimBoundOperation({}, {}, {}),
    StagingBrowserRelayOperationCaseAdapterError,
  );
  assert.throws(
    () => runBrowserRelayClaimBoundOperationForTesting(() => {}, () => {}),
    StagingBrowserRelayOperationCaseAdapterError,
  );
  const production = readFileSync(
    new URL('../browser-relay-operation-case-adapter/adapter.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(production.includes('./testing.mjs'), false);
  assert.equal(production.includes('ForTesting'), false);
});

function copyPackage(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const name of PACKAGE_FILES) {
    copyFileSync(
      new URL(`../browser-relay-operation-case-adapter/${name}`, import.meta.url),
      join(root, name),
    );
  }
  return root;
}

test('guards the exact dormant package and its closed authority', () => {
  validateBrowserRelayOperationCaseAdapterRoot(
    new URL('../browser-relay-operation-case-adapter/', import.meta.url),
  );

  const extraRoot = copyPackage('miakapp-operation-case-adapter-extra-');
  writeFileSync(join(extraRoot, 'apply.sh'), '#!/bin/sh\n', { mode: 0o600 });
  assert.throws(
    () => validateBrowserRelayOperationCaseAdapterRoot(new URL(`file://${extraRoot}/`)),
    /inventory has drifted/u,
  );

  const executableRoot = copyPackage('miakapp-operation-case-adapter-exec-');
  chmodSync(join(executableRoot, 'adapter.mjs'), 0o700);
  assert.throws(
    () => validateBrowserRelayOperationCaseAdapterRoot(new URL(`file://${executableRoot}/`)),
    /non-executable regular file/u,
  );

  const linkRoot = copyPackage('miakapp-operation-case-adapter-link-');
  const readme = join(linkRoot, 'README.md');
  unlinkSync(readme);
  symlinkSync(
    new URL('../browser-relay-operation-case-adapter/README.md', import.meta.url),
    readme,
  );
  assert.throws(
    () => validateBrowserRelayOperationCaseAdapterRoot(new URL(`file://${linkRoot}/`)),
    /entries must be regular files/u,
  );

  const authorityRoot = copyPackage('miakapp-operation-case-adapter-authority-');
  const profilePath = join(authorityRoot, 'profile.json');
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  profile.authority.live_execution_authorized = true;
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  assert.throws(
    () => validateBrowserRelayOperationCaseAdapterRoot(new URL(`file://${authorityRoot}/`)),
    /exceeds its composition-only authority/u,
  );

  const credential = ['ya', '29.', 'a'.repeat(40)].join('');
  for (const name of ['README.md', 'guard.mjs']) {
    const credentialRoot = copyPackage(`miakapp-operation-case-adapter-${name}-`);
    const path = join(credentialRoot, name);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n${credential}\n`);
    assert.throws(
      () => validateBrowserRelayOperationCaseAdapterRoot(
        new URL(`file://${credentialRoot}/`),
      ),
      /credential literal/u,
    );
  }

  const writableContractRoot = copyPackage('miakapp-operation-case-adapter-writable-');
  const contractPath = join(writableContractRoot, 'contract.mjs');
  writeFileSync(
    contractPath,
    readFileSync(contractPath, 'utf8').replace(
      "import { lstatSync, readFileSync } from 'node:fs';",
      "import { lstatSync, readFileSync, writeFileSync } from 'node:fs';",
    ),
  );
  assert.throws(
    () => validateBrowserRelayOperationCaseAdapterRoot(
      new URL(`file://${writableContractRoot}/`),
    ),
    /read-only allowlist/u,
  );
});
