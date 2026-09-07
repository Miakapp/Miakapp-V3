import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'session.mjs',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-relay-independent-observers/contract.mjs',
    '../browser-relay-page-receipt/contract.mjs',
    '../browser-relay-runner/contract.mjs',
    '../browser-relay/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ]),
  'internal.mjs': Object.freeze([
    '../browser-relay-independent-observers/contract.mjs',
    '../browser-relay-independent-observers/observers.mjs',
    '../browser-relay-page-receipt/contract.mjs',
    '../browser-relay-page-receipt/producer.mjs',
    '../browser-relay-runner/contract.mjs',
    './contract.mjs',
  ]),
  'session.mjs': Object.freeze([
    './contract.mjs',
    './internal.mjs',
    'node:process',
  ]),
  'testing.mjs': Object.freeze([
    './contract.mjs',
    './internal.mjs',
  ]),
});

function reject(message) {
  throw new Error(message);
}

function validateStaticImports(name, source) {
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
  if (JSON.stringify(imports) !== JSON.stringify([...STATIC_IMPORTS[name]].sort())
    || /^\s*import\s*['"]/mu.test(source)
    || /\bimport\s*\(|\brequire\s*\(/u.test(source)) {
    reject(`${name} imports differ from the reviewed source-only allowlist`);
  }
}

export function validateBrowserRelayEvidenceSessionRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...ROOT_FILES].sort())) {
    reject('Browser-relay evidence session root differs from the reviewed inventory');
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Browser-relay evidence session entries must be regular files');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const contract = readFileSync(new URL('contract.mjs', rootUrl), 'utf8');
  const source = readFileSync(new URL('session.mjs', rootUrl), 'utf8');
  const internal = readFileSync(new URL('internal.mjs', rootUrl), 'utf8');
  const testing = readFileSync(new URL('testing.mjs', rootUrl), 'utf8');
  validateStaticImports('contract.mjs', contract);
  validateStaticImports('internal.mjs', internal);
  validateStaticImports('session.mjs', source);
  validateStaticImports('testing.mjs', testing);
  for (const required of [
    'Symbol(',
    'rejectIndependentObserverPrivateMaterial',
    'validateIndependentSourceFact',
    'createBrowserRelayPageReceiptProducer',
    'produceBrowserRelayIndependentRunnerResult',
    'Object.freeze',
    'toJSON',
    "failSession('failed',",
    'readingClock',
  ]) {
    if (!internal.includes(required)) {
      reject('Browser-relay evidence session safety boundary has drifted');
    }
  }
  if (!source.includes('process.hrtime.bigint')
    || !source.includes('SYSTEM_MONOTONIC_CLOCK')
    || source.includes('ForTest')
    || source.includes('./testing.mjs')
    || !testing.includes('createBrowserRelayEvidenceSessionForTest')) {
    reject('Browser-relay evidence session clock entrypoints have drifted');
  }
  const guardedSource = `${source}\n${internal}\n${testing}\n${contract}`;
  if (/\bfetch\b|globalThis|process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
    .test(guardedSource)) {
    reject('Browser-relay evidence session must remain a dormant source-only library');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)/u.test(guardedSource)) {
    reject('Browser-relay evidence session contains a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(guardedSource)) {
    reject('Browser-relay evidence session contains a credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-evidence-session-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayEvidenceSessionRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
