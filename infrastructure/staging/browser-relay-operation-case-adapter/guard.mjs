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
    '../browser-relay-independent-case-adapter/adapter.mjs',
    '../browser-relay-operation/operation.mjs',
    './contract.mjs',
    './internal.mjs',
  ]),
  'contract.mjs': Object.freeze([
    '../browser-relay-independent-case-adapter/contract.mjs',
    '../browser-relay-operation/contract.mjs',
    '../browser-relay-orchestrator/contract.mjs',
    '../browser-relay-runner/contract.mjs',
    '../browser-relay/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ]),
  'internal.mjs': Object.freeze([
    '../browser-relay-operation/contract.mjs',
    '../browser-relay-orchestrator/claim.mjs',
    './contract.mjs',
    'node:util',
  ]),
  'testing.mjs': Object.freeze([
    './contract.mjs',
    './internal.mjs',
  ]),
});
const READ_ONLY_CONTRACT_IMPORTS = Object.freeze({
  'node:crypto': Object.freeze(['createHash']),
  'node:fs': Object.freeze(['lstatSync', 'readFileSync']),
  'node:util': Object.freeze(['isDeepStrictEqual']),
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
    reject(`${name} imports differ from the reviewed composition-only allowlist`);
  }
}

function validateReadOnlyContract(source) {
  for (const [moduleName, expected] of Object.entries(READ_ONLY_CONTRACT_IMPORTS)) {
    const escaped = moduleName.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const matches = [...source.matchAll(new RegExp(
      `import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]\\s*;`,
      'gu',
    ))];
    const bindings = matches.length === 1
      ? matches[0][1].split(',').map((value) => value.trim()).filter(Boolean).sort()
      : [];
    if (JSON.stringify(bindings) !== JSON.stringify([...expected].sort())) {
      reject(`contract.mjs ${moduleName} bindings exceed the read-only allowlist`);
    }
  }
  if (/\b(?:appendFile|appendFileSync|chmod|chmodSync|chown|chownSync|copyFile|copyFileSync|cp|cpSync|link|linkSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|open|openSync|rename|renameSync|rm|rmSync|rmdir|rmdirSync|symlink|symlinkSync|truncate|truncateSync|unlink|unlinkSync|write|writeFile|writeFileSync|writeSync)\b|\bprocess\s*\.|\bglobalThis\s*\.\s*(?:fetch|WebSocket)|\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u
    .test(source)) {
    reject('contract.mjs exceeds its read-only validation authority');
  }
}

export function validateBrowserRelayOperationCaseAdapterRoot(rootUrl) {
  const root = lstatSync(rootUrl);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Browser-relay operation case-adapter root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...ROOT_FILES].sort())) {
    reject('Browser-relay operation case-adapter inventory has drifted');
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Browser-relay operation case-adapter entries must be regular files');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const contents = Object.fromEntries(
    ROOT_FILES.map((name) => [
      name,
      readFileSync(new URL(name, rootUrl), 'utf8'),
    ]),
  );
  const sources = Object.fromEntries(
    Object.keys(STATIC_IMPORTS).map((name) => [name, contents[name]]),
  );
  for (const [name, source] of Object.entries(sources)) validateStaticImports(name, source);
  validateReadOnlyContract(sources['contract.mjs']);

  for (const marker of [
    'runSingleUseBrowserRelayOperation',
    'runBrowserRelayIndependentCaseSchedule',
    'runBrowserRelayClaimBoundOperationWithRunners',
  ]) {
    if (!sources['adapter.mjs'].includes(marker)) {
      reject('Operation case-adapter production composition has drifted');
    }
  }
  if (!/return runBrowserRelayClaimBoundOperationWithRunners\(\s*runSingleUseBrowserRelayOperation,\s*runBrowserRelayIndependentCaseSchedule,\s*components,?\s*\);/u
    .test(sources['adapter.mjs'])) {
    reject('Operation case-adapter production runner order has drifted');
  }
  for (const marker of [
    'INTERNAL_ERRORS.has(error)',
    'validateOrchestratorClaimReceipt',
    'OPERATION_CASE_ADAPTER_CLAIM_RECEIPT_FIELDS',
    'OPERATION_CASE_ADAPTER_WINDOW_CONTEXT_FIELDS',
    'claimAttempts !== 0',
    'matrixInvocations !== 0',
    'protocolViolated = true',
    'windowEntries !== 0',
    'createClaimCapability',
    'capability.open(context)',
    'capability.enter(context)',
    'Object.freeze({ signal })',
    'binding.capability.complete()',
    'validateClosedRunnerResult',
    'validateOperationResult',
    'toJSON',
    'deadline > expires',
    'binding?.revoke()',
  ]) {
    if (!sources['internal.mjs'].includes(marker)) {
      reject('Operation case-adapter claim boundary has drifted');
    }
  }
  if (sources['adapter.mjs'].includes('ForTesting')
    || sources['adapter.mjs'].includes('./testing.mjs')
    || !sources['testing.mjs'].includes(
      'runBrowserRelayClaimBoundOperationForTesting',
    )) {
    reject('Operation case-adapter entrypoint separation has drifted');
  }
  const runtimeSource = [
    sources['adapter.mjs'],
    sources['internal.mjs'],
    sources['testing.mjs'],
  ].join('\n');
  if (/\bimport\s*\(|child_process|execSync|spawnSync|process\.(?:argv|env|stdin)|\bfetch\s*\(|\bgcloud\b|\bterraform\b|\.launch\s*\(|firebase-admin|google-auth-library|node:fs|node:http|node:https|node:net|node:tls/u
    .test(runtimeSource)) {
    reject('Operation case-adapter runtime exceeds its composition-only authority');
  }
  const guardedSource = Object.values(contents).join('\n');
  const legacyProject = ['miakapp', '3'].join('-');
  const productionProject = ['miakapp', 'v4'].join('-');
  const forbiddenTarget = new RegExp(
    `\\b${legacyProject}\\b|projects\\/${productionProject}(?:\\/|\\b)`,
    'u',
  );
  if (forbiddenTarget.test(guardedSource)) {
    reject('Operation case-adapter contains a forbidden target literal');
  }
  const credentialPattern = new RegExp([
    ['-----BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY-----'].join(''),
    ['\\b', 'ya29\\.', '[A-Za-z0-9._-]+', '\\b'].join(''),
    ['\\b', 'eyJ', '[A-Za-z0-9_-]{8,}', '\\.', '[A-Za-z0-9_-]{8,}',
      '\\.', '[A-Za-z0-9_-]{8,}', '\\b'].join(''),
  ].join('|'), 'u');
  if (credentialPattern.test(guardedSource)) {
    reject('Operation case-adapter contains a credential literal');
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(new URL('profile.json', rootUrl), 'utf8'));
  } catch {
    return reject('Operation case-adapter profile is not valid JSON');
  }
  if (profile?.authority === null || typeof profile?.authority !== 'object'
    || Object.values(profile.authority).some((value) => value !== false)
    || profile?.target?.cloud_compute_resources !== 0
    || profile?.target?.unscheduled !== true
    || profile?.compatibility?.live_operation_wired !== false
    || profile?.compatibility?.hosting_publication_wired !== false
    || profile?.trust_boundary?.hard_termination_present !== false
    || profile?.evidence?.cloud_requests !== 0
    || profile?.evidence?.cloud_mutations !== 0
    || profile?.evidence?.live_execution_count !== 0) {
    reject('Operation case-adapter profile exceeds its composition-only authority');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-operation-case-adapter-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayOperationCaseAdapterRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
