import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAndVerifyArtifact, validatePinnedPackageVersions } from './artifact.mjs';
import { runBrowserAttestation, validateBrowserPreflight } from './browser.mjs';
import { createOperationClaim } from './claim.mjs';
import {
  FIREBASE_APP_ID,
  HOSTING_SITE,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  PROJECT_ID,
  RUNNER_PATH,
  canonicalJson,
  privateBundle,
  readAttestationMetadata,
  sha256,
  validateAttestationAuthorization,
  writePrivateFile,
} from './contract.mjs';
import { validateBrowserAttestationRoot } from './guard.mjs';
import {
  createHostingVersion,
  deleteHostingVersion,
  disableHostingSite,
  finalizeHostingVersion,
  hostingMessages,
  populateHostingVersion,
  releaseHostingVersion,
  waitForDisabledRunner,
  waitForRunner,
} from './hosting.mjs';
import {
  observeAttestationBaseline,
  observeHostingInventory,
  sameBaseline,
} from './inventory.mjs';
import { observeBrowserAppCheckRegistrationInventory } from '../browser-app-check/inventory.mjs';
import {
  repositoryRoot,
  validateStagingManifest,
  verifiedOperatorSession,
} from '../browser-app-check/cli.mjs';
import {
  assertSafeWorkloadEnvironment,
  verifyExactMain,
} from '../workload/contract.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_BROWSER_ATTESTATION_APPLY_AUTHORIZATION';
process.umask(0o077);

function normalizedPostClaimBaseline(value) {
  return Object.freeze({ ...value, operation_claim_present: false });
}

async function disableWithBoundedRecovery(session) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await disableHostingSite(session);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Firebase Hosting site disable failed');
}

function validateFinalHostingInventory(inventory, versionName, deployRelease, disableRelease) {
  const versions = inventory.versions.filter(({ name }) => name === versionName);
  const deploys = inventory.releases.filter(({ name }) => name === deployRelease.name);
  const disables = inventory.releases.filter(({ name }) => name === disableRelease.name);
  if (inventory.site.site !== HOSTING_SITE
    || inventory.versions.length !== 1
    || versions.length !== 1
    || versions[0].status !== 'DELETED'
    || inventory.releases.length !== 2
    || deploys.length !== 1
    || deploys[0].type !== 'DEPLOY'
    || deploys[0].version_name !== versionName
    || deploys[0].message !== hostingMessages.deploy
    || disables.length !== 1
    || disables[0].type !== 'SITE_DISABLE'
    || disables[0].version_name !== null
    || disables[0].message !== hostingMessages.disable) {
    throw new Error('Firebase Hosting did not converge to the exact disabled post-attestation state');
  }
  return versions[0];
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateBrowserAttestationRoot(new URL('./', import.meta.url));
  validateStagingManifest();
  validateBrowserPreflight();
  const bundle = privateBundle(process.argv[2], repositoryRoot);
  const { value: metadata, bytes: metadataBytes } = readAttestationMetadata(
    join(bundle, 'metadata.json'),
  );
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  validateAttestationAuthorization(
    process.env[APPLY_AUTHORIZATION],
    metadataBytes,
    metadata.repository_commit,
  );
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
  validatePinnedPackageVersions(packageJson);
  if (sha256(readFileSync(join(repositoryRoot, 'bun.lock'))) !== metadata.dependency_lock_sha256) {
    throw new Error('Browser-attestation dependency lock differs from the reviewed plan');
  }
  const artifacts = readAndVerifyArtifact(bundle, metadata);
  const indexEntry = artifacts.find(({ path }) => path === RUNNER_PATH);
  if (indexEntry === undefined) throw new Error('Browser-attestation index artifact is missing');

  const session = await verifiedOperatorSession();
  const baseline = await observeAttestationBaseline(session);
  if (!sameBaseline(baseline.baseline, metadata.baseline)
    || sha256(Buffer.from(canonicalJson(baseline.firebase_config), 'utf8'))
      !== metadata.firebase_config_sha256) {
    throw new Error('Live browser-attestation prerequisites changed after planning');
  }
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  const claim = await createOperationClaim(session, metadataBytes, metadata);
  const postClaim = await observeAttestationBaseline(session, { operationClaimPresent: true });
  if (!sameBaseline(normalizedPostClaimBaseline(postClaim.baseline), metadata.baseline)
    || sha256(Buffer.from(canonicalJson(postClaim.firebase_config), 'utf8'))
      !== metadata.firebase_config_sha256) {
    throw new Error('Live browser-attestation prerequisites changed after the atomic claim');
  }

  let versionName;
  let deployRelease;
  let disableRelease;
  let browserResult;
  let publicStartedAt;
  let operationError;
  let cleanupError;
  let releaseAttempted = false;
  try {
    versionName = await createHostingVersion(session, metadata.repository_commit);
    await populateHostingVersion(session, versionName, artifacts);
    const finalized = await finalizeHostingVersion(
      session,
      versionName,
      metadata.repository_commit,
    );
    const acceptedStoredByteCounts = new Set([
      String(metadata.artifact.total_content_bytes),
      String(metadata.artifact.total_gzip_bytes),
    ]);
    if (finalized.fileCount !== String(metadata.artifact.file_count)
      || !acceptedStoredByteCounts.has(finalized.versionBytes)) {
      throw new Error('Finalized Hosting artifact size differs from the reviewed bundle');
    }
    publicStartedAt = Date.now();
    releaseAttempted = true;
    deployRelease = await releaseHostingVersion(session, versionName);
    await waitForRunner(indexEntry);
    browserResult = await runBrowserAttestation();
  } catch (error) {
    operationError = error;
  }

  try {
    if (releaseAttempted) disableRelease = await disableWithBoundedRecovery(session);
    if (versionName !== undefined) await deleteHostingVersion(session, versionName);
    if (releaseAttempted) await waitForDisabledRunner();
  } catch (error) {
    cleanupError = error;
  }
  if (cleanupError !== undefined) {
    throw new Error('Browser-attestation cleanup did not prove that public Hosting was disabled');
  }
  if (operationError !== undefined) {
    throw new Error('Browser-attestation execution failed after bounded Hosting cleanup');
  }
  if (versionName === undefined || deployRelease === undefined || disableRelease === undefined
    || browserResult === undefined || publicStartedAt === undefined) {
    throw new Error('Browser-attestation execution is incomplete');
  }
  const publicWindowMilliseconds = Date.now() - publicStartedAt;
  if (publicWindowMilliseconds < 0
    || publicWindowMilliseconds > MAXIMUM_PUBLIC_WINDOW_MILLISECONDS) {
    throw new Error('Browser-attestation public window exceeded the reviewed bound');
  }

  const [hosting, appCheck] = await Promise.all([
    observeHostingInventory(session),
    observeBrowserAppCheckRegistrationInventory(session),
  ]);
  const deletedVersion = validateFinalHostingInventory(
    hosting,
    versionName,
    deployRelease,
    disableRelease,
  );
  if (appCheck.service_enforcement_records !== 0 || appCheck.debug_tokens !== 0) {
    throw new Error('App Check enforcement or debug-token state changed during attestation');
  }
  verifyExactMain(repositoryRoot, metadata.repository_commit);

  const result = Object.freeze({
    schema: 'miakapp.staging-browser-attestation-result/1',
    operation: metadata.operation,
    project_id: PROJECT_ID,
    project_number: metadata.project_number,
    repository_commit: metadata.repository_commit,
    completed_at: new Date().toISOString(),
    operation_claim: claim,
    hosting: Object.freeze({
      site: HOSTING_SITE,
      runner_path: RUNNER_PATH,
      artifact_files: metadata.artifact.file_count,
      artifact_content_bytes: metadata.artifact.total_content_bytes,
      version_name_sha256: sha256(Buffer.from(versionName, 'utf8')),
      version_status: deletedVersion.status,
      deploy_release_name_sha256: sha256(Buffer.from(deployRelease.name, 'utf8')),
      disable_release_name_sha256: sha256(Buffer.from(disableRelease.name, 'utf8')),
      releases_created: hosting.releases.length,
      site_disabled: true,
      runner_route_present: false,
      public_window_milliseconds: publicWindowMilliseconds,
    }),
    browser: browserResult,
    app_check: Object.freeze({
      firebase_app_id: FIREBASE_APP_ID,
      provider: 'recaptcha-enterprise',
      real_browser_attestation: true,
      maximum_assessments: 1,
      enforcement_records: appCheck.service_enforcement_records,
      debug_tokens: appCheck.debug_tokens,
    }),
    firebase_auth_used: false,
    control_plane_public_ingress_changed: false,
    credential_material_returned_to_driver: false,
    browser_storage_persisted: false,
  });
  const resultBytes = Buffer.from(canonicalJson(result), 'utf8');
  writePrivateFile(join(bundle, 'result.json'), resultBytes, 0o400);
  process.stdout.write([
    'The bounded real-browser App Check attestation succeeded and Hosting was disabled.',
    `Private result: ${join(bundle, 'result.json')}`,
    `Result SHA-256: ${sha256(resultBytes)}`,
    `Public window: ${publicWindowMilliseconds} ms`,
    'No token, Firebase user, control-plane request, debug provider or enforcement change was retained.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Browser-attestation apply failed');
    process.exitCode = 1;
  });
}
