import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'composition.mjs',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'composition.mjs': Object.freeze([
    '../browser-relay-authenticated-source-readers/readers.mjs',
    '../browser-relay-operation-case-adapter/adapter.mjs',
    '../browser-relay-source-authority-adapters/adapters.mjs',
    '../browser-relay-source-clients/clients.mjs',
    '../browser-relay-source-session-producers/producers.mjs',
    '../browser-relay-source-transports/transports.mjs',
    './contract.mjs',
    './internal.mjs',
  ]),
  'contract.mjs': Object.freeze([
    '../browser-relay-authenticated-source-readers/contract.mjs',
    '../browser-relay-operation-case-adapter/contract.mjs',
    '../browser-relay-source-authority-adapters/contract.mjs',
    '../browser-relay-source-clients/contract.mjs',
    '../browser-relay-source-session-producers/contract.mjs',
    '../browser-relay-source-transports/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ]),
  'internal.mjs': Object.freeze(['./contract.mjs', 'node:async_hooks']),
  'testing.mjs': Object.freeze(['./contract.mjs', './internal.mjs']),
});
const READ_ONLY_CONTRACT_IMPORTS = Object.freeze({
  'node:crypto': Object.freeze(['createHash']),
  'node:fs': Object.freeze(['lstatSync', 'readFileSync']),
  'node:util': Object.freeze(['isDeepStrictEqual', 'types']),
});
const READ_ONLY_INTERNAL_IMPORTS = Object.freeze({
  'node:async_hooks': Object.freeze(['AsyncLocalStorage']),
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
  for (const [specifier, expected] of Object.entries(READ_ONLY_CONTRACT_IMPORTS)) {
    if (name !== 'contract.mjs') continue;
    const actual = namedImports(source, specifier);
    if (actual === undefined || !exactNames(actual, expected)) {
      reject(`contract.mjs ${specifier} bindings exceed the read-only allowlist`);
    }
  }
  for (const [specifier, expected] of Object.entries(READ_ONLY_INTERNAL_IMPORTS)) {
    if (name !== 'internal.mjs') continue;
    const actual = namedImports(source, specifier);
    if (actual === undefined || !exactNames(actual, expected)) {
      reject(`internal.mjs ${specifier} bindings exceed the read-only allowlist`);
    }
  }
}

export async function validateBrowserRelayTrustedSourceCompositionRoot(rootUrl) {
  const root = lstatSync(rootUrl);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Trusted source composition root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!exactNames(entries.map(({ name }) => name), ROOT_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Trusted source composition root differs from the reviewed file inventory');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const contents = Object.fromEntries(ROOT_FILES.map((name) => [
    name,
    readFileSync(new URL(name, rootUrl), 'utf8'),
  ]));
  for (const [name, expected] of Object.entries(STATIC_IMPORTS)) {
    if (expected !== undefined) validateImports(name, contents[name]);
  }

  const productionBoundary = [
    contents['contract.mjs'],
    contents['internal.mjs'],
    contents['composition.mjs'],
  ].join('\n');
  for (const marker of [
    'TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE',
    'TRUSTED_SOURCE_COMPOSITION_TARGETS_BY_SOURCE_AND_KIND',
    'claimedProviders',
    'validateTrustedSourceAcquireDescriptor',
    'createTrustedSourceProviderContext',
    'createTrustedSourceReceipt',
    'request_capability',
    'create_source_clients',
    'create_source_sessions',
    'create_authority_adapters',
    'create_authenticated_readers',
    'create_source_transports',
    'run_operation_case',
    'wrapObserver',
    'callbackContext',
    'bindOperationToRootSignal',
    'cleanupMap',
    'rawExecuteTask',
    'dispatchedCloseTask',
    'closeTask',
    'closeOwnedSources',
    'provider_released',
    'state.methods = undefined',
    'sourceObservers: observerMap',
  ]) {
    if (!productionBoundary.includes(marker)) {
      reject('Trusted source composition lifecycle boundary has drifted');
    }
  }
  if (!contents['composition.mjs'].includes(
    'createBrowserRelayTrustedSourceCompositionInternal',
  )
    || contents['composition.mjs'].includes('ForTesting')
    || contents['composition.mjs'].includes('./testing.mjs')
    || !contents['testing.mjs'].includes(
      'createBrowserRelayTrustedSourceCompositionForTesting',
    )) {
    reject('Trusted source production and testing entrypoints are not separated');
  }
  if (/process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
    .test(productionBoundary)) {
    reject('Trusted source composition must not discover ambient authority or invoke a CLI');
  }
  if (/\bfetch\b|\bWebSocket\b|node:https?|node:net|node:tls|firebase-admin|google-auth-library|@google-cloud/u
    .test(productionBoundary)) {
    reject('Trusted source composition must not contain a built-in live transport or SDK client');
  }
  if (/\b(?:access_token|api_key|authorization|id_token|private_key|refresh_token|secret_value)\b/u
    .test(productionBoundary)) {
    reject('Trusted source composition must not accept credential-bearing runtime fields');
  }
  if (/\btarget_url\b|\bbase_url\b|\bendpoint\b|\bheaders\b/u.test(productionBoundary)) {
    reject('Trusted source composition must not accept arbitrary targets or request material');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?!-staging)(?:\/|\b)/u.test(productionBoundary)) {
    reject('Trusted source composition contains a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(Object.values(contents).join('\n'))) {
    reject('Trusted source composition contains a forbidden credential literal');
  }
  if (/\b(?:appendFile|appendFileSync|chmod|chmodSync|chown|chownSync|copyFile|copyFileSync|cp|cpSync|createWriteStream|link|linkSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|rename|renameSync|rm|rmSync|rmdir|rmdirSync|symlink|symlinkSync|truncate|truncateSync|unlink|unlinkSync|utimes|utimesSync|write|writeFile|writeFileSync|writeSync)\s*\(/u
    .test(productionBoundary)) {
    reject('Trusted source composition production graph must not mutate the filesystem');
  }
  if (/\b(?:globalThis|global|process)\b|\b(?:eval|Function)\s*\(|\b(?:Bun|Deno|XMLHttpRequest|EventSource)\b/u
    .test(productionBoundary)) {
    reject('Trusted source composition production graph must not access computed ambient authority');
  }

  const { validateBrowserRelayTrustedSourceCompositionProfile } = await import('./contract.mjs');
  const profile = validateBrowserRelayTrustedSourceCompositionProfile(rootUrl);
  if (profile.authority.explicit_ephemeral_provider_capabilities_accepted !== true
    || profile.authority.fixed_staging_targets_authorized !== true
    || Object.entries(profile.authority).some(([key, entry]) => (
      ![
        'explicit_ephemeral_provider_capabilities_accepted',
        'fixed_staging_targets_authorized',
      ].includes(key) && entry !== false
    ))
    || profile.compatibility.operation_case_adapter_wired !== true
    || profile.compatibility.named_trusted_live_provider_capabilities_present !== true
    || profile.compatibility.built_in_live_source_implementations_present !== false
    || profile.lifecycle.strategy !== 'differential_conformance'
    || profile.evidence.cloud_requests !== 0
    || profile.evidence.cloud_mutations !== 0
    || profile.evidence.public_ingress_changes !== 0
    || profile.evidence.live_execution_count !== 0
    || profile.evidence.incremental_monthly_cost_eur !== 0) {
    reject('Trusted source composition profile exceeds its dormant authority');
  }
  return profile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-trusted-source-composition-root>');
    process.exitCode = 2;
  } else {
    try {
      const profile = await validateBrowserRelayTrustedSourceCompositionRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      console.log(`Validated ${profile.schema}; trusted source composition remains dormant.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Trusted source composition rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
