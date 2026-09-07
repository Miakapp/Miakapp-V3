import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
import {
  chromiumPageFacts as chromiumFacts,
  pageLifecycleObservation as lifecycleObservation,
  pageObservation as observation,
  secondaryPageFacts as secondaryFacts,
} from './helpers/browser-relay-evidence-fixture.mjs';

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
