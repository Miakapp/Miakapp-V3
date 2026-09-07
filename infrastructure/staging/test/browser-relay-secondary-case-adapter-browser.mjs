import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { firefox, webkit } from 'playwright';

import {
  FACT_KINDS_BY_STAGE,
} from '../browser-relay-case-scheduler/contract.mjs';
import {
  runBrowserRelayCaseScheduleForTest,
} from '../browser-relay-case-scheduler/testing.mjs';
import {
  runBrowserRelayChromiumCaseScheduleForTesting,
} from '../browser-relay-chromium-case-adapter/testing.mjs';
import {
  CHROMIUM_SCENARIO_RESULT_SCHEMA,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  createBrowserRelayEvidenceSessionForTest,
} from '../browser-relay-evidence-session/testing.mjs';
import {
  createBrowserRelayPageReceiptProducer,
} from '../browser-relay-page-receipt/producer.mjs';
import {
  TARGET_ORIGIN,
  TARGET_URL,
} from '../browser-relay-page/contract.mjs';
import {
  runBrowserRelayPlaywrightBridge,
} from '../browser-relay-playwright-bridge/bridge.mjs';
import {
  validateBrowserRelaySecondaryCaseAdapterProfile,
} from '../browser-relay-secondary-case-adapter/contract.mjs';
import {
  runBrowserRelaySecondaryCaseScheduleForTesting,
} from '../browser-relay-secondary-case-adapter/testing.mjs';
import {
  chromiumPageFacts,
  fullIndependentFacts,
  independentProjection,
  pageProjection,
} from './helpers/browser-relay-evidence-fixture.mjs';

const engines = Object.freeze({ firefox, webkit });
const modules = Object.freeze([
  'browser-relay-page/runtime.mjs',
  'browser-relay-page/boundary.mjs',
  'test/helpers/browser-relay-page-harness.mjs',
  'test/helpers/browser-relay-playwright-bridge-entry.mjs',
]);
const moduleResponses = new Map(modules.map((path) => [
  `${TARGET_ORIGIN}/${path}`,
  readFileSync(new URL(`../${path}`, import.meta.url)),
]));
const documentSource = '<!doctype html><html><head><meta charset="utf-8">'
  + '<link rel="icon" href="data:,"><title>Offline secondary case adapter</title></head>'
  + '<body><script type="module" src="/test/helpers/'
  + 'browser-relay-playwright-bridge-entry.mjs"></script></body></html>';
const independent = fullIndependentFacts();
const cursors = Object.fromEntries(Object.entries(independent).map(([browser, sources]) => [
  browser,
  Object.fromEntries(Object.keys(sources).map((source) => [source, 0])),
]));
const browserStarts = { chromium: undefined, firefox: undefined, webkit: undefined };
const launched = {};
const pages = {};
const inputOrder = [];
const origin = 50_000_000_000n;
let elapsedNanoseconds = 0n;
let lastNanoseconds = 0n;
let fixtureRevision = 1;
let fixtureTemperature = 20;
let remainingCloseCalls = 0;

function clock() {
  lastNanoseconds = elapsedNanoseconds;
  return origin + lastNanoseconds;
}

function advanceMilliseconds(value = 1) {
  elapsedNanoseconds += BigInt(value) * 1_000_000n;
}

function setAtLeastMilliseconds(value) {
  const candidate = BigInt(value) * 1_000_000n;
  if (candidate > elapsedNanoseconds) elapsedNanoseconds = candidate;
}

function lastMilliseconds() {
  return Number(lastNanoseconds / 1_000_000n);
}

function token(a, b, c) {
  return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
}

function closedChromiumScenarioResult() {
  const producer = createBrowserRelayPageReceiptProducer('chromium');
  for (const fact of chromiumPageFacts()) producer.record(fact);
  return Object.freeze({
    schema: CHROMIUM_SCENARIO_RESULT_SCHEMA,
    browser: 'chromium',
    state: 'receipt_closed',
    private_inputs_requested: 2,
    page_instances: 2,
    native_bfcache_restores: 1,
    receipt: producer.close(),
  });
}

async function chromiumScenario(dependencies, port, options) {
  const facts = chromiumPageFacts();
  const record = async (sequence) => {
    setAtLeastMilliseconds(
      browserStarts.chromium + facts[sequence - 1].elapsed_milliseconds,
    );
    assert.equal(await port.record(pageProjection(facts[sequence - 1]), options.signal), true);
  };
  const control = (phase) => dependencies.controlPhase(phase, options.signal);
  await dependencies.openPage(1, options.signal);
  await dependencies.privateInputProvider('chromium', 1, options.signal);
  await record(1);
  await record(2);
  await control('authoritative_state');
  await record(3);
  await control('patched_state');
  await record(4);
  await control('initial_call');
  await record(5);
  await control('same_relay_reauthenticated');
  await record(6);
  await control('relay_handoff_stale');
  await record(7);
  await control('relay_b_ready');
  await record(8);
  await control('relay_b_state');
  await record(9);
  await control('relay_b_call');
  await record(10);
  await control('failed_call');
  await control('uncertain_call');
  await record(11);
  await control('relay_b_recovered');
  await record(12);
  for (let sequence = 13; sequence <= 15; sequence += 1) await record(sequence);
  await dependencies.openPage(2, options.signal);
  await dependencies.privateInputProvider('chromium', 2, options.signal);
  for (let sequence = 16; sequence <= 18; sequence += 1) await record(sequence);
  return closedChromiumScenarioResult();
}

function recordIndependentStage(scope) {
  const stageKey = `${scope.case_id}/${scope.browser}`;
  const records = [];
  let order = 0;
  for (const [source, kinds] of Object.entries(FACT_KINDS_BY_STAGE[stageKey])) {
    if (source === 'browser_page') continue;
    const start = cursors[scope.browser][source];
    const values = independent[scope.browser][source].slice(start, start + kinds.length);
    assert.deepEqual(values.map(({ kind }) => kind), kinds);
    for (const value of values) {
      records.push({
        elapsed: value.elapsed_milliseconds,
        order: order += 1,
        projection: independentProjection(value),
        source,
      });
    }
    cursors[scope.browser][source] += kinds.length;
  }
  records.sort((left, right) => left.elapsed - right.elapsed || left.order - right.order);
  for (const record of records) {
    setAtLeastMilliseconds(browserStarts[scope.browser] + record.elapsed);
    assert.equal(scope.record(record.source, record.projection), true);
  }
}

async function createOfflinePage(browser, browserName) {
  const context = await browser.newContext({
    acceptDownloads: false,
    bypassCSP: false,
    ignoreHTTPSErrors: false,
    javaScriptEnabled: true,
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  let pageErrors = 0;
  let unexpectedRequests = 0;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === TARGET_URL) {
      await route.fulfill({
        status: 200,
        body: documentSource,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
      return;
    }
    const body = moduleResponses.get(url);
    if (body === undefined) {
      unexpectedRequests += 1;
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({
      status: 200,
      body,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
    });
  });
  const page = await context.newPage();
  page.on('pageerror', () => { pageErrors += 1; });
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(
    () => globalThis.miakappBrowserRelayPage !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  return {
    context,
    page,
    diagnostics: () => ({ browserName, pageErrors, unexpectedRequests }),
  };
}

const fixture = {
  stateExpectation() {
    return Object.freeze({
      schema: 'miakapp.staging-browser-relay-fixture-state-expectation/1',
      path: 'acceptance.temperature',
      revision: fixtureRevision,
      value: fixtureTemperature,
    });
  },
  async setTemperature(value) {
    fixtureRevision += 1;
    fixtureTemperature = value;
    return this.stateExpectation();
  },
  async privateInput(browser, identityGeneration) {
    inputOrder.push(`${browser}:${identityGeneration}`);
    return Object.freeze({
      schema: 'miakapp.staging-browser-relay-page-input/1',
      browser,
      firebase_custom_token: token('u', 'v', 'w'),
    });
  },
  async rotateRelayToB() {
    return true;
  },
};

const remainingAdapter = {
  async startBrowser(browser) {
    if (Object.hasOwn(engines, browser)) {
      launched[browser] = {
        browser: await engines[browser].launch({ headless: true }),
      };
    }
    advanceMilliseconds();
    browserStarts[browser] = lastMilliseconds();
  },
  async execute(scope) {
    recordIndependentStage(scope);
  },
  async closePage() {
    assert.fail('All page closure is owned by the composed page adapters');
  },
  async closeBrowser(browser) {
    const owned = launched[browser];
    if (owned !== undefined) {
      assert.equal(pages[browser].page.isClosed(), true);
      await owned.context.close();
      await owned.browser.close();
      delete launched[browser];
    }
    advanceMilliseconds();
  },
  async close() {
    remainingCloseCalls += 1;
    for (const browser of ['firefox', 'webkit']) {
      const owned = launched[browser];
      if (owned !== undefined) {
        try { await owned.context?.close(); } catch {}
        try { await owned.browser.close(); } catch {}
        delete launched[browser];
      }
    }
  },
};

let stage = 'profile';
try {
  validateBrowserRelaySecondaryCaseAdapterProfile();
  stage = 'schedule';
  const schedulerRunner = (adapter, options) => runBrowserRelayCaseScheduleForTest(
    () => {
      const session = createBrowserRelayEvidenceSessionForTest(clock);
      browserStarts.chromium = lastMilliseconds();
      return session;
    },
    adapter,
    options,
  );
  const chromiumCaseRunner = (components, options) => (
    runBrowserRelayChromiumCaseScheduleForTesting(
      schedulerRunner,
      chromiumScenario,
      components,
      options,
    )
  );
  const result = await runBrowserRelaySecondaryCaseScheduleForTesting(
    chromiumCaseRunner,
    runBrowserRelayPlaywrightBridge,
    {
      fixture,
      async openChromiumPage(pageInstance) {
        return Object.freeze({ pageInstance });
      },
      async openSecondaryPage(browser) {
        const owned = launched[browser];
        assert.ok(owned?.browser);
        const offline = await createOfflinePage(owned.browser, browser);
        owned.context = offline.context;
        pages[browser] = offline;
        return offline.page;
      },
      async prepareChromiumPhase() {},
      remainingAdapter,
    },
  );
  assert.equal(result.state, 'succeeded_closed_output');
  assert.equal(result.assertions_passed, 40);
  assert.equal(result.assertions_failed, 0);
  assert.deepEqual(inputOrder, [
    'chromium:1',
    'chromium:2',
    'firefox:1',
    'webkit:1',
  ]);
  assert.equal(remainingCloseCalls, 1);
  for (const browser of ['firefox', 'webkit']) {
    assert.equal(pages[browser].page.isClosed(), true);
    assert.deepEqual(pages[browser].diagnostics(), {
      browserName: browser,
      pageErrors: 0,
      unexpectedRequests: 0,
    });
  }
  process.stdout.write(
    'firefox+webkit: real offline pages closed one composed 40-assertion schedule.\n',
  );
} catch {
  try { await remainingAdapter.close(); } catch {}
  process.stderr.write(
    `Offline secondary case-adapter browser smoke failed at ${stage}; raw diagnostics were discarded.\n`,
  );
  process.exitCode = 1;
}
