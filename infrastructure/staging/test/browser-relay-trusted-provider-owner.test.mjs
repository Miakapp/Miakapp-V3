import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRUSTED_PROVIDER_OWNER_CALLS_BY_SOURCE,
  TRUSTED_PROVIDER_OWNER_MATRIX_FIELDS,
  TRUSTED_PROVIDER_OWNER_OBSERVATION_COUNT,
  TRUSTED_PROVIDER_OWNER_OPERATION_FIELDS,
  TRUSTED_PROVIDER_OWNER_SOURCE_ORDER,
  TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS,
  StagingBrowserRelayTrustedProviderOwnerError,
  validateTrustedProviderOwnerSchedule,
} from '../browser-relay-trusted-provider-owner/contract.mjs';
import {
  INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE,
  INDEPENDENT_CASE_ADAPTER_STAGE_ORDER,
} from '../browser-relay-independent-case-adapter/contract.mjs';
import {
  createBrowserRelayTrustedProviderOperation,
} from '../browser-relay-trusted-provider-owner/operation.mjs';
import {
  createBrowserRelayTrustedProviderSourceTruth,
  delayBrowserRelayTrustedProviderOwnerTimeline,
} from '../browser-relay-trusted-provider-owner/source-truth.mjs';
import {
  createBrowserRelayTrustedProviderOwnerForTesting,
} from '../browser-relay-trusted-provider-owner/testing.mjs';
import {
  closedOperationResult,
} from '../browser-relay-trusted-provider-process/test/helpers.mjs';

function ownerError(error) {
  return error instanceof StagingBrowserRelayTrustedProviderOwnerError
    && error.name === 'StagingBrowserRelayTrustedProviderOwnerError'
    && error.message === 'Staging browser-relay trusted provider owner failed closed';
}

function fakeBrowserOwner(trace) {
  return Object.freeze({
    components: Object.freeze({
      fixture: Object.freeze({}),
      async openChromiumPage() {},
      async openSecondaryPage() {},
      async prepareChromiumPhase() {},
      browserLifecycle: Object.freeze({}),
    }),
    async close() { trace.push('browser:close'); },
  });
}

test('pins the exact complete graph schedule', () => {
  assert.equal(validateTrustedProviderOwnerSchedule(), true);
  assert.equal(TRUSTED_PROVIDER_OWNER_SOURCE_ORDER.length, 7);
  assert.equal(TRUSTED_PROVIDER_OWNER_OPERATION_FIELDS.length, 17);
  assert.equal(TRUSTED_PROVIDER_OWNER_MATRIX_FIELDS.length, 5);
  assert.equal(TRUSTED_PROVIDER_OWNER_OBSERVATION_COUNT, 43);
  assert.equal(
    TRUSTED_PROVIDER_OWNER_SOURCE_ORDER.reduce(
      (total, source) => total + TRUSTED_PROVIDER_OWNER_CALLS_BY_SOURCE[source].length,
      0,
    ),
    43,
  );
});

test('owns all 43 timeline-ordered source observations without generic authority', async () => {
  const controller = new AbortController();
  let now = 10_000;
  const delays = [];
  const root = createBrowserRelayTrustedProviderSourceTruth(Object.freeze({
    clock: () => now,
    async delay(milliseconds, signal) {
      assert.equal(signal, controller.signal);
      assert.ok(Number.isSafeInteger(milliseconds) && milliseconds > 0);
      delays.push(milliseconds);
      now += milliseconds;
      await Promise.resolve();
    },
    signal: controller.signal,
  }));
  assert.equal(await root.authority.activateOperation(), true);
  let observations = 0;
  const activatedBrowsers = new Set();
  const expiry = now + 900_000;
  for (const stage of INDEPENDENT_CASE_ADAPTER_STAGE_ORDER) {
    const stageStartedAt = now;
    if (!activatedBrowsers.has(stage.browser)) {
      assert.equal(await root.authority.activateBrowser(stage.browser), true);
      activatedBrowsers.add(stage.browser);
    }
    const sources = INDEPENDENT_CASE_ADAPTER_SOURCES_BY_STAGE[
      `${stage.case_id}/${stage.browser}`
    ];
    await Promise.all(Object.entries(sources).map(async ([source, kinds]) => {
      const provider = root.providers[source];
      assert.equal(provider.source, source);
      assert.equal(provider.expires_at_milliseconds, expiry);
      assert.equal(Object.isFrozen(provider), true);
      assert.equal('request' in provider, false);
      assert.equal('fetch' in provider, false);
      for (const kind of kinds) {
        const observation = await provider[kind](Object.freeze({
          browser: stage.browser,
          case_id: stage.case_id,
          signal: controller.signal,
        }));
        assert.equal(Object.isFrozen(observation), true);
        observations += 1;
      }
    }));
    if (stage.browser === 'chromium' && ['LIVE-05', 'LIVE-06'].includes(stage.case_id)) {
      now = Math.max(now, stageStartedAt + 240_000);
    }
  }
  for (const source of TRUSTED_PROVIDER_OWNER_SOURCE_ORDER) {
    const provider = root.providers[source];
    await provider.close(controller.signal);
  }
  assert.equal(observations, 43);
  assert.ok(delays.includes(TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS));
  assert.ok(delays.every((milliseconds) => (
    milliseconds <= TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS
  )));
  await root.close();
});

test('cancels a real timeline delay without retaining the abort reason', async () => {
  const controller = new AbortController();
  const pending = delayBrowserRelayTrustedProviderOwnerTimeline(60_000, controller.signal);
  controller.abort(new Error('private abort reason'));
  await assert.rejects(pending, (error) => (
    error instanceof Error
    && error.message === 'Trusted provider source timeline was aborted'
    && !error.message.includes('private abort reason')
  ));
  assert.throws(
    () => delayBrowserRelayTrustedProviderOwnerTimeline(0, controller.signal),
    ownerError,
  );
});

test('rejects an overlapping source read without corrupting the source cursor', async () => {
  const controller = new AbortController();
  const root = createBrowserRelayTrustedProviderSourceTruth(Object.freeze({
    clock: () => 15_000,
    async delay() {},
    signal: controller.signal,
  }));
  assert.equal(await root.authority.activateOperation(), true);
  assert.equal(await root.authority.activateBrowser('chromium'), true);
  const provider = root.providers.firebase_app_check;
  const [firstCall, secondCall] = TRUSTED_PROVIDER_OWNER_CALLS_BY_SOURCE
    .firebase_app_check;
  const context = (call) => Object.freeze({
    browser: call.browser,
    case_id: call.case_id,
    signal: controller.signal,
  });
  const [first, duplicate] = await Promise.allSettled([
    provider[firstCall.kind](context(firstCall)),
    provider[firstCall.kind](context(firstCall)),
  ]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(duplicate.status, 'rejected');
  assert.equal(ownerError(duplicate.reason), true);
  assert.equal(
    Object.isFrozen(await provider[secondCall.kind](context(secondCall))),
    true,
  );
  await root.close();
});

test('constructs only during execute and drains every acquired root on close', async () => {
  const trace = [];
  const expectedResult = closedOperationResult();
  let compositionCloseCalls = 0;
  const runtime = Object.freeze({
    clock: () => 20_000,
    async delay() {},
    createSourceTruth(input) {
      trace.push('source:create');
      const root = createBrowserRelayTrustedProviderSourceTruth(input);
      return Object.freeze({
        ...root,
        async close() {
          trace.push('source:close');
          return root.close();
        },
      });
    },
    createOperation(input) {
      trace.push('operation:create');
      const root = createBrowserRelayTrustedProviderOperation(input);
      return Object.freeze({
        ...root,
        async close() {
          trace.push('operation:close');
          return root.close();
        },
      });
    },
    createBrowser() {
      trace.push('browser:create');
      return fakeBrowserOwner(trace);
    },
    createComposition(root, options) {
      trace.push('composition:create');
      assert.deepEqual(Object.keys(root), ['providers', 'operation', 'matrix']);
      assert.deepEqual(Object.keys(options), ['signal']);
      return Object.freeze({
        async execute() {
          trace.push('composition:execute');
          return expectedResult;
        },
        async close() {
          compositionCloseCalls += 1;
          trace.push('composition:close');
        },
      });
    },
  });
  const owner = createBrowserRelayTrustedProviderOwnerForTesting(runtime);
  assert.equal(Object.getPrototypeOf(owner), null);
  assert.equal(Object.isFrozen(owner), true);
  assert.deepEqual(Object.keys(owner), ['execute', 'close']);
  assert.deepEqual(trace, []);

  const controller = new AbortController();
  const result = await owner.execute(Object.freeze({ signal: controller.signal }));
  assert.deepEqual(result, expectedResult);
  assert.deepEqual(trace.slice(0, 5), [
    'source:create',
    'operation:create',
    'browser:create',
    'composition:create',
    'composition:execute',
  ]);
  await assert.rejects(owner.execute(), ownerError);
  await Promise.all([owner.close(), owner.close()]);
  await owner.close();
  assert.equal(compositionCloseCalls, 1);
  assert.deepEqual(trace.slice(-4), [
    'composition:close',
    'source:close',
    'browser:close',
    'operation:close',
  ]);
});

test('fails closed and cleans partial construction without retaining thrown details', async () => {
  const trace = [];
  const controller = new AbortController();
  const source = createBrowserRelayTrustedProviderSourceTruth(Object.freeze({
    clock: () => 30_000,
    async delay() {},
    signal: controller.signal,
  }));
  const runtime = Object.freeze({
    clock: () => 30_000,
    async delay() {},
    createSourceTruth() {
      return Object.freeze({
        ...source,
        async close() { trace.push('source:close'); return source.close(); },
      });
    },
    createOperation() { throw new Error('Bearer private-test-value'); },
    createBrowser() { assert.fail('browser construction must not run'); },
    createComposition() { assert.fail('composition construction must not run'); },
  });
  const owner = createBrowserRelayTrustedProviderOwnerForTesting(runtime);
  await assert.rejects(owner.execute(Object.freeze({ signal: controller.signal })), ownerError);
  await owner.close();
  assert.deepEqual(trace, ['source:close']);
});
