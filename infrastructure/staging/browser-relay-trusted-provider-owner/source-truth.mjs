import {
  CONTROL_PLANE_SIGNING_PROJECTIONS,
  FACT_ORDER_BY_BROWSER,
  INDEPENDENT_SOURCE_FACT_SCHEMA,
  controlPlaneSigningProjectionSha256,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  TRUSTED_PROVIDER_OWNER_BROWSER_ORDER,
  TRUSTED_PROVIDER_OWNER_CALLS_BY_SOURCE,
  TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS,
  TRUSTED_PROVIDER_OWNER_METHODS_BY_SOURCE,
  TRUSTED_PROVIDER_OWNER_SCOPES_BY_SOURCE,
  TRUSTED_PROVIDER_OWNER_SOURCE_ORDER,
  TRUSTED_PROVIDER_OWNER_VERSION_ONE_RETENTION_MILLISECONDS,
  TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS,
  rejectTrustedProviderOwner,
  validateTrustedProviderOwnerObservation,
} from './contract.mjs';

const CONTROL_PLANE_REVISION = 'control-plane-00010-vop';
const CONTROL_PLANE_ACTIVATION_REVISION = 'control-plane-00011-act';
const CONTROL_PLANE_RETIREMENT_REVISION = 'control-plane-00012-ret';
const CONTROL_PLANE_SOURCE_SHA256 =
  '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e';
const RELAY_A_REVISION = 'miakapp-staging-relay-a-00002-s62';
const RELAY_B_REVISION = 'miakapp-staging-relay-b-00002-d8z';
const TARGET_ORIGIN = 'https://miakapp-v4-staging.web.app';
const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
const PROVIDER_LIFETIME_MILLISECONDS = 15 * 60 * 1000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const INTRINSIC_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const INTRINSIC_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const SIGNING_PROJECTION_SHA256 = Object.freeze(Object.fromEntries(
  Object.entries(CONTROL_PLANE_SIGNING_PROJECTIONS).map(([name, projection]) => [
    name,
    controlPlaneSigningProjectionSha256(projection),
  ]),
));

function reject() {
  return rejectTrustedProviderOwner();
}

function signalAborted(signal) {
  try {
    return Reflect.apply(ABORTED_GETTER, signal, []);
  } catch {
    return reject();
  }
}

export function delayBrowserRelayTrustedProviderOwnerTimeline(milliseconds, signal) {
  if (arguments.length !== 2 || !Number.isSafeInteger(milliseconds) || milliseconds < 1
    || signalAborted(signal)) reject();
  return new Promise((resolve, rejectDelay) => {
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      INTRINSIC_CLEAR_TIMEOUT(timer);
      try {
        Reflect.apply(INTRINSIC_REMOVE_EVENT_LISTENER, signal, ['abort', abort]);
      } catch {}
      callback();
    };
    const abort = () => finish(() => rejectDelay(
      new Error('Trusted provider source timeline was aborted'),
    ));
    try {
      Reflect.apply(INTRINSIC_ADD_EVENT_LISTENER, signal, ['abort', abort, { once: true }]);
      timer = INTRINSIC_SET_TIMEOUT(() => finish(resolve), milliseconds);
      if (signalAborted(signal)) abort();
    } catch {
      finish(() => rejectDelay(new Error('Trusted provider source timeline failed')));
    }
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve, settled: false };
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneObservation(value) {
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function signingDigest(name) {
  const value = SIGNING_PROJECTION_SHA256[name];
  if (typeof value !== 'string') reject();
  return value;
}

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
    case 'invalid_token_denial':
      return {
        result: 'DENY',
        security: kind === 'missing_token_denial' ? 'MISSING' : 'INVALID',
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
          signingDigest('version_1_current_both_published'),
      };
    case 'version_1_last_issuance':
      return {
        published_key_ids: ['1', '2'],
        signing_key_id: '1',
        issuance_boundary: 'last',
        revision_id: CONTROL_PLANE_REVISION,
        deployed_source_sha256: CONTROL_PLANE_SOURCE_SHA256,
        runtime_signing_projection_sha256:
          signingDigest('version_1_current_both_published'),
      };
    case 'version_2_first_issuance':
      return {
        published_key_ids: ['1', '2'],
        signing_key_id: '2',
        issuance_boundary: 'first',
        revision_id: CONTROL_PLANE_ACTIVATION_REVISION,
        deployed_source_sha256: CONTROL_PLANE_SOURCE_SHA256,
        runtime_signing_projection_sha256:
          signingDigest('version_2_current_both_published'),
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
          signingDigest('version_2_current_both_published'),
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
          signingDigest('version_2_current_only_published'),
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
            signingDigest('version_1_current_both_published'),
            signingDigest('version_2_current_both_published'),
            signingDigest('version_2_current_only_published'),
          ]
          : [signingDigest('version_2_current_both_published')],
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
    case 'wrong_home_denial':
    case 'wrong_role_denial':
      return {
        credential_class: {
          wrong_audience_denial: 'wrong_audience',
          wrong_home_denial: 'wrong_home',
          wrong_role_denial: 'wrong_role',
        }[kind],
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
      return reject();
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

function createFact(browser, source, sequence, kind) {
  return {
    schema: INDEPENDENT_SOURCE_FACT_SCHEMA,
    browser,
    source,
    sequence,
    kind,
    elapsed_milliseconds: independentElapsed(browser, source, kind, sequence),
    observation: independentObservation(browser, kind),
  };
}

function exactInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !Object.isFrozen(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['clock', 'delay', 'signal'])) {
    reject();
  }
  if (typeof value.clock !== 'function' || typeof value.delay !== 'function') reject();
  signalAborted(value.signal);
  return value;
}

function factKey(browser, source, sequence) {
  return `${browser}\0${source}\0${sequence}`;
}

export function createBrowserRelayTrustedProviderSourceTruth(inputValue) {
  if (arguments.length !== 1) reject();
  const input = exactInput(inputValue);
  const now = input.clock();
  if (!Number.isSafeInteger(now) || now < 0 || signalAborted(input.signal)) reject();
  const expiresAt = now + PROVIDER_LIFETIME_MILLISECONDS;
  const facts = new Map();
  const consumed = new Set();
  const activeBrowsers = new Set();
  const cursors = Object.fromEntries(
    TRUSTED_PROVIDER_OWNER_SOURCE_ORDER.map((source) => [source, 0]),
  );
  const closedProviders = new Set();
  const activeSources = new Set();
  const poisonedSources = new Set();
  const milestones = Object.fromEntries([
    'version_two_published',
    'version_two_first_issued',
    'route_transitioned',
    'relay_reconnected',
    'firefox_control_summarized',
    'firefox_kms_summarized',
    'webkit_control_summarized',
    'webkit_kms_summarized',
    'version_one_removed',
    'chromium_control_summarized',
    'chromium_kms_summarized',
    'version_one_disabled',
    'version_two_session_opened',
  ].map((name) => [name, deferred()]));
  let versionOneLastIssuanceAt;
  let operationActive = false;
  let closed = false;

  function clockMilliseconds() {
    const value = input.clock();
    if (!Number.isSafeInteger(value) || value < 0) reject();
    return value;
  }

  function mark(name, value = true) {
    const milestone = milestones[name];
    if (milestone === undefined || milestone.settled) reject();
    milestone.settled = true;
    milestone.resolve(value);
    return value;
  }

  async function waitFor(name, signal) {
    const milestone = milestones[name];
    if (milestone === undefined) reject();
    if (milestone.settled) return milestone.promise;
    let abort;
    try {
      const aborted = new Promise((_, rejectWait) => {
        abort = () => rejectWait(new Error('Trusted provider source milestone was aborted'));
        Reflect.apply(INTRINSIC_ADD_EVENT_LISTENER, signal, ['abort', abort, { once: true }]);
      });
      const value = await Promise.race([milestone.promise, aborted]);
      if (signalAborted(signal)) reject();
      return value;
    } catch {
      return reject();
    } finally {
      if (abort !== undefined) {
        try {
          Reflect.apply(INTRINSIC_REMOVE_EVENT_LISTENER, signal, ['abort', abort]);
        } catch {}
      }
    }
  }

  async function delay(milliseconds, signal) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) reject();
    let result;
    try {
      result = await input.delay(milliseconds, signal);
    } catch {
      return reject();
    }
    if (result !== undefined || signalAborted(signal)) reject();
  }

  async function delayUntil(startedAt, minimumMilliseconds, signal) {
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) reject();
    const remaining = startedAt + minimumMilliseconds - clockMilliseconds();
    if (remaining > 0) await delay(remaining, signal);
  }

  async function enforceTimeline(source, kind, context) {
    const { browser, signal } = context;
    if (browser === 'chromium' && source === 'control_plane') {
      if (kind === 'version_2_jwk_published') {
        mark('version_two_published', clockMilliseconds());
      } else if (kind === 'version_1_last_issuance') {
        versionOneLastIssuanceAt = clockMilliseconds();
      } else if (kind === 'version_2_first_issuance') {
        await waitFor('version_two_published', signal);
        await delay(TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS, signal);
        mark('version_two_first_issued');
      } else if (kind === 'atomic_credential_reuse') {
        await waitFor('route_transitioned', signal);
        await delay(TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS, signal);
      } else if (kind === 'version_1_jwk_retained') {
        await delayUntil(
          versionOneLastIssuanceAt,
          TRUSTED_PROVIDER_OWNER_VERSION_ONE_RETENTION_MILLISECONDS,
          signal,
        );
      } else if (kind === 'version_1_jwk_removed') {
        await delay(TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS, signal);
        mark('version_one_removed');
      } else if (kind === 'exchange_summary') {
        mark('chromium_control_summarized');
      }
    } else if (browser === 'chromium' && source === 'relay') {
      if (kind === 'version_2_existing_socket') {
        await waitFor('version_two_first_issued', signal);
        await delay(TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS, signal);
      } else if (kind === 'disconnect_reconnect_resync') {
        mark('relay_reconnected');
      } else if (kind === 'new_session_version_2') {
        await Promise.all([
          waitFor('version_one_removed', signal),
          waitFor('chromium_control_summarized', signal),
          waitFor('chromium_kms_summarized', signal),
        ]);
        await delay(TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS * 2, signal);
        mark('version_two_session_opened');
      }
    } else if (browser === 'chromium' && source === 'coordinator'
      && kind === 'physical_call_delivery') {
      await waitFor('relay_reconnected', signal);
      await delay(TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS, signal);
    } else if (browser === 'chromium' && source === 'kms') {
      if (kind === 'signature_summary') {
        mark('chromium_kms_summarized');
      } else if (kind === 'version_1_lifecycle') {
        await waitFor('version_one_removed', signal);
        await delay(TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS, signal);
        mark('version_one_disabled');
      }
    } else if (browser === 'chromium' && source === 'firestore') {
      if (kind === 'authoritative_route_transition') {
        mark('route_transitioned');
      } else if (kind === 'operation_write_summary') {
        await Promise.all([
          waitFor('version_two_session_opened', signal),
          waitFor('version_one_disabled', signal),
        ]);
        await delay(TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS, signal);
      }
    } else if (['firefox', 'webkit'].includes(browser)) {
      if (source === 'control_plane' && kind === 'exchange_summary') {
        mark(`${browser}_control_summarized`);
      } else if (source === 'kms' && kind === 'signature_summary') {
        mark(`${browser}_kms_summarized`);
      } else if (source === 'relay' && kind === 'version_2_session') {
        await Promise.all([
          waitFor(`${browser}_control_summarized`, signal),
          waitFor(`${browser}_kms_summarized`, signal),
        ]);
        await delay(TRUSTED_PROVIDER_OWNER_CROSS_SOURCE_SETTLEMENT_MILLISECONDS, signal);
      }
    }
  }

  function activateOperation() {
    if (arguments.length !== 0 || closed || operationActive || signalAborted(input.signal)) {
      reject();
    }
    operationActive = true;
    return true;
  }

  function activateBrowser(browser) {
    if (arguments.length !== 1 || closed || !operationActive
      || !TRUSTED_PROVIDER_OWNER_BROWSER_ORDER.includes(browser)
      || activeBrowsers.has(browser) || signalAborted(input.signal)) reject();
    for (const [source, kinds] of Object.entries(FACT_ORDER_BY_BROWSER[browser])) {
      for (const [index, kind] of kinds.entries()) {
        const sequence = index + 1;
        const fact = createFact(browser, source, sequence, kind);
        const observation = validateTrustedProviderOwnerObservation(
          fact,
          browser,
          source,
          sequence,
        );
        const key = factKey(browser, source, sequence);
        if (facts.has(key)) reject();
        facts.set(key, cloneObservation(observation));
      }
    }
    activeBrowsers.add(browser);
    return true;
  }

  async function observe(source, kind, context) {
    if (closed || closedProviders.has(source) || signalAborted(input.signal)
      || signalAborted(context?.signal) || activeSources.has(source)
      || poisonedSources.has(source)) reject();
    const expected = TRUSTED_PROVIDER_OWNER_CALLS_BY_SOURCE[source]?.[cursors[source]];
    if (expected === undefined || expected.kind !== kind
      || expected.browser !== context.browser || expected.case_id !== context.case_id
      || !activeBrowsers.has(context.browser)) reject();
    const kinds = FACT_ORDER_BY_BROWSER[context.browser]?.[source];
    const sequence = kinds?.indexOf(kind) + 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1) reject();
    const key = factKey(context.browser, source, sequence);
    if (!facts.has(key) || consumed.has(key)) reject();
    activeSources.add(source);
    try {
      await enforceTimeline(source, kind, context);
      consumed.add(key);
      cursors[source] += 1;
      return cloneObservation(facts.get(key));
    } catch {
      poisonedSources.add(source);
      reject();
    } finally {
      activeSources.delete(source);
    }
  }

  const providers = Object.freeze(Object.fromEntries(
    TRUSTED_PROVIDER_OWNER_SOURCE_ORDER.map((source) => {
      let provider;
      const methods = Object.fromEntries(
        TRUSTED_PROVIDER_OWNER_METHODS_BY_SOURCE[source].map((kind) => [
          kind,
          async function observeKind(context) {
            if (this !== provider || arguments.length !== 1) reject();
            return observe(source, kind, context);
          },
        ]),
      );
      provider = Object.freeze({
        source,
        scope: TRUSTED_PROVIDER_OWNER_SCOPES_BY_SOURCE[source],
        expires_at_milliseconds: expiresAt,
        ...methods,
        async close(signal) {
          if (this !== provider || arguments.length !== 1 || closedProviders.has(source)
            || signalAborted(signal)) reject();
          closedProviders.add(source);
          return undefined;
        },
      });
      return [source, provider];
    }),
  ));

  async function close() {
    if (arguments.length !== 0) reject();
    if (closed) return undefined;
    closed = true;
    facts.clear();
    consumed.clear();
    activeBrowsers.clear();
    activeSources.clear();
    poisonedSources.clear();
    operationActive = false;
    for (const source of TRUSTED_PROVIDER_OWNER_SOURCE_ORDER) cursors[source] = undefined;
    return undefined;
  }

  const authority = Object.freeze({ activateOperation, activateBrowser, close });
  return Object.freeze({ providers, authority, close });
}
