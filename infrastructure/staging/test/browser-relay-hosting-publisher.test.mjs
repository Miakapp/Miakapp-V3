import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  BROWSER_RELAY_HOSTING_DEPLOY_MESSAGE,
  BROWSER_RELAY_HOSTING_DISABLE_MESSAGE,
  BROWSER_RELAY_HOSTING_HEADERS,
  BROWSER_RELAY_HOSTING_LABELS,
  BROWSER_RELAY_HOSTING_PUBLISHER_PROFILE_SHA256,
  BROWSER_RELAY_HOSTING_SITE,
  StagingBrowserRelayHostingPublisherError,
  sha256,
  validateBrowserRelayHostingPublisherProfile,
} from '../browser-relay-hosting-publisher/contract.mjs';
import {
  validateBrowserRelayHostingPublisherRoot,
} from '../browser-relay-hosting-publisher/guard.mjs';
import {
  createBrowserRelayHostingPublisher,
} from '../browser-relay-hosting-publisher/publisher.mjs';
import {
  browserRelayHostingPublisherTestingConstants as URLS,
  createBrowserRelayHostingPublisherForImplementation,
} from '../browser-relay-hosting-publisher/testing.mjs';

const ROOT = new URL('../browser-relay-hosting-publisher/', import.meta.url);
const FILES = Object.freeze([
  'README.md', 'check.sh', 'contract.mjs', 'guard.mjs', 'internal.mjs',
  'profile.json', 'publisher.mjs', 'testing.mjs',
]);
const START = 1_789_100_000_000;
const TOKEN = `synthetic-hosting-authority-${'h'.repeat(80)}`;
const VERSION = `sites/${BROWSER_RELAY_HOSTING_SITE}/versions/synthetic-version-001`;
const HISTORICAL_VERSION =
  `sites/${BROWSER_RELAY_HOSTING_SITE}/versions/historical-deleted-001`;
const HISTORICAL_RELEASE =
  `sites/${BROWSER_RELAY_HOSTING_SITE}/releases/historical-disable-001`;

function artifact() {
  const values = [
    {
      path: '/__acceptance/browser-relay/',
      content_type: 'text/html; charset=utf-8',
      raw: Buffer.from('<!doctype html><main>synthetic relay</main>'),
    },
    {
      path: '/__acceptance/browser-relay/assets/browser-relay-Synthetic001.js',
      content_type: 'text/javascript; charset=utf-8',
      raw: Buffer.from('globalThis.syntheticBrowserRelay = true;\n'),
    },
  ];
  return Object.freeze(values.map((value) => {
    const gzip = gzipSync(value.raw, { level: 9, mtime: 0 });
    return Object.freeze({
      content_bytes: value.raw.byteLength,
      content_sha256: sha256(value.raw),
      content_type: value.content_type,
      gzip,
      gzip_bytes: gzip.byteLength,
      gzip_sha256: sha256(gzip),
      path: value.path,
      raw: value.raw,
    });
  }));
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function context(state, signal = new AbortController().signal) {
  return Object.freeze({
    signal,
    opened_at_milliseconds: START,
    callback_deadline_milliseconds: START + 900_000,
    deadline_milliseconds: START + 1_200_000,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function harness(options = {}) {
  const entries = options.entries ?? artifact();
  const state = {
    now: START,
    disabled: true,
    versions: [{ name: HISTORICAL_VERSION, status: 'DELETED' }],
    releases: [{
      name: HISTORICAL_RELEASE,
      type: 'SITE_DISABLE',
      version: null,
      message: 'Historical bounded attestation retired',
      releaseTime: new Date(START - 60_000).toISOString(),
    }],
    sequence: 0,
    requiredUploads: options.requiredUploads ?? entries.map(({ gzip_sha256 }) => gzip_sha256),
  };
  const calls = [];
  const waits = [];

  function managedVersion(status) {
    return {
      name: VERSION,
      status,
      labels: BROWSER_RELAY_HOSTING_LABELS,
      config: URLS.serving_config.config,
      ...(status === 'FINALIZED' ? { fileCount: '2', versionBytes: '4096' } : {}),
    };
  }

  function release(type, message) {
    state.sequence += 1;
    return {
      name: `sites/${BROWSER_RELAY_HOSTING_SITE}/releases/synthetic-release-${String(state.sequence).padStart(3, '0')}`,
      type,
      version: type === 'SITE_DISABLE' ? null : managedVersion('FINALIZED'),
      message,
      releaseTime: new Date(START + state.sequence * 1_000).toISOString(),
    };
  }

  const implementations = {
    clock: options.clock ?? (() => state.now),
    async wait(milliseconds, signal) {
      waits.push({ milliseconds, signal });
      if (signal?.aborted) throw new Error('aborted');
      state.now += milliseconds;
      if (options.wait) return options.wait({ milliseconds, signal, state });
    },
    async fetch(input, init) {
      const url = String(input);
      let kind;
      if (url === URLS.site_url && init.method === 'GET') kind = 'site';
      else if (url === URLS.version_inventory_url && init.method === 'GET') kind = 'versions';
      else if (url === URLS.release_inventory_url && init.method === 'GET') kind = 'releases';
      else if (url === URLS.versions_url && init.method === 'POST') kind = 'create';
      else if (url === `${URLS.versions_url}/${VERSION.split('/').at(-1)}:populateFiles`
        && init.method === 'POST') kind = 'populate';
      else if (url.startsWith(`https://upload-firebasehosting.googleapis.com/upload/${VERSION}/files/`)
        && init.method === 'POST') kind = 'upload';
      else if (url === `${URLS.versions_url}/${VERSION.split('/').at(-1)}?update_mask=status`
        && init.method === 'PATCH') kind = 'finalize';
      else if (url === `${URLS.releases_url}?versionName=${encodeURIComponent(VERSION)}`
        && init.method === 'POST') kind = 'deploy';
      else if (url === URLS.releases_url && init.method === 'POST') kind = 'disable';
      else if (url === `${URLS.versions_url}/${VERSION.split('/').at(-1)}`
        && init.method === 'DELETE') kind = 'delete';
      else if (url.startsWith('https://miakapp-v4-staging.web.app/__acceptance/browser-relay/')) {
        kind = 'public';
      }
      assert.ok(kind, `Only reviewed Hosting endpoints may be called: ${url}`);
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      const call = { body, init, kind, url };
      calls.push(call);
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.ok(init.signal instanceof AbortSignal);
      if (kind === 'public') {
        assert.equal(init.headers, undefined);
      } else {
        assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
        assert.equal(init.headers['X-Goog-User-Project'], 'miakapp-v4-staging');
      }

      const defaultResponse = () => {
        if (kind === 'site') return jsonResponse({
          name: `projects/miakapp-v4-staging/sites/${BROWSER_RELAY_HOSTING_SITE}`,
          defaultUrl: 'https://miakapp-v4-staging.web.app',
          type: 'DEFAULT_SITE',
          appId: '1:1072737219170:web:5053ca93bf25d7373cd73b',
        });
        if (kind === 'versions') return jsonResponse({ versions: state.versions });
        if (kind === 'releases') return jsonResponse({ releases: state.releases });
        if (kind === 'create') {
          assert.deepEqual(body, URLS.serving_config);
          state.versions.push(managedVersion('CREATED'));
          return jsonResponse(managedVersion('CREATED'));
        }
        if (kind === 'populate') {
          assert.deepEqual(body.files, Object.fromEntries(entries.map((entry) => [
            entry.path, entry.gzip_sha256,
          ])));
          return jsonResponse({
            uploadRequiredHashes: state.requiredUploads,
            uploadUrl: `https://upload-firebasehosting.googleapis.com/upload/${VERSION}/files`,
          });
        }
        if (kind === 'upload') {
          const hash = url.split('/').at(-1);
          const entry = entries.find(({ gzip_sha256 }) => gzip_sha256 === hash);
          assert.ok(entry);
          assert.ok(Buffer.isBuffer(body));
          assert.equal(body.equals(entry.gzip), true);
          assert.equal(init.headers['Content-Type'], 'application/octet-stream');
          return new Response(null, { status: 200 });
        }
        if (kind === 'finalize') {
          assert.deepEqual(body, { status: 'FINALIZED' });
          state.versions = state.versions.map((version) => (
            version.name === VERSION ? managedVersion('FINALIZED') : version
          ));
          return jsonResponse(managedVersion('FINALIZED'));
        }
        if (kind === 'deploy') {
          assert.deepEqual(body, { message: BROWSER_RELAY_HOSTING_DEPLOY_MESSAGE });
          state.disabled = false;
          const deployed = release('DEPLOY', BROWSER_RELAY_HOSTING_DEPLOY_MESSAGE);
          state.releases.push(deployed);
          return jsonResponse(deployed);
        }
        if (kind === 'disable') {
          assert.deepEqual(body, {
            type: 'SITE_DISABLE',
            message: BROWSER_RELAY_HOSTING_DISABLE_MESSAGE,
          });
          state.disabled = true;
          const disabled = release('SITE_DISABLE', BROWSER_RELAY_HOSTING_DISABLE_MESSAGE);
          state.releases.push(disabled);
          return jsonResponse(disabled);
        }
        if (kind === 'delete') {
          state.versions = state.versions.map((version) => (
            version.name === VERSION ? { ...managedVersion('FINALIZED'), status: 'DELETED' } : version
          ));
          return new Response(null, { status: 200 });
        }
        const path = new URL(url).pathname;
        const entry = entries.find((candidate) => candidate.path === path);
        if (state.disabled) return new Response('not found', { status: 404 });
        assert.ok(entry);
        return new Response(entry.raw, {
          status: 200,
          headers: { ...BROWSER_RELAY_HOSTING_HEADERS, 'Content-Type': entry.content_type },
        });
      };
      if (options.respond) {
        const response = await options.respond({
          body, call, calls, defaultResponse, entries, init, kind, state, url,
        });
        if (response !== undefined) return response;
      }
      return defaultResponse();
    },
  };
  const instance = createBrowserRelayHostingPublisherForImplementation(
    { accessToken: TOKEN },
    entries,
    implementations,
  );
  return {
    ...instance,
    calls,
    context: context(state),
    entries,
    implementations,
    state,
    waits,
  };
}

async function rejectsPublisher(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StagingBrowserRelayHostingPublisherError);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    const serialized = `${error.stack}\n${JSON.stringify(error)}`;
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes(VERSION), false);
    return true;
  });
}

async function publishAndVerify(h) {
  assert.equal(await h.publisher.publishRunner(h.context), true);
  assert.equal(await h.publisher.verifyRunner(h.context), true);
}

test('pins a dormant non-live fixed-site publisher and closed package', () => {
  const profile = validateBrowserRelayHostingPublisherProfile();
  assert.equal(profile.target.site_id, BROWSER_RELAY_HOSTING_SITE);
  assert.equal(profile.baseline.latest_release_type, 'SITE_DISABLE');
  assert.equal(profile.bounds.mutation_retries, 0);
  assert.equal(profile.bounds.maximum_public_poll_attempts, 30);
  assert.equal(profile.compatibility.staging_live_operation_wired, false);
  assert.equal(profile.evidence.hosting_publications, 0);
  assert.match(BROWSER_RELAY_HOSTING_PUBLISHER_PROFILE_SHA256, /^[0-9a-f]{64}$/u);
  assert.doesNotThrow(() => validateBrowserRelayHostingPublisherRoot(ROOT));
});

test('imports and constructs inertly with the exact operation method surface', () => {
  let calls = 0;
  const entries = artifact();
  const instance = createBrowserRelayHostingPublisherForImplementation(
    { accessToken: TOKEN },
    entries,
    {
      clock: () => START,
      fetch: () => { calls += 1; },
      wait: () => { calls += 1; },
    },
  );
  assert.equal(calls, 0);
  assert.deepEqual(Object.keys(instance.publisher), ['publishRunner', 'verifyRunner', 'removeRunner']);
  assert.equal(Object.getPrototypeOf(instance.publisher), null);
  assert.ok(Object.isFrozen(instance.publisher));
  assert.equal(typeof createBrowserRelayHostingPublisher, 'function');
});

test('drives one exact two-upload lifecycle and closes with sanitized inspection', async () => {
  const h = harness();
  await publishAndVerify(h);
  assert.equal(await h.publisher.removeRunner(), true);
  assert.equal(await h.publisher.removeRunner(), true);
  const inspection = h.inspect();
  assert.deepEqual(inspection, {
    schema: 'miakapp.staging-browser-relay-hosting-publisher-inspection/1',
    state: 'cleaned',
    version_known: true,
    publication_verified: true,
    cleanup_verified: true,
    attempts: {
      baseline: 1,
      create: 1,
      populate: 1,
      upload: 2,
      finalize: 1,
      deploy: 1,
      public_verify: 1,
      disable: 1,
      delete: 1,
      cleanup_verify: 1,
    },
    credentials_retained_in_result: false,
    artifact_bytes_retained_in_result: false,
    raw_responses_retained: false,
  });
  assert.equal(JSON.stringify(inspection).includes(TOKEN), false);
  assert.equal(JSON.stringify(inspection).includes(VERSION), false);
  for (const mutation of ['create', 'populate', 'finalize', 'deploy', 'disable', 'delete']) {
    assert.equal(h.calls.filter(({ kind }) => kind === mutation).length, 1);
  }
  assert.equal(h.calls.filter(({ kind }) => kind === 'upload').length, 2);
});

test('accepts a content-addressed zero-upload population response', async () => {
  const h = harness({ requiredUploads: [] });
  await publishAndVerify(h);
  assert.equal(await h.publisher.removeRunner(), true);
  assert.equal(h.calls.filter(({ kind }) => kind === 'upload').length, 0);
  assert.equal(h.inspect().attempts.upload, 0);
});

test('requires exact session, implementation, artifact, and operation context boundaries', async () => {
  const entries = artifact();
  const implementations = { clock: () => START, fetch: () => {}, wait: () => {} };
  for (const session of [undefined, {}, { accessToken: 'short' },
    { accessToken: `${TOKEN}\n` }, { accessToken: TOKEN, extra: true }]) {
    assert.throws(() => createBrowserRelayHostingPublisherForImplementation(
      session, entries, implementations,
    ), StagingBrowserRelayHostingPublisherError);
  }
  for (const boundary of [{}, { ...implementations, extra: true },
    { ...implementations, clock: () => -1 }, { ...implementations, fetch: null }]) {
    assert.throws(() => createBrowserRelayHostingPublisherForImplementation(
      { accessToken: TOKEN }, entries, boundary,
    ), StagingBrowserRelayHostingPublisherError);
  }
  for (const mutate of [
    (candidate) => { candidate[0].path = '/'; },
    (candidate) => { candidate[1].raw = Buffer.from('tampered'); },
    (candidate) => { candidate[1].gzip = Buffer.from('not gzip'); },
    (candidate) => { candidate.pop(); },
  ]) {
    const candidate = entries.map((entry) => ({ ...entry }));
    mutate(candidate);
    assert.throws(() => createBrowserRelayHostingPublisherForImplementation(
      { accessToken: TOKEN }, candidate, implementations,
    ), StagingBrowserRelayHostingPublisherError);
  }
  const invalidContext = harness();
  await rejectsPublisher(invalidContext.publisher.publishRunner({
    ...invalidContext.context,
    deadline_milliseconds: START + 1_200_001,
  }), 'invalid_configuration');
});

test('rejects unsafe baselines before dispatching a mutation', async (t) => {
  const cases = [
    ['active version', ({ kind, state }) => {
      if (kind === 'versions') state.versions.push({ name: VERSION, status: 'CREATED' });
    }],
    ['latest deploy', ({ kind, state }) => {
      if (kind === 'releases') state.releases.push({
        name: `sites/${BROWSER_RELAY_HOSTING_SITE}/releases/foreign-deploy-001`,
        type: 'DEPLOY', version: { name: HISTORICAL_VERSION }, message: 'foreign',
        releaseTime: new Date(START + 1_000).toISOString(),
      });
    }],
    ['existing public route', ({ kind, defaultResponse, entries }) => kind === 'public'
      ? new Response(entries[0].raw, { status: 200 }) : defaultResponse()],
    ['incomplete pagination', ({ kind, defaultResponse }) => kind === 'versions'
      ? jsonResponse({ versions: [], nextPageToken: 'more' }) : defaultResponse()],
    ['oversized inventory', ({ kind, defaultResponse }) => kind === 'versions'
      ? jsonResponse({ versions: Array.from({ length: 101 }, (_, index) => ({
        name: `sites/${BROWSER_RELAY_HOSTING_SITE}/versions/deleted-${String(index).padStart(3, '0')}`,
        status: 'DELETED',
      })) }) : defaultResponse()],
    ['ambiguous release order', ({ kind, defaultResponse, state }) => kind === 'releases'
      ? jsonResponse({ releases: [
        ...state.releases,
        {
          name: `sites/${BROWSER_RELAY_HOSTING_SITE}/releases/tied-deploy-001`,
          type: 'DEPLOY',
          version: { name: HISTORICAL_VERSION },
          message: 'foreign',
          releaseTime: state.releases[0].releaseTime,
        },
      ] }) : defaultResponse()],
  ];
  for (const [name, alter] of cases) await t.test(name, async () => {
    const h = harness({ respond: (event) => alter(event) });
    await assert.rejects(h.publisher.publishRunner(h.context),
      StagingBrowserRelayHostingPublisherError);
    assert.equal(h.calls.some(({ kind }) => kind === 'create'), false);
  });
});

test('rejects mutation response drift and cleans every known partial version once', async (t) => {
  const cases = [
    ['create labels', 'create', ({ defaultResponse }) => defaultResponse().json()
      .then((value) => jsonResponse({ ...value, labels: { owner: 'foreign' } }))],
    ['populate hash', 'populate', ({ entries }) => jsonResponse({
      uploadRequiredHashes: ['0'.repeat(64)],
      uploadUrl: `https://upload-firebasehosting.googleapis.com/upload/${VERSION}/files`,
      ignored: entries.length,
    })],
    ['finalize state', 'finalize', () => jsonResponse({
      name: VERSION, status: 'CREATED', labels: BROWSER_RELAY_HOSTING_LABELS,
      config: URLS.serving_config.config,
    })],
    ['deploy target', 'deploy', ({ defaultResponse }) => {
      const response = defaultResponse();
      return response.json().then((value) => jsonResponse({ ...value, message: 'drifted' }));
    }],
  ];
  for (const [name, failureKind, response] of cases) await t.test(name, async () => {
    const h = harness({
      respond: (event) => event.kind === failureKind ? response(event) : event.defaultResponse(),
    });
    await assert.rejects(h.publisher.publishRunner(h.context),
      StagingBrowserRelayHostingPublisherError);
    assert.equal(h.inspect().version_known, true);
    assert.equal(await h.publisher.removeRunner(), true);
    assert.equal(h.calls.filter(({ kind }) => kind === 'disable').length, 1);
    assert.equal(h.calls.filter(({ kind }) => kind === 'delete').length, 1);
  });
});

test('bounds read-only publication polling and rejects tampered public bytes', async () => {
  let misses = 0;
  const delayed = harness({
    respond: ({ kind, defaultResponse, state }) => {
      if (kind === 'public' && !state.disabled && misses < 4) {
        misses += 1;
        return new Response('not ready', { status: 404 });
      }
      return defaultResponse();
    },
  });
  await publishAndVerify(delayed);
  assert.equal(delayed.inspect().attempts.public_verify, 3);
  assert.equal(delayed.waits.length, 2);
  assert.equal(await delayed.publisher.removeRunner(), true);

  const tampered = harness({
    respond: ({ kind, defaultResponse, state }) => {
      if (kind === 'public' && !state.disabled) {
        return new Response('tampered', {
          status: 200,
          headers: {
            ...BROWSER_RELAY_HOSTING_HEADERS,
            'Content-Type': 'text/html; charset=utf-8',
          },
        });
      }
      return defaultResponse();
    },
  });
  assert.equal(await tampered.publisher.publishRunner(tampered.context), true);
  await rejectsPublisher(tampered.publisher.verifyRunner(tampered.context), 'verification_failed');
  assert.equal(tampered.waits.length, 0);
  assert.equal(await tampered.publisher.removeRunner(), true);
});

test('reconciles ambiguous disable and delete outcomes without mutation replay', async (t) => {
  for (const ambiguous of ['disable', 'delete']) await t.test(ambiguous, async () => {
    let failed = false;
    const h = harness({
      respond: ({ kind, defaultResponse }) => {
        if (kind === ambiguous && !failed) {
          failed = true;
          defaultResponse();
          throw new Error(`${TOKEN}:${VERSION}`);
        }
        return defaultResponse();
      },
    });
    await publishAndVerify(h);
    assert.equal(await h.publisher.removeRunner(), true);
    assert.equal(h.calls.filter(({ kind }) => kind === ambiguous).length, 1);
    assert.equal(h.inspect().cleanup_verified, true);
  });
});

test('fails closed on ambiguous unnamed version creation without retrying it', async () => {
  let failed = false;
  const h = harness({
    respond: ({ kind, defaultResponse }) => {
      if (kind === 'create' && !failed) {
        failed = true;
        defaultResponse();
        throw new Error(`${TOKEN}:${VERSION}`);
      }
      return defaultResponse();
    },
  });
  await assert.rejects(h.publisher.publishRunner(h.context),
    StagingBrowserRelayHostingPublisherError);
  assert.equal(h.inspect().version_known, false);
  await rejectsPublisher(h.publisher.removeRunner(), 'cleanup_failed');
  assert.equal(h.calls.filter(({ kind }) => kind === 'create').length, 1);
  assert.equal(h.calls.some(({ kind }) => kind === 'disable' || kind === 'delete'), false);
});

test('never replays cleanup mutations after a failed read-only reconciliation', async () => {
  let cleanupStarted = false;
  const h = harness({
    respond: ({ kind, defaultResponse }) => {
      if (kind === 'disable') {
        cleanupStarted = true;
        return defaultResponse();
      }
      if (kind === 'versions' && cleanupStarted) {
        return jsonResponse({ versions: [{
          name: `sites/${BROWSER_RELAY_HOSTING_SITE}/versions/foreign-active-001`,
          status: 'CREATED',
        }] });
      }
      return defaultResponse();
    },
  });
  await publishAndVerify(h);
  await rejectsPublisher(h.publisher.removeRunner(), 'cleanup_failed');
  await rejectsPublisher(h.publisher.removeRunner(), 'cleanup_failed');
  assert.equal(h.calls.filter(({ kind }) => kind === 'disable').length, 1);
  assert.equal(h.calls.filter(({ kind }) => kind === 'delete').length, 1);
});

test('rejects out-of-order, repeated, concurrent, expired, and aborted calls', async () => {
  const outOfOrder = harness();
  await rejectsPublisher(outOfOrder.publisher.verifyRunner(outOfOrder.context), 'invalid_lifecycle');
  assert.equal(await outOfOrder.publisher.removeRunner(), true);
  await rejectsPublisher(outOfOrder.publisher.publishRunner(outOfOrder.context), 'invalid_lifecycle');

  const gate = deferred();
  let held = false;
  const concurrent = harness({
    respond: ({ kind, defaultResponse }) => {
      if (kind === 'site' && !held) {
        held = true;
        return gate.promise.then(defaultResponse);
      }
      return defaultResponse();
    },
  });
  const first = concurrent.publisher.publishRunner(concurrent.context);
  await new Promise((resolve) => setImmediate(resolve));
  await rejectsPublisher(concurrent.publisher.publishRunner(concurrent.context), 'invalid_lifecycle');
  gate.resolve();
  assert.equal(await first, true);
  await rejectsPublisher(concurrent.publisher.publishRunner(concurrent.context), 'invalid_lifecycle');
  assert.equal(await concurrent.publisher.removeRunner(), true);

  const expired = harness();
  expired.state.now = START + 900_001;
  await rejectsPublisher(expired.publisher.publishRunner(expired.context), 'aborted');

  const aborted = harness();
  const controller = new AbortController();
  controller.abort();
  await rejectsPublisher(aborted.publisher.publishRunner(context(aborted.state, controller.signal)),
    'aborted');
  assert.equal(aborted.calls.length, 0);
});

test('guard rejects profile drift, extra entries, symlinks, and executable files', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-hosting-publisher-test-'));
  try {
    for (const name of FILES) copyFileSync(new URL(name, ROOT), join(temporary, name));
    const rootUrl = pathToFileURL(`${temporary}/`);
    assert.doesNotThrow(() => validateBrowserRelayHostingPublisherRoot(rootUrl));

    const profilePath = join(temporary, 'profile.json');
    const profile = readFileSync(profilePath, 'utf8');
    writeFileSync(profilePath, `${profile}\n`);
    assert.throws(() => validateBrowserRelayHostingPublisherRoot(rootUrl),
      StagingBrowserRelayHostingPublisherError);
    writeFileSync(profilePath, profile);

    writeFileSync(join(temporary, 'extra.txt'), 'unexpected\n');
    assert.throws(() => validateBrowserRelayHostingPublisherRoot(rootUrl));
    rmSync(join(temporary, 'extra.txt'));

    rmSync(join(temporary, 'publisher.mjs'));
    symlinkSync(new URL('publisher.mjs', ROOT), join(temporary, 'publisher.mjs'));
    assert.throws(() => validateBrowserRelayHostingPublisherRoot(rootUrl));
    rmSync(join(temporary, 'publisher.mjs'));
    copyFileSync(new URL('publisher.mjs', ROOT), join(temporary, 'publisher.mjs'));
    chmodSync(join(temporary, 'publisher.mjs'), 0o700);
    assert.throws(() => validateBrowserRelayHostingPublisherRoot(rootUrl));
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

test('profile header pin matches the exact page-builder header bytes', () => {
  const profile = validateBrowserRelayHostingPublisherProfile();
  const digest = createHash('sha256')
    .update(`${JSON.stringify(BROWSER_RELAY_HOSTING_HEADERS, null, 2)}\n`)
    .digest('hex');
  assert.equal(profile.pins.hosting_headers_sha256, digest);
});
