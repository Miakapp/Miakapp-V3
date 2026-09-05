import { isDeepStrictEqual } from 'node:util';

import {
  HOSTING_HEADERS,
  HOSTING_ORIGIN,
  HOSTING_SITE,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  RUNNER_URL,
  sha256,
} from './contract.mjs';
import { googleJsonRequest } from './inventory.mjs';

const VERSION_NAME = new RegExp(`^sites/${HOSTING_SITE}/versions/[0-9A-Za-z_-]{8,128}$`, 'u');
const RELEASE_NAME = new RegExp(`^sites/${HOSTING_SITE}/releases/[0-9A-Za-z_-]{8,128}$`, 'u');
const DEPLOY_MESSAGE = 'Miakapp V4 bounded interactive browser App Check attestation v6';
const DISABLE_MESSAGE = 'Miakapp V4 interactive browser App Check attestation v6 retired';
const MAXIMUM_STORED_ARTIFACT_BYTES = 1024 * 1024;

function request(session, url, options = {}) {
  return googleJsonRequest(url, session.accessToken, options);
}

export function hostingLabels(repositoryCommit) {
  return Object.freeze({
    environment: 'staging',
    operation: 'browser-app-check-attestation-v6',
    repository: repositoryCommit,
  });
}

function servingConfig(repositoryCommit) {
  return Object.freeze({
    config: Object.freeze({
      headers: Object.freeze([Object.freeze({
        glob: '**',
        headers: HOSTING_HEADERS,
      })]),
    }),
    labels: hostingLabels(repositoryCommit),
  });
}

function validateVersion(value, status, repositoryCommit) {
  if (value?.status !== status || !VERSION_NAME.test(value?.name ?? '')
    || !isDeepStrictEqual(value.labels, servingConfig(repositoryCommit).labels)) {
    throw new Error(`Firebase Hosting version did not reach exact ${status} state`);
  }
  const headerRules = value.config?.headers;
  if (!Array.isArray(headerRules) || headerRules.length !== 1
    || headerRules[0]?.glob !== '**'
    || !isDeepStrictEqual(headerRules[0].headers, HOSTING_HEADERS)) {
    throw new Error('Firebase Hosting version security headers have drifted');
  }
  return value;
}

export async function createHostingVersion(session, repositoryCommit, fetchImplementation) {
  const response = await request(
    session,
    `https://firebasehosting.googleapis.com/v1beta1/sites/${HOSTING_SITE}/versions`,
    {
      method: 'POST',
      body: JSON.stringify(servingConfig(repositoryCommit)),
      description: 'Firebase Hosting attestation version creation',
      fetchImplementation,
    },
  );
  return validateVersion(response.value, 'CREATED', repositoryCommit).name;
}

export async function populateHostingVersion(
  session,
  versionName,
  artifactEntries,
  fetchImplementation,
) {
  if (!VERSION_NAME.test(versionName)) throw new Error('Firebase Hosting version name is invalid');
  const files = Object.fromEntries(artifactEntries.map((entry) => [entry.path, entry.gzip_sha256]));
  const response = await request(
    session,
    `https://firebasehosting.googleapis.com/v1beta1/${versionName}:populateFiles`,
    {
      method: 'POST',
      body: JSON.stringify({ files }),
      description: 'Firebase Hosting attestation file population',
      fetchImplementation,
    },
  );
  const value = response.value;
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).some((key) => !['uploadRequiredHashes', 'uploadUrl'].includes(key))) {
    throw new Error('Firebase Hosting file-population response is malformed');
  }
  const required = value.uploadRequiredHashes ?? [];
  const uploadUrl = response.value?.uploadUrl;
  const known = new Set(artifactEntries.map(({ gzip_sha256: hash }) => hash));
  const expectedUploadUrl =
    `https://upload-firebasehosting.googleapis.com/upload/${versionName}/files`;
  if (value.uploadRequiredHashes === null
    || !Array.isArray(required) || new Set(required).size !== required.length
    || required.some((hash) => !known.has(hash))
    || (required.length > 0 && uploadUrl !== expectedUploadUrl)
    || (required.length === 0
      && ![undefined, '', expectedUploadUrl].includes(uploadUrl))) {
    throw new Error('Firebase Hosting requested an unreviewed artifact upload');
  }
  for (const hash of required) {
    const entry = artifactEntries.find(({ gzip_sha256: candidate }) => candidate === hash);
    await uploadHostingFile(session, `${uploadUrl}/${hash}`, entry.gzip, fetchImplementation);
  }
  return Object.freeze({
    required_uploads: required.length,
    upload_url_present: uploadUrl === expectedUploadUrl,
    file_count: artifactEntries.length,
  });
}

async function uploadHostingFile(session, url, bytes, fetchImplementation) {
  let response;
  try {
    response = await (fetchImplementation ?? fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'X-Goog-User-Project': 'miakapp-v4-staging',
      },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Firebase Hosting artifact upload failed');
  }
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200 || responseBytes.byteLength > 64 * 1024) {
    throw new Error('Firebase Hosting artifact upload returned an unexpected response');
  }
}

export async function finalizeHostingVersion(
  session,
  versionName,
  repositoryCommit,
  artifact,
  fetchImplementation,
) {
  const response = await request(
    session,
    `https://firebasehosting.googleapis.com/v1beta1/${versionName}?update_mask=status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'FINALIZED' }),
      description: 'Firebase Hosting attestation version finalization',
      fetchImplementation,
    },
  );
  const version = validateVersion(response.value, 'FINALIZED', repositoryCommit);
  const reportedFileCount = version.fileCount ?? null;
  const reportedVersionBytes = version.versionBytes ?? null;
  const fileCount = typeof reportedFileCount === 'string'
    && /^(?:0|[1-9][0-9]*)$/u.test(reportedFileCount)
    && Number(reportedFileCount) <= artifact.file_count
    ? reportedFileCount
    : null;
  const versionBytes = typeof reportedVersionBytes === 'string'
    && /^(?:0|[1-9][0-9]*)$/u.test(reportedVersionBytes)
    && Number(reportedVersionBytes) <= MAXIMUM_STORED_ARTIFACT_BYTES
    ? reportedVersionBytes
    : null;
  return Object.freeze({
    file_count: fileCount,
    version_bytes: versionBytes,
    metrics_within_reviewed_bounds:
      (reportedFileCount === null || fileCount !== null)
      && (reportedVersionBytes === null || versionBytes !== null),
  });
}

export async function releaseHostingVersion(session, versionName, fetchImplementation) {
  const response = await request(
    session,
    `https://firebasehosting.googleapis.com/v1beta1/sites/${HOSTING_SITE}/releases?versionName=${encodeURIComponent(versionName)}`,
    {
      method: 'POST',
      body: JSON.stringify({ message: DEPLOY_MESSAGE }),
      description: 'Firebase Hosting attestation release',
      fetchImplementation,
    },
  );
  const release = response.value;
  if (!RELEASE_NAME.test(release?.name ?? '')
    || release?.type !== 'DEPLOY'
    || release?.version?.name !== versionName
    || release?.version?.status !== 'FINALIZED'
    || release?.message !== DEPLOY_MESSAGE) {
    throw new Error('Firebase Hosting attestation release response is malformed');
  }
  return Object.freeze({ name: release.name, released_at: release.releaseTime });
}

export async function disableHostingSite(session, fetchImplementation) {
  const response = await request(
    session,
    `https://firebasehosting.googleapis.com/v1beta1/sites/${HOSTING_SITE}/releases`,
    {
      method: 'POST',
      body: JSON.stringify({ type: 'SITE_DISABLE', message: DISABLE_MESSAGE }),
      description: 'Firebase Hosting attestation site disable',
      fetchImplementation,
    },
  );
  const release = response.value;
  if (!RELEASE_NAME.test(release?.name ?? '')
    || release?.type !== 'SITE_DISABLE'
    || (release?.version !== undefined && release.version !== null)
    || release?.message !== DISABLE_MESSAGE) {
    throw new Error('Firebase Hosting site-disable release response is malformed');
  }
  return Object.freeze({ name: release.name, released_at: release.releaseTime });
}

export async function deleteHostingVersion(session, versionName, fetchImplementation) {
  const response = await request(
    session,
    `https://firebasehosting.googleapis.com/v1beta1/${versionName}`,
    {
      method: 'DELETE',
      description: 'Firebase Hosting attestation version deletion',
      acceptedStatuses: [200],
      allowEmpty: true,
      fetchImplementation,
    },
  );
  if (response.value !== null && !isDeepStrictEqual(response.value, {})) {
    throw new Error('Firebase Hosting version deletion returned an unexpected body');
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validatePollingDeadline(deadlineMilliseconds) {
  const now = Date.now();
  if (!Number.isInteger(deadlineMilliseconds)
    || deadlineMilliseconds <= now
    || deadlineMilliseconds - now > MAXIMUM_PUBLIC_WINDOW_MILLISECONDS) {
    throw new Error('Firebase Hosting polling deadline is outside the reviewed bound');
  }
  return deadlineMilliseconds;
}

function requestTimeout(deadlineMilliseconds) {
  return Math.max(1, Math.min(10_000, deadlineMilliseconds - Date.now()));
}

export async function waitForRunner(
  artifactEntries,
  fetchImplementation,
  deadlineMilliseconds = Date.now() + 60_000,
) {
  if (!Array.isArray(artifactEntries) || artifactEntries.length !== 2) {
    throw new Error('Public browser-attestation verification requires both reviewed files');
  }
  const deadline = validatePollingDeadline(deadlineMilliseconds);
  for (let attempt = 0; attempt < 30 && Date.now() < deadline; attempt += 1) {
    let responses;
    try {
      responses = await Promise.all(artifactEntries.map(async (entry, index) => {
        const response = await (fetchImplementation ?? fetch)(
          `${HOSTING_ORIGIN}${entry.path}?publication=${attempt}-${index}`,
          {
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(requestTimeout(deadline)),
          },
        );
        return Object.freeze({ entry, response });
      }));
    } catch {
      responses = null;
    }
    if (responses?.every(({ response }) => response.status === 200)) {
      let contentBytes = 0;
      for (const { entry, response } of responses) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const headers = Object.fromEntries(
          Object.keys(HOSTING_HEADERS).map((name) => [name, response.headers.get(name)]),
        );
        if (bytes.byteLength !== entry.content_bytes
          || sha256(bytes) !== entry.content_sha256
          || !isDeepStrictEqual(headers, HOSTING_HEADERS)) {
          throw new Error('Public browser-attestation artifact differs from the reviewed release');
        }
        contentBytes += bytes.byteLength;
      }
      return Object.freeze({
        files_verified: responses.length,
        content_bytes_verified: contentBytes,
      });
    }
    const remaining = deadline - Date.now();
    if (attempt !== 29 && remaining > 0) await wait(Math.min(2_000, remaining));
  }
  throw new Error('Public browser-attestation artifact did not become readable in time');
}

export async function waitForDisabledRunner(
  fetchImplementation,
  deadlineMilliseconds = Date.now() + 60_000,
) {
  const deadline = validatePollingDeadline(deadlineMilliseconds);
  for (let attempt = 0; attempt < 30 && Date.now() < deadline; attempt += 1) {
    try {
      const response = await (fetchImplementation ?? fetch)(`${RUNNER_URL}?retirement=${attempt}`, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeout(deadline)),
      });
      if (response.status === 404) return;
    } catch {
      // A transient network error is not retirement evidence; poll again.
    }
    const remaining = deadline - Date.now();
    if (attempt !== 29 && remaining > 0) await wait(Math.min(2_000, remaining));
  }
  throw new Error('Browser-attestation runner remained publicly readable after site disable');
}

export const hostingMessages = Object.freeze({
  deploy: DEPLOY_MESSAGE,
  disable: DISABLE_MESSAGE,
});
