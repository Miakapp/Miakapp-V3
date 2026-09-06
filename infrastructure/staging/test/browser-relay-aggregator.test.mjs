import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateClosedBrowserRelayEngineEvidence,
  createClosedBrowserRelayEngineAggregator,
} from '../browser-relay-aggregator/aggregator.mjs';
import {
  AGGREGATOR_PROFILE_SHA256,
  COUNTER_KEYS,
  SOURCE_ASSERTIONS,
  SOURCE_ORDER_BY_BROWSER,
  SOURCE_RECEIPT_SCHEMA,
  STABLE_OUTCOME_CLASSES,
  StagingBrowserRelayAggregatorError,
  validateBrowserRelayAggregatorProfile,
  validateSourceReceipt,
} from '../browser-relay-aggregator/contract.mjs';
import { validateBrowserRelayAggregatorRoot } from '../browser-relay-aggregator/guard.mjs';
import { buildClosedRunnerResult } from '../browser-relay-runner/contract.mjs';

function counters() {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
}

function receipt(browser, source, overrides = {}) {
  const sourceCounters = counters();
  if (source === 'browser_page') sourceCounters.maximum_active_websockets = 1;
  if (source === 'firebase_app_check') {
    sourceCounters.app_check_assessments = browser === 'chromium' ? 2 : 1;
  }
  if (source === 'control_plane') {
    sourceCounters.control_plane_exchanges = browser === 'chromium' ? 3 : 1;
  }
  if (source === 'kms') sourceCounters.kms_signatures = browser === 'chromium' ? 3 : 1;
  if (source === 'firestore') sourceCounters.firestore_writes = 8;
  const value = {
    schema: SOURCE_RECEIPT_SCHEMA,
    browser,
    source,
    state: 'observed_closed',
    assertions: Object.fromEntries(
      SOURCE_ASSERTIONS[browser][source].map((assertion) => [assertion, true]),
    ),
    counters: sourceCounters,
    public_key_ids: source === 'control_plane'
      ? (browser === 'chromium' ? ['1', '2'] : ['2'])
      : [],
    revision_ids: source === 'control_plane'
      ? ['control-plane-00010-vop']
      : (source === 'relay'
        ? (browser === 'chromium'
          ? ['miakapp-staging-relay-a-00002-tst', 'miakapp-staging-relay-b-00002-tst']
          : ['miakapp-staging-relay-b-00002-tst'])
        : []),
    stable_outcome_classes: browser === 'chromium' && source === 'browser_page'
      ? [...STABLE_OUTCOME_CLASSES]
      : [],
  };
  return {
    ...value,
    ...overrides,
    assertions: overrides.assertions ?? value.assertions,
    counters: overrides.counters ?? value.counters,
    public_key_ids: overrides.public_key_ids ?? value.public_key_ids,
    revision_ids: overrides.revision_ids ?? value.revision_ids,
    stable_outcome_classes:
      overrides.stable_outcome_classes ?? value.stable_outcome_classes,
  };
}

function receipts(browser) {
  return SOURCE_ORDER_BY_BROWSER[browser].map((source) => receipt(browser, source));
}

test('pins an inert independent-source aggregation boundary with no live authority', () => {
  const profile = validateBrowserRelayAggregatorProfile();
  assert.equal(
    profile.state,
    'closed_independent_source_aggregator_implemented_not_wired_not_executed',
  );
  assert.equal(profile.aggregation.receipts_per_matrix, 18);
  assert.equal(profile.aggregation.assertion_source_overlap, 0);
  assert.equal(profile.aggregation.browser_self_attested_cloud_assertions, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(profile.evidence.live_engine_results, 0);
  assert.match(AGGREGATOR_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
});

test('closes Chromium only after all eight source owners contribute exact evidence', () => {
  const result = aggregateClosedBrowserRelayEngineEvidence('chromium', receipts('chromium'), 9_000);
  assert.equal(result.state, 'succeeded');
  assert.equal(Object.keys(result.assertions).length, 36);
  assert.ok(Object.values(result.assertions).every((value) => value === true));
  assert.deepEqual(result.counters, {
    app_check_assessments: 2,
    control_plane_exchanges: 3,
    kms_signatures: 3,
    firestore_writes: 8,
    maximum_active_websockets: 1,
    source_credentials_on_websocket: 0,
    browser_credential_persistence_events: 0,
    physical_call_replays: 0,
  });
  assert.deepEqual(result.public_key_ids, ['1', '2']);
  assert.deepEqual(result.revision_ids, [
    'control-plane-00010-vop',
    'miakapp-staging-relay-a-00002-tst',
    'miakapp-staging-relay-b-00002-tst',
  ]);
  assert.deepEqual(result.stable_outcome_classes, STABLE_OUTCOME_CLASSES);
});

test('closes the three browser results inside the existing aggregate budgets', () => {
  const engineResults = [
    aggregateClosedBrowserRelayEngineEvidence('chromium', receipts('chromium'), 9_000),
    aggregateClosedBrowserRelayEngineEvidence('firefox', receipts('firefox'), 2_000),
    aggregateClosedBrowserRelayEngineEvidence('webkit', receipts('webkit'), 2_000),
  ];
  assert.equal(Object.keys(engineResults[1].assertions).length, 2);
  assert.equal(Object.keys(engineResults[2].assertions).length, 2);
  assert.deepEqual(engineResults[1].public_key_ids, ['2']);
  const closed = buildClosedRunnerResult(engineResults, 14_000);
  assert.equal(closed.assertions_passed, 40);
  assert.equal(closed.browser_invocations, 3);
  assert.deepEqual(closed.counters, {
    app_check_assessments: 4,
    control_plane_exchanges: 5,
    kms_signatures: 5,
    firestore_writes: 8,
    maximum_active_websockets: 1,
    source_credentials_on_websocket: 0,
    browser_credential_persistence_events: 0,
    physical_call_replays: 0,
  });
});

test('fails the single-use state permanently on false, missing or out-of-order evidence', () => {
  const falseReceipt = receipt('chromium', 'browser_page');
  falseReceipt.assertions.chromium_initial_exchange_and_hello = false;
  const aggregator = createClosedBrowserRelayEngineAggregator('chromium');
  assert.throws(
    () => aggregator.record(falseReceipt),
    /browser_page receipt and failed closed/u,
  );
  assert.throws(
    () => aggregator.record(receipt('chromium', 'browser_page')),
    /after its boundary closed/u,
  );
  assert.throws(() => aggregator.close(1), /exactly once/u);

  assert.throws(
    () => aggregateClosedBrowserRelayEngineEvidence(
      'chromium',
      receipts('chromium').slice(1),
      1,
    ),
    /browser_page receipt and failed closed/u,
  );
  const incomplete = createClosedBrowserRelayEngineAggregator('firefox');
  incomplete.record(receipt('firefox', 'browser_page'));
  assert.throws(
    () => incomplete.close(1),
    /before every independent source receipt arrived/u,
  );
});

test('rejects private material and evidence reported by the wrong source', () => {
  assert.throws(
    () => validateSourceReceipt({
      ...receipt('firefox', 'browser_page'),
      token: 'eyJprivatevalue.privatevalue.privatevalue',
    }, 'firefox', 'browser_page'),
    /private material|forbidden/u,
  );
  const wrongOwnerCounters = counters();
  wrongOwnerCounters.maximum_active_websockets = 1;
  wrongOwnerCounters.kms_signatures = 1;
  assert.throws(
    () => validateSourceReceipt(receipt('firefox', 'browser_page', {
      counters: wrongOwnerCounters,
    }), 'firefox', 'browser_page'),
    /belongs to another evidence source/u,
  );
  assert.throws(
    () => validateSourceReceipt(receipt('firefox', 'browser_page', {
      revision_ids: ['control-plane-00010-vop'],
    }), 'firefox', 'browser_page'),
    /revisions belong only/u,
  );
});

test('requires key overlap, exact relay coverage and stable outcome classes', () => {
  const missingKey = receipts('chromium');
  const controlPlaneIndex = SOURCE_ORDER_BY_BROWSER.chromium.indexOf('control_plane');
  missingKey[controlPlaneIndex] = receipt('chromium', 'control_plane', {
    public_key_ids: ['2'],
  });
  assert.throws(
    () => aggregateClosedBrowserRelayEngineEvidence('chromium', missingKey, 1),
    /control_plane receipt and failed closed/u,
  );

  const missingRelay = receipts('chromium');
  const relayIndex = SOURCE_ORDER_BY_BROWSER.chromium.indexOf('relay');
  missingRelay[relayIndex] = receipt('chromium', 'relay', {
    revision_ids: ['miakapp-staging-relay-b-00002-tst'],
  });
  assert.throws(
    () => aggregateClosedBrowserRelayEngineEvidence('chromium', missingRelay, 1),
    /relay receipt and failed closed/u,
  );

  const missingOutcome = receipts('chromium');
  const browserPageIndex = SOURCE_ORDER_BY_BROWSER.chromium.indexOf('browser_page');
  missingOutcome[browserPageIndex] = receipt('chromium', 'browser_page', {
    stable_outcome_classes: STABLE_OUTCOME_CLASSES.slice(0, -1),
  });
  assert.throws(
    () => aggregateClosedBrowserRelayEngineEvidence('chromium', missingOutcome, 1),
    /browser_page receipt and failed closed/u,
  );
});

test('supports explicit abort without permitting reuse or a later result', () => {
  const aggregator = createClosedBrowserRelayEngineAggregator('webkit');
  aggregator.record(receipt('webkit', 'browser_page'));
  assert.equal(aggregator.abort(), true);
  assert.equal(aggregator.abort(), true);
  assert.throws(
    () => aggregator.record(receipt('webkit', 'firebase_app_check')),
    /after its boundary closed/u,
  );
  assert.throws(() => aggregator.close(1), /exactly once/u);
});

test('guards the exact source-only aggregator inventory', () => {
  validateBrowserRelayAggregatorRoot(
    new URL('../browser-relay-aggregator/', import.meta.url),
  );
  assert.throws(
    () => createClosedBrowserRelayEngineAggregator('safari'),
    StagingBrowserRelayAggregatorError,
  );
});
