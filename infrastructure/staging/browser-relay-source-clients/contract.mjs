import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual, types } from 'node:util';

import {
  SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE,
  SOURCE_SESSION_PRODUCERS_CLIENT_DESCRIPTOR_FIELDS,
  SOURCE_SESSION_PRODUCERS_CLIENT_FIELDS,
  SOURCE_SESSION_PRODUCERS_DISTINCT_KIND_COUNT,
  SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS,
  SOURCE_SESSION_PRODUCERS_OBSERVATIONS_PER_MATRIX,
  SOURCE_SESSION_PRODUCERS_PROFILE_SHA256,
  SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE,
  SOURCE_SESSION_PRODUCERS_SOURCE_ORDER,
  SOURCE_SESSION_PRODUCERS_STAGE_COUNT,
  validateBrowserRelaySourceSessionProducersProfile,
  validateSourceSessionProducerObservation,
  validateSourceSessionProducerSignal,
} from '../browser-relay-source-session-producers/contract.mjs';

export const SOURCE_CLIENTS_PROFILE_PATH = 'browser-relay-source-clients/profile.json';
export const SOURCE_CLIENTS_PROFILE_SHA256 =
  '75357c6dc8b863d08a6c131edbd1222e389c20882fda5a574b5581e840b15724';
export const SOURCE_CLIENTS_IMPLEMENTATION_BASE_COMMIT =
  '19cdde9c5fd24f14b5eab8b32d61b2e044c6c610';
export const SOURCE_CLIENTS_DEPENDENCY_CONTRACTS_SHA256 =
  'e4e49bf4d49ee96f6ed48b719cb62eea157c328229e110cd36baaaf3d8119725';
export const SOURCE_CLIENTS_INTERNAL_SOURCE_SHA256 =
  'c1f5c982950b3e21a5b7ffa6e1c655e9040fdadbb630e9ea9ad63997d113de34';
export const SOURCE_CLIENTS_PRODUCTION_SOURCE_SHA256 =
  '55e21c6453d95db2a6ef9ae2db24c0fb0c8d8056358adddb28ffd3c19feb3f78';
export const SOURCE_CLIENTS_TESTING_SOURCE_SHA256 =
  '667ea27a2bae3748c130e2de948d6af6e67cad548a0e589d774d82bada40f45b';
export const SOURCE_CLIENTS_GUARD_SOURCE_SHA256 =
  '1d5e2d537d12220ca019d3126ce228667990d7aa6fe5f84fc21a90ed787fde03';
export const SOURCE_CLIENTS_UNIT_TEST_SHA256 =
  '94da9f600c9f073fa6c4abbbfff31e6977ea423659b8895443fda5e4ef086a43';
export const SOURCE_CLIENTS_WORKFLOW_SHA256 =
  '4df1150c7084392be70bea17cf9118576e042692b68793be4c355fda1ac41899';

export const SOURCE_CLIENTS_SOURCE_ORDER = SOURCE_SESSION_PRODUCERS_SOURCE_ORDER;
export const SOURCE_CLIENTS_SCOPES_BY_SOURCE = SOURCE_SESSION_PRODUCERS_SCOPES_BY_SOURCE;
export const SOURCE_CLIENTS_CALLS_BY_SOURCE = SOURCE_SESSION_PRODUCERS_CALLS_BY_SOURCE;
export const SOURCE_CLIENTS_STAGE_COUNT = SOURCE_SESSION_PRODUCERS_STAGE_COUNT;
export const SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX =
  SOURCE_SESSION_PRODUCERS_OBSERVATIONS_PER_MATRIX;
export const SOURCE_CLIENTS_DISTINCT_KIND_COUNT = SOURCE_SESSION_PRODUCERS_DISTINCT_KIND_COUNT;
export const SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS =
  SOURCE_SESSION_PRODUCERS_MAXIMUM_SESSION_LIFETIME_MILLISECONDS;
export const SOURCE_CLIENTS_CLIENT_FIELDS = SOURCE_SESSION_PRODUCERS_CLIENT_FIELDS;
export const SOURCE_CLIENTS_CLIENT_DESCRIPTOR_FIELDS =
  SOURCE_SESSION_PRODUCERS_CLIENT_DESCRIPTOR_FIELDS;
export const SOURCE_CLIENTS_AUTHORITY_FIELDS = Object.freeze([
  'source',
  'scope',
  'expires_at_milliseconds',
  'acquire',
  'close',
]);
export const SOURCE_CLIENTS_OPTIONS_FIELDS = Object.freeze(['signal']);
export const SOURCE_CLIENTS_ACQUIRE_DESCRIPTOR_FIELDS = Object.freeze([
  'source',
  'scope',
  'browser',
  'case_id',
  'kind',
  'target',
  'signal',
  'request_capability',
]);
export const SOURCE_CLIENTS_RECEIPT_FIELDS = Object.freeze([
  'source',
  'scope',
  'browser',
  'case_id',
  'kind',
  'target',
  'request_capability',
  'observation',
]);
export const SOURCE_CLIENTS_RUNTIME_FIELDS = Object.freeze([
  'clock',
  'set_timer',
  'clear_timer',
  'authority_released',
]);

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

const TARGETS = {
  firebase_app_check: {
    provider_assessment: {
      authority: 'browser_app_check_provider',
      resource: 'operation_ledger.firebase_app_check.provider_assessment',
    },
    valid_verification: {
      authority: 'firebase_admin_app_check_verifier',
      resource: 'operation_ledger.firebase_app_check.non_consuming_verification',
    },
    missing_token_denial: {
      authority: 'control_plane_app_check_verifier',
      resource: 'operation_ledger.firebase_app_check.missing_token_denial',
    },
    invalid_token_denial: {
      authority: 'control_plane_app_check_verifier',
      resource: 'operation_ledger.firebase_app_check.invalid_token_denial',
    },
    verification_mode: {
      authority: 'firebase_admin_app_check_verifier',
      resource: 'operation_ledger.firebase_app_check.verification_mode',
    },
  },
  hosting: {
    management_site_configuration: {
      authority: 'firebase_hosting_management',
      resource: 'projects/miakapp-v4-staging/sites/miakapp-v4-staging',
    },
    served_sdk_configuration: {
      authority: 'firebase_hosting_serving',
      resource: 'https://miakapp-v4-staging.web.app/__/firebase/init.json',
    },
  },
  control_plane: {
    cors_preflight: {
      authority: 'control_plane_https',
      resource: 'https://control-plane-aczhngqraq-od.a.run.app/v1/user-relay-tokens:exchange#cors-preflight',
    },
    foreign_origin_denial: {
      authority: 'control_plane_https',
      resource: 'https://control-plane-aczhngqraq-od.a.run.app/v1/user-relay-tokens:exchange#foreign-origin-denial',
    },
    source_uid_admission: {
      authority: 'control_plane_operation_ledger',
      resource: 'operation_ledger.control_plane.source_uid_admission',
    },
    authenticated_cache_policy: {
      authority: 'control_plane_operation_ledger',
      resource: 'operation_ledger.control_plane.authenticated_cache_policy',
    },
    version_2_jwk_published: {
      authority: 'control_plane_rotation_ledger',
      resource: 'https://control-plane-aczhngqraq-od.a.run.app/.well-known/jwks.json#version-2-prepublished',
    },
    version_1_last_issuance: {
      authority: 'control_plane_rotation_ledger',
      resource: 'operation_ledger.control_plane.version_1_last_issuance',
    },
    version_2_first_issuance: {
      authority: 'control_plane_rotation_ledger',
      resource: 'operation_ledger.control_plane.version_2_first_issuance',
    },
    atomic_credential_reuse: {
      authority: 'control_plane_operation_ledger',
      resource: 'operation_ledger.control_plane.atomic_credential_reuse',
    },
    version_1_jwk_retained: {
      authority: 'control_plane_rotation_ledger',
      resource: 'https://control-plane-aczhngqraq-od.a.run.app/.well-known/jwks.json#version-1-retained',
    },
    version_1_jwk_removed: {
      authority: 'control_plane_rotation_ledger',
      resource: 'https://control-plane-aczhngqraq-od.a.run.app/.well-known/jwks.json#version-1-removed',
    },
    exchange_summary: {
      authority: 'control_plane_operation_ledger',
      resource: 'operation_ledger.control_plane.exchange_summary',
    },
  },
  relay: {
    version_2_existing_socket: {
      authority: 'relay_protocol_ledger',
      resource: 'operation_ledger.relay.version_2_existing_socket',
    },
    version_2_session: {
      authority: 'relay_protocol_ledger',
      resource: 'operation_ledger.relay.version_2_session',
    },
    wrong_audience_denial: {
      authority: 'relay_protocol_ledger',
      resource: 'operation_ledger.relay.wrong_audience_denial',
    },
    wrong_home_denial: {
      authority: 'relay_protocol_ledger',
      resource: 'operation_ledger.relay.wrong_home_denial',
    },
    wrong_role_denial: {
      authority: 'relay_protocol_ledger',
      resource: 'operation_ledger.relay.wrong_role_denial',
    },
    unknown_kid_refresh: {
      authority: 'relay_protocol_ledger',
      resource: 'operation_ledger.relay.unknown_kid_refresh',
    },
    disconnect_reconnect_resync: {
      authority: 'relay_protocol_ledger',
      resource: 'operation_ledger.relay.disconnect_reconnect_resync',
    },
    new_session_version_2: {
      authority: 'relay_protocol_ledger',
      resource: 'operation_ledger.relay.new_session_version_2',
    },
    revision_summary: {
      authority: 'relay_serving_revision_ledger',
      resource: 'operation_ledger.relay.serving_revision_summary',
    },
  },
  coordinator: {
    physical_call_delivery: {
      authority: 'coordinator_dispatch_ledger',
      resource: 'operation_ledger.coordinator.physical_call_delivery',
    },
  },
  kms: {
    signature_summary: {
      authority: 'kms_signer_ledger',
      resource: 'operation_ledger.kms.signature_summary',
    },
    version_1_lifecycle: {
      authority: 'cloud_kms_inventory',
      resource: 'projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing/cryptoKeyVersions/1',
    },
  },
  firestore: {
    authoritative_route_transition: {
      authority: 'firestore_strong_read_ledger',
      resource: 'operation_ledger.firestore.exact_synthetic_home_route_transition',
    },
    operation_write_summary: {
      authority: 'firestore_commit_ledger',
      resource: 'operation_ledger.firestore.operation_write_summary',
    },
  },
};

export const SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND = deepFreeze(TARGETS);

const expectedProfile = JSON.parse(readFileSync(new URL('profile.json', import.meta.url), 'utf8'));
const packageRootUrl = new URL('./', import.meta.url);
const contractPath = new URL('contract.mjs', import.meta.url);
const unitTestPath = new URL('../test/browser-relay-source-clients.test.mjs', import.meta.url);
const workflowPath = new URL('../../../.github/workflows/browser-relay-source-clients.yml', import.meta.url);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-source-session-producers/contract.mjs',
].sort());
const MAXIMUM_PROFILE_BYTES = 48 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const INTRINSIC_IS_PROXY = types.isProxy.bind(types);

export class StagingBrowserRelaySourceClientError extends Error {
  constructor() {
    super('Staging browser-relay source client failed closed');
    this.name = 'StagingBrowserRelaySourceClientError';
  }
}

function reject() {
  throw new StagingBrowserRelaySourceClientError();
}

function packageError(error) {
  try {
    return error instanceof StagingBrowserRelaySourceClientError;
  } catch {
    return false;
  }
}

function plainObject(value) {
  try {
    if (value === null || typeof value !== 'object' || INTRINSIC_IS_PROXY(value)
      || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactDataRecord(value, keys, requireFrozen = false) {
  if (!plainObject(value) || (requireFrozen && !Object.isFrozen(value))) reject();
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

function exactProtocolRecord(value, fields) {
  if (!plainObject(value) || !Object.isFrozen(value) || Object.getPrototypeOf(value) !== null) {
    reject();
  }
  const keys = [...fields, 'toJSON'];
  const snapshot = exactDataRecordWithHiddenSerializer(value, keys, fields);
  return snapshot;
}

function exactDataRecordWithHiddenSerializer(value, keys, fields) {
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
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || !descriptor.enumerable || descriptor.writable || descriptor.configurable) reject();
    snapshot[field] = descriptor.value;
  }
  const serializer = descriptors.toJSON;
  if (serializer === undefined || !Object.hasOwn(serializer, 'value')
    || serializer.enumerable || serializer.writable || serializer.configurable
    || typeof serializer.value !== 'function') reject();
  return snapshot;
}

function opaqueCapability(value) {
  try {
    if (typeof value !== 'function' || !Object.isFrozen(value)
      || Object.getPrototypeOf(value) !== null) reject();
    return value;
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

function capturedAuthority(value, source, expectedExpiry) {
  const snapshot = exactDataRecord(value, SOURCE_CLIENTS_AUTHORITY_FIELDS, true);
  exact(snapshot.source, source);
  if (snapshot.scope !== SOURCE_CLIENTS_SCOPES_BY_SOURCE[source]) reject();
  exact(snapshot.expires_at_milliseconds, expectedExpiry);
  if (typeof snapshot.acquire !== 'function' || typeof snapshot.close !== 'function') reject();
  const acquire = snapshot.acquire;
  const close = snapshot.close;
  return Object.freeze({
    identity: value,
    acquire: (...args) => Reflect.apply(acquire, value, args),
    close: (...args) => Reflect.apply(close, value, args),
  });
}

export function validateSourceClientSignal(value) {
  try {
    return validateSourceSessionProducerSignal(value);
  } catch {
    return reject();
  }
}

export function validateSourceClientFactoryInputs(authoritiesValue, optionsValue, nowValue) {
  try {
    if (!Number.isSafeInteger(nowValue) || nowValue < 0) {
      reject();
    }
    const options = exactDataRecord(optionsValue, SOURCE_CLIENTS_OPTIONS_FIELDS);
    const signal = validateSourceClientSignal(options.signal);
    const authoritySnapshot = exactDataRecord(
      authoritiesValue,
      SOURCE_CLIENTS_SOURCE_ORDER,
      true,
    );
    const first = authoritySnapshot[SOURCE_CLIENTS_SOURCE_ORDER[0]];
    const firstSnapshot = exactDataRecord(first, SOURCE_CLIENTS_AUTHORITY_FIELDS, true);
    const expiresAt = firstSnapshot.expires_at_milliseconds;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowValue
      || expiresAt > nowValue + SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS) reject();
    const identities = new Set();
    const authorities = Object.fromEntries(SOURCE_CLIENTS_SOURCE_ORDER.map((source) => {
      const authority = capturedAuthority(authoritySnapshot[source], source, expiresAt);
      if (identities.has(authority.identity)) reject();
      identities.add(authority.identity);
      return [source, authority];
    }));
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

export function validateSourceClientRuntime(value) {
  try {
    const snapshot = exactDataRecord(value, SOURCE_CLIENTS_RUNTIME_FIELDS);
    for (const field of SOURCE_CLIENTS_RUNTIME_FIELDS) {
      if (typeof snapshot[field] !== 'function') reject();
    }
    const methods = Object.fromEntries(SOURCE_CLIENTS_RUNTIME_FIELDS.map((field) => {
      const method = snapshot[field];
      return [field, (...args) => Reflect.apply(method, value, args)];
    }));
    return Object.freeze(methods);
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceClientDescriptor(value, source, cursor) {
  try {
    if (!SOURCE_CLIENTS_SOURCE_ORDER.includes(source)
      || !Number.isSafeInteger(cursor) || cursor < 0) reject();
    const snapshot = exactProtocolRecord(value, SOURCE_CLIENTS_CLIENT_DESCRIPTOR_FIELDS);
    const expected = SOURCE_CLIENTS_CALLS_BY_SOURCE[source]?.[cursor];
    if (expected === undefined) reject();
    exact(snapshot.source, source);
    if (snapshot.scope !== SOURCE_CLIENTS_SCOPES_BY_SOURCE[source]) reject();
    exact(snapshot.browser, expected.browser);
    exact(snapshot.case_id, expected.case_id);
    exact(snapshot.kind, expected.kind);
    validateSourceClientSignal(snapshot.signal);
    return Object.freeze({
      source,
      scope: snapshot.scope,
      browser: snapshot.browser,
      case_id: snapshot.case_id,
      kind: snapshot.kind,
      target: SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND[source][snapshot.kind],
      signal: snapshot.signal,
    });
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function createSourceClientAcquireDescriptor(context, signal, capability) {
  try {
    validateSourceClientSignal(signal);
    opaqueCapability(capability);
    const descriptor = Object.create(null);
    for (const [key, value] of [
      ['source', context.source],
      ['scope', context.scope],
      ['browser', context.browser],
      ['case_id', context.case_id],
      ['kind', context.kind],
      ['target', context.target],
      ['signal', signal],
      ['request_capability', capability],
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
      value() { throw new StagingBrowserRelaySourceClientError(); },
    });
    return Object.freeze(descriptor);
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}

export function validateSourceClientReceipt(value, context, capability) {
  try {
    opaqueCapability(capability);
    const receipt = exactProtocolRecord(value, SOURCE_CLIENTS_RECEIPT_FIELDS);
    exact(receipt.source, context.source);
    if (receipt.scope !== context.scope) reject();
    exact(receipt.browser, context.browser);
    exact(receipt.case_id, context.case_id);
    exact(receipt.kind, context.kind);
    if (receipt.target !== context.target || receipt.request_capability !== capability) reject();
    return validateSourceSessionProducerObservation(receipt.observation, context);
  } catch {
    return reject();
  }
}

export function sourceClientsDependencyContractsSha256() {
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
    || candidate.size === 0 || candidate.size > 80 * 1024
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
    'clients',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ]);
  exact(profile, expectedProfile);
  exact(profile.schema, 'miakapp.staging-browser-relay-source-clients-profile/1');
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
    implementation_base_commit: SOURCE_CLIENTS_IMPLEMENTATION_BASE_COMMIT,
    source_session_producers_profile_sha256: SOURCE_SESSION_PRODUCERS_PROFILE_SHA256,
    dependency_contracts_sha256: SOURCE_CLIENTS_DEPENDENCY_CONTRACTS_SHA256,
    internal_source_sha256: SOURCE_CLIENTS_INTERNAL_SOURCE_SHA256,
    production_source_sha256: SOURCE_CLIENTS_PRODUCTION_SOURCE_SHA256,
    testing_source_sha256: SOURCE_CLIENTS_TESTING_SOURCE_SHA256,
    guard_source_sha256: SOURCE_CLIENTS_GUARD_SOURCE_SHA256,
    unit_test_sha256: SOURCE_CLIENTS_UNIT_TEST_SHA256,
    workflow_sha256: SOURCE_CLIENTS_WORKFLOW_SHA256,
  });
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) reject();
  exact(profile.clients.source_order, SOURCE_CLIENTS_SOURCE_ORDER);
  exact(profile.clients.scopes_by_source, SOURCE_CLIENTS_SCOPES_BY_SOURCE);
  exact(profile.clients.targets_by_source_and_kind, SOURCE_CLIENTS_TARGETS_BY_SOURCE_AND_KIND);
  exact(profile.clients.client_fields, SOURCE_CLIENTS_CLIENT_FIELDS);
  exact(profile.clients.client_descriptor_fields, SOURCE_CLIENTS_CLIENT_DESCRIPTOR_FIELDS);
  exact(profile.clients.authority_fields, SOURCE_CLIENTS_AUTHORITY_FIELDS);
  exact(profile.clients.options_fields, SOURCE_CLIENTS_OPTIONS_FIELDS);
  exact(profile.clients.acquire_descriptor_fields, SOURCE_CLIENTS_ACQUIRE_DESCRIPTOR_FIELDS);
  exact(profile.clients.receipt_fields, SOURCE_CLIENTS_RECEIPT_FIELDS);
  exact(profile.clients.runtime_fields, SOURCE_CLIENTS_RUNTIME_FIELDS);
  exact(profile.clients.stage_count, SOURCE_CLIENTS_STAGE_COUNT);
  exact(profile.clients.observations_per_matrix, SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX);
  exact(profile.clients.distinct_kind_count, SOURCE_CLIENTS_DISTINCT_KIND_COUNT);
  exact(
    profile.clients.maximum_authority_lifetime_milliseconds,
    SOURCE_CLIENTS_MAXIMUM_AUTHORITY_LIFETIME_MILLISECONDS,
  );
  if (Object.values(profile.clients.invariants).some((entry) => entry !== true)) reject();
  exact(profile.compatibility, {
    source_session_producers_compatible: true,
    explicit_ephemeral_source_authorities_present: true,
    complete_source_count: SOURCE_CLIENTS_SOURCE_ORDER.length,
    complete_stage_count: SOURCE_CLIENTS_STAGE_COUNT,
    complete_observation_capacity: SOURCE_CLIENTS_OBSERVATIONS_PER_MATRIX,
    fixed_target_acquisition_clients_present: true,
    built_in_credential_discovery_present: false,
    consuming_app_check_verification_present: false,
    delayed_metric_inference_present: false,
    operation_case_adapter_wired: false,
    trusted_live_authority_providers_present: false,
    dedicated_process_ipc_present: false,
    preexisting_async_resource_reentrancy_isolated: false,
    uncooperative_same_process_authority_forced_termination: false,
  });
  exact(profile.output, {
    client_fields: SOURCE_CLIENTS_CLIENT_FIELDS,
    submitted_fields: ['observation'],
    request_capability_exposed_to_authority_only: true,
    request_capability_exposed_to_output: false,
    semantic_validation_before_output: true,
    raw_source_material_accepted: false,
    raw_source_material_retained: false,
    authority_references_exposed: false,
    credential_strings_accepted: false,
    arbitrary_errors_propagated: false,
  });
  exact(profile.authority, {
    explicit_ephemeral_authorities_accepted: true,
    fixed_staging_targets_authorized: true,
    ambient_credentials_authorized: false,
    arbitrary_targets_authorized: false,
    direct_network_implementation_authorized: false,
    cloud_mutations_authorized: false,
    case_adapter_wiring_authorized: false,
    live_execution_authorized: false,
    public_ingress_changes_authorized: false,
  });
  exact(profile.evidence, {
    state: 'absent',
    live_source_authorities: 0,
    live_source_client_calls: 0,
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

export function validateBrowserRelaySourceClientsProfile(rootValue) {
  try {
    const root = profileRoot(rootValue);
    exact(sourceClientsDependencyContractsSha256(), SOURCE_CLIENTS_DEPENDENCY_CONTRACTS_SHA256);
    validateBrowserRelaySourceSessionProducersProfile();
    reviewedContractFile(new URL('contract.mjs', root));
    for (const [name, maximumBytes, digest] of [
      ['profile.json', MAXIMUM_PROFILE_BYTES, SOURCE_CLIENTS_PROFILE_SHA256],
      ['internal.mjs', 56 * 1024, SOURCE_CLIENTS_INTERNAL_SOURCE_SHA256],
      ['clients.mjs', 8 * 1024, SOURCE_CLIENTS_PRODUCTION_SOURCE_SHA256],
      ['testing.mjs', 8 * 1024, SOURCE_CLIENTS_TESTING_SOURCE_SHA256],
      ['guard.mjs', 24 * 1024, SOURCE_CLIENTS_GUARD_SOURCE_SHA256],
    ]) regularPinnedFile(new URL(name, root), maximumBytes, digest);
    for (const [path, maximumBytes, digest] of [
      [unitTestPath, 224 * 1024, SOURCE_CLIENTS_UNIT_TEST_SHA256],
      [workflowPath, 8 * 1024, SOURCE_CLIENTS_WORKFLOW_SHA256],
    ]) regularPinnedFile(path, maximumBytes, digest);
    return validateProfileValue(JSON.parse(readFileSync(new URL('profile.json', root), 'utf8')));
  } catch (error) {
    if (packageError(error)) throw error;
    return reject();
  }
}
