import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  DEPLOYED_REPOSITORY_COMMIT,
  KEY_ID,
  KEY_NAME,
  KEY_RING,
  PROJECT_ID,
  REGION,
  RUNTIME_CONFIG_SHA256,
  VERSION_1_NAME,
  VERSION_2_NAME,
  canonicalJson,
  childEnvironment,
  sha256,
} from './contract.mjs';
import { repositoryRoot, run, runJson } from './cli.mjs';

const FUNCTION_NAME = 'control-plane';
const VERSION_1_KID = 'staging-access-token-v1';
const VERSION_2_KID = 'staging-access-token-v2';
const VERSION_1_X = 'eINmaVIFYgARhSMf1pBb9yRstrT_6LfO5d12WFL5Dsw';
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const EXPECTED_KEY_LABELS = Object.freeze({
  environment: 'staging',
  'goog-terraform-provisioned': 'true',
  'managed-by': 'terraform',
  product: 'miakapp-v4',
});

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function timestamp(value, description) {
  if (typeof value !== 'string' || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) {
    reject(`${description} is not a canonical Cloud timestamp`);
  }
  return value;
}

export function publicKeyToJwk(pem, kid) {
  if (typeof pem !== 'string' || !/^staging-access-token-v[12]$/u.test(kid)) {
    reject('Signing public-key conversion inputs are invalid');
  }
  let exported;
  try {
    exported = createPublicKey(pem).export({ format: 'jwk' });
  } catch {
    return reject('Signing public key is not a valid asymmetric PEM');
  }
  if (!plainObject(exported)
    || exported.kty !== 'OKP'
    || exported.crv !== 'Ed25519'
    || typeof exported.x !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/u.test(exported.x)
    || Object.keys(exported).some((field) => !['crv', 'kty', 'x'].includes(field))) {
    reject('Signing public key is not an Ed25519 public key');
  }
  return Object.freeze({
    kty: 'OKP',
    crv: 'Ed25519',
    x: exported.x,
    use: 'sig',
    alg: 'EdDSA',
    kid,
  });
}

export function normalizeSigningKey(value) {
  if (!plainObject(value)
    || value.name !== KEY_NAME
    || value.purpose !== 'ASYMMETRIC_SIGN'
    || value.destroyScheduledDuration !== '2592000s'
    || !isDeepStrictEqual(value.versionTemplate, {
      algorithm: 'EC_SIGN_ED25519',
      protectionLevel: 'SOFTWARE',
    })
    || value.rotationPeriod !== undefined
    || value.nextRotationTime !== undefined
    || !isDeepStrictEqual(value.labels, EXPECTED_KEY_LABELS)) {
    reject('Signing KMS key does not match the reviewed staging key');
  }
  return Object.freeze({
    name: value.name,
    purpose: value.purpose,
    algorithm: value.versionTemplate.algorithm,
    protection_level: value.versionTemplate.protectionLevel,
    destroy_scheduled_duration: value.destroyScheduledDuration,
    automatic_rotation: false,
    labels: Object.freeze({ ...value.labels }),
    create_time: timestamp(value.createTime, 'Signing KMS key creation time'),
  });
}

export function normalizeSigningVersion(value, pem) {
  if (!plainObject(value)
    || ![VERSION_1_NAME, VERSION_2_NAME].includes(value.name)
    || value.state !== 'ENABLED'
    || value.algorithm !== 'EC_SIGN_ED25519'
    || value.protectionLevel !== 'SOFTWARE'
    || value.destroyTime !== undefined
    || value.destroyEventTime !== undefined
    || value.importJob !== undefined
    || value.importFailureReason !== undefined) {
    reject('Signing KMS version does not match the reviewed enabled software profile');
  }
  const version = value.name === VERSION_1_NAME ? 1 : 2;
  return Object.freeze({
    name: value.name,
    version,
    state: value.state,
    algorithm: value.algorithm,
    protection_level: value.protectionLevel,
    create_time: timestamp(value.createTime, `Signing KMS version ${version} creation time`),
    generate_time: timestamp(value.generateTime, `Signing KMS version ${version} generation time`),
    public_jwk: publicKeyToJwk(pem, version === 1 ? VERSION_1_KID : VERSION_2_KID),
  });
}

function normalizeRuntime(value, runPolicy) {
  if (!plainObject(value)
    || value.name !== `projects/${PROJECT_ID}/locations/${REGION}/functions/${FUNCTION_NAME}`
    || value.state !== 'ACTIVE'
    || !plainObject(value.serviceConfig)
    || value.serviceConfig.ingressSettings !== 'ALLOW_INTERNAL_ONLY'
    || typeof value.serviceConfig.revision !== 'string'
    || !/^control-plane-\d{5}-[a-z]{3}$/u.test(value.serviceConfig.revision)
    || typeof value.serviceConfig.uri !== 'string'
    || !value.serviceConfig.uri.startsWith('https://')) {
    reject('Control-plane inventory is not the reviewed private active function');
  }
  const bindings = Array.isArray(runPolicy?.bindings) ? runPolicy.bindings : [];
  if (bindings.some((binding) => Array.isArray(binding.members)
    && binding.members.some((member) => ['allUsers', 'allAuthenticatedUsers'].includes(member)))) {
    reject('Control plane has an unauthenticated invoker');
  }
  const environment = value.serviceConfig.environmentVariables;
  if (!plainObject(environment)
    || !isDeepStrictEqual(Object.keys(environment).sort(), [
      'LOG_EXECUTION_ID',
      'MIAKAPP_DEPLOYMENT_COMMIT',
      'MIAKAPP_RUNTIME_CONFIG_JSON',
      'MIAKAPP_SOURCE_ARCHIVE_SHA256',
    ])) {
    reject('Control-plane environment inventory has drifted');
  }
  const runtimeBytes = Buffer.from(environment.MIAKAPP_RUNTIME_CONFIG_JSON ?? '', 'utf8');
  if (sha256(runtimeBytes) !== RUNTIME_CONFIG_SHA256) {
    reject('Live control-plane runtime document differs from the reviewed digest');
  }
  const committedRuntime = readFileSync(
    new URL('../workload/runtime-config.json', import.meta.url),
  );
  if (!runtimeBytes.equals(committedRuntime)) {
    reject('Live and committed control-plane runtime documents differ');
  }
  let runtime;
  try {
    runtime = JSON.parse(runtimeBytes.toString('utf8'));
  } catch {
    return reject('Live control-plane runtime document is invalid JSON');
  }
  const signing = runtime?.security?.signing;
  if (runtime.schema !== 'miakapp.production-runtime/2'
    || runtime.security?.schema !== 'miakapp.production-security/2'
    || signing?.current_kid !== VERSION_1_KID
    || !Array.isArray(signing.versions)
    || signing.versions.length !== 1
    || signing.versions[0]?.key_version_name !== VERSION_1_NAME
    || !isDeepStrictEqual(signing.versions[0]?.public_jwk, {
      kty: 'OKP',
      crv: 'Ed25519',
      x: VERSION_1_X,
      use: 'sig',
      alg: 'EdDSA',
      kid: VERSION_1_KID,
    })) {
    reject('Live control-plane signing runtime is not the reviewed single-key schema 2 baseline');
  }
  if (environment.MIAKAPP_DEPLOYMENT_COMMIT !== DEPLOYED_REPOSITORY_COMMIT
    || !/^[0-9a-f]{64}$/u.test(environment.MIAKAPP_SOURCE_ARCHIVE_SHA256 ?? '')) {
    reject('Control-plane deployment pins have drifted');
  }
  return Object.freeze({
    name: value.name,
    state: value.state,
    revision: value.serviceConfig.revision,
    update_time: timestamp(value.updateTime, 'Control-plane update time'),
    uri: value.serviceConfig.uri,
    ingress: value.serviceConfig.ingressSettings,
    unauthenticated_invokers: 0,
    deployed_repository_commit: environment.MIAKAPP_DEPLOYMENT_COMMIT,
    source_archive_sha256: environment.MIAKAPP_SOURCE_ARCHIVE_SHA256,
    runtime_config_sha256: RUNTIME_CONFIG_SHA256,
    runtime_schema: runtime.schema,
    security_schema: runtime.security.schema,
    current_kid: signing.current_kid,
    published_signing_keys: signing.versions.length,
    published_jwks: Object.freeze(signing.versions.map(({ public_jwk: jwk }) => Object.freeze({ ...jwk }))),
  });
}

export function validateKeyCreationBaseline(value) {
  if (!plainObject(value)
    || value.schema !== 'miakapp.staging-signing-overlap-inventory/1'
    || value.project_id !== PROJECT_ID
    || !plainObject(value.kms_key)
    || value.kms_key.name !== KEY_NAME
    || !Array.isArray(value.versions)
    || value.versions.length !== 1
    || value.versions[0]?.name !== VERSION_1_NAME
    || value.versions[0]?.public_jwk?.x !== VERSION_1_X
    || value.control_plane?.runtime_config_sha256 !== RUNTIME_CONFIG_SHA256
    || value.control_plane?.deployed_repository_commit !== DEPLOYED_REPOSITORY_COMMIT
    || value.control_plane?.current_kid !== VERSION_1_KID
    || value.control_plane?.published_signing_keys !== 1
    || value.control_plane?.ingress !== 'ALLOW_INTERNAL_ONLY'
    || value.control_plane?.unauthenticated_invokers !== 0) {
    reject('Signing-overlap baseline is not the exact single-key private runtime');
  }
  return Object.freeze(value);
}

export function validateKeyCreationResult(value, baseline) {
  validateKeyCreationBaseline(baseline);
  if (!plainObject(value)
    || value.schema !== 'miakapp.staging-signing-overlap-inventory/1'
    || value.project_id !== PROJECT_ID
    || !isDeepStrictEqual(value.kms_key, baseline.kms_key)
    || !isDeepStrictEqual(value.control_plane, baseline.control_plane)
    || !Array.isArray(value.versions)
    || value.versions.length !== 2
    || !isDeepStrictEqual(value.versions[0], baseline.versions[0])
    || value.versions[1]?.name !== VERSION_2_NAME
    || value.versions[1]?.version !== 2
    || value.versions[1]?.state !== 'ENABLED'
    || value.versions[1]?.algorithm !== 'EC_SIGN_ED25519'
    || value.versions[1]?.protection_level !== 'SOFTWARE'
    || value.versions[1]?.public_jwk?.kid !== VERSION_2_KID
    || value.versions[1]?.public_jwk?.x === VERSION_1_X) {
    reject('Signing-overlap post-creation inventory is not exact version 2 convergence');
  }
  return Object.freeze(value);
}

export function inventorySha256(value) {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

export function observeSigningInventory(operatorEmail) {
  const common = [
    `--project=${PROJECT_ID}`,
    `--account=${operatorEmail}`,
    '--quiet',
  ];
  const key = runJson('gcloud', [
    'kms', 'keys', 'describe', KEY_ID,
    `--keyring=${KEY_RING}`,
    `--location=${REGION}`,
    ...common,
    '--format=json',
  ], { cwd: repositoryRoot, description: 'signing-kms-key-inventory' });
  const rawVersions = runJson('gcloud', [
    'kms', 'keys', 'versions', 'list',
    `--key=${KEY_ID}`,
    `--keyring=${KEY_RING}`,
    `--location=${REGION}`,
    ...common,
    '--sort-by=name',
    '--format=json',
  ], { cwd: repositoryRoot, description: 'signing-kms-version-inventory' });
  if (!Array.isArray(rawVersions) || rawVersions.length < 1 || rawVersions.length > 2) {
    reject('Signing KMS version inventory is outside the reviewed one-or-two boundary');
  }
  const versions = rawVersions.map((version) => {
    const number = version.name?.split('/').at(-1);
    if (!['1', '2'].includes(number)) reject('Signing KMS version ID is outside the reviewed boundary');
    const pem = Buffer.from(run('gcloud', [
      'kms', 'keys', 'versions', 'get-public-key', number,
      `--key=${KEY_ID}`,
      `--keyring=${KEY_RING}`,
      `--location=${REGION}`,
      ...common,
    ], {
      cwd: repositoryRoot,
      env: childEnvironment(),
      description: `signing-kms-version-${number}-public-key`,
    }).stdout).toString('utf8');
    return normalizeSigningVersion(version, pem);
  });
  versions.sort((left, right) => left.version - right.version);
  const controlPlane = runJson('gcloud', [
    'functions', 'describe', FUNCTION_NAME,
    '--gen2',
    `--region=${REGION}`,
    ...common,
    '--format=json',
  ], { cwd: repositoryRoot, description: 'signing-control-plane-inventory' });
  const runPolicy = runJson('gcloud', [
    'run', 'services', 'get-iam-policy', FUNCTION_NAME,
    `--region=${REGION}`,
    ...common,
    '--format=json',
  ], { cwd: repositoryRoot, description: 'signing-control-plane-iam-inventory' });
  return Object.freeze({
    schema: 'miakapp.staging-signing-overlap-inventory/1',
    project_id: PROJECT_ID,
    kms_key: normalizeSigningKey(key),
    versions: Object.freeze(versions),
    control_plane: normalizeRuntime(controlPlane, runPolicy),
  });
}
