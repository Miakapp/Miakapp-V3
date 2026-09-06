import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWED_RELAY_SERVICE_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'README.md',
  'apply.mjs',
  'apply.sh',
  'bootstrap-failure-v1.json',
  'claim.mjs',
  'cli.mjs',
  'contract.mjs',
  'foundation.tf',
  'guard.mjs',
  'inventory.mjs',
  'locals.tf',
  'main.tf',
  'memory-recovery-failure-v1.json',
  'private-ready-result-v1.json',
  'outputs.tf',
  'plan.mjs',
  'plan.sh',
  'profile-v1.json',
  'profile-v2.json',
  'profile-v3.json',
  'profile-v4.json',
  'profile-v5.json',
  'profile.json',
  'providers.tf',
  'recovery-apply.mjs',
  'recovery-apply.sh',
  'recovery-claim.mjs',
  'recovery-plan.mjs',
  'recovery-plan.sh',
  'ready-apply.mjs',
  'ready-apply.sh',
  'ready-claim.mjs',
  'ready-plan.mjs',
  'ready-plan.sh',
  'terraform-cli.tfrc',
  'validate-plan.mjs',
  'variables.tf',
  'versions.tf',
]);
export const ALLOWED_RELAY_SERVICE_TEST_FILES = Object.freeze([
  'browser-relay-services.tftest.hcl',
]);
const ALLOWED_DIRECTORIES = Object.freeze(['.terraform', 'tests']);

function exactNames(actual, expected, path) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${path} must contain only the reviewed relay-services inventory`);
  }
}

const EXECUTABLE_FILES = new Set([
  'apply.sh', 'plan.sh', 'recovery-apply.sh', 'recovery-plan.sh',
  'ready-apply.sh', 'ready-plan.sh',
]);

function validateRegularFile(url, description, executable = false) {
  const entry = lstatSync(url);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`${description} must be a regular file`);
  }
  if (executable ? (entry.mode & 0o111) === 0 : (entry.mode & 0o111) !== 0) {
    throw new Error(`${description} has unexpected executable permissions`);
  }
}

export function validateRelayServicesRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const url = new URL(entry.name, rootUrl);
    if (entry.isSymbolicLink() || lstatSync(url).isSymbolicLink()) {
      throw new Error(`Relay-services entry ${entry.name} must not be a symbolic link`);
    }
    if (entry.isFile()) {
      files.push(entry.name);
      validateRegularFile(
        url,
        `Relay-services entry ${entry.name}`,
        EXECUTABLE_FILES.has(entry.name),
      );
    } else if (entry.isDirectory()) {
      directories.push(entry.name);
    } else {
      throw new Error(`Relay-services entry ${entry.name} has an unsupported file type`);
    }
  }
  exactNames(files, ALLOWED_RELAY_SERVICE_FILES, 'Relay-services root files');
  const unexpectedDirectories = directories.filter((name) => !ALLOWED_DIRECTORIES.includes(name));
  if (unexpectedDirectories.length !== 0 || !directories.includes('tests')) {
    throw new Error('Relay-services root directories must contain only tests and an optional Terraform cache');
  }

  const testUrl = new URL('tests/', rootUrl);
  const tests = readdirSync(testUrl, { withFileTypes: true });
  for (const entry of tests) {
    validateRegularFile(new URL(entry.name, testUrl), `Relay-services test ${entry.name}`);
  }
  exactNames(
    tests.map(({ name }) => name),
    ALLOWED_RELAY_SERVICE_TEST_FILES,
    'Relay-services test files',
  );

  const consumedEntrypoints = ['apply.mjs', 'plan.mjs']
    .map((name) => readFileSync(new URL(name, rootUrl), 'utf8'));
  const consumedRecoveryEntrypoints = ['recovery-apply.mjs', 'recovery-plan.mjs']
    .map((name) => readFileSync(new URL(name, rootUrl), 'utf8'));
  const recoveryClaim = readFileSync(new URL('recovery-claim.mjs', rootUrl), 'utf8');
  const recoveryApply = readFileSync(new URL('recovery-apply.mjs', rootUrl), 'utf8');
  const recoveryPlan = readFileSync(new URL('recovery-plan.mjs', rootUrl), 'utf8');
  const readyClaim = readFileSync(new URL('ready-claim.mjs', rootUrl), 'utf8');
  const readyApply = readFileSync(new URL('ready-apply.mjs', rootUrl), 'utf8');
  const readyPlan = readFileSync(new URL('ready-plan.mjs', rootUrl), 'utf8');
  if (consumedEntrypoints.some((source) => (
    !source.includes('export const RELAY_SERVICES_BOOTSTRAP_OPERATION_CONSUMED = true')
      || !source.includes('if (RELAY_SERVICES_BOOTSTRAP_OPERATION_CONSUMED)')
  ))
    || consumedRecoveryEntrypoints.some((source) => (
      !source.includes('export const RELAY_SERVICES_MEMORY_RECOVERY_OPERATION_CONSUMED = true')
        || !source.includes('if (RELAY_SERVICES_MEMORY_RECOVERY_OPERATION_CONSUMED)')
    ))
    || [readyApply, readyPlan].some((source) => (
      !source.includes('export const RELAY_SERVICES_PRIVATE_READY_OPERATION_CONSUMED = true')
        || !source.includes('if (RELAY_SERVICES_PRIVATE_READY_OPERATION_CONSUMED)')
    ))
    || !recoveryClaim.includes("url.searchParams.set('ifGenerationMatch', '0')")
    || !recoveryApply.includes('validateRelayServicesRecoveredInventory')
    || !recoveryPlan.includes('readAndValidateRecoveryRelayServicesPlan')
    || !readyClaim.includes("url.searchParams.set('ifGenerationMatch', '0')")
    || !readyApply.includes('validateRelayServicesPrivateReadyInventory')
    || !readyPlan.includes('readAndValidatePrivateReadyRelayServicesPlan')
    || /gcloud[\s\S]{0,80}(?:run deploy|storage rm)|allUsers|allAuthenticatedUsers/u
      .test(`${recoveryClaim}\n${recoveryApply}\n${recoveryPlan}\n${readyClaim}\n${readyApply}\n${readyPlan}`)) {
    throw new Error('Relay-services transition source differs from the reviewed one-shot boundary');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-services-root>');
    process.exitCode = 2;
  } else {
    validateRelayServicesRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
