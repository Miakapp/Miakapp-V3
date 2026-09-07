import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { FIREBASE_APP_ID } from '../browser-app-check/contract.mjs';
import {
  AGGREGATOR_PROFILE_SHA256,
  COUNTER_MAXIMUMS,
  SOURCE_ASSERTIONS,
  SOURCE_ORDER_BY_BROWSER,
  SOURCE_RECEIPT_SCHEMA,
  validateBrowserRelayAggregatorProfile,
} from '../browser-relay-aggregator/contract.mjs';
import {
  BROWSER_RELAY_PLAN_SHA256,
  validateBrowserRelayPlan,
} from '../browser-relay/contract.mjs';
import {
  BROWSER_ORDER,
  BROWSER_DEADLINES_MILLISECONDS,
  RUNNER_RESULT_SCHEMA,
} from '../browser-relay-runner/contract.mjs';
import { TARGET_ORIGIN } from '../browser-relay-page/boundary.mjs';
import {
  MINIMUM_RENEWAL_INTERVAL_MILLISECONDS,
  PAGE_RECEIPT_PROFILE_SHA256,
  validateBrowserRelayPageReceiptProfile,
} from '../browser-relay-page-receipt/contract.mjs';

export const INDEPENDENT_OBSERVERS_PROFILE_PATH =
  'browser-relay-independent-observers/profile.json';
export const INDEPENDENT_OBSERVERS_PROFILE_SHA256 =
  'dccfa34e8243e546c5c7e58d314da912f1c59e63410580773912dab2137f2acb';
export const INDEPENDENT_OBSERVERS_IMPLEMENTATION_BASE_COMMIT =
  '7d2822d170df6849971b4748922fd1a459da6699';
export const INDEPENDENT_OBSERVERS_SOURCE_SHA256 =
  'f13a22c22e4953b3baee9d98b828f1e0b76997d49a8e066c98297557b9d35785';
export const INDEPENDENT_OBSERVERS_DEPENDENCY_CONTRACTS_SHA256 =
  '2942c96d56dbf9732675f06b86cd0911bb7cd39a92ad32d4cc830796834754f7';
export const INDEPENDENT_SOURCE_FACT_SCHEMA =
  'miakapp.staging-browser-relay-independent-source-fact/1';
export const MINIMUM_CHROMIUM_ENGINE_DURATION_MILLISECONDS =
  2 * MINIMUM_RENEWAL_INTERVAL_MILLISECONDS;

export const INDEPENDENT_SOURCES_BY_BROWSER = Object.freeze(
  Object.fromEntries(BROWSER_ORDER.map((browser) => [
    browser,
    Object.freeze(SOURCE_ORDER_BY_BROWSER[browser].filter((source) => source !== 'browser_page')),
  ])),
);

export const FACT_ORDER_BY_BROWSER = Object.freeze({
  chromium: Object.freeze({
    firebase_app_check: Object.freeze([
      'provider_assessment',
      'valid_verification',
      'missing_token_denial',
      'invalid_token_denial',
      'verification_mode',
    ]),
    hosting: Object.freeze([
      'management_site_configuration',
      'served_sdk_configuration',
    ]),
    control_plane: Object.freeze([
      'cors_preflight',
      'foreign_origin_denial',
      'source_uid_admission',
      'authenticated_cache_policy',
      'version_2_jwk_published',
      'version_1_last_issuance',
      'version_2_first_issuance',
      'atomic_credential_reuse',
      'version_1_jwk_retained',
      'version_1_jwk_removed',
      'exchange_summary',
    ]),
    relay: Object.freeze([
      'version_2_existing_socket',
      'wrong_audience_denial',
      'wrong_home_denial',
      'wrong_role_denial',
      'unknown_kid_refresh',
      'disconnect_reconnect_resync',
      'new_session_version_2',
      'revision_summary',
    ]),
    coordinator: Object.freeze(['physical_call_delivery']),
    kms: Object.freeze(['signature_summary', 'version_1_lifecycle']),
    firestore: Object.freeze([
      'authoritative_route_transition',
      'operation_write_summary',
    ]),
  }),
  firefox: Object.freeze({
    firebase_app_check: Object.freeze([
      'provider_assessment',
      'valid_verification',
    ]),
    control_plane: Object.freeze(['exchange_summary']),
    relay: Object.freeze(['version_2_session', 'revision_summary']),
    kms: Object.freeze(['signature_summary']),
  }),
  webkit: Object.freeze({
    firebase_app_check: Object.freeze([
      'provider_assessment',
      'valid_verification',
    ]),
    control_plane: Object.freeze(['exchange_summary']),
    relay: Object.freeze(['version_2_session', 'revision_summary']),
    kms: Object.freeze(['signature_summary']),
  }),
});

export const INDEPENDENT_SOURCE_RECEIPTS_PER_MATRIX = Object.values(
  INDEPENDENT_SOURCES_BY_BROWSER,
).reduce((total, sources) => total + sources.length, 0);
export const INDEPENDENT_FACTS_PER_MATRIX = Object.values(FACT_ORDER_BY_BROWSER)
  .flatMap((sources) => Object.values(sources))
  .reduce((total, facts) => total + facts.length, 0);
export const INDEPENDENT_DISTINCT_FACT_KINDS = new Set(
  Object.values(FACT_ORDER_BY_BROWSER).flatMap((sources) => Object.values(sources).flat()),
).size;

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);
const profilePath = new URL('profile.json', import.meta.url);
const observersPath = new URL('observers.mjs', import.meta.url);
const MAXIMUM_PROFILE_BYTES = 32 * 1024;
const MAXIMUM_SANITIZED_ARRAY_LENGTH = 4_096;
const MAXIMUM_SANITIZED_CHARACTERS = 1_048_576;
const MAXIMUM_SANITIZED_DEPTH = 32;
const MAXIMUM_SANITIZED_NODES = 16_384;
const MAXIMUM_SANITIZED_OBJECT_FIELDS = 4_096;
const MAXIMUM_SANITIZED_STRING_LENGTH = 16_384;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const CONTROL_PLANE_REVISION = /^control-plane-[0-9]{5}-[a-z0-9]{3}$/u;
const RELAY_REVISION = /^miakapp-staging-relay-[ab]-[0-9]{5}-[a-z0-9]{3}$/u;
const CONTROL_PLANE_SOURCE_SHA256 =
  '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e';
const CONTROL_PLANE_BASELINE_REVISION = 'control-plane-00010-vop';
const CONTROL_PLANE_ACTIVATION_REVISION = /^control-plane-00011-[a-z0-9]{3}$/u;
const CONTROL_PLANE_RETIREMENT_REVISION = /^control-plane-00012-[a-z0-9]{3}$/u;
export const CONTROL_PLANE_SIGNING_PROJECTION_SCHEMA =
  'miakapp.staging-control-plane-signing-projection/1';

function signingProjection(currentKeyId, publishedKeyIds) {
  return Object.freeze({
    current_key_id: currentKeyId,
    published_key_ids: Object.freeze([...publishedKeyIds]),
  });
}

export const CONTROL_PLANE_SIGNING_PROJECTIONS = Object.freeze({
  version_1_current_both_published: signingProjection('1', ['1', '2']),
  version_2_current_both_published: signingProjection('2', ['1', '2']),
  version_2_current_only_published: signingProjection('2', ['2']),
});

export function controlPlaneSigningProjectionSha256(value) {
  const projection = exactKeys(value, [
    'current_key_id',
    'published_key_ids',
  ], 'control_plane_signing_projection');
  const normalized = {
    current_key_id: projection.current_key_id,
    published_key_ids: Array.isArray(projection.published_key_ids)
      ? [...projection.published_key_ids]
      : projection.published_key_ids,
  };
  if (!Object.values(CONTROL_PLANE_SIGNING_PROJECTIONS)
    .some((expected) => isDeepStrictEqual(normalized, expected))) {
    reject('control_plane_signing_projection is outside the reviewed rotation states');
  }
  return sha256(JSON.stringify(normalized));
}

const SIGNING_PROJECTION_SHA256 = Object.freeze(Object.fromEntries(
  Object.entries(CONTROL_PLANE_SIGNING_PROJECTIONS).map(([name, projection]) => [
    name,
    controlPlaneSigningProjectionSha256(projection),
  ]),
));
const EXPECTED_RELAY_REVISIONS = Object.freeze({
  chromium: Object.freeze([
    'miakapp-staging-relay-a-00002-s62',
    'miakapp-staging-relay-b-00002-d8z',
  ]),
  firefox: Object.freeze(['miakapp-staging-relay-b-00002-d8z']),
  webkit: Object.freeze(['miakapp-staging-relay-b-00002-d8z']),
});
const PRIVATE_MATERIAL = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\bmhk1_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}\b/u,
]);
const DEPENDENCY_CONTRACT_PATHS = Object.freeze([
  '../browser-app-check/contract.mjs',
  '../browser-relay-aggregator/contract.mjs',
  '../browser-relay-page-receipt/contract.mjs',
  '../browser-relay-page/boundary.mjs',
  '../browser-relay-runner/contract.mjs',
  '../browser-relay/contract.mjs',
].sort());
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'app_check_token',
  'authorization',
  'browser_storage',
  'cookie',
  'custom_token',
  'email',
  'execution_identifier',
  'firebase_custom_token',
  'firebase_id_token',
  'firebase_uid',
  'har',
  'home_id',
  'home_key',
  'home_traffic',
  'id_token',
  'password',
  'private_key',
  'raw_document',
  'raw_log_entry',
  'raw_request',
  'raw_response',
  'refresh_token',
  'request_headers',
  'response_headers',
  'secret_value',
  'token',
  'trace_context',
  'video',
  'websocket_frame',
]);

export class StagingBrowserRelayIndependentObserverError extends Error {
  constructor(message = 'Staging browser-relay independent observation is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayIndependentObserverError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayIndependentObserverError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactKeys(value, keys, path) {
  if (!plainObject(value)) reject(`${path} must contain exactly the reviewed fields`);
  let ownKeys;
  let descriptors;
  try {
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return reject(`${path} must contain exactly the reviewed fields`);
  }
  if (ownKeys.some((key) => typeof key !== 'string')
    || ownKeys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined || !descriptor.enumerable
        || !Object.hasOwn(descriptor, 'value');
    })
    || !isDeepStrictEqual([...ownKeys].sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return Object.fromEntries(ownKeys.map((key) => [key, descriptors[key].value]));
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
}

function boundedInteger(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(`${path} is outside its reviewed bound`);
  }
  return value;
}

function sortedUniqueStrings(value, maximum, pattern, path) {
  if (!Array.isArray(value) || value.length > maximum
    || value.some((entry) => typeof entry !== 'string' || !pattern.test(entry))
    || new Set(value).size !== value.length
    || !isDeepStrictEqual(value, [...value].sort())) {
    reject(`${path} must be a bounded sorted unique public identifier array`);
  }
  return Object.freeze([...value]);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function browserRelayIndependentDependencyContractsSha256() {
  const hash = createHash('sha256');
  for (const path of DEPENDENCY_CONTRACT_PATHS) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(new URL(path, import.meta.url)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sanitizedSnapshot(value, path, state, depth) {
  state.nodes += 1;
  if (state.nodes > MAXIMUM_SANITIZED_NODES || depth > MAXIMUM_SANITIZED_DEPTH) {
    reject(`${path} exceeds the bounded sanitized data graph`);
  }
  if (typeof value === 'string') {
    state.characters += value.length;
    if (state.characters > MAXIMUM_SANITIZED_CHARACTERS) {
      reject(`${path} exceeds the sanitized character budget`);
    }
    if (value.length > MAXIMUM_SANITIZED_STRING_LENGTH) {
      reject(`${path} exceeds the sanitized string bound`);
    }
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains private material`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) reject(`${path} contains repeated object identity`);
    state.seen.add(value);
    let prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return reject(`${path} must be a plain dense data array`);
    }
    if (prototype !== Array.prototype) {
      reject(`${path} must be a plain dense data array`);
    }
    if (value.length > MAXIMUM_SANITIZED_ARRAY_LENGTH) {
      reject(`${path} exceeds the sanitized array bound`);
    }
    let ownKeys;
    let descriptors;
    try {
      ownKeys = Reflect.ownKeys(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return reject(`${path} must be a plain dense data array`);
    }
    const indexKeys = Array.from({ length: value.length }, (_, index) => String(index));
    const expectedKeys = [...indexKeys, 'length'];
    if (ownKeys.some((key) => typeof key !== 'string')
      || !isDeepStrictEqual([...ownKeys].sort(), [...expectedKeys].sort())
      || indexKeys.some((key) => {
        const descriptor = descriptors[key];
        return descriptor === undefined || !descriptor.enumerable
          || !Object.hasOwn(descriptor, 'value');
      })) {
      reject(`${path} must be a plain dense data array`);
    }
    return Object.freeze(indexKeys.map((key, index) => (
      sanitizedSnapshot(descriptors[key].value, `${path}[${index}]`, state, depth + 1)
    )));
  }
  if (plainObject(value)) {
    if (state.seen.has(value)) reject(`${path} contains repeated object identity`);
    state.seen.add(value);
    let ownKeys;
    let descriptors;
    try {
      ownKeys = Reflect.ownKeys(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return reject(`${path} must contain only enumerable string data fields`);
    }
    if (ownKeys.length > MAXIMUM_SANITIZED_OBJECT_FIELDS) {
      reject(`${path} exceeds the sanitized object-field bound`);
    }
    if (ownKeys.some((key) => typeof key !== 'string')
      || ownKeys.some((key) => {
        const descriptor = descriptors[key];
        return descriptor === undefined || !descriptor.enumerable
          || !Object.hasOwn(descriptor, 'value');
      })) {
      reject(`${path} must contain only enumerable string data fields`);
    }
    state.characters += ownKeys.reduce((total, key) => total + key.length, 0);
    if (state.characters > MAXIMUM_SANITIZED_CHARACTERS) {
      reject(`${path} exceeds the sanitized character budget`);
    }
    const entries = ownKeys.map((key) => {
      if (FORBIDDEN_FIELDS.has(key)) reject(`${path}.${key} is forbidden`);
      return [
        key,
        sanitizedSnapshot(descriptors[key].value, `${path}.${key}`, state, depth + 1),
      ];
    });
    return Object.freeze(Object.fromEntries(entries));
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  return reject(`${path} must contain only sanitized JSON data`);
}

export function rejectIndependentObserverPrivateMaterial(value, path = 'source_fact') {
  try {
    return sanitizedSnapshot(
      value,
      path,
      { characters: path.length, seen: new WeakSet(), nodes: 0 },
      0,
    );
  } catch (error) {
    if (error instanceof StagingBrowserRelayIndependentObserverError) throw error;
    return reject(`${path} must contain only bounded sanitized JSON data`);
  }
}

function validateProviderAssessment(value) {
  const observation = exactKeys(value, [
    'provider',
    'result',
    'token_status',
    'assessment_count',
    'attribution',
  ], 'source_fact.observation');
  exact(observation.provider, 'recaptcha_enterprise', 'provider_assessment.provider');
  exact(observation.result, 'ALLOW', 'provider_assessment.result');
  exact(observation.token_status, 'VALID', 'provider_assessment.token_status');
  exact(
    observation.attribution,
    'isolated_synthetic_window',
    'provider_assessment.attribution',
  );
  boundedInteger(
    observation.assessment_count,
    1,
    COUNTER_MAXIMUMS.app_check_assessments,
    'provider_assessment.assessment_count',
  );
  return observation;
}

function validateAppCheckVerification(value, expected) {
  const keys = expected.responseStatus === undefined
    ? ['result', 'security', 'verification_count']
    : ['result', 'security', 'verification_count', 'response_status', 'error_code'];
  const observation = exactKeys(value, keys, 'source_fact.observation');
  exact(observation.result, expected.result, 'app_check_verification.result');
  exact(observation.security, expected.security, 'app_check_verification.security');
  boundedInteger(observation.verification_count, 1, 16,
    'app_check_verification.verification_count');
  if (expected.responseStatus !== undefined) {
    exact(observation.response_status, expected.responseStatus,
      'app_check_verification.response_status');
    exact(observation.error_code, 'invalid_app_check_token',
      'app_check_verification.error_code');
  }
  return observation;
}

function validateVerificationMode(value) {
  const observation = exactKeys(value, [
    'mode',
    'repeated_valid_verifications',
    'consumed_verifications',
  ], 'source_fact.observation');
  exact(observation.mode, 'verify_only', 'verification_mode.mode');
  boundedInteger(observation.repeated_valid_verifications, 2, 16,
    'verification_mode.repeated_valid_verifications');
  exact(observation.consumed_verifications, 0,
    'verification_mode.consumed_verifications');
  return observation;
}

function validateHostingManagement(value) {
  const observation = exactKeys(value, [
    'site_id',
    'default_url',
    'app_id',
    'release_state',
  ], 'source_fact.observation');
  exact(observation.site_id, 'miakapp-v4-staging', 'hosting.site_id');
  exact(observation.default_url, TARGET_ORIGIN, 'hosting.default_url');
  exact(observation.app_id, FIREBASE_APP_ID, 'hosting.app_id');
  exact(observation.release_state, 'FINALIZED', 'hosting.release_state');
  return observation;
}

function validateHostingServed(value) {
  const observation = exactKeys(value, [
    'origin',
    'status',
    'app_id',
    'configuration_source',
  ], 'source_fact.observation');
  exact(observation.origin, TARGET_ORIGIN, 'hosting.origin');
  exact(observation.status, 200, 'hosting.status');
  exact(observation.app_id, FIREBASE_APP_ID, 'hosting.app_id');
  exact(
    observation.configuration_source,
    'firebase_reserved_sdk_configuration',
    'hosting.configuration_source',
  );
  return observation;
}

function validateCorsPreflight(value) {
  const observation = exactKeys(value, [
    'status',
    'request_origin',
    'allow_origin',
    'allow_credentials',
    'allow_headers',
    'allow_methods',
    'max_age_seconds',
    'cache_control',
    'pragma',
  ], 'source_fact.observation');
  exact(observation.status, 204, 'cors_preflight.status');
  exact(observation.request_origin, TARGET_ORIGIN, 'cors_preflight.request_origin');
  exact(observation.allow_origin, TARGET_ORIGIN, 'cors_preflight.allow_origin');
  exact(observation.allow_credentials, 'false', 'cors_preflight.allow_credentials');
  exact(observation.allow_headers, [
    'Authorization',
    'Cache-Control',
    'Content-Type',
    'Miakapp-Push-Proof',
    'Pragma',
    'X-Firebase-AppCheck',
  ], 'cors_preflight.allow_headers');
  exact(observation.allow_methods, [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ], 'cors_preflight.allow_methods');
  exact(observation.max_age_seconds, 600, 'cors_preflight.max_age_seconds');
  exact(observation.cache_control, 'no-store', 'cors_preflight.cache_control');
  exact(observation.pragma, 'no-cache', 'cors_preflight.pragma');
  return observation;
}

function validateForeignOriginDenial(value) {
  const observation = exactKeys(value, [
    'origin_class',
    'status',
    'error_code',
    'allow_origin_state',
  ], 'source_fact.observation');
  exact(observation.origin_class, 'foreign', 'foreign_origin.origin_class');
  exact(observation.status, 400, 'foreign_origin.status');
  exact(observation.error_code, 'invalid_request', 'foreign_origin.error_code');
  exact(observation.allow_origin_state, 'absent', 'foreign_origin.allow_origin_state');
  return observation;
}

function validateSourceUidAdmission(value) {
  const observation = exactKeys(value, [
    'operation',
    'audit_status',
    'actor_kind',
    'source_budget',
    'user_budget',
    'identity_binding',
  ], 'source_fact.observation');
  exact(observation.operation, 'user_relay.exchange', 'source_uid.operation');
  exact(observation.audit_status, 'ok', 'source_uid.audit_status');
  exact(observation.actor_kind, 'firebase_user', 'source_uid.actor_kind');
  exact(
    observation.source_budget,
    'user_relay.exchange.source',
    'source_uid.source_budget',
  );
  exact(
    observation.user_budget,
    'user_relay.exchange.user',
    'source_uid.user_budget',
  );
  exact(
    observation.identity_binding,
    'synthetic_fixture',
    'source_uid.identity_binding',
  );
  return observation;
}

function validateAuthenticatedCachePolicy(value) {
  const observation = exactKeys(value, [
    'status',
    'cache_control',
    'pragma',
    'referrer_policy',
  ], 'source_fact.observation');
  exact(observation.status, 200, 'authenticated_cache.status');
  exact(observation.cache_control, 'no-store', 'authenticated_cache.cache_control');
  exact(observation.pragma, 'no-cache', 'authenticated_cache.pragma');
  exact(observation.referrer_policy, 'no-referrer', 'authenticated_cache.referrer_policy');
  return observation;
}

function validateAtomicReuse(value) {
  const observation = exactKeys(value, [
    'route_change_exchange_requests',
    'handoff_reexchange_requests',
    'distinct_credential_digests',
    'distinct_issuance_records',
    'comparison',
  ], 'source_fact.observation');
  exact(observation.route_change_exchange_requests, 1,
    'atomic_reuse.route_change_exchange_requests');
  exact(observation.handoff_reexchange_requests, 0,
    'atomic_reuse.handoff_reexchange_requests');
  exact(observation.distinct_credential_digests, 1,
    'atomic_reuse.distinct_credential_digests');
  exact(observation.distinct_issuance_records, 1,
    'atomic_reuse.distinct_issuance_records');
  exact(observation.comparison, 'constant_time_digest', 'atomic_reuse.comparison');
  return observation;
}

function validateControlPlaneRevisionBinding(observation, phase, path) {
  exact(
    observation.deployed_source_sha256,
    CONTROL_PLANE_SOURCE_SHA256,
    `${path}.deployed_source_sha256`,
  );
  const phases = {
    baseline: {
      revision: CONTROL_PLANE_BASELINE_REVISION,
      projection: SIGNING_PROJECTION_SHA256.version_1_current_both_published,
    },
    activation: {
      revision: CONTROL_PLANE_ACTIVATION_REVISION,
      projection: SIGNING_PROJECTION_SHA256.version_2_current_both_published,
    },
    retirement: {
      revision: CONTROL_PLANE_RETIREMENT_REVISION,
      projection: SIGNING_PROJECTION_SHA256.version_2_current_only_published,
    },
  };
  const expected = phases[phase];
  if (typeof expected.revision === 'string') {
    exact(observation.revision_id, expected.revision, `${path}.revision_id`);
  } else if (typeof observation.revision_id !== 'string'
    || !expected.revision.test(observation.revision_id)) {
    reject(`${path}.revision_id is outside the reviewed revision generation`);
  }
  exact(
    observation.runtime_signing_projection_sha256,
    expected.projection,
    `${path}.runtime_signing_projection_sha256`,
  );
}

function validateJwkPublication(value) {
  const observation = exactKeys(value, [
    'published_key_ids',
    'current_signing_key_id',
    'publication_state',
    'cache_control',
    'revision_id',
    'deployed_source_sha256',
    'runtime_signing_projection_sha256',
  ], 'source_fact.observation');
  exact(observation.published_key_ids, ['1', '2'],
    'version_2_jwk_published.published_key_ids');
  exact(observation.current_signing_key_id, '1',
    'version_2_jwk_published.current_signing_key_id');
  exact(observation.publication_state, 'prepublished',
    'version_2_jwk_published.publication_state');
  exact(observation.cache_control, 'public_bounded',
    'version_2_jwk_published.cache_control');
  validateControlPlaneRevisionBinding(
    observation,
    'baseline',
    'version_2_jwk_published',
  );
  return observation;
}

function validateSigningTransition(value, kind) {
  const observation = exactKeys(value, [
    'published_key_ids',
    'signing_key_id',
    'issuance_boundary',
    'revision_id',
    'deployed_source_sha256',
    'runtime_signing_projection_sha256',
  ], 'source_fact.observation');
  exact(observation.published_key_ids, ['1', '2'], `${kind}.published_key_ids`);
  exact(
    observation.signing_key_id,
    kind === 'version_1_last_issuance' ? '1' : '2',
    `${kind}.signing_key_id`,
  );
  exact(
    observation.issuance_boundary,
    kind === 'version_1_last_issuance' ? 'last' : 'first',
    `${kind}.issuance_boundary`,
  );
  validateControlPlaneRevisionBinding(
    observation,
    kind === 'version_1_last_issuance' ? 'baseline' : 'activation',
    kind,
  );
  return observation;
}

function validateJwkRetention(value, kind) {
  const observation = exactKeys(value, [
    'published_key_ids',
    'retired_key_id',
    'lifecycle_state',
    'cache_control',
    'revision_id',
    'deployed_source_sha256',
    'runtime_signing_projection_sha256',
  ], 'source_fact.observation');
  exact(
    observation.published_key_ids,
    kind === 'version_1_jwk_removed' ? ['2'] : ['1', '2'],
    `${kind}.published_key_ids`,
  );
  exact(observation.retired_key_id, '1', `${kind}.retired_key_id`);
  exact(
    observation.lifecycle_state,
    kind === 'version_1_jwk_removed' ? 'removed' : 'retained',
    `${kind}.lifecycle_state`,
  );
  exact(observation.cache_control, 'public_bounded', `${kind}.cache_control`);
  validateControlPlaneRevisionBinding(
    observation,
    kind === 'version_1_jwk_removed' ? 'retirement' : 'activation',
    kind,
  );
  return observation;
}

function validateExchangeSummary(value, browser) {
  const observation = exactKeys(value, [
    'scope',
    'successful_exchanges',
    'home_key_exchanges',
    'user_relay_exchanges',
    'request_count_source',
    'public_key_ids',
    'revision_ids',
    'deployed_source_sha256',
    'runtime_signing_projection_sha256s',
  ], 'source_fact.observation');
  const expectedScope = browser === 'chromium'
    ? 'shared_setup_and_chromium_invocation'
    : `${browser}_invocation`;
  exact(observation.scope, expectedScope, 'exchange_summary.scope');
  boundedInteger(observation.successful_exchanges, 1, COUNTER_MAXIMUMS.control_plane_exchanges,
    'exchange_summary.successful_exchanges');
  boundedInteger(observation.home_key_exchanges, 0, COUNTER_MAXIMUMS.control_plane_exchanges,
    'exchange_summary.home_key_exchanges');
  exact(
    observation.user_relay_exchanges,
    browser === 'chromium' ? 6 : 1,
    'exchange_summary.user_relay_exchanges',
  );
  exact(
    observation.successful_exchanges,
    observation.home_key_exchanges + observation.user_relay_exchanges,
    'exchange_summary partition',
  );
  if (browser === 'chromium') {
    boundedInteger(observation.home_key_exchanges, 1, 8,
      'exchange_summary.home_key_exchanges');
  } else {
    exact(observation.home_key_exchanges, 0, 'exchange_summary.home_key_exchanges');
  }
  exact(
    observation.request_count_source,
    'operation_scoped_control_plane_exchange_ledger',
    'exchange_summary.request_count_source',
  );
  exact(
    observation.public_key_ids,
    browser === 'chromium' ? ['1', '2'] : ['2'],
    'exchange_summary.public_key_ids',
  );
  const revisions = sortedUniqueStrings(
    observation.revision_ids,
    3,
    CONTROL_PLANE_REVISION,
    'exchange_summary.revision_ids',
  );
  const expectedRevisionPatterns = browser === 'chromium'
    ? [CONTROL_PLANE_BASELINE_REVISION,
      CONTROL_PLANE_ACTIVATION_REVISION,
      CONTROL_PLANE_RETIREMENT_REVISION]
    : [CONTROL_PLANE_ACTIVATION_REVISION];
  if (revisions.length !== expectedRevisionPatterns.length
    || expectedRevisionPatterns.some((expected, index) => (
      typeof expected === 'string'
        ? revisions[index] !== expected
        : !expected.test(revisions[index])
    ))) {
    reject('exchange_summary.revision_ids are outside the reviewed revision lineage');
  }
  exact(
    observation.deployed_source_sha256,
    CONTROL_PLANE_SOURCE_SHA256,
    'exchange_summary.deployed_source_sha256',
  );
  exact(
    observation.runtime_signing_projection_sha256s,
    browser === 'chromium'
      ? [
        SIGNING_PROJECTION_SHA256.version_1_current_both_published,
        SIGNING_PROJECTION_SHA256.version_2_current_both_published,
        SIGNING_PROJECTION_SHA256.version_2_current_only_published,
      ]
      : [SIGNING_PROJECTION_SHA256.version_2_current_both_published],
    'exchange_summary.runtime_signing_projection_sha256s',
  );
  return Object.freeze({ ...observation, revision_ids: revisions });
}

function validateAcceptedRelaySession(value, kind) {
  const keys = kind === 'version_2_existing_socket'
    ? ['key_id', 'result', 'socket_generation', 'session_kind']
    : ['key_id', 'result', 'session_kind'];
  const observation = exactKeys(value, keys, 'source_fact.observation');
  exact(observation.key_id, '2', `${kind}.key_id`);
  exact(observation.result, 'accepted', `${kind}.result`);
  exact(
    observation.session_kind,
    kind === 'version_2_existing_socket' ? 'reauthentication' : 'new',
    `${kind}.session_kind`,
  );
  if (kind === 'version_2_existing_socket') {
    exact(observation.socket_generation, 1, `${kind}.socket_generation`);
  }
  return observation;
}

function validateRelayDenial(value, expectedClass) {
  const observation = exactKeys(value, [
    'credential_class',
    'result',
    'protocol_state',
  ], 'source_fact.observation');
  exact(observation.credential_class, expectedClass, 'relay_denial.credential_class');
  exact(observation.result, 'denied', 'relay_denial.result');
  exact(
    observation.protocol_state,
    'rejected_before_welcome',
    'relay_denial.protocol_state',
  );
  return observation;
}

function validateUnknownKidRefresh(value) {
  const observation = exactKeys(value, [
    'credential_class',
    'result',
    'verification_attempts',
    'jwks_fetches',
    'duration_milliseconds',
  ], 'source_fact.observation');
  exact(observation.credential_class, 'unknown_key', 'unknown_kid.credential_class');
  exact(observation.result, 'denied', 'unknown_kid.result');
  boundedInteger(observation.verification_attempts, 2, 16,
    'unknown_kid.verification_attempts');
  exact(observation.jwks_fetches, 1, 'unknown_kid.jwks_fetches');
  boundedInteger(observation.duration_milliseconds, 0, 10_000,
    'unknown_kid.duration_milliseconds');
  return observation;
}

function validateReconnectResync(value) {
  const observation = exactKeys(value, [
    'disconnects',
    'reconnects',
    'state_resyncs',
    'duration_milliseconds',
    'final_state',
  ], 'source_fact.observation');
  exact(observation.disconnects, 1, 'reconnect.disconnects');
  exact(observation.reconnects, 1, 'reconnect.reconnects');
  exact(observation.state_resyncs, 1, 'reconnect.state_resyncs');
  boundedInteger(observation.duration_milliseconds, 0, 30_000,
    'reconnect.duration_milliseconds');
  exact(observation.final_state, 'ready_authoritative', 'reconnect.final_state');
  return observation;
}

function validateRelayRevisionSummary(value, browser) {
  const observation = exactKeys(value, [
    'revision_ids',
    'serving_state',
  ], 'source_fact.observation');
  const revisions = sortedUniqueStrings(
    observation.revision_ids,
    2,
    RELAY_REVISION,
    'revision_summary.revision_ids',
  );
  exact(revisions, EXPECTED_RELAY_REVISIONS[browser], 'revision_summary.revision_ids');
  exact(observation.serving_state, 'ready_reconciled', 'revision_summary.serving_state');
  return Object.freeze({ ...observation, revision_ids: revisions });
}

function validatePhysicalCallDelivery(value) {
  const observation = exactKeys(value, [
    'logical_calls',
    'physical_dispatches',
    'physical_replays',
    'reconnects',
  ], 'source_fact.observation');
  exact(observation.logical_calls, 4, 'coordinator.logical_calls');
  exact(observation.physical_dispatches, observation.logical_calls,
    'coordinator.physical_dispatches');
  exact(observation.physical_replays, 0, 'coordinator.physical_replays');
  exact(observation.reconnects, 1, 'coordinator.reconnects');
  return observation;
}

function validateSignatureSummary(value, browser) {
  const observation = exactKeys(value, [
    'scope',
    'algorithm',
    'signing_rpc_count_total',
    'version_1_signing_rpc_count',
    'version_2_signing_rpc_count',
    'verified_distinct_signatures_total',
    'version_1_verified_distinct_signatures',
    'version_2_verified_distinct_signatures',
    'request_count_source',
    'verification_source',
  ], 'source_fact.observation');
  const expectedScope = browser === 'chromium'
    ? 'shared_setup_and_chromium_invocation'
    : `${browser}_invocation`;
  exact(observation.scope, expectedScope, 'kms.scope');
  exact(observation.algorithm, 'EC_SIGN_ED25519', 'kms.algorithm');
  boundedInteger(observation.signing_rpc_count_total, 1, COUNTER_MAXIMUMS.kms_signatures,
    'kms.signing_rpc_count_total');
  boundedInteger(observation.version_1_signing_rpc_count, 0, COUNTER_MAXIMUMS.kms_signatures,
    'kms.version_1_signing_rpc_count');
  boundedInteger(observation.version_2_signing_rpc_count, 1, COUNTER_MAXIMUMS.kms_signatures,
    'kms.version_2_signing_rpc_count');
  exact(
    observation.signing_rpc_count_total,
    observation.version_1_signing_rpc_count + observation.version_2_signing_rpc_count,
    'kms signing RPC partition',
  );
  boundedInteger(
    observation.verified_distinct_signatures_total,
    1,
    COUNTER_MAXIMUMS.kms_signatures,
    'kms.verified_distinct_signatures_total',
  );
  boundedInteger(
    observation.version_1_verified_distinct_signatures,
    0,
    COUNTER_MAXIMUMS.kms_signatures,
    'kms.version_1_verified_distinct_signatures',
  );
  boundedInteger(
    observation.version_2_verified_distinct_signatures,
    1,
    COUNTER_MAXIMUMS.kms_signatures,
    'kms.version_2_verified_distinct_signatures',
  );
  exact(
    observation.verified_distinct_signatures_total,
    observation.version_1_verified_distinct_signatures
      + observation.version_2_verified_distinct_signatures,
    'kms verified-signature partition',
  );
  exact(
    observation.verified_distinct_signatures_total,
    observation.signing_rpc_count_total,
    'kms verified signatures match signing RPCs',
  );
  exact(
    observation.version_1_verified_distinct_signatures,
    observation.version_1_signing_rpc_count,
    'kms version 1 verified signatures match signing RPCs',
  );
  exact(
    observation.version_2_verified_distinct_signatures,
    observation.version_2_signing_rpc_count,
    'kms version 2 verified signatures match signing RPCs',
  );
  if (browser === 'chromium') {
    boundedInteger(observation.version_1_verified_distinct_signatures, 1, 8,
      'kms.version_1_verified_distinct_signatures');
    boundedInteger(observation.version_2_verified_distinct_signatures, 5, 15,
      'kms.version_2_verified_distinct_signatures');
  } else {
    exact(observation.version_1_signing_rpc_count, 0, 'kms.version_1_signing_rpc_count');
    exact(observation.version_1_verified_distinct_signatures, 0,
      'kms.version_1_verified_distinct_signatures');
    exact(observation.version_2_verified_distinct_signatures, 1,
      'kms.version_2_verified_distinct_signatures');
  }
  exact(
    observation.request_count_source,
    'operation_scoped_kms_signer_ledger',
    'kms.request_count_source',
  );
  exact(observation.verification_source, 'kms_public_key', 'kms.verification_source');
  return observation;
}

function validateVersionOneLifecycle(value) {
  const observation = exactKeys(value, [
    'key_version',
    'state',
    'destroy_time_state',
    'key_material_state',
  ], 'source_fact.observation');
  exact(observation.key_version, 1, 'kms_lifecycle.key_version');
  exact(observation.state, 'DISABLED', 'kms_lifecycle.state');
  exact(observation.destroy_time_state, 'absent', 'kms_lifecycle.destroy_time_state');
  exact(
    observation.key_material_state,
    'retained_reenableable',
    'kms_lifecycle.key_material_state',
  );
  return observation;
}

function validateRouteTransition(value) {
  const observation = exactKeys(value, [
    'document_scope',
    'read_consistency',
    'route_before',
    'route_after',
    'update_order',
    'retention_mode',
  ], 'source_fact.observation');
  exact(observation.document_scope, 'exact_synthetic_home', 'firestore.document_scope');
  exact(observation.read_consistency, 'strong', 'firestore.read_consistency');
  exact(observation.route_before, 'relay-a', 'firestore.route_before');
  exact(observation.route_after, 'relay-b', 'firestore.route_after');
  exact(observation.update_order, 'before_precedes_after', 'firestore.update_order');
  exact(observation.retention_mode, 'sanitized_projection_only', 'firestore.retention_mode');
  return observation;
}

function validateOperationWriteSummary(value) {
  const observation = exactKeys(value, [
    'scope',
    'observed_write_count',
    'observation_source',
    'retention_mode',
  ], 'source_fact.observation');
  exact(
    observation.scope,
    'synthetic_operation_through_matrix_close',
    'firestore_write_summary.scope',
  );
  boundedInteger(
    observation.observed_write_count,
    2,
    COUNTER_MAXIMUMS.firestore_writes,
    'firestore_write_summary.observed_write_count',
  );
  exact(
    observation.observation_source,
    'sanitized_firestore_commit_ledger',
    'firestore_write_summary.observation_source',
  );
  exact(
    observation.retention_mode,
    'count_only',
    'firestore_write_summary.retention_mode',
  );
  return observation;
}

function validateObservation(value, browser, source, kind) {
  if (source === 'firebase_app_check') {
    if (kind === 'provider_assessment') return validateProviderAssessment(value);
    if (kind === 'valid_verification') {
      return validateAppCheckVerification(value, { result: 'ALLOW', security: 'VALID' });
    }
    if (kind === 'missing_token_denial') {
      return validateAppCheckVerification(value, {
        result: 'DENY', security: 'MISSING', responseStatus: 401,
      });
    }
    if (kind === 'invalid_token_denial') {
      return validateAppCheckVerification(value, {
        result: 'DENY', security: 'INVALID', responseStatus: 401,
      });
    }
    if (kind === 'verification_mode') return validateVerificationMode(value);
  }
  if (source === 'hosting') {
    if (kind === 'management_site_configuration') return validateHostingManagement(value);
    if (kind === 'served_sdk_configuration') return validateHostingServed(value);
  }
  if (source === 'control_plane') {
    if (kind === 'cors_preflight') return validateCorsPreflight(value);
    if (kind === 'foreign_origin_denial') return validateForeignOriginDenial(value);
    if (kind === 'source_uid_admission') return validateSourceUidAdmission(value);
    if (kind === 'authenticated_cache_policy') return validateAuthenticatedCachePolicy(value);
    if (kind === 'atomic_credential_reuse') return validateAtomicReuse(value);
    if (kind === 'version_2_jwk_published') return validateJwkPublication(value);
    if (kind === 'version_1_last_issuance' || kind === 'version_2_first_issuance') {
      return validateSigningTransition(value, kind);
    }
    if (kind === 'version_1_jwk_retained' || kind === 'version_1_jwk_removed') {
      return validateJwkRetention(value, kind);
    }
    if (kind === 'exchange_summary') return validateExchangeSummary(value, browser);
  }
  if (source === 'relay') {
    if (kind === 'version_2_existing_socket' || kind === 'version_2_session'
      || kind === 'new_session_version_2') {
      return validateAcceptedRelaySession(value, kind);
    }
    if (kind === 'wrong_audience_denial') return validateRelayDenial(value, 'wrong_audience');
    if (kind === 'wrong_home_denial') return validateRelayDenial(value, 'wrong_home');
    if (kind === 'wrong_role_denial') return validateRelayDenial(value, 'wrong_role');
    if (kind === 'unknown_kid_refresh') return validateUnknownKidRefresh(value);
    if (kind === 'disconnect_reconnect_resync') return validateReconnectResync(value);
    if (kind === 'revision_summary') return validateRelayRevisionSummary(value, browser);
  }
  if (source === 'coordinator' && kind === 'physical_call_delivery') {
    return validatePhysicalCallDelivery(value);
  }
  if (source === 'kms') {
    if (kind === 'signature_summary') return validateSignatureSummary(value, browser);
    if (kind === 'version_1_lifecycle') return validateVersionOneLifecycle(value);
  }
  if (source === 'firestore' && kind === 'authoritative_route_transition') {
    return validateRouteTransition(value);
  }
  if (source === 'firestore' && kind === 'operation_write_summary') {
    return validateOperationWriteSummary(value);
  }
  return reject('source_fact observation kind is not implemented');
}

export function validateIndependentSourceFact(value, browser, source, expectedSequence) {
  if (!BROWSER_ORDER.includes(browser)) reject('Source-fact browser is not reviewed');
  const phases = FACT_ORDER_BY_BROWSER[browser]?.[source];
  if (!Array.isArray(phases)) reject('Source-fact owner is not reviewed for this browser');
  boundedInteger(expectedSequence, 1, phases.length, 'expected source-fact sequence');
  const snapshot = rejectIndependentObserverPrivateMaterial(value, 'source_fact');
  const fact = exactKeys(snapshot, [
    'schema',
    'browser',
    'source',
    'sequence',
    'kind',
    'elapsed_milliseconds',
    'observation',
  ], 'source_fact');
  exact(fact.schema, INDEPENDENT_SOURCE_FACT_SCHEMA, 'source_fact.schema');
  exact(fact.browser, browser, 'source_fact.browser');
  exact(fact.source, source, 'source_fact.source');
  exact(fact.sequence, expectedSequence, 'source_fact.sequence');
  exact(fact.kind, phases[expectedSequence - 1], 'source_fact.kind');
  boundedInteger(
    fact.elapsed_milliseconds,
    0,
    BROWSER_DEADLINES_MILLISECONDS[browser],
    'source_fact.elapsed_milliseconds',
  );
  const observation = validateObservation(fact.observation, browser, source, fact.kind);
  return Object.freeze({ ...fact, observation: Object.freeze({ ...observation }) });
}

function regularPinnedFile(path, maximumBytes, expectedSha256, description) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0
    || entry.size === 0 || entry.size > maximumBytes
    || sha256(readFileSync(path)) !== expectedSha256) {
    reject(`${description} differs from the reviewed regular file`);
  }
}

function validateProfileValue(value) {
  rejectIndependentObserverPrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'observers',
    'compatibility',
    'output',
    'authority',
    'evidence',
  ], 'profile');
  exact(profile, expectedProfile, 'profile');
  exact(
    profile.schema,
    'miakapp.staging-browser-relay-independent-observers-profile/1',
    'profile.schema',
  );
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'closed_independent_source_receipt_producers_implemented_not_wired_not_executed',
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
    implementation_base_commit: INDEPENDENT_OBSERVERS_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    browser_relay_aggregator_profile_sha256: AGGREGATOR_PROFILE_SHA256,
    browser_relay_page_receipt_profile_sha256: PAGE_RECEIPT_PROFILE_SHA256,
    dependency_contracts_sha256: INDEPENDENT_OBSERVERS_DEPENDENCY_CONTRACTS_SHA256,
    observers_source_sha256: INDEPENDENT_OBSERVERS_SOURCE_SHA256,
  }, 'profile.pins');
  if (!COMMIT.test(profile.pins.implementation_base_commit)
    || Object.entries(profile.pins).some(([key, entry]) => (
      key.endsWith('_sha256') && !SHA256.test(entry)
    ))) reject('profile.pins contains an invalid immutable identifier');
  exact(profile.observers, {
    source_fact_schema: INDEPENDENT_SOURCE_FACT_SCHEMA,
    source_receipt_schema: SOURCE_RECEIPT_SCHEMA,
    browser_order: BROWSER_ORDER,
    independent_sources_by_browser: INDEPENDENT_SOURCES_BY_BROWSER,
    fact_order_by_browser: FACT_ORDER_BY_BROWSER,
    source_receipts_per_matrix: INDEPENDENT_SOURCE_RECEIPTS_PER_MATRIX,
    facts_per_matrix: INDEPENDENT_FACTS_PER_MATRIX,
    distinct_fact_kinds: INDEPENDENT_DISTINCT_FACT_KINDS,
    matrix_scope: 'three_browser',
    browser_start_offsets_required: true,
    page_receipt_close_offsets_required: true,
    single_use: true,
    fact_order_exact: true,
    fact_retries: 0,
    assertion_boolean_inputs: false,
    raw_facts_retained: false,
    arbitrary_errors_propagated: false,
    source_ownership_exact: true,
    cross_source_counter_parity_exact: true,
    cross_browser_revision_lineage_exact: true,
    cross_browser_timeline_exact: true,
    independent_receipts_exposed: false,
    transport_adapters_present: false,
  }, 'profile.observers');
  exact(profile.compatibility, {
    browser_page_receipt_producer_present: true,
    independent_source_receipt_producers_present: true,
    complete_receipt_count: 18,
    offline_aggregator_integration_present: true,
    runner_result_producer_present: true,
    live_aggregator_wired: false,
    live_source_adapters_present: false,
    common_operation_clock_shape_present: true,
    common_operation_provenance_present: false,
    cross_source_timeline_bound: true,
    canonical_live_case_order_preserved: true,
    current_sequential_runner_compatible: false,
    complete_chromium_page_scenario: false,
    bfcache_capable_automation: false,
  }, 'profile.compatibility');
  exact(profile.output, {
    runner_result_schema: RUNNER_RESULT_SCHEMA,
    assertion_owners: Object.fromEntries(BROWSER_ORDER.map((browser) => [
      browser,
      Object.fromEntries(INDEPENDENT_SOURCES_BY_BROWSER[browser].map((source) => [
        source,
        SOURCE_ASSERTIONS[browser][source],
      ])),
    ])),
    allowed_observations: [
      'bounded_counts',
      'durations',
      'public_key_ids',
      'revision_ids',
      'source_and_configuration_digests',
      'stable_enum_outcomes',
    ],
    forbidden_observations: [
      'browser_storage',
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
    live_source_facts: 0,
    live_source_receipts: 0,
    cloud_requests: 0,
    cloud_mutations: 0,
    live_execution_count: 0,
    credentials_committed: false,
    raw_facts_committed: false,
  }, 'profile.evidence');
  return Object.freeze(structuredClone(profile));
}

export function validateBrowserRelayIndependentObserversProfile() {
  exact(
    browserRelayIndependentDependencyContractsSha256(),
    INDEPENDENT_OBSERVERS_DEPENDENCY_CONTRACTS_SHA256,
    'Browser-relay independent observer dependency contracts digest',
  );
  validateBrowserRelayPlan(new URL('../browser-relay/plan.json', import.meta.url));
  validateBrowserRelayAggregatorProfile();
  validateBrowserRelayPageReceiptProfile();
  regularPinnedFile(
    profilePath,
    MAXIMUM_PROFILE_BYTES,
    INDEPENDENT_OBSERVERS_PROFILE_SHA256,
    'Browser-relay independent observers profile',
  );
  regularPinnedFile(
    observersPath,
    48 * 1024,
    INDEPENDENT_OBSERVERS_SOURCE_SHA256,
    'Browser-relay independent observers source',
  );
  let value;
  try {
    value = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return reject('Browser-relay independent observers profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== readFileSync(profilePath, 'utf8')) {
    reject('Browser-relay independent observers profile is not canonical JSON');
  }
  return validateProfileValue(value);
}
