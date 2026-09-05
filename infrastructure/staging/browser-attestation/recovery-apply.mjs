import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { buildOperationClaim } from './claim.mjs';
import {
  HOSTING_SITE,
  PROJECT_ID,
  canonicalJson,
  privateBundle,
  readAttestationMetadataForRecovery,
  sha256,
  writePrivateFile,
} from './contract.mjs';
import { validateBrowserAttestationRoot } from './guard.mjs';
import {
  deleteHostingVersion,
  disableHostingSite,
  waitForDisabledRunner,
} from './hosting.mjs';
import { observeHostingInventory, observeOperationClaim } from './inventory.mjs';
import {
  readRecoveryMetadata,
  validateInterruptedHostingInventory,
  validateRecoveryAuthorization,
} from './recovery.mjs';
import {
  repositoryRoot,
  validateStagingManifest,
  verifiedOperatorSession,
} from '../browser-app-check/cli.mjs';
import {
  assertSafeWorkloadEnvironment,
  verifyExactMain,
} from '../workload/contract.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_BROWSER_ATTESTATION_RECOVERY_AUTHORIZATION';
const ATTEMPT_MARKER = 'recovery-attempted.json';
process.umask(0o077);

function persistAttemptMarker(bundle, metadata) {
  const marker = Object.freeze({
    schema: 'miakapp.staging-browser-attestation-recovery-attempt/5',
    operation: metadata.operation,
    project_id: PROJECT_ID,
    repository_commit: metadata.repository_commit,
    source_metadata_sha256: metadata.source_metadata_sha256,
    claim_generation: metadata.claim_generation,
    hosting_inventory_sha256: metadata.hosting_inventory_sha256,
    attempted_at: new Date().toISOString(),
    maximum_site_disable_attempts: metadata.safety.maximum_site_disable_attempts,
    maximum_versions_deleted: metadata.safety.maximum_versions_deleted,
    retry_authorized: false,
  });
  const path = join(bundle, ATTEMPT_MARKER);
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

function validatePostRecoveryInventory(after, metadata, sourceMetadata, disableRelease) {
  const summary = validateInterruptedHostingInventory(after, sourceMetadata);
  const expectedDisableCount = metadata.summary.disable_release_count
    + (metadata.summary.site_disable_required ? 1 : 0);
  if (summary.version_name !== metadata.summary.version_name
    || (summary.version_name !== null && summary.version_status !== 'DELETED')
    || summary.delete_version
    || summary.deploy_release_count !== metadata.summary.deploy_release_count
    || summary.disable_release_count !== expectedDisableCount
    || summary.site_disable_required) {
    throw new Error('Browser-attestation recovery did not converge to the exact disabled state');
  }
  if (metadata.summary.site_disable_required) {
    const matches = after.releases.filter(({ name }) => name === disableRelease?.name);
    if (matches.length !== 1 || matches[0].type !== 'SITE_DISABLE') {
      throw new Error('Browser-attestation recovery site-disable release is missing');
    }
  } else if (disableRelease !== undefined) {
    throw new Error('Browser-attestation recovery created an unplanned site-disable release');
  }
  return summary;
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./recovery-apply.sh <private-recovery-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateBrowserAttestationRoot(new URL('./', import.meta.url));
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2], repositoryRoot);
  if (existsSync(join(bundle, ATTEMPT_MARKER))) {
    throw new Error('This browser-attestation recovery bundle was already attempted');
  }
  const recovery = readRecoveryMetadata(join(bundle, 'recovery-metadata.json'));
  verifyExactMain(repositoryRoot, recovery.value.repository_commit);
  validateRecoveryAuthorization(
    process.env[APPLY_AUTHORIZATION],
    recovery.bytes,
    recovery.value.repository_commit,
  );
  const sourceBundle = privateBundle(dirname(bundle), repositoryRoot);
  const source = readAttestationMetadataForRecovery(join(sourceBundle, 'metadata.json'));
  if (sha256(source.bytes) !== recovery.value.source_metadata_sha256
    || source.value.repository_commit !== recovery.value.source_repository_commit) {
    throw new Error('Browser-attestation recovery source bundle differs from the reviewed plan');
  }

  const session = await verifiedOperatorSession();
  const [claim, before] = await Promise.all([
    observeOperationClaim(session),
    observeHostingInventory(session),
  ]);
  if (!isDeepStrictEqual(claim.value, buildOperationClaim(source.bytes, source.value))
    || claim.receipt.generation !== recovery.value.claim_generation
    || claim.receipt.sha256 !== recovery.value.claim_sha256
    || sha256(Buffer.from(canonicalJson(before), 'utf8'))
      !== recovery.value.hosting_inventory_sha256
    || !isDeepStrictEqual(
      validateInterruptedHostingInventory(before, source.value),
      recovery.value.summary,
    )) {
    throw new Error('Live browser-attestation recovery boundary changed after planning');
  }
  verifyExactMain(repositoryRoot, recovery.value.repository_commit);
  persistAttemptMarker(bundle, recovery.value);

  let disableRelease;
  if (recovery.value.summary.site_disable_required) {
    disableRelease = await disableHostingSite(session);
  }
  if (recovery.value.summary.delete_version) {
    await deleteHostingVersion(session, recovery.value.summary.version_name);
  }
  await waitForDisabledRunner();

  const after = await observeHostingInventory(session);
  const summary = validatePostRecoveryInventory(
    after,
    recovery.value,
    source.value,
    disableRelease,
  );
  verifyExactMain(repositoryRoot, recovery.value.repository_commit);
  const result = Object.freeze({
    schema: 'miakapp.staging-browser-attestation-recovery-result/5',
    operation: recovery.value.operation,
    project_id: PROJECT_ID,
    repository_commit: recovery.value.repository_commit,
    completed_at: new Date().toISOString(),
    hosting: Object.freeze({
      site: HOSTING_SITE,
      site_disabled: true,
      runner_route_present: false,
      version_name_sha256: summary.version_name === null
        ? null
        : sha256(Buffer.from(summary.version_name, 'utf8')),
      version_status: summary.version_status,
      site_disable_release_sha256: disableRelease === undefined
        ? null
        : sha256(Buffer.from(disableRelease.name, 'utf8')),
    }),
    operation_claim_deleted: false,
    app_check_mutated: false,
    browser_invoked: false,
    control_plane_invoked: false,
  });
  const resultBytes = Buffer.from(canonicalJson(result), 'utf8');
  writePrivateFile(join(bundle, 'recovery-result.json'), resultBytes, 0o400);
  process.stdout.write([
    'The interrupted browser-attestation Hosting state was safely retired.',
    `Private result: ${join(bundle, 'recovery-result.json')}`,
    `Result SHA-256: ${sha256(resultBytes)}`,
    'The Hosting site and operation claim were retained; App Check and the control plane were unchanged.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Browser-attestation recovery failed');
    process.exitCode = 1;
  });
}
