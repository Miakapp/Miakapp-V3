import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RELAY_IMAGE_PROFILE_SHA256,
  assertSafeRelayImageEnvironment,
  buildRelayImageMetadata,
  canonicalJson,
  createRelayImageBundle,
  relayImageAuthorization,
  sha256,
  validateRelayImageProfile,
  writePrivateFile,
} from './contract.mjs';
import { validateRelayImageRoot } from './guard.mjs';
import {
  observeRelayImageInventory,
  validateRelayImageBaseline,
} from './inventory.mjs';
import { buildRelaySourceArchive } from './source.mjs';
import {
  repositoryRoot,
  validateStagingManifest,
  verifiedOperatorSession,
} from '../browser-app-check/cli.mjs';
import { verifyExactMain } from '../workload/contract.mjs';

const PLAN_CONFIRMATION = 'MIAKAPP_STAGING_RELAY_IMAGE_PLAN_CONFIRMATION';
export const RELAY_IMAGE_OPERATION_CONSUMED = true;
const RETIRED_MESSAGE =
  'The verified relay image recovery succeeded; this one-shot planner is permanently retired';
process.umask(0o077);

async function main() {
  const profile = validateRelayImageProfile();
  if (process.argv.length !== 4 || process.argv[2] === undefined || process.argv[3] === undefined) {
    throw new Error(`Usage: ${PLAN_CONFIRMATION}=${profile.project.project_id} ./plan.sh <private-parent> <Miakapp-Server-root>`);
  }
  assertSafeRelayImageEnvironment(process.env, PLAN_CONFIRMATION);
  if (process.env[PLAN_CONFIRMATION] !== profile.project.project_id) {
    throw new Error(`Set ${PLAN_CONFIRMATION}=${profile.project.project_id} to acknowledge the exact staging target`);
  }
  validateRelayImageRoot(new URL('./', import.meta.url));
  validateStagingManifest();
  const repositoryCommit = verifyExactMain(repositoryRoot);
  const source = buildRelaySourceArchive(process.argv[3]);
  const session = await verifiedOperatorSession();
  const baseline = validateRelayImageBaseline(await observeRelayImageInventory(session));
  verifyExactMain(repositoryRoot, repositoryCommit);
  const verifiedSource = buildRelaySourceArchive(process.argv[3]);
  if (!isDeepStrictEqual(
    { ...source, archive: undefined },
    { ...verifiedSource, archive: undefined },
  ) || !source.archive.equals(verifiedSource.archive)) {
    throw new Error('Miakapp-Server source changed during relay image planning');
  }

  const bundle = createRelayImageBundle(process.argv[2]);
  writePrivateFile(join(bundle, 'source.tar.gz'), source.archive, 0o400);
  const metadata = buildRelayImageMetadata({
    repositoryCommit,
    createdAt: new Date().toISOString(),
    baseline,
    archiveBytes: source.archive,
  });
  const metadataBytes = Buffer.from(canonicalJson(metadata), 'utf8');
  writePrivateFile(join(bundle, 'metadata.json'), metadataBytes, 0o400);
  verifyExactMain(repositoryRoot, repositoryCommit);

  process.stdout.write([
    `Private relay-image bundle: ${bundle}`,
    `Profile SHA-256: ${RELAY_IMAGE_PROFILE_SHA256}`,
    `Metadata SHA-256: ${sha256(metadataBytes)}`,
    `Source archive: ${source.archive_bytes} bytes; SHA-256 ${source.archive_sha256}`,
    `Authorization: ${relayImageAuthorization(metadataBytes, repositoryCommit)}`,
    'Planned boundary: one v2 verified E2_MEDIUM Cloud Build from the existing immutable source, one private image tag, no Cloud Run or IAM mutation.',
    'The distinct atomic claim and existing source object are retained; the operation cannot retry, upload source, or delete them.',
    '',
  ].join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (RELAY_IMAGE_OPERATION_CONSUMED) {
    console.error(RETIRED_MESSAGE);
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : 'Relay image planning failed');
      process.exitCode = 1;
    });
  }
}
