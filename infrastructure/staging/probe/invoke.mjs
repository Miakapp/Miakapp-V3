import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  DISCOVERY_PATH,
  EXPECTED_DISCOVERY,
  FUNCTION_URI,
  PROBE_ACCOUNT,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_COMMIT,
  WORKLOAD_SOURCE_SHA256,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  childEnvironment,
  createPrivateProbeBundle,
  probeInvokeAuthorization,
  validateProbeInvokeAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import { validateProbeRoot } from './guard.mjs';
import { observeDeployedWorkload } from '../workload/inventory.mjs';

const INVOKE_AUTHORIZATION = 'MIAKAPP_STAGING_PROBE_INVOKE_AUTHORIZATION';
const probeRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const MAXIMUM_OUTPUT_BYTES = 8 * 1024 * 1024;
const WORKFLOW_RESOURCE = `projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}`;
const PROBE_ACCOUNT_RESOURCE = `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`;
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

function command(args, repository, spawn = spawnSync) {
  const result = spawn('gcloud', [...args, '--quiet', '--format=json'], {
    cwd: repository,
    env: childEnvironment(),
    maxBuffer: MAXIMUM_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = Buffer.from(result.stdout ?? '');
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    reject('Private-probe inventory command failed');
  }
  return parseJson(stdout, 'Private-probe inventory command');
}

function workflowInventory(value) {
  if (!plainObject(value)) reject('Workflow inventory is invalid');
  exact(value.name, WORKFLOW_RESOURCE, 'Workflow resource name');
  exact(value.state, 'ACTIVE', 'Workflow state');
  exact(value.serviceAccount, PROBE_ACCOUNT_RESOURCE, 'Workflow service account');
  exact(value.callLogLevel, 'LOG_NONE', 'Workflow call log level');
  exact(value.executionHistoryLevel, 'EXECUTION_HISTORY_BASIC', 'Workflow history level');
  exact(value.sourceContents, WORKFLOW_SOURCE, 'Workflow source');
  exact(value.labels, {
    environment: 'staging',
    'goog-terraform-provisioned': 'true',
    'managed-by': 'terraform',
    product: 'miakapp-v4',
    purpose: 'private-probe',
  }, 'Workflow labels');
  if (typeof value.revisionId !== 'string' || !/^[0-9a-z][0-9a-z-]{0,62}$/u.test(value.revisionId)) {
    reject('Workflow revision is invalid');
  }
  return Object.freeze({
    name: WORKFLOW_RESOURCE,
    revision: value.revisionId,
    service_account: PROBE_ACCOUNT,
    source_sha256: WORKFLOW_SOURCE_SHA256,
    call_log_level: 'LOG_NONE',
    execution_history_level: 'EXECUTION_HISTORY_BASIC',
  });
}

function executionInventory(value, expectedCount) {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    reject(`Workflow must have exactly ${expectedCount} execution(s)`);
  }
  return value;
}

export function observeProbeDeployment({ repositoryRoot: root, expectedExecutions = 0, spawn = spawnSync }) {
  const run = (args) => command(args, root, spawn);
  const services = run([
    'services', 'list', '--enabled', `--project=${PROJECT_ID}`,
    '--filter=config.name=workflows.googleapis.com',
  ]);
  if (!Array.isArray(services) || services.length !== 1
    || services[0]?.config?.name !== 'workflows.googleapis.com'
    || services[0]?.state !== 'ENABLED') {
    reject('Workflows API is not exactly enabled in staging');
  }
  const workflow = workflowInventory(run([
    'workflows', 'describe', WORKFLOW_NAME, `--location=${REGION}`, `--project=${PROJECT_ID}`,
  ]));
  const executions = executionInventory(run([
    'workflows', 'executions', 'list', WORKFLOW_NAME,
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
    '--limit=2',
    '--sort-by=~startTime',
  ]), expectedExecutions);
  return Object.freeze({
    schema: 'miakapp.staging-probe-deployment/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    workflows_api: 'ENABLED',
    workflow,
    executions,
    scheduled_triggers: 0,
    live_request_performed: expectedExecutions !== 0,
  });
}

function responseHeader(headers, expectedName) {
  if (!plainObject(headers)) reject('Workflow HTTP response headers are invalid');
  const entries = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === expectedName.toLowerCase());
  if (entries.length !== 1) reject(`Workflow response header ${expectedName} is missing or ambiguous`);
  const value = entries[0][1];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') return value[0];
  return reject(`Workflow response header ${expectedName} is invalid`);
}

function executionTimestamp(value, description) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) {
    reject(`${description} is not a valid UTC timestamp`);
  }
  return Date.parse(value);
}

export function validateSuccessfulExecution(value, workflow) {
  if (!plainObject(value)) reject('Workflow execution response is invalid');
  if (typeof value.name !== 'string' || !value.name.startsWith(`${WORKFLOW_RESOURCE}/executions/`)) {
    reject('Workflow execution belongs to a foreign workflow');
  }
  exact(value.state, 'SUCCEEDED', 'Workflow execution state');
  exact(value.workflowRevisionId, workflow.revision, 'Workflow execution revision');
  const start = executionTimestamp(value.startTime, 'Workflow execution start');
  const end = executionTimestamp(value.endTime, 'Workflow execution end');
  if (end < start || end - start > 120_000) reject('Workflow execution duration is outside the reviewed bound');
  if (typeof value.result !== 'string' || Buffer.byteLength(value.result, 'utf8') > 64 * 1024) {
    reject('Workflow execution result is invalid');
  }
  let result;
  try {
    result = JSON.parse(value.result);
  } catch {
    return reject('Workflow execution result is not JSON');
  }
  if (!plainObject(result)) reject('Workflow execution result is not an object');
  exact(Object.keys(result).sort(), ['body', 'code', 'headers'], 'Workflow result fields');
  exact(result.code, 200, 'Discovery response status');
  let body = result.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return reject('Discovery response body is not JSON');
    }
  }
  exact(body, EXPECTED_DISCOVERY, 'Discovery response body');
  const cacheControl = responseHeader(result.headers, 'cache-control');
  const contentType = responseHeader(result.headers, 'content-type');
  exact(cacheControl, 'public, max-age=300, must-revalidate', 'Discovery cache policy');
  if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(contentType)) {
    reject('Discovery content type is not JSON');
  }
  return Object.freeze({
    name: value.name,
    state: 'SUCCEEDED',
    workflow_revision: workflow.revision,
    duration_milliseconds: end - start,
    response: Object.freeze({
      status: 200,
      content_type: contentType.toLowerCase(),
      cache_control: cacheControl,
      body: Object.freeze({ ...EXPECTED_DISCOVERY }),
    }),
  });
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
      join(bundle, 'invocation-failure.log'),
      diagnostics.length === 0 ? Buffer.from('Invocation failed without diagnostics\n') : diagnostics,
    );
    reject('The single private-probe execution failed; private diagnostics were preserved');
  }
  return parseJson(Buffer.from(result.stdout), 'Workflow execution');
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${INVOKE_AUTHORIZATION}=... ./invoke.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, INVOKE_AUTHORIZATION);
  validateProbeRoot(new URL('./', import.meta.url));
  const repositoryCommit = verifyExactMain(repositoryRoot);
  verifiedOperatorEmail(repositoryRoot);
  const deployment = observeProbeDeployment({ repositoryRoot, expectedExecutions: 0 });
  validateProbeInvokeAuthorization(
    process.env[INVOKE_AUTHORIZATION],
    deployment.workflow.revision,
    repositoryCommit,
  );

  const bundle = createPrivateProbeBundle(process.argv[2], repositoryRoot);
  const workload = observeDeployedWorkload({
    repositoryRoot,
    repositoryCommit: WORKLOAD_COMMIT,
    sourceArchiveSha256: WORKLOAD_SOURCE_SHA256,
  });
  const finalPreflight = observeProbeDeployment({ repositoryRoot, expectedExecutions: 0 });
  if (finalPreflight.workflow.revision !== deployment.workflow.revision) {
    reject('Workflow revision changed after invocation authorization');
  }
  const rawExecution = runWorkflow(bundle);
  const execution = validateSuccessfulExecution(rawExecution, deployment.workflow);
  const after = observeProbeDeployment({ repositoryRoot, expectedExecutions: 1 });
  if (after.executions[0]?.name !== execution.name
    || after.executions[0]?.state !== 'SUCCEEDED'
    || after.workflow.revision !== deployment.workflow.revision) {
    reject('Post-invocation Workflow inventory does not match the single successful execution');
  }

  const result = Object.freeze({
    schema: 'miakapp.staging-private-probe-result/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: new Date().toISOString(),
    repository_commit: repositoryCommit,
    workflow: Object.freeze({
      name: WORKFLOW_RESOURCE,
      revision: deployment.workflow.revision,
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
      retries: 0,
      input: false,
      count: 1,
    }),
    execution: Object.freeze({
      state: execution.state,
      workflow_revision: execution.workflow_revision,
      duration_milliseconds: execution.duration_milliseconds,
      count_before: 0,
      count_after: 1,
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
    'The one-shot private staging probe succeeded.',
    `Private sanitized result: ${resultPath}`,
    'HTTP 200; internal-only ingress; executions: 1; retries: 0; Miakapp writes expected: 0.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Private-probe invocation failed');
    process.exitCode = 1;
  });
}

export function invocationAuthorization(repositoryCommit, workflowRevision) {
  return probeInvokeAuthorization(workflowRevision, repositoryCommit);
}
