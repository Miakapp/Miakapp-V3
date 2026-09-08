import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateBrowserRelayAuthenticatedSourceReadersProfile } from './contract.mjs';

const ROOT_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'readers.mjs',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-relay-independent-observers/contract.mjs',
    '../browser-relay-source-transports/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ].sort()),
  'internal.mjs': Object.freeze(['./contract.mjs', 'node:async_hooks']),
  'readers.mjs': Object.freeze(['./internal.mjs']),
  'testing.mjs': Object.freeze(['./internal.mjs']),
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

export function validateBrowserRelayAuthenticatedSourceReadersRoot(rootUrl) {
  const root = lstatSync(resolve(fileURLToPath(rootUrl)));
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Authenticated source readers root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!exactNames(entries.map(({ name }) => name), ROOT_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Authenticated source readers root differs from the reviewed file inventory');
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
  const lifecycleBoundary = `${sources['contract.mjs']}\n${sources['internal.mjs']}`;
  for (const marker of [
    'AUTHENTICATED_SOURCE_READERS_AUTHORITY_METHODS_BY_SOURCE',
    'validateIndependentSourceFact',
    'operationCapability',
    'expiresAt',
    'claimedAuthorities',
    'callbackContext',
    'subscribeToAbort',
    'authority_released',
    'state.cursor += 1; // Reserve before invoking or awaiting the authority.',
    'checkShared(state.shared, state.runtime, state.signal)',
    'eofEmitted',
    'poisonShared',
    'state.authority = undefined',
    'shared.operationCapability = undefined',
  ]) {
    if (!lifecycleBoundary.includes(marker)) {
      reject('Authenticated source reader lifecycle boundary has drifted');
    }
  }
  if (!sources['readers.mjs'].includes('createBrowserRelayAuthenticatedSourceReadersInternal')
    || sources['readers.mjs'].includes('ForTest')
    || sources['readers.mjs'].includes('testing.mjs')
    || !sources['testing.mjs']
      .includes('createBrowserRelayAuthenticatedSourceReadersForTestInternal')) {
    reject('Production and testing authenticated reader entrypoints are not separated');
  }
  const runtimeBoundary = `${sources['internal.mjs']}\n${sources['readers.mjs']}`;
  if (/process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
    .test(runtimeBoundary)) {
    reject('Authenticated source readers must not discover ambient authority or invoke a CLI');
  }
  if (/\bfetch\b|\bWebSocket\b|node:https?|node:net|firebase(?:-admin|\/)|google-auth-library|@google-cloud/u
    .test(runtimeBoundary)) {
    reject('Authenticated source readers must not implement a live network or SDK adapter');
  }
  if (/access_token|api_key|authorization|id_token|private_key|refresh_token|secret_value/u
    .test(runtimeBoundary)) {
    reject('Authenticated source readers must not accept a credential-bearing runtime field');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)/u.test(runtimeBoundary)) {
    reject('Authenticated source readers contain a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(runtimeBoundary)) {
    reject('Authenticated source readers contain a forbidden credential literal');
  }
  const profile = validateBrowserRelayAuthenticatedSourceReadersProfile(rootUrl);
  if (Object.values(profile.authority).some((entry) => entry !== false)
    || Object.entries(profile.evidence).some(([key, entry]) => (
      key !== 'state' && entry !== 0 && entry !== false
    ))) {
    reject('Authenticated source reader profile grants authority or records live evidence');
  }
  return profile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-authenticated-source-readers-root>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateBrowserRelayAuthenticatedSourceReadersRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      console.log(`Validated ${profile.schema}; authenticated source readers remain dormant.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Authenticated source readers rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
