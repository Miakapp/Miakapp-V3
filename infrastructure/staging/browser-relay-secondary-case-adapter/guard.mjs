import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'adapter.mjs',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'adapter.mjs': Object.freeze([
    '../browser-relay-chromium-case-adapter/adapter.mjs',
    '../browser-relay-playwright-bridge/bridge.mjs',
    './contract.mjs',
    './internal.mjs',
  ]),
  'contract.mjs': Object.freeze([
    '../browser-relay-case-scheduler/contract.mjs',
    '../browser-relay-chromium-case-adapter/contract.mjs',
    '../browser-relay-evidence-session/contract.mjs',
    '../browser-relay-page-receipt/contract.mjs',
    '../browser-relay-playwright-bridge/contract.mjs',
    '../browser-relay-runner/contract.mjs',
    '../browser-relay-scenario-fixture/contract.mjs',
    '../browser-relay/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ]),
  'internal.mjs': Object.freeze([
    '../browser-relay-page-receipt/contract.mjs',
    '../browser-relay-page-receipt/producer.mjs',
    '../browser-relay-playwright-bridge/contract.mjs',
    '../browser-relay-runner/contract.mjs',
    './contract.mjs',
    'node:events',
    'node:util',
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

export function validateBrowserRelaySecondaryCaseAdapterRoot(rootUrl) {
  const root = lstatSync(rootUrl);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Browser-relay secondary case-adapter root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...ROOT_FILES].sort())) {
    reject('Browser-relay secondary case-adapter inventory has drifted');
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Browser-relay secondary case-adapter entries must be regular files');
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
  for (const [name, source] of Object.entries(sources)) validateStaticImports(name, source);
  for (const marker of [
    'runBrowserRelaySecondaryCaseScheduleWithRunners',
    'runBrowserRelayChromiumCaseSchedule',
    'runBrowserRelayPlaywrightBridge',
  ]) {
    if (!sources['adapter.mjs'].includes(marker)) {
      reject('Secondary case-adapter production entrypoint has drifted');
    }
  }
  for (const marker of [
    'createBrowserRelayPageReceiptProducer',
    'validateBrowserRelayPageFact',
    "stage.scope.record('browser_page', projectionFromFact(fact))",
    "source === 'browser_page'",
    'validatePlaywrightBridgeResult',
    'nextSecondaryInputIndex',
    'inFlightBridgeTasks',
    'inFlightDependencyTasks',
    'inFlightRemainingTasks',
    'closeLatePage',
    'drainTasks',
    'remainingAdapter.close()',
    'scheduleAbortSubscription',
    'toJSON',
  ]) {
    if (!sources['internal.mjs'].includes(marker)) {
      reject('Secondary case-adapter safety boundary has drifted');
    }
  }
  if (sources['adapter.mjs'].includes('ForTesting')
    || sources['adapter.mjs'].includes('./testing.mjs')
    || !sources['testing.mjs'].includes(
      'runBrowserRelaySecondaryCaseScheduleForTesting',
    )) {
    reject('Secondary case-adapter entrypoint separation has drifted');
  }
  const runtimeSource = [
    sources['adapter.mjs'],
    sources['internal.mjs'],
    sources['testing.mjs'],
  ].join('\n');
  if (/\bimport\s*\(|child_process|execSync|spawnSync|process\.(?:argv|env|stdin)|\bfetch\s*\(|\bgcloud\b|\bterraform\b|firefox\.launch|webkit\.launch|chromium\.launch|firestore|firebase-admin|google-auth-library|node:fs|node:http|node:https|node:net|node:tls/u
    .test(runtimeSource)) {
    reject('Secondary case-adapter runtime exceeds its source-only authority');
  }
  const guardedSource = Object.values(sources).join('\n');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)/u.test(guardedSource)) {
    reject('Secondary case-adapter contains a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(guardedSource)) {
    reject('Secondary case-adapter contains a credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-secondary-case-adapter-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelaySecondaryCaseAdapterRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
