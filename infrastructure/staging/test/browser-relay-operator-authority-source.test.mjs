import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  OPERATOR_AUTHORITY_SOURCE_MAXIMUM_AUTHORITY_BYTES,
  OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS,
  OPERATOR_AUTHORITY_SOURCE_PROFILE_SHA256,
  OPERATOR_AUTHORITY_SOURCE_USERINFO_URL,
  StagingBrowserRelayOperatorAuthoritySourceError,
  validateBrowserRelayOperatorAuthoritySourceProfile,
} from '../browser-relay-operator-authority-source/contract.mjs';
import {
  validateBrowserRelayOperatorAuthoritySourceRoot,
} from '../browser-relay-operator-authority-source/guard.mjs';
import {
  createBrowserRelayOperatorAuthoritySource,
} from '../browser-relay-operator-authority-source/source.mjs';
import {
  createBrowserRelayOperatorAuthoritySourceForTesting,
} from '../browser-relay-operator-authority-source/testing.mjs';

const ROOT = new URL('../browser-relay-operator-authority-source/', import.meta.url);
const FILES = Object.freeze([
  'README.md', 'check.sh', 'contract.mjs', 'guard.mjs', 'internal.mjs',
  'profile.json', 'source.mjs', 'testing.mjs',
]);
const START = 1_789_000_000_000;
const OPERATOR_EMAIL = 'operator@example.test';
const OPERATOR_SHA256 = createHash('sha256').update(OPERATOR_EMAIL).digest('hex');
const AUTHORITY_TEXT = `synthetic-authority-${'a'.repeat(96)}`;
const COMMANDS = Object.freeze([
  Object.freeze(['config', 'get-value', 'account', '--quiet']),
  Object.freeze(['config', 'get-value', 'auth/impersonate_service_account', '--quiet']),
  Object.freeze(['auth', 'print-access-token', `--account=${OPERATOR_EMAIL}`, '--quiet']),
]);

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function harness(overrides = {}) {
  const state = { now: START };
  const calls = [];
  const commandBuffers = [];
  const implementations = {
    clock: overrides.clock ?? (() => state.now),
    async command(args, options) {
      const index = calls.filter(({ kind }) => kind === 'command').length;
      assert.deepEqual(args, COMMANDS[index]);
      assert.ok(Object.isFrozen(args));
      assert.ok(Object.isFrozen(options));
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.timeout_milliseconds, 30_000);
      assert.equal(options.maximum_output_bytes, 65_536);
      calls.push({ kind: 'command', args, options });
      if (overrides.command) {
        const replacement = await overrides.command({ index, args, options, state });
        if (replacement !== undefined) return replacement;
      }
      const stdout = Buffer.from([
        `${OPERATOR_EMAIL}\n`, '(unset)\n', `${AUTHORITY_TEXT}\n`,
      ][index], 'utf8');
      const stderr = Buffer.alloc(0);
      commandBuffers.push(stdout, stderr);
      return { ok: true, stderr, stdout };
    },
    async fetch(url, init) {
      calls.push({ kind: 'fetch', url, init });
      assert.equal(url, OPERATOR_AUTHORITY_SOURCE_USERINFO_URL);
      assert.equal(init.method, 'GET');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.ok(init.signal instanceof AbortSignal);
      assert.deepEqual(init.headers, {
        Accept: 'application/json',
        Authorization: `Bearer ${AUTHORITY_TEXT}`,
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      });
      if (overrides.fetch) {
        const replacement = await overrides.fetch({ url, init, state });
        if (replacement !== undefined) return replacement;
      }
      return jsonResponse({ email: OPERATOR_EMAIL, email_verified: true });
    },
  };
  const source = createBrowserRelayOperatorAuthoritySourceForTesting(
    implementations,
    overrides.operatorSha256 ?? OPERATOR_SHA256,
  );
  return { calls, commandBuffers, implementations, source, state };
}

async function rejectsSource(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StagingBrowserRelayOperatorAuthoritySourceError);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    const serialized = `${error.stack}\n${JSON.stringify(error)}`;
    assert.equal(serialized.includes(AUTHORITY_TEXT), false);
    assert.equal(serialized.includes(OPERATOR_EMAIL), false);
    return true;
  });
}

test('pins a dormant non-live operator source and a closed package inventory', () => {
  const profile = validateBrowserRelayOperatorAuthoritySourceProfile();
  assert.equal(profile.pins.authority_channel_maximum_bytes, 16_384);
  assert.equal(profile.bounds.maximum_local_authority_window_seconds, 1_500);
  assert.equal(profile.limitations.google_bearer_cryptographically_audience_restricted, false);
  assert.equal(profile.lifecycle.close_signals_in_flight_work, true);
  assert.equal(profile.limitations.uncooperative_same_process_callback_forced_termination, false);
  assert.equal(profile.compatibility.trusted_provider_owner_wired, false);
  assert.equal(profile.authority.real_credential_acquisition_authorized_by_artifact, false);
  assert.equal(profile.evidence.real_credentials_acquired, 0);
  assert.equal(profile.evidence.live_principal_requests, 0);
  assert.match(OPERATOR_AUTHORITY_SOURCE_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.doesNotThrow(() => validateBrowserRelayOperatorAuthoritySourceRoot(ROOT));
});

test('imports and constructs without command or network work', () => {
  let calls = 0;
  const source = createBrowserRelayOperatorAuthoritySourceForTesting({
    clock: () => START,
    command: () => { calls += 1; },
    fetch: () => { calls += 1; },
  }, OPERATOR_SHA256);
  assert.deepEqual(Object.keys(source), ['consume', 'close']);
  assert.equal(Object.getPrototypeOf(source), null);
  assert.ok(Object.isFrozen(source));
  assert.equal(calls, 0);
  assert.equal(typeof createBrowserRelayOperatorAuthoritySource, 'function');
});

test('verifies the exact operator and exposes authority only for one closed callback', async () => {
  const h = harness();
  let callbackAuthority;
  const result = await h.source.consume(async (authority, context) => {
    callbackAuthority = authority;
    assert.ok(Buffer.isBuffer(authority));
    assert.equal(authority.toString('ascii'), AUTHORITY_TEXT);
    assert.equal(context.expires_at_milliseconds,
      START + OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS);
    assert.ok(context.signal instanceof AbortSignal);
    assert.equal(Object.getPrototypeOf(context), null);
    assert.ok(Object.isFrozen(context));
    return { state: 'closed', operation_count: 1 };
  });
  assert.deepEqual(result, { state: 'closed', operation_count: 1 });
  assert.ok(Object.isFrozen(result));
  assert.equal(callbackAuthority.every((byte) => byte === 0), true);
  assert.equal(h.commandBuffers.every((buffer) => buffer.every((byte) => byte === 0)), true);
  assert.deepEqual(h.calls.map(({ kind }) => kind), ['command', 'command', 'command', 'fetch']);
  await rejectsSource(h.source.consume(() => true), 'already_consumed');
  assert.equal(await h.source.close(), true);
  assert.equal(await h.source.close(), true);
});

test('requires the exact implementation, identity digest, callback, and options boundaries', async () => {
  const valid = {
    clock: () => START,
    command: () => assert.fail('must remain inert'),
    fetch: () => assert.fail('must remain inert'),
  };
  for (const value of [undefined, {}, { ...valid, extra: true },
    { ...valid, clock: () => NaN }, { ...valid, command: null }]) {
    assert.throws(
      () => createBrowserRelayOperatorAuthoritySourceForTesting(value, OPERATOR_SHA256),
      StagingBrowserRelayOperatorAuthoritySourceError,
    );
  }
  assert.throws(
    () => createBrowserRelayOperatorAuthoritySourceForTesting(valid, '0'.repeat(63)),
    StagingBrowserRelayOperatorAuthoritySourceError,
  );
  const missingCallback = harness();
  await rejectsSource(missingCallback.source.consume(null), 'invalid_configuration');
  const invalidOptions = harness();
  await rejectsSource(invalidOptions.source.consume(() => true, { signal: {}, extra: true }),
    'invalid_configuration');
});

test('rejects operator, impersonation, token, and command drift with fixed failures', async (t) => {
  const cases = [
    ['wrong operator', { command: ({ index }) => index === 0
      ? { ok: true, stdout: Buffer.from('other@example.test'), stderr: Buffer.alloc(0) }
      : undefined }, 'invalid_principal'],
    ['uppercase operator', { command: ({ index }) => index === 0
      ? { ok: true, stdout: Buffer.from('Operator@example.test'), stderr: Buffer.alloc(0) }
      : undefined }, 'invalid_principal'],
    ['impersonation configured', { command: ({ index }) => index === 1
      ? { ok: true, stdout: Buffer.from('service@example.test'), stderr: Buffer.alloc(0) }
      : undefined }, 'invalid_configuration'],
    ['command failed', { command: ({ index }) => index === 1
      ? { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.from(AUTHORITY_TEXT) }
      : undefined }, 'command_failed'],
    ['token too short', { command: ({ index }) => index === 2
      ? { ok: true, stdout: Buffer.from('short'), stderr: Buffer.alloc(0) }
      : undefined }, 'invalid_token'],
    ['token whitespace', { command: ({ index }) => index === 2
      ? { ok: true, stdout: Buffer.from('synthetic token with whitespace'), stderr: Buffer.alloc(0) }
      : undefined }, 'invalid_token'],
  ];
  for (const [name, overrides, code] of cases) await t.test(name, async () => {
    const h = harness(overrides);
    await rejectsSource(h.source.consume(() => true), code);
    assert.equal(h.calls.some(({ kind }) => kind === 'fetch'), false);
  });
});

test('rejects principal transport and semantic drift without leaking authority', async (t) => {
  const cases = [
    ['request failure', { fetch: () => { throw new Error(AUTHORITY_TEXT); } },
      'principal_request_failed'],
    ['wrong status', { fetch: () => jsonResponse({
      email: OPERATOR_EMAIL, email_verified: true,
    }, 403) }, 'invalid_principal'],
    ['wrong email', { fetch: () => jsonResponse({
      email: 'other@example.test', email_verified: true,
    }) }, 'invalid_principal'],
    ['unverified email', { fetch: () => jsonResponse({
      email: OPERATOR_EMAIL, email_verified: false,
    }) }, 'invalid_principal'],
    ['invalid JSON', { fetch: () => new Response('{', { status: 200 }) }, 'invalid_principal'],
    ['oversized declared body', { fetch: () => new Response('{}', {
      status: 200, headers: { 'Content-Length': '65537' },
    }) }, 'invalid_principal'],
  ];
  for (const [name, overrides, code] of cases) await t.test(name, async () => {
    const h = harness(overrides);
    await rejectsSource(h.source.consume(() => true), code);
  });
});

test('rejects unsafe callback results and collapses callback diagnostics', async () => {
  const thrown = harness();
  await rejectsSource(thrown.source.consume(() => { throw new Error(AUTHORITY_TEXT); }),
    'callback_failed');

  const forbiddenKey = harness();
  await rejectsSource(forbiddenKey.source.consume(() => ({ token: AUTHORITY_TEXT })),
    'invalid_result');

  const embedded = harness();
  await rejectsSource(embedded.source.consume(() => ({ state: AUTHORITY_TEXT })),
    'invalid_result');

  const binary = harness();
  await rejectsSource(binary.source.consume(() => Buffer.from(AUTHORITY_TEXT)),
    'invalid_result');
});

test('enforces one in-flight consume and the local authority window', async () => {
  const gate = deferred();
  const concurrent = harness();
  const first = concurrent.source.consume(async () => {
    await gate.promise;
    return true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  await rejectsSource(concurrent.source.consume(() => true), 'already_consumed');
  gate.resolve();
  assert.equal(await first, true);

  const expired = harness();
  await rejectsSource(expired.source.consume(() => {
    expired.state.now += OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS + 1;
    return true;
  }), 'window_expired');
});

test('forwards caller abort and close, then rejects use after close', async () => {
  const before = harness();
  const controller = new AbortController();
  controller.abort();
  await rejectsSource(before.source.consume(() => true, { signal: controller.signal }), 'aborted');
  assert.equal(before.calls.length, 0);

  const request = deferred();
  const inFlight = harness({
    fetch: ({ init }) => {
      init.signal.addEventListener('abort', () => request.reject(new Error('aborted')), { once: true });
      return request.promise;
    },
  });
  const consuming = inFlight.source.consume(() => true);
  await new Promise((resolve) => setImmediate(resolve));
  const closing = inFlight.source.close();
  await rejectsSource(consuming, 'aborted');
  assert.equal(await closing, true);

  const closed = harness();
  assert.equal(await closed.source.close(), true);
  await rejectsSource(closed.source.consume(() => true), 'closed');
  assert.equal(closed.calls.length, 0);
});

test('guard rejects profile drift, extra entries, symlinks, and executable sources', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-operator-authority-test-'));
  try {
    for (const name of FILES) copyFileSync(new URL(name, ROOT), join(temporary, name));
    const rootUrl = pathToFileURL(`${temporary}/`);
    assert.doesNotThrow(() => validateBrowserRelayOperatorAuthoritySourceRoot(rootUrl));

    const profilePath = join(temporary, 'profile.json');
    const profile = readFileSync(profilePath, 'utf8');
    writeFileSync(profilePath, `${profile}\n`);
    assert.throws(() => validateBrowserRelayOperatorAuthoritySourceRoot(rootUrl),
      StagingBrowserRelayOperatorAuthoritySourceError);
    writeFileSync(profilePath, profile);

    writeFileSync(join(temporary, 'extra.txt'), 'unexpected\n');
    assert.throws(() => validateBrowserRelayOperatorAuthoritySourceRoot(rootUrl));
    rmSync(join(temporary, 'extra.txt'));

    rmSync(join(temporary, 'source.mjs'));
    symlinkSync(new URL('source.mjs', ROOT), join(temporary, 'source.mjs'));
    assert.throws(() => validateBrowserRelayOperatorAuthoritySourceRoot(rootUrl));
    rmSync(join(temporary, 'source.mjs'));
    copyFileSync(new URL('source.mjs', ROOT), join(temporary, 'source.mjs'));
    chmodSync(join(temporary, 'source.mjs'), 0o700);
    assert.throws(() => validateBrowserRelayOperatorAuthoritySourceRoot(rootUrl));

    assert.notEqual(readFileSync(join(temporary, 'profile.json'), 'utf8'), '');
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

test('bounds authority input to the trusted-process maximum', async () => {
  const oversized = harness({
    command: ({ index }) => index === 2 ? {
      ok: true,
      stdout: Buffer.alloc(OPERATOR_AUTHORITY_SOURCE_MAXIMUM_AUTHORITY_BYTES + 1, 0x61),
      stderr: Buffer.alloc(0),
    } : undefined,
  });
  await rejectsSource(oversized.source.consume(() => true), 'invalid_token');
});
