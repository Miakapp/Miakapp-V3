import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { firefox, webkit } from 'playwright';

import { createBrowserRelayPageReceiptProducer } from '../browser-relay-page-receipt/producer.mjs';
import { TARGET_ORIGIN, TARGET_URL } from '../browser-relay-page/contract.mjs';
import { validatePlaywrightDiagnosticEnvironment } from '../browser-relay-runner/driver.mjs';
import { runBrowserRelayPlaywrightBridge } from '../browser-relay-playwright-bridge/bridge.mjs';
import { validateBrowserRelayPlaywrightBridgeProfile } from '../browser-relay-playwright-bridge/contract.mjs';

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
  + '<link rel="icon" href="data:,"><title>Offline Playwright bridge</title></head>'
  + '<body><script type="module" src="/test/helpers/'
  + 'browser-relay-playwright-bridge-entry.mjs"></script></body></html>';

function token(a, b, c) {
  return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
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
    page,
    context,
    diagnostics: () => ({ browserName, pageErrors, unexpectedRequests }),
  };
}

let currentStage = 'diagnostic-environment';
try {
  validatePlaywrightDiagnosticEnvironment(process.env);
  currentStage = 'profile';
  validateBrowserRelayPlaywrightBridgeProfile();
  let chromiumDependencyCalls = 0;
  currentStage = 'chromium-capability';
  const chromium = await runBrowserRelayPlaywrightBridge('chromium', {
    async openPage() { chromiumDependencyCalls += 1; },
    async privateInputProvider() { chromiumDependencyCalls += 1; },
    receiptProducerFactory() { chromiumDependencyCalls += 1; },
  });
  assert.equal(chromium.state, 'blocked');
  assert.equal(chromium.reason, 'pinned_playwright_bfcache_unsupported');
  assert.equal(chromium.private_inputs_requested, 0);
  assert.equal(chromium.receipt, null);
  assert.equal(chromiumDependencyCalls, 0);
  process.stdout.write('chromium: pinned BFCache blocker passed before page or private input.\n');

  for (const browserName of ['firefox', 'webkit']) {
    currentStage = `${browserName}:launch`;
    const browser = await engines[browserName].launch({ headless: true });
    let offlinePage;
    let privateInputRequests = 0;
    try {
      const result = await runBrowserRelayPlaywrightBridge(browserName, {
        async openPage() {
          offlinePage = await createOfflinePage(browser, browserName);
          return offlinePage.page;
        },
        async privateInputProvider(requestedBrowser, identityGeneration) {
          assert.equal(requestedBrowser, browserName);
          assert.equal(identityGeneration, 1);
          privateInputRequests += 1;
          return {
            schema: 'miakapp.staging-browser-relay-page-input/1',
            browser: browserName,
            firebase_custom_token: token('u', 'v', 'w'),
          };
        },
        receiptProducerFactory(requestedBrowser) {
          assert.equal(requestedBrowser, browserName);
          return createBrowserRelayPageReceiptProducer(browserName);
        },
      });
      assert.equal(result.state, 'receipt_closed');
      assert.equal(result.receipt.browser, browserName);
      assert.equal(result.receipt.source, 'browser_page');
      assert.equal(result.receipt.state, 'observed_closed');
      assert.equal(result.receipt.counters.maximum_active_websockets, 1);
      assert.equal(privateInputRequests, 1);
      assert.equal(offlinePage.page.isClosed(), true);
      assert.deepEqual(offlinePage.diagnostics(), {
        browserName,
        pageErrors: 0,
        unexpectedRequests: 0,
      });
      await offlinePage.context.close();
      process.stdout.write(`${browserName}: phased page bridge and closed receipt passed (offline fakes).\n`);
    } finally {
      await browser.close();
    }
  }
} catch {
  process.stderr.write(`Offline Playwright bridge smoke failed at ${currentStage}; raw diagnostics were discarded.\n`);
  process.exitCode = 1;
}
