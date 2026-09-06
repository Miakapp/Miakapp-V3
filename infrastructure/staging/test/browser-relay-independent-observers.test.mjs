import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  COUNTER_KEYS,
  SOURCE_ASSERTIONS,
  SOURCE_RECEIPT_SCHEMA,
  STABLE_OUTCOME_CLASSES,
} from '../browser-relay-aggregator/contract.mjs';
import {
  CONTROL_PLANE_SIGNING_PROJECTIONS,
  FACT_ORDER_BY_BROWSER,
  INDEPENDENT_DISTINCT_FACT_KINDS,
  INDEPENDENT_FACTS_PER_MATRIX,
  INDEPENDENT_OBSERVERS_DEPENDENCY_CONTRACTS_SHA256,
  INDEPENDENT_OBSERVERS_PROFILE_SHA256,
  INDEPENDENT_SOURCE_RECEIPTS_PER_MATRIX,
  INDEPENDENT_SOURCE_FACT_SCHEMA,
  INDEPENDENT_SOURCES_BY_BROWSER,
  MINIMUM_CHROMIUM_ENGINE_DURATION_MILLISECONDS,
  StagingBrowserRelayIndependentObserverError,
  browserRelayIndependentDependencyContractsSha256,
  controlPlaneSigningProjectionSha256,
  validateBrowserRelayIndependentObserversProfile,
  validateIndependentSourceFact,
} from '../browser-relay-independent-observers/contract.mjs';
import * as independentObserverModule from '../browser-relay-independent-observers/observers.mjs';
import {
  validateBrowserRelayIndependentObserversRoot,
} from '../browser-relay-independent-observers/guard.mjs';
import { PAGE_RECEIPT_PROFILE_SHA256 } from '../browser-relay-page-receipt/contract.mjs';

const CONTROL_PLANE_REVISION = 'control-plane-00010-vop';
const CONTROL_PLANE_ACTIVATION_REVISION = 'control-plane-00011-act';
const CONTROL_PLANE_RETIREMENT_REVISION = 'control-plane-00012-ret';
const CONTROL_PLANE_SOURCE_SHA256 =
  '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e';
const SIGNING_PROJECTION_SHA256 = Object.freeze(Object.fromEntries(
  Object.entries(CONTROL_PLANE_SIGNING_PROJECTIONS).map(([name, projection]) => [
    name,
    controlPlaneSigningProjectionSha256(projection),
  ]),
));
const RELAY_A_REVISION = 'miakapp-staging-relay-a-00002-s62';
const RELAY_B_REVISION = 'miakapp-staging-relay-b-00002-d8z';
const TARGET_ORIGIN = 'https://miakapp-v4-staging.web.app';
const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
const { produceBrowserRelayIndependentRunnerResult } = independentObserverModule;

function observation(browser, kind) {
  switch (kind) {
    case 'provider_assessment':
      return {
        provider: 'recaptcha_enterprise',
        result: 'ALLOW',
        token_status: 'VALID',
        assessment_count: 1,
        attribution: 'isolated_synthetic_window',
      };
    case 'valid_verification':
      return { result: 'ALLOW', security: 'VALID', verification_count: 2 };
    case 'missing_token_denial':
      return {
        result: 'DENY',
        security: 'MISSING',
        verification_count: 1,
        response_status: 401,
        error_code: 'invalid_app_check_token',
      };
    case 'invalid_token_denial':
      return {
        result: 'DENY',
        security: 'INVALID',
        verification_count: 1,
        response_status: 401,
        error_code: 'invalid_app_check_token',
      };
    case 'verification_mode':
      return {
        mode: 'verify_only',
        repeated_valid_verifications: 2,
        consumed_verifications: 0,
      };
    case 'management_site_configuration':
      return {
        site_id: 'miakapp-v4-staging',
        default_url: TARGET_ORIGIN,
        app_id: FIREBASE_APP_ID,
        release_state: 'FINALIZED',
      };
    case 'served_sdk_configuration':
      return {
        origin: TARGET_ORIGIN,
        status: 200,
        app_id: FIREBASE_APP_ID,
        configuration_source: 'firebase_reserved_sdk_configuration',
      };
    case 'cors_preflight':
      return {
        status: 204,
        request_origin: TARGET_ORIGIN,
        allow_origin: TARGET_ORIGIN,
        allow_credentials: 'false',
        allow_headers: [
          'Authorization',
          'Cache-Control',
          'Content-Type',
          'Miakapp-Push-Proof',
          'Pragma',
          'X-Firebase-AppCheck',
        ],
        allow_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        max_age_seconds: 600,
        cache_control: 'no-store',
        pragma: 'no-cache',
      };
    case 'foreign_origin_denial':
      return {
        origin_class: 'foreign',
        status: 400,
        error_code: 'invalid_request',
        allow_origin_state: 'absent',
      };
    case 'source_uid_admission':
      return {
        operation: 'user_relay.exchange',
        audit_status: 'ok',
        actor_kind: 'firebase_user',
        source_budget: 'user_relay.exchange.source',
        user_budget: 'user_relay.exchange.user',
        identity_binding: 'synthetic_fixture',
      };
    case 'authenticated_cache_policy':
      return {
        status: 200,
        cache_control: 'no-store',
        pragma: 'no-cache',
        referrer_policy: 'no-referrer',
      };
    case 'atomic_credential_reuse':
      return {
        route_change_exchange_requests: 1,
        handoff_reexchange_requests: 0,
        distinct_credential_digests: 1,
        distinct_issuance_records: 1,
        comparison: 'constant_time_digest',
      };
    case 'version_2_jwk_published':
      return {
        published_key_ids: ['1', '2'],
        current_signing_key_id: '1',
        publication_state: 'prepublished',
        cache_control: 'public_bounded',
        revision_id: CONTROL_PLANE_REVISION,
        deployed_source_sha256: CONTROL_PLANE_SOURCE_SHA256,
        runtime_signing_projection_sha256:
          SIGNING_PROJECTION_SHA256.version_1_current_both_published,
      };
    case 'version_1_last_issuance':
      return {
        published_key_ids: ['1', '2'],
        signing_key_id: '1',
        issuance_boundary: 'last',
        revision_id: CONTROL_PLANE_REVISION,
        deployed_source_sha256: CONTROL_PLANE_SOURCE_SHA256,
        runtime_signing_projection_sha256:
          SIGNING_PROJECTION_SHA256.version_1_current_both_published,
      };
    case 'version_2_first_issuance':
      return {
        published_key_ids: ['1', '2'],
        signing_key_id: '2',
        issuance_boundary: 'first',
        revision_id: CONTROL_PLANE_ACTIVATION_REVISION,
        deployed_source_sha256: CONTROL_PLANE_SOURCE_SHA256,
        runtime_signing_projection_sha256:
          SIGNING_PROJECTION_SHA256.version_2_current_both_published,
      };
    case 'version_1_jwk_retained':
      return {
        published_key_ids: ['1', '2'],
        retired_key_id: '1',
        lifecycle_state: 'retained',
        cache_control: 'public_bounded',
        revision_id: CONTROL_PLANE_ACTIVATION_REVISION,
        deployed_source_sha256: CONTROL_PLANE_SOURCE_SHA256,
        runtime_signing_projection_sha256:
          SIGNING_PROJECTION_SHA256.version_2_current_both_published,
      };
    case 'version_1_jwk_removed':
      return {
        published_key_ids: ['2'],
        retired_key_id: '1',
        lifecycle_state: 'removed',
        cache_control: 'public_bounded',
        revision_id: CONTROL_PLANE_RETIREMENT_REVISION,
        deployed_source_sha256: CONTROL_PLANE_SOURCE_SHA256,
        runtime_signing_projection_sha256:
          SIGNING_PROJECTION_SHA256.version_2_current_only_published,
      };
    case 'exchange_summary':
      return {
        scope: browser === 'chromium'
          ? 'shared_setup_and_chromium_invocation'
          : `${browser}_invocation`,
        successful_exchanges: browser === 'chromium' ? 8 : 1,
        home_key_exchanges: browser === 'chromium' ? 2 : 0,
        user_relay_exchanges: browser === 'chromium' ? 6 : 1,
        request_count_source: 'operation_scoped_control_plane_exchange_ledger',
        public_key_ids: browser === 'chromium' ? ['1', '2'] : ['2'],
        revision_ids: browser === 'chromium'
          ? [
            CONTROL_PLANE_REVISION,
            CONTROL_PLANE_ACTIVATION_REVISION,
            CONTROL_PLANE_RETIREMENT_REVISION,
          ]
          : [CONTROL_PLANE_ACTIVATION_REVISION],
        deployed_source_sha256: CONTROL_PLANE_SOURCE_SHA256,
        runtime_signing_projection_sha256s: browser === 'chromium'
          ? [
            SIGNING_PROJECTION_SHA256.version_1_current_both_published,
            SIGNING_PROJECTION_SHA256.version_2_current_both_published,
            SIGNING_PROJECTION_SHA256.version_2_current_only_published,
          ]
          : [SIGNING_PROJECTION_SHA256.version_2_current_both_published],
      };
    case 'version_2_existing_socket':
      return {
        key_id: '2',
        result: 'accepted',
        socket_generation: 1,
        session_kind: 'reauthentication',
      };
    case 'version_2_session':
    case 'new_session_version_2':
      return { key_id: '2', result: 'accepted', session_kind: 'new' };
    case 'wrong_audience_denial':
      return {
        credential_class: 'wrong_audience',
        result: 'denied',
        protocol_state: 'rejected_before_welcome',
      };
    case 'wrong_home_denial':
      return {
        credential_class: 'wrong_home',
        result: 'denied',
        protocol_state: 'rejected_before_welcome',
      };
    case 'wrong_role_denial':
      return {
        credential_class: 'wrong_role',
        result: 'denied',
        protocol_state: 'rejected_before_welcome',
      };
    case 'unknown_kid_refresh':
      return {
        credential_class: 'unknown_key',
        result: 'denied',
        verification_attempts: 8,
        jwks_fetches: 1,
        duration_milliseconds: 1_000,
      };
    case 'disconnect_reconnect_resync':
      return {
        disconnects: 1,
        reconnects: 1,
        state_resyncs: 1,
        duration_milliseconds: 2_000,
        final_state: 'ready_authoritative',
      };
    case 'revision_summary':
      return {
        revision_ids: browser === 'chromium'
          ? [RELAY_A_REVISION, RELAY_B_REVISION]
          : [RELAY_B_REVISION],
        serving_state: 'ready_reconciled',
      };
    case 'physical_call_delivery':
      return {
        logical_calls: 4,
        physical_dispatches: 4,
        physical_replays: 0,
        reconnects: 1,
      };
    case 'signature_summary':
      return {
        scope: browser === 'chromium'
          ? 'shared_setup_and_chromium_invocation'
          : `${browser}_invocation`,
        algorithm: 'EC_SIGN_ED25519',
        signing_rpc_count_total: browser === 'chromium' ? 8 : 1,
        version_1_signing_rpc_count: browser === 'chromium' ? 2 : 0,
        version_2_signing_rpc_count: browser === 'chromium' ? 6 : 1,
        verified_distinct_signatures_total: browser === 'chromium' ? 8 : 1,
        version_1_verified_distinct_signatures: browser === 'chromium' ? 2 : 0,
        version_2_verified_distinct_signatures: browser === 'chromium' ? 6 : 1,
        request_count_source: 'operation_scoped_kms_signer_ledger',
        verification_source: 'kms_public_key',
      };
    case 'version_1_lifecycle':
      return {
        key_version: 1,
        state: 'DISABLED',
        destroy_time_state: 'absent',
        key_material_state: 'retained_reenableable',
      };
    case 'authoritative_route_transition':
      return {
        document_scope: 'exact_synthetic_home',
        read_consistency: 'strong',
        route_before: 'relay-a',
        route_after: 'relay-b',
        update_order: 'before_precedes_after',
        retention_mode: 'sanitized_projection_only',
      };
    case 'operation_write_summary':
      return {
        scope: 'synthetic_operation_through_matrix_close',
        observed_write_count: 8,
        observation_source: 'sanitized_firestore_commit_ledger',
        retention_mode: 'count_only',
      };
    default:
      throw new Error(`Missing test observation for ${kind}`);
  }
}

function elapsed(browser, source, kind, sequence) {
  if (kind === 'version_2_jwk_published') return 5_000;
  if (kind === 'version_1_last_issuance') return 6_000;
  if (kind === 'version_2_first_issuance') return 270_000;
  if (kind === 'atomic_credential_reuse') return 542_000;
  if (kind === 'version_1_jwk_retained') return 570_000;
  if (kind === 'version_1_jwk_removed') return 580_000;
  if (kind === 'exchange_summary' && sequence > 1) return 590_000;
  if (browser === 'chromium' && source === 'relay') {
    if (kind === 'version_2_existing_socket') return 271_000;
    if (kind === 'new_session_version_2') return 591_000;
    if (kind === 'revision_summary') return 592_000;
    return 541_000 + sequence * 1_000;
  }
  if (browser === 'chromium' && source === 'kms') {
    return kind === 'signature_summary' ? 590_000 : 593_000;
  }
  if (browser === 'chromium' && source === 'coordinator') return 548_000;
  if (browser === 'chromium' && source === 'firestore') {
    return kind === 'authoritative_route_transition' ? 541_000 : 594_000;
  }
  return sequence * 1_000;
}

function fact(browser, source, sequence, kind, overrides = {}) {
  const value = {
    schema: INDEPENDENT_SOURCE_FACT_SCHEMA,
    browser,
    source,
    sequence,
    kind,
    elapsed_milliseconds: elapsed(browser, source, kind, sequence),
    observation: observation(browser, kind),
  };
  return {
    ...value,
    ...overrides,
    observation: overrides.observation ?? value.observation,
  };
}

function facts(browser, source) {
  return FACT_ORDER_BY_BROWSER[browser][source].map((kind, index) => (
    fact(browser, source, index + 1, kind)
  ));
}

function matrixFacts(browser) {
  return Object.fromEntries(INDEPENDENT_SOURCES_BY_BROWSER[browser].map((source) => [
    source,
    facts(browser, source),
  ]));
}

function fullMatrixFacts() {
  return Object.fromEntries(['chromium', 'firefox', 'webkit'].map((browser) => [
    browser,
    matrixFacts(browser),
  ]));
}

function produceBrowserRelayIndependentSourceReceipts(browser, input) {
  const matrix = fullMatrixFacts();
  matrix[browser] = input;
  return produceBrowserRelayIndependentRunnerResult(runnerInput(matrix));
}

function emptyCounters() {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
}

function pageReceipt(browser) {
  const counters = emptyCounters();
  counters.maximum_active_websockets = 1;
  return {
    schema: SOURCE_RECEIPT_SCHEMA,
    browser,
    source: 'browser_page',
    state: 'observed_closed',
    assertions: Object.fromEntries(
      SOURCE_ASSERTIONS[browser].browser_page.map((assertion) => [assertion, true]),
    ),
    counters,
    public_key_ids: [],
    revision_ids: [],
    stable_outcome_classes: browser === 'chromium' ? [...STABLE_OUTCOME_CLASSES] : [],
  };
}

function runnerInput(factValuesByBrowser = fullMatrixFacts()) {
  return {
    fact_values_by_browser: factValuesByBrowser,
    page_receipts_by_browser: Object.fromEntries(
      ['chromium', 'firefox', 'webkit'].map((browser) => [browser, pageReceipt(browser)]),
    ),
    engine_durations_milliseconds: {
      chromium: 600_000,
      firefox: 10_000,
      webkit: 10_000,
    },
    browser_start_elapsed_milliseconds: {
      chromium: 0,
      firefox: 551_000,
      webkit: 554_000,
    },
    page_receipt_closed_elapsed_milliseconds_by_browser: {
      chromium: 550_000,
      firefox: 553_000,
      webkit: 556_000,
    },
    total_duration_milliseconds: 620_000,
  };
}

function minimumDurationMatrixFacts() {
  const matrix = fullMatrixFacts();
  const elapsedByKind = {
    version_2_jwk_published: 5_000,
    version_1_last_issuance: 6_000,
    version_2_first_issuance: 65_000,
    atomic_credential_reuse: 70_000,
    version_1_jwk_retained: 336_000,
    version_1_jwk_removed: 336_001,
    exchange_summary: 336_002,
    version_2_existing_socket: 65_001,
    wrong_audience_denial: 71_000,
    wrong_home_denial: 72_000,
    wrong_role_denial: 73_000,
    unknown_kid_refresh: 74_000,
    disconnect_reconnect_resync: 75_000,
    new_session_version_2: 336_003,
    revision_summary: 336_004,
    physical_call_delivery: 76_000,
    signature_summary: 336_002,
    version_1_lifecycle: 336_003,
    authoritative_route_transition: 69_001,
    operation_write_summary: 336_005,
  };
  for (const sourceFacts of Object.values(matrix.chromium)) {
    for (const sourceFact of sourceFacts) {
      if (elapsedByKind[sourceFact.kind] !== undefined) {
        sourceFact.elapsed_milliseconds = elapsedByKind[sourceFact.kind];
      }
    }
  }
  return matrix;
}

test('pins fifteen dormant non-page receipt producers with no live authority', () => {
  const profile = validateBrowserRelayIndependentObserversProfile();
  assert.deepEqual(SIGNING_PROJECTION_SHA256, {
    version_1_current_both_published:
      '6e37bb7fd4f1c327414f6dceee0222d2790821544b6c58e367dd5e28175fed8c',
    version_2_current_both_published:
      'c397b4e5d0017c16c5032b707ddf39f4b60601837fc747763fce31b6fd253b85',
    version_2_current_only_published:
      '1358948605a1dab42885893023458424599d19306de3169e210cbd8f8c75099e',
  });
  assert.equal(
    browserRelayIndependentDependencyContractsSha256(),
    INDEPENDENT_OBSERVERS_DEPENDENCY_CONTRACTS_SHA256,
  );
  assert.equal(profile.observers.source_receipts_per_matrix, 15);
  assert.equal(profile.observers.facts_per_matrix, 43);
  assert.equal(profile.observers.distinct_fact_kinds, 32);
  assert.equal(profile.observers.source_receipts_per_matrix,
    INDEPENDENT_SOURCE_RECEIPTS_PER_MATRIX);
  assert.equal(profile.observers.facts_per_matrix, INDEPENDENT_FACTS_PER_MATRIX);
  assert.equal(profile.observers.distinct_fact_kinds, INDEPENDENT_DISTINCT_FACT_KINDS);
  assert.equal(profile.observers.cross_source_counter_parity_exact, true);
  assert.equal(profile.observers.assertion_boolean_inputs, false);
  assert.equal(profile.observers.transport_adapters_present, false);
  assert.equal(
    profile.pins.browser_relay_page_receipt_profile_sha256,
    PAGE_RECEIPT_PROFILE_SHA256,
  );
  assert.equal(profile.compatibility.complete_receipt_count, 18);
  assert.equal(profile.compatibility.offline_aggregator_integration_present, true);
  assert.equal(profile.compatibility.runner_result_producer_present, true);
  assert.equal(profile.compatibility.live_aggregator_wired, false);
  assert.equal(profile.compatibility.common_operation_provenance_present, false);
  assert.equal(profile.compatibility.cross_source_timeline_bound, true);
  assert.equal(profile.compatibility.canonical_live_case_order_preserved, true);
  assert.equal(profile.compatibility.current_sequential_runner_compatible, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(profile.evidence.live_source_receipts, 0);
  assert.match(INDEPENDENT_OBSERVERS_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(Object.keys(independentObserverModule), [
    'produceBrowserRelayIndependentRunnerResult',
  ]);
});

test('produces every independent receipt from exact source-owned facts', () => {
  const result = produceBrowserRelayIndependentRunnerResult(runnerInput());
  assert.equal(result.state, 'succeeded_closed_output');
  assert.equal(result.browser_invocations, 3);
  assert.deepEqual(result.engine_results.map((engine) => engine.assertions_passed), [36, 2, 2]);
});

test('combines the fifteen receipts with page evidence into all three engine results', () => {
  const result = produceBrowserRelayIndependentRunnerResult(runnerInput());
  assert.equal(result.assertions_passed, 40);
  assert.equal(result.browser_invocations, 3);
  assert.deepEqual(result.counters, {
    app_check_assessments: 3,
    control_plane_exchanges: 10,
    kms_signatures: 10,
    firestore_writes: 8,
    maximum_active_websockets: 1,
    source_credentials_on_websocket: 0,
    browser_credential_persistence_events: 0,
    physical_call_replays: 0,
  });
  assert.deepEqual(result.public_key_ids, ['1', '2']);
  assert.deepEqual(result.revision_ids, [
    CONTROL_PLANE_REVISION,
    CONTROL_PLANE_ACTIVATION_REVISION,
    CONTROL_PLANE_RETIREMENT_REVISION,
    RELAY_A_REVISION,
    RELAY_B_REVISION,
  ]);
});

test('rejects private, asserted, missing and out-of-order source facts', () => {
  const privateFact = fact('firefox', 'kms', 1, 'signature_summary', {
    token: 'eyJprivatevalue.privatevalue.privatevalue',
  });
  assert.throws(
    () => validateIndependentSourceFact(privateFact, 'firefox', 'kms', 1),
    /private material|forbidden/u,
  );
  const booleanClaim = fact('firefox', 'kms', 1, 'signature_summary', {
    assertions: { kms_signature_is_valid: true },
  });
  assert.throws(
    () => validateIndependentSourceFact(booleanClaim, 'firefox', 'kms', 1),
    /reviewed fields/u,
  );

  const outOfOrder = matrixFacts('chromium');
  outOfOrder.hosting.reverse();
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', outOfOrder),
    /management_site_configuration and failed closed/u,
  );

  const incomplete = matrixFacts('chromium');
  incomplete.kms.pop();
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', incomplete),
    /before every reviewed fact/u,
  );
});

test('rejects hidden properties and accessors without evaluating them', () => {
  const symbolFact = facts('firefox', 'kms')[0];
  symbolFact[Symbol('token')] = 'private material';
  assert.throws(
    () => validateIndependentSourceFact(symbolFact, 'firefox', 'kms', 1),
    /enumerable string data fields/u,
  );

  const nonEnumerableFact = facts('firefox', 'kms')[0];
  Object.defineProperty(nonEnumerableFact, 'token', {
    value: 'private material',
    enumerable: false,
  });
  assert.throws(
    () => validateIndependentSourceFact(nonEnumerableFact, 'firefox', 'kms', 1),
    /enumerable string data fields/u,
  );

  let getterEvaluated = false;
  const accessorFact = facts('firefox', 'kms')[0];
  Object.defineProperty(accessorFact.observation, 'verification_source', {
    enumerable: true,
    get() {
      getterEvaluated = true;
      throw new Error('must not escape');
    },
  });
  assert.throws(
    () => validateIndependentSourceFact(accessorFact, 'firefox', 'kms', 1),
    /enumerable string data fields/u,
  );
  assert.equal(getterEvaluated, false);
});

test('rejects cyclic, excessively deep and oversized sanitized input with one error class', () => {
  const cyclic = runnerInput();
  cyclic.repeated = cyclic;
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(cyclic),
    (error) => error instanceof StagingBrowserRelayIndependentObserverError
      && /repeated object identity/u.test(error.message),
  );

  const deep = runnerInput();
  let cursor = {};
  deep.deep = cursor;
  for (let depth = 0; depth < 40; depth += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(deep),
    (error) => error instanceof StagingBrowserRelayIndependentObserverError
      && /bounded sanitized data graph/u.test(error.message),
  );

  const oversized = runnerInput();
  oversized.oversized = 'x'.repeat(16_385);
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(oversized),
    (error) => error instanceof StagingBrowserRelayIndependentObserverError
      && /sanitized string bound/u.test(error.message),
  );

  const cumulative = runnerInput();
  cumulative.cumulative = Array.from({ length: 65 }, () => 'x'.repeat(16_384));
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(cumulative),
    (error) => error instanceof StagingBrowserRelayIndependentObserverError
      && /sanitized character budget/u.test(error.message),
  );
});

test('cross-checks App Check, control-plane, relay, KMS and Firestore semantics', () => {
  const appCheck = matrixFacts('chromium');
  appCheck.firebase_app_check[4].observation.repeated_valid_verifications = 3;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', appCheck),
    /verification_mode and failed closed/u,
  );

  const controlPlane = matrixFacts('chromium');
  controlPlane.control_plane[6].elapsed_milliseconds = 64_999;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', controlPlane),
    /version_2_first_issuance and failed closed/u,
  );

  const retention = matrixFacts('chromium');
  retention.control_plane[5].elapsed_milliseconds = 220_000;
  retention.control_plane[8].elapsed_milliseconds = 549_999;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', retention),
    /version_1_jwk_retained and failed closed/u,
  );

  const removal = matrixFacts('chromium');
  removal.control_plane[9].elapsed_milliseconds =
    removal.control_plane[8].elapsed_milliseconds;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', removal),
    /version_1_jwk_removed and failed closed/u,
  );

  const cors = matrixFacts('chromium');
  cors.control_plane[0].observation.allow_origin = '*';
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', cors),
    /cors_preflight and failed closed/u,
  );

  const admission = matrixFacts('chromium');
  admission.control_plane[2].observation.user_budget = 'user_relay.exchange.source';
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', admission),
    /source_uid_admission and failed closed/u,
  );

  const atomicReuse = matrixFacts('chromium');
  atomicReuse.control_plane[7].observation.handoff_reexchange_requests = 1;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', atomicReuse),
    /atomic_credential_reuse and failed closed/u,
  );

  const controlPlaneRevision = matrixFacts('chromium');
  controlPlaneRevision.control_plane[10].observation.revision_ids[1] =
    'control-plane-00013-new';
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', controlPlaneRevision),
    /exchange_summary and failed closed/u,
  );

  const relay = matrixFacts('chromium');
  relay.relay[7].observation.revision_ids = [RELAY_B_REVISION];
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', relay),
    /revision_summary and failed closed/u,
  );

  const relayRevision = matrixFacts('webkit');
  relayRevision.relay[1].observation.revision_ids = ['miakapp-staging-relay-b-00003-new'];
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('webkit', relayRevision),
    /revision_summary and failed closed/u,
  );

  const unknownKid = matrixFacts('chromium');
  unknownKid.relay[4].observation.jwks_fetches = 2;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', unknownKid),
    /unknown_kid_refresh and failed closed/u,
  );

  const kms = matrixFacts('chromium');
  kms.kms[1].observation.state = 'DESTROYED';
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', kms),
    /version_1_lifecycle and failed closed/u,
  );

  const retriedKms = matrixFacts('chromium');
  retriedKms.kms[0].observation.signing_rpc_count_total = 7;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', retriedKms),
    /signature_summary and failed closed/u,
  );

  const duplicateKmsSignature = matrixFacts('chromium');
  duplicateKmsSignature.kms[0].observation.verified_distinct_signatures_total = 7;
  duplicateKmsSignature.kms[0].observation.version_2_verified_distinct_signatures = 5;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts(
      'chromium',
      duplicateKmsSignature,
    ),
    /signature_summary and failed closed/u,
  );

  const coordinator = matrixFacts('chromium');
  coordinator.coordinator[0].observation.logical_calls = 1;
  coordinator.coordinator[0].observation.physical_dispatches = 1;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', coordinator),
    /physical_call_delivery and failed closed/u,
  );

  const firestore = matrixFacts('chromium');
  firestore.firestore[0].observation.route_after = 'relay-a';
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', firestore),
    /authoritative_route_transition and failed closed/u,
  );
});

test('rejects missing, extra and unreviewed matrix owners', () => {
  const missing = matrixFacts('firefox');
  delete missing.kms;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('firefox', missing),
    /every reviewed source exactly once/u,
  );
  const extra = matrixFacts('webkit');
  extra.hosting = [];
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('webkit', extra),
    /every reviewed source exactly once/u,
  );
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('safari', {}),
    /exactly the three reviewed browsers/u,
  );
});

test('enforces monotonic facts, exact fact counts and array input', () => {
  const nonmonotonic = matrixFacts('chromium');
  nonmonotonic.kms[0].elapsed_milliseconds = 594_000;
  nonmonotonic.kms[1].elapsed_milliseconds = 593_000;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', nonmonotonic),
    /version_1_lifecycle and failed closed/u,
  );

  const overrun = matrixFacts('firefox');
  overrun.kms.push(facts('firefox', 'kms')[0]);
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('firefox', overrun),
    /too many source facts/u,
  );

  const nonArray = matrixFacts('firefox');
  nonArray.kms = new Set();
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('firefox', nonArray),
    /sanitized JSON data|one ordered array/u,
  );
});

test('reconciles operation-scoped control-plane and KMS request ledgers', () => {
  const input = matrixFacts('chromium');
  input.kms[0].observation.signing_rpc_count_total = 9;
  input.kms[0].observation.version_2_signing_rpc_count = 7;
  input.kms[0].observation.verified_distinct_signatures_total = 9;
  input.kms[0].observation.version_2_verified_distinct_signatures = 7;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', input),
    /ledgers do not reconcile/u,
  );
});

test('reconciles the cross-source rotation timeline before emitting receipts', () => {
  const earlyExistingSocket = matrixFacts('chromium');
  earlyExistingSocket.relay[0].elapsed_milliseconds = 269_999;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', earlyExistingSocket),
    /timeline places relay\.version_2_existing_socket/u,
  );

  const earlyRoute = matrixFacts('chromium');
  earlyRoute.firestore[0].elapsed_milliseconds = 270_000;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', earlyRoute),
    /timeline places firestore\.authoritative_route_transition/u,
  );

  const earlyDenial = matrixFacts('chromium');
  earlyDenial.relay[1].elapsed_milliseconds = 541_000;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', earlyDenial),
    /timeline places relay\.wrong_audience_denial/u,
  );

  const earlyPostRetirementSession = matrixFacts('chromium');
  earlyPostRetirementSession.relay[6].elapsed_milliseconds = 579_999;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', earlyPostRetirementSession),
    /timeline places relay\.new_session_version_2/u,
  );

  const earlyKmsDisable = matrixFacts('chromium');
  earlyKmsDisable.kms[0].elapsed_milliseconds = 579_000;
  earlyKmsDisable.kms[1].elapsed_milliseconds = 579_999;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', earlyKmsDisable),
    /timeline places kms\.version_1_lifecycle/u,
  );

  const lateAuthoritativeRoute = matrixFacts('chromium');
  lateAuthoritativeRoute.firestore[0].elapsed_milliseconds = 543_000;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('chromium', lateAuthoritativeRoute),
    /timeline places control_plane\.atomic_credential_reuse/u,
  );

  const earlySecondarySession = matrixFacts('firefox');
  earlySecondarySession.relay[0].elapsed_milliseconds = 0;
  assert.throws(
    () => produceBrowserRelayIndependentSourceReceipts('firefox', earlySecondarySession),
    /timeline places relay\.version_2_session/u,
  );
});

test('reconciles one control-plane activation revision across all browsers', () => {
  const input = fullMatrixFacts();
  input.firefox.control_plane[0].observation.revision_ids = ['control-plane-00011-alt'];
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(runnerInput(input)),
    /do not share Chromium activation revision lineage/u,
  );
});

test('requires engine and runner durations to cover every accepted fact', () => {
  const shortEngine = runnerInput();
  shortEngine.engine_durations_milliseconds.chromium = 593_999;
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(shortEngine),
    /chromium engine duration ends before its independent source facts/u,
  );

  const shortRunner = runnerInput();
  shortRunner.total_duration_milliseconds = 619_999;
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(shortRunner),
    /Runner duration is shorter than its engine durations/u,
  );

  const shortPageTimeline = runnerInput(minimumDurationMatrixFacts());
  shortPageTimeline.browser_start_elapsed_milliseconds.firefox = 80_000;
  shortPageTimeline.browser_start_elapsed_milliseconds.webkit = 90_000;
  shortPageTimeline.page_receipt_closed_elapsed_milliseconds_by_browser.chromium =
    MINIMUM_CHROMIUM_ENGINE_DURATION_MILLISECONDS - 1;
  shortPageTimeline.page_receipt_closed_elapsed_milliseconds_by_browser.firefox = 82_000;
  shortPageTimeline.page_receipt_closed_elapsed_milliseconds_by_browser.webkit = 92_000;
  shortPageTimeline.engine_durations_milliseconds.chromium =
    MINIMUM_CHROMIUM_ENGINE_DURATION_MILLISECONDS - 1;
  shortPageTimeline.total_duration_milliseconds =
    Object.values(shortPageTimeline.engine_durations_milliseconds)
      .reduce((total, duration) => total + duration, 0);
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(shortPageTimeline),
    /cannot contain both scheduled page renewals/u,
  );
});

test('uses one explicit operation clock for canonical secondary-browser ordering', () => {
  const beforeLiveTen = runnerInput();
  beforeLiveTen.browser_start_elapsed_milliseconds.firefox = 549_000;
  beforeLiveTen.page_receipt_closed_elapsed_milliseconds_by_browser.firefox = 551_000;
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(beforeLiveTen),
    /firefox browser window is not globally bracketed between LIVE-09 and LIVE-11/u,
  );

  const afterLiveTen = runnerInput();
  afterLiveTen.browser_start_elapsed_milliseconds.webkit = 569_000;
  afterLiveTen.page_receipt_closed_elapsed_milliseconds_by_browser.webkit = 571_000;
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(afterLiveTen),
    /webkit browser window is not globally bracketed between LIVE-09 and LIVE-11/u,
  );

  const outsideOperation = runnerInput();
  outsideOperation.engine_durations_milliseconds.webkit = 70_000;
  assert.throws(
    () => produceBrowserRelayIndependentRunnerResult(outsideOperation),
    /webkit engine duration exceeds the operation timeline/u,
  );
});

test('guards the exact dormant independent-observer package', () => {
  const names = ['README.md', 'contract.mjs', 'guard.mjs', 'observers.mjs', 'profile.json'];
  validateBrowserRelayIndependentObserversRoot(
    new URL('../browser-relay-independent-observers/', import.meta.url),
  );

  const extraRoot = mkdtempSync(join(tmpdir(), 'miakapp-independent-observers-extra-'));
  for (const name of names) {
    copyFileSync(
      new URL(`../browser-relay-independent-observers/${name}`, import.meta.url),
      join(extraRoot, name),
    );
    chmodSync(join(extraRoot, name), 0o600);
  }
  writeFileSync(join(extraRoot, 'run.sh'), '#!/bin/sh\n');
  assert.throws(
    () => validateBrowserRelayIndependentObserversRoot(new URL(`file://${extraRoot}/`)),
    /reviewed inventory/u,
  );

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-independent-observers-link-'));
  for (const name of names.filter((entry) => entry !== 'README.md')) {
    copyFileSync(
      new URL(`../browser-relay-independent-observers/${name}`, import.meta.url),
      join(symlinkRoot, name),
    );
    chmodSync(join(symlinkRoot, name), 0o600);
  }
  symlinkSync(
    new URL('../browser-relay-independent-observers/README.md', import.meta.url),
    join(symlinkRoot, 'README.md'),
  );
  assert.throws(
    () => validateBrowserRelayIndependentObserversRoot(new URL(`file://${symlinkRoot}/`)),
    /regular files/u,
  );

  const networkRoot = mkdtempSync(join(tmpdir(), 'miakapp-independent-observers-network-'));
  for (const name of names) {
    copyFileSync(
      new URL(`../browser-relay-independent-observers/${name}`, import.meta.url),
      join(networkRoot, name),
    );
    chmodSync(join(networkRoot, name), 0o600);
  }
  const contractPath = join(networkRoot, 'contract.mjs');
  writeFileSync(contractPath, `${readFileSync(contractPath, 'utf8')}\nvoid fetch('https://invalid.test');\n`);
  assert.throws(
    () => validateBrowserRelayIndependentObserversRoot(new URL(`file://${networkRoot}/`)),
    /dormant source-only libraries/u,
  );

  const importRoot = mkdtempSync(join(tmpdir(), 'miakapp-independent-observers-import-'));
  for (const name of names) {
    copyFileSync(
      new URL(`../browser-relay-independent-observers/${name}`, import.meta.url),
      join(importRoot, name),
    );
    chmodSync(join(importRoot, name), 0o600);
  }
  const observerPath = join(importRoot, 'observers.mjs');
  writeFileSync(
    observerPath,
    readFileSync(observerPath, 'utf8').replace("from './contract.mjs';", "from 'node:http';"),
  );
  assert.throws(
    () => validateBrowserRelayIndependentObserversRoot(new URL(`file://${importRoot}/`)),
    /source-only allowlist/u,
  );
});
