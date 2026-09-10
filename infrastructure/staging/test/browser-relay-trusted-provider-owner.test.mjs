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
  validateTrustedProviderOwnerAuthorityBytes,
  validateTrustedProviderOwnerBootstrap,
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

function nullRecord(value) {
  return Object.freeze(Object.assign(Object.create(null), value));
}

function authorityFixture({ trace, value = Buffer.alloc(32, 0xa5), reject = false } = {}) {
  let calls = 0;
  const authority = nullRecord({
    async consume(callback) {
      calls += 1;
      trace?.push('authority:consume');
      if (reject) {
        if (Buffer.isBuffer(value)) value.fill(0);
        throw new Error('Bearer authority-callback-secret');
      }
      if (typeof callback !== 'function') throw new Error('invalid callback');
      try {
        return await callback(value);
      } finally {
        if (Buffer.isBuffer(value)) value.fill(0);
      }
    },
  });
  return Object.freeze({
    bootstrap: nullRecord({ authority }),
    bytes: value,
    calls: () => calls,
  });
}

function allZero(bytes) {
  return bytes.every((byte) => byte === 0);
}

function unreachableRuntime() {
  return Object.freeze({
    clock: () => 1,
    async delay() {},
    createSourceTruth() { assert.fail('source construction must not run'); },
    createOperation() { assert.fail('operation construction must not run'); },
    createBrowser() { assert.fail('browser construction must not run'); },
    createComposition() { assert.fail('composition construction must not run'); },
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

test('captures only the exact frozen null-prototype authority capability', async () => {
  const fixture = authorityFixture();
  const consume = validateTrustedProviderOwnerBootstrap(fixture.bootstrap);
  assert.equal(typeof consume, 'function');
  await consume(async (bytes) => {
    assert.equal(bytes, fixture.bytes);
  });
  assert.equal(fixture.calls(), 1);
  assert.equal(allZero(fixture.bytes), true);

  const shadowedValid = Buffer.alloc(32, 0xa5);
  Object.defineProperty(shadowedValid, 'byteLength', { value: 0 });
  assert.equal(validateTrustedProviderOwnerAuthorityBytes(shadowedValid), shadowedValid);
  shadowedValid.fill(0);

  const shadowedEmpty = Buffer.alloc(0);
  Object.defineProperty(shadowedEmpty, 'byteLength', { value: 32 });
  assert.throws(
    () => validateTrustedProviderOwnerAuthorityBytes(shadowedEmpty),
    ownerError,
  );
  if (typeof SharedArrayBuffer === 'function') {
    const shared = Buffer.from(new SharedArrayBuffer(32));
    Object.defineProperty(shared, 'buffer', { value: new ArrayBuffer(32) });
    const sharedArrayBufferDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'SharedArrayBuffer',
    );
    try {
      Object.defineProperty(globalThis, 'SharedArrayBuffer', {
        configurable: true,
        value: class ShadowedSharedArrayBuffer {},
      });
      assert.throws(
        () => validateTrustedProviderOwnerAuthorityBytes(shared),
        ownerError,
      );
    } finally {
      Object.defineProperty(globalThis, 'SharedArrayBuffer', sharedArrayBufferDescriptor);
    }
    shared.fill(0);
  }

  const validAuthority = fixture.bootstrap.authority;
  for (const invalid of [
    undefined,
    null,
    {},
    Object.freeze({ authority: validAuthority }),
    nullRecord({ authority: Object.freeze({ consume() {} }) }),
    nullRecord({ authority: validAuthority, extra: true }),
    new Proxy(fixture.bootstrap, {}),
  ]) assert.throws(() => validateTrustedProviderOwnerBootstrap(invalid), ownerError);
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
  const authority = authorityFixture({ trace });
  const owner = createBrowserRelayTrustedProviderOwnerForTesting(
    runtime,
    authority.bootstrap,
  );
  assert.equal(Object.getPrototypeOf(owner), null);
  assert.equal(Object.isFrozen(owner), true);
  assert.deepEqual(Object.keys(owner), ['execute', 'close']);
  assert.deepEqual(trace, []);

  const controller = new AbortController();
  const result = await owner.execute(Object.freeze({ signal: controller.signal }));
  assert.deepEqual(result, expectedResult);
  assert.equal(authority.calls(), 1);
  assert.equal(allZero(authority.bytes), true);
  assert.deepEqual(trace.slice(0, 6), [
    'authority:consume',
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
  const authority = authorityFixture();
  const owner = createBrowserRelayTrustedProviderOwnerForTesting(
    runtime,
    authority.bootstrap,
  );
  await assert.rejects(owner.execute(Object.freeze({ signal: controller.signal })), ownerError);
  await owner.close();
  assert.equal(authority.calls(), 1);
  assert.equal(allZero(authority.bytes), true);
  assert.deepEqual(trace, ['source:close']);
});

test('fails closed on invalid or rejected authority without constructing the graph', async () => {
  for (const fixture of [
    authorityFixture({ value: 'Bearer invalid-authority' }),
    authorityFixture({ reject: true }),
  ]) {
    const owner = createBrowserRelayTrustedProviderOwnerForTesting(
      unreachableRuntime(),
      fixture.bootstrap,
    );
    await assert.rejects(owner.execute(), ownerError);
    await owner.close();
    assert.equal(fixture.calls(), 1);
    if (Buffer.isBuffer(fixture.bytes)) assert.equal(allZero(fixture.bytes), true);
  }
});

test('close before execute clears the captured consumer without invoking it', async () => {
  const fixture = authorityFixture();
  const owner = createBrowserRelayTrustedProviderOwnerForTesting(
    unreachableRuntime(),
    fixture.bootstrap,
  );
  await Promise.all([owner.close(), owner.close()]);
  assert.equal(fixture.calls(), 0);
  await assert.rejects(owner.execute(), ownerError);
});
