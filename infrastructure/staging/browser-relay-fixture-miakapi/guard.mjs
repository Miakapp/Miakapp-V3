import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  MIAKAPI_LICENSE_SHA256,
  MIAKAPI_NODE_BUNDLE_SHA256,
  sha256,
} from './contract.mjs';

const ROOT_FILES = Object.freeze([
  'README.md',
  'binding.mjs',
  'contract.mjs',
  'guard.mjs',
  'profile.json',
]);
const VENDOR_FILES = Object.freeze(['LICENSE.miakapi', 'miakapi-node-v4.mjs']);

function reject(message) {
  throw new Error(message);
}

function exactNames(value, expected, description) {
  if (JSON.stringify([...value].sort()) !== JSON.stringify([...expected].sort())) {
    reject(`${description} differs from the reviewed inventory`);
  }
}

function regularFile(url, description) {
  const entry = lstatSync(url);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
    reject(`${description} must be a non-executable regular file`);
  }
  return entry;
}

export function validateBrowserRelayFixtureMiakApiRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  exactNames(
    entries.filter((entry) => entry.isFile()).map(({ name }) => name),
    ROOT_FILES,
    'MiakAPI binding root files',
  );
  exactNames(
    entries.filter((entry) => entry.isDirectory()).map(({ name }) => name),
    ['vendor'],
    'MiakAPI binding root directories',
  );
  if (entries.some((entry) => entry.isSymbolicLink()
    || (!entry.isFile() && !entry.isDirectory()))) {
    reject('MiakAPI binding root contains an unsupported entry');
  }
  for (const name of ROOT_FILES) regularFile(new URL(name, rootUrl), name);
  const vendorUrl = new URL('vendor/', rootUrl);
  const vendorEntry = lstatSync(vendorUrl);
  if (!vendorEntry.isDirectory() || vendorEntry.isSymbolicLink()) {
    reject('MiakAPI binding vendor root must be a real directory');
  }
  const vendorEntries = readdirSync(vendorUrl, { withFileTypes: true });
  exactNames(vendorEntries.map(({ name }) => name), VENDOR_FILES, 'MiakAPI binding vendor files');
  if (vendorEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('MiakAPI binding vendor entries must be regular files');
  }
  for (const name of VENDOR_FILES) regularFile(new URL(name, vendorUrl), `vendor/${name}`);

  const binding = readFileSync(new URL('binding.mjs', rootUrl), 'utf8');
  if (!binding.includes('fetch: injectedFetch')
    || !binding.includes('input.accessTokenProvider !== provider')
    || !binding.includes('createVendoredCoordinator')
    || !binding.includes('createVendoredHomeKeyAccessTokenProvider')
    || /globalThis\.fetch|process\.argv|process\.stdin|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
      .test(binding)) {
    reject('MiakAPI binding source boundary has drifted');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(binding)) {
    reject('MiakAPI binding source contains a forbidden target or credential literal');
  }
  const bundle = readFileSync(new URL('vendor/miakapi-node-v4.mjs', rootUrl));
  const license = readFileSync(new URL('vendor/LICENSE.miakapi', rootUrl));
  if (bundle.byteLength !== 160_762 || sha256(bundle) !== MIAKAPI_NODE_BUNDLE_SHA256
    || bundle.includes(Buffer.from('sourceMappingURL'))
    || sha256(license) !== MIAKAPI_LICENSE_SHA256) {
    reject('MiakAPI binding vendor bytes have drifted');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-fixture-miakapi-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayFixtureMiakApiRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
