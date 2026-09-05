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
  BROWSER_RELAY_ENTRY_RUNTIME_CONFIG_SHA256,
  PROJECT_ID,
  REGION,
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  browserRelayRotationEntryAuthorization,
  buildBrowserRelayRotationEntryPlanMetadata,
  canonicalJson,
  childEnvironment,
  createPrivateBundle,
  sha256,
  validateBrowserRelayRotationEntryBaseline,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import { validateWorkloadRoot } from './guard.mjs';
import {
  PINNED_UPDATE_BASELINE,
  readAndValidatePinnedBrowserRelayRotationEntryPlan,
} from './validate-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_WORKLOAD_UPDATE_PLAN_CONFIRMATION';
const ROTATION_ENTRY_CONFIRMATION =
  'MIAKAPP_STAGING_BROWSER_RELAY_ENTRY_PLAN_CONFIRMATION';
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

function browserRelayRotationEntryBaseline() {
  const result = run('gcloud', [
    'functions',
    'describe',
    'control-plane',
    '--gen2',
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
    '--quiet',
    '--format=json(name,state,updateTime,serviceConfig.revision,serviceConfig.environmentVariables)',
  ], { cwd: repositoryRoot, description: 'browser-relay-rotation-entry-baseline' });
  let value;
  try {
    value = JSON.parse(Buffer.from(result.stdout).toString('utf8'));
  } catch {
    throw new Error('Live browser-relay rotation-entry baseline is invalid JSON');
  }
  return validateBrowserRelayRotationEntryBaseline(value);
}

async function main() {
  const rotationEntry = process.argv[2] === '--browser-relay-rotation-entry';
  const offset = rotationEntry ? 1 : 0;
  const privateParent = process.argv[2 + offset];
  const confirmation = rotationEntry ? ROTATION_ENTRY_CONFIRMATION : PLAN_CONFIRMATION;
  if (process.argv.length !== 3 + offset || privateParent === undefined) {
    const executable = rotationEntry ? './browser-relay-entry-plan.sh' : './update-plan.sh';
    throw new Error(`Usage: ${confirmation}=${PROJECT_ID} ${executable} <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, confirmation);
  if (process.env[confirmation] !== PROJECT_ID) {
    throw new Error(`Set ${confirmation}=${PROJECT_ID} to acknowledge the exact private update target`);
  }
  if (!rotationEntry) {
    throw new Error('Regular source updates remain blocked until the browser-relay rotation entry is recorded and its one-shot tooling is retired');
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
  if (sha256(readFileSync(runtimeConfigPath)) !== BROWSER_RELAY_ENTRY_RUNTIME_CONFIG_SHA256) {
    throw new Error('Committed staging runtime configuration does not match the reviewed digest');
  }
  browserRelayRotationEntryBaseline();

  const bundle = createPrivateBundle(privateParent, repositoryRoot);
  const terraformData = join(bundle, 'terraform-data');
  mkdirSync(terraformData, { mode: 0o700 });
  try {
    const archivePath = join(bundle, 'control-plane.zip');
    const packageResult = buildProductionArchive(archivePath);
    verifyExactMain(repositoryRoot, repositoryCommit);
    if (packageResult.archive_sha256 !== PINNED_UPDATE_BASELINE.sourceArchiveSha256) {
      throw new Error('Browser-relay rotation entry requires the exact deployed source bytes');
    }

    const variablesPath = join(bundle, 'workload.auto.tfvars.json');
    writePrivateFile(variablesPath, Buffer.from(canonicalJson({
      operator_user_email: operatorEmail,
      browser_relay_rotation_entry: true,
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
    if (plan.status !== 2) {
      throw new Error('Browser-relay rotation entry must contain the exact reviewed runtime delta');
    }
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
      sourceRepositoryCommit: PINNED_UPDATE_BASELINE.sourceRepositoryCommit,
      sourceArchiveSha256: packageResult.archive_sha256,
      runtimeConfigSha256: BROWSER_RELAY_ENTRY_RUNTIME_CONFIG_SHA256,
      browserRelayRotationEntry: true,
    };
    const summary = readAndValidatePinnedBrowserRelayRotationEntryPlan(
      planJsonPath,
      validationInput,
    );
    browserRelayRotationEntryBaseline();
    const planBytes = readFileSync(planPath);
    const metadata = buildBrowserRelayRotationEntryPlanMetadata({
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
      `Private browser-relay rotation-entry bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Source SHA-256: ${metadata.source_archive_sha256}`,
      `Authorization: ${browserRelayRotationEntryAuthorization(planBytes, repositoryCommit)}`,
      'Planned delta: two in-place updates; identical source; versions 1 and 2 published; version 1 current; IAM, ingress and scale unchanged; no live request.',
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
