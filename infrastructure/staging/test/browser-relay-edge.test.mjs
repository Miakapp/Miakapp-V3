import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildFunctionIngressPatch,
  buildFunctionProfilePatch,
  buildIamPatch,
  createGoogleEdgeClient,
} from '../browser-relay-edge/cloud.mjs';
import { validateBrowserRelayEdgeRoot } from '../browser-relay-edge/guard.mjs';
import {
  PROBE_PRINCIPAL,
  StagingBrowserRelayEdgeInventoryError,
  classifyEdgeInventory,
  normalizeEdgeInventory,
  policyForPublicInvoker,
  validateCanonicalPrivateInventory,
} from '../browser-relay-edge/inventory.mjs';
import {
  CANONICAL_RUNTIME_SHA256,
  CONTROL_PLANE_URI,
  DEPLOYED_REPOSITORY_COMMIT,
  DEPLOYED_SOURCE_SHA256,
  EDGE_PROFILE,
  EDGE_RUNTIME_SHA256,
  FUNCTION_NAME,
  RUN_SERVICE_NAME,
  runtimeBytes,
  runtimeDigest,
  runtimeJson,
  runtimeProfile,
} from '../browser-relay-edge/runtime.mjs';
import {
  StagingBrowserRelayEdgeWindowError,
  rollbackEdgeToCanonical,
  runBoundedEdgeWindow,
  transitionEdgeToPublic,
} from '../browser-relay-edge/window.mjs';

const UPDATE_TIMES = Object.freeze([
  '2026-09-05T19:48:55.366699112Z',
  '2026-09-05T20:00:01.000000001Z',
  '2026-09-05T20:00:02.000000001Z',
  '2026-09-05T20:00:03.000000001Z',
]);

function functionFixture(options = {}) {
  const profile = options.profile ?? 'canonical';
  const ingress = options.ingress ?? 'ALLOW_INTERNAL_ONLY';
  const revision = options.revision ?? 'control-plane-00010-vop';
  const updateTime = options.updateTime ?? UPDATE_TIMES[0];
  return {
    name: FUNCTION_NAME,
    state: 'ACTIVE',
    environment: 'GEN_2',
    description: 'Private Miakapp V4 staging control plane.',
    labels: {
      environment: 'staging',
      'goog-terraform-provisioned': 'true',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
    },
    buildConfig: {
      runtime: 'nodejs22',
      entryPoint: 'controlPlane',
      dockerRepository:
        'projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane',
      serviceAccount:
        'projects/miakapp-v4-staging/serviceAccounts/miakapp-control-build@miakapp-v4-staging.iam.gserviceaccount.com',
      source: {
        storageSource: {
          bucket: 'gcf-v2-sources-1072737219170-europe-west9',
          object: 'control-plane/function-source.zip',
          generation: '1788637681094791',
        },
      },
    },
    serviceConfig: {
      service: RUN_SERVICE_NAME,
      uri: CONTROL_PLANE_URI,
      revision,
      ingressSettings: ingress,
      maxInstanceCount: 1,
      maxInstanceRequestConcurrency: 16,
      timeoutSeconds: 30,
      availableMemory: '256M',
      availableCpu: '1',
      allTrafficOnLatestRevision: true,
      serviceAccountEmail:
        'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
      environmentVariables: {
        LOG_EXECUTION_ID: 'true',
        MIAKAPP_DEPLOYMENT_COMMIT: DEPLOYED_REPOSITORY_COMMIT,
        MIAKAPP_RUNTIME_CONFIG_JSON: runtimeJson(profile),
        MIAKAPP_SOURCE_ARCHIVE_SHA256: DEPLOYED_SOURCE_SHA256,
      },
    },
    updateTime,
  };
}

function policyFixture(publicInvoker = false, etag = 'BwZanS3TQAE=') {
  return {
    version: 1,
    etag,
    bindings: [{
      role: 'roles/run.invoker',
      members: publicInvoker ? ['allUsers', PROBE_PRINCIPAL] : [PROBE_PRINCIPAL],
    }],
  };
}

function inventory(options = {}) {
  return normalizeEdgeInventory(
    functionFixture(options),
    policyFixture(options.publicInvoker, options.etag),
  );
}

function nextInventory(value, change = {}) {
  const profile = change.profile ?? value.function.runtime_profile;
  const ingress = change.ingress ?? value.function.ingress;
  const publicInvoker = change.publicInvoker ?? value.iam.unauthenticated_invokers === 1;
  const revisionNumber = Number(value.function.revision.slice(14, 19)) + 1;
  return inventory({
    profile,
    ingress,
    publicInvoker,
    revision: change.functionChanged === false
      ? value.function.revision
      : `control-plane-${String(revisionNumber).padStart(5, '0')}-tst`,
    updateTime: change.functionChanged === false
      ? value.function.update_time
      : UPDATE_TIMES[Math.min(revisionNumber - 10, UPDATE_TIMES.length - 1)],
    etag: change.iamChanged ? 'BwZanS3TQAI=' : value.iam.etag,
  });
}

function mockClient(initial, options = {}) {
  let current = initial;
  const calls = [];
  let ambiguousRemoval = options.ambiguousRemoval === true;
  let failedRemoval = options.failedRemoval === true;
  let ambiguousAddition = options.ambiguousAddition === true;
  let observationFailures = options.observationFailures ?? 0;
  return {
    calls,
    current: () => current,
    async observe() {
      calls.push('observe');
      if (observationFailures > 0) {
        observationFailures -= 1;
        throw new Error('simulated combined inventory outage');
      }
      return current;
    },
    async setRuntimeProfile(expected, profile) {
      assert.deepEqual(expected, current);
      calls.push(`runtime:${profile}`);
      current = nextInventory(current, { profile });
      return current;
    },
    async setIngress(expected, ingress) {
      assert.deepEqual(expected, current);
      calls.push(`ingress:${ingress}`);
      current = nextInventory(current, { ingress });
      return current;
    },
    async setPublicInvoker(expected, enabled) {
      assert.deepEqual(expected, current);
      calls.push(`iam:${enabled ? 'public' : 'private'}`);
      if (!enabled && failedRemoval) {
        failedRemoval = false;
        throw new Error('simulated failed removal before mutation');
      }
      current = nextInventory(current, {
        publicInvoker: enabled,
        functionChanged: false,
        iamChanged: true,
      });
      if (!enabled && ambiguousRemoval) {
        ambiguousRemoval = false;
        throw new Error('simulated ambiguous response after convergence');
      }
      if (enabled && ambiguousAddition) {
        ambiguousAddition = false;
        throw new Error('simulated ambiguous addition after convergence');
      }
      return current;
    },
    async closeIngress() {
      calls.push('emergency-ingress:private');
      if (current.function.ingress === 'ALLOW_ALL') {
        current = nextInventory(current, { ingress: 'ALLOW_INTERNAL_ONLY' });
      }
      return current.function;
    },
  };
}

test('pins canonical and edge runtime bytes that differ only by issuer and origin', () => {
  assert.equal(runtimeDigest('canonical'), CANONICAL_RUNTIME_SHA256);
  assert.equal(runtimeDigest(EDGE_PROFILE), EDGE_RUNTIME_SHA256);
  assert.equal(runtimeProfile(runtimeJson('canonical')), 'canonical');
  assert.equal(runtimeProfile(runtimeJson(EDGE_PROFILE)), EDGE_PROFILE);
  const canonical = JSON.parse(runtimeBytes('canonical'));
  const edge = JSON.parse(runtimeBytes(EDGE_PROFILE));
  assert.equal(edge.security.issuer, CONTROL_PLANE_URI);
  assert.deepEqual(edge.allowed_origins, ['https://miakapp-v4-staging.web.app']);
  edge.security.issuer = canonical.security.issuer;
  edge.allowed_origins = canonical.allowed_origins;
  assert.deepEqual(edge, canonical);
  assert.throws(() => runtimeProfile(`${runtimeJson('canonical')} `), /reviewed network profile/u);
});

test('normalizes only the exact private, ingress-ready and public edge states', () => {
  assert.equal(validateCanonicalPrivateInventory(inventory()).state, 'canonical_private');
  assert.equal(inventory({ profile: EDGE_PROFILE }).state, 'edge_private');
  assert.equal(inventory({ profile: EDGE_PROFILE, ingress: 'ALLOW_ALL' }).state, 'edge_ingress_ready');
  assert.equal(inventory({
    profile: EDGE_PROFILE,
    ingress: 'ALLOW_ALL',
    publicInvoker: true,
  }).state, 'edge_public');
  assert.equal(inventory({ publicInvoker: true }).state, 'recoverable_partial');
  assert.equal(classifyEdgeInventory(inventory()), 'canonical_private');
});

test('rejects source, runtime, scale, IAM and identity drift', () => {
  const source = functionFixture();
  source.serviceConfig.environmentVariables.MIAKAPP_SOURCE_ARCHIVE_SHA256 = '0'.repeat(64);
  assert.throws(
    () => normalizeEdgeInventory(source, policyFixture()),
    StagingBrowserRelayEdgeInventoryError,
  );
  const runtime = functionFixture();
  runtime.serviceConfig.environmentVariables.MIAKAPP_RUNTIME_CONFIG_JSON = '{}\n';
  assert.throws(() => normalizeEdgeInventory(runtime, policyFixture()), /network profile/u);
  const scaled = functionFixture();
  scaled.serviceConfig.minInstanceCount = 1;
  assert.throws(() => normalizeEdgeInventory(scaled, policyFixture()), /edge boundary/u);
  const publicGroup = policyFixture();
  publicGroup.bindings[0].members.push('allAuthenticatedUsers');
  assert.throws(() => normalizeEdgeInventory(functionFixture(), publicGroup), /principals/u);
  const foreignRole = policyFixture();
  foreignRole.bindings.push({ role: 'roles/viewer', members: [PROBE_PRINCIPAL] });
  assert.throws(() => normalizeEdgeInventory(functionFixture(), foreignRole), /IAM policy/u);
});

test('builds separate exact Function patches and an etag-bound IAM policy', () => {
  const profile = buildFunctionProfilePatch(EDGE_PROFILE);
  const profileUrl = new URL(profile.url);
  assert.equal(profile.method, 'PATCH');
  assert.equal(profileUrl.searchParams.get('updateMask'), 'serviceConfig.environmentVariables');
  const profileBody = JSON.parse(profile.body);
  assert.equal(profileBody.name, FUNCTION_NAME);
  assert.equal(
    profileBody.serviceConfig.environmentVariables.MIAKAPP_RUNTIME_CONFIG_JSON,
    runtimeJson(EDGE_PROFILE),
  );
  assert.equal('ingressSettings' in profileBody.serviceConfig, false);

  const ingress = buildFunctionIngressPatch('ALLOW_ALL');
  assert.equal(new URL(ingress.url).searchParams.get('updateMask'), 'serviceConfig.ingressSettings');
  assert.deepEqual(JSON.parse(ingress.body), {
    name: FUNCTION_NAME,
    serviceConfig: { ingressSettings: 'ALLOW_ALL' },
  });
  assert.throws(() => buildFunctionIngressPatch('ALLOW_INTERNAL_AND_GCLB'), /invalid/u);

  const baseline = inventory();
  const publicPatch = buildIamPatch(baseline.iam, true);
  const publicBody = JSON.parse(publicPatch.body);
  assert.equal(publicBody.updateMask, 'bindings,etag');
  assert.equal(publicBody.policy.etag, baseline.iam.etag);
  assert.deepEqual(publicBody.policy.bindings[0].members, ['allUsers', PROBE_PRINCIPAL]);
  assert.deepEqual(
    policyForPublicInvoker(publicBody.policy, false).bindings[0].members,
    [PROBE_PRINCIPAL],
  );
});

test('observes and applies one Function profile patch through the exact REST boundary', async () => {
  let profile = 'canonical';
  let revision = 'control-plane-00010-vop';
  let updateTime = UPDATE_TIMES[0];
  let pendingProfile = null;
  const requests = [];
  const operationName = 'projects/miakapp-v4-staging/locations/europe-west9/operations/test-operation';
  const response = (value) => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const fetchImplementation = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes(':getIamPolicy')) return response(policyFixture());
    if (String(url) === `https://cloudfunctions.googleapis.com/v2/${operationName}`) {
      profile = pendingProfile;
      revision = 'control-plane-00011-tst';
      updateTime = UPDATE_TIMES[1];
      return response({ name: operationName, done: true, response: { name: FUNCTION_NAME } });
    }
    if (String(url).startsWith(`https://cloudfunctions.googleapis.com/v2/${FUNCTION_NAME}?`)) {
      const body = JSON.parse(options.body);
      pendingProfile = runtimeProfile(
        body.serviceConfig.environmentVariables.MIAKAPP_RUNTIME_CONFIG_JSON,
      );
      return response({ name: operationName, done: false });
    }
    if (String(url) === `https://cloudfunctions.googleapis.com/v2/${FUNCTION_NAME}`) {
      return response(functionFixture({ profile, revision, updateTime }));
    }
    throw new Error('unexpected test request');
  };
  const client = createGoogleEdgeClient(
    { accessToken: 'test-ephemeral-access-token-value' },
    { fetchImplementation, sleep: async () => {} },
  );
  const baseline = await client.observe();
  const result = await client.setRuntimeProfile(baseline, EDGE_PROFILE);
  assert.equal(result.state, 'edge_private');
  assert.equal(result.function.revision, 'control-plane-00011-tst');
  const patch = requests.find(({ options }) => options.method === 'PATCH');
  assert.equal(new URL(patch.url).searchParams.get('updateMask'), 'serviceConfig.environmentVariables');
  assert.match(patch.options.headers.Authorization, /^Bearer test-/u);
  assert.equal(requests.filter(({ url }) => url === `https://cloudfunctions.googleapis.com/v2/${operationName}`).length, 1);
});

test('transitions in profile, ingress, IAM order and rolls back in reverse safety order', async () => {
  const baseline = inventory();
  const client = mockClient(baseline);
  const transition = await transitionEdgeToPublic(client, baseline, { clock: () => 1_000 });
  assert.equal(transition.public_state.state, 'edge_public');
  assert.deepEqual(client.calls, [
    'observe',
    `runtime:${EDGE_PROFILE}`,
    'ingress:ALLOW_ALL',
    'iam:public',
  ]);
  client.calls.length = 0;
  const rollback = await rollbackEdgeToCanonical(client, baseline);
  assert.equal(rollback.state, 'canonical_private');
  assert.deepEqual(client.calls, [
    'observe',
    'iam:private',
    'ingress:ALLOW_INTERNAL_ONLY',
    'runtime:canonical',
    'observe',
  ]);
});

test('rejects static source drift before the first edge mutation', async () => {
  const baseline = inventory();
  const driftedFunction = functionFixture();
  driftedFunction.buildConfig.source.storageSource.generation = '1788637681094792';
  const client = mockClient(normalizeEdgeInventory(driftedFunction, policyFixture()));
  await assert.rejects(
    transitionEdgeToPublic(client, baseline),
    StagingBrowserRelayEdgeInventoryError,
  );
  assert.deepEqual(client.calls, ['observe']);
  assert.equal(client.current().state, 'canonical_private');
});

test('reconciles an ambiguous public-IAM removal before restoring the canonical runtime', async () => {
  const baseline = inventory();
  const client = mockClient(inventory({
    profile: EDGE_PROFILE,
    ingress: 'ALLOW_ALL',
    publicInvoker: true,
  }), { ambiguousRemoval: true });
  const result = await rollbackEdgeToCanonical(client, baseline);
  assert.deepEqual(result.reconciled_failures, ['public-invoker-removal-first-pass']);
  assert.equal(client.current().state, 'canonical_private');
  assert.deepEqual(client.calls, [
    'observe',
    'iam:private',
    'observe',
    'ingress:ALLOW_INTERNAL_ONLY',
    'runtime:canonical',
    'observe',
  ]);
});

test('closes ingress before a second IAM-removal pass when the first removal fails', async () => {
  const baseline = inventory();
  const client = mockClient(inventory({
    profile: EDGE_PROFILE,
    ingress: 'ALLOW_ALL',
    publicInvoker: true,
  }), { failedRemoval: true });
  const result = await rollbackEdgeToCanonical(client, baseline);
  assert.deepEqual(result.reconciled_failures, ['public-invoker-removal-first-pass']);
  assert.equal(client.current().state, 'canonical_private');
  assert.deepEqual(client.calls, [
    'observe',
    'iam:private',
    'observe',
    'ingress:ALLOW_INTERNAL_ONLY',
    'iam:private',
    'runtime:canonical',
    'observe',
  ]);
});

test('an ambiguous final opening step enters rollback without running the callback', async () => {
  const baseline = inventory();
  const client = mockClient(baseline, { ambiguousAddition: true });
  let callbackRan = false;
  await assert.rejects(
    runBoundedEdgeWindow(client, baseline, async () => { callbackRan = true; }),
    (error) => error instanceof StagingBrowserRelayEdgeWindowError
      && /transition failed.*rollback restored/u.test(error.message),
  );
  assert.equal(callbackRan, false);
  assert.equal(client.current().state, 'canonical_private');
});

test('an inventory outage invokes the IAM-independent emergency ingress closure', async () => {
  const baseline = inventory();
  const client = mockClient(inventory({
    profile: EDGE_PROFILE,
    ingress: 'ALLOW_ALL',
    publicInvoker: true,
  }), { observationFailures: 3 });
  const result = await rollbackEdgeToCanonical(client, baseline, { sleep: async () => {} });
  assert.equal(result.state, 'canonical_private');
  assert.deepEqual(result.reconciled_failures, [
    'initial-inventory-observation',
    'emergency-private-ingress',
  ]);
  assert.deepEqual(client.calls.slice(0, 5), [
    'observe',
    'observe',
    'observe',
    'emergency-ingress:private',
    'observe',
  ]);
  assert.equal(client.current().state, 'canonical_private');
});

test('runs one bounded callback and always returns to the canonical private boundary', async () => {
  const baseline = inventory();
  const client = mockClient(baseline);
  const instants = [1_000, 1_000, 1_125];
  let timerCleared = false;
  const result = await runBoundedEdgeWindow(
    client,
    baseline,
    async ({ signal, opened_at_milliseconds: openedAt, deadline_milliseconds: deadline }) => {
      assert.equal(signal.aborted, false);
      assert.equal(openedAt, 1_000);
      assert.equal(deadline, 2_000);
    },
    {
      clock: () => instants.shift(),
      maximumPublicWindowMilliseconds: 1_000,
      setTimer: () => 17,
      clearTimer: (timer) => { timerCleared = timer === 17; },
    },
  );
  assert.equal(result.state, 'completed_canonical_private');
  assert.equal(result.public_window_milliseconds, 125);
  assert.equal(timerCleared, true);
  assert.equal(client.current().state, 'canonical_private');
});

test('deadline failure aborts the callback and still restores the canonical boundary', async () => {
  const baseline = inventory();
  const client = mockClient(baseline);
  const instants = [1_000, 1_000];
  let deadlineCallback;
  const pending = new Promise(() => {});
  const execution = runBoundedEdgeWindow(
    client,
    baseline,
    () => pending,
    {
      clock: () => instants.shift() ?? 2_000,
      maximumPublicWindowMilliseconds: 1_000,
      setTimer: (callback) => {
        deadlineCallback = callback;
        queueMicrotask(callback);
        return 19;
      },
      clearTimer: () => {},
    },
  );
  await assert.rejects(
    execution,
    (error) => error instanceof StagingBrowserRelayEdgeWindowError
      && /rollback restored/u.test(error.message),
  );
  assert.equal(typeof deadlineCallback, 'function');
  assert.equal(client.current().state, 'canonical_private');
});

test('guards the exact dormant non-executable browser-relay edge package', () => {
  const names = ['README.md', 'cloud.mjs', 'guard.mjs', 'inventory.mjs', 'runtime.mjs', 'window.mjs'];
  validateBrowserRelayEdgeRoot(new URL('../browser-relay-edge/', import.meta.url));

  const extraRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-edge-extra-'));
  for (const name of names) {
    copyFileSync(new URL(`../browser-relay-edge/${name}`, import.meta.url), join(extraRoot, name));
    chmodSync(join(extraRoot, name), 0o600);
  }
  writeFileSync(join(extraRoot, 'apply.sh'), '#!/bin/sh\n');
  assert.throws(
    () => validateBrowserRelayEdgeRoot(new URL(`file://${extraRoot}/`)),
    /reviewed file inventory/u,
  );

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-edge-symlink-'));
  for (const name of names.filter((name) => name !== 'window.mjs')) {
    copyFileSync(new URL(`../browser-relay-edge/${name}`, import.meta.url), join(symlinkRoot, name));
    chmodSync(join(symlinkRoot, name), 0o600);
  }
  symlinkSync(join(symlinkRoot, 'runtime.mjs'), join(symlinkRoot, 'window.mjs'));
  assert.throws(
    () => validateBrowserRelayEdgeRoot(new URL(`file://${symlinkRoot}/`)),
    /regular files/u,
  );
});
