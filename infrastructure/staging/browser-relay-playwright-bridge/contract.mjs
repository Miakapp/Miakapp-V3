import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  AGGREGATOR_PROFILE_SHA256,
  SOURCE_RECEIPT_SCHEMA,
  validateBrowserRelayAggregatorProfile,
  validateSourceReceipt,
} from '../browser-relay-aggregator/contract.mjs';
import {
  BROWSER_ORDER,
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
  PAGE_LIFECYCLE_OBSERVATION_SCHEMA,
  PAGE_OBSERVATION_SCHEMA,
  PAGE_PRIVATE_INPUT_SCHEMA,
  PLAYWRIGHT_VERSION,
  TARGET_URL,
  validateBrowserRelayPageProfile,
} from '../browser-relay-page/contract.mjs';
import {
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  validateBrowserRelayRunnerProfile,
} from '../browser-relay-runner/contract.mjs';

export const PLAYWRIGHT_BRIDGE_PROFILE_PATH =
  'browser-relay-playwright-bridge/profile.json';
export const PLAYWRIGHT_BRIDGE_PROFILE_SHA256 =
  'd303d105a16168306739383fcb00c7eba3164d75c9ea657604aba2c949aeb6a7';
export const PLAYWRIGHT_BRIDGE_IMPLEMENTATION_BASE_COMMIT =
  '509a25fc65764b9bbe4fa7c823e263feed24a8ff';
export const PLAYWRIGHT_BRIDGE_SOURCE_SHA256 =
  '384908bddf1747124583cbeeb6e0eebf28585e1c79c8e7f48ba53495dbbd38b6';
export const PLAYWRIGHT_BRIDGE_BROWSER_SMOKE_SHA256 =
  '95d9653138151413f283d756fe2913329220be63cb79a2b0eb7e2c7bd69050a8';
export const PLAYWRIGHT_BRIDGE_OFFLINE_ENTRY_SHA256 =
  'd879e83f0c8c5c27991cfd00b11a4e418916d7add7027902ecb14a8ce795e34c';
export const PLAYWRIGHT_BRIDGE_WORKFLOW_SHA256 =
  'd9d017738add5910a7bfb34928dac358f7588c3f1f88f84863712d816fd36d0a';
export const PLAYWRIGHT_TYPES_SHA256 =
  '6c688250f2b7061cec3a17ab8797671137b653f8c4e81a6df3190cb112a7579a';
export const PLAYWRIGHT_BRIDGE_RESULT_SCHEMA =
  'miakapp.staging-browser-relay-playwright-bridge-result/1';
export const PAGE_FACT_SCHEMA = 'miakapp.staging-browser-relay-page-fact/2';
export const PINNED_PLAYWRIGHT_BFCACHE_REASON =
  'pinned_playwright_bfcache_unsupported';
export const MAXIMUM_SECONDARY_BRIDGE_MILLISECONDS = 60_000;

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const bridgePath = new URL('bridge.mjs', import.meta.url);
const browserSmokePath = new URL('../test/browser-relay-playwright-bridge-browser.mjs', import.meta.url);
const offlineEntryPath = new URL('../test/helpers/browser-relay-playwright-bridge-entry.mjs', import.meta.url);
const workflowPath = new URL('../../../.github/workflows/browser-relay-playwright-bridge.yml', import.meta.url);
const playwrightTypesPath = new URL('../../../node_modules/playwright-core/types/types.d.ts', import.meta.url);
const packagePath = new URL('../../../package.json', import.meta.url);
const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const BFCACHE_UNSUPPORTED_SENTINEL =
  'Testing Back/Forward Cache (BFCache) is not supported.';
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
]);
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'app_check_token',
  'authorization',
  'browser_storage',
  'cookie',
  'custom_token',
  'email',
  'firebase_custom_token',
  'firebase_id_token',
  'firebase_uid',
  'har',
  'home_key',
  'home_traffic',
  'id_token',
  'password',
  'private_key',
  'raw_request',
  'raw_response',
  'refresh_token',
  'request_headers',
  'response_headers',
  'secret_value',
  'token',
  'trace_context',
  'video',
  'websocket_frame',
]);

export class StagingBrowserRelayPlaywrightBridgeError extends Error {
  constructor(message = 'Staging browser-relay Playwright bridge failed closed') {
    super(message);
    this.name = 'StagingBrowserRelayPlaywrightBridgeError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayPlaywrightBridgeError(message);
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

function boundedInteger(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(`${path} is outside its reviewed bound`);
  }
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function rejectPlaywrightBridgePrivateMaterial(value, path = 'bridge_result') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains private material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPlaywrightBridgePrivateMaterial(
      entry,
      `${path}[${index}]`,
    ));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is forbidden`);
      rejectPlaywrightBridgePrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function buildBlockedPlaywrightBridgeResult() {
  return validatePlaywrightBridgeResult({
    schema: PLAYWRIGHT_BRIDGE_RESULT_SCHEMA,
    browser: 'chromium',
    state: 'blocked',
    reason: PINNED_PLAYWRIGHT_BFCACHE_REASON,
    private_inputs_requested: 0,
    receipt: null,
  }, 'chromium');
}

export function buildClosedPlaywrightBridgeResult(browser, receiptValue) {
  return validatePlaywrightBridgeResult({
    schema: PLAYWRIGHT_BRIDGE_RESULT_SCHEMA,
    browser,
    state: 'receipt_closed',
    reason: 'none',
    private_inputs_requested: 1,
    receipt: validateSourceReceipt(receiptValue, browser, 'browser_page'),
  }, browser);
}

export function validatePlaywrightBridgeResult(value, expectedBrowser) {
  rejectPlaywrightBridgePrivateMaterial(value);
  if (!BROWSER_ORDER.includes(expectedBrowser)) reject('Bridge result browser is not reviewed');
  const result = exactKeys(value, [
    'schema',
    'browser',
    'state',
    'reason',
    'private_inputs_requested',
    'receipt',
  ], 'bridge_result');
  exact(result.schema, PLAYWRIGHT_BRIDGE_RESULT_SCHEMA, 'bridge_result.schema');
  exact(result.browser, expectedBrowser, 'bridge_result.browser');
  if (expectedBrowser === 'chromium') {
    exact({
      state: result.state,
      reason: result.reason,
      private_inputs_requested: result.private_inputs_requested,
      receipt: result.receipt,
    }, {
      state: 'blocked',
      reason: PINNED_PLAYWRIGHT_BFCACHE_REASON,
      private_inputs_requested: 0,
      receipt: null,
    }, 'blocked Chromium bridge result');
    return Object.freeze({ ...result });
  }
  exact(result.state, 'receipt_closed', 'bridge_result.state');
  exact(result.reason, 'none', 'bridge_result.reason');
  exact(result.private_inputs_requested, 1, 'bridge_result.private_inputs_requested');
  const receipt = validateSourceReceipt(result.receipt, expectedBrowser, 'browser_page');
  return Object.freeze({ ...result, receipt });
}

function regularPinnedFile(path, maximumBytes, expectedSha256, description) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || sha256(readFileSync(path)) !== expectedSha256) {
    reject(`${description} differs from the reviewed regular file`);
  }
}

function validatePinnedPlaywrightContract() {
  let packageValue;
  try {
    packageValue = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    return reject('Repository package metadata is invalid');
  }
  exact(packageValue.devDependencies?.playwright, PLAYWRIGHT_VERSION,
    'repository Playwright dependency');
  regularPinnedFile(
    playwrightTypesPath,
    2 * 1024 * 1024,
    PLAYWRIGHT_TYPES_SHA256,
    'Pinned Playwright type contract',
  );
  if (!readFileSync(playwrightTypesPath, 'utf8').includes(BFCACHE_UNSUPPORTED_SENTINEL)) {
    reject('Pinned Playwright no longer declares BFCache testing unsupported');
  }
}

function validateProfileValue(value) {
  rejectPlaywrightBridgePrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'bridge',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-playwright-bridge-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_secondary_receipt_bridge_implemented_chromium_bfcache_blocked_not_wired_not_executed',
    'profile.state',
  );
  exact(profile.target, {
    project_id: 'miakapp-v4-staging',
    target_url: TARGET_URL,
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  }, 'profile.target');
  exact(profile.pins, {
    implementation_base_commit: PLAYWRIGHT_BRIDGE_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_runner_profile_sha256: BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    browser_relay_page_profile_sha256: BROWSER_RELAY_PAGE_PROFILE_SHA256,
    browser_relay_aggregator_profile_sha256: AGGREGATOR_PROFILE_SHA256,
    playwright_version: PLAYWRIGHT_VERSION,
    playwright_types_sha256: PLAYWRIGHT_TYPES_SHA256,
    bridge_source_sha256: PLAYWRIGHT_BRIDGE_SOURCE_SHA256,
    browser_smoke_sha256: PLAYWRIGHT_BRIDGE_BROWSER_SMOKE_SHA256,
    offline_entry_sha256: PLAYWRIGHT_BRIDGE_OFFLINE_ENTRY_SHA256,
    workflow_sha256: PLAYWRIGHT_BRIDGE_WORKFLOW_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) {
    reject('profile.pins contains an invalid immutable identifier');
  }
  exact(profile.bridge, {
    result_schema: PLAYWRIGHT_BRIDGE_RESULT_SCHEMA,
    page_fact_schema: PAGE_FACT_SCHEMA,
    page_private_input_schema: PAGE_PRIVATE_INPUT_SCHEMA,
    page_observation_schema: PAGE_OBSERVATION_SCHEMA,
    page_lifecycle_observation_schema: PAGE_LIFECYCLE_OBSERVATION_SCHEMA,
    source_receipt_schema: SOURCE_RECEIPT_SCHEMA,
    private_input_provider_lazy: true,
    page_provider_lazy: true,
    receipt_producer_injected: true,
    page_owned_until_cleanup: true,
    process_diagnostics_checked: true,
    target_revalidated_before_each_action: true,
    elapsed_deadline_checked_between_phases: true,
    cleanup_steps_independent: true,
    secondary_private_inputs_per_browser: 1,
    maximum_secondary_milliseconds: MAXIMUM_SECONDARY_BRIDGE_MILLISECONDS,
    raw_page_errors_propagated: false,
    raw_facts_retained: false,
  }, 'profile.bridge');
  exact(profile.compatibility, {
    playwright_bfcache_testing_supported: false,
    chromium_blocked_before_page_or_private_input: true,
    chromium_receipt_transport_complete: false,
    firefox_receipt_transport_complete: true,
    webkit_receipt_transport_complete: true,
    page_host_api_scenario_complete: false,
    independent_cloud_observers_present: false,
    aggregator_wired: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    blocked_reason: PINNED_PLAYWRIGHT_BFCACHE_REASON,
    blocked_result_is_engine_result: false,
    allowed_observations: [
      'closed_browser_page_receipt',
      'private_input_request_count',
      'stable_blocked_reason',
    ],
    forbidden_observations: [
      'browser_storage',
      'email',
      'execution_identifier',
      'firebase_uid',
      'har',
      'home_traffic',
      'raw_page_error',
      'token',
      'trace_context',
      'video',
      'websocket_frame',
    ],
  }, 'profile.output');
  if (Object.values(profile.authority).some((entry) => entry !== false)) {
    reject('profile.authority must remain closed');
  }
  exact(profile.evidence, {
    state: 'offline_only',
    offline_browser_engines: 2,
    blocked_browser_capability_checks: 1,
    offline_secondary_receipts: 2,
    chromium_private_inputs_requested: 0,
    live_page_facts: 0,
    live_receipts: 0,
    cloud_mutations: 0,
    live_execution_count: 0,
    credentials_committed: false,
    raw_page_diagnostics_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayPlaywrightBridgeProfile() {
  validateBrowserRelayRunnerProfile();
  validateBrowserRelayPageProfile();
  validateBrowserRelayAggregatorProfile();
  regularPinnedFile(
    profilePath,
    MAXIMUM_PROFILE_BYTES,
    PLAYWRIGHT_BRIDGE_PROFILE_SHA256,
    'Browser-relay Playwright bridge profile',
  );
  regularPinnedFile(
    bridgePath,
    32 * 1024,
    PLAYWRIGHT_BRIDGE_SOURCE_SHA256,
    'Browser-relay Playwright bridge source',
  );
  regularPinnedFile(
    browserSmokePath,
    32 * 1024,
    PLAYWRIGHT_BRIDGE_BROWSER_SMOKE_SHA256,
    'Browser-relay Playwright bridge browser smoke',
  );
  regularPinnedFile(
    offlineEntryPath,
    16 * 1024,
    PLAYWRIGHT_BRIDGE_OFFLINE_ENTRY_SHA256,
    'Browser-relay Playwright bridge offline entry',
  );
  regularPinnedFile(
    workflowPath,
    16 * 1024,
    PLAYWRIGHT_BRIDGE_WORKFLOW_SHA256,
    'Browser-relay Playwright bridge workflow',
  );
  validatePinnedPlaywrightContract();
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('Browser-relay Playwright bridge profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== readFileSync(profilePath, 'utf8')) {
    reject('Browser-relay Playwright bridge profile is not canonical JSON');
  }
  return validateProfileValue(value);
}

export function validateBridgePageReceipt(value, browser) {
  if (browser === 'chromium') reject('Chromium browser-page receipt remains blocked');
  return validateSourceReceipt(value, browser, 'browser_page');
}

export function validateBridgeElapsed(value) {
  return boundedInteger(
    value,
    0,
    MAXIMUM_SECONDARY_BRIDGE_MILLISECONDS,
    'bridge elapsed time',
  );
}
