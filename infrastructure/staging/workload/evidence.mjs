import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const RESULT_SHA256 = 'bab093e5f070039c3e8f482f83bb00927406ca9284c639ca62bc69c4ae997713';
const MAXIMUM_RESULT_BYTES = 8 * 1024;

function reject(message) {
  throw new Error(`Staging workload evidence ${message}`);
}

function expectedResult() {
  const projectId = 'miakapp-v4-staging';
  const projectNumber = '1072737219170';
  const region = 'europe-west9';
  const sourceSha256 = 'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8';
  const buildSourceBucket = `gcf-v2-sources-${projectNumber}-${region}`;
  return {
    schema: 'miakapp.staging-workload-result/1',
    project_id: projectId,
    project_number: projectNumber,
    region,
    observed_at: '2026-09-05T12:53:00.364Z',
    repository_commit: '6a9db97deb59b6c8e919d451c922ddb246eb54b2',
    source_archive_sha256: sourceSha256,
    source_generation: '1788612724252705',
    function: {
      name: `projects/${projectId}/locations/${region}/functions/control-plane`,
      state: 'ACTIVE',
      generation: 2,
      service: `projects/${projectId}/locations/${region}/services/control-plane`,
      revision: 'control-plane-00008-saz',
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
    runtime_config_sha256: '40e2f83fbe8e3d27b7e53c4a666f424519fc6972ef19a7598ab9e093be0c70f7',
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
        'The current internal-only Gen 2 Function deployment is active, schema-2, two-key/version-2-current and source-verified; its deployment inventory made no request.',
      ].join(' '));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging workload evidence is invalid');
      process.exitCode = 1;
    }
  }
}
