import { rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  buildFirebaseAuthStateRecoveryMetadata,
  canonicalJson,
  createPrivateFirebaseAuthBundle,
  firebaseAuthStateRecoveryAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  createTerraformData,
  repositoryRoot,
  run,
  terraformEnvironment,
  validateStagingManifest,
  validateToolchain,
} from './cli.mjs';
import { validateFirebaseAuthRoot } from './guard.mjs';
import { inspectFirebaseAuthState, observeLiveFirebaseAuth } from './recovery.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_FIREBASE_AUTH_RECOVERY_PLAN_CONFIRMATION';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./recovery-plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact recovery target`);
  }
  validateFirebaseAuthRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  verifiedOperatorEmail(repositoryRoot);

  const bundle = createPrivateFirebaseAuthBundle(process.argv[2], repositoryRoot);
  const terraformData = createTerraformData(bundle, 'recovery-plan');
  try {
    const environment = terraformEnvironment(terraformData);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-plan-init',
    });
    const pulled = run('terraform', ['state', 'pull'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'recovery-plan-state-pull',
    });
    const state = inspectFirebaseAuthState(pulled.stdout);
    const live = await observeLiveFirebaseAuth();
    if (!live.exists) {
      throw new Error('Firebase Auth is not initialized live; use the normal initialization plan');
    }
    const metadata = buildFirebaseAuthStateRecoveryMetadata({
      repositoryCommit,
      createdAt: new Date().toISOString(),
      action: state.recovery_action ?? 'reconcile',
      state,
      liveConfigSha256: live.sha256,
    });
    writePrivateFile(
      join(bundle, 'state-recovery-metadata.json'),
      Buffer.from(canonicalJson(metadata), 'utf8'),
      0o400,
    );
    verifyExactMain(repositoryRoot, repositoryCommit);
    process.stdout.write([
      `Private Firebase Auth recovery bundle: ${bundle}`,
      `Recovery action: ${metadata.action}`,
      `Authorization: ${firebaseAuthStateRecoveryAuthorization(metadata)}`,
      metadata.action === 'reconcile'
        ? 'This operation prepares reconciliation for the exact already-managed staging configuration.'
        : 'This operation only adopts or untaints the exact existing staging configuration in Terraform state.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Firebase Auth recovery planning failed');
  process.exitCode = 1;
});
