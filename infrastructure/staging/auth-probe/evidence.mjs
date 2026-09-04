import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const RESULT_SHA256 = '87af1de1f94bd4f1d070fef430f6e61ee70f7b988ec81fcfb0fb2805a3edc95f';
const RETIREMENT_SHA256 = '595c994647f181b7f2b7a98e403c9d039b32cde6e57acd9df904d40b568e5b54';
const MAXIMUM_EVIDENCE_BYTES = 16 * 1024;
const UUID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu;
const TRACE_CONTEXT = /\b[0-9a-f]{32}(?:\/[0-9a-f]+)?(?:;o=[01])?\b/iu;
const CREDENTIAL = /(?:AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|eyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+)/u;
const FORBIDDEN_FIELDS = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'diagnostic',
  'errorcontext',
  'executionid',
  'executionname',
  'headers',
  'idtoken',
  'refreshtoken',
  'secret',
  'secretvalue',
  'stack',
  'stacktrace',
  'trace',
  'tracecontext',
  'traceid',
]);

function reject(message) {
  throw new Error(`Staging Auth/App Check evidence ${message}`);
}

function expectedResult() {
  const projectId = 'miakapp-v4-staging';
  const projectNumber = '1072737219170';
  const region = 'europe-west9';
  const workflowRevision = '000001-bb4';
  const functionRevision = 'control-plane-00003-hum';
  return {
    schema: 'miakapp.staging-auth-app-check-probe-result/1',
    project_id: projectId,
    project_number: projectNumber,
    region,
    observed_at: '2026-09-04T11:33:48.986Z',
    repository_commit: '753601acc160c2214511c3207b9f0c47d3d7e03e',
    workflow: {
      name: `projects/${projectId}/locations/${region}/workflows/miakapp-auth-app-check-probe`,
      revision: workflowRevision,
      service_account: `miakapp-staging-probe@${projectId}.iam.gserviceaccount.com`,
      source_sha256: '525b97d18a2848c1d852b9d117cb20cf464bbc1d7baa85b2d44d457487cd922c',
      call_log_level: 'LOG_NONE',
      execution_history_level: 'EXECUTION_HISTORY_BASIC',
      scheduled_triggers: 0,
    },
    execution: {
      state: 'SUCCEEDED',
      workflow_revision: workflowRevision,
      duration_milliseconds: 7_821,
      count_before: 0,
      count_after: 1,
    },
    request: {
      method: 'GET',
      path: '/v1/push-destinations',
      product_requests: 3,
      successful_reads: 2,
      expected_application_writes: 0,
      retries: 0,
      cloud_run_authentication_header: 'X-Serverless-Authorization',
    },
    responses: {
      first_authenticated_read: {
        destination_count: 0,
        schema: 'miakapp.push-destination-list/1',
        status: 200,
      },
      missing_app_check: {
        code: 'invalid_app_check_token',
        status: 401,
      },
      replay_authenticated_read: {
        destination_count: 0,
        schema: 'miakapp.push-destination-list/1',
        status: 200,
      },
    },
    firebase_auth: {
      token_source: 'execution-scoped-custom-token',
      synthetic_user_created: true,
      synthetic_user_deleted: true,
      workflow_absence_verified: true,
      independent_absence_verified: true,
    },
    app_check: {
      firebase_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
      token_source: 'admin-custom-provider',
      token_consumption: false,
      first_use_accepted: true,
      replay_accepted: true,
      browser_provider_attestation_validated: false,
    },
    workload: {
      deployment_commit: '60322c69c92b8ccf5f3d1bc87ba264a00e5dca05',
      source_sha256: '86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358',
      function_revision: functionRevision,
      expected_function_revision: functionRevision,
      function_uri: 'https://control-plane-aczhngqraq-od.a.run.app',
      ingress: 'ALLOW_INTERNAL_ONLY',
      unauthenticated_invokers: 0,
      probe_user_managed_keys: 0,
    },
  };
}

function expectedRetirement() {
  const projectId = 'miakapp-v4-staging';
  return {
    schema: 'miakapp.staging-auth-probe-retirement/1',
    project_id: projectId,
    project_number: '1072737219170',
    region: 'europe-west9',
    custom_role: {
      name: `projects/${projectId}/roles/miakapp.stagingAuthProbe`,
      stage: 'GA',
      deleted: false,
      permissions: [
        'firebase.clients.get',
        'firebaseappcheck.tokens.mint',
        'firebaseauth.users.get',
        'serviceusage.services.use',
      ],
    },
    iam: {
      project_role_assigned_to_probe: false,
      self_signer_assigned_to_probe: false,
    },
    workflow_present: false,
    temporary_bindings_present: false,
    recurring_compute: false,
  };
}

function rejectPrivateMaterial(value, path = 'evidence') {
  if (typeof value === 'string') {
    if (UUID.test(value) || TRACE_CONTEXT.test(value) || CREDENTIAL.test(value)) {
      reject(`${path} contains a private execution, trace or credential value`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key.replace(/[_-]/gu, '').toLowerCase())) {
        reject(`${path}.${key} is a private telemetry or credential field`);
      }
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function readExactJson(path, expectedDigest) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_EVIDENCE_BYTES) {
    reject('must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest) {
    reject('digest does not match the live result');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('is not in exact canonical JSON form');
  }
  return value;
}

export function validateAuthProbeEvidenceValues(result, retirement) {
  rejectPrivateMaterial(result, 'result');
  rejectPrivateMaterial(retirement, 'retirement');
  if (!isDeepStrictEqual(result, expectedResult())) reject('result fields have drifted');
  if (!isDeepStrictEqual(retirement, expectedRetirement())) reject('retirement fields have drifted');
  if (result.project_id !== retirement.project_id
    || result.project_number !== retirement.project_number
    || result.region !== retirement.region) {
    reject('result and retirement target different environments');
  }
  return Object.freeze({ result, retirement });
}

export function validateAuthProbeEvidence(resultPath, retirementPath) {
  return validateAuthProbeEvidenceValues(
    readExactJson(resultPath, RESULT_SHA256),
    readExactJson(retirementPath, RETIREMENT_SHA256),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) {
    console.error('Usage: node evidence.mjs <result.json> <retirement.json>');
    process.exitCode = 2;
  } else {
    try {
      const { result } = validateAuthProbeEvidence(process.argv[2], process.argv[3]);
      console.log([
        `Validated ${result.schema} for ${result.project_id}.`,
        'One bounded execution proved Firebase Auth and App Check enforcement; the synthetic user and every temporary capability were removed.',
      ].join(' '));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging Auth/App Check evidence is invalid');
      process.exitCode = 1;
    }
  }
}
