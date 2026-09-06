import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateBrowserRelayScenarioFixtureCloudProfile } from './contract.mjs';

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

function exactNames(value, expected) {
  return JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
}

export function validateBrowserRelayScenarioFixtureCloudRoot(rootUrl) {
  const root = lstatSync(resolve(fileURLToPath(rootUrl)));
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Scenario fixture cloud root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!exactNames(entries.map(({ name }) => name), REQUIRED_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Scenario fixture cloud root differs from the reviewed regular-file inventory');
  }
  for (const name of REQUIRED_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const source = readFileSync(new URL('cloud.mjs', rootUrl), 'utf8');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(source)) {
    reject('Scenario fixture cloud source contains a forbidden target or credential literal');
  }
  if (/process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|google-auth-library|\bgcloud\b|\bterraform\b/u
    .test(source)) {
    reject('Scenario fixture cloud adapter must use only its injected ephemeral boundary');
  }
  for (const required of [
    'verifyReplacementIdentityAbsent',
    'createReplacementIdentity',
    'issueReplacementFirebaseCustomToken',
    'removeReplacementIdentity',
    'signedJwtAttempts',
    'identityDeletionAttempted',
    'identityExchangeDispatched',
    'lookupReplacementUser',
  ]) {
    if (!source.includes(required)) {
      reject('Scenario fixture cloud safety boundary has drifted');
    }
  }
  return validateBrowserRelayScenarioFixtureCloudProfile(new URL('profile.json', rootUrl));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-scenario-fixture-cloud-root>');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateBrowserRelayScenarioFixtureCloudRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      console.log(
        `Validated ${profile.schema}; the replacement identity adapter remains dormant and closed.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Scenario fixture cloud adapter rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
