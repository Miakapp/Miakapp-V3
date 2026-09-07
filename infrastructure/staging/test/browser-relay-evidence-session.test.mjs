import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  EVIDENCE_SESSION_DEPENDENCY_CONTRACTS_SHA256,
  EVIDENCE_SESSION_INTERNAL_SOURCE_SHA256,
  EVIDENCE_SESSION_PROFILE_SHA256,
  EVIDENCE_SESSION_SOURCE_SHA256,
  EVIDENCE_SESSION_TESTING_SOURCE_SHA256,
  StagingBrowserRelayEvidenceSessionError,
  browserRelayEvidenceSessionDependencyContractsSha256,
  validateBrowserRelayEvidenceSessionProfile,
} from '../browser-relay-evidence-session/contract.mjs';
import {
  validateBrowserRelayEvidenceSessionRoot,
} from '../browser-relay-evidence-session/guard.mjs';
import {
  createBrowserRelayEvidenceSession,
} from '../browser-relay-evidence-session/session.mjs';
import {
  createBrowserRelayEvidenceSessionForTest,
} from '../browser-relay-evidence-session/testing.mjs';
import {
  INDEPENDENT_SOURCES_BY_BROWSER,
} from '../browser-relay-independent-observers/contract.mjs';
import {
  chromiumPageFacts,
  fullIndependentFacts,
  independentProjection,
  pageProjection,
  secondaryPageFacts,
} from './helpers/browser-relay-evidence-fixture.mjs';

const PACKAGE_FILES = [
  'README.md',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'session.mjs',
  'testing.mjs',
];

function controlledClock() {
  const origin = 10_000_000_000n;
  let elapsedNanoseconds = 0n;
  return {
    clock: () => origin + elapsedNanoseconds,
    setMilliseconds(value) {
      elapsedNanoseconds = BigInt(value) * 1_000_000n;
    },
    setNanoseconds(value) {
      elapsedNanoseconds = BigInt(value);
    },
  };
}

function browserPorts(session, browser) {
  return Object.fromEntries([
    'browser_page',
    ...INDEPENDENT_SOURCES_BY_BROWSER[browser],
  ].map((source) => [source, session.port(browser, source)]));
}

function eventsFor(browser, pageFacts, independentFacts, predicate = () => true) {
  const events = [];
  let order = 0;
  for (const value of pageFacts) {
    if (predicate(value.elapsed_milliseconds)) {
      events.push({
        elapsed: value.elapsed_milliseconds,
        order: order += 1,
        source: 'browser_page',
        payload: pageProjection(value),
      });
    }
  }
  for (const source of INDEPENDENT_SOURCES_BY_BROWSER[browser]) {
    for (const value of independentFacts[source]) {
      if (predicate(value.elapsed_milliseconds)) {
        events.push({
          elapsed: value.elapsed_milliseconds,
          order: order += 1,
          source,
          payload: independentProjection(value),
        });
      }
    }
  }
  return events.sort((left, right) => left.elapsed - right.elapsed || left.order - right.order);
}

function recordEvents(
  clock,
  ports,
  browserStart,
  events,
  mutateFirstPayload = false,
  browserStartNanoseconds = undefined,
) {
  let mutated = false;
  for (const event of events) {
    if (browserStartNanoseconds === undefined) {
      clock.setMilliseconds(browserStart + event.elapsed);
    } else {
      clock.setNanoseconds(
        browserStartNanoseconds + BigInt(event.elapsed) * 1_000_000n,
      );
    }
    assert.equal(ports[event.source].record(event.payload), true);
    if (mutateFirstPayload && !mutated) {
      event.payload.observation.relay_ids.push('caller-mutation-after-record');
      mutated = true;
    }
  }
}

function completeSession({
  mutateFirstPayload = false,
  fractionalFirefox = false,
  webkitFinishesAtLiveEleven = false,
} = {}) {
  const clock = controlledClock();
  const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
  const independent = fullIndependentFacts();
  const chromiumPorts = browserPorts(session, 'chromium');
  const chromiumPages = chromiumPageFacts();
  recordEvents(
    clock,
    chromiumPorts,
    0,
    eventsFor(
      'chromium',
      chromiumPages,
      independent.chromium,
      (elapsed) => elapsed < 570_000,
    ),
    mutateFirstPayload,
  );
  clock.setMilliseconds(550_000);
  assert.equal(session.closePage('chromium'), true);

  const firefoxStartMilliseconds = webkitFinishesAtLiveEleven ? 564_000 : 551_000;
  const firefoxStartNanoseconds = fractionalFirefox
    ? 551_000n * 1_000_000n + 900_000n
    : undefined;
  if (firefoxStartNanoseconds === undefined) clock.setMilliseconds(firefoxStartMilliseconds);
  else clock.setNanoseconds(firefoxStartNanoseconds);
  assert.equal(session.startBrowser('firefox'), true);
  const firefoxPorts = browserPorts(session, 'firefox');
  recordEvents(
    clock,
    firefoxPorts,
    firefoxStartMilliseconds,
    eventsFor('firefox', secondaryPageFacts('firefox'), independent.firefox),
    false,
    firefoxStartNanoseconds,
  );
  if (fractionalFirefox) clock.setNanoseconds(553_001n * 1_000_000n);
  else clock.setMilliseconds(webkitFinishesAtLiveEleven ? 566_000 : 553_000);
  assert.equal(session.closePage('firefox'), true);
  assert.equal(session.finishBrowser('firefox'), true);

  const webkitStartMilliseconds = webkitFinishesAtLiveEleven ? 567_000 : 554_000;
  clock.setMilliseconds(webkitStartMilliseconds);
  assert.equal(session.startBrowser('webkit'), true);
  const webkitPorts = browserPorts(session, 'webkit');
  recordEvents(
    clock,
    webkitPorts,
    webkitStartMilliseconds,
    eventsFor('webkit', secondaryPageFacts('webkit'), independent.webkit),
  );
  clock.setMilliseconds(webkitFinishesAtLiveEleven ? 570_000 : 556_000);
  assert.equal(session.closePage('webkit'), true);
  assert.equal(session.finishBrowser('webkit'), true);

  recordEvents(
    clock,
    chromiumPorts,
    0,
    eventsFor('chromium', [], independent.chromium, (elapsed) => elapsed >= 570_000),
  );
  clock.setMilliseconds(600_000);
  assert.equal(session.finishBrowser('chromium'), true);
  const result = session.close();
  return { result, session, chromiumPorts };
}

test('pins a dormant operation-local evidence session with no live authority', () => {
  const profile = validateBrowserRelayEvidenceSessionProfile();
  assert.equal(
    browserRelayEvidenceSessionDependencyContractsSha256(),
    EVIDENCE_SESSION_DEPENDENCY_CONTRACTS_SHA256,
  );
  assert.equal(profile.session.common_operation_epoch, true);
  assert.equal(profile.session.production_clock_captured_at_module_initialization, true);
  assert.equal(profile.session.test_clock_factory_present, true);
  assert.equal(profile.session.test_clock_factory_live_import_authorized, false);
  assert.equal(profile.session.caller_supplied_timestamps, false);
  assert.equal(profile.session.caller_supplied_sequences, false);
  assert.equal(profile.session.ports_attenuated_to_browser_source, true);
  assert.equal(profile.compatibility.operation_local_provenance_primitive_present, true);
  assert.equal(profile.compatibility.durable_claim_binding_present, false);
  assert.equal(profile.compatibility.live_operation_wired, false);
  assert.equal(profile.compatibility.live_source_adapters_present, false);
  assert.equal(profile.compatibility.interleaving_scheduler_present, true);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(profile.evidence.live_execution_count, 0);
  assert.match(EVIDENCE_SESSION_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(EVIDENCE_SESSION_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(EVIDENCE_SESSION_INTERNAL_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(EVIDENCE_SESSION_TESTING_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
});

test('derives and closes one exact interleaved matrix from attenuated projections', () => {
  const { result, session, chromiumPorts } = completeSession({ mutateFirstPayload: true });
  assert.equal(result.schema, 'miakapp.staging-browser-relay-runner-result/1');
  assert.equal(result.state, 'succeeded_closed_output');
  assert.equal(result.duration_milliseconds, 600_000);
  assert.deepEqual(result.engine_results.map((entry) => entry.duration_milliseconds), [
    600_000,
    2_000,
    2_000,
  ]);
  assert.equal(result.assertions_passed, 40);
  assert.equal(result.assertions_failed, 0);
  assert.equal(result.counters.control_plane_exchanges, 10);
  assert.equal(result.counters.kms_signatures, 10);
  assert.equal(JSON.stringify(result).includes('caller-mutation-after-record'), false);
  assert.equal(JSON.stringify(result).includes('capability'), false);
  assert.throws(() => session.close(), /no longer active/u);
  assert.throws(
    () => chromiumPorts.control_plane.record({ observation: {} }),
    /no longer active/u,
  );
});

test('derives duration from quantized common-clock endpoints', () => {
  const { result } = completeSession({ fractionalFirefox: true });
  assert.equal(result.duration_milliseconds, 600_000);
  assert.deepEqual(result.engine_results.map((entry) => entry.duration_milliseconds), [
    600_000,
    2_001,
    2_000,
  ]);
});

test('ports expose no owner metadata and reject caller envelopes permanently', () => {
  const clock = controlledClock();
  const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
  const port = session.port('chromium', 'firebase_app_check');
  assert.equal(Object.isFrozen(port), true);
  assert.deepEqual(Object.keys(port), ['record']);
  assert.equal('browser' in port, false);
  assert.equal('source' in port, false);
  const firstFact = fullIndependentFacts().chromium.firebase_app_check[0];
  assert.throws(
    () => port.record({
      observation: firstFact.observation,
      elapsed_milliseconds: firstFact.elapsed_milliseconds,
    }),
    /unreviewed projection/u,
  );
  assert.throws(() => session.abort(), /no longer active/u);
});

test('page ports reject replayed facts and caller-owned envelope fields', () => {
  const replayClock = controlledClock();
  const replaySession = createBrowserRelayEvidenceSessionForTest(replayClock.clock);
  const replayPort = replaySession.port('chromium', 'browser_page');
  const first = chromiumPageFacts()[0];
  assert.equal(replayPort.record(pageProjection(first)), true);
  assert.throws(
    () => replayPort.record(pageProjection(first)),
    /rejected its next reviewed projection/u,
  );
  assert.throws(() => replaySession.abort(), /no longer active/u);

  const envelopeClock = controlledClock();
  const envelopeSession = createBrowserRelayEvidenceSessionForTest(envelopeClock.clock);
  const envelopePort = envelopeSession.port('chromium', 'browser_page');
  assert.throws(
    () => envelopePort.record({ ...pageProjection(first), sequence: 1 }),
    /unreviewed projection/u,
  );
  assert.throws(() => envelopeSession.abort(), /no longer active/u);
});

test('a source port cannot attest another source and revokes every sibling port', () => {
  const clock = controlledClock();
  const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
  const kms = session.port('chromium', 'kms');
  const page = session.port('chromium', 'browser_page');
  clock.setMilliseconds(1_000);
  const appCheck = fullIndependentFacts().chromium.firebase_app_check[0];
  assert.throws(
    () => kms.record(independentProjection(appCheck)),
    /rejected its next observation/u,
  );
  assert.throws(
    () => page.record(pageProjection(chromiumPageFacts()[0])),
    /no longer active/u,
  );
});

test('rejects early secondary starts and same-millisecond boundary collapse', () => {
  const earlyClock = controlledClock();
  const early = createBrowserRelayEvidenceSessionForTest(earlyClock.clock);
  assert.throws(() => early.startBrowser('firefox'), /after Chromium page receipt/u);

  const clock = controlledClock();
  const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
  const page = session.port('chromium', 'browser_page');
  for (const value of chromiumPageFacts()) {
    clock.setMilliseconds(value.elapsed_milliseconds);
    page.record(pageProjection(value));
  }
  clock.setMilliseconds(550_000);
  session.closePage('chromium');
  clock.setNanoseconds(550_000n * 1_000_000n + 1n);
  assert.throws(
    () => session.startBrowser('firefox'),
    /strict operation boundary/u,
  );
});

test('rejects an unreviewed port owner and incomplete secondary source closure', () => {
  const ownerClock = controlledClock();
  const ownerSession = createBrowserRelayEvidenceSessionForTest(ownerClock.clock);
  assert.throws(
    () => ownerSession.port('chromium', 'unreviewed_source'),
    /source is not owned/u,
  );
  assert.throws(() => ownerSession.abort(), /no longer active/u);

  const clock = controlledClock();
  const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
  const chromiumPage = session.port('chromium', 'browser_page');
  for (const value of chromiumPageFacts()) {
    clock.setMilliseconds(value.elapsed_milliseconds);
    chromiumPage.record(pageProjection(value));
  }
  clock.setMilliseconds(550_000);
  session.closePage('chromium');
  clock.setMilliseconds(551_000);
  session.startBrowser('firefox');
  const firefoxPage = session.port('firefox', 'browser_page');
  for (const value of secondaryPageFacts('firefox')) {
    clock.setMilliseconds(551_000 + value.elapsed_milliseconds);
    firefoxPage.record(pageProjection(value));
  }
  clock.setMilliseconds(553_000);
  session.closePage('firefox');
  assert.throws(
    () => session.finishBrowser('firefox'),
    /before every source fact arrived/u,
  );
  assert.throws(() => firefoxPage.record({}), /no longer active/u);
});

test('rejects Chromium LIVE-11 until both secondary browsers finish', () => {
  const clock = controlledClock();
  const session = createBrowserRelayEvidenceSessionForTest(clock.clock);
  const controlPlane = session.port('chromium', 'control_plane');
  const facts = fullIndependentFacts().chromium.control_plane;
  for (const value of facts.slice(0, 8)) {
    clock.setMilliseconds(value.elapsed_milliseconds);
    controlPlane.record(independentProjection(value));
  }
  clock.setMilliseconds(facts[8].elapsed_milliseconds);
  assert.throws(
    () => controlPlane.record(independentProjection(facts[8])),
    /LIVE-11 evidence preceded both LIVE-10 browsers/u,
  );
});

test('rejects LIVE-11 in the same integer millisecond as WebKit finishes', () => {
  assert.throws(
    () => completeSession({ webkitFinishesAtLiveEleven: true }),
    /LIVE-11 did not cross the WebKit boundary/u,
  );
});

test('clock rollback, incomplete closure and abort all revoke outstanding ports', () => {
  const rollbackClock = controlledClock();
  const rollback = createBrowserRelayEvidenceSessionForTest(rollbackClock.clock);
  const rollbackPort = rollback.port('chromium', 'browser_page');
  rollbackClock.setMilliseconds(1);
  rollbackClock.setNanoseconds(-1n);
  assert.throws(
    () => rollbackPort.record(pageProjection(chromiumPageFacts()[0])),
    /moved backward/u,
  );
  assert.throws(() => rollback.abort(), /no longer active/u);

  const incompleteClock = controlledClock();
  const incomplete = createBrowserRelayEvidenceSessionForTest(incompleteClock.clock);
  const incompletePort = incomplete.port('chromium', 'browser_page');
  assert.throws(() => incomplete.closePage('chromium'), /could not close reviewed evidence/u);
  assert.throws(
    () => incompletePort.record(pageProjection(chromiumPageFacts()[0])),
    /no longer active/u,
  );

  const abortClock = controlledClock();
  const aborted = createBrowserRelayEvidenceSessionForTest(abortClock.clock);
  const abortedPort = aborted.port('chromium', 'browser_page');
  assert.equal(aborted.abort(), true);
  assert.throws(
    () => abortedPort.record(pageProjection(chromiumPageFacts()[0])),
    /no longer active/u,
  );

  const expiredClock = controlledClock();
  const expired = createBrowserRelayEvidenceSessionForTest(expiredClock.clock);
  const expiredPort = expired.port('chromium', 'browser_page');
  expiredClock.setMilliseconds(840_001);
  assert.throws(
    () => expiredPort.record(pageProjection(chromiumPageFacts()[0])),
    /exceeded its operation timeline/u,
  );
  assert.throws(() => expired.abort(), /no longer active/u);
});

test('root and source capabilities reject persistence attempts', () => {
  const rootClock = controlledClock();
  const root = createBrowserRelayEvidenceSessionForTest(rootClock.clock);
  assert.equal(Object.isFrozen(root), true);
  assert.throws(() => JSON.stringify(root), /cannot be serialized/u);
  assert.throws(() => root.abort(), /no longer active/u);

  const portClock = controlledClock();
  const session = createBrowserRelayEvidenceSessionForTest(portClock.clock);
  const port = session.port('chromium', 'relay');
  assert.throws(() => JSON.stringify(port), /cannot be serialized/u);
  assert.throws(() => session.abort(), /no longer active/u);
});

test('the production factory rejects every option without evaluating it', () => {
  let accessed = false;
  const options = {};
  Object.defineProperty(options, 'clock', {
    enumerable: true,
    get() {
      accessed = true;
      return () => 0n;
    },
  });
  assert.throws(
    () => createBrowserRelayEvidenceSession(options),
    /does not accept caller options/u,
  );
  assert.equal(accessed, false);
  for (const unreviewed of [
    { clock: () => 0n, epoch: 0n },
    new (class Options {})(),
    new Proxy({}, {
      ownKeys() {
        throw new Error('private-own-keys-diagnostic');
      },
    }),
    new Proxy({ clock: () => 0n }, {
      getOwnPropertyDescriptor() {
        throw new Error('private-descriptor-diagnostic');
      },
    }),
  ]) {
    assert.throws(
      () => createBrowserRelayEvidenceSession(unreviewed),
      (error) => error instanceof StagingBrowserRelayEvidenceSessionError
        && error.message === 'Evidence session creation does not accept caller options',
    );
  }
});

test('the production session retains its captured system clock primitive', () => {
  const session = createBrowserRelayEvidenceSession();
  const port = session.port('chromium', 'firebase_app_check');
  const original = process.hrtime.bigint;
  try {
    process.hrtime.bigint = () => {
      throw new Error('replacement-clock-must-not-run');
    };
    assert.equal(port.record(independentProjection(
      fullIndependentFacts().chromium.firebase_app_check[0],
    )), true);
  } finally {
    process.hrtime.bigint = original;
    session.abort();
  }
});

test('a re-entrant injected clock cannot continue a transition after revocation', () => {
  const origin = 10_000_000_000n;
  let session;
  let revokeDuringRead = false;
  const clock = () => {
    if (revokeDuringRead) {
      revokeDuringRead = false;
      session.abort();
    }
    return origin;
  };
  session = createBrowserRelayEvidenceSessionForTest(clock);
  const port = session.port('chromium', 'firebase_app_check');
  revokeDuringRead = true;
  assert.throws(
    () => port.record(independentProjection(
      fullIndependentFacts().chromium.firebase_app_check[0],
    )),
    /no longer active/u,
  );
  assert.throws(() => session.abort(), /no longer active/u);
});

test('guards the exact dormant evidence-session package', () => {
  const sourceRoot = new URL('../browser-relay-evidence-session/', import.meta.url);
  assert.equal(validateBrowserRelayEvidenceSessionRoot(sourceRoot), undefined);
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-session-'));
  for (const name of PACKAGE_FILES) {
    copyFileSync(new URL(name, sourceRoot), join(temporaryRoot, name));
  }
  assert.equal(
    validateBrowserRelayEvidenceSessionRoot(new URL(`file://${temporaryRoot}/`)),
    undefined,
  );
  writeFileSync(join(temporaryRoot, 'credential.json'), '{}\n');
  assert.throws(
    () => validateBrowserRelayEvidenceSessionRoot(new URL(`file://${temporaryRoot}/`)),
    /reviewed inventory/u,
  );
});

test('uses one collapsed public error class for invalid session input', () => {
  for (const operation of [
    () => createBrowserRelayEvidenceSessionForTest(() => '0'),
    () => createBrowserRelayEvidenceSessionForTest(() => { throw new Error('secret'); }),
    () => createBrowserRelayEvidenceSessionForTest(undefined),
  ]) {
    assert.throws(
      operation,
      (error) => error instanceof StagingBrowserRelayEvidenceSessionError
        && !error.message.includes('secret'),
    );
  }
});
