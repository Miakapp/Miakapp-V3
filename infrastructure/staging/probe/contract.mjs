import { timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  OPERATOR_USER_SHA256,
  PLAN_TTL_MILLISECONDS,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  childEnvironment,
  readPrivateFile,
  sha256,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from '../workload/contract.mjs';

export {
  OPERATOR_USER_SHA256,
  PLAN_TTL_MILLISECONDS,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  childEnvironment,
  readPrivateFile,
  sha256,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
};

export const WORKFLOW_NAME = 'miakapp-private-probe';
export const PROBE_ACCOUNT = `miakapp-staging-probe@${PROJECT_ID}.iam.gserviceaccount.com`;
export const FUNCTION_NAME = 'control-plane';
export const FUNCTION_URI = 'https://control-plane-aczhngqraq-od.a.run.app';
export const DISCOVERY_PATH = '/.well-known/miakapp-control-plane';
export const WORKLOAD_SOURCE_SHA256 = 'd2a9ffae2bd85106f782f9c75a10b6fb398682ead65dada2a1cf8ab5c65b7eb4';
export const WORKLOAD_COMMIT = '3f5a94dfcdfc0984487a558d966bbeaa769b18eb';

export const WORKFLOW_SOURCE = [
  'main:',
  '  steps:',
  '    - invoke:',
  '        call: http.get',
  '        args:',
  `          url: ${FUNCTION_URI}${DISCOVERY_PATH}`,
  '          timeout: 30',
  '          headers:',
  '            Accept: application/json',
  '          auth:',
  '            type: OIDC',
  `            audience: ${FUNCTION_URI}`,
  '        result: response',
  '    - result:',
  '        return:',
  '          code: ${response.code}',
  '          headers: ${response.headers}',
  '          body: ${response.body}',
  '',
].join('\n');

export const WORKFLOW_SOURCE_SHA256 = sha256(Buffer.from(WORKFLOW_SOURCE));
export const EXPECTED_DISCOVERY = Object.freeze({
  schema: 'miakapp.control-plane-discovery/1',
  issuer: 'https://control.staging.miakapp.com',
  jwks_uri: 'https://control.staging.miakapp.com/.well-known/jwks.json',
  exchange_endpoint: 'https://control.staging.miakapp.com/v1/access-tokens:exchange',
  push_audience: 'https://control.staging.miakapp.com/v1/push',
  components_audience: 'https://control.staging.miakapp.com/v1/components',
});

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const REVISION = /^[0-9a-z][0-9a-z-]{0,62}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export class StagingProbeError extends Error {
  constructor(message = 'Staging private-probe contract is invalid') {
    super(message);
    this.name = 'StagingProbeError';
  }
}

function reject(message) {
  throw new StagingProbeError(message);
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

function timestamp(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

function safeEqual(actual, expected) {
  const actualBytes = Buffer.from(typeof actual === 'string' ? actual : '', 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes);
}

export function createPrivateProbeBundle(parentPath, repositoryRoot) {
  if (!isAbsolute(parentPath)) reject('Private-probe bundle parent must be an absolute path');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, parent);
  if (relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Private-probe bundle must remain outside the repository');
  }
  const entry = lstatSync(parent);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    reject('Private-probe bundle parent must be a real directory');
  }
  const directory = mkdtempSync(join(parent, 'miakapp-staging-probe-'));
  chmodSync(directory, 0o700);
  return realpathSync(directory);
}

export function probeApplyAuthorization(planBytes, repositoryCommit) {
  if (!Buffer.isBuffer(planBytes) || planBytes.byteLength === 0 || !COMMIT.test(repositoryCommit)) {
    reject('Private-probe apply authorization inputs are invalid');
  }
  return `apply-private-probe:${PROJECT_ID}:${sha256(planBytes)}:${repositoryCommit}`;
}

export function validateProbeApplyAuthorization(value, planBytes, repositoryCommit) {
  if (!safeEqual(value, probeApplyAuthorization(planBytes, repositoryCommit))) {
    reject('Exact staging private-probe apply authorization is missing or invalid');
  }
}

export function probeInvokeAuthorization(workflowRevision, repositoryCommit) {
  if (!REVISION.test(workflowRevision) || !COMMIT.test(repositoryCommit)) {
    reject('Private-probe invocation authorization inputs are invalid');
  }
  return `invoke-private-probe:${PROJECT_ID}:${workflowRevision}:${WORKFLOW_SOURCE_SHA256}:${repositoryCommit}`;
}

export function validateProbeInvokeAuthorization(value, workflowRevision, repositoryCommit) {
  if (!safeEqual(value, probeInvokeAuthorization(workflowRevision, repositoryCommit))) {
    reject('Exact staging private-probe invocation authorization is missing or invalid');
  }
}

export function buildProbePlanMetadata({ repositoryCommit, createdAt, planBytes, planJsonBytes, summary }) {
  if (!COMMIT.test(repositoryCommit)
    || !Buffer.isBuffer(planBytes)
    || !Buffer.isBuffer(planJsonBytes)
    || !plainObject(summary)) {
    reject('Private-probe plan metadata inputs are invalid');
  }
  const createdMilliseconds = timestamp(createdAt, 'created_at');
  return Object.freeze({
    schema: 'miakapp.staging-probe-plan/1',
    operation: 'deploy-fixed-private-discovery-probe',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(createdMilliseconds + PLAN_TTL_MILLISECONDS).toISOString(),
    operator_user_sha256: OPERATOR_USER_SHA256,
    terraform_version: TERRAFORM_VERSION,
    terraform_plan_sha256: sha256(planBytes),
    terraform_plan_json_sha256: sha256(planJsonBytes),
    workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
    summary,
    private_bundle_committed: false,
    live_request_authorized: false,
  });
}

export function validateProbePlanMetadata(value, now = Date.now()) {
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
    'terraform_version',
    'terraform_plan_sha256',
    'terraform_plan_json_sha256',
    'workflow_source_sha256',
    'summary',
    'private_bundle_committed',
    'live_request_authorized',
  ], 'Private-probe plan metadata');
  if (metadata.schema !== 'miakapp.staging-probe-plan/1'
    || metadata.operation !== 'deploy-fixed-private-discovery-probe'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.region !== REGION
    || !COMMIT.test(metadata.repository_commit)
    || metadata.operator_user_sha256 !== OPERATOR_USER_SHA256
    || metadata.terraform_version !== TERRAFORM_VERSION
    || !SHA256.test(metadata.terraform_plan_sha256)
    || !SHA256.test(metadata.terraform_plan_json_sha256)
    || metadata.workflow_source_sha256 !== WORKFLOW_SOURCE_SHA256
    || !plainObject(metadata.summary)
    || metadata.private_bundle_committed !== false
    || metadata.live_request_authorized !== false) {
    reject('Private-probe plan metadata does not match the reviewed deployment');
  }
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  if (expires - created !== PLAN_TTL_MILLISECONDS || now < created - 60_000 || now > expires) {
    reject('Private-probe plan metadata is expired or not yet valid');
  }
  return metadata;
}

export function readProbePlanMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Private-probe plan metadata is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Private-probe plan metadata is not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateProbePlanMetadata(value, now) });
}
