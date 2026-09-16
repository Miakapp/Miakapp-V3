#!/usr/bin/env node
/**
 * A timed restore rehearsal for the local coordinator environment.
 *
 * Workstream B deliverable 5. The point is not to prove that `tar` works. It is
 * to find out, by doing it, what an operator of the v3 house gets back after the
 * machine that runs Node-RED is gone, how long each step takes, and which
 * plausible backups produce a house that looks restored and is not.
 *
 * A restored house needs two layers, and they are recovered differently:
 *
 *   the installation — Node-RED itself, `node-red-contrib-miakapi` and its
 *     dependencies. Rebuilt from `package-lock.json` by `npm ci`, before any
 *     archive is opened. It is deliberately not in the backup: it is derivable.
 *   the user directory — the house. Only this is archived, because only this
 *     is irreplaceable.
 *
 * The rehearsal restores the second onto the first, which is the order an
 * operator works in after losing a machine: rebuild the box, then restore the
 * house.
 *
 * The rehearsal:
 *   1. builds a live environment and records how it behaves;
 *   2. archives it at three scopes an operator might plausibly choose;
 *   3. destroys it;
 *   4. restores each archive into a path that did not exist before, in a fresh
 *      process, without redeploying anything;
 *   5. replays the same stimuli and compares the two observations;
 *   6. reports elapsed time for every step.
 *
 * Every scenario below is an expectation the run either confirms or refutes;
 * the report prints what happened, not what was predicted.
 *
 * Usage:
 *   node bin/restore-rehearsal.mjs [--json] [--keep]
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  BACKUP_SCOPES,
  backupEnvironment,
  describeEnvironment,
  destroyEnvironment,
  elapsedSince,
  restoreEnvironment,
} from '../src/environment.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const worker = path.join(here, 'rehearsal-house.mjs');

/**
 * The environment outside the user directory that the house also depends on.
 *
 * `commitVariables` supports a value of type `env`, which reads
 * `process.env[name]` at commit time. Nothing in the user directory records
 * that a house needs it. It is listed here so the rehearsal can restore an
 * archive both with and without it.
 */
const HOUSE_ENV = { HOUSE_VERSION: '3.0.31' };

/**
 * What gets rehearsed, narrowest backup first.
 *
 * `restoreEnv: false` keeps the archive complete and drops the process
 * environment instead, which is the separate way a restore can be incomplete.
 */
const SCENARIOS = [
  {
    id: 'flows-only',
    scope: 'flows-only',
    restoreEnv: true,
    question: 'is flows.json, the file operators know about, enough on its own?',
  },
  {
    id: 'config-only',
    scope: 'config-only',
    restoreEnv: true,
    question: 'is the whole user directory minus node_modules enough?',
  },
  {
    id: 'with-node-modules',
    scope: 'with-node-modules',
    restoreEnv: true,
    question: 'does archiving node_modules as well make the restore safer?',
  },
  {
    id: 'config-only-without-env',
    scope: 'config-only',
    restoreEnv: false,
    question: 'does a working archive restored onto a bare shell behave the same?',
  },
];

const wantsJson = process.argv.includes('--json');
const keepWorkspace = process.argv.includes('--keep');

const workspace = await mkdtemp(path.join(tmpdir(), 'restore-rehearsal-'));
const liveDir = path.join(workspace, 'live');

try {
  const report = await rehearse();
  if (wantsJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(renderReport(report));
  process.exitCode = report.verdict.ok ? 0 : 1;
} finally {
  if (!keepWorkspace) await rm(workspace, { recursive: true, force: true });
  else process.stderr.write(`workspace kept at ${workspace}\n`);
}

async function rehearse() {
  // 1. The house that exists before anything goes wrong.
  const buildStarted = process.hrtime.bigint();
  const before = await runHouse(['--deploy', '--user-dir', liveDir], HOUSE_ENV);
  const buildMs = elapsedSince(buildStarted);

  const inventory = await describeEnvironment(liveDir);

  // 2. Archive it, once per scope, while the house is still intact.
  const backups = {};
  for (const scope of Object.keys(BACKUP_SCOPES)) {
    backups[scope] = await backupEnvironment(liveDir, path.join(workspace, `${scope}.tar.gz`), scope);
  }

  // 3. The disk dies.
  const destroy = await destroyEnvironment(liveDir);

  // 4-5. Bring each archive back into a path that did not exist, in a new
  //      process, and replay the same stimuli.
  const scenarios = [];
  for (const scenario of SCENARIOS) {
    const targetDir = path.join(workspace, `restored-${scenario.id}`);
    const restore = await restoreEnvironment(path.join(workspace, `${scenario.scope}.tar.gz`), targetDir);

    const environment = scenario.restoreEnv ? HOUSE_ENV : {};
    const bootStarted = process.hrtime.bigint();
    const outcome = await runHouse(['--from-disk', '--user-dir', targetDir], environment);
    const bootMs = elapsedSince(bootStarted);
    const restored = outcome.observation;

    scenarios.push({
      ...scenario,
      archiveBytes: backups[scenario.scope].bytes,
      restoreMs: restore.elapsedMs,
      bootMs,
      alive: restored.alive,
      // Recorded even when nothing came back, because the shape of the failure
      // is the finding: the runtime started and reported no error of its own.
      startResolved: restored.startResolved ?? true,
      missingTypes: restored.missingTypes ?? [],
      divergences: restored.alive ? compare(before.observation, restored) : null,
    });
  }

  const equivalent = scenarios.filter((s) => s.alive && s.divergences.length === 0);

  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    build: { elapsedMs: buildMs, bootMs: before.observation.bootMs },
    installation: {
      rebuiltFrom: 'package-lock.json',
      archived: false,
      note: 'Node-RED and the node package are reinstalled before any archive is opened; the backup carries only the user directory.',
    },
    inventory,
    backups,
    destroy,
    scenarios,
    verdict: {
      // The rehearsal passes when at least one declared scope restores an
      // equivalent house. A rehearsal in which nothing comes back is a finding,
      // not a success.
      ok: equivalent.length > 0,
      equivalentScopes: equivalent.map((s) => s.id),
      // Recovery time an operator can quote: archive, unpack and boot, for the
      // narrowest scope that actually worked.
      restoreSeconds: equivalent.length > 0
        ? round((backups[equivalent[0].scope].elapsedMs + equivalent[0].restoreMs + equivalent[0].bootMs) / 1000)
        : null,
    },
  };
}

async function runHouse(argv, environment) {
  const out = path.join(workspace, `observation-${Math.random().toString(36).slice(2)}.json`);
  await run(process.execPath, [worker, ...argv, '--out', out], {
    env: { PATH: process.env.PATH, NODE_RED_ADAPTER_NODE_TIMEOUT_MS: '8000', ...environment },
  });
  return { observation: JSON.parse(await readFile(out, 'utf8')) };
}

/** Every place the restored house differs from the one that was lost. */
function compare(before, after) {
  const divergences = [];
  const fields = ['registeredTypes', 'connection', 'deliveredBy', 'pushes', 'commit', 'flowsSha256', 'deployedNodeIds'];
  for (const field of fields) {
    const left = JSON.stringify(before[field]);
    const right = JSON.stringify(after[field]);
    if (left !== right) divergences.push({ field, before: before[field], after: after[field] });
  }
  return divergences;
}

function renderReport(report) {
  const lines = [];
  lines.push('Timed restore rehearsal — local coordinator environment');
  lines.push(`  node ${report.node}, ${report.generatedAt}`);
  lines.push('');

  lines.push('Environment as the runtime left it:');
  for (const entry of report.inventory) {
    const state = entry.present ? `${formatBytes(entry.bytes)}` : 'absent';
    lines.push(`  ${entry.path.padEnd(22)} ${state.padStart(10)}   ${entry.what}`);
  }
  lines.push('');

  lines.push('Backups:');
  for (const [scope, backup] of Object.entries(report.backups)) {
    lines.push(`  ${scope.padEnd(14)} ${formatBytes(backup.bytes).padStart(10)} in ${round(backup.elapsedMs)} ms   ${backup.included.join(', ')}`);
  }
  lines.push(`  destroy        ${'—'.padStart(10)} in ${round(report.destroy.elapsedMs)} ms`);
  lines.push('');

  lines.push('Restores:');
  for (const scenario of report.scenarios) {
    lines.push(`  ${scenario.id}`);
    lines.push(`    question   ${scenario.question}`);
    // For a house that never came back, the boot figure is the deadline the
    // rehearsal waited, not a measurement of anything.
    const boot = scenario.alive
      ? `boot ${round(scenario.bootMs)} ms`
      : `gave up after ${round(scenario.bootMs)} ms`;
    lines.push(`    timing     restore ${round(scenario.restoreMs)} ms, ${boot}`);
    if (!scenario.alive) {
      lines.push('    outcome    NO HOUSE — the runtime started, reported no error of its own,');
      lines.push(`               and instantiated nothing. Missing types: ${scenario.missingTypes.join(', ')}`);
    } else if (scenario.divergences.length === 0) {
      lines.push('    outcome    equivalent to the house that was lost');
    } else {
      lines.push(`    outcome    booted, but diverged in ${scenario.divergences.length} field(s):`);
      for (const divergence of scenario.divergences) {
        lines.push(`      ${divergence.field}`);
        lines.push(`        before ${JSON.stringify(divergence.before)}`);
        lines.push(`        after  ${JSON.stringify(divergence.after)}`);
      }
    }
    lines.push('');
  }

  lines.push(`Verdict: ${report.verdict.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`  scopes that restored an equivalent house: ${report.verdict.equivalentScopes.join(', ') || 'none'}`);
  if (report.verdict.restoreSeconds !== null) {
    lines.push(`  measured recovery time, narrowest working scope: ${report.verdict.restoreSeconds} s`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${round(bytes / 1024 / 1024)} MiB`;
  if (bytes >= 1024) return `${round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
