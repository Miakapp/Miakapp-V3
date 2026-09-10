import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateBrowserRelayOperatorAuthoritySourceProfile } from './contract.mjs';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'check.sh',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'source.mjs',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../workload/contract.mjs', 'node:crypto', 'node:fs', 'node:util',
  ]),
  'internal.mjs': Object.freeze([
    '../workload/contract.mjs', './contract.mjs', 'node:util',
  ]),
  'source.mjs': Object.freeze([
    '../workload/contract.mjs', './internal.mjs', 'node:child_process', 'node:url',
  ]),
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

export function validateBrowserRelayOperatorAuthoritySourceRoot(rootUrl) {
  const rootPath = resolve(fileURLToPath(rootUrl));
  const root = lstatSync(rootPath);
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!root.isDirectory() || root.isSymbolicLink()
    || !exactNames(entries.map(({ name }) => name), REQUIRED_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Operator authority source root differs from the reviewed regular-file inventory');
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

  const combined = Object.values(sources).join('\n');
  const runtimeSources = `${sources['internal.mjs']}\n${sources['source.mjs']}\n${sources['testing.mjs']}`;
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(runtimeSources)) {
    reject('Operator authority source contains a forbidden target or credential literal');
  }
  if (/GOOGLE_APPLICATION_CREDENTIALS|application-default|service-account\s+activate|auth\/impersonate_service_account=.*|exec(?:File)?Sync|\bshell:\s*true/u
    .test(combined)) {
    reject('Operator authority source contains an unreviewed credential or command path');
  }
  if (/process\.(?:argv|stdin)|process\.env|https?:\/\/(?!openidconnect\.googleapis\.com\/v1\/userinfo)/u
    .test(`${sources['internal.mjs']}\n${sources['source.mjs']}`)) {
    reject('Operator authority source contains an ambient input or arbitrary network target');
  }
  for (const marker of [
    "spawnSync('gcloud'",
    'env: childEnvironment()',
    "stdio: ['ignore', 'pipe', 'pipe']",
    'shell: false',
    "['config', 'get-value', 'account', '--quiet']",
    "['config', 'get-value', 'auth/impersonate_service_account', '--quiet']",
    "['auth', 'print-access-token', `--account=${account}`, '--quiet']",
    'OPERATOR_AUTHORITY_SOURCE_USERINFO_URL',
    'email_verified !== true',
    "authority.toString('ascii')",
    'cloneOperatorAuthorityCallbackResult(result, authorityText)',
    'overwrite(authority)',
    'AbortSignal.timeout(OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS)',
  ]) {
    if (!combined.includes(marker)) reject('Operator authority source safety boundary has drifted');
  }
  if (/export\s+(?:async\s+)?function\s+(?:get|print|load|return).*token/iu.test(combined)
    || /export\s+const\s+.*(?:token|credential)/iu.test(combined)) {
    reject('Operator authority source exposes an unreviewed credential-return API');
  }
  return validateBrowserRelayOperatorAuthoritySourceProfile(new URL('profile.json', rootUrl));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-operator-authority-source-root>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateBrowserRelayOperatorAuthoritySourceRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      console.log(`Validated ${profile.schema}; the real operator authority source remains dormant.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Operator authority source rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
