import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';
import {
  CASE_SCHEDULER_PROFILE_SHA256,
  STAGE_ORDER,
  validateBrowserRelayCaseSchedulerProfile,
} from '../browser-relay-case-scheduler/contract.mjs';
import {
  CHROMIUM_SCENARIO_PROFILE_SHA256,
  CONTROL_PHASE_ORDER,
  validateBrowserRelayChromiumScenarioProfile,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  EVIDENCE_SESSION_PROFILE_SHA256,
  PAGE_PORT_PAYLOAD_FIELDS,
  validateBrowserRelayEvidenceSessionProfile,
} from '../browser-relay-evidence-session/contract.mjs';
import {
  PAGE_RECEIPT_PROFILE_SHA256,
  validateBrowserRelayPageReceiptProfile,
} from '../browser-relay-page-receipt/contract.mjs';
import {
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  RUNNER_RESULT_SCHEMA,
  validateBrowserRelayRunnerProfile,
} from '../browser-relay-runner/contract.mjs';
import {
  SCENARIO_FIXTURE_PROFILE_SHA256,
  validateBrowserRelayScenarioFixtureProfile,
} from '../browser-relay-scenario-fixture/contract.mjs';

export const CHROMIUM_CASE_ADAPTER_PROFILE_PATH =
  'browser-relay-chromium-case-adapter/profile.json';
export const CHROMIUM_CASE_ADAPTER_PROFILE_SHA256 =
  '2aa85ce1b4ce8fe99baa2523a9b4524b9b8c2a763c74fe6b17b312ee43e52d48';
export const CHROMIUM_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT =
  '04037dfd9b15a328a03611c80256589844fc2a1d';
export const CHROMIUM_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256 =
  '5fe5699a6a2c603cab69632682bb546b127092bac34c8b9e0eb96e641be0f774';
export const CHROMIUM_CASE_ADAPTER_SOURCE_SHA256 =
  '58b7b519b9ab55c0deb89655f30fbdc5a0cec0d2818849220e3f7abce7178988';
export const CHROMIUM_CASE_ADAPTER_INTERNAL_SOURCE_SHA256 =
  '16b2b8096e7dcb4ef8cf29118de696e6b553b549343afc97794994b5901a1b87';
export const CHROMIUM_CASE_ADAPTER_TESTING_SOURCE_SHA256 =
  '6461713caf9b0212b8b153aa3c2321550c58d3023471fa0880f4449080adca6a';
export const CHROMIUM_CASE_ADAPTER_GUARD_SOURCE_SHA256 =
  '375aaeb28adb7b21641ff01ebe08efe0825d4df22f36097b92740b061bfec0d8';
export const CHROMIUM_CASE_ADAPTER_UNIT_TEST_SHA256 =
  'ab9144f7b27e785a0f1613c86ac86c1b6a5d20bee5f9ba47a0b5533d0226db69';
export const CHROMIUM_CASE_ADAPTER_WORKFLOW_SHA256 =
  'f4b0f6b60b0fa4c311ed4228d9b196ec6fce00ed4bc4196e3cbf6fdea5c7a02b';

export const CHROMIUM_CASE_ADAPTER_COMPONENT_FIELDS = Object.freeze([
  'fixture',
  'openChromiumPage',
  'prepareChromiumPhase',
  'remainingAdapter',
]);
export const CHROMIUM_CASE_ADAPTER_FIXTURE_METHODS = Object.freeze([
  'stateExpectation',
  'setTemperature',
  'privateInput',
  'rotateRelayToB',
]);
export const CHROMIUM_CASE_ADAPTER_REMAINING_METHODS = Object.freeze([
  'startBrowser',
  'execute',
  'closePage',
  'closeBrowser',
  'close',
]);
export const CHROMIUM_CASE_ADAPTER_STAGE_ORDER = Object.freeze(
  STAGE_ORDER.map((stage) => Object.freeze({ ...stage })),
);
export const CHROMIUM_CASE_ADAPTER_START_ORDER = Object.freeze([
  'chromium',
  'firefox',
  'webkit',
]);
export const CHROMIUM_CASE_ADAPTER_PAGE_CLOSE_ORDER = Object.freeze([
  'chromium',
  'firefox',
  'webkit',
]);
export const CHROMIUM_CASE_ADAPTER_BROWSER_CLOSE_ORDER = Object.freeze([
  'firefox',
  'webkit',
  'chromium',
]);
export const CHROMIUM_CASE_ADAPTER_PAGE_PROJECTION_FIELDS = PAGE_PORT_PAYLOAD_FIELDS;
export const CHROMIUM_PAGE_STAGE_BY_SEQUENCE = Object.freeze([
  ...Array(5).fill('LIVE-04'),
  'LIVE-05',
  ...Array(4).fill('LIVE-06'),
  ...Array(2).fill('LIVE-08'),
  ...Array(6).fill('LIVE-09'),
]);
export const CHROMIUM_CONTROL_STAGE_BY_PHASE = Object.freeze({
  authoritative_state: 'LIVE-04',
  patched_state: 'LIVE-04',
  initial_call: 'LIVE-04',
  same_relay_reauthenticated: 'LIVE-05',
  relay_handoff_stale: 'LIVE-06',
  relay_b_ready: 'LIVE-06',
  relay_b_state: 'LIVE-06',
  relay_b_call: 'LIVE-06',
  failed_call: 'LIVE-08',
  uncertain_call: 'LIVE-08',
  relay_b_recovered: 'LIVE-08',
});

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const adapterPath = new URL('adapter.mjs', import.meta.url);
const internalPath = new URL('internal.mjs', import.meta.url);
const testingPath = new URL('testing.mjs', import.meta.url);
const guardPath = new URL('guard.mjs', import.meta.url);
const unitTestPath = new URL(
  '../test/browser-relay-chromium-case-adapter.test.mjs',
  import.meta.url,
);
const workflowPath = new URL(
  '../../../.github/workflows/browser-relay-chromium-scenario.yml',
  import.meta.url,
);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-case-scheduler/contract.mjs',
  '../browser-relay-chromium-scenario/contract.mjs',
  '../browser-relay-evidence-session/contract.mjs',
  '../browser-relay-page-receipt/contract.mjs',
  '../browser-relay-runner/contract.mjs',
  '../browser-relay-scenario-fixture/contract.mjs',
  '../browser-relay/contract.mjs',
].sort());
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
]);
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'authorization',
  'cookie',
  'custom_token',
  'email',
  'firebase_custom_token',
  'firebase_id_token',
  'firebase_uid',
  'home_key',
  'id_token',
  'password',
  'private_key',
  'raw_error',
  'raw_request',
  'raw_response',
  'refresh_token',
  'request_headers',
  'response_headers',
  'token',
]);

export class StagingBrowserRelayChromiumCaseAdapterError extends Error {
  constructor(message = 'Staging Chromium case-adapter composition failed closed') {
    super(message);
    this.name = 'StagingBrowserRelayChromiumCaseAdapterError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayChromiumCaseAdapterError(message);
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
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is forbidden`);
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function chromiumCaseAdapterDependencyContractsSha256() {
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

function validateProfileValue(profile) {
  rejectPrivateMaterial(profile);
  exactKeys(profile, [
    'schema', 'revision', 'state', 'target', 'pins', 'composition', 'controls',
    'trust_boundary', 'compatibility', 'output', 'authority', 'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(
    profile.schema,
    'miakapp.staging-browser-relay-chromium-case-adapter-profile/1',
    'profile.schema',
  );
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_chromium_scenario_case_scheduler_composition_offline_proven_not_live_wired_not_executed',
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
    implementation_base_commit: CHROMIUM_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    browser_relay_case_scheduler_profile_sha256: CASE_SCHEDULER_PROFILE_SHA256,
    browser_relay_chromium_scenario_profile_sha256: CHROMIUM_SCENARIO_PROFILE_SHA256,
    browser_relay_scenario_fixture_profile_sha256: SCENARIO_FIXTURE_PROFILE_SHA256,
    browser_relay_evidence_session_profile_sha256: EVIDENCE_SESSION_PROFILE_SHA256,
    browser_relay_page_receipt_profile_sha256: PAGE_RECEIPT_PROFILE_SHA256,
    browser_relay_runner_profile_sha256: BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    dependency_contracts_sha256: CHROMIUM_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
    adapter_source_sha256: CHROMIUM_CASE_ADAPTER_SOURCE_SHA256,
    internal_source_sha256: CHROMIUM_CASE_ADAPTER_INTERNAL_SOURCE_SHA256,
    testing_source_sha256: CHROMIUM_CASE_ADAPTER_TESTING_SOURCE_SHA256,
    guard_source_sha256: CHROMIUM_CASE_ADAPTER_GUARD_SOURCE_SHA256,
    unit_test_sha256: CHROMIUM_CASE_ADAPTER_UNIT_TEST_SHA256,
    workflow_sha256: CHROMIUM_CASE_ADAPTER_WORKFLOW_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, value]) => (
      key.endsWith('_sha256') && !SHA256.test(value)
    ))) reject('profile.pins contains an invalid immutable identifier');
  exact(profile.composition.component_fields, CHROMIUM_CASE_ADAPTER_COMPONENT_FIELDS,
    'profile.composition.component_fields');
  exact(profile.composition.fixture_methods, CHROMIUM_CASE_ADAPTER_FIXTURE_METHODS,
    'profile.composition.fixture_methods');
  exact(profile.composition.remaining_adapter_methods,
    CHROMIUM_CASE_ADAPTER_REMAINING_METHODS,
    'profile.composition.remaining_adapter_methods');
  exact(profile.composition.stage_order, CHROMIUM_CASE_ADAPTER_STAGE_ORDER,
    'profile.composition.stage_order');
  exact(profile.composition.chromium_page_stage_by_sequence,
    CHROMIUM_PAGE_STAGE_BY_SEQUENCE,
    'profile.composition.chromium_page_stage_by_sequence');
  exact(profile.composition.chromium_control_stage_by_phase,
    CHROMIUM_CONTROL_STAGE_BY_PHASE,
    'profile.composition.chromium_control_stage_by_phase');
  exact(Object.keys(profile.composition.chromium_control_stage_by_phase),
    CONTROL_PHASE_ORDER,
    'profile.composition Chromium control order');
  exact(profile.composition.page_projection_fields,
    CHROMIUM_CASE_ADAPTER_PAGE_PROJECTION_FIELDS,
    'profile.composition.page_projection_fields');
  exact(profile.composition.browser_start_order, CHROMIUM_CASE_ADAPTER_START_ORDER,
    'profile.composition.browser_start_order');
  exact(profile.composition.page_close_order, CHROMIUM_CASE_ADAPTER_PAGE_CLOSE_ORDER,
    'profile.composition.page_close_order');
  exact(profile.composition.browser_close_order, CHROMIUM_CASE_ADAPTER_BROWSER_CLOSE_ORDER,
    'profile.composition.browser_close_order');
  for (const [field, expected] of Object.entries({
    scenario_starts_in_case: 'LIVE-04',
    fact_12_acknowledgement_waits_for_case: 'LIVE-09',
    chromium_page_close_proof: 'validated_native_scenario_result',
    remaining_chromium_page_source_blocked: true,
    remaining_scope_nonserializable: true,
    remaining_scope_revoked_after_stage: true,
    fixture_creation_and_removal_owned_by_operation: true,
    fixture_lifecycle_methods_granted: false,
    page_projection_acknowledgement: 'exact_true',
    page_projection_backpressure: true,
    cancellation_rechecked_before_external_action: true,
    caller_supplied_case_order: false,
    caller_supplied_page_fact_metadata: false,
    caller_supplied_timestamps: false,
    caller_supplied_results: false,
    global_close_once: true,
    global_close_aborts_and_drains_scenario: true,
    global_close_drains_remaining_tasks: true,
  })) exact(profile.composition[field], expected, `profile.composition.${field}`);
  exact(profile.controls, {
    authoritative_state: 'fixture_state_expectation',
    patched_state: 'fixture_set_temperature_21',
    initial_call: 'call_target_21',
    same_relay_reauthenticated: 'prepare_only',
    relay_handoff_stale: 'fixture_rotate_relay_to_b',
    relay_b_ready: 'prepare_only',
    relay_b_state: 'fixture_state_expectation',
    relay_b_call: 'call_target_22',
    failed_call: 'call_target_23',
    uncertain_call: 'call_target_24',
    relay_b_recovered: 'fixture_set_temperature_23',
  }, 'profile.controls');
  exact(profile.trust_boundary, {
    ready_fixture_trusted: true,
    page_provider_trusted: true,
    phase_preparer_trusted: true,
    remaining_adapter_trusted: true,
    same_realm_hostile_code_supported: false,
    isolated_process_present: false,
    validated_ipc_present: false,
    isolated_process_required_before_untrusted_live_wiring: true,
    validated_ipc_required_before_untrusted_live_wiring: true,
  }, 'profile.trust_boundary');
  exact(profile.compatibility, {
    case_scheduler_composed: true,
    evidence_session_composed_by_scheduler: true,
    scenario_fixture_interface_composed: true,
    complete_chromium_page_scenario_composed: true,
    native_chromium_bfcache_composed: true,
    chromium_page_closure_proven: true,
    independent_live_source_adapters_present: false,
    secondary_live_browser_drivers_present: false,
    durable_claim_binding_present: false,
    live_operation_wired: false,
    hosting_publication_wired: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    runner_result_schema: RUNNER_RESULT_SCHEMA,
    partial_results_exposed: false,
    raw_facts_exposed: false,
    raw_browser_diagnostics_exposed: false,
    private_inputs_exposed: false,
    fixture_identity_exposed: false,
    underlying_errors_exposed: false,
  }, 'profile.output');
  exact(profile.authority, {
    cloud_mutation_authorized: false,
    hosting_publication_authorized: false,
    iam_binding_mutation_authorized: false,
    public_ingress_authorized: false,
    live_execution_authorized: false,
  }, 'profile.authority');
  exact(profile.evidence, {
    state: 'offline_only',
    offline_complete_compositions: 1,
    offline_chromium_page_projections: 18,
    offline_closed_runner_results: 1,
    live_source_facts: 0,
    cloud_requests: 0,
    cloud_mutations: 0,
    hosting_publications: 0,
    live_execution_count: 0,
    credentials_committed: false,
    raw_facts_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayChromiumCaseAdapterProfile() {
  exact(
    chromiumCaseAdapterDependencyContractsSha256(),
    CHROMIUM_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
    'Chromium case-adapter dependency contracts digest',
  );
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayCaseSchedulerProfile();
  validateBrowserRelayChromiumScenarioProfile();
  validateBrowserRelayScenarioFixtureProfile();
  validateBrowserRelayEvidenceSessionProfile();
  validateBrowserRelayPageReceiptProfile();
  validateBrowserRelayRunnerProfile();
  for (const [path, maximum, digest, description] of [
    [profilePath, 32 * 1024, CHROMIUM_CASE_ADAPTER_PROFILE_SHA256,
      'Chromium case-adapter profile'],
    [adapterPath, 8 * 1024, CHROMIUM_CASE_ADAPTER_SOURCE_SHA256,
      'Chromium case-adapter source'],
    [internalPath, 64 * 1024, CHROMIUM_CASE_ADAPTER_INTERNAL_SOURCE_SHA256,
      'Chromium case-adapter internal source'],
    [testingPath, 8 * 1024, CHROMIUM_CASE_ADAPTER_TESTING_SOURCE_SHA256,
      'Chromium case-adapter testing source'],
    [guardPath, 16 * 1024, CHROMIUM_CASE_ADAPTER_GUARD_SOURCE_SHA256,
      'Chromium case-adapter guard source'],
    [unitTestPath, 64 * 1024, CHROMIUM_CASE_ADAPTER_UNIT_TEST_SHA256,
      'Chromium case-adapter unit test'],
    [workflowPath, 8 * 1024, CHROMIUM_CASE_ADAPTER_WORKFLOW_SHA256,
      'Chromium case-adapter workflow'],
  ]) regularPinnedFile(path, maximum, digest, description);
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('Chromium case-adapter profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== readFileSync(profilePath, 'utf8')) {
    reject('Chromium case-adapter profile is not canonical JSON');
  }
  return validateProfileValue(value);
}
