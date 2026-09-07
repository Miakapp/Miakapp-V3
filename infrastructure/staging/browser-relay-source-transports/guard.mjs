import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateBrowserRelaySourceTransportsProfile } from './contract.mjs';

const ROOT_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'testing.mjs',
  'transports.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-relay-independent-case-adapter/contract.mjs',
    '../browser-relay-independent-observers/contract.mjs',
    '../browser-relay/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ].sort()),
  'internal.mjs': Object.freeze([
    './contract.mjs',
    'node:async_hooks',
  ]),
  'testing.mjs': Object.freeze(['./internal.mjs']),
  'transports.mjs': Object.freeze(['./internal.mjs']),
});

function reject(message) {
  throw new Error(message);
}

function exactNames(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function staticImports(source) {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
}

function validateImports(name, source) {
  if (!exactNames(staticImports(source), STATIC_IMPORTS[name])
    || /^\s*import\s*['"]/mu.test(source)
    || /\bimport\s*\(|\brequire\s*\(/u.test(source)) {
    reject(`${name} imports differ from the reviewed static allowlist`);
  }
}

export function validateBrowserRelaySourceTransportsRoot(rootUrl) {
  const root = lstatSync(resolve(fileURLToPath(rootUrl)));
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Source transports root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!exactNames(entries.map(({ name }) => name), ROOT_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Source transports root differs from the reviewed regular-file inventory');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const sources = Object.fromEntries(
    Object.keys(STATIC_IMPORTS).map((name) => [
      name,
      readFileSync(new URL(name, rootUrl), 'utf8'),
    ]),
  );
  for (const [name, source] of Object.entries(sources)) validateImports(name, source);
  for (const marker of [
    'claimedProviders',
    'claimedReaders',
    'operationCapability',
    'expected_kinds',
    'validateSourceTransportReadResult',
    'closeLateReader',
    'settleTracked',
    'AsyncLocalStorage',
    'INTRINSIC_ABORT_SIGNAL_ANY',
    'INTRINSIC_ADD_EVENT_LISTENER',
    'subscribeToAbort',
    'signalAborted',
    'terminateStage',
    'protocol_poison_permanent',
  ]) {
    if (!`${sources['internal.mjs']}\n${sources['contract.mjs']}`.includes(marker)) {
      reject('Source transport lifecycle boundary has drifted');
    }
  }
  if (!sources['transports.mjs'].includes('createBrowserRelaySourceTransportsInternal')
    || sources['transports.mjs'].includes('ForTest')
    || sources['transports.mjs'].includes('testing.mjs')
    || !sources['testing.mjs'].includes('createBrowserRelaySourceTransportsForTestInternal')) {
    reject('Production and testing source transport entrypoints are not separated');
  }
  const productionBoundary = [
    sources['contract.mjs'],
    sources['internal.mjs'],
    sources['transports.mjs'],
  ].join('\n');
  if (/process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
    .test(productionBoundary)) {
    reject('Source transports must not discover ambient authority or invoke a CLI');
  }
  if (/\bfetch\b|\bWebSocket\b|firebase(?:-admin|\/)|google-auth-library|@google-cloud/u
    .test(productionBoundary)) {
    reject('Source transports must not implement a live network or SDK reader');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)/u.test(productionBoundary)) {
    reject('Source transports contain a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(productionBoundary)) {
    reject('Source transports contain a forbidden credential literal');
  }
  const profile = validateBrowserRelaySourceTransportsProfile(rootUrl);
  if (Object.values(profile.authority).some((entry) => entry !== false)
    || Object.entries(profile.evidence).some(([key, entry]) => (
      key !== 'state' && entry !== 0 && entry !== false
    ))) {
    reject('Source transport profile grants authority or records live evidence');
  }
  return profile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-source-transports-root>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateBrowserRelaySourceTransportsRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      console.log(`Validated ${profile.schema}; source transports remain dormant.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Source transports rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
