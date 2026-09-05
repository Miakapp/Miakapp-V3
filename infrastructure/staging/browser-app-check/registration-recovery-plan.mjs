import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  FIREBASE_APP_ID,
  PROJECT_ID,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  privateBrowserAppCheckBundle,
  readPrivateFile,
  sha256,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  readBrowserAppCheckRegistrationPlanMetadataForRecovery,
} from './registration-contract.mjs';
import {
  observePinnedBrowserAppCheckKeyAttemptClaim,
} from './attempt-claim.mjs';
import {
  observeBrowserAppCheckProviderAttemptClaimState,
  observeBrowserAppCheckRegistrationAttemptClaim,
  readBrowserAppCheckRegistrationAttemptClaimReceipt,
} from './registration-claim.mjs';
import {
  KEY_PREREQUISITE_ATTEMPT_CLAIM,
} from './key-contract.mjs';
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
  observeBrowserAppCheckRegistrationRecoveryInventory,
} from './inventory.mjs';
import {
  browserAppCheckRegistrationRecoveryAuthorization,
  buildBrowserAppCheckRegistrationRecoveryMetadata,
  createBrowserAppCheckRegistrationRecoveryBundle,
  inspectBrowserAppCheckRegistrationState,
  validateBrowserAppCheckRegistrationProviderAttemptBoundary,
} from './registration-recovery.mjs';
import {
  readBrowserAppCheckStateBytes,
  validateCurrentBrowserAppCheckKeyState,
} from './state.mjs';
import {
  readAndValidateBrowserAppCheckRegistrationPlan,
} from './validate-registration-plan.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_BROWSER_APP_CHECK_REGISTRATION_RECOVERY_CONFIRMATION';
const EXACT_TARGET = `${PROJECT_ID}:${FIREBASE_APP_ID}:claim-bound-recovery`;
const ATTEMPT_MARKER = 'registration-mutation-attempted.json';
const ATTEMPT_CLAIM_RECEIPT = 'global-registration-attempt-claim.json';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${EXACT_TARGET} ./registration-recovery-plan.sh <private-registration-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== EXACT_TARGET) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${EXACT_TARGET} to acknowledge the exact state-only recovery target`);
  }
  validateBrowserAppCheckRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const sourceBundle = privateBrowserAppCheckBundle(process.argv[2], repositoryRoot);
  if (!existsSync(join(sourceBundle, ATTEMPT_MARKER))) {
    throw new Error('Registration recovery requires the consumed local attempt marker');
  }
  readPrivateFile(join(sourceBundle, ATTEMPT_MARKER), 1024 * 1024);
  const { value: registrationMetadata } =
    readBrowserAppCheckRegistrationPlanMetadataForRecovery(join(sourceBundle, 'metadata.json'));
  verifyExactMain(repositoryRoot, registrationMetadata.repository_commit);
  const planPath = join(sourceBundle, 'browser-app-check-registration.tfplan');
  const planJsonPath = join(sourceBundle, 'browser-app-check-registration.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== registrationMetadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== registrationMetadata.terraform_plan_json_sha256
    || !isDeepStrictEqual(
      readAndValidateBrowserAppCheckRegistrationPlan(planJsonPath),
      registrationMetadata.summary,
    )) {
    throw new Error('Consumed registration bundle no longer matches its reviewed saved plan');
  }
  const localClaim = existsSync(join(sourceBundle, ATTEMPT_CLAIM_RECEIPT))
    ? readBrowserAppCheckRegistrationAttemptClaimReceipt(
      join(sourceBundle, ATTEMPT_CLAIM_RECEIPT),
      registrationMetadata,
    ).value
    : null;
  const bundle = createBrowserAppCheckRegistrationRecoveryBundle(
    sourceBundle,
    repositoryRoot,
  );

  const terraformData = createTerraformData(bundle, 'registration-recovery-plan');
  try {
    const session = await verifiedOperatorSession();
    const environment = terraformEnvironment(terraformData, session.accessToken);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-recovery-plan-init',
    });
    const pulled = run('terraform', ['state', 'pull'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-recovery-state-pull',
    });
    const state = inspectBrowserAppCheckRegistrationState(pulled.stdout);
    const rawState = await readBrowserAppCheckStateBytes(session);
    if (sha256(rawState.bytes) !== state.sha256) {
      throw new Error('Terraform and immutable-generation state reads do not match');
    }
    const [keyAttemptClaim, claim] = await Promise.all([
      observePinnedBrowserAppCheckKeyAttemptClaim(
        session,
        KEY_PREREQUISITE_ATTEMPT_CLAIM,
      ),
      observeBrowserAppCheckRegistrationAttemptClaim(session, registrationMetadata),
    ]);
    const [providerAttemptClaim, live] = await Promise.all([
      observeBrowserAppCheckProviderAttemptClaimState(
        session,
        registrationMetadata,
        claim,
      ),
      observeBrowserAppCheckRegistrationRecoveryInventory(session),
    ]);
    if (!isDeepStrictEqual(keyAttemptClaim, registrationMetadata.baseline.key_attempt_claim)
      || (localClaim !== null && !isDeepStrictEqual(claim, localClaim))) {
      throw new Error('Consumed claim receipts no longer match the reviewed registration bundle');
    }
    const providerAttemptClaimState = providerAttemptClaim.state === 'absent'
      ? 'absent'
      : 'present';
    validateBrowserAppCheckRegistrationProviderAttemptBoundary(
      live.provider_status,
      providerAttemptClaimState,
    );
    if (live.provider_status === 'unregistered') {
      validateCurrentBrowserAppCheckKeyState(rawState.metadata, rawState.bytes);
    }
    const liveInventorySha256 = sha256(Buffer.from(canonicalJson(live.inventory), 'utf8'));
    const recovery = buildBrowserAppCheckRegistrationRecoveryMetadata({
      registrationMetadata,
      createdAt: new Date().toISOString(),
      stateGeneration: rawState.metadata.generation,
      state,
      liveProviderStatus: live.provider_status,
      liveInventorySha256,
      keyAttemptClaim,
      registrationClaim: claim,
      providerAttemptClaim,
    });
    writePrivateFile(
      join(bundle, 'observed-global-registration-attempt-claim.json'),
      Buffer.from(canonicalJson(claim), 'utf8'),
      0o400,
    );
    if (providerAttemptClaimState === 'present') {
      writePrivateFile(
        join(bundle, 'observed-global-provider-attempt-claim.json'),
        Buffer.from(canonicalJson(providerAttemptClaim), 'utf8'),
        0o400,
      );
    }
    writePrivateFile(
      join(bundle, 'registration-recovery-metadata.json'),
      Buffer.from(canonicalJson(recovery), 'utf8'),
      0o400,
    );
    verifyExactMain(repositoryRoot, recovery.repository_commit);
    process.stdout.write([
      `Private browser App Check registration recovery bundle: ${bundle}`,
      `Read-only source registration bundle: ${sourceBundle}`,
      `Recovery action: ${recovery.action}`,
      `Authorization: ${browserAppCheckRegistrationRecoveryAuthorization(recovery)}`,
      recovery.action === 'resume-before-patch'
        ? 'The exact saved creation plan may run once because the registration claim exists, the provider-attempt claim is absent, and provider/state remain at the pinned pre-PATCH boundary.'
        : recovery.action === 'reconcile'
        ? 'The exact provider is already managed; only a fresh no-cloud-mutation reconciliation is permitted.'
        : `Only Terraform state ${recovery.action} of the exact live provider is permitted.`,
      recovery.action === 'resume-before-patch'
        ? 'The recovery must atomically acquire the global provider-attempt claim immediately before this first PATCH; a present claim with an absent provider always fails closed.'
        : 'The original registration plan must never be resumed; provider PATCH and delete operations remain forbidden.',
      '',
    ].join('\n'));
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Browser App Check registration recovery planning failed');
    process.exitCode = 1;
  });
}
