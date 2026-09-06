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
  PROBE_PRINCIPAL,
  normalizeEdgeInventory,
} from '../browser-relay-edge/inventory.mjs';
import {
  CONTROL_PLANE_URI,
  DEPLOYED_REPOSITORY_COMMIT,
  DEPLOYED_SOURCE_SHA256,
  EDGE_PROFILE,
  FUNCTION_NAME,
  RUN_SERVICE_NAME,
  runtimeJson,
} from '../browser-relay-edge/runtime.mjs';
import {
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
  ORCHESTRATOR_IMPLEMENTATION_COMMIT,
  ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
  ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
  ORCHESTRATOR_PROFILE_SHA256,
  canonicalJson,
  rejectOrchestratorPrivateMaterial,
  sha256,
  validateBrowserRelayOrchestratorProfile,
  validateOrchestratorPreflightResult,
} from '../browser-relay-orchestrator/contract.mjs';
import {
  buildOrchestratorClaim,
  createAtomicOrchestratorClaim,
  observeOrchestratorClaimAbsent,
  orchestratorClaimAbsence,
  validateOrchestratorClaimReceipt,
} from '../browser-relay-orchestrator/claim.mjs';
import {
  StagingBrowserRelayOrchestrationError,
  runSingleUseEdgeOrchestrator,
} from '../browser-relay-orchestrator/orchestrator.mjs';
import {
  buildOrchestratorPreflightResult,
  observeOrchestratorPreflight,
} from '../browser-relay-orchestrator/preflight.mjs';
import {
  validateBrowserRelayOrchestratorRoot,
} from '../browser-relay-orchestrator/guard.mjs';
import { validateRollbackPreflightResult } from '../browser-relay-rollback/contract.mjs';

const START = Date.parse('2026-09-06T08:00:00.000Z');
const UPDATE_TIMES = Object.freeze([
  '2026-09-05T19:48:55.366699112Z',
  '2026-09-06T08:00:01.000000001Z',
  '2026-09-06T08:00:02.000000001Z',
  '2026-09-06T08:00:03.000000001Z',
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
      : `control-plane-${String(revisionNumber).padStart(5, '0')}-orc`,
    updateTime: change.functionChanged === false
      ? value.function.update_time
      : UPDATE_TIMES[Math.min(revisionNumber - 10, UPDATE_TIMES.length - 1)],
    etag: change.iamChanged
      ? (value.iam.etag === 'BwZanS3TQAE=' ? 'BwZanS3TQAI=' : 'BwZanS3TQAM=')
      : value.iam.etag,
  });
}

function mockEdgeClient(initial = inventory()) {
  let current = initial;
  const calls = [];
  return {
    calls,
    current: () => current,
    async observe() {
      calls.push('edge:observe');
      return current;
    },
    async setRuntimeProfile(expected, profile) {
      assert.deepEqual(expected, current);
      calls.push(`edge:runtime:${profile}`);
      current = nextInventory(current, { profile });
      return current;
    },
    async setIngress(expected, ingress) {
      assert.deepEqual(expected, current);
      calls.push(`edge:ingress:${ingress}`);
      current = nextInventory(current, { ingress });
      return current;
    },
    async setPublicInvoker(expected, enabled) {
      assert.deepEqual(expected, current);
      calls.push(`edge:iam:${enabled ? 'public' : 'private'}`);
      current = nextInventory(current, {
        publicInvoker: enabled,
        functionChanged: false,
        iamChanged: true,
      });
      return current;
    },
    async closeIngress() {
      calls.push('edge:emergency-private');
      if (current.function.ingress === 'ALLOW_ALL') {
        current = nextInventory(current, { ingress: 'ALLOW_INTERNAL_ONLY' });
      }
      return current.function;
    },
  };
}

function claimReceipt(attemptedAt = new Date(START).toISOString()) {
  const claim = buildOrchestratorClaim(attemptedAt);
  const bytes = Buffer.from(canonicalJson(claim), 'utf8');
  return {
    schema: ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
    bucket: ORCHESTRATOR_CLAIM_BUCKET,
    object: ORCHESTRATOR_CLAIM_OBJECT,
    generation: '1788660000000001',
    size_bytes: bytes.byteLength,
    sha256: sha256(bytes),
    repository_commit: ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
    profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    browser_relay_plan_sha256: claim.browser_relay_plan_sha256,
    attempted_at: claim.attempted_at,
    expires_at: claim.expires_at,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  };
}

test('pins the single-use orchestrator to the eight satisfied prerequisites', () => {
  const profile = validateBrowserRelayOrchestratorProfile();
  assert.equal(profile.revision, 1);
  assert.equal(profile.preflight.required_open_precondition, 'EDGE-01');
  assert.equal(profile.preflight.required_satisfied_preconditions.length, 8);
  assert.equal(profile.claim.if_generation_match, 0);
  assert.equal(profile.claim.retry_authorized, false);
  assert.equal(profile.target.cloud_mutation_authorized_by_profile, false);
});

test('pins the successful post-merge read-only preflight', () => {
  const result = validateOrchestratorPreflightResult();
  assert.equal(result.implementation_commit, ORCHESTRATOR_IMPLEMENTATION_COMMIT);
  assert.equal(result.claim_state, 'absent');
  assert.equal(result.control_plane_state, 'canonical_private');
  assert.equal(result.relay_phase, 'private_ready');
  assert.equal(result.terraform_convergence, 'no_changes');
  assert.equal(result.cloud_mutations, 0);
  assert.equal(
    ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    '5ccbbab4edcc92820dbcf09ac592fdc7c57ebc277bd5c1f8a64a5fb9422f6e9e',
  );
});

test('builds one retained claim that is not itself execution authorization', () => {
  const claim = buildOrchestratorClaim(new Date(START).toISOString());
  assert.equal(claim.repository_commit, ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT);
  assert.equal(claim.maximum_claim_creations, 1);
  assert.equal(claim.claim_precedes_first_cloud_mutation, true);
  assert.equal(claim.separate_exact_authorization_required, true);
  assert.equal(claim.profile_authorizes_execution, false);
  assert.equal(claim.retry_authorized, false);
  assert.equal(claim.deletion_authorized, false);
  assert.equal(Date.parse(claim.expires_at) - Date.parse(claim.attempted_at), 1_800_000);
  assert.throws(
    () => rejectOrchestratorPrivateMaterial({ accessToken: 'redacted' }),
    /forbidden/u,
  );
});

test('observes absence then creates the claim with generation zero and reads it back', async () => {
  const attemptedAt = new Date(START).toISOString();
  const claimBytes = Buffer.from(canonicalJson(buildOrchestratorClaim(attemptedAt)), 'utf8');
  const requests = [];
  const fetchImplementation = async (url, options) => {
    requests.push({ url: String(url), options });
    const parsed = new URL(url);
    if (options.method === 'GET' && parsed.searchParams.get('alt') !== 'media') {
      return requests.length === 1
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify({
          bucket: ORCHESTRATOR_CLAIM_BUCKET,
          name: ORCHESTRATOR_CLAIM_OBJECT,
          generation: '1788660000000001',
          size: String(claimBytes.byteLength),
        }), { status: 200 });
    }
    if (options.method === 'POST') {
      assert.deepEqual(Buffer.from(options.body), claimBytes);
      return new Response(JSON.stringify({
        bucket: ORCHESTRATOR_CLAIM_BUCKET,
        name: ORCHESTRATOR_CLAIM_OBJECT,
        generation: '1788660000000001',
        size: String(claimBytes.byteLength),
      }), { status: 200 });
    }
    if (options.method === 'GET' && parsed.searchParams.get('alt') === 'media') {
      return new Response(claimBytes, { status: 200 });
    }
    throw new Error('unexpected request');
  };
  const session = { accessToken: 'test-ephemeral-access-token-value' };
  assert.deepEqual(
    await observeOrchestratorClaimAbsent(session, fetchImplementation),
    orchestratorClaimAbsence(),
  );
  const receipt = await createAtomicOrchestratorClaim(
    session,
    attemptedAt,
    fetchImplementation,
  );
  assert.equal(receipt.generation, '1788660000000001');
  const upload = requests.find(({ options }) => options.method === 'POST');
  assert.equal(new URL(upload.url).searchParams.get('ifGenerationMatch'), '0');
  assert.equal(new URL(upload.url).searchParams.get('name'), ORCHESTRATOR_CLAIM_OBJECT);
  assert.equal(receipt.raw_contents_committed, false);
});

test('never treats an existing or ambiguous claim as permission to execute', async () => {
  const session = { accessToken: 'test-ephemeral-access-token-value' };
  await assert.rejects(
    observeOrchestratorClaimAbsent(session, async () => (
      new Response('{}', { status: 200 })
    )),
    /already exists/u,
  );
  await assert.rejects(
    createAtomicOrchestratorClaim(
      session,
      new Date(START).toISOString(),
      async () => { throw new Error('ambiguous'); },
    ),
    /stop without retry/u,
  );

  const edgeClient = mockEdgeClient();
  await assert.rejects(
    runSingleUseEdgeOrchestrator({
      acquireClaim: async () => claimReceipt(new Date(START + 1).toISOString()),
      duringWindow: async () => ({ state: 'passed' }),
      edgeClient,
      observeClaimAbsent: async () => orchestratorClaimAbsence(),
      validateAuthorization: async () => true,
      validateWindowResult: (value) => value,
    }, { clock: () => START }),
    /not bound to this attempt/u,
  );
  assert.deepEqual(edgeClient.calls, ['edge:observe']);
});

test('binds each claim receipt to the exact canonical claim bytes', () => {
  const receipt = claimReceipt();
  assert.deepEqual(validateOrchestratorClaimReceipt(receipt), receipt);
  assert.throws(
    () => validateOrchestratorClaimReceipt({ ...receipt, size_bytes: receipt.size_bytes + 1 }),
    /validity has drifted/u,
  );
  assert.throws(
    () => validateOrchestratorClaimReceipt({ ...receipt, sha256: '0'.repeat(64) }),
    /validity has drifted/u,
  );
  assert.throws(
    () => validateOrchestratorClaimReceipt({
      ...receipt,
      expires_at: new Date(Date.parse(receipt.expires_at) + 1).toISOString(),
    }),
    /validity has drifted/u,
  );
});

test('reduces the claim absence and rollback observation to a closed preflight result', () => {
  const rollback = validateRollbackPreflightResult();
  const result = buildOrchestratorPreflightResult({
    implementationCommit: 'a'.repeat(40),
    claim: orchestratorClaimAbsence(),
    rollback,
  });
  assert.equal(result.claim_state, 'absent');
  assert.equal(result.control_plane_state, 'canonical_private');
  assert.equal(result.relay_phase, 'private_ready');
  assert.equal(result.terraform_convergence, 'no_changes');
  assert.equal(result.cloud_mutations, 0);
});

test('composes only the claim observer and closed rollback observer during preflight', async () => {
  const calls = [];
  const rollback = validateRollbackPreflightResult();
  const result = await observeOrchestratorPreflight(
    { accessToken: 'test-ephemeral-access-token-value' },
    {
      clock: () => Date.parse(rollback.observed_at),
      implementationCommit: 'b'.repeat(40),
      terraformPlan: { planned_values: {} },
      fetchImplementation: async () => { throw new Error('network not expected'); },
      claimObserver: async () => {
        calls.push('claim:observe');
        return orchestratorClaimAbsence();
      },
      rollbackObserver: async (_session, options) => {
        calls.push('rollback:observe');
        assert.equal(options.implementationCommit, 'b'.repeat(40));
        return rollback;
      },
    },
  );
  assert.deepEqual(calls.sort(), ['claim:observe', 'rollback:observe']);
  assert.equal(result.implementation_commit, 'b'.repeat(40));
  assert.equal(result.acceptance_executions, 0);
});

test('acquires one claim before one edge window and verifies private postflight', async () => {
  const calls = [];
  const edgeClient = mockEdgeClient();
  const instants = [START, START + 1_000, START + 1_000, START + 1_125];
  const result = await runSingleUseEdgeOrchestrator({
    async validateAuthorization() {
      calls.push('authorization');
      return true;
    },
    async observeClaimAbsent() {
      calls.push('claim:observe');
      return orchestratorClaimAbsence();
    },
    async acquireClaim(attemptedAt) {
      calls.push('claim:create');
      return claimReceipt(attemptedAt);
    },
    edgeClient,
    async duringWindow({ signal }) {
      calls.push('callback');
      assert.equal(signal.aborted, false);
      return { schema: 'test.closed-window-result/1', state: 'passed', browsers: 3 };
    },
    validateWindowResult(value) {
      assert.deepEqual(value, {
        schema: 'test.closed-window-result/1',
        state: 'passed',
        browsers: 3,
      });
      return Object.freeze(value);
    },
  }, {
    clock: () => instants.shift(),
    maximumPublicWindowMilliseconds: 1_000,
    maximumCallbackExecutionMilliseconds: 900,
    setTimer: () => 17,
    clearTimer: () => {},
  });
  assert.equal(result.state, 'completed_once_canonical_private');
  assert.equal(result.claim_creations, 1);
  assert.equal(result.edge_window_executions, 1);
  assert.equal(result.callback_invocations, 1);
  assert.equal(result.public_window_milliseconds, 125);
  assert.equal(result.postflight_state, 'canonical_private');
  assert.deepEqual(calls, ['authorization', 'claim:observe', 'claim:create', 'callback']);
  assert.deepEqual(edgeClient.calls, [
    'edge:observe',
    'edge:observe',
    'edge:observe',
    `edge:runtime:${EDGE_PROFILE}`,
    'edge:ingress:ALLOW_ALL',
    'edge:iam:public',
    'edge:observe',
    'edge:iam:private',
    'edge:ingress:ALLOW_INTERNAL_ONLY',
    'edge:runtime:canonical',
    'edge:observe',
    'edge:observe',
  ]);
});

test('rejects authorization before claim access and closes after callback failure', async () => {
  let claimCalls = 0;
  await assert.rejects(
    runSingleUseEdgeOrchestrator({
      acquireClaim: async () => { claimCalls += 1; },
      duringWindow: async () => ({}),
      edgeClient: mockEdgeClient(),
      observeClaimAbsent: async () => { claimCalls += 1; },
      validateAuthorization: async () => false,
      validateWindowResult: (value) => value,
    }),
    StagingBrowserRelayOrchestrationError,
  );
  assert.equal(claimCalls, 0);

  const edgeClient = mockEdgeClient();
  const instants = [START, START + 1_000, START + 1_000];
  await assert.rejects(
    runSingleUseEdgeOrchestrator({
      acquireClaim: async (attemptedAt) => claimReceipt(attemptedAt),
      duringWindow: async () => { throw new Error('closed simulated failure'); },
      edgeClient,
      observeClaimAbsent: async () => orchestratorClaimAbsence(),
      validateAuthorization: async () => true,
      validateWindowResult: (value) => value,
    }, {
      clock: () => instants.shift(),
      maximumPublicWindowMilliseconds: 1_000,
      maximumCallbackExecutionMilliseconds: 900,
      setTimer: () => 19,
      clearTimer: () => {},
    }),
    /canonical-private postflight was verified/u,
  );
  assert.equal(edgeClient.current().state, 'canonical_private');
});

test('rolls back when the callback validator does not return a closed result object', async () => {
  const edgeClient = mockEdgeClient();
  const instants = [START, START + 1_000, START + 1_000];
  await assert.rejects(
    runSingleUseEdgeOrchestrator({
      acquireClaim: async (attemptedAt) => claimReceipt(attemptedAt),
      duringWindow: async () => ({ state: 'passed' }),
      edgeClient,
      observeClaimAbsent: async () => orchestratorClaimAbsence(),
      validateAuthorization: async () => true,
      validateWindowResult: () => 'not-a-closed-object',
    }, {
      clock: () => instants.shift(),
      maximumPublicWindowMilliseconds: 1_000,
      maximumCallbackExecutionMilliseconds: 900,
      setTimer: () => 23,
      clearTimer: () => {},
    }),
    /canonical-private postflight was verified/u,
  );
  assert.equal(edgeClient.current().state, 'canonical_private');
});

test('guards the exact dormant non-executable orchestrator package', () => {
  const names = [
    'README.md',
    'claim.mjs',
    'contract.mjs',
    'guard.mjs',
    'orchestrator.mjs',
    'preflight.mjs',
    'preflight-result-v1.json',
    'profile.json',
  ];
  validateBrowserRelayOrchestratorRoot(
    new URL('../browser-relay-orchestrator/', import.meta.url),
  );
  const extraRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-orchestrator-extra-'));
  for (const name of names) {
    copyFileSync(
      new URL(`../browser-relay-orchestrator/${name}`, import.meta.url),
      join(extraRoot, name),
    );
    chmodSync(join(extraRoot, name), 0o600);
  }
  writeFileSync(join(extraRoot, 'apply.sh'), '#!/bin/sh\n');
  assert.throws(
    () => validateBrowserRelayOrchestratorRoot(new URL(`file://${extraRoot}/`)),
    /reviewed file inventory/u,
  );
  const symlinkRoot = mkdtempSync(join(tmpdir(), 'miakapp-browser-relay-orchestrator-link-'));
  for (const name of names.filter((name) => name !== 'orchestrator.mjs')) {
    copyFileSync(
      new URL(`../browser-relay-orchestrator/${name}`, import.meta.url),
      join(symlinkRoot, name),
    );
    chmodSync(join(symlinkRoot, name), 0o600);
  }
  symlinkSync(join(symlinkRoot, 'preflight.mjs'), join(symlinkRoot, 'orchestrator.mjs'));
  assert.throws(
    () => validateBrowserRelayOrchestratorRoot(new URL(`file://${symlinkRoot}/`)),
    /regular files/u,
  );
});
