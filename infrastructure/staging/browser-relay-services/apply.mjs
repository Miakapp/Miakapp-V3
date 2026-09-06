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
  readRelayServicesBootstrapPlanMetadata,
  sha256,
  validateBootstrapRelayVariables,
  validateRelayServicesBootstrapAuthorization,
  validateRelayServicesProfile,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  createRelayBootstrapClaim,
  observePinnedRelayBootstrapClaim,
  validateRelayBootstrapClaimReceipt,
} from './claim.mjs';
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
  validateRelayServicesBootstrapBaseline,
  validateRelayServicesPrivateBootstrapInventory,
} from './inventory.mjs';
import { readAndValidateInitialRelayServicesPlan } from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_RELAY_SERVICES_BOOTSTRAP_APPLY_AUTHORIZATION';
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

function readVariables(path, metadata) {
  const bytes = readPrivateFile(path, 64 * 1024);
  if (sha256(bytes) !== metadata.terraform_variables_sha256) {
    reject('Private relay-services variables digest has drifted');
  }
  const value = parseJson(bytes, 'Private relay-services variables', 64 * 1024);
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Private relay-services variables are not canonical JSON');
  }
  return Object.freeze({ bytes, value: validateBootstrapRelayVariables(value) });
}

function expectedPostClaimBaseline(baseline, receipt) {
  return {
    ...baseline,
    operation_claim: {
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
    schema: 'miakapp.staging-browser-relay-services-bootstrap-attempt/1',
    operation: 'deploy-private-browser-relay-bootstrap',
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    attempted_at: new Date().toISOString(),
    retry_authorized: false,
  }), 'utf8'), 0o400);
}

export function validateRelayServicesTerraformOutput(value) {
  const profile = validateRelayServicesProfile();
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || value.schema !== 'miakapp.staging-browser-relay-services/1'
    || value.deployment_phase !== 'private_bootstrap'
    || value.project_id !== PROJECT_ID
    || value.project_number !== PROJECT_NUMBER
    || value.region !== REGION
    || value.relay_source_commit !== profile.pins.miakapp_server_commit
    || value.relay_image !== profile.image.digest_reference
    || value.runtime_identity !== profile.runtime_identity.email
    || !isDeepStrictEqual(value.runtime_project_roles, [])
    || value.services === null || Array.isArray(value.services)
    || typeof value.services !== 'object'
    || !isDeepStrictEqual(Object.keys(value.services).sort(), ['relay-a', 'relay-b'])) {
    reject('Relay-services Terraform output does not match the reviewed private bootstrap');
  }
  for (const service of profile.services) {
    const observed = value.services[service.id];
    const uriPattern = new RegExp(
      service.audience_pattern.replace('^wss:', '^https:').replace('/ws$', '$'),
      'u',
    );
    if (observed === null || Array.isArray(observed) || typeof observed !== 'object'
      || observed.name !== service.name
      || typeof observed.uri !== 'string' || !uriPattern.test(observed.uri)
      || observed.audience !== service.bootstrap_audience
      || observed.public_invoker !== false
      || observed.minimum_instances !== 0
      || observed.maximum_instances !== 1
      || observed.concurrency !== profile.cloud_run.concurrency
      || observed.timeout_seconds !== profile.cloud_run.request_timeout_seconds
      || observed.deletion_protection !== false) {
      reject(`${service.id} Terraform output does not match the reviewed private bootstrap`);
    }
  }
  return Object.freeze(value);
}

export function buildRelayServicesBootstrapResult({
  metadata,
  claimReceipt,
  output,
  inventory,
}) {
  const profile = validateRelayServicesProfile();
  const checkedClaim = validateRelayBootstrapClaimReceipt(
    claimReceipt,
    Buffer.from(canonicalJson(metadata), 'utf8'),
    metadata,
  );
  const checkedOutput = validateRelayServicesTerraformOutput(output);
  const checkedInventory = validateRelayServicesPrivateBootstrapInventory(
    inventory,
    checkedClaim,
  );
  for (const service of profile.services) {
    const relay = checkedInventory.relays.find(({ id }) => id === service.id);
    if (relay.uri !== checkedOutput.services[service.id].uri) {
      reject(`${service.id} Terraform and Cloud Run URIs differ`);
    }
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-bootstrap-result/1',
    operation: 'deploy-private-browser-relay-bootstrap',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    repository_commit: metadata.repository_commit,
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
        bootstrap_audience: service.bootstrap_audience,
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
    const path = join(bundle, 'uncertain-inventory.json');
    if (!existsSync(path)) {
      writePrivateFile(path, Buffer.from(canonicalJson(inventory), 'utf8'), 0o400);
    }
  } catch {
    // Existing private diagnostics remain the only evidence if inventory cannot be read.
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateRelayServicesRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateRelayServicesBundle(process.argv[2], repositoryRoot);
  if (existsSync(join(bundle, ATTEMPT_MARKER))) {
    reject('This relay-services bundle already attempted a mutation and must never be retried');
  }

  const metadataPath = join(bundle, 'metadata.json');
  const { bytes: metadataBytes, value: metadata } =
    readRelayServicesBootstrapPlanMetadata(metadataPath);
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  const planPath = join(bundle, 'relay-services-bootstrap.tfplan');
  const planJsonPath = join(bundle, 'relay-services-bootstrap.tfplan.json');
  const variablesPath = join(bundle, 'relay-services.auto.tfvars.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 32 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    reject('Private relay-services bundle digest verification failed');
  }
  const { value: variables } = readVariables(variablesPath, metadata);
  validateRelayServicesBootstrapAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
    metadata.baseline_sha256,
  );
  const summary = readAndValidateInitialRelayServicesPlan(planJsonPath);
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    reject('Relay-services metadata summary no longer matches the reviewed plan');
  }

  const terraformData = createTerraformData(bundle, 'bootstrap-apply');
  let mutationAttempted = false;
  try {
    const inspectionSession = await verifiedOperatorSession();
    const inspectionEnvironment = terraformEnvironment(terraformData, inspectionSession.accessToken);
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      cwd: relayServicesRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'apply-init',
    });
    const shown = run('terraform', ['show', '-json', planPath], {
      cwd: relayServicesRoot,
      env: inspectionEnvironment,
      diagnosticDirectory: bundle,
      description: 'apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      reject('Terraform relay-services plan no longer renders to the reviewed JSON');
    }

    const mutationSession = await verifiedOperatorSession();
    const liveBaseline = validateRelayServicesBootstrapBaseline(
      await observeRelayServicesInventory(mutationSession),
    );
    const { bytes: freshMetadataBytes, value: freshMetadata } =
      readRelayServicesBootstrapPlanMetadata(metadataPath);
    verifyExactMain(repositoryRoot, freshMetadata.repository_commit);
    validateRelayServicesBootstrapAuthorization(
      process.env[APPLY_AUTHORIZATION],
      planBytes,
      freshMetadata.repository_commit,
      freshMetadata.baseline_sha256,
    );
    if (!isDeepStrictEqual(freshMetadata, metadata)
      || !freshMetadataBytes.equals(metadataBytes)
      || !isDeepStrictEqual(liveBaseline, freshMetadata.baseline)
      || relayServicesInventorySha256(liveBaseline) !== freshMetadata.baseline_sha256) {
      reject('Live relay-services prerequisites changed after the saved plan was rendered');
    }

    writeMutationAttemptMarker(bundle, freshMetadata);
    mutationAttempted = true;
    const claimReceipt = await createRelayBootstrapClaim(
      mutationSession,
      freshMetadataBytes,
      freshMetadata,
    );
    writePrivateFile(
      join(bundle, 'claim-receipt.json'),
      Buffer.from(canonicalJson(claimReceipt), 'utf8'),
      0o400,
    );
    const postClaim = await observeRelayServicesInventory(mutationSession);
    if (!isDeepStrictEqual(postClaim, expectedPostClaimBaseline(liveBaseline, claimReceipt))) {
      reject('Staging resources changed unexpectedly while the global bootstrap claim was acquired');
    }

    const mutationEnvironment = terraformEnvironment(terraformData, mutationSession.accessToken);
    const applied = run('terraform', [
      'apply', '-input=false', '-auto-approve', '-no-color', planPath,
    ], {
      cwd: relayServicesRoot,
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
      `-var-file=${variablesPath}`,
    ], {
      cwd: relayServicesRoot,
      env: mutationEnvironment,
      allowedStatuses: [0, 1, 2],
      diagnosticDirectory: bundle,
      description: 'terraform-convergence',
    });
    if (convergence.status !== 0) {
      writeDiagnostics(join(bundle, 'convergence-failure.log'), convergence);
      reject(applyFailed
        ? 'Relay-services apply failed and live state is incomplete or uncertain'
        : 'Relay-services apply completed but the follow-up plan is not empty');
    }

    const evidenceSession = await verifiedOperatorSession();
    await observePinnedRelayBootstrapClaim(
      evidenceSession,
      claimReceipt,
      metadataBytes,
      metadata,
    );
    const inventory = validateRelayServicesPrivateBootstrapInventory(
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
      description: 'terraform-output',
    });
    const output = parseJson(renderedOutput.stdout, 'Relay-services Terraform output');
    const result = buildRelayServicesBootstrapResult({
      metadata,
      claimReceipt,
      output,
      inventory,
    });
    const resultPath = join(bundle, 'result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider returned an error after the exact private relay bootstrap converged.'
        : 'The exact private relay bootstrap plan was applied and converged.',
      `Private result: ${resultPath}`,
      'Relays: 2 private Cloud Run services, scale 0..1; public IAM members: 0.',
      'Runtime identity: keyless with zero project roles; live requests by driver: 0; Hosting releases: 0.',
      'The global claim makes this bootstrap operation permanently non-retryable.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      await captureUncertainInventory(bundle);
      throw new Error([
        error instanceof Error ? error.message : 'Private relay bootstrap failed.',
        'The private bundle and post-attempt inventory were preserved when available.',
        'Do not retry this saved plan or delete the global claim; reconcile from fresh evidence.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Private relay-services apply failed');
    process.exitCode = 1;
  });
}
