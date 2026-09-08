import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE,
  SOURCE_AUTHORITY_ADAPTERS_DISTINCT_KIND_COUNT,
  SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
  SOURCE_AUTHORITY_ADAPTERS_OBSERVATIONS_PER_MATRIX,
  SOURCE_AUTHORITY_ADAPTERS_OPTIONS_FIELDS,
  SOURCE_AUTHORITY_ADAPTERS_PROFILE_SHA256,
  SOURCE_AUTHORITY_ADAPTERS_READ_DESCRIPTOR_FIELDS,
  SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE,
  SOURCE_AUTHORITY_ADAPTERS_SESSION_FIELDS,
  SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER,
  SOURCE_AUTHORITY_ADAPTERS_STAGE_COUNT,
  validateBrowserRelaySourceAuthorityAdaptersProfile,
  validateSourceAuthorityAdapterFactoryInputs,
  validateSourceAuthorityAdapterObservation,
  validateSourceAuthorityAdapterSignal,
} from '../browser-relay-source-authority-adapters/contract.mjs';

export const SOURCE_SESSION_PRODUCERS_PROFILE_PATH =
  'browser-relay-source-session-producers/profile.json';
export const SOURCE_SESSION_PRODUCERS_PROFILE_SHA256 =
  '22cee3ddd347b979ad804e9b886972cdb78f9f15390f13679a4b6f229ccb026e';
export const SOURCE_SESSION_PRODUCERS_IMPLEMENTATION_BASE_COMMIT =
  '88aacf517ee4417732656805e811ca040bca5e46';
export const SOURCE_SESSION_PRODUCERS_DEPENDENCY_CONTRACTS_SHA256 =
  'e98f89b68a69f52254816f2837244e51643188b819bf04b63283994d001fa2f9';
export const SOURCE_SESSION_PRODUCERS_INTERNAL_SOURCE_SHA256 =
  'c0e1467c3e697adb4a05f6723d887a8beb587bc7fb33975d886f01d06da2518c';
export const SOURCE_SESSION_PRODUCERS_PRODUCTION_SOURCE_SHA256 =
  'c3d0dfdfe9828b64f2921ed390e1d5f8564d5f936af68820ff5797d664af3a4c';
export const SOURCE_SESSION_PRODUCERS_TESTING_SOURCE_SHA256 =
  '599e101dc4447f0658a26f2601fe02f7374e33ff96e3dafa427ae7d1ff2ae238';
export const SOURCE_SESSION_PRODUCERS_GUARD_SOURCE_SHA256 =
  '024a53751f3508abb6d617f38207059c84a05ef7db46a44af671b5a2489d9ca1';
export const SOURCE_SESSION_PRODUCERS_UNIT_TEST_SHA256 =
  '840847c6f195500d4bea1600d632c4e1e97c7a5cecf6655c4d584519900398ce';
export const SOURCE_SESSION_PRODUCERS_WORKFLOW_SHA256 =
  '7d28ec1bfcfba19010b51f33c6b8f2ba89248954203e2e2a738424ee2e34b51d';

export const SOURCE_SESSION_PRODUCERS_SOURCE_ORDER = SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER;
export const SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE =
  SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE;
export const SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE;
export const SOURCE_SESSION_PRODUCERS_STAGE_COUNT = SOURCE_AUTHORITY_ADAPTERS_STAGE_COUNT;
export const SOURCE_SESSION_PRODUCERS_OBSERVATIONS_PER_MATRIX =
  SOURCE_AUTHORITY_ADAPTERS_OBSERVATIONS_PER_MATRIX;
export const SOURCE_SESSION_PRODUCERS_DISTINCT_KIND_COUNT =
  SOURCE_AUTHORITY_ADAPTERS_DISTINCT_KIND_COUNT;
export const SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS =
  SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
export const SOURCE_SESSION_PRODUCERS_CLIENT_FIELDS = Object.freeze(['observe', 'close']);
export const SOURCE_SESSION_PRODUCERS_OPTIONS_FIELDS = SOURCE_AUTHORITY_ADAPTERS_OPTIONS_FIELDS;
export const SOURCE_SESSION_PRODUCERS_SESSION_FIELDS = SOURCE_AUTHORITY_ADAPTERS_SESSION_FIELDS;
export const SOURCE_SESSION_PRODUCERS_READ_DESCRIPTOR_FIELDS =
  SOURCE_AUTHORITY_ADAPTERS_READ_DESCRIPTOR_FIELDS;
export const SOURCE_SESSION_PRODUCERS_CLIENT_DESCRIPTOR_FIELDS = Object.freeze([
  'source',
  'scope',
  'browser',
  'case_id',
  'kind',
  'signal',
]);
export const SOURCE_SESSION_PRODUCERS_RUNTIME_FIELDS = Object.freeze([
  'clock',
  'set_timer',
  'clear_timer',
  'client_released',
]);

const expectedProfile = JSON.parse(readFileSync(new URL('profile.json', import.meta.url), 'utf8'));
const packageRootUrl = new URL('./', import.meta.url);
const contractPath = new URL('contract.mjs', import.meta.url);
const unitTestPath = new URL(
  '../test/browser-relay-source-session-producers.test.mjs',
  import.meta.url,
);
const workflowPath = new URL(
  '../../../.github/workflows/browser-relay-source-session-producers.yml',
  import.meta.url,
);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-source-authority-adapters/contract.mjs',
].sort());
const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;

export class StagingBrowserRelaySourceSessionProducerError extends Error {
  constructor() {
    super('Staging browser-relay source session producer failed closed');
    this.name = 'StagingBrowserRelaySourceSessionProducerError';
  }
}

function reject() {
  throw new StagingBrowserRelaySourceSessionProducerError();
}

function packageError(error) {
  try {
    return error instanceof StagingBrowserRelaySourceSessionProducerError;
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

function deeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value) || !Object.isFrozen(value)) return false;
  seen.add(value);
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return false;
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value') || !deeplyFrozen(descriptor.value, seen)) return false;
  }
  return true;
}

function capturedClient(value) {
  if (!Object.isFrozen(value)) reject();
  const snapshot = exactDataRecord(value, SOURCE_SESSION_PRODUCERS_CLIENT_FIELDS);
  if (typeof snapshot.observe !== 'function' || typeof snapshot.close !== 'function') reject();
  const observe = snapshot.observe;
  const close = snapshot.close;
  return Object.freeze({
    identity: value,
    observe: (...args) => Reflect.apply(observe, value, args),
    close: (...args) => Reflect.apply(close, value, args),
  });
}

export function validateSourceSessionProducerSignal(value) {
  try {
    validateSourceAuthorityAdapterSignal(value);
    ABORTED_GETTER.call(value);
    return value;
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceSessionProducerFactoryInputs(
  clientsValue,
  optionsValue,
  nowValue,
) {
  try {
    if (!Number.isSafeInteger(nowValue) || nowValue < 0) reject();
    if (!Object.isFrozen(clientsValue)) reject();
    const options = exactDataRecord(optionsValue, SOURCE_SESSION_PRODUCERS_OPTIONS_FIELDS);
    const signal = validateSourceSessionProducerSignal(options.signal);
    const expiresAt = options.expires_at_milliseconds;
    if (!Number.isSafeInteger(expiresAt)
      || expiresAt <= nowValue
      || expiresAt > nowValue + SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS) {
      reject();
    }
    const clientSnapshot = exactDataRecord(clientsValue, SOURCE_SESSION_PRODUCERS_SOURCE_ORDER);
    const identities = new Set();
    const clients = Object.fromEntries(SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.map((source) => {
      const client = capturedClient(clientSnapshot[source]);
      if (identities.has(client.identity)) reject();
      identities.add(client.identity);
      return [source, client];
    }));
    return Object.freeze({
      clients: Object.freeze(clients),
      signal,
      expires_at_milliseconds: expiresAt,
    });
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceSessionProducerRuntime(value) {
  try {
    const snapshot = exactDataRecord(value, SOURCE_SESSION_PRODUCERS_RUNTIME_FIELDS);
    for (const field of SOURCE_SESSION_PRODUCERS_RUNTIME_FIELDS) {
      if (typeof snapshot[field] !== 'function') reject();
    }
    const methods = Object.fromEntries(SOURCE_SESSION_PRODUCERS_RUNTIME_FIELDS.map((field) => {
      const method = snapshot[field];
      return [field, (...args) => Reflect.apply(method, value, args)];
    }));
    return Object.freeze(methods);
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceSessionProducerReadDescriptor(value, source, cursor) {
  try {
    if (!SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.includes(source)
      || !Number.isSafeInteger(cursor) || cursor < 0 || !Object.isFrozen(value)
      || Object.getPrototypeOf(value) !== null) reject();
    const expected = SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE[source]?.[cursor];
    if (expected === undefined) reject();
    const ownKeys = Reflect.ownKeys(value);
    const expectedKeys = [...SOURCE_SESSION_PRODUCERS_READ_DESCRIPTOR_FIELDS, 'toJSON'];
    if (ownKeys.some((key) => typeof key !== 'string')
      || !isDeepStrictEqual([...ownKeys].sort(), expectedKeys.sort())) reject();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = {};
    for (const field of SOURCE_SESSION_PRODUCERS_READ_DESCRIPTOR_FIELDS) {
      const descriptor = descriptors[field];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
        || !descriptor.enumerable || descriptor.writable || descriptor.configurable) reject();
      snapshot[field] = descriptor.value;
    }
    const serializer = descriptors.toJSON;
    if (serializer === undefined || !Object.hasOwn(serializer, 'value')
      || serializer.enumerable || serializer.writable || serializer.configurable
      || typeof serializer.value !== 'function') reject();
    exact(snapshot.source, source);
    exact(snapshot.browser, expected.browser);
    exact(snapshot.case_id, expected.case_id);
    exact(snapshot.kind, expected.kind);
    validateSourceSessionProducerSignal(snapshot.signal);
    return Object.freeze({
      source,
      browser: snapshot.browser,
      case_id: snapshot.case_id,
      kind: snapshot.kind,
      signal: snapshot.signal,
    });
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function createSourceSessionProducerClientDescriptor(context, signal) {
  try {
    validateSourceSessionProducerSignal(signal);
    const scope = SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE[context.source];
    if (scope === undefined || !deeplyFrozen(scope)) reject();
    const descriptor = Object.create(null);
    for (const [key, value] of [
      ['source', context.source],
      ['scope', scope],
      ['browser', context.browser],
      ['case_id', context.case_id],
      ['kind', context.kind],
      ['signal', signal],
    ]) {
      Object.defineProperty(descriptor, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value,
      });
    }
    Object.defineProperty(descriptor, 'toJSON', {
      configurable: false,
      enumerable: false,
      writable: false,
      value() {
        throw new StagingBrowserRelaySourceSessionProducerError();
      },
    });
    return Object.freeze(descriptor);
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceSessionProducerObservation(value, context) {
  try {
    return validateSourceAuthorityAdapterObservation(value, context);
  } catch {
    return reject();
  }
}

export function validateSourceSessionProducerSessions(sessions, options, now) {
  try {
    validateSourceAuthorityAdapterFactoryInputs(sessions, options, now);
    return sessions;
  } catch {
    return reject();
  }
}

export function sourceSessionProducersDependencyContractsSha256() {
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
    'producer',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ]);
  exact(profile, expectedProfile);
  exact(profile.schema, 'miakapp.staging-browser-relay-source-session-producers-profile/1');
  exact(profile.revision, 1);
  exact(
    profile.state,
    'closed_trusted_source_session_producers_injected_clients_implemented_not_live_not_wired_not_executed',
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
    implementation_base_commit: SOURCE_SESSION_PRODUCERS_IMPLEMENTATION_BASE_COMMIT,
    source_authority_adapters_profile_sha256: SOURCE_AUTHORITY_ADAPTERS_PROFILE_SHA256,
    dependency_contracts_sha256: SOURCE_SESSION_PRODUCERS_DEPENDENCY_CONTRACTS_SHA256,
    internal_source_sha256: SOURCE_SESSION_PRODUCERS_INTERNAL_SOURCE_SHA256,
    production_source_sha256: SOURCE_SESSION_PRODUCERS_PRODUCTION_SOURCE_SHA256,
    testing_source_sha256: SOURCE_SESSION_PRODUCERS_TESTING_SOURCE_SHA256,
    guard_source_sha256: SOURCE_SESSION_PRODUCERS_GUARD_SOURCE_SHA256,
    unit_test_sha256: SOURCE_SESSION_PRODUCERS_UNIT_TEST_SHA256,
    workflow_sha256: SOURCE_SESSION_PRODUCERS_WORKFLOW_SHA256,
  });
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) reject();
  exact(profile.producer, {
    source_order: SOURCE_SESSION_PRODUCERS_SOURCE_ORDER,
    scopes_by_source: SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE,
    client_fields: SOURCE_SESSION_PRODUCERS_CLIENT_FIELDS,
    client_descriptor_fields: SOURCE_SESSION_PRODUCERS_CLIENT_DESCRIPTOR_FIELDS,
    options_fields: SOURCE_SESSION_PRODUCERS_OPTIONS_FIELDS,
    session_fields: SOURCE_SESSION_PRODUCERS_SESSION_FIELDS,
    read_descriptor_fields: SOURCE_SESSION_PRODUCERS_READ_DESCRIPTOR_FIELDS,
    runtime_fields: SOURCE_SESSION_PRODUCERS_RUNTIME_FIELDS,
    stage_count: SOURCE_SESSION_PRODUCERS_STAGE_COUNT,
    observations_per_matrix: SOURCE_SESSION_PRODUCERS_OBSERVATIONS_PER_MATRIX,
    distinct_kind_count: SOURCE_SESSION_PRODUCERS_DISTINCT_KIND_COUNT,
    maximum_session_lifetime_milliseconds:
      SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
    expiry_is_absolute_unix_epoch_milliseconds: true,
    explicit_injected_clients: true,
    client_map_frozen: true,
    options_snapshotted_once: true,
    client_claim_after_output_validation: true,
    client_identity_single_operation: true,
    session_identity_single_operation: true,
    producer_owns_source_scope_and_expiry: true,
    canonical_order_revalidated: true,
    source_calls_ordered_nonoverlapping: true,
    call_reserved_before_await: true,
    abort_checked_before_and_after_call: true,
    expiry_checked_before_and_after_call: true,
    abort_and_expiry_rechecked_at_dispatch: true,
    active_request_abort_poisons_shared: true,
    active_expiry_aborts_client_signal: true,
    expiry_timer_races_callback_settlement: false,
    client_descriptor_attenuated: true,
    operation_capability_omitted_from_client_descriptor: true,
    semantic_validation_before_session_output: true,
    caller_abort_reason_sanitized: true,
    callback_read_reentrancy_rejected: true,
    callback_close_reentrancy_rejected: true,
    foreign_thenable_context_preserved: true,
    shared_poison_permanent: true,
    client_close_invoked_at_most_once: true,
    close_cleanup_independent_of_operation_cancellation: true,
    close_started_before_cleanup_abort_invoked_exactly_once: true,
    terminal_started_callbacks_settled: true,
    terminal_client_references_cleared: true,
    testing_client_release_probe_present: true,
    production_clock_intrinsic: true,
    production_timers_intrinsic: true,
    public_read_and_close_deadlines_owned_by_source_authority_adapter: true,
    inner_timeout_race_present: false,
  });
  exact(profile.compatibility, {
    source_authority_adapters_compatible: true,
    independent_observation_validation_present: true,
    trusted_source_session_producers_present: true,
    explicit_injected_source_clients_present: true,
    complete_source_count: SOURCE_SESSION_PRODUCERS_SOURCE_ORDER.length,
    complete_stage_count: SOURCE_SESSION_PRODUCERS_STAGE_COUNT,
    complete_observation_capacity: SOURCE_SESSION_PRODUCERS_OBSERVATIONS_PER_MATRIX,
    concrete_live_source_clients_present: false,
    built_in_network_implementation_present: false,
    operation_case_adapter_wired: false,
    trusted_live_page_providers_present: false,
    dedicated_process_ipc_present: false,
    uncooperative_same_process_client_forced_termination: false,
  });
  exact(profile.output, {
    session_fields: SOURCE_SESSION_PRODUCERS_SESSION_FIELDS,
    submitted_fields: ['observation'],
    semantic_validation_before_output: true,
    raw_source_material_accepted: false,
    raw_source_material_retained: false,
    client_references_exposed: false,
    operation_capability_exposed: false,
    arbitrary_errors_propagated: false,
  });
  if (Object.values(profile.authority).some((entry) => entry !== false)) reject();
  exact(profile.evidence, {
    state: 'absent',
    live_source_clients: 0,
    live_source_sessions: 0,
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

export function validateBrowserRelaySourceSessionProducersProfile(rootValue) {
  try {
    const root = profileRoot(rootValue);
    exact(
      sourceSessionProducersDependencyContractsSha256(),
      SOURCE_SESSION_PRODUCERS_DEPENDENCY_CONTRACTS_SHA256,
    );
    validateBrowserRelaySourceAuthorityAdaptersProfile();
    reviewedContractFile(new URL('contract.mjs', root));
    for (const [name, maximumBytes, digest] of [
      ['profile.json', MAXIMUM_PROFILE_BYTES, SOURCE_SESSION_PRODUCERS_PROFILE_SHA256],
      ['internal.mjs', 48 * 1024, SOURCE_SESSION_PRODUCERS_INTERNAL_SOURCE_SHA256],
      ['producers.mjs', 8 * 1024, SOURCE_SESSION_PRODUCERS_PRODUCTION_SOURCE_SHA256],
      ['testing.mjs', 8 * 1024, SOURCE_SESSION_PRODUCERS_TESTING_SOURCE_SHA256],
      ['guard.mjs', 20 * 1024, SOURCE_SESSION_PRODUCERS_GUARD_SOURCE_SHA256],
    ]) regularPinnedFile(new URL(name, root), maximumBytes, digest);
    for (const [path, maximumBytes, digest] of [
      [unitTestPath, 192 * 1024, SOURCE_SESSION_PRODUCERS_UNIT_TEST_SHA256],
      [workflowPath, 8 * 1024, SOURCE_SESSION_PRODUCERS_WORKFLOW_SHA256],
    ]) regularPinnedFile(path, maximumBytes, digest);
    return validateProfileValue(JSON.parse(readFileSync(new URL('profile.json', root), 'utf8')));
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}
