import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_ORDER,
  CALLBACK_CLEANUP_RESERVE_MILLISECONDS,
  CONTROL_PLANE_EXCHANGE_ENDPOINT,
  EDGE_ROLLBACK_RESERVE_MILLISECONDS,
  HOME_ID,
  MAXIMUM_CALLBACK_MILLISECONDS,
  MAXIMUM_CHROMIUM_MILLISECONDS,
  MAXIMUM_FIREFOX_MILLISECONDS,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  MAXIMUM_RUNNER_MILLISECONDS,
  MAXIMUM_WEBKIT_MILLISECONDS,
  PAGE_OBSERVATION_SCHEMA,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
  StagingBrowserRelayPageError,
  TARGET_URL,
  rejectPagePrivateMaterial,
  validatePagePrivateInput,
  validatePageSafeObservation,
} from './boundary.mjs';

export * from './boundary.mjs';

export const BROWSER_RELAY_PAGE_PROFILE_PATH = 'browser-relay-page/profile.json';
export const BROWSER_RELAY_PAGE_PROFILE_SHA256 =
  '73fd831b2f372e50206d024de031ce40f6a577b97767f385d14dbebcd2824d9c';
export const BROWSER_RELAY_PLAN_SHA256 =
  'dbf0e73a20875353f28466b4fe1edcb8e8d1fc6604d979002b36a7610c36aa9a';
export const BROWSER_RELAY_RUNNER_PROFILE_SHA256 =
  '72b688ccd577f7b40b21d9f874bbca555324eaec1fbf2acbc87dee35cf83a536';
export const MIAKAPI_COMMIT = 'a798a746847ba3d5c16128a08b33353269e770a4';
export const IMPLEMENTATION_BASE_COMMIT = 'a065f05775890d503fc9756c6fd4e4247ebea3da';
export const MIAKAPI_SOURCE_ARCHIVE_SHA256 =
  '499ba3b4205538691341aaa8cea76f9d232308aed01522cc5f35aebcf9cc9c5a';
export const MIAKAPI_PACKAGE_SHA256 =
  '008b74b9793cbf167cbe918a12eec304bcafc6570ee55479b9349553ff238e94';
export const MIAKAPI_BUNDLE_SHA256 =
  'b9651758d3cf531dc739afac8d25196b34ded87cee402f68e66646a70bc30623';
export const MIAKAPI_BROWSER_ENTRY_SHA256 =
  'f21565e94b4e726346352826a3afa7f3c5976c7cb60dc7bac76c1e63805f2013';
export const MIAKAPI_BUN_LOCK_SHA256 =
  '0ba5e8d70a2e43ed61928fdf38ac1961a78d48112c9209c92c60354042ac7595';
export const FIREBASE_SDK_VERSION = '12.18.0';
export const VITE_VERSION = '8.2.2';
export const BUN_VERSION = '1.2.23';

const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);

function reject(message) {
  throw new StagingBrowserRelayPageError(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
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

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateProfileValue(value) {
  rejectPagePrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'page',
    'timing',
    'artifact',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-page-profile/1', 'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_page_host_and_artifact_implemented_not_wired_not_published_not_executed',
    'profile.state',
  );
  exactKeys(profile.target, [
    'project_id',
    'origin',
    'path',
    'control_plane_exchange_endpoint',
    'home_id',
    'relay_urls',
    'data_policy',
    'cloud_compute_resources',
    'unscheduled',
  ], 'profile.target');
  exact(profile.target.project_id, 'miakapp-v4-staging', 'profile.target.project_id');
  exact(`${profile.target.origin}${profile.target.path}`, TARGET_URL, 'profile.target URL');
  exact(profile.target.control_plane_exchange_endpoint, CONTROL_PLANE_EXCHANGE_ENDPOINT,
    'profile.target.control_plane_exchange_endpoint');
  exact(profile.target.home_id, HOME_ID, 'profile.target.home_id');
  exact(profile.target.relay_urls, [RELAY_A_URL, RELAY_B_URL], 'profile.target.relay_urls');
  exact(profile.target.data_policy, 'synthetic_only', 'profile.target.data_policy');
  exact(profile.target.cloud_compute_resources, 0, 'profile.target.cloud_compute_resources');
  exact(profile.target.unscheduled, true, 'profile.target.unscheduled');
  exactKeys(profile.pins, [
    'implementation_base_commit',
    'browser_relay_plan_sha256',
    'browser_relay_runner_profile_sha256',
    'miakapi_commit',
    'miakapi_source_archive_sha256',
    'miakapi_package_sha256',
    'miakapi_bundle_sha256',
    'miakapi_browser_entry_sha256',
    'miakapi_bun_lock_sha256',
    'firebase_sdk_version',
    'vite_version',
    'bun_version',
    'boundary_source_sha256',
    'runtime_source_sha256',
    'page_source_sha256',
    'artifact_source_sha256',
    'index_sha256',
  ], 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || !COMMIT.test(profile.pins.miakapi_commit)
    || profile.pins.miakapi_commit !== MIAKAPI_COMMIT) {
    reject('profile commit pins are invalid');
  }
  for (const field of [
    'browser_relay_plan_sha256',
    'browser_relay_runner_profile_sha256',
    'miakapi_source_archive_sha256',
    'miakapi_package_sha256',
    'miakapi_bundle_sha256',
    'miakapi_browser_entry_sha256',
    'miakapi_bun_lock_sha256',
    'boundary_source_sha256',
    'runtime_source_sha256',
    'page_source_sha256',
    'artifact_source_sha256',
    'index_sha256',
  ]) {
    if (!SHA256.test(profile.pins[field])) reject(`profile.pins.${field} is invalid`);
  }
  exact(profile.pins.browser_relay_plan_sha256, BROWSER_RELAY_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256');
  exact(profile.pins.implementation_base_commit, IMPLEMENTATION_BASE_COMMIT,
    'profile.pins.implementation_base_commit');
  exact(profile.pins.browser_relay_runner_profile_sha256,
    BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    'profile.pins.browser_relay_runner_profile_sha256');
  exact(profile.pins.miakapi_bundle_sha256, MIAKAPI_BUNDLE_SHA256,
    'profile.pins.miakapi_bundle_sha256');
  exact(profile.pins.miakapi_source_archive_sha256, MIAKAPI_SOURCE_ARCHIVE_SHA256,
    'profile.pins.miakapi_source_archive_sha256');
  exact(profile.pins.miakapi_package_sha256, MIAKAPI_PACKAGE_SHA256,
    'profile.pins.miakapi_package_sha256');
  exact(profile.pins.miakapi_browser_entry_sha256, MIAKAPI_BROWSER_ENTRY_SHA256,
    'profile.pins.miakapi_browser_entry_sha256');
  exact(profile.pins.miakapi_bun_lock_sha256, MIAKAPI_BUN_LOCK_SHA256,
    'profile.pins.miakapi_bun_lock_sha256');
  exact(profile.pins.firebase_sdk_version, FIREBASE_SDK_VERSION,
    'profile.pins.firebase_sdk_version');
  exact(profile.pins.vite_version, VITE_VERSION, 'profile.pins.vite_version');
  exact(profile.pins.bun_version, BUN_VERSION, 'profile.pins.bun_version');
  exactKeys(profile.page, [
    'private_input_schema',
    'safe_observation_schema',
    'browser_order',
    'runner_compatible',
    'api',
    'firebase_auth_persistence',
    'app_check_provider',
    'app_check_auto_refresh',
    'app_check_persistence',
    'source_credentials_on_websocket',
    'raw_websocket_frames_retained',
    'raw_browser_errors_retained',
    'browser_console_collected',
    'network_payloads_collected',
  ], 'profile.page');
  exact(profile.page.private_input_schema, PAGE_PRIVATE_INPUT_SCHEMA,
    'profile.page.private_input_schema');
  exact(profile.page.safe_observation_schema, PAGE_OBSERVATION_SCHEMA,
    'profile.page.safe_observation_schema');
  exact(profile.page.browser_order, BROWSER_ORDER, 'profile.page.browser_order');
  exact(profile.page.runner_compatible, false, 'profile.page.runner_compatible');
  exact(profile.page.api, [
    'initialize',
    'start',
    'observe',
    'observeState',
    'call',
    'suspend',
    'resume',
    'stop',
  ], 'profile.page.api');
  exact(profile.page.firebase_auth_persistence, 'memory_only',
    'profile.page.firebase_auth_persistence');
  exact(profile.page.app_check_provider, 'recaptcha_enterprise',
    'profile.page.app_check_provider');
  exact(profile.page.app_check_auto_refresh, false,
    'profile.page.app_check_auto_refresh');
  exact(profile.page.app_check_persistence, 'memory_only_indexeddb_blocked',
    'profile.page.app_check_persistence');
  exact(profile.page.source_credentials_on_websocket, false,
    'profile.page.source_credentials_on_websocket');
  exact(profile.page.raw_websocket_frames_retained, false,
    'profile.page.raw_websocket_frames_retained');
  exact(profile.page.raw_browser_errors_retained, false,
    'profile.page.raw_browser_errors_retained');
  exact(profile.page.browser_console_collected, false,
    'profile.page.browser_console_collected');
  exact(profile.page.network_payloads_collected, false,
    'profile.page.network_payloads_collected');
  exactKeys(profile.timing, [
    'maximum_runner_milliseconds',
    'maximum_chromium_milliseconds',
    'maximum_firefox_milliseconds',
    'maximum_webkit_milliseconds',
    'maximum_callback_milliseconds',
    'maximum_public_window_milliseconds',
    'callback_cleanup_reserve_milliseconds',
    'edge_rollback_reserve_milliseconds',
  ], 'profile.timing');
  exact(profile.timing.maximum_runner_milliseconds, MAXIMUM_RUNNER_MILLISECONDS,
    'profile.timing.maximum_runner_milliseconds');
  exact(profile.timing.maximum_chromium_milliseconds, MAXIMUM_CHROMIUM_MILLISECONDS,
    'profile.timing.maximum_chromium_milliseconds');
  exact(profile.timing.maximum_firefox_milliseconds, MAXIMUM_FIREFOX_MILLISECONDS,
    'profile.timing.maximum_firefox_milliseconds');
  exact(profile.timing.maximum_webkit_milliseconds, MAXIMUM_WEBKIT_MILLISECONDS,
    'profile.timing.maximum_webkit_milliseconds');
  exact(profile.timing.maximum_callback_milliseconds, MAXIMUM_CALLBACK_MILLISECONDS,
    'profile.timing.maximum_callback_milliseconds');
  exact(profile.timing.maximum_public_window_milliseconds, MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
    'profile.timing.maximum_public_window_milliseconds');
  exact(profile.timing.callback_cleanup_reserve_milliseconds,
    CALLBACK_CLEANUP_RESERVE_MILLISECONDS,
    'profile.timing.callback_cleanup_reserve_milliseconds');
  exact(profile.timing.edge_rollback_reserve_milliseconds,
    EDGE_ROLLBACK_RESERVE_MILLISECONDS,
    'profile.timing.edge_rollback_reserve_milliseconds');
  exact(
    profile.timing.maximum_chromium_milliseconds
      + profile.timing.maximum_firefox_milliseconds
      + profile.timing.maximum_webkit_milliseconds,
    profile.timing.maximum_runner_milliseconds,
    'profile.timing per-browser total',
  );
  exactKeys(profile.artifact, [
    'build_tool',
    'maximum_files',
    'html_files',
    'javascript_files',
    'source_maps',
    'content_addressed_gzip',
    'cache_control',
    'frame_ancestors',
    'credentials_embedded',
    'hosting_publisher_present',
  ], 'profile.artifact');
  exact(profile.artifact, {
    build_tool: 'vite',
    maximum_files: 2,
    html_files: 1,
    javascript_files: 1,
    source_maps: false,
    content_addressed_gzip: true,
    cache_control: 'no-store, max-age=0',
    frame_ancestors: 'none',
    credentials_embedded: false,
    hosting_publisher_present: false,
  }, 'profile.artifact');
  exact(profile.authority, {
    cloud_mutation_authorized: false,
    hosting_publication_authorized: false,
    public_ingress_authorized: false,
    live_execution_authorized: false,
  }, 'profile.authority');
  exact(profile.evidence, {
    state: 'absent',
    live_artifact_builds: 0,
    hosting_publications: 0,
    live_execution_count: 0,
    cloud_mutations: 0,
  }, 'profile.evidence');
  return Object.freeze(profile);
}

export function validateBrowserRelayPageProfile(
  path = new URL('profile.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Browser-relay page profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== BROWSER_RELAY_PAGE_PROFILE_SHA256) {
    reject('Browser-relay page profile digest has drifted');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser-relay page profile is not valid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser-relay page profile is not canonical JSON');
  }
  return validateProfileValue(value);
}

export {
  rejectPagePrivateMaterial,
  validatePagePrivateInput,
  validatePageSafeObservation,
};
