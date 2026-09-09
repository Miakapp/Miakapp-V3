import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_ENTRIES = Object.freeze([
  'README.md',
  'check.sh',
  'contract.mjs',
  'framed-channel.mjs',
  'guard.mjs',
  'internal.mjs',
  'process.mjs',
  'profile.json',
  'test',
  'worker.mjs',
]);
const TEST_ENTRIES = Object.freeze([
  'contract.test.mjs',
  'fixtures',
  'framed-channel.test.mjs',
  'helpers.mjs',
  'inert-import.test.mjs',
  'process.test.mjs',
]);
const FIXTURE_ENTRIES = Object.freeze([
  'hostile-peer.mjs',
  'uncooperative-descendant.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    'node:crypto', 'node:fs', 'node:path', 'node:util',
  ]),
  'framed-channel.mjs': Object.freeze(['./contract.mjs', 'node:util']),
  'internal.mjs': Object.freeze([
    './contract.mjs', './framed-channel.mjs', 'node:child_process',
    'node:crypto', 'node:process', 'node:url',
  ]),
  'process.mjs': Object.freeze(['./contract.mjs', './internal.mjs']),
  'worker.mjs': Object.freeze([
    './contract.mjs', './framed-channel.mjs', 'node:crypto', 'node:fs',
    'node:process', 'node:url',
  ]),
});

function reject(message) {
  throw new Error(message);
}

function exactNames(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function imports(source) {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
}

function assertDirectory(url, expectedEntries, description) {
  const root = lstatSync(url);
  const entries = readdirSync(url, { withFileTypes: true });
  if (!root.isDirectory() || root.isSymbolicLink()
    || !exactNames(entries.map(({ name }) => name), expectedEntries)
    || entries.some((entry) => entry.isSymbolicLink())) {
    reject(`${description} differs from the reviewed inventory`);
  }
  return entries;
}

export async function validateBrowserRelayTrustedProviderProcessRoot(rootUrl) {
  const entries = assertDirectory(rootUrl, ROOT_ENTRIES, 'Trusted provider process root');
  for (const entry of entries.filter(({ name }) => name !== 'test')) {
    const stat = lstatSync(new URL(entry.name, rootUrl));
    if (!entry.isFile() || !stat.isFile() || stat.isSymbolicLink()
      || (stat.mode & 0o111) !== 0) {
      reject(`${entry.name} must be one non-executable regular file`);
    }
  }
  const testUrl = new URL('test/', rootUrl);
  const testEntries = assertDirectory(testUrl, TEST_ENTRIES, 'Trusted provider process tests');
  for (const entry of testEntries.filter(({ name }) => name !== 'fixtures')) {
    const stat = lstatSync(new URL(entry.name, testUrl));
    if (!entry.isFile() || !stat.isFile() || stat.isSymbolicLink()
      || (stat.mode & 0o111) !== 0) {
      reject(`test/${entry.name} must be one non-executable regular file`);
    }
  }
  const fixtureUrl = new URL('fixtures/', testUrl);
  const fixtureEntries = assertDirectory(
    fixtureUrl,
    FIXTURE_ENTRIES,
    'Trusted provider process fixtures',
  );
  if (fixtureEntries.some((entry) => !entry.isFile()
    || (lstatSync(new URL(entry.name, fixtureUrl)).mode & 0o111) !== 0)) {
    reject('Trusted provider process fixtures must be non-executable regular files');
  }

  const sources = Object.fromEntries(Object.keys(STATIC_IMPORTS).map((name) => [
    name,
    readFileSync(new URL(name, rootUrl), 'utf8'),
  ]));
  for (const [name, expected] of Object.entries(STATIC_IMPORTS)) {
    const dynamicImports = sources[name].match(/\bimport\s*\(/gu) ?? [];
    const dynamicImportsAllowed = dynamicImports.length === 0
      || (name === 'contract.mjs'
        && dynamicImports.length === 1
        && sources[name].includes("import('../browser-relay-operation/contract.mjs')"))
      || (name === 'worker.mjs'
        && dynamicImports.length === 1
        && sources[name].includes("import(`data:text/javascript;base64,${bytes.toString('base64')}`)"));
    if (!exactNames(imports(sources[name]), expected)
      || /^\s*import\s*['"]/mu.test(sources[name])
      || !dynamicImportsAllowed) {
      reject(`${name} imports differ from the reviewed allowlist`);
    }
  }

  const internal = sources['internal.mjs'];
  const worker = sources['worker.mjs'];
  const processEntry = sources['process.mjs'];
  const framing = sources['framed-channel.mjs'];
  for (const marker of [
    'spawn(process.execPath',
    'detached: true',
    'env: Object.create(null)',
    'shell: false',
    "stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']",
    "process.kill(-child.pid, 'SIGKILL')",
    'ready_timeout_milliseconds',
    'operation_timeout_milliseconds',
    'cancellation_grace_milliseconds',
    "beginShutdown('aborted', true)",
    'await Promise.all([processClosed.promise, responseSettled.promise])',
    'terminateAndVerifyProcessGroup',
    'processGroupExists',
    'cancelSent',
    'supportedNodeRuntime',
  ]) {
    if (!internal.includes(marker)) reject('Trusted provider process lifecycle has drifted');
  }
  for (const marker of [
    'fd: 3',
    'fd: 4',
    'fsConstants.O_NOFOLLOW',
    'realpathSync.native(path) !== path',
    "process.send !== undefined",
    'process.execArgv.length !== 0',
    'sanitizeWorkerEnvironment',
    'Object.keys(process.env).length === 0',
    'data:text/javascript;base64',
    'validateTrustedProviderOwnerModule',
    'cloneValidatedTrustedProviderProcessResult',
    'await owner.close()',
    "forcedFailureCode = 'invalid_protocol'",
    'runBrowserRelayTrustedProviderWorker',
  ]) {
    if (!worker.includes(marker)) reject('Trusted provider owner worker has drifted');
  }
  for (const marker of [
    'createBrowserRelayTrustedProviderProcess',
    'cloneValidatedTrustedProviderProcessResult',
    "StagingBrowserRelayTrustedProviderProcessError('peer_failed')",
    'Object.create(null)',
    'execute',
    'close',
  ]) {
    if (!processEntry.includes(marker)) reject('Trusted provider public entry has drifted');
  }
  for (const marker of [
    'TextDecoder',
    'readUInt32BE',
    'writeUInt32BE',
    'JSON.stringify(value) !== text',
    'ignoreBOM: true',
    'TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_DEPTH',
    'TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_TOKENS',
    "stream.once('drain', onDrain)",
    "stream.once('close', onStreamClose)",
    "stream.on('close', onStreamFailure)",
    'pendingDispatch.catch',
  ]) {
    if (!framing.includes(marker)) reject('Trusted provider framed channel has drifted');
  }

  const productionBoundary = Object.values(sources).join('\n');
  if (/\b(?:fork|exec|execFile|spawnSync|execSync)\s*\(/u.test(productionBoundary)
    || /['"]ipc['"]|\bsendHandle\b|process\.send\s*\(/u.test(productionBoundary)
    || /env:\s*process\.env|stdio:\s*['"]inherit['"]|shell:\s*true/u.test(productionBoundary)
    || /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource)\b|node:(?:http|https|net|tls|dns)/u
      .test(productionBoundary)
    || /\b(?:firebase-admin|google-auth-library|@google-cloud|gcloud|terraform)\b/u
      .test(productionBoundary)
    || /\b(?:access_token|authorization|id_token|private_key|refresh_token|secret_value)\b/u
      .test(productionBoundary)
    || /\b(?:retry|restart|respawn|replay)\b/u.test(productionBoundary)) {
    reject('Trusted provider process exceeds the reviewed narrow authority');
  }

  const { validateBrowserRelayTrustedProviderProcessProfile } = await import('./contract.mjs');
  const profile = validateBrowserRelayTrustedProviderProcessProfile();
  if (profile.ownership.dedicated_process_ipc_present !== true
    || profile.ownership.operating_system_sandbox_present !== false
    || profile.compatibility.live_owner_bundle_present !== false
    || profile.compatibility.live_operation_wired !== false
    || profile.evidence.cloud_requests !== 0
    || profile.evidence.cloud_mutations !== 0
    || profile.evidence.live_execution_count !== 0
    || profile.evidence.incremental_monthly_cost_eur !== 0) {
    reject('Trusted provider process profile exceeds its dormant authority');
  }
  return profile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    process.stderr.write(
      'Usage: node guard.mjs <browser-relay-trusted-provider-process-root>\n',
    );
    process.exitCode = 2;
  } else {
    try {
      const profile = await validateBrowserRelayTrustedProviderProcessRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      process.stdout.write(
        `Validated ${profile.schema}; provider ownership remains dormant.\n`,
      );
    } catch {
      process.stderr.write('Trusted provider process root rejected.\n');
      process.exitCode = 1;
    }
  }
}
