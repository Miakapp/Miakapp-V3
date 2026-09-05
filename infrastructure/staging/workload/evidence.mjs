import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const RESULT_SHA256 = '7aa7f4ec4b5d5bcd2b272f472361975c84dbc974dfdf24f154290d20c95b7266';
const MAXIMUM_RESULT_BYTES = 8 * 1024;

function reject(message) {
  throw new Error(`Staging workload evidence ${message}`);
}

function expectedResult() {
  const projectId = 'miakapp-v4-staging';
  const projectNumber = '1072737219170';
  const region = 'europe-west9';
  const sourceSha256 = '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e';
  const buildSourceBucket = `gcf-v2-sources-${projectNumber}-${region}`;
  return {
    schema: 'miakapp.staging-workload-result/1',
    project_id: projectId,
    project_number: projectNumber,
    region,
    observed_at: '2026-09-05T19:49:07.829Z',
    repository_commit: 'ba4fc9caed566fa39fc66371192fb1821b4232ff',
    source_archive_sha256: sourceSha256,
    source_generation: '1788637681094791',
    function: {
      name: `projects/${projectId}/locations/${region}/functions/control-plane`,
      state: 'ACTIVE',
      generation: 2,
      service: `projects/${projectId}/locations/${region}/services/control-plane`,
      revision: 'control-plane-00010-vop',
      uri: 'https://control-plane-aczhngqraq-od.a.run.app',
      ingress: 'ALLOW_INTERNAL_ONLY',
      unauthenticated_invokers: 0,
      minimum_instances: 0,
      maximum_instances: 1,
      concurrency: 16,
      timeout_seconds: 30,
      available_memory: '256M',
      available_cpu: '1',
    },
    identities: {
      runtime: `miakapp-control-plane@${projectId}.iam.gserviceaccount.com`,
      build: `miakapp-control-build@${projectId}.iam.gserviceaccount.com`,
      probe: `miakapp-staging-probe@${projectId}.iam.gserviceaccount.com`,
      user_managed_keys: {
        runtime: 0,
        build: 0,
        probe: 0,
      },
      operator_user_sha256: 'd1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c',
    },
    iam: {
      probe_invoker_role: 'roles/run.invoker',
      probe_token_role: 'roles/iam.serviceAccountOpenIdTokenCreator',
      fcm_role: `projects/${projectId}/roles/miakapp.controlPlaneFcmSender`,
      fcm_permissions: ['cloudmessaging.messages.create'],
      build_source_role: 'roles/storage.objectViewer',
      build_source_bucket: buildSourceBucket,
    },
    artifacts: {
      source_bucket: `${projectId}-function-source-${projectNumber}`,
      source_object: `sources/${sourceSha256}.zip`,
      copied_source_bucket: buildSourceBucket,
      copied_source_object: 'control-plane/function-source.zip',
      repository: `projects/${projectId}/locations/${region}/repositories/miakapp-control-plane`,
    },
    runtime_config_sha256: 'c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37',
    live_request_performed: false,
  };
}

export function validateWorkloadEvidence(path) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_RESULT_BYTES) {
    reject('must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== RESULT_SHA256) {
    reject('digest does not match the live inventory');
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
  if (!isDeepStrictEqual(result, expectedResult())) reject('fields have drifted');
  return Object.freeze(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: node evidence.mjs <result.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = validateWorkloadEvidence(process.argv[2]);
      console.log([
        `Validated ${result.schema} for ${result.project_id}.`,
        'The current internal-only Gen 2 Function deployment is active, schema-2, two-key/version-1-current, browser-relay edge-profile capable and source-verified; its deployment inventory made no request.',
      ].join(' '));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging workload evidence is invalid');
      process.exitCode = 1;
    }
  }
}
