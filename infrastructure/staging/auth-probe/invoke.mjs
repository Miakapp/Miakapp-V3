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
  SYNTHETIC_HOME_ID,
  SYNTHETIC_OWNER_UID,
  SYNTHETIC_UID,
  VERIFIER_ACCOUNT,
  VERIFIER_SERVICE_NAME,
  VERIFIER_SERVICE_URI,
  VERIFIER_SOURCE_SHA256,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_COMMIT,
  WORKLOAD_FUNCTION_REVISION,
  WORKLOAD_IMAGE,
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
const FIRESTORE_DOCUMENT_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/controlHomes/${SYNTHETIC_HOME_ID}`;
const PUBLIC_FIRESTORE_DOCUMENT_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/homes/${SYNTHETIC_HOME_ID}`;
const MAXIMUM_RESULT_BYTES = 64 * 1024;
const BOUNDED_FAILURE_STAGES = new Set([
  'initialize',
  'web_config',
  'initial_home',
  'initial_user',
  'auth_custom_token',
  'auth_exchange',
  'app_check_custom_token',
  'app_check_exchange',
  'cloud_run_identity',
  'discovery',
  'jwks',
  'invalid_firebase',
  'missing_app_check',
  'missing_home',
  'home_create',
  'first_exchange',
  'home_rotation',
  'second_exchange',
  'token_verification',
  'success',
]);
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
    'firestore',
    'metadata',
    'responses',
    'tokens',
  ], 'User-relay probe Workflow result');
  exact(result.schema, 'miakapp.staging-user-relay-workflow-result/1', 'Result schema');
  exact(result.project_id, PROJECT_ID, 'Result project');
  exact(String(result.project_number), PROJECT_NUMBER, 'Result project number');
  exact(result.firebase_app_id, FIREBASE_APP_ID, 'Result Firebase app');
  exact(result.route, {
    method: 'POST',
    path: DESTINATION_PATH,
    product_requests: 5,
    successful_exchanges: 2,
    negative_controls: 3,
    retries: 0,
  }, 'Result route');
  exact(result.cloud_run, {
    authentication_header: 'X-Serverless-Authorization',
    verifier_uri: VERIFIER_SERVICE_URI,
    verifier_ingress: 'internal-only',
  }, 'Result Cloud Run boundary');
  exact(result.firebase_auth, {
    token_source: 'execution-scoped-custom-token',
    synthetic_user_created: true,
    synthetic_user_deleted: true,
    synthetic_user_absence_verified: true,
    verified_email_present: false,
  }, 'Result Firebase Auth boundary');
  exact(result.app_check, {
    token_source: 'admin-custom-provider',
    token_consumption: false,
    replay_accepted: true,
  }, 'Result App Check boundary');
  exact(result.firestore, {
    collection: 'controlHomes',
    synthetic_home_created: true,
    relay_rotated: true,
    synthetic_home_deleted: true,
    synthetic_home_absence_verified: true,
    public_home_written: false,
    owner_matches_authenticated_user: false,
  }, 'Result Firestore boundary');
  exact(result.metadata, { discovery_valid: true, jwks_valid: true }, 'Result metadata boundary');
  exact(result.responses, {
    invalid_firebase: { status: 401, code: 'invalid_firebase_token' },
    missing_app_check: { status: 401, code: 'invalid_app_check_token' },
    missing_home: { status: 404, code: 'home_not_found' },
    first_exchange: { status: 200, relay_url: 'wss://relay-a.probe.invalid/ws' },
    second_exchange: { status: 200, relay_url: 'wss://relay-b.probe.invalid/ws' },
  }, 'Result responses');
  exact(result.tokens, {
    algorithm: 'EdDSA',
    key_id: 'staging-access-token-v1',
    type: 'at+jwt',
    ttl_seconds: 300,
    signatures_valid: true,
    audiences_changed: true,
    distinct_tokens: true,
    distinct_jti: true,
    scope: 'relay:user',
    role: 'user',
    verified_email_present: false,
    client_id_present: false,
    coordinator_present: false,
  }, 'Result token boundary');
  return Object.freeze(result);
}

export function validateSuccessfulAuthProbeExecution(value, workflowRevision) {
  if (!plainObject(value)) reject('User-relay probe execution response is invalid');
  const prefixes = [
    `${WORKFLOW_RESOURCE}/executions/`,
    `projects/${PROJECT_NUMBER}/locations/${REGION}/workflows/${WORKFLOW_NAME}/executions/`,
  ];
  const prefix = typeof value.name === 'string'
    ? prefixes.find((candidate) => value.name.startsWith(candidate))
    : undefined;
  const executionId = prefix === undefined ? '' : value.name.slice(prefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(executionId)) {
    reject('User-relay probe execution belongs to a foreign Workflow');
  }
  if (value.state !== 'SUCCEEDED') {
    const context = plainObject(value.error) && typeof value.error.context === 'string'
      ? value.error.context
      : '';
    const match = /^RuntimeError: "User-relay probe failed at bounded stage ([a-z_]+)"(?:\n|$)/u.exec(context);
    if (match !== null && BOUNDED_FAILURE_STAGES.has(match[1])) {
      reject(`User-relay probe execution failed at bounded stage ${match[1]}`);
    }
    reject('User-relay probe execution state does not match the reviewed value');
  }
  exact(value.workflowRevisionId, workflowRevision, 'User-relay probe execution revision');
  const started = executionTimestamp(value.startTime, 'User-relay probe execution start');
  const ended = executionTimestamp(value.endTime, 'User-relay probe execution end');
  if (ended < started || ended - started > 300_000) {
    reject('User-relay probe execution duration is outside the reviewed bound');
  }
  if (typeof value.result !== 'string' || Buffer.byteLength(value.result, 'utf8') === 0
    || Buffer.byteLength(value.result, 'utf8') > MAXIMUM_RESULT_BYTES) {
    reject('User-relay probe execution result has an invalid size');
  }
  let result;
  try {
    result = JSON.parse(value.result);
  } catch {
    return reject('User-relay probe execution result is not JSON');
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
    return reject('Private user-relay probe deployment is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8') || !isDeepStrictEqual(value, observed)) {
    reject('Private user-relay probe deployment no longer matches live staging');
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

async function jsonRequest(url, { accessToken, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-Goog-User-Project': PROJECT_ID,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return reject('Independent synthetic-fixture request failed');
  }
  let value = {};
  const bytes = await response.text();
  if (bytes.length > 0) {
    try {
      value = JSON.parse(bytes);
    } catch {
      return reject('Independent synthetic-fixture request returned invalid JSON');
    }
  }
  if (!plainObject(value)) reject('Independent synthetic-fixture request returned a non-object');
  return Object.freeze({ status: response.status, value });
}

async function syntheticUserPresent(accessToken) {
  const response = await jsonRequest(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
    { method: 'POST', body: { localId: [SYNTHETIC_UID] }, accessToken },
  );
  if (response.status !== 200) reject('Independent Firebase Auth lookup returned an unexpected status');
  if (response.value.users === undefined) return false;
  if (!Array.isArray(response.value.users) || response.value.users.length !== 1
    || response.value.users[0]?.localId !== SYNTHETIC_UID
    || response.value.users[0]?.email !== undefined) {
    reject('Synthetic Firebase Auth inventory is ambiguous');
  }
  return true;
}

function validateSyntheticHome(value) {
  if (value?.name !== `projects/${PROJECT_ID}/databases/(default)/documents/controlHomes/${SYNTHETIC_HOME_ID}`
    || value?.fields?.probe_marker?.stringValue !== 'miakapp.staging-user-relay-probe/1'
    || value?.fields?.home_id?.stringValue !== SYNTHETIC_HOME_ID
    || value?.fields?.owner_uid?.stringValue !== SYNTHETIC_OWNER_UID
    || typeof value?.updateTime !== 'string') {
    reject('Synthetic Firestore Home inventory is ambiguous');
  }
  return value.updateTime;
}

async function syntheticHome(accessToken) {
  const response = await jsonRequest(FIRESTORE_DOCUMENT_URL, { accessToken });
  if (response.status === 404) return null;
  if (response.status !== 200) reject('Independent Firestore Home lookup returned an unexpected status');
  validateSyntheticHome(response.value);
  return response.value;
}

async function syntheticPublicHomePresent(accessToken) {
  const response = await jsonRequest(PUBLIC_FIRESTORE_DOCUMENT_URL, { accessToken });
  if (response.status === 404) return false;
  if (response.status !== 200
    || response.value.name !== `projects/${PROJECT_ID}/databases/(default)/documents/homes/${SYNTHETIC_HOME_ID}`) {
    reject('Independent public Firestore Home lookup is ambiguous');
  }
  return true;
}

async function settle(operation) {
  try {
    return Object.freeze({ ok: true, value: await operation() });
  } catch {
    return Object.freeze({ ok: false, value: null });
  }
}

export async function requireSyntheticFixturesAbsent({ cleanup }) {
  const accessToken = operatorAccessToken();
  const [userInspection, homeInspection, publicHomeInspection] = await Promise.all([
    settle(() => syntheticUserPresent(accessToken)),
    settle(() => syntheticHome(accessToken)),
    settle(() => syntheticPublicHomePresent(accessToken)),
  ]);
  const inspectionFailed = !userInspection.ok || !homeInspection.ok || !publicHomeInspection.ok;
  const userPresent = userInspection.value === true;
  const home = homeInspection.value;
  const publicHomePresent = publicHomeInspection.value === true;
  if (!cleanup && (inspectionFailed || userPresent || home !== null || publicHomePresent)) {
    reject('A synthetic user-relay fixture already exists before or after invocation');
  }
  if (!cleanup) {
    return Object.freeze({
      user_present_before_cleanup: false,
      home_present_before_cleanup: false,
      public_home_present_before_cleanup: false,
      user_present_after_cleanup: false,
      home_present_after_cleanup: false,
      public_home_present_after_cleanup: false,
    });
  }

  const [homeDeletion, userDeletion] = await Promise.all([
    settle(async () => {
      if (!homeInspection.ok || home === null) return false;
      const updateTime = validateSyntheticHome(home);
      const deleted = await jsonRequest(
        `${FIRESTORE_DOCUMENT_URL}?currentDocument.updateTime=${encodeURIComponent(updateTime)}`,
        { method: 'DELETE', accessToken },
      );
      if (deleted.status !== 200) reject('Independent Firestore Home cleanup failed');
      return true;
    }),
    settle(async () => {
      if (!userInspection.ok || !userPresent) return false;
      const deleted = await jsonRequest(
        `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`,
        { method: 'POST', body: { localId: SYNTHETIC_UID }, accessToken },
      );
      if (deleted.status !== 200) reject('Independent Firebase Auth cleanup failed');
      return true;
    }),
  ]);
  const [homeAfter, userAfter, publicHomeAfter] = await Promise.all([
    settle(() => syntheticHome(accessToken)),
    settle(() => syntheticUserPresent(accessToken)),
    settle(() => syntheticPublicHomePresent(accessToken)),
  ]);
  if (inspectionFailed || !homeDeletion.ok || !userDeletion.ok
    || !homeAfter.ok || !userAfter.ok || !publicHomeAfter.ok
    || homeAfter.value !== null || userAfter.value !== false || publicHomeAfter.value !== false
    || publicHomePresent) {
    reject('A synthetic user-relay fixture remains after cleanup');
  }
  return Object.freeze({
    user_present_before_cleanup: userPresent,
    home_present_before_cleanup: home !== null,
    public_home_present_before_cleanup: publicHomePresent,
    user_present_after_cleanup: false,
    home_present_after_cleanup: false,
    public_home_present_after_cleanup: false,
  });
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
    description: 'user-relay-probe-invocation',
  });
  return parseJson(result.stdout, 'User-relay probe execution');
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
    process.env[INVOKE_AUTHORIZATION], deployment.workflow.revision, repositoryCommit,
  );
  const workload = observeDeployedWorkload({
    repositoryRoot,
    repositoryCommit: WORKLOAD_COMMIT,
    sourceArchiveSha256: WORKLOAD_SOURCE_SHA256,
  });
  if (workload.function.revision !== WORKLOAD_FUNCTION_REVISION) {
    reject('Deployed workload revision no longer matches the reviewed user-relay target');
  }
  await requireSyntheticFixturesAbsent({ cleanup: false });
  const finalPreflight = observeAuthProbeDeployment({ expectedExecutions: 0 });
  if (finalPreflight.workflow.revision !== deployment.workflow.revision
    || finalPreflight.verifier.revision !== deployment.verifier.revision) {
    reject('User-relay probe deployment changed after invocation authorization');
  }

  let execution;
  try {
    execution = validateSuccessfulAuthProbeExecution(
      runWorkflow(bundle), deployment.workflow.revision,
    );
    await requireSyntheticFixturesAbsent({ cleanup: false });
  } catch (error) {
    try {
      await requireSyntheticFixturesAbsent({ cleanup: true });
    } catch {
      reject('User-relay probe failed and synthetic fixtures require manual cleanup');
    }
    throw error;
  }

  const after = observeAuthProbeDeployment({ expectedExecutions: 1 });
  if (after.workflow.revision !== deployment.workflow.revision
    || after.verifier.revision !== deployment.verifier.revision
    || after.workflow.executions[0]?.name !== execution.name
    || after.workflow.executions[0]?.state !== 'SUCCEEDED') {
    reject('Post-invocation inventory does not match the single successful execution');
  }
  const result = Object.freeze({
    schema: 'miakapp.staging-user-relay-probe-result/1',
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
    verifier: Object.freeze({
      service_name: VERIFIER_SERVICE_NAME,
      service_uri: VERIFIER_SERVICE_URI,
      revision: deployment.verifier.revision,
      identity: VERIFIER_ACCOUNT,
      image: WORKLOAD_IMAGE,
      source_sha256: VERIFIER_SOURCE_SHA256,
      ingress: 'internal-only',
      public_invokers: 0,
      service_level_invoker_bindings: 1,
      workflow_only: false,
      inherited_invocation: deployment.iam.verifier_inherited_invokers,
      user_managed_keys: 0,
    }),
    execution: Object.freeze({
      state: 'SUCCEEDED',
      workflow_revision: execution.workflow_revision,
      duration_milliseconds: execution.duration_milliseconds,
      count_before: 0,
      count_after: 1,
    }),
    request: execution.result.route,
    responses: execution.result.responses,
    firebase_auth: Object.freeze({
      ...execution.result.firebase_auth,
      workflow_absence_verified: true,
      independent_absence_verified: true,
    }),
    app_check: Object.freeze({
      firebase_app_id: FIREBASE_APP_ID,
      ...execution.result.app_check,
      browser_provider_attestation_validated: false,
    }),
    firestore: Object.freeze({
      ...execution.result.firestore,
      independent_absence_verified: true,
    }),
    metadata: execution.result.metadata,
    tokens: execution.result.tokens,
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
    'The bounded audience-bound user-relay staging probe succeeded.',
    `Private sanitized result: ${resultPath}`,
    'Responses: invalid Firebase 401; missing App Check 401; missing Home 404; exchanges 200 then 200.',
    'Two Ed25519 tokens were verified; the synthetic user and private Home were independently absent.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'User-relay probe invocation failed');
    process.exitCode = 1;
  });
}

export function invocationAuthorization(repositoryCommit, workflowRevision) {
  return authProbeInvokeAuthorization(workflowRevision, repositoryCommit);
}
