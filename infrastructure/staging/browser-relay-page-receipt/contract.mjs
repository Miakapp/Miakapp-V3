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
} from '../browser-relay-runner/contract.mjs';
import {
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
  MAXIMUM_CHROMIUM_MILLISECONDS,
  validateBrowserRelayPageProfile,
  validatePageSafeObservation,
} from '../browser-relay-page/contract.mjs';
import {
  AGGREGATOR_PROFILE_SHA256,
  COUNTER_KEYS,
  SOURCE_ASSERTIONS,
  SOURCE_RECEIPT_SCHEMA,
  STABLE_OUTCOME_CLASSES,
  validateBrowserRelayAggregatorProfile,
} from '../browser-relay-aggregator/contract.mjs';

export const PAGE_RECEIPT_PROFILE_PATH = 'browser-relay-page-receipt/profile.json';
export const PAGE_RECEIPT_PROFILE_SHA256 =
  '37f3b7a23b28a42f2a073e85744e986ecced39e64ff045aee915378a7b4aaaa3';
export const PAGE_RECEIPT_IMPLEMENTATION_BASE_COMMIT =
  '361cabb9a88d5cb3efebd40f3f803cf7023c02e3';
export const PAGE_RECEIPT_SOURCE_SHA256 =
  '12f209051e7e0871226d964fe2e07e6f40b94cf2305a4bcb0e457a17c5151a6c';
export const PAGE_FACT_SCHEMA = 'miakapp.staging-browser-relay-page-fact/1';
export const PAGE_LIFECYCLE_EVENT_SCHEMA =
  'miakapp.staging-browser-relay-page-lifecycle-event/1';
export const PAGE_STATE_OBSERVATION_SCHEMA =
  'miakapp.staging-browser-relay-page-state-observation/1';
export const PAGE_CALL_OBSERVATION_SCHEMA =
  'miakapp.staging-browser-relay-page-call-observation/1';
export const MINIMUM_RENEWAL_INTERVAL_MILLISECONDS = 240_000;
export const MAXIMUM_RENEWAL_INTERVAL_MILLISECONDS = 330_000;
export const MAXIMUM_LIFECYCLE_PAUSE_MILLISECONDS = 30_000;
export const REQUIRED_MATRIX_PRIVATE_INPUTS = 4;

export const PAGE_FACT_ORDER_BY_BROWSER = Object.freeze({
  chromium: Object.freeze([
    'initial_initialized',
    'initial_ready',
    'authoritative_state',
    'patched_state',
    'initial_call',
    'same_relay_reauthenticated',
    'relay_handoff_stale',
    'relay_b_ready',
    'relay_b_state',
    'relay_b_call',
    'failed_and_uncertain_calls',
    'relay_b_recovered',
    'pagehide_suspended',
    'pageshow_restored',
    'signed_out_stopped',
    'replacement_initialized',
    'replacement_ready',
    'replacement_stopped',
  ]),
  firefox: Object.freeze([
    'initial_initialized',
    'initial_ready',
    'signed_out_stopped',
  ]),
  webkit: Object.freeze([
    'initial_initialized',
    'initial_ready',
    'signed_out_stopped',
  ]),
});

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const producerPath = new URL('producer.mjs', import.meta.url);
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
  'app_check_token',
  'authorization',
  'browser_storage',
  'cookie',
  'custom_token',
  'email',
  'execution_identifier',
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

export class StagingBrowserRelayPageReceiptError extends Error {
  constructor(message = 'Staging browser-page receipt evidence is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayPageReceiptError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayPageReceiptError(message);
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

export function rejectPageReceiptPrivateMaterial(value, path = 'page_fact') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains private material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPageReceiptPrivateMaterial(
      entry,
      `${path}[${index}]`,
    ));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is forbidden`);
      rejectPageReceiptPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function validatePageStateObservation(value) {
  const observation = exactKeys(value, [
    'schema',
    'state',
    'revision',
    'stale',
  ], 'page_fact.state_observation');
  exact(observation.schema, PAGE_STATE_OBSERVATION_SCHEMA,
    'page_fact.state_observation.schema');
  if (!['matched', 'pending'].includes(observation.state)) {
    reject('page_fact.state_observation.state is invalid');
  }
  boundedInteger(observation.revision, 0, 64, 'page_fact.state_observation.revision');
  if (typeof observation.stale !== 'boolean') {
    reject('page_fact.state_observation.stale is invalid');
  }
  if (observation.state === 'matched'
    && (observation.revision < 1 || observation.stale !== false)) {
    reject('A matched state observation must be authoritative');
  }
  if (observation.state === 'pending' && observation.stale !== true) {
    reject('A pending state observation must be explicitly stale');
  }
  return Object.freeze({ ...observation });
}

export function validatePageCallObservation(value) {
  const observation = exactKeys(value, [
    'schema',
    'state',
    'outcome',
  ], 'page_fact.call_observation');
  exact(observation.schema, PAGE_CALL_OBSERVATION_SCHEMA,
    'page_fact.call_observation.schema');
  exact(observation.state, 'completed', 'page_fact.call_observation.state');
  exact(observation.outcome, 'applied', 'page_fact.call_observation.outcome');
  return Object.freeze({ ...observation });
}

export function validatePageLifecycleEvent(value) {
  const event = exactKeys(value, [
    'schema',
    'type',
    'visibility_state',
    'persisted',
  ], 'page_fact.lifecycle_event');
  exact(event.schema, PAGE_LIFECYCLE_EVENT_SCHEMA, 'page_fact.lifecycle_event.schema');
  const expected = event.type === 'pagehide'
    ? { visibility_state: 'hidden', persisted: true }
    : (event.type === 'pageshow'
      ? { visibility_state: 'visible', persisted: true }
      : null);
  if (expected === null) reject('page_fact.lifecycle_event.type is invalid');
  exact(
    { visibility_state: event.visibility_state, persisted: event.persisted },
    expected,
    'page_fact.lifecycle_event',
  );
  return Object.freeze({ ...event });
}

export function validateBrowserRelayPageFact(
  value,
  browser,
  expectedSequence,
) {
  if (!BROWSER_ORDER.includes(browser)) reject('Page-fact browser is not reviewed');
  const phases = PAGE_FACT_ORDER_BY_BROWSER[browser];
  boundedInteger(expectedSequence, 1, phases.length, 'expected page-fact sequence');
  rejectPageReceiptPrivateMaterial(value);
  const fact = exactKeys(value, [
    'schema',
    'browser',
    'sequence',
    'phase',
    'page_instance',
    'input_generation',
    'identity_generation',
    'elapsed_milliseconds',
    'observation',
    'state_observation',
    'call_observation',
    'lifecycle_event',
  ], 'page_fact');
  exact(fact.schema, PAGE_FACT_SCHEMA, 'page_fact.schema');
  exact(fact.browser, browser, 'page_fact.browser');
  exact(fact.sequence, expectedSequence, 'page_fact.sequence');
  exact(fact.phase, phases[expectedSequence - 1], 'page_fact.phase');
  boundedInteger(fact.page_instance, 1, 2, 'page_fact.page_instance');
  boundedInteger(fact.input_generation, 1, 2, 'page_fact.input_generation');
  boundedInteger(fact.identity_generation, 1, 2, 'page_fact.identity_generation');
  boundedInteger(
    fact.elapsed_milliseconds,
    0,
    BROWSER_DEADLINES_MILLISECONDS[browser],
    'page_fact.elapsed_milliseconds',
  );
  let observation;
  try {
    observation = validatePageSafeObservation(fact.observation);
  } catch {
    return reject('page_fact.observation is not a closed page observation');
  }
  exact(observation.browser, browser, 'page_fact.observation.browser');
  const stateObservation = fact.state_observation === null
    ? null
    : validatePageStateObservation(fact.state_observation);
  const callObservation = fact.call_observation === null
    ? null
    : validatePageCallObservation(fact.call_observation);
  const lifecycleEvent = fact.lifecycle_event === null
    ? null
    : validatePageLifecycleEvent(fact.lifecycle_event);
  return Object.freeze({
    ...fact,
    observation,
    state_observation: stateObservation,
    call_observation: callObservation,
    lifecycle_event: lifecycleEvent,
  });
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
  rejectPageReceiptPrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'producer',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-page-receipt-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_browser_page_receipt_producer_implemented_not_wired_not_executed',
    'profile.state',
  );
  exact(profile.target, {
    project_id: 'miakapp-v4-staging',
    project_number: '1072737219170',
    region: 'europe-west9',
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  }, 'profile.target');
  exact(profile.pins, {
    implementation_base_commit: PAGE_RECEIPT_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    browser_relay_page_profile_sha256: BROWSER_RELAY_PAGE_PROFILE_SHA256,
    browser_relay_aggregator_profile_sha256: AGGREGATOR_PROFILE_SHA256,
    producer_source_sha256: PAGE_RECEIPT_SOURCE_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) {
    reject('profile.pins contains an invalid immutable identifier');
  }
  exact(profile.producer, {
    page_fact_schema: PAGE_FACT_SCHEMA,
    source_receipt_schema: SOURCE_RECEIPT_SCHEMA,
    source: 'browser_page',
    browser_order: BROWSER_ORDER,
    fact_order_by_browser: PAGE_FACT_ORDER_BY_BROWSER,
    chromium_facts: 18,
    secondary_browser_facts: 3,
    page_instances_by_browser: {
      chromium: 2,
      firefox: 1,
      webkit: 1,
    },
    required_matrix_private_inputs: REQUIRED_MATRIX_PRIVATE_INPUTS,
    single_use: true,
    fact_order_exact: true,
    fact_retries: 0,
    raw_facts_retained: false,
    arbitrary_errors_propagated: false,
    minimum_renewal_interval_milliseconds: MINIMUM_RENEWAL_INTERVAL_MILLISECONDS,
    maximum_renewal_interval_milliseconds: MAXIMUM_RENEWAL_INTERVAL_MILLISECONDS,
    maximum_lifecycle_pause_milliseconds: MAXIMUM_LIFECYCLE_PAUSE_MILLISECONDS,
    native_pagehide_pageshow_persisted_required: true,
    identity_generation_change_required: true,
    prior_identity_stopped_before_replacement: true,
    maximum_active_websockets: 1,
    source_credentials_on_websocket: 0,
    browser_credential_persistence_events: 0,
  }, 'profile.producer');
  exact(profile.compatibility, {
    current_fixture_private_inputs: 3,
    required_matrix_private_inputs: REQUIRED_MATRIX_PRIVATE_INPUTS,
    fixture_capacity_satisfied: false,
    current_page_chromium_milliseconds: MAXIMUM_CHROMIUM_MILLISECONDS,
    required_page_chromium_milliseconds: 600_000,
    page_timing_capacity_satisfied: true,
    page_host_api_scenario_complete: false,
    playwright_bridge_present: false,
    aggregator_wired: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    chromium_assertions: SOURCE_ASSERTIONS.chromium.browser_page,
    firefox_assertions: SOURCE_ASSERTIONS.firefox.browser_page,
    webkit_assertions: SOURCE_ASSERTIONS.webkit.browser_page,
    chromium_stable_outcome_classes: STABLE_OUTCOME_CLASSES,
    secondary_stable_outcome_classes: [],
    public_key_ids: [],
    revision_ids: [],
    allowed_observations: [
      'bounded_counts',
      'durations',
      'stable_outcome_classes',
    ],
    forbidden_observations: [
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
    ],
  }, 'profile.output');
  if (Object.values(profile.authority).some((entry) => entry !== false)) {
    reject('profile.authority must remain closed');
  }
  exact(profile.evidence, {
    state: 'absent',
    live_page_facts: 0,
    live_receipts: 0,
    cloud_mutations: 0,
    live_execution_count: 0,
    credentials_committed: false,
    raw_facts_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayPageReceiptProfile() {
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayPageProfile();
  validateBrowserRelayAggregatorProfile();
  regularPinnedFile(
    profilePath,
    MAXIMUM_PROFILE_BYTES,
    PAGE_RECEIPT_PROFILE_SHA256,
    'Browser-page receipt profile',
  );
  regularPinnedFile(
    producerPath,
    48 * 1024,
    PAGE_RECEIPT_SOURCE_SHA256,
    'Browser-page receipt producer',
  );
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('Browser-page receipt profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== readFileSync(profilePath, 'utf8')) {
    reject('Browser-page receipt profile is not canonical JSON');
  }
  return validateProfileValue(value);
}

export function emptyPageReceiptCounters() {
  return Object.freeze(Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0])));
}
