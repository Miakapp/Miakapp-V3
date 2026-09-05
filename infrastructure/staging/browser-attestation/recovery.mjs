import { timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
} from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  HOSTING_SITE,
  PROJECT_ID,
  PROJECT_NUMBER,
  canonicalJson,
  readPrivateFile,
  sha256,
} from './contract.mjs';
import { hostingLabels, hostingMessages } from './hosting.mjs';
import {
  validateRetiredAttestationReleases,
  validateRetiredPreflightVersions,
} from './inventory.mjs';

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const GENERATION = /^[1-9][0-9]*$/u;
const VERSION_NAME = new RegExp(`^sites/${HOSTING_SITE}/versions/[0-9A-Za-z_-]{8,128}$`, 'u');
const RECOVERY_TTL_MILLISECONDS = 2 * 60 * 60 * 1_000;
const MAXIMUM_METADATA_BYTES = 64 * 1024;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exactKeys(value, keys, description) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${description} must contain exactly the reviewed fields`);
  }
  return value;
}

function canonicalTimestamp(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

export function validateInterruptedHostingInventory(inventory, sourceMetadata, options = {}) {
  if (!plainObject(inventory)
    || inventory.site?.site !== HOSTING_SITE
    || inventory.site?.type !== 'DEFAULT_SITE'
    || !Array.isArray(inventory.versions)
    || !Array.isArray(inventory.releases)
    || inventory.versions.length < 5
    || inventory.versions.length > 6
    || inventory.releases.length < 4
    || inventory.releases.length > 7) {
    reject('Browser-attestation recovery inventory exceeds the reviewed historical-plus-v6 boundary');
  }
  const historicalVersions = validateRetiredPreflightVersions(inventory, options);
  const historicalReleases = validateRetiredAttestationReleases(
    inventory,
    historicalVersions,
    options,
  );
  const historicalNames = new Set(historicalVersions.map(({ name }) => name));
  const historicalReleaseNames = new Set(historicalReleases.map(({ name }) => name));
  const currentVersions = inventory.versions.filter(({ name }) => !historicalNames.has(name));
  if (currentVersions.length > 1) {
    reject('Browser-attestation recovery found more than one v6 Hosting version');
  }
  const [version] = currentVersions;
  if (version !== undefined
    && (!VERSION_NAME.test(version.name)
      || !['CREATED', 'FINALIZED', 'DELETED', 'ABANDONED'].includes(version.status)
      || !isDeepStrictEqual(version.labels, hostingLabels(sourceMetadata.repository_commit)))) {
    reject('Browser-attestation recovery found an unreviewed Hosting version');
  }
  let deployReleaseCount = 0;
  let disableReleaseCount = 0;
  let latestRelease = null;
  const currentReleases = inventory.releases.filter(({ name }) => (
    !historicalReleaseNames.has(name)
  ));
  let deployReleaseTime = null;
  const sourceCreatedAt = Date.parse(sourceMetadata.created_at);
  if (!Number.isFinite(sourceCreatedAt)) {
    reject('Browser-attestation recovery source metadata has an invalid creation time');
  }
  for (const release of currentReleases) {
    const releasedAt = Date.parse(release.release_time);
    if (!Number.isFinite(releasedAt) || releasedAt < sourceCreatedAt) {
      reject('Browser-attestation recovery found a release without a valid timestamp');
    }
    if (latestRelease === null || releasedAt > latestRelease.released_at) {
      latestRelease = { type: release.type, released_at: releasedAt };
    }
    if (release.type === 'DEPLOY') {
      deployReleaseCount += 1;
      deployReleaseTime = releasedAt;
      if (release.version_name !== version?.name
        || release.message !== hostingMessages.deploy) {
        reject('Browser-attestation recovery found an unreviewed deploy release');
      }
    } else if (release.type === 'SITE_DISABLE') {
      disableReleaseCount += 1;
      if (release.version_name !== null || release.message !== hostingMessages.disable) {
        reject('Browser-attestation recovery found an unreviewed site-disable release');
      }
    } else {
      reject('Browser-attestation recovery found an unreviewed release type');
    }
  }
  if (deployReleaseCount > 1 || disableReleaseCount > 2
    || (deployReleaseCount === 0 && disableReleaseCount !== 0)
    || (deployReleaseTime !== null && currentReleases.some((release) => (
      release.type === 'SITE_DISABLE' && Date.parse(release.release_time) <= deployReleaseTime
    )))
    || (currentReleases.length > 0 && version === undefined)) {
    reject('Browser-attestation recovery release counts exceed the reviewed boundary');
  }
  return Object.freeze({
    version_name: version?.name ?? null,
    version_status: version?.status ?? null,
    delete_version: version !== undefined && version.status !== 'DELETED',
    site_disable_required: latestRelease?.type === 'DEPLOY',
    deploy_release_count: deployReleaseCount,
    disable_release_count: disableReleaseCount,
  });
}

export function createRecoveryBundle(sourceBundle) {
  const entry = lstatSync(sourceBundle);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0) {
    reject('Browser-attestation recovery requires a private source bundle');
  }
  const bundle = mkdtempSync(join(sourceBundle, 'recovery-'));
  chmodSync(bundle, 0o700);
  return bundle;
}

export function buildRecoveryMetadata({
  repositoryCommit,
  sourceMetadata,
  sourceMetadataBytes,
  createdAt,
  claim,
  hostingInventory,
}, inventoryValidationOptions = {}) {
  const created = canonicalTimestamp(createdAt, 'Browser-attestation recovery creation time');
  const summary = validateInterruptedHostingInventory(
    hostingInventory,
    sourceMetadata,
    inventoryValidationOptions,
  );
  if (!COMMIT.test(repositoryCommit)
    || !Buffer.isBuffer(sourceMetadataBytes)
    || sourceMetadataBytes.byteLength === 0
    || !GENERATION.test(claim?.receipt?.generation ?? '')
    || !SHA256.test(claim?.receipt?.sha256 ?? '')) {
    reject('Browser-attestation recovery metadata inputs are invalid');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-attestation-recovery-plan/6',
    operation: 'disable-and-delete-interrupted-browser-attestation-v6',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    hosting_site: HOSTING_SITE,
    repository_commit: repositoryCommit,
    source_repository_commit: sourceMetadata.repository_commit,
    source_metadata_sha256: sha256(sourceMetadataBytes),
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + RECOVERY_TTL_MILLISECONDS).toISOString(),
    claim_generation: claim.receipt.generation,
    claim_sha256: claim.receipt.sha256,
    hosting_inventory_sha256: sha256(
      Buffer.from(canonicalJson(hostingInventory), 'utf8'),
    ),
    summary,
    safety: Object.freeze({
      maximum_site_disable_attempts: summary.site_disable_required ? 1 : 0,
      maximum_versions_deleted: summary.delete_version ? 1 : 0,
      hosting_site_deletion_authorized: false,
      operation_claim_deletion_authorized: false,
      app_check_mutation_authorized: false,
      browser_invocation_authorized: false,
      control_plane_invocation_authorized: false,
    }),
  });
}

export function validateRecoveryMetadata(value, now = Date.now()) {
  const metadata = exactKeys(value, [
    'claim_generation',
    'claim_sha256',
    'created_at',
    'expires_at',
    'hosting_inventory_sha256',
    'hosting_site',
    'operation',
    'project_id',
    'project_number',
    'repository_commit',
    'safety',
    'schema',
    'source_metadata_sha256',
    'source_repository_commit',
    'summary',
  ], 'Browser-attestation recovery metadata');
  const summary = exactKeys(metadata.summary, [
    'delete_version',
    'deploy_release_count',
    'disable_release_count',
    'site_disable_required',
    'version_name',
    'version_status',
  ], 'Browser-attestation recovery summary');
  const safety = exactKeys(metadata.safety, [
    'app_check_mutation_authorized',
    'browser_invocation_authorized',
    'control_plane_invocation_authorized',
    'hosting_site_deletion_authorized',
    'maximum_site_disable_attempts',
    'maximum_versions_deleted',
    'operation_claim_deletion_authorized',
  ], 'Browser-attestation recovery safety');
  const created = canonicalTimestamp(metadata.created_at, 'Browser-attestation recovery creation time');
  const expires = canonicalTimestamp(metadata.expires_at, 'Browser-attestation recovery expiry time');
  if (metadata.schema !== 'miakapp.staging-browser-attestation-recovery-plan/6'
    || metadata.operation !== 'disable-and-delete-interrupted-browser-attestation-v6'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.hosting_site !== HOSTING_SITE
    || !COMMIT.test(metadata.repository_commit)
    || !COMMIT.test(metadata.source_repository_commit)
    || !SHA256.test(metadata.source_metadata_sha256)
    || !GENERATION.test(metadata.claim_generation)
    || !SHA256.test(metadata.claim_sha256)
    || !SHA256.test(metadata.hosting_inventory_sha256)
    || expires - created !== RECOVERY_TTL_MILLISECONDS
    || !Number.isFinite(now) || now < created || now >= expires
    || (summary.version_name !== null && !VERSION_NAME.test(summary.version_name))
    || ![null, 'CREATED', 'FINALIZED', 'DELETED', 'ABANDONED'].includes(summary.version_status)
    || typeof summary.delete_version !== 'boolean'
    || typeof summary.site_disable_required !== 'boolean'
    || !Number.isInteger(summary.deploy_release_count)
    || summary.deploy_release_count < 0 || summary.deploy_release_count > 1
    || !Number.isInteger(summary.disable_release_count)
    || summary.disable_release_count < 0 || summary.disable_release_count > 2
    || (summary.version_name === null) !== (summary.version_status === null)
    || (summary.deploy_release_count === 0 && summary.site_disable_required)
    || summary.delete_version !== (summary.version_name !== null
      && summary.version_status !== 'DELETED')
    || !isDeepStrictEqual(safety, {
      maximum_site_disable_attempts: summary.site_disable_required ? 1 : 0,
      maximum_versions_deleted: summary.delete_version ? 1 : 0,
      hosting_site_deletion_authorized: false,
      operation_claim_deletion_authorized: false,
      app_check_mutation_authorized: false,
      browser_invocation_authorized: false,
      control_plane_invocation_authorized: false,
    })) {
    reject('Browser-attestation recovery metadata differs from the reviewed operation');
  }
  return metadata;
}

export function readRecoveryMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, MAXIMUM_METADATA_BYTES);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    reject('Browser-attestation recovery metadata is invalid JSON');
  }
  validateRecoveryMetadata(value, now);
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser-attestation recovery metadata is not canonical JSON');
  }
  return Object.freeze({ value, bytes });
}

export function recoveryAuthorization(metadataBytes, repositoryCommit) {
  if (!Buffer.isBuffer(metadataBytes) || metadataBytes.byteLength === 0
    || !COMMIT.test(repositoryCommit)) {
    reject('Browser-attestation recovery authorization inputs are invalid');
  }
  return `recover-interactive-browser-app-check-attestation-v6:${PROJECT_ID}:${sha256(metadataBytes)}:${repositoryCommit}`;
}

export function validateRecoveryAuthorization(value, metadataBytes, repositoryCommit) {
  const expected = Buffer.from(recoveryAuthorization(metadataBytes, repositoryCommit), 'utf8');
  const actual = Buffer.from(typeof value === 'string' ? value : '', 'utf8');
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    reject('Exact staging browser-attestation recovery authorization is missing or invalid');
  }
}
