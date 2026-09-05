import {
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  assertSafeWorkloadEnvironment,
  canonicalJson,
  readAuthProbePlanMetadata,
  readPrivateFile,
  sha256,
  validateAuthProbeRetireAuthorization,
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
import { observeAuthProbeRetirement } from './inventory.mjs';
import { requireSyntheticFixturesAbsent } from './invoke.mjs';
import { readAndValidateAuthProbePlan } from './validate-plan.mjs';
import { AUTH_PROBE_RETIRED_STATE_ADDRESSES } from './retirement-recovery.mjs';

const RETIRE_AUTHORIZATION = 'MIAKAPP_STAGING_AUTH_PROBE_RETIRE_AUTHORIZATION';
process.umask(0o077);

function validateRetiredState(value) {
  const addresses = Buffer.from(value.stdout ?? '').toString('utf8')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!isDeepStrictEqual(addresses.sort(), AUTH_PROBE_RETIRED_STATE_ADDRESSES)) {
    throw new Error('Retired Auth-probe Terraform state contains an unexpected resource');
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${RETIRE_AUTHORIZATION}=... ./retire-apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, RETIRE_AUTHORIZATION);
  validateAuthProbeRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  const { value: metadata } = readAuthProbePlanMetadata(
    join(bundle, 'retire-metadata.json'),
    'retire',
  );
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  verifiedOperatorEmail(repositoryRoot);

  const planPath = join(bundle, 'retire.tfplan');
  const planJsonPath = join(bundle, 'retire.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    throw new Error('Auth-probe retirement bundle digest verification failed');
  }
  validateAuthProbeRetireAuthorization(
    process.env[RETIRE_AUTHORIZATION],
    planBytes,
    metadata.workflow_revision,
    metadata.repository_commit,
  );
  const summary = readAndValidateAuthProbePlan(planJsonPath, 'retire');
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    throw new Error('Auth-probe retirement metadata no longer matches the reviewed plan');
  }

  const terraformData = createTerraformData(bundle, 'retire-apply');
  const environment = terraformEnvironment(terraformData);
  try {
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-apply-init',
    });
    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      throw new Error('Terraform retirement plan no longer renders to the reviewed JSON');
    }
    run('terraform', ['apply', '-input=false', '-auto-approve', '-no-color', planPath], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-retire-apply',
    });
    await requireSyntheticFixturesAbsent({ cleanup: true });
    run('terraform', [
      'plan',
      '-var=armed=false',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
    ], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retire-convergence',
    });
    validateRetiredState(run('terraform', ['state', 'list'], {
      cwd: authProbeRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'retired-state-inventory',
    }));

    const retirement = observeAuthProbeRetirement();
    const retirementPath = join(bundle, 'retirement.json');
    writePrivateFile(retirementPath, Buffer.from(canonicalJson(retirement), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      'The exact Auth-probe retirement plan was applied and converged.',
      `Private retirement result: ${retirementPath}`,
      'Workflow and verifier service removed; temporary IAM bindings removed; dormant roles disabled and the verifier identity retained keyless.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Auth-probe retirement apply failed');
  process.exitCode = 1;
});
