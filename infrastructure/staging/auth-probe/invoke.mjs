import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  DESTINATION_PATH,
  FIREBASE_APP_ID,
  FUNCTION_URI,
  PROBE_ACCOUNT,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  SYNTHETIC_UID,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_COMMIT,
  WORKLOAD_FUNCTION_REVISION,
  WORKLOAD_SOURCE_SHA256,
  assertSafeWorkloadEnvironment,
  authProbeInvokeAuthorization,
  canonicalJson,
  readPrivateFile,
  validateAuthProbeInvokeAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  parseJson,
  privateBundle,
  repositoryRoot,
  run,
  validateFirebaseAuthConvergence,
} from './cli.mjs';
import { validateAuthProbeRoot } from './guard.mjs';
import { observeAuthProbeDeployment } from './inventory.mjs';
import { observeDeployedWorkload } from '../workload/inventory.mjs';

const INVOKE_AUTHORIZATION = 'MIAKAPP_STAGING_AUTH_PROBE_INVOKE_AUTHORIZATION';
const WORKFLOW_RESOURCE = `projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}`;
const MAXIMUM_RESULT_BYTES = 64 * 1024;
process.umask(0o077);

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function exactObject(value, keys, description) {
  if (!plainObject(value)) reject(`${description} is not an object`);
  exact(Object.keys(value).sort(), [...keys].sort(), `${description} fields`);
  return value;
}

function executionTimestamp(value, description) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) {
    reject(`${description} is not a valid UTC timestamp`);
  }
  return Date.parse(value);
}

export function validateAuthProbeWorkflowResult(value) {
  const result = exactObject(value, [
    'schema',
    'project_id',
    'project_number',
    'firebase_app_id',
    'route',
    'cloud_run',
    'firebase_auth',
    'app_check',
    'responses',
  ], 'Auth-probe Workflow result');
  exact(result.schema, 'miakapp.staging-auth-app-check-workflow-result/1', 'Result schema');
  exact(result.project_id, PROJECT_ID, 'Result project');
  exact(String(result.project_number), PROJECT_NUMBER, 'Result project number');
  exact(result.firebase_app_id, FIREBASE_APP_ID, 'Result Firebase app');
  exact(result.route, {
    method: 'GET',
    path: DESTINATION_PATH,
    product_requests: 3,
    successful_reads: 2,
    expected_application_writes: 0,
    retries: 0,
  }, 'Result route');
  exact(result.cloud_run, {
    authentication_header: 'X-Serverless-Authorization',
  }, 'Result Cloud Run boundary');
  exact(result.firebase_auth, {
    token_source: 'execution-scoped-custom-token',
    missing_app_check_reached: true,
    synthetic_user_created: true,
    synthetic_user_deleted: true,
    synthetic_user_absence_verified: true,
  }, 'Result Firebase Auth boundary');
  exact(result.app_check, {
    token_source: 'admin-custom-provider',
    token_consumption: false,
    first_use_accepted: true,
    replay_accepted: true,
  }, 'Result App Check boundary');
  exactObject(result.responses, [
    'missing_app_check',
    'first_authenticated_read',
    'replay_authenticated_read',
  ], 'Result responses');
  exact(result.responses.missing_app_check, {
    status: 401,
    code: 'invalid_app_check_token',
  }, 'Missing-App-Check response');
  const expectedRead = {
    status: 200,
    schema: 'miakapp.push-destination-list/1',
    destination_count: 0,
  };
  exact(result.responses.first_authenticated_read, expectedRead, 'First authenticated read');
  exact(result.responses.replay_authenticated_read, expectedRead, 'Replay authenticated read');
  return Object.freeze(result);
}

export function validateSuccessfulAuthProbeExecution(value, workflowRevision) {
  if (!plainObject(value)) reject('Auth-probe execution response is invalid');
  const prefixes = [
    `${WORKFLOW_RESOURCE}/executions/`,
    `projects/${PROJECT_NUMBER}/locations/${REGION}/workflows/${WORKFLOW_NAME}/executions/`,
  ];
  const prefix = typeof value.name === 'string'
    ? prefixes.find((candidate) => value.name.startsWith(candidate))
    : undefined;
  const executionId = prefix === undefined ? '' : value.name.slice(prefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(executionId)) {
    reject('Auth-probe execution belongs to a foreign Workflow');
  }
  exact(value.state, 'SUCCEEDED', 'Auth-probe execution state');
  exact(value.workflowRevisionId, workflowRevision, 'Auth-probe execution revision');
  const started = executionTimestamp(value.startTime, 'Auth-probe execution start');
  const ended = executionTimestamp(value.endTime, 'Auth-probe execution end');
  if (ended < started || ended - started > 300_000) {
    reject('Auth-probe execution duration is outside the reviewed bound');
  }
  if (typeof value.result !== 'string'
    || Buffer.byteLength(value.result, 'utf8') === 0
    || Buffer.byteLength(value.result, 'utf8') > MAXIMUM_RESULT_BYTES) {
    reject('Auth-probe execution result has an invalid size');
  }
  let result;
  try {
    result = JSON.parse(value.result);
  } catch {
    return reject('Auth-probe execution result is not JSON');
  }
  return Object.freeze({
    name: value.name,
    state: 'SUCCEEDED',
    workflow_revision: workflowRevision,
    duration_milliseconds: ended - started,
    result: validateAuthProbeWorkflowResult(result),
  });
}

function readDeployment(bundle, observed) {
  const bytes = readPrivateFile(join(bundle, 'deployment.json'), 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Private Auth-probe deployment is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8') || !isDeepStrictEqual(value, observed)) {
    reject('Private Auth-probe deployment no longer matches live staging');
  }
}

function operatorAccessToken() {
  const result = run('gcloud', ['auth', 'print-access-token', '--quiet'], {
    cwd: repositoryRoot,
    description: 'operator-access-token',
  });
  const token = Buffer.from(result.stdout).toString('utf8').trim();
  if (token.length < 20 || token.length > 16 * 1024 || /\s/u.test(token)) {
    reject('Operator access token response is invalid');
  }
  return token;
}

async function firebaseAdminRequest(path, body, accessToken) {
  let response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/${path}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Goog-User-Project': PROJECT_ID,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    return reject('Independent Firebase Auth cleanup request failed');
  }
  let value;
  try {
    value = await response.json();
  } catch {
    return reject('Independent Firebase Auth cleanup returned invalid JSON');
  }
  if (response.status !== 200 || !plainObject(value)) {
    reject('Independent Firebase Auth cleanup returned an unexpected status');
  }
  return value;
}

async function syntheticUserPresent(accessToken) {
  const value = await firebaseAdminRequest(
    'accounts:lookup',
    { localId: [SYNTHETIC_UID] },
    accessToken,
  );
  if (value.users === undefined) return false;
  if (!Array.isArray(value.users) || value.users.length !== 1
    || value.users[0]?.localId !== SYNTHETIC_UID) {
    reject('Synthetic Firebase Auth inventory is ambiguous');
  }
  return true;
}

export async function requireSyntheticUserAbsent({ cleanup }) {
  const accessToken = operatorAccessToken();
  const present = await syntheticUserPresent(accessToken);
  if (present && !cleanup) reject('Synthetic Firebase Auth user already exists before invocation');
  if (present) {
    await firebaseAdminRequest('accounts:delete', { localId: SYNTHETIC_UID }, accessToken);
  }
  if (await syntheticUserPresent(accessToken)) {
    reject('Synthetic Firebase Auth user remains after cleanup');
  }
  return Object.freeze({ present_before_cleanup: present, present_after_cleanup: false });
}

function runWorkflow(bundle) {
  const result = run('gcloud', [
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
    diagnosticDirectory: bundle,
    description: 'auth-probe-invocation',
  });
  return parseJson(result.stdout, 'Auth-probe execution');
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${INVOKE_AUTHORIZATION}=... ./invoke.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, INVOKE_AUTHORIZATION);
  validateAuthProbeRoot(new URL('./', import.meta.url));
  const bundle = privateBundle(process.argv[2]);
  const repositoryCommit = verifyExactMain(repositoryRoot);
  verifiedOperatorEmail(repositoryRoot);
  await validateFirebaseAuthConvergence(bundle, 'invoke');
  const deployment = observeAuthProbeDeployment({ expectedExecutions: 0 });
  readDeployment(bundle, deployment);
  validateAuthProbeInvokeAuthorization(
    process.env[INVOKE_AUTHORIZATION],
    deployment.workflow.revision,
    repositoryCommit,
  );
  const workload = observeDeployedWorkload({
    repositoryRoot,
    repositoryCommit: WORKLOAD_COMMIT,
    sourceArchiveSha256: WORKLOAD_SOURCE_SHA256,
  });
  if (workload.function.revision !== WORKLOAD_FUNCTION_REVISION) {
    reject('Deployed workload revision no longer matches the reviewed Auth-probe target');
  }
  await requireSyntheticUserAbsent({ cleanup: false });
  const finalPreflight = observeAuthProbeDeployment({ expectedExecutions: 0 });
  if (finalPreflight.workflow.revision !== deployment.workflow.revision) {
    reject('Auth-probe Workflow revision changed after invocation authorization');
  }

  let execution;
  try {
    execution = validateSuccessfulAuthProbeExecution(
      runWorkflow(bundle),
      deployment.workflow.revision,
    );
    await requireSyntheticUserAbsent({ cleanup: false });
  } catch (error) {
    try {
      await requireSyntheticUserAbsent({ cleanup: true });
    } catch {
      reject('Auth-probe failed and the synthetic Firebase user requires manual cleanup');
    }
    throw error;
  }

  const after = observeAuthProbeDeployment({ expectedExecutions: 1 });
  if (after.workflow.revision !== deployment.workflow.revision
    || after.workflow.executions[0]?.name !== execution.name
    || after.workflow.executions[0]?.state !== 'SUCCEEDED') {
    reject('Post-invocation Workflow inventory does not match the single successful execution');
  }
  const result = Object.freeze({
    schema: 'miakapp.staging-auth-app-check-probe-result/1',
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
    execution: Object.freeze({
      state: 'SUCCEEDED',
      workflow_revision: execution.workflow_revision,
      duration_milliseconds: execution.duration_milliseconds,
      count_before: 0,
      count_after: 1,
    }),
    request: Object.freeze({
      method: 'GET',
      path: DESTINATION_PATH,
      product_requests: 3,
      successful_reads: 2,
      expected_application_writes: 0,
      retries: 0,
      cloud_run_authentication_header: 'X-Serverless-Authorization',
    }),
    responses: execution.result.responses,
    firebase_auth: Object.freeze({
      token_source: 'execution-scoped-custom-token',
      synthetic_user_created: true,
      synthetic_user_deleted: true,
      workflow_absence_verified: true,
      independent_absence_verified: true,
    }),
    app_check: Object.freeze({
      firebase_app_id: FIREBASE_APP_ID,
      token_source: 'admin-custom-provider',
      token_consumption: false,
      first_use_accepted: true,
      replay_accepted: true,
      browser_provider_attestation_validated: false,
    }),
    workload: Object.freeze({
      deployment_commit: workload.repository_commit,
      source_sha256: workload.source_archive_sha256,
      function_revision: workload.function.revision,
      expected_function_revision: WORKLOAD_FUNCTION_REVISION,
      function_uri: FUNCTION_URI,
      ingress: workload.function.ingress,
      unauthenticated_invokers: workload.function.unauthenticated_invokers,
      probe_user_managed_keys: workload.identities.user_managed_keys.probe,
    }),
  });
  const resultPath = join(bundle, 'result.json');
  writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
  verifyExactMain(repositoryRoot, repositoryCommit);
  process.stdout.write([
    'The bounded Firebase Auth and App Check staging probe succeeded.',
    `Private sanitized result: ${resultPath}`,
    'Responses: missing App Check 401; authenticated reads 200 then 200.',
    'Synthetic Firebase user deleted and independently verified absent.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Auth-probe invocation failed');
    process.exitCode = 1;
  });
}

export function invocationAuthorization(repositoryCommit, workflowRevision) {
  return authProbeInvokeAuthorization(workflowRevision, repositoryCommit);
}
