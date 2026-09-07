import { addAbortListener } from 'node:events';
import { isDeepStrictEqual } from 'node:util';

import {
  FACT_KINDS_BY_STAGE,
} from '../../browser-relay-case-scheduler/contract.mjs';
import {
  INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER,
} from '../../browser-relay-independent-case-adapter/contract.mjs';
import {
  fullIndependentFacts,
} from './browser-relay-evidence-fixture.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function exactLifecycle(value) {
  const candidate = value ?? {};
  if (candidate === null || Array.isArray(candidate) || typeof candidate !== 'object') {
    throw new Error('Deterministic lifecycle callbacks are invalid');
  }
  const expected = ['close', 'closeBrowser', 'startBrowser'];
  if (Object.keys(candidate).some((key) => !expected.includes(key))
    || Object.values(candidate).some((entry) => typeof entry !== 'function')) {
    throw new Error('Deterministic lifecycle callbacks differ from the reviewed methods');
  }
  return candidate;
}

export function createDeterministicIndependentSourceHarness({
  browserStarts,
  clock,
  lifecycle,
  trace = [],
} = {}) {
  if (browserStarts === null || typeof browserStarts !== 'object'
    || clock === null || typeof clock !== 'object'
    || !['advanceMilliseconds', 'lastMilliseconds', 'setAtLeastMilliseconds']
      .every((method) => typeof clock[method] === 'function')
    || !Array.isArray(trace)) {
    throw new Error('Deterministic independent source harness inputs are invalid');
  }
  const lifecycleCallbacks = exactLifecycle(lifecycle);
  const facts = fullIndependentFacts();
  const cursors = Object.fromEntries(Object.entries(facts).map(([browser, sources]) => [
    browser,
    Object.fromEntries(Object.keys(sources).map((source) => [source, 0])),
  ]));
  const observerCloseCalls = Object.fromEntries(
    INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER.map((source) => [source, 0]),
  );
  const observedCalls = [];
  const registrationsByStage = new Map();
  let browserLifecycleCloseCalls = 0;

  function stageSources(stageKey) {
    return Object.entries(FACT_KINDS_BY_STAGE[stageKey])
      .filter(([source]) => source !== 'browser_page');
  }

  function settleRegistrations(registrations, method, value) {
    for (const registration of registrations.values()) {
      try { registration.subscription[Symbol.dispose]?.(); } catch {}
      registration[method](value);
    }
  }

  function driveStage(stageKey, registrations) {
    const [caseId, browser] = stageKey.split('/');
    const records = [];
    let stableOrder = 0;
    for (const [source, expectedKinds] of stageSources(stageKey)) {
      const start = cursors[browser][source];
      const values = facts[browser][source].slice(start, start + expectedKinds.length);
      if (!isDeepStrictEqual(values.map(({ kind }) => kind), expectedKinds)) {
        settleRegistrations(registrations, 'reject', new Error('Fact partition drift'));
        return;
      }
      for (const value of values) {
        records.push({
          elapsed: value.elapsed_milliseconds,
          kind: value.kind,
          observation: structuredClone(value.observation),
          order: stableOrder += 1,
          source,
        });
      }
    }
    records.sort((left, right) => left.elapsed - right.elapsed || left.order - right.order);
    try {
      const browserStart = browserStarts[browser] ?? 0;
      for (const record of records) {
        clock.setAtLeastMilliseconds(browserStart + record.elapsed);
        const registration = registrations.get(record.source);
        if (registration.scope.record(record.observation) !== true) {
          throw new Error('Observation was not acknowledged');
        }
        cursors[browser][record.source] += 1;
        observedCalls.push(Object.freeze({
          browser,
          case_id: caseId,
          kind: record.kind,
          source: record.source,
        }));
        trace.push(`observer:${record.source}:${caseId}/${browser}:${record.kind}`);
      }
      registrationsByStage.delete(stageKey);
      settleRegistrations(registrations, 'resolve', undefined);
    } catch (error) {
      registrationsByStage.delete(stageKey);
      settleRegistrations(registrations, 'reject', error);
    }
  }

  function executeSource(source, scope) {
    const stageKey = `${scope.case_id}/${scope.browser}`;
    const expectedSources = stageSources(stageKey).map(([name]) => name);
    if (!expectedSources.includes(source)) {
      throw new Error(`Unexpected ${source} observer stage`);
    }
    let registrations = registrationsByStage.get(stageKey);
    if (registrations === undefined) {
      registrations = new Map();
      registrationsByStage.set(stageKey, registrations);
    }
    if (registrations.has(source)) throw new Error('Duplicate source registration');
    const completion = deferred();
    const subscription = addAbortListener(scope.signal, () => {
      completion.reject(new Error('Deterministic observer was aborted'));
    });
    registrations.set(source, {
      ...completion,
      scope,
      subscription,
    });
    trace.push(`observer:${source}:execute:${stageKey}`);
    if (registrations.size === expectedSources.length) driveStage(stageKey, registrations);
    return completion.promise;
  }

  const sourceObservers = Object.freeze(Object.fromEntries(
    INDEPENDENT_CASE_ADAPTER_SOURCE_ORDER.map((source) => [source, Object.freeze({
      execute(scope) {
        return executeSource(source, scope);
      },
      async close() {
        observerCloseCalls[source] += 1;
        trace.push(`observer:${source}:close`);
      },
    })]),
  ));

  const browserLifecycle = Object.freeze({
    async startBrowser(browser, signal) {
      trace.push(`lifecycle:startBrowser:${browser}`);
      if (lifecycleCallbacks.startBrowser !== undefined) {
        await lifecycleCallbacks.startBrowser(browser, signal);
      }
      clock.advanceMilliseconds();
      browserStarts[browser] = clock.lastMilliseconds();
    },
    async closeBrowser(browser, signal) {
      trace.push(`lifecycle:closeBrowser:${browser}`);
      clock.advanceMilliseconds();
      if (lifecycleCallbacks.closeBrowser !== undefined) {
        await lifecycleCallbacks.closeBrowser(browser, signal);
      }
    },
    async close() {
      browserLifecycleCloseCalls += 1;
      trace.push('lifecycle:close');
      if (lifecycleCallbacks.close !== undefined) await lifecycleCallbacks.close();
    },
  });

  return Object.freeze({
    browserLifecycle,
    browserLifecycleCloseCalls: () => browserLifecycleCloseCalls,
    cursors,
    observedCalls,
    observerCloseCalls,
    sourceObservers,
  });
}
