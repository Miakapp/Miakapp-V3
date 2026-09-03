import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'README.md',
  'apply-and-migrate.sh',
  'backend.gcs.tf.example',
  'billing.tf',
  'bootstrap-execution.mjs',
  'guard.mjs',
  'iam.tf',
  'identity.tf',
  'imports.tf',
  'inspect-plan.sh',
  'locals.tf',
  'outputs.tf',
  'plan.sh',
  'providers.tf',
  'save-plan.sh',
  'saved-plan.mjs',
  'state.tf',
  'terraform-cli.tfrc',
  'variables.tf',
  'versions.tf',
]);

const ALLOWED_DIRECTORIES = Object.freeze(['.terraform', 'tests']);
const ALLOWED_TEST_FILES = Object.freeze(['bootstrap.tftest.hcl']);

function exactNames(actual, expected, path) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${path} must contain only the reviewed bootstrap inventory`);
  }
}

export function validateBootstrapRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const entryUrl = new URL(entry.name, rootUrl);
    if (entry.isSymbolicLink() || lstatSync(entryUrl).isSymbolicLink()) {
      throw new Error(`Bootstrap entry ${entry.name} must not be a symbolic link`);
    }
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory()) directories.push(entry.name);
    else throw new Error(`Bootstrap entry ${entry.name} has an unsupported file type`);
  }
  exactNames(files, ALLOWED_FILES, 'Bootstrap root files');
  const unexpectedDirectories = directories.filter((name) => !ALLOWED_DIRECTORIES.includes(name));
  if (unexpectedDirectories.length !== 0 || !directories.includes('tests')) {
    throw new Error('Bootstrap root directories must contain only the reviewed inventory');
  }

  const testUrl = new URL('tests/', rootUrl);
  const testEntries = readdirSync(testUrl, { withFileTypes: true });
  if (testEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('Bootstrap tests must contain regular files only');
  }
  exactNames(testEntries.map((entry) => entry.name), ALLOWED_TEST_FILES, 'Bootstrap test files');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <bootstrap-root>');
    process.exitCode = 2;
  } else {
    const rootUrl = pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`);
    validateBootstrapRoot(rootUrl);
  }
}
