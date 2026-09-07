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
  CHROMIUM_CASE_ADAPTER_FIXTURE_METHODS,
  CHROMIUM_CASE_ADAPTER_PROFILE_SHA256,
  CHROMIUM_CASE_ADAPTER_REMAINING_METHODS,
  validateBrowserRelayChromiumCaseAdapterProfile,
} from '../browser-relay-chromium-case-adapter/contract.mjs';
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
  PLAYWRIGHT_BRIDGE_PROFILE_SHA256,
  validateBrowserRelayPlaywrightBridgeProfile,
} from '../browser-relay-playwright-bridge/contract.mjs';
import {
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  RUNNER_RESULT_SCHEMA,
  validateBrowserRelayRunnerProfile,
} from '../browser-relay-runner/contract.mjs';
import {
  SCENARIO_FIXTURE_PROFILE_SHA256,
  validateBrowserRelayScenarioFixtureProfile,
} from '../browser-relay-scenario-fixture/contract.mjs';

export const SECONDARY_CASE_ADAPTER_PROFILE_PATH =
  'browser-relay-secondary-case-adapter/profile.json';
export const SECONDARY_CASE_ADAPTER_PROFILE_SHA256 =
  'f4c21ccbf187771508f9ce634863c1f78edc107eec91925bbf7842c2e4da4119';
export const SECONDARY_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT =
  '2e1bceb254e29ffdf7fe46d49c8a67ff8426e23f';
export const SECONDARY_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256 =
  '3fa27b8ea5471db97d97092f47eb208a96e2b6e414e27921d5f15079ca898db0';
export const SECONDARY_CASE_ADAPTER_SOURCE_SHA256 =
  '85e5da426b278d79513e84a75d15cafe69a596122c531a50adebfec9aac23c69';
export const SECONDARY_CASE_ADAPTER_INTERNAL_SOURCE_SHA256 =
  '5102d9e921e1077d23b703658c120e5b38782c3e58aac35419baf7db43d2988a';
export const SECONDARY_CASE_ADAPTER_TESTING_SOURCE_SHA256 =
  'fc424aae4bc254ad6c76308b3abc3d450a18bcb7c021f27db16ec5ca5f97f4df';
export const SECONDARY_CASE_ADAPTER_GUARD_SOURCE_SHA256 =
  '4ec3e8ee9e0ca30985ad3d8f3e92834252221b5c87cdfd765812e368c492ebf1';
export const SECONDARY_CASE_ADAPTER_UNIT_TEST_SHA256 =
  'c36d177f29e3de6cfd55731e69e1517b5675d9ae61fd9bacc3428977a30bf2bc';
export const SECONDARY_CASE_ADAPTER_BROWSER_SMOKE_SHA256 =
  '9fc5be0372ce4df3bcc8248a9b4bb65e6f191946d004748b2abec40446d5be6a';
export const SECONDARY_CASE_ADAPTER_WORKFLOW_SHA256 =
  'b5e9ca6e4bcc840d69b7798be1b42c849dc22cc6192ab80b72b88d19fc7ba161';

export const SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS = Object.freeze([
  'fixture',
  'openChromiumPage',
  'openSecondaryPage',
  'prepareChromiumPhase',
  'remainingAdapter',
]);
export const SECONDARY_CASE_ADAPTER_FIXTURE_METHODS =
  CHROMIUM_CASE_ADAPTER_FIXTURE_METHODS;
export const SECONDARY_CASE_ADAPTER_REMAINING_METHODS =
  CHROMIUM_CASE_ADAPTER_REMAINING_METHODS;
export const SECONDARY_CASE_ADAPTER_STAGE_ORDER = Object.freeze(
  STAGE_ORDER.map((stage) => Object.freeze({ ...stage })),
);
export const SECONDARY_CASE_ADAPTER_START_ORDER = Object.freeze([
  'chromium',
  'firefox',
  'webkit',
]);
export const SECONDARY_CASE_ADAPTER_PAGE_CLOSE_ORDER = Object.freeze([
  'firefox',
  'webkit',
]);
export const SECONDARY_CASE_ADAPTER_BROWSER_CLOSE_ORDER = Object.freeze([
  'firefox',
  'webkit',
  'chromium',
]);
export const SECONDARY_CASE_ADAPTER_BROWSERS = Object.freeze([
  'firefox',
  'webkit',
]);
export const SECONDARY_CASE_ADAPTER_INPUT_ORDER = Object.freeze([
  Object.freeze({ browser: 'firefox', identity_generation: 1 }),
  Object.freeze({ browser: 'webkit', identity_generation: 1 }),
]);
export const SECONDARY_CASE_ADAPTER_PAGE_PROJECTION_FIELDS =
  PAGE_PORT_PAYLOAD_FIELDS;
export const SECONDARY_CASE_ADAPTER_PAGE_FACTS_PER_BROWSER = 3;

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const adapterPath = new URL('adapter.mjs', import.meta.url);
const internalPath = new URL('internal.mjs', import.meta.url);
const testingPath = new URL('testing.mjs', import.meta.url);
const guardPath = new URL('guard.mjs', import.meta.url);
const unitTestPath = new URL(
  '../test/browser-relay-secondary-case-adapter.test.mjs',
  import.meta.url,
);
const browserSmokePath = new URL(
  '../test/browser-relay-secondary-case-adapter-browser.mjs',
  import.meta.url,
);
const workflowPath = new URL(
  '../../../.github/workflows/browser-relay-secondary-case-adapter.yml',
  import.meta.url,
);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-case-scheduler/contract.mjs',
  '../browser-relay-chromium-case-adapter/contract.mjs',
  '../browser-relay-evidence-session/contract.mjs',
  '../browser-relay-page-receipt/contract.mjs',
  '../browser-relay-playwright-bridge/contract.mjs',
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
  'raw_error',
  'raw_request',
  'raw_response',
  'refresh_token',
  'request_headers',
  'response_headers',
  'token',
  'trace_context',
  'video',
  'websocket_frame',
]);

export class StagingBrowserRelaySecondaryCaseAdapterError extends Error {
  constructor(message = 'Staging secondary case-adapter composition failed closed') {
    super(message);
    this.name = 'StagingBrowserRelaySecondaryCaseAdapterError';
  }
}

function reject(message) {
  throw new StagingBrowserRelaySecondaryCaseAdapterError(message);
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

export function secondaryCaseAdapterDependencyContractsSha256() {
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
    'schema', 'revision', 'state', 'target', 'pins', 'composition',
    'trust_boundary', 'compatibility', 'output', 'authority', 'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(
    profile.schema,
    'miakapp.staging-browser-relay-secondary-case-adapter-profile/1',
    'profile.schema',
  );
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_secondary_page_case_scheduler_composition_offline_proven_not_live_wired_not_executed',
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
    implementation_base_commit: SECONDARY_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    browser_relay_case_scheduler_profile_sha256: CASE_SCHEDULER_PROFILE_SHA256,
    browser_relay_chromium_case_adapter_profile_sha256:
      CHROMIUM_CASE_ADAPTER_PROFILE_SHA256,
    browser_relay_evidence_session_profile_sha256: EVIDENCE_SESSION_PROFILE_SHA256,
    browser_relay_page_receipt_profile_sha256: PAGE_RECEIPT_PROFILE_SHA256,
    browser_relay_playwright_bridge_profile_sha256: PLAYWRIGHT_BRIDGE_PROFILE_SHA256,
    browser_relay_runner_profile_sha256: BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    browser_relay_scenario_fixture_profile_sha256: SCENARIO_FIXTURE_PROFILE_SHA256,
    dependency_contracts_sha256: SECONDARY_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
    adapter_source_sha256: SECONDARY_CASE_ADAPTER_SOURCE_SHA256,
    internal_source_sha256: SECONDARY_CASE_ADAPTER_INTERNAL_SOURCE_SHA256,
    testing_source_sha256: SECONDARY_CASE_ADAPTER_TESTING_SOURCE_SHA256,
    guard_source_sha256: SECONDARY_CASE_ADAPTER_GUARD_SOURCE_SHA256,
    unit_test_sha256: SECONDARY_CASE_ADAPTER_UNIT_TEST_SHA256,
    browser_smoke_sha256: SECONDARY_CASE_ADAPTER_BROWSER_SMOKE_SHA256,
    workflow_sha256: SECONDARY_CASE_ADAPTER_WORKFLOW_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, value]) => (
      key.endsWith('_sha256') && !SHA256.test(value)
    ))) reject('profile.pins contains an invalid immutable identifier');
  exact(profile.composition.component_fields, SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS,
    'profile.composition.component_fields');
  exact(profile.composition.fixture_methods, SECONDARY_CASE_ADAPTER_FIXTURE_METHODS,
    'profile.composition.fixture_methods');
  exact(profile.composition.remaining_adapter_methods,
    SECONDARY_CASE_ADAPTER_REMAINING_METHODS,
    'profile.composition.remaining_adapter_methods');
  exact(profile.composition.stage_order, SECONDARY_CASE_ADAPTER_STAGE_ORDER,
    'profile.composition.stage_order');
  exact(profile.composition.browser_start_order, SECONDARY_CASE_ADAPTER_START_ORDER,
    'profile.composition.browser_start_order');
  exact(profile.composition.page_close_order, SECONDARY_CASE_ADAPTER_PAGE_CLOSE_ORDER,
    'profile.composition.page_close_order');
  exact(profile.composition.browser_close_order,
    SECONDARY_CASE_ADAPTER_BROWSER_CLOSE_ORDER,
    'profile.composition.browser_close_order');
  exact(profile.composition.secondary_browser_order, SECONDARY_CASE_ADAPTER_BROWSERS,
    'profile.composition.secondary_browser_order');
  exact(profile.composition.secondary_private_input_order,
    SECONDARY_CASE_ADAPTER_INPUT_ORDER,
    'profile.composition.secondary_private_input_order');
  exact(profile.composition.page_projection_fields,
    SECONDARY_CASE_ADAPTER_PAGE_PROJECTION_FIELDS,
    'profile.composition.page_projection_fields');
  for (const [field, expected] of Object.entries({
    secondary_case_id: 'LIVE-10',
    secondary_page_facts_per_browser: SECONDARY_CASE_ADAPTER_PAGE_FACTS_PER_BROWSER,
    bridge_receipt_producer_adapted: true,
    complete_fact_validated_before_projection: true,
    session_owns_authoritative_fact_envelope: true,
    session_owns_authoritative_receipt: true,
    bridge_receipt_is_page_closure_proof_only: true,
    remaining_browser_page_source_blocked: true,
    remaining_scope_nonserializable: true,
    remaining_scope_revoked_after_stage: true,
    shared_fixture_instance_required: true,
    fixture_creation_and_removal_owned_by_operation: true,
    fixture_lifecycle_methods_granted: false,
    page_projection_acknowledgement: 'exact_true',
    page_projection_backpressure: true,
    cancellation_rechecked_before_external_action: true,
    caller_supplied_case_order: false,
    caller_supplied_page_fact_metadata: false,
    caller_supplied_timestamps: false,
    caller_supplied_receipts: false,
    caller_supplied_results: false,
    global_close_once: true,
    global_close_aborts_and_drains_bridges: true,
    global_close_drains_dependency_tasks: true,
    late_secondary_page_cleanup_before_remaining_close: true,
    global_close_drains_remaining_tasks: true,
  })) exact(profile.composition[field], expected, `profile.composition.${field}`);
  exact(profile.trust_boundary, {
    ready_fixture_trusted: true,
    chromium_page_provider_trusted: true,
    chromium_phase_preparer_trusted: true,
    secondary_page_provider_trusted: true,
    remaining_adapter_trusted: true,
    same_realm_hostile_code_supported: false,
    isolated_process_present: false,
    validated_ipc_present: false,
    isolated_process_required_before_untrusted_live_wiring: true,
    validated_ipc_required_before_untrusted_live_wiring: true,
  }, 'profile.trust_boundary');
  exact(profile.compatibility, {
    case_scheduler_composed: true,
    chromium_case_adapter_composed: true,
    evidence_session_composed_by_scheduler: true,
    scenario_fixture_interface_composed: true,
    complete_chromium_page_scenario_composed: true,
    complete_secondary_page_scenarios_composed: true,
    complete_three_browser_page_scenarios_composed: true,
    native_chromium_bfcache_composed: true,
    secondary_page_closure_proven: true,
    independent_live_source_adapters_present: false,
    secondary_live_browser_providers_present: false,
    dedicated_process_browser_driver_present: false,
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
    bridge_receipts_exposed: false,
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
    offline_secondary_browser_engines: 2,
    offline_secondary_page_projections: 6,
    offline_secondary_bridge_receipts: 2,
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

export function validateBrowserRelaySecondaryCaseAdapterProfile() {
  exact(
    secondaryCaseAdapterDependencyContractsSha256(),
    SECONDARY_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
    'Secondary case-adapter dependency contracts digest',
  );
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayCaseSchedulerProfile();
  validateBrowserRelayChromiumCaseAdapterProfile();
  validateBrowserRelayEvidenceSessionProfile();
  validateBrowserRelayPageReceiptProfile();
  validateBrowserRelayPlaywrightBridgeProfile();
  validateBrowserRelayRunnerProfile();
  validateBrowserRelayScenarioFixtureProfile();
  for (const [path, maximum, digest, description] of [
    [profilePath, 32 * 1024, SECONDARY_CASE_ADAPTER_PROFILE_SHA256,
      'Secondary case-adapter profile'],
    [adapterPath, 8 * 1024, SECONDARY_CASE_ADAPTER_SOURCE_SHA256,
      'Secondary case-adapter source'],
    [internalPath, 64 * 1024, SECONDARY_CASE_ADAPTER_INTERNAL_SOURCE_SHA256,
      'Secondary case-adapter internal source'],
    [testingPath, 8 * 1024, SECONDARY_CASE_ADAPTER_TESTING_SOURCE_SHA256,
      'Secondary case-adapter testing source'],
    [guardPath, 16 * 1024, SECONDARY_CASE_ADAPTER_GUARD_SOURCE_SHA256,
      'Secondary case-adapter guard source'],
    [unitTestPath, 96 * 1024, SECONDARY_CASE_ADAPTER_UNIT_TEST_SHA256,
      'Secondary case-adapter unit test'],
    [browserSmokePath, 64 * 1024, SECONDARY_CASE_ADAPTER_BROWSER_SMOKE_SHA256,
      'Secondary case-adapter browser smoke'],
    [workflowPath, 16 * 1024, SECONDARY_CASE_ADAPTER_WORKFLOW_SHA256,
      'Secondary case-adapter workflow'],
  ]) regularPinnedFile(path, maximum, digest, description);
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('Secondary case-adapter profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== readFileSync(profilePath, 'utf8')) {
    reject('Secondary case-adapter profile is not canonical JSON');
  }
  return validateProfileValue(value);
}
