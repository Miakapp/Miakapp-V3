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
    lifecycle_observation: lifecycleObservation(browser),
    state_observation: null,
    call_observation: null,
    lifecycle_event: null,
    ...extras,
  };
}

function chromiumFacts() {
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
    client_statuses: [...replacementReady.client_statuses, 'stopping'],
    duration_milliseconds: 2_000,
  };
  return [
    fact('chromium', 1, 0, observation('chromium'), {
      lifecycle_observation: initializedLifecycle,
    }),
    fact('chromium', 2, 1_000, readyA, { lifecycle_observation: readyLifecycle }),
    fact('chromium', 3, 1_100, readyA, {
      lifecycle_observation: readyLifecycle,
      state_observation: matched(1),
    }),
    fact('chromium', 4, 1_200, readyA, {
      lifecycle_observation: patchedLifecycle,
      state_observation: matched(2),
    }),
    fact('chromium', 5, 1_300, readyA, {
      lifecycle_observation: initialCallLifecycle,
      call_observation: applied(),
    }),
    fact('chromium', 6, 271_000, reauthenticated, {
      lifecycle_observation: initialCallLifecycle,
    }),
    fact('chromium', 7, 541_000, handoff, {
      lifecycle_observation: handoffLifecycle,
      state_observation: stale(3),
    }),
    fact('chromium', 8, 542_000, readyB, { lifecycle_observation: readyBLifecycle }),
    fact('chromium', 9, 542_100, readyB, {
      lifecycle_observation: readyBLifecycle,
      state_observation: matched(3),
    }),
    fact('chromium', 10, 542_200, readyB, {
      lifecycle_observation: relayBCallLifecycle,
      call_observation: applied(),
    }),
    fact('chromium', 11, 543_000, uncertain, {
      lifecycle_observation: uncertainLifecycle,
      state_observation: stale(4),
    }),
    fact('chromium', 12, 544_000, recovered, {
      lifecycle_observation: recoveredLifecycle,
      state_observation: matched(4),
    }),
    fact('chromium', 13, 545_000, suspended, {
      lifecycle_observation: suspendedLifecycle,
      lifecycle_event: lifecycle('pagehide'),
    }),
    fact('chromium', 14, 546_000, restored, {
      lifecycle_observation: restoredLifecycle,
      state_observation: matched(4),
      lifecycle_event: lifecycle('pageshow'),
    }),
    fact('chromium', 15, 547_000, stopped, {
      lifecycle_observation: stoppedLifecycle,
    }),
    fact('chromium', 16, 548_000, observation('chromium'), {
      lifecycle_observation: lifecycleObservation('chromium'),
    }),
    fact('chromium', 17, 549_000, replacementReady, {
      lifecycle_observation: replacementReadyLifecycle,
    }),
    fact('chromium', 18, 550_000, replacementStopped, {
      lifecycle_observation: replacementStoppedLifecycle,
    }),
  ];
}

function secondaryFacts(browser) {
  const readyLifecycle = lifecycleObservation(browser, {
    state_transitions: [{ revision: 1, stale: false }],
  });
  const stoppedLifecycle = lifecycleObservation(browser, {
    ...readyLifecycle,
    sign_outs: 1,
    disposals: 1,
  });
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
    client_statuses: [...ready.client_statuses, 'stopping'],
    duration_milliseconds: 2_000,
  };
  return [
    fact(browser, 1, 0, observation(browser)),
    fact(browser, 2, 1_000, ready, { lifecycle_observation: readyLifecycle }),
    fact(browser, 3, 2_000, stopped, { lifecycle_observation: stoppedLifecycle }),
  ];
}

test('pins a closed browser-page producer without live authority', () => {
  const profile = validateBrowserRelayPageReceiptProfile();
  assert.equal(
    profile.state,
    'closed_browser_page_receipt_producer_bridge_bound_not_aggregated_not_executed',
  );
  assert.equal(profile.producer.chromium_facts, 18);
  assert.equal(profile.compatibility.fixture_capacity_satisfied, false);
  assert.equal(profile.compatibility.playwright_bridge_present, true);
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

test('rejects lifecycle regression, guessed outcomes and incomplete terminal cleanup', () => {
  const regressed = chromiumFacts();
  regressed[8] = {
    ...regressed[8],
    lifecycle_observation: {
      ...regressed[8].lifecycle_observation,
      state_transitions: [{ revision: 3, stale: false }],
    },
  };
  assert.throws(
    () => produceBrowserRelayPageReceipt('chromium', regressed),
    /relay_b_state and failed closed/u,
  );

  const guessed = chromiumFacts();
  guessed[10] = {
    ...guessed[10],
    observation: {
      ...guessed[10].observation,
      failure_classes: ['internal:failed', 'unavailable:outcome_unknown'],
    },
    lifecycle_observation: {
      ...guessed[10].lifecycle_observation,
      call_outcomes: ['applied', 'applied'],
    },
  };
  assert.throws(
    () => produceBrowserRelayPageReceipt('chromium', guessed),
    /failed_and_uncertain_calls and failed closed/u,
  );

  const incompleteCleanup = secondaryFacts('firefox');
  incompleteCleanup[2] = {
    ...incompleteCleanup[2],
    lifecycle_observation: {
      ...incompleteCleanup[2].lifecycle_observation,
      disposals: 0,
    },
  };
  assert.throws(
    () => produceBrowserRelayPageReceipt('firefox', incompleteCleanup),
    /signed_out_stopped and failed closed/u,
  );

  const prematureCleanup = secondaryFacts('webkit');
  prematureCleanup[1] = {
    ...prematureCleanup[1],
    lifecycle_observation: {
      ...prematureCleanup[1].lifecycle_observation,
      sign_outs: 1,
      disposals: 1,
    },
  };
  prematureCleanup[2] = {
    ...prematureCleanup[2],
    lifecycle_observation: {
      ...prematureCleanup[2].lifecycle_observation,
      sign_outs: 1,
      disposals: 1,
    },
  };
  assert.throws(
    () => produceBrowserRelayPageReceipt('webkit', prematureCleanup),
    /initial_ready and failed closed/u,
  );

  const reusedLifecycle = chromiumFacts();
  reusedLifecycle[15] = {
    ...reusedLifecycle[15],
    lifecycle_observation: lifecycleObservation('chromium', {
      state_transitions: [{ revision: 1, stale: false }],
    }),
  };
  assert.throws(
    () => produceBrowserRelayPageReceipt('chromium', reusedLifecycle),
    /replacement_initialized and failed closed/u,
  );
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
