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
  'scheduler.mjs',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-relay-evidence-session/contract.mjs',
    '../browser-relay-independent-observers/contract.mjs',
    '../browser-relay-page-receipt/contract.mjs',
    '../browser-relay-runner/contract.mjs',
    '../browser-relay/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ]),
  'internal.mjs': Object.freeze([
    './contract.mjs',
    'node:events',
  ]),
  'scheduler.mjs': Object.freeze([
    '../browser-relay-evidence-session/session.mjs',
    './contract.mjs',
    './internal.mjs',
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
  const imports = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
  if (JSON.stringify(imports) !== JSON.stringify([...STATIC_IMPORTS[name]].sort())
    || /\b(?:from|import|require)\s*\/[*/]/u.test(source)
    || /\bimport\s*['"]/u.test(source)
    || /\bimport\s*\(/u.test(source)
    || /\brequire\s*\(/u.test(source)) {
    reject(`${name} imports differ from the reviewed source-only allowlist`);
  }
}

export function validateBrowserRelayCaseSchedulerRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...ROOT_FILES].sort())) {
    reject('Browser-relay case scheduler root differs from the reviewed inventory');
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Browser-relay case scheduler entries must be regular files');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const contract = readFileSync(new URL('contract.mjs', rootUrl), 'utf8');
  const internal = readFileSync(new URL('internal.mjs', rootUrl), 'utf8');
  const scheduler = readFileSync(new URL('scheduler.mjs', rootUrl), 'utf8');
  const testing = readFileSync(new URL('testing.mjs', rootUrl), 'utf8');
  validateStaticImports('contract.mjs', contract);
  validateStaticImports('internal.mjs', internal);
  validateStaticImports('scheduler.mjs', scheduler);
  validateStaticImports('testing.mjs', testing);
  for (const required of [
    'AbortController',
    'addAbortListener',
    'Symbol(',
    'Object.freeze',
    'toJSON',
    'RECORD_COUNTS_BY_STAGE',
    'SCHEDULE_ACTIONS',
    'startAdapterClose',
    "invokeAdapter('startBrowser'",
    'session.abort()',
    "invokeSessionTransition(session, 'closePage'",
    "invokeSessionTransition(session, 'finishBrowser'",
  ]) {
    if (!internal.includes(required)) {
      reject('Browser-relay case scheduler safety boundary has drifted');
    }
  }
  if (!scheduler.includes('../browser-relay-evidence-session/session.mjs')
    || scheduler.includes('../browser-relay-evidence-session/testing.mjs')
    || scheduler.includes('../browser-relay-evidence-session/internal.mjs')
    || scheduler.includes('ForTest')
    || !testing.includes('runBrowserRelayCaseScheduleForTest')) {
    reject('Browser-relay case scheduler entrypoint separation has drifted');
  }
  const guardedSource = `${contract}\n${internal}\n${scheduler}\n${testing}`;
  if (/\bfetch\b|globalThis|process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|['"]node:(?:dgram|dns|http|http2|https|net|tls)['"]|\bgcloud\b|\bterraform\b|\bplaywright\b/u
    .test(guardedSource)) {
    reject('Browser-relay case scheduler must remain a dormant source-only library');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)/u.test(guardedSource)) {
    reject('Browser-relay case scheduler contains a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(guardedSource)) {
    reject('Browser-relay case scheduler contains a credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-case-scheduler-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayCaseSchedulerRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
