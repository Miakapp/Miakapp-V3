import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  OPERATION_RESULT_SCHEMA,
  buildClosedMatrixResult,
  evaluateOperationMonitoringSample,
  operationCaseIds,
  operationWindowCaseIds,
  validateOperationResult,
} from '../../browser-relay-operation/contract.mjs';
import { RUNNER_RESULT_SCHEMA } from '../../browser-relay-runner/contract.mjs';

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
    total_relay_instance_seconds: 1_200,
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

export function closedOperationResult() {
  const before = evaluateOperationMonitoringSample(monitoringSample({
    browser_invocations: 0,
    control_plane_exchanges: 0,
    firestore_writes: 0,
    kms_signatures: 0,
    recaptcha_assessments: 0,
  }));
  const after = evaluateOperationMonitoringSample(monitoringSample());
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
    window_result: {
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
    },
    final_cleanup: finalCleanup(),
    credentials_retained: false,
    raw_cloud_responses_retained: false,
    browser_diagnostics_retained: false,
  });
}

export function createBundle(source) {
  const directory = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'miakapp-provider-owner-')),
  );
  const path = join(directory, 'owner.mjs');
  writeFileSync(path, source, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  const bytes = readFileSync(path);
  return Object.freeze({
    directory,
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    cleanup() {
      rmSync(directory, { force: true, recursive: true });
    },
  });
}

export function ownerBundle({ mode = 'success', observationPath, descendantPath } = {}) {
  const result = JSON.stringify(closedOperationResult());
  const imports = [];
  if (observationPath !== undefined || mode === 'descendant') {
    imports.push("import { writeFileSync } from 'node:fs';");
  }
  if (mode.startsWith('descendant')) {
    imports.push("import { spawn } from 'node:child_process';");
  }

  let execute;
  let close = '';
  if (mode === 'success') {
    execute = observationPath === undefined ? 'return RESULT;' : `
      writeFileSync(${JSON.stringify(observationPath)}, JSON.stringify({
        pid: process.pid,
        env_keys: Object.keys(process.env),
        exec_argv: process.execArgv,
        process_send: process.send === undefined,
        process_channel: process.channel === undefined,
        context_keys: Object.keys(context),
        context_frozen: Object.isFrozen(context),
        context_prototype_null: Object.getPrototypeOf(context) === null
      }));
      return RESULT;`;
    close = observationPath === undefined ? '' : `
      writeFileSync(${JSON.stringify(observationPath)}, JSON.stringify({
        ...JSON.parse(readFileSync(${JSON.stringify(observationPath)}, 'utf8')),
        closed: true
      }));`;
    if (observationPath !== undefined) {
      imports[0] = "import { readFileSync, writeFileSync } from 'node:fs';";
    }
  } else if (mode === 'throw_secret') {
    execute = "throw new Error('Bearer child-only-secret-value');";
  } else if (mode === 'invalid_result') {
    execute = "return { secret_value: 'child-only-secret-value' };";
  } else if (mode === 'close_secret') {
    execute = 'return RESULT;';
    close = "throw new Error('Bearer child-only-close-secret');";
  } else if (mode === 'wait_for_abort') {
    execute = `${observationPath === undefined ? '' : `writeFileSync(${JSON.stringify(observationPath)}, 'started');`}
    await new Promise((resolve) => {
      if (context.signal.aborted) resolve();
      else context.signal.addEventListener('abort', resolve, { once: true });
    });
    throw new Error('cancelled');`;
  } else if (mode === 'ignore_abort') {
    execute = `${observationPath === undefined ? '' : `writeFileSync(${JSON.stringify(observationPath)}, 'started');`}
    await new Promise(() => {});`;
  } else if (mode === 'descendant') {
    execute = `const child = spawn(process.execPath, [${JSON.stringify(descendantPath)}], {
      detached: false,
      env: Object.create(null),
      stdio: 'ignore'
    });
    writeFileSync(${JSON.stringify(observationPath)}, String(child.pid));
    await new Promise(() => {});`;
  } else if (mode === 'descendant_success' || mode === 'descendant_throw') {
    execute = `const child = spawn(process.execPath, [${JSON.stringify(descendantPath)}], {
      detached: false,
      env: Object.create(null),
      stdio: 'ignore'
    });
    child.unref();
    writeFileSync(${JSON.stringify(observationPath)}, String(child.pid));
    ${mode === 'descendant_success'
    ? 'return RESULT;'
    : "throw new Error('Bearer descendant-owner-secret');"}`;
  } else if (mode === 'protocol_failure_order') {
    execute = `writeFileSync(${JSON.stringify(observationPath)}, 'started');
    await new Promise((resolve) => setTimeout(resolve, 100));
    return RESULT;`;
    close = `writeFileSync(${JSON.stringify(observationPath)}, 'closed');`;
  } else {
    throw new Error('unknown owner fixture mode');
  }

  return createBundle(`${imports.join('\n')}
const RESULT = ${result};
export function createBrowserRelayTrustedProviderOwner() {
  return {
    async execute(context) { ${execute} },
    async close() { ${close} }
  };
}
`);
}

export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export async function waitFor(predicate, timeoutMilliseconds = 2_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('bounded test condition did not become true');
}
