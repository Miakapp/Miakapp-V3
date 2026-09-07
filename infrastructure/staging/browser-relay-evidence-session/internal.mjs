import {
  FACT_ORDER_BY_BROWSER,
  INDEPENDENT_SOURCE_FACT_SCHEMA,
  INDEPENDENT_SOURCES_BY_BROWSER,
  rejectIndependentObserverPrivateMaterial,
  validateIndependentSourceFact,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  produceBrowserRelayIndependentRunnerResult,
} from '../browser-relay-independent-observers/observers.mjs';
import {
  PAGE_FACT_ORDER_BY_BROWSER,
  PAGE_FACT_SCHEMA,
} from '../browser-relay-page-receipt/contract.mjs';
import {
  createBrowserRelayPageReceiptProducer,
} from '../browser-relay-page-receipt/producer.mjs';
import {
  BROWSER_DEADLINES_MILLISECONDS,
  BROWSER_ORDER,
  MAXIMUM_TOTAL_MILLISECONDS,
} from '../browser-relay-runner/contract.mjs';
import {
  INDEPENDENT_PORT_PAYLOAD_FIELDS,
  PAGE_PORT_PAYLOAD_FIELDS,
  StagingBrowserRelayEvidenceSessionError,
  validateBrowserRelayEvidenceSessionProfile,
} from './contract.mjs';

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const MAXIMUM_TOTAL_NANOSECONDS =
  BigInt(MAXIMUM_TOTAL_MILLISECONDS) * NANOSECONDS_PER_MILLISECOND;

function reject(message) {
  throw new StagingBrowserRelayEvidenceSessionError(message);
}

function exactPayload(value, fields, path) {
  const snapshot = rejectIndependentObserverPrivateMaterial(value, path);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== 'object'
    || JSON.stringify(Object.keys(snapshot).sort()) !== JSON.stringify([...fields].sort())) {
    reject(`${path} must contain exactly the reviewed projections`);
  }
  return snapshot;
}

function milliseconds(nanoseconds) {
  return Number(nanoseconds / NANOSECONDS_PER_MILLISECOND);
}

function nonSerializable(target, fail) {
  Object.defineProperty(target, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: fail,
  });
  return Object.freeze(target);
}

export function createBrowserRelayEvidenceSessionWithClock(clock) {
  if (arguments.length !== 1 || typeof clock !== 'function') {
    reject('Internal evidence session clock must be one function');
  }
  validateBrowserRelayEvidenceSessionProfile();
  let epochNanoseconds;
  try {
    epochNanoseconds = clock();
  } catch {
    return reject('Evidence session monotonic clock failed during creation');
  }
  if (typeof epochNanoseconds !== 'bigint' || epochNanoseconds < 0n) {
    reject('Evidence session monotonic clock returned an invalid instant');
  }

  const capability = Symbol('browser-relay-evidence-session');
  let activeCapability = capability;
  let state = 'collecting';
  let lastNanoseconds = epochNanoseconds;
  let readingClock = false;
  const portCache = new Map();
  const browsers = Object.fromEntries(BROWSER_ORDER.map((browser) => [browser, {
    status: browser === 'chromium' ? 'active' : 'pending',
    startNanoseconds: browser === 'chromium' ? epochNanoseconds : undefined,
    startElapsedMilliseconds: browser === 'chromium' ? 0 : undefined,
    finishNanoseconds: undefined,
    finishElapsedMilliseconds: undefined,
    durationMilliseconds: undefined,
    pageSequence: 1,
    pageProducer: browser === 'chromium'
      ? createBrowserRelayPageReceiptProducer(browser)
      : undefined,
    pageReceipt: undefined,
    pageReceiptCloseNanoseconds: undefined,
    pageReceiptCloseElapsedMilliseconds: undefined,
    independentFacts: Object.fromEntries(
      INDEPENDENT_SOURCES_BY_BROWSER[browser].map((source) => [source, []]),
    ),
  }]));

  function requireCapability(candidate) {
    if (state !== 'collecting' || activeCapability !== candidate) {
      reject('Evidence session capability is no longer active');
    }
  }

  function discard(nextState) {
    for (const browser of BROWSER_ORDER) {
      const browserState = browsers[browser];
      if (browserState.pageProducer !== undefined) {
        try {
          browserState.pageProducer.abort();
        } catch {}
      }
      browserState.pageProducer = undefined;
      browserState.pageReceipt = undefined;
      browserState.pageReceiptCloseNanoseconds = undefined;
      browserState.pageReceiptCloseElapsedMilliseconds = undefined;
      browserState.startNanoseconds = undefined;
      browserState.startElapsedMilliseconds = undefined;
      browserState.finishNanoseconds = undefined;
      browserState.finishElapsedMilliseconds = undefined;
      browserState.durationMilliseconds = undefined;
      browserState.pageSequence = PAGE_FACT_ORDER_BY_BROWSER[browser].length + 1;
      browserState.independentFacts = Object.fromEntries(
        INDEPENDENT_SOURCES_BY_BROWSER[browser].map((source) => [source, []]),
      );
      browserState.status = nextState;
    }
    portCache.clear();
    activeCapability = undefined;
    epochNanoseconds = 0n;
    lastNanoseconds = 0n;
    state = nextState;
  }

  function failSession(nextState, message) {
    discard(nextState);
    reject(message);
  }

  function readInstant(candidate) {
    requireCapability(candidate);
    if (readingClock) {
      return failSession('failed', 'Evidence session monotonic clock was re-entered');
    }
    let value;
    readingClock = true;
    try {
      value = clock();
    } catch {
      return failSession('failed', 'Evidence session monotonic clock failed');
    } finally {
      readingClock = false;
    }
    requireCapability(candidate);
    if (typeof value !== 'bigint' || value < lastNanoseconds) {
      return failSession('failed', 'Evidence session monotonic clock moved backward');
    }
    const operationNanoseconds = value - epochNanoseconds;
    if (operationNanoseconds < 0n || operationNanoseconds > MAXIMUM_TOTAL_NANOSECONDS) {
      return failSession('failed', 'Evidence session exceeded its operation timeline');
    }
    lastNanoseconds = value;
    return Object.freeze({
      nanoseconds: value,
      operationElapsedMilliseconds: milliseconds(operationNanoseconds),
    });
  }

  function activeBrowser(candidate, browser) {
    requireCapability(candidate);
    if (!BROWSER_ORDER.includes(browser) || browsers[browser].status !== 'active') {
      return failSession('failed', 'Evidence port browser is not the active reviewed browser');
    }
    return browsers[browser];
  }

  function browserElapsed(candidate, browser) {
    const browserState = activeBrowser(candidate, browser);
    const instant = readInstant(candidate);
    const elapsedNanoseconds = instant.nanoseconds - browserState.startNanoseconds;
    if (elapsedNanoseconds < 0n
      || elapsedNanoseconds > BigInt(BROWSER_DEADLINES_MILLISECONDS[browser])
        * NANOSECONDS_PER_MILLISECOND) {
      return failSession('failed', `${browser} evidence exceeded its browser timeline`);
    }
    return Object.freeze({
      ...instant,
      browserElapsedMilliseconds: milliseconds(elapsedNanoseconds),
    });
  }

  function recordPage(candidate, browser, payload) {
    const browserState = activeBrowser(candidate, browser);
    if (browserState.pageReceipt !== undefined || browserState.pageProducer === undefined) {
      return failSession('failed', 'Browser-page evidence arrived after receipt closure');
    }
    let snapshot;
    try {
      snapshot = exactPayload(payload, PAGE_PORT_PAYLOAD_FIELDS, 'page_port_payload');
    } catch {
      return failSession('failed', 'Browser-page port rejected an unreviewed projection');
    }
    const sequence = browserState.pageSequence;
    if (sequence > PAGE_FACT_ORDER_BY_BROWSER[browser].length) {
      return failSession('failed', 'Browser-page port received too many projections');
    }
    const instant = browserElapsed(candidate, browser);
    const pageInstance = browser === 'chromium' && sequence >= 16 ? 2 : 1;
    const fact = {
      schema: PAGE_FACT_SCHEMA,
      browser,
      sequence,
      phase: PAGE_FACT_ORDER_BY_BROWSER[browser][sequence - 1],
      page_instance: pageInstance,
      input_generation: pageInstance,
      identity_generation: pageInstance,
      elapsed_milliseconds: instant.browserElapsedMilliseconds,
      ...snapshot,
    };
    try {
      browserState.pageProducer.record(fact);
    } catch {
      return failSession('failed', 'Browser-page port rejected its next reviewed projection');
    }
    browserState.pageSequence += 1;
    return true;
  }

  function recordIndependent(candidate, browser, source, payload) {
    const browserState = activeBrowser(candidate, browser);
    let snapshot;
    try {
      snapshot = exactPayload(
        payload,
        INDEPENDENT_PORT_PAYLOAD_FIELDS,
        'independent_port_payload',
      );
    } catch {
      return failSession('failed', 'Independent source port rejected an unreviewed projection');
    }
    const facts = browserState.independentFacts[source];
    const sequence = facts.length + 1;
    const kinds = FACT_ORDER_BY_BROWSER[browser][source];
    if (sequence > kinds.length) {
      return failSession('failed', 'Independent source port received too many projections');
    }
    const kind = kinds[sequence - 1];
    const beginsLiveEleven = browser === 'chromium' && source === 'control_plane'
      && kind === 'version_1_jwk_retained';
    if (beginsLiveEleven
      && (browsers.firefox.status !== 'finished' || browsers.webkit.status !== 'finished')) {
      return failSession('failed', 'Chromium LIVE-11 evidence preceded both LIVE-10 browsers');
    }
    const instant = browserElapsed(candidate, browser);
    if (beginsLiveEleven
      && (instant.nanoseconds <= browsers.webkit.finishNanoseconds
        || instant.operationElapsedMilliseconds <= browsers.webkit.finishElapsedMilliseconds)) {
      return failSession('failed', 'Chromium LIVE-11 did not cross the WebKit boundary');
    }
    let fact;
    try {
      fact = validateIndependentSourceFact({
        schema: INDEPENDENT_SOURCE_FACT_SCHEMA,
        browser,
        source,
        sequence,
        kind,
        elapsed_milliseconds: instant.browserElapsedMilliseconds,
        observation: snapshot.observation,
      }, browser, source, sequence);
    } catch {
      return failSession('failed', 'Independent source port rejected its next observation');
    }
    facts.push(fact);
    return true;
  }

  function createPort(candidate, browser, source) {
    const browserState = activeBrowser(candidate, browser);
    if (source !== 'browser_page'
      && !INDEPENDENT_SOURCES_BY_BROWSER[browser].includes(source)) {
      return failSession('failed', 'Evidence port source is not owned by its browser');
    }
    if (source === 'browser_page'
      && (browserState.pageReceipt !== undefined || browserState.pageProducer === undefined)) {
      return failSession('failed', 'Browser-page port cannot be issued after receipt closure');
    }
    const key = `${browser}\0${source}`;
    if (portCache.has(key)) return portCache.get(key);
    const port = nonSerializable({
      record(payload) {
        requireCapability(candidate);
        return source === 'browser_page'
          ? recordPage(candidate, browser, payload)
          : recordIndependent(candidate, browser, source, payload);
      },
    }, () => failSession('failed', 'Evidence source ports cannot be serialized'));
    portCache.set(key, port);
    return port;
  }

  function closePage(candidate, browser) {
    const browserState = activeBrowser(candidate, browser);
    if (browserState.pageReceipt !== undefined || browserState.pageProducer === undefined) {
      return failSession('failed', 'Browser-page receipt may close exactly once');
    }
    const instant = browserElapsed(candidate, browser);
    let receipt;
    try {
      receipt = browserState.pageProducer.close();
    } catch {
      return failSession('failed', 'Browser-page receipt could not close reviewed evidence');
    }
    browserState.pageProducer = undefined;
    browserState.pageReceipt = receipt;
    browserState.pageReceiptCloseNanoseconds = instant.nanoseconds;
    browserState.pageReceiptCloseElapsedMilliseconds = instant.operationElapsedMilliseconds;
    return true;
  }

  function startBrowser(candidate, browser) {
    requireCapability(candidate);
    if (!['firefox', 'webkit'].includes(browser) || browsers[browser].status !== 'pending'
      || browsers.chromium.status !== 'active') {
      return failSession('failed', 'Secondary browser start order is invalid');
    }
    if (browser === 'firefox') {
      if (browsers.chromium.pageReceipt === undefined
        || browsers.webkit.status !== 'pending') {
        return failSession('failed', 'Firefox must start after Chromium page receipt closure');
      }
    } else if (browsers.firefox.status !== 'finished') {
      return failSession('failed', 'WebKit must start after Firefox finishes');
    }
    const instant = readInstant(candidate);
    const boundaryNanoseconds = browser === 'firefox'
      ? browsers.chromium.pageReceiptCloseNanoseconds
      : browsers.firefox.finishNanoseconds;
    const boundaryMilliseconds = browser === 'firefox'
      ? browsers.chromium.pageReceiptCloseElapsedMilliseconds
      : browsers.firefox.finishElapsedMilliseconds;
    if (instant.nanoseconds <= boundaryNanoseconds
      || instant.operationElapsedMilliseconds <= boundaryMilliseconds) {
      return failSession('failed', `${browser} did not cross its strict operation boundary`);
    }
    const browserState = browsers[browser];
    browserState.status = 'active';
    browserState.startNanoseconds = instant.nanoseconds;
    browserState.startElapsedMilliseconds = instant.operationElapsedMilliseconds;
    try {
      browserState.pageProducer = createBrowserRelayPageReceiptProducer(browser);
    } catch {
      return failSession('failed', `${browser} page producer could not start`);
    }
    return true;
  }

  function finishBrowser(candidate, browser) {
    const browserState = activeBrowser(candidate, browser);
    if (browserState.pageReceipt === undefined) {
      return failSession('failed', `${browser} cannot finish before its page receipt closes`);
    }
    if (browser === 'firefox' && browsers.webkit.status !== 'pending') {
      return failSession('failed', 'Firefox must finish before WebKit starts');
    }
    if (browser === 'webkit' && browsers.firefox.status !== 'finished') {
      return failSession('failed', 'WebKit cannot finish before Firefox');
    }
    if (browser === 'chromium'
      && (browsers.firefox.status !== 'finished' || browsers.webkit.status !== 'finished')) {
      return failSession('failed', 'Chromium must finish after both secondary browsers');
    }
    for (const source of INDEPENDENT_SOURCES_BY_BROWSER[browser]) {
      if (browserState.independentFacts[source].length
        !== FACT_ORDER_BY_BROWSER[browser][source].length) {
        return failSession('failed', `${browser} cannot finish before every source fact arrived`);
      }
    }
    const instant = browserElapsed(candidate, browser);
    browserState.status = 'finished';
    browserState.finishNanoseconds = instant.nanoseconds;
    browserState.finishElapsedMilliseconds = instant.operationElapsedMilliseconds;
    browserState.durationMilliseconds = instant.operationElapsedMilliseconds
      - browserState.startElapsedMilliseconds;
    return true;
  }

  function close(candidate) {
    requireCapability(candidate);
    if (BROWSER_ORDER.some((browser) => browsers[browser].status !== 'finished')) {
      return failSession('failed', 'Evidence session cannot close before every browser finishes');
    }
    const instant = readInstant(candidate);
    const input = {
      fact_values_by_browser: Object.fromEntries(BROWSER_ORDER.map((browser) => [
        browser,
        browsers[browser].independentFacts,
      ])),
      page_receipts_by_browser: Object.fromEntries(BROWSER_ORDER.map((browser) => [
        browser,
        browsers[browser].pageReceipt,
      ])),
      engine_durations_milliseconds: Object.fromEntries(BROWSER_ORDER.map((browser) => [
        browser,
        browsers[browser].durationMilliseconds,
      ])),
      browser_start_elapsed_milliseconds: Object.fromEntries(BROWSER_ORDER.map((browser) => [
        browser,
        browsers[browser].startElapsedMilliseconds,
      ])),
      page_receipt_closed_elapsed_milliseconds_by_browser: Object.fromEntries(
        BROWSER_ORDER.map((browser) => [
          browser,
          browsers[browser].pageReceiptCloseElapsedMilliseconds,
        ]),
      ),
      total_duration_milliseconds: instant.operationElapsedMilliseconds,
    };
    let result;
    try {
      result = produceBrowserRelayIndependentRunnerResult(input);
    } catch {
      return failSession('failed', 'Evidence session could not reconcile reviewed evidence');
    }
    discard('closed');
    return result;
  }

  const root = {
    port(browser, source) {
      return createPort(capability, browser, source);
    },
    startBrowser(browser) {
      return startBrowser(capability, browser);
    },
    closePage(browser) {
      return closePage(capability, browser);
    },
    finishBrowser(browser) {
      return finishBrowser(capability, browser);
    },
    close() {
      return close(capability);
    },
    abort() {
      requireCapability(capability);
      discard('aborted');
      return true;
    },
  };
  return nonSerializable(
    root,
    () => failSession('failed', 'Evidence session capabilities cannot be serialized'),
  );
}
