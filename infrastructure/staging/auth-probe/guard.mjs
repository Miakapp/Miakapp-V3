import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  '.terraform.lock.hcl',
  'README.md',
  'apply.mjs',
  'apply.sh',
  'cli.mjs',
  'contract.mjs',
  'guard.mjs',
  'invoke.mjs',
  'invoke.sh',
  'inventory.mjs',
  'locals.tf',
  'main.tf',
  'outputs.tf',
  'plan.mjs',
  'plan.sh',
  'providers.tf',
  'retire-apply.mjs',
  'retire-apply.sh',
  'retire-plan.mjs',
  'retire-plan.sh',
  'retire-recovery-apply.mjs',
  'retire-recovery-apply.sh',
  'retire-recovery-plan.mjs',
  'retire-recovery-plan.sh',
  'retirement-recovery.mjs',
  'terraform-cli.tfrc',
  'validate-plan.mjs',
  'variables.tf',
  'versions.tf',
  'workflow.yaml',
]);
const ALLOWED_DIRECTORIES = Object.freeze(['.terraform', 'tests']);
const TEST_FILES = Object.freeze(['auth-probe.tftest.hcl']);
const EXECUTABLES = Object.freeze([
  'apply.sh',
  'invoke.sh',
  'plan.sh',
  'retire-apply.sh',
  'retire-plan.sh',
  'retire-recovery-apply.sh',
  'retire-recovery-plan.sh',
]);

function exactNames(actual, expected, description) {
  const names = new Set(actual);
  const missing = expected.filter((name) => !names.has(name));
  const unexpected = actual.filter((name) => !expected.includes(name));
  if (missing.length !== 0 || unexpected.length !== 0 || names.size !== actual.length) {
    throw new Error(`${description} must contain only the reviewed Auth-probe inventory`);
  }
}

export function validateAuthProbeRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const url = new URL(entry.name, rootUrl);
    if (entry.isSymbolicLink() || lstatSync(url).isSymbolicLink()) {
      throw new Error(`Auth-probe entry ${entry.name} must not be a symbolic link`);
    }
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory()) directories.push(entry.name);
    else throw new Error(`Auth-probe entry ${entry.name} has an unsupported file type`);
  }
  exactNames(files, REQUIRED_FILES, 'Auth-probe root files');
  const unexpectedDirectories = directories.filter((name) => !ALLOWED_DIRECTORIES.includes(name));
  if (unexpectedDirectories.length !== 0 || !directories.includes('tests')) {
    throw new Error('Auth-probe directories must contain only the reviewed inventory');
  }
  const tests = readdirSync(new URL('tests/', rootUrl), { withFileTypes: true });
  if (tests.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('Auth-probe tests must contain regular files only');
  }
  exactNames(tests.map(({ name }) => name), TEST_FILES, 'Auth-probe tests');
  for (const executable of EXECUTABLES) {
    if ((lstatSync(new URL(executable, rootUrl)).mode & 0o111) === 0) {
      throw new Error(`${executable} must be executable`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <auth-probe-root>');
    process.exitCode = 2;
  } else {
    validateAuthProbeRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
