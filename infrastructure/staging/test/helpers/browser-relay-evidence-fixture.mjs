import {
  CONTROL_PLANE_SIGNING_PROJECTIONS,
  FACT_ORDER_BY_BROWSER,
  INDEPENDENT_SOURCE_FACT_SCHEMA,
  INDEPENDENT_SOURCES_BY_BROWSER,
  controlPlaneSigningProjectionSha256,
} from '../../browser-relay-independent-observers/contract.mjs';
import {
  PAGE_FACT_ORDER_BY_BROWSER,
  PAGE_FACT_SCHEMA,
  PAGE_LIFECYCLE_EVENT_SCHEMA,
} from '../../browser-relay-page-receipt/contract.mjs';

const STATUS_READY = ['connecting', 'authenticating', 'synchronizing', 'ready'];

function pageObservation(browser, overrides = {}) {
  return {
    schema: 'miakapp.staging-browser-relay-page-observation/1',
    browser,
    state: 'initialized',
    client_instances: 1,
    firebase_auth_sessions: 1,
    app_check_instances: 1,
    firebase_token_requests: 0,
    app_check_token_requests: 0,
    control_plane_exchanges: 0,
    exchange_cache_conformant: true,
    websocket_connections: 0,
    active_websockets: 0,
    maximum_active_websockets: 0,
    source_credentials_on_websocket: 0,
    browser_credential_persistence_events: 0,
    relay_ids: [],
    client_statuses: [],
    failure_classes: [],
    duration_milliseconds: 0,
    ...overrides,
  };
}

function matched(revision) {
  return {
    schema: 'miakapp.staging-browser-relay-page-state-observation/1',
    state: 'matched',
    revision,
    stale: false,
  };
}

function stale(revision) {
  return {
    schema: 'miakapp.staging-browser-relay-page-state-observation/1',
    state: 'pending',
    revision,
    stale: true,
  };
}

function applied() {
  return {
    schema: 'miakapp.staging-browser-relay-page-call-observation/1',
    state: 'completed',
    outcome: 'applied',
  };
}

function lifecycle(type) {
  return {
    schema: PAGE_LIFECYCLE_EVENT_SCHEMA,
    type,
    visibility_state: type === 'pagehide' ? 'hidden' : 'visible',
    persisted: true,
  };
}

function lifecycleObservation(browser, overrides = {}) {
  return {
    schema: 'miakapp.staging-browser-relay-page-lifecycle-observation/1',
    browser,
    events: [],
    suspensions: 0,
    resumptions: 0,
    sign_outs: 0,
    disposals: 0,
    state_transitions: [],
    call_outcomes: [],
    ...overrides,
  };
}

function pageFact(browser, sequence, elapsed, pageObservation, extras = {}) {
  const pageInstance = browser === 'chromium' && sequence >= 16 ? 2 : 1;
  return {
    schema: PAGE_FACT_SCHEMA,
    browser,
    sequence,
    phase: PAGE_FACT_ORDER_BY_BROWSER[browser][sequence - 1],
    page_instance: pageInstance,
    input_generation: pageInstance,
    identity_generation: pageInstance,
    elapsed_milliseconds: elapsed,
    observation: pageObservation,
    lifecycle_observation: lifecycleObservation(browser),
    state_observation: null,
    call_observation: null,
    lifecycle_event: null,
    ...extras,
  };
}

export function chromiumPageFacts() {
  const initializedLifecycle = lifecycleObservation('chromium');
  const readyLifecycle = lifecycleObservation('chromium', {
    state_transitions: [{ revision: 1, stale: false }],
  });
  const patchedLifecycle = lifecycleObservation('chromium', {
    state_transitions: [
      { revision: 1, stale: false },
      { revision: 2, stale: false },
    ],
  });
  const initialCallLifecycle = lifecycleObservation('chromium', {
    state_transitions: patchedLifecycle.state_transitions,
    call_outcomes: ['applied'],
  });
  const handoffLifecycle = lifecycleObservation('chromium', {
    state_transitions: [
      ...patchedLifecycle.state_transitions,
      { revision: 2, stale: true },
    ],
    call_outcomes: initialCallLifecycle.call_outcomes,
  });
  const readyBLifecycle = lifecycleObservation('chromium', {
    state_transitions: [
      ...handoffLifecycle.state_transitions,
      { revision: 3, stale: false },
    ],
    call_outcomes: initialCallLifecycle.call_outcomes,
  });
  const relayBCallLifecycle = lifecycleObservation('chromium', {
    state_transitions: readyBLifecycle.state_transitions,
    call_outcomes: ['applied', 'applied'],
  });
  const uncertainLifecycle = lifecycleObservation('chromium', {
    state_transitions: [
      ...readyBLifecycle.state_transitions,
      { revision: 4, stale: true },
    ],
    call_outcomes: ['applied', 'applied', 'failed', 'outcome_unknown'],
  });
  const recoveredLifecycle = lifecycleObservation('chromium', {
    state_transitions: [
      ...uncertainLifecycle.state_transitions,
      { revision: 4, stale: false },
    ],
    call_outcomes: uncertainLifecycle.call_outcomes,
  });
  const suspendedLifecycle = lifecycleObservation('chromium', {
    events: [{ event: 'pagehide', persisted: true }],
    suspensions: 1,
    state_transitions: recoveredLifecycle.state_transitions,
    call_outcomes: recoveredLifecycle.call_outcomes,
  });
  const restoredLifecycle = lifecycleObservation('chromium', {
    events: [
      ...suspendedLifecycle.events,
      { event: 'pageshow', persisted: true },
    ],
    suspensions: 1,
    resumptions: 1,
    state_transitions: recoveredLifecycle.state_transitions,
    call_outcomes: recoveredLifecycle.call_outcomes,
  });
  const stoppedLifecycle = lifecycleObservation('chromium', {
    ...restoredLifecycle,
    sign_outs: 1,
    disposals: 1,
  });
  const replacementReadyLifecycle = lifecycleObservation('chromium', {
    state_transitions: [{ revision: 1, stale: false }],
  });
  const replacementStoppedLifecycle = lifecycleObservation('chromium', {
    ...replacementReadyLifecycle,
    sign_outs: 1,
    disposals: 1,
  });
  const readyA = pageObservation('chromium', {
    state: 'ready',
    firebase_token_requests: 1,
    app_check_token_requests: 1,
    control_plane_exchanges: 1,
    websocket_connections: 1,
    active_websockets: 1,
    maximum_active_websockets: 1,
    relay_ids: ['relay-a'],
    client_statuses: STATUS_READY,
    duration_milliseconds: 1_000,
  });
  const reauthenticated = {
    ...readyA,
    firebase_token_requests: 2,
    app_check_token_requests: 2,
    control_plane_exchanges: 2,
    duration_milliseconds: 271_000,
  };
  const handoff = {
    ...reauthenticated,
    firebase_token_requests: 3,
    app_check_token_requests: 3,
    control_plane_exchanges: 3,
    active_websockets: 0,
    client_statuses: [...STATUS_READY, 'reconnecting'],
    duration_milliseconds: 541_000,
  };
  const readyB = {
    ...handoff,
    websocket_connections: 2,
    active_websockets: 1,
    relay_ids: ['relay-a', 'relay-b'],
    client_statuses: [...handoff.client_statuses, 'ready'],
    duration_milliseconds: 542_000,
  };
  const uncertain = {
    ...readyB,
    active_websockets: 0,
    client_statuses: [...readyB.client_statuses, 'reconnecting'],
    failure_classes: ['internal:accepted', 'unavailable:outcome_unknown'],
    duration_milliseconds: 543_000,
  };
  const recovered = {
    ...uncertain,
    firebase_token_requests: 4,
    app_check_token_requests: 4,
    control_plane_exchanges: 4,
    websocket_connections: 3,
    active_websockets: 1,
    client_statuses: [...uncertain.client_statuses, 'ready'],
    duration_milliseconds: 544_000,
  };
  const suspended = {
    ...recovered,
    state: 'suspended',
    active_websockets: 0,
    client_statuses: [...recovered.client_statuses, 'stopping'],
    duration_milliseconds: 545_000,
  };
  const restored = {
    ...suspended,
    state: 'ready',
    client_instances: 2,
    firebase_token_requests: 5,
    app_check_token_requests: 5,
    control_plane_exchanges: 5,
    websocket_connections: 4,
    active_websockets: 1,
    client_statuses: [
      ...suspended.client_statuses,
      'connecting',
      'authenticating',
      'synchronizing',
      'ready',
    ],
    duration_milliseconds: 546_000,
  };
  const stopped = {
    ...restored,
    state: 'stopped',
    active_websockets: 0,
    client_statuses: [...restored.client_statuses, 'stopping'],
    duration_milliseconds: 547_000,
  };
  const replacementReady = pageObservation('chromium', {
    state: 'ready',
    firebase_token_requests: 1,
    app_check_token_requests: 1,
    control_plane_exchanges: 1,
    websocket_connections: 1,
    active_websockets: 1,
    maximum_active_websockets: 1,
    relay_ids: ['relay-b'],
    client_statuses: STATUS_READY,
    duration_milliseconds: 1_000,
  });
  const replacementStopped = {
    ...replacementReady,
    state: 'stopped',
    active_websockets: 0,
    client_statuses: [...replacementReady.client_statuses, 'stopping'],
    duration_milliseconds: 2_000,
  };
  return [
    pageFact('chromium', 1, 0, pageObservation('chromium'), {
      lifecycle_observation: initializedLifecycle,
    }),
    pageFact('chromium', 2, 1_000, readyA, { lifecycle_observation: readyLifecycle }),
    pageFact('chromium', 3, 1_100, readyA, {
      lifecycle_observation: readyLifecycle,
      state_observation: matched(1),
    }),
    pageFact('chromium', 4, 1_200, readyA, {
      lifecycle_observation: patchedLifecycle,
      state_observation: matched(2),
    }),
    pageFact('chromium', 5, 1_300, readyA, {
      lifecycle_observation: initialCallLifecycle,
      call_observation: applied(),
    }),
    pageFact('chromium', 6, 271_000, reauthenticated, {
      lifecycle_observation: initialCallLifecycle,
    }),
    pageFact('chromium', 7, 541_000, handoff, {
      lifecycle_observation: handoffLifecycle,
      state_observation: stale(3),
    }),
    pageFact('chromium', 8, 542_000, readyB, { lifecycle_observation: readyBLifecycle }),
    pageFact('chromium', 9, 542_100, readyB, {
      lifecycle_observation: readyBLifecycle,
      state_observation: matched(3),
    }),
    pageFact('chromium', 10, 542_200, readyB, {
      lifecycle_observation: relayBCallLifecycle,
      call_observation: applied(),
    }),
    pageFact('chromium', 11, 543_000, uncertain, {
      lifecycle_observation: uncertainLifecycle,
      state_observation: stale(4),
    }),
    pageFact('chromium', 12, 544_000, recovered, {
      lifecycle_observation: recoveredLifecycle,
      state_observation: matched(4),
    }),
    pageFact('chromium', 13, 545_000, suspended, {
      lifecycle_observation: suspendedLifecycle,
      lifecycle_event: lifecycle('pagehide'),
    }),
    pageFact('chromium', 14, 546_000, restored, {
      lifecycle_observation: restoredLifecycle,
      state_observation: matched(4),
      lifecycle_event: lifecycle('pageshow'),
    }),
    pageFact('chromium', 15, 547_000, stopped, {
      lifecycle_observation: stoppedLifecycle,
    }),
    pageFact('chromium', 16, 548_000, pageObservation('chromium'), {
      lifecycle_observation: lifecycleObservation('chromium'),
    }),
    pageFact('chromium', 17, 549_000, replacementReady, {
      lifecycle_observation: replacementReadyLifecycle,
    }),
    pageFact('chromium', 18, 550_000, replacementStopped, {
      lifecycle_observation: replacementStoppedLifecycle,
    }),
  ];
}

export function secondaryPageFacts(browser) {
  const readyLifecycle = lifecycleObservation(browser, {
    state_transitions: [{ revision: 1, stale: false }],
  });
  const stoppedLifecycle = lifecycleObservation(browser, {
    ...readyLifecycle,
    sign_outs: 1,
    disposals: 1,
  });
  const ready = pageObservation(browser, {
    state: 'ready',
    firebase_token_requests: 1,
    app_check_token_requests: 1,
    control_plane_exchanges: 1,
    websocket_connections: 1,
    active_websockets: 1,
    maximum_active_websockets: 1,
    relay_ids: ['relay-b'],
    client_statuses: STATUS_READY,
    duration_milliseconds: 1_000,
  });
  const stopped = {
    ...ready,
    state: 'stopped',
    active_websockets: 0,
    client_statuses: [...ready.client_statuses, 'stopping'],
    duration_milliseconds: 2_000,
  };
  return [
    pageFact(browser, 1, 0, pageObservation(browser)),
    pageFact(browser, 2, 1_000, ready, { lifecycle_observation: readyLifecycle }),
    pageFact(browser, 3, 2_000, stopped, { lifecycle_observation: stoppedLifecycle }),
  ];
}

export const CONTROL_PLANE_REVISION = 'control-plane-00010-vop';
export const CONTROL_PLANE_ACTIVATION_REVISION = 'control-plane-00011-act';
export const CONTROL_PLANE_RETIREMENT_REVISION = 'control-plane-00012-ret';
const CONTROL_PLANE_SOURCE_SHA256 =
  '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e';
export const SIGNING_PROJECTION_SHA256 = Object.freeze(Object.fromEntries(
  Object.entries(CONTROL_PLANE_SIGNING_PROJECTIONS).map(([name, projection]) => [
    name,
    controlPlaneSigningProjectionSha256(projection),
  ]),
));
export const RELAY_A_REVISION = 'miakapp-staging-relay-a-00002-s62';
export const RELAY_B_REVISION = 'miakapp-staging-relay-b-00002-d8z';
const TARGET_ORIGIN = 'https://miakapp-v4-staging.web.app';
const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
function independentObservation(browser, kind) {
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

function independentElapsed(browser, source, kind, sequence) {
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

export function independentFact(browser, source, sequence, kind, overrides = {}) {
  const value = {
    schema: INDEPENDENT_SOURCE_FACT_SCHEMA,
    browser,
    source,
    sequence,
    kind,
    elapsed_milliseconds: independentElapsed(browser, source, kind, sequence),
    observation: independentObservation(browser, kind),
  };
  return {
    ...value,
    ...overrides,
    observation: overrides.observation ?? value.observation,
  };
}

export function independentFacts(browser, source) {
  return FACT_ORDER_BY_BROWSER[browser][source].map((kind, index) => (
    independentFact(browser, source, index + 1, kind)
  ));
}

export function independentFactsBySource(browser) {
  return Object.fromEntries(INDEPENDENT_SOURCES_BY_BROWSER[browser].map((source) => [
    source,
    independentFacts(browser, source),
  ]));
}

export function fullIndependentFacts() {
  return Object.fromEntries(['chromium', 'firefox', 'webkit'].map((browser) => [
    browser,
    independentFactsBySource(browser),
  ]));
}

export function pageProjection(value) {
  return structuredClone({
    observation: value.observation,
    lifecycle_observation: value.lifecycle_observation,
    state_observation: value.state_observation,
    call_observation: value.call_observation,
    lifecycle_event: value.lifecycle_event,
  });
}

export function independentProjection(value) {
  return structuredClone({ observation: value.observation });
}

export {
  lifecycleObservation as pageLifecycleObservation,
  pageObservation,
};
