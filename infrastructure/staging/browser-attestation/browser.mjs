import { lstatSync } from 'node:fs';
import { chromium } from 'playwright';

import {
  RUNNER_URL,
  validateBrowserResult,
} from './contract.mjs';

export function validateBrowserPreflight() {
  const executable = chromium.executablePath();
  let entry;
  try {
    entry = lstatSync(executable);
  } catch {
    throw new Error('Pinned Playwright Chromium is not installed');
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error('Pinned Playwright Chromium executable is invalid');
  }
  return Object.freeze({ engine: chromium.name(), executable_present: true });
}

export async function runBrowserAttestation(options = {}) {
  const browserType = options.browserType ?? chromium;
  const launch = options.launch ?? ((settings) => browserType.launch(settings));
  let browser;
  let context;
  let page;
  try {
    browser = await launch({ headless: false });
    context = await browser.newContext({
      acceptDownloads: false,
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      serviceWorkers: 'allow',
    });
    page = await context.newPage();
    await page.goto(RUNNER_URL, {
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    });
    const semanticResult = await page.evaluate(async () => {
      const promise = window.__MIAKAPP_BROWSER_ATTESTATION__;
      if (!(promise instanceof Promise)) return null;
      return promise;
    });
    await context.close();
    context = undefined;
    await browser.close();
    browser = undefined;
    return validateBrowserResult({
      ...semanticResult,
      browser_context: 'ephemeral-closed',
    });
  } catch {
    throw new Error('Real browser App Check attestation did not produce the closed success shape');
  } finally {
    if (page !== undefined && context !== undefined) {
      await page.close().catch(() => {});
    }
    if (context !== undefined) await context.close().catch(() => {});
    if (browser !== undefined) await browser.close().catch(() => {});
  }
}
