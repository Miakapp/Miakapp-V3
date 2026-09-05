import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'claim.mjs',
  'cli.mjs',
  'contract.mjs',
  'evidence.mjs',
  'guard.mjs',
  'inventory.mjs',
  'key-apply.mjs',
  'key-apply.sh',
  'key-plan.mjs',
  'key-plan.sh',
  'plan.json',
  'result.json',
]);

function exactNames(actual, expected, description) {
  const names = [...actual].sort();
  const reviewed = [...expected].sort();
  if (JSON.stringify(names) !== JSON.stringify(reviewed)) {
    throw new Error(`${description} must contain only the reviewed signing-overlap inventory`);
  }
}

export function validateSigningOverlapRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink())) {
    throw new Error('Signing-overlap entries must not be symbolic links');
  }
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error('Signing-overlap root may contain regular files only');
  }
  exactNames(entries.map(({ name }) => name), REQUIRED_FILES, 'Signing-overlap root');
  for (const name of REQUIRED_FILES) {
    const executable = (lstatSync(new URL(name, rootUrl)).mode & 0o111) !== 0;
    if (name.endsWith('.sh') !== executable) {
      throw new Error(`${name} executable mode does not match the reviewed signing-overlap inventory`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <signing-overlap-root>');
    process.exitCode = 2;
  } else {
    validateSigningOverlapRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
