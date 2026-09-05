import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_ID,
  assertSafeEnvironment,
  buildKeyVersionPlanMetadata,
  canonicalJson,
  createPrivateBundle,
  keyVersionAuthorization,
  validateSigningOverlapPlan,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import { observeSigningClaimAbsent } from './claim.mjs';
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
} from './inventory.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_SIGNING_KEY_PLAN_CONFIRMATION';
export const KEY_VERSION_CREATION_CONSUMED = true;
const RETIRED_MESSAGE =
  'Signing-key version 2 already converged; this one-shot planning entrypoint is permanently retired';
process.umask(0o077);

async function main() {
  if (KEY_VERSION_CREATION_CONSUMED) throw new Error(RETIRED_MESSAGE);
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${PROJECT_ID} ./key-plan.sh <private-parent>`);
  }
  assertSafeEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== PROJECT_ID) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${PROJECT_ID} to acknowledge the exact staging target`);
  }
  validateSigningOverlapRoot(new URL('./', import.meta.url));
  validateSigningOverlapPlan();
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const session = await verifiedOperatorSession();
  const [gateClaim, attemptClaim] = await Promise.all([
    observeSigningClaimAbsent(session, 'gate'),
    observeSigningClaimAbsent(session, 'attempt'),
  ]);
  const baseline = validateKeyCreationBaseline(observeSigningInventory(session.email));
  verifyExactMain(repositoryRoot, repositoryCommit);
  const bundle = createPrivateBundle(process.argv[2], repositoryRoot);
  const metadata = buildKeyVersionPlanMetadata({
    repositoryCommit,
    createdAt: new Date().toISOString(),
    baseline,
  });
  if (!isDeepStrictEqual(metadata.claims_before, {
    gate: gateClaim,
    attempt: attemptClaim,
  })) {
    throw new Error('Live signing-overlap claim baseline differs from the reviewed absent state');
  }
  const metadataBytes = Buffer.from(canonicalJson(metadata), 'utf8');
  writePrivateFile(join(bundle, 'metadata.json'), metadataBytes, 0o400);
  verifyExactMain(repositoryRoot, repositoryCommit);
  process.stdout.write([
    `Private signing-key bundle: ${bundle}`,
    `Baseline SHA-256: ${metadata.baseline_sha256}`,
    `Inventory SHA-256: ${inventorySha256(baseline)}`,
    `Authorization: ${keyVersionAuthorization(metadataBytes, repositoryCommit)}`,
    'Planned delta: one software Ed25519 key version and two private atomic coordination objects.',
    'Runtime, Terraform state, IAM, ingress and live application requests remain unchanged.',
    'The KMS creation has no automatic retry; projected recurring increment: USD 0.06/month.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Signing-key planning failed');
    process.exitCode = 1;
  });
}
