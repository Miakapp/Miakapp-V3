import { addAbortListener } from 'node:events';

import { chromium, firefox, webkit } from 'playwright-core';

import {
  CONTROL_PHASE_ORDER,
} from '../browser-relay-chromium-scenario/contract.mjs';
import {
  TARGET_URL,
} from '../browser-relay-page/contract.mjs';
import {
  TRUSTED_PROVIDER_OWNER_BROWSER_ORDER,
  TRUSTED_PROVIDER_OWNER_MATRIX_FIELDS,
  rejectTrustedProviderOwner,
} from './contract.mjs';
import {
  EXTERNAL_REQUEST_PROBE_URL,
  createBrowserRelayTrustedProviderPageHost,
} from './page-host.mjs';

const ENGINES = Object.freeze({ chromium, firefox, webkit });
const CLOSE_ORDER = Object.freeze(['firefox', 'webkit', 'chromium']);
const PRIVATE_INPUT_ORDER = Object.freeze([
  Object.freeze({ browser: 'chromium', identity_generation: 1 }),
  Object.freeze({ browser: 'chromium', identity_generation: 2 }),
  Object.freeze({ browser: 'firefox', identity_generation: 1 }),
  Object.freeze({ browser: 'webkit', identity_generation: 1 }),
]);
const RENEWAL_INTERVAL_MILLISECONDS = 240_000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;

function reject() {
  return rejectTrustedProviderOwner();
}

function signalAborted(signal) {
  try {
    return Reflect.apply(ABORTED_GETTER, signal, []);
  } catch {
    return reject();
  }
}

function exactInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !Object.isFrozen(value)
    || JSON.stringify(Object.keys(value)) !== JSON.stringify(['authority'])
    || value.authority === null || typeof value.authority !== 'object'
    || typeof value.authority.activateBrowser !== 'function') reject();
  return value;
}

function token(a, b, c) {
  return `${a.repeat(32)}.${b.repeat(32)}.${c.repeat(32)}`;
}

function wait(milliseconds, signal) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || signalAborted(signal)) {
    return Promise.reject(reject());
  }
  return new Promise((resolve, rejectWait) => {
    let timer;
    let subscription;
    let settled = false;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { subscription?.[Symbol.dispose]?.(); } catch {}
      callback();
    };
    try {
      timer = setTimeout(() => settle(resolve), milliseconds);
      subscription = addAbortListener(signal, () => settle(() => rejectWait(
        new Error('Trusted provider browser wait was aborted'),
      )));
      if (signalAborted(signal)) {
        settle(() => rejectWait(new Error('Trusted provider browser wait was aborted')));
      }
    } catch {
      settle(() => rejectWait(new Error('Trusted provider browser wait failed')));
    }
  });
}

function contextOptions(browser) {
  return {
    acceptDownloads: false,
    bypassCSP: false,
    ignoreHTTPSErrors: browser === 'chromium',
    javaScriptEnabled: true,
    locale: 'en-US',
    serviceWorkers: 'block',
  };
}

export function createBrowserRelayTrustedProviderBrowser(inputValue) {
  if (arguments.length !== 1) reject();
  const { authority } = exactInput(inputValue);
  const pageHost = createBrowserRelayTrustedProviderPageHost();
  const owned = Object.fromEntries(TRUSTED_PROVIDER_OWNER_BROWSER_ORDER.map((browser) => [
    browser,
    { browser: undefined, contexts: [], pages: [] },
  ]));
  let startIndex = 0;
  let closeIndex = 0;
  let chromiumPageInstance = 1;
  let secondaryIndex = 0;
  let phaseIndex = 0;
  let privateInputIndex = 0;
  let revision = 1;
  let temperature = 20;
  let externalRequestProbes = 0;
  let lifecycleClosed = false;
  let rootClosed = false;
  let closeTask;

  function requireActive(signal) {
    if (lifecycleClosed || rootClosed || signalAborted(signal)) reject();
    return signal;
  }

  function stateExpectation() {
    if (arguments.length !== 0 || lifecycleClosed || rootClosed) reject();
    return Object.freeze({
      schema: 'miakapp.staging-browser-relay-fixture-state-expectation/1',
      path: 'acceptance.temperature',
      revision,
      value: temperature,
    });
  }

  const fixture = Object.freeze({
    stateExpectation,
    async setTemperature(value) {
      if (arguments.length !== 1 || !Number.isSafeInteger(value)
        || ![21, 23].includes(value) || lifecycleClosed || rootClosed) reject();
      revision += 1;
      temperature = value;
      return stateExpectation();
    },
    async privateInput(browser, identityGeneration, signal) {
      if (arguments.length !== 3) reject();
      requireActive(signal);
      const expected = PRIVATE_INPUT_ORDER[privateInputIndex];
      if (expected?.browser !== browser
        || expected.identity_generation !== identityGeneration) reject();
      privateInputIndex += 1;
      return Object.freeze({
        schema: 'miakapp.staging-browser-relay-page-input/1',
        browser,
        firebase_custom_token: identityGeneration === 1
          ? token('a', 'b', 'c')
          : token('u', 'v', 'w'),
      });
    },
    async rotateRelayToB() {
      if (arguments.length !== 0 || lifecycleClosed || rootClosed
        || revision !== 2 || temperature !== 21) reject();
      return true;
    },
  });

  async function openPage(browser, identityGeneration, signal) {
    requireActive(signal);
    const browserOwner = owned[browser];
    if (browserOwner?.browser === undefined) reject();
    let context;
    let page;
    try {
      context = await browserOwner.browser.newContext(contextOptions(browser));
      browserOwner.contexts.push(context);
      await pageHost.install(context, browser, identityGeneration);
      page = await context.newPage();
      browserOwner.pages.push(page);
      page.on('pageerror', () => {
        browserOwner.pageErrors = (browserOwner.pageErrors ?? 0) + 1;
      });
      const response = await page.goto(TARGET_URL, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      });
      if (response === null || response.status() !== 200 || page.url() !== TARGET_URL) reject();
      await page.waitForFunction(
        (requiresControl) => globalThis.miakappBrowserRelayPage !== undefined
          && (!requiresControl || globalThis.miakappChromiumScenarioControl !== undefined),
        browser === 'chromium',
        { timeout: 30_000 },
      );
      const externalRequestBlocked = await page.evaluate(async (url) => {
        try {
          await globalThis.fetch(url, {
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
          });
          return false;
        } catch {
          return true;
        }
      }, EXTERNAL_REQUEST_PROBE_URL);
      if (externalRequestBlocked !== true) reject();
      externalRequestProbes += 1;
      requireActive(signal);
      return page;
    } catch {
      try { await page?.close(); } catch {}
      try { await context?.close(); } catch {}
      reject();
    }
  }

  async function openChromiumPage(pageInstance, signal) {
    if (arguments.length !== 2 || pageInstance !== chromiumPageInstance
      || pageInstance < 1 || pageInstance > 2) reject();
    chromiumPageInstance += 1;
    return openPage('chromium', pageInstance, signal);
  }

  async function openSecondaryPage(browser, signal) {
    if (arguments.length !== 2 || ['firefox', 'webkit'][secondaryIndex] !== browser) reject();
    secondaryIndex += 1;
    return openPage(browser, 1, signal);
  }

  async function prepareChromiumPhase(phase, signal) {
    if (arguments.length !== 2 || CONTROL_PHASE_ORDER[phaseIndex] !== phase) reject();
    requireActive(signal);
    if (phase === 'same_relay_reauthenticated' || phase === 'relay_handoff_stale') {
      await wait(RENEWAL_INTERVAL_MILLISECONDS, signal);
      requireActive(signal);
    }
    const page = owned.chromium.pages[0];
    if (page === undefined || page.isClosed()) reject();
    try {
      await page.evaluate(async (selectedPhase) => (
        globalThis.miakappChromiumScenarioControl.phase(selectedPhase)
      ), phase);
    } catch {
      reject();
    }
    if (phase === 'relay_b_ready') {
      if (revision !== 2 || temperature !== 21) reject();
      revision = 3;
      temperature = 22;
    }
    phaseIndex += 1;
    return undefined;
  }

  async function cleanup(requireComplete) {
    let converged = true;
    for (const browser of CLOSE_ORDER) {
      const browserOwner = owned[browser];
      for (const page of browserOwner.pages) {
        try {
          if (!page.isClosed()) {
            if (requireComplete) converged = false;
            await page.close();
          }
        } catch {
          converged = false;
        }
      }
      for (const context of browserOwner.contexts) {
        try { await context.close(); } catch { converged = false; }
      }
      if (browserOwner.browser !== undefined) {
        try { await browserOwner.browser.close(); } catch { converged = false; }
      }
      browserOwner.browser = undefined;
      browserOwner.contexts.length = 0;
      browserOwner.pages.length = 0;
    }
    if (requireComplete) {
      const diagnostics = pageHost.diagnostics();
      if (startIndex !== TRUSTED_PROVIDER_OWNER_BROWSER_ORDER.length
        || closeIndex !== CLOSE_ORDER.length
        || chromiumPageInstance !== 3
        || secondaryIndex !== 2
        || phaseIndex !== CONTROL_PHASE_ORDER.length
        || privateInputIndex !== PRIVATE_INPUT_ORDER.length
        || externalRequestProbes !== PRIVATE_INPUT_ORDER.length
        || revision !== 4 || temperature !== 23
        || diagnostics.installed_contexts !== 4
        || diagnostics.rejected_requests !== 0
        || diagnostics.served_requests < 8
        || !Number.isSafeInteger(diagnostics.loopback_port)
        || TRUSTED_PROVIDER_OWNER_BROWSER_ORDER.some(
          (browser) => (owned[browser].pageErrors ?? 0) !== 0,
        )) converged = false;
    }
    try { await pageHost.close(); } catch { converged = false; }
    if (!converged) reject();
  }

  const browserLifecycle = Object.freeze({
    async startBrowser(browser, signal) {
      if (arguments.length !== 2 || TRUSTED_PROVIDER_OWNER_BROWSER_ORDER[startIndex] !== browser) {
        reject();
      }
      requireActive(signal);
      const browserOwner = owned[browser];
      if (browserOwner.browser !== undefined) reject();
      try {
        const port = await pageHost.start();
        const launchOptions = browser === 'chromium'
          ? {
            channel: 'chromium',
            headless: true,
            ignoreDefaultArgs: ['--disable-back-forward-cache'],
            args: [
              '--host-resolver-rules='
                + `MAP miakapp-v4-staging.web.app:443 127.0.0.1:${port}, `
                + 'MAP * ~NOTFOUND',
            ],
          }
          : { headless: true };
        browserOwner.browser = await ENGINES[browser].launch(launchOptions);
        requireActive(signal);
        if (await authority.activateBrowser(browser) !== true) reject();
        startIndex += 1;
      } catch {
        try { await browserOwner.browser?.close(); } catch {}
        browserOwner.browser = undefined;
        reject();
      }
      return undefined;
    },
    async closeBrowser(browser, signal) {
      if (arguments.length !== 2 || CLOSE_ORDER[closeIndex] !== browser) reject();
      requireActive(signal);
      const browserOwner = owned[browser];
      if (browserOwner.browser === undefined
        || browserOwner.pages.some((page) => !page.isClosed())) reject();
      let converged = true;
      for (const context of browserOwner.contexts) {
        try { await context.close(); } catch { converged = false; }
      }
      try { await browserOwner.browser.close(); } catch { converged = false; }
      browserOwner.contexts.length = 0;
      browserOwner.pages.length = 0;
      browserOwner.browser = undefined;
      if (!converged) reject();
      closeIndex += 1;
      return undefined;
    },
    async close() {
      if (arguments.length !== 0 || lifecycleClosed) reject();
      lifecycleClosed = true;
      await cleanup(true);
      return undefined;
    },
  });

  const components = Object.freeze({
    fixture,
    openChromiumPage,
    openSecondaryPage,
    prepareChromiumPhase,
    browserLifecycle,
  });
  if (JSON.stringify(Object.keys(components))
    !== JSON.stringify(TRUSTED_PROVIDER_OWNER_MATRIX_FIELDS)) reject();

  async function close() {
    if (arguments.length !== 0) reject();
    if (closeTask === undefined) {
      rootClosed = true;
      closeTask = lifecycleClosed ? Promise.resolve() : cleanup(false);
    }
    await closeTask;
    return undefined;
  }

  return Object.freeze({ components, close });
}
