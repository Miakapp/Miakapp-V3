import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  DISCOVERY_PATH,
  FUNCTION_URI,
  PROBE_ACCOUNT,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_COMMIT,
  WORKLOAD_FUNCTION_REVISION,
  WORKLOAD_SOURCE_SHA256,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  childEnvironment,
  createPrivateProbeBundle,
  probeRecoveryAuthorization,
  validateProbeRecoveryAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import { validateProbeRoot } from './guard.mjs';
import { observeProbeDeployment, validateSuccessfulExecution } from './invoke.mjs';
import { observeDeployedWorkload } from '../workload/inventory.mjs';

const RECOVERY_AUTHORIZATION = 'MIAKAPP_STAGING_PROBE_RECOVERY_AUTHORIZATION';
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const MAXIMUM_OUTPUT_BYTES = 8 * 1024 * 1024;
const WORKFLOW_RESOURCE = `projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}`;
const FAILED_START = '2026-09-04T01:14:35.985075630Z';
const FAILED_END = '2026-09-04T01:14:38.074599578Z';
const FAILED_CONTEXT = 'HTTP server responded with error code 503\nin step "invoke", routine "main", line: 4';
process.umask(0o077);

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} does not match the reviewed value`);
}

function parseJson(bytes, description) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_OUTPUT_BYTES) {
    reject(`${description} returned an invalid response size`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
}

function command(args) {
  const result = spawnSync('gcloud', [...args, '--quiet', '--format=json'], {
    cwd: repositoryRoot,
    env: childEnvironment(),
    maxBuffer: MAXIMUM_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    reject('Private-probe recovery inventory command failed');
  }
  return parseJson(Buffer.from(result.stdout ?? ''), 'Private-probe recovery inventory command');
}

function executionName(value) {
  if (typeof value !== 'string') reject('Workflow execution name is invalid');
  const prefixes = [
    `${WORKFLOW_RESOURCE}/executions/`,
    `projects/${PROJECT_NUMBER}/locations/${REGION}/workflows/${WORKFLOW_NAME}/executions/`,
  ];
  const prefix = prefixes.find((candidate) => value.startsWith(candidate));
  const suffix = prefix === undefined ? '' : value.slice(prefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(suffix)) {
    reject('Workflow execution belongs to a foreign or malformed resource');
  }
  return value;
}

function timestamp(value, expected, description) {
  exact(value, expected, description);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) reject(`${description} is invalid`);
  return milliseconds;
}

function validateFailedIdentity(value, workflow) {
  if (!plainObject(value)) reject('Prior Workflow execution is invalid');
  const name = executionName(value.name);
  exact(value.state, 'FAILED', 'Prior Workflow execution state');
  exact(value.workflowRevisionId, workflow.revision, 'Prior Workflow execution revision');
  const start = timestamp(value.startTime, FAILED_START, 'Prior Workflow execution start');
  const end = timestamp(value.endTime, FAILED_END, 'Prior Workflow execution end');
  return Object.freeze({ name, duration_milliseconds: end - start });
}

export function validateFailedExecution(value, workflow) {
  const identity = validateFailedIdentity(value, workflow);
  if (!plainObject(value.error)) reject('Prior Workflow error is missing');
  exact(Object.keys(value.error).sort(), ['context', 'payload', 'stackTrace'], 'Prior Workflow error fields');
  exact(value.error.context, FAILED_CONTEXT, 'Prior Workflow error context');
  exact(value.error.stackTrace, {
    elements: [{
      position: { column: '9', length: '4', line: '4' },
      routine: 'main',
      step: 'invoke',
    }],
  }, 'Prior Workflow stack');
  if (typeof value.error.payload !== 'string'
    || Buffer.byteLength(value.error.payload, 'utf8') > 64 * 1024) {
    reject('Prior Workflow error payload is invalid');
  }
  let payload;
  try {
    payload = JSON.parse(value.error.payload);
  } catch {
    return reject('Prior Workflow error payload is not JSON');
  }
  if (!plainObject(payload) || !plainObject(payload.headers)) {
    reject('Prior Workflow HTTP error is invalid');
  }
  exact(Object.keys(payload).sort(), ['body', 'code', 'headers', 'message', 'tags'], 'Prior HTTP error fields');
  exact(payload.body, { error: 'service_unavailable' }, 'Prior HTTP error body');
  exact(payload.code, 503, 'Prior HTTP error status');
  exact(payload.message, 'HTTP server responded with error code 503', 'Prior HTTP error message');
  exact(payload.tags, ['HttpError'], 'Prior HTTP error tags');
  exact(Object.keys(payload.headers).sort(), [
    'Alt-Svc',
    'Cache-Control',
    'Content-Length',
    'Content-Type',
    'Date',
    'Server',
    'X-Cloud-Trace-Context',
  ], 'Prior HTTP error header fields');
  exact(payload.headers['Alt-Svc'], 'h3=":443"; ma=2592000,h3-29=":443"; ma=2592000', 'Prior HTTP alternative service');
  exact(payload.headers['Cache-Control'], 'no-store', 'Prior HTTP cache policy');
  exact(payload.headers['Content-Length'], '31', 'Prior HTTP content length');
  exact(payload.headers['Content-Type'], 'application/json; charset=utf-8', 'Prior HTTP content type');
  exact(payload.headers.Date, 'Fri, 04 Sep 2026 01:14:38 GMT', 'Prior HTTP date');
  exact(payload.headers.Server, 'Google Frontend', 'Prior HTTP server');
  if (!/^[0-9a-f]{32};o=[01]$/u.test(payload.headers['X-Cloud-Trace-Context'] ?? '')) {
    reject('Prior private trace context is malformed');
  }
  return Object.freeze({
    ...identity,
    state: 'FAILED',
    workflow_revision: workflow.revision,
    response: Object.freeze({ status: 503, error: 'service_unavailable' }),
  });
}

function observeFailure() {
  const deployment = observeProbeDeployment({ repositoryRoot, expectedExecutions: 1 });
  const listed = validateFailedIdentity(deployment.executions[0], deployment.workflow);
  const detailed = command([
    'workflows', 'executions', 'describe', listed.name,
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
  ]);
  const failure = validateFailedExecution(detailed, deployment.workflow);
  exact(failure.name, listed.name, 'Prior Workflow execution identity');
  return Object.freeze({ deployment, failure });
}

function runWorkflow(bundle) {
  const result = spawnSync('gcloud', [
    'workflows', 'run', WORKFLOW_NAME,
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
    '--call-log-level=log-none',
    '--execution-history-level=execution-history-basic',
    '--disable-concurrency-quota-overflow-buffering',
    '--quiet',
    '--format=json',
  ], {
    cwd: repositoryRoot,
    env: childEnvironment(),
    maxBuffer: MAXIMUM_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    const diagnostics = Buffer.concat([
      Buffer.from(result.stdout ?? ''),
      Buffer.from(result.stderr ?? ''),
    ]);
    writePrivateFile(
      join(bundle, 'recovery-failure.log'),
      diagnostics.length === 0 ? Buffer.from('Recovery failed without diagnostics\n') : diagnostics,
    );
    reject('The single private-probe recovery execution failed; private diagnostics were preserved');
  }
  return parseJson(Buffer.from(result.stdout), 'Workflow recovery execution');
}

function observeCorrectedWorkload() {
  const workload = observeDeployedWorkload({
    repositoryRoot,
    repositoryCommit: WORKLOAD_COMMIT,
    sourceArchiveSha256: WORKLOAD_SOURCE_SHA256,
  });
  exact(workload.function.revision, WORKLOAD_FUNCTION_REVISION, 'Corrected Function revision');
  return workload;
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${RECOVERY_AUTHORIZATION}=... ./recover.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, RECOVERY_AUTHORIZATION);
  validateProbeRoot(new URL('./', import.meta.url));
  const repositoryCommit = verifyExactMain(repositoryRoot);
  verifiedOperatorEmail(repositoryRoot);

  const initial = observeFailure();
  const workload = observeCorrectedWorkload();
  validateProbeRecoveryAuthorization(
    process.env[RECOVERY_AUTHORIZATION],
    initial.deployment.workflow.revision,
    workload.function.revision,
    repositoryCommit,
  );

  const bundle = createPrivateProbeBundle(process.argv[2], repositoryRoot);
  const finalPreflight = observeFailure();
  const finalWorkload = observeCorrectedWorkload();
  exact(finalPreflight.failure.name, initial.failure.name, 'Prior execution stable identity');
  exact(finalPreflight.deployment.workflow, initial.deployment.workflow, 'Workflow stable deployment');
  exact(finalWorkload.function.revision, workload.function.revision, 'Function stable revision');

  const rawExecution = runWorkflow(bundle);
  const execution = validateSuccessfulExecution(rawExecution, initial.deployment.workflow);
  const after = observeProbeDeployment({ repositoryRoot, expectedExecutions: 2 });
  const priorAfter = validateFailedIdentity(after.executions[1], after.workflow);
  if (after.workflow.revision !== initial.deployment.workflow.revision
    || executionName(after.executions[0]?.name) !== execution.name
    || after.executions[0]?.state !== 'SUCCEEDED'
    || after.executions[0]?.workflowRevisionId !== after.workflow.revision
    || priorAfter.name !== initial.failure.name) {
    reject('Post-recovery Workflow inventory does not match the exact two executions');
  }
  observeCorrectedWorkload();

  const result = Object.freeze({
    schema: 'miakapp.staging-private-probe-recovery-result/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: new Date().toISOString(),
    repository_commit: repositoryCommit,
    workflow: Object.freeze({
      name: WORKFLOW_RESOURCE,
      revision: initial.deployment.workflow.revision,
      service_account: PROBE_ACCOUNT,
      source_sha256: WORKFLOW_SOURCE_SHA256,
      call_log_level: 'LOG_NONE',
      execution_history_level: 'EXECUTION_HISTORY_BASIC',
      scheduled_triggers: 0,
    }),
    request: Object.freeze({
      method: 'GET',
      uri: `${FUNCTION_URI}${DISCOVERY_PATH}`,
      authentication: 'OIDC',
      audience: FUNCTION_URI,
      timeout_seconds: 30,
      workflow_retries: 0,
      attempts_after_correction: 1,
      input: false,
    }),
    prior_execution: Object.freeze({
      state: initial.failure.state,
      workflow_revision: initial.failure.workflow_revision,
      duration_milliseconds: initial.failure.duration_milliseconds,
      response: initial.failure.response,
      cause: 'secret-manager-numeric-project-canonicalization',
    }),
    recovery_execution: Object.freeze({
      state: execution.state,
      workflow_revision: execution.workflow_revision,
      duration_milliseconds: execution.duration_milliseconds,
      count_before: 1,
      count_after: 2,
    }),
    response: execution.response,
    workload: Object.freeze({
      deployment_commit: workload.repository_commit,
      source_sha256: workload.source_archive_sha256,
      function_revision: workload.function.revision,
      function_uri: workload.function.uri,
      ingress: workload.function.ingress,
      unauthenticated_invokers: workload.function.unauthenticated_invokers,
      probe_user_managed_keys: workload.identities.user_managed_keys.probe,
    }),
    claims: Object.freeze({
      private_ingress_reached: true,
      secure_runtime_served_discovery: true,
      firebase_auth_validated: false,
      app_check_validated: false,
      application_mutation_expected: false,
    }),
  });
  const resultPath = join(bundle, 'result.json');
  writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
  verifyExactMain(repositoryRoot, repositoryCommit);
  process.stdout.write([
    'The single private staging probe recovery succeeded.',
    `Private sanitized result: ${resultPath}`,
    'HTTP 200; internal-only ingress; total executions: 2; Workflow retries: 0; Miakapp writes expected: 0.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Private-probe recovery failed');
    process.exitCode = 1;
  });
}

export function recoveryAuthorization(repositoryCommit, workflowRevision, functionRevision) {
  return probeRecoveryAuthorization(workflowRevision, functionRevision, repositoryCommit);
}
