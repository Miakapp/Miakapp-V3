import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const RESULT_SHA256 = 'ea3245756727eaf071f2edc6ef55ba1b730c5e3f61e38746fb7cbf36e8f4ef05';
const MAXIMUM_RESULT_BYTES = 8 * 1024;
const UUID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu;
const TRACE_CONTEXT = /\b[0-9a-f]{32}(?:\/[0-9a-f]+)?(?:;o=[01])?\b/iu;
const FORBIDDEN_FIELDS = new Set([
  'accesstoken',
  'apikey',
  'argument',
  'arguments',
  'authorization',
  'bearertoken',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'diagnostic',
  'diagnostics',
  'exception',
  'executionid',
  'headers',
  'httpheaders',
  'idtoken',
  'insertid',
  'password',
  'refreshtoken',
  'remoteip',
  'requestheaders',
  'responseheaders',
  'secret',
  'secretvalue',
  'setcookie',
  'span',
  'spanid',
  'stack',
  'stacktrace',
  'token',
  'tokens',
  'trace',
  'tracecontext',
  'traceid',
  'useragent',
  'xcloudtracecontext',
]);

function reject(message) {
  throw new Error(`Staging private-probe evidence ${message}`);
}

function expectedResult() {
  const projectId = 'miakapp-v4-staging';
  const region = 'europe-west9';
  const functionUri = 'https://control-plane-aczhngqraq-od.a.run.app';
  const workflowRevision = '000001-7fb';
  const discovery = {
    schema: 'miakapp.control-plane-discovery/1',
    issuer: 'https://control.staging.miakapp.com',
    jwks_uri: 'https://control.staging.miakapp.com/.well-known/jwks.json',
    exchange_endpoint: 'https://control.staging.miakapp.com/v1/access-tokens:exchange',
    push_audience: 'https://control.staging.miakapp.com/v1/push',
    components_audience: 'https://control.staging.miakapp.com/v1/components',
  };
  return {
    schema: 'miakapp.staging-private-probe-recovery-result/2',
    project_id: projectId,
    project_number: '1072737219170',
    region,
    observed_at: '2026-09-04T02:35:49.645Z',
    repository_commit: '58b6d8a7427f905b54f26dcb23aae514dac1a1a6',
    workflow: {
      name: `projects/${projectId}/locations/${region}/workflows/miakapp-private-probe`,
      revision: workflowRevision,
      service_account: `miakapp-staging-probe@${projectId}.iam.gserviceaccount.com`,
      source_sha256: '361519966cc628d5b6ec03afd99b1e3ed7f03e05bf941e2cd34bb4aba547dd9f',
      call_log_level: 'LOG_NONE',
      execution_history_level: 'EXECUTION_HISTORY_BASIC',
      scheduled_triggers: 0,
    },
    request: {
      method: 'GET',
      uri: `${functionUri}/.well-known/miakapp-control-plane`,
      authentication: 'OIDC',
      audience: functionUri,
      timeout_seconds: 30,
      workflow_retries: 0,
      attempts_after_latest_correction: 1,
      input: false,
    },
    prior_executions: [
      {
        phase: 'after-secret-name-compatibility-update',
        state: 'FAILED',
        workflow_revision: workflowRevision,
        duration_milliseconds: 343,
        response: { status: 503, error: 'service_unavailable' },
      },
      {
        phase: 'initial-runtime',
        state: 'FAILED',
        workflow_revision: workflowRevision,
        duration_milliseconds: 2_089,
        response: { status: 503, error: 'service_unavailable' },
      },
    ],
    recovery_execution: {
      state: 'SUCCEEDED',
      workflow_revision: workflowRevision,
      duration_milliseconds: 956,
      count_before: 2,
      count_after: 3,
    },
    response: {
      status: 200,
      content_type: 'application/json; charset=utf-8',
      cache_control: 'public, max-age=300, must-revalidate',
      body: discovery,
    },
    workload: {
      deployment_commit: '60322c69c92b8ccf5f3d1bc87ba264a00e5dca05',
      source_sha256: '86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358',
      function_revision: 'control-plane-00003-hum',
      function_uri: functionUri,
      ingress: 'ALLOW_INTERNAL_ONLY',
      unauthenticated_invokers: 0,
      probe_user_managed_keys: 0,
    },
    claims: {
      private_ingress_reached: true,
      secure_runtime_served_discovery: true,
      firebase_auth_validated: false,
      app_check_validated: false,
      application_mutation_expected: false,
    },
  };
}

function rejectPrivateTelemetry(value, path = 'result') {
  if (typeof value === 'string') {
    if (UUID.test(value) || TRACE_CONTEXT.test(value) || /x-cloud-trace-context/iu.test(value)) {
      reject(`${path} contains a private execution or trace correlator`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateTelemetry(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.replace(/[_-]/gu, '').toLowerCase();
      if (FORBIDDEN_FIELDS.has(normalizedKey)) {
        reject(`${path}.${key} is a private telemetry or credential field`);
      }
      rejectPrivateTelemetry(entry, `${path}.${key}`);
    }
  }
}

export function validateProbeEvidenceValue(value) {
  rejectPrivateTelemetry(value);
  if (!isDeepStrictEqual(value, expectedResult())) reject('fields have drifted');
  return Object.freeze(value);
}

export function validateProbeEvidence(path) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_RESULT_BYTES) {
    reject('must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== RESULT_SHA256) {
    reject('digest does not match the live recovery result');
  }
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('is not valid JSON');
  }
  if (`${JSON.stringify(result, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('is not in exact canonical JSON form');
  }
  return validateProbeEvidenceValue(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: node evidence.mjs <result.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = validateProbeEvidence(process.argv[2]);
      console.log([
        `Validated ${result.schema} for ${result.project_id}.`,
        'The single corrected recovery request reached private ingress and served the exact discovery document without committing execution or trace identifiers to the public artifact.',
      ].join(' '));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging private-probe evidence is invalid');
      process.exitCode = 1;
    }
  }
}
