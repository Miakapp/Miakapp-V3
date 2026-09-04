import {
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  CUSTOM_ROLE_NAME,
  PROBE_ACCOUNT,
  PROJECT_ID,
  REGION,
  WORKFLOW_NAME,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  readAuthProbeRetirementRecoveryMetadata,
  validateAuthProbeRetirementRecoveryAuthorization,
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
import {
  observeAuthProbeRetirement,
  observeAuthProbeTemporaryInventory,
} from './inventory.mjs';
import { requireSyntheticUserAbsent } from './invoke.mjs';
import {
  buildAuthProbeRetirementRecoveryInventory,
  inspectAuthProbeState,
  TEMPORARY_ADDRESS_BY_KIND,
  validateAuthProbeRetirementRecoveryInventory,
} from './retirement-recovery.mjs';
import { readAndValidateAuthProbePlan } from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_AUTH_PROBE_RETIRE_RECOVERY_AUTHORIZATION';
const CUSTOM_ROLE_ADDRESS = 'google_project_iam_custom_role.auth_probe';
const CUSTOM_ROLE_IMPORT_ID = CUSTOM_ROLE_NAME;
const PROBE_MEMBER = `serviceAccount:${PROBE_ACCOUNT}`;
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./retire-recovery-apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateAuthProbeRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  const { value: metadata } = readAuthProbeRetirementRecoveryMetadata(
    join(bundle, 'retire-recovery-metadata.json'),
  );
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  verifiedOperatorEmail(repositoryRoot);
  validateAuthProbeRetirementRecoveryAuthorization(process.env[APPLY_AUTHORIZATION], metadata);

  const terraformData = createTerraformData(bundle, 'retire-recovery-apply');
  try {
    const environment = terraformEnvironment(terraformData);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-apply-init',
    });
    const pulled = run('terraform', ['state', 'pull'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-apply-state',
    });
    validateAuthProbeRetirementRecoveryInventory(buildAuthProbeRetirementRecoveryInventory(
      inspectAuthProbeState(pulled.stdout),
      observeAuthProbeTemporaryInventory(),
    ), metadata);

    if (metadata.custom_role_state_action !== null) {
      const roleStateArgs = metadata.custom_role_state_action === 'import'
        ? [
          'import', '-input=false', '-lock-timeout=5m', '-no-color',
          CUSTOM_ROLE_ADDRESS, CUSTOM_ROLE_IMPORT_ID,
        ]
        : ['untaint', '-lock-timeout=5m', '-no-color', CUSTOM_ROLE_ADDRESS];
      run('terraform', roleStateArgs, {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: `retire-recovery-${metadata.custom_role_state_action}-custom-role`,
      });
    }
    for (const kind of metadata.absent_remote_temporaries) {
      run('terraform', [
        'state', 'rm', '-lock-timeout=5m', TEMPORARY_ADDRESS_BY_KIND[kind],
      ], {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: `retire-recovery-forget-${kind}`,
      });
    }
    if (metadata.missing_temporaries.includes('workflow')) {
      run('gcloud', [
        'workflows', 'delete', WORKFLOW_NAME,
        `--location=${REGION}`,
        `--project=${PROJECT_ID}`,
        '--quiet',
      ], {
        cwd: repositoryRoot,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-delete-workflow',
      });
    }
    if (metadata.missing_temporaries.includes('project_role_binding')) {
      run('gcloud', [
        'projects', 'remove-iam-policy-binding', PROJECT_ID,
        `--member=${PROBE_MEMBER}`,
        `--role=${CUSTOM_ROLE_NAME}`,
        '--condition=None',
        '--quiet',
      ], {
        cwd: repositoryRoot,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-remove-project-binding',
      });
    }
    if (metadata.missing_temporaries.includes('self_signer_binding')) {
      run('gcloud', [
        'iam', 'service-accounts', 'remove-iam-policy-binding', PROBE_ACCOUNT,
        `--member=${PROBE_MEMBER}`,
        '--role=roles/iam.serviceAccountTokenCreator',
        '--condition=None',
        `--project=${PROJECT_ID}`,
        '--quiet',
      ], {
        cwd: repositoryRoot,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-remove-self-signer',
      });
    }

    const finalLive = observeAuthProbeTemporaryInventory();
    for (const kind of metadata.missing_temporaries) {
      const present = kind === 'workflow' ? finalLive.workflow !== null : finalLive[kind] === true;
      if (present) throw new Error(`Auth-probe recovery did not remove ${kind}`);
    }
    const finalPull = run('terraform', ['state', 'pull'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-final-state',
    });
    const finalState = inspectAuthProbeState(finalPull.stdout);
    let resultState = finalState;
    if (metadata.custom_role_state_action !== null
      && finalState.custom_role_status !== 'managed') {
      throw new Error('Auth-probe custom role state recovery did not converge');
    }
    const trackedTemporaries = Object.values({
      project_role_binding: 'google_project_iam_member.auth_probe[0]',
      self_signer_binding: 'google_service_account_iam_member.auth_probe_self_signer[0]',
      workflow: 'google_workflows_workflow.auth_probe[0]',
    }).filter((address) => finalState.addresses.includes(address));
    let finalizedRetirement = null;
    if (trackedTemporaries.length === 0) {
      const finalizePlanPath = join(bundle, 'retire-recovery-finalize.tfplan');
      const finalizePlan = run('terraform', [
        'plan',
        '-var=armed=false',
        '-input=false',
        '-lock-timeout=5m',
        '-no-color',
        '-detailed-exitcode',
        `-out=${finalizePlanPath}`,
      ], {
        cwd: authProbeRoot,
        env: environment,
        allowedStatuses: [0, 2],
        diagnosticDirectory: bundle,
        description: 'retire-recovery-finalize-plan',
      });
      if (finalizePlan.status === 2) {
        const shown = run('terraform', ['show', '-json', finalizePlanPath], {
          cwd: authProbeRoot,
          env: environment,
          diagnosticDirectory: bundle,
          description: 'retire-recovery-finalize-show',
        });
        const finalizeJsonPath = join(bundle, 'retire-recovery-finalize.tfplan.json');
        writePrivateFile(finalizeJsonPath, Buffer.from(shown.stdout), 0o400);
        const summary = readAndValidateAuthProbePlan(finalizeJsonPath, 'retire-finalize');
        if (summary.create !== 0 || summary.update !== 0 || summary.delete !== 0) {
          throw new Error('Auth-probe recovery finalization contains a cloud-resource mutation');
        }
        run('terraform', [
          'apply', '-input=false', '-auto-approve', '-no-color', finalizePlanPath,
        ], {
          cwd: authProbeRoot,
          env: environment,
          diagnosticDirectory: bundle,
          description: 'retire-recovery-finalize-apply',
        });
        chmodSync(finalizePlanPath, 0o400);
      }
      await requireSyntheticUserAbsent({ cleanup: true });
      run('terraform', [
        'plan', '-var=armed=false', '-input=false', '-lock-timeout=5m',
        '-no-color', '-detailed-exitcode',
      ], {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-final-convergence',
      });
      finalizedRetirement = observeAuthProbeRetirement();
      const retiredState = inspectAuthProbeState(run('terraform', ['state', 'pull'], {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-retired-state',
      }).stdout);
      const expected = [
        'data.terraform_remote_state.firebase_auth',
        'data.terraform_remote_state.workload',
        'google_project_iam_custom_role.auth_probe',
        'terraform_data.auth_probe_guard',
      ];
      if (JSON.stringify(retiredState.addresses) !== JSON.stringify(expected)) {
        throw new Error('Recovered Auth-probe retirement state is not exact');
      }
      resultState = retiredState;
    }
    const resultPath = join(bundle, 'retire-recovery-result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson({
      schema: 'miakapp.staging-auth-probe-retirement-recovery-result/1',
      project_id: PROJECT_ID,
      repository_commit: metadata.repository_commit,
      observed_at: new Date().toISOString(),
      removed_state_missing_temporaries: metadata.missing_temporaries,
      forgotten_remote_absent_temporaries: metadata.absent_remote_temporaries,
      custom_role_state_action: metadata.custom_role_state_action,
      terraform_state_sha256: resultState.sha256,
      live_inventory: finalLive,
      retirement: finalizedRetirement,
      recurring_compute: false,
      persistent_credentials_created: 0,
    }), 'utf8'), 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      'The exact Auth-probe retirement recovery completed.',
      `Private sanitized result: ${resultPath}`,
      finalizedRetirement === null
        ? 'Render and apply the normal retirement plan next; no product request was executed.'
        : 'No state-tracked temporary remained; state-only finalization and exact live retirement checks completed.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Auth-probe retirement recovery failed');
  process.exitCode = 1;
});
