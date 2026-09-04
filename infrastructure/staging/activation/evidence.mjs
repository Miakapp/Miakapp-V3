import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const PROJECT_ID = 'miakapp-v4-staging';
const PROJECT_NUMBER = '1072737219170';
const RESULT_SHA256 = '290c7cedb500d9f6844b49a45737ed920b3fe2e6ada6ed95b754a795768ccbdf';
const RUNTIME_SHA256 = 'b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8';
const MAXIMUM_EVIDENCE_BYTES = 16 * 1024;
const SECRET_BINDINGS = Object.freeze([
  Object.freeze({ purpose: 'homeKeyPepper', secretId: 'miakapp-home-key-pepper' }),
  Object.freeze({ purpose: 'componentHmac', secretId: 'miakapp-component-hmac' }),
  Object.freeze({ purpose: 'pushHmac', secretId: 'miakapp-push-hmac' }),
  Object.freeze({ purpose: 'auditHmac', secretId: 'miakapp-audit-hmac' }),
  Object.freeze({ purpose: 'networkHmac', secretId: 'miakapp-network-hmac' }),
]);

function reject(message) {
  throw new Error(`Staging activation evidence ${message}`);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readExactJson(path, expectedDigest, serialization) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_EVIDENCE_BYTES) {
    reject('must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (digest(bytes) !== expectedDigest) reject('digest does not match the live result');
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    reject('is not valid JSON');
  }
  if (!Buffer.from(serialization(value), 'utf8').equals(bytes)) {
    reject('is not in its exact canonical JSON form');
  }
  return value;
}

function expectedResult() {
  return {
    schema: 'miakapp.staging-activation-result/1',
    operation: 'materialize-initial-runtime-inputs',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: 'europe-west9',
    repository_commit: '101e4231d452423bafa2ae1efd051e51faeff3c8',
    plan_sha256: 'f3c29e250cca705a76d3337ec2e1fe7aac40ee9d244e9b9b09cbe083778ad87e',
    completed_at: '2026-09-03T22:04:21.219Z',
    firebase_app: {
      appId: '1:1072737219170:web:5053ca93bf25d7373cd73b',
      displayName: 'Miakapp V4 Staging Web',
      platform: 'WEB',
      state: 'ACTIVE',
    },
    secret_versions: SECRET_BINDINGS.map(({ purpose, secretId }) => ({
      purpose,
      secret_id: secretId,
      resource_name: `projects/${PROJECT_ID}/secrets/${secretId}/versions/1`,
      state: 'ENABLED',
      payload_bytes: 32,
    })),
    runtime_config_sha256: RUNTIME_SHA256,
    workload_delta: {
      app_engine_applications: 0,
      cloud_functions: 0,
      cloud_run_services: 0,
      public_ingress: 0,
      minimum_instances: 0,
    },
  };
}

function expectedRuntime() {
  return {
    schema: 'miakapp.production-runtime/1',
    security: {
      schema: 'miakapp.production-security/1',
      environment: 'staging',
      project_id: PROJECT_ID,
      region: 'europe-west9',
      issuer: 'https://control.staging.miakapp.com',
      signing: {
        key_version_name: `projects/${PROJECT_ID}/locations/europe-west9/keyRings/${PROJECT_ID}/cryptoKeys/access-token-signing/cryptoKeyVersions/1`,
        public_jwk: {
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'eINmaVIFYgARhSMf1pBb9yRstrT_6LfO5d12WFL5Dsw',
          use: 'sig',
          alg: 'EdDSA',
          kid: 'staging-access-token-v1',
        },
        rpc_timeout_ms: 2_000,
      },
      secret_manager: {
        rpc_timeout_ms: 1_500,
        keyrings: Object.fromEntries(SECRET_BINDINGS.map(({ purpose, secretId }) => [
          purpose,
          {
            current_version: 'v1',
            versions: [{
              logical_version: 'v1',
              resource_name: `projects/${PROJECT_ID}/secrets/${secretId}/versions/1`,
            }],
          },
        ])),
      },
    },
    allowed_origins: ['https://app.staging.miakapp.com'],
    app_check_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
    component_bucket: 'miakapp-v4-staging-components',
  };
}

export function validateActivationEvidence(resultPath, runtimePath) {
  const result = readExactJson(
    resultPath,
    RESULT_SHA256,
    (value) => `${JSON.stringify(value, null, 2)}\n`,
  );
  if (!isDeepStrictEqual(result, expectedResult())) reject('result fields have drifted');
  const runtime = readExactJson(
    runtimePath,
    RUNTIME_SHA256,
    (value) => `${JSON.stringify(value)}\n`,
  );
  if (!isDeepStrictEqual(runtime, expectedRuntime())) reject('runtime document fields have drifted');
  if (result.runtime_config_sha256 !== digest(readFileSync(runtimePath))) {
    reject('result and runtime document digests disagree');
  }
  return Object.freeze({ result, runtime });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) {
    console.error('Usage: node evidence.mjs <result.json> <runtime-config.json>');
    process.exitCode = 2;
  } else {
    try {
      const validated = validateActivationEvidence(process.argv[2], process.argv[3]);
      console.log([
        `Validated ${validated.result.schema} for ${PROJECT_ID}.`,
        'One Firebase Web app and five enabled version-1 references were materialized; workloads were absent in the activation-time inventory.',
      ].join(' '));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging activation evidence is invalid');
      process.exitCode = 1;
    }
  }
}
