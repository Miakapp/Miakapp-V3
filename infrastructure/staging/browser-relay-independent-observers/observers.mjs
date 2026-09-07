import {
  COUNTER_KEYS,
  SOURCE_ASSERTIONS,
  SOURCE_ORDER_BY_BROWSER,
  SOURCE_RECEIPT_SCHEMA,
  validateSourceReceipt,
} from '../browser-relay-aggregator/contract.mjs';
import {
  aggregateClosedBrowserRelayEngineEvidence,
} from '../browser-relay-aggregator/aggregator.mjs';
import {
  BROWSER_ORDER,
  MAXIMUM_TOTAL_MILLISECONDS,
  buildClosedRunnerResult,
} from '../browser-relay-runner/contract.mjs';
import {
  FACT_ORDER_BY_BROWSER,
  INDEPENDENT_SOURCES_BY_BROWSER,
  MINIMUM_CHROMIUM_ENGINE_DURATION_MILLISECONDS,
  StagingBrowserRelayIndependentObserverError,
  rejectIndependentObserverPrivateMaterial,
  validateBrowserRelayIndependentObserversProfile,
  validateIndependentSourceFact,
} from './contract.mjs';

function reject(message) {
  throw new StagingBrowserRelayIndependentObserverError(message);
}

function emptyCounters() {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
}

function createBrowserRelayIndependentSourceObserver(browser, source) {
  validateBrowserRelayIndependentObserversProfile();
  const sources = INDEPENDENT_SOURCES_BY_BROWSER[browser];
  if (!Array.isArray(sources) || !sources.includes(source)) {
    reject('Independent observer browser and source pair is not reviewed');
  }
  const phases = FACT_ORDER_BY_BROWSER[browser][source];
  let state = 'collecting';
  let nextSequence = 1;
  let lastElapsed = 0;
  let counters = emptyCounters();
  let publicKeyIds = [];
  let revisionIds = [];
  let retained = {};

  function discard(nextState) {
    state = nextState;
    nextSequence = phases.length + 1;
    lastElapsed = 0;
    counters = emptyCounters();
    publicKeyIds = [];
    revisionIds = [];
    retained = {};
  }

  function fail(message) {
    discard('failed');
    reject(message);
  }

  function retainFact(fact) {
    const { kind, observation } = fact;
    if (kind === 'provider_assessment') {
      counters.app_check_assessments = observation.assessment_count;
    } else if (kind === 'valid_verification') {
      retained.validVerifications = observation.verification_count;
    } else if (kind === 'verification_mode') {
      if (observation.repeated_valid_verifications > retained.validVerifications) {
        reject('App Check verification-mode evidence exceeds the observed valid verifications');
      }
    } else if (kind === 'atomic_credential_reuse') {
      retained.atomicReuseExchanges = observation.route_change_exchange_requests;
    } else if (kind === 'version_2_jwk_published') {
      retained.versionTwoPublicationElapsed = fact.elapsed_milliseconds;
      retained.baselineControlPlaneRevision = observation.revision_id;
    } else if (kind === 'version_1_last_issuance') {
      if (observation.revision_id !== retained.baselineControlPlaneRevision) {
        reject('Version 1 issuance does not share the prepublication revision');
      }
      retained.versionOneLastIssuanceElapsed = fact.elapsed_milliseconds;
    } else if (kind === 'version_2_first_issuance') {
      if (fact.elapsed_milliseconds - retained.versionTwoPublicationElapsed < 60_000) {
        reject('Version 2 was first issued before its sixty-second publication window');
      }
      retained.activationControlPlaneRevision = observation.revision_id;
    } else if (kind === 'version_1_jwk_retained') {
      if (fact.elapsed_milliseconds - retained.versionOneLastIssuanceElapsed < 330_000) {
        reject('Version 1 was not retained for its three-hundred-thirty-second lease bound');
      }
      if (observation.revision_id !== retained.activationControlPlaneRevision) {
        reject('Version 1 retention does not share the version 2 activation revision');
      }
      retained.retentionElapsed = fact.elapsed_milliseconds;
    } else if (kind === 'version_1_jwk_removed') {
      if (fact.elapsed_milliseconds <= retained.retentionElapsed) {
        reject('JWK removal evidence does not follow retention evidence');
      }
      retained.retirementControlPlaneRevision = observation.revision_id;
    } else if (kind === 'exchange_summary') {
      if (browser === 'chromium'
        && observation.successful_exchanges < (retained.atomicReuseExchanges ?? 0)) {
        reject('Control-plane exchange summary omits the atomic reuse attempts');
      }
      if (browser === 'chromium') {
        const expectedRevisions = [
          retained.baselineControlPlaneRevision,
          retained.activationControlPlaneRevision,
          retained.retirementControlPlaneRevision,
        ].sort();
        if (JSON.stringify(observation.revision_ids) !== JSON.stringify(expectedRevisions)) {
          reject('Control-plane exchange summary does not match the observed revision lineage');
        }
      }
      counters.control_plane_exchanges = observation.successful_exchanges;
      publicKeyIds = [...observation.public_key_ids];
      revisionIds = [...observation.revision_ids];
    } else if (kind === 'revision_summary') {
      revisionIds = [...observation.revision_ids];
    } else if (kind === 'physical_call_delivery') {
      counters.physical_call_replays = observation.physical_replays;
    } else if (kind === 'signature_summary') {
      counters.kms_signatures = observation.signing_rpc_count_total;
    } else if (kind === 'operation_write_summary') {
      counters.firestore_writes = observation.observed_write_count;
    }
  }

  return Object.freeze({
    record(factValue) {
      if (state !== 'collecting') {
        reject('Independent observer cannot accept a fact after closure');
      }
      if (nextSequence > phases.length) {
        return fail('Independent observer received too many source facts');
      }
      try {
        const fact = validateIndependentSourceFact(
          factValue,
          browser,
          source,
          nextSequence,
        );
        if (fact.elapsed_milliseconds < lastElapsed) {
          reject('Independent source facts are not monotonic');
        }
        retainFact(fact);
        lastElapsed = fact.elapsed_milliseconds;
        nextSequence += 1;
      } catch {
        return fail(`Independent observer rejected ${phases[nextSequence - 1]} and failed closed`);
      }
      return true;
    },

    close() {
      if (state !== 'collecting') reject('Independent observer may close exactly once');
      if (nextSequence !== phases.length + 1) {
        return fail('Independent observer cannot close before every reviewed fact arrived');
      }
      let receipt;
      try {
        receipt = validateSourceReceipt({
          schema: SOURCE_RECEIPT_SCHEMA,
          browser,
          source,
          state: 'observed_closed',
          assertions: Object.fromEntries(
            SOURCE_ASSERTIONS[browser][source].map((assertion) => [assertion, true]),
          ),
          counters,
          public_key_ids: publicKeyIds,
          revision_ids: revisionIds,
          stable_outcome_classes: [],
        }, browser, source);
      } catch {
        return fail('Independent source facts could not produce a closed source receipt');
      }
      discard('closed');
      return receipt;
    },

    abort() {
      if (state === 'closed') reject('Independent observer cannot abort after closure');
      if (state !== 'aborted') discard('aborted');
      return true;
    },
  });
}

function produceBrowserRelayIndependentSourceReceipt(browser, source, factValues) {
  if (!Array.isArray(factValues)) reject('Independent source facts must be one ordered array');
  const observer = createBrowserRelayIndependentSourceObserver(browser, source);
  try {
    for (const fact of factValues) observer.record(fact);
    return observer.close();
  } catch (error) {
    try {
      observer.abort();
    } catch {}
    if (error instanceof StagingBrowserRelayIndependentObserverError) throw error;
    return reject('Independent source receipt production failed before closure');
  }
}

function factElapsed(factValuesBySource, source, kind) {
  const fact = factValuesBySource[source].find((entry) => entry.kind === kind);
  if (fact === undefined) reject(`Independent receipt matrix is missing ${source}.${kind}`);
  return fact.elapsed_milliseconds;
}

function requireTimelineOrder(factValuesBySource, before, after) {
  const beforeElapsed = factElapsed(factValuesBySource, before.source, before.kind);
  const afterElapsed = factElapsed(factValuesBySource, after.source, after.kind);
  if (afterElapsed < beforeElapsed) {
    reject(
      `Independent receipt matrix timeline places ${after.source}.${after.kind} before ${before.source}.${before.kind}`,
    );
  }
}

function validateCrossSourceTimeline(browser, factValuesBySource) {
  if (browser === 'chromium') {
    requireTimelineOrder(
      factValuesBySource,
      { source: 'control_plane', kind: 'version_2_first_issuance' },
      { source: 'relay', kind: 'version_2_existing_socket' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'relay', kind: 'version_2_existing_socket' },
      { source: 'firestore', kind: 'authoritative_route_transition' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'firestore', kind: 'authoritative_route_transition' },
      { source: 'control_plane', kind: 'atomic_credential_reuse' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'control_plane', kind: 'atomic_credential_reuse' },
      { source: 'relay', kind: 'wrong_audience_denial' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'relay', kind: 'disconnect_reconnect_resync' },
      { source: 'coordinator', kind: 'physical_call_delivery' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'control_plane', kind: 'version_1_jwk_removed' },
      { source: 'relay', kind: 'new_session_version_2' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'control_plane', kind: 'exchange_summary' },
      { source: 'relay', kind: 'new_session_version_2' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'kms', kind: 'signature_summary' },
      { source: 'relay', kind: 'new_session_version_2' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'control_plane', kind: 'version_1_jwk_removed' },
      { source: 'kms', kind: 'version_1_lifecycle' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'relay', kind: 'new_session_version_2' },
      { source: 'firestore', kind: 'operation_write_summary' },
    );
    requireTimelineOrder(
      factValuesBySource,
      { source: 'kms', kind: 'version_1_lifecycle' },
      { source: 'firestore', kind: 'operation_write_summary' },
    );
    return;
  }
  requireTimelineOrder(
    factValuesBySource,
    { source: 'control_plane', kind: 'exchange_summary' },
    { source: 'relay', kind: 'version_2_session' },
  );
  requireTimelineOrder(
    factValuesBySource,
    { source: 'kms', kind: 'signature_summary' },
    { source: 'relay', kind: 'version_2_session' },
  );
}

function produceBrowserRelayIndependentSourceReceipts(browser, factValuesBySource) {
  const sources = INDEPENDENT_SOURCES_BY_BROWSER[browser];
  if (!Array.isArray(sources) || factValuesBySource === null
    || Array.isArray(factValuesBySource) || typeof factValuesBySource !== 'object') {
    reject('Independent receipt matrix input is invalid');
  }
  const safeFactValuesBySource = rejectIndependentObserverPrivateMaterial(
    factValuesBySource,
    'independent_receipt_matrix_input',
  );
  const sourceNames = Object.keys(safeFactValuesBySource).sort();
  if (sourceNames.length !== sources.length
    || sourceNames.some((source, index) => source !== [...sources].sort()[index])) {
    reject('Independent receipt matrix must contain every reviewed source exactly once');
  }
  const receipts = sources.map((source) => (
    produceBrowserRelayIndependentSourceReceipt(browser, source, safeFactValuesBySource[source])
  ));
  validateCrossSourceTimeline(browser, safeFactValuesBySource);
  const controlPlane = receipts.find((receipt) => receipt.source === 'control_plane');
  const kms = receipts.find((receipt) => receipt.source === 'kms');
  if (controlPlane.counters.control_plane_exchanges !== kms.counters.kms_signatures) {
    reject('Control-plane exchange and KMS signing ledgers do not reconcile');
  }
  return Object.freeze(receipts);
}

function produceBrowserRelayIndependentMatrixReceipts(factValuesByBrowser) {
  const safeFactValuesByBrowser = rejectIndependentObserverPrivateMaterial(
    factValuesByBrowser,
    'independent_receipt_matrix',
  );
  if (safeFactValuesByBrowser === null || Array.isArray(safeFactValuesByBrowser)
    || typeof safeFactValuesByBrowser !== 'object') {
    reject('Independent receipt matrix must be one exact three-browser object');
  }
  const browsers = Object.keys(safeFactValuesByBrowser).sort();
  if (browsers.length !== BROWSER_ORDER.length
    || browsers.some((browser, index) => browser !== [...BROWSER_ORDER].sort()[index])) {
    reject('Independent receipt matrix must contain every reviewed browser exactly once');
  }
  const receiptsByBrowser = Object.fromEntries(BROWSER_ORDER.map((browser) => [
    browser,
    produceBrowserRelayIndependentSourceReceipts(
      browser,
      safeFactValuesByBrowser[browser],
    ),
  ]));
  const controlPlaneRevisions = Object.fromEntries(BROWSER_ORDER.map((browser) => [
    browser,
    receiptsByBrowser[browser]
      .find((receipt) => receipt.source === 'control_plane').revision_ids,
  ]));
  const activationRevision = controlPlaneRevisions.chromium[1];
  for (const browser of ['firefox', 'webkit']) {
    if (controlPlaneRevisions[browser].length !== 1
      || controlPlaneRevisions[browser][0] !== activationRevision) {
      reject('Secondary browsers do not share Chromium activation revision lineage');
    }
  }
  return Object.freeze(Object.fromEntries(BROWSER_ORDER.map((browser) => [
    browser,
    receiptsByBrowser[browser],
  ])));
}

function exactBrowserMap(value, path) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...BROWSER_ORDER].sort())) {
    reject(`${path} must contain exactly the three reviewed browsers`);
  }
  return value;
}

function operationFactElapsed(factValuesByBrowser, browserStarts, browser, source, kind) {
  return browserStarts[browser]
    + factElapsed(factValuesByBrowser[browser], source, kind);
}

function validateCrossBrowserTimeline(
  factValuesByBrowser,
  browserStarts,
  pageReceiptCloses,
  durations,
) {
  const liveEightCompleted = operationFactElapsed(
    factValuesByBrowser,
    browserStarts,
    'chromium',
    'coordinator',
    'physical_call_delivery',
  );
  const liveElevenStarted = operationFactElapsed(
    factValuesByBrowser,
    browserStarts,
    'chromium',
    'control_plane',
    'version_1_jwk_retained',
  );
  const firefoxFinished = browserStarts.firefox + durations.firefox;
  const webkitFinished = browserStarts.webkit + durations.webkit;
  if (pageReceiptCloses.chromium <= liveEightCompleted) {
    reject('Chromium page receipt does not close after the final LIVE-08 signal');
  }
  if (firefoxFinished >= browserStarts.webkit) {
    reject('Firefox does not finish before the WebKit browser window starts');
  }
  if (webkitFinished >= liveElevenStarted) {
    reject('WebKit does not finish before Chromium LIVE-11 starts');
  }
  for (const browser of ['firefox', 'webkit']) {
    const operationElapsed = Object.values(factValuesByBrowser[browser])
      .flatMap((facts) => facts.map((fact) => (
        browserStarts[browser] + fact.elapsed_milliseconds
      )));
    if (browserStarts[browser] <= pageReceiptCloses.chromium
      || Math.min(...operationElapsed) < browserStarts[browser]
      || Math.max(...operationElapsed) > pageReceiptCloses[browser]
      || pageReceiptCloses[browser] >= liveElevenStarted) {
      reject(
        `${browser} browser window is not globally bracketed between LIVE-09 and LIVE-11`,
      );
    }
  }
}

export function produceBrowserRelayIndependentRunnerResult(value) {
  const input = rejectIndependentObserverPrivateMaterial(
    value,
    'independent_runner_input',
  );
  if (input === null || Array.isArray(input) || typeof input !== 'object'
    || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify([
      'browser_start_elapsed_milliseconds',
      'engine_durations_milliseconds',
      'fact_values_by_browser',
      'page_receipt_closed_elapsed_milliseconds_by_browser',
      'page_receipts_by_browser',
      'total_duration_milliseconds',
    ])) {
    reject('Independent runner input differs from the reviewed fields');
  }
  const factsByBrowser = exactBrowserMap(
    input.fact_values_by_browser,
    'independent_runner_input.fact_values_by_browser',
  );
  const pageReceiptsByBrowser = exactBrowserMap(
    input.page_receipts_by_browser,
    'independent_runner_input.page_receipts_by_browser',
  );
  const durations = exactBrowserMap(
    input.engine_durations_milliseconds,
    'independent_runner_input.engine_durations_milliseconds',
  );
  const browserStarts = exactBrowserMap(
    input.browser_start_elapsed_milliseconds,
    'independent_runner_input.browser_start_elapsed_milliseconds',
  );
  const pageReceiptCloses = exactBrowserMap(
    input.page_receipt_closed_elapsed_milliseconds_by_browser,
    'independent_runner_input.page_receipt_closed_elapsed_milliseconds_by_browser',
  );
  if (!Number.isSafeInteger(input.total_duration_milliseconds)
    || input.total_duration_milliseconds < 0
    || input.total_duration_milliseconds > MAXIMUM_TOTAL_MILLISECONDS) {
    reject('Independent runner total duration is outside the reviewed bound');
  }
  for (const browser of BROWSER_ORDER) {
    if (!Number.isSafeInteger(browserStarts[browser])
      || browserStarts[browser] < 0
      || browserStarts[browser] > input.total_duration_milliseconds) {
      reject(`${browser} start offset is outside the operation timeline`);
    }
  }
  if (browserStarts.chromium !== 0) {
    reject('Chromium must anchor the operation monotonic epoch');
  }
  const independentReceipts = produceBrowserRelayIndependentMatrixReceipts(factsByBrowser);
  for (const browser of BROWSER_ORDER) {
    const maximumFactElapsed = Math.max(...Object.values(factsByBrowser[browser])
      .flatMap((facts) => facts.map((fact) => fact.elapsed_milliseconds)));
    if (!Number.isSafeInteger(durations[browser])
      || durations[browser] < maximumFactElapsed) {
      reject(`${browser} engine duration ends before its independent source facts`);
    }
    if (browser === 'chromium'
      && durations[browser] < MINIMUM_CHROMIUM_ENGINE_DURATION_MILLISECONDS) {
      reject('Chromium engine duration cannot contain both scheduled page renewals');
    }
    if (browserStarts[browser] + durations[browser] > input.total_duration_milliseconds) {
      reject(`${browser} engine duration exceeds the operation timeline`);
    }
    if (!Number.isSafeInteger(pageReceiptCloses[browser])
      || pageReceiptCloses[browser] < browserStarts[browser]
      || pageReceiptCloses[browser] > browserStarts[browser] + durations[browser]) {
      reject(`${browser} page receipt closure is outside its browser window`);
    }
  }
  validateCrossBrowserTimeline(
    factsByBrowser,
    browserStarts,
    pageReceiptCloses,
    durations,
  );
  const engineResults = BROWSER_ORDER.map((browser) => {
    const receiptsBySource = Object.fromEntries(
      independentReceipts[browser].map((receipt) => [receipt.source, receipt]),
    );
    const receipts = SOURCE_ORDER_BY_BROWSER[browser].map((source) => (
      source === 'browser_page' ? pageReceiptsByBrowser[browser] : receiptsBySource[source]
    ));
    return aggregateClosedBrowserRelayEngineEvidence(browser, receipts, durations[browser]);
  });
  return buildClosedRunnerResult(
    engineResults,
    input.total_duration_milliseconds,
    browserStarts,
  );
}
