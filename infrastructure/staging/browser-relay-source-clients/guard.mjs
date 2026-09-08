import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'clients.mjs',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'clients.mjs': Object.freeze(['./internal.mjs']),
  'contract.mjs': Object.freeze([
    '../browser-relay-source-session-producers/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ].sort()),
  'internal.mjs': Object.freeze([
    './contract.mjs',
    'node:async_hooks',
    'node:timers',
  ].sort()),
  'testing.mjs': Object.freeze(['./internal.mjs']),
});
const STATIC_NAMED_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze({
    'node:crypto': Object.freeze(['createHash']),
    'node:fs': Object.freeze(['lstatSync', 'readFileSync']),
    'node:util': Object.freeze(['isDeepStrictEqual', 'types']),
  }),
  'internal.mjs': Object.freeze({
    'node:async_hooks': Object.freeze(['AsyncLocalStorage']),
    'node:timers': Object.freeze([
      'clearTimeout as clearTimeoutIntrinsic',
      'setTimeout as setTimeoutIntrinsic',
    ]),
  }),
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

function namedImports(source, specifier) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = [...source.matchAll(new RegExp(
    `\\bimport\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]\\s*;`,
    'gu',
  ))];
  if (matches.length !== 1) return undefined;
  return matches[0][1].split(',')
    .map((entry) => entry.trim().replace(/\s+/gu, ' '))
    .filter(Boolean)
    .sort();
}

function validateImports(name, source) {
  if (!exactNames(staticImports(source), STATIC_IMPORTS[name])
    || /^\s*import\s*['"]/mu.test(source)
    || /\bimport\s*\(|\brequire\s*\(/u.test(source)) {
    reject(`${name} imports differ from the reviewed static allowlist`);
  }
  for (const [specifier, expected] of Object.entries(STATIC_NAMED_IMPORTS[name] ?? {})) {
    const actual = namedImports(source, specifier);
    if (actual === undefined || !exactNames(actual, expected)) {
      reject(`${name} ${specifier} bindings differ from the reviewed static allowlist`);
    }
  }
}

export async function validateBrowserRelaySourceClientsRoot(rootUrl) {
  const root = lstatSync(resolve(fileURLToPath(rootUrl)));
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Source clients root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!exactNames(entries.map(({ name }) => name), ROOT_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Source clients root differs from the reviewed file inventory');
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
    'SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND',
    'claimedAuthorities',
    'claimedReceipts',
    'callbackContext',
    'INTRINSIC_IS_PROXY',
    'subscribeToAbort',
    'linkedAcquireSignal',
    'expiryTimerStarted',
    'sourceState.runtime.set_timer',
    'sourceState.runtime.clear_timer',
    'isolatedCleanupSignal',
    'settlePendingCallbacks',
    'authority_released',
    'state.cursor += 1; // Reserve before invoking or awaiting the ephemeral source authority.',
    'createRequestCapability',
    'createSourceClientAcquireDescriptor',
    'validateSourceClientReceipt',
    'callbackContext.run(state.shared.callbackToken',
    'Promise.resolve(state.authority.acquire(acquireDescriptor))',
    'Promise.resolve(state.authority.close(link.signal))',
    'claimAuthorityIdentities(canonical.inputs.authorities)',
    'poisonShared',
    'state.authority = undefined',
    'shared.callbackToken = undefined',
  ]) {
    if (!lifecycleBoundary.includes(marker)) {
      reject('Source client lifecycle boundary has drifted');
    }
  }
  if (!sources['clients.mjs'].includes('createBrowserRelaySourceClientsInternal')
    || sources['clients.mjs'].includes('ForTest')
    || sources['clients.mjs'].includes('testing.mjs')
    || !sources['testing.mjs'].includes('createBrowserRelaySourceClientsForTestInternal')) {
    reject('Production and testing source client entrypoints are not separated');
  }

  const runtimeBoundary = [
    sources['contract.mjs'],
    sources['internal.mjs'],
    sources['clients.mjs'],
  ].join('\n');
  if (/process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
    .test(runtimeBoundary)) {
    reject('Source clients must not discover ambient authority or invoke a CLI');
  }
  if (/\bfetch\b|\bWebSocket\b|node:https?|node:net|firebase-admin|google-auth-library|@google-cloud/u
    .test(runtimeBoundary)) {
    reject('Source clients must not contain a built-in live transport or SDK client');
  }
  if (/\b(?:access_token|api_key|authorization|id_token|private_key|refresh_token|secret_value)\b/u
    .test(runtimeBoundary)) {
    reject('Source clients must not accept a credential-bearing runtime field');
  }
  if (/\btarget_url\b|\bbase_url\b|\bendpoint\b|\bheaders\b/u.test(runtimeBoundary)) {
    reject('Source clients must not accept arbitrary targets or request material');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?!-staging)(?:\/|\b)/u.test(lifecycleBoundary)) {
    reject('Source clients contain a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(lifecycleBoundary)) {
    reject('Source clients contain a forbidden credential literal');
  }
  if (/verifyAppCheckToken|assessment_count.*monitoring|document\/write_count/u
    .test(runtimeBoundary)) {
    reject('Source clients contain a forbidden consuming or delayed-metric inference path');
  }
  if (/browser-relay-(?:operation-case-adapter|independent-case-adapter|source-transports)|playwright|browser-relay-runner/u
    .test(runtimeBoundary)) {
    reject('Source clients must not contain transport, case, operation, or browser wiring');
  }

  if (/\b(?:appendFile|appendFileSync|chmod|chmodSync|chown|chownSync|copyFile|copyFileSync|cp|cpSync|createWriteStream|link|linkSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|rename|renameSync|rm|rmSync|rmdir|rmdirSync|symlink|symlinkSync|truncate|truncateSync|unlink|unlinkSync|utimes|utimesSync|write|writeFile|writeFileSync|writeSync)\s*\(/u
    .test(runtimeBoundary)) {
    reject('Source clients production graph must not mutate the filesystem');
  }
  if (/\b(?:globalThis|global)\b|\bprocess\s*\[|\b(?:eval|Function)\s*\(|\b(?:Bun|Deno|XMLHttpRequest|EventSource)\b/u
    .test(runtimeBoundary)) {
    reject('Source clients production graph must not access computed ambient authority');
  }

  const { validateBrowserRelaySourceClientsProfile } = await import('./contract.mjs');
  const profile = validateBrowserRelaySourceClientsProfile(rootUrl);
  if (profile.authority.explicit_ephemeral_authorities_accepted !== true
    || profile.authority.fixed_staging_targets_authorized !== true
    || Object.entries(profile.authority).some(([key, entry]) => (
      !['explicit_ephemeral_authorities_accepted', 'fixed_staging_targets_authorized'].includes(key)
      && entry !== false
    ))
    || Object.entries(profile.evidence).some(([key, entry]) => (
      key !== 'state' && entry !== 0 && entry !== false
    ))) {
    reject('Source client profile grants unreviewed authority or records live evidence');
  }
  return profile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-source-clients-root>');
    process.exitCode = 2;
  } else {
    try {
      const profile = await validateBrowserRelaySourceClientsRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      console.log(`Validated ${profile.schema}; fixed-target source clients remain dormant.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Source clients rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
