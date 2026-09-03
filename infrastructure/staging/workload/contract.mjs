import { spawnSync } from 'node:child_process';
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
export const REGION = 'europe-west9';
export const TERRAFORM_VERSION = '1.11.3';
export const OPERATOR_USER_SHA256 = 'd1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c';
export const RUNTIME_CONFIG_SHA256 = 'b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8';
export const PLAN_TTL_MILLISECONDS = 2 * 60 * 60 * 1_000;

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_PRIVATE_FILE_BYTES = 64 * 1024 * 1024;
const FORBIDDEN_ENVIRONMENT_NAMES = new Set([
  'ALL_PROXY',
  'FIREBASE_TOKEN',
  'GCLOUD_KEYFILE_JSON',
  'GCLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_CREDENTIALS',
  'GOOGLE_CLOUD_KEYFILE_JSON',
  'GOOGLE_CREDENTIALS',
  'GRPC_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NO_PROXY',
  'XDG_CONFIG_HOME',
  'all_proxy',
  'grpc_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
]);

export class StagingWorkloadError extends Error {
  constructor(message = 'Staging workload contract is invalid') {
    super(message);
    this.name = 'StagingWorkloadError';
  }
}

function reject(message) {
  throw new StagingWorkloadError(message);
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

export function assertSafeWorkloadEnvironment(environment, allowedName) {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || value.length === 0) continue;
    if (FORBIDDEN_ENVIRONMENT_NAMES.has(name)
      || name.startsWith('GOOGLE_')
      || name.startsWith('CLOUDSDK_')
      || name.startsWith('TF_')
      || (name.startsWith('FIREBASE_') && name !== 'FIREBASE_CLI_DISABLE_UPDATE_CHECK')
      || (name.startsWith('MIAKAPP_') && name !== allowedName)) {
      reject(`Environment override ${name} is forbidden for staging workload execution`);
    }
  }
  if (typeof environment.HOME !== 'string' || environment.HOME.length === 0
    || typeof environment.PATH !== 'string' || environment.PATH.length === 0) {
    reject('Staging workload execution requires the normal local HOME and PATH');
  }
}

export function childEnvironment(environment = process.env, additions = {}) {
  const selected = {};
  for (const name of [
    'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER',
  ]) {
    if (typeof environment[name] === 'string' && environment[name].length !== 0) {
      selected[name] = environment[name];
    }
  }
  selected.CI = '1';
  return Object.freeze({ ...selected, ...additions });
}

function command(commandName, args, repositoryRoot) {
  const result = spawnSync(commandName, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: childEnvironment(),
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    reject(`${commandName} state could not be verified`);
  }
  return result.stdout.trim();
}

export function verifyExactMain(repositoryRoot, expectedCommit) {
  if (command('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot) !== '') {
    reject('Staging workload execution requires a clean repository');
  }
  const head = command('git', ['rev-parse', 'HEAD'], repositoryRoot);
  const main = command('git', ['rev-parse', 'origin/main'], repositoryRoot);
  if (!COMMIT.test(head) || head !== main || (expectedCommit !== undefined && head !== expectedCommit)) {
    reject('Staging workload execution requires the exact reviewed origin/main commit');
  }
  return head;
}

export function verifiedOperatorEmail(repositoryRoot) {
  const email = command(
    'gcloud',
    ['config', 'get-value', 'account', '--quiet'],
    repositoryRoot,
  );
  if (!EMAIL.test(email) || email !== email.toLowerCase()
    || sha256(Buffer.from(email, 'utf8')) !== OPERATOR_USER_SHA256) {
    reject('The active Google user does not match the reviewed private staging operator');
  }
  return email;
}

export function createPrivateBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Private bundle parent must be an absolute path');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  if (relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Private workload bundle must remain outside the repository');
  }
  const parentEntry = lstatSync(parent);
  if (!parentEntry.isDirectory() || parentEntry.isSymbolicLink()) {
    reject('Private bundle parent must be a real directory');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-workload-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function writePrivateFile(path, bytes, mode = 0o600) {
  writeFileSync(path, bytes, { flag: 'wx', mode });
  chmodSync(path, mode);
}

export function readPrivateFile(path, maximumBytes = MAXIMUM_PRIVATE_FILE_BYTES) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || (typeof process.getuid === 'function' && entry.uid !== process.getuid())) {
    reject('Private workload bundle contains an invalid file');
  }
  return readFileSync(path);
}

export function workloadAuthorization(planBytes, repositoryCommit) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0 || !COMMIT.test(repositoryCommit)) {
    reject('Workload authorization inputs are invalid');
  }
  return `apply-private-workload:${PROJECT_ID}:${sha256(planBytes)}:${repositoryCommit}`;
}

export function validateWorkloadAuthorization(value, planBytes, repositoryCommit) {
  const expected = Buffer.from(workloadAuthorization(planBytes, repositoryCommit), 'utf8');
  const actual = Buffer.from(typeof value === 'string' ? value : '', 'utf8');
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    reject('Exact staging workload authorization is missing or invalid');
  }
}

export function buildPlanMetadata({
  repositoryCommit,
  createdAt,
  packageResult,
  planBytes,
  planJsonBytes,
  summary,
}) {
  if (!COMMIT.test(repositoryCommit)
    || !SHA256.test(packageResult.archive_sha256)
    || !Buffer.isBuffer(planBytes)
    || !Buffer.isBuffer(planJsonBytes)) {
    reject('Workload plan metadata inputs are invalid');
  }
  const createdMilliseconds = canonicalTimestamp(createdAt, 'created_at');
  return Object.freeze({
    schema: 'miakapp.staging-workload-plan/1',
    operation: 'deploy-initial-private-control-plane',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(createdMilliseconds + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    runtime_config_sha256: RUNTIME_CONFIG_SHA256,
    source_archive_sha256: packageResult.archive_sha256,
    source_archive_bytes: packageResult.archive_bytes,
    source_files: packageResult.files,
    terraform_version: TERRAFORM_VERSION,
    terraform_plan_sha256: sha256(planBytes),
    terraform_plan_json_sha256: sha256(planJsonBytes),
    summary,
    private_bundle_committed: false,
    live_request_authorized: false,
  });
}

export function validatePlanMetadata(value, now = Date.now()) {
  const metadata = exactKeys(value, [
    'schema',
    'operation',
    'project_id',
    'project_number',
    'region',
    'repository_commit',
    'created_at',
    'expires_at',
    'operator_user_sha256',
    'runtime_config_sha256',
    'source_archive_sha256',
    'source_archive_bytes',
    'source_files',
    'terraform_version',
    'terraform_plan_sha256',
    'terraform_plan_json_sha256',
    'summary',
    'private_bundle_committed',
    'live_request_authorized',
  ], 'Workload plan metadata');
  if (metadata.schema !== 'miakapp.staging-workload-plan/1'
    || metadata.operation !== 'deploy-initial-private-control-plane'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.runtime_config_sha256 !== RUNTIME_CONFIG_SHA256
    || !SHA256.test(metadata.source_archive_sha256)
    || !Number.isSafeInteger(metadata.source_archive_bytes)
    || metadata.source_archive_bytes < 1
    || metadata.source_archive_bytes > 8 * 1024 * 1024
    || !Array.isArray(metadata.source_files)
    || metadata.source_files.length < 2
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || !plainObject(metadata.summary)
    || metadata.private_bundle_committed !== false
    || metadata.live_request_authorized !== false) {
    reject('Workload plan metadata does not match the reviewed deployment');
  }
  const created = canonicalTimestamp(metadata.created_at, 'created_at');
  const expires = canonicalTimestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Workload plan metadata is expired or not yet valid');
  }
  return metadata;
}

export function readPlanMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Workload plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Workload plan metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value: validatePlanMetadata(value, now) });
}
