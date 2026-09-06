import {
  BROWSER_ORDER,
  BROWSER_DEADLINES_MILLISECONDS,
  BROWSER_RELAY_TARGET_URL,
  ENGINE_RESULT_SCHEMA,
  MAXIMUM_NAVIGATION_MILLISECONDS,
  MAXIMUM_TOTAL_MILLISECONDS,
  StagingBrowserRelayRunnerError,
  buildClosedRunnerResult,
  validateBrowserRelayRunnerProfile,
  validateEngineResult,
  validatePrivatePageInput,
} from './contract.mjs';

function reject(message) {
  throw new StagingBrowserRelayRunnerError(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

export function validatePlaywrightDiagnosticEnvironment(environment = process.env) {
  if (!plainObject(environment)) reject('Runner diagnostic environment is invalid');
  const debug = environment.DEBUG ?? '';
  if (typeof debug !== 'string'
    || /(?:^|[,\s])pw(?::|\*)/u.test(debug)
    || environment.PWDEBUG !== undefined) {
    reject('Playwright diagnostics must be disabled for private browser input');
  }
  return true;
}

function validateEngines(value) {
  if (!plainObject(value)
    || JSON.stringify(Object.keys(value)) !== JSON.stringify(BROWSER_ORDER)
    || BROWSER_ORDER.some((name) => typeof value[name]?.launch !== 'function')) {
    reject('Runner requires Chromium, Firefox and WebKit in reviewed order');
  }
  return value;
}

function validateOptions(options) {
  const clock = options.clock ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const maximumTotalMilliseconds = options.maximumTotalMilliseconds
    ?? MAXIMUM_TOTAL_MILLISECONDS;
  const maximumBrowserMilliseconds = options.maximumBrowserMilliseconds;
  if (typeof clock !== 'function' || typeof setTimer !== 'function'
    || typeof clearTimer !== 'function'
    || !Number.isSafeInteger(maximumTotalMilliseconds)
    || maximumTotalMilliseconds <= 0
    || maximumTotalMilliseconds > MAXIMUM_TOTAL_MILLISECONDS
    || (maximumBrowserMilliseconds !== undefined
      && (!Number.isSafeInteger(maximumBrowserMilliseconds)
        || maximumBrowserMilliseconds <= 0
        || maximumBrowserMilliseconds > BROWSER_DEADLINES_MILLISECONDS.chromium))) {
    reject('Runner timing options exceed the reviewed bounds');
  }
  if (options.signal !== undefined
    && (typeof options.signal !== 'object'
      || typeof options.signal.aborted !== 'boolean'
      || typeof options.signal.addEventListener !== 'function'
      || typeof options.signal.removeEventListener !== 'function')) {
    reject('Runner abort signal is invalid');
  }
  const browserDeadlinesMilliseconds = Object.freeze(Object.fromEntries(
    BROWSER_ORDER.map((browser) => [
      browser,
      Math.min(
        BROWSER_DEADLINES_MILLISECONDS[browser],
        maximumBrowserMilliseconds ?? BROWSER_DEADLINES_MILLISECONDS[browser],
      ),
    ]),
  ));
  return {
    clock,
    setTimer,
    clearTimer,
    maximumTotalMilliseconds,
    browserDeadlinesMilliseconds,
  };
}

function instant(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) reject('Runner clock returned an invalid instant');
  return value;
}

async function closeQuietly(value) {
  if (value === undefined || typeof value.close !== 'function') return true;
  try {
    await value.close();
    return true;
  } catch {
    return false;
  }
}

async function runEngine(engine, browserName, privateInputProvider, timing, signal) {
  if (signal?.aborted === true) reject('Browser-relay runner was aborted before launch');
  let privateInput;
  let browser;
  let context;
  let timer;
  let expired = false;
  let abortHandler;
  try {
    const operation = (async () => {
      try {
        privateInput = validatePrivatePageInput(await privateInputProvider(browserName, signal));
      } catch {
        return reject(`Private input provisioning failed for ${browserName}`);
      }
      if (expired || signal?.aborted === true) reject('Browser invocation expired before launch');
      browser = await engine.launch({ headless: true });
      if (browser === null || typeof browser !== 'object'
        || typeof browser.newContext !== 'function' || typeof browser.close !== 'function') {
        reject('Browser engine returned an invalid browser boundary');
      }
      if (expired || signal?.aborted === true) {
        await closeQuietly(browser);
        reject('Browser invocation expired during launch');
      }
      context = await browser.newContext({
        acceptDownloads: false,
        bypassCSP: false,
        ignoreHTTPSErrors: false,
        javaScriptEnabled: true,
        locale: 'en-US',
        serviceWorkers: 'block',
      });
      if (context === null || typeof context !== 'object'
        || typeof context.newPage !== 'function' || typeof context.close !== 'function') {
        reject('Browser engine returned an invalid context boundary');
      }
      if (expired || signal?.aborted === true) reject('Browser invocation expired during setup');
      const page = await context.newPage();
      if (page === null || typeof page !== 'object'
        || typeof page.goto !== 'function' || typeof page.evaluate !== 'function') {
        reject('Browser engine returned an invalid page boundary');
      }
      await page.goto(BROWSER_RELAY_TARGET_URL, {
        waitUntil: 'domcontentloaded',
        timeout: MAXIMUM_NAVIGATION_MILLISECONDS,
      });
      const rawResult = await page.evaluate(async ({ input, expectedBrowser, expectedSchema }) => {
        const acceptance = globalThis.miakappBrowserRelayAcceptance;
        if (acceptance === null || typeof acceptance !== 'object'
          || typeof acceptance.run !== 'function') {
          throw new Error('closed acceptance API absent');
        }
        const result = await acceptance.run(input);
        if (result?.browser !== expectedBrowser || result?.schema !== expectedSchema) {
          throw new Error('closed acceptance API returned the wrong boundary');
        }
        return result;
      }, {
        input: privateInput,
        expectedBrowser: browserName,
        expectedSchema: ENGINE_RESULT_SCHEMA,
      });
      return validateEngineResult(rawResult, browserName);
    })();
    const deadline = new Promise((_, rejectDeadline) => {
      timer = timing.setTimer(
        () => {
          expired = true;
          rejectDeadline(new StagingBrowserRelayRunnerError('browser deadline'));
        },
        timing.browserDeadlinesMilliseconds[browserName],
      );
    });
    const aborted = new Promise((_, rejectAbort) => {
      if (signal === undefined) return;
      abortHandler = () => {
        expired = true;
        rejectAbort(new StagingBrowserRelayRunnerError('browser aborted'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    });
    return await Promise.race([operation, deadline, aborted]);
  } catch (error) {
    if (error instanceof StagingBrowserRelayRunnerError
      && error.message === `Private input provisioning failed for ${browserName}`) {
      throw error;
    }
    return reject(`Browser-relay ${browserName} invocation failed before a closed result`);
  } finally {
    privateInput = undefined;
    if (timer !== undefined) timing.clearTimer(timer);
    if (abortHandler !== undefined) signal.removeEventListener('abort', abortHandler);
    await closeQuietly(context);
    if (!await closeQuietly(browser)) {
      reject(`Browser-relay ${browserName} cleanup did not converge`);
    }
  }
}

export async function runThreeEngineBrowserRelayAcceptance(
  engineValue,
  privateInputProvider,
  options = {},
) {
  validatePlaywrightDiagnosticEnvironment();
  validateBrowserRelayRunnerProfile();
  const engines = validateEngines(engineValue);
  if (typeof privateInputProvider !== 'function') {
    reject('Runner requires one in-memory private input provider');
  }
  const timing = validateOptions(options);
  const startedAt = instant(timing.clock);
  const deadline = startedAt + timing.maximumTotalMilliseconds;
  const results = [];
  for (const browserName of BROWSER_ORDER) {
    if (instant(timing.clock) >= deadline) reject('Three-engine runner reached its total deadline');
    results.push(await runEngine(
      engines[browserName],
      browserName,
      privateInputProvider,
      timing,
      options.signal,
    ));
  }
  const duration = instant(timing.clock) - startedAt;
  if (duration < 0 || duration > timing.maximumTotalMilliseconds) {
    reject('Three-engine runner exceeded its total deadline');
  }
  return buildClosedRunnerResult(results, duration);
}
