import {
  chmodSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  buildRelayServicesPrivateReadyPlanMetadata,
  canonicalJson,
  createPrivateRelayServicesReadyBundle,
  privateReadyRelayVariables,
  relayServicesPrivateReadyAuthorization,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  createTerraformData,
  relayServicesRoot,
  repositoryRoot,
  run,
  terraformEnvironment,
  validateStagingManifest,
  validateToolchain,
  verifiedOperatorSession,
} from './cli.mjs';
import { validateRelayServicesRoot } from './guard.mjs';
import {
  observeRelayServicesInventory,
  validateRelayServicesPrivateReadyBaseline,
} from './inventory.mjs';
import {
  observePinnedPrivateReadyPrerequisiteClaims,
  observeRelayPrivateReadyClaimAbsent,
} from './ready-claim.mjs';
import { readAndValidatePrivateReadyRelayServicesPlan } from './validate-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_RELAY_SERVICES_READY_PLAN_CONFIRMATION';
export const RELAY_SERVICES_PRIVATE_READY_OPERATION_CONSUMED = true;
const RETIRED_MESSAGE =
  'Relay private-ready transition already converged; this one-shot planning entrypoint is permanently retired';
process.umask(0o077);

async function observeBaseline(session) {
  return validateRelayServicesPrivateReadyBaseline({
    schema: 'miakapp.staging-browser-relay-services-private-ready-baseline/1',
    inventory: await observeRelayServicesInventory(session),
    private_ready_claim: await observeRelayPrivateReadyClaimAbsent(session),
  });
}

async function main() {
  if (RELAY_SERVICES_PRIVATE_READY_OPERATION_CONSUMED) throw new Error(RETIRED_MESSAGE);
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./ready-plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact private-ready target`);
  }
  validateRelayServicesRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const session = await verifiedOperatorSession();
  const baseline = await observeBaseline(session);
  await observePinnedPrivateReadyPrerequisiteClaims(session);

  const bundle = createPrivateRelayServicesReadyBundle(process.argv[2], repositoryRoot);
  const terraformData = createTerraformData(bundle, 'private-ready-plan');
  try {
    const variables = privateReadyRelayVariables();
    const variablesBytes = Buffer.from(canonicalJson(variables), 'utf8');
    const variablesPath = join(bundle, 'relay-services.auto.tfvars.json');
    writePrivateFile(variablesPath, variablesBytes);
    const environment = terraformEnvironment(terraformData, session.accessToken);

    run('terraform', ['fmt', '-check', '-recursive'], {
      cwd: relayServicesRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-fmt',
    });
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: relayServicesRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-init',
    });
    run('terraform', ['validate', '-no-color'], {
      cwd: relayServicesRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-validate',
    });

    const planPath = join(bundle, 'relay-services-private-ready.tfplan');
    const planned = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-var-file=${variablesPath}`,
      `-out=${planPath}`,
    ], {
      cwd: relayServicesRoot,
      env: environment,
      allowedStatuses: [2],
      diagnosticDirectory: bundle,
      description: 'terraform-private-ready-plan',
    });
    if (planned.status !== 2) {
      throw new Error('Private-ready plan must contain the reviewed three in-place updates');
    }
    chmodSync(planPath, 0o400);

    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: relayServicesRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-private-ready-show',
    });
    const planJsonBytes = Buffer.from(shown.stdout);
    const planJsonPath = join(bundle, 'relay-services-private-ready.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidatePrivateReadyRelayServicesPlan(planJsonPath);
    const planBytes = readFileSync(planPath);

    const baselineAfterPlan = await observeBaseline(session);
    await observePinnedPrivateReadyPrerequisiteClaims(session);
    if (!isDeepStrictEqual(baselineAfterPlan, baseline)) {
      throw new Error('Private-ready planning changed the reviewed live baseline');
    }
    const metadata = buildRelayServicesPrivateReadyPlanMetadata({
      repositoryCommit,
      createdAt: new Date().toISOString(),
      planBytes,
      planJsonBytes,
      variablesBytes,
      baseline,
      summary,
    });
    writePrivateFile(
      join(bundle, 'metadata.json'),
      Buffer.from(canonicalJson(metadata), 'utf8'),
      0o400,
    );
    chmodSync(variablesPath, 0o400);
    verifyExactMain(repositoryRoot, repositoryCommit);

    process.stdout.write([
      `Private relay-ready bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Baseline SHA-256: ${metadata.baseline_sha256}`,
      `Authorization: ${relayServicesPrivateReadyAuthorization(planBytes, repositoryCommit, metadata.baseline_sha256)}`,
      'Planned delta: 2 in-place audience updates, 1 in-place guard update, 1 identity no-op, 0 creates, 0 deletes.',
      'Relays remain private and scale 0..1; public invokers: 0; live requests: 0; Hosting releases: 0.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Private relay-ready planning failed');
    process.exitCode = 1;
  });
}
