import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual, types } from 'node:util';

import {
  CHROMIUM_SCENARIO_PROFILE_SHA256,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  FACT_ORDER_BY_BROWSER,
  validateIndependentSourceFact,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS,
  OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS,
  OPERATION_CASE_ADAPTER_PROFILE_SHA256,
} from '../browser-relay-operation-case-adapter/contract.mjs';
import {
  validateOperationResult,
} from '../browser-relay-operation/contract.mjs';
import {
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
} from '../browser-relay-page/contract.mjs';
import {
  SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS,
} from '../browser-relay-source-authority-adapters/contract.mjs';
import {
  SOURCE_TRANSPORTS_READ_TIMEOUT_MILLISECONDS,
} from '../browser-relay-source-transports/contract.mjs';
import {
  PLAYWRIGHT_BRIDGE_PROFILE_SHA256,
} from '../browser-relay-playwright-bridge/contract.mjs';
import {
  TRUSTED_PROVIDER_PROCESS_PROFILE_SHA256,
} from '../browser-relay-trusted-provider-process/contract.mjs';
import {
  TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE,
  TRUSTED_SOURCE_COMPOSITION_MATRIX_COMPONENT_FIELDS,
  TRUSTED_SOURCE_COMPOSITION_MAXIMUM_PROVIDER_LIFETIME_MILLISECONDS,
  TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX,
  TRUSTED_SOURCE_COMPOSITION_PROFILE_SHA256,
  TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE,
  TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE,
  TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER,
  TRUSTED_SOURCE_COMPOSITION_STAGE_COUNT,
} from '../browser-relay-trusted-source-composition/contract.mjs';

export const TRUSTED_PROVIDER_OWNER_PROFILE_PATH =
  'browser-relay-trusted-provider-owner/profile.json';
export const TRUSTED_PROVIDER_OWNER_PROFILE_SHA256 =
  'fcc476217d5aac5465e862cfa0154209d090d1f259f3f25a9f30b9148e41ad75';
export const TRUSTED_PROVIDER_OWNER_IMPLEMENTATION_BASE_COMMIT =
  '3dcb314a7e515105b7344da12bee8c0e67c05c26';
export const TRUSTED_PROVIDER_OWNER_DEPENDENCY_CONTRACTS_SHA256 =
  'b5f5acb02606357936f0eecee30c174177d55b5d6cfe55bb1d46647a18595e82';
export const TRUSTED_PROVIDER_OWNER_INTERNAL_SOURCE_SHA256 =
  '8ad615f6a9cfd86e26404070b80cf9a178e420fea283fa17dedb448eba4f95d6';
export const TRUSTED_PROVIDER_OWNER_ENTRY_SOURCE_SHA256 =
  '664a8eb707e3ba97cb6b01cff7fcb75ca588ee0a4fd57e3e379c55e6cc02b277';
export const TRUSTED_PROVIDER_OWNER_SOURCE_TRUTH_SOURCE_SHA256 =
  '803e92f18c141f5e9af95b610555e96357e3256be04e22de04f24b330c0052b7';
export const TRUSTED_PROVIDER_OWNER_OPERATION_SOURCE_SHA256 =
  'd173ad15ead860d5dc25b7be6aedcfb7dbe268d3adc8e7a7e9264879191e2786';
export const TRUSTED_PROVIDER_OWNER_PAGE_HOST_SOURCE_SHA256 =
  'b6f1ec0a92f25b5f7f8680b89fe60296b4b7f9f063edfb1a55908d8b5170b86d';
export const TRUSTED_PROVIDER_OWNER_BROWSER_SOURCE_SHA256 =
  'ff325fbfc81adc45a093086edaaa4e90096688d03d9af00f1ab68a26adf45708';
export const TRUSTED_PROVIDER_OWNER_SOURCE_SHA256 =
  'a5cd92c8b5af40e41571986def7ff924ca5ea95cb90cf275ef6cc704b0e2bc2c';
export const TRUSTED_PROVIDER_OWNER_TESTING_SOURCE_SHA256 =
  '2f3f1e76ae7700c3bc8a028e6787b89c1f7ec26e5b5757836c3c1fadcea305c8';
export const TRUSTED_PROVIDER_OWNER_BUNDLE_SOURCE_SHA256 =
  'ae70f8e60cc96ecf3e3828fe0b4ecb084aea086b9763730c4ce4927f70ae7d7b';
export const TRUSTED_PROVIDER_OWNER_GUARD_SOURCE_SHA256 =
  'db1c1edcc0ca94d721131eb4e14995ab7f17734879446ed891e8874c8f561852';
export const TRUSTED_PROVIDER_OWNER_UNIT_TEST_SHA256 =
  'a445b3fa8ab93285e5ef0d319195a67bed34631490790b674d8f609fbae50b98';
export const TRUSTED_PROVIDER_OWNER_BUNDLE_TEST_SHA256 =
  '83e410891bcee963b1746b0689a6f96e0e55aec4ca92b38a4df288620c30ecdc';
export const TRUSTED_PROVIDER_OWNER_BROWSER_TEST_SHA256 =
  '6173f8e9921ae983d23d77557136f165ac74cec118dd37bffb4e7722837611e8';
export const TRUSTED_PROVIDER_OWNER_WORKFLOW_SHA256 =
  '467460790da832e4dcb319a8dd31d386f9ffe8260417b379ea4b82299e894e29';

export const TRUSTED_PROVIDER_OWNER_SOURCE_ORDER = TRUSTED_SOURCE_COMPOSITION_SOURCE_ORDER;
export const TRUSTED_PROVIDER_OWNER_SCOPES_BY_SOURCE =
  TRUSTED_SOURCE_COMPOSITION_SCOPES_BY_SOURCE;
export const TRUSTED_PROVIDER_OWNER_CALLS_BY_SOURCE =
  TRUSTED_SOURCE_COMPOSITION_CALLS_BY_SOURCE;
export const TRUSTED_PROVIDER_OWNER_METHODS_BY_SOURCE =
  TRUSTED_SOURCE_COMPOSITION_PROVIDER_METHODS_BY_SOURCE;
export const TRUSTED_PROVIDER_OWNER_OPERATION_FIELDS = Object.freeze([
  ...OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS,
]);
export const TRUSTED_PROVIDER_OWNER_MATRIX_FIELDS = Object.freeze([
  ...TRUSTED_SOURCE_COMPOSITION_MATRIX_COMPONENT_FIELDS,
]);
export const TRUSTED_PROVIDER_OWNER_STAGE_COUNT = TRUSTED_SOURCE_COMPOSITION_STAGE_COUNT;
export const TRUSTED_PROVIDER_OWNER_OBSERVATION_COUNT =
  TRUSTED_SOURCE_COMPOSITION_OBSERVATIONS_PER_MATRIX;
export const TRUSTED_PROVIDER_OWNER_ASSERTION_COUNT = 40;
export const TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS = 61_000;
export const TRUSTED_PROVIDER_OWNER_VERSION_ONE_RETENTION_MILLISECONDS = 330_000;
export const TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS = 10;
export const TRUSTED_PROVIDER_OWNER_BROWSER_ORDER = Object.freeze([
  'chromium',
  'firefox',
  'webkit',
]);
export const TRUSTED_PROVIDER_OWNER_OUTPUT_FIELDS = Object.freeze(['execute', 'close']);
export const TRUSTED_PROVIDER_OWNER_SOURCE_ROOT_FIELDS = Object.freeze([
  'providers',
  'authority',
  'close',
]);
export const TRUSTED_PROVIDER_OWNER_AUTHORITY_FIELDS = Object.freeze([
  'activateOperation',
  'activateBrowser',
  'close',
]);
export const TRUSTED_PROVIDER_OWNER_COMPONENT_OWNER_FIELDS = Object.freeze([
  'components',
  'close',
]);
export const TRUSTED_PROVIDER_OWNER_RUNTIME_FIELDS = Object.freeze([
  'clock',
  'delay',
  'createSourceTruth',
  'createOperation',
  'createBrowser',
  'createComposition',
]);

const packageRootUrl = new URL('./', import.meta.url);
const profilePath = new URL('profile.json', import.meta.url);
const expectedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-relay-chromium-scenario/contract.mjs',
  '../browser-relay-independent-observers/contract.mjs',
  '../browser-relay-operation-case-adapter/contract.mjs',
  '../browser-relay-operation/contract.mjs',
  '../browser-relay-page/contract.mjs',
  '../browser-relay-playwright-bridge/contract.mjs',
  '../browser-relay-source-authority-adapters/contract.mjs',
  '../browser-relay-source-transports/contract.mjs',
  '../browser-relay-trusted-provider-process/contract.mjs',
  '../browser-relay-trusted-source-composition/contract.mjs',
].sort());
const PINNED_PACKAGE_FILES = Object.freeze({
  'entry.mjs': TRUSTED_PROVIDER_OWNER_ENTRY_SOURCE_SHA256,
  'internal.mjs': TRUSTED_PROVIDER_OWNER_INTERNAL_SOURCE_SHA256,
  'source-truth.mjs': TRUSTED_PROVIDER_OWNER_SOURCE_TRUTH_SOURCE_SHA256,
  'operation.mjs': TRUSTED_PROVIDER_OWNER_OPERATION_SOURCE_SHA256,
  'page-host.mjs': TRUSTED_PROVIDER_OWNER_PAGE_HOST_SOURCE_SHA256,
  'browser.mjs': TRUSTED_PROVIDER_OWNER_BROWSER_SOURCE_SHA256,
  'owner.mjs': TRUSTED_PROVIDER_OWNER_SOURCE_SHA256,
  'testing.mjs': TRUSTED_PROVIDER_OWNER_TESTING_SOURCE_SHA256,
  'bundle.mjs': TRUSTED_PROVIDER_OWNER_BUNDLE_SOURCE_SHA256,
  'guard.mjs': TRUSTED_PROVIDER_OWNER_GUARD_SOURCE_SHA256,
});
const PINNED_REPOSITORY_FILES = Object.freeze({
  '../test/browser-relay-trusted-provider-owner.test.mjs':
    TRUSTED_PROVIDER_OWNER_UNIT_TEST_SHA256,
  '../test/browser-relay-trusted-provider-owner-bundle.test.mjs':
    TRUSTED_PROVIDER_OWNER_BUNDLE_TEST_SHA256,
  '../test/browser-relay-trusted-provider-owner-browser.mjs':
    TRUSTED_PROVIDER_OWNER_BROWSER_TEST_SHA256,
  '../../../.github/workflows/browser-relay-trusted-provider-owner.yml':
    TRUSTED_PROVIDER_OWNER_WORKFLOW_SHA256,
});
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const INTRINSIC_IS_PROXY = types.isProxy.bind(types);
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;

export class StagingBrowserRelayTrustedProviderOwnerError extends Error {
  constructor() {
    super('Staging browser-relay trusted provider owner failed closed');
    this.name = 'StagingBrowserRelayTrustedProviderOwnerError';
  }
}

export function rejectTrustedProviderOwner() {
  throw new StagingBrowserRelayTrustedProviderOwnerError();
}

function isOwnerError(error) {
  try {
    return error instanceof StagingBrowserRelayTrustedProviderOwnerError;
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
  if (!plainObject(value) || (requireFrozen && !Object.isFrozen(value))) {
    rejectTrustedProviderOwner();
  }
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return rejectTrustedProviderOwner();
  }
  if (keys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual([...keys].sort(), [...fields].sort())) {
    rejectTrustedProviderOwner();
  }
  const snapshot = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true) rejectTrustedProviderOwner();
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function capturedMethods(identity, snapshot, fields) {
  const result = Object.create(null);
  for (const field of fields) {
    if (typeof snapshot[field] !== 'function') rejectTrustedProviderOwner();
    Object.defineProperty(result, field, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: (...args) => Reflect.apply(snapshot[field], identity, args),
    });
  }
  return Object.freeze(result);
}

function exact(value, expected) {
  if (!isDeepStrictEqual(value, expected)) rejectTrustedProviderOwner();
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function validateTrustedProviderOwnerExecuteInput(value = {}) {
  try {
    const keys = Reflect.ownKeys(value);
    const expected = keys.length === 0 ? [] : ['signal'];
    const snapshot = directRecord(value, expected);
    if (snapshot.signal !== undefined) Reflect.apply(ABORTED_GETTER, snapshot.signal, []);
    return Object.freeze(snapshot.signal === undefined ? {} : { signal: snapshot.signal });
  } catch (error) {
    if (isOwnerError(error)) throw error;
    return rejectTrustedProviderOwner();
  }
}

export function validateTrustedProviderOwnerRuntime(value) {
  try {
    const snapshot = directRecord(value, TRUSTED_PROVIDER_OWNER_RUNTIME_FIELDS, true);
    return capturedMethods(value, snapshot, TRUSTED_PROVIDER_OWNER_RUNTIME_FIELDS);
  } catch (error) {
    if (isOwnerError(error)) throw error;
    return rejectTrustedProviderOwner();
  }
}

export function validateTrustedProviderSourceOwner(value) {
  try {
    const snapshot = directRecord(value, TRUSTED_PROVIDER_OWNER_SOURCE_ROOT_FIELDS, true);
    const authoritySnapshot = directRecord(
      snapshot.authority,
      TRUSTED_PROVIDER_OWNER_AUTHORITY_FIELDS,
      true,
    );
    if (!plainObject(snapshot.providers) || !Object.isFrozen(snapshot.providers)) {
      rejectTrustedProviderOwner();
    }
    return Object.freeze({
      providers: snapshot.providers,
      authority: capturedMethods(
        snapshot.authority,
        authoritySnapshot,
        TRUSTED_PROVIDER_OWNER_AUTHORITY_FIELDS,
      ),
      close: capturedMethods(value, snapshot, ['close']).close,
    });
  } catch (error) {
    if (isOwnerError(error)) throw error;
    return rejectTrustedProviderOwner();
  }
}

function validateComponentOwner(value, componentFields) {
  const snapshot = directRecord(value, TRUSTED_PROVIDER_OWNER_COMPONENT_OWNER_FIELDS, true);
  const components = directRecord(snapshot.components, componentFields, true);
  return Object.freeze({
    components: Object.freeze({ ...components }),
    close: capturedMethods(value, snapshot, ['close']).close,
  });
}

export function validateTrustedProviderOperationOwner(value) {
  try {
    return validateComponentOwner(value, TRUSTED_PROVIDER_OWNER_OPERATION_FIELDS);
  } catch (error) {
    if (isOwnerError(error)) throw error;
    return rejectTrustedProviderOwner();
  }
}

export function validateTrustedProviderBrowserOwner(value) {
  try {
    return validateComponentOwner(value, TRUSTED_PROVIDER_OWNER_MATRIX_FIELDS);
  } catch (error) {
    if (isOwnerError(error)) throw error;
    return rejectTrustedProviderOwner();
  }
}

export function validateTrustedProviderOwnerResult(value) {
  try {
    return validateOperationResult(value);
  } catch {
    return rejectTrustedProviderOwner();
  }
}

export function validateTrustedProviderOwnerObservation(value, browser, source, sequence) {
  try {
    return validateIndependentSourceFact(value, browser, source, sequence).observation;
  } catch {
    return rejectTrustedProviderOwner();
  }
}

export function trustedProviderOwnerDependencyContractsSha256() {
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
    || sha256(readFileSync(path)) !== expectedSha256) rejectTrustedProviderOwner();
}

function profileRoot(value) {
  if (value === undefined) return packageRootUrl;
  try {
    const candidate = typeof value === 'string' && value.startsWith('/')
      ? new URL(value, 'file://')
      : value;
    if (!(candidate instanceof URL) || candidate.protocol !== 'file:') {
      rejectTrustedProviderOwner();
    }
    if (candidate.href.endsWith('/profile.json')) return new URL('./', candidate);
    if (!candidate.href.endsWith('/')) rejectTrustedProviderOwner();
    return candidate;
  } catch (error) {
    if (isOwnerError(error)) throw error;
    return rejectTrustedProviderOwner();
  }
}

function validateProfileSemantics(profile) {
  exact(profile.schema, 'miakapp.staging-browser-relay-trusted-provider-owner-profile/1');
  exact(profile.revision, 1);
  exact(profile.state,
    'complete_process_owned_provider_and_page_graph_offline_proven_not_live_executed');
  exact(profile.target, {
    project_id: 'miakapp-v4-staging',
    project_number: '1072737219170',
    region: 'europe-west9',
    data_policy: 'synthetic_only',
    cloud_compute_resources: 0,
    unscheduled: true,
  });
  exact(profile.pins.implementation_base_commit,
    TRUSTED_PROVIDER_OWNER_IMPLEMENTATION_BASE_COMMIT);
  exact(profile.pins.trusted_source_composition_profile_sha256,
    TRUSTED_SOURCE_COMPOSITION_PROFILE_SHA256);
  exact(profile.pins.trusted_provider_process_profile_sha256,
    TRUSTED_PROVIDER_PROCESS_PROFILE_SHA256);
  exact(profile.pins.operation_case_adapter_profile_sha256,
    OPERATION_CASE_ADAPTER_PROFILE_SHA256);
  exact(profile.pins.chromium_scenario_profile_sha256,
    CHROMIUM_SCENARIO_PROFILE_SHA256);
  exact(profile.pins.playwright_bridge_profile_sha256,
    PLAYWRIGHT_BRIDGE_PROFILE_SHA256);
  exact(profile.pins.page_profile_sha256, BROWSER_RELAY_PAGE_PROFILE_SHA256);
  exact(profile.pins.dependency_contracts_sha256,
    TRUSTED_PROVIDER_OWNER_DEPENDENCY_CONTRACTS_SHA256);
  exact(profile.graph.provider_sources, TRUSTED_PROVIDER_OWNER_SOURCE_ORDER);
  exact(profile.graph.operation_fields, TRUSTED_PROVIDER_OWNER_OPERATION_FIELDS);
  exact(profile.graph.matrix_fields, TRUSTED_PROVIDER_OWNER_MATRIX_FIELDS);
  exact(profile.graph.browser_order, TRUSTED_PROVIDER_OWNER_BROWSER_ORDER);
  exact(profile.graph.stage_count, TRUSTED_PROVIDER_OWNER_STAGE_COUNT);
  exact(profile.graph.observation_count, TRUSTED_PROVIDER_OWNER_OBSERVATION_COUNT);
  exact(profile.graph.assertion_count, TRUSTED_PROVIDER_OWNER_ASSERTION_COUNT);
  exact(profile.source_truth.maximum_expiry_milliseconds,
    TRUSTED_SOURCE_COMPOSITION_MAXIMUM_PROVIDER_LIFETIME_MILLISECONDS);
  exact(profile.source_truth.overlapping_source_read_rejected, true);
  exact(profile.source_truth.failed_source_read_retry_authorized, false);
  exact(profile.source_truth.timeline, {
    clock: 'owner_injected_wall_clock',
    delay: 'owner_injected_abortable_timer',
    version_two_publication_settlement_milliseconds:
      TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS,
    source_authority_read_deadline_milliseconds:
      SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS,
    source_transport_read_deadline_milliseconds:
      SOURCE_TRANSPORTS_READ_TIMEOUT_MILLISECONDS,
    version_one_retention_minimum_milliseconds:
      TRUSTED_PROVIDER_OWNER_VERSION_ONE_RETENTION_MILLISECONDS,
    cross_source_settlement_milliseconds:
      TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS,
    evidence_timestamps_caller_accepted: false,
    cross_source_dependencies_explicit: true,
  });
  if (TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS
      >= SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS
    || SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS
      >= SOURCE_TRANSPORTS_READ_TIMEOUT_MILLISECONDS) rejectTrustedProviderOwner();
  exact(profile.browsers.strict_offline_content_security_policy, true);
  exact(profile.browsers.chromium_unmatched_hostnames_fail_resolution, true);
  exact(profile.browsers.external_request_probe_per_page, true);
  exact(profile.bundle.playwright_core_tree_included, false);
  exact(profile.bundle.playwright_core_runtime_subset_included, true);
  exact(profile.bundle.owner_testing_entry_included, false);
  exact(profile.bundle.dependency_validation_assets_included, true);
  exact(profile.bundle.unreferenced_package_files_included, false);
  exact(profile.bundle.module_allowlist_included, true);
  exact(profile.bundle.unlisted_bundle_modules_importable, false);
  exact(profile.bundle.validation_only_assets_importable, false);
  exact(profile.bundle.repository_files, 204);
  exact(profile.bundle.playwright_files, 13);
  exact(profile.bundle.generated_data_files, 1);
  exact(profile.bundle.module_files, 87);
  exact(profile.lifecycle.concurrent_close_coalesced, true);
  exact(profile.lifecycle.repeated_close_idempotent, true);
  exact(profile.evidence.blocked_external_request_probes, 4);
  exact(profile.authority, {
    loopback_listener_authorized_for_offline_proof: true,
    fixed_openssl_certificate_generation_authorized: true,
    ephemeral_loopback_tls_material_authorized: true,
    persistent_tls_material_authorized: false,
    external_network_authorized: false,
    ambient_credentials_authorized: false,
    cloud_or_user_credential_bytes_authorized: false,
    arbitrary_targets_authorized: false,
    cloud_requests_authorized: false,
    cloud_mutations_authorized: false,
    hosting_publication_authorized: false,
    public_ingress_changes_authorized: false,
    live_execution_authorized: false,
  });
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, value]) => (
      key.endsWith('_sha256') && !SHA256.test(value)
    ))) rejectTrustedProviderOwner();
  return profile;
}

export function validateBrowserRelayTrustedProviderOwnerProfile(rootValue) {
  try {
    const root = profileRoot(rootValue);
    const candidatePath = new URL('profile.json', root);
    regularPinnedFile(candidatePath, MAXIMUM_PROFILE_BYTES,
      TRUSTED_PROVIDER_OWNER_PROFILE_SHA256);
    const profile = JSON.parse(readFileSync(candidatePath, 'utf8'));
    exact(profile, expectedProfile);
    validateProfileSemantics(profile);
    if (trustedProviderOwnerDependencyContractsSha256()
      !== TRUSTED_PROVIDER_OWNER_DEPENDENCY_CONTRACTS_SHA256) {
      rejectTrustedProviderOwner();
    }
    for (const [path, digest] of Object.entries(PINNED_PACKAGE_FILES)) {
      regularPinnedFile(new URL(path, root), 256 * 1024, digest);
    }
    for (const [path, digest] of Object.entries(PINNED_REPOSITORY_FILES)) {
      regularPinnedFile(new URL(path, root), 512 * 1024, digest);
    }
    return deepFreeze(profile);
  } catch (error) {
    if (isOwnerError(error)) throw error;
    return rejectTrustedProviderOwner();
  }
}

export function validateTrustedProviderOwnerSchedule() {
  const providerMethodCount = TRUSTED_PROVIDER_OWNER_SOURCE_ORDER.reduce(
    (count, source) => count + TRUSTED_PROVIDER_OWNER_METHODS_BY_SOURCE[source].length,
    0,
  );
  if (providerMethodCount !== 32
    || TRUSTED_PROVIDER_OWNER_OBSERVATION_COUNT !== 43
    || TRUSTED_PROVIDER_OWNER_STAGE_COUNT !== 22
    || !isDeepStrictEqual(
      Object.keys(FACT_ORDER_BY_BROWSER).sort(),
      [...TRUSTED_PROVIDER_OWNER_BROWSER_ORDER].sort(),
    )
    || !isDeepStrictEqual(
      OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS.filter(
        (field) => field !== 'sourceObservers',
      ),
      TRUSTED_PROVIDER_OWNER_MATRIX_FIELDS,
    )) rejectTrustedProviderOwner();
  return true;
}
