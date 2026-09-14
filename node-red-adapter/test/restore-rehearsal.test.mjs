/**
 * The timed restore rehearsal, run as a test so its findings cannot rot.
 *
 * Workstream B deliverable 5 is a rehearsal, and a rehearsal that is performed
 * once and written up is a document, not a guarantee. Running it in CI keeps
 * every claim in `RESTORE-REHEARSAL.md` attached to a run that produced it.
 *
 * This file asserts the *shape* of the outcome, not the timings. Wall-clock
 * numbers belong in the report, where they are quoted with the machine that
 * produced them; asserting them here would only make CI flaky.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const rehearsal = path.join(here, '..', 'bin', 'restore-rehearsal.mjs');

let report;

const scenario = (id) => report.scenarios.find((entry) => entry.id === id);

before(async () => {
  const { stdout } = await run(process.execPath, [rehearsal, '--json'], {
    maxBuffer: 8 * 1024 * 1024,
  });
  report = JSON.parse(stdout);
}, { timeout: 180000 });

test('the rehearsal ends with at least one scope that brings the house back', () => {
  assert.equal(report.verdict.ok, true);
  assert.ok(report.verdict.equivalentScopes.length > 0);
  assert.equal(typeof report.verdict.restoreSeconds, 'number');
});

test('the user directory is the only thing worth archiving', () => {
  // The Node-RED installation is rebuilt from the lockfile rather than restored,
  // so the backup is small enough that its size is not an operational argument.
  assert.equal(report.installation.archived, false);
  assert.ok(report.backups['flows-only'].bytes < 64 * 1024);
});

test('flows.json alone restores a house indistinguishable from the one lost', () => {
  const outcome = scenario('flows-only');
  assert.equal(outcome.alive, true);
  assert.deepEqual(outcome.divergences, []);
});

test('the rest of the user directory changes nothing either way', () => {
  const outcome = scenario('config-only');
  assert.equal(outcome.alive, true);
  assert.deepEqual(outcome.divergences, []);
});

test('archiving node_modules destroys the restore instead of protecting it', () => {
  const outcome = scenario('with-node-modules');

  // A partial copy of an npm tree shadows the working installation: Node-RED
  // prefers the local module, that module cannot resolve its own dependencies,
  // and no type ever registers.
  assert.equal(outcome.alive, false);
  assert.ok(outcome.missingTypes.includes('initMiakapi'));
  assert.ok(outcome.missingTypes.includes('onUserAction'));

  // The dangerous half: this is not a crash. The runtime started, loaded the
  // flow revision and raised nothing of its own. An operator watching the
  // process would see a healthy restore with no house behind it.
  assert.equal(outcome.startResolved, true);
});

test('a restore that forgets the process environment loses a state path silently', () => {
  const outcome = scenario('config-only-without-env');

  assert.equal(outcome.alive, true);
  assert.equal(outcome.divergences.length, 1);

  const [divergence] = outcome.divergences;
  assert.equal(divergence.field, 'commit');

  // `commitVariables` reads env-typed values from `process.env` with no
  // fallback, so a missing variable becomes `undefined` rather than an error.
  // The key is still in the set the node built...
  assert.ok(divergence.after.setKeys.includes('systeme.version'));
  // ...and gone from what serialisation carries to the coordinator.
  assert.ok(!divergence.after.transportedKeys.includes('systeme.version'));
  assert.ok(divergence.before.transportedKeys.includes('systeme.version'));

  // Everything else came back, which is what makes it hard to notice.
  assert.deepEqual(
    divergence.after.transportedKeys,
    ['capteurs.salle de bain.humidite', 'capteurs.salon.temperature'],
  );
});
