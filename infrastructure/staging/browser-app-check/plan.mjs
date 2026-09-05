import {
  chmodSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  browserAppCheckApiAuthorization,
  buildBrowserAppCheckApiPlanMetadata,
  canonicalJson,
  createPrivateBrowserAppCheckBundle,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  browserAppCheckRoot,
  createTerraformData,
  repositoryRoot,
  run,
  terraformEnvironment,
  validateStagingManifest,
  validateToolchain,
  verifiedOperatorSession,
} from './cli.mjs';
import { validateBrowserAppCheckRoot } from './guard.mjs';
import {
  observeBrowserAppCheckInventory,
  validateBrowserAppCheckInventory,
} from './inventory.mjs';
import { observeInitialBrowserAppCheckState } from './state.mjs';
import { readAndValidateBrowserAppCheckApiPlan } from './validate-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_BROWSER_APP_CHECK_API_PLAN_CONFIRMATION';
process.umask(0o077);

async function observeBaseline(session) {
  const [inventory, terraformState] = await Promise.all([
    observeBrowserAppCheckInventory(session),
    observeInitialBrowserAppCheckState(session),
  ]);
  return Object.freeze({
    inventory: validateBrowserAppCheckInventory(inventory, 'before-api'),
    terraform_state: terraformState,
  });
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact reCAPTCHA API target`);
  }
  validateBrowserAppCheckRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const session = await verifiedOperatorSession();
  const baseline = await observeBaseline(session);

  const bundle = createPrivateBrowserAppCheckBundle(process.argv[2], repositoryRoot);
  const terraformData = createTerraformData(bundle, 'api-plan');
  try {
    const environment = terraformEnvironment(terraformData, session.accessToken);
    run('terraform', ['fmt', '-check', '-recursive'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-fmt',
    });
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-init',
    });
    run('terraform', ['validate', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-validate',
    });

    const planPath = join(bundle, 'browser-app-check-api.tfplan');
    const planned = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-out=${planPath}`,
    ], {
      cwd: browserAppCheckRoot,
      env: environment,
      allowedStatuses: [2],
      diagnosticDirectory: bundle,
      description: 'terraform-plan',
    });
    if (planned.status !== 2) {
      throw new Error('Browser App Check API plan must contain the reviewed create-only delta');
    }
    chmodSync(planPath, 0o400);

    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-show',
    });
    const planJsonBytes = Buffer.from(shown.stdout);
    const planJsonPath = join(bundle, 'browser-app-check-api.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidateBrowserAppCheckApiPlan(planJsonPath);
    const planBytes = readFileSync(planPath);
    const stateAfterPlan = await observeInitialBrowserAppCheckState(session);
    if (!isDeepStrictEqual(stateAfterPlan, baseline.terraform_state)) {
      throw new Error('Browser App Check API planning changed the reviewed empty backend state');
    }
    const metadata = buildBrowserAppCheckApiPlanMetadata({
      repositoryCommit,
      createdAt: new Date().toISOString(),
      planBytes,
      planJsonBytes,
      summary,
      baseline,
    });
    writePrivateFile(
      join(bundle, 'metadata.json'),
      Buffer.from(canonicalJson(metadata), 'utf8'),
      0o400,
    );
    verifyExactMain(repositoryRoot, repositoryCommit);
    process.stdout.write([
      `Private browser App Check API bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Baseline SHA-256: ${metadata.baseline_sha256}`,
      `Authorization: ${browserAppCheckApiAuthorization(planBytes, repositoryCommit, metadata.baseline_sha256)}`,
      `Planned delta: ${summary.create} creates, 0 updates, 0 deletes; state guard and API only.`,
      'Cloud Asset currently corroborates zero keys; authoritative key existence remains unknown until the API is enabled.',
      'No reCAPTCHA key, App Check registration, enforcement, debug token, browser request, or public ingress is planned.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Browser App Check API planning failed');
  process.exitCode = 1;
});
