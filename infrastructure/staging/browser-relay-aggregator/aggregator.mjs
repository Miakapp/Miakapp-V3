import {
  BROWSER_ORDER,
  validateEngineResult,
} from '../browser-relay-runner/contract.mjs';
import {
  COUNTER_KEYS,
  SOURCE_ASSERTIONS,
  SOURCE_ORDER_BY_BROWSER,
  STABLE_OUTCOME_CLASSES,
  StagingBrowserRelayAggregatorError,
  validateAggregatorDuration,
  validateBrowserRelayAggregatorProfile,
  validateSourceReceipt,
} from './contract.mjs';

function reject(message) {
  throw new StagingBrowserRelayAggregatorError(message);
}

function emptyCounters() {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
}

function sortedUnique(values, order = null) {
  const unique = [...new Set(values)];
  if (order === null) return unique.sort();
  return unique.sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

export function createClosedBrowserRelayEngineAggregator(browser) {
  validateBrowserRelayAggregatorProfile();
  if (!BROWSER_ORDER.includes(browser)) reject('Aggregator browser is not reviewed');
  const expectedSources = SOURCE_ORDER_BY_BROWSER[browser];
  let state = 'collecting';
  let nextSourceIndex = 0;
  let counters = emptyCounters();
  let assertionNames = new Set();
  let publicKeyIds = [];
  let revisionIds = [];
  let stableOutcomeClasses = [];

  function discard(nextState) {
    counters = emptyCounters();
    assertionNames.clear();
    assertionNames = new Set();
    publicKeyIds = [];
    revisionIds = [];
    stableOutcomeClasses = [];
    state = nextState;
  }

  function fail(message) {
    discard('failed');
    reject(message);
  }

  return Object.freeze({
    record(receiptValue) {
      if (state !== 'collecting') {
        reject('Aggregator cannot accept a receipt after its boundary closed');
      }
      const expectedSource = expectedSources[nextSourceIndex];
      if (expectedSource === undefined) {
        return fail('Aggregator received more receipts than the reviewed source set');
      }
      let receipt;
      try {
        receipt = validateSourceReceipt(receiptValue, browser, expectedSource);
      } catch {
        return fail(`Aggregator rejected the ${expectedSource} receipt and failed closed`);
      }
      for (const assertion of Object.keys(receipt.assertions)) {
        if (assertionNames.has(assertion)) {
          return fail('Aggregator detected overlapping assertion ownership');
        }
        assertionNames.add(assertion);
      }
      for (const key of COUNTER_KEYS) counters[key] += receipt.counters[key];
      publicKeyIds.push(...receipt.public_key_ids);
      revisionIds.push(...receipt.revision_ids);
      stableOutcomeClasses.push(...receipt.stable_outcome_classes);
      nextSourceIndex += 1;
      return true;
    },

    close(durationMilliseconds) {
      if (state !== 'collecting') reject('Aggregator may close exactly once');
      if (nextSourceIndex !== expectedSources.length) {
        return fail('Aggregator cannot close before every independent source receipt arrived');
      }
      const expectedAssertions = expectedSources
        .flatMap((source) => SOURCE_ASSERTIONS[browser][source]);
      if (assertionNames.size !== expectedAssertions.length
        || expectedAssertions.some((assertion) => !assertionNames.has(assertion))) {
        return fail('Aggregator assertion coverage is incomplete');
      }
      let result;
      try {
        result = validateEngineResult({
          schema: 'miakapp.staging-browser-relay-engine-result/1',
          browser,
          state: 'succeeded',
          assertions: Object.fromEntries(expectedAssertions.map((assertion) => [assertion, true])),
          counters,
          duration_milliseconds: validateAggregatorDuration(durationMilliseconds, browser),
          public_key_ids: sortedUnique(publicKeyIds, ['1', '2']),
          revision_ids: sortedUnique(revisionIds),
          stable_outcome_classes: sortedUnique(
            stableOutcomeClasses,
            STABLE_OUTCOME_CLASSES,
          ),
        }, browser);
      } catch {
        return fail('Aggregator could not produce a closed engine result');
      }
      discard('closed');
      return result;
    },

    abort() {
      if (state === 'closed') reject('Aggregator cannot abort after a closed result');
      if (state !== 'aborted') discard('aborted');
      return true;
    },
  });
}

export function aggregateClosedBrowserRelayEngineEvidence(
  browser,
  receiptValues,
  durationMilliseconds,
) {
  if (!Array.isArray(receiptValues)) reject('Aggregator receipts must be one ordered array');
  const aggregator = createClosedBrowserRelayEngineAggregator(browser);
  try {
    for (const receipt of receiptValues) aggregator.record(receipt);
    return aggregator.close(durationMilliseconds);
  } catch (error) {
    try {
      aggregator.abort();
    } catch {}
    if (error instanceof StagingBrowserRelayAggregatorError) throw error;
    return reject('Aggregator failed before producing a closed engine result');
  }
}
