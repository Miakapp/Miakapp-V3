import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'fixture.mjs',
  'guard.mjs',
  'profile.json',
]);

function reject(message) {
  throw new Error(message);
}

export function validateBrowserRelayFixtureRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || !entry.isFile()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink())) {
    reject('Browser-relay fixture root may contain regular files only');
  }
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...REQUIRED_FILES].sort())) {
    reject('Browser-relay fixture root differs from the reviewed file inventory');
  }
  if (entries.some((entry) => (lstatSync(new URL(entry.name, rootUrl)).mode & 0o111) !== 0)) {
    reject('Browser-relay fixture files must not be executable');
  }
  const source = readFileSync(new URL('fixture.mjs', rootUrl), 'utf8');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(source)) {
    reject('Browser-relay fixture source contains a forbidden target or credential literal');
  }
  if (/process\.argv|process\.stdin|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
    .test(source)) {
    reject('Browser-relay fixture must remain a dormant in-process library');
  }
  for (const required of [
    'verifyFixtureAbsent',
    'cleanupAuthorized = true',
    'issuedTokenDigests',
    'await stopCoordinator()',
    'removeFixture',
  ]) {
    if (!source.includes(required)) reject('Browser-relay fixture safety boundary has drifted');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-fixture-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayFixtureRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
