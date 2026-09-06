import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'claim.mjs',
  'contract.mjs',
  'guard.mjs',
  'orchestrator.mjs',
  'preflight.mjs',
  'preflight-result-v1.json',
  'profile.json',
]);

function reject(message) {
  throw new Error(message);
}

export function validateBrowserRelayOrchestratorRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || !entry.isFile()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink())) {
    reject('Browser-relay orchestrator root may contain regular files only');
  }
  const names = entries.map(({ name }) => name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...REQUIRED_FILES].sort())) {
    reject('Browser-relay orchestrator root differs from the reviewed file inventory');
  }
  if (entries.some((entry) => (lstatSync(new URL(entry.name, rootUrl)).mode & 0o111) !== 0)) {
    reject('Browser-relay orchestrator files must not be executable');
  }

  const sources = Object.fromEntries(REQUIRED_FILES
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => [name, readFileSync(new URL(name, rootUrl), 'utf8')]));
  const activeSources = Object.entries(sources)
    .filter(([name]) => !['contract.mjs', 'guard.mjs'].includes(name))
    .map(([, source]) => source)
    .join('\n');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(activeSources)) {
    reject('Browser-relay orchestrator source contains a forbidden target or credential');
  }
  const combined = Object.entries(sources)
    .filter(([name]) => name !== 'guard.mjs')
    .map(([, source]) => source)
    .join('\n');
  if (/process\.argv|process\.stdin|process\.env|child_process|execSync|spawnSync|\bgcloud\b/u
    .test(combined)) {
    reject('Browser-relay orchestrator must remain a dormant in-process library');
  }
  if (/method:\s*['"](?:DELETE|PUT)['"]/u.test(combined)
    || !sources['claim.mjs'].includes("url.searchParams.set('ifGenerationMatch', '0')")
    || !sources['claim.mjs'].includes('execution must stop without retry')
    || !sources['orchestrator.mjs'].includes('await components.validateAuthorization()')
    || !sources['orchestrator.mjs'].includes('await components.observeClaimAbsent()')
    || !sources['orchestrator.mjs'].includes('await components.acquireClaim(attemptedAt)')
    || !sources['orchestrator.mjs'].includes('sameClaimBaseline(baseline')
    || !sources['orchestrator.mjs'].includes('await runBoundedEdgeWindow(')
    || !sources['orchestrator.mjs'].includes('validateCanonicalPrivateInventory(')) {
    reject('Browser-relay orchestrator ordering differs from the reviewed single-use flow');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-orchestrator-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayOrchestratorRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
