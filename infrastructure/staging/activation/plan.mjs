import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createActivationCloudClient, assertSafeActivationEnvironment } from './cloud.mjs';
import {
  PROJECT_ID,
  activationAuthorization,
  buildActivationPlan,
  createPrivatePlanDirectory,
  sha256,
  writePrivateJson,
} from './contract.mjs';
import { validateActivationRoot } from './guard.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_ACTIVATION_PLAN_CONFIRMATION';
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
process.umask(0o077);

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { HOME: process.env.HOME, PATH: process.env.PATH },
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    throw new Error('Repository state could not be verified');
  }
  return result.stdout.trim();
}

function verifiedRepositoryCommit() {
  if (git(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    throw new Error('The staging activation plan requires a clean repository');
  }
  const head = git(['rev-parse', 'HEAD']);
  const main = git(['rev-parse', 'origin/main']);
  if (head !== main || !/^[0-9a-f]{40}$/.test(head)) {
    throw new Error('The staging activation plan must run from the exact origin/main commit');
  }
  return head;
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./plan.sh <private-parent>`);
  }
  assertSafeActivationEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact target`);
  }
  validateActivationRoot(new URL('./', import.meta.url));
  const commit = verifiedRepositoryCommit();
  const directory = createPrivatePlanDirectory(process.argv[2], repositoryRoot);
  const client = createActivationCloudClient({
    repositoryRoot,
    workingDirectory: directory,
  });
  const plan = buildActivationPlan({
    repositoryCommit: commit,
    createdAt: new Date().toISOString(),
    toolVersions: client.toolVersions(),
    observation: client.observe(),
  });
  const planPath = join(directory, 'plan.json');
  writePrivateJson(planPath, plan, 0o400);
  const bytes = readFileSync(planPath);
  process.stdout.write([
    `Private activation plan: ${planPath}`,
    `Plan SHA-256: ${sha256(bytes)}`,
    `Authorization: ${activationAuthorization(bytes, commit)}`,
    'Planned delta: 1 Firebase Web app, 5 enabled 32-byte secret versions, 0 workloads.',
    '',
  ].join('\n'));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown staging activation plan failure';
  console.error(message);
  process.exitCode = 1;
});
