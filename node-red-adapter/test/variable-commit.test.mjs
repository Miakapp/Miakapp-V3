/**
 * What `commitVariables` sends to the coordinator.
 *
 * The v4 state model has to reproduce these values, so the coercions the v3
 * node performs matter as much as the paths it writes.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startHouse, settle } from '../src/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

let house;

before(async () => {
  process.env.HOUSE_VERSION = '3.0.31';
  const flows = JSON.parse(
    await readFile(path.join(here, '..', 'fixtures', 'synthetic-house.flows.json'), 'utf8'),
  );
  house = await startHouse({ flows });
  await settle();
});

after(async () => {
  await house?.stop();
});

test('a commit resolves jsonata, literal and env values in one payload', async () => {
  house.receive('commit-etat', { payload: 21.5 });
  await settle();

  assert.equal(house.recorder.commits.length, 1);
  assert.deepEqual(house.recorder.commits[0], {
    'capteurs.salon.temperature': 21.5,
    'capteurs.salle de bain.humidite': '48',
    'systeme.version': '3.0.31',
  });
});

test('variable paths keep spaces and accents exactly as authored', async () => {
  // `capteurs.salle de bain.humidite` survives untouched. Anything in v4 that
  // assumes dotted paths are slug-shaped will not round-trip a real house.
  const [committed] = house.recorder.commits;
  assert.ok(Object.keys(committed).includes('capteurs.salle de bain.humidite'));
});

test('a falsy sensor reading is committed as an empty string, not as its value', async () => {
  // `variables[path] = jsonata(...).evaluate(contexts) || ''` in miakapi.js.
  // A temperature of 0, a closed contact of false, an empty count: all arrive
  // at the coordinator as ''. This is the single most likely source of silent
  // divergence when v4 replays v3 state, so it is pinned here rather than
  // discovered during migration.
  house.receive('commit-etat', { payload: 0 });
  await settle();

  assert.equal(house.recorder.commits.length, 2);
  assert.equal(house.recorder.commits[1]['capteurs.salon.temperature'], '');

  house.receive('commit-etat', { payload: false });
  await settle();
  assert.equal(house.recorder.commits[2]['capteurs.salon.temperature'], '');
});

test('each commit sends the full variable set, not only what changed', async () => {
  // The node accumulates into one module level object and assigns the whole
  // thing on every commit, so the coordinator always receives every path this
  // flow knows about.
  const latest = house.recorder.commits.at(-1);
  assert.deepEqual(Object.keys(latest).sort(), [
    'capteurs.salle de bain.humidite',
    'capteurs.salon.temperature',
    'systeme.version',
  ]);
});
