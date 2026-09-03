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

import {
  BOOTSTRAP_RESOURCE_ADDRESSES,
  RECOVERY_LINEAGE_SHA256,
  RECOVERY_MANAGED_ADDRESSES,
  RECOVERY_STATE_SERIAL,
  RECOVERY_STATE_SHA256,
  validateSavedPlanMetadata,
} from './saved-plan.mjs';

export const APPROVED_CONFIGURATION_COMMIT = 'e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501';
export const APPROVED_PLAN_SHA256 = '12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da';
export const APPROVED_BILLING_ACCOUNT_SHA256 = '4557923f1be719b78ee844b14bfa4654be3eb3fa785a2cb5a2624c3f85d12270';
export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const PROJECT_DISPLAY_NAME = 'Miakapp V4 Staging';
export const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
export const STATE_PREFIX = 'terraform/bootstrap';
export const STATE_OBJECT = `${STATE_PREFIX}/default.tfstate`;
export const BUDGET_DISPLAY_NAME = 'Miakapp V4 staging monthly';

const MAX_OBSERVATION_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const TERRAFORM_LINEAGE_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const BILLING_ACCOUNT_PATTERN = /^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/;
const BOOTSTRAP_SERVICE_APIS = Object.freeze([
  'billingbudgets.googleapis.com',
  'cloudbilling.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'serviceusage.googleapis.com',
  'storage.googleapis.com',
  'sts.googleapis.com',
]);

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

export function executionAuthorization(repositoryCommit) {
  if (typeof repositoryCommit !== 'string' || !COMMIT_PATTERN.test(repositoryCommit)) {
    reject('Bootstrap execution requires a canonical repository commit');
  }
  return `apply-and-migrate:${PROJECT_ID}:${APPROVED_PLAN_SHA256}:${repositoryCommit}`;
}

export function validateExecutionAuthorization(value, repositoryCommit) {
  if (value !== executionAuthorization(repositoryCommit)) {
    reject('Bootstrap execution requires the exact reviewed plan and repository-commit authorization');
  }
  return value;
}

export function createPrivateExecutionDirectory(bundlePath, repositoryPath) {
  if (typeof bundlePath !== 'string' || !isAbsolute(bundlePath) || /[\0-\x1f\x7f]/.test(bundlePath)) {
    reject('Saved-plan bundle must be an absolute path without control characters');
  }
  assertPrivateEntry(bundlePath, 'Saved-plan bundle', 'directory');
  const bundle = realpathSync(bundlePath);
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

export function verifyEnabledBootstrapServices(value) {
  if (!Array.isArray(value)) reject('Enabled-service inventory must be an array');
  const enabled = new Set(value.map((entry) => (
    isPlainObject(entry) && isPlainObject(entry.config) ? entry.config.name : undefined
  )).filter((name) => typeof name === 'string'));
  if (BOOTSTRAP_SERVICE_APIS.some((name) => !enabled.has(name))) {
    reject('Enabled-service inventory is missing a recovered bootstrap API');
  }
  return Object.freeze({ bootstrapServices: BOOTSTRAP_SERVICE_APIS.length });
}

export function classifyStateBucket(value) {
  if (!Array.isArray(value)) reject('State-bucket inventory must be an array');
  const targetCount = value.filter((entry) => (
    isPlainObject(entry) && entry.name === STATE_BUCKET
  )).length;
  if (targetCount > 1) reject('State-bucket inventory contains a duplicate target');
  return targetCount === 1 ? 'present' : 'absent';
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

function managedStateInstances(state) {
  const instances = new Map();
  if (!Array.isArray(state.resources)) reject('Terraform state resources must be an array');
  for (const resource of state.resources) {
    if (!isPlainObject(resource)) reject('Terraform state resource is malformed');
    if (resource.mode !== 'managed') continue;
    if (!Array.isArray(resource.instances) || resource.instances.length === 0) {
      reject('Terraform state managed resource must contain instances');
    }
    for (const instance of resource.instances) {
      const address = instanceAddress(resource, instance, instances.size);
      if (instances.has(address)) reject('Terraform state contains duplicate managed addresses');
      instances.set(address, { instance, resource });
    }
  }
  return instances;
}

function validateRecoveryManagedIdentities(
  state,
  expectedBillingAccountSha256 = APPROVED_BILLING_ACCOUNT_SHA256,
) {
  if (typeof expectedBillingAccountSha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(expectedBillingAccountSha256)) {
    reject('Expected recovery billing-account SHA-256 is invalid');
  }
  const instances = managedStateInstances(state);
  const billing = instances.get('google_billing_project_info.staging');
  if (billing === undefined
      || billing.instance.schema_version !== 0
      || billing.resource.provider !== 'provider["registry.terraform.io/hashicorp/google-beta"]') {
    reject('Recovery Terraform state billing-link identity is invalid');
  }
  const billingAttributes = exactKeys(
    billing.instance.attributes,
    ['billing_account', 'deletion_policy', 'id', 'project', 'timeouts'],
    'Recovery Terraform state billing-link attributes',
  );
  if (billingAttributes.id !== `projects/${PROJECT_ID}`
      || billingAttributes.project !== PROJECT_ID
      || billingAttributes.deletion_policy !== 'PREVENT'
      || billingAttributes.timeouts !== null
      || typeof billingAttributes.billing_account !== 'string'
      || !BILLING_ACCOUNT_PATTERN.test(billingAttributes.billing_account)
      || createHash('sha256').update(billingAttributes.billing_account).digest('hex')
        !== expectedBillingAccountSha256) {
    reject('Recovery Terraform state billing-link attributes are invalid');
  }

  for (const service of BOOTSTRAP_SERVICE_APIS) {
    const address = `google_project_service.bootstrap[${JSON.stringify(service)}]`;
    const entry = instances.get(address);
    if (entry === undefined
        || entry.instance.schema_version !== 0
        || entry.resource.provider !== 'provider["registry.terraform.io/hashicorp/google"]') {
      reject(`Recovery Terraform state service identity is invalid for ${service}`);
    }
    const attributes = exactKeys(
      entry.instance.attributes,
      [
        'deletion_policy',
        'disable_dependent_services',
        'disable_on_destroy',
        'id',
        'project',
        'service',
        'timeouts',
      ],
      `Recovery Terraform state service attributes for ${service}`,
    );
    if (attributes.deletion_policy !== 'PREVENT'
        || attributes.disable_dependent_services !== false
        || attributes.disable_on_destroy !== false
        || attributes.id !== `${PROJECT_ID}/${service}`
        || attributes.project !== PROJECT_ID
        || attributes.service !== service
        || attributes.timeouts !== null) {
      reject(`Recovery Terraform state service attributes are invalid for ${service}`);
    }
  }
}

function validateStateHeader(state, path) {
  if (!isPlainObject(state)
      || state.version !== 4
      || state.terraform_version !== '1.11.3'
      || !Number.isSafeInteger(state.serial)
      || state.serial < 1
      || typeof state.lineage !== 'string'
      || !TERRAFORM_LINEAGE_PATTERN.test(state.lineage)) {
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

export function reconcileBootstrapStates(
  localState,
  remoteState,
  metadataValue,
  mode,
  expectedLineageSha256,
  expectedBillingAccountSha256,
) {
  const validation = validateAppliedBootstrapState(
    localState,
    metadataValue,
    mode,
    expectedLineageSha256,
    expectedBillingAccountSha256,
  );
  validateStateHeader(remoteState, 'Remote bootstrap state');
  if (!isDeepStrictEqual(localState, remoteState)) reject('Remote bootstrap state does not exactly match local state');
  return validation;
}

export function validateAppliedBootstrapState(
  state,
  metadataValue,
  mode,
  expectedLineageSha256,
  expectedBillingAccountSha256,
) {
  const metadata = validateSavedPlanMetadata(metadataValue);
  if (mode !== 'complete' && mode !== 'partial') reject('State reconciliation mode is invalid');
  validateStateHeader(state, 'Local bootstrap state');
  if (state.serial < metadata.recovery.serial) {
    reject('Terraform state does not descend from the reviewed recovery state');
  }
  const lineageSha256 = createHash('sha256').update(state.lineage).digest('hex');
  if (lineageSha256 !== (expectedLineageSha256 ?? metadata.recovery.lineage_sha256)) {
    reject('Terraform state does not retain the reviewed recovery lineage');
  }
  validateRecoveryManagedIdentities(state, expectedBillingAccountSha256);

  const expected = metadata.plan.resource_changes.map(({ address }) => address).sort();
  const actual = managedStateAddresses(state);
  if (mode === 'complete') {
    if (!isDeepStrictEqual(actual, expected)) {
      reject('Complete Terraform state does not contain the exact reviewed resource inventory');
    }
    validateFoundationActivation(state);
  } else {
    if (actual.some((address) => !expected.includes(address))
        || RECOVERY_MANAGED_ADDRESSES.some((address) => !actual.includes(address))) {
      reject('Partial Terraform state lost recovery resources or contains unexpected inventory');
    }
    exactKeys(state.outputs, [], 'Partial Terraform state outputs');
  }
  return Object.freeze({ mode, managedResources: actual.length, serial: state.serial });
}

export function validateAppliedBootstrapStateFile(localPath, metadataPath, mode) {
  const localState = readPrivateJson(localPath, MAX_STATE_BYTES, 'Local bootstrap state');
  const metadata = readPrivateJson(metadataPath, MAX_OBSERVATION_BYTES, 'Saved-plan metadata');
  return validateAppliedBootstrapState(localState, metadata, mode);
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

export function validateRecoveryState(
  state,
  expectedLineageSha256 = RECOVERY_LINEAGE_SHA256,
  expectedBillingAccountSha256 = APPROVED_BILLING_ACCOUNT_SHA256,
) {
  if (typeof expectedLineageSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedLineageSha256)) {
    reject('Expected recovery lineage SHA-256 is invalid');
  }
  validateStateHeader(state, 'Recovery Terraform state');
  if (state.serial !== RECOVERY_STATE_SERIAL
      || createHash('sha256').update(state.lineage).digest('hex') !== expectedLineageSha256
      || !isPlainObject(state.outputs)
      || Object.keys(state.outputs).length !== 0
      || !isDeepStrictEqual(managedStateAddresses(state), [...RECOVERY_MANAGED_ADDRESSES].sort())) {
    reject('Recovery Terraform state does not contain the exact preserved partial inventory');
  }
  validateRecoveryManagedIdentities(state, expectedBillingAccountSha256);
  return Object.freeze({
    managedResources: RECOVERY_MANAGED_ADDRESSES.length,
    serial: state.serial,
  });
}

export function validateRecoveryDescendantState(
  state,
  expectedLineageSha256 = RECOVERY_LINEAGE_SHA256,
  expectedBillingAccountSha256 = APPROVED_BILLING_ACCOUNT_SHA256,
) {
  if (typeof expectedLineageSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedLineageSha256)) {
    reject('Expected recovery lineage SHA-256 is invalid');
  }
  validateStateHeader(state, 'Recovery-descendant Terraform state');
  const actualLineageSha256 = createHash('sha256').update(state.lineage).digest('hex');
  const actual = managedStateAddresses(state);
  if (state.serial < RECOVERY_STATE_SERIAL
      || actualLineageSha256 !== expectedLineageSha256
      || !isPlainObject(state.outputs)
      || actual.some((address) => !BOOTSTRAP_RESOURCE_ADDRESSES.includes(address))
      || RECOVERY_MANAGED_ADDRESSES.some((address) => !actual.includes(address))) {
    reject('Terraform state does not descend from the exact preserved recovery state');
  }
  validateRecoveryManagedIdentities(state, expectedBillingAccountSha256);
  return Object.freeze({ managedResources: actual.length, serial: state.serial });
}

export function verifyRecoveryDescendantStateFile(localPath) {
  const localState = readPrivateJson(
    localPath,
    MAX_STATE_BYTES,
    'Recovery-descendant Terraform state',
  );
  return validateRecoveryDescendantState(localState);
}

export function verifyRecoveryStateFile(localPath, repositoryPath) {
  if (typeof localPath !== 'string' || !isAbsolute(localPath) || /[\0-\x1f\x7f]/.test(localPath)) {
    reject('Recovery Terraform state must be an absolute path without control characters');
  }
  if (typeof repositoryPath !== 'string' || !isAbsolute(repositoryPath)) {
    reject('Recovery Terraform state verification requires an absolute repository path');
  }
  if (lstatSync(localPath).isSymbolicLink()) {
    reject('Recovery Terraform state must not be a symbolic link');
  }
  const canonicalPath = realpathSync(localPath);
  const repository = realpathSync(repositoryPath);
  if (containsPath(repository, canonicalPath)) {
    reject('Recovery Terraform state must remain outside the repository');
  }
  assertPrivateEntry(dirname(canonicalPath), 'Recovery Terraform state parent', 'directory');
  const entry = assertPrivateEntry(canonicalPath, 'Recovery Terraform state', 'file');
  if (entry.size === 0 || entry.size > MAX_STATE_BYTES) {
    reject('Recovery Terraform state has an invalid size');
  }
  const bytes = readFileSync(canonicalPath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== RECOVERY_STATE_SHA256) {
    reject('Recovery Terraform state does not match the preserved state SHA-256');
  }
  const state = parseJson(bytes.toString('utf8'), 'Recovery Terraform state');
  const validated = validateRecoveryState(state);
  return Object.freeze({
    ...validated,
    sha256: actualSha256,
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create-directory' && args.length === 2) {
    process.stdout.write(createPrivateExecutionDirectory(args[0], args[1]));
    return;
  }
  if (command === 'verify-authorization' && args.length === 2) {
    validateExecutionAuthorization(args[0], args[1]);
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
  if (command === 'verify-enabled-bootstrap-services' && args.length === 0) {
    const result = verifyEnabledBootstrapServices(
      parseJson(await readBoundedStandardInput(), 'Enabled-service inventory'),
    );
    console.log(`Recovered bootstrap services enabled: ${result.bootstrapServices}`);
    return;
  }
  if (command === 'classify-state-bucket' && args.length === 0) {
    process.stdout.write(classifyStateBucket(
      parseJson(await readBoundedStandardInput(), 'State-bucket inventory'),
    ));
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
  if (command === 'verify-recovery-state' && args.length === 2) {
    const result = verifyRecoveryStateFile(args[0], args[1]);
    console.log(`Recovery bootstrap state verified: managed resources: ${result.managedResources}; serial: ${result.serial}`);
    return;
  }
  if (command === 'verify-recovery-descendant-state' && args.length === 1) {
    const result = verifyRecoveryDescendantStateFile(args[0]);
    console.log(`Recovery-descendant bootstrap state verified: managed resources: ${result.managedResources}; serial: ${result.serial}`);
    return;
  }
  if (command === 'verify-applied-state' && args.length === 3) {
    const result = validateAppliedBootstrapStateFile(args[0], args[1], args[2]);
    console.log(`Applied bootstrap state verified: ${result.mode}; managed resources: ${result.managedResources}; serial: ${result.serial}`);
    return;
  }
  if (command === 'reconcile-state' && args.length === 4) {
    const result = reconcileBootstrapStateFiles(args[0], args[1], args[2], args[3]);
    console.log(`Bootstrap state reconciled: ${result.mode}; managed resources: ${result.managedResources}; serial: ${result.serial}`);
    return;
  }
  reject('Usage: bootstrap-execution.mjs <create-directory|verify-authorization|verify-project|verify-billing-link|verify-empty-inventory|verify-absent-targets|verify-provisioned-targets|verify-enabled-bootstrap-services|classify-state-bucket|verify-state-object|verify-recoverable-state|verify-recovery-state|verify-recovery-descendant-state|verify-applied-state|reconcile-state> ...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Bootstrap execution rejected: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
