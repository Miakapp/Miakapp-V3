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
  bootstrapRelayVariables,
  buildRelayServicesBootstrapPlanMetadata,
  canonicalJson,
  createPrivateRelayServicesBundle,
  relayServicesBootstrapAuthorization,
  sha256,
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
  validateRelayServicesBootstrapBaseline,
} from './inventory.mjs';
import { readAndValidateInitialRelayServicesPlan } from './validate-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_RELAY_SERVICES_BOOTSTRAP_PLAN_CONFIRMATION';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact private relay target`);
  }
  validateRelayServicesRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const session = await verifiedOperatorSession();
  const baseline = validateRelayServicesBootstrapBaseline(
    await observeRelayServicesInventory(session),
  );

  const bundle = createPrivateRelayServicesBundle(process.argv[2], repositoryRoot);
  const terraformData = createTerraformData(bundle, 'bootstrap-plan');
  try {
    const variables = bootstrapRelayVariables();
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

    const planPath = join(bundle, 'relay-services-bootstrap.tfplan');
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
      description: 'terraform-plan',
    });
    if (planned.status !== 2) {
      throw new Error('Private relay bootstrap plan must contain the reviewed create-only delta');
    }
    chmodSync(planPath, 0o400);

    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: relayServicesRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-show',
    });
    const planJsonBytes = Buffer.from(shown.stdout);
    const planJsonPath = join(bundle, 'relay-services-bootstrap.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidateInitialRelayServicesPlan(planJsonPath);
    const planBytes = readFileSync(planPath);

    const baselineAfterPlan = validateRelayServicesBootstrapBaseline(
      await observeRelayServicesInventory(session),
    );
    if (!isDeepStrictEqual(baselineAfterPlan, baseline)) {
      throw new Error('Relay-services planning changed the reviewed staging baseline');
    }
    const metadata = buildRelayServicesBootstrapPlanMetadata({
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
      `Private relay-services bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Baseline SHA-256: ${metadata.baseline_sha256}`,
      `Authorization: ${relayServicesBootstrapAuthorization(planBytes, repositoryCommit, metadata.baseline_sha256)}`,
      'Planned delta: 4 creates, 0 updates, 0 deletes; two private scale-to-zero relays and one keyless identity.',
      'Public invokers: 0; live requests: 0; Hosting releases: 0; estimated monthly increment below EUR 1.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Private relay-services planning failed');
    process.exitCode = 1;
  });
}
