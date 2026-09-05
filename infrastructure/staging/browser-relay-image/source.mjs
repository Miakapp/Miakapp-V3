import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sha256,
  validateRelayImageProfile,
} from './contract.mjs';
import { childEnvironment } from '../workload/contract.mjs';

const repositoryRoot = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const MAXIMUM_GIT_OUTPUT_BYTES = 1024 * 1024;

function reject(message) {
  throw new Error(message);
}

function runGit(sourceRoot, args, spawn = spawnSync, binary = false) {
  const result = spawn('git', args, {
    cwd: sourceRoot,
    encoding: binary ? undefined : 'utf8',
    env: childEnvironment(),
    maxBuffer: MAXIMUM_GIT_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? '', 'utf8');
  if (result.status !== 0 || result.signal !== null || result.error !== undefined
    || stdout.byteLength > MAXIMUM_GIT_OUTPUT_BYTES) {
    reject('Miakapp-Server source state could not be verified');
  }
  return binary ? stdout : stdout.toString('utf8').trim();
}

function exactSourceRoot(path) {
  if (!isAbsolute(path)) reject('Miakapp-Server source path must be absolute');
  const unresolved = resolve(path);
  const entry = lstatSync(unresolved);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    reject('Miakapp-Server source path must be a real directory');
  }
  const sourceRoot = realpathSync(unresolved);
  const relation = relative(repositoryRoot, sourceRoot);
  if (relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Miakapp-Server source must remain outside the Miakapp-V3 repository');
  }
  return sourceRoot;
}

export function buildRelaySourceArchive(path, spawn = spawnSync) {
  const profile = validateRelayImageProfile();
  const sourceRoot = exactSourceRoot(path);
  if (runGit(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=all'], spawn) !== '') {
    reject('Miakapp-Server source repository must be clean');
  }
  const head = runGit(sourceRoot, ['rev-parse', 'HEAD'], spawn);
  const main = runGit(sourceRoot, ['rev-parse', 'origin/main'], spawn);
  const tree = runGit(sourceRoot, ['rev-parse', 'HEAD^{tree}'], spawn);
  const remote = runGit(sourceRoot, ['remote', 'get-url', 'origin'], spawn);
  if (head !== profile.source.commit || main !== profile.source.commit
    || tree !== profile.source.tree || remote !== profile.source.repository) {
    reject('Miakapp-Server source repository differs from the reviewed origin/main tree');
  }

  const pinnedFiles = Object.freeze({
    '.dockerignore': profile.source.dockerignore_sha256,
    Dockerfile: profile.source.dockerfile_sha256,
    'go.mod': profile.source.go_mod_sha256,
    'go.sum': profile.source.go_sum_sha256,
  });
  for (const [name, digest] of Object.entries(pinnedFiles)) {
    const bytes = runGit(sourceRoot, ['show', `${profile.source.commit}:${name}`], spawn, true);
    if (sha256(bytes) !== digest) {
      reject(`Miakapp-Server ${name} differs from the reviewed source bytes`);
    }
  }

  const archive = runGit(sourceRoot, [
    'archive',
    '--format=tar.gz',
    profile.source.commit,
    '--',
    ...profile.source.archive_files,
  ], spawn, true);
  if (archive.byteLength !== profile.source.archive_bytes
    || sha256(archive) !== profile.source.archive_sha256) {
    reject('Miakapp-Server deterministic source archive differs from the reviewed bytes');
  }
  if (runGit(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=all'], spawn) !== '') {
    reject('Miakapp-Server source repository changed during archive creation');
  }

  return Object.freeze({
    source_root: sourceRoot,
    commit: head,
    tree,
    archive,
    archive_sha256: profile.source.archive_sha256,
    archive_bytes: archive.byteLength,
    archive_files: Object.freeze([...profile.source.archive_files]),
  });
}
