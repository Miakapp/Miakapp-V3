import {
  chmodSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_API,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  privateBrowserAppCheckBundle,
  readBrowserAppCheckApiPlanMetadata,
  readPrivateFile,
  sha256,
  validateBrowserAppCheckApiAuthorization,
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

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_BROWSER_APP_CHECK_API_APPLY_AUTHORIZATION';
const ATTEMPT_MARKER = 'mutation-attempted.json';
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
  const [inventory, terraformState] = await Promise.all([
    observeBrowserAppCheckInventory(session),
    observeInitialBrowserAppCheckState(session),
  ]);
  return Object.freeze({
    inventory: validateBrowserAppCheckInventory(inventory, 'before-api'),
    terraform_state: terraformState,
  });
}

export function validateBrowserAppCheckTerraformOutput(value) {
  const expected = {
    schema: 'miakapp.staging-browser-app-check-api/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_app_id: FIREBASE_APP_ID,
    firebase_app_display_name: FIREBASE_APP_DISPLAY_NAME,
    recaptcha_api: RECAPTCHA_API,
    recaptcha_api_enabled: true,
    recaptcha_keys_created: 0,
    app_check_registered: false,
    app_check_enforcement: false,
    debug_tokens: 0,
    public_endpoints_created: 0,
    fixed_cost_services: 0,
  };
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || !isDeepStrictEqual(value, expected)) {
    reject('Browser App Check API Terraform output does not match the reviewed value');
  }
  return Object.freeze(value);
}

export function buildBrowserAppCheckApiResult({ metadata, output, inventory }) {
  const checkedOutput = validateBrowserAppCheckTerraformOutput(output);
  const checkedInventory = validateBrowserAppCheckInventory(inventory, 'after-api');
  if (checkedOutput.firebase_app_id !== checkedInventory.firebase_web_app.app_id) {
    reject('Terraform and live Firebase Web app identifiers do not match');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-api-result/1',
    operation: 'enable-recaptcha-enterprise-api-only',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    final_inventory_sha256: sha256(Buffer.from(canonicalJson(checkedInventory), 'utf8')),
    recaptcha_api_enabled: true,
    authoritative_recaptcha_keys: 0,
    cloud_asset_recaptcha_keys: 0,
    app_check_registered: false,
    app_check_enforcement_records: 0,
    debug_tokens: 0,
    public_endpoints_created: 0,
    fixed_cost_services: 0,
    assessments_initiated_by_driver: 0,
  });
}

async function captureUncertainInventory(bundle) {
  try {
    const session = await verifiedOperatorSession();
    const inventory = await observeBrowserAppCheckInventory(session);
    const path = join(bundle, 'uncertain-inventory.json');
    if (!existsSync(path)) {
      writePrivateFile(path, Buffer.from(canonicalJson(inventory), 'utf8'), 0o400);
    }
  } catch {
    // Existing private diagnostics remain the only evidence if inventory cannot be read.
  }
}

function writeMutationAttemptMarker(bundle, metadata) {
  const marker = Object.freeze({
    schema: 'miakapp.staging-browser-app-check-api-attempt/1',
    operation: 'enable-recaptcha-enterprise-api-only',
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    attempted_at: new Date().toISOString(),
    retry_authorized: false,
  });
  writePrivateFile(
    join(bundle, ATTEMPT_MARKER),
    Buffer.from(canonicalJson(marker), 'utf8'),
    0o400,
  );
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateBrowserAppCheckRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBrowserAppCheckBundle(process.argv[2], repositoryRoot);
  if (existsSync(join(bundle, ATTEMPT_MARKER))) {
    reject('This browser App Check API bundle has already attempted a mutation and must never be retried');
  }

  const metadataPath = join(bundle, 'metadata.json');
  const { value: metadata } = readBrowserAppCheckApiPlanMetadata(metadataPath);
  verifyExactMain(repositoryRoot, metadata.repository_commit);

  const planPath = join(bundle, 'browser-app-check-api.tfplan');
  const planJsonPath = join(bundle, 'browser-app-check-api.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    reject('Browser App Check API bundle digest verification failed');
  }
  validateBrowserAppCheckApiAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
    metadata.baseline_sha256,
  );
  const summary = readAndValidateBrowserAppCheckApiPlan(planJsonPath);
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    reject('Browser App Check API metadata summary no longer matches the reviewed plan');
  }

  const terraformData = createTerraformData(bundle, 'api-apply');
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
      description: 'apply-init',
    });
    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: browserAppCheckRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      reject('Terraform browser App Check API plan no longer renders to the reviewed JSON');
    }

    // Refresh every mutable prerequisite immediately before the first cloud mutation.
    const mutationSession = await verifiedOperatorSession();
    const liveBaseline = await observeBaseline(mutationSession);
    const { value: freshMetadata } = readBrowserAppCheckApiPlanMetadata(metadataPath);
    verifyExactMain(repositoryRoot, freshMetadata.repository_commit);
    validateBrowserAppCheckApiAuthorization(
      process.env[APPLY_AUTHORIZATION],
      planBytes,
      freshMetadata.repository_commit,
      freshMetadata.baseline_sha256,
    );
    if (!isDeepStrictEqual(freshMetadata, metadata)
      || !isDeepStrictEqual(liveBaseline, freshMetadata.baseline)
      || sha256(Buffer.from(canonicalJson(liveBaseline), 'utf8')) !== freshMetadata.baseline_sha256) {
      reject('Live browser App Check API prerequisites changed after the saved plan was rendered');
    }

    // This exclusive durable marker intentionally makes every post-call outcome non-retryable.
    writeMutationAttemptMarker(bundle, freshMetadata);
    mutationAttempted = true;
    const mutationEnvironment = terraformEnvironment(
      terraformData,
      mutationSession.accessToken,
    );
    const applied = run('terraform', [
      'apply', '-input=false', '-auto-approve', '-no-color', planPath,
    ], {
      cwd: browserAppCheckRoot,
      env: mutationEnvironment,
      allowedStatuses: [0, 1],
      diagnosticDirectory: bundle,
      description: 'terraform-apply',
    });
    const applyFailed = applied.status !== 0;
    if (applyFailed) writeDiagnostics(join(bundle, 'apply-failure.log'), applied);

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
      description: 'terraform-convergence',
    });
    if (convergence.status !== 0) {
      writeDiagnostics(join(bundle, 'convergence-failure.log'), convergence);
      reject(applyFailed
        ? 'Browser App Check API apply failed and the live state is incomplete or uncertain'
        : 'Browser App Check API apply completed but the follow-up plan is not empty');
    }

    const evidenceSession = await verifiedOperatorSession();
    const inventory = validateBrowserAppCheckInventory(
      await observeBrowserAppCheckInventory(evidenceSession),
      'after-api',
    );
    const evidenceEnvironment = terraformEnvironment(
      terraformData,
      evidenceSession.accessToken,
    );
    const renderedOutput = run('terraform', [
      'output', '-json', 'staging_browser_app_check_api',
    ], {
      cwd: browserAppCheckRoot,
      env: evidenceEnvironment,
      diagnosticDirectory: bundle,
      description: 'terraform-output',
    });
    let output;
    try {
      output = JSON.parse(Buffer.from(renderedOutput.stdout).toString('utf8'));
    } catch {
      return reject('Browser App Check API Terraform output is invalid JSON');
    }
    const result = buildBrowserAppCheckApiResult({ metadata, output, inventory });
    const resultPath = join(bundle, 'result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider returned an error after the exact reCAPTCHA API prerequisite converged.'
        : 'The exact reCAPTCHA Enterprise API prerequisite was enabled and converged.',
      `Private result: ${resultPath}`,
      'Authoritative reCAPTCHA key inventory: empty; App Check registration and enforcement: absent.',
      'No key, debug token, public endpoint, browser request, or assessment was created by this driver.',
      'Create a fresh phase-two plan before considering any browser key.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      await captureUncertainInventory(bundle);
      throw new Error([
        error instanceof Error ? error.message : 'Browser App Check API apply failed.',
        'The private bundle and post-attempt inventory were preserved when available.',
        'Do not retry the saved plan. Inspect Terraform state and the authoritative reCAPTCHA key inventory; an existing key may have become active when the API was enabled.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Browser App Check API apply failed');
    process.exitCode = 1;
  });
}
