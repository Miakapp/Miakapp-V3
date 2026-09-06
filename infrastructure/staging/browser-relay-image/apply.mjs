import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRelayImageClaim } from './claim.mjs';
import {
  buildRelayImageResult,
  inspectPublishedRelayImage,
  submitRelayImageBuild,
  validateCompletedRelayImageBuild,
  waitForRelayImageBuild,
} from './cloud.mjs';
import {
  assertSafeRelayImageEnvironment,
  canonicalJson,
  existingRelayImageBundle,
  readRelayImageMetadata,
  readRelaySourceArchive,
  sha256,
  validateRelayImageAuthorization,
  validateRelayImageProfile,
  writePrivateFile,
} from './contract.mjs';
import { validateRelayImageRoot } from './guard.mjs';
import {
  normalizePreparedRelayImageInventory,
  observeRelayImageInventory,
  relayImageSourceReceipt,
  sameRelayImageBaseline,
  validateFinalRelayImageInventory,
  validateRelayImageBaseline,
} from './inventory.mjs';
import {
  repositoryRoot,
  validateStagingManifest,
  verifiedOperatorSession,
} from '../browser-app-check/cli.mjs';
import { verifyExactMain } from '../workload/contract.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_RELAY_IMAGE_APPLY_AUTHORIZATION';
export const RELAY_IMAGE_OPERATION_CONSUMED = true;
const RETIRED_MESSAGE =
  'The verified relay image recovery succeeded; this one-shot apply path is permanently retired';
process.umask(0o077);

async function retryReadOnly(description, operation, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => { setTimeout(resolve, 2_000); });
      }
    }
  }
  throw lastError ?? new Error(`${description} failed`);
}

async function main() {
  const profile = validateRelayImageProfile();
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./apply.sh <private-relay-image-bundle>`);
  }
  assertSafeRelayImageEnvironment(process.env, APPLY_AUTHORIZATION);
  validateRelayImageRoot(new URL('./', import.meta.url));
  validateStagingManifest();
  const bundle = existingRelayImageBundle(process.argv[2]);
  const { value: metadata, bytes: metadataBytes } = readRelayImageMetadata(
    join(bundle, 'metadata.json'),
  );
  readRelaySourceArchive(join(bundle, 'source.tar.gz'));
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  validateRelayImageAuthorization(
    process.env[APPLY_AUTHORIZATION],
    metadataBytes,
    metadata.repository_commit,
  );
  const session = await verifiedOperatorSession();
  const baseline = validateRelayImageBaseline(await observeRelayImageInventory(session));
  if (!sameRelayImageBaseline(baseline, metadata.baseline)) {
    throw new Error('Live relay image prerequisites changed after planning');
  }
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  const claimReceipt = await createRelayImageClaim(
    session,
    metadataBytes,
    metadata,
    new Date().toISOString(),
  );
  const claimed = await observeRelayImageInventory(session);
  if (!sameRelayImageBaseline(
    normalizePreparedRelayImageInventory(claimed, { claim: claimReceipt }),
    baseline,
  )) {
    throw new Error('Staging state changed after the atomic relay image claim');
  }

  const sourceReceipt = relayImageSourceReceipt(baseline);
  const prepared = await observeRelayImageInventory(session);
  if (!sameRelayImageBaseline(
    normalizePreparedRelayImageInventory(prepared, {
      claim: claimReceipt,
    }),
    baseline,
  )) {
    throw new Error('Staging state changed before the v2 relay image build');
  }
  verifyExactMain(repositoryRoot, metadata.repository_commit);

  const submitted = await submitRelayImageBuild(
    session,
    sourceReceipt,
    metadata.build_request_commitment_sha256,
  );
  process.stdout.write(`Cloud Build submitted; operation SHA-256 ${sha256(Buffer.from(submitted.operation.name, 'utf8'))}.\n`);
  const completed = await waitForRelayImageBuild(session, submitted.operation, {
    onStatus(status) {
      process.stdout.write(`Cloud Build state: ${status}\n`);
    },
  });
  const buildReceipt = validateCompletedRelayImageBuild(completed.build, sourceReceipt);
  const publication = await retryReadOnly(
    'Published relay image inspection',
    () => inspectPublishedRelayImage(session, buildReceipt),
  );
  const finalInventory = await retryReadOnly(
    'Final relay image inventory',
    async () => {
      const value = await observeRelayImageInventory(session);
      return validateFinalRelayImageInventory(value, baseline, {
        claim: claimReceipt,
        source: sourceReceipt,
        build: buildReceipt,
      });
    },
  );
  if (finalInventory.cloud_run_services.length !== 1) {
    throw new Error('Relay image build unexpectedly changed Cloud Run services');
  }
  verifyExactMain(repositoryRoot, metadata.repository_commit);

  const result = buildRelayImageResult({
    repositoryCommit: metadata.repository_commit,
    metadataSha256: sha256(metadataBytes),
    claimReceipt,
    sourceReceipt,
    operationName: submitted.operation.name,
    buildReceipt,
    publication,
    observedAt: new Date().toISOString(),
  });
  const resultPath = join(bundle, 'result.json');
  writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
  process.stdout.write([
    `Recovered verified private relay image: ${publication.digest_reference}`,
    `Compressed bytes: ${publication.compressed_bytes}`,
    `Private result: ${resultPath}`,
    'Cloud Run services created: 0; IAM bindings created: 0; public ingress created: false.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (RELAY_IMAGE_OPERATION_CONSUMED) {
    console.error(RETIRED_MESSAGE);
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Relay image apply failed');
      process.exitCode = 1;
    });
  }
}
