import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  EVIDENCE_SESSION_PROFILE_SHA256,
  validateBrowserRelayEvidenceSessionProfile,
} from '../browser-relay-evidence-session/contract.mjs';
import {
  FACT_ORDER_BY_BROWSER,
  INDEPENDENT_SOURCES_BY_BROWSER,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  PAGE_FACT_ORDER_BY_BROWSER,
} from '../browser-relay-page-receipt/contract.mjs';
import {
  RUNNER_RESULT_SCHEMA,
} from '../browser-relay-runner/contract.mjs';
import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';

export const CASE_SCHEDULER_PROFILE_PATH = 'browser-relay-case-scheduler/profile.json';
export const CASE_SCHEDULER_PROFILE_SHA256 =
  '132e7a76717e36d2b8222412d0f806d5f6acf9292ab83fe3add0981304279cab';
export const CASE_SCHEDULER_IMPLEMENTATION_BASE_COMMIT =
  '17a21138e4deccfb175354ae81aad9e52fc3edb2';
export const CASE_SCHEDULER_SOURCE_SHA256 =
  'd2b6d3e7c0364241c5916b166dae8be9a34a60095b72dfe3a9e0d5bb39df4efb';
export const CASE_SCHEDULER_INTERNAL_SOURCE_SHA256 =
  'd4db6014afd559689b9cf90b462ce324502a43eae578f00f6e5a7bbb1aa29275';
export const CASE_SCHEDULER_TESTING_SOURCE_SHA256 =
  '11659d0c63067e9e8af8ab298c4bc5d073f17f84da86f8c64f652dad62ccdd69';
export const CASE_SCHEDULER_DEPENDENCY_CONTRACTS_SHA256 =
  'a9a2518da655f43ff1fd843013a85a150d706b1b90be38d2cf84b68550337d38';
export const CASE_SCHEDULER_RUNNER_RESULT_SCHEMA = RUNNER_RESULT_SCHEMA;

export const CASE_ORDER = Object.freeze([
  'LIVE-02',
  'LIVE-03',
  'LIVE-04',
  'LIVE-05',
  'LIVE-06',
  'LIVE-07',
  'LIVE-08',
  'LIVE-09',
  'LIVE-10',
  'LIVE-11',
]);

export const STAGE_ORDER = Object.freeze([
  Object.freeze({ case_id: 'LIVE-02', browser: 'chromium' }),
  Object.freeze({ case_id: 'LIVE-03', browser: 'chromium' }),
  Object.freeze({ case_id: 'LIVE-04', browser: 'chromium' }),
  Object.freeze({ case_id: 'LIVE-05', browser: 'chromium' }),
  Object.freeze({ case_id: 'LIVE-06', browser: 'chromium' }),
  Object.freeze({ case_id: 'LIVE-07', browser: 'chromium' }),
  Object.freeze({ case_id: 'LIVE-08', browser: 'chromium' }),
  Object.freeze({ case_id: 'LIVE-09', browser: 'chromium' }),
  Object.freeze({ case_id: 'LIVE-10', browser: 'firefox' }),
  Object.freeze({ case_id: 'LIVE-10', browser: 'webkit' }),
  Object.freeze({ case_id: 'LIVE-11', browser: 'chromium' }),
]);

function frozenFactKinds(value) {
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([source, facts]) => [
    source,
    Object.freeze(facts),
  ])));
}

export const FACT_KINDS_BY_STAGE = Object.freeze({
  'LIVE-02/chromium': frozenFactKinds({
    firebase_app_check: [
      'provider_assessment',
      'valid_verification',
      'missing_token_denial',
      'invalid_token_denial',
      'verification_mode',
    ],
    hosting: ['management_site_configuration', 'served_sdk_configuration'],
  }),
  'LIVE-03/chromium': frozenFactKinds({
    control_plane: [
      'cors_preflight',
      'foreign_origin_denial',
      'source_uid_admission',
      'authenticated_cache_policy',
    ],
  }),
  'LIVE-04/chromium': frozenFactKinds({
    browser_page: [
      'initial_initialized',
      'initial_ready',
      'authoritative_state',
      'patched_state',
      'initial_call',
    ],
  }),
  'LIVE-05/chromium': frozenFactKinds({
    browser_page: ['same_relay_reauthenticated'],
    control_plane: [
      'version_2_jwk_published',
      'version_1_last_issuance',
      'version_2_first_issuance',
    ],
    relay: ['version_2_existing_socket'],
  }),
  'LIVE-06/chromium': frozenFactKinds({
    browser_page: [
      'relay_handoff_stale',
      'relay_b_ready',
      'relay_b_state',
      'relay_b_call',
    ],
    control_plane: ['atomic_credential_reuse'],
    firestore: ['authoritative_route_transition'],
  }),
  'LIVE-07/chromium': frozenFactKinds({
    relay: [
      'wrong_audience_denial',
      'wrong_home_denial',
      'wrong_role_denial',
      'unknown_kid_refresh',
    ],
  }),
  'LIVE-08/chromium': frozenFactKinds({
    browser_page: ['failed_and_uncertain_calls', 'relay_b_recovered'],
    relay: ['disconnect_reconnect_resync'],
    coordinator: ['physical_call_delivery'],
  }),
  'LIVE-09/chromium': frozenFactKinds({
    browser_page: [
      'pagehide_suspended',
      'pageshow_restored',
      'signed_out_stopped',
      'replacement_initialized',
      'replacement_ready',
      'replacement_stopped',
    ],
  }),
  'LIVE-10/firefox': frozenFactKinds({
    browser_page: ['initial_initialized', 'initial_ready', 'signed_out_stopped'],
    firebase_app_check: ['provider_assessment', 'valid_verification'],
    control_plane: ['exchange_summary'],
    relay: ['version_2_session', 'revision_summary'],
    kms: ['signature_summary'],
  }),
  'LIVE-10/webkit': frozenFactKinds({
    browser_page: ['initial_initialized', 'initial_ready', 'signed_out_stopped'],
    firebase_app_check: ['provider_assessment', 'valid_verification'],
    control_plane: ['exchange_summary'],
    relay: ['version_2_session', 'revision_summary'],
    kms: ['signature_summary'],
  }),
  'LIVE-11/chromium': frozenFactKinds({
    control_plane: [
      'version_1_jwk_retained',
      'version_1_jwk_removed',
      'exchange_summary',
    ],
    relay: ['new_session_version_2', 'revision_summary'],
    kms: ['signature_summary', 'version_1_lifecycle'],
    firestore: ['operation_write_summary'],
  }),
});

export const RECORD_COUNTS_BY_STAGE = Object.freeze(Object.fromEntries(
  Object.entries(FACT_KINDS_BY_STAGE).map(([stage, sources]) => [
    stage,
    Object.freeze(Object.fromEntries(Object.entries(sources).map(([source, facts]) => [
      source,
      facts.length,
    ]))),
  ]),
));

function action(type, fields = {}) {
  return Object.freeze({ type, ...fields });
}

function stageAction(caseId, browser) {
  const stage = STAGE_ORDER.find((candidate) => (
    candidate.case_id === caseId && candidate.browser === browser
  ));
  if (stage === undefined) throw new Error('Invalid reviewed scheduler action plan');
  return action('execute_stage', { stage });
}

export const SCHEDULE_ACTIONS = Object.freeze([
  action('start_browser', { browser: 'chromium', starts_session_span: false }),
  action('create_session'),
  stageAction('LIVE-02', 'chromium'),
  stageAction('LIVE-03', 'chromium'),
  stageAction('LIVE-04', 'chromium'),
  stageAction('LIVE-05', 'chromium'),
  stageAction('LIVE-06', 'chromium'),
  stageAction('LIVE-07', 'chromium'),
  stageAction('LIVE-08', 'chromium'),
  stageAction('LIVE-09', 'chromium'),
  action('close_page', { browser: 'chromium' }),
  action('start_browser', { browser: 'firefox', starts_session_span: true }),
  stageAction('LIVE-10', 'firefox'),
  action('close_page', { browser: 'firefox' }),
  action('close_browser', { browser: 'firefox' }),
  action('start_browser', { browser: 'webkit', starts_session_span: true }),
  stageAction('LIVE-10', 'webkit'),
  action('close_page', { browser: 'webkit' }),
  action('close_browser', { browser: 'webkit' }),
  stageAction('LIVE-11', 'chromium'),
  action('close_browser', { browser: 'chromium' }),
  action('close_adapter'),
  action('close_session'),
]);

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const schedulerPath = new URL('scheduler.mjs', import.meta.url);
const internalPath = new URL('internal.mjs', import.meta.url);
const testingPath = new URL('testing.mjs', import.meta.url);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-evidence-session/contract.mjs',
  '../browser-relay-independent-observers/contract.mjs',
  '../browser-relay-page-receipt/contract.mjs',
  '../browser-relay-runner/contract.mjs',
  '../browser-relay/contract.mjs',
].sort());
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

export class StagingBrowserRelayCaseSchedulerError extends Error {
  constructor(message = 'Staging browser-relay case schedule failed closed') {
    super(message);
    this.name = 'StagingBrowserRelayCaseSchedulerError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayCaseSchedulerError(message);
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

export function browserRelayCaseSchedulerDependencyContractsSha256() {
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

function validateRecordPartition(plan) {
  exact(
    plan.matrix.slice(1, -1).map(({ id }) => id),
    CASE_ORDER,
    'Scheduler case order against the reviewed live matrix',
  );
  const actual = Object.fromEntries(Object.keys(PAGE_FACT_ORDER_BY_BROWSER).map((browser) => [
    browser,
    Object.fromEntries([
      ['browser_page', 0],
      ...INDEPENDENT_SOURCES_BY_BROWSER[browser].map((source) => [source, 0]),
    ]),
  ]));
  for (const { case_id: caseId, browser } of STAGE_ORDER) {
    const stage = RECORD_COUNTS_BY_STAGE[`${caseId}/${browser}`];
    for (const [source, count] of Object.entries(stage)) {
      if (!Object.hasOwn(actual[browser], source)
        || !Number.isSafeInteger(count) || count <= 0) {
        reject('Scheduler record partition contains an invalid source allocation');
      }
      actual[browser][source] += count;
    }
  }
  const expected = Object.fromEntries(Object.keys(PAGE_FACT_ORDER_BY_BROWSER).map((browser) => [
    browser,
    Object.fromEntries([
      ['browser_page', PAGE_FACT_ORDER_BY_BROWSER[browser].length],
      ...INDEPENDENT_SOURCES_BY_BROWSER[browser].map((source) => [
        source,
        FACT_ORDER_BY_BROWSER[browser][source].length,
      ]),
    ]),
  ]));
  exact(actual, expected, 'Scheduler record partition');
  exact(
    Object.keys(RECORD_COUNTS_BY_STAGE),
    STAGE_ORDER.map(({ case_id: caseId, browser }) => `${caseId}/${browser}`),
    'Scheduler record stage order',
  );
  exact(
    Object.keys(FACT_KINDS_BY_STAGE),
    STAGE_ORDER.map(({ case_id: caseId, browser }) => `${caseId}/${browser}`),
    'Scheduler fact-kind stage order',
  );
  for (const browser of Object.keys(PAGE_FACT_ORDER_BY_BROWSER)) {
    const sourceOrders = {
      browser_page: PAGE_FACT_ORDER_BY_BROWSER[browser],
      ...FACT_ORDER_BY_BROWSER[browser],
    };
    for (const [source, expectedFacts] of Object.entries(sourceOrders)) {
      const actualFacts = STAGE_ORDER
        .filter((stage) => stage.browser === browser)
        .flatMap((stage) => (
          FACT_KINDS_BY_STAGE[`${stage.case_id}/${browser}`][source] ?? []
        ));
      exact(actualFacts, expectedFacts, `Scheduler ${browser}/${source} fact-kind partition`);
    }
  }
}

function validateScheduleActions() {
  exact(
    SCHEDULE_ACTIONS.filter(({ type }) => type === 'execute_stage').map(({ stage }) => stage),
    STAGE_ORDER,
    'Scheduler action-plan stages',
  );
  exact(
    SCHEDULE_ACTIONS.filter(({ type }) => type === 'start_browser')
      .map(({ browser }) => browser),
    ['chromium', 'firefox', 'webkit'],
    'Scheduler action-plan browser starts',
  );
  exact(
    SCHEDULE_ACTIONS.filter(({ type }) => type === 'close_page')
      .map(({ browser }) => browser),
    ['chromium', 'firefox', 'webkit'],
    'Scheduler action-plan page closes',
  );
  exact(
    SCHEDULE_ACTIONS.filter(({ type }) => type === 'close_browser')
      .map(({ browser }) => browser),
    ['firefox', 'webkit', 'chromium'],
    'Scheduler action-plan browser closes',
  );
  exact(
    SCHEDULE_ACTIONS.map(({ type }) => type).slice(-2),
    ['close_adapter', 'close_session'],
    'Scheduler action-plan terminal barriers',
  );
}

function validateProfileValue(value, plan) {
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'schedule',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-case-scheduler-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_case_interleaving_implemented_not_wired_not_executed',
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
    implementation_base_commit: CASE_SCHEDULER_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    browser_relay_evidence_session_profile_sha256: EVIDENCE_SESSION_PROFILE_SHA256,
    dependency_contracts_sha256: CASE_SCHEDULER_DEPENDENCY_CONTRACTS_SHA256,
    scheduler_source_sha256: CASE_SCHEDULER_SOURCE_SHA256,
    internal_source_sha256: CASE_SCHEDULER_INTERNAL_SOURCE_SHA256,
    testing_source_sha256: CASE_SCHEDULER_TESTING_SOURCE_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) reject('profile.pins contains an invalid immutable identifier');
  exact(profile.schedule, {
    case_order: CASE_ORDER,
    stage_order: STAGE_ORDER,
    fact_kinds_by_stage: FACT_KINDS_BY_STAGE,
    record_counts_by_stage: RECORD_COUNTS_BY_STAGE,
    action_plan: SCHEDULE_ACTIONS,
    adapter_methods: ['startBrowser', 'execute', 'closePage', 'closeBrowser', 'close'],
    case_scope_fields: ['case_id', 'browser', 'signal', 'record'],
    browser_start_order: ['chromium', 'firefox', 'webkit'],
    page_close_order: ['chromium', 'firefox', 'webkit'],
    browser_close_order: ['firefox', 'webkit', 'chromium'],
    secondary_browser_order: ['firefox', 'webkit'],
    adapter_start_precedes_session_boundary: true,
    chromium_starts_at_common_epoch: true,
    chromium_page_closes_after_live_09: true,
    chromium_browser_closes_after_live_11: true,
    adapter_global_close_precedes_session_close: true,
    exact_fact_kind_partition: true,
    exact_record_partition: true,
    cross_source_total_order_imposed: false,
    adapter_completion_value: 'undefined',
    case_scopes_serializable: false,
    case_scopes_revoked_after_stage: true,
    caller_supplied_case_order: false,
    caller_supplied_evidence_envelopes: false,
    caller_supplied_timestamps: false,
    caller_supplied_results: false,
    internal_abort_signal: true,
    external_abort_cooperative: true,
    external_abort_listener_protected: true,
    adapter_methods_receive_internal_abort_signal: true,
    adapter_close_once: true,
    adapter_close_after_invoked_work_settles: true,
    invoked_work_awaited_before_rejection: true,
  }, 'profile.schedule');
  exact(profile.compatibility, {
    evidence_session_composed: true,
    evidence_session_production_entrypoint_only: true,
    case_level_interleaving_scheduler_present: true,
    durable_claim_binding_present: false,
    live_operation_wired: false,
    live_source_adapters_present: false,
    playwright_bridge_wired: false,
    scenario_fixture_wired: false,
    complete_chromium_page_scenario: false,
    bfcache_capable_automation: false,
    callback_resolution_proves_resource_closure: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    runner_result_schema: RUNNER_RESULT_SCHEMA,
    partial_results_exposed: false,
    raw_facts_exposed: false,
    capability_identifiers_exposed: false,
    adapter_errors_exposed: false,
  }, 'profile.output');
  exact(profile.authority, {
    cloud_mutation_authorized: false,
    hosting_publication_authorized: false,
    iam_binding_mutation_authorized: false,
    public_ingress_authorized: false,
    live_execution_authorized: false,
  }, 'profile.authority');
  exact(profile.evidence, {
    state: 'absent',
    offline_complete_schedules: 0,
    live_source_facts: 0,
    cloud_requests: 0,
    cloud_mutations: 0,
    live_execution_count: 0,
    credentials_committed: false,
    raw_facts_committed: false,
  }, 'profile.evidence');
  validateRecordPartition(plan);
  validateScheduleActions();
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayCaseSchedulerProfile() {
  exact(
    browserRelayCaseSchedulerDependencyContractsSha256(),
    CASE_SCHEDULER_DEPENDENCY_CONTRACTS_SHA256,
    'Browser-relay case scheduler dependency contracts digest',
  );
  const plan = validateBrowserRelayPlan(
    new URL('../browser-relay/plan.json', import.meta.url),
  );
  validateBrowserRelayEvidenceSessionProfile();
  regularPinnedFile(
    profilePath,
    24 * 1024,
    CASE_SCHEDULER_PROFILE_SHA256,
    'Browser-relay case scheduler profile',
  );
  regularPinnedFile(
    schedulerPath,
    8 * 1024,
    CASE_SCHEDULER_SOURCE_SHA256,
    'Browser-relay case scheduler source',
  );
  regularPinnedFile(
    internalPath,
    32 * 1024,
    CASE_SCHEDULER_INTERNAL_SOURCE_SHA256,
    'Browser-relay case scheduler internal source',
  );
  regularPinnedFile(
    testingPath,
    8 * 1024,
    CASE_SCHEDULER_TESTING_SOURCE_SHA256,
    'Browser-relay case scheduler testing source',
  );
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('Browser-relay case scheduler profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== readFileSync(profilePath, 'utf8')) {
    reject('Browser-relay case scheduler profile is not canonical JSON');
  }
  return validateProfileValue(value, plan);
}
