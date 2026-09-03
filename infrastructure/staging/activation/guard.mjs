import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED_FILES = Object.freeze([
  'README.md',
  'apply.mjs',
  'apply.sh',
  'cloud.mjs',
  'contract.mjs',
  'evidence.mjs',
  'guard.mjs',
  'plan.mjs',
  'plan.sh',
  'result.json',
  'runtime-config.json',
]);

function exactNames(actual, expected) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error('Activation root must contain only the reviewed file inventory');
  }
}

export function validateActivationRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  for (const entry of entries) {
    const url = new URL(entry.name, rootUrl);
    if (!entry.isFile() || entry.isSymbolicLink() || lstatSync(url).isSymbolicLink()) {
      throw new Error(`Activation entry ${entry.name} must be a regular file`);
    }
  }
  exactNames(entries.map(({ name }) => name), ALLOWED_FILES);
  for (const executable of ['apply.sh', 'plan.sh']) {
    const mode = lstatSync(new URL(executable, rootUrl)).mode;
    if ((mode & 0o111) === 0) throw new Error(`${executable} must be executable`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <activation-root>');
    process.exitCode = 2;
  } else {
    validateActivationRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
