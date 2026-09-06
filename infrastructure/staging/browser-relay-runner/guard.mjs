import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'driver.mjs',
  'guard.mjs',
  'profile.json',
]);

function reject(message) {
  throw new Error(message);
}

export function validateBrowserRelayRunnerRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || !entry.isFile()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink())) {
    reject('Browser-relay runner root may contain regular files only');
  }
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...REQUIRED_FILES].sort())) {
    reject('Browser-relay runner root differs from the reviewed file inventory');
  }
  if (entries.some((entry) => (lstatSync(new URL(entry.name, rootUrl)).mode & 0o111) !== 0)) {
    reject('Browser-relay runner files must not be executable');
  }
  const sources = Object.fromEntries(REQUIRED_FILES
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => [name, readFileSync(new URL(name, rootUrl), 'utf8')]));
  const combined = sources['driver.mjs'];
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(combined)) {
    reject('Browser-relay runner source contains a forbidden target or credential literal');
  }
  if (/process\.argv|process\.stdin|child_process|execSync|spawnSync|\bgcloud\b/u.test(combined)) {
    reject('Browser-relay runner must remain a dormant in-process library');
  }
  if (!sources['driver.mjs'].includes("engine.launch({ headless: true })")
    || !sources['driver.mjs'].includes("serviceWorkers: 'block'")
    || !sources['driver.mjs'].includes('page.evaluate')
    || /page\.on\(|context\.tracing|recordHar|recordVideo|screenshot\(/u.test(sources['driver.mjs'])) {
    reject('Browser-relay runner execution boundary has drifted');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-runner-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayRunnerRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
