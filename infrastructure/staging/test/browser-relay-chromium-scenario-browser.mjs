import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';
import { utils as playwrightCoreUtils } from 'playwright-core/lib/coreBundle';

import { runBrowserRelayChromiumScenarioForTesting } from '../browser-relay-chromium-scenario/testing.mjs';
import { runBrowserRelayChromiumScenarioInternal } from '../browser-relay-chromium-scenario/internal.mjs';
import {
  CHROMIUM_SCENARIO_AWAY_URL,
  validateBrowserRelayChromiumScenarioProfile,
} from '../browser-relay-chromium-scenario/contract.mjs';
import { HOSTING_HEADERS } from '../browser-relay-page/artifact.mjs';
import { TARGET_ORIGIN, TARGET_URL } from '../browser-relay-page/contract.mjs';
import { validatePlaywrightDiagnosticEnvironment } from '../browser-relay-runner/driver.mjs';

const modulePaths = Object.freeze([
  'browser-relay-page/runtime.mjs',
  'browser-relay-page/boundary.mjs',
  'test/helpers/browser-relay-chromium-scenario-entry.mjs',
]);
const moduleResponses = new Map(modulePaths.map((path) => [
  `${TARGET_ORIGIN}/${path}`,
  readFileSync(new URL(`../${path}`, import.meta.url)),
]));
const scenarioTargetDocument = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="referrer" content="no-referrer"><link rel="icon" href="data:,">'
  + '<title>Offline Chromium relay scenario</title></head><body>'
  + '<script type="module" src="/test/helpers/'
  + 'browser-relay-chromium-scenario-entry.mjs"></script></body></html>';
const pendingActionModulePath = 'test/helpers/browser-relay-chromium-pending-action.mjs';
const pendingActionDocument = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="referrer" content="no-referrer"><link rel="icon" href="data:,">'
  + '<title>Offline Chromium pending action</title></head><body>'
  + `<script type="module" src="/${pendingActionModulePath}"></script></body></html>`;
moduleResponses.set(`${TARGET_ORIGIN}/${pendingActionModulePath}`, Buffer.from(`
const never = new Promise(() => {});
const pageApi = Object.freeze({
  async initialize() {
    await globalThis.miakappPendingAction();
    return never;
  },
  async start() { return never; },
  observe() { return null; },
  observeLifecycle() { return null; },
  observeState() { return null; },
  async call() { return never; },
  async suspend() { return never; },
  async resume() { return never; },
  async stop() { return never; },
});
Object.defineProperty(globalThis, 'miakappBrowserRelayPage', {
  configurable: false,
  enumerable: false,
  value: pageApi,
  writable: false,
});
`));
let servedTargetDocument = scenarioTargetDocument;
const awayDocument = readFileSync(
  new URL('../browser-relay-chromium-scenario/away.html', import.meta.url),
);

function token(a, b, c) {
  return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
}

const privateTokens = Object.freeze([
  token('a', 'b', 'c'),
  token('u', 'v', 'w'),
]);
const precreatedContextChild = process.argv[2] === '--precreated-context-child';

let currentStage = 'diagnostic-environment';
let browser;
let offlineServer;
let offlineServerRoot;
const contexts = [];
const pages = [];
let pageErrors = 0;
let unexpectedRequests = 0;
let privateInputRequests = 0;
let instrumentationApiCalls = 0;
let instrumentationPrivateCaptures = 0;
let instrumentationListener;
let instrumentationTarget;
let now = 1_000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return Object.freeze({ promise, reject, resolve });
}

async function withDeadline(promise, label, milliseconds = 20_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function pageProjectionPort(record) {
  const port = { record };
  Object.defineProperty(port, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      throw new Error('Native Chromium projection port cannot be serialized');
    },
  });
  return Object.freeze(port);
}

function hostingHeaders(contentType) {
  return { ...HOSTING_HEADERS, 'Content-Type': contentType };
}

async function startOfflineServer() {
  offlineServerRoot = mkdtempSync(join(tmpdir(), 'miakapp-chromium-scenario-'));
  const keyPath = join(offlineServerRoot, 'key.pem');
  const certificatePath = join(offlineServerRoot, 'certificate.pem');
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-days',
    '1',
    '-subj',
    '/CN=miakapp-v4-staging.web.app',
    '-addext',
    'subjectAltName=DNS:miakapp-v4-staging.web.app',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
  ], { stdio: 'ignore' });
  offlineServer = createServer({
    cert: readFileSync(certificatePath),
    key: readFileSync(keyPath),
  }, (request, response) => {
    const url = new URL(request.url ?? '/', TARGET_ORIGIN).href;
    let body;
    let contentType;
    if (url === TARGET_URL) {
      body = servedTargetDocument;
      contentType = 'text/html; charset=utf-8';
    } else if (url === CHROMIUM_SCENARIO_AWAY_URL) {
      body = awayDocument;
      contentType = 'text/html; charset=utf-8';
    } else {
      body = moduleResponses.get(url);
      contentType = 'text/javascript; charset=utf-8';
    }
    if (body === undefined) {
      unexpectedRequests += 1;
      response.writeHead(404, hostingHeaders('text/plain; charset=utf-8'));
      response.end('Not found');
      return;
    }
    response.writeHead(200, hostingHeaders(contentType));
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    offlineServer.once('error', reject);
    offlineServer.listen(0, '127.0.0.1', resolve);
  });
  return offlineServer.address().port;
}

async function openOfflinePage(pageInstance, signal) {
  assert.ok(pageInstance === 1 || pageInstance === 2);
  assert.equal(signal.aborted, false);
  const context = await browser.newContext({
    acceptDownloads: false,
    bypassCSP: false,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  contexts.push(context);
  if (instrumentationListener === undefined) {
    instrumentationListener = {
      onApiCallBegin(_apiZone, call) {
        instrumentationApiCalls += 1;
        try {
          const parameters = JSON.stringify(call?.params) ?? '';
          if (privateTokens.some((privateToken) => parameters.includes(privateToken))) {
            instrumentationPrivateCaptures += 1;
          }
        } catch {
          instrumentationPrivateCaptures += 1;
        }
      },
    };
    instrumentationTarget = context._connection._instrumentation;
    instrumentationTarget.addListener(instrumentationListener);
  }
  await context.addInitScript(({ generation }) => {
    Object.defineProperty(globalThis, 'miakappChromiumScenarioGeneration', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: generation,
    });
  }, { generation: pageInstance });
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', () => { pageErrors += 1; });
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(
    () => globalThis.miakappBrowserRelayPage !== undefined
      && globalThis.miakappChromiumScenarioControl !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  return page;
}

async function proveActiveTracingRejected() {
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: 'block',
  });
  contexts.push(context);
  await context.route(TARGET_URL, (route) => route.fulfill({
    status: 200,
    body: '<!doctype html><title>Capture guard</title>',
    headers: hostingHeaders('text/html; charset=utf-8'),
  }));
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await context.tracing.start({ screenshots: true, snapshots: true });
  let tracedInputRequests = 0;
  try {
    await assert.rejects(
      runBrowserRelayChromiumScenarioForTesting({
        async controlPhase() { return undefined; },
        async openPage(pageInstance, signal) {
          assert.equal(pageInstance, 1);
          assert.equal(signal.aborted, false);
          return page;
        },
        async privateInputProvider() {
          tracedInputRequests += 1;
          return {
            schema: 'miakapp.staging-browser-relay-page-input/1',
            browser: 'chromium',
            firebase_custom_token: token('t', 'r', 'c'),
          };
        },
      }, {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
        signal: undefined,
      }),
      /failed before a closed receipt/u,
    );
    assert.equal(tracedInputRequests, 0);
    assert.equal(page.isClosed(), true);
  } finally {
    try { await context.tracing.stop(); } catch {}
    try { await context.close(); } catch {}
  }
}

async function proveCaptureTransitionRejected() {
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: 'block',
  });
  contexts.push(context);
  await context.route(TARGET_URL, (route) => route.fulfill({
    status: 200,
    body: '<!doctype html><title>Capture transition guard</title>',
    headers: hostingHeaders('text/html; charset=utf-8'),
  }));
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await context.tracing.start({ screenshots: true, snapshots: true });
  await context.tracing.stopChunk();
  assert.equal(context.tracing._isTracing, false);
  assert.equal(context._connection._tracingCount, 0);
  const evaluate = page.evaluate.bind(page);
  let pageActionCalls = 0;
  page.evaluate = (...parameters) => {
    pageActionCalls += 1;
    return evaluate(...parameters);
  };
  let captureAttempt;
  let transitionInputRequests = 0;
  try {
    await assert.rejects(
      runBrowserRelayChromiumScenarioForTesting({
        async controlPhase() { return undefined; },
        async openPage(pageInstance, signal) {
          assert.equal(pageInstance, 1);
          assert.equal(signal.aborted, false);
          return page;
        },
        async privateInputProvider() {
          transitionInputRequests += 1;
          captureAttempt = context.tracing.startChunk({ title: 'must-be-blocked' });
          captureAttempt.catch(() => undefined);
          return {
            schema: 'miakapp.staging-browser-relay-page-input/1',
            browser: 'chromium',
            firebase_custom_token: token('p', 'e', 'n'),
          };
        },
      }, {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
        signal: undefined,
      }),
      /failed before a closed receipt/u,
    );
    await assert.rejects(captureAttempt, /capture transition was blocked/u);
    assert.equal(transitionInputRequests, 1);
    assert.equal(pageActionCalls, 0);
    assert.equal(page.isClosed(), true);
  } finally {
    try { await context.tracing.stop(); } catch {}
    try { await context.close(); } catch {}
  }
}

async function proveTrustedRuntimeForgeryRejected(name, mutate) {
  let context;
  let page;
  let restore = () => undefined;
  let privateInputCalls = 0;
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      async controlPhase() { return undefined; },
      async openPage(pageInstance, signal) {
        assert.equal(pageInstance, 1);
        assert.equal(signal.aborted, false);
        context = await browser.newContext({
          acceptDownloads: false,
          serviceWorkers: 'block',
        });
        contexts.push(context);
        await context.route(TARGET_URL, (route) => route.fulfill({
          status: 200,
          body: '<!doctype html><title>Runtime provenance guard</title>',
          headers: hostingHeaders('text/html; charset=utf-8'),
        }));
        page = await context.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await context.unrouteAll({ behavior: 'wait' });
        restore = await mutate(page);
        return page;
      },
      async privateInputProvider() {
        privateInputCalls += 1;
        return {
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser: 'chromium',
          firebase_custom_token: token('f', 'o', 'r'),
        };
      },
    }, {
      signal: undefined,
      timing: {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
      },
    }),
    /failed before a closed receipt/u,
    name,
  );
  assert.equal(privateInputCalls, 0, name);
  assert.equal(page.isClosed(), true, name);
  try { await restore(); } catch {}
  try { await context.close(); } catch {}
}

async function proveTrustedRuntimeForgeryRejections() {
  let forgedTransportCalls = 0;
  let networkObserverCalls = 0;
  await proveTrustedRuntimeForgeryRejected('forged Frame prototype', (page) => {
    const frame = page._mainFrame;
    const prototype = Object.getPrototypeOf(frame);
    Object.setPrototypeOf(frame, Object.create(prototype));
    return () => Object.setPrototypeOf(frame, prototype);
  });
  await proveTrustedRuntimeForgeryRejected('forged Frame channel', (page) => {
    const frame = page._mainFrame;
    const channel = frame._channel;
    const initializedChannel = page._initializer.mainFrame;
    const forged = Object.create(Object.getPrototypeOf(channel));
    Object.defineProperty(forged, '_object', {
      configurable: true,
      enumerable: true,
      value: frame,
      writable: true,
    });
    frame._channel = forged;
    page._initializer.mainFrame = forged;
    return () => {
      frame._channel = channel;
      page._initializer.mainFrame = initializedChannel;
    };
  });
  await proveTrustedRuntimeForgeryRejected('forged channel evaluate method', (page) => {
    const channel = page._mainFrame._channel;
    Object.defineProperty(channel, 'evaluateExpression', {
      configurable: true,
      enumerable: true,
      value: async () => ({ value: { v: 'undefined' } }),
      writable: true,
    });
    return () => { Reflect.deleteProperty(channel, 'evaluateExpression'); };
  });
  await proveTrustedRuntimeForgeryRejected('forged Frame API wrapper', (page) => {
    const frame = page._mainFrame;
    Object.defineProperty(frame, '_wrapApiCall', {
      configurable: true,
      enumerable: false,
      value: async (operation) => operation({ apiName: 'forged' }),
      writable: true,
    });
    return () => { Reflect.deleteProperty(frame, '_wrapApiCall'); };
  });
  await proveTrustedRuntimeForgeryRejected('forged Frame validator context', (page) => {
    const frame = page._mainFrame;
    Object.defineProperty(frame, '_validatorToWireContext', {
      configurable: true,
      enumerable: false,
      value: () => ({ binary: 'buffer' }),
      writable: true,
    });
    return () => { Reflect.deleteProperty(frame, '_validatorToWireContext'); };
  });
  await proveTrustedRuntimeForgeryRejected('caller-owned no-op page close', (page) => {
    Object.defineProperty(page, 'close', {
      configurable: true,
      enumerable: false,
      value: async () => undefined,
      writable: true,
    });
    return () => { Reflect.deleteProperty(page, 'close'); };
  });
  await proveTrustedRuntimeForgeryRejected('forged connection transport hook', (page) => {
    const connection = page.context()._connection;
    const onmessage = connection.onmessage;
    connection.onmessage = (message) => {
      forgedTransportCalls += 1;
      return Reflect.apply(onmessage, connection, [message]);
    };
    return () => { connection.onmessage = onmessage; };
  });
  assert.equal(forgedTransportCalls, 0);
  await proveTrustedRuntimeForgeryRejected('preinstalled network observers', async (page) => {
    const context = page.context();
    const observer = () => { networkObserverCalls += 1; };
    context.on('request', observer);
    await page.route('https://identitytoolkit.googleapis.com/**', (route) => {
      networkObserverCalls += 1;
      return route.abort('blockedbyclient');
    });
    return async () => {
      context.off('request', observer);
      await page.unrouteAll({ behavior: 'wait' });
    };
  });
  assert.equal(networkObserverCalls, 0);
}

async function proveLateOwnedContextDiversionRejected() {
  let context;
  let page;
  let privateInputCalls = 0;
  let divertedCloseCalls = 0;
  await assert.rejects(runBrowserRelayChromiumScenarioInternal({
      async controlPhase() { return undefined; },
      async openPage(pageInstance, signal) {
        assert.equal(pageInstance, 1);
        assert.equal(signal.aborted, false);
        context = await browser.newContext({
          acceptDownloads: false,
          serviceWorkers: 'block',
        });
        contexts.push(context);
        await context.route(TARGET_URL, (route) => route.fulfill({
          status: 200,
          body: '<!doctype html><title>Late close diversion guard</title>',
          headers: hostingHeaders('text/html; charset=utf-8'),
        }));
        page = await context.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await context.unrouteAll({ behavior: 'wait' });
        return page;
      },
      async privateInputProvider() {
        privateInputCalls += 1;
        page._ownedContext = {
          async close() { divertedCloseCalls += 1; },
        };
        return {
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser: 'chromium',
          firebase_custom_token: token('l', 'a', 't'),
        };
      },
    }, {
      signal: undefined,
      timing: {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
      },
    }), /failed before a closed receipt/u);
  assert.equal(privateInputCalls, 1);
  assert.equal(divertedCloseCalls, 0);
  assert.equal(page.isClosed(), true);
  try { Reflect.deleteProperty(page, '_ownedContext'); } catch {}
  try { await context.close(); } catch {}
}

async function proveFactoryObservedPagesClosed(name, createExtraPage) {
  let context;
  let inputCalls = 0;
  const observedPages = [];
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      async controlPhase() { return undefined; },
      async openPage(pageInstance, signal) {
        assert.equal(pageInstance, 1);
        assert.equal(signal.aborted, false);
        context = await browser.newContext({
          acceptDownloads: false,
          ignoreHTTPSErrors: true,
          serviceWorkers: 'block',
        });
        contexts.push(context);
        const page = await context.newPage();
        observedPages.push(page);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (!createExtraPage) throw new Error('provider rejected after page creation');
        observedPages.push(await context.newPage());
        return page;
      },
      async privateInputProvider() {
        inputCalls += 1;
        throw new Error('factory ownership failure reached private input');
      },
    }, {
      signal: undefined,
      timing: {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
      },
    }),
    /failed before a closed receipt/u,
    name,
  );
  assert.equal(inputCalls, 0, name);
  assert.equal(observedPages.length, createExtraPage ? 2 : 1, name);
  assert.ok(observedPages.every((page) => page.isClosed()), name);
  try { await context.close(); } catch {}
}

async function proveFactoryObservedPagesOwned() {
  await proveFactoryObservedPagesClosed('provider rejection after newPage', false);
  await proveFactoryObservedPagesClosed('provider created an extra page', true);
}

async function provePrecreatedContextFactoryFaultContained() {
  const context = await browser.newContext({
    acceptDownloads: false,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  contexts.push(context);
  let inputCalls = 0;
  let page;
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      async controlPhase() { return undefined; },
      async openPage(pageInstance, signal) {
        assert.equal(pageInstance, 1);
        assert.equal(signal.aborted, false);
        page = await context.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return page;
      },
      async privateInputProvider() {
        inputCalls += 1;
        throw new Error('precreated context reached private input');
      },
    }, {
      signal: undefined,
      timing: {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
      },
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(inputCalls, 0);
  assert.ok(page !== undefined);
  assert.equal(page.isClosed(), true);
  assert.deepEqual(context.pages(), []);
  try { await context.close(); } catch {}
}

async function provePendingActionTransitionRejected(name, transition) {
  const controller = new AbortController();
  let context;
  let page;
  let inputCalls = 0;
  let pendingActionCalls = 0;
  let transitionFailure;
  servedTargetDocument = pendingActionDocument;
  try {
    await assert.rejects(
      runBrowserRelayChromiumScenarioInternal({
        async controlPhase() { return undefined; },
        async openPage(pageInstance, signal) {
          assert.equal(pageInstance, 1);
          assert.equal(signal.aborted, false);
          context = await browser.newContext({
            acceptDownloads: false,
            ignoreHTTPSErrors: true,
            serviceWorkers: 'block',
          });
          contexts.push(context);
          await context.exposeFunction('miakappPendingAction', async () => {
            pendingActionCalls += 1;
            try {
              await transition({ browser, context, page });
            } catch (error) {
              transitionFailure = error;
            } finally {
              controller.abort();
            }
          });
          page = await context.newPage();
          await page.goto(TARGET_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });
          await page.waitForFunction(
            () => globalThis.miakappBrowserRelayPage !== undefined,
            undefined,
            { timeout: 30_000 },
          );
          return page;
        },
        async privateInputProvider() {
          inputCalls += 1;
          return {
            schema: 'miakapp.staging-browser-relay-page-input/1',
            browser: 'chromium',
            firebase_custom_token: token('m', 'i', 'd'),
          };
        },
      }, {
        signal: controller.signal,
        timing: {
          clock: () => now,
          setTimer: setTimeout,
          clearTimer: clearTimeout,
          maximumMilliseconds: 600_000,
        },
      }),
      /failed before a closed receipt/u,
      name,
    );
    assert.equal(inputCalls, 1, name);
    assert.equal(pendingActionCalls, 1, name);
    assert.match(
      transitionFailure?.message ?? '',
      /(?:network listener|unowned CDP) transition was blocked/u,
      name,
    );
    assert.equal(page.isClosed(), true, name);
  } finally {
    servedTargetDocument = scenarioTargetDocument;
    try { await context?.close(); } catch {}
  }
}

async function provePendingActionTransitionsRejected() {
  await provePendingActionTransitionRejected(
    'pending request listener',
    ({ context }) => { context.on('request', () => undefined); },
  );
  await provePendingActionTransitionRejected(
    'pending WebSocket listener',
    ({ page }) => { page.on('websocket', () => undefined); },
  );
  await provePendingActionTransitionRejected(
    'pending browser CDP session',
    ({ browser: selectedBrowser }) => selectedBrowser.newBrowserCDPSession(),
  );
}

async function proveProviderTransitionAlreadyPendingRejected(name, beginTransition) {
  let context;
  let page;
  let pendingTransition;
  let inputCalls = 0;
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      async controlPhase() { return undefined; },
      async openPage(pageInstance, signal) {
        assert.equal(pageInstance, 1);
        assert.equal(signal.aborted, false);
        context = await browser.newContext({
          acceptDownloads: false,
          ignoreHTTPSErrors: true,
          serviceWorkers: 'block',
        });
        contexts.push(context);
        page = await context.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        pendingTransition = Promise.resolve(beginTransition({ browser, context, page }));
        pendingTransition.catch(() => undefined);
        return page;
      },
      async privateInputProvider() {
        inputCalls += 1;
        return {
          schema: 'miakapp.staging-browser-relay-page-input/1',
          browser: 'chromium',
          firebase_custom_token: token('p', 'r', 'e'),
        };
      },
    }, {
      signal: undefined,
      timing: {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
      },
    }),
    /failed before a closed receipt/u,
    name,
  );
  const transitionResult = await pendingTransition.then(
    (value) => value,
    () => undefined,
  );
  try { await transitionResult?.detach(); } catch {}
  assert.equal(inputCalls, 0, name);
  assert.equal(page.isClosed(), true, name);
  try { await context.close(); } catch {}
}

async function proveProviderTransitionsAlreadyPendingRejected() {
  await proveProviderTransitionAlreadyPendingRejected(
    'pending context CDP session',
    ({ context, page }) => context.newCDPSession(page),
  );
  await proveProviderTransitionAlreadyPendingRejected(
    'pending browser CDP session',
    ({ browser: selectedBrowser }) => selectedBrowser.newBrowserCDPSession(),
  );
  await proveProviderTransitionAlreadyPendingRejected(
    'pending frame navigation',
    ({ page }) => page.goto('data:text/html,<title>Unreviewed pending navigation</title>'),
  );
}

async function proveDiagnosticLoggerMutationRejected() {
  let context;
  let page;
  let inputCalls = 0;
  let mutationRejected = false;
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      async controlPhase() { return undefined; },
      async openPage(pageInstance, signal) {
        assert.equal(pageInstance, 1);
        assert.equal(signal.aborted, false);
        context = await browser.newContext({
          acceptDownloads: false,
          ignoreHTTPSErrors: true,
          serviceWorkers: 'block',
        });
        contexts.push(context);
        page = await context.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return page;
      },
      async privateInputProvider() {
        inputCalls += 1;
        try {
          playwrightCoreUtils.debugLogger.log = () => undefined;
        } catch {
          mutationRejected = true;
        }
        throw new Error('diagnostic logger mutation rejected');
      },
    }, {
      signal: undefined,
      timing: {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
      },
    }),
    /failed before a closed receipt/u,
  );
  assert.equal(inputCalls, 1);
  assert.equal(mutationRejected, true);
  assert.equal(page.isClosed(), true);
  try { await context.close(); } catch {}
}

async function proveConcurrentRunAndLatePageCleanup() {
  const controller = new AbortController();
  let context;
  let page;
  let divertedCloseCalls = 0;
  let secondOpenCalls = 0;
  const pageReady = Promise.withResolvers();
  const releasePage = Promise.withResolvers();
  const firstRun = runBrowserRelayChromiumScenarioInternal({
    async controlPhase() { return undefined; },
    async openPage(pageInstance, signal) {
      assert.equal(pageInstance, 1);
      assert.equal(signal.aborted, false);
      context = await browser.newContext({
        acceptDownloads: false,
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
      });
      contexts.push(context);
      page = await context.newPage();
      await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      pageReady.resolve();
      await releasePage.promise;
      Object.defineProperty(page, 'close', {
        configurable: true,
        enumerable: false,
        value: async () => { divertedCloseCalls += 1; },
        writable: true,
      });
      return page;
    },
    async privateInputProvider() {
      throw new Error('late page must not request private input');
    },
  }, {
    signal: controller.signal,
    timing: {
      clock: () => now,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      maximumMilliseconds: 600_000,
    },
  });
  await pageReady.promise;
  await assert.rejects(
    runBrowserRelayChromiumScenarioInternal({
      async controlPhase() { return undefined; },
      async openPage() {
        secondOpenCalls += 1;
        throw new Error('concurrent page acquisition must not run');
      },
      async privateInputProvider() {
        throw new Error('concurrent private input must not run');
      },
    }, {
      signal: undefined,
      timing: {
        clock: () => now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        maximumMilliseconds: 600_000,
      },
    }),
    /already active/u,
  );
  controller.abort();
  releasePage.resolve();
  await assert.rejects(firstRun, /failed before a closed receipt/u);
  assert.equal(secondOpenCalls, 0);
  assert.equal(divertedCloseCalls, 0);
  assert.equal(page.isClosed(), true);
  try { Reflect.deleteProperty(page, 'close'); } catch {}
  try { await context.close(); } catch {}
}

try {
  validatePlaywrightDiagnosticEnvironment(process.env);
  assert.equal(HOSTING_HEADERS['Cache-Control'], 'no-store, max-age=0');
  currentStage = 'profile';
  validateBrowserRelayChromiumScenarioProfile();
  if (!precreatedContextChild) {
    currentStage = 'precreated-context-child-process';
    execFileSync(process.execPath, [process.argv[1], '--precreated-context-child'], {
      stdio: 'pipe',
      timeout: 120_000,
    });
  }
  currentStage = 'chromium-launch';
  const offlinePort = await startOfflineServer();
  browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
    args: [
      `--host-resolver-rules=MAP miakapp-v4-staging.web.app:443 127.0.0.1:${offlinePort}`,
    ],
  });
  if (precreatedContextChild) {
    currentStage = 'precreated-context-factory-fault';
    await provePrecreatedContextFactoryFaultContained();
    process.stdout.write('chromium: precreated-context factory fault stayed controlled.\n');
  } else {
  currentStage = 'active-tracing-rejection';
  await proveActiveTracingRejected();
  currentStage = 'capture-transition-rejection';
  await proveCaptureTransitionRejected();
  currentStage = 'trusted-runtime-forgery-rejections';
  await proveTrustedRuntimeForgeryRejections();
  currentStage = 'late-owned-context-diversion';
  await proveLateOwnedContextDiversionRejected();
  currentStage = 'factory-observed-page-ownership';
  await proveFactoryObservedPagesOwned();
  currentStage = 'pending-action-transition-rejections';
  await provePendingActionTransitionsRejected();
  currentStage = 'provider-pending-transition-rejections';
  await proveProviderTransitionsAlreadyPendingRejected();
  currentStage = 'diagnostic-logger-mutation-rejection';
  await proveDiagnosticLoggerMutationRejected();
  currentStage = 'concurrent-run-late-page-cleanup';
  await proveConcurrentRunAndLatePageCleanup();
  currentStage = 'complete-scenario';
  const fact12Projected = deferred();
  const releaseFact12 = deferred();
  const projections = [];
  const execution = runBrowserRelayChromiumScenarioInternal({
    openPage: openOfflinePage,
    async privateInputProvider(requestedBrowser, identityGeneration, signal) {
      assert.equal(requestedBrowser, 'chromium');
      assert.ok(identityGeneration === 1 || identityGeneration === 2);
      assert.equal(signal.aborted, false);
      privateInputRequests += 1;
      return {
        schema: 'miakapp.staging-browser-relay-page-input/1',
        browser: 'chromium',
        firebase_custom_token: identityGeneration === 1
          ? token('a', 'b', 'c')
          : token('u', 'v', 'w'),
      };
    },
    async controlPhase(step, signal) {
      assert.equal(signal.aborted, false);
      if (step === 'same_relay_reauthenticated' || step === 'relay_handoff_stale') {
        now += 240_000;
      }
      return pages[0].evaluate(async (selectedStep) => (
        globalThis.miakappChromiumScenarioControl.phase(selectedStep)
      ), step);
    },
  }, {
    pageProjectionPort: pageProjectionPort(async (projection, signal) => {
      assert.equal(signal.aborted, false);
      assert.deepEqual(Object.keys(projection).sort(), [
        'call_observation',
        'lifecycle_event',
        'lifecycle_observation',
        'observation',
        'state_observation',
      ]);
      projections.push(projection);
      if (projections.length === 12) {
        fact12Projected.resolve();
        await releaseFact12.promise;
      }
      return true;
    }),
    signal: undefined,
    timing: {
      clock: () => now,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      maximumMilliseconds: 600_000,
    },
  });
  let barrierFailure;
  try {
    await withDeadline(
      Promise.race([
        fact12Projected.promise,
        execution.then(
          () => { throw new Error('Native Chromium scenario closed before fact 12'); },
          (error) => { throw error; },
        ),
      ]),
      'Native Chromium fact-12 projection',
    );
    currentStage = 'native-fact-12-backpressure';
    assert.equal(projections.length, 12);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].isClosed(), false);
    assert.equal(pages[0].url(), TARGET_URL);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(projections.length, 12);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].url(), TARGET_URL);
  } catch (error) {
    barrierFailure = error;
  } finally {
    releaseFact12.resolve(true);
  }
  const result = await withDeadline(execution, 'Native Chromium scenario completion');
  if (barrierFailure !== undefined) throw barrierFailure;
  currentStage = 'closed-result';
  assert.equal(result.state, 'receipt_closed');
  assert.equal(result.receipt.state, 'observed_closed');
  assert.equal(result.receipt.source, 'browser_page');
  assert.equal(Object.keys(result.receipt.assertions).length, 14);
  assert.ok(Object.values(result.receipt.assertions).every(Boolean));
  assert.equal(result.native_bfcache_restores, 1);
  assert.equal(result.page_instances, 2);
  assert.equal(result.private_inputs_requested, 2);
  assert.equal(privateInputRequests, 2);
  assert.equal(projections.length, 18);
  assert.ok(instrumentationApiCalls > 0);
  assert.equal(instrumentationPrivateCaptures, 0);
  assert.equal(pages.length, 2);
  assert.ok(pages.every((page) => page.isClosed()));
  assert.equal(pageErrors, 0);
  assert.equal(unexpectedRequests, 0);
  process.stdout.write(
    'chromium: complete 18-phase receipt and native dual-witness BFCache restore passed (offline fakes).\n',
  );
  }
} catch (error) {
  process.stderr.write(`Sanitized failure: ${error?.message ?? 'unknown'}\n`);
  process.stderr.write(
    `Offline Chromium scenario smoke failed at ${currentStage}; raw diagnostics were discarded.\n`,
  );
  process.exitCode = 1;
} finally {
  try { instrumentationTarget?.removeListener(instrumentationListener); } catch {}
  for (const context of contexts) {
    try { await context.close(); } catch {}
  }
  try { await browser?.close(); } catch {}
  if (offlineServer !== undefined) {
    await new Promise((resolve) => offlineServer.close(resolve));
  }
  if (offlineServerRoot !== undefined) {
    try { rmSync(offlineServerRoot, { force: true, recursive: true }); } catch {}
  }
}
