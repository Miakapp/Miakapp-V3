#!/usr/bin/env node
/**
 * Writes a Node-RED export that a real runtime produced, not one a human typed.
 *
 * Every MiakAPI v4 tool that reads `flows.json` — `miakapp discover` first
 * among them — has so far been tested against hand-authored fixtures, which
 * only ever prove the parser agrees with its author. This command deploys the
 * synthetic house into a real Node-RED 5 runtime and saves the file that
 * runtime persisted, so downstream parsers can be checked against the shape
 * Node-RED actually writes.
 *
 * Usage: node bin/capture-export.mjs [output-path]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startHouse, settle } from '../src/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'synthetic-house.flows.json');
const destination = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, '..', 'captured', 'runtime-export.flows.json');

const flows = JSON.parse(await readFile(fixture, 'utf8'));
const house = await startHouse({
  flows,
  users: [
    { uid: 'u-admin', displayName: 'Mathieu', groups: ['habitants', 'admins'], isAdmin: true, notifications: true },
    { uid: 'u-invite', displayName: 'Invité', groups: ['invites'], isAdmin: false, notifications: true },
  ],
});

try {
  await settle();
  const persisted = await house.persistedFlows();
  const credentials = await house.persistedCredentials();

  if (!persisted) throw new Error('the runtime persisted no flows.json');

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

  const secretHolders = persisted
    .filter((node) => typeof node.coordSecret === 'string' && node.coordSecret.length > 0)
    .map((node) => node.id);

  console.log(`captured ${persisted.length} nodes from a real Node-RED runtime -> ${destination}`);
  console.log(`registered node types: ${house.registeredTypes().sort().join(', ')}`);
  console.log(`credentials file: ${credentials ? 'present' : 'absent'}`);
  console.log(
    secretHolders.length > 0
      ? `coordSecret in cleartext in flows.json at: ${secretHolders.join(', ')}`
      : 'no cleartext coordSecret in flows.json',
  );
} finally {
  await house.stop();
}
