/**
 * When a restored house is finished restoring.
 *
 * The restore rehearsal measures how long it takes to get the process back. That
 * is not the same question as how long it takes to get the *house* back, because
 * the house's state does not live in the user directory at all: it is pushed to
 * the coordinator by `commitVariables`, and the v3 node holds the outgoing set
 * in a module level object that starts empty on every boot.
 *
 * A restart therefore begins with an empty variable set, and each commit sends
 * the whole set rather than a delta. This file measures what the coordinator
 * receives in between.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { startHouse, settle } from '../src/harness.mjs';

/**
 * Two independent commit nodes, as a real house has: one per source of readings.
 *
 * The synthetic-house fixture has a single commit node, which cannot show what
 * happens between the first commit and the last after a restart.
 */
const flows = [
  { id: 'tab-maison', type: 'tab', label: 'Maison' },
  {
    id: 'init-home',
    type: 'initMiakapi',
    z: 'tab-maison',
    home: 'maison-synthetique',
    coordID: 'coord-synthetique',
    coordSecret: 'secret-en-clair-du-coordinateur',
    wires: [],
  },
  {
    id: 'commit-salon',
    type: 'commitVariables',
    z: 'tab-maison',
    name: 'Salon',
    values: { 'capteurs.salon.temperature': { type: 'jsonata', value: 'msg.payload' } },
    wires: [],
  },
  {
    id: 'commit-chaudiere',
    type: 'commitVariables',
    z: 'tab-maison',
    name: 'Chaudière',
    // A boiler reports rarely. That is the point: this node may not fire for a
    // long time after a restart.
    values: { 'chauffage.chaudiere.pression': { type: 'jsonata', value: 'msg.payload' } },
    wires: [],
  },
];

let house;

before(async () => {
  house = await startHouse({ flows });
  await settle();
});

after(async () => {
  await house?.stop();
});

test('a restarted house starts with an empty variable set', () => {
  // Nothing has committed yet, so the coordinator has heard nothing from this
  // process about any path, however much state the previous one had sent.
  assert.deepEqual(house.recorder.commits, []);
});

test('the first commit after a restart carries only the paths of the node that fired', async () => {
  house.receive('commit-salon', { payload: 21.5 });
  await settle();

  assert.equal(house.recorder.commits.length, 1);
  assert.deepEqual(house.recorder.commits[0], { 'capteurs.salon.temperature': 21.5 });

  // The boiler path is absent, not stale and not null. Combined with the
  // observation that every commit sends the whole set rather than a delta, a
  // coordinator that treats a commit as the house's complete state has just
  // been told the boiler path does not exist.
  assert.ok(!('chauffage.chaudiere.pression' in house.recorder.commits[0]));
});

test('the set is only complete once every commit node has fired at least once', async () => {
  house.receive('commit-chaudiere', { payload: 1.4 });
  await settle();

  assert.deepEqual(house.recorder.commits.at(-1), {
    'capteurs.salon.temperature': 21.5,
    'chauffage.chaudiere.pression': 1.4,
  });

  // So recovery time for state is not the boot time measured by the restore
  // rehearsal. It is bounded below by the slowest trigger in the house, and
  // nothing in the runtime reports when that point is reached.
  assert.equal(house.recorder.commits.length, 2);
});
