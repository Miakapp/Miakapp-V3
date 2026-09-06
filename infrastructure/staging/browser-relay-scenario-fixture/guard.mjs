#!/usr/bin/env node

import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  SCENARIO_FIXTURE_PROFILE_PATH,
  StagingBrowserRelayScenarioFixtureError,
  validateBrowserRelayScenarioFixtureProfile,
} from './contract.mjs';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'contract.mjs',
  'fixture.mjs',
  'guard.mjs',
  'profile.json',
]);

export function validateBrowserRelayScenarioFixtureRoot(root) {
  const entry = lstatSync(root);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new StagingBrowserRelayScenarioFixtureError(
      'Browser-relay scenario fixture root must be one real directory',
    );
  }
  const entries = readdirSync(root, { withFileTypes: true });
  if (!isSameNames(entries.map(({ name }) => name), REQUIRED_FILES)
    || entries.some((candidate) => !candidate.isFile() || candidate.isSymbolicLink())) {
    throw new StagingBrowserRelayScenarioFixtureError(
      'Browser-relay scenario fixture root differs from the reviewed regular-file inventory',
    );
  }
  for (const name of REQUIRED_FILES) {
    const candidate = lstatSync(resolve(root, name));
    if (!candidate.isFile() || candidate.isSymbolicLink() || (candidate.mode & 0o111) !== 0) {
      throw new StagingBrowserRelayScenarioFixtureError(
        `${name} must be one non-executable regular file`,
      );
    }
  }
  const source = readFileSync(resolve(root, 'fixture.mjs'), 'utf8');
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u
    .test(source)
    || /\bfetch\b|globalThis|process\.(?:argv|env|stdin)|child_process|execSync|spawnSync|\bgcloud\b|\bterraform\b/u
      .test(source)) {
    throw new StagingBrowserRelayScenarioFixtureError(
      'Browser-relay scenario fixture escaped its dormant in-process boundary',
    );
  }
  for (const required of [
    'verifyReplacementIdentityAbsent',
    'REPLACEMENT_SYNTHETIC_UID',
    'pageTokenDigests',
    'await baseFixture.stop()',
    'removeReplacementIdentity',
    'await baseFixture.remove()',
  ]) {
    if (!source.includes(required)) {
      throw new StagingBrowserRelayScenarioFixtureError(
        'Browser-relay scenario fixture safety boundary has drifted',
      );
    }
  }
  return validateBrowserRelayScenarioFixtureProfile(
    resolve(root, SCENARIO_FIXTURE_PROFILE_PATH.split('/').at(-1)),
  );
}

function isSameNames(value, expected) {
  return JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node infrastructure/staging/browser-relay-scenario-fixture/guard.mjs <scenario-fixture-directory>\n');
    process.exitCode = 2;
  } else {
    try {
      const profile = validateBrowserRelayScenarioFixtureRoot(resolve(process.argv[2]));
      console.log(
        `Validated ${profile.schema}; four ordered page inputs span two synthetic identities without cloud or live authority.\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Browser-relay scenario fixture rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
