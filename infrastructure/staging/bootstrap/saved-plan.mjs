import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAN_SCHEMA = 'miakapp.staging-bootstrap-plan/1';
const PLAN_FILE = 'bootstrap.tfplan';
const METADATA_FILE = 'metadata.json';
const STATE_FILE = 'bootstrap.tfstate';
const TERRAFORM_VERSION = '1.11.3';
const MAX_PLAN_JSON_BYTES = 16 * 1024 * 1024;
const MAX_PLAN_FILE_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const ADDRESS_PATTERN = /^[A-Za-z0-9_./[\]"-]{1,256}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const EXPECTED_RESOURCE_TYPE_COUNTS = Object.freeze({
  google_billing_budget: 1,
  google_billing_project_info: 1,
  google_iam_workload_identity_pool: 1,
  google_iam_workload_identity_pool_provider: 2,
  google_project_iam_member: 10,
  google_project_service: 8,
  google_service_account: 3,
  google_service_account_iam_member: 2,
  google_storage_bucket: 2,
  google_storage_bucket_iam_member: 6,
});

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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function exact(value, expected, path) {
  if (value !== expected) reject(`${path} must equal ${JSON.stringify(expected)}`);
}

function canonicalTimestamp(value, path) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    reject(`${path} must be a canonical UTC timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().replace('.000Z', 'Z') !== value) {
    reject(`${path} is not a real UTC timestamp`);
  }
  return value;
}

function parseJson(value, path) {
  try {
    return JSON.parse(value);
  } catch {
    reject(`${path} is not valid JSON`);
  }
}

function canonicalResourceChanges(plan) {
  if (!isPlainObject(plan)) reject('Terraform plan must be a JSON object');
  exact(plan.terraform_version, TERRAFORM_VERSION, 'Terraform plan version');
  if (!Array.isArray(plan.resource_changes) || plan.resource_changes.length !== 36) {
    reject('Terraform bootstrap plan must contain exactly 36 resource changes');
  }

  const seen = new Set();
  const typeCounts = new Map();
  const changes = plan.resource_changes.map((change, index) => {
    if (!isPlainObject(change)) reject(`Terraform resource change ${index} must be an object`);
    if (typeof change.address !== 'string' || !ADDRESS_PATTERN.test(change.address)) {
      reject(`Terraform resource change ${index} has an invalid address`);
    }
    if (seen.has(change.address)) reject(`Terraform resource address ${change.address} is duplicated`);
    seen.add(change.address);
    exact(change.mode, 'managed', `Terraform resource change ${change.address}.mode`);
    if (!isPlainObject(change.change) || JSON.stringify(change.change.actions) !== '["create"]') {
      reject(`Terraform resource change ${change.address} must be create-only`);
    }
    const resourceType = change.type;
    if (typeof resourceType !== 'string'
        || !Object.hasOwn(EXPECTED_RESOURCE_TYPE_COUNTS, resourceType)) {
      reject(`Terraform resource change ${change.address} has an unexpected type`);
    }
    typeCounts.set(resourceType, (typeCounts.get(resourceType) ?? 0) + 1);
    return Object.freeze({ address: change.address, actions: Object.freeze(['create']) });
  });

  for (const [type, expected] of Object.entries(EXPECTED_RESOURCE_TYPE_COUNTS)) {
    if (typeCounts.get(type) !== expected) {
      reject(`Terraform bootstrap plan must contain exactly ${expected} ${type} changes`);
    }
  }

  return changes.sort((left, right) => {
    if (left.address < right.address) return -1;
    if (left.address > right.address) return 1;
    return 0;
  });
}

export function buildSavedPlanMetadata(plan, context) {
  const values = exactKeys(context, ['configurationCommit', 'createdAt', 'planSha256'], 'Context');
  if (typeof values.configurationCommit !== 'string' || !COMMIT_PATTERN.test(values.configurationCommit)) {
    reject('Context configurationCommit must be a canonical Git commit');
  }
  if (typeof values.planSha256 !== 'string' || !SHA256_PATTERN.test(values.planSha256)) {
    reject('Context planSha256 must be a lowercase SHA-256 digest');
  }
  const changes = canonicalResourceChanges(plan);

  return {
    schema: PLAN_SCHEMA,
    environment: 'staging',
    project_id: 'miakapp-v4-staging',
    configuration_commit: values.configurationCommit,
    terraform_version: TERRAFORM_VERSION,
    created_at: canonicalTimestamp(values.createdAt, 'Context createdAt'),
    plan: {
      file: PLAN_FILE,
      sha256: values.planSha256,
      backend: 'local',
      state_file: STATE_FILE,
      state_created: false,
      change_summary: {
        create: changes.length,
        update: 0,
        delete: 0,
      },
      resource_changes: changes,
    },
    authorization: {
      apply_authorized: false,
      state_migration_authorized: false,
    },
  };
}

export function validateSavedPlanMetadata(value) {
  const metadata = exactKeys(value, [
    'schema',
    'environment',
    'project_id',
    'configuration_commit',
    'terraform_version',
    'created_at',
    'plan',
    'authorization',
  ], 'Saved-plan metadata');
  exact(metadata.schema, PLAN_SCHEMA, 'Saved-plan metadata.schema');
  exact(metadata.environment, 'staging', 'Saved-plan metadata.environment');
  exact(metadata.project_id, 'miakapp-v4-staging', 'Saved-plan metadata.project_id');
  exact(metadata.terraform_version, TERRAFORM_VERSION, 'Saved-plan metadata.terraform_version');
  if (typeof metadata.configuration_commit !== 'string'
      || !COMMIT_PATTERN.test(metadata.configuration_commit)) {
    reject('Saved-plan metadata.configuration_commit must be a canonical Git commit');
  }
  canonicalTimestamp(metadata.created_at, 'Saved-plan metadata.created_at');

  const plan = exactKeys(metadata.plan, [
    'file',
    'sha256',
    'backend',
    'state_file',
    'state_created',
    'change_summary',
    'resource_changes',
  ], 'Saved-plan metadata.plan');
  exact(plan.file, PLAN_FILE, 'Saved-plan metadata.plan.file');
  exact(plan.backend, 'local', 'Saved-plan metadata.plan.backend');
  exact(plan.state_file, STATE_FILE, 'Saved-plan metadata.plan.state_file');
  exact(plan.state_created, false, 'Saved-plan metadata.plan.state_created');
  if (typeof plan.sha256 !== 'string' || !SHA256_PATTERN.test(plan.sha256)) {
    reject('Saved-plan metadata.plan.sha256 must be a lowercase SHA-256 digest');
  }
  const summary = exactKeys(
    plan.change_summary,
    ['create', 'update', 'delete'],
    'Saved-plan metadata.plan.change_summary',
  );
  exact(summary.create, 36, 'Saved-plan metadata.plan.change_summary.create');
  exact(summary.update, 0, 'Saved-plan metadata.plan.change_summary.update');
  exact(summary.delete, 0, 'Saved-plan metadata.plan.change_summary.delete');
  if (!Array.isArray(plan.resource_changes) || plan.resource_changes.length !== 36) {
    reject('Saved-plan metadata.plan.resource_changes must contain exactly 36 entries');
  }
  const addresses = new Set();
  const typeCounts = new Map();
  let previousAddress = '';
  for (const [index, change] of plan.resource_changes.entries()) {
    exactKeys(change, ['address', 'actions'], `Saved-plan metadata.plan.resource_changes[${index}]`);
    if (typeof change.address !== 'string' || !ADDRESS_PATTERN.test(change.address)) {
      reject(`Saved-plan metadata.plan.resource_changes[${index}].address is invalid`);
    }
    if (change.address <= previousAddress || addresses.has(change.address)) {
      reject('Saved-plan metadata resource addresses must be unique and byte-sorted');
    }
    previousAddress = change.address;
    addresses.add(change.address);
    if (JSON.stringify(change.actions) !== '["create"]') {
      reject(`Saved-plan metadata.plan.resource_changes[${index}] must be create-only`);
    }
    const type = change.address.split('.')[0];
    if (!Object.hasOwn(EXPECTED_RESOURCE_TYPE_COUNTS, type)) {
      reject(`Saved-plan metadata.plan.resource_changes[${index}] has an unexpected type`);
    }
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  for (const [type, expected] of Object.entries(EXPECTED_RESOURCE_TYPE_COUNTS)) {
    if (typeCounts.get(type) !== expected) {
      reject(`Saved-plan metadata must contain exactly ${expected} ${type} changes`);
    }
  }

  const authorization = exactKeys(
    metadata.authorization,
    ['apply_authorized', 'state_migration_authorized'],
    'Saved-plan metadata.authorization',
  );
  exact(authorization.apply_authorized, false, 'Saved-plan metadata.authorization.apply_authorized');
  exact(
    authorization.state_migration_authorized,
    false,
    'Saved-plan metadata.authorization.state_migration_authorized',
  );
  return metadata;
}

export function validatePlanAgainstMetadata(plan, value) {
  const metadata = validateSavedPlanMetadata(value);
  const changes = canonicalResourceChanges(plan);
  if (JSON.stringify(changes) !== JSON.stringify(metadata.plan.resource_changes)) {
    reject('Terraform plan resource changes do not match the saved metadata');
  }
  return metadata;
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

export function createPrivateBundle(parentPath, repositoryPath) {
  if (typeof parentPath !== 'string' || !isAbsolute(parentPath) || /[\0-\x1f\x7f]/.test(parentPath)) {
    reject('Private plan parent must be an absolute path without control characters');
  }
  assertPrivateEntry(parentPath, 'Private plan parent', 'directory');
  const parent = realpathSync(parentPath);
  const repository = realpathSync(repositoryPath);
  if (containsPath(repository, parent)) reject('Private plan parent must be outside the repository');
  return mkdtempSync(join(parent, 'miakapp-staging-bootstrap-plan-'));
}

export function writeSavedPlanMetadata(path, metadata) {
  validateSavedPlanMetadata(metadata);
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

export async function sha256File(path) {
  const file = assertPrivateEntry(path, 'Saved Terraform plan', 'file');
  if (file.size === 0 || file.size > MAX_PLAN_FILE_BYTES) {
    reject('Saved Terraform plan has an invalid size');
  }
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

export async function inspectPrivateBundle(bundlePath, expectedCommit) {
  if (typeof bundlePath !== 'string' || !isAbsolute(bundlePath) || /[\0-\x1f\x7f]/.test(bundlePath)) {
    reject('Saved-plan bundle must be an absolute path without control characters');
  }
  if (typeof expectedCommit !== 'string' || !COMMIT_PATTERN.test(expectedCommit)) {
    reject('Expected commit must be a canonical Git commit');
  }
  assertPrivateEntry(bundlePath, 'Saved-plan bundle', 'directory');
  const bundle = realpathSync(bundlePath);
  const entries = readdirSync(bundle).sort();
  if (JSON.stringify(entries) !== JSON.stringify([METADATA_FILE, PLAN_FILE].sort())) {
    reject('Saved-plan bundle must contain exactly metadata.json and bootstrap.tfplan');
  }
  const metadataPath = join(bundle, METADATA_FILE);
  const planPath = join(bundle, PLAN_FILE);
  const metadataStat = assertPrivateEntry(metadataPath, 'Saved-plan metadata', 'file');
  if (metadataStat.size === 0 || metadataStat.size > MAX_METADATA_BYTES) {
    reject('Saved-plan metadata has an invalid size');
  }
  const metadata = validateSavedPlanMetadata(
    parseJson(readFileSync(metadataPath, 'utf8'), 'Saved-plan metadata'),
  );
  exact(metadata.configuration_commit, expectedCommit, 'Saved-plan metadata.configuration_commit');
  const actualDigest = await sha256File(planPath);
  exact(actualDigest, metadata.plan.sha256, 'Saved Terraform plan SHA-256');
  return metadata;
}

async function readBoundedStandardInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_PLAN_JSON_BYTES) reject('Terraform plan JSON exceeds the metadata limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function printSummary(metadata) {
  console.log(`Saved bootstrap plan: ${metadata.project_id}`);
  console.log(`Configuration commit: ${metadata.configuration_commit}`);
  console.log(`Terraform version: ${metadata.terraform_version}`);
  console.log(`Created at: ${metadata.created_at}`);
  console.log(`SHA-256: ${metadata.plan.sha256}`);
  console.log('Changes: 36 create, 0 update, 0 delete');
  for (const change of metadata.plan.resource_changes) console.log(`create: ${change.address}`);
  console.log('Apply authorized: no');
  console.log('State migration authorized: no');
}

function readMetadataFile(path) {
  const metadataStat = assertPrivateEntry(path, 'Saved-plan metadata', 'file');
  if (metadataStat.size === 0 || metadataStat.size > MAX_METADATA_BYTES) {
    reject('Saved-plan metadata has an invalid size');
  }
  return parseJson(readFileSync(path, 'utf8'), 'Saved-plan metadata');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create-bundle' && args.length === 2) {
    process.stdout.write(createPrivateBundle(args[0], resolve(args[1])));
    return;
  }
  if (command === 'sha256' && args.length === 1) {
    process.stdout.write(await sha256File(resolve(args[0])));
    return;
  }
  if (command === 'create-metadata' && args.length === 4) {
    const [metadataPath, planSha256, configurationCommit, createdAt] = args;
    const plan = parseJson(await readBoundedStandardInput(), 'Terraform plan JSON');
    const metadata = buildSavedPlanMetadata(plan, {
      configurationCommit,
      createdAt,
      planSha256,
    });
    writeSavedPlanMetadata(resolve(metadataPath), metadata);
    printSummary(metadata);
    return;
  }
  if (command === 'verify-plan' && args.length === 1) {
    const plan = parseJson(await readBoundedStandardInput(), 'Terraform plan JSON');
    validatePlanAgainstMetadata(plan, readMetadataFile(resolve(args[0])));
    return;
  }
  if (command === 'verify' && args.length === 2) {
    const metadata = await inspectPrivateBundle(args[0], args[1]);
    printSummary(metadata);
    return;
  }
  reject('Usage: saved-plan.mjs <create-bundle|sha256|create-metadata|verify-plan|verify> ...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Saved bootstrap plan rejected: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
