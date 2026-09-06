import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
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
import { validatePlaywrightDiagnosticEnvironment } from '../browser-relay-runner/driver.mjs';

const engines = Object.freeze({ chromium, firefox, webkit });
const firebaseConfig = Object.freeze({
  apiKey: `${'AI'}${'za'}${'A'.repeat(35)}`,
  appId: '1:1072737219170:web:5053ca93bf25d7373cd73b',
  authDomain: 'miakapp-v4-staging.firebaseapp.com',
  messagingSenderId: '1072737219170',
  projectId: 'miakapp-v4-staging',
  storageBucket: 'miakapp-v4-staging.firebasestorage.app',
});
const bundle = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-page-smoke-'));
const lifecycleModules = [
  'browser-relay-page/runtime.mjs',
  'browser-relay-page/boundary.mjs',
  'test/helpers/browser-relay-page-harness.mjs',
  'test/helpers/browser-relay-page-bfcache-entry.mjs',
];

function documentSource(away = false) {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<link rel="icon" href="data:,"><title>Offline relay lifecycle smoke</title></head><body>'
    + (away ? '<p>Offline history destination</p>'
      : '<a id="away" href="/offline/away">Leave synthetic page</a>'
        + '<script type="module" src="/test/helpers/browser-relay-page-bfcache-entry.mjs"></script>')
    + '</body></html>';
}

async function createLoopbackServer(profile) {
  const pinNames = [
    'runtime_source_sha256', 'boundary_source_sha256',
    'offline_page_harness_sha256', 'offline_bfcache_entry_sha256',
  ];
  const responses = new Map(lifecycleModules.map((path) => [
    `/${path}`, { body: readFileSync(new URL(`../${path}`, import.meta.url)), type: 'text/javascript; charset=utf-8' },
  ]));
  lifecycleModules.forEach((path, index) => {
    const entry = lstatSync(new URL(`../${path}`, import.meta.url));
    assert.ok(entry.isFile() && !entry.isSymbolicLink() && (entry.mode & 0o111) === 0);
    assert.equal(createHash('sha256').update(responses.get(`/${path}`).body).digest('hex'),
      profile.pins[pinNames[index]]);
  });
  for (const path of ['/offline/primary', '/offline/replacement', '/offline/away']) {
    responses.set(path, { body: documentSource(path === '/offline/away'), type: 'text/html; charset=utf-8' });
  }
  let origin;
  const server = createServer((request, response) => {
    const file = responses.get(request.url);
    if (request.method !== 'GET' || `http://${request.headers.host}` !== origin || file === undefined) {
      response.writeHead(403, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    response.writeHead(200, {
      ...HOSTING_HEADERS,
      'Content-Type': file.type,
    });
    response.end(file.body);
  });
  // A denying proxy blocks browser-background and page traffic outside this exact loopback server.
  server.on('connect', (_request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  server.on('upgrade', (_request, socket) => {
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function initializedPage(context, origin, browserName, generation) {
  const page = await context.newPage();
  let pageErrors = 0;
  let unexpectedRequests = 0;
  page.on('pageerror', () => { pageErrors += 1; });
  page.on('request', (request) => {
    if (!request.url().startsWith(`${origin}/`)) unexpectedRequests += 1;
  });
  await page.goto(`${origin}/offline/${generation === 1 ? 'primary' : 'replacement'}`, {
    waitUntil: 'domcontentloaded', timeout: 15_000,
  });
  await page.waitForFunction(() => globalThis.miakappOfflineRelaySmoke !== undefined);
  const observation = await page.evaluate(
    ({ browserName: name, generation: identity }) => globalThis.miakappOfflineRelaySmoke.initialize(name, identity),
    { browserName, generation },
  );
  assert.equal(observation.page.state, 'ready');
  assert.equal(observation.indexed_db_unavailable, true);
  assert.equal(observation.page.firebase_auth_sessions, 1);
  assert.equal(observation.page.maximum_active_websockets, 1);
  return { page, counts: () => ({ pageErrors, unexpectedRequests }) };
}

async function nativeFallbackSmoke(browser, browserName, origin) {
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
  let phase = 'first-identity-initialization';
  try {
    const first = await initializedPage(context, origin, browserName, 1);
    const firstResult = await first.page.evaluate(async () => ({
      call: await globalThis.miakappOfflineRelaySmoke.call(23),
      lifecycle: globalThis.miakappOfflineRelaySmoke.observe().lifecycle,
      stopped: await globalThis.miakappOfflineRelaySmoke.stop(),
    }));
    assert.deepEqual(firstResult.call, {
      schema: 'miakapp.staging-browser-relay-page-call-observation/1',
      state: 'completed',
      outcome: 'applied',
    });
    assert.deepEqual(firstResult.lifecycle.call_outcomes, ['applied']);
    assert.ok(firstResult.lifecycle.state_transitions.some(
      ({ revision, stale }) => revision === 1 && !stale,
    ));
    assert.equal(firstResult.stopped.page.state, 'stopped');
    assert.equal(firstResult.stopped.page.active_websockets, 0);
    assert.equal(firstResult.stopped.lifecycle.sign_outs, 1);
    assert.equal(firstResult.stopped.lifecycle.disposals, 1);
    assert.deepEqual(firstResult.stopped.cleanup, { signOuts: 1, disposals: 1 });
    assert.deepEqual(first.counts(), { pageErrors: 0, unexpectedRequests: 0 });
    await first.page.close();

    // Replacement starts only after the prior identity completed explicit cleanup.
    phase = 'replacement-identity-initialization';
    const second = await initializedPage(context, origin, browserName, 2);
    const replacement = await second.page.evaluate(async () => ({
      call: await globalThis.miakappOfflineRelaySmoke.call(24),
      observation: globalThis.miakappOfflineRelaySmoke.observe(),
    }));
    assert.equal(replacement.call.outcome, 'applied');
    assert.deepEqual(replacement.observation.page.relay_ids, ['relay-b']);
    phase = 'native-pagehide';
    await Promise.all([
      second.page.waitForURL(`${origin}/offline/away`, { waitUntil: 'domcontentloaded' }),
      second.page.locator('#away').click(),
    ]);
    phase = 'trusted-non-persisted-terminal-fence';
    const checkpointResult = await second.page.evaluate(() => {
      const key = 'miakapp-offline-lifecycle';
      const raw = globalThis.sessionStorage.getItem(key);
      globalThis.sessionStorage.removeItem(key);
      return {
        checkpoint: raw === null ? null : JSON.parse(raw),
        cleared: globalThis.sessionStorage.getItem(key) === null,
      };
    });
    assert.equal(checkpointResult.cleared, true);
    const checkpoint = checkpointResult.checkpoint;
    assert.deepEqual(Object.keys(checkpoint).sort(), [
      'active_sockets', 'active_websockets', 'client_stops', 'indexed_db_unavailable',
      'lifecycle_pagehides', 'page_state', 'persisted', 'trusted',
    ]);
    assert.deepEqual({
      trusted: checkpoint.trusted,
      persisted: checkpoint.persisted,
      lifecycle_pagehides: checkpoint.lifecycle_pagehides,
      active_websockets: checkpoint.active_websockets,
      client_stops: checkpoint.client_stops,
      active_sockets: checkpoint.active_sockets,
    }, {
      trusted: true,
      persisted: false,
      lifecycle_pagehides: 1,
      active_websockets: 0,
      client_stops: 1,
      active_sockets: 0,
    });
    assert.ok(checkpoint.page_state === 'stopping' || checkpoint.page_state === 'stopped');
    assert.equal(checkpoint.indexed_db_unavailable, checkpoint.page_state === 'stopping');
    assert.deepEqual(second.counts(), { pageErrors: 0, unexpectedRequests: 0 });
    await second.page.close();
  } catch (error) {
    throw Object.assign(new Error('Offline native fallback lifecycle was not proven'), {
      phase,
      cause: error,
    });
  } finally {
    await context.close();
  }
}

let loopback;
let currentStage = 'diagnostic-environment';
try {
  validatePlaywrightDiagnosticEnvironment();
  assert.equal(process.argv.length, 2);
  const playwrightTypesUrl = new URL('../../../node_modules/playwright-core/types/types.d.ts', import.meta.url);
  const playwrightTypesEntry = lstatSync(playwrightTypesUrl);
  assert.ok(playwrightTypesEntry.isFile() && !playwrightTypesEntry.isSymbolicLink());
  assert.ok(readFileSync(playwrightTypesUrl, 'utf8').includes(
    'Testing Back/Forward Cache (BFCache) is not supported.',
  ));
  currentStage = 'profile-and-artifact';
  const profile = validateBrowserRelayPageProfile();
  const metadata = await buildBrowserRelayPageArtifact(bundle, firebaseConfig, 'A'.repeat(32));
  const files = readAndVerifyBrowserRelayPageArtifact(bundle, metadata);
  const responses = new Map(files.map((file) => [`${TARGET_ORIGIN}${file.path}`, file]));
  loopback = await createLoopbackServer(profile);
  const failures = [];

  for (const browserName of BROWSER_ORDER) {
    const browserType = engines[browserName];
    currentStage = `${browserName}:launch`;
    const browser = await browserType.launch({
      headless: true,
      proxy: { server: loopback.origin, bypass: '127.0.0.1' },
    });
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    let unexpectedRequests = 0;
    let pageErrors = 0;
    try {
      await context.route('**/*', async (route) => {
        const file = responses.get(route.request().url());
        if (file === undefined) {
          unexpectedRequests += 1;
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
      page.on('pageerror', () => { pageErrors += 1; });
      currentStage = `${browserName}:dormant-artifact`;
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
      assert.equal(pageErrors, 0);
      assert.equal(unexpectedRequests, 0);
      await context.close();
      currentStage = `${browserName}:native-non-persisted-fallback`;
      try {
        await nativeFallbackSmoke(browser, browserName, loopback.origin);
        process.stdout.write(`${browserName}: explicit identity cleanup, sequential replacement and trusted non-persisted pagehide fencing passed (offline fakes).\n`);
      } catch (error) {
        failures.push(browserName);
        process.stderr.write(`${JSON.stringify({
          browser: browserName,
          phase: error.phase,
          offline_native_fallback_proven: false,
        })}\n`);
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }
  assert.deepEqual(failures, []);
  process.stdout.write(
    'Dormant artifacts, explicit cleanup and native pagehide fencing passed in all pinned browsers; asynchronous unload cleanup, BFCache restoration and cloud acceptance remain unproven.\n',
  );
} catch {
  process.stderr.write(`Offline browser page smoke failed at ${currentStage}; raw browser diagnostics were discarded.\n`);
  process.exitCode = 1;
} finally {
  await loopback?.close();
  rmSync(bundle, { force: true, recursive: true });
}
