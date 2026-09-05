import {
  chmodSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  FIREBASE_APP_ID,
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  createPrivateBrowserAppCheckBundle,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  KEY_PREREQUISITE_ATTEMPT_CLAIM,
} from './key-contract.mjs';
import {
  browserAppCheckRegistrationAuthorization,
  buildBrowserAppCheckRegistrationPlanMetadata,
} from './registration-contract.mjs';
import {
  observePinnedBrowserAppCheckKeyAttemptClaim,
} from './attempt-claim.mjs';
import {
  observeBrowserAppCheckProviderAttemptClaimAbsent,
  observeBrowserAppCheckRegistrationAttemptClaimAbsent,
} from './registration-claim.mjs';
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
  observeBrowserAppCheckKeyInventory,
  validateCurrentBrowserAppCheckKeyInventory,
} from './inventory.mjs';
import { observeCurrentBrowserAppCheckKeyState } from './state.mjs';
import {
  readAndValidateBrowserAppCheckRegistrationPlan,
} from './validate-registration-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_BROWSER_APP_CHECK_REGISTRATION_PLAN_CONFIRMATION';
const EXACT_TARGET = `${PROJECT_ID}:${FIREBASE_APP_ID}:nondeletable`;
export const APP_CHECK_REGISTRATION_CONSUMED = true;
process.umask(0o077);

export async function observeBrowserAppCheckRegistrationBaseline(session) {
  const [
    keyAttemptClaim,
    registrationAttemptClaim,
    providerAttemptClaim,
    inventory,
    terraformState,
  ] =
    await Promise.all([
      observePinnedBrowserAppCheckKeyAttemptClaim(
        session,
        KEY_PREREQUISITE_ATTEMPT_CLAIM,
      ),
      observeBrowserAppCheckRegistrationAttemptClaimAbsent(session),
      observeBrowserAppCheckProviderAttemptClaimAbsent(session),
      observeBrowserAppCheckKeyInventory(session),
      observeCurrentBrowserAppCheckKeyState(session),
    ]);
  return Object.freeze({
    key_attempt_claim: keyAttemptClaim,
    registration_attempt_claim: registrationAttemptClaim,
    provider_attempt_claim: providerAttemptClaim,
    inventory: validateCurrentBrowserAppCheckKeyInventory(inventory),
    terraform_state: terraformState,
  });
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${EXACT_TARGET} ./registration-plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== EXACT_TARGET) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${EXACT_TARGET} to acknowledge the exact non-deletable provider target`);
  }
  validateBrowserAppCheckRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const session = await verifiedOperatorSession();
  const baseline = await observeBrowserAppCheckRegistrationBaseline(session);

  const bundle = createPrivateBrowserAppCheckBundle(process.argv[2], repositoryRoot);
  const terraformData = createTerraformData(bundle, 'registration-plan');
  try {
    const environment = terraformEnvironment(terraformData, session.accessToken);
    run('terraform', ['fmt', '-check', '-recursive'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-terraform-fmt',
    });
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-terraform-init',
    });
    run('terraform', ['validate', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-terraform-validate',
    });

    const planPath = join(bundle, 'browser-app-check-registration.tfplan');
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
      description: 'registration-terraform-plan',
    });
    if (planned.status !== 2) {
      throw new Error('Browser App Check registration plan must contain the reviewed one-create delta');
    }
    chmodSync(planPath, 0o400);

    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-terraform-show',
    });
    const planJsonBytes = Buffer.from(shown.stdout);
    const planJsonPath = join(bundle, 'browser-app-check-registration.tfplan.json');
    writePrivateFile(planJsonPath, planJsonBytes, 0o400);
    const summary = readAndValidateBrowserAppCheckRegistrationPlan(planJsonPath);
    const planBytes = readFileSync(planPath);

    const postPlanBaseline = await observeBrowserAppCheckRegistrationBaseline(session);
    if (!isDeepStrictEqual(postPlanBaseline, baseline)) {
      throw new Error('Browser App Check registration planning changed its exact prerequisite boundary');
    }
    const metadata = buildBrowserAppCheckRegistrationPlanMetadata({
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
      `Private browser App Check registration bundle: ${bundle}`,
      `Plan SHA-256: ${metadata.terraform_plan_sha256}`,
      `Baseline SHA-256: ${metadata.baseline_sha256}`,
      `Authorization: ${browserAppCheckRegistrationAuthorization(planBytes, repositoryCommit, metadata.baseline_sha256)}`,
      'Planned delta: 1 non-deletable provider registration, 0 updates, 0 deletes, 0 replacements.',
      'The exact existing score key, one-hour token TTL and default 0.5 risk score are pinned.',
      'App Check enforcement, browser traffic, assessments, debug tokens, IAM, public ingress and fixed-cost services remain absent.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (APP_CHECK_REGISTRATION_CONSUMED) {
    console.error(
      'The browser App Check provider registration has already converged; this planner is permanently retired.',
    );
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Browser App Check registration planning failed');
      process.exitCode = 1;
    });
  }
}
