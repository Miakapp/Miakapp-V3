import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'README.md',
  'apply.mjs',
  'apply.sh',
  'contract.mjs',
  'evidence.mjs',
  'foundation.tf',
  'guard.mjs',
  'iam.tf',
  'inventory.mjs',
  'locals.tf',
  'outputs.tf',
  'plan.mjs',
  'plan.sh',
  'providers.tf',
  'result.json',
  'runtime-config.json',
  'runtime-apply.sh',
  'runtime-plan.sh',
  'terraform-cli.tfrc',
  'update-apply.mjs',
  'update-apply.sh',
  'update-plan.mjs',
  'update-plan.sh',
  'validate-plan.mjs',
  'variables.tf',
  'versions.tf',
  'workload.tf',
]);
const ALLOWED_DIRECTORIES = Object.freeze(['.terraform', 'tests']);
const ALLOWED_TEST_FILES = Object.freeze(['synthetic-source.txt', 'workload.tftest.hcl']);

function exactNames(actual, expected, path) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${path} must contain only the reviewed workload inventory`);
  }
}

export function validateWorkloadRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const url = new URL(entry.name, rootUrl);
    if (entry.isSymbolicLink() || lstatSync(url).isSymbolicLink()) {
      throw new Error(`Workload entry ${entry.name} must not be a symbolic link`);
    }
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory()) directories.push(entry.name);
    else throw new Error(`Workload entry ${entry.name} has an unsupported file type`);
  }
  exactNames(files, ALLOWED_FILES, 'Workload root files');
  const unexpectedDirectories = directories.filter((name) => !ALLOWED_DIRECTORIES.includes(name));
  if (unexpectedDirectories.length !== 0 || !directories.includes('tests')) {
    throw new Error('Workload root directories must contain only the reviewed inventory');
  }
  const tests = readdirSync(new URL('tests/', rootUrl), { withFileTypes: true });
  if (tests.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('Workload test entries must be regular files');
  }
  exactNames(tests.map(({ name }) => name), ALLOWED_TEST_FILES, 'Workload test files');
  for (const executable of [
    'apply.sh',
    'plan.sh',
    'runtime-apply.sh',
    'runtime-plan.sh',
    'update-apply.sh',
    'update-plan.sh',
  ]) {
    if ((lstatSync(new URL(executable, rootUrl)).mode & 0o111) === 0) {
      throw new Error(`${executable} must be executable`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <workload-root>');
    process.exitCode = 2;
  } else {
    validateWorkloadRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
