import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'README.md',
  'bootstrap.tf',
  'foundation.tf',
  'foundation-state.mjs',
  'guard.mjs',
  'iam.tf',
  'initialize-state.sh',
  'locals.tf',
  'outputs.tf',
  'plan.sh',
  'providers.tf',
  'services.tf',
  'terraform-cli.tfrc',
  'versions.tf',
]);

const ALLOWED_DIRECTORIES = Object.freeze(['.terraform', 'tests']);
const ALLOWED_TEST_FILES = Object.freeze(['foundation.tftest.hcl']);

function exactNames(actual, expected, path) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${path} must contain only the reviewed Terraform inventory`);
  }
}

export function validateTerraformRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const entryUrl = new URL(entry.name, rootUrl);
    if (entry.isSymbolicLink() || lstatSync(entryUrl).isSymbolicLink()) {
      throw new Error(`Terraform entry ${entry.name} must not be a symbolic link`);
    }
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory()) directories.push(entry.name);
    else throw new Error(`Terraform entry ${entry.name} has an unsupported file type`);
  }
  exactNames(files, ALLOWED_FILES, 'Terraform root files');
  const unexpectedDirectories = directories.filter((name) => !ALLOWED_DIRECTORIES.includes(name));
  if (unexpectedDirectories.length !== 0 || !directories.includes('tests')) {
    throw new Error('Terraform root directories must contain only the reviewed inventory');
  }

  const testUrl = new URL('tests/', rootUrl);
  const testEntries = readdirSync(testUrl, { withFileTypes: true });
  if (testEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('Terraform tests must contain regular files only');
  }
  exactNames(testEntries.map((entry) => entry.name), ALLOWED_TEST_FILES, 'Terraform test files');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <terraform-root>');
    process.exitCode = 2;
  } else {
    const rootUrl = pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`);
    validateTerraformRoot(rootUrl);
  }
}
