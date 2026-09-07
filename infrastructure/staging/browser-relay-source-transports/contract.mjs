import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';
import {
  INDEPENDENT_CASE_ADAPTER_OBSERVER_METHODS,
  INDEPENDENT_CASE_ADAPTER_OBSERVER_SCOPE_FIELDS,
  INDEPENDENT_CASE_ADAPTER_PROFILE_SHA256,
  INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER,
  INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE,
  INDEPENDENT_CASE_ADAPTER_STAGE_ORDER,
  validateBrowserRelayIndependentCaseAdapterProfile,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  INDEPENDENT_FACTS_PER_MATRIX,
  INDEPENDENT_OBSERVERS_PROFILE_SHA256,
  rejectIndependentObserverPrivateMaterial,
  validateBrowserRelayIndependentObserversProfile,
} from '../browser-relay-independent-observers/contract.mjs';

export const SOURCE_TRANSPORTS_PROFILE_PATH =
  'browser-relay-source-transports/profile.json';
export const SOURCE_TRANSPORTS_PROFILE_SHA256 =
  '9628f2dbe63713da3f4777908e036155c8c7852f3ac110d3efc162266a933ad4';
export const SOURCE_TRANSPORTS_IMPLEMENTATION_BASE_COMMIT =
  '859bdf72b31639ced839c842f00b6e89e5b8bf72';
export const SOURCE_TRANSPORTS_DEPENDENCY_CONTRACTS_SHA256 =
  'fa2c14c5a88d3015d278fe2aa6e1be2ffb105980588a1f65d6c217bb88c82e30';
export const SOURCE_TRANSPORTS_INTERNAL_SOURCE_SHA256 =
  '486078eadef5e02847f4489e2df593b07744f717d31a741465cfa8053713d9e6';
export const SOURCE_TRANSPORTS_PRODUCTION_SOURCE_SHA256 =
  '602e34e9eae57212c7899a41e06a7673e7f3a04f7c9504c6388ad54913ede396';
export const SOURCE_TRANSPORTS_TESTING_SOURCE_SHA256 =
  'bd7a74c4b3bdf0e37cabeaa16ad4ee27c1617e34a435429d7f61b572187462e5';
export const SOURCE_TRANSPORTS_GUARD_SOURCE_SHA256 =
  '46f4bcb41edecd13b67c5df4ec781665ec3ccdfec4728b2877138a3378adc21d';
export const SOURCE_TRANSPORTS_UNIT_TEST_SHA256 =
  '3229825d54edb3f5fbb2bfa3ccfa9ef55a6b3344cc272e548c568a2db19ab2f6';
export const SOURCE_TRANSPORTS_WORKFLOW_SHA256 =
  'b26911a4afc4cf895f7d1165d55517c7f64aa4d427abe4b3262e31fff6c1686c';

export const SOURCE_TRANSPORTS_SOURCE_ORDER = Object.freeze([
  ...INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER,
]);
export const SOURCE_TRANSPORTS_OBSERVER_METHODS = Object.freeze([
  ...INDEPENDENT_CASE_ADAPTER_OBSERVER_METHODS,
]);
export const SOURCE_TRANSPORTS_SCOPE_FIELDS = Object.freeze([
  ...INDEPENDENT_CASE_ADAPTER_OBSERVER_SCOPE_FIELDS,
]);
export const SOURCE_TRANSPORTS_PROVIDER_METHODS = Object.freeze([
  'openStage',
  'close',
]);
export const SOURCE_TRANSPORTS_READER_METHODS = Object.freeze([
  'next',
  'close',
]);
export const SOURCE_TRANSPORTS_OPTIONS_FIELDS = Object.freeze(['signal']);
export const SOURCE_TRANSPORTS_REQUEST_FIELDS = Object.freeze([
  'source',
  'browser',
  'case_id',
  'expected_kinds',
  'expected_observation_count',
  'signal',
  'operation_capability',
]);
export const SOURCE_TRANSPORTS_RUNTIME_FIELDS = Object.freeze([
  'setTimeout',
  'clearTimeout',
]);
export const SOURCE_TRANSPORTS_READ_TIMEOUT_MILLISECONDS = 120_000;

export const SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE = Object.freeze(
  Object.fromEntries(SOURCE_TRANSPORTS_SOURCE_ORDER.map((source) => [
    source,
    Object.freeze(INDEPENDENT_CASE_ADAPTER_STAGE_ORDER.flatMap(({ case_id: caseId, browser }) => {
      const expectedKinds = INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[
        `${caseId}/${browser}`
      ]?.[source];
      return expectedKinds === undefined ? [] : [Object.freeze({
        browser,
        case_id: caseId,
        expected_kinds: Object.freeze([...expectedKinds]),
      })];
    })),
  ])),
);

export const SOURCE_TRANSPORTS_STAGE_COUNT = Object.values(
  SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE,
).reduce((total, invocations) => total + invocations.length, 0);
export const SOURCE_TRANSPORTS_OBSERVATIONS_PER_MATRIX = Object.values(
  SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE,
).flat().reduce((total, invocation) => total + invocation.expected_kinds.length, 0);

const expectedProfile = JSON.parse(readFileSync(new URL('profile.json', import.meta.url), 'utf8'));
const packageRootUrl = new URL('./', import.meta.url);
const contractPath = new URL('contract.mjs', import.meta.url);
const unitTestPath = new URL('../test/browser-relay-source-transports.test.mjs', import.meta.url);
const workflowPath = new URL('../../../.github/workflows/browser-relay-source-transports.yml', import.meta.url);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-independent-case-adapter/contract.mjs',
  '../browser-relay-independent-observers/contract.mjs',
  '../browser-relay/contract.mjs',
].sort());
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;

export class StagingBrowserRelaySourceTransportError extends Error {
  constructor(message = 'Staging browser-relay source transport failed closed') {
    super(message);
    this.name = 'StagingBrowserRelaySourceTransportError';
  }
}

function reject(message) {
  throw new StagingBrowserRelaySourceTransportError(message);
}

function sourceTransportError(error) {
  try {
    return error instanceof StagingBrowserRelaySourceTransportError;
  } catch {
    return false;
  }
}

function plainObject(value) {
  try {
    if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactDataRecord(value, keys, path) {
  if (!plainObject(value)) reject(`${path} must be one plain object`);
  let ownKeys;
  let descriptors;
  try {
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return reject(`${path} descriptors could not be inspected`);
  }
  if (ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual([...ownKeys].sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  const snapshot = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      reject(`${path}.${key} must be one enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
}

function abortSignal(value, path) {
  try {
    if (!(value instanceof AbortSignal)) reject(`${path} must be one AbortSignal`);
    ABORTED_GETTER.call(value);
    return value;
  } catch (error) {
    if (sourceTransportError(error)) throw error;
    return reject(`${path} must be one genuine AbortSignal`);
  }
}

function capturedMethodRecord(value, keys, path) {
  const snapshot = exactDataRecord(value, keys, path);
  const methods = {};
  for (const key of keys) {
    if (typeof snapshot[key] !== 'function') reject(`${path}.${key} must be one function`);
    const method = snapshot[key];
    methods[key] = (...args) => Reflect.apply(method, value, args);
  }
  return Object.freeze({ identity: value, methods: Object.freeze(methods) });
}

export function validateSourceTransportFactoryInputs(providerValue, optionsValue) {
  try {
    const providerSnapshot = exactDataRecord(
      providerValue,
      SOURCE_TRANSPORTS_SOURCE_ORDER,
      'source_transport_providers',
    );
    const identities = new Set();
    const providers = Object.fromEntries(SOURCE_TRANSPORTS_SOURCE_ORDER.map((source) => {
      const provider = capturedMethodRecord(
        providerSnapshot[source],
        SOURCE_TRANSPORTS_PROVIDER_METHODS,
        `source_transport_providers.${source}`,
      );
      if (identities.has(provider.identity)) reject('Source transport providers must be distinct');
      identities.add(provider.identity);
      return [source, provider];
    }));
    const options = exactDataRecord(
      optionsValue,
      SOURCE_TRANSPORTS_OPTIONS_FIELDS,
      'source_transport_options',
    );
    return Object.freeze({
      providers: Object.freeze(providers),
      signal: abortSignal(options.signal, 'source_transport_options.signal'),
    });
  } catch (error) {
    if (sourceTransportError(error)) throw error;
    return reject('Source transport factory validation failed closed');
  }
}

export function validateSourceTransportScope(value, source, invocationIndex) {
  if (!SOURCE_TRANSPORTS_SOURCE_ORDER.includes(source)) {
    reject('Source transport owner is not reviewed');
  }
  const invocation = SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE[source]?.[invocationIndex];
  if (invocation === undefined) reject('Source transport received an excess execution');
  if (!plainObject(value)) reject('source_transport_scope must be one plain object');
  let ownKeys;
  let descriptors;
  try {
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return reject('source_transport_scope descriptors could not be inspected');
  }
  const reviewedKeys = [...SOURCE_TRANSPORTS_SCOPE_FIELDS, 'toJSON'];
  if (ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual([...ownKeys].sort(), reviewedKeys.sort())) {
    reject('source_transport_scope must contain exactly the reviewed fields');
  }
  const scope = {};
  for (const key of SOURCE_TRANSPORTS_SCOPE_FIELDS) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || !descriptor.enumerable) {
      reject(`source_transport_scope.${key} must be one enumerable data property`);
    }
    scope[key] = descriptor.value;
  }
  const toJSON = descriptors.toJSON;
  if (toJSON === undefined || !Object.hasOwn(toJSON, 'value')
    || toJSON.enumerable || toJSON.configurable || toJSON.writable
    || typeof toJSON.value !== 'function') {
    reject('source_transport_scope.toJSON must be the non-serializable adapter boundary');
  }
  exact(scope.browser, invocation.browser, 'source_transport_scope.browser');
  exact(scope.case_id, invocation.case_id, 'source_transport_scope.case_id');
  abortSignal(scope.signal, 'source_transport_scope.signal');
  if (typeof scope.record !== 'function') {
    reject('source_transport_scope.record must be one function');
  }
  return Object.freeze({
    browser: scope.browser,
    case_id: scope.case_id,
    signal: scope.signal,
    record: (...args) => Reflect.apply(scope.record, value, args),
    expected_kinds: invocation.expected_kinds,
  });
}

export function validateSourceTransportReader(value) {
  return capturedMethodRecord(value, SOURCE_TRANSPORTS_READER_METHODS, 'source_stage_reader');
}

export function validateSourceTransportReadResult(value, expectDone) {
  const result = exactDataRecord(
    value,
    expectDone ? ['done'] : ['done', 'observation'],
    'source_stage_read_result',
  );
  exact(result.done, expectDone, 'source_stage_read_result.done');
  if (expectDone) return Object.freeze({ done: true });
  const observation = rejectIndependentObserverPrivateMaterial(
    result.observation,
    'source_stage_read_result.observation',
  );
  return Object.freeze({ done: false, observation });
}

export function validateSourceTransportRuntime(value) {
  return capturedMethodRecord(value, SOURCE_TRANSPORTS_RUNTIME_FIELDS, 'source_transport_runtime');
}

export function sourceTransportDependencyContractsSha256() {
  const hash = createHash('sha256');
  for (const path of DEPENDENCY_CONTRACT_PATHS) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(new URL(path, import.meta.url)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function regularPinnedFile(path, maximumBytes, expectedSha256, description) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || sha256(readFileSync(path)) !== expectedSha256) {
    reject(`${description} differs from the reviewed regular file`);
  }
}

function reviewedContractFile(path) {
  const candidate = lstatSync(path);
  const canonical = lstatSync(contractPath);
  if (!candidate.isFile() || candidate.isSymbolicLink() || (candidate.mode & 0o111) !== 0
    || candidate.size === 0 || candidate.size > 64 * 1024
    || candidate.size !== canonical.size
    || sha256(readFileSync(path)) !== sha256(readFileSync(contractPath))) {
    reject('Contract differs from the reviewed regular file');
  }
}

function profileRoot(value) {
  if (value === undefined) return packageRootUrl;
  try {
    const candidate = typeof value === 'string' && value.startsWith('/')
      ? new URL(value, 'file://')
      : value;
    if (!(candidate instanceof URL) || candidate.protocol !== 'file:') {
      reject('Source transport profile root must be one file directory URL');
    }
    if (candidate.href.endsWith('/profile.json')) return new URL('./', candidate);
    if (!candidate.href.endsWith('/')) {
      reject('Source transport profile root must be one file directory URL');
    }
    return candidate;
  } catch (error) {
    if (sourceTransportError(error)) throw error;
    return reject('Source transport profile root is invalid');
  }
}

function validateProfileValue(value) {
  const profile = exactDataRecord(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'transport',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-source-transports-profile/1',
    'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(profile.state,
    'closed_genuine_source_transport_adapters_implemented_not_wired_not_executed',
    'profile.state');
  exact(profile.target, {
    project_id: 'miakapp-v4-staging',
    project_number: '1072737219170',
    region: 'europe-west9',
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  }, 'profile.target');
  exact(profile.pins, {
    implementation_base_commit: SOURCE_TRANSPORTS_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    independent_observers_profile_sha256: INDEPENDENT_OBSERVERS_PROFILE_SHA256,
    independent_case_adapter_profile_sha256: INDEPENDENT_CASE_ADAPTER_PROFILE_SHA256,
    dependency_contracts_sha256: SOURCE_TRANSPORTS_DEPENDENCY_CONTRACTS_SHA256,
    internal_source_sha256: SOURCE_TRANSPORTS_INTERNAL_SOURCE_SHA256,
    production_source_sha256: SOURCE_TRANSPORTS_PRODUCTION_SOURCE_SHA256,
    testing_source_sha256: SOURCE_TRANSPORTS_TESTING_SOURCE_SHA256,
    guard_source_sha256: SOURCE_TRANSPORTS_GUARD_SOURCE_SHA256,
    unit_test_sha256: SOURCE_TRANSPORTS_UNIT_TEST_SHA256,
    workflow_sha256: SOURCE_TRANSPORTS_WORKFLOW_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) reject('profile.pins contains an invalid immutable identifier');
  exact(profile.transport, {
    source_order: SOURCE_TRANSPORTS_SOURCE_ORDER,
    observer_methods: SOURCE_TRANSPORTS_OBSERVER_METHODS,
    provider_methods: SOURCE_TRANSPORTS_PROVIDER_METHODS,
    reader_methods: SOURCE_TRANSPORTS_READER_METHODS,
    scope_fields: SOURCE_TRANSPORTS_SCOPE_FIELDS,
    request_fields: SOURCE_TRANSPORTS_REQUEST_FIELDS,
    invocations_by_source: SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE,
    stage_count: SOURCE_TRANSPORTS_STAGE_COUNT,
    observations_per_matrix: SOURCE_TRANSPORTS_OBSERVATIONS_PER_MATRIX,
    read_timeout_milliseconds: SOURCE_TRANSPORTS_READ_TIMEOUT_MILLISECONDS,
    expected_eof_required: true,
    downstream_backpressure_awaited: true,
    operation_capability_noncloneable: true,
    provider_identity_single_operation: true,
    reader_identity_single_stage: true,
    source_execution_nonoverlapping: true,
    source_invocation_order_exact: true,
    late_records_suppressed: true,
    abort_before_drain: true,
    finite_late_settlements_drained: true,
    stage_reader_close_exact: true,
    provider_close_exact: true,
    protocol_poison_permanent: true,
    production_runtime_intrinsic: true,
    raw_observations_retained: false,
    arbitrary_errors_propagated: false,
  }, 'profile.transport');
  exact(profile.compatibility, {
    independent_source_observers_present: true,
    independent_case_adapter_compatible: true,
    complete_source_count: SOURCE_TRANSPORTS_SOURCE_ORDER.length,
    complete_observation_capacity: INDEPENDENT_FACTS_PER_MATRIX,
    genuine_source_transport_adapters_present: true,
    trusted_live_source_readers_present: false,
    operation_case_adapter_wired: false,
    common_operation_clock_owned_here: false,
    dedicated_process_ipc_present: false,
    network_implementation_present: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    submitted_fields: ['observation'],
    metadata_derived_by_existing_adapter: [
      'browser',
      'case_id',
      'source',
      'kind',
      'sequence',
      'elapsed_milliseconds',
    ],
    allowed_retention: [
      'invocation_cursor',
      'lifecycle_state',
      'operation_abort_state_until_terminal_close',
      'operation_capability_until_terminal_close',
      'weak_object_identity',
    ],
    forbidden_retention: [
      'browser_storage',
      'credential',
      'email',
      'execution_identifier',
      'firebase_uid',
      'har',
      'home_id',
      'home_traffic',
      'raw_cloud_response',
      'raw_document',
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
    live_source_readers: 0,
    live_source_observations: 0,
    live_source_receipts: 0,
    cloud_requests: 0,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    live_execution_count: 0,
    incremental_monthly_cost_eur: 0,
    credentials_committed: false,
    raw_source_material_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelaySourceTransportsProfile(rootValue) {
  try {
    const root = profileRoot(rootValue);
    exact(
      sourceTransportDependencyContractsSha256(),
      SOURCE_TRANSPORTS_DEPENDENCY_CONTRACTS_SHA256,
      'Source transport dependency contracts digest',
    );
    validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
    validateBrowserRelayIndependentObserversProfile();
    validateBrowserRelayIndependentCaseAdapterProfile();
    reviewedContractFile(new URL('contract.mjs', root));
    for (const [name, maximumBytes, digest, description] of [
      ['profile.json', MAXIMUM_PROFILE_BYTES, SOURCE_TRANSPORTS_PROFILE_SHA256, 'Profile'],
      ['internal.mjs', 48 * 1024, SOURCE_TRANSPORTS_INTERNAL_SOURCE_SHA256,
        'Internal source'],
      ['transports.mjs', 8 * 1024, SOURCE_TRANSPORTS_PRODUCTION_SOURCE_SHA256,
        'Production source'],
      ['testing.mjs', 8 * 1024, SOURCE_TRANSPORTS_TESTING_SOURCE_SHA256,
        'Testing source'],
      ['guard.mjs', 16 * 1024, SOURCE_TRANSPORTS_GUARD_SOURCE_SHA256, 'Guard source'],
    ]) regularPinnedFile(new URL(name, root), maximumBytes, digest, description);
    for (const [path, maximumBytes, digest, description] of [
      [unitTestPath, 96 * 1024, SOURCE_TRANSPORTS_UNIT_TEST_SHA256, 'Unit test'],
      [workflowPath, 8 * 1024, SOURCE_TRANSPORTS_WORKFLOW_SHA256, 'CI workflow'],
    ]) regularPinnedFile(path, maximumBytes, digest, description);
    return validateProfileValue(JSON.parse(readFileSync(new URL('profile.json', root), 'utf8')));
  } catch (error) {
    if (sourceTransportError(error)) throw error;
    return reject('Source transport profile validation failed closed');
  }
}
