import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'README.md',
  'apply.mjs',
  'apply.sh',
  'contract.mjs',
  'guard.mjs',
  'invoke.mjs',
  'invoke.sh',
  'locals.tf',
  'outputs.tf',
  'plan.mjs',
  'plan.sh',
  'providers.tf',
  'terraform-cli.tfrc',
  'validate-plan.mjs',
  'versions.tf',
  'workload.tf',
]);
const OPTIONAL_FILES = Object.freeze(['result.json']);
const ALLOWED_DIRECTORIES = Object.freeze(['.terraform', 'tests']);
const TEST_FILES = Object.freeze(['probe.tftest.hcl']);

function exactNames(actual, required, optional, description) {
  const names = new Set(actual);
  const missing = required.filter((name) => !names.has(name));
  const unexpected = actual.filter((name) => !required.includes(name) && !optional.includes(name));
  if (missing.length !== 0 || unexpected.length !== 0 || names.size !== actual.length) {
    throw new Error(`${description} must contain only the reviewed private-probe inventory`);
  }
}

export function validateProbeRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const url = new URL(entry.name, rootUrl);
    if (entry.isSymbolicLink() || lstatSync(url).isSymbolicLink()) {
      throw new Error(`Private-probe entry ${entry.name} must not be a symbolic link`);
    }
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory()) directories.push(entry.name);
    else throw new Error(`Private-probe entry ${entry.name} has an unsupported file type`);
  }
  exactNames(files, REQUIRED_FILES, OPTIONAL_FILES, 'Private-probe root files');
  const unexpectedDirectories = directories.filter((name) => !ALLOWED_DIRECTORIES.includes(name));
  if (unexpectedDirectories.length !== 0 || !directories.includes('tests')) {
    throw new Error('Private-probe directories must contain only the reviewed inventory');
  }
  const tests = readdirSync(new URL('tests/', rootUrl), { withFileTypes: true });
  if (tests.some((entry) => !entry.isFile() || entry.isSymbolicLink())
    || JSON.stringify(tests.map(({ name }) => name).sort()) !== JSON.stringify([...TEST_FILES].sort())) {
    throw new Error('Private-probe tests must contain only the reviewed inventory');
  }
  for (const executable of ['apply.sh', 'invoke.sh', 'plan.sh']) {
    if ((lstatSync(new URL(executable, rootUrl)).mode & 0o111) === 0) {
      throw new Error(`${executable} must be executable`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <private-probe-root>');
    process.exitCode = 2;
  } else {
    validateProbeRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
