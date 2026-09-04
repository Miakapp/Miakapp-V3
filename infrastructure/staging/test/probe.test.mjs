import assert from 'node:assert/strict';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import {
  EXPECTED_DISCOVERY,
  FUNCTION_URI,
  PROJECT_ID,
  PROBE_ACCOUNT,
  TERRAFORM_VERSION,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_COMMIT,
  WORKLOAD_FUNCTION_REVISION,
  WORKLOAD_SOURCE_SHA256,
  assertSafeWorkloadEnvironment,
  buildProbePlanMetadata,
  probeApplyAuthorization,
  probeInvokeAuthorization,
  probeRecoveryAuthorization,
  validateProbeApplyAuthorization,
  validateProbeInvokeAuthorization,
  validateProbeRecoveryAuthorization,
  validateProbePlanMetadata,
} from '../probe/contract.mjs';
import {
  validateProbeEvidence,
  validateProbeEvidenceValue,
} from '../probe/evidence.mjs';
import { validateProbeRoot } from '../probe/guard.mjs';
import {
  observeProbeDeployment,
  validateSuccessfulExecution,
} from '../probe/invoke.mjs';
import {
  FAILED_EXECUTION_PROFILES,
  validateFailedExecution,
} from '../probe/recover.mjs';
import { validateProbePlanAgainstPolicy } from '../probe/validate-plan.mjs';

const COMMIT = '1'.repeat(40);
const PLAN = Buffer.from('synthetic-private-probe-plan');
const PLAN_JSON = Buffer.from('{"synthetic":true}\n');
const probeRoot = new URL('../probe/', import.meta.url);
const terraformFiles = readdirSync(probeRoot).filter((name) => name.endsWith('.tf')).sort();
const terraformSource = terraformFiles
  .map((name) => readFileSync(new URL(name, probeRoot), 'utf8'))
  .join('\n');
const localsSource = readFileSync(new URL('locals.tf', probeRoot), 'utf8');
const planSource = readFileSync(new URL('plan.mjs', probeRoot), 'utf8');
const applySource = readFileSync(new URL('apply.mjs', probeRoot), 'utf8');
const invokeSource = readFileSync(new URL('invoke.mjs', probeRoot), 'utf8');
const recoverSource = readFileSync(new URL('recover.mjs', probeRoot), 'utf8');
const lockSource = readFileSync(new URL('.terraform.lock.hcl', probeRoot), 'utf8');
const checkSource = readFileSync(new URL('../check.sh', import.meta.url), 'utf8');
const workflowResource = `projects/${PROJECT_ID}/locations/europe-west9/workflows/${WORKFLOW_NAME}`;

function planValue(address) {
  switch (address) {
    case 'terraform_data.probe_guard':
      return {
        input: {
          project_id: PROJECT_ID,
          project_number: '1072737219170',
          region: 'europe-west9',
          function_name: 'control-plane',
          function_uri: FUNCTION_URI,
          probe_service_account: PROBE_ACCOUNT,
          source_sha256: 'd2a9ffae2bd85106f782f9c75a10b6fb398682ead65dada2a1cf8ab5c65b7eb4',
          repository_commit: '3f5a94dfcdfc0984487a558d966bbeaa769b18eb',
          ingress: 'ALLOW_INTERNAL_ONLY',
          unauthenticated: false,
          minimum_instances: 0,
          maximum_instances: 1,
          workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
        },
      };
    case 'google_project_service.workflows':
      return {
        project: PROJECT_ID,
        service: 'workflows.googleapis.com',
        disable_on_destroy: false,
      };
    case 'google_workflows_workflow.private_probe':
      return {
        project: PROJECT_ID,
        region: 'europe-west9',
        name: WORKFLOW_NAME,
        description: 'Single-purpose private discovery probe for the Miakapp V4 staging control plane.',
        service_account: PROBE_ACCOUNT,
        source_contents: WORKFLOW_SOURCE,
        call_log_level: 'LOG_NONE',
        execution_history_level: 'EXECUTION_HISTORY_BASIC',
        deletion_protection: true,
        labels: {
          environment: 'staging',
          'managed-by': 'terraform',
          product: 'miakapp-v4',
          purpose: 'private-probe',
        },
      };
    default:
      throw new Error(`Unknown synthetic address ${address}`);
  }
}

function syntheticPlan() {
  const managed = {
    'google_project_service.workflows': 'google_project_service',
    'google_workflows_workflow.private_probe': 'google_workflows_workflow',
    'terraform_data.probe_guard': 'terraform_data',
  };
  return {
    format_version: '1.2',
    terraform_version: TERRAFORM_VERSION,
    applyable: true,
    complete: true,
    errored: false,
    variables: {},
    configuration: {
      provider_config: {
        google: {
          full_name: 'registry.terraform.io/hashicorp/google',
          version_constraint: '8.1.0',
        },
        terraform: { full_name: 'terraform.io/builtin/terraform' },
      },
      root_module: {
        resources: [
          {
            address: 'data.terraform_remote_state.workload',
            mode: 'data',
            type: 'terraform_remote_state',
            provider_config_key: 'terraform',
          },
          ...Object.entries(managed).map(([address, type]) => ({
            address,
            mode: 'managed',
            type,
            provider_config_key: type === 'terraform_data' ? 'terraform' : 'google',
          })),
        ],
      },
    },
    resource_changes: Object.entries(managed).map(([address, type]) => ({
      address,
      mode: 'managed',
      type,
      change: {
        actions: ['create'],
        before: null,
        after: planValue(address),
      },
    })),
  };
}

function workflow() {
  return {
    name: workflowResource,
    state: 'ACTIVE',
    serviceAccount: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
    callLogLevel: 'LOG_NONE',
    executionHistoryLevel: 'EXECUTION_HISTORY_BASIC',
    sourceContents: WORKFLOW_SOURCE,
    labels: {
      environment: 'staging',
      'goog-terraform-provisioned': 'true',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
      purpose: 'private-probe',
    },
    revisionId: '000001-abc',
  };
}

function successfulExecution() {
  return {
    name: `${workflowResource}/executions/00000000-0000-4000-8000-000000000000`,
    state: 'SUCCEEDED',
    workflowRevisionId: '000001-abc',
    startTime: '2026-09-04T01:00:00.000000001Z',
    endTime: '2026-09-04T01:00:01.250000001Z',
    result: JSON.stringify({
      code: 200,
      headers: {
        'cache-control': 'public, max-age=300, must-revalidate',
        'Content-Type': ['application/json; charset=utf-8'],
      },
      body: EXPECTED_DISCOVERY,
    }),
  };
}

function failedExecution(profile = FAILED_EXECUTION_PROFILES[1]) {
  return {
    name: `projects/1072737219170/locations/europe-west9/workflows/${WORKFLOW_NAME}/executions/00000000-0000-4000-8000-000000000001`,
    state: 'FAILED',
    workflowRevisionId: '000001-abc',
    startTime: profile.startTime,
    endTime: profile.endTime,
    error: {
      context: 'HTTP server responded with error code 503\nin step "invoke", routine "main", line: 4',
      payload: JSON.stringify({
        body: { error: 'service_unavailable' },
        code: 503,
        headers: {
          'Alt-Svc': 'h3=":443"; ma=2592000,h3-29=":443"; ma=2592000',
          'Cache-Control': 'no-store',
          'Content-Length': '31',
          'Content-Type': 'application/json; charset=utf-8',
          Date: profile.responseDate,
          Server: 'Google Frontend',
          'X-Cloud-Trace-Context': `${'a'.repeat(32)};o=1`,
        },
        message: 'HTTP server responded with error code 503',
        tags: ['HttpError'],
      }),
      stackTrace: {
        elements: [{
          position: { column: '9', length: '4', line: '4' },
          routine: 'main',
          step: 'invoke',
        }],
      },
    },
  };
}

test('contains only the fixed zero-idle private invocation graph', () => {
  assert.doesNotThrow(() => validateProbeRoot(probeRoot));
  assert.match(terraformSource, /prefix = "terraform\/probe"/);
  assert.match(terraformSource, /service\s+= "workflows\.googleapis\.com"/);
  assert.match(terraformSource, /resource "google_workflows_workflow" "private_probe"/);
  assert.match(terraformSource, /call_log_level\s+= "LOG_NONE"/);
  assert.match(terraformSource, /execution_history_level\s+= "EXECUTION_HISTORY_BASIC"/);
  assert.match(terraformSource, /deletion_protection\s+= true/);
  assert.equal((terraformSource.match(/resource\s+"/g) ?? []).length, 3);
  assert.deepEqual(
    [...terraformSource.matchAll(/resource\s+"([^"]+)"/g)].map((match) => match[1]).sort(),
    ['google_project_service', 'google_workflows_workflow', 'terraform_data'],
  );
  assert.doesNotMatch(terraformSource, /google_(cloudfunctions|cloud_run|compute|scheduler|service_account|service_account_key)/);
  assert.doesNotMatch(terraformSource, /allUsers|allAuthenticatedUsers|roles\/owner|roles\/editor|\bmiakapp-3\b/);
});

test('pins a single argument-free OIDC GET without retry or Firebase credentials', () => {
  const sourceMatch = /workflow_source\s*=\s*<<-YAML\n([\s\S]*?)\n\s*YAML/.exec(localsSource);
  assert.notEqual(sourceMatch, null);
  const terraformWorkflow = sourceMatch[1]
    .split('\n')
    .map((line) => line.slice(4))
    .join('\n')
    .replaceAll('${local.function_uri}${local.discovery_path}', `${FUNCTION_URI}/.well-known/miakapp-control-plane`)
    .replaceAll('${local.function_uri}', FUNCTION_URI)
    .replaceAll('$${', '${')
    .concat('\n');
  assert.equal(terraformWorkflow, WORKFLOW_SOURCE);
  assert.equal((WORKFLOW_SOURCE.match(/call: http\.get/g) ?? []).length, 1);
  assert.match(WORKFLOW_SOURCE, new RegExp(`url: ${FUNCTION_URI.replaceAll('.', '\\.')}/\\.well-known/miakapp-control-plane`));
  assert.match(WORKFLOW_SOURCE, /type: OIDC/);
  assert.match(WORKFLOW_SOURCE, new RegExp(`audience: ${FUNCTION_URI.replaceAll('.', '\\.')}`));
  assert.doesNotMatch(WORKFLOW_SOURCE, /retry:|params:|args: \$\{|Authorization|Firebase|AppCheck|query/);
  const requestArguments = WORKFLOW_SOURCE.slice(
    WORKFLOW_SOURCE.indexOf('        args:'),
    WORKFLOW_SOURCE.indexOf('        result: response'),
  );
  assert.doesNotMatch(requestArguments, /\n\s+body:/);
});

test('separates deployment from the exact one-shot invocation', () => {
  assert.doesNotMatch(planSource, /'apply'|'destroy'|'workflows', 'run'/);
  assert.match(planSource, /'-detailed-exitcode'/);
  assert.match(planSource, /readAndValidateProbePlan/);
  assert.match(applySource, /'apply', '-input=false', '-auto-approve', '-no-color', planPath/);
  assert.match(applySource, /validateProbeApplyAuthorization/);
  assert.match(applySource, /'terraform-convergence'/);
  assert.doesNotMatch(applySource, /'workflows', 'run'|curl|fetch\(/);
  assert.equal((invokeSource.match(/'workflows', 'run'/g) ?? []).length, 1);
  assert.match(invokeSource, /expectedExecutions: 0/);
  assert.match(invokeSource, /expectedExecutions: 1/);
  assert.match(invokeSource, /--call-log-level=log-none/);
  assert.match(invokeSource, /--execution-history-level=execution-history-basic/);
  assert.match(invokeSource, /--disable-concurrency-quota-overflow-buffering/);
  assert.match(invokeSource, /validateProbeInvokeAuthorization/);
  assert.doesNotMatch(invokeSource, /--data|retry:|setTimeout|curl|fetch\(/);
});

test('limits recovery to two pinned failures and one corrected execution', () => {
  assert.equal((recoverSource.match(/'workflows', 'run'/g) ?? []).length, 1);
  assert.equal((recoverSource.match(/= observeFailures\(\);/g) ?? []).length, 2);
  assert.match(recoverSource, /expectedExecutions: 2/);
  assert.match(recoverSource, /expectedExecutions: 3/);
  assert.match(recoverSource, /validateProbeRecoveryAuthorization/);
  assert.match(recoverSource, /WORKLOAD_FUNCTION_REVISION/);
  assert.match(recoverSource, /attempts_after_latest_correction: 1/);
  assert.doesNotMatch(recoverSource, /--data|retry:|setTimeout|curl|fetch\(/);
  assert.equal(WORKLOAD_COMMIT, '60322c69c92b8ccf5f3d1bc87ba264a00e5dca05');
  assert.equal(WORKLOAD_SOURCE_SHA256, '86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358');
  assert.equal(WORKLOAD_FUNCTION_REVISION, 'control-plane-00003-hum');
});

test('locks the only provider for both CI platforms and runs the root in the main gate', () => {
  assert.equal((lockSource.match(/provider "registry\.terraform\.io\/hashicorp\/google"/g) ?? []).length, 1);
  assert.equal((lockSource.match(/"h1:/g) ?? []).length, 2);
  assert.match(lockSource, /version\s+= "8\.1\.0"/);
  assert.match(checkSource, /for terraform_root in bootstrap terraform workload probe/);
  assert.match(checkSource, /infrastructure\/staging\/test\/probe\.test\.mjs/);
  assert.match(checkSource, /infrastructure\/staging\/probe\/evidence\.mjs/);
  assert.match(checkSource, /infrastructure\/staging\/probe\/result\.json/);
  assert.match(checkSource, /infrastructure\/staging\/probe\/invoke\.sh/);
});

test('accepts only the reviewed initial probe plan', () => {
  assert.deepEqual(validateProbePlanAgainstPolicy(syntheticPlan()), {
    profile: 'initial',
    create: 3,
    update: 0,
    delete: 0,
    workflows_api: 1,
    workflows: 1,
    scheduled_triggers: 0,
    retries: 0,
    public_invokers: 0,
    workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
  });
  for (const [completed, expected] of [
    [1, { profile: 'after-guard', create: 2 }],
    [2, { profile: 'after-api', create: 1 }],
  ]) {
    const plan = syntheticPlan();
    for (const address of [
      'terraform_data.probe_guard',
      'google_project_service.workflows',
    ].slice(0, completed)) {
      const change = plan.resource_changes.find((candidate) => candidate.address === address);
      change.change.actions = ['no-op'];
      change.change.before = structuredClone(change.change.after);
    }
    const summary = validateProbePlanAgainstPolicy(plan);
    assert.equal(summary.profile, expected.profile);
    assert.equal(summary.create, expected.create);
  }
  for (const mutate of [
    (plan) => { plan.resource_changes[0].change.actions = ['delete', 'create']; },
    (plan) => { plan.resource_changes[1].change.after.source_contents += '    retry: ${http.default_retry}\n'; },
    (plan) => { plan.resource_changes[1].change.after.service_account = 'attacker@example.test'; },
    (plan) => { plan.resource_changes[0].change.after.project = 'miakapp-v4'; },
    (plan) => { plan.resource_changes.push({ address: 'google_cloud_scheduler_job.probe', mode: 'managed' }); },
  ]) {
    const plan = syntheticPlan();
    mutate(plan);
    assert.throws(() => validateProbePlanAgainstPolicy(plan));
  }
});

test('binds short-lived apply and invocation authorizations to exact artifacts', () => {
  const summary = validateProbePlanAgainstPolicy(syntheticPlan());
  const metadata = buildProbePlanMetadata({
    repositoryCommit: COMMIT,
    createdAt: '2026-09-04T01:00:00.000Z',
    planBytes: PLAN,
    planJsonBytes: PLAN_JSON,
    summary,
  });
  assert.equal(validateProbePlanMetadata(metadata, Date.parse('2026-09-04T01:01:00.000Z')), metadata);
  const applyAuthorization = probeApplyAuthorization(PLAN, COMMIT);
  assert.doesNotThrow(() => validateProbeApplyAuthorization(applyAuthorization, PLAN, COMMIT));
  assert.throws(() => validateProbeApplyAuthorization(`${applyAuthorization}x`, PLAN, COMMIT));
  const invokeAuthorization = probeInvokeAuthorization('000001-abc', COMMIT);
  assert.doesNotThrow(() => validateProbeInvokeAuthorization(invokeAuthorization, '000001-abc', COMMIT));
  assert.throws(() => validateProbeInvokeAuthorization(invokeAuthorization, '000002-def', COMMIT));
  const recoveryAuthorization = probeRecoveryAuthorization(
    '000001-abc',
    'control-plane-00002-kux',
    COMMIT,
  );
  assert.doesNotThrow(() => validateProbeRecoveryAuthorization(
    recoveryAuthorization,
    '000001-abc',
    'control-plane-00002-kux',
    COMMIT,
  ));
  assert.throws(() => validateProbeRecoveryAuthorization(
    recoveryAuthorization,
    '000001-abc',
    'control-plane-00003-bad',
    COMMIT,
  ));
});

test('rejects ambient credentials and unreviewed files', () => {
  assert.throws(() => assertSafeWorkloadEnvironment({
    HOME: '/tmp/home',
    PATH: '/usr/bin',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json',
  }, 'MIAKAPP_STAGING_PROBE_PLAN_CONFIRMATION'));
  const unexpected = new URL('unreviewed.tf', probeRoot);
  writeFileSync(unexpected, 'resource "google_compute_network" "bad" {}\n', { flag: 'wx', mode: 0o600 });
  try {
    assert.throws(() => validateProbeRoot(probeRoot));
  } finally {
    unlinkSync(unexpected);
  }
});

test('accepts only the exact active Workflow with the requested execution count', () => {
  const responses = [
    [{ config: { name: 'workflows.googleapis.com' }, state: 'ENABLED' }],
    workflow(),
    [],
  ];
  const calls = [];
  const spawn = (_command, args) => {
    calls.push(args);
    return { status: 0, signal: null, stdout: Buffer.from(JSON.stringify(responses.shift())) };
  };
  const result = observeProbeDeployment({ repositoryRoot: '/tmp', spawn });
  assert.equal(result.workflow.revision, '000001-abc');
  assert.equal(result.executions.length, 0);
  assert.equal(calls.length, 3);
  assert.match(calls[2].join(' '), /--limit=4/);

  const exactThreeResponses = [
    [{ config: { name: 'workflows.googleapis.com' }, state: 'ENABLED' }],
    workflow(),
    [{ state: 'SUCCEEDED' }, { state: 'FAILED' }, { state: 'FAILED' }],
  ];
  assert.equal(observeProbeDeployment({
    repositoryRoot: '/tmp',
    expectedExecutions: 3,
    spawn: () => ({
      status: 0,
      signal: null,
      stdout: Buffer.from(JSON.stringify(exactThreeResponses.shift())),
    }),
  }).executions.length, 3);

  const extraExecutionResponses = [
    [{ config: { name: 'workflows.googleapis.com' }, state: 'ENABLED' }],
    workflow(),
    [{}, {}, {}, {}],
  ];
  assert.throws(() => observeProbeDeployment({
    repositoryRoot: '/tmp',
    expectedExecutions: 3,
    spawn: () => ({
      status: 0,
      signal: null,
      stdout: Buffer.from(JSON.stringify(extraExecutionResponses.shift())),
    }),
  }));

  const changed = workflow();
  changed.sourceContents += 'retry: ${http.default_retry}\n';
  const changedResponses = [
    [{ config: { name: 'workflows.googleapis.com' }, state: 'ENABLED' }],
    changed,
    [],
  ];
  assert.throws(() => observeProbeDeployment({
    repositoryRoot: '/tmp',
    spawn: () => ({ status: 0, signal: null, stdout: Buffer.from(JSON.stringify(changedResponses.shift())) }),
  }));
});

test('validates the exact successful discovery result without retaining its execution ID', () => {
  assert.deepEqual(validateSuccessfulExecution(successfulExecution(), {
    revision: '000001-abc',
  }), {
    name: `${workflowResource}/executions/00000000-0000-4000-8000-000000000000`,
    state: 'SUCCEEDED',
    workflow_revision: '000001-abc',
    duration_milliseconds: 1250,
    response: {
      status: 200,
      content_type: 'application/json; charset=utf-8',
      cache_control: 'public, max-age=300, must-revalidate',
      body: EXPECTED_DISCOVERY,
    },
  });
  for (const mutate of [
    (execution) => { execution.state = 'FAILED'; },
    (execution) => { execution.workflowRevisionId = '000002-def'; },
    (execution) => { execution.result = execution.result.replace('200', '201'); },
    (execution) => { execution.result = execution.result.replace('control.staging', 'attacker'); },
  ]) {
    const execution = successfulExecution();
    mutate(execution);
    assert.throws(() => validateSuccessfulExecution(execution, { revision: '000001-abc' }));
  }
});

test('accepts only both pinned failed executions without retaining their trace contexts', () => {
  for (const profile of FAILED_EXECUTION_PROFILES) {
    const execution = failedExecution(profile);
    const result = validateFailedExecution(execution, { revision: '000001-abc' }, profile);
    assert.deepEqual(result, {
      name: execution.name,
      phase: profile.phase,
      state: 'FAILED',
      workflow_revision: '000001-abc',
      duration_milliseconds: profile.durationMilliseconds,
      response: { status: 503, error: 'service_unavailable' },
    });
    assert.doesNotMatch(JSON.stringify(result), /X-Cloud-Trace|a{32}/);
  }
  for (const mutate of [
    (value) => { value.state = 'SUCCEEDED'; },
    (value) => { value.startTime = '2026-09-04T01:14:35.985075631Z'; },
    (value) => { value.error.context = 'different step'; },
    (value) => {
      const payload = JSON.parse(value.error.payload);
      payload.code = 500;
      value.error.payload = JSON.stringify(payload);
    },
    (value) => {
      const payload = JSON.parse(value.error.payload);
      payload.headers['X-Cloud-Trace-Context'] = 'not-a-trace';
      value.error.payload = JSON.stringify(payload);
    },
  ]) {
    const profile = FAILED_EXECUTION_PROFILES[1];
    const value = failedExecution(profile);
    mutate(value);
    assert.throws(() => validateFailedExecution(value, { revision: '000001-abc' }, profile));
  }
  assert.throws(() => validateFailedExecution(
    failedExecution(),
    { revision: '000001-abc' },
    { ...FAILED_EXECUTION_PROFILES[1] },
  ));
});

test('pins the sanitized successful recovery evidence without private correlators', () => {
  const result = validateProbeEvidence(new URL('../probe/result.json', import.meta.url));
  assert.equal(result.recovery_execution.state, 'SUCCEEDED');
  assert.equal(result.recovery_execution.count_before, 2);
  assert.equal(result.recovery_execution.count_after, 3);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.response.body, EXPECTED_DISCOVERY);
  assert.equal(result.workload.function_revision, 'control-plane-00003-hum');
  assert.equal(result.workload.ingress, 'ALLOW_INTERNAL_ONLY');
  assert.equal(result.workload.unauthenticated_invokers, 0);
  assert.equal(result.workload.probe_user_managed_keys, 0);
  assert.equal(result.claims.secure_runtime_served_discovery, true);
  assert.equal(result.claims.firebase_auth_validated, false);
  assert.equal(result.claims.app_check_validated, false);
  assert.doesNotMatch(JSON.stringify(result), /executions\/[0-9a-f-]{36}|x-cloud-trace-context/iu);

  const changedStatus = structuredClone(result);
  changedStatus.response.status = 201;
  assert.throws(() => validateProbeEvidenceValue(changedStatus), /fields have drifted/);

  const executionId = structuredClone(result);
  executionId.correlator = '00000000-0000-4000-8000-000000000000';
  assert.throws(() => validateProbeEvidenceValue(executionId), /private execution or trace correlator/);

  const traceField = structuredClone(result);
  traceField.trace_id = 'a'.repeat(32);
  assert.throws(() => validateProbeEvidenceValue(traceField), /private telemetry or credential field/);

  for (const field of [
    'executionId',
    'insert-id',
    'requestHeaders',
    'stackTrace',
    'xCloudTraceContext',
    'authorization',
    'accessToken',
    'secret',
    'set-cookie',
    'remoteIp',
    'userAgent',
  ]) {
    const privateField = structuredClone(result);
    privateField[field] = 'redacted-but-still-forbidden';
    assert.throws(
      () => validateProbeEvidenceValue(privateField),
      /private telemetry or credential field/,
    );
  }
});
