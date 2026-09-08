import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  AUTHENTICATED_SOURCE_READERS_AUTHORITY_METHODS_BY_SOURCE,
  AUTHENTICATED_SOURCE_READERS_CONTEXT_FIELDS,
  AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE,
  AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
  AUTHENTICATED_SOURCE_READERS_OBSERVATIONS_PER_MATRIX,
  AUTHENTICATED_SOURCE_READERS_PROFILE_SHA256,
  AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER,
  AUTHENTICATED_SOURCE_READERS_STAGE_COUNT,
  validateAuthenticatedSourceReaderObservation,
  validateBrowserRelayAuthenticatedSourceReadersProfile,
} from '../browser-relay-authenticated-source-readers/contract.mjs';

export const SOURCE_AUTHORITY_ADAPTERS_PROFILE_PATH =
  'browser-relay-source-authority-adapters/profile.json';
export const SOURCE_AUTHORITY_ADAPTERS_PROFILE_SHA256 =
  '1648e635091be7f83ead3b0739dc2ad2624d34c2bc161a26d03639872df9a568';
export const SOURCE_AUTHORITY_ADAPTERS_IMPLEMENTATION_BASE_COMMIT =
  'a6d99142228fffbfdc5a9ce9fe9b77b435d65a60';
export const SOURCE_AUTHORITY_ADAPTERS_DEPENDENCY_CONTRACTS_SHA256 =
  '146a005a7e82aee89a6b2b19df31502a8d928081551cd3c69ff5028c4602a0da';
export const SOURCE_AUTHORITY_ADAPTERS_INTERNAL_SOURCE_SHA256 =
  'ed04b584d732325eefa4b4b39856b31e4b9ea8dfa659018c2dbdb1f796326e96';
export const SOURCE_AUTHORITY_ADAPTERS_PRODUCTION_SOURCE_SHA256 =
  '96099451f1e1eb84895337c332d609403ea1d97c87cab405fde33401626bd6b0';
export const SOURCE_AUTHORITY_ADAPTERS_TESTING_SOURCE_SHA256 =
  '937edcccbc3c9f55bdf2b310f9bcbfeaa8e64aa68d3b0d8bb2a4559ddf82ebe2';
export const SOURCE_AUTHORITY_ADAPTERS_GUARD_SOURCE_SHA256 =
  '6e6292c57bb816dcaa3111542e20fdf7d10c99c32e7135323f5f4a7ae4dffd23';
export const SOURCE_AUTHORITY_ADAPTERS_UNIT_TEST_SHA256 =
  '4ea1b976e1bfa288102ea2cd2b77bac96b28a8de125ded1a0bd5337a8777ae9e';
export const SOURCE_AUTHORITY_ADAPTERS_WORKFLOW_SHA256 =
  'baf66af60725df0a5b90a14df7fca449290260a99f95a6fb7307eee50628dc27';

export const SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER = Object.freeze([
  ...AUTHENTICATED_SOURCE_READERS_SOURCE_ORDER,
]);
export const SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE =
  AUTHENTICATED_SOURCE_READERS_AUTHORITY_METHODS_BY_SOURCE;
export const SOURCE_AUTHORITY_ADAPTERS_INVOCATIONS_BY_SOURCE =
  AUTHENTICATED_SOURCE_READERS_INVOCATIONS_BY_SOURCE;
export const SOURCE_AUTHORITY_ADAPTERS_STAGE_COUNT = AUTHENTICATED_SOURCE_READERS_STAGE_COUNT;
export const SOURCE_AUTHORITY_ADAPTERS_OBSERVATIONS_PER_MATRIX =
  AUTHENTICATED_SOURCE_READERS_OBSERVATIONS_PER_MATRIX;
export const SOURCE_AUTHORITY_ADAPTERS_DISTINCT_KIND_COUNT = new Set(
  SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.flatMap((source) => (
    SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE[source]
      .filter((method) => method !== 'close')
  )),
).size;
export const SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS =
  AUTHENTICATED_SOURCE_READERS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS;
export const SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS = 30_000;
export const SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_CLOSE_MILLISECONDS = 30_000;
export const SOURCE_AUTHORITY_ADAPTERS_OPTIONS_FIELDS = Object.freeze([
  'signal',
  'expires_at_milliseconds',
]);
export const SOURCE_AUTHORITY_ADAPTERS_SESSION_FIELDS = Object.freeze([
  'source',
  'scope',
  'expires_at_milliseconds',
  'read',
  'close',
]);
export const SOURCE_AUTHORITY_ADAPTERS_READ_DESCRIPTOR_FIELDS = Object.freeze([
  'source',
  'browser',
  'case_id',
  'kind',
  'signal',
]);
export const SOURCE_AUTHORITY_ADAPTERS_RUNTIME_FIELDS = Object.freeze([
  'clock',
  'set_timer',
  'clear_timer',
  'session_released',
]);

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export const SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE = deepFreeze({
  firebase_app_check: {
    project_id: 'miakapp-v4-staging',
    project_number: '1072737219170',
    firebase_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
    provider_type: 'recaptcha_enterprise',
  },
  hosting: {
    project_id: 'miakapp-v4-staging',
    site_id: 'miakapp-v4-staging',
    origin: 'https://miakapp-v4-staging.web.app',
  },
  control_plane: {
    project_id: 'miakapp-v4-staging',
    region: 'europe-west9',
    service_name: 'control-plane',
    origin: 'https://control-plane-aczhngqraq-od.a.run.app',
  },
  relay: {
    project_id: 'miakapp-v4-staging',
    region: 'europe-west9',
    service_names: [
      'miakapp-staging-relay-a',
      'miakapp-staging-relay-b',
    ],
    websocket_audiences: [
      'wss://miakapp-staging-relay-a-aczhngqraq-od.a.run.app/ws',
      'wss://miakapp-staging-relay-b-aczhngqraq-od.a.run.app/ws',
    ],
  },
  coordinator: {
    execution_location: 'operator_local',
    data_policy: 'synthetic_only',
  },
  kms: {
    project_id: 'miakapp-v4-staging',
    region: 'europe-west9',
    crypto_key: 'projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing',
  },
  firestore: {
    project_id: 'miakapp-v4-staging',
    database_id: '(default)',
    data_policy: 'synthetic_only',
  },
});

export const SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE = Object.freeze(
  Object.fromEntries(SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.map((source) => [
    source,
    Object.freeze(SOURCE_AUTHORITY_ADAPTERS_INVOCATIONS_BY_SOURCE[source].flatMap(
      (invocation) => invocation.expected_kinds.map((kind) => Object.freeze({
        browser: invocation.browser,
        case_id: invocation.case_id,
        kind,
      })),
    )),
  ])),
);

const expectedProfile = JSON.parse(readFileSync(new URL('profile.json', import.meta.url), 'utf8'));
const packageRootUrl = new URL('./', import.meta.url);
const contractPath = new URL('contract.mjs', import.meta.url);
const unitTestPath = new URL(
  '../test/browser-relay-source-authority-adapters.test.mjs',
  import.meta.url,
);
const workflowPath = new URL(
  '../../../.github/workflows/browser-relay-source-authority-adapters.yml',
  import.meta.url,
);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-authenticated-source-readers/contract.mjs',
].sort());
const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;

export class StagingBrowserRelaySourceAuthorityAdapterError extends Error {
  constructor() {
    super('Staging browser-relay source authority adapter failed closed');
    this.name = 'StagingBrowserRelaySourceAuthorityAdapterError';
  }
}

function reject() {
  throw new StagingBrowserRelaySourceAuthorityAdapterError();
}

function packageError(error) {
  try {
    return error instanceof StagingBrowserRelaySourceAuthorityAdapterError;
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

export function validateSourceAuthorityAdapterSignal(value) {
  try {
    if (!(value instanceof AbortSignal)) reject();
    ABORTED_GETTER.call(value);
    return value;
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceAuthorityAdapterOperationCapability(value) {
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

function capturedSession(value, source, expiresAt) {
  if (!Object.isFrozen(value)) reject();
  const snapshot = exactDataRecord(value, SOURCE_AUTHORITY_ADAPTERS_SESSION_FIELDS);
  exact(snapshot.source, source);
  exact(snapshot.scope, SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE[source]);
  if (!deeplyFrozen(snapshot.scope)) reject();
  exact(snapshot.expires_at_milliseconds, expiresAt);
  if (typeof snapshot.read !== 'function' || typeof snapshot.close !== 'function') reject();
  const read = snapshot.read;
  const close = snapshot.close;
  return Object.freeze({
    identity: value,
    read: (...args) => Reflect.apply(read, value, args),
    close: (...args) => Reflect.apply(close, value, args),
  });
}

export function validateSourceAuthorityAdapterFactoryInputs(
  sessionsValue,
  optionsValue,
  nowValue,
) {
  try {
    if (!Number.isSafeInteger(nowValue) || nowValue < 0) reject();
    const options = exactDataRecord(optionsValue, SOURCE_AUTHORITY_ADAPTERS_OPTIONS_FIELDS);
    const signal = validateSourceAuthorityAdapterSignal(options.signal);
    const expiresAt = options.expires_at_milliseconds;
    if (!Number.isSafeInteger(expiresAt)
      || expiresAt <= nowValue
      || expiresAt > nowValue + SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS) {
      reject();
    }
    const sessionSnapshot = exactDataRecord(
      sessionsValue,
      SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER,
    );
    const identities = new Set();
    const sessions = Object.fromEntries(SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.map((source) => {
      const session = capturedSession(
        sessionSnapshot[source],
        source,
        expiresAt,
      );
      if (identities.has(session.identity)) reject();
      identities.add(session.identity);
      return [source, session];
    }));
    return Object.freeze({
      sessions: Object.freeze(sessions),
      signal,
      expires_at_milliseconds: expiresAt,
    });
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceAuthorityAdapterRuntime(value) {
  try {
    const snapshot = exactDataRecord(value, SOURCE_AUTHORITY_ADAPTERS_RUNTIME_FIELDS);
    for (const field of SOURCE_AUTHORITY_ADAPTERS_RUNTIME_FIELDS) {
      if (typeof snapshot[field] !== 'function') reject();
    }
    const methods = Object.fromEntries(SOURCE_AUTHORITY_ADAPTERS_RUNTIME_FIELDS.map((field) => {
      const method = snapshot[field];
      return [field, (...args) => Reflect.apply(method, value, args)];
    }));
    return Object.freeze(methods);
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceAuthorityAdapterContext(value, source, cursor) {
  try {
    if (!SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.includes(source)
      || !Number.isSafeInteger(cursor) || cursor < 0 || !Object.isFrozen(value)
      || Object.getPrototypeOf(value) !== null) reject();
    const expected = SOURCE_AUTHORITY_ADAPTERS_CALLS_BY_SOURCE[source]?.[cursor];
    if (expected === undefined) reject();
    const ownKeys = Reflect.ownKeys(value);
    const expectedKeys = [...AUTHENTICATED_SOURCE_READERS_CONTEXT_FIELDS, 'toJSON'];
    if (ownKeys.some((key) => typeof key !== 'string')
      || !isDeepStrictEqual([...ownKeys].sort(), expectedKeys.sort())) reject();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = {};
    for (const field of AUTHENTICATED_SOURCE_READERS_CONTEXT_FIELDS) {
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
    validateSourceAuthorityAdapterSignal(snapshot.signal);
    validateSourceAuthorityAdapterOperationCapability(snapshot.operation_capability);
    return Object.freeze({
      source,
      browser: snapshot.browser,
      case_id: snapshot.case_id,
      kind: snapshot.kind,
      signal: snapshot.signal,
      operation_capability: snapshot.operation_capability,
    });
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function createSourceAuthorityAdapterReadDescriptor(context, signal) {
  validateSourceAuthorityAdapterSignal(signal);
  const descriptor = Object.create(null);
  for (const [key, value] of [
    ['source', context.source],
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
      throw new StagingBrowserRelaySourceAuthorityAdapterError();
    },
  });
  return Object.freeze(descriptor);
}

export function validateSourceAuthorityAdapterObservation(value, context) {
  try {
    return validateAuthenticatedSourceReaderObservation(
      value,
      Object.freeze({ source: context.source, browser: context.browser }),
      context.kind,
    );
  } catch {
    return reject();
  }
}

export function sourceAuthorityAdaptersDependencyContractsSha256() {
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
    'adapter',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ]);
  exact(profile, expectedProfile);
  exact(profile.schema, 'miakapp.staging-browser-relay-source-authority-adapters-profile/1');
  exact(profile.revision, 1);
  exact(
    profile.state,
    'closed_concrete_source_authority_adapters_ephemeral_sessions_implemented_not_sourced_not_wired_not_executed',
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
    implementation_base_commit: SOURCE_AUTHORITY_ADAPTERS_IMPLEMENTATION_BASE_COMMIT,
    authenticated_source_readers_profile_sha256: AUTHENTICATED_SOURCE_READERS_PROFILE_SHA256,
    dependency_contracts_sha256: SOURCE_AUTHORITY_ADAPTERS_DEPENDENCY_CONTRACTS_SHA256,
    internal_source_sha256: SOURCE_AUTHORITY_ADAPTERS_INTERNAL_SOURCE_SHA256,
    production_source_sha256: SOURCE_AUTHORITY_ADAPTERS_PRODUCTION_SOURCE_SHA256,
    testing_source_sha256: SOURCE_AUTHORITY_ADAPTERS_TESTING_SOURCE_SHA256,
    guard_source_sha256: SOURCE_AUTHORITY_ADAPTERS_GUARD_SOURCE_SHA256,
    unit_test_sha256: SOURCE_AUTHORITY_ADAPTERS_UNIT_TEST_SHA256,
    workflow_sha256: SOURCE_AUTHORITY_ADAPTERS_WORKFLOW_SHA256,
  });
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) reject();
  exact(profile.adapter, {
    source_order: SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER,
    authority_methods_by_source: SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE,
    scopes_by_source: SOURCE_AUTHORITY_ADAPTERS_SCOPES_BY_SOURCE,
    options_fields: SOURCE_AUTHORITY_ADAPTERS_OPTIONS_FIELDS,
    session_fields: SOURCE_AUTHORITY_ADAPTERS_SESSION_FIELDS,
    read_descriptor_fields: SOURCE_AUTHORITY_ADAPTERS_READ_DESCRIPTOR_FIELDS,
    stage_count: SOURCE_AUTHORITY_ADAPTERS_STAGE_COUNT,
    observations_per_matrix: SOURCE_AUTHORITY_ADAPTERS_OBSERVATIONS_PER_MATRIX,
    distinct_kind_count: SOURCE_AUTHORITY_ADAPTERS_DISTINCT_KIND_COUNT,
    maximum_session_lifetime_milliseconds:
      SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
    maximum_read_milliseconds: SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS,
    maximum_close_milliseconds: SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_CLOSE_MILLISECONDS,
    expiry_is_absolute_unix_epoch_milliseconds: true,
    explicit_source_sessions: true,
    source_scope_exact: true,
    session_identity_single_operation: true,
    operation_capability_identity_bound: true,
    authority_surface_exact: true,
    context_order_revalidated: true,
    source_calls_ordered_nonoverlapping: true,
    call_reserved_before_await: true,
    read_descriptor_attenuated: true,
    operation_capability_omitted_from_read_descriptor: true,
    abort_checked_before_and_after_call: true,
    expiry_checked_before_and_after_call: true,
    abort_and_expiry_rechecked_at_dispatch: true,
    bounded_read_and_close_wrapper_settlement: true,
    caller_abort_reason_sanitized: true,
    callback_close_reentrancy_rejected: true,
    shared_poison_permanent: true,
    session_close_deadline_signal_bounded: true,
    close_cleanup_independent_of_operation_cancellation: true,
    session_close_invoked_at_most_once: true,
    terminal_started_callbacks_settled: true,
    terminal_adapter_session_references_cleared: true,
    testing_session_release_probe_present: true,
    production_runtime_intrinsic: true,
  });
  exact(profile.compatibility, {
    authenticated_source_readers_compatible: true,
    independent_observation_validation_present: true,
    concrete_source_authority_adapters_present: true,
    explicit_ephemeral_source_sessions_present: true,
    complete_source_count: SOURCE_AUTHORITY_ADAPTERS_SOURCE_ORDER.length,
    complete_stage_count: SOURCE_AUTHORITY_ADAPTERS_STAGE_COUNT,
    complete_observation_capacity: SOURCE_AUTHORITY_ADAPTERS_OBSERVATIONS_PER_MATRIX,
    source_session_producers_present: false,
    network_implementation_present: false,
    operation_case_adapter_wired: false,
    trusted_live_page_providers_present: false,
    dedicated_process_ipc_present: false,
    uncooperative_same_process_session_forced_termination: false,
  });
  exact(profile.output, {
    authority_fields: SOURCE_AUTHORITY_ADAPTERS_AUTHORITY_METHODS_BY_SOURCE,
    submitted_fields: ['observation'],
    semantic_validation_before_output: true,
    raw_source_material_accepted: false,
    raw_source_material_retained: false,
    session_references_exposed: false,
    operation_capability_exposed: false,
    arbitrary_errors_propagated: false,
  });
  if (Object.values(profile.authority).some((entry) => entry !== false)) reject();
  exact(profile.evidence, {
    state: 'absent',
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

export function validateBrowserRelaySourceAuthorityAdaptersProfile(rootValue) {
  try {
    const root = profileRoot(rootValue);
    exact(
      sourceAuthorityAdaptersDependencyContractsSha256(),
      SOURCE_AUTHORITY_ADAPTERS_DEPENDENCY_CONTRACTS_SHA256,
    );
    validateBrowserRelayAuthenticatedSourceReadersProfile();
    reviewedContractFile(new URL('contract.mjs', root));
    for (const [name, maximumBytes, digest] of [
      ['profile.json', MAXIMUM_PROFILE_BYTES, SOURCE_AUTHORITY_ADAPTERS_PROFILE_SHA256],
      ['internal.mjs', 48 * 1024, SOURCE_AUTHORITY_ADAPTERS_INTERNAL_SOURCE_SHA256],
      ['adapters.mjs', 8 * 1024, SOURCE_AUTHORITY_ADAPTERS_PRODUCTION_SOURCE_SHA256],
      ['testing.mjs', 8 * 1024, SOURCE_AUTHORITY_ADAPTERS_TESTING_SOURCE_SHA256],
      ['guard.mjs', 20 * 1024, SOURCE_AUTHORITY_ADAPTERS_GUARD_SOURCE_SHA256],
    ]) regularPinnedFile(new URL(name, root), maximumBytes, digest);
    for (const [path, maximumBytes, digest] of [
      [unitTestPath, 160 * 1024, SOURCE_AUTHORITY_ADAPTERS_UNIT_TEST_SHA256],
      [workflowPath, 8 * 1024, SOURCE_AUTHORITY_ADAPTERS_WORKFLOW_SHA256],
    ]) regularPinnedFile(path, maximumBytes, digest);
    return validateProfileValue(JSON.parse(readFileSync(new URL('profile.json', root), 'utf8')));
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}
