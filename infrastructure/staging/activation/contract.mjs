import {
  createHash,
  createHmac,
  createPublicKey,
  timingSafeEqual,
} from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const PROJECT_DISPLAY_NAME = 'Miakapp V4 Staging';
export const REGION = 'europe-west9';
export const FIREBASE_APP_DISPLAY_NAME = 'Miakapp V4 Staging Web';
export const FIREBASE_APP_ID = /^1:1072737219170:web:[A-Za-z0-9]{16,64}$/;
export const KMS_VERSION_NAME = `projects/${PROJECT_ID}/locations/${REGION}/keyRings/${PROJECT_ID}/cryptoKeys/access-token-signing/cryptoKeyVersions/1`;
export const PLAN_TTL_MILLISECONDS = 2 * 60 * 60 * 1_000;
export const SECRET_BINDINGS = Object.freeze([
  Object.freeze({ purpose: 'homeKeyPepper', secretId: 'miakapp-home-key-pepper' }),
  Object.freeze({ purpose: 'componentHmac', secretId: 'miakapp-component-hmac' }),
  Object.freeze({ purpose: 'pushHmac', secretId: 'miakapp-push-hmac' }),
  Object.freeze({ purpose: 'auditHmac', secretId: 'miakapp-audit-hmac' }),
  Object.freeze({ purpose: 'networkHmac', secretId: 'miakapp-network-hmac' }),
]);

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const APP_VERSION_NAME = /^projects\/(miakapp-v4-staging|1072737219170)\/secrets\/([a-z0-9-]+)\/versions\/([1-9][0-9]*)$/;
const GRAPHIC_ASCII = /^[\x21-\x7e]+$/;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const MAXIMUM_PRIVATE_JSON_BYTES = 1024 * 1024;

export class StagingActivationError extends Error {
  constructor(message = 'Staging activation contract is invalid') {
    super(message);
    this.name = 'StagingActivationError';
  }
}

function reject(message) {
  throw new StagingActivationError(message);
}

function isPlainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value, keys, path) {
  if (!isPlainObject(value)) reject(`${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} does not match the reviewed value`);
}

function canonicalTimestamp(value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    reject(`${path} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    reject(`${path} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

function exactProject(value) {
  if (!isPlainObject(value)
    || value.projectId !== PROJECT_ID
    || String(value.projectNumber) !== PROJECT_NUMBER
    || value.name !== PROJECT_DISPLAY_NAME
    || value.lifecycleState !== 'ACTIVE') {
    reject('Cloud observation is not the exact active staging project');
  }
}

function exactKmsVersion(value) {
  if (!isPlainObject(value)
    || value.name !== KMS_VERSION_NAME
    || value.state !== 'ENABLED'
    || value.algorithm !== 'EC_SIGN_ED25519'
    || value.protectionLevel !== 'SOFTWARE') {
    reject('Cloud observation is not the exact enabled staging signing key version');
  }
}

function canonicalPublicJwk(pem) {
  if (typeof pem !== 'string' || pem.length === 0 || Buffer.byteLength(pem, 'utf8') > 8_192) {
    reject('KMS public key response is invalid');
  }
  let jwk;
  try {
    jwk = createPublicKey(pem).export({ format: 'jwk' });
  } catch {
    reject('KMS public key response is invalid');
  }
  if (jwk.kty !== 'OKP'
    || jwk.crv !== 'Ed25519'
    || typeof jwk.x !== 'string'
    || !BASE64URL_32.test(jwk.x)
    || Buffer.from(jwk.x, 'base64url').byteLength !== 32
    || Buffer.from(jwk.x, 'base64url').toString('base64url') !== jwk.x
    || jwk.d !== undefined) {
    reject('KMS public key is not a canonical Ed25519 public key');
  }
  return Object.freeze({
    kty: 'OKP',
    crv: 'Ed25519',
    x: jwk.x,
    use: 'sig',
    alg: 'EdDSA',
    kid: 'staging-access-token-v1',
  });
}

function firebaseApps(value, mode) {
  if (!Array.isArray(value)) reject('Firebase app observation must be an array');
  if (value.length === 0) return Object.freeze([]);
  if (mode === 'baseline' || value.length !== 1) {
    reject('Firebase app inventory is outside the reviewed activation delta');
  }
  const app = value[0];
  if (!isPlainObject(app)
    || app.displayName !== FIREBASE_APP_DISPLAY_NAME
    || app.platform !== 'WEB'
    || app.state !== 'ACTIVE'
    || typeof app.appId !== 'string'
    || !FIREBASE_APP_ID.test(app.appId)) {
    reject('Firebase app inventory is outside the reviewed activation delta');
  }
  return Object.freeze([Object.freeze({
    appId: app.appId,
    displayName: app.displayName,
    platform: app.platform,
    state: app.state,
  })]);
}

function secretVersions(value, secretId, mode) {
  if (!Array.isArray(value)) reject(`${secretId} version observation must be an array`);
  if (value.length === 0) return Object.freeze([]);
  if (mode === 'baseline' || value.length !== 1) {
    reject(`${secretId} contains an unreviewed secret version`);
  }
  const version = value[0];
  if (!isPlainObject(version) || typeof version.name !== 'string' || version.state !== 'ENABLED') {
    reject(`${secretId} version observation is invalid`);
  }
  const match = APP_VERSION_NAME.exec(version.name);
  if (match?.[2] !== secretId) reject(`${secretId} version observation is foreign`);
  return Object.freeze([Object.freeze({
    version: Number(match[3]),
    resourceName: `projects/${PROJECT_ID}/secrets/${secretId}/versions/${match[3]}`,
    state: 'ENABLED',
  })]);
}

function emptyInventory(value, path) {
  if (!Array.isArray(value) || value.length !== 0) {
    reject(`${path} inventory must remain empty`);
  }
}

export function normalizeCloudObservation(value, mode = 'baseline') {
  if (!['baseline', 'partial', 'complete'].includes(mode)) reject('Observation mode is invalid');
  const observation = record(value, [
    'project',
    'firebaseApps',
    'secretVersions',
    'kmsVersion',
    'kmsPublicPem',
    'functions',
    'runServices',
    'appEngineApplication',
  ], 'Cloud observation');
  exactProject(observation.project);
  exactKmsVersion(observation.kmsVersion);
  const publicJwk = canonicalPublicJwk(observation.kmsPublicPem);
  emptyInventory(observation.functions, 'Cloud Functions');
  emptyInventory(observation.runServices, 'Cloud Run');
  exact(observation.appEngineApplication, false, 'App Engine application state');
  const apps = firebaseApps(observation.firebaseApps, mode);
  const rawVersions = record(
    observation.secretVersions,
    SECRET_BINDINGS.map(({ secretId }) => secretId),
    'Secret version observation',
  );
  const versions = Object.fromEntries(SECRET_BINDINGS.map(({ secretId }) => [
    secretId,
    secretVersions(rawVersions[secretId], secretId, mode),
  ]));
  if (mode === 'complete') {
    if (apps.length !== 1
      || SECRET_BINDINGS.some(({ secretId }) => versions[secretId].length !== 1)) {
      reject('Activation observation is incomplete');
    }
  }
  return Object.freeze({
    firebaseApps: apps,
    secretVersions: Object.freeze(versions),
    publicJwk,
  });
}

function validateToolVersions(value) {
  const versions = record(value, ['node', 'gcloud', 'firebase'], 'Tool versions');
  const nodeParts = typeof versions.node === 'string'
    ? /^(\d+)\.(\d+)\.(\d+)$/.exec(versions.node)
    : null;
  if (nodeParts === null
    || Number(nodeParts[1]) !== 22
    || Number(nodeParts[2]) < 12
    || typeof versions.gcloud !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(versions.gcloud)
    || versions.firebase !== '15.28.2') {
    reject('Activation toolchain does not match the reviewed profile');
  }
  return versions;
}

export function buildActivationPlan({
  repositoryCommit,
  createdAt,
  toolVersions,
  observation,
}) {
  if (typeof repositoryCommit !== 'string' || !COMMIT.test(repositoryCommit)) {
    reject('Activation plan requires a canonical repository commit');
  }
  const createdMilliseconds = canonicalTimestamp(createdAt, 'created_at');
  const normalized = normalizeCloudObservation(observation, 'baseline');
  validateToolVersions(toolVersions);
  return Object.freeze({
    schema: 'miakapp.staging-activation-plan/1',
    operation: 'materialize-initial-runtime-inputs',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(createdMilliseconds + PLAN_TTL_MILLISECONDS).toISOString(),
    tool_versions: Object.freeze({ ...toolVersions }),
    baseline: Object.freeze({
      firebase_apps: 0,
      secret_versions: Object.freeze(Object.fromEntries(
        SECRET_BINDINGS.map(({ secretId }) => [secretId, 0]),
      )),
      cloud_functions: 0,
      cloud_run_services: 0,
      app_engine_application: false,
      kms_key_version: KMS_VERSION_NAME,
      kms_public_jwk: normalized.publicJwk,
    }),
    actions: Object.freeze({
      firebase_web_app: Object.freeze({
        display_name: FIREBASE_APP_DISPLAY_NAME,
        count: 1,
      }),
      secret_versions: Object.freeze(SECRET_BINDINGS.map(({ purpose, secretId }) => Object.freeze({
        purpose,
        secret_id: secretId,
        versions_to_add: 1,
        payload_bytes: 32,
        final_state: 'ENABLED',
      }))),
    }),
    runtime_profile: Object.freeze({
      schema: 'miakapp.production-runtime/1',
      issuer: 'https://control.staging.miakapp.com',
      allowed_origins: Object.freeze(['https://app.staging.miakapp.com']),
      component_bucket: 'miakapp-v4-staging-components',
      signing_key_version: KMS_VERSION_NAME,
      signing_kid: 'staging-access-token-v1',
      signing_rpc_timeout_ms: 2_000,
      secret_rpc_timeout_ms: 1_500,
      secret_logical_version: 'v1',
    }),
    forbidden_delta: Object.freeze({
      app_engine_application: true,
      cloud_function: true,
      cloud_run_service: true,
      public_ingress: true,
      minimum_instance: true,
      secret_payload_in_plan: true,
    }),
  });
}

export function validateActivationPlan(value, {
  now = Date.now(),
  allowExpired = false,
} = {}) {
  const plan = record(value, [
    'schema',
    'operation',
    'project_id',
    'project_number',
    'region',
    'repository_commit',
    'created_at',
    'expires_at',
    'tool_versions',
    'baseline',
    'actions',
    'runtime_profile',
    'forbidden_delta',
  ], 'Activation plan');
  exact(plan.schema, 'miakapp.staging-activation-plan/1', 'schema');
  exact(plan.operation, 'materialize-initial-runtime-inputs', 'operation');
  exact(plan.project_id, PROJECT_ID, 'project_id');
  exact(String(plan.project_number), PROJECT_NUMBER, 'project_number');
  exact(plan.region, REGION, 'region');
  if (typeof plan.repository_commit !== 'string' || !COMMIT.test(plan.repository_commit)) {
    reject('repository_commit is invalid');
  }
  const created = canonicalTimestamp(plan.created_at, 'created_at');
  const expires = canonicalTimestamp(plan.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS
    || (!allowExpired && (now < created || now > expires))) {
    reject('Activation plan is outside its exact execution window');
  }
  validateToolVersions(plan.tool_versions);

  const baseline = record(plan.baseline, [
    'firebase_apps',
    'secret_versions',
    'cloud_functions',
    'cloud_run_services',
    'app_engine_application',
    'kms_key_version',
    'kms_public_jwk',
  ], 'baseline');
  exact(baseline.firebase_apps, 0, 'baseline.firebase_apps');
  exact(baseline.cloud_functions, 0, 'baseline.cloud_functions');
  exact(baseline.cloud_run_services, 0, 'baseline.cloud_run_services');
  exact(baseline.app_engine_application, false, 'baseline.app_engine_application');
  exact(baseline.kms_key_version, KMS_VERSION_NAME, 'baseline.kms_key_version');
  const secretBaseline = record(
    baseline.secret_versions,
    SECRET_BINDINGS.map(({ secretId }) => secretId),
    'baseline.secret_versions',
  );
  for (const { secretId } of SECRET_BINDINGS) exact(secretBaseline[secretId], 0, `baseline.secret_versions.${secretId}`);
  const jwk = record(baseline.kms_public_jwk, ['kty', 'crv', 'x', 'use', 'alg', 'kid'], 'baseline.kms_public_jwk');
  exact(jwk.kty, 'OKP', 'baseline.kms_public_jwk.kty');
  exact(jwk.crv, 'Ed25519', 'baseline.kms_public_jwk.crv');
  exact(jwk.use, 'sig', 'baseline.kms_public_jwk.use');
  exact(jwk.alg, 'EdDSA', 'baseline.kms_public_jwk.alg');
  exact(jwk.kid, 'staging-access-token-v1', 'baseline.kms_public_jwk.kid');
  if (typeof jwk.x !== 'string' || !BASE64URL_32.test(jwk.x)) reject('baseline KMS JWK is invalid');
  if (Buffer.from(jwk.x, 'base64url').byteLength !== 32
    || Buffer.from(jwk.x, 'base64url').toString('base64url') !== jwk.x) {
    reject('baseline KMS JWK is invalid');
  }

  const actions = record(plan.actions, ['firebase_web_app', 'secret_versions'], 'actions');
  exact(actions.firebase_web_app, {
    display_name: FIREBASE_APP_DISPLAY_NAME,
    count: 1,
  }, 'actions.firebase_web_app');
  exact(actions.secret_versions, SECRET_BINDINGS.map(({ purpose, secretId }) => ({
    purpose,
    secret_id: secretId,
    versions_to_add: 1,
    payload_bytes: 32,
    final_state: 'ENABLED',
  })), 'actions.secret_versions');
  exact(plan.runtime_profile, {
    schema: 'miakapp.production-runtime/1',
    issuer: 'https://control.staging.miakapp.com',
    allowed_origins: ['https://app.staging.miakapp.com'],
    component_bucket: 'miakapp-v4-staging-components',
    signing_key_version: KMS_VERSION_NAME,
    signing_kid: 'staging-access-token-v1',
    signing_rpc_timeout_ms: 2_000,
    secret_rpc_timeout_ms: 1_500,
    secret_logical_version: 'v1',
  }, 'runtime_profile');
  exact(plan.forbidden_delta, {
    app_engine_application: true,
    cloud_function: true,
    cloud_run_service: true,
    public_ingress: true,
    minimum_instance: true,
    secret_payload_in_plan: true,
  }, 'forbidden_delta');
  return plan;
}

export function serializePrivateJson(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAXIMUM_PRIVATE_JSON_BYTES) {
    reject('Private activation document is too large');
  }
  return serialized;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function activationAuthorization(planBytes, repositoryCommit) {
  if (typeof repositoryCommit !== 'string' || !COMMIT.test(repositoryCommit)) {
    reject('Activation authorization requires a canonical repository commit');
  }
  const digest = sha256(planBytes);
  return `materialize-staging-activation:${PROJECT_ID}:${digest}:${repositoryCommit}`;
}

export function validateActivationAuthorization(value, planBytes, repositoryCommit) {
  if (value !== activationAuthorization(planBytes, repositoryCommit)) {
    reject('Activation requires the exact plan digest and repository commit authorization');
  }
}

function assertOwnedPrivateEntry(path, kind, expectedType) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) reject(`${kind} must not be a symbolic link`);
  if (expectedType === 'directory' ? !entry.isDirectory() : !entry.isFile()) {
    reject(`${kind} has the wrong file type`);
  }
  if ((entry.mode & 0o077) !== 0) reject(`${kind} must not be accessible by group or other users`);
  if (typeof process.getuid === 'function' && entry.uid !== process.getuid()) {
    reject(`${kind} must be owned by the current user`);
  }
  return entry;
}

function containsPath(parent, candidate) {
  const child = relative(parent, candidate);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

export function assertPrivateDirectory(path, repositoryPath, kind = 'Private activation directory') {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\0-\x1f\x7f]/.test(path)) {
    reject(`${kind} path is invalid`);
  }
  assertOwnedPrivateEntry(path, kind, 'directory');
  const directory = realpathSync(path);
  const repository = realpathSync(repositoryPath);
  if (containsPath(repository, directory)) reject(`${kind} must remain outside the repository`);
  return directory;
}

export function createPrivatePlanDirectory(parentPath, repositoryPath) {
  const parent = assertPrivateDirectory(parentPath, repositoryPath, 'Private activation parent');
  const directory = mkdtempSync(join(parent, 'miakapp-staging-activation-plan-'));
  chmodSync(directory, 0o700);
  return directory;
}

export function readPrivatePlan(path, repositoryPath, options = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\0-\x1f\x7f]/.test(path)) {
    reject('Private activation plan path is invalid');
  }
  const entry = assertOwnedPrivateEntry(path, 'Private activation plan', 'file');
  if (entry.size === 0 || entry.size > MAXIMUM_PRIVATE_JSON_BYTES) {
    reject('Private activation plan has an invalid size');
  }
  const resolved = realpathSync(path);
  assertPrivateDirectory(dirname(resolved), repositoryPath);
  const bytes = readFileSync(resolved);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    reject('Private activation plan is not valid JSON');
  }
  if (!Buffer.from(serializePrivateJson(parsed), 'utf8').equals(bytes)) {
    reject('Private activation plan is not in canonical reviewed form');
  }
  return Object.freeze({
    bytes,
    path: resolved,
    plan: validateActivationPlan(parsed, options),
  });
}

export function writePrivateJson(path, value, mode = 0o600) {
  writeFileSync(path, serializePrivateJson(value), { flag: 'wx', mode });
  chmodSync(path, mode);
}

export function deriveSecretPayload(seed, secretId) {
  const key = Buffer.from(seed);
  if (key.byteLength !== 32 || !SECRET_BINDINGS.some((binding) => binding.secretId === secretId)) {
    reject('Secret derivation input is invalid');
  }
  return createHmac('sha256', key)
    .update(`miakapp.staging-secret/1\0${PROJECT_ID}\0${secretId}\0v1`, 'utf8')
    .digest();
}

export function payloadMatches(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.byteLength === 32 && right.byteLength === 32 && timingSafeEqual(left, right);
}

export function runtimeBuilderInput(observation) {
  const normalized = normalizeCloudObservation(observation, 'complete');
  const app = normalized.firebaseApps[0];
  if (app === undefined) reject('Firebase application is missing');
  return Object.freeze({
    schema: 'miakapp.staging-runtime-inputs/1',
    firebase_app_id: app.appId,
    signing_public_key_x: normalized.publicJwk.x,
    secret_versions: Object.freeze(Object.fromEntries(SECRET_BINDINGS.map(({ purpose, secretId }) => {
      const version = normalized.secretVersions[secretId][0]?.version;
      if (!Number.isSafeInteger(version) || version < 1) reject(`${secretId} version is missing`);
      return [purpose, version];
    }))),
  });
}

export function buildActivationResult({
  planDigest,
  repositoryCommit,
  completedAt,
  normalizedObservation,
  runtimeConfigDigest,
}) {
  if (!SHA256.test(planDigest) || !SHA256.test(runtimeConfigDigest) || !COMMIT.test(repositoryCommit)) {
    reject('Activation result digests are invalid');
  }
  canonicalTimestamp(completedAt, 'completed_at');
  const app = normalizedObservation.firebaseApps[0];
  if (app === undefined) reject('Activation result is missing the Firebase app');
  return Object.freeze({
    schema: 'miakapp.staging-activation-result/1',
    operation: 'materialize-initial-runtime-inputs',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    plan_sha256: planDigest,
    completed_at: completedAt,
    firebase_app: app,
    secret_versions: Object.freeze(SECRET_BINDINGS.map(({ purpose, secretId }) => {
      const version = normalizedObservation.secretVersions[secretId][0];
      if (version === undefined) reject(`${secretId} result is missing`);
      return Object.freeze({
        purpose,
        secret_id: secretId,
        resource_name: version.resourceName,
        state: version.state,
        payload_bytes: 32,
      });
    })),
    runtime_config_sha256: runtimeConfigDigest,
    workload_delta: Object.freeze({
      app_engine_applications: 0,
      cloud_functions: 0,
      cloud_run_services: 0,
      public_ingress: 0,
      minimum_instances: 0,
    }),
  });
}
