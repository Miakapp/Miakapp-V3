import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'cloud.mjs',
  'contract.mjs',
  'guard.mjs',
  'profile.json',
]);

function reject(message) {
  throw new Error(message);
}

export function validateBrowserRelayRollbackRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || !entry.isFile()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink())) {
    reject('Browser-relay rollback root may contain regular files only');
  }
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...REQUIRED_FILES].sort())) {
    reject('Browser-relay rollback root differs from the reviewed file inventory');
  }
  if (entries.some((entry) => (lstatSync(new URL(entry.name, rootUrl)).mode & 0o111) !== 0)) {
    reject('Browser-relay rollback files must not be executable');
  }
  const sources = Object.fromEntries(REQUIRED_FILES
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => [name, readFileSync(new URL(name, rootUrl), 'utf8')]));
  const combined = [sources['cloud.mjs'], sources['contract.mjs']].join('\n');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(sources['cloud.mjs'])) {
    reject('Browser-relay rollback source contains a forbidden target or credential literal');
  }
  if (/process\.argv|process\.stdin|child_process|execSync|spawnSync|\bgcloud\b/u.test(combined)
    || /writeFile|appendFile|createWriteStream/u.test(combined)) {
    reject('Browser-relay rollback package must remain a dormant in-process library');
  }
  const mutatingMethod = /method:\s*['"](?:PATCH|PUT|DELETE)['"]/u;
  const postCount = [...sources['cloud.mjs'].matchAll(/method:\s*'POST'/gu)].length;
  if (mutatingMethod.test(sources['cloud.mjs']) || postCount !== 2
    || !sources['cloud.mjs'].includes('documents:listCollectionIds')
    || !sources['cloud.mjs'].includes(':getIamPolicy')
    || !sources['cloud.mjs'].includes("method: 'HEAD'")
    || !sources['cloud.mjs'].includes('summarizeRelayTerraformNoChangePlan')
    || !sources['cloud.mjs'].includes('validateCanonicalPrivateInventory')
    || !sources['cloud.mjs'].includes('validateRelayServicesPrivateReadyInventory')
    || !sources['contract.mjs'].includes("'remove_acceptance_runner_route'")
    || !sources['contract.mjs'].includes("'no_changes'")) {
    reject('Browser-relay rollback read-only or fail-closed boundary has drifted');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-rollback-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayRollbackRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
