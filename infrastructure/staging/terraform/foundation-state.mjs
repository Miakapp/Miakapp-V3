import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import { FOUNDATION_ACTIVATION } from '../bootstrap/bootstrap-execution.mjs';

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const PROJECT_DISPLAY_NAME = 'Miakapp V4 Staging';
export const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
export const BOOTSTRAP_STATE_OBJECT = 'terraform/bootstrap/default.tfstate';
export const BOOTSTRAP_STATE_GENERATION = '1788439334043522';
export const BOOTSTRAP_STATE_SHA256 = '8753dcceaa848ba8734d9892dbec6f2445fbf6b3fbead7da375cc37f0702d3bf';
export const BOOTSTRAP_STATE_SIZE = 60909;
export const BOOTSTRAP_STATE_LINEAGE_SHA256 = '35e52294057979e6191eaa05141a9476261d4b0ea75c9113128f780abda7a9ba';
export const FOUNDATION_STATE_OBJECT = 'terraform/foundation/default.tfstate';

const TERRAFORM_VERSION = '1.11.3';
const MAX_OBSERVATION_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const LINEAGE_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function reject(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, path) {
  if (!isPlainObject(value)) reject(`${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!isDeepStrictEqual(actual, expected)) reject(`${path} must contain exactly the reviewed fields`);
  return value;
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    reject(`${path} is not valid JSON`);
  }
}

async function readBoundedStandardInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_OBSERVATION_BYTES) reject('Observation exceeds the execution limit');
    chunks.push(chunk);
  }
  if (bytes === 0) reject('Observation is empty');
  return Buffer.concat(chunks).toString('utf8');
}

function assertPrivateEntry(path, kind, expectedType) {
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
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function readPrivateState(path, kind) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\0-\x1f\x7f]/.test(path)) {
    reject(`${kind} must have an absolute path without control characters`);
  }
  if (lstatSync(path).isSymbolicLink()) reject(`${kind} must not be a symbolic link`);
  const canonicalPath = realpathSync(path);
  assertPrivateEntry(dirname(canonicalPath), `${kind} parent`, 'directory');
  const entry = assertPrivateEntry(canonicalPath, kind, 'file');
  if (entry.size === 0 || entry.size > MAX_STATE_BYTES) reject(`${kind} has an invalid size`);
  const bytes = readFileSync(canonicalPath);
  return Object.freeze({
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    state: parseJson(bytes.toString('utf8'), kind),
  });
}

export function foundationStateAuthorization(repositoryCommit) {
  if (typeof repositoryCommit !== 'string' || !COMMIT_PATTERN.test(repositoryCommit)) {
    reject('Foundation-state initialization requires a canonical repository commit');
  }
  return `initialize-foundation-state:${PROJECT_ID}:${BOOTSTRAP_STATE_GENERATION}:${repositoryCommit}`;
}

export function validateFoundationStateAuthorization(value, repositoryCommit) {
  if (value !== foundationStateAuthorization(repositoryCommit)) {
    reject('Foundation-state initialization requires the exact bootstrap generation and repository-commit authorization');
  }
  return value;
}

export function createPrivateExecutionDirectory(parentPath, repositoryPath) {
  if (typeof parentPath !== 'string' || !isAbsolute(parentPath) || /[\0-\x1f\x7f]/.test(parentPath)) {
    reject('Private execution parent must be an absolute path without control characters');
  }
  if (typeof repositoryPath !== 'string' || !isAbsolute(repositoryPath)) {
    reject('Private execution setup requires an absolute repository path');
  }
  if (lstatSync(parentPath).isSymbolicLink()) reject('Private execution parent must not be a symbolic link');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryPath);
  assertPrivateEntry(parent, 'Private execution parent', 'directory');
  if (containsPath(repository, parent)) reject('Private execution parent must remain outside the repository');
  const execution = mkdtempSync(join(parent, 'miakapp-staging-foundation-state-'));
  assertPrivateEntry(execution, 'Private execution directory', 'directory');
  return execution;
}

export function verifyProjectObservation(value) {
  if (!isPlainObject(value)
      || value.projectId !== PROJECT_ID
      || String(value.projectNumber) !== PROJECT_NUMBER
      || value.name !== PROJECT_DISPLAY_NAME
      || value.lifecycleState !== 'ACTIVE') {
    reject('The observed project is not the reviewed active staging project');
  }
  return value;
}

function verifyInventoryMarker(entry, expectedType, expectedUrl, path) {
  exactKeys(entry, ['type', 'url'], path);
  if (entry.type !== expectedType || entry.url !== expectedUrl) {
    reject(`${path} does not match the reviewed state-bucket marker`);
  }
}

function verifyInventoryObject(entry, expectedName, expectedGeneration, expectedSize, path) {
  exactKeys(entry, ['metadata', 'type', 'url'], path);
  if (entry.type !== 'cloud_object' || !isPlainObject(entry.metadata)) {
    reject(`${path} is not a current state object`);
  }
  const metadata = entry.metadata;
  const generation = String(metadata.generation ?? '');
  const size = Number(metadata.size);
  if (metadata.bucket !== STATE_BUCKET
      || metadata.name !== expectedName
      || !/^\d+$/.test(generation)
      || BigInt(generation) <= 0n
      || !Number.isSafeInteger(size)
      || size <= 0
      || metadata.timeDeleted !== undefined
      || metadata.softDeleteTime !== undefined
      || entry.url !== `gs://${STATE_BUCKET}/${expectedName}#${generation}`
      || (expectedGeneration !== undefined && generation !== expectedGeneration)
      || (expectedSize !== undefined && size !== expectedSize)) {
    reject(`${path} metadata does not match the reviewed current state object`);
  }
  return Object.freeze({ generation, size });
}

export function inspectStateBucketInventory(value) {
  if (!Array.isArray(value)) reject('State-bucket inventory must be an array');
  const entries = new Map();
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.url !== 'string' || entries.has(entry.url)) {
      reject('State-bucket inventory contains a malformed or duplicate entry');
    }
    entries.set(entry.url, entry);
  }

  const rootUrl = `gs://${STATE_BUCKET}/`;
  const terraformUrl = `${rootUrl}terraform/`;
  const bootstrapPrefixUrl = `${terraformUrl}bootstrap/`;
  const bootstrapObjectUrl = `${rootUrl}${BOOTSTRAP_STATE_OBJECT}#${BOOTSTRAP_STATE_GENERATION}`;
  for (const [url, type, label] of [
    [rootUrl, 'unknown', 'bucket root'],
    [terraformUrl, 'prefix', 'Terraform prefix'],
    [bootstrapPrefixUrl, 'prefix', 'bootstrap prefix'],
  ]) {
    const entry = entries.get(url);
    if (entry === undefined) reject(`State-bucket inventory is missing the reviewed ${label}`);
    verifyInventoryMarker(entry, type, url, `State-bucket ${label}`);
  }
  const bootstrapObject = entries.get(bootstrapObjectUrl);
  if (bootstrapObject === undefined) reject('State-bucket inventory is missing the reconciled bootstrap state');
  verifyInventoryObject(
    bootstrapObject,
    BOOTSTRAP_STATE_OBJECT,
    BOOTSTRAP_STATE_GENERATION,
    BOOTSTRAP_STATE_SIZE,
    'State-bucket bootstrap object',
  );

  const foundationPrefixUrl = `${terraformUrl}foundation/`;
  const foundationEntries = [...entries.values()].filter((entry) => (
    entry.url === foundationPrefixUrl
      || entry.url.startsWith(`${rootUrl}${FOUNDATION_STATE_OBJECT}#`)
  ));
  const expectedBaseCount = 4;
  if (foundationEntries.length === 0) {
    if (entries.size !== expectedBaseCount) reject('State-bucket inventory contains an unreviewed object or prefix');
    return Object.freeze({ state: 'absent' });
  }
  if (foundationEntries.length !== 2 || entries.size !== expectedBaseCount + 2) {
    reject('State-bucket inventory contains an invalid foundation-state boundary');
  }
  const foundationPrefix = entries.get(foundationPrefixUrl);
  if (foundationPrefix === undefined) reject('State-bucket inventory is missing the foundation prefix');
  verifyInventoryMarker(
    foundationPrefix,
    'prefix',
    foundationPrefixUrl,
    'State-bucket foundation prefix',
  );
  const foundationObjects = foundationEntries.filter((entry) => entry.type === 'cloud_object');
  if (foundationObjects.length !== 1) reject('State-bucket inventory must contain exactly one foundation state object');
  const object = verifyInventoryObject(
    foundationObjects[0],
    FOUNDATION_STATE_OBJECT,
    undefined,
    undefined,
    'State-bucket foundation object',
  );
  return Object.freeze({ state: 'present', ...object });
}

function validateStateHeader(state, path) {
  exactKeys(
    state,
    ['version', 'terraform_version', 'serial', 'lineage', 'outputs', 'resources', 'check_results'],
    path,
  );
  if (state.version !== 4
      || state.terraform_version !== TERRAFORM_VERSION
      || !Number.isSafeInteger(state.serial)
      || state.serial < 1
      || typeof state.lineage !== 'string'
      || !LINEAGE_PATTERN.test(state.lineage)) {
    reject(`${path} is not a canonical Terraform 1.11.3 state`);
  }
}

function managedInstanceCount(state) {
  if (!Array.isArray(state.resources)) reject('Terraform state resources must be an array');
  let count = 0;
  for (const resource of state.resources) {
    if (!isPlainObject(resource)) reject('Terraform state contains a malformed resource');
    if (resource.mode !== 'managed') continue;
    if (!Array.isArray(resource.instances)) reject('Terraform managed resource instances must be an array');
    count += resource.instances.length;
  }
  return count;
}

export function verifyKnownBootstrapStateFile(path) {
  const observed = readPrivateState(path, 'Bootstrap state evidence');
  if (observed.bytes.length !== BOOTSTRAP_STATE_SIZE || observed.sha256 !== BOOTSTRAP_STATE_SHA256) {
    reject('Bootstrap state evidence does not match the reconciled remote generation');
  }
  const state = observed.state;
  validateStateHeader(state, 'Bootstrap state evidence');
  const lineageSha256 = createHash('sha256').update(state.lineage).digest('hex');
  if (state.serial !== 40
      || lineageSha256 !== BOOTSTRAP_STATE_LINEAGE_SHA256
      || managedInstanceCount(state) !== 36
      || !isPlainObject(state.outputs)
      || !isPlainObject(state.outputs.foundation_activation)
      || !isDeepStrictEqual(state.outputs.foundation_activation.value, FOUNDATION_ACTIVATION)) {
    reject('Bootstrap state evidence does not contain the reconciled foundation activation');
  }
  return Object.freeze({ managedResources: 36, serial: 40, sha256: observed.sha256 });
}

export function validateEmptyFoundationPlan(value) {
  const plan = exactKeys(value, [
    'format_version',
    'terraform_version',
    'planned_values',
    'configuration',
    'timestamp',
    'applyable',
    'complete',
    'errored',
  ], 'Foundation-state initialization plan');
  const plannedValues = exactKeys(
    plan.planned_values,
    ['root_module'],
    'Foundation-state initialization planned values',
  );
  const plannedRoot = exactKeys(
    plannedValues.root_module,
    [],
    'Foundation-state initialization planned root module',
  );
  const configuration = exactKeys(
    plan.configuration,
    ['root_module'],
    'Foundation-state initialization configuration',
  );
  const configurationRoot = exactKeys(
    configuration.root_module,
    [],
    'Foundation-state initialization configuration root module',
  );
  if (plan.format_version !== '1.2'
      || plan.terraform_version !== TERRAFORM_VERSION
      || typeof plan.timestamp !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(plan.timestamp)
      || plan.applyable !== false
      || plan.complete !== true
      || plan.errored !== false
      || Object.keys(plannedRoot).length !== 0
      || Object.keys(configurationRoot).length !== 0) {
    reject('Foundation-state initialization plan is not the exact empty refresh-only plan');
  }
  return Object.freeze({ managedResources: 0, applyable: false });
}

export function validateEmptyFoundationState(state) {
  validateStateHeader(state, 'Foundation Terraform state');
  if (state.serial !== 1
      || !isPlainObject(state.outputs)
      || Object.keys(state.outputs).length !== 0
      || !Array.isArray(state.resources)
      || state.resources.length !== 0
      || state.check_results !== null) {
    reject('Foundation Terraform state is not the exact canonical empty state');
  }
  return Object.freeze({
    lineageSha256: createHash('sha256').update(state.lineage).digest('hex'),
    managedResources: 0,
    serial: 1,
  });
}

export function verifyEmptyFoundationStateFile(path) {
  const observed = readPrivateState(path, 'Foundation Terraform state');
  return Object.freeze({
    ...validateEmptyFoundationState(observed.state),
    sha256: observed.sha256,
    size: observed.bytes.length,
  });
}

export function reconcileEmptyFoundationStateFiles(pulledPath, objectPath) {
  const pulled = readPrivateState(pulledPath, 'Pulled foundation Terraform state');
  const object = readPrivateState(objectPath, 'Foundation state object');
  const validation = validateEmptyFoundationState(object.state);
  validateEmptyFoundationState(pulled.state);
  if (!isDeepStrictEqual(pulled.state, object.state)) {
    reject('Pulled foundation state does not exactly match the current GCS object');
  }
  return Object.freeze({
    ...validation,
    sha256: object.sha256,
    size: object.bytes.length,
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create-directory' && args.length === 2) {
    process.stdout.write(createPrivateExecutionDirectory(args[0], args[1]));
    return;
  }
  if (command === 'verify-authorization' && args.length === 2) {
    validateFoundationStateAuthorization(args[0], args[1]);
    return;
  }
  if (command === 'verify-project' && args.length === 0) {
    verifyProjectObservation(parseJson(await readBoundedStandardInput(), 'Project observation'));
    return;
  }
  if (command === 'inspect-bucket' && args.length === 0) {
    process.stdout.write(JSON.stringify(inspectStateBucketInventory(
      parseJson(await readBoundedStandardInput(), 'State-bucket inventory'),
    )));
    return;
  }
  if (command === 'verify-bootstrap-state' && args.length === 1) {
    process.stdout.write(JSON.stringify(verifyKnownBootstrapStateFile(args[0])));
    return;
  }
  if (command === 'verify-empty-plan' && args.length === 0) {
    process.stdout.write(JSON.stringify(validateEmptyFoundationPlan(
      parseJson(await readBoundedStandardInput(), 'Foundation-state initialization plan'),
    )));
    return;
  }
  if (command === 'verify-empty-state' && args.length === 1) {
    process.stdout.write(JSON.stringify(verifyEmptyFoundationStateFile(args[0])));
    return;
  }
  if (command === 'reconcile-empty-states' && args.length === 2) {
    process.stdout.write(JSON.stringify(reconcileEmptyFoundationStateFiles(args[0], args[1])));
    return;
  }
  reject('Usage: foundation-state.mjs <create-directory|verify-authorization|verify-project|inspect-bucket|verify-bootstrap-state|verify-empty-plan|verify-empty-state|reconcile-empty-states> ...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Foundation-state initialization rejected: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
