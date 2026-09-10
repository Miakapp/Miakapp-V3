import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateBrowserRelayHostingPublisherProfile } from './contract.mjs';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'check.sh',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'publisher.mjs',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-relay-page/artifact.mjs', '../browser-relay-page/boundary.mjs',
    '../browser-relay-page/contract.mjs', '../workload/contract.mjs',
    'node:crypto', 'node:fs', 'node:util',
  ]),
  'internal.mjs': Object.freeze([
    '../workload/contract.mjs', './contract.mjs', 'node:util', 'node:zlib',
  ]),
  'publisher.mjs': Object.freeze(['./internal.mjs']),
  'testing.mjs': Object.freeze(['./internal.mjs']),
});

function reject(message) {
  throw new Error(message);
}

function exactNames(value, expected) {
  return JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
}

function imports(source) {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
}

export function validateBrowserRelayHostingPublisherRoot(rootUrl) {
  const rootPath = resolve(fileURLToPath(rootUrl));
  const root = lstatSync(rootPath);
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!root.isDirectory() || root.isSymbolicLink()
    || !exactNames(entries.map(({ name }) => name), REQUIRED_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Hosting publisher root differs from the reviewed regular-file inventory');
  }
  for (const name of REQUIRED_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be one non-executable regular file`);
    }
  }

  const sources = Object.fromEntries(Object.keys(STATIC_IMPORTS).map((name) => [
    name,
    readFileSync(new URL(name, rootUrl), 'utf8'),
  ]));
  for (const [name, expected] of Object.entries(STATIC_IMPORTS)) {
    if (!exactNames(imports(sources[name]), expected)
      || /^\s*import\s*['"]/mu.test(sources[name])
      || /\bimport\s*\(/u.test(sources[name])) {
      reject(`${name} imports differ from the reviewed allowlist`);
    }
  }

  const runtime = `${sources['internal.mjs']}\n${sources['publisher.mjs']}\n${sources['testing.mjs']}`;
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(runtime)) {
    reject('Hosting publisher contains a forbidden target or credential literal');
  }
  if (/process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|google-auth-library|\bgcloud\b|\bterraform\b|browser-attestation/u
    .test(runtime)) {
    reject('Hosting publisher must use only its injected ephemeral HTTP boundary');
  }
  if (/\b(?:setInterval|fetch)\s*\(/u.test(sources['publisher.mjs'])
    || /https?:\/\/(?!firebasehosting\.googleapis\.com|upload-firebasehosting\.googleapis\.com)/u
      .test(runtime)) {
    reject('Hosting publisher contains an unreviewed scheduler or network target');
  }
  const combined = Object.values(sources).join('\n');
  for (const marker of [
    "BROWSER_RELAY_HOSTING_SITE = 'miakapp-v4-staging'",
    "BROWSER_RELAY_HOSTING_API_ORIGIN = 'https://firebasehosting.googleapis.com'",
    "BROWSER_RELAY_HOSTING_UPLOAD_ORIGIN =",
    'gunzipSync(entry.gzip',
    'requireDisabledInventory',
    "latest.type !== 'SITE_DISABLE'",
    'attempts.create += 1',
    'attempts.populate += 1',
    'attempts.upload += 1',
    'attempts.finalize += 1',
    'attempts.deploy += 1',
    'attempts.disable += 1',
    'attempts.delete += 1',
    'await verifyCleanup()',
    'createBrowserRelayHostingPublisher',
    'publishRunner',
    'verifyRunner',
    'removeRunner',
  ]) {
    if (!combined.includes(marker)) reject('Hosting publisher safety boundary has drifted');
  }
  if (/\b(?:p-retry|async-retry|retry-axios)\b/u.test(combined)
    || /while\s*\([^)]*(?:create|populate|upload|finalize|deploy|disable|delete)/iu
      .test(runtime)) {
    reject('Hosting publisher contains an unreviewed mutation retry path');
  }
  return validateBrowserRelayHostingPublisherProfile(new URL('profile.json', rootUrl));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-hosting-publisher-root>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateBrowserRelayHostingPublisherRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      console.log(`Validated ${profile.schema}; the staging Hosting publisher remains dormant.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Hosting publisher rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
