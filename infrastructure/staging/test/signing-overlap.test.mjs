import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ATTEMPT_CLAIM_OBJECT,
  GATE_CLAIM_OBJECT,
  KEY_NAME,
  PROJECT_ID,
  SIGNING_OVERLAP_PLAN_SHA256,
  STATE_BUCKET,
  StagingSigningOverlapError,
  VERSION_1_NAME,
  VERSION_2_NAME,
  buildKeyVersionPlanMetadata,
  canonicalJson,
  keyVersionAuthorization,
  validateKeyVersionAuthorization,
  validateKeyVersionPlanMetadata,
  validateSigningOverlapPlan,
  validateSigningOverlapPlanValue,
} from '../signing-overlap/contract.mjs';
import {
  buildSigningClaim,
  createSigningClaim,
  observeSigningClaimAbsent,
  signingClaimAbsence,
  validateSigningClaimReceipt,
} from '../signing-overlap/claim.mjs';
import { validateSigningOverlapRoot } from '../signing-overlap/guard.mjs';
import {
  validateSigningOverlapEvidence,
  validateSigningOverlapEvidenceValue,
} from '../signing-overlap/evidence.mjs';
import {
  inventorySha256,
  normalizeSigningKey,
  normalizeSigningVersion,
  publicKeyToJwk,
  validateKeyCreationBaseline,
  validateKeyCreationResult,
} from '../signing-overlap/inventory.mjs';
import { invokeKmsVersionCreation } from '../signing-overlap/key-apply.mjs';

const COMMIT = 'a'.repeat(40);
const VERSION_1_X = 'eINmaVIFYgARhSMf1pBb9yRstrT_6LfO5d12WFL5Dsw';
const VERSION_1_PEM = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAeINmaVIFYgARhSMf1pBb9yRstrT/6LfO5d12WFL5Dsw=',
  '-----END PUBLIC KEY-----',
  '',
].join('\n');
const VERSION_2_PEM = generateKeyPairSync('ed25519').publicKey.export({
  type: 'spki',
  format: 'pem',
});
const PLAN_PATH = new URL('../signing-overlap/plan.json', import.meta.url);
const PLAN_FIXTURE = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
const ROOT_FILES = [
  'README.md',
  'claim.mjs',
  'cli.mjs',
  'contract.mjs',
  'evidence.mjs',
  'guard.mjs',
  'inventory.mjs',
  'key-apply.mjs',
  'key-apply.sh',
  'key-plan.mjs',
  'key-plan.sh',
  'plan.json',
  'result.json',
];

function rawKey() {
  return {
    createTime: '2026-09-03T16:08:25.581256847Z',
    destroyScheduledDuration: '2592000s',
    labels: {
      environment: 'staging',
      'goog-terraform-provisioned': 'true',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
    },
    name: KEY_NAME,
    purpose: 'ASYMMETRIC_SIGN',
    versionTemplate: {
      algorithm: 'EC_SIGN_ED25519',
      protectionLevel: 'SOFTWARE',
    },
  };
}

function rawVersion(version) {
  return {
    algorithm: 'EC_SIGN_ED25519',
    createTime: version === 1
      ? '2026-09-03T16:08:25.581256847Z'
      : '2026-09-05T12:00:00.123456789Z',
    generateTime: version === 1
      ? '2026-09-03T16:08:25.642587918Z'
      : '2026-09-05T12:00:00.234567891Z',
    name: version === 1 ? VERSION_1_NAME : VERSION_2_NAME,
    protectionLevel: 'SOFTWARE',
    state: 'ENABLED',
  };
}

function baseline() {
  const version = normalizeSigningVersion(rawVersion(1), VERSION_1_PEM);
  return {
    schema: 'miakapp.staging-signing-overlap-inventory/1',
    project_id: PROJECT_ID,
    kms_key: normalizeSigningKey(rawKey()),
    versions: [version],
    control_plane: {
      name: `projects/${PROJECT_ID}/locations/europe-west9/functions/control-plane`,
      state: 'ACTIVE',
      revision: 'control-plane-00006-wid',
      update_time: '2026-09-05T04:59:27.070289191Z',
      uri: 'https://control-plane-example.a.run.app',
      ingress: 'ALLOW_INTERNAL_ONLY',
      unauthenticated_invokers: 0,
      deployed_repository_commit: 'e42cdd70f812580a6070f0e850daa04dbe0cee42',
      source_archive_sha256: 'd'.repeat(64),
      runtime_config_sha256: '20be750358ffbc2136bab26bca6338b430ea6480ae9874f3fe5e7132c5e0db10',
      runtime_schema: 'miakapp.production-runtime/2',
      security_schema: 'miakapp.production-security/2',
      current_kid: 'staging-access-token-v1',
      published_signing_keys: 1,
      published_jwks: [version.public_jwk],
    },
  };
}

function metadata() {
  return buildKeyVersionPlanMetadata({
    repositoryCommit: COMMIT,
    createdAt: new Date().toISOString(),
    baseline: baseline(),
  });
}

test('pins the non-retryable signing-overlap plan and bounded cost', () => {
  const value = validateSigningOverlapPlan(PLAN_PATH);
  assert.equal(value.revision, 1);
  assert.equal(value.state, 'reviewed_key_version_absent');
  assert.equal(value.mutation.transport, 'single_direct_rest_post');
  assert.equal(value.mutation.maximum_kms_version_creations, 1);
  assert.equal(value.mutation.automatic_retry, false);
  assert.equal(value.coordination.creation_precondition, 'ifGenerationMatch=0');
  assert.equal(value.rollout.prepublication_seconds, 60);
  assert.equal(value.rollout.retiring_key_retention_seconds, 330);
  assert.equal(value.cost.maximum_incremental_monthly_usd, 0.06);
  assert.match(SIGNING_OVERLAP_PLAN_SHA256, /^[0-9a-f]{64}$/u);

  const drifted = structuredClone(PLAN_FIXTURE);
  drifted.mutation.maximum_kms_version_creations = 2;
  assert.throws(
    () => validateSigningOverlapPlanValue(drifted),
    (error) => error instanceof StagingSigningOverlapError
      && /boundary|drifted/u.test(error.message),
  );
});

test('normalizes only the exact software Ed25519 key and public versions', () => {
  const key = normalizeSigningKey(rawKey());
  assert.equal(key.name, KEY_NAME);
  assert.equal(key.automatic_rotation, false);
  const first = normalizeSigningVersion(rawVersion(1), VERSION_1_PEM);
  const second = normalizeSigningVersion(rawVersion(2), VERSION_2_PEM);
  assert.equal(first.public_jwk.x, VERSION_1_X);
  assert.equal(first.public_jwk.kid, 'staging-access-token-v1');
  assert.equal(second.public_jwk.kid, 'staging-access-token-v2');
  assert.notEqual(second.public_jwk.x, first.public_jwk.x);
  assert.throws(() => publicKeyToJwk('not a key', 'staging-access-token-v2'), /public key/u);
  assert.throws(
    () => normalizeSigningVersion({ ...rawVersion(2), state: 'DISABLED' }, VERSION_2_PEM),
    /enabled software profile/u,
  );
});

test('accepts one-key baseline and exact two-key convergence only', () => {
  const before = validateKeyCreationBaseline(baseline());
  const after = structuredClone(before);
  after.versions.push(normalizeSigningVersion(rawVersion(2), VERSION_2_PEM));
  assert.equal(validateKeyCreationResult(after, before).versions.length, 2);
  assert.match(inventorySha256(after), /^[0-9a-f]{64}$/u);

  const third = structuredClone(after);
  third.versions.push({ ...third.versions[1], name: `${KEY_NAME}/cryptoKeyVersions/3`, version: 3 });
  assert.throws(() => validateKeyCreationResult(third, before), /version 2 convergence/u);
  const changedRuntime = structuredClone(after);
  changedRuntime.control_plane.current_kid = 'staging-access-token-v2';
  assert.throws(() => validateKeyCreationResult(changedRuntime, before), /version 2 convergence/u);
});

test('binds metadata and exact authorization to the baseline and commit', () => {
  const value = metadata();
  assert.equal(validateKeyVersionPlanMetadata(value).expected_created_version, VERSION_2_NAME);
  const bytes = Buffer.from(canonicalJson(value), 'utf8');
  const authorization = keyVersionAuthorization(bytes, COMMIT);
  assert.doesNotThrow(() => validateKeyVersionAuthorization(authorization, bytes, COMMIT));
  assert.throws(
    () => validateKeyVersionAuthorization(`${authorization}x`, bytes, COMMIT),
    /authorization/u,
  );
  const drifted = structuredClone(value);
  drifted.baseline.control_plane.ingress = 'ALLOW_ALL';
  assert.throws(() => validateKeyVersionPlanMetadata(drifted), /metadata/u);
});

test('observes absent claims and creates exact atomic gate and attempt claims', async () => {
  const session = { accessToken: 'synthetic-access-token-material' };
  for (const stage of ['gate', 'attempt']) {
    const absent = await observeSigningClaimAbsent(
      session,
      stage,
      async () => new Response(null, { status: 404 }),
    );
    assert.deepEqual(absent, signingClaimAbsence(stage));
  }

  const planMetadata = metadata();
  async function create(stage, gateReceipt) {
    let body;
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(url.searchParams.get('ifGenerationMatch'), '0');
        assert.equal(options.method, 'POST');
        body = Buffer.from(options.body);
        const claim = JSON.parse(body.toString('utf8'));
        assert.equal(claim.stage, stage);
        assert.equal(claim.object, stage === 'gate' ? GATE_CLAIM_OBJECT : ATTEMPT_CLAIM_OBJECT);
        return new Response(JSON.stringify({
          bucket: STATE_BUCKET,
          name: claim.object,
          generation: stage === 'gate' ? '1001' : '1002',
          size: String(body.byteLength),
        }), { status: 200 });
      }
      assert.equal(url.searchParams.get('alt'), 'media');
      return new Response(body, { status: 200 });
    };
    const receipt = await createSigningClaim(
      session,
      stage,
      planMetadata,
      gateReceipt,
      new Date().toISOString(),
      fetchImpl,
    );
    assert.equal(calls, 2);
    return receipt;
  }

  const gate = await create('gate');
  const attempt = await create('attempt', gate);
  assert.equal(attempt.gate_claim_generation, gate.generation);
  assert.equal(attempt.gate_claim_sha256, gate.sha256);
  assert.doesNotThrow(() => validateSigningClaimReceipt(gate, 'gate', planMetadata));
  assert.doesNotThrow(() => validateSigningClaimReceipt(attempt, 'attempt', planMetadata, gate));
  const attemptClaim = buildSigningClaim(
    'attempt',
    planMetadata,
    new Date().toISOString(),
    gate,
  );
  assert.equal(attemptClaim.gate_claim_generation, gate.generation);

  await assert.rejects(
    () => createSigningClaim(
      session,
      'gate',
      planMetadata,
      undefined,
      new Date().toISOString(),
      async () => new Response(null, { status: 412 }),
    ),
    /already acquired/u,
  );
});

test('guards the exact executable package inventory', () => {
  validateSigningOverlapRoot(new URL('../signing-overlap/', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'miakapp-signing-overlap-root-'));
  for (const name of ROOT_FILES) {
    copyFileSync(new URL(`../signing-overlap/${name}`, import.meta.url), join(root, name));
    chmodSync(join(root, name), name.endsWith('.sh') ? 0o700 : 0o600);
  }
  writeFileSync(join(root, 'retry.sh'), '#!/bin/sh\n');
  assert.throws(
    () => validateSigningOverlapRoot(new URL(`file://${root}/`)),
    /reviewed signing-overlap inventory/u,
  );
});

test('pins the exact sanitized version-2 convergence evidence', () => {
  const path = new URL('../signing-overlap/result.json', import.meta.url);
  const result = validateSigningOverlapEvidence(path);
  assert.equal(result.created_version.version, 2);
  assert.equal(result.created_version.public_jwk.kid, 'staging-access-token-v2');
  assert.equal(result.runtime_changed, false);
  assert.equal(result.terraform_state_changed, false);
  assert.equal(result.automatic_retry_performed, false);

  const drifted = structuredClone(result);
  drifted.kms_version_creations = 2;
  assert.throws(
    () => validateSigningOverlapEvidenceValue(drifted),
    /exact sanitized result/u,
  );
});

test('the KMS mutation is one direct non-retried REST request', async () => {
  let calls = 0;
  const result = await invokeKmsVersionCreation(
    { accessToken: 'synthetic-access-token-material' },
    async (url, options) => {
      calls += 1;
      assert.equal(
        url,
        `https://cloudkms.googleapis.com/v1/${KEY_NAME}/cryptoKeyVersions`,
      );
      assert.equal(options.method, 'POST');
      assert.equal(options.body, '{}');
      assert.equal(options.headers['X-Goog-User-Project'], PROJECT_ID);
      assert.match(options.headers.Authorization, /^Bearer /u);
      return new Response('{}', { status: 200 });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  await assert.rejects(
    () => invokeKmsVersionCreation(
      { accessToken: 'synthetic-access-token-material' },
      async () => { throw new Error('ambiguous'); },
    ),
    /must not be retried/u,
  );
});

test('consumed one-shot drivers retire before hostile environment or cloud access', () => {
  const driver = readFileSync(
    new URL('../signing-overlap/key-apply.mjs', import.meta.url),
    'utf8',
  );
  assert.equal((driver.match(/invokeKmsVersionCreation\(session\)/gu) ?? []).length, 1);
  assert.equal((driver.match(/method: 'POST'/gu) ?? []).length, 1);
  assert.match(driver, /must never be retried/u);

  for (const name of ['key-plan.mjs', 'key-apply.mjs']) {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL(`../signing-overlap/${name}`, import.meta.url)),
      tmpdir(),
    ], {
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        GOOGLE_APPLICATION_CREDENTIALS: '/tmp/forbidden.json',
        CLOUDSDK_CORE_PROJECT: 'forbidden-project',
        MIAKAPP_STAGING_SIGNING_KEY_PLAN_CONFIRMATION: PROJECT_ID,
        MIAKAPP_STAGING_SIGNING_KEY_APPLY_AUTHORIZATION: 'invalid',
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already converged.*permanently retired/u);
    assert.doesNotMatch(result.stderr, /environment override|authorization|cloud/u);
  }
});
