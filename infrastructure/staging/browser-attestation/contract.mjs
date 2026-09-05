import { createHash, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
export const HOSTING_SITE = PROJECT_ID;
export const HOSTING_ORIGIN = `https://${HOSTING_SITE}.web.app`;
export const RUNNER_DIRECTORY = '/__acceptance/app-check';
export const RUNNER_PATH = `${RUNNER_DIRECTORY}/index.html`;
export const RUNNER_URL = `${HOSTING_ORIGIN}${RUNNER_PATH}`;
export const STATE_BUCKET = `${PROJECT_ID}-tfstate-${PROJECT_NUMBER}`;
export const PRIOR_CLAIM_OBJECT =
  'terraform/browser-attestation/operations/live-browser-attestation.json';
export const SECOND_PRIOR_CLAIM_OBJECT =
  'terraform/browser-attestation/operations/live-browser-attestation-v2.json';
export const THIRD_PRIOR_CLAIM_OBJECT =
  'terraform/browser-attestation/operations/live-browser-attestation-v3.json';
export const FOURTH_PRIOR_CLAIM_OBJECT =
  'terraform/browser-attestation/operations/live-browser-attestation-v4.json';
export const FIFTH_PRIOR_CLAIM_OBJECT =
  'terraform/browser-attestation/operations/live-browser-attestation-v5.json';
export const CLAIM_OBJECT =
  'terraform/browser-attestation/operations/live-browser-attestation-v6.json';
export const PRIOR_CLAIM_GENERATION = '1788616557403719';
export const PRIOR_CLAIM_SIZE_BYTES = 671;
export const PRIOR_CLAIM_SHA256 =
  '202b5ead353763493e9632daef12abec9cb19e9bb1bd8114a9afe2a300c0cadb';
export const PREFLIGHT_REPOSITORY_COMMIT =
  'fd2a42513446d4d3bb86cce364e2b5e021ff9bd7';
export const PREFLIGHT_METADATA_SHA256 =
  'de5b108f513906242771779bb5b714c9ff85a557db3d3ec9cfc3a7a6bc88eb0d';
export const PREFLIGHT_VERSION_NAME_SHA256 =
  'faf679b105232f95bcbf16d666b6d6159bebb9e88f35cd6ee55219c7462bd512';
export const SECOND_PRIOR_CLAIM_GENERATION = '1788617641293074';
export const SECOND_PRIOR_CLAIM_SIZE_BYTES = 674;
export const SECOND_PRIOR_CLAIM_SHA256 =
  '50a4c647f04903ad007dd470262c4298908e7adfde57573e4e6766efd6702e33';
export const PREFLIGHT_V2_REPOSITORY_COMMIT =
  '4fba5cf19ed4bf316b4e23676a8efc8a2bc0695a';
export const PREFLIGHT_V2_METADATA_SHA256 =
  'dbabd91442b9bd42b6b8afe934dcc9a433aad51abc375847491fc9dcbffa30bb';
export const PREFLIGHT_V2_VERSION_NAME_SHA256 =
  'd0dc444702b93d17043a794280cfc41e65d9a0b5242c83e36f2f9b8f0c402b6e';
export const THIRD_PRIOR_CLAIM_GENERATION = '1788618402280790';
export const THIRD_PRIOR_CLAIM_SIZE_BYTES = 674;
export const THIRD_PRIOR_CLAIM_SHA256 =
  'aae55149143ed237acf4ac3cb30f4850d431d258c68624d3c38d7a6d85b92133';
export const PREFLIGHT_V3_REPOSITORY_COMMIT =
  '4dba55108fbd5862f349311af67ba5fde42b5543';
export const PREFLIGHT_V3_METADATA_SHA256 =
  'c78ff6910da64cb933a866c05d70ce84c9d49cb06bb81aaffa0d755d96d0a10c';
export const PREFLIGHT_V3_VERSION_NAME_SHA256 =
  '57bcd7fff5f5cbe7d66bbcd78c8205b558c0f7727dd2691a7de6a7a2b8dc8f21';
export const FOURTH_PRIOR_CLAIM_GENERATION = '1788618927741289';
export const FOURTH_PRIOR_CLAIM_SIZE_BYTES = 674;
export const FOURTH_PRIOR_CLAIM_SHA256 =
  '933ec73794d8b0e8f11e8379b1069b5a0ccb7942d20edcddad6b571f1650b910';
export const PREFLIGHT_V4_REPOSITORY_COMMIT =
  'b388f385c2df089e2ab19ba5580dec900092e089';
export const PREFLIGHT_V4_METADATA_SHA256 =
  '8ffa9e869072974502d2b7d693dbc19ee6abfde764c41ceef046c716f961476a';
export const PREFLIGHT_V4_VERSION_NAME_SHA256 =
  '17a2c9a4780a96101f510cf62d454c0c7beec6a158d8131724cd534973f6be23';
export const PREFLIGHT_V4_DEPLOY_RELEASE_NAME_SHA256 =
  '72ad96b2f48acff6c8cddfbf99454f6cc8c7840ab405734fe1c731f7161abce7';
export const PREFLIGHT_V4_DISABLE_RELEASE_NAME_SHA256 =
  '9bcb68a387fb363317c644d85f72f70d6fa7486ff24138e526f8ba5337538ddc';
export const PREFLIGHT_V4_DEPLOY_RELEASE_TIME = '2026-09-05T14:35:33.316Z';
export const PREFLIGHT_V4_DISABLE_RELEASE_TIME = '2026-09-05T14:35:39.637Z';
export const PREFLIGHT_V4_DEPLOY_MESSAGE =
  'Miakapp V4 bounded browser App Check attestation v4';
export const PREFLIGHT_V4_DISABLE_MESSAGE =
  'Miakapp V4 browser App Check attestation v4 retired';
export const FIFTH_PRIOR_CLAIM_GENERATION = '1788629890224429';
export const FIFTH_PRIOR_CLAIM_SIZE_BYTES = 686;
export const FIFTH_PRIOR_CLAIM_SHA256 =
  'e1e7fb2e4a79c9b7845af604e28157f6de344e975ee8fbfa79afc3f9fb7d105b';
export const PREFLIGHT_V5_REPOSITORY_COMMIT =
  '930177a0ff0d1305ebed541b2d8fccc3601c29df';
export const PREFLIGHT_V5_METADATA_SHA256 =
  'e78c5bb7bb670218898c12479434f83716d0e40af66bf4c320abfaed167a5fb5';
export const PREFLIGHT_V5_VERSION_NAME_SHA256 =
  '0b2a00c0f321692ee75d1d5e19957a54c0bd1e4289e37fa77775eb3234bda2cd';
export const PREFLIGHT_V5_DEPLOY_RELEASE_NAME_SHA256 =
  '883e02db5637c44e0baa713c8ffa6b602aac319d5c902f3de3d8fc1716fdf8d0';
export const PREFLIGHT_V5_DISABLE_RELEASE_NAME_SHA256 =
  '1c603c5386815f4afd1791cfff4c8f3d728ee1626070df1e2d88b3e54c343e4f';
export const PREFLIGHT_V5_DEPLOY_RELEASE_TIME = '2026-09-05T17:38:19.804Z';
export const PREFLIGHT_V5_DISABLE_RELEASE_TIME = '2026-09-05T17:38:23.594Z';
export const PREFLIGHT_V5_DEPLOY_MESSAGE =
  'Miakapp V4 bounded interactive browser App Check attestation v5';
export const PREFLIGHT_V5_DISABLE_MESSAGE =
  'Miakapp V4 interactive browser App Check attestation v5 retired';
export const OPERATOR_USER_SHA256 =
  'd1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c';
export const APP_CHECK_SITE_KEY_SHA256 =
  '8a76f0f2cc0e0b002ed66c7f7d01ac28a6d44cb74ad2d33c3a7b0f0203e58546';
export const FIREBASE_SDK_VERSION = '12.18.0';
export const PLAN_TTL_MILLISECONDS = 2 * 60 * 60 * 1_000;
export const MAXIMUM_PUBLIC_WINDOW_MILLISECONDS = 5 * 60 * 1_000;
export const INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS = 2 * 60 * 1_000;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self' https://content-firebaseappcheck.googleapis.com https://www.google.com https://www.recaptcha.net",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'frame-src https://www.google.com https://recaptcha.google.com https://www.recaptcha.net',
  'img-src data: https://www.google.com https://www.gstatic.com',
  "script-src 'self' https://www.google.com https://www.gstatic.com",
  "style-src 'unsafe-inline'",
  'worker-src blob:',
].join('; ');

export const HOSTING_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ASSET_PATH = /^\/__acceptance\/app-check\/assets\/attestation-[0-9A-Za-z_-]+\.js$/u;
const MAXIMUM_METADATA_BYTES = 64 * 1024;

export class StagingBrowserAttestationError extends Error {
  constructor(message = 'Staging browser-attestation contract is invalid') {
    super(message);
    this.name = 'StagingBrowserAttestationError';
  }
}

function reject(message) {
  throw new StagingBrowserAttestationError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, description) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${description} must contain exactly the reviewed fields`);
  }
  return value;
}

function canonicalTimestamp(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function privateBundle(parentPath, repositoryRoot, create = false) {
  if (!isAbsolute(parentPath)) reject('Browser-attestation bundle path must be absolute');
  const repository = realpathSync(repositoryRoot);
  const target = create
    ? realpathSync(parentPath)
    : realpathSync(resolve(parentPath));
  const relation = relative(repository, target);
  const entry = lstatSync(target);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')
    || (!create && (entry.mode & 0o077) !== 0)) {
    reject('Browser-attestation bundles must be private real directories outside the repository');
  }
  if (!create) return target;
  const directory = mkdtempSync(join(target, 'miakapp-staging-browser-attestation-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function writePrivateFile(path, bytes, mode = 0o600) {
  writeFileSync(path, bytes, { flag: 'wx', mode });
  chmodSync(path, mode);
}

export function readPrivateFile(path, maximumBytes = MAXIMUM_METADATA_BYTES) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || (typeof process.getuid === 'function' && entry.uid !== process.getuid())) {
    reject('Browser-attestation bundle contains an invalid private file');
  }
  return readFileSync(path);
}

export function attestationAuthorization(metadataBytes, repositoryCommit) {
  if (!Buffer.isBuffer(metadataBytes) || metadataBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit)) {
    reject('Browser-attestation authorization inputs are invalid');
  }
  return `run-interactive-browser-app-check-attestation-v6:${PROJECT_ID}:${sha256(metadataBytes)}:${repositoryCommit}`;
}

export function validateAttestationAuthorization(value, metadataBytes, repositoryCommit) {
  const expected = Buffer.from(attestationAuthorization(metadataBytes, repositoryCommit), 'utf8');
  const actual = Buffer.from(typeof value === 'string' ? value : '', 'utf8');
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    reject('Exact staging browser-attestation authorization is missing or invalid');
  }
}

function validateBaseline(value) {
  const baseline = exactKeys(value, [
    'app_check_config_sha256',
    'app_check_enforcement_records',
    'debug_tokens',
    'firebase_app_config_sha256',
    'hosting_release_count',
    'hosting_site',
    'hosting_site_type',
    'hosting_version_count',
    'operation_claim_present',
    'prior_operation_claims',
    'retired_release_name_sha256s',
    'retired_preflight_version_name_sha256s',
  ], 'Browser-attestation baseline');
  if (!SHA256.test(baseline.app_check_config_sha256)
    || baseline.app_check_enforcement_records !== 0
    || baseline.debug_tokens !== 0
    || !SHA256.test(baseline.firebase_app_config_sha256)
    || baseline.hosting_release_count !== 4
    || baseline.hosting_site !== HOSTING_SITE
    || baseline.hosting_site_type !== 'DEFAULT_SITE'
    || baseline.hosting_version_count !== 5
    || baseline.operation_claim_present !== false
    || !isDeepStrictEqual(baseline.retired_preflight_version_name_sha256s, [
      PREFLIGHT_VERSION_NAME_SHA256,
      PREFLIGHT_V2_VERSION_NAME_SHA256,
      PREFLIGHT_V3_VERSION_NAME_SHA256,
      PREFLIGHT_V4_VERSION_NAME_SHA256,
      PREFLIGHT_V5_VERSION_NAME_SHA256,
    ])
    || !isDeepStrictEqual(baseline.retired_release_name_sha256s, [
      PREFLIGHT_V4_DEPLOY_RELEASE_NAME_SHA256,
      PREFLIGHT_V4_DISABLE_RELEASE_NAME_SHA256,
      PREFLIGHT_V5_DEPLOY_RELEASE_NAME_SHA256,
      PREFLIGHT_V5_DISABLE_RELEASE_NAME_SHA256,
    ])
    || !isDeepStrictEqual(baseline.prior_operation_claims, [
      {
        object: PRIOR_CLAIM_OBJECT,
        generation: PRIOR_CLAIM_GENERATION,
        size_bytes: PRIOR_CLAIM_SIZE_BYTES,
        sha256: PRIOR_CLAIM_SHA256,
      },
      {
        object: SECOND_PRIOR_CLAIM_OBJECT,
        generation: SECOND_PRIOR_CLAIM_GENERATION,
        size_bytes: SECOND_PRIOR_CLAIM_SIZE_BYTES,
        sha256: SECOND_PRIOR_CLAIM_SHA256,
      },
      {
        object: THIRD_PRIOR_CLAIM_OBJECT,
        generation: THIRD_PRIOR_CLAIM_GENERATION,
        size_bytes: THIRD_PRIOR_CLAIM_SIZE_BYTES,
        sha256: THIRD_PRIOR_CLAIM_SHA256,
      },
      {
        object: FOURTH_PRIOR_CLAIM_OBJECT,
        generation: FOURTH_PRIOR_CLAIM_GENERATION,
        size_bytes: FOURTH_PRIOR_CLAIM_SIZE_BYTES,
        sha256: FOURTH_PRIOR_CLAIM_SHA256,
      },
      {
        object: FIFTH_PRIOR_CLAIM_OBJECT,
        generation: FIFTH_PRIOR_CLAIM_GENERATION,
        size_bytes: FIFTH_PRIOR_CLAIM_SIZE_BYTES,
        sha256: FIFTH_PRIOR_CLAIM_SHA256,
      },
    ])) {
    reject('Browser-attestation baseline differs from the reviewed retired preflight boundary');
  }
  return baseline;
}

function validateArtifact(value) {
  const artifact = exactKeys(value, [
    'file_count',
    'files',
    'total_content_bytes',
    'total_gzip_bytes',
  ], 'Browser-attestation artifact');
  if (artifact.file_count !== 2 || !Array.isArray(artifact.files)
    || artifact.files.length !== artifact.file_count
    || !Number.isInteger(artifact.total_content_bytes)
    || !Number.isInteger(artifact.total_gzip_bytes)
    || artifact.total_content_bytes <= 0 || artifact.total_content_bytes > 1024 * 1024
    || artifact.total_gzip_bytes <= 0 || artifact.total_gzip_bytes > 512 * 1024) {
    reject('Browser-attestation artifact bounds are invalid');
  }
  let contentBytes = 0;
  let gzipBytes = 0;
  const paths = new Set();
  for (const [index, value] of artifact.files.entries()) {
    const file = exactKeys(value, [
      'content_bytes',
      'content_sha256',
      'content_type',
      'gzip_bytes',
      'gzip_sha256',
      'path',
    ], `Browser-attestation artifact file ${index}`);
    const expectedType = file.path === RUNNER_PATH
      ? 'text/html; charset=utf-8'
      : 'text/javascript; charset=utf-8';
    if ((file.path !== RUNNER_PATH && !ASSET_PATH.test(file.path))
      || paths.has(file.path)
      || file.content_type !== expectedType
      || !SHA256.test(file.content_sha256)
      || !SHA256.test(file.gzip_sha256)
      || !Number.isInteger(file.content_bytes) || file.content_bytes <= 0
      || !Number.isInteger(file.gzip_bytes) || file.gzip_bytes <= 0
      || file.gzip_bytes > file.content_bytes + 64) {
      reject('Browser-attestation artifact file is invalid');
    }
    paths.add(file.path);
    contentBytes += file.content_bytes;
    gzipBytes += file.gzip_bytes;
  }
  if (!paths.has(RUNNER_PATH)
    || [...paths].filter((path) => ASSET_PATH.test(path)).length !== 1
    || contentBytes !== artifact.total_content_bytes
    || gzipBytes !== artifact.total_gzip_bytes) {
    reject('Browser-attestation artifact totals or paths are invalid');
  }
  return artifact;
}

export function buildAttestationMetadata({
  repositoryCommit,
  createdAt,
  baseline,
  firebaseConfigSha256,
  dependencyLockSha256,
  artifact,
}) {
  const created = canonicalTimestamp(createdAt, 'Browser-attestation creation time');
  if (!COMMIT.test(repositoryCommit) || !SHA256.test(firebaseConfigSha256)
    || !SHA256.test(dependencyLockSha256)) {
    reject('Browser-attestation metadata inputs are invalid');
  }
  validateBaseline(baseline);
  validateArtifact(artifact);
  return Object.freeze({
    schema: 'miakapp.staging-browser-attestation-plan/6',
    operation: 'attest-interactive-browser-app-check-and-disable-hosting-v6',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    hosting_site: HOSTING_SITE,
    hosting_origin: HOSTING_ORIGIN,
    runner_path: RUNNER_PATH,
    repository_commit: repositoryCommit,
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + PLAN_TTL_MILLISECONDS).toISOString(),
    baseline_sha256: sha256(Buffer.from(canonicalJson(baseline), 'utf8')),
    baseline,
    firebase_config_sha256: firebaseConfigSha256,
    dependency_lock_sha256: dependencyLockSha256,
    app_check_site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
    artifact,
    firebase_sdk_version: FIREBASE_SDK_VERSION,
    browser: Object.freeze({
      session: 'macos-default-system-browser',
      observation_channel: 'ephemeral-loopback-fragment-post',
      maximum_invocations: 1,
    }),
    safety: Object.freeze({
      maximum_attestation_attempts: 1,
      maximum_public_window_milliseconds: MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
      interactive_observation_deadline_milliseconds:
        INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS,
      app_check_enforcement_enabled: false,
      control_plane_public_ingress: false,
      firebase_auth_used: false,
      debug_provider_used: false,
      token_returned_to_driver: false,
      raw_browser_error_returned_to_driver: false,
      rollback: 'site-disable-then-delete-version',
    }),
  });
}

export function validateAttestationMetadata(value, now = Date.now()) {
  const metadata = exactKeys(value, [
    'app_check_site_key_sha256',
    'artifact',
    'baseline',
    'baseline_sha256',
    'browser',
    'created_at',
    'dependency_lock_sha256',
    'expires_at',
    'firebase_config_sha256',
    'firebase_sdk_version',
    'hosting_origin',
    'hosting_site',
    'operation',
    'project_id',
    'project_number',
    'repository_commit',
    'runner_path',
    'safety',
    'schema',
  ], 'Browser-attestation metadata');
  const browser = exactKeys(metadata.browser, [
    'maximum_invocations',
    'observation_channel',
    'session',
  ], 'Browser-attestation browser');
  const safety = exactKeys(metadata.safety, [
    'app_check_enforcement_enabled',
    'control_plane_public_ingress',
    'debug_provider_used',
    'firebase_auth_used',
    'interactive_observation_deadline_milliseconds',
    'maximum_attestation_attempts',
    'maximum_public_window_milliseconds',
    'rollback',
    'raw_browser_error_returned_to_driver',
    'token_returned_to_driver',
  ], 'Browser-attestation safety');
  const created = canonicalTimestamp(metadata.created_at, 'Browser-attestation creation time');
  const expires = canonicalTimestamp(metadata.expires_at, 'Browser-attestation expiry time');
  const baseline = validateBaseline(metadata.baseline);
  validateArtifact(metadata.artifact);
  if (metadata.schema !== 'miakapp.staging-browser-attestation-plan/6'
    || metadata.operation !== 'attest-interactive-browser-app-check-and-disable-hosting-v6'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.hosting_site !== HOSTING_SITE
    || metadata.hosting_origin !== HOSTING_ORIGIN
    || metadata.runner_path !== RUNNER_PATH
    || !COMMIT.test(metadata.repository_commit)
    || expires - created !== PLAN_TTL_MILLISECONDS
    || !Number.isFinite(now) || now < created || now >= expires
    || metadata.baseline_sha256 !== sha256(Buffer.from(canonicalJson(baseline), 'utf8'))
    || !SHA256.test(metadata.firebase_config_sha256)
    || !SHA256.test(metadata.dependency_lock_sha256)
    || metadata.app_check_site_key_sha256 !== APP_CHECK_SITE_KEY_SHA256
    || metadata.firebase_sdk_version !== FIREBASE_SDK_VERSION
    || !isDeepStrictEqual(browser, {
      session: 'macos-default-system-browser',
      observation_channel: 'ephemeral-loopback-fragment-post',
      maximum_invocations: 1,
    })
    || !isDeepStrictEqual(safety, {
      maximum_attestation_attempts: 1,
      maximum_public_window_milliseconds: MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
      interactive_observation_deadline_milliseconds:
        INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS,
      app_check_enforcement_enabled: false,
      control_plane_public_ingress: false,
      firebase_auth_used: false,
      debug_provider_used: false,
      token_returned_to_driver: false,
      raw_browser_error_returned_to_driver: false,
      rollback: 'site-disable-then-delete-version',
    })) {
    reject('Browser-attestation metadata differs from the reviewed operation');
  }
  return metadata;
}

function parseAndValidateAttestationMetadata(bytes, now) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    reject('Browser-attestation metadata is invalid JSON');
  }
  validateAttestationMetadata(value, now);
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser-attestation metadata is not canonical JSON');
  }
  return Object.freeze({ value, bytes });
}

export function readAttestationMetadata(path, now = Date.now()) {
  return parseAndValidateAttestationMetadata(readPrivateFile(path), now);
}

export function readAttestationMetadataForRecovery(path) {
  const bytes = readPrivateFile(path);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    reject('Browser-attestation metadata is invalid JSON');
  }
  return parseAndValidateAttestationMetadata(bytes, Date.parse(value.created_at));
}

export function validateBrowserResult(value, expectedChallenge) {
  if (typeof expectedChallenge !== 'string' || !/^[0-9a-f]{64}$/u.test(expectedChallenge)) {
    reject('Browser-attestation challenge is invalid');
  }
  const common = ['attestation_attempts', 'challenge', 'schema', 'state'];
  const keys = value?.state === 'passed'
    ? [...common, 'duration_milliseconds', 'token_format', 'token_ttl_seconds']
    : [...common, 'failure_code', 'failure_stage'];
  const result = exactKeys(value, keys, 'Browser-attestation result');
  const expected = Buffer.from(expectedChallenge, 'utf8');
  const actual = Buffer.from(typeof result.challenge === 'string' ? result.challenge : '', 'utf8');
  if (result.schema !== 'miakapp.browser-app-check-attestation/3'
    || actual.byteLength !== expected.byteLength
    || !timingSafeEqual(actual, expected)
    || result.attestation_attempts !== 1) {
    reject('Browser-attestation result differs from the exact system-browser challenge');
  }
  if (result.state === 'failed') {
    const allowedFailures = {
      'firebase-initialization': ['initialization-rejected'],
      'provider-token-request': [
        'app-check-exchange-http-400',
        'app-check-exchange-http-401',
        'app-check-exchange-http-403',
        'app-check-exchange-http-404',
        'app-check-exchange-http-409',
        'app-check-exchange-http-429',
        'app-check-exchange-http-5xx',
        'app-check-exchange-http-other',
        'app-check-fetch-network-error',
        'app-check-fetch-parse-error',
        'app-check-recaptcha-error',
        'app-check-sdk-error',
        'app-check-throttled',
        'provider-rejection',
      ],
      'token-format-validation': ['token-format-rejected'],
      'token-ttl-validation': ['token-ttl-rejected'],
      'duration-bound-validation': ['duration-bound-rejected'],
    };
    if (!Object.hasOwn(allowedFailures, result.failure_stage)
      || !allowedFailures[result.failure_stage].includes(result.failure_code)) {
      reject('Browser-attestation failure is not the exact closed shape');
    }
    return Object.freeze(result);
  }
  if (result.state !== 'passed'
    || result.token_format !== 'jwt-three-segments'
    || !Number.isInteger(result.token_ttl_seconds)
    || result.token_ttl_seconds < 3000 || result.token_ttl_seconds > 3700
    || !Number.isInteger(result.duration_milliseconds)
    || result.duration_milliseconds < 0 || result.duration_milliseconds > 90_000) {
    reject('Browser-attestation result is not the exact successful semantic shape');
  }
  return Object.freeze(result);
}
