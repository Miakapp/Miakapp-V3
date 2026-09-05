import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { buildOperationClaim } from './claim.mjs';
import {
  PROJECT_ID,
  canonicalJson,
  privateBundle,
  readAttestationMetadataForRecovery,
  writePrivateFile,
} from './contract.mjs';
import { validateBrowserAttestationRoot } from './guard.mjs';
import { observeHostingInventory, observeOperationClaim } from './inventory.mjs';
import {
  buildRecoveryMetadata,
  createRecoveryBundle,
  recoveryAuthorization,
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

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_BROWSER_ATTESTATION_RECOVERY_CONFIRMATION';
export const BROWSER_ATTESTATION_OPERATION_CONSUMED = true;
const RETIRED_MESSAGE =
  'The browser-attestation Hosting state is fully retired; this recovery planner is permanently retired';
process.umask(0o077);

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./recovery-plan.sh <private-attestation-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact staging recovery target`);
  }
  validateBrowserAttestationRoot(new URL('./', import.meta.url));
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const sourceBundle = privateBundle(process.argv[2], repositoryRoot);
  const source = readAttestationMetadataForRecovery(join(sourceBundle, 'metadata.json'));
  const session = await verifiedOperatorSession();
  const [claim, hostingInventory] = await Promise.all([
    observeOperationClaim(session),
    observeHostingInventory(session),
  ]);
  const expectedClaim = buildOperationClaim(source.bytes, source.value);
  if (!isDeepStrictEqual(claim.value, expectedClaim)) {
    throw new Error('Live operation claim differs from the exact source attestation plan');
  }
  verifyExactMain(repositoryRoot, repositoryCommit);

  const bundle = createRecoveryBundle(sourceBundle);
  const metadata = buildRecoveryMetadata({
    repositoryCommit,
    sourceMetadata: source.value,
    sourceMetadataBytes: source.bytes,
    createdAt: new Date().toISOString(),
    claim,
    hostingInventory,
  });
  const metadataBytes = Buffer.from(canonicalJson(metadata), 'utf8');
  writePrivateFile(join(bundle, 'recovery-metadata.json'), metadataBytes, 0o400);
  verifyExactMain(repositoryRoot, repositoryCommit);
  process.stdout.write([
    `Private browser-attestation recovery bundle: ${bundle}`,
    `Source browser-attestation bundle: ${sourceBundle}`,
    `Interrupted version status: ${metadata.summary.version_status ?? 'absent'}`,
    `Authorization: ${recoveryAuthorization(metadataBytes, repositoryCommit)}`,
    'Recovery is limited to one SITE_DISABLE release and deletion of at most the one exact labelled version.',
    'The Hosting site, operation claim and App Check provider cannot be deleted or modified.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (BROWSER_ATTESTATION_OPERATION_CONSUMED) {
    console.error(RETIRED_MESSAGE);
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Browser-attestation recovery planning failed');
      process.exitCode = 1;
    });
  }
}
