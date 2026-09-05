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
  readBrowserAppCheckKeyPlanMetadata,
  validateBrowserAppCheckKeyAuthorization,
} from './key-contract.mjs';
import {
  createBrowserAppCheckKeyAttemptClaim,
  observeBrowserAppCheckKeyAttemptClaim,
  observeBrowserAppCheckKeyAttemptClaimAbsent,
  validateBrowserAppCheckKeyAttemptClaimReceipt,
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
  observeBrowserAppCheckKeyInventory,
  observeRecaptchaKeyRecords,
  validateBrowserAppCheckInventory,
  validateBrowserAppCheckKeyInventory,
} from './inventory.mjs';
import {
  observeBrowserAppCheckApiState,
  readBrowserAppCheckKeyStateBytes,
  validateBrowserAppCheckKeyState,
} from './state.mjs';
import {
  browserAppCheckKeyOutput,
  readAndValidateBrowserAppCheckKeyPlan,
} from './validate-key-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_BROWSER_APP_CHECK_KEY_APPLY_AUTHORIZATION';
const ATTEMPT_MARKER = 'key-mutation-attempted.json';
const ATTEMPT_CLAIM_RECEIPT = 'global-key-attempt-claim.json';
const FALLBACK_STATE = 'errored.tfstate';
export const KEY_PREREQUISITE_CONSUMED = true;
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

export function validateBrowserAppCheckKeyTerraformOutput(value) {
  const expected = browserAppCheckKeyOutput();
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || !isDeepStrictEqual(value, expected)) {
    reject('Browser App Check key Terraform output does not match the reviewed value');
  }
  return Object.freeze(value);
}

export function buildBrowserAppCheckKeyResult({
  metadata,
  attemptClaim,
  output,
  inventory,
  terraformState,
}) {
  const checkedAttemptClaim = validateBrowserAppCheckKeyAttemptClaimReceipt(
    attemptClaim,
    metadata,
  );
  const checkedOutput = validateBrowserAppCheckKeyTerraformOutput(output);
  const checkedInventory = validateBrowserAppCheckKeyInventory(inventory);
  const checkedState = validateBrowserAppCheckKeyState(
    terraformState.metadata,
    terraformState.bytes,
  );
  const key = checkedInventory.recaptcha_keys[0];
  if (checkedOutput.firebase_app_id !== checkedInventory.firebase_web_app.app_id
    || checkedOutput.firebase_app_display_name !== checkedInventory.firebase_web_app.display_name
    || checkedOutput.recaptcha_display_name !== key.display_name
    || checkedOutput.recaptcha_integration !== key.integration_type
    || !isDeepStrictEqual(checkedOutput.recaptcha_allowed_domains, key.allowed_domains)
    || checkedOutput.recaptcha_allow_all !== key.allow_all_domains
    || checkedOutput.recaptcha_allow_amp !== key.allow_amp_traffic
    || checkedOutput.recaptcha_testing !== key.testing_options_configured
    || checkedOutput.recaptcha_waf !== key.waf_settings_configured
    || checkedState.recaptcha_key_name !== key.name
    || checkedState.recaptcha_key_name_sha256 !== key.name_sha256) {
    reject('Terraform state, output and authoritative reCAPTCHA key inventory do not match');
  }
  const {
    recaptcha_key_name: ignoredKeyName,
    ...sanitizedState
  } = checkedState;
  void ignoredKeyName;
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-key-result/1',
    operation: 'create-domain-restricted-score-key',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    global_attempt_claim: checkedAttemptClaim,
    final_inventory_sha256: sha256(Buffer.from(canonicalJson(checkedInventory), 'utf8')),
    terraform_state: Object.freeze(sanitizedState),
    recaptcha_api_enabled: true,
    authoritative_recaptcha_keys: 1,
    cloud_asset_recaptcha_keys: checkedInventory.recaptcha_asset_keys.length,
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
    app_check_registered: false,
    app_check_enforcement_records: 0,
    debug_tokens: 0,
    public_site_key_committed: false,
    legacy_secret_retrievals_by_driver: 0,
    public_endpoints_created: 0,
    fixed_cost_services: 0,
    coordination_objects_created: 1,
    browser_requests_initiated_by_driver: 0,
    assessments_initiated_by_driver: 0,
  });
}

async function captureUncertainInventory(bundle) {
  let session;
  try {
    session = await verifiedOperatorSession();
  } catch {
    return;
  }
  for (const [name, observe] of [
    ['uncertain-key-records.json', observeRecaptchaKeyRecords],
    ['uncertain-inventory.json', observeBrowserAppCheckInventory],
  ]) {
    try {
      const value = await observe(session);
      const path = join(bundle, name);
      if (!existsSync(path)) {
        writePrivateFile(path, Buffer.from(canonicalJson(value), 'utf8'), 0o400);
      }
    } catch {
      // Keep any independently successful recovery observation.
    }
  }
}

async function captureUncertainAttemptClaim(bundle, metadata) {
  try {
    const session = await verifiedOperatorSession();
    const receipt = await observeBrowserAppCheckKeyAttemptClaim(session, metadata);
    const path = join(bundle, 'uncertain-global-key-attempt-claim.json');
    if (!existsSync(path)) {
      writePrivateFile(path, Buffer.from(canonicalJson(receipt), 'utf8'), 0o400);
    }
  } catch {
    // The direct key inventory remains independently recoverable.
  }
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
    schema: 'miakapp.staging-browser-app-check-key-attempt/1',
    operation: 'create-domain-restricted-score-key',
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    attempted_at: new Date().toISOString(),
    retry_authorized: false,
    deletion_authorized: false,
  });
  const markerPath = join(bundle, ATTEMPT_MARKER);
  writePrivateFile(
    markerPath,
    Buffer.from(canonicalJson(marker), 'utf8'),
    0o400,
  );
  for (const path of [markerPath, bundle]) {
    const descriptor = openSync(path, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./key-apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateBrowserAppCheckRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBrowserAppCheckBundle(process.argv[2], repositoryRoot);
  if (existsSync(join(bundle, ATTEMPT_MARKER))) {
    reject('This browser App Check key bundle has attempted a mutation and must never be retried');
  }

  const metadataPath = join(bundle, 'metadata.json');
  const { value: metadata } = readBrowserAppCheckKeyPlanMetadata(metadataPath);
  verifyExactMain(repositoryRoot, metadata.repository_commit);

  const planPath = join(bundle, 'browser-app-check-key.tfplan');
  const planJsonPath = join(bundle, 'browser-app-check-key.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    reject('Browser App Check key bundle digest verification failed');
  }
  validateBrowserAppCheckKeyAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
    metadata.baseline_sha256,
  );
  const summary = readAndValidateBrowserAppCheckKeyPlan(planJsonPath);
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    reject('Browser App Check key metadata summary no longer matches the reviewed plan');
  }

  const terraformData = createTerraformData(bundle, 'key-apply');
  let mutationAttempted = false;
  try {
    const inspectionSession = await verifiedOperatorSession();
    const inspectionEnvironment = terraformEnvironment(
      terraformData,
      inspectionSession.accessToken,
    );
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: browserAppCheckRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'key-apply-init',
    });
    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: browserAppCheckRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'key-apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      reject('Terraform browser App Check key plan no longer renders to the reviewed JSON');
    }

    const mutationSession = await verifiedOperatorSession();
    const liveBaseline = await observeBaseline(mutationSession);
    const { value: freshMetadata } = readBrowserAppCheckKeyPlanMetadata(metadataPath);
    verifyExactMain(repositoryRoot, freshMetadata.repository_commit);
    validateBrowserAppCheckKeyAuthorization(
      process.env[APPLY_AUTHORIZATION],
      planBytes,
      freshMetadata.repository_commit,
      freshMetadata.baseline_sha256,
    );
    if (!isDeepStrictEqual(freshMetadata, metadata)
      || !isDeepStrictEqual(liveBaseline, freshMetadata.baseline)
      || sha256(Buffer.from(canonicalJson(liveBaseline), 'utf8')) !== freshMetadata.baseline_sha256) {
      reject('Live browser App Check key prerequisites changed after the saved plan was rendered');
    }

    writeMutationAttemptMarker(bundle, freshMetadata);
    mutationAttempted = true;
    const attemptClaim = await createBrowserAppCheckKeyAttemptClaim(
      mutationSession,
      freshMetadata,
    );
    writePrivateFile(
      join(bundle, ATTEMPT_CLAIM_RECEIPT),
      Buffer.from(canonicalJson(attemptClaim), 'utf8'),
      0o400,
    );
    const mutationEnvironment = terraformEnvironment(
      terraformData,
      mutationSession.accessToken,
    );
    const applied = run('terraform', [
      'apply', '-input=false', '-auto-approve', '-lock-timeout=5m', '-no-color', planPath,
    ], {
      cwd: browserAppCheckRoot,
      env: mutationEnvironment,
      allowedStatuses: [0, 1],
      diagnosticDirectory: bundle,
      description: 'key-terraform-apply',
    });
    if (preserveFallbackState(bundle)) {
      reject('Terraform wrote fallback state after the key mutation');
    }
    if (applied.status !== 0) {
      writeDiagnostics(join(bundle, 'key-apply-failure.log'), applied);
      reject('Browser App Check key apply returned an error after mutation was attempted');
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
      description: 'key-terraform-convergence',
    });
    if (convergence.status !== 0) {
      writeDiagnostics(join(bundle, 'key-convergence-failure.log'), convergence);
      reject('Browser App Check key apply completed but the follow-up plan is not empty');
    }

    const evidenceSession = await verifiedOperatorSession();
    const [inventory, terraformState] = await Promise.all([
      observeBrowserAppCheckKeyInventory(evidenceSession),
      readBrowserAppCheckKeyStateBytes(evidenceSession),
    ]);
    const evidenceEnvironment = terraformEnvironment(
      terraformData,
      evidenceSession.accessToken,
    );
    const renderedOutput = run('terraform', [
      'output', '-json', 'staging_browser_app_check_key',
    ], {
      cwd: browserAppCheckRoot,
      env: evidenceEnvironment,
      diagnosticDirectory: bundle,
      description: 'key-terraform-output',
    });
    let output;
    try {
      output = JSON.parse(Buffer.from(renderedOutput.stdout).toString('utf8'));
    } catch {
      return reject('Browser App Check key Terraform output is invalid JSON');
    }
    const result = buildBrowserAppCheckKeyResult({
      metadata,
      attemptClaim,
      output,
      inventory,
      terraformState,
    });
    const resultPath = join(bundle, 'result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      'The exact domain-restricted reCAPTCHA Enterprise score key was created and converged.',
      `Private result: ${resultPath}`,
      'One private atomic attempt claim prevents every independent bundle from repeating the creation.',
      `Authoritative inventory: one key for ${HOSTING_DOMAIN}; App Check registration and enforcement remain absent.`,
      `Key display name: ${RECAPTCHA_DISPLAY_NAME}; the public site key and retrievable legacy secret were not emitted.`,
      'No browser request, assessment, debug token, public endpoint or fixed-cost service was created by this driver.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      try {
        preserveFallbackState(bundle);
      } catch {
        // The primary recovery message must still forbid replay.
      }
      await captureUncertainAttemptClaim(bundle, metadata);
      await captureUncertainInventory(bundle);
      throw new Error([
        error instanceof Error ? error.message : 'Browser App Check key apply failed.',
        'The private bundle, fallback state and post-attempt inventory were preserved when available.',
        'Do not retry this saved plan. Inspect the authoritative key inventory and remote Terraform state, then use a separately reviewed import-only or evidence-finalization recovery path.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (KEY_PREREQUISITE_CONSUMED) {
    console.error(
      'The browser App Check score-key prerequisite has already converged; this apply path is permanently retired.',
    );
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Browser App Check key apply failed');
      process.exitCode = 1;
    });
  }
}
