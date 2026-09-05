import {
  chmodSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  HOSTING_DOMAIN,
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  createPrivateBrowserAppCheckBundle,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  browserAppCheckKeyAuthorization,
  buildBrowserAppCheckKeyPlanMetadata,
} from './key-contract.mjs';
import {
  observeBrowserAppCheckKeyAttemptClaimAbsent,
} from './attempt-claim.mjs';
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
import { observeBrowserAppCheckApiState } from './state.mjs';
import { readAndValidateBrowserAppCheckKeyPlan } from './validate-key-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_BROWSER_APP_CHECK_KEY_PLAN_CONFIRMATION';
const EXACT_TARGET = `${PROJECT_ID}:${HOSTING_DOMAIN}`;
export const KEY_PREREQUISITE_CONSUMED = true;
process.umask(0o077);

async function observeBaseline(session) {
  const [attemptClaim, inventory, terraformState] = await Promise.all([
    observeBrowserAppCheckKeyAttemptClaimAbsent(session),
    observeBrowserAppCheckInventory(session),
    observeBrowserAppCheckApiState(session),
  ]);
  return Object.freeze({
    attempt_claim: attemptClaim,
    inventory: validateBrowserAppCheckInventory(inventory, 'after-api'),
    terraform_state: terraformState,
  });
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${EXACT_TARGET} ./key-plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== EXACT_TARGET) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${EXACT_TARGET} to acknowledge the exact key target`);
  }
  validateBrowserAppCheckRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const session = await verifiedOperatorSession();
  const baseline = await observeBaseline(session);

  const bundle = createPrivateBrowserAppCheckBundle(process.argv[2], repositoryRoot);
  const terraformData = createTerraformData(bundle, 'key-plan');
  try {
    const environment = terraformEnvironment(terraformData, session.accessToken);
    run('terraform', ['fmt', '-check', '-recursive'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'key-terraform-fmt',
    });
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'key-terraform-init',
    });
    run('terraform', ['validate', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'key-terraform-validate',
    });

    const planPath = join(bundle, 'browser-app-check-key.tfplan');
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
      description: 'key-terraform-plan',
    });
    if (planned.status !== 2) {
      throw new Error('Browser App Check key plan must contain the reviewed one-create delta');
    }
    chmodSync(planPath, 0o400);

    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'key-terraform-show',
    });
    const planJsonBytes = Buffer.from(shown.stdout);
    const planJsonPath = join(bundle, 'browser-app-check-key.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidateBrowserAppCheckKeyPlan(planJsonPath);
    const planBytes = readFileSync(planPath);

    const postPlanBaseline = await observeBaseline(session);
    if (!isDeepStrictEqual(postPlanBaseline, baseline)) {
      throw new Error('Browser App Check key planning changed its exact empty-key baseline');
    }
    const metadata = buildBrowserAppCheckKeyPlanMetadata({
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
      `Private browser App Check key bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Baseline SHA-256: ${metadata.baseline_sha256}`,
      `Authorization: ${browserAppCheckKeyAuthorization(planBytes, repositoryCommit, metadata.baseline_sha256)}`,
      'Planned delta: 1 create, 0 updates, 0 deletes; one domain-restricted SCORE key only.',
      'Apply will first acquire one private atomic GCS attempt claim; it has no fixed recurring cost and is never auto-retried.',
      `Allowed domain: ${HOSTING_DOMAIN}; all-domain, AMP, testing, WAF and App Check registration are disabled or absent.`,
      'No browser request, assessment, enforcement, debug token, public endpoint or fixed-cost service is planned.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (KEY_PREREQUISITE_CONSUMED) {
    console.error(
      'The browser App Check score-key prerequisite has already converged; this planner is permanently retired.',
    );
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Browser App Check key planning failed');
      process.exitCode = 1;
    });
  }
}
