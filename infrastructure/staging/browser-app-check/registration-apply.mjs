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
  DEFAULT_RISK_SCORE,
  FIREBASE_APP_CONFIG_NAME,
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  HOSTING_DOMAIN,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_DISPLAY_NAME,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  privateBrowserAppCheckBundle,
  readPrivateFile,
  sha256,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  KEY_PREREQUISITE_ATTEMPT_CLAIM,
} from './key-contract.mjs';
import {
  APP_CHECK_REGISTRATION_OPERATION,
  APP_CHECK_REGISTRATION_TTL,
  APP_CHECK_SITE_KEY_SHA256,
  RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
  readBrowserAppCheckRegistrationPlanMetadata,
  validateBrowserAppCheckRegistrationAuthorization,
} from './registration-contract.mjs';
import {
  observePinnedBrowserAppCheckKeyAttemptClaim,
} from './attempt-claim.mjs';
import {
  createBrowserAppCheckProviderAttemptClaim,
  createBrowserAppCheckRegistrationAttemptClaim,
  observeBrowserAppCheckProviderAttemptClaim,
  observeBrowserAppCheckProviderAttemptClaimAbsent,
  observeBrowserAppCheckProviderAttemptClaimState,
  observeBrowserAppCheckRegistrationAttemptClaim,
  validateBrowserAppCheckProviderAttemptClaimReceipt,
  validateBrowserAppCheckRegistrationAttemptClaimReceipt,
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
  observeBrowserAppCheckRegistrationInventory,
  validateBrowserAppCheckRegistrationInventory,
  validateCurrentBrowserAppCheckKeyInventory,
} from './inventory.mjs';
import {
  observeBrowserAppCheckRegistrationBaseline,
} from './registration-plan.mjs';
import {
  observeCurrentBrowserAppCheckKeyState,
  readBrowserAppCheckRegistrationStateBytes,
  readBrowserAppCheckStateBytes,
  validateBrowserAppCheckRegistrationState,
} from './state.mjs';
import {
  browserAppCheckRegistrationOutput,
  readAndValidateBrowserAppCheckRegistrationPlan,
} from './validate-registration-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_BROWSER_APP_CHECK_REGISTRATION_APPLY_AUTHORIZATION';
const ATTEMPT_MARKER = 'registration-mutation-attempted.json';
const ATTEMPT_CLAIM_RECEIPT = 'global-registration-attempt-claim.json';
const PROVIDER_ATTEMPT_CLAIM_RECEIPT = 'global-provider-attempt-claim.json';
const FALLBACK_STATE = 'errored.tfstate';
export const APP_CHECK_REGISTRATION_CONSUMED = true;
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

export function validateBrowserAppCheckRegistrationTerraformOutput(value) {
  const expected = browserAppCheckRegistrationOutput();
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || !isDeepStrictEqual(value, expected)) {
    reject('Browser App Check registration Terraform output does not match the reviewed value');
  }
  return Object.freeze(value);
}

export function buildBrowserAppCheckRegistrationResult({
  metadata,
  attemptClaim,
  providerAttemptClaim,
  output,
  inventory,
  terraformState,
  applyReportedSuccess = true,
  stateRecovery = null,
}) {
  const checkedClaim = validateBrowserAppCheckRegistrationAttemptClaimReceipt(
    attemptClaim,
    metadata,
  );
  const checkedProviderAttemptClaim = validateBrowserAppCheckProviderAttemptClaimReceipt(
    providerAttemptClaim,
    metadata,
    checkedClaim,
  );
  const checkedOutput = validateBrowserAppCheckRegistrationTerraformOutput(output);
  const checkedInventory = validateBrowserAppCheckRegistrationInventory(inventory);
  const checkedState = validateBrowserAppCheckRegistrationState(
    terraformState.metadata,
    terraformState.bytes,
  );
  if (![true, false, null].includes(applyReportedSuccess)) {
    reject('Browser App Check registration apply status is invalid');
  }
  if (stateRecovery !== null && (typeof stateRecovery !== 'object'
    || Array.isArray(stateRecovery)
    || !isDeepStrictEqual(Object.keys(stateRecovery).sort(), [
      'action', 'prior_state_sha256', 'prior_state_serial', 'live_inventory_sha256',
      'output_only_reconciliation_applied', 'cloud_resource_mutations',
      'provider_registrations', 'original_saved_plan_resumed', 'original_plan_replayed',
    ].sort())
    || !['resume-before-patch', 'import', 'reimport', 'reconcile'].includes(stateRecovery.action)
    || !/^[0-9a-f]{64}$/u.test(stateRecovery.prior_state_sha256 ?? '')
    || !Number.isSafeInteger(stateRecovery.prior_state_serial)
    || !/^[0-9a-f]{64}$/u.test(stateRecovery.live_inventory_sha256 ?? '')
    || typeof stateRecovery.output_only_reconciliation_applied !== 'boolean'
    || stateRecovery.cloud_resource_mutations
      !== (stateRecovery.action === 'resume-before-patch' ? 1 : 0)
    || stateRecovery.provider_registrations
      !== (stateRecovery.action === 'resume-before-patch' ? 1 : 0)
    || stateRecovery.original_saved_plan_resumed
      !== (stateRecovery.action === 'resume-before-patch')
    || stateRecovery.original_plan_replayed !== false)) {
    reject('Browser App Check registration state recovery evidence is invalid');
  }
  const key = checkedInventory.recaptcha_keys[0];
  if (checkedOutput.firebase_app_id !== checkedInventory.firebase_web_app.app_id
    || checkedOutput.firebase_app_display_name !== checkedInventory.firebase_web_app.display_name
    || checkedOutput.recaptcha_display_name !== key.display_name
    || checkedOutput.recaptcha_integration !== key.integration_type
    || !isDeepStrictEqual(checkedOutput.recaptcha_allowed_domains, key.allowed_domains)
    || checkedOutput.app_check_config_name !== checkedInventory.app_check.name
    || checkedOutput.app_check_token_ttl !== checkedInventory.app_check.token_ttl
    || checkedOutput.app_check_site_key_sha256 !== checkedInventory.app_check.site_key_sha256
    || checkedInventory.app_check.site_key_sha256 !== APP_CHECK_SITE_KEY_SHA256
    || checkedInventory.app_check.recaptcha_key_resource_name_sha256 !== key.name_sha256
    || checkedInventory.app_check.minimum_valid_score !== DEFAULT_RISK_SCORE
    || checkedState.app_check_config_name !== checkedInventory.app_check.name
    || checkedState.app_check_token_ttl !== checkedInventory.app_check.token_ttl
    || checkedState.app_check_site_key_sha256 !== APP_CHECK_SITE_KEY_SHA256
    || checkedState.recaptcha_key_name_sha256 !== key.name_sha256) {
    reject('Terraform state, output and authoritative provider inventory do not match');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-result/1',
    operation: APP_CHECK_REGISTRATION_OPERATION,
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    terraform_apply_reported_success: applyReportedSuccess,
    state_recovery: stateRecovery === null ? null : Object.freeze(stateRecovery),
    global_key_attempt_claim: KEY_PREREQUISITE_ATTEMPT_CLAIM,
    global_registration_attempt_claim: checkedClaim,
    global_provider_attempt_claim: checkedProviderAttemptClaim,
    final_inventory_sha256: sha256(Buffer.from(canonicalJson(checkedInventory), 'utf8')),
    terraform_state: checkedState,
    recaptcha_api_enabled: true,
    authoritative_recaptcha_keys: 1,
    cloud_asset_recaptcha_keys: 1,
    recaptcha_key: Object.freeze({
      name_sha256: key.name_sha256,
      display_name: key.display_name,
      labels: key.labels,
      create_time: key.create_time,
      integration_type: key.integration_type,
      allow_all_domains: key.allow_all_domains,
      allowed_domains: key.allowed_domains,
      allowed_domain_includes_subdomains: true,
      allow_amp_traffic: key.allow_amp_traffic,
      testing_options_configured: key.testing_options_configured,
      waf_settings_configured: key.waf_settings_configured,
    }),
    app_check_provider: Object.freeze({
      name: FIREBASE_APP_CONFIG_NAME,
      firebase_app_id: FIREBASE_APP_ID,
      token_ttl: APP_CHECK_REGISTRATION_TTL,
      minimum_valid_score: DEFAULT_RISK_SCORE,
      site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
      registered: true,
      deletion_api_available: false,
    }),
    app_check_enforcement_records: 0,
    debug_tokens: 0,
    public_site_key_committed: false,
    raw_provider_config_committed: false,
    legacy_secret_retrievals_by_driver: 0,
    public_endpoints_created: 0,
    fixed_cost_services: 0,
    coordination_objects_created: 3,
    browser_requests_initiated_by_driver: 0,
    assessments_initiated_by_driver: 0,
  });
}

function preserveFallbackState(bundle) {
  const source = join(browserAppCheckRoot, FALLBACK_STATE);
  if (!existsSync(source)) return false;
  const entry = lstatSync(source);
  const destination = join(bundle, FALLBACK_STATE);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0
    || entry.size > 1024 * 1024 || existsSync(destination)) {
    reject('Terraform fallback state could not be safely preserved');
  }
  renameSync(source, destination);
  chmodSync(destination, 0o400);
  return true;
}

function writeMutationAttemptMarker(bundle, metadata) {
  const marker = Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-attempt/1',
    operation: APP_CHECK_REGISTRATION_OPERATION,
    project_id: PROJECT_ID,
    firebase_app_id: FIREBASE_APP_ID,
    app_check_config_name: FIREBASE_APP_CONFIG_NAME,
    recaptcha_key_resource_name_sha256: RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
    app_check_site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
    app_check_token_ttl: APP_CHECK_REGISTRATION_TTL,
    app_check_minimum_valid_score: DEFAULT_RISK_SCORE,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    attempted_at: new Date().toISOString(),
    retry_authorized: false,
    deletion_authorized: false,
  });
  const markerPath = join(bundle, ATTEMPT_MARKER);
  writePrivateFile(markerPath, Buffer.from(canonicalJson(marker), 'utf8'), 0o400);
  for (const path of [markerPath, bundle]) {
    const descriptor = openSync(path, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
}

async function observePrerequisitesAfterClaim(session, metadata) {
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
      observeBrowserAppCheckRegistrationAttemptClaim(session, metadata),
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

async function captureUncertainOutcome(bundle, metadata) {
  let session;
  try {
    session = await verifiedOperatorSession();
  } catch {
    return;
  }
  let registrationClaim;
  try {
    registrationClaim = await observeBrowserAppCheckRegistrationAttemptClaim(session, metadata);
    const path = join(bundle, 'uncertain-global-registration-attempt-claim.json');
    if (!existsSync(path)) {
      writePrivateFile(path, Buffer.from(canonicalJson(registrationClaim), 'utf8'), 0o400);
    }
  } catch {
    // Preserve every independently available observation.
  }
  if (registrationClaim !== undefined) {
    try {
      const providerAttemptClaim = await observeBrowserAppCheckProviderAttemptClaimState(
        session,
        metadata,
        registrationClaim,
      );
      const path = join(bundle, 'uncertain-global-provider-attempt-claim.json');
      if (!existsSync(path)) {
        writePrivateFile(
          path,
          Buffer.from(canonicalJson(providerAttemptClaim), 'utf8'),
          0o400,
        );
      }
    } catch {
      // Live inventory and state still preserve the safest recovery boundary available.
    }
  }
  for (const [name, observe] of [
    ['uncertain-registered-inventory.json', observeBrowserAppCheckRegistrationInventory],
    ['uncertain-unregistered-inventory.json', observeBrowserAppCheckKeyInventory],
  ]) {
    try {
      const value = await observe(session);
      const path = join(bundle, name);
      if (!existsSync(path)) writePrivateFile(path, Buffer.from(canonicalJson(value), 'utf8'), 0o400);
    } catch {
      // Exactly one inventory profile can match; a foreign configuration matches neither.
    }
  }
  try {
    const state = await readBrowserAppCheckStateBytes(session);
    const statePath = join(bundle, 'uncertain-terraform-state.json');
    const metadataPath = join(bundle, 'uncertain-terraform-state-metadata.json');
    if (!existsSync(statePath)) writePrivateFile(statePath, state.bytes, 0o400);
    if (!existsSync(metadataPath)) {
      writePrivateFile(metadataPath, Buffer.from(canonicalJson(state.metadata), 'utf8'), 0o400);
    }
  } catch {
    // Live inventory may still be enough to choose a separately authorized recovery.
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./registration-apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateBrowserAppCheckRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBrowserAppCheckBundle(process.argv[2], repositoryRoot);
  if (existsSync(join(bundle, ATTEMPT_MARKER))) {
    reject('This browser App Check registration bundle has attempted a mutation and must never be retried');
  }

  const metadataPath = join(bundle, 'metadata.json');
  const { value: metadata } = readBrowserAppCheckRegistrationPlanMetadata(metadataPath);
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  const planPath = join(bundle, 'browser-app-check-registration.tfplan');
  const planJsonPath = join(bundle, 'browser-app-check-registration.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    reject('Browser App Check registration bundle digest verification failed');
  }
  validateBrowserAppCheckRegistrationAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
    metadata.baseline_sha256,
  );
  const summary = readAndValidateBrowserAppCheckRegistrationPlan(planJsonPath);
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    reject('Browser App Check registration metadata summary no longer matches the reviewed plan');
  }

  const terraformData = createTerraformData(bundle, 'registration-apply');
  let mutationAttempted = false;
  try {
    const inspectionSession = await verifiedOperatorSession();
    const inspectionEnvironment = terraformEnvironment(terraformData, inspectionSession.accessToken);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'registration-apply-init',
    });
    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: browserAppCheckRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'registration-apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      reject('Terraform browser App Check registration plan no longer renders to the reviewed JSON');
    }

    const mutationSession = await verifiedOperatorSession();
    const liveBaseline = await observeBrowserAppCheckRegistrationBaseline(mutationSession);
    const { value: freshMetadata } = readBrowserAppCheckRegistrationPlanMetadata(metadataPath);
    verifyExactMain(repositoryRoot, freshMetadata.repository_commit);
    validateBrowserAppCheckRegistrationAuthorization(
      process.env[APPLY_AUTHORIZATION],
      planBytes,
      freshMetadata.repository_commit,
      freshMetadata.baseline_sha256,
    );
    if (!isDeepStrictEqual(freshMetadata, metadata)
      || !isDeepStrictEqual(liveBaseline, freshMetadata.baseline)
      || sha256(Buffer.from(canonicalJson(liveBaseline), 'utf8')) !== freshMetadata.baseline_sha256) {
      reject('Live browser App Check registration prerequisites changed after the saved plan was rendered');
    }

    writeMutationAttemptMarker(bundle, freshMetadata);
    mutationAttempted = true;
    const attemptClaim = await createBrowserAppCheckRegistrationAttemptClaim(
      mutationSession,
      freshMetadata,
    );
    writePrivateFile(
      join(bundle, ATTEMPT_CLAIM_RECEIPT),
      Buffer.from(canonicalJson(attemptClaim), 'utf8'),
      0o400,
    );
    const afterClaim = await observePrerequisitesAfterClaim(mutationSession, freshMetadata);
    if (!isDeepStrictEqual(afterClaim.key_attempt_claim, liveBaseline.key_attempt_claim)
      || !isDeepStrictEqual(afterClaim.inventory, liveBaseline.inventory)
      || !isDeepStrictEqual(afterClaim.terraform_state, liveBaseline.terraform_state)
      || !isDeepStrictEqual(
        afterClaim.provider_attempt_claim,
        liveBaseline.provider_attempt_claim,
      )
      || !isDeepStrictEqual(afterClaim.registration_attempt_claim, attemptClaim)) {
      reject('Browser App Check registration prerequisites changed while acquiring the global claim');
    }

    const mutationEnvironment = terraformEnvironment(terraformData, mutationSession.accessToken);
    const applyArguments = [
      'apply', '-input=false', '-auto-approve', '-lock-timeout=5m', '-no-color', planPath,
    ];
    const applyOptions = {
      cwd: browserAppCheckRoot,
      env: mutationEnvironment,
      allowedStatuses: [0, 1],
      diagnosticDirectory: bundle,
      description: 'registration-terraform-apply',
    };
    const providerAttemptClaim = await createBrowserAppCheckProviderAttemptClaim(
      mutationSession,
      freshMetadata,
      attemptClaim,
    );
    const applied = run('terraform', applyArguments, applyOptions);
    writePrivateFile(
      join(bundle, PROVIDER_ATTEMPT_CLAIM_RECEIPT),
      Buffer.from(canonicalJson(providerAttemptClaim), 'utf8'),
      0o400,
    );
    const applyReportedSuccess = applied.status === 0;
    if (!applyReportedSuccess) {
      writeDiagnostics(join(bundle, 'registration-apply-failure.log'), applied);
    }
    if (preserveFallbackState(bundle)) {
      reject('Terraform wrote fallback state after the App Check registration mutation');
    }

    const convergence = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
    ], {
      cwd: browserAppCheckRoot,
      env: mutationEnvironment,
      allowedStatuses: [0, 1, 2],
      diagnosticDirectory: bundle,
      description: 'registration-terraform-convergence',
    });
    if (convergence.status !== 0) {
      writeDiagnostics(join(bundle, 'registration-convergence-failure.log'), convergence);
      reject(applyReportedSuccess
        ? 'Browser App Check registration applied but the follow-up plan is not empty'
        : 'Browser App Check registration outcome is ambiguous and requires state recovery');
    }

    const evidenceSession = await verifiedOperatorSession();
    const [inventory, terraformState, finalAttemptClaim] = await Promise.all([
      observeBrowserAppCheckRegistrationInventory(evidenceSession),
      readBrowserAppCheckRegistrationStateBytes(evidenceSession),
      observeBrowserAppCheckRegistrationAttemptClaim(evidenceSession, metadata),
    ]);
    if (!isDeepStrictEqual(finalAttemptClaim, attemptClaim)) {
      reject('Global browser App Check registration claim changed during apply');
    }
    const finalProviderAttemptClaim = await observeBrowserAppCheckProviderAttemptClaim(
      evidenceSession,
      metadata,
      finalAttemptClaim,
    );
    if (!isDeepStrictEqual(finalProviderAttemptClaim, providerAttemptClaim)) {
      reject('Global browser App Check provider attempt claim changed during apply');
    }
    const evidenceEnvironment = terraformEnvironment(terraformData, evidenceSession.accessToken);
    const renderedOutput = run('terraform', [
      'output', '-json', 'staging_browser_app_check_key',
    ], {
      cwd: browserAppCheckRoot,
      env: evidenceEnvironment,
      diagnosticDirectory: bundle,
      description: 'registration-terraform-output',
    });
    let output;
    try {
      output = JSON.parse(Buffer.from(renderedOutput.stdout).toString('utf8'));
    } catch {
      return reject('Browser App Check registration Terraform output is invalid JSON');
    }
    const result = buildBrowserAppCheckRegistrationResult({
      metadata,
      attemptClaim,
      providerAttemptClaim: finalProviderAttemptClaim,
      output,
      inventory,
      terraformState,
      applyReportedSuccess,
    });
    const resultPath = join(bundle, 'registration-result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyReportedSuccess
        ? 'The exact non-deletable browser App Check provider registration converged.'
        : 'Terraform reported an error, but the exact provider registration and state independently converged.',
      `Private sanitized result: ${resultPath}`,
      `Provider: ${FIREBASE_APP_DISPLAY_NAME}; key domain: ${HOSTING_DOMAIN}; key display name: ${RECAPTCHA_DISPLAY_NAME}.`,
      'Enforcement, browser traffic, assessments, debug tokens, public ingress and fixed-cost services remain absent.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      try {
        preserveFallbackState(bundle);
      } catch {
        // Preserve the primary no-replay recovery instruction.
      }
      await captureUncertainOutcome(bundle, metadata);
      throw new Error([
        error instanceof Error ? error.message : 'Browser App Check registration failed.',
        'The private claim, fallback state, live provider inventory and remote state were preserved when available.',
        'Do not retry this saved plan. Use only the separately authorized registration state-recovery path; a wrong or absent live provider after the consumed claim must fail closed.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (APP_CHECK_REGISTRATION_CONSUMED) {
    console.error(
      'The browser App Check provider registration has already converged; this apply path is permanently retired.',
    );
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Browser App Check registration failed');
      process.exitCode = 1;
    });
  }
}
