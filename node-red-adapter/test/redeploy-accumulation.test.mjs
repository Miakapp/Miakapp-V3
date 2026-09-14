/**
 * What a second Deploy does to a running v3 house.
 *
 * RFC 0003 §18 lists "callbacks append forever" as v3 behavior to be fixed
 * "with idempotent unsubscribe and shutdown cleanup". That row was written by
 * reading `miakapi.js`. These tests make it an observation, and they show the
 * consequence is both larger and differently shaped than the row implies.
 *
 * `miakapi.js` at 3.0.31 registers no `close` handler for any of its node
 * types, and keeps `HOME` plus a `handlers` object in module scope. A Node-RED
 * full deploy destroys every node and rebuilds it in the same process, so
 * nothing the previous generation put into module scope is ever taken back
 * out. Two independent things therefore accumulate at once:
 *
 *   - one coordinator client per deploy, each still subscribed;
 *   - one `handlers.userAction` entry per action node per deploy.
 *
 * Delivery walks both lists, so the duplication multiplies rather than adds.
 * These tests run in order and share one house on purpose: the growth law is
 * the subject.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startHouse, settle } from '../src/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

let house;

const resident = {
  displayName: 'Mathieu',
  groups: ['habitants'],
  isAdmin: true,
  notifications: true,
};

const lampPress = { type: 'press', input: { id: 'lampe-salon' }, user: resident };

/** How many messages `action-lampe` emits for exactly one press. */
async function deliveriesForOnePress() {
  const before = house.sent.filter((event) => event.sourceId === 'action-lampe').length;
  house.emit.userAction(lampPress);
  await settle();
  return house.sent.filter((event) => event.sourceId === 'action-lampe').length - before;
}

before(async () => {
  const flows = JSON.parse(
    await readFile(path.join(here, '..', 'fixtures', 'synthetic-house.flows.json'), 'utf8'),
  );
  house = await startHouse({ flows });
  await settle();
});

after(async () => {
  await house?.stop();
});

test('the first deploy behaves: one press, one message', async () => {
  assert.equal(house.recorder.connections.length, 1);
  assert.equal(await deliveriesForOnePress(), 1);
});

test('a full redeploy opens a second coordinator connection and closes nothing', async () => {
  await house.redeploy();
  await settle();

  // `initMiakapi` calls `Miakapi(...)` in its constructor, and the package
  // registers no close handler, so the first client is overwritten in module
  // scope while still holding its socket. Against the real coordinator this is
  // a connection leak, one per deploy, for the life of the Node-RED process.
  assert.equal(house.recorder.connections.length, 2);

  // Same credentials both times: one house reconnecting, not a reconfiguration.
  const [first, second] = house.recorder.connections;
  assert.deepEqual(first, second);
});

test('after one redeploy a single press fires the flow four times, not twice', async () => {
  // Two leaked clients each receive the action, and each fans out over a
  // `handlers.userAction` list that now holds two entries for `lampe-salon`.
  // Two times two. The duplication multiplies because both lists grew.
  assert.equal(await deliveriesForOnePress(), 4);
});

test('a second redeploy makes it nine: the amplification is quadratic in deploys', async () => {
  await house.redeploy();
  await settle();

  assert.equal(house.recorder.connections.length, 3);

  // Three clients over three handler entries. After n deploys one press runs
  // the downstream flow n squared times. For the lamp in this fixture that is a
  // repeated command; the same fixture binds `serrure-entree` the same way.
  assert.equal(await deliveriesForOnePress(), 9);
});

test('every duplicate reports the same node id, so the flood looks like one node', async () => {
  // The stale closures captured earlier node objects, which carry the id from
  // the same flow. Nothing that identifies senders by id can tell the
  // generations apart: it does not look like extra nodes, it looks like one
  // node firing repeatedly.
  const fromLamp = house.sent.filter((event) => event.sourceId === 'action-lampe');

  assert.ok(fromLamp.length >= 14);
  assert.deepEqual([...new Set(fromLamp.map((event) => event.sourceType))], ['onUserAction']);
});

test('the coordinator cannot see the handler list that causes it', () => {
  // Each generation of `initMiakapi` subscribes once, on its own new Home.
  // That count is visible to the coordinator and grows linearly.
  //
  // The multiplier is the module level `handlers` list, which lives entirely
  // inside the node package and is never exposed over the connection. So the
  // coordinator sees three clients where it expects one, and cannot tell that
  // each of them is also fanning out three ways. This fault is diagnosable only
  // from inside the Node-RED process.
  const counts = house.emit.sdkSubscriptionCounts();

  assert.deepEqual(counts, { ready: 3, update: 3, userLogin: 3, userAction: 3 });
});
