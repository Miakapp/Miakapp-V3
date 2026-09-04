import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TERRAFORM_VERSION,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  childEnvironment,
  readPrivateFile,
  readProbePlanMetadata,
  sha256,
  validateProbeApplyAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import { validateProbeRoot } from './guard.mjs';
import { observeProbeDeployment } from './invoke.mjs';
import { readAndValidateProbePlan } from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_PROBE_APPLY_AUTHORIZATION';
const probeRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
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
    if (options.diagnosticPath !== undefined && !existsSync(options.diagnosticPath)) {
      const diagnostics = Buffer.concat([
        Buffer.from(result.stdout ?? ''),
        Buffer.from(result.stderr ?? ''),
      ]);
      writePrivateFile(
        options.diagnosticPath,
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

function privateBundle(path) {
  const bundle = realpathSync(resolve(path));
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, bundle);
  const entry = lstatSync(bundle);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    throw new Error('Private-probe apply requires an exact private bundle directory');
  }
  return bundle;
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateProbeRoot(new URL('./', import.meta.url));
  const bundle = privateBundle(process.argv[2]);
  const { value: metadata } = readProbePlanMetadata(join(bundle, 'metadata.json'));
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  verifiedOperatorEmail(repositoryRoot);

  const planPath = join(bundle, 'probe.tfplan');
  const planJsonPath = join(bundle, 'probe.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    throw new Error('Private-probe bundle digest verification failed');
  }
  validateProbeApplyAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
  );
  readAndValidateProbePlan(planJsonPath);

  const terraformData = join(bundle, `.terraform-apply-${process.pid}`);
  mkdirSync(terraformData, { mode: 0o700 });
  const environment = terraformEnvironment(terraformData);
  try {
    const version = run('terraform', ['version', '-json'], { description: 'terraform-version' });
    if (JSON.parse(Buffer.from(version.stdout).toString('utf8')).terraform_version !== TERRAFORM_VERSION) {
      throw new Error(`Terraform ${TERRAFORM_VERSION} is required`);
    }
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      env: environment,
      diagnosticPath: join(bundle, 'apply-init.log'),
      description: 'terraform-init',
    });
    const rendered = run('terraform', ['show', '-json', planPath], {
      env: environment,
      diagnosticPath: join(bundle, 'apply-show.log'),
      description: 'terraform-show',
    });
    if (sha256(Buffer.from(rendered.stdout)) !== metadata.terraform_plan_json_sha256) {
      throw new Error('Terraform binary plan no longer renders to the reviewed JSON');
    }
    const applyResult = run('terraform', ['apply', '-input=false', '-auto-approve', '-no-color', planPath], {
      env: environment,
      allowedStatuses: [0, 1],
      diagnosticPath: join(bundle, 'apply-failure.log'),
      description: 'terraform-apply',
    });
    const applyFailed = applyResult.status !== 0;
    if (applyFailed) {
      const diagnostics = Buffer.concat([
        Buffer.from(applyResult.stdout ?? ''),
        Buffer.from(applyResult.stderr ?? ''),
      ]);
      writePrivateFile(
        join(bundle, 'apply-failure.log'),
        diagnostics.length === 0 ? Buffer.from('Apply failed without diagnostics\n') : diagnostics,
      );
    }
    const convergence = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
    ], {
      env: environment,
      allowedStatuses: [0, 1, 2],
      description: 'terraform-convergence',
    });
    if (convergence.status !== 0) {
      const diagnostics = Buffer.concat([
        Buffer.from(convergence.stdout ?? ''),
        Buffer.from(convergence.stderr ?? ''),
      ]);
      writePrivateFile(
        join(bundle, 'convergence-failure.log'),
        diagnostics.length === 0 ? Buffer.from('Convergence failed without diagnostics\n') : diagnostics,
      );
      throw new Error(applyFailed
        ? 'Private-probe apply failed and live state is incomplete; private diagnostics were preserved'
        : 'Private-probe apply completed but the follow-up plan is not empty');
    }

    const result = observeProbeDeployment({ repositoryRoot });
    const resultPath = join(bundle, 'deployment-result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider returned an error after the exact private-probe graph converged.'
        : 'The exact private-probe plan was applied and converged.',
      `Private deployment result: ${resultPath}`,
      `Workflow revision: ${result.workflow.revision}`,
      'Executions: 0; schedules: 0; live requests: 0.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Private-probe apply failed');
  process.exitCode = 1;
});
