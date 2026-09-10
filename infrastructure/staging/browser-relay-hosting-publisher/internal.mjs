import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';

import {
  BROWSER_RELAY_HOSTING_API_ORIGIN,
  BROWSER_RELAY_HOSTING_DEPLOY_MESSAGE,
  BROWSER_RELAY_HOSTING_DISABLE_MESSAGE,
  BROWSER_RELAY_HOSTING_HEADERS,
  BROWSER_RELAY_HOSTING_INVENTORY_PAGE_SIZE,
  BROWSER_RELAY_HOSTING_LABELS,
  BROWSER_RELAY_HOSTING_MAXIMUM_FILE_BYTES,
  BROWSER_RELAY_HOSTING_MAXIMUM_JSON_BYTES,
  BROWSER_RELAY_HOSTING_MAXIMUM_POLL_ATTEMPTS,
  BROWSER_RELAY_HOSTING_MAXIMUM_POLL_INTERVAL_MILLISECONDS,
  BROWSER_RELAY_HOSTING_REQUEST_TIMEOUT_MILLISECONDS,
  BROWSER_RELAY_HOSTING_SITE,
  BROWSER_RELAY_HOSTING_TARGET,
  BROWSER_RELAY_HOSTING_UPLOAD_ORIGIN,
  rejectBrowserRelayHostingPublisher,
  sha256,
  validateBrowserRelayHostingPublisherProfile,
} from './contract.mjs';
import { PROJECT_ID } from '../workload/contract.mjs';

const IMPLEMENTATION_KEYS = Object.freeze(['clock', 'fetch', 'wait']);
const ARTIFACT_KEYS = Object.freeze([
  'content_bytes', 'content_sha256', 'content_type', 'gzip', 'gzip_bytes',
  'gzip_sha256', 'path', 'raw',
]);
const CONTEXT_KEYS = Object.freeze([
  'callback_deadline_milliseconds', 'deadline_milliseconds',
  'opened_at_milliseconds', 'signal',
]);
const VERSION_NAME = new RegExp(
  `^sites/${BROWSER_RELAY_HOSTING_SITE}/versions/[0-9A-Za-z_-]{8,128}$`,
  'u',
);
const RELEASE_NAME = new RegExp(
  `^sites/${BROWSER_RELAY_HOSTING_SITE}/releases/[0-9A-Za-z_-]{8,128}$`,
  'u',
);
const JAVASCRIPT_PATH =
  /^\/__acceptance\/browser-relay\/assets\/browser-relay-[0-9A-Za-z_-]+\.js$/u;
const SITE_URL =
  `${BROWSER_RELAY_HOSTING_API_ORIGIN}/v1beta1/projects/${PROJECT_ID}/sites/${BROWSER_RELAY_HOSTING_SITE}`;
const VERSIONS_URL =
  `${BROWSER_RELAY_HOSTING_API_ORIGIN}/v1beta1/sites/${BROWSER_RELAY_HOSTING_SITE}/versions`;
const RELEASES_URL =
  `${BROWSER_RELAY_HOSTING_API_ORIGIN}/v1beta1/sites/${BROWSER_RELAY_HOSTING_SITE}/releases`;
const VERSION_INVENTORY_URL = `${VERSIONS_URL}?pageSize=${BROWSER_RELAY_HOSTING_INVENTORY_PAGE_SIZE}`;
const RELEASE_INVENTORY_URL = `${RELEASES_URL}?pageSize=${BROWSER_RELAY_HOSTING_INVENTORY_PAGE_SIZE}`;
const SERVING_CONFIG = Object.freeze({
  config: Object.freeze({
    headers: Object.freeze([Object.freeze({
      glob: '**',
      headers: BROWSER_RELAY_HOSTING_HEADERS,
    })]),
  }),
  labels: BROWSER_RELAY_HOSTING_LABELS,
});

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, code = 'invalid_configuration') {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    rejectBrowserRelayHostingPublisher(code);
  }
  return value;
}

function overwrite(value) {
  if (!Buffer.isBuffer(value)) return;
  try {
    value.fill(0);
  } catch {
    // Response buffers are best-effort transient storage.
  }
}

function validateSession(value) {
  const session = exactKeys(value, ['accessToken']);
  if (typeof session.accessToken !== 'string' || session.accessToken.length < 20
    || session.accessToken.length > 16 * 1024 || /\s/u.test(session.accessToken)) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  return Object.freeze({ accessToken: session.accessToken });
}

function validateImplementations(value) {
  const implementations = exactKeys(value, IMPLEMENTATION_KEYS);
  if (IMPLEMENTATION_KEYS.some((key) => typeof implementations[key] !== 'function')) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  const boundary = Object.freeze({
    clock: implementations.clock,
    fetch: implementations.fetch,
    wait: implementations.wait,
  });
  let instant;
  try {
    instant = boundary.clock();
  } catch {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  if (!Number.isSafeInteger(instant) || instant < 0) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  return Object.freeze({ boundary, instant });
}

function cloneArtifactEntries(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    rejectBrowserRelayHostingPublisher('invalid_artifact');
  }
  const entries = value.map((candidate, index) => {
    const entry = exactKeys(candidate, ARTIFACT_KEYS, 'invalid_artifact');
    const html = index === 0;
    if ((html && (entry.path !== BROWSER_RELAY_HOSTING_TARGET.page_path
      || entry.content_type !== 'text/html; charset=utf-8'))
      || (!html && (!JAVASCRIPT_PATH.test(entry.path)
        || entry.content_type !== 'text/javascript; charset=utf-8'))
      || typeof entry.content_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(entry.content_sha256)
      || typeof entry.gzip_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(entry.gzip_sha256)
      || !Number.isSafeInteger(entry.content_bytes) || entry.content_bytes < 1
      || entry.content_bytes > BROWSER_RELAY_HOSTING_MAXIMUM_FILE_BYTES
      || !Number.isSafeInteger(entry.gzip_bytes) || entry.gzip_bytes < 1
      || entry.gzip_bytes > BROWSER_RELAY_HOSTING_MAXIMUM_FILE_BYTES
      || !Buffer.isBuffer(entry.raw) || !Buffer.isBuffer(entry.gzip)
      || entry.raw.byteLength !== entry.content_bytes
      || entry.gzip.byteLength !== entry.gzip_bytes
      || sha256(entry.raw) !== entry.content_sha256
      || sha256(entry.gzip) !== entry.gzip_sha256) {
      rejectBrowserRelayHostingPublisher('invalid_artifact');
    }
    let uncompressed;
    try {
      uncompressed = gunzipSync(entry.gzip, {
        maxOutputLength: BROWSER_RELAY_HOSTING_MAXIMUM_FILE_BYTES,
      });
      if (!uncompressed.equals(entry.raw)) {
        rejectBrowserRelayHostingPublisher('invalid_artifact');
      }
    } catch (error) {
      if (error?.name === 'StagingBrowserRelayHostingPublisherError') throw error;
      rejectBrowserRelayHostingPublisher('invalid_artifact');
    } finally {
      overwrite(uncompressed);
    }
    return Object.freeze({
      content_bytes: entry.content_bytes,
      content_sha256: entry.content_sha256,
      content_type: entry.content_type,
      gzip: Buffer.from(entry.gzip),
      gzip_bytes: entry.gzip_bytes,
      gzip_sha256: entry.gzip_sha256,
      path: entry.path,
      raw: Buffer.from(entry.raw),
    });
  });
  if (entries[0].path === entries[1].path
    || entries[0].content_sha256 === entries[1].content_sha256
    || entries[0].gzip_sha256 === entries[1].gzip_sha256) {
    rejectBrowserRelayHostingPublisher('invalid_artifact');
  }
  return Object.freeze(entries);
}

function validateContext(value) {
  const context = exactKeys(value, CONTEXT_KEYS);
  if (!(context.signal instanceof AbortSignal)
    || !Number.isSafeInteger(context.opened_at_milliseconds)
    || !Number.isSafeInteger(context.callback_deadline_milliseconds)
    || !Number.isSafeInteger(context.deadline_milliseconds)
    || context.opened_at_milliseconds < 0
    || context.callback_deadline_milliseconds <= context.opened_at_milliseconds
    || context.deadline_milliseconds < context.callback_deadline_milliseconds
    || context.deadline_milliseconds - context.opened_at_milliseconds > 1_200_000) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  return context;
}

function cancelResponse(response) {
  try {
    response?.body?.cancel()?.catch(() => undefined);
  } catch {
    // A fixed error code is emitted by the caller.
  }
}

async function responseBytes(response, maximum, allowEmpty, signal, code) {
  const contentLength = response?.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined
    && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) || Number(contentLength) > maximum)) {
    cancelResponse(response);
    rejectBrowserRelayHostingPublisher(code);
  }
  let reader;
  try {
    reader = response?.body?.getReader();
  } catch {
    rejectBrowserRelayHostingPublisher(code);
  }
  if (reader === undefined) {
    if (allowEmpty) return Buffer.alloc(0);
    rejectBrowserRelayHostingPublisher(code);
  }
  const chunks = [];
  let size = 0;
  let complete = false;
  const cancel = () => {
    try {
      reader.cancel()?.catch?.(() => undefined);
    } catch {
      // Cancellation is best-effort; the fixed operation error remains authoritative.
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) rejectBrowserRelayHostingPublisher('aborted');
      const { done, value } = await reader.read();
      if (signal.aborted) rejectBrowserRelayHostingPublisher('aborted');
      if (done) break;
      if (!(value instanceof Uint8Array) || size + value.byteLength > maximum) {
        rejectBrowserRelayHostingPublisher(code);
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      size += chunk.byteLength;
    }
    if (!allowEmpty && size === 0) rejectBrowserRelayHostingPublisher(code);
    complete = true;
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (error?.name === 'StagingBrowserRelayHostingPublisherError') throw error;
    rejectBrowserRelayHostingPublisher(signal.aborted ? 'aborted' : code);
  } finally {
    for (const chunk of chunks) overwrite(chunk);
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    try {
      reader.releaseLock();
    } catch {
      // Reader cleanup must not replace the fixed public result or failure code.
    }
  }
}

function requestSignal(externalSignal) {
  const timeout = AbortSignal.timeout(BROWSER_RELAY_HOSTING_REQUEST_TIMEOUT_MILLISECONDS);
  if (externalSignal === undefined) return timeout;
  if (!(externalSignal instanceof AbortSignal)) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  return AbortSignal.any([externalSignal, timeout]);
}

async function dispatch(fetchImplementation, accessToken, url, options = {}) {
  const signal = requestSignal(options.signal);
  if (signal.aborted) rejectBrowserRelayHostingPublisher('aborted');
  let response;
  try {
    response = await fetchImplementation(url, {
      method: options.method ?? 'GET',
      headers: Object.freeze({
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'X-Goog-User-Project': PROJECT_ID,
        ...(options.body === undefined ? {} : {
          'Content-Type': options.contentType ?? 'application/json',
        }),
      }),
      body: options.body,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch {
    rejectBrowserRelayHostingPublisher(signal.aborted ? 'aborted' : 'invalid_response');
  }
  const bytes = await responseBytes(
    response,
    options.maximumBytes ?? BROWSER_RELAY_HOSTING_MAXIMUM_JSON_BYTES,
    options.allowEmpty === true,
    signal,
    'invalid_response',
  );
  try {
    if (!(options.acceptedStatuses ?? [200]).includes(response.status)) {
      rejectBrowserRelayHostingPublisher('invalid_response');
    }
    if (options.raw === true) return Object.freeze({ bytes, status: response.status });
    if (bytes.byteLength === 0) return Object.freeze({ status: response.status, value: null });
    let value;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      rejectBrowserRelayHostingPublisher('invalid_response');
    }
    return Object.freeze({ status: response.status, value });
  } finally {
    if (options.raw !== true) overwrite(bytes);
  }
}

async function publicDispatch(fetchImplementation, url, externalSignal, maximumBytes) {
  const signal = requestSignal(externalSignal);
  if (signal.aborted) rejectBrowserRelayHostingPublisher('aborted');
  let response;
  try {
    response = await fetchImplementation(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch {
    return null;
  }
  const bytes = await responseBytes(
    response,
    maximumBytes,
    true,
    signal,
    'verification_failed',
  );
  return Object.freeze({ bytes, headers: response.headers, status: response.status });
}

function validateSite(value) {
  if (!plainObject(value)
    || ![
      `projects/${PROJECT_ID}/sites/${BROWSER_RELAY_HOSTING_SITE}`,
      `projects/1072737219170/sites/${BROWSER_RELAY_HOSTING_SITE}`,
    ].includes(value.name)
    || value.defaultUrl !== BROWSER_RELAY_HOSTING_TARGET.origin
    || value.type !== 'DEFAULT_SITE'
    || (value.appId !== undefined
      && value.appId !== ''
      && value.appId !== '1:1072737219170:web:5053ca93bf25d7373cd73b')) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
}

function validateVersion(value, status = undefined) {
  if (!plainObject(value) || !VERSION_NAME.test(value.name ?? '')
    || !['CREATED', 'FINALIZED', 'DELETED', 'ABANDONED'].includes(value.status)
    || (status !== undefined && value.status !== status)) {
    rejectBrowserRelayHostingPublisher('invalid_response');
  }
  return value;
}

function validateManagedVersion(value, status) {
  const version = validateVersion(value, status);
  if (!isDeepStrictEqual(version.labels, BROWSER_RELAY_HOSTING_LABELS)
    || !isDeepStrictEqual(version.config, SERVING_CONFIG.config)) {
    rejectBrowserRelayHostingPublisher('invalid_response');
  }
  return version;
}

function validateVersions(value) {
  if (!plainObject(value)
    || Object.keys(value).some((key) => !['nextPageToken', 'versions'].includes(key))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')
    || (value.versions !== undefined && !Array.isArray(value.versions))) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  const versions = value.versions ?? [];
  if (versions.length > BROWSER_RELAY_HOSTING_INVENTORY_PAGE_SIZE) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  versions.forEach((version) => validateVersion(version));
  if (new Set(versions.map(({ name }) => name)).size !== versions.length) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  return versions;
}

function releaseInstant(value) {
  if (typeof value !== 'string') rejectBrowserRelayHostingPublisher('invalid_baseline');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  return milliseconds;
}

function validateReleases(value) {
  if (!plainObject(value)
    || Object.keys(value).some((key) => !['nextPageToken', 'releases'].includes(key))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')
    || !Array.isArray(value.releases) || value.releases.length === 0) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  const releases = value.releases;
  if (releases.length > BROWSER_RELAY_HOSTING_INVENTORY_PAGE_SIZE) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  for (const release of releases) {
    if (!plainObject(release) || !RELEASE_NAME.test(release.name ?? '')
      || !['DEPLOY', 'ROLLBACK', 'SITE_DISABLE'].includes(release.type)
      || (release.type === 'SITE_DISABLE'
        ? release.version !== undefined && release.version !== null
        : !VERSION_NAME.test(release.version?.name ?? ''))) {
      rejectBrowserRelayHostingPublisher('invalid_baseline');
    }
    releaseInstant(release.releaseTime);
  }
  if (new Set(releases.map(({ name }) => name)).size !== releases.length) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  if (new Set(releases.map(({ releaseTime }) => releaseTime)).size !== releases.length) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  return releases;
}

function latestRelease(releases) {
  return [...releases].sort((left, right) => (
    releaseInstant(right.releaseTime) - releaseInstant(left.releaseTime)
  ))[0];
}

async function observeManagement(fetchImplementation, accessToken, signal) {
  const [site, versions, releases] = await Promise.all([
    dispatch(fetchImplementation, accessToken, SITE_URL, { signal }),
    dispatch(fetchImplementation, accessToken, VERSION_INVENTORY_URL, { signal }),
    dispatch(fetchImplementation, accessToken, RELEASE_INVENTORY_URL, { signal }),
  ]);
  validateSite(site.value);
  return Object.freeze({
    versions: validateVersions(versions.value),
    releases: validateReleases(releases.value),
  });
}

function requireDisabledInventory(inventory, ownedVersionName = undefined) {
  const active = inventory.versions.filter(({ status }) => status !== 'DELETED');
  const latest = latestRelease(inventory.releases);
  if (active.length !== 0 || latest.type !== 'SITE_DISABLE'
    || (latest.version !== undefined && latest.version !== null)) {
    rejectBrowserRelayHostingPublisher('invalid_baseline');
  }
  if (ownedVersionName !== undefined) {
    const matches = inventory.versions.filter(({ name }) => name === ownedVersionName);
    if (matches.length !== 1 || matches[0].status !== 'DELETED') {
      rejectBrowserRelayHostingPublisher('invalid_baseline');
    }
  }
  return inventory;
}

function publicUrl(path, phase, attempt, index) {
  return `${BROWSER_RELAY_HOSTING_TARGET.origin}${path}?${phase}=${attempt}-${index}`;
}

async function routeAbsent(fetchImplementation, entries, phase, attempt, signal) {
  const responses = await Promise.all(entries.map((entry, index) => publicDispatch(
    fetchImplementation,
    publicUrl(entry.path, phase, attempt, index),
    signal,
    BROWSER_RELAY_HOSTING_MAXIMUM_JSON_BYTES,
  )));
  try {
    return responses.every((response) => response !== null && response.status === 404);
  } finally {
    for (const response of responses) overwrite(response?.bytes);
  }
}

function validateRelease(value, type, versionName, message) {
  if (!plainObject(value) || !RELEASE_NAME.test(value.name ?? '')
    || value.type !== type || value.message !== message
    || (type === 'SITE_DISABLE'
      ? value.version !== undefined && value.version !== null
      : value.version?.name !== versionName || value.version?.status !== 'FINALIZED')) {
    rejectBrowserRelayHostingPublisher('invalid_response');
  }
  releaseInstant(value.releaseTime);
  return value;
}

function publicBoundary(publishRunner, verifyRunner, removeRunner) {
  const boundary = Object.create(null);
  Object.defineProperties(boundary, {
    publishRunner: { value: publishRunner, enumerable: true },
    verifyRunner: { value: verifyRunner, enumerable: true },
    removeRunner: { value: removeRunner, enumerable: true },
  });
  return Object.freeze(boundary);
}

export function createBrowserRelayHostingPublisherForImplementation(
  sessionValue,
  artifactValue,
  implementationValue,
) {
  validateBrowserRelayHostingPublisherProfile();
  const session = validateSession(sessionValue);
  const entries = cloneArtifactEntries(artifactValue);
  const { boundary: implementations, instant: constructedAt } =
    validateImplementations(implementationValue);
  let lastInstant = constructedAt;
  let state = 'dormant';
  let windowContext;
  let versionName;
  let deployCompleted = false;
  let publicationVerified = false;
  let cleanupVerified = false;
  let active = false;
  const attempts = {
    baseline: 0,
    create: 0,
    populate: 0,
    upload: 0,
    finalize: 0,
    deploy: 0,
    public_verify: 0,
    disable: 0,
    delete: 0,
    cleanup_verify: 0,
  };

  function now() {
    let value;
    try {
      value = implementations.clock();
    } catch {
      rejectBrowserRelayHostingPublisher('invalid_configuration');
    }
    if (!Number.isSafeInteger(value) || value < lastInstant) {
      rejectBrowserRelayHostingPublisher('invalid_configuration');
    }
    lastInstant = value;
    return value;
  }

  async function exclusive(operation, code) {
    if (active) rejectBrowserRelayHostingPublisher('invalid_lifecycle');
    active = true;
    try {
      return await operation();
    } catch (error) {
      if (error?.name === 'StagingBrowserRelayHostingPublisherError') throw error;
      rejectBrowserRelayHostingPublisher(code);
    } finally {
      active = false;
    }
  }

  function requireWindow(contextValue) {
    const context = validateContext(contextValue);
    const instant = now();
    if (context.signal.aborted || instant < context.opened_at_milliseconds
      || instant > context.callback_deadline_milliseconds) {
      rejectBrowserRelayHostingPublisher('aborted');
    }
    return context;
  }

  async function observeSafeBaseline(signal) {
    attempts.baseline += 1;
    const inventory = requireDisabledInventory(await observeManagement(
      implementations.fetch,
      session.accessToken,
      signal,
    ));
    if (!await routeAbsent(implementations.fetch, entries, 'baseline', 0, signal)) {
      rejectBrowserRelayHostingPublisher('invalid_baseline');
    }
    return inventory;
  }

  async function createVersion(signal) {
    attempts.create += 1;
    const response = await dispatch(implementations.fetch, session.accessToken, VERSIONS_URL, {
      method: 'POST',
      body: JSON.stringify(SERVING_CONFIG),
      signal,
    });
    if (plainObject(response.value) && VERSION_NAME.test(response.value.name ?? '')) {
      versionName = response.value.name;
    }
    const version = validateManagedVersion(response.value, 'CREATED');
    versionName = version.name;
  }

  async function populateVersion(signal) {
    attempts.populate += 1;
    const files = Object.fromEntries(entries.map((entry) => [entry.path, entry.gzip_sha256]));
    const response = await dispatch(
      implementations.fetch,
      session.accessToken,
      `${BROWSER_RELAY_HOSTING_API_ORIGIN}/v1beta1/${versionName}:populateFiles`,
      { method: 'POST', body: JSON.stringify({ files }), signal },
    );
    const value = response.value;
    if (!plainObject(value)
      || Object.keys(value).some((key) => !['uploadRequiredHashes', 'uploadUrl'].includes(key))) {
      rejectBrowserRelayHostingPublisher('invalid_response');
    }
    const required = value.uploadRequiredHashes ?? [];
    const expectedUrl = `${BROWSER_RELAY_HOSTING_UPLOAD_ORIGIN}/upload/${versionName}/files`;
    const known = new Set(entries.map(({ gzip_sha256: hash }) => hash));
    if (value.uploadRequiredHashes === null || !Array.isArray(required)
      || new Set(required).size !== required.length
      || required.some((hash) => !known.has(hash))
      || (required.length > 0 && value.uploadUrl !== expectedUrl)
      || (required.length === 0 && ![undefined, '', expectedUrl].includes(value.uploadUrl))) {
      rejectBrowserRelayHostingPublisher('invalid_response');
    }
    for (const hash of required) {
      const entry = entries.find(({ gzip_sha256 }) => gzip_sha256 === hash);
      attempts.upload += 1;
      const uploaded = await dispatch(
        implementations.fetch,
        session.accessToken,
        `${expectedUrl}/${hash}`,
        {
          method: 'POST',
          body: entry.gzip,
          contentType: 'application/octet-stream',
          allowEmpty: true,
          raw: true,
          signal,
        },
      );
      try {
        if (uploaded.status !== 200) rejectBrowserRelayHostingPublisher('invalid_response');
      } finally {
        overwrite(uploaded.bytes);
      }
    }
  }

  async function finalizeVersion(signal) {
    attempts.finalize += 1;
    const response = await dispatch(
      implementations.fetch,
      session.accessToken,
      `${BROWSER_RELAY_HOSTING_API_ORIGIN}/v1beta1/${versionName}?update_mask=status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'FINALIZED' }),
        signal,
      },
    );
    const version = validateManagedVersion(response.value, 'FINALIZED');
    if (version.fileCount !== undefined
      && (!/^(?:0|[1-9][0-9]*)$/u.test(version.fileCount)
        || Number(version.fileCount) !== entries.length)) {
      rejectBrowserRelayHostingPublisher('invalid_response');
    }
    if (version.versionBytes !== undefined
      && (!/^(?:0|[1-9][0-9]*)$/u.test(version.versionBytes)
        || Number(version.versionBytes) > BROWSER_RELAY_HOSTING_MAXIMUM_FILE_BYTES * 2)) {
      rejectBrowserRelayHostingPublisher('invalid_response');
    }
  }

  async function deployVersion(signal) {
    attempts.deploy += 1;
    const response = await dispatch(
      implementations.fetch,
      session.accessToken,
      `${RELEASES_URL}?versionName=${encodeURIComponent(versionName)}`,
      {
        method: 'POST',
        body: JSON.stringify({ message: BROWSER_RELAY_HOSTING_DEPLOY_MESSAGE }),
        signal,
      },
    );
    validateRelease(
      response.value,
      'DEPLOY',
      versionName,
      BROWSER_RELAY_HOSTING_DEPLOY_MESSAGE,
    );
    deployCompleted = true;
  }

  async function publishRunner(contextValue) {
    return exclusive(async () => {
      if (state !== 'dormant') rejectBrowserRelayHostingPublisher('invalid_lifecycle');
      const context = requireWindow(contextValue);
      windowContext = context;
      state = 'publishing';
      try {
        await observeSafeBaseline(context.signal);
        await createVersion(context.signal);
        await populateVersion(context.signal);
        await finalizeVersion(context.signal);
        await deployVersion(context.signal);
        state = 'published';
        return true;
      } catch (error) {
        state = 'forward_failed';
        if (error?.name === 'StagingBrowserRelayHostingPublisherError') throw error;
        rejectBrowserRelayHostingPublisher('publication_failed');
      }
    }, 'publication_failed');
  }

  async function verifyPublicFiles() {
    for (let attempt = 0;
      attempt < BROWSER_RELAY_HOSTING_MAXIMUM_POLL_ATTEMPTS;
      attempt += 1) {
      attempts.public_verify += 1;
      const responses = await Promise.all(entries.map((entry, index) => publicDispatch(
        implementations.fetch,
        publicUrl(entry.path, 'publication', attempt, index),
        windowContext.signal,
        BROWSER_RELAY_HOSTING_MAXIMUM_FILE_BYTES,
      )));
      let retry = false;
      try {
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index];
          const response = responses[index];
          if (response === null || response.status !== 200) {
            retry = true;
            continue;
          }
          const headers = Object.fromEntries([
            ...Object.keys(BROWSER_RELAY_HOSTING_HEADERS),
            'Content-Type',
          ].map((name) => [name, response.headers.get(name)]));
          if (response.bytes.byteLength !== entry.content_bytes
            || sha256(response.bytes) !== entry.content_sha256
            || headers['Content-Type'] !== entry.content_type
            || !isDeepStrictEqual(
              Object.fromEntries(Object.keys(BROWSER_RELAY_HOSTING_HEADERS)
                .map((name) => [name, headers[name]])),
              BROWSER_RELAY_HOSTING_HEADERS,
            )) {
            rejectBrowserRelayHostingPublisher('verification_failed');
          }
        }
      } finally {
        for (const response of responses) overwrite(response?.bytes);
      }
      if (!retry) return true;
      const remaining = windowContext.callback_deadline_milliseconds - now();
      if (attempt + 1 >= BROWSER_RELAY_HOSTING_MAXIMUM_POLL_ATTEMPTS || remaining <= 0) break;
      try {
        await implementations.wait(
          Math.min(BROWSER_RELAY_HOSTING_MAXIMUM_POLL_INTERVAL_MILLISECONDS, remaining),
          windowContext.signal,
        );
      } catch {
        rejectBrowserRelayHostingPublisher(
          windowContext.signal.aborted ? 'aborted' : 'verification_failed',
        );
      }
    }
    rejectBrowserRelayHostingPublisher('verification_failed');
  }

  async function verifyRunner(contextValue) {
    return exclusive(async () => {
      if (state !== 'published' || contextValue !== windowContext) {
        rejectBrowserRelayHostingPublisher('invalid_lifecycle');
      }
      requireWindow(contextValue);
      await verifyPublicFiles();
      publicationVerified = true;
      state = 'verified';
      return true;
    }, 'verification_failed');
  }

  async function disableSite() {
    if (attempts.disable !== 0) return;
    attempts.disable += 1;
    const response = await dispatch(
      implementations.fetch,
      session.accessToken,
      RELEASES_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'SITE_DISABLE',
          message: BROWSER_RELAY_HOSTING_DISABLE_MESSAGE,
        }),
      },
    );
    validateRelease(
      response.value,
      'SITE_DISABLE',
      null,
      BROWSER_RELAY_HOSTING_DISABLE_MESSAGE,
    );
  }

  async function deleteVersion() {
    if (attempts.delete !== 0) return;
    attempts.delete += 1;
    const response = await dispatch(
      implementations.fetch,
      session.accessToken,
      `${BROWSER_RELAY_HOSTING_API_ORIGIN}/v1beta1/${versionName}`,
      { method: 'DELETE', allowEmpty: true },
    );
    if (response.value !== null && !isDeepStrictEqual(response.value, {})) {
      rejectBrowserRelayHostingPublisher('invalid_response');
    }
  }

  async function verifyCleanup() {
    for (let attempt = 0;
      attempt < BROWSER_RELAY_HOSTING_MAXIMUM_POLL_ATTEMPTS;
      attempt += 1) {
      attempts.cleanup_verify += 1;
      let absent = false;
      let safe;
      try {
        absent = await routeAbsent(
          implementations.fetch,
          entries,
          'cleanup',
          attempt,
          undefined,
        );
        const inventory = await observeManagement(
          implementations.fetch,
          session.accessToken,
          undefined,
        );
        requireDisabledInventory(inventory, versionName);
        const latest = latestRelease(inventory.releases);
        safe = versionName === undefined || !deployCompleted
          || latest.message === BROWSER_RELAY_HOSTING_DISABLE_MESSAGE;
      } catch {
        safe = false;
      }
      if (absent && safe) return true;
      if (attempt + 1 >= BROWSER_RELAY_HOSTING_MAXIMUM_POLL_ATTEMPTS) break;
      try {
        await implementations.wait(BROWSER_RELAY_HOSTING_MAXIMUM_POLL_INTERVAL_MILLISECONDS);
      } catch {
        rejectBrowserRelayHostingPublisher('cleanup_failed');
      }
    }
    rejectBrowserRelayHostingPublisher('cleanup_failed');
  }

  async function removeRunner() {
    return exclusive(async () => {
      if (cleanupVerified) return true;
      if (state === 'dormant') {
        state = 'cleaned';
        cleanupVerified = true;
        return true;
      }
      state = 'cleaning';
      if (versionName !== undefined) {
        try {
          await disableSite();
        } catch {
          // Read-only postflight decides whether an ambiguous disable converged.
        }
        try {
          await deleteVersion();
        } catch {
          // Read-only postflight decides whether an ambiguous deletion converged.
        }
      }
      await verifyCleanup();
      cleanupVerified = true;
      state = 'cleaned';
      return true;
    }, 'cleanup_failed');
  }

  function inspect() {
    return Object.freeze({
      schema: 'miakapp.staging-browser-relay-hosting-publisher-inspection/1',
      state,
      version_known: versionName !== undefined,
      publication_verified: publicationVerified,
      cleanup_verified: cleanupVerified,
      attempts: Object.freeze({ ...attempts }),
      credentials_retained_in_result: false,
      artifact_bytes_retained_in_result: false,
      raw_responses_retained: false,
    });
  }

  return Object.freeze({
    publisher: publicBoundary(publishRunner, verifyRunner, removeRunner),
    inspect,
  });
}

export const browserRelayHostingPublisherTestingConstants = Object.freeze({
  release_inventory_url: RELEASE_INVENTORY_URL,
  releases_url: RELEASES_URL,
  serving_config: SERVING_CONFIG,
  site_url: SITE_URL,
  version_inventory_url: VERSION_INVENTORY_URL,
  versions_url: VERSIONS_URL,
});
