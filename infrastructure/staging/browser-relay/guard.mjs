import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'plan-v8.json',
  'plan.json',
  'validate.mjs',
]);

function exactNames(actual, expected) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error('Browser-relay root must contain only the reviewed file inventory');
  }
}

export function validateBrowserRelayRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  for (const entry of entries) {
    const url = new URL(entry.name, rootUrl);
    if (!entry.isFile() || entry.isSymbolicLink() || lstatSync(url).isSymbolicLink()) {
      throw new Error(`Browser-relay entry ${entry.name} must be a regular file`);
    }
    if ((lstatSync(url).mode & 0o111) !== 0) {
      throw new Error(`Browser-relay entry ${entry.name} must not be executable`);
    }
  }
  exactNames(entries.map(({ name }) => name), ALLOWED_FILES);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
