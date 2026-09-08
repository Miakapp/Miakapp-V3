import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  FACT_ORDER_BY_BROWSER,
  INDEPENDENT_FACTS_PER_MATRIX,
  INDEPENDENT_OBSERVERS_PROFILE_SHA256,
  INDEPENDENT_SOURCE_FACT_SCHEMA,
  validateBrowserRelayIndependentObserversProfile,
  validateIndependentSourceFact,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE,
  SOURCE_TRANSPORTS_OBSERVATIONS_PER_MATRIX,
  SOURCE_TRANSPORTS_PROFILE_SHA256,
  SOURCE_TRANSPORTS_PROVIDER_METHODS,
  SOURCE_TRANSPORTS_READER_METHODS,
  SOURCE_TRANSPORTS_REQUEST_FIELDS,
  SOURCE_TRANSPORTS_SOURCE_ORDER,
  SOURCE_TRANSPORTS_STAGE_COUNT,
  validateBrowserRelaySourceTransportsProfile,
} from '../browser-relay-source-transports/contract.mjs';

export const AUTHENTICATED_SOURCE_READERS_PROFILE_PATH =
  'browser-relay-authenticated-source-readers/profile.json';
export const AUTHENTICATED_SOURCE_READERS_PROFILE_SHA256 =
  '1f2afc28a71eb61183f5927043fb6ccd3c9c305eec9dda71b452bd0106cdbfd6';
export const AUTHENTICATED_SOURCE_READERS_IMPLEMENTATION_BASE_COMMIT =
  'd79438c511770b8f5cdb0dbd70dd14684b688c2e';
export const AUTHENTICATED_SOURCE_READERS_DEPENDENCY_CONTRACTS_SHA256 =
  'e941ff3da6bab9f2a09b76262a8e38b3fbe4daab55397a944e5c7a02295e1493';
export const AUTHENTICATED_SOURCE_READERS_INTERNAL_SOURCE_SHA256 =
  'ea9677112b2cd71ec9413fbed29b8f4241ad66b3e7c5d7db8895c83b0c790f4c';
export const AUTHENTICATED_SOURCE_READERS_PRODUCTION_SOURCE_SHA256 =
  'e0381cc53e6c2ffdecdd7db350d7712fb3b2ceb064bd0a468e6cd2a33e358a7b';
export const AUTHENTICATED_SOURCE_READERS_TESTING_SOURCE_SHA256 =
  '1af12b76b5aaf3a42e9170d60fc7022f219f16d723f6743cca78334129e3ecd6';
export const AUTHENTICATED_SOURCE_READERS_GUARD_SOURCE_SHA256 =
  '2fde09a313b3f29737779be02ad46fb241096e943d16b6f8a2e6f97dbeab8ac7';
export const AUTHENTICATED_SOURCE_READERS_UNIT_TEST_SHA256 =
  '8fdfb26e6581c20f9183478a2a38344d16118b818809c879ac62e2bbee33cd34';
export const AUTHENTICATED_SOURCE_READERS_WORKFLOW_SHA256 =
  '92ddd3210db61fb69e9f8c34751589959b0b8e03bf348ab0237129a938464880';

export const AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER = Object.freeze([
  ...SOURCE_TRANSPORTS_SOURCE_ORDER,
]);
export const AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE =
  SOURCE_TRANSPORTS_INVOCATIONS_BY_SOURCE;
export const AUTHENTICATED_SOURCE_READERS_STAGE_COUNT = SOURCE_TRANSPORTS_STAGE_COUNT;
export const AUTHENTICATED_SOURCE_READERS_OBSERVATIONS_PER_MATRIX =
  SOURCE_TRANSPORTS_OBSERVATIONS_PER_MATRIX;
export const AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS =
  30 * 60 * 1_000;
export const AUTHENTICATED_SOURCE_READERS_PROVIDER_METHODS =
  SOURCE_TRANSPORTS_PROVIDER_METHODS;
export const AUTHENTICATED_SOURCE_READERS_READER_METHODS = SOURCE_TRANSPORTS_READER_METHODS;
export const AUTHENTICATED_SOURCE_READERS_OPTIONS_FIELDS = Object.freeze([
  'signal',
  'expires_at_milliseconds',
]);
export const AUTHENTICATED_SOURCE_READERS_REQUEST_FIELDS = SOURCE_TRANSPORTS_REQUEST_FIELDS;
export const AUTHENTICATED_SOURCE_READERS_CONTEXT_FIELDS = Object.freeze([
  'source',
  'browser',
  'case_id',
  'kind',
  'signal',
  'operation_capability',
]);
export const AUTHENTICATED_SOURCE_READERS_RUNTIME_FIELDS = Object.freeze([
  'clock',
  'authority_released',
]);
export const AUTHENTICATED_SOURCE_READERS_AUTHORITY_METHODS_BY_SOURCE = Object.freeze(
  Object.fromEntries(AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.map((source) => {
    const methods = [];
    for (const invocation of AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE[source]) {
      for (const kind of invocation.expected_kinds) {
        if (!methods.includes(kind)) methods.push(kind);
      }
    }
    return [source, Object.freeze([...methods, 'close'])];
  })),
);

const expectedProfile = JSON.parse(readFileSync(new URL('profile.json', import.meta.url), 'utf8'));
const packageRootUrl = new URL('./', import.meta.url);
const contractPath = new URL('contract.mjs', import.meta.url);
const unitTestPath = new URL(
  '../test/browser-relay-authenticated-source-readers.test.mjs',
  import.meta.url,
);
const workflowPath = new URL(
  '../../../.github/workflows/browser-relay-authenticated-source-readers.yml',
  import.meta.url,
);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-independent-observers/contract.mjs',
  '../browser-relay-source-transports/contract.mjs',
].sort());
const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;

export class StagingBrowserRelayAuthenticatedSourceReaderError extends Error {
  constructor() {
    super('Staging browser-relay authenticated source reader failed closed');
    this.name = 'StagingBrowserRelayAuthenticatedSourceReaderError';
  }
}

function reject() {
  throw new StagingBrowserRelayAuthenticatedSourceReaderError();
}

function packageError(error) {
  try {
    return error instanceof StagingBrowserRelayAuthenticatedSourceReaderError;
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

function exactDataRecord(value, keys) {
  if (!plainObject(value)) reject();
  let ownKeys;
  let descriptors;
  try {
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return reject();
  }
  if (ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual([...ownKeys].sort(), [...keys].sort())) reject();
  const snapshot = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || !descriptor.enumerable) reject();
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function exact(value, expected) {
  if (!isDeepStrictEqual(value, expected)) reject();
}

export function validateAuthenticatedSourceReaderSignal(value) {
  try {
    if (!(value instanceof AbortSignal)) reject();
    ABORTED_GETTER.call(value);
    return value;
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

function capturedMethodRecord(value, keys) {
  const snapshot = exactDataRecord(value, keys);
  const methods = Object.create(null);
  for (const key of keys) {
    if (typeof snapshot[key] !== 'function') reject();
    const method = snapshot[key];
    methods[key] = (...args) => Reflect.apply(method, value, args);
  }
  return Object.freeze({ identity: value, methods: Object.freeze(methods) });
}

export function validateAuthenticatedSourceReaderRuntime(value) {
  return capturedMethodRecord(
    value,
    AUTHENTICATED_SOURCE_READERS_RUNTIME_FIELDS,
  );
}

export function validateAuthenticatedSourceReaderFactoryInputs(
  authorityValue,
  optionsValue,
  nowValue,
) {
  try {
    if (!Number.isSafeInteger(nowValue) || nowValue < 0) reject();
    const authoritySnapshot = exactDataRecord(
      authorityValue,
      AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER,
    );
    const identities = new Set();
    const authorities = Object.fromEntries(
      AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.map((source) => {
        const authority = capturedMethodRecord(
          authoritySnapshot[source],
          AUTHENTICATED_SOURCE_READERS_AUTHORITY_METHODS_BY_SOURCE[source],
        );
        if (identities.has(authority.identity)) reject();
        identities.add(authority.identity);
        return [source, authority];
      }),
    );
    const options = exactDataRecord(
      optionsValue,
      AUTHENTICATED_SOURCE_READERS_OPTIONS_FIELDS,
    );
    const signal = validateAuthenticatedSourceReaderSignal(options.signal);
    const expiresAt = options.expires_at_milliseconds;
    if (!Number.isSafeInteger(expiresAt)
      || expiresAt <= nowValue
      || expiresAt > nowValue
        + AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS) reject();
    return Object.freeze({
      authorities: Object.freeze(authorities),
      signal,
      expires_at_milliseconds: expiresAt,
    });
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

function validateOpaqueOperationCapability(value) {
  try {
    if (typeof value !== 'function'
      || Object.getPrototypeOf(value) !== null
      || !Object.isFrozen(value)
      || Object.hasOwn(value, 'prototype')) reject();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (!isDeepStrictEqual(Reflect.ownKeys(value).sort(), ['length', 'name'])
      || descriptors.length?.value !== 0
      || descriptors.length?.enumerable !== false
      || descriptors.length?.configurable !== false
      || descriptors.name?.enumerable !== false
      || descriptors.name?.configurable !== false) reject();
    return value;
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateAuthenticatedSourceReaderRequest(value, source, invocationIndex) {
  try {
    if (!AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.includes(source)) reject();
    const invocation = AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE[source]?.[
      invocationIndex
    ];
    if (invocation === undefined || !Object.isFrozen(value)) reject();
    const request = exactDataRecord(value, AUTHENTICATED_SOURCE_READERS_REQUEST_FIELDS);
    exact(request.source, source);
    exact(request.browser, invocation.browser);
    exact(request.case_id, invocation.case_id);
    exact(request.expected_kinds, invocation.expected_kinds);
    exact(request.expected_observation_count, invocation.expected_kinds.length);
    if (!Object.isFrozen(request.expected_kinds)) reject();
    validateAuthenticatedSourceReaderSignal(request.signal);
    validateOpaqueOperationCapability(request.operation_capability);
    return Object.freeze({
      source,
      browser: request.browser,
      case_id: request.case_id,
      expected_kinds: invocation.expected_kinds,
      expected_observation_count: request.expected_observation_count,
      signal: request.signal,
      operation_capability: request.operation_capability,
    });
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function createAuthenticatedSourceReaderContext(request, kind, signal) {
  if (!request.expected_kinds.includes(kind)) reject();
  validateAuthenticatedSourceReaderSignal(signal);
  const context = Object.create(null);
  for (const [key, value] of [
    ['source', request.source],
    ['browser', request.browser],
    ['case_id', request.case_id],
    ['kind', kind],
    ['signal', signal],
    ['operation_capability', request.operation_capability],
  ]) {
    Object.defineProperty(context, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value,
    });
  }
  Object.defineProperty(context, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      throw new StagingBrowserRelayAuthenticatedSourceReaderError();
    },
  });
  return Object.freeze(context);
}

export function validateAuthenticatedSourceReaderObservation(value, request, kind) {
  try {
    const phases = FACT_ORDER_BY_BROWSER[request.browser]?.[request.source];
    const expectedSequence = phases?.indexOf(kind) + 1;
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 1) reject();
    const fact = validateIndependentSourceFact({
      schema: INDEPENDENT_SOURCE_FACT_SCHEMA,
      browser: request.browser,
      source: request.source,
      sequence: expectedSequence,
      kind,
      elapsed_milliseconds: 0,
      observation: value,
    }, request.browser, request.source, expectedSequence);
    return fact.observation;
  } catch {
    return reject();
  }
}

export function authenticatedSourceReadersDependencyContractsSha256() {
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

function regularPinnedFile(path, maximumBytes, expectedSha256) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || sha256(readFileSync(path)) !== expectedSha256) reject();
}

function reviewedContractFile(path) {
  const candidate = lstatSync(path);
  const canonical = lstatSync(contractPath);
  if (!candidate.isFile() || candidate.isSymbolicLink() || (candidate.mode & 0o111) !== 0
    || candidate.size === 0 || candidate.size > 64 * 1024
    || candidate.size !== canonical.size
    || sha256(readFileSync(path)) !== sha256(readFileSync(contractPath))) reject();
}

function profileRoot(value) {
  if (value === undefined) return packageRootUrl;
  try {
    const candidate = typeof value === 'string' && value.startsWith('/')
      ? new URL(value, 'file://')
      : value;
    if (!(candidate instanceof URL) || candidate.protocol !== 'file:') reject();
    if (candidate.href.endsWith('/profile.json')) return new URL('./', candidate);
    if (!candidate.href.endsWith('/')) reject();
    return candidate;
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

function validateProfileValue(value) {
  const profile = exactDataRecord(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'reader',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ]);
  exact(profile, expectedProfile);
  exact(profile.schema, 'miakapp.staging-browser-relay-authenticated-source-readers-profile/1');
  exact(profile.revision, 1);
  exact(
    profile.state,
    'closed_authenticated_kind_attenuated_source_readers_implemented_not_live_adapted_not_wired_not_executed',
  );
  exact(profile.target, {
    project_id: 'miakapp-v4-staging',
    project_number: '1072737219170',
    region: 'europe-west9',
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  });
  exact(profile.pins, {
    implementation_base_commit: AUTHENTICATED_SOURCE_READERS_IMPLEMENTATION_BASE_COMMIT,
    source_transports_profile_sha256: SOURCE_TRANSPORTS_PROFILE_SHA256,
    independent_observers_profile_sha256: INDEPENDENT_OBSERVERS_PROFILE_SHA256,
    dependency_contracts_sha256: AUTHENTICATED_SOURCE_READERS_DEPENDENCY_CONTRACTS_SHA256,
    internal_source_sha256: AUTHENTICATED_SOURCE_READERS_INTERNAL_SOURCE_SHA256,
    production_source_sha256: AUTHENTICATED_SOURCE_READERS_PRODUCTION_SOURCE_SHA256,
    testing_source_sha256: AUTHENTICATED_SOURCE_READERS_TESTING_SOURCE_SHA256,
    guard_source_sha256: AUTHENTICATED_SOURCE_READERS_GUARD_SOURCE_SHA256,
    unit_test_sha256: AUTHENTICATED_SOURCE_READERS_UNIT_TEST_SHA256,
    workflow_sha256: AUTHENTICATED_SOURCE_READERS_WORKFLOW_SHA256,
  });
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) reject();
  exact(profile.reader, {
    source_order: AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER,
    authority_methods_by_source: AUTHENTICATED_SOURCE_READERS_AUTHORITY_METHODS_BY_SOURCE,
    provider_methods: AUTHENTICATED_SOURCE_READERS_PROVIDER_METHODS,
    reader_methods: AUTHENTICATED_SOURCE_READERS_READER_METHODS,
    options_fields: AUTHENTICATED_SOURCE_READERS_OPTIONS_FIELDS,
    request_fields: AUTHENTICATED_SOURCE_READERS_REQUEST_FIELDS,
    context_fields: AUTHENTICATED_SOURCE_READERS_CONTEXT_FIELDS,
    stage_count: AUTHENTICATED_SOURCE_READERS_STAGE_COUNT,
    observations_per_matrix: AUTHENTICATED_SOURCE_READERS_OBSERVATIONS_PER_MATRIX,
    maximum_authority_lifetime_milliseconds:
      AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
    expiry_is_absolute_unix_epoch_milliseconds: true,
    kind_attenuation_exact: true,
    operation_capability_identity_bound: true,
    authority_identity_single_operation: true,
    provider_identity_single_operation: true,
    reader_identity_single_stage: true,
    source_stages_ordered_nonoverlapping: true,
    authority_calls_lazy_ordered_nonoverlapping: true,
    call_reserved_before_await: true,
    abort_checked_before_and_after_call: true,
    expiry_checked_before_and_after_call: true,
    abort_checked_before_and_after_close: true,
    expiry_checked_before_and_after_close: true,
    caller_abort_reason_sanitized: true,
    callback_close_reentrancy_rejected: true,
    expected_eof_exact: true,
    reader_close_exact: true,
    provider_close_exact: true,
    shared_poison_permanent: true,
    terminal_authority_references_cleared: true,
    testing_authority_release_probe_present: true,
    production_clock_intrinsic: true,
  });
  if (profile.reader.stage_count !== AUTHENTICATED_SOURCE_READERS_STAGE_COUNT
    || profile.reader.observations_per_matrix !== INDEPENDENT_FACTS_PER_MATRIX) reject();
  exact(profile.compatibility, {
    generic_source_transports_compatible: true,
    independent_observation_validation_present: true,
    authenticated_reader_protocol_present: true,
    kind_attenuated_authority_boundary_present: true,
    complete_source_count: AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER.length,
    complete_stage_count: AUTHENTICATED_SOURCE_READERS_STAGE_COUNT,
    complete_observation_capacity: INDEPENDENT_FACTS_PER_MATRIX,
    concrete_live_source_authority_adapters_present: false,
    network_implementation_present: false,
    operation_case_adapter_wired: false,
    trusted_live_page_providers_present: false,
    dedicated_process_ipc_present: false,
  });
  exact(profile.output, {
    submitted_fields: ['observation'],
    semantic_validation_before_output: true,
    raw_source_material_accepted: false,
    raw_source_material_retained: false,
    authority_references_exposed: false,
    operation_capability_exposed: false,
    arbitrary_errors_propagated: false,
  });
  if (Object.values(profile.authority).some((entry) => entry !== false)) reject();
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
  });
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayAuthenticatedSourceReadersProfile(rootValue) {
  try {
    const root = profileRoot(rootValue);
    exact(
      authenticatedSourceReadersDependencyContractsSha256(),
      AUTHENTICATED_SOURCE_READERS_DEPENDENCY_CONTRACTS_SHA256,
    );
    validateBrowserRelayIndependentObserversProfile();
    validateBrowserRelaySourceTransportsProfile();
    reviewedContractFile(new URL('contract.mjs', root));
    for (const [name, maximumBytes, digest] of [
      ['profile.json', MAXIMUM_PROFILE_BYTES, AUTHENTICATED_SOURCE_READERS_PROFILE_SHA256],
      ['internal.mjs', 48 * 1024, AUTHENTICATED_SOURCE_READERS_INTERNAL_SOURCE_SHA256],
      ['readers.mjs', 8 * 1024, AUTHENTICATED_SOURCE_READERS_PRODUCTION_SOURCE_SHA256],
      ['testing.mjs', 8 * 1024, AUTHENTICATED_SOURCE_READERS_TESTING_SOURCE_SHA256],
      ['guard.mjs', 20 * 1024, AUTHENTICATED_SOURCE_READERS_GUARD_SOURCE_SHA256],
    ]) regularPinnedFile(new URL(name, root), maximumBytes, digest);
    for (const [path, maximumBytes, digest] of [
      [unitTestPath, 128 * 1024, AUTHENTICATED_SOURCE_READERS_UNIT_TEST_SHA256],
      [workflowPath, 8 * 1024, AUTHENTICATED_SOURCE_READERS_WORKFLOW_SHA256],
    ]) regularPinnedFile(path, maximumBytes, digest);
    return validateProfileValue(JSON.parse(readFileSync(new URL('profile.json', root), 'utf8')));
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}
