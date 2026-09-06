import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'cloud.mjs',
  'contract.mjs',
  'guard.mjs',
  'preflight-result-v1.json',
  'profile.json',
]);

function reject(message) {
  throw new Error(message);
}

export function validateBrowserRelayMonitoringRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || !entry.isFile()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink())) {
    reject('Browser-relay monitoring root may contain regular files only');
  }
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...REQUIRED_FILES].sort())) {
    reject('Browser-relay monitoring root differs from the reviewed file inventory');
  }
  if (entries.some((entry) => (lstatSync(new URL(entry.name, rootUrl)).mode & 0o111) !== 0)) {
    reject('Browser-relay monitoring files must not be executable');
  }
  const sources = Object.fromEntries(REQUIRED_FILES
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => [name, readFileSync(new URL(name, rootUrl), 'utf8')]));
  const combined = [sources['cloud.mjs'], sources['contract.mjs']].join('\n');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(sources['cloud.mjs'])) {
    reject('Browser-relay monitoring source contains a forbidden target or credential literal');
  }
  if (/process\.argv|process\.stdin|child_process|execSync|spawnSync|\bgcloud\b/u.test(combined)) {
    reject('Browser-relay monitoring package must remain a dormant in-process library');
  }
  if (/\b(?:POST|PUT|PATCH|DELETE)\b/u.test(sources['cloud.mjs'])
    || /writeFile|appendFile|createWriteStream/u.test(combined)
    || !sources['cloud.mjs'].includes("method: 'GET'")
    || !sources['cloud.mjs'].includes("url.searchParams.set('view', profile.observation.query_view)")
    || !sources['cloud.mjs'].includes('validateCanonicalPrivateInventory')
    || !sources['cloud.mjs'].includes('validateRelayServicesPrivateReadyInventory')
    || !sources['contract.mjs'].includes("'stop_and_rollback_required'")) {
    reject('Browser-relay monitoring read-only or fail-closed boundary has drifted');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-monitoring-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayMonitoringRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
