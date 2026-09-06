import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAGE_FACT_ORDER_BY_BROWSER,
  PAGE_FACT_SCHEMA,
  PAGE_LIFECYCLE_EVENT_SCHEMA,
  PAGE_RECEIPT_PROFILE_SHA256,
  StagingBrowserRelayPageReceiptError,
  validateBrowserRelayPageFact,
  validateBrowserRelayPageReceiptProfile,
} from '../browser-relay-page-receipt/contract.mjs';
import { validateBrowserRelayPageReceiptRoot } from '../browser-relay-page-receipt/guard.mjs';
import {
  createBrowserRelayPageReceiptProducer,
  produceBrowserRelayPageReceipt,
} from '../browser-relay-page-receipt/producer.mjs';

const STATUS_READY = ['connecting', 'authenticating', 'synchronizing', 'ready'];

function observation(browser, overrides = {}) {
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

function fact(browser, sequence, elapsed, pageObservation, extras = {}) {
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
    state_observation: null,
    call_observation: null,
    lifecycle_event: null,
    ...extras,
  };
}

function chromiumFacts() {
  const readyA = observation('chromium', {
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
    failure_classes: ['internal:failed', 'unavailable:outcome_unknown'],
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
    client_statuses: [...recovered.client_statuses, 'stopping', 'stopped'],
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
    client_statuses: [...restored.client_statuses, 'stopping', 'stopped'],
    duration_milliseconds: 547_000,
  };
  const replacementReady = observation('chromium', {
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
    client_statuses: [...replacementReady.client_statuses, 'stopping', 'stopped'],
    duration_milliseconds: 2_000,
  };
  return [
    fact('chromium', 1, 0, observation('chromium')),
    fact('chromium', 2, 1_000, readyA),
    fact('chromium', 3, 1_100, readyA, { state_observation: matched(1) }),
    fact('chromium', 4, 1_200, readyA, { state_observation: matched(2) }),
    fact('chromium', 5, 1_300, readyA, { call_observation: applied() }),
    fact('chromium', 6, 271_000, reauthenticated),
    fact('chromium', 7, 541_000, handoff, { state_observation: stale(3) }),
    fact('chromium', 8, 542_000, readyB),
    fact('chromium', 9, 542_100, readyB, { state_observation: matched(3) }),
    fact('chromium', 10, 542_200, readyB, { call_observation: applied() }),
    fact('chromium', 11, 543_000, uncertain, { state_observation: stale(4) }),
    fact('chromium', 12, 544_000, recovered, { state_observation: matched(4) }),
    fact('chromium', 13, 545_000, suspended, { lifecycle_event: lifecycle('pagehide') }),
    fact('chromium', 14, 546_000, restored, {
      state_observation: matched(4),
      lifecycle_event: lifecycle('pageshow'),
    }),
    fact('chromium', 15, 547_000, stopped),
    fact('chromium', 16, 548_000, observation('chromium')),
    fact('chromium', 17, 549_000, replacementReady),
    fact('chromium', 18, 550_000, replacementStopped),
  ];
}

function secondaryFacts(browser) {
  const ready = observation(browser, {
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
    client_statuses: [...ready.client_statuses, 'stopping', 'stopped'],
    duration_milliseconds: 2_000,
  };
  return [
    fact(browser, 1, 0, observation(browser)),
    fact(browser, 2, 1_000, ready),
    fact(browser, 3, 2_000, stopped),
  ];
}

test('pins a closed browser-page producer without live authority', () => {
  const profile = validateBrowserRelayPageReceiptProfile();
  assert.equal(
    profile.state,
    'closed_browser_page_receipt_producer_implemented_not_wired_not_executed',
  );
  assert.equal(profile.producer.chromium_facts, 18);
  assert.equal(profile.compatibility.fixture_capacity_satisfied, false);
  assert.equal(profile.compatibility.playwright_bridge_present, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.match(PAGE_RECEIPT_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
});

test('derives the complete Chromium page receipt from exact cumulative facts', () => {
  const receipt = produceBrowserRelayPageReceipt('chromium', chromiumFacts());
  assert.equal(receipt.state, 'observed_closed');
  assert.equal(receipt.source, 'browser_page');
  assert.equal(Object.keys(receipt.assertions).length, 14);
  assert.ok(Object.values(receipt.assertions).every((value) => value === true));
  assert.deepEqual(receipt.counters, {
    app_check_assessments: 0,
    control_plane_exchanges: 0,
    kms_signatures: 0,
    firestore_writes: 0,
    maximum_active_websockets: 1,
    source_credentials_on_websocket: 0,
    browser_credential_persistence_events: 0,
    physical_call_replays: 0,
  });
  assert.deepEqual(receipt.stable_outcome_classes, [
    'accepted',
    'applied',
    'failed',
    'outcome_unknown',
    'stale',
  ]);
  assert.deepEqual(receipt.public_key_ids, []);
  assert.deepEqual(receipt.revision_ids, []);
});

test('derives exact Firefox and WebKit teardown receipts without persistence', () => {
  for (const browser of ['firefox', 'webkit']) {
    const receipt = produceBrowserRelayPageReceipt(browser, secondaryFacts(browser));
    assert.equal(Object.keys(receipt.assertions).length, 2);
    assert.equal(receipt.assertions.no_browser_specific_credential_persistence, true);
    assert.equal(receipt.counters.maximum_active_websockets, 1);
    assert.equal(receipt.counters.browser_credential_persistence_events, 0);
    assert.deepEqual(receipt.stable_outcome_classes, []);
  }
});

test('fails permanently on an early renewal or an out-of-order fact', () => {
  const early = chromiumFacts();
  early[5] = { ...early[5], elapsed_milliseconds: 200_000 };
  assert.throws(
    () => produceBrowserRelayPageReceipt('chromium', early),
    /same_relay_reauthenticated and failed closed/u,
  );

  const producer = createBrowserRelayPageReceiptProducer('firefox');
  const values = secondaryFacts('firefox');
  producer.record(values[0]);
  assert.throws(
    () => producer.record({ ...values[1], phase: 'signed_out_stopped' }),
    /initial_ready and failed closed/u,
  );
  assert.throws(
    () => producer.record(values[1]),
    /after closure/u,
  );
  assert.throws(() => producer.close(), /exactly once/u);
});

test('rejects a non-persisted restore and replacement without a new identity generation', () => {
  const lifecycleDrift = chromiumFacts();
  lifecycleDrift[13] = {
    ...lifecycleDrift[13],
    lifecycle_event: { ...lifecycleDrift[13].lifecycle_event, persisted: false },
  };
  assert.throws(
    () => produceBrowserRelayPageReceipt('chromium', lifecycleDrift),
    /pageshow_restored and failed closed/u,
  );

  const sameIdentity = chromiumFacts();
  sameIdentity[15] = { ...sameIdentity[15], identity_generation: 1 };
  assert.throws(
    () => produceBrowserRelayPageReceipt('chromium', sameIdentity),
    /replacement_initialized and failed closed/u,
  );
});

test('rejects overlap, private material and incomplete closure', () => {
  const overlap = chromiumFacts();
  overlap[7] = {
    ...overlap[7],
    observation: {
      ...overlap[7].observation,
      maximum_active_websockets: 2,
    },
  };
  assert.throws(
    () => produceBrowserRelayPageReceipt('chromium', overlap),
    /relay_b_ready and failed closed/u,
  );
  assert.throws(
    () => validateBrowserRelayPageFact({
      ...secondaryFacts('webkit')[0],
      token: 'eyJprivatevalue.privatevalue.privatevalue',
    }, 'webkit', 1),
    /private material|forbidden/u,
  );
  const incomplete = createBrowserRelayPageReceiptProducer('webkit');
  incomplete.record(secondaryFacts('webkit')[0]);
  assert.throws(() => incomplete.close(), /before every reviewed fact/u);
});

test('supports explicit abort without permitting reuse', () => {
  const producer = createBrowserRelayPageReceiptProducer('webkit');
  producer.record(secondaryFacts('webkit')[0]);
  assert.equal(producer.abort(), true);
  assert.equal(producer.abort(), true);
  assert.throws(
    () => producer.record(secondaryFacts('webkit')[1]),
    /after closure/u,
  );
  assert.throws(() => producer.close(), /exactly once/u);
});

test('guards the exact source-only browser-page receipt inventory', () => {
  validateBrowserRelayPageReceiptRoot(
    new URL('../browser-relay-page-receipt/', import.meta.url),
  );
  assert.throws(
    () => createBrowserRelayPageReceiptProducer('safari'),
    StagingBrowserRelayPageReceiptError,
  );
});
