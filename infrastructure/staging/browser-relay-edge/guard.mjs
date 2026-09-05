import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'cloud.mjs',
  'guard.mjs',
  'inventory.mjs',
  'runtime.mjs',
  'window.mjs',
]);

function reject(message) {
  throw new Error(message);
}

export function validateBrowserRelayEdgeRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || !entry.isFile()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink())) {
    reject('Browser-relay edge root may contain regular files only');
  }
  const actual = entries.map(({ name }) => name).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...REQUIRED_FILES].sort())) {
    reject('Browser-relay edge root differs from the reviewed file inventory');
  }
  if (entries.some((entry) => (lstatSync(new URL(entry.name, rootUrl)).mode & 0o111) !== 0)) {
    reject('Browser-relay edge library files must not be executable');
  }

  const sources = Object.fromEntries(REQUIRED_FILES
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => [name, readFileSync(new URL(name, rootUrl), 'utf8')]));
  const combined = Object.entries(sources)
    .filter(([name]) => name !== 'guard.mjs')
    .map(([, source]) => source)
    .join('\n');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(combined)) {
    reject('Browser-relay edge source contains a forbidden target or credential literal');
  }
  if (/process\.argv|process\.stdin|child_process|execSync|spawnSync|\bgcloud\b/u
    .test(combined)) {
    reject('Browser-relay edge package must remain a dormant in-process library');
  }
  if (!sources['cloud.mjs'].includes('updateMask=serviceConfig.environmentVariables')
    || !sources['cloud.mjs'].includes('updateMask=serviceConfig.ingressSettings')
    || !sources['cloud.mjs'].includes("updateMask: 'bindings,etag'")
    || !sources['cloud.mjs'].includes('async closeIngress()')
    || !sources['window.mjs'].includes('await client.setRuntimeProfile(observed, EDGE_PROFILE)')
    || !sources['window.mjs'].includes("await client.setIngress(edgePrivate, 'ALLOW_ALL')")
    || !sources['window.mjs'].includes('await client.setPublicInvoker(ingressReady, true)')
    || !sources['window.mjs'].includes("client.setPublicInvoker(expected, false)")
    || !sources['window.mjs'].includes("client.setIngress(expected, 'ALLOW_INTERNAL_ONLY')")
    || !sources['window.mjs'].includes('await client.closeIngress()')
    || !sources['window.mjs'].includes("client.setRuntimeProfile(expected, 'canonical')")) {
    reject('Browser-relay edge transition ordering differs from the reviewed state machine');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-edge-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayEdgeRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
