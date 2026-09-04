import {
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  assertSafeWorkloadEnvironment,
  authProbeInvokeAuthorization,
  canonicalJson,
  readAuthProbePlanMetadata,
  readPrivateFile,
  sha256,
  validateAuthProbeApplyAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  authProbeRoot,
  createTerraformData,
  privateBundle,
  repositoryRoot,
  run,
  terraformEnvironment,
  validateFirebaseAuthConvergence,
  validateStagingManifest,
  validateToolchain,
} from './cli.mjs';
import { validateAuthProbeRoot } from './guard.mjs';
import { observeAuthProbeDeployment } from './inventory.mjs';
import { readAndValidateAuthProbePlan } from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_AUTH_PROBE_APPLY_AUTHORIZATION';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateAuthProbeRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  const { value: metadata } = readAuthProbePlanMetadata(
    join(bundle, 'arm-metadata.json'),
    'arm',
  );
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  verifiedOperatorEmail(repositoryRoot);

  const planPath = join(bundle, 'arm.tfplan');
  const planJsonPath = join(bundle, 'arm.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    throw new Error('Auth-probe arm bundle digest verification failed');
  }
  validateAuthProbeApplyAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
  );
  const summary = readAndValidateAuthProbePlan(planJsonPath, 'arm');
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    throw new Error('Auth-probe arm metadata summary no longer matches the reviewed plan');
  }
  await validateFirebaseAuthConvergence(bundle, 'apply');

  const terraformData = createTerraformData(bundle, 'arm-apply');
  const environment = terraformEnvironment(terraformData);
  let mutationAttempted = false;
  try {
    const initialized = run('terraform', [
      'init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color',
    ], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'arm-apply-init',
    });
    if (initialized.status !== 0) throw new Error('Terraform initialization failed');
    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'arm-apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      throw new Error('Terraform arm plan no longer renders to the reviewed JSON');
    }
    mutationAttempted = true;
    const applied = run('terraform', [
      'apply', '-input=false', '-auto-approve', '-no-color', planPath,
    ], {
      cwd: authProbeRoot,
      env: environment,
      allowedStatuses: [0, 1],
      description: 'terraform-arm-apply',
    });
    const applyFailed = applied.status !== 0;
    if (applyFailed) {
      const diagnostics = Buffer.concat([
        Buffer.from(applied.stdout ?? ''),
        Buffer.from(applied.stderr ?? ''),
      ]);
      writePrivateFile(
        join(bundle, 'arm-apply-failure.log'),
        diagnostics.length === 0 ? Buffer.from('Apply failed without diagnostics\n') : diagnostics,
      );
    }
    run('terraform', [
      'plan',
      '-var=armed=true',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
    ], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'arm-convergence',
    });

    const deployment = observeAuthProbeDeployment({ expectedExecutions: 0 });
    const deploymentPath = join(bundle, 'deployment.json');
    writePrivateFile(deploymentPath, Buffer.from(canonicalJson(deployment), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider returned an error after the exact Auth-probe graph converged.'
        : 'The exact Auth-probe arm plan was applied and converged.',
      `Private deployment result: ${deploymentPath}`,
      `Workflow revision: ${deployment.workflow.revision}`,
      `Authorization: ${authProbeInvokeAuthorization(deployment.workflow.revision, metadata.repository_commit)}`,
      'Executions: 0; schedules: 0; live product requests: 0.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      throw new Error([
        'Auth-probe arm did not fully converge; the private diagnostics and state were preserved.',
        `Run MIAKAPP_STAGING_AUTH_PROBE_RETIRE_PLAN_CONFIRMATION=miakapp-v4-staging ./infrastructure/staging/auth-probe/retire-plan.sh ${bundle}`,
        'The cleanup planner accepts an exact partial set of temporary resources.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Auth-probe apply failed');
  process.exitCode = 1;
});
