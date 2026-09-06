import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'producer.mjs',
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

export function validateBrowserRelayPageReceiptRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  exactNames(entries.map(({ name }) => name), ROOT_FILES, 'Browser-page receipt root files');
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Browser-page receipt root entries must be regular files');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const source = readFileSync(new URL('producer.mjs', rootUrl), 'utf8');
  if (!source.includes('validateBrowserRelayPageFact')
    || !source.includes('validateSourceReceipt')
    || !source.includes("discard('failed')")
    || !source.includes('pagehide')
    || !source.includes('pageshow')
    || /\bfetch\b|globalThis|process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
      .test(source)) {
    reject('Browser-page receipt producer boundary has drifted');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(source)) {
    reject('Browser-page receipt producer contains a forbidden target or credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-page-receipt-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayPageReceiptRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
