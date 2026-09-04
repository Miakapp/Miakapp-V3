import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_ID,
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  buildProbePlanMetadata,
  canonicalJson,
  childEnvironment,
  createPrivateProbeBundle,
  probeApplyAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import { validateProbeRoot } from './guard.mjs';
import { readAndValidateProbePlan } from './validate-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_PROBE_PLAN_CONFIRMATION';
const probeRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const manifestPath = join(repositoryRoot, 'infrastructure/staging/manifest.json');
process.umask(0o077);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? probeRoot,
    env: options.env ?? childEnvironment(),
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const allowed = options.allowedStatuses ?? [0];
  if (result.error !== undefined || result.signal !== null || result.status === null
    || !allowed.includes(result.status)) {
    if (options.diagnosticDirectory !== undefined) {
      const diagnostics = Buffer.concat([
        Buffer.from(result.stdout ?? ''),
        Buffer.from(result.stderr ?? ''),
      ]);
      writePrivateFile(
        join(options.diagnosticDirectory, `${options.description ?? 'command'}.log`),
        diagnostics.length === 0 ? Buffer.from('Command failed without diagnostics\n') : diagnostics,
      );
    }
    throw new Error(`${options.description ?? command} failed; private diagnostics were preserved`);
  }
  return result;
}

function terraformEnvironment(terraformData) {
  return childEnvironment(process.env, {
    TF_CLI_CONFIG_FILE: join(probeRoot, 'terraform-cli.tfrc'),
    TF_DATA_DIR: terraformData,
    TF_IN_AUTOMATION: '1',
  });
}

function validateToolchain() {
  const result = run('terraform', ['version', '-json'], { description: 'terraform-version' });
  let version;
  try {
    version = JSON.parse(Buffer.from(result.stdout).toString('utf8')).terraform_version;
  } catch {
    throw new Error('Terraform version output is invalid');
  }
  if (version !== TERRAFORM_VERSION) throw new Error(`Terraform ${TERRAFORM_VERSION} is required`);
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact private-probe target`);
  }
  validateProbeRoot(new URL('./', import.meta.url));
  validateToolchain();
  run(process.execPath, [
    join(repositoryRoot, 'infrastructure/staging/validate.mjs'),
    manifestPath,
  ], { cwd: repositoryRoot, description: 'staging-manifest-validation' });
  const repositoryCommit = verifyExactMain(repositoryRoot);
  verifiedOperatorEmail(repositoryRoot);

  const bundle = createPrivateProbeBundle(process.argv[2], repositoryRoot);
  const terraformData = join(bundle, 'terraform-data');
  mkdirSync(terraformData, { mode: 0o700 });
  try {
    const environment = terraformEnvironment(terraformData);
    run('terraform', ['fmt', '-check', '-recursive'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-fmt',
    });
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-init',
    });
    run('terraform', ['validate', '-no-color'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-validate',
    });

    const planPath = join(bundle, 'probe.tfplan');
    const plan = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-out=${planPath}`,
    ], {
      env: environment,
      allowedStatuses: [2],
      diagnosticDirectory: bundle,
      description: 'terraform-plan',
    });
    if (plan.status !== 2) throw new Error('Initial private-probe plan must contain the reviewed create-only delta');
    chmodSync(planPath, 0o400);

    const show = run('terraform', ['show', '-json', planPath], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-show',
    });
    const planJsonBytes = Buffer.from(show.stdout);
    const planJsonPath = join(bundle, 'probe.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidateProbePlan(planJsonPath);
    const planBytes = readFileSync(planPath);
    const metadata = buildProbePlanMetadata({
      repositoryCommit,
      createdAt: new Date().toISOString(),
      planBytes,
      planJsonBytes,
      summary,
    });
    writePrivateFile(
      join(bundle, 'metadata.json'),
      Buffer.from(canonicalJson(metadata), 'utf8'),
      0o400,
    );
    verifyExactMain(repositoryRoot, repositoryCommit);

    process.stdout.write([
      `Private probe bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Workflow source SHA-256: ${metadata.workflow_source_sha256}`,
      `Authorization: ${probeApplyAuthorization(planBytes, repositoryCommit)}`,
      `Planned delta: ${summary.create} creates, 0 updates, 0 deletes (${summary.profile}); one unscheduled Workflow, no live request.`,
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Private-probe planning failed');
  process.exitCode = 1;
});
