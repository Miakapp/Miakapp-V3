import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  sha256,
  validateBrowserRelayPageProfile,
  validateBrowserRelayPageV2Profile,
} from './contract.mjs';

const ROOT_FILES = Object.freeze([
  'README.md',
  'artifact.mjs',
  'boundary.mjs',
  'contract.mjs',
  'guard.mjs',
  'index.html',
  'page.mjs',
  'profile.json',
  'profile-v2.json',
  'runtime.mjs',
]);
const ROOT_DIRECTORIES = Object.freeze(['vendor']);
const VENDOR_FILES = Object.freeze(['LICENSE.miakapi', 'miakapi-browser-v4.mjs']);

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

export function validateBrowserRelayPageRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  exactNames(
    entries.filter((entry) => entry.isFile()).map(({ name }) => name),
    ROOT_FILES,
    'Browser-relay page root files',
  );
  exactNames(
    entries.filter((entry) => entry.isDirectory()).map(({ name }) => name),
    ROOT_DIRECTORIES,
    'Browser-relay page root directories',
  );
  if (entries.some((entry) => entry.isSymbolicLink()
    || (!entry.isFile() && !entry.isDirectory()))) {
    reject('Browser-relay page root contains an unsupported entry');
  }
  for (const name of ROOT_FILES) regularFile(new URL(name, rootUrl), name);
  validateBrowserRelayPageV2Profile(new URL('profile-v2.json', rootUrl));
  const vendorUrl = new URL('vendor/', rootUrl);
  const vendorEntry = lstatSync(vendorUrl);
  if (!vendorEntry.isDirectory() || vendorEntry.isSymbolicLink()) {
    reject('Browser-relay page vendor root must be a real directory');
  }
  const vendorEntries = readdirSync(vendorUrl, { withFileTypes: true });
  exactNames(vendorEntries.map(({ name }) => name), VENDOR_FILES, 'Vendored page files');
  if (vendorEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Vendored page entries must be regular files');
  }
  for (const name of VENDOR_FILES) regularFile(new URL(name, vendorUrl), `vendor/${name}`);

  const profile = validateBrowserRelayPageProfile(new URL('profile.json', rootUrl));
  const sources = Object.fromEntries([
    ['boundary_source_sha256', 'boundary.mjs'],
    ['runtime_source_sha256', 'runtime.mjs'],
    ['page_source_sha256', 'page.mjs'],
    ['artifact_source_sha256', 'artifact.mjs'],
    ['index_sha256', 'index.html'],
  ].map(([field, name]) => [field, sha256(readFileSync(new URL(name, rootUrl)))]));
  for (const [field, digest] of Object.entries(sources)) {
    if (profile.pins?.[field] !== digest) reject(`Browser-relay page ${field} has drifted`);
  }
  if (profile.pins?.miakapi_bundle_sha256
    !== sha256(readFileSync(new URL('vendor/miakapi-browser-v4.mjs', rootUrl)))) {
    reject('Vendored MiakAPI bundle digest has drifted');
  }

  const index = readFileSync(new URL('index.html', rootUrl), 'utf8');
  const page = readFileSync(new URL('page.mjs', rootUrl), 'utf8');
  const runtime = readFileSync(new URL('runtime.mjs', rootUrl), 'utf8');
  const artifact = readFileSync(new URL('artifact.mjs', rootUrl), 'utf8');
  const browserSources = `${index}\n${page}\n${runtime}`;
  if (!index.includes('<script type="module" src="/page.mjs"></script>')
    || !page.includes("from 'firebase/auth'")
    || !page.includes('inMemoryPersistence')
    || !page.includes('ReCaptchaEnterpriseProvider')
    || !page.includes("from './vendor/miakapi-browser-v4.mjs'")
    || !page.includes("Object.defineProperty(globalThis, 'miakappBrowserRelayPage'")
    || page.includes('miakappBrowserRelayAcceptance')
    || /localStorage|sessionStorage|document\.cookie/u.test(browserSources)
    || /console\.|debugger|postMessage|BroadcastChannel/u.test(browserSources)) {
    reject('Browser-relay page browser boundary has drifted');
  }
  if (!runtime.includes('sourceCredentialsOnWebsocket')
    || !runtime.includes('credential.fill(0)')
    || !runtime.includes("Object.defineProperty(globalObject, 'indexedDB'")
    || !runtime.includes('restorePersistence')
    || !runtime.includes('activeWebsockets')
    || !runtime.includes('maximumActiveWebsockets')
    || !runtime.includes('CONTROL_PLANE_EXCHANGE_ENDPOINT')
    || /node:|process\.|child_process|execSync|spawnSync|\bgcloud\b/u.test(runtime)) {
    reject('Browser-relay page runtime boundary has drifted');
  }
  if (!artifact.includes('sourcemap: false')
    || !artifact.includes("'Cache-Control': 'no-store, max-age=0'")
    || !artifact.includes("\"frame-ancestors 'none'\"")
    || /process\.argv|process\.stdin|child_process|execSync|spawnSync|\bgcloud\b/u.test(artifact)) {
    reject('Browser-relay page artifact boundary has drifted');
  }
  if (/\bmiakapp-3\b|demo-miakapp-v4|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(browserSources)) {
    reject('Browser-relay page source contains a forbidden target or credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-page-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayPageRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
