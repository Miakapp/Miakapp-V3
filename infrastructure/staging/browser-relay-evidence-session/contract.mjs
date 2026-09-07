import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  INDEPENDENT_OBSERVERS_PROFILE_SHA256,
  INDEPENDENT_SOURCES_BY_BROWSER,
  validateBrowserRelayIndependentObserversProfile,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  PAGE_RECEIPT_PROFILE_SHA256,
  validateBrowserRelayPageReceiptProfile,
} from '../browser-relay-page-receipt/contract.mjs';
import {
  BROWSER_ORDER,
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  RUNNER_RESULT_SCHEMA,
  validateBrowserRelayRunnerProfile,
} from '../browser-relay-runner/contract.mjs';
import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';

export const EVIDENCE_SESSION_PROFILE_PATH = 'browser-relay-evidence-session/profile.json';
export const EVIDENCE_SESSION_PROFILE_SHA256 =
  '4936834d01d81f0cd4053ef3bd7c505e3d4f8139c381b28ab918248bd187a544';
export const EVIDENCE_SESSION_IMPLEMENTATION_BASE_COMMIT =
  '7f208f25254e9ba28991f286fd3ec1e5517fede8';
export const EVIDENCE_SESSION_SOURCE_SHA256 =
  '057470503c72c69808f7462e08fd317efe18b2a74e8b81f0f5e2745204efb9c0';
export const EVIDENCE_SESSION_INTERNAL_SOURCE_SHA256 =
  '6ac5a3d81af327ab2687b4e544a9127649726affcae2fffbbcadc7e26ac8bd5e';
export const EVIDENCE_SESSION_TESTING_SOURCE_SHA256 =
  'c3e33a2f40c7c16f6ded6bc2a931c38b6f98b24160ac29d2d564e6a879617a96';
export const EVIDENCE_SESSION_DEPENDENCY_CONTRACTS_SHA256 =
  'af55700786535b0cd771357fc86ab55d09a0a5151fb0c2698f157b310d789b2a';
export const PAGE_PORT_PAYLOAD_FIELDS = Object.freeze([
  'call_observation',
  'lifecycle_event',
  'lifecycle_observation',
  'observation',
  'state_observation',
]);
export const INDEPENDENT_PORT_PAYLOAD_FIELDS = Object.freeze(['observation']);

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const sessionPath = new URL('session.mjs', import.meta.url);
const internalPath = new URL('internal.mjs', import.meta.url);
const testingPath = new URL('testing.mjs', import.meta.url);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-independent-observers/contract.mjs',
  '../browser-relay-page-receipt/contract.mjs',
  '../browser-relay-runner/contract.mjs',
  '../browser-relay/contract.mjs',
].sort());
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

export class StagingBrowserRelayEvidenceSessionError extends Error {
  constructor(message = 'Staging browser-relay evidence session is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayEvidenceSessionError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayEvidenceSessionError(message);
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

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function browserRelayEvidenceSessionDependencyContractsSha256() {
  const hash = createHash('sha256');
  for (const path of DEPENDENCY_CONTRACT_PATHS) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(new URL(path, import.meta.url)));
    hash.update('\0');
  }
  return hash.digest('hex');
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
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'session',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-evidence-session-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_operation_local_capability_monotonic_epoch_implemented_not_wired_not_executed',
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
    implementation_base_commit: EVIDENCE_SESSION_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    browser_relay_runner_profile_sha256: BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    browser_relay_page_receipt_profile_sha256: PAGE_RECEIPT_PROFILE_SHA256,
    browser_relay_independent_observers_profile_sha256:
      INDEPENDENT_OBSERVERS_PROFILE_SHA256,
    dependency_contracts_sha256: EVIDENCE_SESSION_DEPENDENCY_CONTRACTS_SHA256,
    session_source_sha256: EVIDENCE_SESSION_SOURCE_SHA256,
    internal_source_sha256: EVIDENCE_SESSION_INTERNAL_SOURCE_SHA256,
    testing_source_sha256: EVIDENCE_SESSION_TESTING_SOURCE_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) reject('profile.pins contains an invalid immutable identifier');
  exact(profile.session, {
    browser_order: BROWSER_ORDER,
    independent_sources_by_browser: INDEPENDENT_SOURCES_BY_BROWSER,
    page_source: 'browser_page',
    page_port_payload_fields: PAGE_PORT_PAYLOAD_FIELDS,
    independent_port_payload_fields: INDEPENDENT_PORT_PAYLOAD_FIELDS,
    monotonic_clock: 'process_hrtime_bigint',
    production_clock_captured_at_module_initialization: true,
    test_clock_factory_present: true,
    test_clock_factory_live_import_authorized: false,
    common_operation_epoch: true,
    caller_supplied_timestamps: false,
    caller_supplied_sequences: false,
    caller_supplied_fact_envelopes: false,
    caller_supplied_receipts: false,
    opaque_root_capability: true,
    ports_attenuated_to_browser_source: true,
    single_use: true,
    fail_closed: true,
    retained_evidence_cleared_on_terminal_state: true,
    root_and_ports_serializable: false,
    chromium_anchors_epoch: true,
    secondary_browser_order: ['firefox', 'webkit'],
    chromium_finishes_last: true,
    interleaved_runner_result_supported: true,
    strict_millisecond_boundaries: true,
  }, 'profile.session');
  exact(profile.compatibility, {
    browser_page_receipt_producer_present: true,
    independent_source_fact_validator_present: true,
    independent_runner_result_producer_present: true,
    operation_local_provenance_primitive_present: true,
    durable_claim_binding_present: false,
    live_operation_wired: false,
    live_source_adapters_present: false,
    interleaving_scheduler_present: true,
    complete_chromium_page_scenario: false,
    bfcache_capable_automation: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    runner_result_schema: RUNNER_RESULT_SCHEMA,
    raw_facts_exposed: false,
    capability_identifiers_exposed: false,
    allowed_observations: [
      'bounded_counts',
      'durations',
      'public_key_ids',
      'revision_ids',
      'stable_enum_outcomes',
    ],
    forbidden_observations: [
      'browser_storage',
      'capability_identifier',
      'email',
      'execution_identifier',
      'firebase_uid',
      'har',
      'home_id',
      'home_traffic',
      'raw_cloud_response',
      'raw_fact',
      'raw_log_entry',
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
    offline_complete_sessions: 0,
    live_source_facts: 0,
    live_source_receipts: 0,
    cloud_requests: 0,
    cloud_mutations: 0,
    live_execution_count: 0,
    credentials_committed: false,
    raw_facts_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayEvidenceSessionProfile() {
  exact(
    browserRelayEvidenceSessionDependencyContractsSha256(),
    EVIDENCE_SESSION_DEPENDENCY_CONTRACTS_SHA256,
    'Browser-relay evidence session dependency contracts digest',
  );
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayRunnerProfile();
  validateBrowserRelayPageReceiptProfile();
  validateBrowserRelayIndependentObserversProfile();
  regularPinnedFile(
    profilePath,
    24 * 1024,
    EVIDENCE_SESSION_PROFILE_SHA256,
    'Browser-relay evidence session profile',
  );
  regularPinnedFile(
    sessionPath,
    8 * 1024,
    EVIDENCE_SESSION_SOURCE_SHA256,
    'Browser-relay evidence session source',
  );
  regularPinnedFile(
    internalPath,
    48 * 1024,
    EVIDENCE_SESSION_INTERNAL_SOURCE_SHA256,
    'Browser-relay evidence session internal source',
  );
  regularPinnedFile(
    testingPath,
    8 * 1024,
    EVIDENCE_SESSION_TESTING_SOURCE_SHA256,
    'Browser-relay evidence session testing source',
  );
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('Browser-relay evidence session profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== readFileSync(profilePath, 'utf8')) {
    reject('Browser-relay evidence session profile is not canonical JSON');
  }
  return validateProfileValue(value);
}
