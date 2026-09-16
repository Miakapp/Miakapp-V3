/**
 * Push notification recipients, lifecycle fan-out, and reconnect.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startHouse, settle } from '../src/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const users = [
  { uid: 'u-admin', displayName: 'Alex', groups: ['residents', 'admins'], isAdmin: true, notifications: true },
  { uid: 'u-resident', displayName: 'Casey', groups: ['residents'], isAdmin: false, notifications: true },
  { uid: 'u-muted', displayName: 'Jordan', groups: ['residents'], isAdmin: true, notifications: false },
];

let house;

before(async () => {
  const flows = JSON.parse(
    await readFile(path.join(here, '..', 'fixtures', 'synthetic-house.flows.json'), 'utf8'),
  );
  house = await startHouse({ flows, users });
  await settle();
});

after(async () => {
  await house?.stop();
});

test('an adminOnly notification reaches admins who kept notifications on', async () => {
  house.emit.userAction({
    type: 'press',
    input: { id: 'front-door-lock' },
    user: { displayName: 'Guest', groups: ['guests'], isAdmin: false, notifications: true },
  });
  await settle();

  assert.deepEqual(
    house.recorder.pushes.map((push) => push.uid),
    ['u-admin'],
    'Casey is not an admin and Jordan disabled notifications',
  );
});

test('notification title and body are jsonata over the triggering message', async () => {
  const [push] = house.recorder.pushes;
  assert.deepEqual(push.notif, {
    title: 'Lock',
    body: 'Opened by Guest',
    image: '',
    tag: 'lock',
  });
});

test('ready, update and login each fan out to their subscribed nodes', async () => {
  // One SDK subscription per event, including userAction despite two action
  // nodes: the init node is the only consumer the coordinator ever sees.
  assert.deepEqual(house.emit.sdkSubscriptionCounts(), {
    ready: 1,
    update: 1,
    userLogin: 1,
    userAction: 1,
  });

  house.emit.ready();
  house.emit.update(users);
  house.emit.userLogin({ type: 'login', user: users[0] });
  await settle();

  assert.equal(house.sent.filter((event) => event.sourceId === 'on-ready').length, 1);
  assert.equal(house.sent.filter((event) => event.sourceId === 'on-update').length, 1);
  assert.equal(house.sent.filter((event) => event.sourceId === 'on-login').length, 1);
});

test('getHomeUsers answers from the live user list', async () => {
  house.receive('read-users', {});
  await settle();

  const [event] = house.sent.filter((item) => item.sourceId === 'read-users');
  assert.deepEqual(
    event.msg.users.map((user) => user.displayName),
    ['Alex', 'Casey', 'Jordan'],
  );
});

test('reconnect asks the SDK to reconnect rather than rebuilding the home', async () => {
  house.receive('reconnect', {});
  await settle();

  assert.equal(house.recorder.reconnects, 1);
  assert.equal(house.recorder.connections.length, 1, 'no second coordinator connection');
});
