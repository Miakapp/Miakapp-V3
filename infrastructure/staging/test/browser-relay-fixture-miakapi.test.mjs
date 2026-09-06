import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CONTROL_PLANE_ORIGIN,
  RELAY_A_URL,
} from '../browser-relay-page/boundary.mjs';
import {
  COORDINATOR_NAME,
} from '../browser-relay-fixture/contract.mjs';
import {
  StagingBrowserRelayFixtureMiakApiError,
  createPinnedMiakApiFixtureFactories,
} from '../browser-relay-fixture-miakapi/binding.mjs';
import {
  FIXTURE_MIAKAPI_BINDING_SOURCE_SHA256,
  FIXTURE_MIAKAPI_PROFILE_SHA256,
  MIAKAPI_NODE_BUNDLE_SHA256,
  validateBrowserRelayFixtureMiakApiProfile,
} from '../browser-relay-fixture-miakapi/contract.mjs';
import {
  validateBrowserRelayFixtureMiakApiRoot,
} from '../browser-relay-fixture-miakapi/guard.mjs';

const KEY_ID = Buffer.alloc(16, 1).toString('base64url');
const HOME_KEY = `mhk1_${KEY_ID}_${Buffer.alloc(32, 2).toString('base64url')}`;
const ACCESS_TOKEN = `${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;
const EXCHANGE_ENDPOINT = `${CONTROL_PLANE_ORIGIN}/v1/access-tokens:exchange`;

function accessTokenResponse() {
  return new Response(JSON.stringify({
    schema: 'miakapp.access-token/1',
    access_token: ACCESS_TOKEN,
    token_type: 'Bearer',
    expires_at_ms: Date.now() + 300_000,
    relay_url: RELAY_A_URL,
    key: { id: KEY_ID, label: 'Browser relay acceptance coordinator' },
  }), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function providerInput() {
  return { exchangeEndpoint: EXCHANGE_ENDPOINT, homeKey: HOME_KEY };
}

test('pins one dormant reproducible MiakAPI Node factory binding', () => {
  const profile = validateBrowserRelayFixtureMiakApiProfile();
  assert.equal(
    profile.state,
    'closed_pinned_miakapi_factory_binding_implemented_not_wired_not_executed',
  );
  assert.equal(profile.runtime.bundle_bytes, 160_762);
  assert.deepEqual(profile.runtime.exported_factories, [
    'createCoordinator',
    'createHomeKeyAccessTokenProvider',
  ]);
  assert.equal(profile.boundary.ambient_fetch_fallback_reachable, false);
  assert.equal(profile.authority.live_execution_authorized, false);
  assert.equal(profile.evidence.live_http_requests, 0);
  assert.match(FIXTURE_MIAKAPI_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(FIXTURE_MIAKAPI_BINDING_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(MIAKAPI_NODE_BUNDLE_SHA256, /^[0-9a-f]{64}$/u);
});

test('constructs both factories and a coordinator without any I/O', () => {
  let requestCount = 0;
  const factories = createPinnedMiakApiFixtureFactories({
    async fetch() {
      requestCount += 1;
      throw new Error('private transport failure');
    },
  });
  assert.equal(requestCount, 0);
  assert.deepEqual(Object.keys(factories), [
    'createHomeKeyAccessTokenProvider',
    'createCoordinator',
  ]);
  const provider = factories.createHomeKeyAccessTokenProvider(providerInput());
  assert.equal(requestCount, 0);
  const coordinator = factories.createCoordinator({
    name: COORDINATOR_NAME,
    accessTokenProvider: provider,
  });
  assert.equal(requestCount, 0);
  assert.equal(typeof coordinator.configure, 'function');
  assert.equal(typeof coordinator.start, 'function');
  assert.equal(typeof coordinator.stop, 'function');
  assert.equal(typeof coordinator.state.set, 'function');
  assert.equal(coordinator.status, 'idle');
});

test('routes the Home Key exchange only through the injected transport', async () => {
  const calls = [];
  const factories = createPinnedMiakApiFixtureFactories({
    async fetch(input, init) {
      calls.push({ input, init });
      return accessTokenResponse();
    },
  });
  const provider = factories.createHomeKeyAccessTokenProvider(providerInput());
  const controller = new AbortController();
  const token = await provider.getAccessToken({
    coordinatorName: COORDINATOR_NAME,
    reason: 'initial',
    signal: controller.signal,
  });
  assert.deepEqual(token, {
    relayUrl: RELAY_A_URL,
    token: ACCESS_TOKEN,
    expiresAtMs: token.expiresAtMs,
  });
  assert.ok(token.expiresAtMs > Date.now());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, EXCHANGE_ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${HOME_KEY}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    purpose: 'relay',
    role: 'coordinator',
    coordinator_name: COORDINATOR_NAME,
    reason: 'initial',
  });
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].init.signal, controller.signal);
});

test('rejects duplicate factories and a substituted coordinator provider', () => {
  const factories = createPinnedMiakApiFixtureFactories({
    fetch: async () => accessTokenResponse(),
  });
  const provider = factories.createHomeKeyAccessTokenProvider(providerInput());
  assert.throws(
    () => factories.createHomeKeyAccessTokenProvider(providerInput()),
    StagingBrowserRelayFixtureMiakApiError,
  );
  assert.throws(
    () => factories.createCoordinator({
      name: COORDINATOR_NAME,
      accessTokenProvider: { async getAccessToken() {} },
    }),
    /outside the reviewed boundary/u,
  );
  const coordinator = factories.createCoordinator({
    name: COORDINATOR_NAME,
    accessTokenProvider: provider,
  });
  assert.equal(coordinator.status, 'idle');
  assert.throws(
    () => factories.createCoordinator({
      name: COORDINATOR_NAME,
      accessTokenProvider: provider,
    }),
    StagingBrowserRelayFixtureMiakApiError,
  );
});

test('collapses injected transport failures without propagating private details', async () => {
  const privateMessage = `Bearer ${'private'.repeat(12)}`;
  const factories = createPinnedMiakApiFixtureFactories({
    async fetch() {
      throw new Error(privateMessage);
    },
  });
  const provider = factories.createHomeKeyAccessTokenProvider(providerInput());
  await assert.rejects(
    provider.getAccessToken({
      coordinatorName: COORDINATOR_NAME,
      reason: 'initial',
      signal: new AbortController().signal,
    }),
    (error) => error instanceof Error
      && error.message === 'Miakapp access-token exchange failed'
      && !error.message.includes(privateMessage),
  );
});

test('guards the exact dormant source and vendored bundle inventory', () => {
  const root = new URL('../browser-relay-fixture-miakapi/', import.meta.url);
  assert.doesNotThrow(() => validateBrowserRelayFixtureMiakApiRoot(root));

  const executableRoot = mkdtempSync(join(tmpdir(), 'miakapp-fixture-miakapi-exec-'));
  mkdirSync(join(executableRoot, 'vendor'));
  for (const file of ['README.md', 'binding.mjs', 'contract.mjs', 'guard.mjs', 'profile.json']) {
    copyFileSync(new URL(file, root), join(executableRoot, file));
  }
  for (const file of ['LICENSE.miakapi', 'miakapi-node-v4.mjs']) {
    copyFileSync(new URL(`vendor/${file}`, root), join(executableRoot, 'vendor', file));
  }
  chmodSync(join(executableRoot, 'binding.mjs'), 0o755);
  assert.throws(
    () => validateBrowserRelayFixtureMiakApiRoot(new URL(`file://${executableRoot}/`)),
    /must be a non-executable regular file/u,
  );
});
