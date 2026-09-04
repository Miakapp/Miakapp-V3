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
    if (inventory.missing_temporaries.length === 0
      && inventory.absent_remote_temporaries.length === 0
      && inventory.custom_role_state_action === null) {
      throw new Error('No state-missing Auth-probe resource exists; use the normal retirement plan');
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
      `State-missing temporary resources: ${metadata.missing_temporaries.length}`,
      `State-tracked resources already absent live: ${metadata.absent_remote_temporaries.length}`,
      `Custom role state action: ${metadata.custom_role_state_action ?? 'none'}`,
      `Authorization: ${authProbeRetirementRecoveryAuthorization(metadata)}`,
      'The recovery can only remove exact live temporaries absent from state or adopt the exact dormant custom role.',
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
