import {
  chmodSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  authProbeRetireAuthorization,
  buildAuthProbePlanMetadata,
  canonicalJson,
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
  validateStagingManifest,
  validateToolchain,
} from './cli.mjs';
import { validateAuthProbeRoot } from './guard.mjs';
import { observeAuthProbeTemporaryInventory } from './inventory.mjs';
import {
  buildAuthProbeRetirementRecoveryInventory,
  inspectAuthProbeState,
  requiresAuthProbeRetirementRecovery,
} from './retirement-recovery.mjs';
import { readAndValidateAuthProbePlan } from './validate-plan.mjs';

const RETIRE_PLAN_CONFIRMATION = 'MIAKAPP_STAGING_AUTH_PROBE_RETIRE_PLAN_CONFIRMATION';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${RETIRE_PLAN_CONFIRMATION}=${PROJECT_ID} ./retire-plan.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, RETIRE_PLAN_CONFIRMATION);
  if (process.env[RETIRE_PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${RETIRE_PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge Auth-probe retirement`);
  }
  validateAuthProbeRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  const repositoryCommit = verifyExactMain(repositoryRoot);
  verifiedOperatorEmail(repositoryRoot);

  const terraformData = createTerraformData(bundle, 'retire-plan');
  const environment = terraformEnvironment(terraformData);
  try {
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-plan-init',
    });
    run('terraform', ['validate', '-no-color'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-plan-validate',
    });
    const state = inspectAuthProbeState(run('terraform', ['state', 'pull'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-plan-state-inventory',
    }).stdout);
    const recovery = buildAuthProbeRetirementRecoveryInventory(
      state,
      observeAuthProbeTemporaryInventory(),
    );
    if (requiresAuthProbeRetirementRecovery(recovery)) {
      throw new Error('Auth-probe retirement requires separately authorized recovery or finalization first');
    }
    const planPath = join(bundle, 'retire.tfplan');
    const planned = run('terraform', [
      'plan',
      '-var=armed=false',
      '-target=google_cloud_run_v2_service.auth_probe_verifier',
      '-target=google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker',
      '-target=google_project_iam_member.auth_probe',
      '-target=google_project_iam_member.auth_probe_firestore',
      '-target=google_project_iam_custom_role.auth_probe_generation_3',
      '-target=google_project_iam_custom_role.auth_probe_firestore_generation_3',
      '-target=google_project_iam_custom_role.auth_probe_signer_generation_3',
      '-target=google_service_account_iam_member.auth_probe_self_signer',
      '-target=google_workflows_workflow.auth_probe',
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
      description: 'terraform-retire-plan',
    });
    if (planned.status !== 2) throw new Error('Auth-probe retirement plan must contain the reviewed capability-closing delta');
    chmodSync(planPath, 0o400);

    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-retire-show',
    });
    const planJsonBytes = Buffer.from(shown.stdout);
    const planJsonPath = join(bundle, 'retire.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidateAuthProbePlan(planJsonPath, 'retire');
    const planBytes = readFileSync(planPath);
    const metadata = buildAuthProbePlanMetadata({
      phase: 'retire',
      repositoryCommit,
      createdAt: new Date().toISOString(),
      planBytes,
      planJsonBytes,
      summary,
      workflowRevision: summary.workflow_revision,
    });
    writePrivateFile(
      join(bundle, 'retire-metadata.json'),
      Buffer.from(canonicalJson(metadata), 'utf8'),
      0o400,
    );
    verifyExactMain(repositoryRoot, repositoryCommit);
    process.stdout.write([
      `Private Auth-probe bundle: ${bundle}`,
      `Retirement plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Authorization: ${authProbeRetireAuthorization(planBytes, summary.workflow_revision, repositoryCommit)}`,
      `Planned cleanup: 0 creates, ${summary.update} role disable(s), ${summary.delete} temporary resource delete(s).`,
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Auth-probe retirement planning failed');
  process.exitCode = 1;
});
