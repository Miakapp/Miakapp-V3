import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'observers.mjs',
  'profile.json',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-app-check/contract.mjs',
    '../browser-relay-aggregator/contract.mjs',
    '../browser-relay-page-receipt/contract.mjs',
    '../browser-relay-page/boundary.mjs',
    '../browser-relay-runner/contract.mjs',
    '../browser-relay/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ].sort()),
  'observers.mjs': Object.freeze([
    '../browser-relay-aggregator/aggregator.mjs',
    '../browser-relay-aggregator/contract.mjs',
    '../browser-relay-runner/contract.mjs',
    './contract.mjs',
  ]),
});

function reject(message) {
  throw new Error(message);
}

function validateStaticImports(name, source) {
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
  if (JSON.stringify(imports) !== JSON.stringify(STATIC_IMPORTS[name])
    || /^\s*import\s*['"]/mu.test(source)
    || /\bimport\s*\(|\brequire\s*\(/u.test(source)) {
    reject(`${name} imports differ from the reviewed source-only allowlist`);
  }
}

export function validateBrowserRelayIndependentObserversRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...ROOT_FILES].sort())) {
    reject('Browser-relay independent observers root differs from the reviewed inventory');
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Browser-relay independent observers entries must be regular files');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const source = readFileSync(new URL('observers.mjs', rootUrl), 'utf8');
  const contract = readFileSync(new URL('contract.mjs', rootUrl), 'utf8');
  validateStaticImports('observers.mjs', source);
  validateStaticImports('contract.mjs', contract);
  for (const required of [
    'validateIndependentSourceFact',
    'validateSourceReceipt',
    "discard('failed')",
    'FACT_ORDER_BY_BROWSER',
    'SOURCE_ASSERTIONS',
    'validateCrossSourceTimeline',
    'produceBrowserRelayIndependentRunnerResult',
  ]) {
    if (!source.includes(required)) {
      reject('Browser-relay independent observer safety boundary has drifted');
    }
  }
  for (const required of [
    'browserRelayIndependentDependencyContractsSha256',
    'controlPlaneSigningProjectionSha256',
    'CONTROL_PLANE_SIGNING_PROJECTIONS',
  ]) {
    if (!contract.includes(required)) {
      reject('Browser-relay independent observer contract boundary has drifted');
    }
  }
  if (/export\s+function\s+(?:createBrowserRelayIndependentSourceObserver|produceBrowserRelayIndependent(?:SourceReceipts?|MatrixReceipts))\b/u
    .test(source)) {
    reject('Per-source receipt construction must remain private to the reconciled matrix');
  }
  if (/\bfetch\b|globalThis|process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
    .test(`${source}\n${contract}`)) {
    reject('Browser-relay independent observers must remain dormant source-only libraries');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)/u.test(`${source}\n${contract}`)) {
    reject('Browser-relay independent observers contain a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(`${source}\n${contract}`)) {
    reject('Browser-relay independent observers contain a forbidden target or credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-independent-observers-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayIndependentObserversRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
