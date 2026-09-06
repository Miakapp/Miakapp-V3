import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWED_RELAY_SERVICE_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'README.md',
  'apply.mjs',
  'apply.sh',
  'claim.mjs',
  'cli.mjs',
  'contract.mjs',
  'foundation.tf',
  'guard.mjs',
  'inventory.mjs',
  'locals.tf',
  'main.tf',
  'outputs.tf',
  'plan.mjs',
  'plan.sh',
  'profile-v1.json',
  'profile-v2.json',
  'profile.json',
  'providers.tf',
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

const EXECUTABLE_FILES = new Set(['apply.sh', 'plan.sh']);

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
