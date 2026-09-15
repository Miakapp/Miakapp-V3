/**
 * What a real Node-RED runtime registers, and what it writes to disk.
 *
 * These assertions are the reason the harness exists. Until now every claim
 * about the v3 node's storage came from reading `miakapi.html`; here the
 * runtime itself answers.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startHouse, settle } from '../src/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '..', 'fixtures', 'synthetic-house.flows.json');

let authored;
let house;

before(async () => {
  authored = JSON.parse(await readFile(fixturePath, 'utf8'));
  house = await startHouse({ flows: authored });
  await settle();
});

after(async () => {
  await house?.stop();
});

test('the runtime registers every node type the package declares', () => {
  assert.deepEqual(house.registeredTypes().sort(), [
    'commitVariables',
    'getHomeUsers',
    'initMiakapi',
    'onHomeReady',
    'onHomeUpdate',
    'onUserAction',
    'onUserLogin',
    'reconnectMiakapi',
    'sendPushNotif',
  ]);
});

test('a full deploy is persisted verbatim, with no injected defaults', async () => {
  // Worth stating plainly: Node-RED 5 does not normalise a full deploy. It
  // writes back exactly what it was given, in the same order, without filling
  // in node defaults. So a hand-authored fixture is a structurally faithful
  // stand-in for a runtime export, and parsers cannot be caught out by
  // silently added fields. The harness is what makes that checkable rather
  // than assumed.
  const persisted = await house.persistedFlows();
  assert.deepEqual(persisted, authored);
});

test('coordSecret is stored in cleartext in flows.json', async () => {
  const persisted = await house.persistedFlows();
  const init = persisted.find((node) => node.type === 'initMiakapi');

  assert.equal(init.coordSecret, 'secret-en-clair-du-coordinateur');

  // The raw file, not the parsed object: anyone reading flows.json — a backup,
  // a git remote, a support archive — reads the coordinator secret.
  const raw = await readFile(path.join(house.userDir, 'flows.json'), 'utf8');
  assert.ok(raw.includes('secret-en-clair-du-coordinateur'));
});

test('no credentials file is created at all, because the node declares none', async () => {
  // `initMiakapi` lists `coordSecret` in `defaults`, never in `credentials`,
  // and registers no credentials schema with the runtime. Node-RED therefore
  // has nothing to encrypt and writes no flows_cred.json, even though the
  // harness supplies a credentialSecret. This is the mechanism behind the
  // cleartext storage above, observed rather than inferred.
  assert.equal(await house.persistedCredentials(), null);
});

test('the secret reaches the SDK exactly as the flow spells it', () => {
  assert.deepEqual(house.recorder.connections, [
    {
      homeID: 'maison-synthetique',
      coordID: 'coord-synthetique',
      coordSecret: 'secret-en-clair-du-coordinateur',
    },
  ]);
});
