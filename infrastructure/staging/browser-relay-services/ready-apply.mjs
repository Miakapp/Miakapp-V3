import {
  chmodSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  privateRelayServicesBundle,
  readPrivateFile,
  readRelayServicesPrivateReadyPlanMetadata,
  sha256,
  validatePrivateReadyRelayVariables,
  validateRelayServicesPrivateReadyAuthorization,
  validateRelayServicesV5Profile,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  createTerraformData,
  parseJson,
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
  relayServicesInventorySha256,
  validateRelayServicesPrivateReadyBaseline,
  validateRelayServicesPrivateReadyInventory,
} from './inventory.mjs';
import {
  createRelayPrivateReadyClaim,
  observePinnedPrivateReadyPrerequisiteClaims,
  observePinnedRelayPrivateReadyClaim,
  observeRelayPrivateReadyClaimAbsent,
  validateRelayPrivateReadyClaimReceipt,
} from './ready-claim.mjs';
import { readAndValidatePrivateReadyRelayServicesPlan } from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_RELAY_SERVICES_READY_APPLY_AUTHORIZATION';
const ATTEMPT_MARKER = 'private-ready-mutation-attempted.json';
export const RELAY_SERVICES_PRIVATE_READY_OPERATION_CONSUMED = true;
const RETIRED_MESSAGE =
  'Relay private-ready transition already converged; this one-shot apply entrypoint is permanently retired';
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

function readVariables(path, metadata) {
  const bytes = readPrivateFile(path, 64 * 1024);
  if (sha256(bytes) !== metadata.terraform_variables_sha256) {
    reject('Private-ready variables digest has drifted');
  }
  const value = parseJson(bytes, 'Private-ready variables', 64 * 1024);
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Private-ready variables are not canonical JSON');
  }
  return Object.freeze({ bytes, value: validatePrivateReadyRelayVariables(value) });
}

function writeMutationAttemptMarker(bundle, metadata) {
  writePrivateFile(join(bundle, ATTEMPT_MARKER), Buffer.from(canonicalJson({
    schema: 'miakapp.staging-browser-relay-services-private-ready-attempt/1',
    operation: 'transition-private-browser-relays-to-assigned-audiences',
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    attempted_at: new Date().toISOString(),
    retry_authorized: false,
  }), 'utf8'), 0o400);
}

async function observeBaseline(session) {
  return validateRelayServicesPrivateReadyBaseline({
    schema: 'miakapp.staging-browser-relay-services-private-ready-baseline/1',
    inventory: await observeRelayServicesInventory(session),
    private_ready_claim: await observeRelayPrivateReadyClaimAbsent(session),
  });
}

export function validateRelayServicesPrivateReadyTerraformOutput(value) {
  const profile = validateRelayServicesV5Profile();
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || value.schema !== 'miakapp.staging-browser-relay-services/1'
    || value.deployment_phase !== 'private_ready'
    || value.project_id !== PROJECT_ID || value.project_number !== PROJECT_NUMBER
    || value.region !== REGION
    || value.relay_source_commit !== profile.pins.miakapp_server_commit
    || value.relay_image !== profile.image.digest_reference
    || value.runtime_identity !== profile.runtime_identity.email
    || !isDeepStrictEqual(value.runtime_project_roles, [])
    || value.services === null || Array.isArray(value.services)
    || typeof value.services !== 'object'
    || !isDeepStrictEqual(Object.keys(value.services).sort(), ['relay-a', 'relay-b'])) {
    reject('Relay-services Terraform output does not match the reviewed private-ready phase');
  }
  for (const service of profile.services) {
    const observed = value.services[service.id];
    if (observed === null || Array.isArray(observed) || typeof observed !== 'object'
      || observed.name !== service.name || observed.uri !== service.assigned_uri
      || observed.audience !== service.ready_audience
      || observed.public_invoker !== false
      || observed.minimum_instances !== 0 || observed.maximum_instances !== 1
      || observed.concurrency !== profile.cloud_run.concurrency
      || observed.timeout_seconds !== profile.cloud_run.request_timeout_seconds
      || observed.deletion_protection !== false) {
      reject(`${service.id} Terraform output does not match its private-ready boundary`);
    }
  }
  return Object.freeze(value);
}

export function buildRelayServicesPrivateReadyResult({
  metadata,
  claimReceipt,
  output,
  inventory,
}) {
  const profile = validateRelayServicesV5Profile();
  const metadataBytes = Buffer.from(canonicalJson(metadata), 'utf8');
  const checkedClaim = validateRelayPrivateReadyClaimReceipt(
    claimReceipt,
    metadataBytes,
    metadata,
  );
  const checkedOutput = validateRelayServicesPrivateReadyTerraformOutput(output);
  const checkedInventory = validateRelayServicesPrivateReadyInventory(inventory, checkedClaim);
  for (const service of profile.services) {
    const relay = checkedInventory.relays.find(({ id }) => id === service.id);
    if (relay.uri !== checkedOutput.services[service.id].uri) {
      reject(`${service.id} Terraform and Cloud Run URIs differ`);
    }
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-private-ready-result/1',
    operation: 'transition-private-browser-relays-to-assigned-audiences',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: metadata.repository_commit,
    profile_sha256: metadata.profile_sha256,
    memory_recovery_failure_sha256: metadata.memory_recovery_failure_sha256,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    claim_generation: checkedClaim.generation,
    claim_sha256: checkedClaim.sha256,
    final_inventory_sha256: relayServicesInventorySha256(checkedInventory),
    terraform_state_generation: checkedInventory.terraform_state.generation,
    terraform_state_sha256: checkedInventory.terraform_state.sha256,
    runtime_identity: profile.runtime_identity.email,
    runtime_project_roles: [],
    user_managed_keys: 0,
    relay_image: profile.image.digest_reference,
    relays: Object.freeze(profile.services.map((service) => {
      const relay = checkedInventory.relays.find(({ id }) => id === service.id);
      return Object.freeze({
        id: service.id,
        name: service.name,
        uri: relay.uri,
        audience: service.ready_audience,
        generation: relay.generation,
        memory: profile.cloud_run.memory,
        public_invoker: false,
        minimum_instances: 0,
        maximum_instances: 1,
      });
    })),
    public_iam_members: 0,
    live_requests_by_driver: 0,
    hosting_releases: 0,
    fixed_minimum_instances: 0,
    maximum_monthly_increment_eur: profile.operation.maximum_monthly_increment_eur,
    retry_authorized: false,
  });
}

async function captureUncertainInventory(bundle) {
  try {
    const session = await verifiedOperatorSession();
    const inventory = await observeRelayServicesInventory(session);
    const path = join(bundle, 'private-ready-uncertain-inventory.json');
    if (!existsSync(path)) {
      writePrivateFile(path, Buffer.from(canonicalJson(inventory), 'utf8'), 0o400);
    }
  } catch {
    // Existing private diagnostics remain the only evidence if inventory cannot be read.
  }
}

async function main() {
  if (RELAY_SERVICES_PRIVATE_READY_OPERATION_CONSUMED) throw new Error(RETIRED_MESSAGE);
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./ready-apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateRelayServicesRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateRelayServicesBundle(process.argv[2], repositoryRoot);
  if (existsSync(join(bundle, ATTEMPT_MARKER))) {
    reject('This relay private-ready bundle already attempted a mutation and must never be retried');
  }

  const metadataPath = join(bundle, 'metadata.json');
  const { bytes: metadataBytes, value: metadata } =
    readRelayServicesPrivateReadyPlanMetadata(metadataPath);
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  const planPath = join(bundle, 'relay-services-private-ready.tfplan');
  const planJsonPath = join(bundle, 'relay-services-private-ready.tfplan.json');
  const variablesPath = join(bundle, 'relay-services.auto.tfvars.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 32 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    reject('Private-ready bundle digest verification failed');
  }
  readVariables(variablesPath, metadata);
  validateRelayServicesPrivateReadyAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
    metadata.baseline_sha256,
  );
  const summary = readAndValidatePrivateReadyRelayServicesPlan(planJsonPath);
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    reject('Private-ready metadata summary no longer matches the reviewed plan');
  }

  const terraformData = createTerraformData(bundle, 'private-ready-apply');
  let mutationAttempted = false;
  try {
    const inspectionSession = await verifiedOperatorSession();
    const inspectionEnvironment = terraformEnvironment(terraformData, inspectionSession.accessToken);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: relayServicesRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'private-ready-apply-init',
    });
    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: relayServicesRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'private-ready-apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      reject('Terraform private-ready plan no longer renders to the reviewed JSON');
    }

    const mutationSession = await verifiedOperatorSession();
    const liveBaseline = await observeBaseline(mutationSession);
    await observePinnedPrivateReadyPrerequisiteClaims(mutationSession);
    const { bytes: freshMetadataBytes, value: freshMetadata } =
      readRelayServicesPrivateReadyPlanMetadata(metadataPath);
    verifyExactMain(repositoryRoot, freshMetadata.repository_commit);
    validateRelayServicesPrivateReadyAuthorization(
      process.env[APPLY_AUTHORIZATION],
      planBytes,
      freshMetadata.repository_commit,
      freshMetadata.baseline_sha256,
    );
    if (!isDeepStrictEqual(freshMetadata, metadata)
      || !freshMetadataBytes.equals(metadataBytes)
      || !isDeepStrictEqual(liveBaseline, freshMetadata.baseline)
      || sha256(Buffer.from(canonicalJson(liveBaseline), 'utf8'))
        !== freshMetadata.baseline_sha256) {
      reject('Live private-ready prerequisites changed after the saved plan was rendered');
    }

    writeMutationAttemptMarker(bundle, freshMetadata);
    mutationAttempted = true;
    const claimReceipt = await createRelayPrivateReadyClaim(
      mutationSession,
      freshMetadataBytes,
      freshMetadata,
    );
    writePrivateFile(
      join(bundle, 'private-ready-claim-receipt.json'),
      Buffer.from(canonicalJson(claimReceipt), 'utf8'),
      0o400,
    );
    const postClaimInventory = await observeRelayServicesInventory(mutationSession);
    await observePinnedPrivateReadyPrerequisiteClaims(mutationSession);
    await observePinnedRelayPrivateReadyClaim(
      mutationSession,
      claimReceipt,
      freshMetadataBytes,
      freshMetadata,
    );
    if (!isDeepStrictEqual(postClaimInventory, liveBaseline.inventory)) {
      reject('Staging resources changed unexpectedly while the private-ready claim was acquired');
    }

    const mutationEnvironment = terraformEnvironment(terraformData, mutationSession.accessToken);
    const applied = run('terraform', [
      'apply', '-input=false', '-lock-timeout=5m', '-auto-approve', '-no-color', planPath,
    ], {
      cwd: relayServicesRoot,
      env: mutationEnvironment,
      allowedStatuses: [0, 1],
      diagnosticDirectory: bundle,
      description: 'terraform-private-ready-apply',
    });
    const applyFailed = applied.status !== 0;
    if (applyFailed) writeDiagnostics(join(bundle, 'private-ready-apply-failure.log'), applied);

    const convergence = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
      `-var-file=${variablesPath}`,
    ], {
      cwd: relayServicesRoot,
      env: mutationEnvironment,
      allowedStatuses: [0, 1, 2],
      diagnosticDirectory: bundle,
      description: 'terraform-private-ready-convergence',
    });
    if (convergence.status !== 0) {
      writeDiagnostics(join(bundle, 'private-ready-convergence-failure.log'), convergence);
      reject(applyFailed
        ? 'Private-ready apply failed and live state is incomplete or uncertain'
        : 'Private-ready apply completed but the follow-up plan is not empty');
    }

    const evidenceSession = await verifiedOperatorSession();
    await observePinnedPrivateReadyPrerequisiteClaims(evidenceSession);
    await observePinnedRelayPrivateReadyClaim(
      evidenceSession,
      claimReceipt,
      metadataBytes,
      metadata,
    );
    const inventory = validateRelayServicesPrivateReadyInventory(
      await observeRelayServicesInventory(evidenceSession),
      claimReceipt,
    );
    const evidenceEnvironment = terraformEnvironment(terraformData, evidenceSession.accessToken);
    const renderedOutput = run('terraform', [
      'output', '-json', 'staging_browser_relays',
    ], {
      cwd: relayServicesRoot,
      env: evidenceEnvironment,
      diagnosticDirectory: bundle,
      description: 'terraform-private-ready-output',
    });
    const output = parseJson(renderedOutput.stdout, 'Private-ready Terraform output');
    const result = buildRelayServicesPrivateReadyResult({
      metadata,
      claimReceipt,
      output,
      inventory,
    });
    const resultPath = join(bundle, 'private-ready-result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider returned an error after the exact private-ready state converged.'
        : 'The exact private-ready relay transition was applied and converged.',
      `Private result: ${resultPath}`,
      'Relays: 2 IAM-private Cloud Run services with exact assigned audiences, 512 MiB, scale 0..1.',
      'Public IAM members: 0; live requests by driver: 0; Hosting releases: 0.',
      'All three global claims remain durable and this transition is permanently non-retryable.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      await captureUncertainInventory(bundle);
      throw new Error([
        error instanceof Error ? error.message : 'Private-ready relay transition failed.',
        'The private bundle and post-attempt inventory were preserved when available.',
        'Do not retry any saved plan or delete any global claim; reconcile from fresh evidence.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Private-ready relay apply failed');
    process.exitCode = 1;
  });
}
