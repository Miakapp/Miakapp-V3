/**
 * The local coordinator environment, and the operations a restore rehearsal
 * performs on it: back it up, destroy it, bring it back, time each step.
 *
 * "Local coordinator environment" means the Node-RED user directory that runs
 * the house, not the MiakAPI coordinator service. The service is the far side
 * of the connection; this is the part that lives in the house and that somebody
 * has to be able to rebuild after a disk dies.
 *
 * The manifest below is not a design. It is the set of paths a real Node-RED
 * 5.0.7 runtime was observed to write into its user directory after one deploy
 * of the synthetic house, plus `flows_cred.json`, which this package never
 * produces (it registers no credentials schema) but which any installation with
 * a credential-bearing node would have.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir, rm, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * What the environment is made of, and what each part costs to lose.
 *
 * `archive` records what the rehearsal found out about including each part in a
 * backup. `harmful` is not a typo: restoring a partial `node_modules` is worse
 * than restoring none, because a local copy shadows the installed one.
 */
export const ENVIRONMENT_MANIFEST = [
  {
    path: 'flows.json',
    archive: 'required',
    what: 'the house itself, and for this package the coordinator credentials in cleartext',
  },
  {
    path: 'flows_cred.json',
    archive: 'required',
    what: 'encrypted credentials; never written here, because the v3 node registers no credentials schema',
  },
  {
    path: 'package.json',
    archive: 'harmless',
    what: "Node-RED's project scaffold; observed to carry no dependencies, so it names no installed node package",
  },
  {
    path: '.config.nodes.json',
    archive: 'harmless',
    what: 'the only local record of which node packages and versions are installed; carries absolute paths, rewritten on boot',
  },
  {
    path: '.config.runtime.json',
    archive: 'harmless',
    what: 'the runtime instance id',
  },
  {
    path: 'lib',
    archive: 'harmless',
    what: 'the editor library of saved flows and functions',
  },
  {
    path: 'node_modules',
    archive: 'harmful',
    what: 'installed packages; a partial copy shadows the working installation and leaves the runtime with no nodes',
  },
];

/**
 * Backup scopes a real operator might plausibly choose, narrowest first.
 *
 * `flows-only` is the one people actually do, because `flows.json` is the file
 * they know about. `with-node-modules` is the one a cautious operator reaches
 * for, on the reasoning that more is safer. The rehearsal exists to find out
 * what each one costs.
 */
export const BACKUP_SCOPES = {
  'flows-only': ['flows.json'],
  'config-only': ['flows.json', 'flows_cred.json', 'package.json', '.config.nodes.json', '.config.runtime.json', 'lib'],
  'with-node-modules': ENVIRONMENT_MANIFEST.map((entry) => entry.path),
};

/** What is actually present in an environment right now, with sizes. */
export async function describeEnvironment(userDir) {
  const entries = [];
  for (const entry of ENVIRONMENT_MANIFEST) {
    const absolute = path.join(userDir, entry.path);
    try {
      const info = await stat(absolute);
      entries.push({
        ...entry,
        present: true,
        bytes: info.isDirectory() ? await directoryBytes(absolute) : info.size,
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries.push({ ...entry, present: false, bytes: 0 });
    }
  }
  return entries;
}

async function directoryBytes(directory) {
  let total = 0;
  const queue = [directory];
  while (queue.length > 0) {
    const current = queue.pop();
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) queue.push(absolute);
      else if (child.isFile()) total += (await stat(absolute)).size;
    }
  }
  return total;
}

/**
 * Copy the named parts of an environment into a single archive.
 *
 * Symlinks are dereferenced (`-h`). The harness links the node package into
 * `node_modules` instead of copying it, and an archive full of links pointing
 * at this checkout would restore into something that only works on this
 * machine. A real installation has the package bytes there, so the archive
 * should carry the bytes.
 */
export async function backupEnvironment(userDir, archivePath, scope = 'full') {
  const wanted = BACKUP_SCOPES[scope];
  if (!wanted) throw new Error(`unknown backup scope: ${scope}`);

  const present = [];
  for (const entry of wanted) {
    try {
      await stat(path.join(userDir, entry));
      present.push(entry);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const started = process.hrtime.bigint();
  await run('tar', ['-czhf', archivePath, '-C', userDir, ...present]);
  const elapsedMs = elapsedSince(started);

  const bytes = (await stat(archivePath)).size;
  const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');

  return { scope, included: present, elapsedMs, bytes, sha256: digest };
}

/** Destroy the environment the way a failed disk does: completely. */
export async function destroyEnvironment(userDir) {
  const started = process.hrtime.bigint();
  await rm(userDir, { recursive: true, force: true });
  return { elapsedMs: elapsedSince(started) };
}

/** Unpack an archive into a directory that did not exist a moment ago. */
export async function restoreEnvironment(archivePath, targetDir) {
  const started = process.hrtime.bigint();
  await mkdir(targetDir, { recursive: true });
  await run('tar', ['-xzf', archivePath, '-C', targetDir]);
  return { elapsedMs: elapsedSince(started) };
}

export function elapsedSince(startedHrtime) {
  return Number(process.hrtime.bigint() - startedHrtime) / 1e6;
}
