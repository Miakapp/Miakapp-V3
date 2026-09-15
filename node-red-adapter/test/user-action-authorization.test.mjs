/**
 * How the v3 node decides whether a user action is allowed.
 *
 * The Miakapp 4 authorization work depends on knowing what v3 actually
 * permitted, including the case that reads like a mistake: an action with an
 * empty group list is allowed to everyone, not denied to everyone.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startHouse, settle } from '../src/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

let house;

const action = (inputID, user) => ({
  type: 'press',
  input: { id: inputID },
  user,
});

const guest = { displayName: 'Invité', groups: ['invites'], isAdmin: false, notifications: true };
const resident = { displayName: 'Mathieu', groups: ['habitants'], isAdmin: true, notifications: true };

const actionsFrom = (nodeId) => house.sent.filter((event) => event.sourceId === nodeId);

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

test('the coordinator sees one action consumer however many nodes listen', () => {
  // Two onUserAction nodes are deployed, yet the SDK received exactly one
  // `onUserAction` subscription. `initMiakapi` subscribes once and dispatches
  // by input id through its own module level handler list.
  //
  // Two consequences for v4. An export without an initMiakapi node has action
  // nodes that can never fire, because nothing subscribes on their behalf. And
  // the coordinator cannot tell from its side how many handlers a house has,
  // nor which input ids are actually bound.
  assert.equal(house.emit.sdkSubscriptionCounts().userAction, 1);
});

test('a listed group allows the matching user and blocks everyone else', async () => {
  house.emit.userAction(action('lampe-salon', resident));
  await settle();
  assert.equal(actionsFrom('action-lampe').length, 1);

  house.emit.userAction(action('lampe-salon', guest));
  await settle();
  assert.equal(
    actionsFrom('action-lampe').length,
    1,
    'a user outside allowedGroups must not reach the flow',
  );
});

test('an empty allowedGroups list allows everyone, including a guest', async () => {
  // `allowedGroups: []` reads like "nobody", and the fixture puts it on a door
  // lock to make the stake obvious. The v3 handler sets `allowed = true`
  // whenever no group is listed, so the guest opens the door.
  house.emit.userAction(action('serrure-entree', guest));
  await settle();

  assert.equal(actionsFrom('action-serrure').length, 1);
});

test('an action is delivered only to nodes bound to its input id', async () => {
  const before = house.sent.length;
  house.emit.userAction(action('input-inexistant', resident));
  await settle();

  assert.equal(house.sent.length, before, 'an unknown input id reaches no node');
});
