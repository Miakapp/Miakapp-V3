import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_ID,
  attestationAuthorization,
  buildAttestationMetadata,
  canonicalJson,
  privateBundle,
  sha256,
  writePrivateFile,
} from './contract.mjs';
import { buildAttestationArtifact, validatePinnedPackageVersions } from './artifact.mjs';
import { validateBrowserAttestationRoot } from './guard.mjs';
import { observeAttestationBaseline } from './inventory.mjs';
import {
  repositoryRoot,
  validateStagingManifest,
  verifiedOperatorSession,
} from '../browser-app-check/cli.mjs';
import {
  assertSafeWorkloadEnvironment,
  verifyExactMain,
} from '../workload/contract.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_BROWSER_ATTESTATION_PLAN_CONFIRMATION';
const root = fileURLToPath(new URL('./', import.meta.url));
export const BROWSER_ATTESTATION_OPERATION_CONSUMED = true;
const RETIRED_MESSAGE =
  'The real system-browser App Check prerequisite is complete; this one-shot planner is permanently retired';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./plan.sh <private-parent>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact staging target`);
  }
  validateBrowserAttestationRoot(new URL('./', import.meta.url));
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
  validatePinnedPackageVersions(packageJson);
  const dependencyLockSha256 = sha256(readFileSync(join(repositoryRoot, 'bun.lock')));
  const session = await verifiedOperatorSession();
  const observed = await observeAttestationBaseline(session);
  verifyExactMain(repositoryRoot, repositoryCommit);

  const bundle = privateBundle(process.argv[2], repositoryRoot, true);
  const built = await buildAttestationArtifact(
    bundle,
    observed.firebase_config,
    observed.site_key,
  );
  if (built.firebase_config_sha256 !== observed.baseline.firebase_app_config_sha256) {
    throw new Error('Built browser artifact does not contain the observed Firebase Web configuration');
  }
  const metadata = buildAttestationMetadata({
    repositoryCommit,
    createdAt: new Date().toISOString(),
    baseline: observed.baseline,
    firebaseConfigSha256: built.firebase_config_sha256,
    dependencyLockSha256,
    artifact: built.artifact,
  });
  const metadataBytes = Buffer.from(canonicalJson(metadata), 'utf8');
  writePrivateFile(join(bundle, 'metadata.json'), metadataBytes, 0o400);
  verifyExactMain(repositoryRoot, repositoryCommit);

  process.stdout.write([
    `Private browser-attestation bundle: ${bundle}`,
    `Metadata SHA-256: ${sha256(metadataBytes)}`,
    `Artifact files: ${metadata.artifact.file_count}; compressed bytes: ${metadata.artifact.total_gzip_bytes}`,
    `Authorization: ${attestationAuthorization(metadataBytes, repositoryCommit)}`,
    'Planned boundary: one default macOS system-browser attestation, at most five public minutes, then SITE_DISABLE and version deletion.',
    'Apply opens the runner once and accepts one challenge-bound semantic result through an ephemeral 127.0.0.1 listener before its absolute two-minute observation deadline.',
    'Firebase Auth, control-plane ingress, App Check enforcement and debug providers remain unchanged.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (BROWSER_ATTESTATION_OPERATION_CONSUMED) {
    console.error(RETIRED_MESSAGE);
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Browser-attestation planning failed');
      process.exitCode = 1;
    });
  }
}
