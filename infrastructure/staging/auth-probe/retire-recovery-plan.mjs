import { rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  authProbeRetirementRecoveryAuthorization,
  buildAuthProbeRetirementRecoveryMetadata,
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

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_AUTH_PROBE_RETIRE_RECOVERY_PLAN_CONFIRMATION';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./retire-recovery-plan.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge exact retirement recovery`);
  }
  validateAuthProbeRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  const repositoryCommit = verifyExactMain(repositoryRoot);
  verifiedOperatorEmail(repositoryRoot);

  const terraformData = createTerraformData(bundle, 'retire-recovery-plan');
  try {
    const environment = terraformEnvironment(terraformData);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-plan-init',
    });
    const pulled = run('terraform', ['state', 'pull'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-recovery-plan-state',
    });
    const inventory = buildAuthProbeRetirementRecoveryInventory(
      inspectAuthProbeState(pulled.stdout),
      observeAuthProbeTemporaryInventory(),
    );
    if (!requiresAuthProbeRetirementRecovery(inventory)) {
      throw new Error('No Auth-probe recovery or finalization action exists; use the normal retirement plan');
    }
    const metadata = buildAuthProbeRetirementRecoveryMetadata({
      repositoryCommit,
      createdAt: new Date().toISOString(),
      inventory,
    });
    writePrivateFile(
      join(bundle, 'retire-recovery-metadata.json'),
      Buffer.from(canonicalJson(metadata), 'utf8'),
      0o400,
    );
    verifyExactMain(repositoryRoot, repositoryCommit);
    process.stdout.write([
      `Private Auth-probe bundle: ${bundle}`,
      `Recovery phase: ${metadata.recovery_phase}`,
      `State-missing temporary resources: ${metadata.missing_temporaries.length}`,
      `State-tracked resources already absent live: ${metadata.absent_remote_temporaries.length}`,
      `Persistent resource state actions: ${metadata.persistent_state_actions.length}`,
      `Guard state action: ${metadata.guard_state_action?.action ?? 'none'}`,
      `Retirement finalization: ${metadata.retirement_finalization_required ? 'required' : 'not required'}`,
      `Authorization: ${authProbeRetirementRecoveryAuthorization(metadata)}`,
      metadata.recovery_phase === 'cloud_asset_api_prerequisite'
        ? 'This phase can only enable and import Cloud Asset API; rerun planning afterward for a fresh complete inventory.'
        : (metadata.retirement_finalization_required
          ? 'This phase can only finalize the exact zero-temporary graph and regenerate retirement evidence.'
          : 'The recovery can only retire exact live temporaries, reconcile exact dormant persistent resources, or repair the state-only guard.'),
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Auth-probe retirement recovery planning failed');
  process.exitCode = 1;
});
