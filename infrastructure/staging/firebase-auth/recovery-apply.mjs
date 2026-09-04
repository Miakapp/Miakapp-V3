import {
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { validateFirebaseAuthResult } from './apply.mjs';
import {
  PROJECT_ID,
  PROJECT_NUMBER,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  readFirebaseAuthReconciliationMetadata,
  readPrivateFile,
  sha256,
  validateFirebaseAuthReconciliationAuthorization,
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
  inspectFirebaseAuthState,
  observeLiveFirebaseAuth,
  validateClosedLiveFirebaseAuth,
  validateNoExternalIdentityProviders,
} from './recovery.mjs';
import { readAndValidateFirebaseAuthPlan } from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_FIREBASE_AUTH_RECONCILIATION_AUTHORIZATION';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./recovery-apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateFirebaseAuthRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  const { value: metadata } = readFirebaseAuthReconciliationMetadata(
    join(bundle, 'reconciliation-metadata.json'),
  );
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  verifiedOperatorEmail(repositoryRoot);
  validateFirebaseAuthReconciliationAuthorization(process.env[APPLY_AUTHORIZATION], metadata);

  const planPath = join(bundle, 'firebase-auth-reconciliation.tfplan');
  const planJsonPath = join(bundle, 'firebase-auth-reconciliation.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    throw new Error('Firebase Auth reconciliation bundle digest verification failed');
  }
  const summary = readAndValidateFirebaseAuthPlan(planJsonPath, 'reconcile');
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    throw new Error('Firebase Auth reconciliation summary no longer matches its metadata');
  }

  const terraformData = createTerraformData(bundle, 'recovery-apply');
  let mutationAttempted = false;
  try {
    const environment = terraformEnvironment(terraformData);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-apply-init',
    });
    const pulled = run('terraform', ['state', 'pull'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-apply-state-pull',
    });
    const state = inspectFirebaseAuthState(pulled.stdout);
    if (state.sha256 !== metadata.state_sha256
      || state.lineage_sha256 !== metadata.state_lineage_sha256
      || state.serial !== metadata.state_serial
      || state.config_status !== 'managed') {
      throw new Error('Firebase Auth state changed after the saved reconciliation plan');
    }
    const live = await observeLiveFirebaseAuth();
    if (!live.exists || live.sha256 !== metadata.live_config_sha256) {
      throw new Error('Live Firebase Auth changed after the saved reconciliation plan');
    }
    const shown = run('terraform', ['show', '-json', planPath], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      throw new Error('Firebase Auth reconciliation plan no longer renders to the reviewed JSON');
    }

    mutationAttempted = true;
    const applied = run('terraform', [
      'apply', '-input=false', '-auto-approve', '-no-color', planPath,
    ], {
      env: environment,
      allowedStatuses: [0, 1],
      description: 'recovery-terraform-apply',
    });
    const applyFailed = applied.status !== 0;
    if (applyFailed) {
      const diagnostics = Buffer.concat([
        Buffer.from(applied.stdout ?? ''),
        Buffer.from(applied.stderr ?? ''),
      ]);
      writePrivateFile(
        join(bundle, 'recovery-apply-failure.log'),
        diagnostics.length === 0 ? Buffer.from('Reconciliation failed without diagnostics\n') : diagnostics,
      );
    }
    const convergence = run('terraform', [
      'plan', '-input=false', '-lock-timeout=5m', '-no-color', '-detailed-exitcode',
    ], {
      env: environment,
      allowedStatuses: [0, 1, 2],
      description: 'recovery-convergence',
    });
    if (convergence.status !== 0) {
      throw new Error(applyFailed
        ? 'Firebase Auth reconciliation failed and remains incomplete'
        : 'Firebase Auth reconciliation applied but did not converge');
    }
    const output = run('terraform', ['output', '-json', 'staging_firebase_auth'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-output',
    });
    const firebaseAuth = validateFirebaseAuthResult(JSON.parse(Buffer.from(output.stdout).toString('utf8')));
    const finalLive = await observeLiveFirebaseAuth();
    if (!finalLive.exists) throw new Error('Firebase Auth disappeared after reconciliation');
    validateClosedLiveFirebaseAuth(finalLive.value);
    await validateNoExternalIdentityProviders();
    const finalPull = run('terraform', ['state', 'pull'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-final-state-pull',
    });
    const finalState = inspectFirebaseAuthState(finalPull.stdout);
    if (finalState.config_status !== 'managed') {
      throw new Error('Firebase Auth final state is not healthy');
    }
    const result = Object.freeze({
      schema: 'miakapp.staging-firebase-auth-recovery-result/1',
      project_id: PROJECT_ID,
      project_number: PROJECT_NUMBER,
      repository_commit: metadata.repository_commit,
      observed_at: new Date().toISOString(),
      terraform_state_sha256: finalState.sha256,
      live_config_sha256: finalLive.sha256,
      firebase_auth: firebaseAuth,
      external_identity_providers: 0,
      public_endpoints_created: 0,
      persistent_credentials_created: 0,
    });
    const resultPath = join(bundle, 'recovery-result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider reported an error, but the exact Firebase Auth recovery converged.'
        : 'The exact Firebase Auth recovery plan was applied and converged.',
      `Private sanitized result: ${resultPath}`,
      'Sign-in providers: 0; external identity providers: 0; public endpoints created: 0.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      throw new Error(`${error instanceof Error ? error.message : 'Firebase Auth recovery failed'}. Private diagnostics and remote state were preserved.`);
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Firebase Auth reconciliation failed');
  process.exitCode = 1;
});
