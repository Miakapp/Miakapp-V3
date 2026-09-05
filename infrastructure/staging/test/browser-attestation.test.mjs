import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  CLAIM_OBJECT,
  FIREBASE_APP_ID,
  FOURTH_PRIOR_CLAIM_GENERATION,
  FOURTH_PRIOR_CLAIM_OBJECT,
  FOURTH_PRIOR_CLAIM_SHA256,
  FOURTH_PRIOR_CLAIM_SIZE_BYTES,
  HOSTING_HEADERS,
  HOSTING_ORIGIN,
  HOSTING_SITE,
  INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  PROJECT_ID,
  PROJECT_NUMBER,
  PREFLIGHT_METADATA_SHA256,
  PREFLIGHT_REPOSITORY_COMMIT,
  PREFLIGHT_V2_METADATA_SHA256,
  PREFLIGHT_V2_REPOSITORY_COMMIT,
  PREFLIGHT_V2_VERSION_NAME_SHA256,
  PREFLIGHT_V3_METADATA_SHA256,
  PREFLIGHT_V3_REPOSITORY_COMMIT,
  PREFLIGHT_V3_VERSION_NAME_SHA256,
  PREFLIGHT_V4_DEPLOY_MESSAGE,
  PREFLIGHT_V4_DEPLOY_RELEASE_NAME_SHA256,
  PREFLIGHT_V4_DEPLOY_RELEASE_TIME,
  PREFLIGHT_V4_DISABLE_MESSAGE,
  PREFLIGHT_V4_DISABLE_RELEASE_NAME_SHA256,
  PREFLIGHT_V4_DISABLE_RELEASE_TIME,
  PREFLIGHT_V4_METADATA_SHA256,
  PREFLIGHT_V4_REPOSITORY_COMMIT,
  PREFLIGHT_V4_VERSION_NAME_SHA256,
  PREFLIGHT_VERSION_NAME_SHA256,
  PRIOR_CLAIM_GENERATION,
  PRIOR_CLAIM_OBJECT,
  PRIOR_CLAIM_SHA256,
  PRIOR_CLAIM_SIZE_BYTES,
  RUNNER_PATH,
  SECOND_PRIOR_CLAIM_GENERATION,
  SECOND_PRIOR_CLAIM_OBJECT,
  SECOND_PRIOR_CLAIM_SHA256,
  SECOND_PRIOR_CLAIM_SIZE_BYTES,
  STATE_BUCKET,
  THIRD_PRIOR_CLAIM_GENERATION,
  THIRD_PRIOR_CLAIM_OBJECT,
  THIRD_PRIOR_CLAIM_SHA256,
  THIRD_PRIOR_CLAIM_SIZE_BYTES,
  attestationAuthorization,
  buildAttestationMetadata,
  canonicalJson,
  sha256,
  validateAttestationAuthorization,
  validateAttestationMetadata,
} from '../browser-attestation/contract.mjs';
import {
  buildAttestationArtifact,
  readAndVerifyArtifact,
  validatePinnedPackageVersions,
} from '../browser-attestation/artifact.mjs';
import {
  createBrowserChallenge,
  interactiveRunnerUrl,
  readBrowserAttestation,
  sanitizedBrowserResult,
  validateBrowserPreflight,
} from '../browser-attestation/browser.mjs';
import { buildOperationClaim, createOperationClaim } from '../browser-attestation/claim.mjs';
import { validateBrowserAttestationRoot } from '../browser-attestation/guard.mjs';
import {
  validatePreflightEvidence,
  validatePreflightEvidenceValue,
} from '../browser-attestation/preflight-evidence.mjs';
import {
  createHostingVersion,
  deleteHostingVersion,
  disableHostingSite,
  finalizeHostingVersion,
  hostingMessages,
  populateHostingVersion,
  releaseHostingVersion,
  waitForDisabledRunner,
  waitForRunner,
} from '../browser-attestation/hosting.mjs';
import {
  observeAttestationBaseline,
  observeOperationClaim,
} from '../browser-attestation/inventory.mjs';
import {
  buildRecoveryMetadata,
  recoveryAuthorization,
  validateInterruptedHostingInventory,
  validateRecoveryAuthorization,
  validateRecoveryMetadata,
} from '../browser-attestation/recovery.mjs';

const COMMIT = 'a'.repeat(40);
const CREATED_AT = '2026-09-05T14:00:00.000Z';
const NOW = Date.parse(CREATED_AT) + 1000;
const HASH = 'b'.repeat(64);
const VERSION = `sites/${HOSTING_SITE}/versions/${'c'.repeat(32)}`;
const RELEASE = `sites/${HOSTING_SITE}/releases/${'d'.repeat(32)}`;
const HISTORICAL_VERSION = `sites/${HOSTING_SITE}/versions/${'h'.repeat(32)}`;
const HISTORICAL_VERSION_SHA256 = sha256(Buffer.from(HISTORICAL_VERSION));
const SECOND_HISTORICAL_VERSION = `sites/${HOSTING_SITE}/versions/${'i'.repeat(32)}`;
const SECOND_HISTORICAL_VERSION_SHA256 = sha256(Buffer.from(SECOND_HISTORICAL_VERSION));
const THIRD_HISTORICAL_VERSION = `sites/${HOSTING_SITE}/versions/${'j'.repeat(32)}`;
const THIRD_HISTORICAL_VERSION_SHA256 = sha256(Buffer.from(THIRD_HISTORICAL_VERSION));
const FOURTH_HISTORICAL_VERSION = `sites/${HOSTING_SITE}/versions/${'k'.repeat(32)}`;
const FOURTH_HISTORICAL_VERSION_SHA256 = sha256(Buffer.from(FOURTH_HISTORICAL_VERSION));
const HISTORICAL_DEPLOY_RELEASE = `sites/${HOSTING_SITE}/releases/${'l'.repeat(32)}`;
const HISTORICAL_DEPLOY_RELEASE_SHA256 = sha256(Buffer.from(HISTORICAL_DEPLOY_RELEASE));
const HISTORICAL_DISABLE_RELEASE = `sites/${HOSTING_SITE}/releases/${'m'.repeat(32)}`;
const HISTORICAL_DISABLE_RELEASE_SHA256 = sha256(Buffer.from(HISTORICAL_DISABLE_RELEASE));

function priorClaimReceipt() {
  return {
    bucket: STATE_BUCKET,
    object: PRIOR_CLAIM_OBJECT,
    generation: PRIOR_CLAIM_GENERATION,
    size_bytes: PRIOR_CLAIM_SIZE_BYTES,
    sha256: PRIOR_CLAIM_SHA256,
  };
}

function secondPriorClaimReceipt() {
  return {
    bucket: STATE_BUCKET,
    object: SECOND_PRIOR_CLAIM_OBJECT,
    generation: SECOND_PRIOR_CLAIM_GENERATION,
    size_bytes: SECOND_PRIOR_CLAIM_SIZE_BYTES,
    sha256: SECOND_PRIOR_CLAIM_SHA256,
  };
}

function thirdPriorClaimReceipt() {
  return {
    bucket: STATE_BUCKET,
    object: THIRD_PRIOR_CLAIM_OBJECT,
    generation: THIRD_PRIOR_CLAIM_GENERATION,
    size_bytes: THIRD_PRIOR_CLAIM_SIZE_BYTES,
    sha256: THIRD_PRIOR_CLAIM_SHA256,
  };
}

function fourthPriorClaimReceipt() {
  return {
    bucket: STATE_BUCKET,
    object: FOURTH_PRIOR_CLAIM_OBJECT,
    generation: FOURTH_PRIOR_CLAIM_GENERATION,
    size_bytes: FOURTH_PRIOR_CLAIM_SIZE_BYTES,
    sha256: FOURTH_PRIOR_CLAIM_SHA256,
  };
}

function priorClaims() {
  return [
    {
      value: {
        schema: 'miakapp.staging-browser-attestation-claim/1',
        operation: 'attest-browser-app-check-and-disable-hosting',
        project_id: PROJECT_ID,
        project_number: PROJECT_NUMBER,
        hosting_site: HOSTING_SITE,
        repository_commit: PREFLIGHT_REPOSITORY_COMMIT,
        metadata_sha256: PREFLIGHT_METADATA_SHA256,
        baseline_sha256: '9'.repeat(64),
        created_at: '2026-09-05T13:55:00.000Z',
        expires_at: '2026-09-05T15:55:00.000Z',
        maximum_attestation_attempts: 1,
        retry_authorized: false,
        deletion_authorized: false,
      },
      receipt: priorClaimReceipt(),
    },
    {
      value: {
        schema: 'miakapp.staging-browser-attestation-claim/2',
        operation: 'attest-browser-app-check-and-disable-hosting-v2',
        project_id: PROJECT_ID,
        project_number: PROJECT_NUMBER,
        hosting_site: HOSTING_SITE,
        repository_commit: PREFLIGHT_V2_REPOSITORY_COMMIT,
        metadata_sha256: PREFLIGHT_V2_METADATA_SHA256,
        baseline_sha256: '8'.repeat(64),
        created_at: '2026-09-05T14:13:35.396Z',
        expires_at: '2026-09-05T16:13:35.396Z',
        maximum_attestation_attempts: 1,
        retry_authorized: false,
        deletion_authorized: false,
      },
      receipt: secondPriorClaimReceipt(),
    },
    {
      value: {
        schema: 'miakapp.staging-browser-attestation-claim/3',
        operation: 'attest-browser-app-check-and-disable-hosting-v3',
        project_id: PROJECT_ID,
        project_number: PROJECT_NUMBER,
        hosting_site: HOSTING_SITE,
        repository_commit: PREFLIGHT_V3_REPOSITORY_COMMIT,
        metadata_sha256: PREFLIGHT_V3_METADATA_SHA256,
        baseline_sha256: '7'.repeat(64),
        created_at: '2026-09-05T14:26:20.582Z',
        expires_at: '2026-09-05T16:26:20.582Z',
        maximum_attestation_attempts: 1,
        retry_authorized: false,
        deletion_authorized: false,
      },
      receipt: thirdPriorClaimReceipt(),
    },
    {
      value: {
        schema: 'miakapp.staging-browser-attestation-claim/4',
        operation: 'attest-browser-app-check-and-disable-hosting-v4',
        project_id: PROJECT_ID,
        project_number: PROJECT_NUMBER,
        hosting_site: HOSTING_SITE,
        repository_commit: PREFLIGHT_V4_REPOSITORY_COMMIT,
        metadata_sha256: PREFLIGHT_V4_METADATA_SHA256,
        baseline_sha256: '6'.repeat(64),
        created_at: '2026-09-05T14:35:05.929Z',
        expires_at: '2026-09-05T16:35:05.929Z',
        maximum_attestation_attempts: 1,
        retry_authorized: false,
        deletion_authorized: false,
      },
      receipt: fourthPriorClaimReceipt(),
    },
  ];
}

function historicalVersion() {
  return {
    name: HISTORICAL_VERSION,
    status: 'DELETED',
    labels: {
      environment: 'staging',
      operation: 'browser-app-check-attestation',
      repository: PREFLIGHT_REPOSITORY_COMMIT,
    },
    file_count: null,
    version_bytes: null,
  };
}

function secondHistoricalVersion() {
  return {
    name: SECOND_HISTORICAL_VERSION,
    status: 'DELETED',
    labels: {
      environment: 'staging',
      operation: 'browser-app-check-attestation-v2',
      repository: PREFLIGHT_V2_REPOSITORY_COMMIT,
    },
    file_count: null,
    version_bytes: null,
  };
}

function thirdHistoricalVersion() {
  return {
    name: THIRD_HISTORICAL_VERSION,
    status: 'DELETED',
    labels: {
      environment: 'staging',
      operation: 'browser-app-check-attestation-v3',
      repository: PREFLIGHT_V3_REPOSITORY_COMMIT,
    },
    file_count: null,
    version_bytes: null,
  };
}

function fourthHistoricalVersion() {
  return {
    name: FOURTH_HISTORICAL_VERSION,
    status: 'DELETED',
    labels: {
      environment: 'staging',
      operation: 'browser-app-check-attestation-v4',
      repository: PREFLIGHT_V4_REPOSITORY_COMMIT,
    },
    file_count: null,
    version_bytes: null,
  };
}

function historicalReleases() {
  return [
    {
      name: HISTORICAL_DEPLOY_RELEASE,
      type: 'DEPLOY',
      version_name: FOURTH_HISTORICAL_VERSION,
      message: PREFLIGHT_V4_DEPLOY_MESSAGE,
      release_time: PREFLIGHT_V4_DEPLOY_RELEASE_TIME,
    },
    {
      name: HISTORICAL_DISABLE_RELEASE,
      type: 'SITE_DISABLE',
      version_name: null,
      message: PREFLIGHT_V4_DISABLE_MESSAGE,
      release_time: PREFLIGHT_V4_DISABLE_RELEASE_TIME,
    },
  ];
}

function retiredVersionExpectations() {
  return [
    {
      name_sha256: HISTORICAL_VERSION_SHA256,
      operation: 'browser-app-check-attestation',
      repository_commit: PREFLIGHT_REPOSITORY_COMMIT,
    },
    {
      name_sha256: SECOND_HISTORICAL_VERSION_SHA256,
      operation: 'browser-app-check-attestation-v2',
      repository_commit: PREFLIGHT_V2_REPOSITORY_COMMIT,
    },
    {
      name_sha256: THIRD_HISTORICAL_VERSION_SHA256,
      operation: 'browser-app-check-attestation-v3',
      repository_commit: PREFLIGHT_V3_REPOSITORY_COMMIT,
    },
    {
      name_sha256: FOURTH_HISTORICAL_VERSION_SHA256,
      operation: 'browser-app-check-attestation-v4',
      repository_commit: PREFLIGHT_V4_REPOSITORY_COMMIT,
    },
  ];
}

function retiredReleaseExpectations() {
  return [
    {
      name_sha256: HISTORICAL_DEPLOY_RELEASE_SHA256,
      type: 'DEPLOY',
      version_name_sha256: FOURTH_HISTORICAL_VERSION_SHA256,
      message: PREFLIGHT_V4_DEPLOY_MESSAGE,
      release_time: PREFLIGHT_V4_DEPLOY_RELEASE_TIME,
    },
    {
      name_sha256: HISTORICAL_DISABLE_RELEASE_SHA256,
      type: 'SITE_DISABLE',
      version_name_sha256: null,
      message: PREFLIGHT_V4_DISABLE_MESSAGE,
      release_time: PREFLIGHT_V4_DISABLE_RELEASE_TIME,
    },
  ];
}

function baseline() {
  return {
    hosting_site: HOSTING_SITE,
    hosting_site_type: 'DEFAULT_SITE',
    hosting_version_count: 4,
    hosting_release_count: 2,
    firebase_app_config_sha256: HASH,
    app_check_config_sha256: 'c'.repeat(64),
    app_check_enforcement_records: 0,
    debug_tokens: 0,
    operation_claim_present: false,
    prior_operation_claims: [
      {
        object: PRIOR_CLAIM_OBJECT,
        generation: PRIOR_CLAIM_GENERATION,
        size_bytes: PRIOR_CLAIM_SIZE_BYTES,
        sha256: PRIOR_CLAIM_SHA256,
      },
      {
        object: SECOND_PRIOR_CLAIM_OBJECT,
        generation: SECOND_PRIOR_CLAIM_GENERATION,
        size_bytes: SECOND_PRIOR_CLAIM_SIZE_BYTES,
        sha256: SECOND_PRIOR_CLAIM_SHA256,
      },
      {
        object: THIRD_PRIOR_CLAIM_OBJECT,
        generation: THIRD_PRIOR_CLAIM_GENERATION,
        size_bytes: THIRD_PRIOR_CLAIM_SIZE_BYTES,
        sha256: THIRD_PRIOR_CLAIM_SHA256,
      },
      {
        object: FOURTH_PRIOR_CLAIM_OBJECT,
        generation: FOURTH_PRIOR_CLAIM_GENERATION,
        size_bytes: FOURTH_PRIOR_CLAIM_SIZE_BYTES,
        sha256: FOURTH_PRIOR_CLAIM_SHA256,
      },
    ],
    retired_preflight_version_name_sha256s: [
      PREFLIGHT_VERSION_NAME_SHA256,
      PREFLIGHT_V2_VERSION_NAME_SHA256,
      PREFLIGHT_V3_VERSION_NAME_SHA256,
      PREFLIGHT_V4_VERSION_NAME_SHA256,
    ],
    retired_release_name_sha256s: [
      PREFLIGHT_V4_DEPLOY_RELEASE_NAME_SHA256,
      PREFLIGHT_V4_DISABLE_RELEASE_NAME_SHA256,
    ],
  };
}

function artifact() {
  const files = [
    {
      path: RUNNER_PATH,
      content_type: 'text/html; charset=utf-8',
      content_sha256: '1'.repeat(64),
      content_bytes: 400,
      gzip_sha256: '2'.repeat(64),
      gzip_bytes: 250,
    },
    {
      path: '/__acceptance/app-check/assets/attestation-AbCd1234.js',
      content_type: 'text/javascript; charset=utf-8',
      content_sha256: '3'.repeat(64),
      content_bytes: 10_000,
      gzip_sha256: '4'.repeat(64),
      gzip_bytes: 4000,
    },
  ];
  return {
    file_count: 2,
    files,
    total_content_bytes: 10_400,
    total_gzip_bytes: 4250,
  };
}

function metadata() {
  return buildAttestationMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    baseline: baseline(),
    firebaseConfigSha256: HASH,
    dependencyLockSha256: 'd'.repeat(64),
    artifact: artifact(),
  });
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('binds the closed attestation metadata to exact artifacts and authorization', () => {
  const plan = metadata();
  assert.equal(validateAttestationMetadata(plan, NOW), plan);
  assert.equal(plan.browser.session, 'operator-connected-interactive');
  assert.equal(plan.browser.observation_channel, 'single-tty-json-line');
  assert.equal(plan.safety.maximum_attestation_attempts, 1);
  assert.equal(plan.safety.maximum_public_window_milliseconds, MAXIMUM_PUBLIC_WINDOW_MILLISECONDS);
  assert.equal(
    plan.safety.interactive_observation_deadline_milliseconds,
    INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS,
  );
  const bytes = Buffer.from(canonicalJson(plan));
  const authorization = attestationAuthorization(bytes, COMMIT);
  assert.doesNotThrow(() => validateAttestationAuthorization(authorization, bytes, COMMIT));
  assert.throws(() => validateAttestationAuthorization(`${authorization}x`, bytes, COMMIT));
  assert.throws(() => validateAttestationAuthorization(
    authorization,
    Buffer.concat([bytes, Buffer.from(' ')]),
    COMMIT,
  ));
});

test('rejects expiry, alternate targets, extra files, enforcement and browser-channel drift', () => {
  const mutateAndReject = (mutate, at = NOW) => {
    const candidate = structuredClone(metadata());
    mutate(candidate);
    assert.throws(() => validateAttestationMetadata(candidate, at));
  };
  mutateAndReject((value) => { value.project_id = 'miakapp-3'; });
  mutateAndReject((value) => { value.hosting_site = 'miakapp-3'; });
  mutateAndReject((value) => { value.baseline.hosting_release_count = 1; });
  mutateAndReject((value) => { value.baseline.operation_claim_present = true; });
  mutateAndReject((value) => { value.baseline.prior_operation_claims[0].generation = '1'; });
  mutateAndReject((value) => {
    value.baseline.retired_preflight_version_name_sha256s[0] = '0'.repeat(64);
  });
  mutateAndReject((value) => { value.artifact.file_count = 3; });
  mutateAndReject((value) => { value.browser.session = 'operator-local-playwright'; });
  mutateAndReject((value) => { value.safety.app_check_enforcement_enabled = true; });
  mutateAndReject((value) => { value.safety.debug_provider_used = true; });
  mutateAndReject((value) => { value.safety.token_returned_to_driver = true; });
  assert.throws(() => validateAttestationMetadata(metadata(), Date.parse(metadata().expires_at)));
});

test('builds two deterministic private files without committing Firebase public values', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'miakapp-browser-attestation-test-'));
  chmodSync(directory, 0o700);
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const firebaseConfig = {
    apiKey: `AIza${'x'.repeat(35)}`,
    appId: FIREBASE_APP_ID,
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    messagingSenderId: PROJECT_NUMBER,
    projectId: PROJECT_ID,
    storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  };
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  mkdirSync(first, { mode: 0o700 });
  mkdirSync(second, { mode: 0o700 });
  const built = await buildAttestationArtifact(
    first,
    firebaseConfig,
    'public-site-key-for-bundle-test',
  );
  const repeated = await buildAttestationArtifact(
    second,
    firebaseConfig,
    'public-site-key-for-bundle-test',
  );
  assert.deepEqual(repeated, built);
  assert.equal(built.artifact.file_count, 2);
  assert.equal(built.artifact.files[0].path, RUNNER_PATH);
  assert.match(built.artifact.files[1].path, /\/assets\/attestation-[0-9A-Za-z_-]+\.js$/u);
  const verified = readAndVerifyArtifact(first, { artifact: built.artifact });
  assert.equal(verified.length, 2);
  assert.equal(verified.every(({ gzip, raw }) => gzip.length > 0 && raw.length > 0), true);
  assert.doesNotMatch(
    readFileSync(new URL('../browser-attestation/runner.mjs', import.meta.url), 'utf8'),
    /AIza|public-site-key-for-bundle-test/u,
  );
});

test('pins the exact Firebase package version without requiring Playwright', () => {
  assert.doesNotThrow(() => validatePinnedPackageVersions({
    dependencies: { firebase: '12.18.0' },
  }));
  assert.throws(() => validatePinnedPackageVersions({
    dependencies: { firebase: '^12.18.0' },
  }));
});

test('observes only the retired preflight Hosting and registered provider baseline', async () => {
  const siteKey = 'synthetic-site-key-for-inventory';
  const siteKeySha256 = sha256(Buffer.from(siteKey));
  const fetchImplementation = async (url) => {
    if (url.includes(`/projects/${PROJECT_ID}/sites/${HOSTING_SITE}`)) {
      return jsonResponse({
        name: `projects/${PROJECT_ID}/sites/${HOSTING_SITE}`,
        defaultUrl: HOSTING_ORIGIN,
        type: 'DEFAULT_SITE',
      });
    }
    if (url.includes(`sites/${HOSTING_SITE}/versions`)) {
      return jsonResponse({
        versions: [
          historicalVersion(),
          secondHistoricalVersion(),
          thirdHistoricalVersion(),
          fourthHistoricalVersion(),
        ],
      });
    }
    if (url.includes(`sites/${HOSTING_SITE}/releases`)) {
      return jsonResponse({
        releases: historicalReleases().map((release) => ({
          name: release.name,
          type: release.type,
          version: release.version_name === null ? null : { name: release.version_name },
          message: release.message,
          releaseTime: release.release_time,
        })),
      });
    }
    if (url.includes('/config')) {
      return jsonResponse({
        apiKey: `AIza${'x'.repeat(35)}`,
        appId: FIREBASE_APP_ID,
        authDomain: `${PROJECT_ID}.firebaseapp.com`,
        messagingSenderId: PROJECT_NUMBER,
        projectId: PROJECT_ID,
        storageBucket: `${PROJECT_ID}.firebasestorage.app`,
      });
    }
    if (url.includes('/storage/v1/')) return jsonResponse({ error: { code: 404 } }, 404);
    throw new Error(`Unexpected URL ${url}`);
  };
  const observed = await observeAttestationBaseline(
    { accessToken: 'test-access-token-with-enough-length' },
    {
      expectedSiteKeySha256: siteKeySha256,
      expectedRetiredVersions: retiredVersionExpectations(),
      expectedRetiredReleases: retiredReleaseExpectations(),
      fetchImplementation,
      observePriorClaims: async () => priorClaims(),
      observeKeys: async () => [{ name: `projects/${PROJECT_ID}/keys/${siteKey}` }],
      observeRegistration: async () => ({
        app_check: { site_key_sha256: siteKeySha256 },
        service_enforcement_records: 0,
        debug_tokens: 0,
      }),
    },
  );
  assert.deepEqual(observed.baseline, {
    ...baseline(),
    firebase_app_config_sha256: observed.baseline.firebase_app_config_sha256,
    app_check_config_sha256: observed.baseline.app_check_config_sha256,
    retired_preflight_version_name_sha256s: [
      HISTORICAL_VERSION_SHA256,
      SECOND_HISTORICAL_VERSION_SHA256,
      THIRD_HISTORICAL_VERSION_SHA256,
      FOURTH_HISTORICAL_VERSION_SHA256,
    ],
    retired_release_name_sha256s: [
      HISTORICAL_DEPLOY_RELEASE_SHA256,
      HISTORICAL_DISABLE_RELEASE_SHA256,
    ],
  });
  assert.equal(observed.site_key, siteKey);
  assert.equal(observed.firebase_config.apiKey.startsWith('AIza'), true);
});

test('accepts one challenge-bound interactive result and sanitizes it without the challenge', async () => {
  const tty = new PassThrough();
  tty.isTTY = true;
  assert.deepEqual(validateBrowserPreflight(tty), {
    session: 'operator-connected-interactive',
    observation_channel: 'single-tty-json-line',
  });
  const challenge = createBrowserChallenge(() => Buffer.alloc(32, 0xab));
  assert.equal(challenge, 'ab'.repeat(32));
  assert.equal(
    interactiveRunnerUrl(challenge),
    `${HOSTING_ORIGIN}${RUNNER_PATH}?challenge=${challenge}`,
  );
  const observed = {
    schema: 'miakapp.browser-app-check-attestation/2',
    state: 'passed',
    challenge,
    attestation_attempts: 1,
    token_format: 'jwt-three-segments',
    token_ttl_seconds: 3599,
    duration_milliseconds: 812,
  };
  const resultPromise = readBrowserAttestation(
    tty,
    challenge,
    NOW + 1000,
    { now: NOW },
  );
  tty.end(`${JSON.stringify(observed)}\n`);
  const result = await resultPromise;
  assert.deepEqual(result, observed);
  const sanitized = sanitizedBrowserResult(result);
  assert.equal(sanitized.challenge_sha256, sha256(Buffer.from(challenge)));
  assert.equal('challenge' in sanitized, false);
  assert.equal('token' in sanitized, false);
  assert.equal(sanitized.raw_token_returned, false);
});

test('accepts a closed failure for immediate cleanup and rejects raw token fields', async () => {
  const challenge = 'a'.repeat(64);
  const failedTty = new PassThrough();
  const failedPromise = readBrowserAttestation(
    failedTty,
    challenge,
    NOW + 1000,
    { now: NOW },
  );
  failedTty.end(`${JSON.stringify({
    schema: 'miakapp.browser-app-check-attestation/2',
    state: 'failed',
    challenge,
    attestation_attempts: 1,
    failure: 'provider-or-token-shape-rejected',
  })}\n`);
  assert.equal((await failedPromise).state, 'failed');

  const hostileTty = new PassThrough();
  const hostilePromise = readBrowserAttestation(
    hostileTty,
    challenge,
    NOW + 1000,
    { now: NOW },
  );
  hostileTty.end(`${JSON.stringify({
    schema: 'miakapp.browser-app-check-attestation/2',
    state: 'passed',
    challenge,
    attestation_attempts: 1,
    token_format: 'jwt-three-segments',
    token_ttl_seconds: 3599,
    duration_milliseconds: 812,
    token: 'must-not-return',
  })}\n`);
  await assert.rejects(hostilePromise);
  assert.throws(() => validateBrowserPreflight(new PassThrough()));
});

test('bounds the interactive channel by one line, one deadline and an abort signal', async () => {
  const challenge = 'b'.repeat(64);
  const duplicateTty = new PassThrough();
  const duplicatePromise = readBrowserAttestation(
    duplicateTty,
    challenge,
    NOW + 1000,
    { now: NOW },
  );
  const valid = JSON.stringify({
    schema: 'miakapp.browser-app-check-attestation/2',
    state: 'failed',
    challenge,
    attestation_attempts: 1,
    failure: 'provider-or-token-shape-rejected',
  });
  duplicateTty.end(`${valid}\n${valid}\n`);
  await assert.rejects(duplicatePromise);

  const interruptedTty = new PassThrough();
  const controller = new AbortController();
  const interruptedPromise = readBrowserAttestation(
    interruptedTty,
    challenge,
    NOW + 1000,
    { now: NOW, signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(interruptedPromise);

  assert.throws(() => readBrowserAttestation(
    new PassThrough(),
    challenge,
    NOW + INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS + 1,
    { now: NOW },
  ));
});

test('uses one atomic non-retry claim bound to the exact plan', async () => {
  const plan = metadata();
  const bytes = Buffer.from(canonicalJson(plan));
  const claim = buildOperationClaim(bytes, plan);
  assert.equal(claim.schema, 'miakapp.staging-browser-attestation-claim/5');
  assert.equal(claim.retry_authorized, false);
  assert.equal(claim.deletion_authorized, false);
  let body;
  const receipt = await createOperationClaim(
    { accessToken: 'test-access-token-with-enough-length' },
    bytes,
    plan,
    async (url, init) => {
      assert.match(url, /ifGenerationMatch=0/u);
      body = Buffer.from(init.body);
      return jsonResponse({
        bucket: 'miakapp-v4-staging-tfstate-1072737219170',
        name: CLAIM_OBJECT,
        generation: '123',
        size: String(body.length),
      });
    },
  );
  assert.equal(receipt.generation, '123');
  assert.equal(receipt.object, CLAIM_OBJECT);
  assert.equal(receipt.sha256, sha256(body));
  assert.equal(JSON.parse(body).metadata_sha256, sha256(bytes));
});

test('drives the exact Hosting REST lifecycle and verifies public headers', async () => {
  const session = { accessToken: 'test-access-token-with-enough-length' };
  const labels = {
    environment: 'staging',
    operation: 'browser-app-check-attestation-v5',
    repository: COMMIT,
  };
  const config = { headers: [{ glob: '**', headers: HOSTING_HEADERS }] };
  const created = await createHostingVersion(session, COMMIT, async () => jsonResponse({
    name: VERSION,
    status: 'CREATED',
    labels,
    config,
  }));
  assert.equal(created, VERSION);
  const entries = artifact().files.map((file) => ({ ...file, gzip: Buffer.from('gzip') }));
  const populated = await populateHostingVersion(session, VERSION, entries, async () => jsonResponse({
    uploadRequiredHashes: [],
    uploadUrl: `https://upload-firebasehosting.googleapis.com/upload/${VERSION}/files`,
  }));
  assert.equal(populated.file_count, 2);
  assert.equal(populated.upload_url_present, true);
  const reused = await populateHostingVersion(
    session,
    VERSION,
    entries,
    async () => jsonResponse({}),
  );
  assert.deepEqual(reused, {
    required_uploads: 0,
    upload_url_present: false,
    file_count: 2,
  });
  await assert.rejects(() => populateHostingVersion(
    session,
    VERSION,
    entries,
    async () => jsonResponse({
      uploadRequiredHashes: [entries[0].gzip_sha256],
    }),
  ));
  await assert.rejects(() => populateHostingVersion(
    session,
    VERSION,
    entries,
    async () => jsonResponse({ uploadUrl: 'https://example.invalid/upload' }),
  ));
  const finalized = await finalizeHostingVersion(
    session,
    VERSION,
    COMMIT,
    artifact(),
    async () => jsonResponse({
      name: VERSION,
      status: 'FINALIZED',
      labels,
      config,
      fileCount: '2',
      versionBytes: '5000',
    }),
  );
  assert.deepEqual(finalized, {
    file_count: '2',
    version_bytes: '5000',
    metrics_within_reviewed_bounds: true,
  });
  const asynchronousMetrics = await finalizeHostingVersion(
    session,
    VERSION,
    COMMIT,
    artifact(),
    async () => jsonResponse({
      name: VERSION,
      status: 'FINALIZED',
      labels,
      config,
      fileCount: 'pending',
      versionBytes: 'pending',
    }),
  );
  assert.deepEqual(asynchronousMetrics, {
    file_count: null,
    version_bytes: null,
    metrics_within_reviewed_bounds: false,
  });
  const deployed = await releaseHostingVersion(session, VERSION, async () => jsonResponse({
    name: RELEASE,
    type: 'DEPLOY',
    version: { name: VERSION, status: 'FINALIZED' },
    message: hostingMessages.deploy,
    releaseTime: '2026-09-05T14:01:00Z',
  }));
  assert.equal(deployed.name, RELEASE);
  const disabled = await disableHostingSite(session, async () => jsonResponse({
    name: `sites/${HOSTING_SITE}/releases/${'e'.repeat(32)}`,
    type: 'SITE_DISABLE',
    version: null,
    message: hostingMessages.disable,
    releaseTime: '2026-09-05T14:02:00Z',
  }));
  assert.match(disabled.name, /releases/u);
  await deleteHostingVersion(session, VERSION, async () => new Response(null, { status: 200 }));
  const publicBodies = new Map([
    [RUNNER_PATH, Buffer.from('index')],
    ['/__acceptance/app-check/assets/attestation-AbCd1234.js', Buffer.from('asset')],
  ]);
  const publicEntries = [...publicBodies].map(([path, bytes]) => ({
    path,
    content_type: path === RUNNER_PATH
      ? 'text/html; charset=utf-8'
      : 'text/javascript; charset=utf-8',
    content_sha256: sha256(bytes),
    content_bytes: bytes.byteLength,
  }));
  const fetchedPaths = [];
  const publicEvidence = await waitForRunner(publicEntries, async (url) => {
    const path = new URL(url).pathname;
    fetchedPaths.push(path);
    const entry = publicEntries.find((candidate) => candidate.path === path);
    return new Response(publicBodies.get(path), {
      status: 200,
      headers: { ...HOSTING_HEADERS, 'Content-Type': entry.content_type },
    });
  });
  assert.deepEqual(publicEvidence, { files_verified: 2, content_bytes_verified: 10 });
  assert.deepEqual(fetchedPaths.sort(), [...publicBodies.keys()].sort());
  await assert.rejects(() => waitForRunner(publicEntries, async (url) => {
    const path = new URL(url).pathname;
    const entry = publicEntries.find((candidate) => candidate.path === path);
    return new Response(path === RUNNER_PATH ? 'index' : 'tampered', {
      status: 200,
      headers: { ...HOSTING_HEADERS, 'Content-Type': entry.content_type },
    });
  }));
  await waitForDisabledRunner(async () => new Response('not found', { status: 404 }));
});

test('reads the immutable claim contents at the exact observed generation', async () => {
  const plan = metadata();
  const bytes = Buffer.from(canonicalJson(plan));
  const claim = buildOperationClaim(bytes, plan);
  const claimBytes = Buffer.from(canonicalJson(claim));
  const seen = [];
  const observed = await observeOperationClaim(
    { accessToken: 'test-access-token-with-enough-length' },
    async (url) => {
      seen.push(url);
      if (url.includes('/download/')) return jsonResponse(claim);
      return jsonResponse({
        bucket: STATE_BUCKET,
        name: CLAIM_OBJECT,
        generation: '456',
        size: String(claimBytes.length),
      });
    },
  );
  assert.equal(observed.receipt.generation, '456');
  assert.equal(observed.receipt.sha256, sha256(claimBytes));
  assert.deepEqual(observed.value, claim);
  assert.match(seen[1], /alt=media&generation=456/u);
});

test('binds interrupted Hosting recovery to one v5 version while retaining all history', () => {
  const plan = metadata();
  const labels = {
    environment: 'staging',
    operation: 'browser-app-check-attestation-v5',
    repository: COMMIT,
  };
  const hosting = {
    site: { site: HOSTING_SITE, type: 'DEFAULT_SITE' },
    versions: [
      historicalVersion(),
      secondHistoricalVersion(),
      thirdHistoricalVersion(),
      fourthHistoricalVersion(),
      {
        name: VERSION,
        status: 'FINALIZED',
        labels,
        file_count: '2',
        version_bytes: '5000',
      },
    ],
    releases: [
      ...historicalReleases(),
      {
        name: RELEASE,
        type: 'DEPLOY',
        version_name: VERSION,
        message: hostingMessages.deploy,
        release_time: '2026-09-05T15:01:00Z',
      },
    ],
  };
  const sourceBytes = Buffer.from(canonicalJson(plan));
  const claimBytes = Buffer.from(canonicalJson(buildOperationClaim(sourceBytes, plan)));
  const inventoryValidationOptions = {
    expectedRetiredVersions: retiredVersionExpectations(),
    expectedRetiredReleases: retiredReleaseExpectations(),
  };
  const recovery = buildRecoveryMetadata({
    repositoryCommit: COMMIT,
    sourceMetadata: plan,
    sourceMetadataBytes: sourceBytes,
    createdAt: CREATED_AT,
    claim: {
      receipt: {
        generation: '456',
        sha256: sha256(claimBytes),
      },
    },
    hostingInventory: hosting,
  }, inventoryValidationOptions);
  assert.equal(recovery.summary.site_disable_required, true);
  assert.equal(recovery.summary.delete_version, true);
  assert.equal(recovery.safety.maximum_site_disable_attempts, 1);
  assert.equal(validateRecoveryMetadata(recovery, NOW), recovery);
  const recoveryBytes = Buffer.from(canonicalJson(recovery));
  const authorization = recoveryAuthorization(recoveryBytes, COMMIT);
  assert.doesNotThrow(() => validateRecoveryAuthorization(
    authorization,
    recoveryBytes,
    COMMIT,
  ));

  const retired = structuredClone(hosting);
  retired.versions[4].status = 'DELETED';
  retired.versions[4].file_count = null;
  retired.versions[4].version_bytes = null;
  retired.releases.push({
    name: `sites/${HOSTING_SITE}/releases/${'e'.repeat(32)}`,
    type: 'SITE_DISABLE',
    version_name: null,
    message: hostingMessages.disable,
    release_time: '2026-09-05T15:02:00Z',
  });
  const retiredSummary = validateInterruptedHostingInventory(
    retired,
    plan,
    inventoryValidationOptions,
  );
  assert.equal(retiredSummary.site_disable_required, false);
  assert.equal(retiredSummary.delete_version, false);

  const unreviewed = structuredClone(hosting);
  unreviewed.versions[4].labels.repository = 'f'.repeat(40);
  assert.throws(() => validateInterruptedHostingInventory(
    unreviewed,
    plan,
    inventoryValidationOptions,
  ));
  const lostHistory = structuredClone(hosting);
  lostHistory.versions[0].labels.repository = 'f'.repeat(40);
  assert.throws(() => validateInterruptedHostingInventory(
    lostHistory,
    plan,
    inventoryValidationOptions,
  ));
  const redeployed = structuredClone(retired);
  redeployed.releases[2].release_time = '2026-09-05T15:03:00Z';
  assert.throws(() => validateInterruptedHostingInventory(
    redeployed,
    plan,
    inventoryValidationOptions,
  ));
});

test('browser-attestation root guard rejects ambient targets and unreviewed entries', () => {
  assert.doesNotThrow(() => validateBrowserAttestationRoot(
    new URL('../browser-attestation/', import.meta.url),
  ));
});

test('pins the exact sanitized result of the consumed v1 preflight', () => {
  const path = new URL('../browser-attestation/preflight-result.json', import.meta.url);
  const evidence = validatePreflightEvidence(path);
  assert.equal(evidence.state, 'consumed_before_release');
  assert.equal(evidence.hosting.releases_created, 0);
  assert.equal(evidence.app_check.browser_invocations, 0);
  assert.equal(evidence.operation_claim.object, PRIOR_CLAIM_OBJECT);
  assert.equal(evidence.operation_claim.generation, PRIOR_CLAIM_GENERATION);
  assert.equal(evidence.operation_claim.sha256, PRIOR_CLAIM_SHA256);
  assert.equal(evidence.hosting.version_name_sha256, PREFLIGHT_VERSION_NAME_SHA256);
  const tampered = structuredClone(evidence);
  tampered.hosting.site_ever_released = true;
  assert.throws(() => validatePreflightEvidenceValue(tampered));
});

test('pins the exact sanitized result of the consumed v2 preflight', () => {
  const path = new URL('../browser-attestation/preflight-v2-result.json', import.meta.url);
  const evidence = validatePreflightEvidence(path);
  assert.equal(evidence.state, 'consumed_before_release');
  assert.equal(evidence.failure_stage, 'before_hosting_release');
  assert.equal(evidence.hosting.releases_created, 0);
  assert.equal(evidence.app_check.browser_invocations, 0);
  assert.equal(evidence.operation_claim.object, SECOND_PRIOR_CLAIM_OBJECT);
  assert.equal(evidence.operation_claim.generation, SECOND_PRIOR_CLAIM_GENERATION);
  assert.equal(evidence.operation_claim.sha256, SECOND_PRIOR_CLAIM_SHA256);
  assert.equal(evidence.hosting.version_name_sha256, PREFLIGHT_V2_VERSION_NAME_SHA256);
  const tampered = structuredClone(evidence);
  tampered.hosting.finalization_proven_after_cleanup = true;
  assert.throws(() => validatePreflightEvidenceValue(tampered));
});

test('pins the exact sanitized result of the consumed v3 preflight', () => {
  const path = new URL('../browser-attestation/preflight-v3-result.json', import.meta.url);
  const evidence = validatePreflightEvidence(path);
  assert.equal(evidence.state, 'consumed_before_release');
  assert.equal(evidence.failure_stage, 'hosting_file_population');
  assert.equal(evidence.hosting.releases_created, 0);
  assert.equal(evidence.app_check.browser_invocations, 0);
  assert.equal(evidence.operation_claim.object, THIRD_PRIOR_CLAIM_OBJECT);
  assert.equal(evidence.operation_claim.generation, THIRD_PRIOR_CLAIM_GENERATION);
  assert.equal(evidence.operation_claim.sha256, THIRD_PRIOR_CLAIM_SHA256);
  assert.equal(evidence.hosting.version_name_sha256, PREFLIGHT_V3_VERSION_NAME_SHA256);
  const tampered = structuredClone(evidence);
  tampered.hosting.site_ever_released = true;
  assert.throws(() => validatePreflightEvidenceValue(tampered));
});

test('pins the exact sanitized result of the retired automated browser operation', () => {
  const path = new URL('../browser-attestation/preflight-v4-result.json', import.meta.url);
  const evidence = validatePreflightEvidence(path);
  assert.equal(evidence.state, 'attestation_failed_after_verified_publication');
  assert.equal(evidence.failure_stage, 'browser_attestation');
  assert.equal(evidence.hosting.artifact_files_verified, 2);
  assert.equal(evidence.hosting.artifact_content_bytes_verified, 40716);
  assert.equal(evidence.hosting.releases_created, 2);
  assert.equal(evidence.hosting.site_disabled, true);
  assert.equal(evidence.hosting.runner_http_status_after_cleanup, 404);
  assert.equal(evidence.app_check.automated_browser_invocations, 1);
  assert.equal(evidence.app_check.real_browser_attestation, false);
  assert.equal(evidence.app_check.enforcement_records, 0);
  assert.equal(evidence.app_check.debug_tokens, 0);
  assert.equal(evidence.retry_authorized, false);
  const tampered = structuredClone(evidence);
  tampered.app_check.real_browser_attestation = true;
  assert.throws(() => validatePreflightEvidenceValue(tampered));
});
