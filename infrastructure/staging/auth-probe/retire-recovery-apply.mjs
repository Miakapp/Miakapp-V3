import {
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  CAPABILITY_EXPIRY,
  CLOUD_ASSET_SERVICE,
  CUSTOM_ROLE_NAME,
  FIRESTORE_ROLE_NAME,
  PROBE_ACCOUNT,
  PROJECT_ID,
  REGION,
  SIGNER_ROLE_NAME,
  VERIFIER_SERVICE_NAME,
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
import { requireSyntheticFixturesAbsent } from './invoke.mjs';
import {
  AUTH_PROBE_RETIRED_STATE_ADDRESSES,
  buildAuthProbeRetirementRecoveryInventory,
  inspectAuthProbeState,
  TEMPORARY_ADDRESS_BY_KIND,
  validateAuthProbeRetirementRecoveryInventory,
} from './retirement-recovery.mjs';
import {
  readAndValidateAuthProbeOutputOnlyPlan,
  readAndValidateAuthProbePersistentRecoveryPlan,
  readAndValidateAuthProbePlan,
} from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_AUTH_PROBE_RETIRE_RECOVERY_AUTHORIZATION';
const PROBE_MEMBER = `serviceAccount:${PROBE_ACCOUNT}`;
const EXPIRY_EXPRESSION = `request.time < timestamp(\"${CAPABILITY_EXPIRY}\")`;
const FIREBASE_CONDITION = `title=temporary_user_relay_probe,expression=${EXPIRY_EXPRESSION},description=Expires the user-relay probe Firebase capability independently of cleanup.`;
const FIRESTORE_CONDITION = `title=temporary_user_relay_probe_default_database,expression=resource.name == \"projects/${PROJECT_ID}/databases/(default)\" && ${EXPIRY_EXPRESSION},description=Limits the temporary probe fixture capability to the default database and arm window.`;
const SIGNER_CONDITION = `title=temporary_user_relay_probe,expression=${EXPIRY_EXPRESSION},description=Expires the user-relay probe self-signing capability independently of cleanup.`;
const VERIFIER_CONDITION = `title=temporary_user_relay_probe,expression=${EXPIRY_EXPRESSION},description=Expires invocation of the temporary verifier independently of cleanup.`;
process.umask(0o077);

function retireAuthorizedLiveTemporaries(kinds, bundle) {
  if (kinds.includes('workflow')) {
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
  if (kinds.includes('project_role_binding')) {
    run('gcloud', [
      'projects', 'remove-iam-policy-binding', PROJECT_ID,
      `--member=${PROBE_MEMBER}`,
      `--role=${CUSTOM_ROLE_NAME}`,
      `--condition=${FIREBASE_CONDITION}`,
      '--quiet',
    ], {
      cwd: repositoryRoot,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-remove-project-binding',
    });
  }
  if (kinds.includes('firestore_role_binding')) {
    run('gcloud', [
      'projects', 'remove-iam-policy-binding', PROJECT_ID,
      `--member=${PROBE_MEMBER}`,
      `--role=${FIRESTORE_ROLE_NAME}`,
      `--condition=${FIRESTORE_CONDITION}`,
      '--quiet',
    ], {
      cwd: repositoryRoot,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-remove-firestore-binding',
    });
  }
  if (kinds.includes('self_signer_binding')) {
    run('gcloud', [
      'iam', 'service-accounts', 'remove-iam-policy-binding', PROBE_ACCOUNT,
      `--member=${PROBE_MEMBER}`,
      `--role=${SIGNER_ROLE_NAME}`,
      `--condition=${SIGNER_CONDITION}`,
      `--project=${PROJECT_ID}`,
      '--quiet',
    ], {
      cwd: repositoryRoot,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-remove-self-signer',
    });
  }
  if (kinds.includes('verifier_invoker_binding')) {
    run('gcloud', [
      'run', 'services', 'remove-iam-policy-binding', VERIFIER_SERVICE_NAME,
      `--member=${PROBE_MEMBER}`,
      '--role=roles/run.servicesInvoker',
      `--condition=${VERIFIER_CONDITION}`,
      `--region=${REGION}`,
      `--project=${PROJECT_ID}`,
      '--quiet',
    ], {
      cwd: repositoryRoot,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-remove-verifier-binding',
    });
  }
  if (kinds.includes('verifier_service')) {
    run('gcloud', [
      'run', 'services', 'delete', VERIFIER_SERVICE_NAME,
      `--region=${REGION}`,
      `--project=${PROJECT_ID}`,
      '--quiet',
    ], {
      cwd: repositoryRoot,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-delete-verifier-service',
    });
  }
}

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

    if (metadata.recovery_phase === 'cloud_asset_api_prerequisite') {
      const [stateAction] = metadata.persistent_state_actions;
      run('gcloud', [
        'services', 'enable', CLOUD_ASSET_SERVICE,
        `--project=${PROJECT_ID}`,
        '--quiet',
      ], {
        cwd: repositoryRoot,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-enable-cloud-asset-api',
      });
      if (stateAction.action === 'enable_reimport') {
        run('terraform', [
          'state', 'rm', '-lock-timeout=5m', stateAction.address,
        ], {
          cwd: authProbeRoot,
          env: environment,
          diagnosticDirectory: bundle,
          description: 'retire-recovery-forget-cloud-asset-api',
        });
      }
      run('terraform', [
        'import', '-input=false', '-lock-timeout=5m', '-no-color',
        stateAction.address, stateAction.import_id,
      ], {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-import-cloud-asset-api',
      });
      const finalLive = observeAuthProbeTemporaryInventory();
      const finalState = inspectAuthProbeState(run('terraform', ['state', 'pull'], {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-cloud-asset-final-state',
      }).stdout);
      if (!finalLive.cloud_asset_api
        || finalState.persistent_resource_statuses[stateAction.address] !== 'managed') {
        throw new Error('Cloud Asset API prerequisite recovery did not converge');
      }
      const resultPath = join(bundle, 'retire-recovery-result.json');
      writePrivateFile(resultPath, Buffer.from(canonicalJson({
        schema: 'miakapp.staging-auth-probe-retirement-recovery-result/1',
        project_id: PROJECT_ID,
        repository_commit: metadata.repository_commit,
        observed_at: new Date().toISOString(),
        recovery_phase: metadata.recovery_phase,
        retirement_finalization_required: metadata.retirement_finalization_required,
        persistent_state_actions: metadata.persistent_state_actions,
        terraform_state_sha256: finalState.sha256,
        live_inventory: finalLive,
        retirement: null,
        recurring_compute: false,
        persistent_credentials_created: 0,
      }), 'utf8'), 0o400);
      verifyExactMain(repositoryRoot, metadata.repository_commit);
      process.stdout.write([
        'The exact Cloud Asset API prerequisite recovery completed.',
        `Private sanitized result: ${resultPath}`,
        'Rerun the retirement recovery planner for a fresh complete inventory and authorization.',
        '',
      ].join('\n'));
      return;
    }

    retireAuthorizedLiveTemporaries(metadata.missing_temporaries, bundle);
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
    for (const stateAction of metadata.persistent_state_actions) {
      let stateArgs = null;
      if (stateAction.action === 'import') {
        stateArgs = [
          'import', '-input=false', '-lock-timeout=5m', '-no-color',
          stateAction.address, stateAction.import_id,
        ];
      } else if (stateAction.action === 'untaint') {
        stateArgs = ['untaint', '-lock-timeout=5m', '-no-color', stateAction.address];
      } else if (stateAction.action === 'recreate') {
        stateArgs = ['state', 'rm', '-lock-timeout=5m', stateAction.address];
      }
      if (stateArgs === null) continue;
      run('terraform', stateArgs, {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: `retire-recovery-${stateAction.action}-${stateAction.address.replaceAll(/[^a-z0-9]+/giu, '-')}`,
      });
    }
    if (['untaint', 'untaint_then_update'].includes(metadata.guard_state_action?.action)) {
      run('terraform', [
        'untaint', '-lock-timeout=5m', '-no-color', 'terraform_data.auth_probe_guard',
      ], {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-untaint-terraform-data-auth-probe-guard',
      });
    }

    const persistentMutations = Object.fromEntries(metadata.persistent_state_actions
      .filter(({ action }) => ['create', 'recreate'].includes(action))
      .map(({ address }) => [address, 'create']));
    if (['create', 'update', 'untaint_then_update'].includes(metadata.guard_state_action?.action)) {
      persistentMutations['terraform_data.auth_probe_guard'] = metadata.guard_state_action.action === 'create'
        ? 'create'
        : 'update';
    }
    if (Object.keys(persistentMutations).length !== 0) {
      const planPath = join(bundle, 'retire-recovery-persistent.tfplan');
      const planned = run('terraform', [
        'plan',
        '-var=armed=false',
        ...Object.keys(persistentMutations).sort().map((address) => `-target=${address}`),
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
        description: 'retire-recovery-persistent-plan',
      });
      if (planned.status !== 2) throw new Error('Persistent Auth-probe recovery plan has no reviewed mutation');
      const shown = run('terraform', ['show', '-json', planPath], {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-persistent-show',
      });
      const planJsonPath = join(bundle, 'retire-recovery-persistent.tfplan.json');
      writePrivateFile(planJsonPath, Buffer.from(shown.stdout), 0o400);
      readAndValidateAuthProbePersistentRecoveryPlan(planJsonPath, persistentMutations);
      run('terraform', [
        'apply', '-input=false', '-auto-approve', '-no-color', planPath,
      ], {
        cwd: authProbeRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'retire-recovery-persistent-apply',
      });
      chmodSync(planPath, 0o400);
    }
    const finalLive = observeAuthProbeTemporaryInventory();
    for (const kind of metadata.missing_temporaries) {
      const present = kind === 'workflow' || kind === 'verifier_service'
        ? finalLive[kind] !== null
        : finalLive[kind] === true;
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
    for (const stateAction of metadata.persistent_state_actions) {
      if (finalState.persistent_resource_statuses[stateAction.address] !== 'managed') {
        throw new Error('Auth-probe persistent resource state recovery did not converge');
      }
    }
    if (finalState.guard_state_status !== 'current') {
      throw new Error('Auth-probe state-only guard recovery did not converge');
    }
    if (Object.values(finalLive.persistent_resources).some((present) => present !== true)) {
      throw new Error('Auth-probe persistent live-resource recovery did not converge');
    }
    const trackedTemporaries = Object.values({
      verifier_service: 'google_cloud_run_v2_service.auth_probe_verifier[0]',
      verifier_invoker_binding: 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]',
      project_role_binding: 'google_project_iam_member.auth_probe[0]',
      firestore_role_binding: 'google_project_iam_member.auth_probe_firestore[0]',
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
        let roleSummary = null;
        try {
          roleSummary = readAndValidateAuthProbePlan(finalizeJsonPath, 'retire-finalize');
        } catch {
          readAndValidateAuthProbeOutputOnlyPlan(finalizeJsonPath);
        }
        if (roleSummary !== null
          && (roleSummary.create !== 0 || roleSummary.update < 1
            || roleSummary.update > 3 || roleSummary.delete !== 0)) {
          throw new Error('Auth-probe recovery finalization is outside the reviewed boundary');
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
      await requireSyntheticFixturesAbsent({ cleanup: true });
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
      if (!isDeepStrictEqual(retiredState.addresses, AUTH_PROBE_RETIRED_STATE_ADDRESSES)) {
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
      recovery_phase: metadata.recovery_phase,
      removed_state_missing_temporaries: metadata.missing_temporaries,
      forgotten_remote_absent_temporaries: metadata.absent_remote_temporaries,
      persistent_state_actions: metadata.persistent_state_actions,
      deleted_custom_roles: metadata.deleted_custom_roles,
      guard_state_action: metadata.guard_state_action,
      retirement_finalization_required: metadata.retirement_finalization_required,
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
