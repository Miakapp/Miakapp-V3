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
export const CLAIM_OBJECT =
  'terraform/browser-attestation/operations/live-browser-attestation-v2.json';
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
export const OPERATOR_USER_SHA256 =
  'd1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c';
export const APP_CHECK_SITE_KEY_SHA256 =
  '8a76f0f2cc0e0b002ed66c7f7d01ac28a6d44cb74ad2d33c3a7b0f0203e58546';
export const FIREBASE_SDK_VERSION = '12.18.0';
export const PLAYWRIGHT_VERSION = '1.62.1';
export const PLAN_TTL_MILLISECONDS = 2 * 60 * 60 * 1_000;
export const MAXIMUM_PUBLIC_WINDOW_MILLISECONDS = 5 * 60 * 1_000;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self' https://firebaseappcheck.googleapis.com https://www.google.com https://www.recaptcha.net",
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
  return `run-browser-app-check-attestation-v2:${PROJECT_ID}:${sha256(metadataBytes)}:${repositoryCommit}`;
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
    'prior_operation_claim',
    'retired_preflight_version_name_sha256',
  ], 'Browser-attestation baseline');
  const priorClaim = exactKeys(baseline.prior_operation_claim, [
    'generation',
    'object',
    'sha256',
    'size_bytes',
  ], 'Prior browser-attestation operation claim');
  if (!SHA256.test(baseline.app_check_config_sha256)
    || baseline.app_check_enforcement_records !== 0
    || baseline.debug_tokens !== 0
    || !SHA256.test(baseline.firebase_app_config_sha256)
    || baseline.hosting_release_count !== 0
    || baseline.hosting_site !== HOSTING_SITE
    || baseline.hosting_site_type !== 'DEFAULT_SITE'
    || baseline.hosting_version_count !== 1
    || baseline.operation_claim_present !== false
    || baseline.retired_preflight_version_name_sha256 !== PREFLIGHT_VERSION_NAME_SHA256
    || !isDeepStrictEqual(priorClaim, {
      object: PRIOR_CLAIM_OBJECT,
      generation: PRIOR_CLAIM_GENERATION,
      size_bytes: PRIOR_CLAIM_SIZE_BYTES,
      sha256: PRIOR_CLAIM_SHA256,
    })) {
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
    schema: 'miakapp.staging-browser-attestation-plan/2',
    operation: 'attest-browser-app-check-and-disable-hosting-v2',
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
    playwright_version: PLAYWRIGHT_VERSION,
    browser: Object.freeze({
      engine: 'chromium',
      headless: false,
      maximum_invocations: 1,
      persistent_context: false,
    }),
    safety: Object.freeze({
      maximum_attestation_attempts: 1,
      maximum_public_window_milliseconds: MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
      app_check_enforcement_enabled: false,
      control_plane_public_ingress: false,
      firebase_auth_used: false,
      debug_provider_used: false,
      trace_recording: false,
      har_recording: false,
      video_recording: false,
      screenshot_recording: false,
      token_returned_to_driver: false,
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
    'playwright_version',
    'project_id',
    'project_number',
    'repository_commit',
    'runner_path',
    'safety',
    'schema',
  ], 'Browser-attestation metadata');
  const browser = exactKeys(metadata.browser, [
    'engine',
    'headless',
    'maximum_invocations',
    'persistent_context',
  ], 'Browser-attestation browser');
  const safety = exactKeys(metadata.safety, [
    'app_check_enforcement_enabled',
    'control_plane_public_ingress',
    'debug_provider_used',
    'firebase_auth_used',
    'har_recording',
    'maximum_attestation_attempts',
    'maximum_public_window_milliseconds',
    'rollback',
    'screenshot_recording',
    'token_returned_to_driver',
    'trace_recording',
    'video_recording',
  ], 'Browser-attestation safety');
  const created = canonicalTimestamp(metadata.created_at, 'Browser-attestation creation time');
  const expires = canonicalTimestamp(metadata.expires_at, 'Browser-attestation expiry time');
  const baseline = validateBaseline(metadata.baseline);
  validateArtifact(metadata.artifact);
  if (metadata.schema !== 'miakapp.staging-browser-attestation-plan/2'
    || metadata.operation !== 'attest-browser-app-check-and-disable-hosting-v2'
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
    || metadata.playwright_version !== PLAYWRIGHT_VERSION
    || !isDeepStrictEqual(browser, {
      engine: 'chromium',
      headless: false,
      maximum_invocations: 1,
      persistent_context: false,
    })
    || !isDeepStrictEqual(safety, {
      maximum_attestation_attempts: 1,
      maximum_public_window_milliseconds: MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
      app_check_enforcement_enabled: false,
      control_plane_public_ingress: false,
      firebase_auth_used: false,
      debug_provider_used: false,
      trace_recording: false,
      har_recording: false,
      video_recording: false,
      screenshot_recording: false,
      token_returned_to_driver: false,
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

export function validateBrowserResult(value) {
  const result = exactKeys(value, [
    'attestation_attempts',
    'browser_context',
    'duration_milliseconds',
    'engine',
    'mode',
    'schema',
    'state',
    'token_format',
    'token_ttl_seconds',
  ], 'Browser-attestation result');
  if (result.schema !== 'miakapp.browser-app-check-attestation/1'
    || result.state !== 'passed'
    || result.engine !== 'chromium'
    || result.mode !== 'headed'
    || result.attestation_attempts !== 1
    || result.token_format !== 'jwt-three-segments'
    || !Number.isInteger(result.token_ttl_seconds)
    || result.token_ttl_seconds < 3000 || result.token_ttl_seconds > 3700
    || !Number.isInteger(result.duration_milliseconds)
    || result.duration_milliseconds < 0 || result.duration_milliseconds > 120_000
    || result.browser_context !== 'ephemeral-closed') {
    reject('Browser-attestation result is not the exact successful semantic shape');
  }
  return Object.freeze(result);
}
