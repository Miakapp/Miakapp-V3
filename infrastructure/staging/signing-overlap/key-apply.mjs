import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  KEY_NAME,
  PROJECT_ID,
  SIGNING_OVERLAP_PLAN_SHA256,
  VERSION_2_NAME,
  assertSafeEnvironment,
  canonicalJson,
  readKeyVersionPlanMetadata,
  sha256,
  validateKeyVersionAuthorization,
  validateSigningOverlapPlan,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  createSigningClaim,
  observePinnedSigningClaim,
  observeSigningClaimAbsent,
} from './claim.mjs';
import {
  repositoryRoot,
  validateStagingManifest,
  verifiedOperatorSession,
} from './cli.mjs';
import { validateSigningOverlapRoot } from './guard.mjs';
import {
  inventorySha256,
  observeSigningInventory,
  validateKeyCreationBaseline,
  validateKeyCreationResult,
} from './inventory.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_SIGNING_KEY_APPLY_AUTHORIZATION';
const APPLY_MARKER = 'apply-mutation-attempted.json';
const KMS_MARKER = 'kms-version-creation-attempted.json';
process.umask(0o077);

function reject(message) {
  throw new Error(message);
}

function privateBundle(path) {
  const bundle = realpathSync(resolve(path));
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, bundle);
  const entry = lstatSync(bundle);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    reject('Signing-key apply requires an exact private bundle outside the repository');
  }
  return bundle;
}

function durablePrivateJson(bundle, name, value) {
  const path = join(bundle, name);
  writePrivateFile(path, Buffer.from(canonicalJson(value), 'utf8'), 0o400);
  for (const target of [path, bundle]) {
    const descriptor = openSync(target, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
  return path;
}

function writeAttemptMarker(bundle, name, metadata, stage) {
  return durablePrivateJson(bundle, name, Object.freeze({
    schema: `miakapp.staging-signing-overlap-${stage}-attempt/1`,
    operation: 'create-second-signing-key-version',
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    reviewed_plan_sha256: SIGNING_OVERLAP_PLAN_SHA256,
    baseline_sha256: metadata.baseline_sha256,
    expected_created_version: VERSION_2_NAME,
    attempted_at: new Date().toISOString(),
    retry_authorized: false,
    deletion_authorized: false,
  }));
}

function preserveApiFailure(bundle, result) {
  if (result.status === 200 || existsSync(join(bundle, 'kms-version-create.log'))) return;
  writePrivateFile(
    join(bundle, 'kms-version-create.log'),
    result.bytes.length === 0
      ? Buffer.from(`KMS creation returned HTTP ${result.status} without diagnostics\n`)
      : result.bytes,
    0o400,
  );
}

export async function invokeKmsVersionCreation(session, fetchImpl = globalThis.fetch) {
  if (session === null || typeof session !== 'object'
    || typeof session.accessToken !== 'string'
    || session.accessToken.length < 20
    || /\s/u.test(session.accessToken)
    || typeof fetchImpl !== 'function') {
    reject('KMS version creation requires a verified ephemeral operator session');
  }
  let response;
  try {
    response = await fetchImpl(
      `https://cloudkms.googleapis.com/v1/${KEY_NAME}/cryptoKeyVersions`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
          'X-Goog-User-Project': PROJECT_ID,
        },
        body: '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    reject('The single KMS version creation request outcome is unknown and must not be retried');
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    reject('The single KMS version creation response is unreadable and must not be retried');
  }
  if (bytes.byteLength > 64 * 1024) {
    reject('The single KMS version creation response is oversized and must not be retried');
  }
  return Object.freeze({ status: response.status, bytes });
}

async function observeConvergence(email, baseline) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return validateKeyCreationResult(observeSigningInventory(email), baseline);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    }
  }
  throw lastError;
}

function buildResult({ metadata, gateClaim, attemptClaim, inventory, apiStatus }) {
  const version = inventory.versions[1];
  return Object.freeze({
    schema: 'miakapp.staging-signing-key-version-result/1',
    operation: 'create-second-signing-key-version',
    state: 'version_2_enabled_runtime_unchanged',
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    reviewed_plan_sha256: SIGNING_OVERLAP_PLAN_SHA256,
    plan_metadata_sha256: sha256(Buffer.from(canonicalJson(metadata), 'utf8')),
    baseline_sha256: metadata.baseline_sha256,
    global_gate_claim: gateClaim,
    global_attempt_claim: attemptClaim,
    kms_api_reported_success: apiStatus === 200,
    final_inventory_sha256: inventorySha256(inventory),
    created_version: Object.freeze({
      name: version.name,
      version: version.version,
      state: version.state,
      algorithm: version.algorithm,
      protection_level: version.protection_level,
      create_time: version.create_time,
      generate_time: version.generate_time,
      public_jwk: version.public_jwk,
    }),
    kms_version_creations: 1,
    coordination_objects_created: 2,
    runtime_changed: false,
    terraform_state_changed: false,
    existing_version_changed: false,
    public_ingress_changed: false,
    live_requests_performed: 0,
    signatures_performed: 0,
    private_bundle_committed: false,
    credential_material_committed: false,
    automatic_retry_performed: false,
  });
}

async function captureUncertainInventory(bundle, email) {
  try {
    const inventory = observeSigningInventory(email);
    if (!existsSync(join(bundle, 'uncertain-inventory.json'))) {
      writePrivateFile(
        join(bundle, 'uncertain-inventory.json'),
        Buffer.from(canonicalJson(inventory), 'utf8'),
        0o400,
      );
    }
  } catch {
    // Preserve the primary failure; authoritative inventory remains independently readable.
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./key-apply.sh <private-bundle>`);
  }
  assertSafeEnvironment(process.env, APPLY_AUTHORIZATION);
  validateSigningOverlapRoot(new URL('./', import.meta.url));
  validateSigningOverlapPlan();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  if (existsSync(join(bundle, APPLY_MARKER)) || existsSync(join(bundle, KMS_MARKER))) {
    reject('This signing-key bundle has attempted a mutation and must never be retried');
  }
  const { bytes: metadataBytes, value: metadata } = readKeyVersionPlanMetadata(
    join(bundle, 'metadata.json'),
  );
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  validateKeyVersionAuthorization(
    process.env[APPLY_AUTHORIZATION],
    metadataBytes,
    metadata.repository_commit,
  );
  const session = await verifiedOperatorSession();
  const [gateAbsent, attemptAbsent] = await Promise.all([
    observeSigningClaimAbsent(session, 'gate'),
    observeSigningClaimAbsent(session, 'attempt'),
  ]);
  if (!isDeepStrictEqual(metadata.claims_before, {
    gate: gateAbsent,
    attempt: attemptAbsent,
  })) {
    reject('Live signing-overlap claims differ from the reviewed absent baseline');
  }
  const baseline = validateKeyCreationBaseline(observeSigningInventory(session.email));
  if (!isDeepStrictEqual(baseline, metadata.baseline)) {
    reject('Live signing inventory differs from the exact planned baseline');
  }
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  writeAttemptMarker(bundle, APPLY_MARKER, metadata, 'apply');
  const gateClaim = await createSigningClaim(session, 'gate', metadata);
  await observePinnedSigningClaim(session, 'gate', gateClaim, metadata);
  const secondBaseline = validateKeyCreationBaseline(observeSigningInventory(session.email));
  if (!isDeepStrictEqual(secondBaseline, baseline)) {
    reject('Signing inventory changed after the gate claim and before the irreversible boundary');
  }
  await observeSigningClaimAbsent(session, 'attempt');
  const attemptClaim = await createSigningClaim(session, 'attempt', metadata, gateClaim);
  await observePinnedSigningClaim(session, 'attempt', attemptClaim, metadata, gateClaim);
  writeAttemptMarker(bundle, KMS_MARKER, metadata, 'kms-version-creation');

  let createResult;
  try {
    createResult = await invokeKmsVersionCreation(session);
    preserveApiFailure(bundle, createResult);
    const inventory = await observeConvergence(session.email, baseline);
    const result = buildResult({
      metadata,
      gateClaim,
      attemptClaim,
      inventory,
      apiStatus: createResult.status,
    });
    const resultPath = join(bundle, 'result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      createResult.status === 200
        ? 'The exact second staging signing-key version was created and converged.'
        : 'The API reported an error, but authoritative inventory proves exact version 2 convergence.',
      `Private result: ${resultPath}`,
      `Created version: ${result.created_version.name}`,
      `Public JWK x: ${result.created_version.public_jwk.x}`,
      'Runtime and Terraform state unchanged; ingress internal-only; live requests and signatures: 0.',
      'Do not rerun this bundle or delete either global coordination claim.',
      '',
    ].join('\n'));
  } catch (error) {
    await captureUncertainInventory(bundle, session.email);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Signing-key creation failed');
    process.exitCode = 1;
  });
}
