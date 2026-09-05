import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_ID,
  REGION,
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  childEnvironment,
  readBrowserRelayRotationEntryPlanMetadata,
  readPrivateFile,
  sha256,
  validateBrowserRelayRotationEntryAuthorization,
  validateBrowserRelayRotationEntryBaseline,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import { validateWorkloadRoot } from './guard.mjs';
import { observeDeployedWorkload } from './inventory.mjs';
import { readAndValidatePinnedBrowserRelayRotationEntryPlan } from './validate-plan.mjs';

const ROTATION_ENTRY_AUTHORIZATION =
  'MIAKAPP_STAGING_BROWSER_RELAY_ENTRY_APPLY_AUTHORIZATION';
const workloadRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
process.umask(0o077);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workloadRoot,
    env: options.env ?? childEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const allowed = options.allowedStatuses ?? [0];
  if (result.error !== undefined || result.signal !== null || result.status === null
    || !allowed.includes(result.status)) {
    if (options.diagnosticPath !== undefined && !existsSync(options.diagnosticPath)) {
      const bytes = Buffer.concat([
        Buffer.from(result.stdout ?? ''),
        Buffer.from(result.stderr ?? ''),
      ]);
      writePrivateFile(
        options.diagnosticPath,
        bytes.length === 0 ? Buffer.from('Command failed without diagnostics\n') : bytes,
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

function privateBundle(path) {
  const bundle = realpathSync(resolve(path));
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, bundle);
  const entry = lstatSync(bundle);
  if (!entry.isDirectory()
    || entry.isSymbolicLink()
    || (entry.mode & 0o077) !== 0
    || relation === ''
    || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    throw new Error('Workload update apply requires an exact private bundle directory');
  }
  return bundle;
}

function verifyVariables(path, metadata, bundle) {
  const bytes = readPrivateFile(path, 64 * 1024);
  let variables;
  try {
    variables = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Private workload update variables are invalid JSON');
  }
  if (canonicalJson(variables) !== bytes.toString('utf8')
    || JSON.stringify(Object.keys(variables).sort()) !== JSON.stringify([
      'browser_relay_rotation_entry',
      'operator_user_email',
      'repository_commit',
      'source_archive_path',
      'source_archive_sha256',
    ])
    || variables.browser_relay_rotation_entry !== true
    || variables.repository_commit !== metadata.repository_commit
    || variables.source_archive_sha256 !== metadata.source_archive_sha256
    || variables.source_archive_path !== join(bundle, 'control-plane.zip')
    || variables.operator_user_email !== verifiedOperatorEmail(repositoryRoot)) {
    throw new Error('Private workload update variables no longer match the reviewed plan');
  }
  return variables;
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
  const bundlePath = process.argv[2 + offset];
  if (process.argv.length !== 3 + offset || bundlePath === undefined) {
    const executable = rotationEntry ? './browser-relay-entry-apply.sh' : './update-apply.sh';
    throw new Error(`Usage: ${ROTATION_ENTRY_AUTHORIZATION}=... ${executable} <private-bundle>`);
  }
  if (!rotationEntry) {
    throw new Error('Regular source updates remain blocked until the browser-relay rotation entry is recorded and its one-shot tooling is retired');
  }
  assertSafeWorkloadEnvironment(process.env, ROTATION_ENTRY_AUTHORIZATION);
  validateWorkloadRoot(new URL('./', import.meta.url));
  const bundle = privateBundle(bundlePath);
  const { value: metadata } = readBrowserRelayRotationEntryPlanMetadata(
    join(bundle, 'metadata.json'),
  );
  verifyExactMain(repositoryRoot, metadata.repository_commit);

  const planPath = join(bundle, 'workload.tfplan');
  const planJsonPath = join(bundle, 'workload.tfplan.json');
  const archivePath = join(bundle, 'control-plane.zip');
  const variablesPath = join(bundle, 'workload.auto.tfvars.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 32 * 1024 * 1024);
  const archiveBytes = readPrivateFile(archivePath, 8 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256
    || sha256(archiveBytes) !== metadata.source_archive_sha256
    || archiveBytes.byteLength !== metadata.source_archive_bytes) {
    throw new Error('Private workload update bundle digest verification failed');
  }
  const variables = verifyVariables(variablesPath, metadata, bundle);
  validateBrowserRelayRotationEntryAuthorization(
    process.env[ROTATION_ENTRY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
  );
  const validationInput = {
    repositoryCommit: metadata.repository_commit,
    sourceRepositoryCommit: metadata.source_repository_commit,
    sourceArchiveSha256: metadata.source_archive_sha256,
    runtimeConfigSha256: metadata.runtime_config_sha256,
    browserRelayRotationEntry: true,
  };
  readAndValidatePinnedBrowserRelayRotationEntryPlan(planJsonPath, validationInput);
  browserRelayRotationEntryBaseline();

  const terraformData = join(bundle, `.terraform-browser-relay-entry-apply-${process.pid}`);
  mkdirSync(terraformData, { mode: 0o700 });
  const environment = terraformEnvironment(terraformData);
  try {
    const version = run('terraform', ['version', '-json'], { description: 'terraform-version' });
    if (JSON.parse(Buffer.from(version.stdout).toString('utf8')).terraform_version !== TERRAFORM_VERSION) {
      throw new Error(`Terraform ${TERRAFORM_VERSION} is required`);
    }
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      env: environment,
      diagnosticPath: join(bundle, 'update-apply-init.log'),
      description: 'terraform-init',
    });
    const rendered = run('terraform', ['show', '-json', planPath], {
      env: environment,
      diagnosticPath: join(bundle, 'update-apply-show.log'),
      description: 'terraform-show',
    });
    if (sha256(Buffer.from(rendered.stdout)) !== metadata.terraform_plan_json_sha256) {
      throw new Error('Terraform binary update plan no longer renders to the reviewed JSON');
    }
    browserRelayRotationEntryBaseline();
    const applyResult = run('terraform', ['apply', '-input=false', '-auto-approve', '-no-color', planPath], {
      env: environment,
      allowedStatuses: [0, 1],
      description: 'terraform-apply',
    });
    const applyFailed = applyResult.status !== 0;
    if (applyFailed) {
      const diagnostics = Buffer.concat([
        Buffer.from(applyResult.stdout ?? ''),
        Buffer.from(applyResult.stderr ?? ''),
      ]);
      writePrivateFile(
        join(bundle, 'update-apply-failure.log'),
        diagnostics.length === 0 ? Buffer.from('Apply failed without diagnostics\n') : diagnostics,
      );
    }

    const convergence = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-var-file=${variablesPath}`,
    ], {
      env: environment,
      allowedStatuses: [0, 1, 2],
      description: 'terraform-convergence',
    });
    if (convergence.status !== 0) {
      if (!existsSync(join(bundle, 'update-convergence-failure.log'))) {
        const diagnostics = Buffer.concat([
          Buffer.from(convergence.stdout ?? ''),
          Buffer.from(convergence.stderr ?? ''),
        ]);
        writePrivateFile(
          join(bundle, 'update-convergence-failure.log'),
          diagnostics.length === 0 ? Buffer.from('Convergence failed without diagnostics\n') : diagnostics,
        );
      }
      throw new Error(applyFailed
        ? 'Workload update apply failed and live state is incomplete; private diagnostics were preserved'
        : 'Workload update apply completed but the follow-up plan is not empty');
    }

    const result = observeDeployedWorkload({
      repositoryRoot,
      repositoryCommit: metadata.repository_commit,
      sourceArchiveSha256: metadata.source_archive_sha256,
      runtimeConfigSha256: metadata.runtime_config_sha256,
    });
    const resultPath = join(bundle, 'result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider returned an error after the exact update converged; live state was reconciled.'
        : 'The exact private browser-relay rotation entry was applied and converged.',
      `Private result: ${resultPath}`,
      `Function: ${result.function.name}`,
      `Revision: ${result.function.revision}`,
      'Ingress: internal-only; unauthenticated invokers: 0; live requests: 0.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Private workload update apply failed');
  process.exitCode = 1;
});
