import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  CONTROL_PLANE_ORIGIN,
  HOME_ID,
} from '../browser-relay-page/boundary.mjs';
import {
  BUN_VERSION,
  MIAKAPI_BUN_LOCK_SHA256,
  MIAKAPI_COMMIT,
  MIAKAPI_PACKAGE_SHA256,
  MIAKAPI_SOURCE_ARCHIVE_SHA256,
  NODE_VERSION,
} from '../browser-relay-page/contract.mjs';
import {
  FIXTURE_CLOUD_PROFILE_SHA256,
  FIXTURE_CLOUD_SOURCE_SHA256,
  validateBrowserRelayFixtureCloudProfile,
} from '../browser-relay-fixture-cloud/contract.mjs';
import {
  COORDINATOR_NAME,
  FIXTURE_PROFILE_SHA256,
  PROJECT_ID,
  REGION,
} from '../browser-relay-fixture/contract.mjs';

export const FIXTURE_MIAKAPI_PROFILE_PATH = 'browser-relay-fixture-miakapi/profile.json';
export const FIXTURE_MIAKAPI_PROFILE_SHA256 =
  'da5f22226afb51637e5ce0ecf585a039b550375a49550637589223ad314b59ea';
export const FIXTURE_MIAKAPI_IMPLEMENTATION_BASE_COMMIT =
  'ce32f8841bbc93f3b2e99f0f30da1c45e728eab1';
export const MIAKAPI_NODE_ENTRY_SHA256 =
  'fc169917c0b54b85c7ce91121d7033ad48b04c3e76cf85016142f82632d04bff';
export const MIAKAPI_NODE_BUNDLE_SHA256 =
  '35b13d30e8dd3834cafa85a46e7535ff58e6c2392963afcb9dfb8f3e626571a2';
export const MIAKAPI_LICENSE_SHA256 =
  'b7db228df09b7a9063f5d3601f85f13852ac8d629590f059001252d006413125';
export const FIXTURE_MIAKAPI_BINDING_SOURCE_SHA256 =
  'd0941258b300cac8530b7a16a5d6e535c59692615adea5fff832de9d2d99c4e8';

const profilePath = new URL('profile.json', import.meta.url);
const bindingPath = new URL('binding.mjs', import.meta.url);
const bundlePath = new URL('vendor/miakapi-node-v4.mjs', import.meta.url);
const licensePath = new URL('vendor/LICENSE.miakapi', import.meta.url);
const expectedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\bmhk1_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}\b/u,
]);
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'authorization',
  'credential',
  'firebase_custom_token',
  'firebase_id_token',
  'home_key_value',
  'private_key',
  'raw_request',
  'raw_response',
  'refresh_token',
  'secret_value',
  'token',
]);

export class StagingBrowserRelayFixtureMiakApiContractError extends Error {
  constructor(message = 'Staging browser-relay MiakAPI profile is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayFixtureMiakApiContractError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayFixtureMiakApiContractError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, path) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
}

function rejectPrivateMaterial(value, path = 'profile') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains private material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) {
        reject(`${path}.${key} is a forbidden private field`);
      }
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function regularPinnedFile(path, maximumBytes, expectedSha256, description) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || sha256(readFileSync(path)) !== expectedSha256) {
    reject(`${description} differs from the reviewed regular file`);
  }
}

function validateProfileValue(value) {
  const profile = exactKeys(value, [
    'authority',
    'boundary',
    'evidence',
    'pins',
    'revision',
    'runtime',
    'schema',
    'state',
    'target',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  rejectPrivateMaterial(profile);
  exact(profile.schema, 'miakapp.staging-browser-relay-fixture-miakapi-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(profile.state,
    'closed_pinned_miakapi_factory_binding_implemented_not_wired_not_executed',
    'profile.state');

  exactKeys(profile.target, [
    'cloud_compute_resources',
    'coordinator_name',
    'data_policy',
    'exchange_endpoint',
    'home_id',
    'project_id',
    'region',
    'unscheduled',
  ], 'profile.target');
  exact(profile.target, {
    project_id: PROJECT_ID,
    region: REGION,
    home_id: HOME_ID,
    coordinator_name: COORDINATOR_NAME,
    exchange_endpoint: `${CONTROL_PLANE_ORIGIN}/v1/access-tokens:exchange`,
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  }, 'profile.target');

  exactKeys(profile.pins, [
    'binding_source_sha256',
    'browser_relay_fixture_cloud_profile_sha256',
    'browser_relay_fixture_cloud_source_sha256',
    'browser_relay_fixture_profile_sha256',
    'implementation_base_commit',
    'miakapi_bun_lock_sha256',
    'miakapi_commit',
    'miakapi_license_sha256',
    'miakapi_node_bundle_sha256',
    'miakapi_node_entry_sha256',
    'miakapi_package_sha256',
    'miakapi_source_archive_sha256',
  ], 'profile.pins');
  for (const field of ['implementation_base_commit', 'miakapi_commit']) {
    if (!COMMIT.test(profile.pins[field])) reject(`profile.pins.${field} is invalid`);
  }
  for (const [field, digest] of Object.entries(profile.pins)) {
    if (field.endsWith('_sha256') && (!SHA256.test(digest))) {
      reject(`profile.pins.${field} is invalid`);
    }
  }
  exact(profile.pins, {
    implementation_base_commit: FIXTURE_MIAKAPI_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_fixture_profile_sha256: FIXTURE_PROFILE_SHA256,
    browser_relay_fixture_cloud_profile_sha256: FIXTURE_CLOUD_PROFILE_SHA256,
    browser_relay_fixture_cloud_source_sha256: FIXTURE_CLOUD_SOURCE_SHA256,
    miakapi_commit: MIAKAPI_COMMIT,
    miakapi_source_archive_sha256: MIAKAPI_SOURCE_ARCHIVE_SHA256,
    miakapi_package_sha256: MIAKAPI_PACKAGE_SHA256,
    miakapi_bun_lock_sha256: MIAKAPI_BUN_LOCK_SHA256,
    miakapi_node_entry_sha256: MIAKAPI_NODE_ENTRY_SHA256,
    miakapi_node_bundle_sha256: MIAKAPI_NODE_BUNDLE_SHA256,
    miakapi_license_sha256: MIAKAPI_LICENSE_SHA256,
    binding_source_sha256: FIXTURE_MIAKAPI_BINDING_SOURCE_SHA256,
  }, 'profile.pins');

  exactKeys(profile.runtime, [
    'bun_version',
    'bundle_bytes',
    'bundle_minified',
    'exported_factories',
    'module_format',
    'node_version',
    'source_maps',
    'vendored_modules',
  ], 'profile.runtime');
  exact(profile.runtime, {
    node_version: NODE_VERSION,
    bun_version: BUN_VERSION,
    module_format: 'esm',
    bundle_minified: true,
    source_maps: false,
    vendored_modules: 48,
    bundle_bytes: 160_762,
    exported_factories: ['createCoordinator', 'createHomeKeyAccessTokenProvider'],
  }, 'profile.runtime');

  exactKeys(profile.boundary, [
    'ambient_fetch_fallback_reachable',
    'construction_http_requests',
    'construction_websocket_connections',
    'coordinator_sessions_started',
    'factory_calls_per_kind',
    'home_key_exchange_transport',
    'home_key_reaches_websocket',
    'logger_installed',
    'raw_errors_propagated',
  ], 'profile.boundary');
  exact(profile.boundary, {
    factory_calls_per_kind: 1,
    home_key_exchange_transport: 'explicit_injected_only',
    ambient_fetch_fallback_reachable: false,
    home_key_reaches_websocket: false,
    logger_installed: false,
    construction_http_requests: 0,
    construction_websocket_connections: 0,
    coordinator_sessions_started: 0,
    raw_errors_propagated: false,
  }, 'profile.boundary');

  exactKeys(profile.authority, [
    'cloud_mutation_authorized',
    'hosting_publication_authorized',
    'iam_binding_mutation_authorized',
    'live_execution_authorized',
    'public_ingress_authorized',
  ], 'profile.authority');
  if (Object.values(profile.authority).some((entry) => entry !== false)) {
    reject('profile.authority must remain closed');
  }

  exactKeys(profile.evidence, [
    'cloud_mutations',
    'credentials_committed',
    'live_coordinator_sessions',
    'live_http_requests',
    'live_websocket_connections',
    'raw_cloud_responses_committed',
    'state',
  ], 'profile.evidence');
  exact(profile.evidence, {
    state: 'absent',
    live_http_requests: 0,
    live_websocket_connections: 0,
    live_coordinator_sessions: 0,
    cloud_mutations: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayFixtureMiakApiProfile() {
  validateBrowserRelayFixtureCloudProfile();
  regularPinnedFile(
    profilePath,
    MAXIMUM_PROFILE_BYTES,
    FIXTURE_MIAKAPI_PROFILE_SHA256,
    'MiakAPI binding profile',
  );
  regularPinnedFile(
    bindingPath,
    32 * 1024,
    FIXTURE_MIAKAPI_BINDING_SOURCE_SHA256,
    'MiakAPI binding source',
  );
  regularPinnedFile(
    bundlePath,
    256 * 1024,
    MIAKAPI_NODE_BUNDLE_SHA256,
    'Vendored MiakAPI Node bundle',
  );
  regularPinnedFile(
    licensePath,
    4 * 1024,
    MIAKAPI_LICENSE_SHA256,
    'Vendored MiakAPI license',
  );
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('MiakAPI binding profile is not valid JSON');
  }
  return validateProfileValue(value);
}
