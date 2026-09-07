import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS,
  INDEPENDENT_CASE_ADAPTER_PROFILE_SHA256,
  INDEPENDENT_CASE_ADAPTER_RUNNER_RESULT_SCHEMA,
  validateBrowserRelayIndependentCaseAdapterProfile,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS as OPERATION_MAXIMUM_CALLBACK_MILLISECONDS,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS as OPERATION_MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  OPERATION_PROFILE_SHA256,
  OPERATION_RESULT_SCHEMA,
  validateBrowserRelayOperationProfile,
} from '../browser-relay-operation/contract.mjs';
import {
  validateBrowserRelayOrchestratorProfile,
} from '../browser-relay-orchestrator/contract.mjs';
import {
  RUNNER_RESULT_SCHEMA,
} from '../browser-relay-runner/contract.mjs';
import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';

export const OPERATION_CASE_ADAPTER_PROFILE_PATH =
  'browser-relay-operation-case-adapter/profile.json';
export const OPERATION_CASE_ADAPTER_PROFILE_SHA256 =
  'bd9daca428611bf2b4d0623fbd218e69d69cbe3805008a83733fe47f93330085';
export const OPERATION_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT =
  'eeffc5cf28b7c9de9d0609706c68b93e166d2141';
export const OPERATION_CASE_ADAPTER_ORCHESTRATOR_CLAIM_SOURCE_SHA256 =
  'b67a42998df291ece0ea6575442c803cbee04535e657ea814c6a1d9eeb221013';
export const OPERATION_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256 =
  'be3399ca2b2bebee8739b480cf40ffcf26cb9946a1a6dd65bae8fcec813b38c9';
export const OPERATION_CASE_ADAPTER_SOURCE_SHA256 =
  '19d159a996cab1ddda60f6be3cd1349814bb768e5ce925ad47763adff9aa6aec';
export const OPERATION_CASE_ADAPTER_INTERNAL_SOURCE_SHA256 =
  '46ac5aa4aa21ec0ee505c1a549afe258530c46a346f7a41399cf17fa98de33a6';
export const OPERATION_CASE_ADAPTER_TESTING_SOURCE_SHA256 =
  'd764135b16bbb8abf2418d50cce3f326313cfab872c1a8b6cf3243ce4534f58c';
export const OPERATION_CASE_ADAPTER_GUARD_SOURCE_SHA256 =
  '70b29bde1c5732ce51171ee49b00d51f4c8a2f7f967c61a203aa1ae4dde75ee2';
export const OPERATION_CASE_ADAPTER_UNIT_TEST_SHA256 =
  'f9288fa577e83e6c7df87b7322746e385e5080c3fe2eca6ac8aba4341a760420';
export const OPERATION_CASE_ADAPTER_WORKFLOW_SHA256 =
  'a09e27e3a988d103ceba9138f818d817ee39c1919708721b3b344abb8fdeed27';

export const OPERATION_CASE_ADAPTER_ROOT_COMPONENT_FIELDS = Object.freeze([
  'operation',
  'matrix',
]);
export const OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS = Object.freeze([
  'acquireClaim',
  'closeRelaysPrivateReady',
  'createSyntheticFixture',
  'edgeClient',
  'observeClaimAbsent',
  'observeWindowBaseline',
  'openRelaysPublic',
  'publishRunner',
  'removeRunner',
  'removeSyntheticFixture',
  'removeTemporaryBindings',
  'sampleMonitoring',
  'stopSessions',
  'validateAuthorization',
  'verifyFinalCleanup',
  'verifyRunner',
  'verifyWindowCleanup',
]);
export const OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS = Object.freeze([
  ...INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS,
]);
export const OPERATION_CASE_ADAPTER_CLAIM_RECEIPT_FIELDS = Object.freeze([
  'schema',
  'bucket',
  'object',
  'generation',
  'size_bytes',
  'sha256',
  'repository_commit',
  'profile_sha256',
  'browser_relay_plan_sha256',
  'attempted_at',
  'expires_at',
  'retry_authorized',
  'deletion_authorized',
  'raw_contents_committed',
]);
export const OPERATION_CASE_ADAPTER_WINDOW_CONTEXT_FIELDS = Object.freeze([
  'signal',
  'opened_at_milliseconds',
  'deadline_milliseconds',
  'callback_deadline_milliseconds',
]);
export const MAXIMUM_PUBLIC_WINDOW_MILLISECONDS =
  OPERATION_MAXIMUM_PUBLIC_WINDOW_MILLISECONDS;
export const MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS =
  OPERATION_MAXIMUM_CALLBACK_MILLISECONDS;
export const OPERATION_CASE_ADAPTER_OPERATION_RESULT_SCHEMA = OPERATION_RESULT_SCHEMA;
export const OPERATION_CASE_ADAPTER_RUNNER_RESULT_SCHEMA = RUNNER_RESULT_SCHEMA;

const profilePath = new URL('profile.json', import.meta.url);
const adapterPath = new URL('adapter.mjs', import.meta.url);
const internalPath = new URL('internal.mjs', import.meta.url);
const testingPath = new URL('testing.mjs', import.meta.url);
const guardPath = new URL('guard.mjs', import.meta.url);
const claimSourcePath = new URL('../browser-relay-orchestrator/claim.mjs', import.meta.url);
const unitTestPath = new URL(
  '../test/browser-relay-operation-case-adapter.test.mjs',
  import.meta.url,
);
const workflowPath = new URL(
  '../../../.github/workflows/browser-relay-operation-case-adapter.yml',
  import.meta.url,
);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-independent-case-adapter/contract.mjs',
  '../browser-relay-operation/contract.mjs',
  '../browser-relay-orchestrator/contract.mjs',
  '../browser-relay-runner/contract.mjs',
  '../browser-relay/contract.mjs',
].sort());
const expectedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const MAXIMUM_PROFILE_BYTES = 32 * 1024;

export class StagingBrowserRelayOperationCaseAdapterError extends Error {
  constructor(message = 'Staging browser-relay claim-bound operation failed closed') {
    super(message);
    this.name = 'StagingBrowserRelayOperationCaseAdapterError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayOperationCaseAdapterError(message);
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

export function operationCaseAdapterDependencyContractsSha256() {
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
    reject(`${description} has drifted from its reviewed source`);
  }
}

function validateProfileValue(value) {
  const profile = exactKeys(value, [
    'authority',
    'compatibility',
    'composition',
    'evidence',
    'output',
    'pins',
    'revision',
    'schema',
    'state',
    'target',
    'trust_boundary',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(
    profile.schema,
    'miakapp.staging-browser-relay-operation-case-adapter-profile/1',
    'profile.schema',
  );
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_claim_bound_operation_case_composition_offline_proven_not_live_executed',
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
  if (!COMMIT.test(profile.pins.implementation_base_commit)) {
    reject('profile.pins.implementation_base_commit is invalid');
  }
  for (const [field, digest] of Object.entries(profile.pins)) {
    if (field !== 'implementation_base_commit' && !SHA256.test(digest)) {
      reject(`profile.pins.${field} is invalid`);
    }
  }
  exact(
    profile.pins.implementation_base_commit,
    OPERATION_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT,
    'profile.pins.implementation_base_commit',
  );
  exact(profile.pins.browser_relay_plan_sha256, BROWSER_RELAY_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256');
  exact(
    profile.pins.browser_relay_independent_case_adapter_profile_sha256,
    INDEPENDENT_CASE_ADAPTER_PROFILE_SHA256,
    'profile.pins.browser_relay_independent_case_adapter_profile_sha256',
  );
  exact(profile.pins.browser_relay_operation_profile_sha256, OPERATION_PROFILE_SHA256,
    'profile.pins.browser_relay_operation_profile_sha256');
  exact(
    profile.pins.browser_relay_orchestrator_claim_source_sha256,
    OPERATION_CASE_ADAPTER_ORCHESTRATOR_CLAIM_SOURCE_SHA256,
    'profile.pins.browser_relay_orchestrator_claim_source_sha256',
  );
  exact(
    profile.pins.dependency_contracts_sha256,
    OPERATION_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
    'profile.pins.dependency_contracts_sha256',
  );
  for (const [field, digest] of [
    ['adapter_source_sha256', OPERATION_CASE_ADAPTER_SOURCE_SHA256],
    ['internal_source_sha256', OPERATION_CASE_ADAPTER_INTERNAL_SOURCE_SHA256],
    ['testing_source_sha256', OPERATION_CASE_ADAPTER_TESTING_SOURCE_SHA256],
    ['guard_source_sha256', OPERATION_CASE_ADAPTER_GUARD_SOURCE_SHA256],
    ['unit_test_sha256', OPERATION_CASE_ADAPTER_UNIT_TEST_SHA256],
    ['workflow_sha256', OPERATION_CASE_ADAPTER_WORKFLOW_SHA256],
  ]) exact(profile.pins[field], digest, `profile.pins.${field}`);

  exact(profile.composition.root_component_fields,
    OPERATION_CASE_ADAPTER_ROOT_COMPONENT_FIELDS,
    'profile.composition.root_component_fields');
  exact(profile.composition.operation_component_fields,
    OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS,
    'profile.composition.operation_component_fields');
  exact(profile.composition.injected_operation_component, 'executeBrowserMatrix',
    'profile.composition.injected_operation_component');
  exact(profile.composition.matrix_component_fields,
    OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS,
    'profile.composition.matrix_component_fields');
  exact(profile.composition.claim_receipt_fields,
    OPERATION_CASE_ADAPTER_CLAIM_RECEIPT_FIELDS,
    'profile.composition.claim_receipt_fields');
  exact(profile.composition.window_context_fields,
    OPERATION_CASE_ADAPTER_WINDOW_CONTEXT_FIELDS,
    'profile.composition.window_context_fields');
  exact(profile.composition.maximum_claim_acquisition_attempts, 1,
    'profile.composition.maximum_claim_acquisition_attempts');
  exact(profile.composition.maximum_claim_acquisitions, 1,
    'profile.composition.maximum_claim_acquisitions');
  exact(profile.composition.maximum_window_entries, 1,
    'profile.composition.maximum_window_entries');
  exact(profile.composition.maximum_matrix_invocations, 1,
    'profile.composition.maximum_matrix_invocations');
  for (const field of [
    'claim_receipt_single_snapshot_validated',
    'claim_capability_nonserializable',
    'claim_capability_private_to_composition',
    'protocol_violation_permanently_poisoned',
    'window_context_validated_before_application_mutation',
    'exact_window_context_identity_preserved',
    'matrix_session_created_after_validated_claim',
    'window_opens_no_earlier_than_claim_attempt',
    'window_deadlines_within_claim_expiry',
    'exact_edge_abort_signal_forwarded',
    'claim_lineage_revoked_and_cleared_on_terminal_path',
    'claim_is_not_execution_authorization',
    'separate_operation_authorization_preserved',
    'production_intrinsic_timing_only',
    'cooperative_cancellation_only',
  ]) exact(profile.composition[field], true, `profile.composition.${field}`);

  exact(profile.trust_boundary, {
    operation_components_trusted: true,
    matrix_components_trusted: true,
    claim_lineage_exposed_to_components: false,
    same_realm_hostile_code_supported: false,
    isolated_process_present: false,
    validated_ipc_present: false,
    hard_termination_present: false,
    isolated_process_required_before_untrusted_live_wiring: true,
    validated_ipc_required_before_untrusted_live_wiring: true,
  }, 'profile.trust_boundary');
  exact(profile.compatibility, {
    single_use_operation_composed: true,
    complete_three_browser_matrix_composed: true,
    durable_claim_matrix_binding_present: true,
    operation_result_unchanged: true,
    genuine_live_source_adapters_present: false,
    trusted_live_browser_providers_present: false,
    dedicated_process_browser_driver_present: false,
    live_operation_wired: false,
    hosting_publication_wired: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    operation_result_schema: OPERATION_CASE_ADAPTER_OPERATION_RESULT_SCHEMA,
    runner_result_schema: OPERATION_CASE_ADAPTER_RUNNER_RESULT_SCHEMA,
    claim_lineage_exposed: false,
    partial_results_exposed: false,
    raw_facts_exposed: false,
    private_inputs_exposed: false,
    underlying_errors_exposed: false,
  }, 'profile.output');
  if (!Object.values(profile.authority).every((entry) => entry === false)) {
    reject('profile.authority must remain closed');
  }
  exact(profile.evidence, {
    state: 'offline_only',
    offline_claim_bound_compositions: 1,
    offline_production_failure_compositions: 1,
    offline_closed_operation_results: 1,
    cloud_requests: 0,
    cloud_mutations: 0,
    hosting_publications: 0,
    live_execution_count: 0,
    credentials_committed: false,
    claim_lineage_committed: false,
    raw_facts_committed: false,
  }, 'profile.evidence');
  exact(INDEPENDENT_CASE_ADAPTER_RUNNER_RESULT_SCHEMA, RUNNER_RESULT_SCHEMA,
    'complete matrix runner schema');
  return Object.freeze(profile);
}

export function validateBrowserRelayOperationCaseAdapterProfile() {
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayIndependentCaseAdapterProfile();
  validateBrowserRelayOperationProfile();
  validateBrowserRelayOrchestratorProfile();
  regularPinnedFile(
    profilePath,
    MAXIMUM_PROFILE_BYTES,
    OPERATION_CASE_ADAPTER_PROFILE_SHA256,
    'Operation case-adapter profile',
  );
  if (operationCaseAdapterDependencyContractsSha256()
    !== OPERATION_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256) {
    reject('Operation case-adapter dependency contracts have drifted');
  }
  for (const [path, maximumBytes, digest, description] of [
    [claimSourcePath, 32 * 1024, OPERATION_CASE_ADAPTER_ORCHESTRATOR_CLAIM_SOURCE_SHA256,
      'Orchestrator claim source'],
    [adapterPath, 8 * 1024, OPERATION_CASE_ADAPTER_SOURCE_SHA256, 'Production adapter'],
    [internalPath, 32 * 1024, OPERATION_CASE_ADAPTER_INTERNAL_SOURCE_SHA256,
      'Internal adapter'],
    [testingPath, 8 * 1024, OPERATION_CASE_ADAPTER_TESTING_SOURCE_SHA256,
      'Testing adapter'],
    [guardPath, 20 * 1024, OPERATION_CASE_ADAPTER_GUARD_SOURCE_SHA256, 'Package guard'],
    [unitTestPath, 96 * 1024, OPERATION_CASE_ADAPTER_UNIT_TEST_SHA256, 'Unit test'],
    [workflowPath, 8 * 1024, OPERATION_CASE_ADAPTER_WORKFLOW_SHA256, 'CI workflow'],
  ]) regularPinnedFile(path, maximumBytes, digest, description);
  return validateProfileValue(JSON.parse(readFileSync(profilePath, 'utf8')));
}
