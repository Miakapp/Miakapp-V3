import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
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
  browserAppCheckProviderAttemptClaimAbsence,
  createBrowserAppCheckProviderAttemptClaim,
  observeBrowserAppCheckProviderAttemptClaimState,
  observeBrowserAppCheckRegistrationAttemptClaim,
  readBrowserAppCheckProviderAttemptClaimReceipt,
  readBrowserAppCheckRegistrationAttemptClaimReceipt,
} from './registration-claim.mjs';
import {
  KEY_PREREQUISITE_ATTEMPT_CLAIM,
} from './key-contract.mjs';
import {
  browserAppCheckRoot,
  createTerraformData,
  parseJson,
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
  observeBrowserAppCheckRegistrationInventory,
  validateBrowserAppCheckRegistrationInventory,
} from './inventory.mjs';
import {
  BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
  BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID,
  browserAppCheckRegistrationRecoverySourceBundle,
  inspectBrowserAppCheckRegistrationState,
  readBrowserAppCheckRegistrationRecoveryMetadata,
  validateBrowserAppCheckRegistrationRecoveryAuthorization,
  validateBrowserAppCheckRegistrationProviderAttemptBoundary,
} from './registration-recovery.mjs';
import {
  buildBrowserAppCheckRegistrationResult,
  validateBrowserAppCheckRegistrationTerraformOutput,
} from './registration-apply.mjs';
import {
  readBrowserAppCheckRegistrationStateBytes,
  readBrowserAppCheckStateBytes,
  validateCurrentBrowserAppCheckKeyState,
} from './state.mjs';
import {
  readAndValidateBrowserAppCheckRegistrationPlan,
  validateBrowserAppCheckRegistrationReconciliationPlan,
} from './validate-registration-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_BROWSER_APP_CHECK_REGISTRATION_RECOVERY_AUTHORIZATION';
const RECOVERY_MARKER = 'registration-state-recovery-attempted.json';
const PROVIDER_ATTEMPT_CLAIM_RECEIPT = 'global-provider-attempt-claim.json';
const FALLBACK_STATE = 'errored.tfstate';
export const APP_CHECK_REGISTRATION_RECOVERY_RETIRED = true;
process.umask(0o077);

function reject(message) {
  throw new Error(message);
}

function writeDiagnostics(path, result) {
  if (existsSync(path)) return;
  const bytes = Buffer.concat([
    Buffer.from(result.stdout ?? ''),
    Buffer.from(result.stderr ?? ''),
  ]);
  writePrivateFile(
    path,
    bytes.length === 0 ? Buffer.from('Command failed without diagnostics\n') : bytes,
  );
}

function preserveFallbackState(bundle) {
  const source = join(browserAppCheckRoot, FALLBACK_STATE);
  if (!existsSync(source)) return false;
  const entry = lstatSync(source);
  const destination = join(bundle, `recovery-${FALLBACK_STATE}`);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > 1024 * 1024 || existsSync(destination)) {
    reject('Terraform recovery fallback state could not be safely preserved');
  }
  renameSync(source, destination);
  chmodSync(destination, 0o400);
  return true;
}

function writeRecoveryMarker(bundle, metadata) {
  const marker = Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-state-recovery-attempt/1',
    operation: metadata.operation,
    project_id: metadata.project_id,
    action: metadata.action,
    state_sha256: metadata.state_sha256,
    live_inventory_sha256: metadata.live_inventory_sha256,
    registration_claim_sha256: metadata.registration_claim_sha256,
    repository_commit: metadata.repository_commit,
    attempted_at: new Date().toISOString(),
    original_saved_plan_resume_authorized: metadata.original_saved_plan_resume_authorized,
    original_plan_replay_authorized: false,
    provider_registration_patch_authorized: metadata.provider_registration_patch_authorized,
    cloud_resource_mutation_authorized: metadata.cloud_resource_mutation_authorized,
  });
  const path = join(bundle, RECOVERY_MARKER);
  writePrivateFile(path, Buffer.from(canonicalJson(marker), 'utf8'), 0o400);
  for (const target of [path, bundle]) {
    const descriptor = openSync(target, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
}

async function observeRecoveryClaims(
  session,
  registrationMetadata,
  recovery,
  expectedProviderAttemptClaim,
) {
  const [keyClaim, registrationClaim] = await Promise.all([
    observePinnedBrowserAppCheckKeyAttemptClaim(
      session,
      KEY_PREREQUISITE_ATTEMPT_CLAIM,
    ),
    observeBrowserAppCheckRegistrationAttemptClaim(session, registrationMetadata),
  ]);
  if (sha256(Buffer.from(canonicalJson(keyClaim), 'utf8'))
      !== recovery.key_attempt_claim_receipt_sha256
    || registrationClaim.generation !== recovery.registration_claim_generation
    || registrationClaim.sha256 !== recovery.registration_claim_sha256) {
    reject('Global App Check prerequisite claims changed after recovery planning');
  }
  const providerAttemptClaim = await observeBrowserAppCheckProviderAttemptClaimState(
    session,
    registrationMetadata,
    registrationClaim,
  );
  if (!isDeepStrictEqual(providerAttemptClaim, expectedProviderAttemptClaim)) {
    reject('Global App Check provider-attempt claim changed after recovery planning');
  }
  return Object.freeze({ keyClaim, registrationClaim, providerAttemptClaim });
}

async function validatePreRecoveryBoundary(
  session,
  registrationMetadata,
  recovery,
  plannedProviderAttemptClaim,
) {
  const claims = await observeRecoveryClaims(
    session,
    registrationMetadata,
    recovery,
    plannedProviderAttemptClaim,
  );
  const live = await observeBrowserAppCheckRegistrationRecoveryInventory(session);
  validateBrowserAppCheckRegistrationProviderAttemptBoundary(
    live.provider_status,
    claims.providerAttemptClaim.state === 'absent' ? 'absent' : 'present',
  );
  if (live.provider_status !== recovery.live_provider_status
    || sha256(Buffer.from(canonicalJson(live.inventory), 'utf8'))
      !== recovery.live_inventory_sha256) {
    reject('Live App Check provider changed after recovery planning');
  }
  return Object.freeze({ ...claims, live });
}

async function validatePostRecoveryBoundary(
  session,
  registrationMetadata,
  recovery,
  expectedProviderAttemptClaim,
) {
  const claims = await observeRecoveryClaims(
    session,
    registrationMetadata,
    recovery,
    expectedProviderAttemptClaim,
  );
  const inventory = await observeBrowserAppCheckRegistrationInventory(session);
  validateBrowserAppCheckRegistrationProviderAttemptBoundary(
    'registered',
    claims.providerAttemptClaim.state === 'absent' ? 'absent' : 'present',
  );
  const checked = validateBrowserAppCheckRegistrationInventory(inventory);
  if (recovery.live_provider_status === 'registered'
    && sha256(Buffer.from(canonicalJson(checked), 'utf8'))
      !== recovery.live_inventory_sha256) {
    reject('Live registered App Check provider changed during state recovery');
  }
  return Object.freeze({ ...claims, inventory: checked });
}

async function captureRecoveryState(bundle, session) {
  try {
    const state = await readBrowserAppCheckStateBytes(session);
    if (!existsSync(join(bundle, 'recovery-uncertain-state.json'))) {
      writePrivateFile(join(bundle, 'recovery-uncertain-state.json'), state.bytes, 0o400);
      writePrivateFile(
        join(bundle, 'recovery-uncertain-state-metadata.json'),
        Buffer.from(canonicalJson(state.metadata), 'utf8'),
        0o400,
      );
    }
  } catch {
    // A later separately planned recovery can independently read remote state.
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./registration-recovery-apply.sh <private-registration-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateBrowserAppCheckRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBrowserAppCheckBundle(process.argv[2], repositoryRoot);
  const sourceBundle = browserAppCheckRegistrationRecoverySourceBundle(
    bundle,
    repositoryRoot,
  );
  if (existsSync(join(bundle, RECOVERY_MARKER))) {
    reject('This browser App Check registration recovery snapshot was already attempted');
  }
  const { value: recovery } = readBrowserAppCheckRegistrationRecoveryMetadata(
    join(bundle, 'registration-recovery-metadata.json'),
  );
  const { value: registrationMetadata } =
    readBrowserAppCheckRegistrationPlanMetadataForRecovery(join(sourceBundle, 'metadata.json'));
  verifyExactMain(repositoryRoot, recovery.repository_commit);
  if (registrationMetadata.repository_commit !== recovery.repository_commit
    || registrationMetadata.terraform_plan_sha256 !== recovery.registration_plan_sha256
    || registrationMetadata.baseline_sha256 !== recovery.registration_baseline_sha256) {
    reject('Recovery metadata is not bound to the consumed registration plan');
  }
  const originalPlanPath = join(sourceBundle, 'browser-app-check-registration.tfplan');
  const originalPlanJsonPath = join(
    sourceBundle,
    'browser-app-check-registration.tfplan.json',
  );
  const originalPlanBytes = readPrivateFile(originalPlanPath);
  const originalPlanJsonBytes = readPrivateFile(originalPlanJsonPath, 16 * 1024 * 1024);
  if (sha256(originalPlanBytes) !== registrationMetadata.terraform_plan_sha256
    || sha256(originalPlanJsonBytes) !== registrationMetadata.terraform_plan_json_sha256
    || !isDeepStrictEqual(
      readAndValidateBrowserAppCheckRegistrationPlan(originalPlanJsonPath),
      registrationMetadata.summary,
    )) {
    reject('Consumed registration saved plan no longer matches its reviewed metadata');
  }
  const { value: plannedRegistrationClaim } =
    readBrowserAppCheckRegistrationAttemptClaimReceipt(
      join(bundle, 'observed-global-registration-attempt-claim.json'),
      registrationMetadata,
    );
  if (plannedRegistrationClaim.generation !== recovery.registration_claim_generation
    || plannedRegistrationClaim.sha256 !== recovery.registration_claim_sha256) {
    reject('Recovery snapshot is not bound to its observed registration claim');
  }
  const sourceClaimPath = join(sourceBundle, 'global-registration-attempt-claim.json');
  if (existsSync(sourceClaimPath)) {
    const { value: sourceRegistrationClaim } =
      readBrowserAppCheckRegistrationAttemptClaimReceipt(
        sourceClaimPath,
        registrationMetadata,
      );
    if (!isDeepStrictEqual(sourceRegistrationClaim, plannedRegistrationClaim)) {
      reject('Source and recovery registration claim receipts do not match');
    }
  }
  let plannedProviderAttemptClaim;
  if (recovery.provider_attempt_claim_state === 'absent') {
    if (existsSync(join(bundle, 'observed-global-provider-attempt-claim.json'))) {
      reject('Pre-PATCH recovery must not contain a provider-attempt claim receipt');
    }
    plannedProviderAttemptClaim = browserAppCheckProviderAttemptClaimAbsence();
  } else {
    const { value } = readBrowserAppCheckProviderAttemptClaimReceipt(
      join(bundle, 'observed-global-provider-attempt-claim.json'),
      registrationMetadata,
      plannedRegistrationClaim,
    );
    if (value.generation !== recovery.provider_attempt_claim_generation
      || value.sha256 !== recovery.provider_attempt_claim_sha256) {
      reject('Recovery snapshot is not bound to its observed provider-attempt claim');
    }
    plannedProviderAttemptClaim = value;
  }
  const sourceProviderClaimPath = join(sourceBundle, PROVIDER_ATTEMPT_CLAIM_RECEIPT);
  if (existsSync(sourceProviderClaimPath)) {
    const { value: sourceProviderAttemptClaim } =
      readBrowserAppCheckProviderAttemptClaimReceipt(
        sourceProviderClaimPath,
        registrationMetadata,
        plannedRegistrationClaim,
      );
    if (!isDeepStrictEqual(sourceProviderAttemptClaim, plannedProviderAttemptClaim)) {
      reject('Source and recovery provider-attempt claim receipts do not match');
    }
  }
  validateBrowserAppCheckRegistrationProviderAttemptBoundary(
    recovery.live_provider_status,
    recovery.provider_attempt_claim_state,
  );
  validateBrowserAppCheckRegistrationRecoveryAuthorization(
    process.env[APPLY_AUTHORIZATION],
    recovery,
  );

  const terraformData = createTerraformData(bundle, 'registration-recovery-apply');
  let recoveryAttempted = false;
  let registrationApplyReportedSuccess = null;
  let session;
  try {
    session = await verifiedOperatorSession();
    const environment = terraformEnvironment(terraformData, session.accessToken);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-recovery-apply-init',
    });
    if (recovery.action === 'resume-before-patch') {
      const shown = run('terraform', ['show', '-json', originalPlanPath], {
        cwd: browserAppCheckRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'registration-recovery-original-plan-show',
      });
      if (sha256(Buffer.from(shown.stdout))
        !== registrationMetadata.terraform_plan_json_sha256) {
        reject('Original registration plan no longer renders to its reviewed JSON');
      }
    }
    const pulled = run('terraform', ['state', 'pull'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-recovery-pre-state-pull',
    });
    const state = inspectBrowserAppCheckRegistrationState(pulled.stdout);
    const remoteState = await readBrowserAppCheckStateBytes(session);
    if (state.sha256 !== recovery.state_sha256
      || state.serial !== recovery.state_serial
      || state.lineage_sha256 !== recovery.state_lineage_sha256
      || state.config_status !== recovery.state_config_status
      || state.output_profile !== recovery.state_output_profile
      || remoteState.metadata.generation !== recovery.state_generation
      || sha256(remoteState.bytes) !== recovery.state_sha256) {
      reject('Terraform state changed after the reviewed registration recovery snapshot');
    }
    if (recovery.action === 'resume-before-patch') {
      validateCurrentBrowserAppCheckKeyState(remoteState.metadata, remoteState.bytes);
    }
    await validatePreRecoveryBoundary(
      session,
      registrationMetadata,
      recovery,
      plannedProviderAttemptClaim,
    );

    const resumedApplyArguments = [
      'apply', '-input=false', '-auto-approve', '-lock-timeout=5m', '-no-color',
      originalPlanPath,
    ];
    const resumedApplyOptions = {
      cwd: browserAppCheckRoot,
      env: environment,
      allowedStatuses: [0, 1],
      diagnosticDirectory: bundle,
      description: 'registration-recovery-resumed-registration-apply',
    };
    writeRecoveryMarker(bundle, recovery);
    recoveryAttempted = true;
    let providerAttemptClaim = plannedProviderAttemptClaim;
    if (recovery.action === 'resume-before-patch') {
      providerAttemptClaim = await createBrowserAppCheckProviderAttemptClaim(
        session,
        registrationMetadata,
        plannedRegistrationClaim,
      );
      const applied = run('terraform', resumedApplyArguments, resumedApplyOptions);
      writePrivateFile(
        join(bundle, PROVIDER_ATTEMPT_CLAIM_RECEIPT),
        Buffer.from(canonicalJson(providerAttemptClaim), 'utf8'),
        0o400,
      );
      registrationApplyReportedSuccess = applied.status === 0;
      if (!registrationApplyReportedSuccess) {
        writeDiagnostics(join(bundle, 'registration-recovery-resumed-apply-failure.log'), applied);
      }
    } else if (recovery.action === 'import') {
      run('terraform', [
        'import', '-input=false', '-lock-timeout=5m', '-no-color',
        BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
        BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID,
      ], {
        cwd: browserAppCheckRoot,
        env: environment,
        allowedStatuses: [0, 1],
        diagnosticDirectory: bundle,
        description: 'registration-recovery-import',
      });
    } else if (recovery.action === 'reimport') {
      const removed = run('terraform', [
        'state', 'rm', '-lock-timeout=5m',
        BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
      ], {
        cwd: browserAppCheckRoot,
        env: environment,
        allowedStatuses: [0, 1],
        diagnosticDirectory: bundle,
        description: 'registration-recovery-remove-tainted-state',
      });
      if (removed.status !== 0) {
        reject('Tainted provider state removal did not complete');
      }
      run('terraform', [
        'import', '-input=false', '-lock-timeout=5m', '-no-color',
        BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
        BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID,
      ], {
        cwd: browserAppCheckRoot,
        env: environment,
        allowedStatuses: [0, 1],
        diagnosticDirectory: bundle,
        description: 'registration-recovery-reimport',
      });
    }
    if (preserveFallbackState(bundle)) {
      reject('Terraform wrote fallback state during App Check state recovery');
    }

    const adoptedPull = run('terraform', ['state', 'pull'], {
      cwd: browserAppCheckRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: 'registration-recovery-adopted-state-pull',
    });
    const adopted = inspectBrowserAppCheckRegistrationState(adoptedPull.stdout);
    if (adopted.config_status !== 'managed'
      || adopted.lineage_sha256 !== recovery.state_lineage_sha256
      || (recovery.action === 'reconcile'
        ? adopted.sha256 !== recovery.state_sha256
        : adopted.serial <= recovery.state_serial)) {
      reject('Browser App Check registration state adoption did not converge to a managed address');
    }
    await validatePostRecoveryBoundary(
      session,
      registrationMetadata,
      recovery,
      providerAttemptClaim,
    );

    const reconciliationPlanPath = join(bundle, 'browser-app-check-registration-reconciliation.tfplan');
    const planned = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-out=${reconciliationPlanPath}`,
    ], {
      cwd: browserAppCheckRoot,
      env: environment,
      allowedStatuses: [0, 2],
      diagnosticDirectory: bundle,
      description: 'registration-recovery-reconciliation-plan',
    });
    let outputReconciliationApplied = false;
    if (planned.status === 2) {
      chmodSync(reconciliationPlanPath, 0o400);
      const shown = run('terraform', ['show', '-json', reconciliationPlanPath], {
        cwd: browserAppCheckRoot,
        env: environment,
        diagnosticDirectory: bundle,
        description: 'registration-recovery-reconciliation-show',
      });
      validateBrowserAppCheckRegistrationReconciliationPlan(
        parseJson(shown.stdout, 'Browser App Check registration reconciliation plan'),
      );
      const applied = run('terraform', [
        'apply', '-input=false', '-auto-approve', '-lock-timeout=5m', '-no-color',
        reconciliationPlanPath,
      ], {
        cwd: browserAppCheckRoot,
        env: environment,
        allowedStatuses: [0, 1],
        diagnosticDirectory: bundle,
        description: 'registration-recovery-output-only-apply',
      });
      outputReconciliationApplied = applied.status === 0;
    }
    if (preserveFallbackState(bundle)) {
      reject('Terraform wrote fallback state during App Check output reconciliation');
    }

    const convergence = run('terraform', [
      'plan', '-input=false', '-lock-timeout=5m', '-no-color', '-detailed-exitcode',
    ], {
      cwd: browserAppCheckRoot,
      env: environment,
      allowedStatuses: [0, 1, 2],
      diagnosticDirectory: bundle,
      description: 'registration-recovery-convergence',
    });
    if (convergence.status !== 0) {
      reject('Browser App Check registration state recovery did not converge');
    }

    const evidenceSession = await verifiedOperatorSession();
    const [finalBoundary, terraformState] = await Promise.all([
      validatePostRecoveryBoundary(
        evidenceSession,
        registrationMetadata,
        recovery,
        providerAttemptClaim,
      ),
      // The exact immutable provider-attempt claim must survive through final evidence.
      readBrowserAppCheckRegistrationStateBytes(evidenceSession),
    ]);
    const finalInventory = finalBoundary.inventory;
    const finalClaim = finalBoundary.registrationClaim;
    const evidenceEnvironment = terraformEnvironment(terraformData, evidenceSession.accessToken);
    const renderedOutput = run('terraform', [
      'output', '-json', 'staging_browser_app_check_key',
    ], {
      cwd: browserAppCheckRoot,
      env: evidenceEnvironment,
      diagnosticDirectory: bundle,
      description: 'registration-recovery-output',
    });
    const output = validateBrowserAppCheckRegistrationTerraformOutput(
      parseJson(renderedOutput.stdout, 'Browser App Check registration recovery output'),
    );
    const result = buildBrowserAppCheckRegistrationResult({
      metadata: registrationMetadata,
      attemptClaim: finalClaim,
      providerAttemptClaim: finalBoundary.providerAttemptClaim,
      output,
      inventory: finalInventory,
      terraformState,
      applyReportedSuccess: recovery.action === 'resume-before-patch'
        ? registrationApplyReportedSuccess
        : existsSync(join(sourceBundle, 'registration-apply-failure.log')) ? false : null,
      stateRecovery: Object.freeze({
        action: recovery.action,
        prior_state_sha256: recovery.state_sha256,
        prior_state_serial: recovery.state_serial,
        live_inventory_sha256: recovery.live_inventory_sha256,
        output_only_reconciliation_applied: outputReconciliationApplied,
        cloud_resource_mutations: recovery.action === 'resume-before-patch' ? 1 : 0,
        provider_registrations: recovery.action === 'resume-before-patch' ? 1 : 0,
        original_saved_plan_resumed: recovery.action === 'resume-before-patch',
        original_plan_replayed: false,
      }),
    });
    const resultPath = join(bundle, 'registration-recovery-result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    verifyExactMain(repositoryRoot, recovery.repository_commit);
    process.stdout.write([
      `Browser App Check registration state recovery converged: ${recovery.action}.`,
      `Private sanitized result: ${resultPath}`,
      recovery.action === 'resume-before-patch'
        ? 'The claim-bound saved plan performed the first provider registration attempt; no key, enforcement or other cloud resource changed.'
        : 'The original plan was not resumed and no provider, key, enforcement or other cloud resource was mutated.',
      '',
    ].join('\n'));
  } catch (error) {
    if (recoveryAttempted) {
      try {
        preserveFallbackState(bundle);
      } catch {
        // Preserve the primary state-only recovery message.
      }
      if (session !== undefined) await captureRecoveryState(bundle, session);
      throw new Error([
        error instanceof Error ? error.message : 'Browser App Check registration state recovery failed.',
        'Do not retry this recovery snapshot or invoke the original registration driver. Render a fresh child recovery snapshot from the preserved source bundle, claim, live provider and remote state.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (APP_CHECK_REGISTRATION_RECOVERY_RETIRED) {
    console.error(
      'The browser App Check provider registration converged without recovery; this recovery apply path is permanently retired.',
    );
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Browser App Check registration recovery failed');
      process.exitCode = 1;
    });
  }
}
