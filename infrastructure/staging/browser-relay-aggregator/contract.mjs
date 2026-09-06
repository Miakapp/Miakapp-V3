import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';
import {
  BROWSER_ORDER,
  BROWSER_DEADLINES_MILLISECONDS,
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  ENGINE_RESULT_SCHEMA,
  validateBrowserRelayRunnerProfile,
} from '../browser-relay-runner/contract.mjs';
import {
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
  validateBrowserRelayPageProfile,
} from '../browser-relay-page/contract.mjs';
import {
  FIXTURE_PROFILE_SHA256,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  validateBrowserRelayFixtureProfile,
} from '../browser-relay-fixture/contract.mjs';
import {
  FIXTURE_CLOUD_PROFILE_SHA256,
  validateBrowserRelayFixtureCloudProfile,
} from '../browser-relay-fixture-cloud/contract.mjs';
import {
  FIXTURE_MIAKAPI_PROFILE_SHA256,
  validateBrowserRelayFixtureMiakApiProfile,
} from '../browser-relay-fixture-miakapi/contract.mjs';

export const AGGREGATOR_PROFILE_PATH = 'browser-relay-aggregator/profile.json';
export const AGGREGATOR_PROFILE_SHA256 =
  '2f78e09655d26af993d1c5885114b1740aaa32e13ced14c5d8d774a9e40a7851';
export const AGGREGATOR_IMPLEMENTATION_BASE_COMMIT =
  '2a3939b2c59b3ec78be93f8daaa98e89eaadafec';
export const AGGREGATOR_SOURCE_SHA256 =
  'd4446df01e831b89530eabbcaa4c1c46e6e33b12ba73b1f101fadeb83901ae5c';
export const SOURCE_RECEIPT_SCHEMA =
  'miakapp.staging-browser-relay-source-receipt/1';

export const SOURCE_ORDER_BY_BROWSER = Object.freeze({
  chromium: Object.freeze([
    'browser_page',
    'firebase_app_check',
    'hosting',
    'control_plane',
    'relay',
    'coordinator',
    'kms',
    'firestore',
  ]),
  firefox: Object.freeze([
    'browser_page',
    'firebase_app_check',
    'control_plane',
    'relay',
    'kms',
  ]),
  webkit: Object.freeze([
    'browser_page',
    'firebase_app_check',
    'control_plane',
    'relay',
    'kms',
  ]),
});

const chromiumAssertions = Object.freeze({
  browser_page: Object.freeze([
    'chromium_initial_exchange_and_hello',
    'authoritative_snapshot_and_patch',
    'one_call_completes',
    'source_credentials_confined_to_https',
    'same_relay_scheduled_reauthentication',
    'one_browser_websocket',
    'old_socket_closes_before_new_socket_opens',
    'state_and_call_recover_on_relay_b',
    'maximum_one_active_browser_socket',
    'visibility_pause_resume_is_bounded',
    'bfcache_restore_revalidates_identity',
    'sign_out_stops_and_discards_immediately',
    'identity_tuple_change_requires_new_session',
    'uncertain_effect_is_outcome_unknown',
  ]),
  firebase_app_check: Object.freeze([
    'real_browser_provider_attestation',
    'missing_and_invalid_app_check_denied',
    'no_token_consumption_mode',
  ]),
  hosting: Object.freeze(['exact_firebase_app_id']),
  control_plane: Object.freeze([
    'exact_origin_cors_and_preflight',
    'foreign_origin_denied',
    'source_and_uid_admission_observed',
    'no_authenticated_response_cache',
    'already_issued_atomic_credential_is_reused',
    'version_2_jwk_prepublished_for_at_least_sixty_seconds',
    'version_1_jwk_retained_for_three_hundred_thirty_seconds',
    'version_1_jwk_removed_after_lease_bound',
  ]),
  relay: Object.freeze([
    'version_2_kid_accepted_on_existing_socket',
    'wrong_relay_audience_denied',
    'wrong_home_denied',
    'wrong_role_denied',
    'unknown_kid_refresh_is_bounded',
    'disconnect_reconnect_and_resync_are_bounded',
    'new_sessions_continue_on_version_2',
  ]),
  coordinator: Object.freeze(['no_physical_call_replay']),
  kms: Object.freeze(['kms_version_1_disabled_not_destroyed']),
  firestore: Object.freeze(['authoritative_route_changes_to_relay_b']),
});

export const SOURCE_ASSERTIONS = Object.freeze({
  chromium: chromiumAssertions,
  firefox: Object.freeze({
    browser_page: Object.freeze([
      'firefox_initial_session_and_teardown',
      'no_browser_specific_credential_persistence',
    ]),
    firebase_app_check: Object.freeze([]),
    control_plane: Object.freeze([]),
    relay: Object.freeze([]),
    kms: Object.freeze([]),
  }),
  webkit: Object.freeze({
    browser_page: Object.freeze([
      'webkit_initial_session_and_teardown',
      'no_browser_specific_credential_persistence',
    ]),
    firebase_app_check: Object.freeze([]),
    control_plane: Object.freeze([]),
    relay: Object.freeze([]),
    kms: Object.freeze([]),
  }),
});

export const COUNTER_KEYS = Object.freeze([
  'app_check_assessments',
  'control_plane_exchanges',
  'kms_signatures',
  'firestore_writes',
  'maximum_active_websockets',
  'source_credentials_on_websocket',
  'browser_credential_persistence_events',
  'physical_call_replays',
]);

export const COUNTER_OWNERS = Object.freeze({
  app_check_assessments: 'firebase_app_check',
  control_plane_exchanges: 'control_plane',
  kms_signatures: 'kms',
  firestore_writes: 'firestore',
  maximum_active_websockets: 'browser_page',
  source_credentials_on_websocket: 'browser_page',
  browser_credential_persistence_events: 'browser_page',
  physical_call_replays: 'coordinator',
});

export const COUNTER_MAXIMUMS = Object.freeze({
  app_check_assessments: 16,
  control_plane_exchanges: 16,
  kms_signatures: 16,
  firestore_writes: 64,
  maximum_active_websockets: 1,
  source_credentials_on_websocket: 0,
  browser_credential_persistence_events: 0,
  physical_call_replays: 0,
});

export const STABLE_OUTCOME_CLASSES = Object.freeze([
  'accepted',
  'applied',
  'failed',
  'outcome_unknown',
  'stale',
]);

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const runnerProfile = JSON.parse(
  readFileSync(new URL('../browser-relay-runner/profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const aggregatorPath = new URL('aggregator.mjs', import.meta.url);
const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const REVISION_ID = /^(?:control-plane|miakapp-staging-relay-[ab])-[0-9]{5}-[a-z]{3}$/u;
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

export class StagingBrowserRelayAggregatorError extends Error {
  constructor(message = 'Staging browser-relay aggregation is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayAggregatorError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayAggregatorError(message);
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

export function rejectAggregatorPrivateMaterial(value, path = 'receipt') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains private material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectAggregatorPrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is forbidden`);
      rejectAggregatorPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function validateStringArray(value, maximum, path) {
  if (!Array.isArray(value) || value.length > maximum
    || value.some((entry) => typeof entry !== 'string')
    || new Set(value).size !== value.length
    || !isDeepStrictEqual(value, [...value].sort())) {
    reject(`${path} must be a bounded sorted unique string array`);
  }
  return Object.freeze([...value]);
}

function validateCounters(value, browser, source) {
  const counters = exactKeys(value, COUNTER_KEYS, 'receipt.counters');
  for (const key of COUNTER_KEYS) {
    const maximum = COUNTER_MAXIMUMS[key];
    boundedInteger(counters[key], 0, maximum, `receipt.counters.${key}`);
    if (COUNTER_OWNERS[key] !== source && counters[key] !== 0) {
      reject(`receipt.counters.${key} belongs to another evidence source`);
    }
  }
  if (source === 'browser_page' && counters.maximum_active_websockets !== 1) {
    reject('receipt browser_page must observe exactly one maximum active WebSocket');
  }
  if (source === 'firebase_app_check' && counters.app_check_assessments < 1) {
    reject('receipt firebase_app_check must observe an assessment');
  }
  if (source === 'control_plane' && counters.control_plane_exchanges < 1) {
    reject('receipt control_plane must observe an exchange');
  }
  if (source === 'kms' && counters.kms_signatures < 1) {
    reject('receipt kms must observe a signature');
  }
  if (browser === 'chromium' && source === 'firestore' && counters.firestore_writes < 1) {
    reject('receipt firestore must observe the synthetic matrix writes');
  }
  return Object.freeze({ ...counters });
}

function validatePublicKeyIds(value, browser, source) {
  const ids = validateStringArray(value, 2, 'receipt.public_key_ids');
  const expected = source === 'control_plane'
    ? (browser === 'chromium' ? ['1', '2'] : ['2'])
    : [];
  exact(ids, expected, 'receipt.public_key_ids');
  return ids;
}

function validateRevisionIds(value, browser, source) {
  const ids = validateStringArray(value, 4, 'receipt.revision_ids');
  if (ids.some((entry) => !REVISION_ID.test(entry))) {
    reject('receipt.revision_ids contains an invalid public revision identifier');
  }
  if (source === 'control_plane') {
    if (ids.length < 1 || ids.some((entry) => !entry.startsWith('control-plane-'))) {
      reject('receipt control_plane must contain only its observed public revisions');
    }
  } else if (source === 'relay') {
    const expectedPrefixes = browser === 'chromium'
      ? ['miakapp-staging-relay-a-', 'miakapp-staging-relay-b-']
      : ['miakapp-staging-relay-b-'];
    if (ids.length !== expectedPrefixes.length
      || expectedPrefixes.some((prefix) => !ids.some((entry) => entry.startsWith(prefix)))) {
      reject('receipt relay revisions do not cover the reviewed route');
    }
  } else if (ids.length !== 0) {
    reject('receipt revisions belong only to the control-plane and relay sources');
  }
  return ids;
}

function validateStableOutcomes(value, browser, source) {
  if (!Array.isArray(value)
    || value.some((entry) => typeof entry !== 'string'
      || !STABLE_OUTCOME_CLASSES.includes(entry))
    || new Set(value).size !== value.length
    || !isDeepStrictEqual(
      value,
      [...value].sort((left, right) => (
        STABLE_OUTCOME_CLASSES.indexOf(left) - STABLE_OUTCOME_CLASSES.indexOf(right)
      )),
    )) {
    reject('receipt.stable_outcome_classes is invalid');
  }
  const expected = browser === 'chromium' && source === 'browser_page'
    ? STABLE_OUTCOME_CLASSES
    : [];
  exact(value, expected, 'receipt.stable_outcome_classes');
  return Object.freeze([...value]);
}

export function validateSourceReceipt(value, browser, expectedSource) {
  if (!BROWSER_ORDER.includes(browser)) reject('receipt browser is not reviewed');
  if (!SOURCE_ORDER_BY_BROWSER[browser].includes(expectedSource)) {
    reject('receipt source is not reviewed for this browser');
  }
  rejectAggregatorPrivateMaterial(value);
  const receipt = exactKeys(value, [
    'schema',
    'browser',
    'source',
    'state',
    'assertions',
    'counters',
    'public_key_ids',
    'revision_ids',
    'stable_outcome_classes',
  ], 'receipt');
  exact(receipt.schema, SOURCE_RECEIPT_SCHEMA, 'receipt.schema');
  exact(receipt.browser, browser, 'receipt.browser');
  exact(receipt.source, expectedSource, 'receipt.source');
  exact(receipt.state, 'observed_closed', 'receipt.state');
  const expectedAssertions = SOURCE_ASSERTIONS[browser][expectedSource];
  const assertions = exactKeys(receipt.assertions, expectedAssertions, 'receipt.assertions');
  for (const assertion of expectedAssertions) {
    exact(assertions[assertion], true, `receipt.assertions.${assertion}`);
  }
  return Object.freeze({
    schema: SOURCE_RECEIPT_SCHEMA,
    browser,
    source: expectedSource,
    state: 'observed_closed',
    assertions: Object.freeze({ ...assertions }),
    counters: validateCounters(receipt.counters, browser, expectedSource),
    public_key_ids: validatePublicKeyIds(receipt.public_key_ids, browser, expectedSource),
    revision_ids: validateRevisionIds(receipt.revision_ids, browser, expectedSource),
    stable_outcome_classes: validateStableOutcomes(
      receipt.stable_outcome_classes,
      browser,
      expectedSource,
    ),
  });
}

function validateProfileValue(value) {
  rejectAggregatorPrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'aggregation',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-aggregator-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_independent_source_aggregator_implemented_not_wired_not_executed',
    'profile.state',
  );
  exact(profile.target, {
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  }, 'profile.target');
  exact(profile.pins, {
    implementation_base_commit: AGGREGATOR_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    browser_relay_runner_profile_sha256: BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    browser_relay_page_profile_sha256: BROWSER_RELAY_PAGE_PROFILE_SHA256,
    browser_relay_fixture_profile_sha256: FIXTURE_PROFILE_SHA256,
    browser_relay_fixture_cloud_profile_sha256: FIXTURE_CLOUD_PROFILE_SHA256,
    browser_relay_fixture_miakapi_profile_sha256: FIXTURE_MIAKAPI_PROFILE_SHA256,
    aggregator_source_sha256: AGGREGATOR_SOURCE_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) {
    reject('profile.pins contains an invalid immutable identifier');
  }
  exact(profile.aggregation.source_receipt_schema, SOURCE_RECEIPT_SCHEMA,
    'profile.aggregation.source_receipt_schema');
  exact(profile.aggregation.engine_result_schema, ENGINE_RESULT_SCHEMA,
    'profile.aggregation.engine_result_schema');
  exact(profile.aggregation.browser_order, BROWSER_ORDER,
    'profile.aggregation.browser_order');
  exact(profile.aggregation.source_order_by_browser, SOURCE_ORDER_BY_BROWSER,
    'profile.aggregation.source_order_by_browser');
  exact(profile.aggregation.assertion_owners, SOURCE_ASSERTIONS,
    'profile.aggregation.assertion_owners');
  exact(profile.aggregation.counter_owners, COUNTER_OWNERS,
    'profile.aggregation.counter_owners');
  exact(profile.aggregation.independent_sources, [
    'firebase_app_check',
    'hosting',
    'control_plane',
    'relay',
    'coordinator',
    'kms',
    'firestore',
  ], 'profile.aggregation.independent_sources');
  exact(profile.aggregation.receipts_per_matrix, 18,
    'profile.aggregation.receipts_per_matrix');
  for (const [field, expected] of Object.entries({
    single_use: true,
    receipt_order_exact: true,
    receipt_retries: 0,
    assertion_source_overlap: 0,
    browser_self_attested_cloud_assertions: false,
    raw_receipts_retained: false,
    arbitrary_errors_propagated: false,
  })) exact(profile.aggregation[field], expected, `profile.aggregation.${field}`);
  for (const browser of BROWSER_ORDER) {
    const ownedAssertions = SOURCE_ORDER_BY_BROWSER[browser]
      .flatMap((source) => SOURCE_ASSERTIONS[browser][source]);
    exact(new Set(ownedAssertions).size, ownedAssertions.length,
      `profile.aggregation.${browser} assertion ownership`);
    exact([...ownedAssertions].sort(), [...runnerProfile.assertions[browser]].sort(),
      `profile.aggregation.${browser} assertion coverage`);
  }
  exact(profile.output.allowed_observations, [
    'bounded_counts',
    'durations',
    'public_key_ids',
    'revision_ids',
    'stable_outcome_classes',
  ], 'profile.output.allowed_observations');
  exact(profile.output.forbidden_observations, [
    'browser_storage',
    'email',
    'execution_identifier',
    'firebase_uid',
    'har',
    'home_traffic',
    'raw_request_or_response',
    'token',
    'trace_context',
    'video',
    'websocket_frame',
  ], 'profile.output.forbidden_observations');
  if (Object.values(profile.authority).some((entry) => entry !== false)) {
    reject('profile.authority must remain closed');
  }
  exact(profile.evidence, {
    state: 'absent',
    live_receipts_aggregated: 0,
    live_engine_results: 0,
    cloud_mutations: 0,
    live_execution_count: 0,
    credentials_committed: false,
    raw_receipts_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

function regularPinnedFile(path, maximumBytes, expectedSha256, description) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || sha256(readFileSync(path)) !== expectedSha256) {
    reject(`${description} differs from the reviewed regular file`);
  }
}

export function validateBrowserRelayAggregatorProfile() {
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayRunnerProfile();
  validateBrowserRelayPageProfile();
  validateBrowserRelayFixtureProfile();
  validateBrowserRelayFixtureCloudProfile();
  validateBrowserRelayFixtureMiakApiProfile();
  regularPinnedFile(
    profilePath,
    MAXIMUM_PROFILE_BYTES,
    AGGREGATOR_PROFILE_SHA256,
    'Browser-relay aggregator profile',
  );
  regularPinnedFile(
    aggregatorPath,
    32 * 1024,
    AGGREGATOR_SOURCE_SHA256,
    'Browser-relay aggregator source',
  );
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('Browser-relay aggregator profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== readFileSync(profilePath, 'utf8')) {
    reject('Browser-relay aggregator profile is not canonical JSON');
  }
  return validateProfileValue(value);
}

export function validateAggregatorDuration(value, browser) {
  if (!BROWSER_ORDER.includes(browser)) reject('aggregation browser is not reviewed');
  return boundedInteger(
    value,
    0,
    BROWSER_DEADLINES_MILLISECONDS[browser],
    'aggregation.duration_milliseconds',
  );
}
