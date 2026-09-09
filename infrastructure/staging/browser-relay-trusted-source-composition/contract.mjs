import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual, types } from 'node:util';

import {
  AUTHENTICATED_SOURCE_READERS_PROFILE_SHA256,
  validateBrowserRelayAuthenticatedSourceReadersProfile,
} from '../browser-relay-authenticated-source-readers/contract.mjs';
import {
  OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS,
  OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS,
  OPERATION_CASE_ADAPTER_PROFILE_SHA256,
  validateBrowserRelayOperationCaseAdapterProfile,
} from '../browser-relay-operation-case-adapter/contract.mjs';
import {
  SOURCE_AUTHORITY_ADAPTERS_PROFILE_SHA256,
  validateBrowserRelaySourceAuthorityAdaptersProfile,
} from '../browser-relay-source-authority-adapters/contract.mjs';
import {
  SOURCE_CLIENTS_ACQUIRE_DESCRIPTOR_FIELDS,
  SOURCE_CLIENTS_CALLS_BY_SOURCE,
  SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
  SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX,
  SOURCE_CLIENTS_PROFILE_SHA256,
  SOURCE_CLIENTS_RECEIPT_FIELDS,
  SOURCE_CLIENTS_SCOPES_BY_SOURCE,
  SOURCE_CLIENTS_SOURCE_ORDER,
  SOURCE_CLIENTS_STAGE_COUNT,
  SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND,
  validateBrowserRelaySourceClientsProfile,
  validateSourceClientSignal,
} from '../browser-relay-source-clients/contract.mjs';
import {
  SOURCE_SESSION_PRODUCERS_PROFILE_SHA256,
  validateBrowserRelaySourceSessionProducersProfile,
  validateSourceSessionProducerObservation,
} from '../browser-relay-source-session-producers/contract.mjs';
import {
  SOURCE_TRANSPORTS_PROFILE_SHA256,
  validateBrowserRelaySourceTransportsProfile,
} from '../browser-relay-source-transports/contract.mjs';

export const TRUSTED_SOURCE_COMPOSITION_PROFILE_PATH =
  'browser-relay-trusted-source-composition/profile.json';
export const TRUSTED_SOURCE_COMPOSITION_PROFILE_SHA256 =
  '29dc0e2a0f198351cd6712e4f84edd3b3ab1a444cbb21bd323a5f3f6a55c7cba';
export const TRUSTED_SOURCE_COMPOSITION_IMPLEMENTATION_BASE_COMMIT =
  'e2c3a5e64eff05571f92962fe4df924b581bca57';
export const TRUSTED_SOURCE_COMPOSITION_DEPENDENCY_CONTRACTS_SHA256 =
  '6128f50aa77ec8d708d019d1cb6e85d41c94fac8791546bcb040e2fe46bf51bc';
export const TRUSTED_SOURCE_COMPOSITION_INTERNAL_SOURCE_SHA256 =
  '4737be64f66867cf00dee18be189ffac06a60ab8b5c78bc5b50426ffee85a24f';
export const TRUSTED_SOURCE_COMPOSITION_PRODUCTION_SOURCE_SHA256 =
  'fb9db75bc25c732bad51bb8b39b3350ae35829ebf5bd560f19990fcb915e44ce';
export const TRUSTED_SOURCE_COMPOSITION_TESTING_SOURCE_SHA256 =
  'f5d5fb1bc398246c404a02c4b3f84082197bf33c21a1e5b870d47dc320aa4e60';
export const TRUSTED_SOURCE_COMPOSITION_GUARD_SOURCE_SHA256 =
  '3425afe1adcaefcdaa67fb651291c8a840b38bcdfb67d9926532e19503025420';
export const TRUSTED_SOURCE_COMPOSITION_UNIT_TEST_SHA256 =
  'cf5cffb6ffa0d0ff3db6942cde56c1759006e057e0259cd0ed85562a906a17f9';
export const TRUSTED_SOURCE_COMPOSITION_WORKFLOW_SHA256 =
  'ae3ec22c2a6247ace69cb7e74352b6e5b5947355bc80a8e4de9d280ec3f0365f';

export const TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER = SOURCE_CLIENTS_SOURCE_ORDER;
export const TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE = SOURCE_CLIENTS_SCOPES_BY_SOURCE;
export const TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE = SOURCE_CLIENTS_CALLS_BY_SOURCE;
export const TRUSTED_SOURCE_COMPOSITION_TARGETS_BY_SOURCE_AND_KIND =
  SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND;
export const TRUSTED_SOURCE_COMPOSITION_STAGE_COUNT = SOURCE_CLIENTS_STAGE_COUNT;
export const TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX =
  SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX;
export const TRUSTED_SOURCE_COMPOSITION_MAXIMUM_PROVIDER_LIFETIME_MILLISECONDS =
  SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS;
export const TRUSTED_SOURCE_COMPOSITION_PROVIDER_CONTEXT_FIELDS = Object.freeze([
  'browser',
  'case_id',
  'signal',
]);
export const TRUSTED_SOURCE_COMPOSITION_ROOT_FIELDS = Object.freeze([
  'providers',
  'operation',
  'matrix',
]);
export const TRUSTED_SOURCE_COMPOSITION_OPTIONS_FIELDS = Object.freeze(['signal']);
export const TRUSTED_SOURCE_COMPOSITION_OUTPUT_FIELDS = Object.freeze(['execute', 'close']);
export const TRUSTED_SOURCE_COMPOSITION_MATRIX_COMPONENT_FIELDS = Object.freeze(
  OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS.filter((field) => field !== 'sourceObservers'),
);
export const TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE = Object.freeze(
  Object.fromEntries(TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => [
    source,
    Object.freeze(SOURCE_CLIENTS_CALLS_BY_SOURCE[source].reduce((methods, call) => {
      if (!methods.includes(call.kind)) methods.push(call.kind);
      return methods;
    }, [])),
  ])),
);
export const TRUSTED_SOURCE_COMPOSITION_PROVIDER_FIELDS_BY_SOURCE = Object.freeze(
  Object.fromEntries(TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => [
    source,
    Object.freeze([
      'source',
      'scope',
      'expires_at_milliseconds',
      ...TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE[source],
      'close',
    ]),
  ])),
);
export const TRUSTED_SOURCE_COMPOSITION_RUNTIME_FIELDS = Object.freeze([
  'clock',
  'create_source_clients',
  'create_source_sessions',
  'create_authority_adapters',
  'create_authenticated_readers',
  'create_source_transports',
  'run_operation_case',
  'provider_released',
]);

const expectedProfile = JSON.parse(readFileSync(new URL('profile.json', import.meta.url), 'utf8'));
const packageRootUrl = new URL('./', import.meta.url);
const contractPath = new URL('contract.mjs', import.meta.url);
const unitTestPath = new URL(
  '../test/browser-relay-trusted-source-composition.test.mjs',
  import.meta.url,
);
const workflowPath = new URL(
  '../../../.github/workflows/browser-relay-trusted-source-composition.yml',
  import.meta.url,
);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-authenticated-source-readers/contract.mjs',
  '../browser-relay-operation-case-adapter/contract.mjs',
  '../browser-relay-source-authority-adapters/contract.mjs',
  '../browser-relay-source-clients/contract.mjs',
  '../browser-relay-source-session-producers/contract.mjs',
  '../browser-relay-source-transports/contract.mjs',
].sort());
const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const INTRINSIC_IS_PROXY = types.isProxy.bind(types);

export class StagingBrowserRelayTrustedSourceCompositionError extends Error {
  constructor() {
    super('Staging browser-relay trusted source composition failed closed');
    this.name = 'StagingBrowserRelayTrustedSourceCompositionError';
  }
}

function reject() {
  throw new StagingBrowserRelayTrustedSourceCompositionError();
}

function compositionError(error) {
  try {
    return error instanceof StagingBrowserRelayTrustedSourceCompositionError;
  } catch {
    return false;
  }
}

function plainObject(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || INTRINSIC_IS_PROXY(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function directRecord(value, fields, requireFrozen = false) {
  if (!plainObject(value) || (requireFrozen && !Object.isFrozen(value))) reject();
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return reject();
  }
  if (keys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual([...keys].sort(), [...fields].sort())) reject();
  const snapshot = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || !descriptor.enumerable) reject();
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function protocolRecord(value, fields) {
  if (!plainObject(value) || !Object.isFrozen(value)
    || Object.getPrototypeOf(value) !== null) reject();
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return reject();
  }
  if (keys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual([...keys].sort(), [...fields, 'toJSON'].sort())) reject();
  const snapshot = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || !descriptor.enumerable || descriptor.configurable || descriptor.writable) reject();
    snapshot[field] = descriptor.value;
  }
  const serializer = descriptors.toJSON;
  if (serializer === undefined || !Object.hasOwn(serializer, 'value')
    || serializer.enumerable || serializer.configurable || serializer.writable
    || typeof serializer.value !== 'function') reject();
  return snapshot;
}

function exact(value, expected) {
  if (!isDeepStrictEqual(value, expected)) reject();
}

function opaqueCapability(value) {
  try {
    if (typeof value !== 'function' || !Object.isFrozen(value)
      || Object.getPrototypeOf(value) !== null) reject();
    return value;
  } catch (error) {
    if (compositionError(error)) throw error;
    return reject();
  }
}

function capturedMethods(value, fields, receiver = value) {
  const result = {};
  for (const field of fields) {
    const candidate = value[field];
    if (typeof candidate !== 'function') reject();
    result[field] = (...args) => Reflect.apply(candidate, receiver, args);
  }
  return Object.freeze(result);
}

function capturedComponents(identity, snapshot, fields, passthrough) {
  const result = {};
  for (const field of fields) {
    if (passthrough.includes(field)) {
      result[field] = snapshot[field];
      continue;
    }
    const candidate = snapshot[field];
    if (typeof candidate !== 'function') reject();
    result[field] = (...args) => Reflect.apply(candidate, identity, args);
  }
  return Object.freeze(result);
}

export function validateTrustedSourceCompositionInputs(rootValue, optionsValue, nowValue) {
  try {
    if (!Number.isSafeInteger(nowValue) || nowValue < 0) reject();
    const root = directRecord(rootValue, TRUSTED_SOURCE_COMPOSITION_ROOT_FIELDS);
    const options = directRecord(optionsValue, TRUSTED_SOURCE_COMPOSITION_OPTIONS_FIELDS);
    const signal = validateSourceClientSignal(options.signal);
    const providerMap = directRecord(
      root.providers,
      TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER,
      true,
    );
    const firstSource = TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER[0];
    const first = directRecord(
      providerMap[firstSource],
      TRUSTED_SOURCE_COMPOSITION_PROVIDER_FIELDS_BY_SOURCE[firstSource],
      true,
    );
    const expiresAt = first.expires_at_milliseconds;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowValue
      || expiresAt > nowValue + TRUSTED_SOURCE_COMPOSITION_MAXIMUM_PROVIDER_LIFETIME_MILLISECONDS) {
      reject();
    }
    const identities = new Set();
    const providers = Object.fromEntries(TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.map((source) => {
      const identity = providerMap[source];
      const fields = TRUSTED_SOURCE_COMPOSITION_PROVIDER_FIELDS_BY_SOURCE[source];
      const snapshot = directRecord(identity, fields, true);
      exact(snapshot.source, source);
      if (snapshot.scope !== TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE[source]) reject();
      exact(snapshot.expires_at_milliseconds, expiresAt);
      if (identities.has(identity)) reject();
      identities.add(identity);
      return [source, Object.freeze({
        identity,
        methods: capturedMethods(snapshot, [
          ...TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE[source],
          'close',
        ], identity),
      })];
    }));
    const operationSnapshot = directRecord(
      root.operation,
      OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS,
    );
    const matrixSnapshot = directRecord(
      root.matrix,
      TRUSTED_SOURCE_COMPOSITION_MATRIX_COMPONENT_FIELDS,
    );
    return Object.freeze({
      providers: Object.freeze(providers),
      operation: capturedComponents(
        root.operation,
        operationSnapshot,
        OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS,
        ['edgeClient'],
      ),
      matrix: capturedComponents(
        root.matrix,
        matrixSnapshot,
        TRUSTED_SOURCE_COMPOSITION_MATRIX_COMPONENT_FIELDS,
        ['fixture', 'browserLifecycle'],
      ),
      signal,
      expires_at_milliseconds: expiresAt,
    });
  } catch (error) {
    if (compositionError(error)) throw error;
    return reject();
  }
}

export function validateTrustedSourceCompositionRuntime(value) {
  try {
    const snapshot = directRecord(value, TRUSTED_SOURCE_COMPOSITION_RUNTIME_FIELDS);
    return capturedMethods(snapshot, TRUSTED_SOURCE_COMPOSITION_RUNTIME_FIELDS, value);
  } catch (error) {
    if (compositionError(error)) throw error;
    return reject();
  }
}

export function validateTrustedSourceAcquireDescriptor(value, source, cursor) {
  try {
    if (!TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.includes(source)
      || !Number.isSafeInteger(cursor) || cursor < 0) reject();
    const expected = TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE[source]?.[cursor];
    if (expected === undefined) reject();
    const snapshot = protocolRecord(value, SOURCE_CLIENTS_ACQUIRE_DESCRIPTOR_FIELDS);
    exact(snapshot.source, source);
    if (snapshot.scope !== TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE[source]) reject();
    exact(snapshot.browser, expected.browser);
    exact(snapshot.case_id, expected.case_id);
    exact(snapshot.kind, expected.kind);
    if (snapshot.target !== TRUSTED_SOURCE_COMPOSITION_TARGETS_BY_SOURCE_AND_KIND[
      source
    ][expected.kind]) reject();
    validateSourceClientSignal(snapshot.signal);
    opaqueCapability(snapshot.request_capability);
    return Object.freeze({
      source,
      scope: snapshot.scope,
      browser: snapshot.browser,
      case_id: snapshot.case_id,
      kind: snapshot.kind,
      target: snapshot.target,
      signal: snapshot.signal,
      request_capability: snapshot.request_capability,
    });
  } catch (error) {
    if (compositionError(error)) throw error;
    return reject();
  }
}

function nonSerializableRecord(entries) {
  const record = Object.create(null);
  for (const [field, value] of entries) {
    Object.defineProperty(record, field, {
      configurable: false,
      enumerable: true,
      writable: false,
      value,
    });
  }
  Object.defineProperty(record, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() { reject(); },
  });
  return Object.freeze(record);
}

export function createTrustedSourceProviderContext(context) {
  try {
    return nonSerializableRecord([
      ['browser', context.browser],
      ['case_id', context.case_id],
      ['signal', validateSourceClientSignal(context.signal)],
    ]);
  } catch (error) {
    if (compositionError(error)) throw error;
    return reject();
  }
}

export function createTrustedSourceReceipt(context, observationValue) {
  try {
    const observation = validateSourceSessionProducerObservation(observationValue, context);
    return nonSerializableRecord([
      ['source', context.source],
      ['scope', context.scope],
      ['browser', context.browser],
      ['case_id', context.case_id],
      ['kind', context.kind],
      ['target', context.target],
      ['request_capability', context.request_capability],
      ['observation', observation],
    ]);
  } catch (error) {
    if (compositionError(error)) throw error;
    return reject();
  }
}

export function trustedSourceCompositionDependencyContractsSha256() {
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
    || candidate.size === 0 || candidate.size > 72 * 1024
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
    if (compositionError(error)) throw error;
    return reject();
  }
}

function validateProfileValue(value) {
  const profile = directRecord(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'composition',
    'providers',
    'lifecycle',
    'compatibility',
    'authority',
    'evidence',
  ]);
  exact(profile, expectedProfile);
  exact(profile.schema, 'miakapp.staging-browser-relay-trusted-source-composition-profile/1');
  exact(profile.revision, 1);
  exact(profile.target, {
    project_id: 'miakapp-v4-staging',
    project_number: '1072737219170',
    region: 'europe-west9',
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  });
  exact(profile.pins, {
    implementation_base_commit: TRUSTED_SOURCE_COMPOSITION_IMPLEMENTATION_BASE_COMMIT,
    source_clients_profile_sha256: SOURCE_CLIENTS_PROFILE_SHA256,
    source_session_producers_profile_sha256: SOURCE_SESSION_PRODUCERS_PROFILE_SHA256,
    source_authority_adapters_profile_sha256: SOURCE_AUTHORITY_ADAPTERS_PROFILE_SHA256,
    authenticated_source_readers_profile_sha256: AUTHENTICATED_SOURCE_READERS_PROFILE_SHA256,
    source_transports_profile_sha256: SOURCE_TRANSPORTS_PROFILE_SHA256,
    operation_case_adapter_profile_sha256: OPERATION_CASE_ADAPTER_PROFILE_SHA256,
    dependency_contracts_sha256: TRUSTED_SOURCE_COMPOSITION_DEPENDENCY_CONTRACTS_SHA256,
    internal_source_sha256: TRUSTED_SOURCE_COMPOSITION_INTERNAL_SOURCE_SHA256,
    production_source_sha256: TRUSTED_SOURCE_COMPOSITION_PRODUCTION_SOURCE_SHA256,
    testing_source_sha256: TRUSTED_SOURCE_COMPOSITION_TESTING_SOURCE_SHA256,
    guard_source_sha256: TRUSTED_SOURCE_COMPOSITION_GUARD_SOURCE_SHA256,
    unit_test_sha256: TRUSTED_SOURCE_COMPOSITION_UNIT_TEST_SHA256,
    workflow_sha256: TRUSTED_SOURCE_COMPOSITION_WORKFLOW_SHA256,
  });
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([field, digest]) => (
      field.endsWith('_sha256') && !SHA256.test(digest)
    ))) reject();
  exact(profile.composition.root_fields, TRUSTED_SOURCE_COMPOSITION_ROOT_FIELDS);
  exact(profile.composition.matrix_component_fields,
    TRUSTED_SOURCE_COMPOSITION_MATRIX_COMPONENT_FIELDS);
  exact(profile.composition.options_fields, TRUSTED_SOURCE_COMPOSITION_OPTIONS_FIELDS);
  exact(profile.composition.output_fields, TRUSTED_SOURCE_COMPOSITION_OUTPUT_FIELDS);
  exact(profile.composition.stage_count, TRUSTED_SOURCE_COMPOSITION_STAGE_COUNT);
  exact(profile.composition.observations_per_matrix,
    TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX);
  exact(profile.providers.source_order, TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER);
  exact(profile.providers.scopes_by_source, TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE);
  exact(profile.providers.methods_by_source,
    TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE);
  exact(profile.providers.context_fields, TRUSTED_SOURCE_COMPOSITION_PROVIDER_CONTEXT_FIELDS);
  exact(profile.providers.maximum_lifetime_milliseconds,
    TRUSTED_SOURCE_COMPOSITION_MAXIMUM_PROVIDER_LIFETIME_MILLISECONDS);
  if (Object.values(profile.providers.invariants).some((entry) => entry !== true)
    || Object.values(profile.lifecycle.invariants).some((entry) => entry !== true)) reject();
  exact(profile.lifecycle.strategy, 'differential_conformance');
  exact(profile.compatibility, {
    fixed_target_source_clients_composed: true,
    source_sessions_composed: true,
    source_authority_adapters_composed: true,
    authenticated_source_readers_composed: true,
    source_transports_composed: true,
    operation_case_adapter_wired: true,
    named_trusted_live_provider_capabilities_present: true,
    built_in_live_source_implementations_present: false,
    trusted_live_browser_providers_present: false,
    dedicated_process_ipc_present: false,
    hosting_publication_wired: false,
    live_operation_wired: false,
  });
  exact(profile.authority, {
    explicit_ephemeral_provider_capabilities_accepted: true,
    fixed_staging_targets_authorized: true,
    ambient_credentials_authorized: false,
    credential_bytes_accepted: false,
    arbitrary_targets_authorized: false,
    direct_network_implementation_authorized: false,
    cloud_mutations_authorized: false,
    live_execution_authorized: false,
    public_ingress_changes_authorized: false,
  });
  exact(profile.evidence, {
    state: 'offline_only',
    offline_composed_matrices: 1,
    offline_differential_conformance_runs: 1,
    complete_source_count: TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER.length,
    complete_stage_count: TRUSTED_SOURCE_COMPOSITION_STAGE_COUNT,
    complete_observation_count: TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX,
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

export function validateBrowserRelayTrustedSourceCompositionProfile(rootValue) {
  try {
    const root = profileRoot(rootValue);
    exact(
      trustedSourceCompositionDependencyContractsSha256(),
      TRUSTED_SOURCE_COMPOSITION_DEPENDENCY_CONTRACTS_SHA256,
    );
    validateBrowserRelaySourceClientsProfile();
    validateBrowserRelaySourceSessionProducersProfile();
    validateBrowserRelaySourceAuthorityAdaptersProfile();
    validateBrowserRelayAuthenticatedSourceReadersProfile();
    validateBrowserRelaySourceTransportsProfile();
    validateBrowserRelayOperationCaseAdapterProfile();
    reviewedContractFile(new URL('contract.mjs', root));
    for (const [name, maximumBytes, digest] of [
      ['profile.json', MAXIMUM_PROFILE_BYTES, TRUSTED_SOURCE_COMPOSITION_PROFILE_SHA256],
      ['internal.mjs', 48 * 1024, TRUSTED_SOURCE_COMPOSITION_INTERNAL_SOURCE_SHA256],
      ['composition.mjs', 8 * 1024, TRUSTED_SOURCE_COMPOSITION_PRODUCTION_SOURCE_SHA256],
      ['testing.mjs', 8 * 1024, TRUSTED_SOURCE_COMPOSITION_TESTING_SOURCE_SHA256],
      ['guard.mjs', 24 * 1024, TRUSTED_SOURCE_COMPOSITION_GUARD_SOURCE_SHA256],
    ]) regularPinnedFile(new URL(name, root), maximumBytes, digest);
    for (const [path, maximumBytes, digest] of [
      [unitTestPath, 192 * 1024, TRUSTED_SOURCE_COMPOSITION_UNIT_TEST_SHA256],
      [workflowPath, 12 * 1024, TRUSTED_SOURCE_COMPOSITION_WORKFLOW_SHA256],
    ]) regularPinnedFile(path, maximumBytes, digest);
    return validateProfileValue(JSON.parse(readFileSync(new URL('profile.json', root), 'utf8')));
  } catch (error) {
    if (compositionError(error)) throw error;
    return reject();
  }
}
