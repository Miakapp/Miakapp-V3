import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, firefox, webkit } from 'playwright';

import {
  HOSTING_HEADERS,
  buildBrowserRelayPageArtifact,
  readAndVerifyBrowserRelayPageArtifact,
} from '../browser-relay-page/artifact.mjs';
import {
  BROWSER_ORDER,
  TARGET_ORIGIN,
  TARGET_URL,
  validateBrowserRelayPageProfile,
} from '../browser-relay-page/contract.mjs';

const engines = Object.freeze({ chromium, firefox, webkit });
const firebaseConfig = Object.freeze({
  apiKey: `AIza${'A'.repeat(35)}`,
  appId: '1:1072737219170:web:5053ca93bf25d7373cd73b',
  authDomain: 'miakapp-v4-staging.firebaseapp.com',
  messagingSenderId: '1072737219170',
  projectId: 'miakapp-v4-staging',
  storageBucket: 'miakapp-v4-staging.firebasestorage.app',
});
const bundle = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-page-smoke-'));

try {
  const profile = validateBrowserRelayPageProfile();
  const metadata = await buildBrowserRelayPageArtifact(bundle, firebaseConfig, 'A'.repeat(32));
  const files = readAndVerifyBrowserRelayPageArtifact(bundle, metadata);
  const responses = new Map(files.map((file) => [`${TARGET_ORIGIN}${file.path}`, file]));

  for (const browserName of BROWSER_ORDER) {
    const browserType = engines[browserName];
    const browser = await browserType.launch({ headless: true });
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    const unexpectedRequests = [];
    const pageErrors = [];
    try {
      await context.route('**/*', async (route) => {
        const file = responses.get(route.request().url());
        if (file === undefined) {
          unexpectedRequests.push(route.request().url());
          await route.abort('blockedbyclient');
          return;
        }
        await route.fulfill({
          status: 200,
          body: file.raw,
          headers: {
            ...HOSTING_HEADERS,
            'Content-Type': file.content_type,
          },
        });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(
        () => globalThis.miakappBrowserRelayPage !== undefined,
        undefined,
        { timeout: 30_000 },
      );
      const observation = await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(
          globalThis,
          'miakappBrowserRelayPage',
        );
        return {
          api: Object.keys(globalThis.miakappBrowserRelayPage),
          frozen: Object.isFrozen(globalThis.miakappBrowserRelayPage),
          descriptor: descriptor === undefined ? null : {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            writable: descriptor.writable,
          },
          runner_api_absent: globalThis.miakappBrowserRelayAcceptance === undefined,
          state: document.querySelector('[data-mia-state]')?.dataset.miaState,
          text: document.querySelector('[data-mia-state]')?.textContent,
          indexed_db_available_before_private_initialization:
            typeof globalThis.indexedDB === 'object',
        };
      });
      assert.deepEqual(observation, {
        api: profile.page.api,
        frozen: true,
        descriptor: {
          configurable: false,
          enumerable: false,
          writable: false,
        },
        runner_api_absent: true,
        state: 'dormant',
        text: 'Staging browser relay acceptance is dormant',
        indexed_db_available_before_private_initialization: true,
      });
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(unexpectedRequests, []);
    } finally {
      await context.close();
      await browser.close();
    }
  }
  process.stdout.write(
    'Dormant page artifact loaded in Chromium, Firefox and WebKit without network access.\n',
  );
} finally {
  rmSync(bundle, { force: true, recursive: true });
}
