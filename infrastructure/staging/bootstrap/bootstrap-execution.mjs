import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSavedPlanMetadata } from './saved-plan.mjs';

export const APPROVED_CONFIGURATION_COMMIT = '6340bffbddcc4797067ef48170fc5c3524345bf2';
export const APPROVED_PLAN_SHA256 = '6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457';
export const APPROVED_BILLING_ACCOUNT_SHA256 = '4557923f1be719b78ee844b14bfa4654be3eb3fa785a2cb5a2624c3f85d12270';
export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const PROJECT_DISPLAY_NAME = 'Miakapp V4 Staging';
export const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
export const STATE_PREFIX = 'terraform/bootstrap';
export const STATE_OBJECT = `${STATE_PREFIX}/default.tfstate`;
export const EXECUTION_AUTHORIZATION = `apply-and-migrate:${PROJECT_ID}:${APPROVED_PLAN_SHA256}`;
export const BUDGET_DISPLAY_NAME = 'Miakapp V4 staging monthly';

const MAX_OBSERVATION_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BILLING_ACCOUNT_PATTERN = /^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/;

export const FOUNDATION_ACTIVATION = Object.freeze({
  schema: 'miakapp.staging-bootstrap/1',
  project_id: PROJECT_ID,
  project_number: PROJECT_NUMBER,
  region: 'europe-west9',
  state_bucket: STATE_BUCKET,
  bootstrap_prefix: STATE_PREFIX,
  foundation_prefix: 'terraform/foundation',
  planner_service_account: `miakapp-tf-plan@${PROJECT_ID}.iam.gserviceaccount.com`,
  deployer_service_account: `miakapp-tf-apply@${PROJECT_ID}.iam.gserviceaccount.com`,
  runtime_service_account: `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`,
  component_bucket: 'miakapp-v4-staging-components',
  plan_provider: `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan`,
  apply_provider: `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply`,
  github_repository_id: '354682190',
  github_repository_owner_id: '83046838',
});
export const FOUNDATION_ACTIVATION_TYPE = Object.freeze([
  'object',
  Object.freeze(Object.fromEntries(
    Object.keys(FOUNDATION_ACTIVATION).map((key) => [key, 'string']),
  )),
]);

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

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    reject(`${path} is not valid JSON`);
  }
}

function readPrivateJson(path, maximumBytes, kind) {
  const entry = assertPrivateEntry(path, kind, 'file');
  if (entry.size === 0 || entry.size > maximumBytes) reject(`${kind} has an invalid size`);
  return parseJson(readFileSync(path, 'utf8'), kind);
}

async function readBoundedStandardInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_OBSERVATION_BYTES) reject('Cloud observation exceeds the execution limit');
    chunks.push(chunk);
  }
  if (bytes === 0) reject('Cloud observation is empty');
  return Buffer.concat(chunks).toString('utf8');
}

export function validateExecutionAuthorization(value) {
  if (value !== EXECUTION_AUTHORIZATION) {
    reject('Bootstrap execution requires the exact reviewed apply-and-migrate authorization');
  }
  return value;
}

export function createPrivateExecutionDirectory(bundlePath, repositoryPath) {
  if (typeof bundlePath !== 'string' || !isAbsolute(bundlePath) || /[\0-\x1f\x7f]/.test(bundlePath)) {
    reject('Saved-plan bundle must be an absolute path without control characters');
  }
  const bundle = realpathSync(bundlePath);
  assertPrivateEntry(bundle, 'Saved-plan bundle', 'directory');
  const parent = realpathSync(dirname(bundle));
  assertPrivateEntry(parent, 'Private execution parent', 'directory');
  const repository = realpathSync(repositoryPath);
  if (containsPath(repository, parent)) reject('Private execution parent must be outside the repository');
  const execution = mkdtempSync(join(parent, 'miakapp-staging-bootstrap-execution-'));
  assertPrivateEntry(execution, 'Private execution directory', 'directory');
  return execution;
}

export function verifyProjectObservation(value) {
  if (!isPlainObject(value)) reject('Project observation must be an object');
  if (value.projectId !== PROJECT_ID
      || String(value.projectNumber) !== PROJECT_NUMBER
      || value.name !== PROJECT_DISPLAY_NAME
      || value.lifecycleState !== 'ACTIVE') {
    reject('The observed project is not the reviewed active staging project');
  }
  return value;
}

export function verifyBillingObservation(value, expectedFingerprint = APPROVED_BILLING_ACCOUNT_SHA256) {
  if (!isPlainObject(value)
      || value.projectId !== PROJECT_ID
      || value.billingEnabled !== true
      || typeof value.billingAccountName !== 'string') {
    reject('The staging project is not linked to the reviewed billing account');
  }
  const prefix = 'billingAccounts/';
  if (!value.billingAccountName.startsWith(prefix)) {
    reject('The staging project billing account name is malformed');
  }
  const billingAccountId = value.billingAccountName.slice(prefix.length);
  if (!BILLING_ACCOUNT_PATTERN.test(billingAccountId)) {
    reject('The staging project billing account identifier is malformed');
  }
  const fingerprint = createHash('sha256').update(billingAccountId).digest('hex');
  if (fingerprint !== expectedFingerprint) {
    reject('The staging project is linked to a different billing account');
  }
  return billingAccountId;
}

export function verifyEmptyInventory(value, label) {
  if (typeof label !== 'string' || !/^[a-z-]{1,64}$/.test(label)) reject('Inventory label is invalid');
  if (!Array.isArray(value)) reject(`${label} inventory must be an array`);
  if (value.length !== 0) reject(`${label} inventory is not empty`);
}

export function verifyAbsentTargetInventory(value, label) {
  if (!Array.isArray(value)) reject(`${label} inventory must be an array`);
  let containsTarget;
  switch (label) {
    case 'budgets':
      containsTarget = value.some((entry) => isPlainObject(entry)
        && entry.displayName === BUDGET_DISPLAY_NAME);
      break;
    case 'storage-buckets':
      containsTarget = value.some((entry) => isPlainObject(entry)
        && (entry.name === STATE_BUCKET || entry.name === 'miakapp-v4-staging-components'));
      break;
    case 'service-accounts':
      containsTarget = value.some((entry) => isPlainObject(entry) && [
        `miakapp-tf-plan@${PROJECT_ID}.iam.gserviceaccount.com`,
        `miakapp-tf-apply@${PROJECT_ID}.iam.gserviceaccount.com`,
        `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`,
      ].includes(entry.email));
      break;
    case 'workload-identity-pools':
      containsTarget = value.some((entry) => isPlainObject(entry)
        && typeof entry.name === 'string'
        && entry.name.endsWith('/workloadIdentityPools/miakapp-github'));
      break;
    default:
      reject('Target inventory label is invalid');
  }
  if (containsTarget) reject(`${label} already contains a bootstrap target`);
}

export function verifyProvisionedTargetInventory(value, label) {
  if (!Array.isArray(value)) reject(`${label} inventory must be an array`);
  if (label !== 'budgets') reject('Provisioned target inventory label is invalid');
  const targetCount = value.filter((entry) => isPlainObject(entry)
    && entry.displayName === BUDGET_DISPLAY_NAME).length;
  if (targetCount !== 1) reject(`${label} must contain exactly one bootstrap target`);
}

export function verifyRemoteStateObject(value) {
  if (!isPlainObject(value)
      || value.bucket !== STATE_BUCKET
      || value.name !== STATE_OBJECT
      || !/^\d+$/.test(String(value.generation))
      || BigInt(value.generation) <= 0n
      || !/^\d+$/.test(String(value.size))
      || BigInt(value.size) <= 0n
      || value.timeDeleted !== undefined
      || value.softDeleteTime !== undefined) {
    reject('The remote bootstrap state object metadata is invalid');
  }
  return Object.freeze({ generation: String(value.generation), size: String(value.size) });
}

function instanceAddress(resource, instance, index) {
  if (!isPlainObject(resource) || resource.mode !== 'managed' || typeof resource.type !== 'string'
      || typeof resource.name !== 'string' || resource.module !== undefined || !isPlainObject(instance)) {
    reject(`Terraform state managed instance ${index} is malformed`);
  }
  let suffix = '';
  if (Object.hasOwn(instance, 'index_key')) {
    if (typeof instance.index_key === 'string') suffix = `[${JSON.stringify(instance.index_key)}]`;
    else if (Number.isSafeInteger(instance.index_key) && instance.index_key >= 0) suffix = `[${instance.index_key}]`;
    else reject(`Terraform state managed instance ${index} has an invalid index key`);
  }
  return `${resource.type}.${resource.name}${suffix}`;
}

function managedStateAddresses(state) {
  if (!Array.isArray(state.resources)) reject('Terraform state resources must be an array');
  const addresses = [];
  for (const resource of state.resources) {
    if (!isPlainObject(resource)) reject('Terraform state resource is malformed');
    if (resource.mode !== 'managed') continue;
    if (!Array.isArray(resource.instances) || resource.instances.length === 0) {
      reject('Terraform state managed resource must contain instances');
    }
    for (const instance of resource.instances) addresses.push(instanceAddress(resource, instance, addresses.length));
  }
  addresses.sort();
  if (new Set(addresses).size !== addresses.length) reject('Terraform state contains duplicate managed addresses');
  return addresses;
}

function validateStateHeader(state, path) {
  if (!isPlainObject(state)
      || state.version !== 4
      || state.terraform_version !== '1.11.3'
      || !Number.isSafeInteger(state.serial)
      || state.serial < 1
      || typeof state.lineage !== 'string'
      || !UUID_PATTERN.test(state.lineage)) {
    reject(`${path} is not a canonical Terraform 1.11.3 state`);
  }
}

function validateFoundationActivation(state) {
  exactKeys(
    state.outputs,
    ['foundation_activation'],
    'Complete Terraform state outputs',
  );
  const activation = exactKeys(
    state.outputs.foundation_activation,
    ['sensitive', 'type', 'value'],
    'Complete Terraform state foundation_activation output',
  );
  if (activation.sensitive !== false
      || !isDeepStrictEqual(activation.type, FOUNDATION_ACTIVATION_TYPE)
      || !isDeepStrictEqual(activation.value, FOUNDATION_ACTIVATION)) {
    reject('Complete Terraform state foundation_activation output does not match the reviewed identity');
  }
}

export function reconcileBootstrapStates(localState, remoteState, metadataValue, mode) {
  const metadata = validateSavedPlanMetadata(metadataValue);
  if (mode !== 'complete' && mode !== 'partial') reject('State reconciliation mode is invalid');
  validateStateHeader(localState, 'Local bootstrap state');
  validateStateHeader(remoteState, 'Remote bootstrap state');
  if (!isDeepStrictEqual(localState, remoteState)) reject('Remote bootstrap state does not exactly match local state');

  const expected = metadata.plan.resource_changes.map(({ address }) => address).sort();
  const actual = managedStateAddresses(localState);
  if (mode === 'complete') {
    if (!isDeepStrictEqual(actual, expected)) {
      reject('Complete Terraform state does not contain the exact reviewed resource inventory');
    }
    validateFoundationActivation(localState);
  } else {
    if (actual.length === 0 || actual.some((address) => !expected.includes(address))) {
      reject('Partial Terraform state contains an empty or unexpected managed inventory');
    }
  }
  return Object.freeze({ mode, managedResources: actual.length, serial: localState.serial });
}

export function reconcileBootstrapStateFiles(localPath, remotePath, metadataPath, mode) {
  const localState = readPrivateJson(localPath, MAX_STATE_BYTES, 'Local bootstrap state');
  const remoteState = readPrivateJson(remotePath, MAX_STATE_BYTES, 'Remote bootstrap state');
  const metadata = readPrivateJson(metadataPath, MAX_OBSERVATION_BYTES, 'Saved-plan metadata');
  return reconcileBootstrapStates(localState, remoteState, metadata, mode);
}

export function verifyRecoverableLocalStateFile(localPath) {
  const localState = readPrivateJson(localPath, MAX_STATE_BYTES, 'Local bootstrap state');
  validateStateHeader(localState, 'Local bootstrap state');
  const managedResources = managedStateAddresses(localState).length;
  if (managedResources === 0) reject('Failed bootstrap state contains no managed resources to migrate');
  return Object.freeze({ managedResources, serial: localState.serial });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create-directory' && args.length === 2) {
    process.stdout.write(createPrivateExecutionDirectory(args[0], args[1]));
    return;
  }
  if (command === 'verify-authorization' && args.length === 1) {
    validateExecutionAuthorization(args[0]);
    return;
  }
  if (command === 'verify-project' && args.length === 0) {
    verifyProjectObservation(parseJson(await readBoundedStandardInput(), 'Project observation'));
    return;
  }
  if (command === 'verify-billing-link' && args.length === 0) {
    const billingAccountId = verifyBillingObservation(
      parseJson(await readBoundedStandardInput(), 'Billing observation'),
    );
    process.stdout.write(billingAccountId);
    return;
  }
  if (command === 'verify-empty-inventory' && args.length === 1) {
    verifyEmptyInventory(parseJson(await readBoundedStandardInput(), `${args[0]} inventory`), args[0]);
    return;
  }
  if (command === 'verify-absent-targets' && args.length === 1) {
    verifyAbsentTargetInventory(
      parseJson(await readBoundedStandardInput(), `${args[0]} inventory`),
      args[0],
    );
    return;
  }
  if (command === 'verify-provisioned-targets' && args.length === 1) {
    verifyProvisionedTargetInventory(
      parseJson(await readBoundedStandardInput(), `${args[0]} inventory`),
      args[0],
    );
    return;
  }
  if (command === 'verify-state-object' && args.length === 0) {
    const observation = verifyRemoteStateObject(
      parseJson(await readBoundedStandardInput(), 'Remote state object observation'),
    );
    console.log(`Remote bootstrap state generation: ${observation.generation}; bytes: ${observation.size}`);
    return;
  }
  if (command === 'verify-recoverable-state' && args.length === 1) {
    const result = verifyRecoverableLocalStateFile(args[0]);
    console.log(`Recoverable bootstrap state: managed resources: ${result.managedResources}; serial: ${result.serial}`);
    return;
  }
  if (command === 'reconcile-state' && args.length === 4) {
    const result = reconcileBootstrapStateFiles(args[0], args[1], args[2], args[3]);
    console.log(`Bootstrap state reconciled: ${result.mode}; managed resources: ${result.managedResources}; serial: ${result.serial}`);
    return;
  }
  reject('Usage: bootstrap-execution.mjs <create-directory|verify-authorization|verify-project|verify-billing-link|verify-empty-inventory|verify-absent-targets|verify-provisioned-targets|verify-state-object|verify-recoverable-state|reconcile-state> ...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Bootstrap execution rejected: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
