#!/usr/bin/env node
/**
 * One house, one process, one observation.
 *
 * The restore rehearsal needs at least two houses: the one that existed before
 * the disk died and the one that came back. They cannot share a process. The v3
 * node keeps `HOME`, `variables` and its handler lists in module scope, so a
 * second house in the same process would inherit the first one's state — which
 * is exactly the thing a restore is supposed to have lost. Running each house in
 * its own process is not test hygiene here, it is the subject.
 *
 * Usage:
 *   rehearsal-house.mjs --deploy --user-dir <path> --out <path>
 *   rehearsal-house.mjs --from-disk --user-dir <path> --out <path>
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startHouse, settle } from '../src/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The same people in both houses, so any difference comes from the restore. */
const USERS = [
  {
    uid: 'uid-mathieu',
    displayName: 'Mathieu',
    groups: ['habitants'],
    isAdmin: true,
    notifications: true,
  },
  {
    uid: 'uid-invite',
    displayName: 'Invité',
    groups: ['invites'],
    isAdmin: false,
    notifications: true,
  },
];

const options = parseArgv(process.argv.slice(2));

const flows = options.deploy
  ? JSON.parse(await readFile(path.join(here, '..', 'fixtures', 'synthetic-house.flows.json'), 'utf8'))
  : null;

const bootStarted = process.hrtime.bigint();
const house = await startHouse({
  flows,
  users: USERS,
  userDir: options.userDir,
  keepUserDir: true,
  // A restore that produces no nodes is an outcome to describe, not a crash to
  // report. Node-RED itself does not crash in that case.
  requireNodes: options.deploy,
});
const bootMs = Number(process.hrtime.bigint() - bootStarted) / 1e6;

const alive = house.missingNodeIds.length === 0;

const observation = alive
  ? { alive: true, ...(await observe(house)) }
  : {
      alive: false,
      // What the runtime believes about itself after a failed palette load: it
      // started, it holds the flow revision, and it is waiting for types that
      // will never register. `RED.start()` resolved without throwing.
      startResolved: true,
      missingNodeIds: house.missingNodeIds,
      missingTypes: house.missingTypes(),
      registeredTypes: house.registeredTypes().slice().sort(),
    };

await writeFile(
  options.out,
  `${JSON.stringify({ bootMs, ...observation }, null, 2)}\n`,
  'utf8',
);

await house.stop();

/**
 * Drive the house through the same stimuli in both runs and write down what
 * came out. Everything here is an observation of the real node: the stimuli are
 * the callbacks the coordinator would fire and the messages an upstream node
 * would deliver.
 */
async function observe(subject) {
  // The coordinator says hello.
  subject.emit.ready();
  await settle();

  // A resident presses the living-room lamp, and a guest presses it too.
  subject.emit.userAction({ type: 'press', input: { id: 'lampe-salon' }, user: USERS[0] });
  subject.emit.userAction({ type: 'press', input: { id: 'lampe-salon' }, user: USERS[1] });
  await settle();

  // Somebody opens the front door, which fans out to a push notification.
  subject.emit.userAction({ type: 'press', input: { id: 'serrure-entree' }, user: USERS[1] });
  await settle();

  // A temperature reading arrives from the broker and is committed upstream.
  subject.receive('commit-etat', { payload: 21.5 });
  await settle();

  const committed = subject.recorder.commits.at(-1) ?? {};

  const persisted = await readFile(path.join(subject.userDir, 'flows.json'), 'utf8');

  return {
    registeredTypes: subject.registeredTypes().slice().sort(),
    // Proves the restored house still talks to the same coordinator with the
    // same credentials, which is the part an operator most needs back.
    connection: subject.recorder.connections.at(-1) ?? null,
    deliveredBy: countBySource(subject.sent),
    pushes: subject.recorder.pushes.map((push) => ({ uid: push.uid, notif: push.notif })),
    // Two views of one commit on purpose. `setKeys` is what the node put in the
    // variable set; `transportedKeys` is what survives JSON serialisation on the
    // way to the coordinator. An `undefined` value sits in the first and
    // vanishes from the second without raising anything.
    commit: {
      setKeys: Object.keys(committed).sort(),
      transportedKeys: Object.keys(JSON.parse(JSON.stringify(committed))).sort(),
      values: JSON.parse(JSON.stringify(committed)),
    },
    flowsSha256: createHash('sha256').update(persisted).digest('hex'),
    deployedNodeIds: JSON.parse(persisted)
      .map((node) => node.id)
      .sort(),
  };
}

function countBySource(sent) {
  const counts = {};
  for (const event of sent) {
    if (!event.sourceId) continue;
    counts[event.sourceId] = (counts[event.sourceId] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function parseArgv(argv) {
  const parsed = { deploy: false, userDir: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--deploy') parsed.deploy = true;
    else if (argument === '--from-disk') parsed.deploy = false;
    else if (argument === '--user-dir') parsed.userDir = argv[(index += 1)];
    else if (argument === '--out') parsed.out = argv[(index += 1)];
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!parsed.userDir || !parsed.out) {
    throw new Error('rehearsal-house.mjs needs --user-dir and --out');
  }
  return parsed;
}
