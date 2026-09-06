import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'operation.mjs',
  'profile.json',
]);

function reject(message) {
  throw new Error(message);
}

export function validateBrowserRelayOperationRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || !entry.isFile()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink())) {
    reject('Browser-relay operation root may contain regular files only');
  }
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...REQUIRED_FILES].sort())) {
    reject('Browser-relay operation root differs from the reviewed file inventory');
  }
  if (entries.some((entry) => (lstatSync(new URL(entry.name, rootUrl)).mode & 0o111) !== 0)) {
    reject('Browser-relay operation files must not be executable');
  }
  const operation = readFileSync(new URL('operation.mjs', rootUrl), 'utf8');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(operation)) {
    reject('Browser-relay operation source contains a forbidden target or credential literal');
  }
  if (/process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b|\bfirebase\b/u
    .test(operation)) {
    reject('Browser-relay operation must remain a dormant in-process composition library');
  }
  const cleanupOrder = [
    'components.removeRunner',
    'components.stopSessions',
    'components.closeRelaysPrivateReady',
    'components.verifyWindowCleanup',
    'components.removeSyntheticFixture',
    'components.removeTemporaryBindings',
    'components.verifyFinalCleanup',
  ].map((needle) => operation.indexOf(needle));
  if (cleanupOrder.some((index) => index < 0)
    || cleanupOrder.some((index, position) => position > 0 && index <= cleanupOrder[position - 1])) {
    reject('Browser-relay operation cleanup order has drifted');
  }
  const publicLast = [
    'components.publishRunner',
    'components.verifyRunner',
    "components.sampleMonitoring('before_matrix'",
    'components.openRelaysPublic',
    'components.executeBrowserMatrix',
  ].map((needle) => operation.indexOf(needle));
  if (publicLast.some((index) => index < 0)
    || publicLast.some((index, position) => position > 0 && index <= publicLast[position - 1])) {
    reject('Relay public-last execution order has drifted');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-operation-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayOperationRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
