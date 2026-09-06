import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

import {
  BROWSER_ORDER,
  BROWSER_RELAY_TARGET_URL,
  ENGINE_RESULT_SCHEMA,
} from '../browser-relay-runner/contract.mjs';
import { runThreeEngineBrowserRelayAcceptance } from '../browser-relay-runner/driver.mjs';
import profile from '../browser-relay-runner/profile.json' with { type: 'json' };

function result(browser) {
  return {
    schema: ENGINE_RESULT_SCHEMA,
    browser,
    state: 'succeeded',
    assertions: Object.fromEntries(profile.assertions[browser].map((name) => [name, true])),
    counters: {
      app_check_assessments: 0,
      control_plane_exchanges: 0,
      kms_signatures: 0,
      firestore_writes: 0,
      maximum_active_websockets: 0,
      source_credentials_on_websocket: 0,
      browser_credential_persistence_events: 0,
      physical_call_replays: 0,
    },
    duration_milliseconds: 1,
    public_key_ids: [],
    revision_ids: [],
    stable_outcome_classes: ['accepted'],
  };
}

const unexpectedRequests = [];

function interceptedEngine(browserType, browserName) {
  return {
    async launch(options) {
      const browser = await browserType.launch(options);
      return {
        async newContext(contextOptions) {
          const context = await browser.newContext(contextOptions);
          await context.route('**/*', async (route) => {
            if (route.request().url() !== BROWSER_RELAY_TARGET_URL) {
              unexpectedRequests.push(route.request().url());
              await route.abort('blockedbyclient');
              return;
            }
            const closedResult = JSON.stringify(result(browserName));
            await route.fulfill({
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: `<!doctype html><script>
                globalThis.miakappBrowserRelayAcceptance = Object.freeze({
                  run: async () => (${closedResult})
                });
              </script>`,
            });
          });
          return {
            async newPage() {
              const page = await context.newPage();
              return page;
            },
            close: () => context.close(),
          };
        },
        close: () => browser.close(),
      };
    },
  };
}

const engines = {
  chromium: interceptedEngine(chromium, 'chromium'),
  firefox: interceptedEngine(firefox, 'firefox'),
  webkit: interceptedEngine(webkit, 'webkit'),
};
const privateMarker = 'private-browser-smoke-marker';
const output = await runThreeEngineBrowserRelayAcceptance(
  engines,
  async (browser) => ({ browser, privateMarker }),
);
assert.deepEqual(output.browser_order, BROWSER_ORDER);
assert.equal(output.browser_invocations, 3);
assert.equal(output.assertions_passed, 40);
assert.equal(output.assertions_failed, 0);
assert.equal(JSON.stringify(output).includes(privateMarker), false);
assert.deepEqual(unexpectedRequests, []);
process.stdout.write('Closed runner launched Chromium, Firefox and WebKit without network access.\n');
