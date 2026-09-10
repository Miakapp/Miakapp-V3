import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  HOSTING_HEADERS,
} from '../browser-relay-page/artifact.mjs';
import {
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
} from '../browser-relay-page/contract.mjs';
import {
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  PAGE_DIRECTORY,
  PAGE_PATH,
  TARGET_ORIGIN,
  TARGET_URL,
} from '../browser-relay-page/boundary.mjs';
import { PROJECT_ID } from '../workload/contract.mjs';

export const BROWSER_RELAY_HOSTING_PUBLISHER_PROFILE_PATH =
  'browser-relay-hosting-publisher/profile.json';
export const BROWSER_RELAY_HOSTING_PUBLISHER_PROFILE_SHA256 =
  '569bfdf4f0afe150856a3243eb4dcf50ff7e646373f2081d8ef7415365f9d13b';
export const BROWSER_RELAY_HOSTING_PUBLISHER_IMPLEMENTATION_BASE_COMMIT =
  '353a003a33c4f582eaaee13fedca83a63a85db03';
export const BROWSER_RELAY_HOSTING_SITE = 'miakapp-v4-staging';
export const BROWSER_RELAY_HOSTING_API_ORIGIN = 'https://firebasehosting.googleapis.com';
export const BROWSER_RELAY_HOSTING_UPLOAD_ORIGIN =
  'https://upload-firebasehosting.googleapis.com';
export const BROWSER_RELAY_HOSTING_MAXIMUM_JSON_BYTES = 64 * 1024;
export const BROWSER_RELAY_HOSTING_MAXIMUM_FILE_BYTES = 2 * 1024 * 1024;
export const BROWSER_RELAY_HOSTING_REQUEST_TIMEOUT_MILLISECONDS = 30_000;
export const BROWSER_RELAY_HOSTING_MAXIMUM_POLL_ATTEMPTS = 30;
export const BROWSER_RELAY_HOSTING_MAXIMUM_POLL_INTERVAL_MILLISECONDS = 2_000;
export const BROWSER_RELAY_HOSTING_INVENTORY_PAGE_SIZE = 100;
export const BROWSER_RELAY_HOSTING_DEPLOY_MESSAGE =
  'Miakapp V4 bounded browser relay acceptance';
export const BROWSER_RELAY_HOSTING_DISABLE_MESSAGE =
  'Miakapp V4 bounded browser relay acceptance retired';
export const BROWSER_RELAY_HOSTING_LABELS = Object.freeze({
  environment: 'staging',
  operation: 'browser-relay-acceptance',
  owner: 'miakapp-v4',
});
export const BROWSER_RELAY_HOSTING_HEADERS = HOSTING_HEADERS;
export const BROWSER_RELAY_HOSTING_TARGET = Object.freeze({
  origin: TARGET_ORIGIN,
  page_directory: PAGE_DIRECTORY,
  page_path: PAGE_PATH,
  target_url: TARGET_URL,
});

const PROFILE_PATH = new URL('profile.json', import.meta.url);
const expectedProfile = JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ERROR_CODES = new Set([
  'aborted', 'cleanup_failed', 'invalid_artifact', 'invalid_baseline',
  'invalid_configuration', 'invalid_lifecycle', 'invalid_response',
  'publication_failed', 'verification_failed',
]);

export class StagingBrowserRelayHostingPublisherError extends Error {
  constructor(code = 'invalid_configuration') {
    if (!ERROR_CODES.has(code)) code = 'invalid_configuration';
    super(`Staging browser-relay Hosting publisher failed: ${code}`);
    this.name = 'StagingBrowserRelayHostingPublisherError';
    this.code = code;
  }
}

export function rejectBrowserRelayHostingPublisher(code) {
  throw new StagingBrowserRelayHostingPublisherError(code);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  return value;
}

function exact(value, expected) {
  if (!isDeepStrictEqual(value, expected)) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateProfileValue(profile) {
  exact(profile, expectedProfile);
  exactKeys(profile, [
    'schema', 'revision', 'state', 'target', 'pins', 'baseline', 'lifecycle',
    'bounds', 'credential_boundary', 'compatibility', 'authority', 'evidence',
  ]);
  exact(profile.schema, 'miakapp.staging-browser-relay-hosting-publisher-profile/1');
  exact(profile.revision, 1);
  exact(profile.target, {
    project_id: PROJECT_ID,
    site_id: BROWSER_RELAY_HOSTING_SITE,
    origin: TARGET_ORIGIN,
    acceptance_path: PAGE_PATH,
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  });
  exact(profile.pins.browser_relay_page_profile_sha256,
    BROWSER_RELAY_PAGE_PROFILE_SHA256);
  exact(profile.pins.hosting_headers_sha256,
    sha256(Buffer.from(canonicalJson(HOSTING_HEADERS), 'utf8')));
  exact(profile.bounds.request_timeout_seconds,
    BROWSER_RELAY_HOSTING_REQUEST_TIMEOUT_MILLISECONDS / 1_000);
  exact(profile.bounds.maximum_json_response_bytes,
    BROWSER_RELAY_HOSTING_MAXIMUM_JSON_BYTES);
  exact(profile.bounds.maximum_public_file_bytes,
    BROWSER_RELAY_HOSTING_MAXIMUM_FILE_BYTES);
  exact(profile.bounds.inventory_page_size, BROWSER_RELAY_HOSTING_INVENTORY_PAGE_SIZE);
  exact(profile.bounds.maximum_public_poll_attempts,
    BROWSER_RELAY_HOSTING_MAXIMUM_POLL_ATTEMPTS);
  exact(profile.bounds.maximum_public_poll_interval_milliseconds,
    BROWSER_RELAY_HOSTING_MAXIMUM_POLL_INTERVAL_MILLISECONDS);
  exact(profile.bounds.maximum_public_window_seconds,
    MAXIMUM_PUBLIC_WINDOW_MILLISECONDS / 1_000);
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || !SHA256.test(profile.pins.browser_relay_page_profile_sha256)
    || !SHA256.test(profile.pins.hosting_headers_sha256)
    || profile.authority.real_credentials_authorized_by_artifact !== false
    || profile.authority.external_network_authorized_by_artifact !== false
    || profile.authority.cloud_requests_authorized_by_artifact !== false
    || profile.authority.cloud_mutations_authorized_by_artifact !== false
    || profile.authority.hosting_publication_authorized_by_artifact !== false
    || profile.authority.public_ingress_authorized_by_artifact !== false
    || profile.authority.live_execution_authorized_by_artifact !== false
    || profile.evidence.real_credentials_used !== 0
    || profile.evidence.dns_requests !== 0
    || profile.evidence.external_network_requests !== 0
    || profile.evidence.cloud_requests !== 0
    || profile.evidence.cloud_mutations !== 0
    || profile.evidence.hosting_publications !== 0
    || profile.evidence.public_ingress_changes !== 0
    || profile.evidence.live_execution_count !== 0
    || profile.evidence.incremental_cost_eur !== 0) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  return Object.freeze(profile);
}

export function validateBrowserRelayHostingPublisherProfile(path = PROFILE_PATH) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size < 1 || entry.size > MAXIMUM_PROFILE_BYTES) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== BROWSER_RELAY_HOSTING_PUBLISHER_PROFILE_SHA256) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes.toString('utf8')) {
    rejectBrowserRelayHostingPublisher('invalid_configuration');
  }
  return validateProfileValue(value);
}
