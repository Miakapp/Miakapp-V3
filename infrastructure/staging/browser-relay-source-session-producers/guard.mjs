import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateBrowserRelaySourceSessionProducersProfile } from './contract.mjs';

const ROOT_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'producers.mjs',
  'profile.json',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-relay-source-authority-adapters/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ].sort()),
  'internal.mjs': Object.freeze(['./contract.mjs', 'node:async_hooks']),
  'producers.mjs': Object.freeze(['./internal.mjs']),
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

export function validateBrowserRelaySourceSessionProducersRoot(rootUrl) {
  const root = lstatSync(resolve(fileURLToPath(rootUrl)));
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Source session producers root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!exactNames(entries.map(({ name }) => name), ROOT_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Source session producers root differs from the reviewed file inventory');
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
    'SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE',
    'validateSourceAuthorityAdapterObservation',
    'claimedClients',
    'callbackContext',
    'subscribeToAbort',
    'expiryTimerStarted',
    'isolatedCleanupSignal',
    'settlePendingCallbacks',
    'client_released',
    'state.cursor += 1; // Reserve before invoking or awaiting the injected source client.',
    'createSourceSessionProducerClientDescriptor',
    'Promise.resolve(state.client.observe(clientDescriptor))',
    'Promise.resolve(state.client.close(link.signal))',
    'canonicalOptions',
    'claimClients(inputs.clients)',
    'poisonShared',
    'state.client = undefined',
    'shared.callbackToken = undefined',
  ]) {
    if (!lifecycleBoundary.includes(marker)) {
      reject('Source session producer lifecycle boundary has drifted');
    }
  }
  if (!sources['producers.mjs'].includes('createBrowserRelaySourceSessionsInternal')
    || sources['producers.mjs'].includes('ForTest')
    || sources['producers.mjs'].includes('testing.mjs')
    || !sources['testing.mjs'].includes('createBrowserRelaySourceSessionsForTestInternal')) {
    reject('Production and testing source session producer entrypoints are not separated');
  }

  const runtimeBoundary = `${sources['internal.mjs']}\n${sources['producers.mjs']}`;
  if (/process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
    .test(runtimeBoundary)) {
    reject('Source session producers must not discover ambient authority or invoke a CLI');
  }
  if (/\bfetch\b|\bWebSocket\b|node:https?|node:net|firebase(?:-admin|\/)|google-auth-library|@google-cloud/u
    .test(runtimeBoundary)) {
    reject('Source session producers must not implement source network access');
  }
  if (/access_token|api_key|authorization|id_token|private_key|refresh_token|secret_value/u
    .test(runtimeBoundary)) {
    reject('Source session producers must not accept a credential-bearing runtime field');
  }
  if (/\btarget_url\b|\bbase_url\b|\bendpoint\b|\bheaders\b/u.test(runtimeBoundary)) {
    reject('Source session producers must not accept arbitrary targets or request material');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?!-staging)(?:\/|\b)/u
    .test(`${lifecycleBoundary}\n${sources['producers.mjs']}`)) {
    reject('Source session producers contain a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(lifecycleBoundary)) {
    reject('Source session producers contain a forbidden credential literal');
  }
  if (/browser-relay-(?:operation-case-adapter|independent-case-adapter|source-transports)|playwright|browser-relay-runner/u
    .test(runtimeBoundary)) {
    reject('Source session producers must not contain transport, case, operation, or browser wiring');
  }

  const profile = validateBrowserRelaySourceSessionProducersProfile(rootUrl);
  if (Object.values(profile.authority).some((entry) => entry !== false)
    || Object.entries(profile.evidence).some(([key, entry]) => (
      key !== 'state' && entry !== 0 && entry !== false
    ))) {
    reject('Source session producer profile grants authority or records live evidence');
  }
  return profile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-source-session-producers-root>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateBrowserRelaySourceSessionProducersRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      console.log(`Validated ${profile.schema}; trusted source session producers remain dormant.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Source session producers rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
