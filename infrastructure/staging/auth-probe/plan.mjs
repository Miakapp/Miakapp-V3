import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  authProbeApplyAuthorization,
  buildAuthProbePlanMetadata,
  canonicalJson,
  createPrivateAuthProbeBundle,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  authProbeRoot,
  repositoryRoot,
  run,
  terraformEnvironment,
  validateFirebaseAuthConvergence,
  validateStagingManifest,
  validateToolchain,
} from './cli.mjs';
import { validateAuthProbeRoot } from './guard.mjs';
import { observeCloudAssetApi } from './inventory.mjs';
import { readAndValidateAuthProbePlan } from './validate-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_AUTH_PROBE_PLAN_CONFIRMATION';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact Auth-probe target`);
  }
  validateAuthProbeRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  verifiedOperatorEmail(repositoryRoot);
  observeCloudAssetApi();

  const bundle = createPrivateAuthProbeBundle(process.argv[2], repositoryRoot);
  await validateFirebaseAuthConvergence(bundle, 'plan');
  const terraformData = join(bundle, 'terraform-data');
  mkdirSync(terraformData, { mode: 0o700 });
  try {
    const environment = terraformEnvironment(terraformData);
    run('terraform', ['fmt', '-check', '-recursive'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-fmt',
    });
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-init',
    });
    run('terraform', ['validate', '-no-color'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-validate',
    });

    const planPath = join(bundle, 'arm.tfplan');
    const planned = run('terraform', [
      'plan',
      '-var=armed=true',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-out=${planPath}`,
    ], {
      cwd: authProbeRoot,
      env: environment,
      allowedStatuses: [2],
      diagnosticDirectory: bundle,
      description: 'terraform-arm-plan',
    });
    if (planned.status !== 2) throw new Error('Auth-probe arm plan must contain the reviewed delta');
    chmodSync(planPath, 0o400);

    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-arm-show',
    });
    const planJsonBytes = Buffer.from(shown.stdout);
    const planJsonPath = join(bundle, 'arm.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidateAuthProbePlan(planJsonPath, 'arm');
    const planBytes = readFileSync(planPath);
    const metadata = buildAuthProbePlanMetadata({
      phase: 'arm',
      repositoryCommit,
      createdAt: new Date().toISOString(),
      planBytes,
      planJsonBytes,
      summary,
    });
    writePrivateFile(
      join(bundle, 'arm-metadata.json'),
      Buffer.from(canonicalJson(metadata), 'utf8'),
      0o400,
    );
    verifyExactMain(repositoryRoot, repositoryCommit);
    process.stdout.write([
      `Private Auth-probe bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Workflow source SHA-256: ${metadata.workflow_source_sha256}`,
      `Authorization: ${authProbeApplyAuthorization(planBytes, repositoryCommit)}`,
      `Planned delta: ${summary.create} creates, ${summary.update} updates, 0 deletes; no execution or public ingress.`,
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Auth-probe planning failed');
  process.exitCode = 1;
});
