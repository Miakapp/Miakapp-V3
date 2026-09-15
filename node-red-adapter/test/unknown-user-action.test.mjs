/**
 * What v3 does with an action from a user it cannot resolve.
 *
 * The SDK does not hand the node the uid from the wire. It resolves it first:
 *
 *     onUserAction(data) {
 *       const eventData = { ...data, user: thisHome.users.find((u) => u.id === data.user) };
 *
 * `find` returns `undefined` when the uid is absent from the live user list,
 * which the USERLIST packet populates. An action arriving before the first
 * USERLIST, or from a user enrolled since it was sent, therefore reaches the
 * node with `user: undefined`.
 *
 * The node then runs, for a node that lists groups:
 *
 *     config.allowedGroups.forEach((g) => { if (userAction.user.groups.includes(g)) ... })
 *
 * These tests record what that does, because the answer decides what Miakapp 4
 * must guarantee about an unresolvable principal.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startHouse, settle } from '../src/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

let house;

/** Exactly the shape the SDK builds when `users.find(...)` misses. */
const unresolved = (inputID) => ({
  type: 'click',
  input: { id: inputID, name: inputID, value: '1' },
  user: undefined,
});

const sentBy = (nodeId) => house.sent.filter((event) => event.sourceId === nodeId).length;

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

test('an action from an unknown user throws out of the guarded node', async () => {
  // `lampe-salon` is the node that lists groups (`["habitants"]`). Reading
  // `.groups` off `undefined` is a TypeError, and nothing in the v3 node
  // catches it.
  assert.throws(
    () => house.emit.userAction(unresolved('lampe-salon')),
    TypeError,
  );
  await settle();
});

test('the unguarded lock fires its flow first, and only then crashes', async () => {
  // `serrure-entree` has an empty allowedGroups, so the node short-circuits to
  // `else allowed = true` and never dereferences the missing user to decide.
  // It sends, and only afterwards builds its status badge:
  //
  //     node.send({ userAction });
  //     node.status({ ..., text: `[${userAction.user.displayName}] ...` });
  //
  // So this node also throws, but the order is what matters: the message is
  // already downstream when it does.
  const before = sentBy('action-serrure');

  assert.throws(
    () => house.emit.userAction(unresolved('serrure-entree')),
    TypeError,
  );
  await settle();

  // The door opened. The crash is the status line, after the effect.
  assert.equal(sentBy('action-serrure') - before, 1);
});

test('the guarded node crashes before sending, so the two failures differ', () => {
  // The contrast is the finding. The node that lists groups dereferences the
  // missing user while deciding, so it throws before `node.send` and emits
  // nothing. The node with no access rule decides without the user, sends, and
  // throws afterwards.
  //
  // Losing a principal's identity therefore blocks the guarded action and lets
  // the unguarded one through. Both end in an uncaught TypeError, so neither
  // failure is distinguishable from the other by its error alone, and the
  // fixture puts the unguarded one on the front door.
  const lampBefore = sentBy('action-lampe');

  assert.throws(() => house.emit.userAction(unresolved('lampe-salon')), TypeError);

  assert.equal(sentBy('action-lampe') - lampBefore, 0);
});

test('the throw is not contained: later handlers for the same input are skipped', async () => {
  // `initMiakapi` dispatches with
  // `handlers.userAction.filter(...).forEach((h) => h.handler(action))`.
  // `forEach` has no error boundary, so the first handler that throws ends the
  // dispatch for that action. A second node bound to the same input id after
  // the guarded one would simply not run, with no log line of its own.
  //
  // Recorded here as a property of the dispatch loop rather than of a
  // particular fixture ordering: one throwing handler aborts the rest.
  const dispatch = (handlers, action) => {
    const ran = [];
    try {
      handlers
        .filter((h) => h.inputID === action.input.id)
        .forEach((h) => h.handler(action, ran));
    } catch {
      // the v3 node has no catch here; this one only keeps the test readable
    }
    return ran;
  };

  const handlers = [
    { inputID: 'x', handler: (_a, ran) => ran.push('first') },
    { inputID: 'x', handler: () => { throw new TypeError('unresolved user'); } },
    { inputID: 'x', handler: (_a, ran) => ran.push('third') },
  ];

  assert.deepEqual(dispatch(handlers, { input: { id: 'x' } }), ['first']);
});
