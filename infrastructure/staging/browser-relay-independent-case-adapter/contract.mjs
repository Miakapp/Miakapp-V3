import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';
import {
  CASE_SCHEDULER_PROFILE_SHA256,
  FACT_KINDS_BY_STAGE,
  STAGE_ORDER,
  validateBrowserRelayCaseSchedulerProfile,
} from '../browser-relay-case-scheduler/contract.mjs';
import {
  EVIDENCE_SESSION_PROFILE_SHA256,
  validateBrowserRelayEvidenceSessionProfile,
} from '../browser-relay-evidence-session/contract.mjs';
import {
  FACT_ORDER_BY_BROWSER,
  INDEPENDENT_FACTS_PER_MATRIX,
  INDEPENDENT_OBSERVERS_PROFILE_SHA256,
  INDEPENDENT_SOURCES_BY_BROWSER,
  validateBrowserRelayIndependentObserversProfile,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  RUNNER_RESULT_SCHEMA,
} from '../browser-relay-runner/contract.mjs';
import {
  SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS,
  SECONDARY_CASE_ADAPTER_PROFILE_SHA256,
  validateBrowserRelaySecondaryCaseAdapterProfile,
} from '../browser-relay-secondary-case-adapter/contract.mjs';

export const INDEPENDENT_CASE_ADAPTER_PROFILE_PATH =
  'browser-relay-independent-case-adapter/profile.json';
export const INDEPENDENT_CASE_ADAPTER_PROFILE_SHA256 =
  'e228eee9e27b2cf411beee979bdbd69b44e62248cb65997636c87134912508d6';
export const INDEPENDENT_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT =
  '706fc93064a5ad3767be25fc6e73dd49eca4721e';
export const INDEPENDENT_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256 =
  'ed257704c02d3a69b376f50562b105108ded3bd79d78710237345228b20020d8';
export const INDEPENDENT_CASE_ADAPTER_SOURCE_SHA256 =
  'fca139a594b1ae0ac1e2dddee6b0de9fe83e15ba0c1a4cc2a796552e9d23fb51';
export const INDEPENDENT_CASE_ADAPTER_INTERNAL_SOURCE_SHA256 =
  '2b1aef4d80bbdbefb9e060e6666b55c3fcbcbdd7f2b71b4c22c60e89f66ba03d';
export const INDEPENDENT_CASE_ADAPTER_TESTING_SOURCE_SHA256 =
  'c6ba37267e7c53372bdd4e0dc5678e8eb485f8840f5d0fdb9a65f188d1e239a9';
export const INDEPENDENT_CASE_ADAPTER_GUARD_SOURCE_SHA256 =
  '213d7e244e5f28e997382615703cc860db864b53530f8a0544a27371956a0b82';
export const INDEPENDENT_CASE_ADAPTER_UNIT_TEST_SHA256 =
  '25c685804b90930df5612e22b59dbc1ef9cea058bb0b8e5bb071a8a1cae755b4';
export const INDEPENDENT_CASE_ADAPTER_BROWSER_SMOKE_SHA256 =
  '5e1795df27c581c450c45848a095016ccb816d725501b6ccecb1f50a6ed94223';
export const INDEPENDENT_CASE_ADAPTER_TEST_HARNESS_SHA256 =
  '38e6dbd1c0a68a1112467247a5367f0741e28f6c15dc263b6910298daa8ec381';
export const INDEPENDENT_CASE_ADAPTER_WORKFLOW_SHA256 =
  'fa4f666ca733cf1affffbd923a3768e878c9bb7b595f82b5acdc3636593da726';

export const INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS = Object.freeze([
  ...SECONDARY_CASE_ADAPTER_COMPONENT_FIELDS.filter((field) => field !== 'remainingAdapter'),
  'sourceObservers',
  'browserLifecycle',
]);
export const INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER = Object.freeze([
  ...INDEPENDENT_SOURCES_BY_BROWSER.chromium,
]);
export const INDEPENDENT_CASE_ADAPTER_OBSERVER_METHODS = Object.freeze([
  'execute',
  'close',
]);
export const INDEPENDENT_CASE_ADAPTER_BROWSER_LIFECYCLE_METHODS = Object.freeze([
  'startBrowser',
  'closeBrowser',
  'close',
]);
export const INDEPENDENT_CASE_ADAPTER_OBSERVER_SCOPE_FIELDS = Object.freeze([
  'browser',
  'case_id',
  'signal',
  'record',
]);
export const INDEPENDENT_CASE_ADAPTER_STAGE_ORDER = Object.freeze(
  STAGE_ORDER.map((stage) => Object.freeze({ ...stage })),
);
export const INDEPENDENT_CASE_ADAPTER_START_ORDER = Object.freeze([
  'chromium',
  'firefox',
  'webkit',
]);
export const INDEPENDENT_CASE_ADAPTER_BROWSER_CLOSE_ORDER = Object.freeze([
  'firefox',
  'webkit',
  'chromium',
]);
export const INDEPENDENT_CASE_ADAPTER_OBSERVATIONS_PER_MATRIX =
  INDEPENDENT_FACTS_PER_MATRIX;
export const INDEPENDENT_CASE_ADAPTER_RUNNER_RESULT_SCHEMA = RUNNER_RESULT_SCHEMA;

export const INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE = Object.freeze(
  Object.fromEntries(STAGE_ORDER.map(({ case_id: caseId, browser }) => {
    const key = `${caseId}/${browser}`;
    return [key, Object.freeze(Object.fromEntries(
      Object.entries(FACT_KINDS_BY_STAGE[key])
        .filter(([source]) => source !== 'browser_page')
        .map(([source, kinds]) => [source, Object.freeze([...kinds])]),
    ))];
  })),
);

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const adapterPath = new URL('adapter.mjs', import.meta.url);
const internalPath = new URL('internal.mjs', import.meta.url);
const testingPath = new URL('testing.mjs', import.meta.url);
const guardPath = new URL('guard.mjs', import.meta.url);
const unitTestPath = new URL(
  '../test/browser-relay-independent-case-adapter.test.mjs',
  import.meta.url,
);
const browserSmokePath = new URL(
  '../test/browser-relay-independent-case-adapter-browser.mjs',
  import.meta.url,
);
const testHarnessPath = new URL(
  '../test/helpers/browser-relay-independent-source-harness.mjs',
  import.meta.url,
);
const workflowPath = new URL(
  '../../../.github/workflows/browser-relay-independent-case-adapter.yml',
  import.meta.url,
);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-case-scheduler/contract.mjs',
  '../browser-relay-evidence-session/contract.mjs',
  '../browser-relay-independent-observers/contract.mjs',
  '../browser-relay-runner/contract.mjs',
  '../browser-relay-secondary-case-adapter/contract.mjs',
  '../browser-relay/contract.mjs',
].sort());
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const MAXIMUM_PROFILE_BYTES = 32 * 1024;

export class StagingBrowserRelayIndependentCaseAdapterError extends Error {
  constructor(message = 'Staging browser-relay independent case adapter failed closed') {
    super(message);
    this.name = 'StagingBrowserRelayIndependentCaseAdapterError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayIndependentCaseAdapterError(message);
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

export function independentCaseAdapterDependencyContractsSha256() {
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

function validateSourcePartition() {
  let observations = 0;
  for (const [browser, sources] of Object.entries(FACT_ORDER_BY_BROWSER)) {
    for (const [source, expectedKinds] of Object.entries(sources)) {
      const actualKinds = INDEPENDENT_CASE_ADAPTER_STAGE_ORDER.flatMap(({ case_id: caseId,
        browser: stageBrowser }) => (
        stageBrowser === browser
          ? INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[`${caseId}/${browser}`][source] ?? []
          : []
      ));
      exact(actualKinds, expectedKinds, `source_partition.${browser}.${source}`);
      observations += actualKinds.length;
    }
  }
  exact(observations, INDEPENDENT_CASE_ADAPTER_OBSERVATIONS_PER_MATRIX,
    'source_partition.observations_per_matrix');
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
  exact(profile.schema, 'miakapp.staging-browser-relay-independent-case-adapter-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
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
  exact(profile.pins.implementation_base_commit,
    INDEPENDENT_CASE_ADAPTER_IMPLEMENTATION_BASE_COMMIT,
    'profile.pins.implementation_base_commit');
  exact(profile.pins.browser_relay_plan_sha256, BROWSER_RELAY_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256');
  exact(profile.pins.browser_relay_case_scheduler_profile_sha256,
    CASE_SCHEDULER_PROFILE_SHA256,
    'profile.pins.browser_relay_case_scheduler_profile_sha256');
  exact(profile.pins.browser_relay_evidence_session_profile_sha256,
    EVIDENCE_SESSION_PROFILE_SHA256,
    'profile.pins.browser_relay_evidence_session_profile_sha256');
  exact(profile.pins.browser_relay_independent_observers_profile_sha256,
    INDEPENDENT_OBSERVERS_PROFILE_SHA256,
    'profile.pins.browser_relay_independent_observers_profile_sha256');
  exact(profile.pins.browser_relay_secondary_case_adapter_profile_sha256,
    SECONDARY_CASE_ADAPTER_PROFILE_SHA256,
    'profile.pins.browser_relay_secondary_case_adapter_profile_sha256');
  exact(profile.pins.dependency_contracts_sha256,
    INDEPENDENT_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256,
    'profile.pins.dependency_contracts_sha256');
  exact(profile.pins.adapter_source_sha256, INDEPENDENT_CASE_ADAPTER_SOURCE_SHA256,
    'profile.pins.adapter_source_sha256');
  exact(profile.pins.internal_source_sha256, INDEPENDENT_CASE_ADAPTER_INTERNAL_SOURCE_SHA256,
    'profile.pins.internal_source_sha256');
  exact(profile.pins.testing_source_sha256, INDEPENDENT_CASE_ADAPTER_TESTING_SOURCE_SHA256,
    'profile.pins.testing_source_sha256');
  exact(profile.pins.guard_source_sha256, INDEPENDENT_CASE_ADAPTER_GUARD_SOURCE_SHA256,
    'profile.pins.guard_source_sha256');
  exact(profile.pins.unit_test_sha256, INDEPENDENT_CASE_ADAPTER_UNIT_TEST_SHA256,
    'profile.pins.unit_test_sha256');
  exact(profile.pins.browser_smoke_sha256, INDEPENDENT_CASE_ADAPTER_BROWSER_SMOKE_SHA256,
    'profile.pins.browser_smoke_sha256');
  exact(profile.pins.test_harness_sha256, INDEPENDENT_CASE_ADAPTER_TEST_HARNESS_SHA256,
    'profile.pins.test_harness_sha256');
  exact(profile.pins.workflow_sha256, INDEPENDENT_CASE_ADAPTER_WORKFLOW_SHA256,
    'profile.pins.workflow_sha256');
  exact(profile.composition.component_fields, INDEPENDENT_CASE_ADAPTER_COMPONENT_FIELDS,
    'profile.composition.component_fields');
  exact(profile.composition.source_order, INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER,
    'profile.composition.source_order');
  exact(profile.composition.observer_methods, INDEPENDENT_CASE_ADAPTER_OBSERVER_METHODS,
    'profile.composition.observer_methods');
  exact(profile.composition.browser_lifecycle_methods,
    INDEPENDENT_CASE_ADAPTER_BROWSER_LIFECYCLE_METHODS,
    'profile.composition.browser_lifecycle_methods');
  exact(profile.composition.observer_scope_fields,
    INDEPENDENT_CASE_ADAPTER_OBSERVER_SCOPE_FIELDS,
    'profile.composition.observer_scope_fields');
  exact(profile.composition.stage_order, INDEPENDENT_CASE_ADAPTER_STAGE_ORDER,
    'profile.composition.stage_order');
  exact(profile.composition.sources_by_stage, INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE,
    'profile.composition.sources_by_stage');
  exact(profile.composition.browser_start_order, INDEPENDENT_CASE_ADAPTER_START_ORDER,
    'profile.composition.browser_start_order');
  exact(profile.composition.browser_close_order,
    INDEPENDENT_CASE_ADAPTER_BROWSER_CLOSE_ORDER,
    'profile.composition.browser_close_order');
  exact(profile.composition.observations_per_matrix,
    INDEPENDENT_CASE_ADAPTER_OBSERVATIONS_PER_MATRIX,
    'profile.composition.observations_per_matrix');
  exact(profile.output.runner_result_schema, INDEPENDENT_CASE_ADAPTER_RUNNER_RESULT_SCHEMA,
    'profile.output.runner_result_schema');
  if (!Object.values(profile.authority).every((entry) => entry === false)) {
    reject('profile.authority must remain closed');
  }
  exact(profile.compatibility.independent_source_composition_present, true,
    'profile.compatibility.independent_source_composition_present');
  exact(profile.compatibility.genuine_live_source_adapters_present, false,
    'profile.compatibility.genuine_live_source_adapters_present');
  exact(profile.compatibility.durable_claim_binding_present, false,
    'profile.compatibility.durable_claim_binding_present');
  if (profile.evidence.live_source_observations !== 0
    || profile.evidence.cloud_requests !== 0
    || profile.evidence.cloud_mutations !== 0
    || profile.evidence.live_execution_count !== 0) {
    reject('profile.evidence must remain offline');
  }
  validateSourcePartition();
  return Object.freeze(profile);
}

export function validateBrowserRelayIndependentCaseAdapterProfile() {
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayCaseSchedulerProfile();
  validateBrowserRelayEvidenceSessionProfile();
  validateBrowserRelayIndependentObserversProfile();
  validateBrowserRelaySecondaryCaseAdapterProfile();
  const entry = lstatSync(profilePath);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > MAXIMUM_PROFILE_BYTES
    || sha256(readFileSync(profilePath)) !== INDEPENDENT_CASE_ADAPTER_PROFILE_SHA256) {
    reject('Independent case-adapter profile has drifted from its reviewed bytes');
  }
  if (independentCaseAdapterDependencyContractsSha256()
    !== INDEPENDENT_CASE_ADAPTER_DEPENDENCY_CONTRACTS_SHA256) {
    reject('Independent case-adapter dependency contracts have drifted');
  }
  for (const [path, maximumBytes, digest, description] of [
    [adapterPath, 8 * 1024, INDEPENDENT_CASE_ADAPTER_SOURCE_SHA256, 'Production adapter'],
    [internalPath, 40 * 1024, INDEPENDENT_CASE_ADAPTER_INTERNAL_SOURCE_SHA256,
      'Internal adapter'],
    [testingPath, 8 * 1024, INDEPENDENT_CASE_ADAPTER_TESTING_SOURCE_SHA256,
      'Testing adapter'],
    [guardPath, 16 * 1024, INDEPENDENT_CASE_ADAPTER_GUARD_SOURCE_SHA256, 'Package guard'],
    [unitTestPath, 64 * 1024, INDEPENDENT_CASE_ADAPTER_UNIT_TEST_SHA256, 'Unit test'],
    [browserSmokePath, 48 * 1024, INDEPENDENT_CASE_ADAPTER_BROWSER_SMOKE_SHA256,
      'Browser smoke'],
    [testHarnessPath, 24 * 1024, INDEPENDENT_CASE_ADAPTER_TEST_HARNESS_SHA256,
      'Test harness'],
    [workflowPath, 8 * 1024, INDEPENDENT_CASE_ADAPTER_WORKFLOW_SHA256, 'CI workflow'],
  ]) regularPinnedFile(path, maximumBytes, digest, description);
  return validateProfileValue(JSON.parse(readFileSync(profilePath, 'utf8')));
}
