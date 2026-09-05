import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProductionArchive } from '../../../control-plane/deployment/package.mjs';
import {
  PROJECT_ID,
  RUNTIME_CONFIG_SHA256,
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  buildWorkloadUpdatePlanMetadata,
  canonicalJson,
  childEnvironment,
  createPrivateBundle,
  sha256,
  verifiedOperatorEmail,
  verifyExactMain,
  workloadUpdateAuthorization,
  writePrivateFile,
} from './contract.mjs';
import { validateWorkloadRoot } from './guard.mjs';
import {
  PINNED_UPDATE_BASELINE,
  readAndValidatePinnedSourceUpdatePlan,
} from './validate-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_WORKLOAD_UPDATE_PLAN_CONFIRMATION';
const workloadRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const manifestPath = join(repositoryRoot, 'infrastructure/staging/manifest.json');
process.umask(0o077);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workloadRoot,
    env: options.env ?? childEnvironment(),
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
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
    TF_CLI_CONFIG_FILE: join(workloadRoot, 'terraform-cli.tfrc'),
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
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./update-plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact private update target`);
  }
  validateWorkloadRoot(new URL('./', import.meta.url));
  validateToolchain();
  run(process.execPath, [
    join(repositoryRoot, 'infrastructure/staging/validate.mjs'),
    manifestPath,
  ], { cwd: repositoryRoot, description: 'staging-manifest-validation' });
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const operatorEmail = verifiedOperatorEmail(repositoryRoot);
  const runtimeConfigPath = join(workloadRoot, 'runtime-config-version-1-current.json');
  if (sha256(readFileSync(runtimeConfigPath)) !== RUNTIME_CONFIG_SHA256) {
    throw new Error('Committed staging runtime configuration does not match the reviewed digest');
  }

  const bundle = createPrivateBundle(process.argv[2], repositoryRoot);
  const terraformData = join(bundle, 'terraform-data');
  mkdirSync(terraformData, { mode: 0o700 });
  try {
    const archivePath = join(bundle, 'control-plane.zip');
    const packageResult = buildProductionArchive(archivePath);
    verifyExactMain(repositoryRoot, repositoryCommit);
    if (packageResult.archive_sha256 === PINNED_UPDATE_BASELINE.sourceArchiveSha256) {
      throw new Error('Pinned workload update requires new deterministic source bytes');
    }

    const variablesPath = join(bundle, 'workload.auto.tfvars.json');
    writePrivateFile(variablesPath, Buffer.from(canonicalJson({
      operator_user_email: operatorEmail,
      repository_commit: repositoryCommit,
      source_archive_path: archivePath,
      source_archive_sha256: packageResult.archive_sha256,
    }), 'utf8'));

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

    const planPath = join(bundle, 'workload.tfplan');
    const plan = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-var-file=${variablesPath}`,
      `-out=${planPath}`,
    ], {
      env: environment,
      allowedStatuses: [2],
      diagnosticDirectory: bundle,
      description: 'terraform-plan',
    });
    if (plan.status !== 2) throw new Error('Pinned workload update must contain the exact reviewed source delta');
    chmodSync(planPath, 0o400);

    const show = run('terraform', ['show', '-json', planPath], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-show',
    });
    const planJsonBytes = Buffer.from(show.stdout);
    const planJsonPath = join(bundle, 'workload.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const validationInput = {
      repositoryCommit,
      sourceRepositoryCommit: repositoryCommit,
      sourceArchiveSha256: packageResult.archive_sha256,
      runtimeConfigSha256: RUNTIME_CONFIG_SHA256,
    };
    const summary = readAndValidatePinnedSourceUpdatePlan(planJsonPath, validationInput);
    const planBytes = readFileSync(planPath);
    const metadata = buildWorkloadUpdatePlanMetadata({
      repositoryCommit,
      sourceRepositoryCommit: validationInput.sourceRepositoryCommit,
      createdAt: new Date().toISOString(),
      packageResult,
      planBytes,
      planJsonBytes,
      summary,
    });
    const metadataPath = join(bundle, 'metadata.json');
    writePrivateFile(metadataPath, Buffer.from(canonicalJson(metadata), 'utf8'), 0o400);
    chmodSync(archivePath, 0o400);
    chmodSync(variablesPath, 0o400);
    verifyExactMain(repositoryRoot, repositoryCommit);

    process.stdout.write([
      `Private workload update bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Source SHA-256: ${metadata.source_archive_sha256}`,
      `Authorization: ${workloadUpdateAuthorization(planBytes, repositoryCommit)}`,
      'Planned delta: one reproducible source replacement and two in-place updates; IAM, ingress and scale unchanged; no live request.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Private workload update planning failed');
  process.exitCode = 1;
});
