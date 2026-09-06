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
  RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  privateRelayServicesBundle,
  readPrivateFile,
  readRelayServicesRecoveryPlanMetadata,
  sha256,
  validateBootstrapRelayVariables,
  validateRelayServicesProfile,
  validateRelayServicesRecoveryAuthorization,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  createRelayRecoveryClaim,
  observePinnedOriginalRelayBootstrapClaim,
  observePinnedRelayRecoveryClaim,
  validateRelayRecoveryClaimReceipt,
} from './recovery-claim.mjs';
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
  validateRelayServicesRecoveredInventory,
  validateRelayServicesRecoveryBaseline,
} from './inventory.mjs';
import { validateRelayServicesTerraformOutput } from './apply.mjs';
import { readAndValidateRecoveryRelayServicesPlan } from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_RELAY_SERVICES_RECOVERY_APPLY_AUTHORIZATION';
const ATTEMPT_MARKER = 'recovery-mutation-attempted.json';
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
    reject('Private relay recovery variables digest has drifted');
  }
  const value = parseJson(bytes, 'Private relay recovery variables', 64 * 1024);
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Private relay recovery variables are not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateBootstrapRelayVariables(value) });
}

function expectedPostClaimBaseline(baseline, receipt) {
  return {
    ...baseline,
    recovery_claim: {
      schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
      bucket: receipt.bucket,
      object: receipt.object,
      state: 'present',
      generation: receipt.generation,
      size_bytes: receipt.size_bytes,
    },
  };
}

function writeMutationAttemptMarker(bundle, metadata) {
  writePrivateFile(join(bundle, ATTEMPT_MARKER), Buffer.from(canonicalJson({
    schema: 'miakapp.staging-browser-relay-services-memory-recovery-attempt/1',
    operation: 'recover-private-browser-relay-bootstrap-memory',
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    attempted_at: new Date().toISOString(),
    retry_authorized: false,
  }), 'utf8'), 0o400);
}

export function buildRelayServicesRecoveryResult({
  metadata,
  claimReceipt,
  output,
  inventory,
}) {
  const profile = validateRelayServicesProfile();
  const checkedClaim = validateRelayRecoveryClaimReceipt(
    claimReceipt,
    Buffer.from(canonicalJson(metadata), 'utf8'),
    metadata,
  );
  const checkedOutput = validateRelayServicesTerraformOutput(output);
  const checkedInventory = validateRelayServicesRecoveredInventory(inventory, checkedClaim);
  for (const service of profile.services) {
    const relay = checkedInventory.relays.find(({ id }) => id === service.id);
    if (relay.uri !== checkedOutput.services[service.id].uri) {
      reject(`${service.id} Terraform and Cloud Run URIs differ`);
    }
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-memory-recovery-result/1',
    operation: 'recover-private-browser-relay-bootstrap-memory',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: metadata.repository_commit,
    profile_sha256: metadata.profile_sha256,
    bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    original_claim_generation: metadata.original_claim_generation,
    original_claim_sha256: metadata.original_claim_sha256,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    recovery_claim_generation: checkedClaim.generation,
    recovery_claim_sha256: checkedClaim.sha256,
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
        bootstrap_audience: service.bootstrap_audience,
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
    const path = join(bundle, 'recovery-uncertain-inventory.json');
    if (!existsSync(path)) {
      writePrivateFile(path, Buffer.from(canonicalJson(inventory), 'utf8'), 0o400);
    }
  } catch {
    // Existing private diagnostics remain the only evidence if inventory cannot be read.
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./recovery-apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateRelayServicesRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateRelayServicesBundle(process.argv[2], repositoryRoot);
  if (existsSync(join(bundle, ATTEMPT_MARKER))) {
    reject('This relay recovery bundle already attempted a mutation and must never be retried');
  }

  const metadataPath = join(bundle, 'metadata.json');
  const { bytes: metadataBytes, value: metadata } =
    readRelayServicesRecoveryPlanMetadata(metadataPath);
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  const planPath = join(bundle, 'relay-services-memory-recovery.tfplan');
  const planJsonPath = join(bundle, 'relay-services-memory-recovery.tfplan.json');
  const variablesPath = join(bundle, 'relay-services.auto.tfvars.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 32 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    reject('Private relay recovery bundle digest verification failed');
  }
  readVariables(variablesPath, metadata);
  validateRelayServicesRecoveryAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
    metadata.baseline_sha256,
  );
  const summary = readAndValidateRecoveryRelayServicesPlan(planJsonPath);
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    reject('Relay recovery metadata summary no longer matches the reviewed plan');
  }

  const terraformData = createTerraformData(bundle, 'memory-recovery-apply');
  let mutationAttempted = false;
  try {
    const inspectionSession = await verifiedOperatorSession();
    const inspectionEnvironment = terraformEnvironment(terraformData, inspectionSession.accessToken);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: relayServicesRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'recovery-apply-init',
    });
    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: relayServicesRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'recovery-apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      reject('Terraform relay recovery plan no longer renders to the reviewed JSON');
    }

    const mutationSession = await verifiedOperatorSession();
    const liveBaseline = validateRelayServicesRecoveryBaseline(
      await observeRelayServicesInventory(mutationSession),
    );
    await observePinnedOriginalRelayBootstrapClaim(mutationSession);
    const { bytes: freshMetadataBytes, value: freshMetadata } =
      readRelayServicesRecoveryPlanMetadata(metadataPath);
    verifyExactMain(repositoryRoot, freshMetadata.repository_commit);
    validateRelayServicesRecoveryAuthorization(
      process.env[APPLY_AUTHORIZATION],
      planBytes,
      freshMetadata.repository_commit,
      freshMetadata.baseline_sha256,
    );
    if (!isDeepStrictEqual(freshMetadata, metadata)
      || !freshMetadataBytes.equals(metadataBytes)
      || !isDeepStrictEqual(liveBaseline, freshMetadata.baseline)
      || relayServicesInventorySha256(liveBaseline) !== freshMetadata.baseline_sha256) {
      reject('Live relay recovery prerequisites changed after the saved plan was rendered');
    }

    writeMutationAttemptMarker(bundle, freshMetadata);
    mutationAttempted = true;
    const claimReceipt = await createRelayRecoveryClaim(
      mutationSession,
      freshMetadataBytes,
      freshMetadata,
    );
    writePrivateFile(
      join(bundle, 'recovery-claim-receipt.json'),
      Buffer.from(canonicalJson(claimReceipt), 'utf8'),
      0o400,
    );
    const postClaim = await observeRelayServicesInventory(mutationSession);
    if (!isDeepStrictEqual(postClaim, expectedPostClaimBaseline(liveBaseline, claimReceipt))) {
      reject('Staging resources changed unexpectedly while the global recovery claim was acquired');
    }

    const mutationEnvironment = terraformEnvironment(terraformData, mutationSession.accessToken);
    const applied = run('terraform', [
      'apply', '-input=false', '-lock-timeout=5m', '-auto-approve', '-no-color', planPath,
    ], {
      cwd: relayServicesRoot,
      env: mutationEnvironment,
      allowedStatuses: [0, 1],
      diagnosticDirectory: bundle,
      description: 'terraform-recovery-apply',
    });
    const applyFailed = applied.status !== 0;
    if (applyFailed) writeDiagnostics(join(bundle, 'recovery-apply-failure.log'), applied);

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
      description: 'terraform-recovery-convergence',
    });
    if (convergence.status !== 0) {
      writeDiagnostics(join(bundle, 'recovery-convergence-failure.log'), convergence);
      reject(applyFailed
        ? 'Relay-services recovery apply failed and live state is incomplete or uncertain'
        : 'Relay-services recovery apply completed but the follow-up plan is not empty');
    }

    const evidenceSession = await verifiedOperatorSession();
    await observePinnedOriginalRelayBootstrapClaim(evidenceSession);
    await observePinnedRelayRecoveryClaim(
      evidenceSession,
      claimReceipt,
      metadataBytes,
      metadata,
    );
    const inventory = validateRelayServicesRecoveredInventory(
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
      description: 'terraform-recovery-output',
    });
    const output = parseJson(renderedOutput.stdout, 'Relay-services Terraform output');
    const result = buildRelayServicesRecoveryResult({
      metadata,
      claimReceipt,
      output,
      inventory,
    });
    const resultPath = join(bundle, 'recovery-result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider returned an error after the exact relay recovery converged.'
        : 'The exact private relay memory recovery plan was applied and converged.',
      `Private result: ${resultPath}`,
      'Relays: 2 private Cloud Run services, 512 MiB, scale 0..1; public IAM members: 0.',
      'Runtime identity: keyless with zero project roles; live requests by driver: 0; Hosting releases: 0.',
      'Both global claims remain durable and the recovery is permanently non-retryable.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      await captureUncertainInventory(bundle);
      throw new Error([
        error instanceof Error ? error.message : 'Private relay recovery failed.',
        'The private bundle and post-attempt inventory were preserved when available.',
        'Do not retry either saved plan or delete either global claim; reconcile from fresh evidence.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Private relay recovery apply failed');
    process.exitCode = 1;
  });
}
