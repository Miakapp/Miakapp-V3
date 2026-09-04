import {
  chmodSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  FIREBASE_AUTH_IMPORT_ID,
  assertSafeWorkloadEnvironment,
  buildFirebaseAuthReconciliationMetadata,
  canonicalJson,
  firebaseAuthReconciliationAuthorization,
  readFirebaseAuthStateRecoveryMetadata,
  validateFirebaseAuthStateRecoveryAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  createTerraformData,
  privateBundle,
  repositoryRoot,
  run,
  terraformEnvironment,
  validateStagingManifest,
  validateToolchain,
} from './cli.mjs';
import { validateFirebaseAuthRoot } from './guard.mjs';
import {
  FIREBASE_AUTH_ADDRESS,
  inspectFirebaseAuthState,
  observeLiveFirebaseAuth,
  validateClosedLiveFirebaseAuth,
  validateNoExternalIdentityProviders,
} from './recovery.mjs';
import { readAndValidateFirebaseAuthPlan } from './validate-plan.mjs';
import { validateFirebaseAuthResult } from './apply.mjs';

const ADOPT_AUTHORIZATION = 'MIAKAPP_STAGING_FIREBASE_AUTH_STATE_RECOVERY_AUTHORIZATION';
process.umask(0o077);

function assertStateSnapshot(state, metadata) {
  if (state.sha256 !== metadata.state_sha256
    || state.lineage_sha256 !== metadata.state_lineage_sha256
    || state.serial !== metadata.state_serial
    || (metadata.action === 'reconcile'
      ? state.config_status !== 'managed'
      : state.recovery_action !== metadata.action)) {
    throw new Error('Firebase Auth state changed after the reviewed recovery inventory');
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${ADOPT_AUTHORIZATION}=... ./recovery-adopt.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, ADOPT_AUTHORIZATION);
  validateFirebaseAuthRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  const { value: metadata } = readFirebaseAuthStateRecoveryMetadata(
    join(bundle, 'state-recovery-metadata.json'),
  );
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  verifiedOperatorEmail(repositoryRoot);
  validateFirebaseAuthStateRecoveryAuthorization(process.env[ADOPT_AUTHORIZATION], metadata);

  const terraformData = createTerraformData(bundle, 'recovery-adopt');
  try {
    const environment = terraformEnvironment(terraformData);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-adopt-init',
    });
    const pulled = run('terraform', ['state', 'pull'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-adopt-state-pull',
    });
    assertStateSnapshot(inspectFirebaseAuthState(pulled.stdout), metadata);
    const live = await observeLiveFirebaseAuth();
    if (!live.exists || live.sha256 !== metadata.live_config_sha256) {
      throw new Error('Live Firebase Auth configuration changed after the reviewed recovery inventory');
    }

    if (metadata.action !== 'reconcile') {
      const mutationArgs = metadata.action === 'import'
        ? ['import', '-input=false', '-lock-timeout=5m', '-no-color', FIREBASE_AUTH_ADDRESS, FIREBASE_AUTH_IMPORT_ID]
        : ['untaint', '-lock-timeout=5m', '-no-color', FIREBASE_AUTH_ADDRESS];
      run('terraform', mutationArgs, {
        env: environment,
        diagnosticDirectory: bundle,
        description: `recovery-${metadata.action}`,
      });
    }

    const postPull = run('terraform', ['state', 'pull'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-post-state-pull',
    });
    const postState = inspectFirebaseAuthState(postPull.stdout);
    if (postState.config_status !== 'managed'
      || postState.lineage_sha256 !== metadata.state_lineage_sha256
      || (metadata.action === 'reconcile'
        ? postState.sha256 !== metadata.state_sha256
        : postState.serial <= metadata.state_serial)) {
      throw new Error('Firebase Auth state adoption did not produce the exact healthy managed address');
    }
    const postLive = await observeLiveFirebaseAuth();
    if (!postLive.exists || postLive.sha256 !== metadata.live_config_sha256) {
      throw new Error('Firebase Auth state adoption unexpectedly changed the live configuration');
    }

    const planPath = join(bundle, 'firebase-auth-reconciliation.tfplan');
    const planned = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-out=${planPath}`,
    ], {
      env: environment,
      allowedStatuses: [0, 2],
      diagnosticDirectory: bundle,
      description: 'recovery-reconciliation-plan',
    });
    if (planned.status === 0) {
      const output = run('terraform', ['output', '-json', 'staging_firebase_auth'], {
        env: environment,
        diagnosticDirectory: bundle,
        description: 'recovery-adopt-output',
      });
      const firebaseAuth = validateFirebaseAuthResult(
        JSON.parse(Buffer.from(output.stdout).toString('utf8')),
      );
      validateClosedLiveFirebaseAuth(postLive.value);
      await validateNoExternalIdentityProviders();
      const resultPath = join(bundle, 'recovery-result.json');
      writePrivateFile(resultPath, Buffer.from(canonicalJson({
        schema: 'miakapp.staging-firebase-auth-recovery-result/1',
        project_id: metadata.project_id,
        project_number: metadata.project_number,
        repository_commit: metadata.repository_commit,
        observed_at: new Date().toISOString(),
        terraform_state_sha256: postState.sha256,
        live_config_sha256: postLive.sha256,
        firebase_auth: firebaseAuth,
        external_identity_providers: 0,
        public_endpoints_created: 0,
        persistent_credentials_created: 0,
      }), 'utf8'), 0o400);
      verifyExactMain(repositoryRoot, metadata.repository_commit);
      process.stdout.write([
        `Terraform state action completed: ${metadata.action}`,
        'The exact Firebase Auth baseline already converges; no cloud reconciliation was required.',
        `Private sanitized result: ${resultPath}`,
        '',
      ].join('\n'));
      return;
    }
    chmodSync(planPath, 0o400);
    const shown = run('terraform', ['show', '-json', planPath], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-reconciliation-show',
    });
    const planJsonBytes = Buffer.from(shown.stdout);
    const planJsonPath = join(bundle, 'firebase-auth-reconciliation.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidateFirebaseAuthPlan(planJsonPath, 'reconcile');
    const planBytes = readFileSync(planPath);
    const reconciliation = buildFirebaseAuthReconciliationMetadata({
      repositoryCommit: metadata.repository_commit,
      createdAt: new Date().toISOString(),
      planBytes,
      planJsonBytes,
      summary,
      state: postState,
      liveConfigSha256: postLive.sha256,
    });
    writePrivateFile(
      join(bundle, 'reconciliation-metadata.json'),
      Buffer.from(canonicalJson(reconciliation), 'utf8'),
      0o400,
    );
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      `Terraform state action completed: ${metadata.action}`,
      `Reconciliation plan SHA-256: ${reconciliation.terraform_plan_sha256}`,
      `Authorization: ${firebaseAuthReconciliationAuthorization(reconciliation)}`,
      `Planned reconciliation: ${summary.create} creates, ${summary.update} updates, 0 deletes; Firebase Auth is never created or replaced.`,
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Firebase Auth state adoption failed');
  process.exitCode = 1;
});
