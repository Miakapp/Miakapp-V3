import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { readAndVerifyArtifact, validatePinnedPackageVersions } from './artifact.mjs';
import {
  createBrowserChallenge,
  interactiveRunnerUrl,
  readBrowserAttestation,
  sanitizedBrowserResult,
  validateBrowserPreflight,
} from './browser.mjs';
import { createOperationClaim } from './claim.mjs';
import {
  FIREBASE_APP_ID,
  HOSTING_SITE,
  INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS,
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
  hostingLabels,
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
  validateRetiredAttestationReleases,
  validateRetiredPreflightVersions,
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

function throwIfInterrupted(signal) {
  if (signal.aborted) throw new Error('Interactive browser attestation was interrupted');
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

function validateFinalHostingInventory(
  inventory,
  versionName,
  repositoryCommit,
  deployRelease,
  disableRelease,
) {
  const retiredVersions = validateRetiredPreflightVersions(inventory);
  const retiredReleases = validateRetiredAttestationReleases(inventory, retiredVersions);
  const retiredVersionNames = new Set(retiredVersions.map(({ name }) => name));
  const retiredReleaseNames = new Set(retiredReleases.map(({ name }) => name));
  const versions = inventory.versions.filter(({ name }) => !retiredVersionNames.has(name));
  const releases = inventory.releases.filter(({ name }) => !retiredReleaseNames.has(name));
  const deploys = releases.filter(({ name }) => name === deployRelease.name);
  const disables = releases.filter(({ name }) => name === disableRelease.name);
  if (inventory.site.site !== HOSTING_SITE
    || inventory.versions.length !== 5
    || versions.length !== 1
    || versions[0].name !== versionName
    || versions[0].status !== 'DELETED'
    || versions[0].file_count !== null
    || versions[0].version_bytes !== null
    || !isDeepStrictEqual(versions[0].labels, hostingLabels(repositoryCommit))
    || inventory.releases.length !== 4
    || releases.length !== 2
    || deploys.length !== 1
    || deploys[0].type !== 'DEPLOY'
    || deploys[0].version_name !== versionName
    || deploys[0].message !== hostingMessages.deploy
    || disables.length !== 1
    || disables[0].type !== 'SITE_DISABLE'
    || disables[0].version_name !== null
    || disables[0].message !== hostingMessages.disable) {
    throw new Error('Firebase Hosting did not converge to the exact disabled v5 state');
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
  if (!artifacts.some(({ path }) => path === RUNNER_PATH)) {
    throw new Error('Browser-attestation index artifact is missing');
  }

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

  const interruption = new AbortController();
  const interrupt = () => interruption.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);

  let versionName;
  let deployRelease;
  let disableRelease;
  let browserResult;
  let finalizedMetrics;
  let publicArtifactEvidence;
  let publicStartedAt;
  let interactiveDeadline;
  let operationError;
  let cleanupError;
  let failureStage = 'hosting_version_creation';
  let releaseAttempted = false;
  try {
    throwIfInterrupted(interruption.signal);
    versionName = await createHostingVersion(session, metadata.repository_commit);
    throwIfInterrupted(interruption.signal);
    failureStage = 'hosting_file_population';
    await populateHostingVersion(session, versionName, artifacts);
    throwIfInterrupted(interruption.signal);
    failureStage = 'hosting_version_finalization';
    finalizedMetrics = await finalizeHostingVersion(
      session,
      versionName,
      metadata.repository_commit,
      metadata.artifact,
    );
    throwIfInterrupted(interruption.signal);
    failureStage = 'hosting_version_release';
    publicStartedAt = Date.now();
    interactiveDeadline = publicStartedAt + INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS;
    releaseAttempted = true;
    deployRelease = await releaseHostingVersion(session, versionName);
    throwIfInterrupted(interruption.signal);
    failureStage = 'public_artifact_verification';
    publicArtifactEvidence = await waitForRunner(artifacts, undefined, interactiveDeadline);
    throwIfInterrupted(interruption.signal);
    failureStage = 'interactive_browser_attestation';
    const challenge = createBrowserChallenge();
    const runnerUrl = interactiveRunnerUrl(challenge);
    process.stdout.write([
      'INTERACTIVE_BROWSER_READY',
      `Runner URL: ${runnerUrl}`,
      `Observation deadline: ${new Date(interactiveDeadline).toISOString()}`,
      'Open the exact URL in the connected interactive browser, await window.__MIAKAPP_BROWSER_ATTESTATION__, then send JSON.stringify(result) as one terminal line.',
      'The runner returns only semantic evidence; never paste or return an App Check token.',
      '',
    ].join('\n'));
    browserResult = await readBrowserAttestation(
      process.stdin,
      challenge,
      interactiveDeadline,
      { signal: interruption.signal },
    );
    if (browserResult.state !== 'passed') {
      throw new Error('Interactive browser App Check attestation returned the closed failure shape');
    }
  } catch (error) {
    operationError = error;
  }

  try {
    if (releaseAttempted) disableRelease = await disableWithBoundedRecovery(session);
    if (versionName !== undefined) await deleteHostingVersion(session, versionName);
    if (releaseAttempted) {
      await waitForDisabledRunner(
        undefined,
        publicStartedAt + MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
      );
    }
  } catch (error) {
    cleanupError = error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  const publicWindowMilliseconds = publicStartedAt === undefined
    ? null
    : Date.now() - publicStartedAt;
  if (cleanupError !== undefined) {
    throw new Error('Browser-attestation cleanup did not prove that public Hosting was disabled');
  }
  if (publicWindowMilliseconds !== null
    && (publicWindowMilliseconds < 0
      || publicWindowMilliseconds > MAXIMUM_PUBLIC_WINDOW_MILLISECONDS)) {
    failureStage = 'public_window_boundary';
    operationError = new Error('Browser-attestation public window exceeded the reviewed bound');
  }
  if (operationError !== undefined) {
    const failure = Object.freeze({
      schema: 'miakapp.staging-browser-attestation-failure/5',
      operation: metadata.operation,
      state: 'failed_after_bounded_cleanup',
      project_id: PROJECT_ID,
      repository_commit: metadata.repository_commit,
      completed_at: new Date().toISOString(),
      failed_stage: failureStage,
      operation_claim: claim,
      hosting: Object.freeze({
        version_created: versionName !== undefined,
        version_name_sha256: versionName === undefined
          ? null
          : sha256(Buffer.from(versionName, 'utf8')),
        finalization_response_validated: finalizedMetrics !== undefined,
        finalized_metrics: finalizedMetrics ?? null,
        release_attempted: releaseAttempted,
        deploy_response_validated: deployRelease !== undefined,
        public_artifacts_validated: publicArtifactEvidence !== undefined,
        site_disable_response_validated: disableRelease !== undefined,
        version_delete_response_validated: versionName !== undefined,
        runner_404_validated: releaseAttempted,
        public_window_milliseconds: publicWindowMilliseconds,
      }),
      interactive_browser_requested: failureStage === 'interactive_browser_attestation',
      interactive_observation_received: browserResult !== undefined,
      interactive_observation_state: browserResult?.state ?? null,
      challenge_retained: false,
      firebase_auth_used: false,
      control_plane_invoked: false,
      credential_material_retained: false,
      retry_authorized: false,
    });
    const failureBytes = Buffer.from(canonicalJson(failure), 'utf8');
    const failurePath = join(bundle, 'failure.json');
    writePrivateFile(failurePath, failureBytes, 0o400);
    throw new Error(
      `Browser-attestation execution failed after bounded Hosting cleanup; private evidence: ${failurePath}`,
    );
  }
  if (versionName === undefined || deployRelease === undefined || disableRelease === undefined
    || browserResult === undefined || finalizedMetrics === undefined
    || publicArtifactEvidence === undefined || publicWindowMilliseconds === null
    || interactiveDeadline === undefined) {
    throw new Error('Browser-attestation execution is incomplete');
  }

  const [hosting, appCheck] = await Promise.all([
    observeHostingInventory(session),
    observeBrowserAppCheckRegistrationInventory(session),
  ]);
  const deletedVersion = validateFinalHostingInventory(
    hosting,
    versionName,
    metadata.repository_commit,
    deployRelease,
    disableRelease,
  );
  if (appCheck.service_enforcement_records !== 0 || appCheck.debug_tokens !== 0) {
    throw new Error('App Check enforcement or debug-token state changed during attestation');
  }
  verifyExactMain(repositoryRoot, metadata.repository_commit);

  const result = Object.freeze({
    schema: 'miakapp.staging-browser-attestation-result/5',
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
      artifact_files_verified: publicArtifactEvidence.files_verified,
      artifact_content_bytes_verified: publicArtifactEvidence.content_bytes_verified,
      finalized_file_count: finalizedMetrics.file_count,
      finalized_version_bytes: finalizedMetrics.version_bytes,
      finalized_metrics_within_reviewed_bounds:
        finalizedMetrics.metrics_within_reviewed_bounds,
      version_name_sha256: sha256(Buffer.from(versionName, 'utf8')),
      version_status: deletedVersion.status,
      deploy_release_name_sha256: sha256(Buffer.from(deployRelease.name, 'utf8')),
      disable_release_name_sha256: sha256(Buffer.from(disableRelease.name, 'utf8')),
      operation_releases_created: 2,
      total_historical_releases: hosting.releases.length,
      site_disabled: true,
      runner_route_present: false,
      interactive_deadline_milliseconds: interactiveDeadline - publicStartedAt,
      public_window_milliseconds: publicWindowMilliseconds,
    }),
    browser: sanitizedBrowserResult(browserResult),
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
    persistent_browser_profile_required: false,
  });
  const resultBytes = Buffer.from(canonicalJson(result), 'utf8');
  writePrivateFile(join(bundle, 'result.json'), resultBytes, 0o400);
  process.stdout.write([
    'The bounded interactive-browser App Check attestation succeeded and Hosting was disabled.',
    `Private result: ${join(bundle, 'result.json')}`,
    `Result SHA-256: ${sha256(resultBytes)}`,
    `Public window: ${publicWindowMilliseconds} ms`,
    'No token, Firebase user, raw browser error, control-plane request, debug provider or enforcement change was retained.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Browser-attestation apply failed');
    process.exitCode = 1;
  });
}
