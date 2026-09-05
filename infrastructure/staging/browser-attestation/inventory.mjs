import { isDeepStrictEqual } from 'node:util';

import {
  APP_CHECK_SITE_KEY_SHA256,
  CLAIM_OBJECT,
  FIREBASE_APP_ID,
  HOSTING_ORIGIN,
  HOSTING_SITE,
  PREFLIGHT_METADATA_SHA256,
  PREFLIGHT_REPOSITORY_COMMIT,
  PREFLIGHT_VERSION_NAME_SHA256,
  PRIOR_CLAIM_GENERATION,
  PRIOR_CLAIM_OBJECT,
  PRIOR_CLAIM_SHA256,
  PRIOR_CLAIM_SIZE_BYTES,
  PROJECT_ID,
  PROJECT_NUMBER,
  STATE_BUCKET,
  canonicalJson,
  sha256,
} from './contract.mjs';
import {
  observeBrowserAppCheckRegistrationInventory,
  observeRecaptchaKeyRecords,
} from '../browser-app-check/inventory.mjs';

const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const VERSION_NAME = new RegExp(`^sites/${HOSTING_SITE}/versions/[0-9A-Za-z_-]{8,128}$`, 'u');
const RELEASE_NAME = new RegExp(`^sites/${HOSTING_SITE}/releases/[0-9A-Za-z_-]{8,128}$`, 'u');
const SHA256 = /^[0-9a-f]{64}$/u;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

async function responseBytes(response, description, allowEmpty = false) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if ((!allowEmpty && bytes.byteLength === 0) || bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    reject(`${description} response size is invalid`);
  }
  return bytes;
}

export async function googleJsonRequest(url, accessToken, options = {}) {
  if (typeof accessToken !== 'string' || accessToken.length < 20 || /\s/u.test(accessToken)) {
    reject('Google request requires a valid short-lived operator token');
  }
  let response;
  try {
    response = await (options.fetchImplementation ?? fetch)(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Goog-User-Project': PROJECT_ID,
        ...(options.body === undefined ? {} : { 'Content-Type': options.contentType ?? 'application/json' }),
        ...(options.headers ?? {}),
      },
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMilliseconds ?? 30_000),
    });
  } catch {
    return reject(`${options.description ?? 'Google'} request failed`);
  }
  const description = options.description ?? 'Google';
  const accepted = options.acceptedStatuses ?? [200];
  const bytes = await responseBytes(response, description, options.allowEmpty === true);
  let value = null;
  if (bytes.byteLength !== 0) {
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      return reject(`${description} returned invalid JSON`);
    }
  }
  if (!accepted.includes(response.status)) {
    reject(`${description} returned an unexpected response`);
  }
  return Object.freeze({ status: response.status, value, headers: response.headers });
}

function validateWebConfig(value) {
  if (!plainObject(value)
    || value.projectId !== PROJECT_ID
    || value.appId !== FIREBASE_APP_ID
    || value.authDomain !== `${PROJECT_ID}.firebaseapp.com`
    || value.storageBucket !== `${PROJECT_ID}.firebasestorage.app`
    || value.messagingSenderId !== PROJECT_NUMBER
    || typeof value.apiKey !== 'string'
    || !/^AIza[0-9A-Za-z_-]{30,}$/u.test(value.apiKey)) {
    reject('Firebase Web configuration differs from the reviewed staging app');
  }
  return Object.freeze({
    apiKey: value.apiKey,
    appId: value.appId,
    authDomain: value.authDomain,
    messagingSenderId: value.messagingSenderId,
    projectId: value.projectId,
    storageBucket: value.storageBucket,
  });
}

function normalizeSite(value) {
  if (!plainObject(value)
    || ![`projects/${PROJECT_ID}/sites/${HOSTING_SITE}`, `projects/${PROJECT_NUMBER}/sites/${HOSTING_SITE}`]
      .includes(value.name)
    || value.defaultUrl !== HOSTING_ORIGIN
    || value.type !== 'DEFAULT_SITE'
    || (value.appId !== undefined && value.appId !== '' && value.appId !== FIREBASE_APP_ID)) {
    reject('Firebase Hosting site differs from the exact staging default site');
  }
  return Object.freeze({
    site: HOSTING_SITE,
    type: value.type,
    default_url: value.defaultUrl,
    app_id: value.appId ?? null,
  });
}

function normalizeVersions(value) {
  if (!plainObject(value)
    || Object.keys(value).some((key) => !['nextPageToken', 'versions'].includes(key))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')
    || (value.versions !== undefined && !Array.isArray(value.versions))) {
    reject('Firebase Hosting version inventory is malformed or incomplete');
  }
  return Object.freeze((value.versions ?? []).map((version) => {
    if (!plainObject(version) || !VERSION_NAME.test(version.name)
      || !['CREATED', 'FINALIZED', 'DELETED', 'ABANDONED'].includes(version.status)) {
      reject('Firebase Hosting version inventory contains an invalid version');
    }
    return Object.freeze({
      name: version.name,
      status: version.status,
      labels: plainObject(version.labels) ? Object.freeze({ ...version.labels }) : Object.freeze({}),
      file_count: version.fileCount ?? null,
      version_bytes: version.versionBytes ?? null,
    });
  }).sort((left, right) => left.name.localeCompare(right.name)));
}

function normalizeReleases(value) {
  if (!plainObject(value)
    || Object.keys(value).some((key) => !['nextPageToken', 'releases'].includes(key))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')
    || (value.releases !== undefined && !Array.isArray(value.releases))) {
    reject('Firebase Hosting release inventory is malformed or incomplete');
  }
  return Object.freeze((value.releases ?? []).map((release) => {
    if (!plainObject(release) || !RELEASE_NAME.test(release.name)
      || !['DEPLOY', 'ROLLBACK', 'SITE_DISABLE'].includes(release.type)
      || (release.type === 'SITE_DISABLE'
        ? release.version !== undefined && release.version !== null
        : !VERSION_NAME.test(release.version?.name ?? ''))) {
      reject('Firebase Hosting release inventory contains an invalid release');
    }
    return Object.freeze({
      name: release.name,
      type: release.type,
      version_name: release.version?.name ?? null,
      message: release.message ?? '',
      release_time: release.releaseTime,
    });
  }).sort((left, right) => left.name.localeCompare(right.name)));
}

export async function observeHostingInventory(session, fetchImplementation) {
  const token = session?.accessToken;
  const request = (url, description) => googleJsonRequest(url, token, {
    description,
    fetchImplementation,
  });
  const [site, versions, releases] = await Promise.all([
    request(
      `https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites/${HOSTING_SITE}`,
      'Firebase Hosting site inventory',
    ),
    request(
      `https://firebasehosting.googleapis.com/v1beta1/sites/${HOSTING_SITE}/versions?pageSize=100`,
      'Firebase Hosting version inventory',
    ),
    request(
      `https://firebasehosting.googleapis.com/v1beta1/sites/${HOSTING_SITE}/releases?pageSize=100`,
      'Firebase Hosting release inventory',
    ),
  ]);
  return Object.freeze({
    site: normalizeSite(site.value),
    versions: normalizeVersions(versions.value),
    releases: normalizeReleases(releases.value),
  });
}

export function validateRetiredPreflightVersion(inventory, options = {}) {
  const expectedNameSha256 = options.expectedVersionNameSha256
    ?? PREFLIGHT_VERSION_NAME_SHA256;
  const expectedRepositoryCommit = options.expectedRepositoryCommit
    ?? PREFLIGHT_REPOSITORY_COMMIT;
  if (!plainObject(inventory) || !Array.isArray(inventory.versions)
    || !SHA256.test(expectedNameSha256)
    || !/^[0-9a-f]{40}$/u.test(expectedRepositoryCommit)) {
    reject('Retired browser-attestation preflight inventory is invalid');
  }
  const matches = inventory.versions.filter(({ name }) => (
    sha256(Buffer.from(name, 'utf8')) === expectedNameSha256
  ));
  const [version] = matches;
  if (matches.length !== 1
    || version.status !== 'DELETED'
    || version.file_count !== null
    || version.version_bytes !== null
    || !isDeepStrictEqual(version.labels, {
      environment: 'staging',
      operation: 'browser-app-check-attestation',
      repository: expectedRepositoryCommit,
    })) {
    reject('Retired browser-attestation preflight version has drifted');
  }
  return version;
}

function validateClaimObject(objectName) {
  if (![CLAIM_OBJECT, PRIOR_CLAIM_OBJECT].includes(objectName)) {
    reject('Browser-attestation claim inventory object is outside the reviewed boundary');
  }
  return objectName;
}

async function operationClaimPresent(session, objectName, fetchImplementation) {
  validateClaimObject(objectName);
  const encoded = encodeURIComponent(objectName);
  const response = await googleJsonRequest(
    `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encoded}`,
    session.accessToken,
    {
      description: 'Browser-attestation operation claim inventory',
      acceptedStatuses: [200, 404],
      fetchImplementation,
    },
  );
  if (response.status === 404) return false;
  if (!plainObject(response.value)
    || response.value.bucket !== STATE_BUCKET
    || response.value.name !== objectName
    || !/^[1-9][0-9]*$/u.test(response.value.generation ?? '')) {
    reject('Browser-attestation operation claim inventory is malformed');
  }
  return true;
}

async function observeClaim(session, objectName, fetchImplementation) {
  if (!plainObject(session) || typeof session.accessToken !== 'string') {
    reject('Browser-attestation claim inventory requires a verified operator session');
  }
  validateClaimObject(objectName);
  const encoded = encodeURIComponent(objectName);
  const metadataResponse = await googleJsonRequest(
    `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encoded}`,
    session.accessToken,
    {
      description: 'Browser-attestation operation claim metadata',
      fetchImplementation,
    },
  );
  const metadata = metadataResponse.value;
  if (!plainObject(metadata)
    || metadata.bucket !== STATE_BUCKET
    || metadata.name !== objectName
    || !/^[1-9][0-9]*$/u.test(metadata.generation ?? '')
    || !/^[1-9][0-9]*$/u.test(metadata.size ?? '')
    || Number(metadata.size) > 64 * 1024) {
    reject('Browser-attestation operation claim metadata is malformed');
  }
  const contentResponse = await googleJsonRequest(
    `https://storage.googleapis.com/download/storage/v1/b/${STATE_BUCKET}/o/${encoded}?alt=media&generation=${metadata.generation}`,
    session.accessToken,
    {
      description: 'Browser-attestation operation claim contents',
      fetchImplementation,
    },
  );
  if (!plainObject(contentResponse.value)) {
    reject('Browser-attestation operation claim contents are malformed');
  }
  const bytes = Buffer.from(canonicalJson(contentResponse.value), 'utf8');
  if (bytes.byteLength !== Number(metadata.size)) {
    reject('Browser-attestation operation claim size differs from its immutable object metadata');
  }
  return Object.freeze({
    value: Object.freeze(contentResponse.value),
    receipt: Object.freeze({
      bucket: STATE_BUCKET,
      object: objectName,
      generation: metadata.generation,
      size_bytes: bytes.byteLength,
      sha256: sha256(bytes),
    }),
  });
}

export function observeOperationClaim(session, fetchImplementation) {
  return observeClaim(session, CLAIM_OBJECT, fetchImplementation);
}

export function observePriorOperationClaim(session, fetchImplementation) {
  return observeClaim(session, PRIOR_CLAIM_OBJECT, fetchImplementation);
}

function validatePriorOperationClaim(claim, expectedReceipt) {
  const value = claim?.value;
  if (!plainObject(value)
    || !isDeepStrictEqual(claim.receipt, expectedReceipt)
    || !isDeepStrictEqual(Object.keys(value).sort(), [
      'baseline_sha256',
      'created_at',
      'deletion_authorized',
      'expires_at',
      'hosting_site',
      'maximum_attestation_attempts',
      'metadata_sha256',
      'operation',
      'project_id',
      'project_number',
      'repository_commit',
      'retry_authorized',
      'schema',
    ].sort())
    || value.schema !== 'miakapp.staging-browser-attestation-claim/1'
    || value.operation !== 'attest-browser-app-check-and-disable-hosting'
    || value.project_id !== PROJECT_ID
    || value.project_number !== PROJECT_NUMBER
    || value.hosting_site !== HOSTING_SITE
    || value.repository_commit !== PREFLIGHT_REPOSITORY_COMMIT
    || value.metadata_sha256 !== PREFLIGHT_METADATA_SHA256
    || !SHA256.test(value.baseline_sha256 ?? '')
    || typeof value.created_at !== 'string'
    || typeof value.expires_at !== 'string'
    || value.maximum_attestation_attempts !== 1
    || value.retry_authorized !== false
    || value.deletion_authorized !== false) {
    reject('Prior browser-attestation operation claim has drifted');
  }
  return claim;
}

export async function observeAttestationBaseline(session, options = {}) {
  if (!plainObject(session) || typeof session.accessToken !== 'string') {
    reject('Browser-attestation inventory requires a verified operator session');
  }
  const fetchImplementation = options.fetchImplementation;
  const expectedPriorClaimReceipt = options.expectedPriorClaimReceipt ?? Object.freeze({
    bucket: STATE_BUCKET,
    object: PRIOR_CLAIM_OBJECT,
    generation: PRIOR_CLAIM_GENERATION,
    size_bytes: PRIOR_CLAIM_SIZE_BYTES,
    sha256: PRIOR_CLAIM_SHA256,
  });
  const [appCheck, keys, hosting, webConfigResponse, priorClaim, claimPresent] = await Promise.all([
    (options.observeRegistration ?? observeBrowserAppCheckRegistrationInventory)(session),
    (options.observeKeys ?? observeRecaptchaKeyRecords)(session),
    observeHostingInventory(session, fetchImplementation),
    googleJsonRequest(
      `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps/${encodeURIComponent(FIREBASE_APP_ID)}/config`,
      session.accessToken,
      {
        description: 'Firebase Web configuration inventory',
        fetchImplementation,
      },
    ),
    (options.observePriorClaim ?? observePriorOperationClaim)(session, fetchImplementation),
    operationClaimPresent(session, CLAIM_OBJECT, fetchImplementation),
  ]);
  const firebaseConfig = validateWebConfig(webConfigResponse.value);
  if (!Array.isArray(keys) || keys.length !== 1 || !plainObject(keys[0])
    || typeof keys[0].name !== 'string') {
    reject('Browser-attestation requires exactly one authoritative reCAPTCHA key');
  }
  const siteKey = keys[0].name.split('/').at(-1);
  const expectedSiteKeySha256 = options.expectedSiteKeySha256 ?? APP_CHECK_SITE_KEY_SHA256;
  if (typeof siteKey !== 'string'
    || sha256(Buffer.from(siteKey, 'utf8')) !== expectedSiteKeySha256
    || appCheck.app_check?.site_key_sha256 !== expectedSiteKeySha256
    || appCheck.service_enforcement_records !== 0
    || appCheck.debug_tokens !== 0) {
    reject('Browser-attestation App Check provider differs from the registered boundary');
  }
  validatePriorOperationClaim(priorClaim, expectedPriorClaimReceipt);
  const retiredVersion = validateRetiredPreflightVersion(hosting, {
    expectedVersionNameSha256: options.expectedPreflightVersionNameSha256,
    expectedRepositoryCommit: options.expectedPreflightRepositoryCommit,
  });
  const baseline = Object.freeze({
    hosting_site: hosting.site.site,
    hosting_site_type: hosting.site.type,
    hosting_version_count: hosting.versions.length,
    hosting_release_count: hosting.releases.length,
    firebase_app_config_sha256: sha256(Buffer.from(canonicalJson(firebaseConfig), 'utf8')),
    app_check_config_sha256: sha256(Buffer.from(canonicalJson(appCheck.app_check), 'utf8')),
    app_check_enforcement_records: appCheck.service_enforcement_records,
    debug_tokens: appCheck.debug_tokens,
    operation_claim_present: claimPresent,
    prior_operation_claim: Object.freeze({
      object: priorClaim.receipt.object,
      generation: priorClaim.receipt.generation,
      size_bytes: priorClaim.receipt.size_bytes,
      sha256: priorClaim.receipt.sha256,
    }),
    retired_preflight_version_name_sha256: sha256(Buffer.from(retiredVersion.name, 'utf8')),
  });
  const expectedClaimPresent = options.operationClaimPresent ?? false;
  if (typeof expectedClaimPresent !== 'boolean'
    || baseline.hosting_version_count !== 1
    || baseline.hosting_release_count !== 0
    || baseline.operation_claim_present !== expectedClaimPresent) {
    reject('Browser-attestation requires the exact retired preflight boundary');
  }
  return Object.freeze({
    baseline,
    firebase_config: firebaseConfig,
    site_key: siteKey,
  });
}

export function sameBaseline(left, right) {
  return isDeepStrictEqual(left, right);
}
