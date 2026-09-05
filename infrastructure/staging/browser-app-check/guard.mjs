import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'README.md',
  'apply.mjs',
  'apply.sh',
  'cli.mjs',
  'contract.mjs',
  'evidence.mjs',
  'guard.mjs',
  'inventory.mjs',
  'locals.tf',
  'main.tf',
  'outputs.tf',
  'plan.mjs',
  'plan.sh',
  'providers.tf',
  'result.json',
  'state.mjs',
  'terraform-cli.tfrc',
  'validate-plan.mjs',
  'versions.tf',
]);
const ALLOWED_DIRECTORIES = Object.freeze(['.terraform', 'tests']);
const TEST_FILES = Object.freeze(['browser-app-check.tftest.hcl']);

function exact(actual, expected, description) {
  const names = new Set(actual);
  if (names.size !== actual.length
    || expected.some((name) => !names.has(name))
    || actual.some((name) => !expected.includes(name))) {
    throw new Error(`${description} must contain only the reviewed browser App Check inventory`);
  }
}

export function validateBrowserAppCheckRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const url = new URL(entry.name, rootUrl);
    if (entry.isSymbolicLink() || lstatSync(url).isSymbolicLink()) {
      throw new Error(`Browser App Check entry ${entry.name} must not be a symbolic link`);
    }
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory()) directories.push(entry.name);
    else throw new Error(`Browser App Check entry ${entry.name} has an unsupported type`);
  }
  exact(files, REQUIRED_FILES, 'Browser App Check root files');
  if (!directories.includes('tests')
    || directories.some((name) => !ALLOWED_DIRECTORIES.includes(name))) {
    throw new Error('Browser App Check directories must contain only the reviewed inventory');
  }
  const tests = readdirSync(new URL('tests/', rootUrl), { withFileTypes: true });
  if (tests.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('Browser App Check tests must contain regular files only');
  }
  exact(tests.map(({ name }) => name), TEST_FILES, 'Browser App Check tests');
  for (const executable of ['apply.sh', 'plan.sh']) {
    if ((lstatSync(new URL(executable, rootUrl)).mode & 0o111) === 0) {
      throw new Error(`${executable} must be executable`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-app-check-root>');
    process.exitCode = 2;
  } else {
    validateBrowserAppCheckRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
