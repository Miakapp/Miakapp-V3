import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'aggregator.mjs',
  'contract.mjs',
  'guard.mjs',
  'profile.json',
]);

function reject(message) {
  throw new Error(message);
}

function exactNames(value, expected, description) {
  if (JSON.stringify([...value].sort()) !== JSON.stringify([...expected].sort())) {
    reject(`${description} differs from the reviewed inventory`);
  }
}

export function validateBrowserRelayAggregatorRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  exactNames(entries.map(({ name }) => name), ROOT_FILES, 'Aggregator root files');
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Aggregator root entries must be regular files');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const source = readFileSync(new URL('aggregator.mjs', rootUrl), 'utf8');
  if (!source.includes('validateSourceReceipt')
    || !source.includes('validateEngineResult')
    || !source.includes("discard('failed')")
    || /\bfetch\b|globalThis|process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
      .test(source)) {
    reject('Aggregator source boundary has drifted');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(source)) {
    reject('Aggregator source contains a forbidden target or credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-aggregator-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayAggregatorRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
