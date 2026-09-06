import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildRelayImageClaim,
  createRelayImageClaim,
  validateRelayImageClaim,
} from '../browser-relay-image/claim.mjs';
import {
  buildRelayImageResult,
  inspectPublishedRelayImage,
  submitRelayImageBuild,
  validateCompletedRelayImageBuild,
  waitForRelayImageBuild,
} from '../browser-relay-image/cloud.mjs';
import {
  RELAY_IMAGE_PROFILE_SHA256,
  StagingRelayImageError,
  buildCloudBuildRequest,
  canonicalJson,
  cloudBuildRequestCommitment,
  relayImageAuthorization,
  relayImageSmokeScript,
  sha256,
  validateRelayImageAuthorization,
  validateRelayImageMetadata,
  validateRelayImageProfile,
} from '../browser-relay-image/contract.mjs';
import {
  RELAY_IMAGE_FILES,
  validateRelayImageRoot,
} from '../browser-relay-image/guard.mjs';
import {
  RELAY_IMAGE_V1_PROFILE_SHA256,
  RELAY_IMAGE_V1_RESULT_SHA256,
  RELAY_IMAGE_V2_RESULT_SHA256,
  rejectRelayImageV2Replay,
  validateRelayImageV1Profile,
  validateRelayImageV1Result,
  validateRelayImageV2Result,
} from '../browser-relay-image/result.mjs';
import {
  normalizePreparedRelayImageInventory,
  observeRelayImageInventory,
  relayImageSourceReceipt,
  sameRelayImageBaseline,
  validateFinalRelayImageInventory,
  validateRelayImageBaseline,
} from '../browser-relay-image/inventory.mjs';
import { buildRelaySourceArchive } from '../browser-relay-image/source.mjs';

const rootUrl = new URL('../browser-relay-image/', import.meta.url);
const profile = validateRelayImageProfile(fileURLToPath(new URL('profile.json', rootUrl)));
const session = Object.freeze({ accessToken: 'x'.repeat(40), email: 'operator@example.invalid' });
const repositoryCommit = 'a'.repeat(40);
const sourceGeneration = profile.source.object_generation;
const sourceReceipt = Object.freeze({
  schema: 'miakapp.staging-browser-relay-image-source-receipt/2',
  bucket: profile.source.source_bucket,
  object: profile.source.source_object,
  generation: sourceGeneration,
  size_bytes: profile.source.archive_bytes,
  sha256: profile.source.archive_sha256,
  source_reused: true,
  upload_authorized: false,
  deletion_authorized: false,
  object_generation: sourceGeneration,
});

function temporaryDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'miakapp-relay-image-test-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function objectAbsence(bucket, object) {
  return { state: 'absent', bucket, object };
}

function baselineFixture() {
  return {
    schema: 'miakapp.staging-browser-relay-image-inventory/2',
    project_id: profile.project.project_id,
    project_number: profile.project.project_number,
    region: profile.project.region,
    deployed_workload: {
      schema: 'validated-workload-fixture/1',
      iam: { probe_token_role: 'roles/iam.serviceAccountOpenIdTokenCreator' },
    },
    cloud_run_services: ['control-plane'],
    relay_package: {
      state: 'present',
      name: `projects/${profile.project.project_id}/locations/${profile.project.region}`
        + `/repositories/miakapp-control-plane/packages/${profile.image.name}`,
    },
    image_tag: {
      state: 'absent',
      tag_reference: profile.image.tag_reference,
    },
    source_object: {
      state: 'present',
      bucket: profile.source.source_bucket,
      object: profile.source.source_object,
      generation: sourceGeneration,
      size_bytes: profile.source.archive_bytes,
      sha256: profile.source.archive_sha256,
    },
    prior_operation_claim: {
      state: 'present',
      bucket: profile.operation.claim_bucket,
      object: profile.recovery.v1_claim_object,
      generation: profile.recovery.v1_claim_generation,
      size_bytes: 1030,
      sha256: profile.recovery.v1_claim_sha256,
    },
    operation_claim: objectAbsence(profile.operation.claim_bucket, profile.operation.claim_object),
    prior_matching_builds: [{
      id: profile.recovery.v1_build_id,
      status: 'FAILURE',
    }],
    matching_builds: [],
    container_analysis_api: {
      service: profile.prerequisites.container_analysis_api,
      state: 'ENABLED',
    },
    container_scanning_api: {
      service: profile.prerequisites.container_scanning_api,
      state: 'DISABLED',
    },
  };
}

function metadataFixture(now = Date.now()) {
  const createdAt = new Date(now - 30_000).toISOString();
  const baseline = baselineFixture();
  return {
    schema: 'miakapp.staging-browser-relay-image-plan/2',
    operation: 'recover-private-browser-relay-image-verification',
    project_id: profile.project.project_id,
    project_number: profile.project.project_number,
    region: profile.project.region,
    repository_commit: repositoryCommit,
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + 2 * 60 * 60 * 1_000).toISOString(),
    operator_user_sha256: 'd1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c',
    profile_sha256: RELAY_IMAGE_PROFILE_SHA256,
    relay_source_commit: profile.source.commit,
    relay_source_tree: profile.source.tree,
    source_archive_sha256: profile.source.archive_sha256,
    source_archive_bytes: profile.source.archive_bytes,
    source_object_generation: profile.source.object_generation,
    v1_result_sha256: profile.contracts.v1_result_sha256,
    foundation_state_generation: profile.prerequisites.foundation_state_generation,
    container_analysis_api_enabled: true,
    container_scanning_api_enabled: false,
    source_upload_authorized: false,
    build_request_commitment_sha256: cloudBuildRequestCommitment(
      buildCloudBuildRequest(profile.source.object_generation),
    ),
    baseline_sha256: sha256(Buffer.from(canonicalJson(baseline), 'utf8')),
    baseline,
    maximum_builds: 1,
    retry_authorized: false,
    deletion_authorized: false,
    public_ingress_authorized: false,
    relay_service_creation_authorized: false,
    private_bundle_committed: false,
    credential_material_committed: false,
  };
}

function buildFixture() {
  const request = buildCloudBuildRequest(sourceGeneration);
  const builderDigest = profile.build.builder_image.split('@')[1];
  const imageDigest = `sha256:${'b'.repeat(64)}`;
  return {
    id: '12345678-1234-1234-1234-123456789abc',
    name: `projects/${profile.project.project_number}/locations/${profile.project.region}`
      + '/builds/12345678-1234-1234-1234-123456789abc',
    projectId: profile.project.project_id,
    status: 'SUCCESS',
    serviceAccount: profile.build.service_account,
    tags: [profile.build.build_tag],
    source: request.source,
    timeout: request.timeout,
    queueTtl: request.queueTtl,
    options: {
      machineType: profile.build.machine_type,
      logging: profile.build.logging,
      sourceProvenanceHash: [profile.build.source_provenance_hash],
      requestedVerifyOption: profile.build.requested_verify_option,
    },
    steps: request.steps.map((step) => ({ ...step, status: 'SUCCESS' })),
    sourceProvenance: {
      resolvedStorageSource: request.source.storageSource,
      fileHashes: {
        [`gs://${sourceReceipt.bucket}/${sourceReceipt.object}#${sourceReceipt.generation}`]: {
          fileHash: [
            {
              type: 'SHA256',
              value: `${Buffer.from(sourceReceipt.sha256, 'hex').toString('base64url')}=`,
            },
            {
              type: 'MD5',
              value: `${Buffer.alloc(16, 7).toString('base64url')}==`,
            },
          ],
        },
      },
    },
    results: {
      buildStepImages: [builderDigest, ''],
      images: [{ name: profile.image.tag_reference, digest: imageDigest }],
    },
  };
}

function buildReceiptFixture(imageDigest = `sha256:${'b'.repeat(64)}`) {
  return {
    schema: 'miakapp.staging-browser-relay-image-build-receipt/2',
    build_id: '12345678-1234-1234-1234-123456789abc',
    status: 'SUCCESS',
    source_generation: sourceGeneration,
    source_sha256: profile.source.archive_sha256,
    builder_digest: profile.build.builder_image.split('@')[1],
    image_tag_reference: profile.image.tag_reference,
    image_digest: imageDigest,
    image_digest_reference: `${profile.image.repository}/${profile.image.name}@${imageDigest}`,
    requested_verify_option: 'VERIFIED',
    source_provenance_hash: 'SHA256',
  };
}

test('pins the exact source, verified build request and bounded smoke test', () => {
  assert.equal(
    RELAY_IMAGE_PROFILE_SHA256,
    '6ab86de257a4e85d51a47d528240b3862a79120d1383bab6a9092011abd3f76b',
  );
  assert.equal(profile.source.commit, 'df10674e034f30eec80760f5ec94bc108cff026f');
  assert.equal(profile.source.archive_bytes, 53098);
  assert.equal(profile.source.object_generation, '1788648564283151');
  assert.equal(profile.operation.source_upload_authorized, false);
  assert.equal(profile.prerequisites.container_analysis_api_enabled, true);
  assert.equal(profile.prerequisites.container_scanning_api_enabled, false);
  const request = buildCloudBuildRequest(sourceGeneration);
  assert.equal(request.steps.length, 2);
  assert.equal(request.steps[0].name, profile.build.builder_image);
  assert.equal(request.steps[1].name, profile.build.builder_image);
  assert.deepEqual(request.images, [profile.image.tag_reference]);
  assert.equal(request.options.requestedVerifyOption, 'VERIFIED');
  assert.deepEqual(request.options.sourceProvenanceHash, ['SHA256']);
  assert.equal(request.serviceAccount, profile.build.service_account);
  assert.equal(cloudBuildRequestCommitment(request), cloudBuildRequestCommitment(
    buildCloudBuildRequest('999'),
  ));
  const smoke = relayImageSmokeScript();
  for (const expected of [
    '--read-only',
    '--cap-drop ALL',
    '--security-opt no-new-privileges',
    '--memory 256m',
    'MIAKAPP_MAX_CONNECTIONS=8',
    '/ping',
    "grep -Fxq 'pong'",
  ]) assert.match(smoke, new RegExp(expected.replaceAll('/', '\\/'), 'u'));
  assert.doesNotMatch(smoke, /docker push|allUsers|miakapp-3/u);
});

test('rejects profile drift, invalid source generations and credential material', () => {
  temporaryDirectory((directory) => {
    const mutated = structuredClone(profile);
    mutated.cost.maximum_incremental_eur = 5;
    const path = join(directory, 'profile.json');
    writeFileSync(path, canonicalJson(mutated));
    assert.throws(
      () => validateRelayImageProfile(path),
      (error) => error instanceof StagingRelayImageError && /digest has drifted/u.test(error.message),
    );
  });
  assert.throws(() => buildCloudBuildRequest('0'), /positive decimal/u);
  const metadata = metadataFixture();
  metadata.baseline.credential_token = 'Bearer definitely-not-allowed';
  metadata.baseline_sha256 = sha256(Buffer.from(canonicalJson(metadata.baseline), 'utf8'));
  assert.throws(() => validateRelayImageMetadata(metadata), /credential/u);
});

test('validates canonical metadata and binds authorization to its exact bytes', () => {
  const metadata = metadataFixture();
  assert.equal(validateRelayImageMetadata(metadata).schema, metadata.schema);
  const bytes = Buffer.from(canonicalJson(metadata), 'utf8');
  const authorization = relayImageAuthorization(bytes, repositoryCommit);
  validateRelayImageAuthorization(authorization, bytes, repositoryCommit);
  assert.throws(
    () => validateRelayImageAuthorization(`${authorization}x`, bytes, repositoryCommit),
    /authorization/u,
  );
  const expired = metadataFixture(Date.now() - 3 * 60 * 60 * 1_000);
  assert.throws(() => validateRelayImageMetadata(expired), /expired/u);
});

test('builds and creates one exact generation-zero operation claim', async () => {
  const metadata = metadataFixture();
  const metadataBytes = Buffer.from(canonicalJson(metadata), 'utf8');
  const attemptedAt = new Date().toISOString();
  const claim = buildRelayImageClaim(metadataBytes, metadata, attemptedAt);
  validateRelayImageClaim(claim, metadataBytes, metadata);
  let calls = 0;
  const receipt = await createRelayImageClaim(
    session,
    metadataBytes,
    metadata,
    attemptedAt,
    async (url, options) => {
      calls += 1;
      const parsed = new URL(url);
      assert.equal(options.method, 'POST');
      assert.equal(parsed.searchParams.get('ifGenerationMatch'), '0');
      assert.equal(parsed.searchParams.get('name'), profile.operation.claim_object);
      assert.deepEqual(JSON.parse(Buffer.from(options.body).toString('utf8')), claim);
      return jsonResponse({
        bucket: profile.operation.claim_bucket,
        name: profile.operation.claim_object,
        generation: '88',
        size: String(Buffer.byteLength(canonicalJson(claim))),
      });
    },
  );
  assert.equal(calls, 1);
  assert.equal(receipt.generation, '88');
  assert.equal(receipt.retry_authorized, false);
});

test('observes and validates only the exact v2 recovery baseline', async () => {
  const expected = baselineFixture();
  const fetchImplementation = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'run.googleapis.com') {
      return jsonResponse({ services: [{
        name: `projects/${profile.project.project_id}/locations/${profile.project.region}/services/control-plane`,
      }] });
    }
    if (parsed.hostname === 'artifactregistry.googleapis.com') {
      return jsonResponse({ name: expected.relay_package.name });
    }
    if (parsed.hostname === `${profile.project.region}-docker.pkg.dev`) {
      return jsonResponse({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, 404);
    }
    if (parsed.hostname === 'cloudbuild.googleapis.com') {
      return parsed.searchParams.get('filter') === 'tags=miakapp-relay-image-v1'
        ? jsonResponse({ builds: [{
          id: profile.recovery.v1_build_id,
          projectId: profile.project.project_id,
          tags: ['miakapp-relay-image-v1'],
          status: 'FAILURE',
        }] })
        : jsonResponse({});
    }
    if (parsed.hostname === 'serviceusage.googleapis.com') {
      const service = parsed.pathname.split('/').at(-1);
      return jsonResponse({
        name: `projects/${profile.project.project_number}/services/${service}`,
        config: { name: service },
        state: service === profile.prerequisites.container_analysis_api
          ? 'ENABLED'
          : 'DISABLED',
      });
    }
    throw new Error(`Unexpected inventory URL ${url}`);
  };
  const inventory = await observeRelayImageInventory(session, {
    fetchImplementation,
    observeWorkload: () => expected.deployed_workload,
    observeObject: async (_session, _bucket, object) => {
      if (object === profile.source.source_object) return expected.source_object;
      if (object === profile.recovery.v1_claim_object) return expected.prior_operation_claim;
      if (object === profile.operation.claim_object) return expected.operation_claim;
      throw new Error(`Unexpected object ${object}`);
    },
  });
  validateRelayImageBaseline(inventory);
  assert.deepEqual(inventory, expected);
  const drift = structuredClone(inventory);
  drift.cloud_run_services.push('miakapp-staging-relay-a');
  assert.throws(() => validateRelayImageBaseline(drift), /recovery state/u);
  for (const mutate of [
    (candidate) => { candidate.container_analysis_api.state = 'DISABLED'; },
    (candidate) => { candidate.container_scanning_api.state = 'ENABLED'; },
    (candidate) => { candidate.source_object.generation = '1'; },
    (candidate) => {
      candidate.image_tag = {
        state: 'present',
        tag_reference: profile.image.tag_reference,
        digest: `sha256:${'d'.repeat(64)}`,
      };
    },
    (candidate) => {
      candidate.operation_claim = {
        state: 'present',
        bucket: profile.operation.claim_bucket,
        object: profile.operation.claim_object,
        generation: '1',
        size_bytes: 1,
        sha256: 'a'.repeat(64),
      };
    },
    (candidate) => {
      candidate.matching_builds = [{
        id: '12345678-1234-1234-1234-123456789abc',
        status: 'SUCCESS',
      }];
    },
  ]) {
    const candidate = structuredClone(inventory);
    mutate(candidate);
    assert.throws(() => validateRelayImageBaseline(candidate), /recovery state/u);
  }
});

test('reuses the exact source and normalizes only the distinct v2 claim', () => {
  const baseline = baselineFixture();
  const claim = {
    bucket: profile.operation.claim_bucket,
    object: profile.operation.claim_object,
    generation: '88',
    size_bytes: 900,
    sha256: 'c'.repeat(64),
  };
  const prepared = structuredClone(baseline);
  prepared.operation_claim = { state: 'present', ...claim };
  assert.deepEqual(relayImageSourceReceipt(baseline), sourceReceipt);
  assert.ok(sameRelayImageBaseline(
    normalizePreparedRelayImageInventory(prepared, { claim, source: sourceReceipt }),
    baseline,
  ));
  const receipt = buildReceiptFixture();
  const finalInventory = structuredClone(prepared);
  finalInventory.relay_package = {
    state: 'present',
    name: baseline.relay_package.name,
  };
  finalInventory.image_tag = {
    state: 'present',
    tag_reference: profile.image.tag_reference,
    digest: receipt.image_digest,
  };
  finalInventory.matching_builds = [{ id: receipt.build_id, status: 'SUCCESS' }];
  validateFinalRelayImageInventory(finalInventory, baseline, {
    claim,
    source: sourceReceipt,
    build: receipt,
  });
  const tagDrift = structuredClone(finalInventory);
  tagDrift.image_tag.digest = `sha256:${'d'.repeat(64)}`;
  assert.throws(
    () => validateFinalRelayImageInventory(tagDrift, baseline, {
      claim,
      source: sourceReceipt,
      build: receipt,
    }),
    /unique operation/u,
  );
  finalInventory.matching_builds.push({ id: '87654321-1234-1234-1234-123456789abc', status: 'SUCCESS' });
  assert.throws(
    () => validateFinalRelayImageInventory(finalInventory, baseline, {
      claim,
      source: sourceReceipt,
      build: receipt,
    }),
    /unique operation/u,
  );
});

test('submits exactly the committed request and accepts one completed operation', async () => {
  const expectedCommitment = cloudBuildRequestCommitment(buildCloudBuildRequest(sourceGeneration));
  const operationName = `operations/build/${profile.project.project_id}/${profile.project.region}/test-operation`;
  let submissions = 0;
  const submitted = await submitRelayImageBuild(
    session,
    sourceReceipt,
    expectedCommitment,
    async (url, options) => {
      submissions += 1;
      assert.equal(
        url,
        `https://cloudbuild.googleapis.com/v1/projects/${profile.project.project_id}`
          + `/locations/${profile.project.region}/builds`,
      );
      const request = JSON.parse(Buffer.from(options.body).toString('utf8'));
      assert.deepEqual(request, buildCloudBuildRequest(sourceGeneration));
      return jsonResponse({
        name: operationName,
        metadata: { build: { id: '12345678-1234-1234-1234-123456789abc', status: 'QUEUED' } },
      });
    },
  );
  assert.equal(submissions, 1);
  const statuses = [];
  const completed = await waitForRelayImageBuild(session, submitted.operation, {
    sleep: async () => {},
    onStatus: (status) => statuses.push(status),
    fetchImplementation: async (url) => {
      assert.equal(
        url,
        `https://${profile.project.region}-cloudbuild.googleapis.com/v1/${operationName}`,
      );
      return jsonResponse({ name: operationName, done: true, response: buildFixture() });
    },
  });
  assert.deepEqual(statuses, ['QUEUED', 'SUCCESS']);
  assert.equal(completed.build.status, 'SUCCESS');
  await assert.rejects(
    () => submitRelayImageBuild(session, sourceReceipt, '0'.repeat(64), async () => {
      throw new Error('must not submit');
    }),
    /commitment/u,
  );
  await assert.rejects(
    () => submitRelayImageBuild(
      session,
      { ...sourceReceipt, upload_authorized: true },
      expectedCommitment,
      async () => { throw new Error('must not submit'); },
    ),
    /source receipt is invalid/u,
  );
});

test('requires exact source provenance, builder digests and successful smoke step', () => {
  const build = buildFixture();
  const receipt = validateCompletedRelayImageBuild(build, sourceReceipt);
  assert.equal(receipt.image_digest, `sha256:${'b'.repeat(64)}`);
  const noProvenance = structuredClone(build);
  noProvenance.sourceProvenance.fileHashes = {};
  assert.throws(
    () => validateCompletedRelayImageBuild(noProvenance, sourceReceipt),
    /provenance hash/u,
  );
  const wrongSha256 = structuredClone(build);
  wrongSha256.sourceProvenance.fileHashes[
    `gs://${sourceReceipt.bucket}/${sourceReceipt.object}#${sourceReceipt.generation}`
  ].fileHash[0].value = `${Buffer.alloc(32, 9).toString('base64url')}=`;
  assert.throws(
    () => validateCompletedRelayImageBuild(wrongSha256, sourceReceipt),
    /provenance hash/u,
  );
  const failedSmoke = structuredClone(build);
  failedSmoke.steps[1].status = 'FAILURE';
  assert.throws(
    () => validateCompletedRelayImageBuild(failedSmoke, sourceReceipt),
    /successful step/u,
  );
});

test('pins both consumed relay-image attempts and the verified v2 result', () => {
  const v1Profile = validateRelayImageV1Profile();
  const v1Result = validateRelayImageV1Result();
  const v2Result = validateRelayImageV2Result();
  assert.equal(
    RELAY_IMAGE_V1_PROFILE_SHA256,
    '2afcfc7b5f0b9fb524a59bd81cd5dcd98f73bf58c2619640b6a42bbbd0958981',
  );
  assert.equal(
    RELAY_IMAGE_V1_RESULT_SHA256,
    'c24b5cc5fe3a48a6a35365e6c404734aaf657832af8ce16c7a67c1c8e94ec1a9',
  );
  assert.equal(
    RELAY_IMAGE_V2_RESULT_SHA256,
    'dcf1ea4d63e9c7e13970d77c40dcc0ebc43215ffc6ffc3293ce28b78868e1649',
  );
  assert.equal(v1Result.build.status, 'FAILURE');
  assert.equal(v1Result.build.build_step_status, 'SUCCESS');
  assert.equal(v1Result.build.smoke_step_status, 'SUCCESS');
  assert.equal(v1Result.build.verified_provenance_created, false);
  assert.equal(v1Result.image.deployment_authorized, false);
  assert.equal(v1Result.prerequisites.container_analysis_api_enabled, false);
  assert.equal(profile.contracts.v1_profile_sha256, RELAY_IMAGE_V1_PROFILE_SHA256);
  assert.equal(profile.contracts.v1_result_sha256, RELAY_IMAGE_V1_RESULT_SHA256);
  assert.equal(v1Result.profile_sha256, RELAY_IMAGE_V1_PROFILE_SHA256);
  assert.equal(v2Result.profile_sha256, RELAY_IMAGE_PROFILE_SHA256);
  assert.equal(v2Result.build.status, 'SUCCESS');
  assert.equal(v2Result.source.object_generation, profile.source.object_generation);
  assert.equal(v2Result.recovery.source_reused, true);
  assert.equal(v2Result.recovery.source_upload_performed, false);
  assert.equal(v2Result.image.digest, v2Result.image.digest_reference.split('@')[1]);
  assert.equal(v2Result.effects.cloud_run_services_created, 0);
  assert.equal(v2Result.effects.public_ingress_created, false);
  assert.notEqual(profile.operation.claim_object, v1Profile.operation.claim_object);
  assert.notEqual(profile.build.build_tag, v1Profile.build.build_tag);
  assert.notEqual(profile.image.tag_reference, v1Profile.image.tag_reference);
  assert.throws(() => rejectRelayImageV2Replay(), /permanently retired/u);

  temporaryDirectory((directory) => {
    const path = join(directory, 'result-v2.json');
    const drifted = structuredClone(v2Result);
    drifted.effects.cloud_run_services_created = 1;
    writeFileSync(path, canonicalJson(drifted));
    assert.throws(() => validateRelayImageV2Result(path), /digest has drifted/u);
  });
});

test('permanently retires both v2 mutation entrypoints', () => {
  for (const name of ['plan.sh', 'apply.sh']) {
    const execution = spawnSync(fileURLToPath(new URL(name, rootUrl)), [], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /permanently retired/u);
    assert.equal(execution.stdout, '');
  }
});

test('validates the published manifest, config, immutable digest and size', async () => {
  const config = Buffer.from(JSON.stringify({
    architecture: profile.image.expected_architecture,
    os: profile.image.expected_os,
    config: {
      User: profile.image.expected_user,
      Entrypoint: profile.image.expected_entrypoint,
      ExposedPorts: { '3000/tcp': {} },
      Labels: profile.image.labels,
      Env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
    },
  }));
  const configDigest = `sha256:${sha256(config)}`;
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: { mediaType: 'application/vnd.docker.container.image.v1+json', digest: configDigest, size: config.byteLength },
    layers: [{ mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', digest: `sha256:${'d'.repeat(64)}`, size: 1024 }],
  }));
  const manifestDigest = `sha256:${sha256(manifest)}`;
  const buildReceipt = buildReceiptFixture(manifestDigest);
  const publication = await inspectPublishedRelayImage(
    session,
    buildReceipt,
    async (url) => {
      if (String(url).includes('/manifests/')) {
        return new Response(manifest, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json',
            'Docker-Content-Digest': manifestDigest,
          },
        });
      }
      if (String(url).includes('/blobs/')) {
        return new Response(config, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected registry URL ${url}`);
    },
  );
  assert.equal(publication.digest, manifestDigest);
  assert.equal(publication.user, '65532');
  assert.equal(publication.compressed_bytes, config.byteLength + 1024);
  const result = buildRelayImageResult({
    repositoryCommit,
    metadataSha256: 'e'.repeat(64),
    claimReceipt: { generation: '88', sha256: 'c'.repeat(64) },
    sourceReceipt,
    operationName: `operations/build/${profile.project.project_id}/${profile.project.region}/test-operation`,
    buildReceipt,
    publication,
    observedAt: new Date().toISOString(),
  });
  assert.equal(result.state, 'private_image_recovered_verified_not_deployed');
  assert.equal(result.recovery.source_reused, true);
  assert.equal(result.recovery.source_upload_performed, false);
  assert.equal(result.effects.container_analysis_enabled, true);
  assert.equal(result.effects.cloud_run_services_created, 0);
});

test('accepts only the exact relay-image source inventory and executable modes', () => {
  validateRelayImageRoot(rootUrl);
  temporaryDirectory((directory) => {
    for (const name of RELAY_IMAGE_FILES) {
      copyFileSync(new URL(name, rootUrl), join(directory, name));
      chmodSync(join(directory, name), name.endsWith('.sh') ? 0o700 : 0o600);
    }
    validateRelayImageRoot(pathToFileURL(`${directory}/`));
    writeFileSync(join(directory, 'extra.txt'), 'unexpected\n');
    assert.throws(
      () => validateRelayImageRoot(pathToFileURL(`${directory}/`)),
      /reviewed file inventory/u,
    );
  });
  temporaryDirectory((directory) => {
    for (const name of RELAY_IMAGE_FILES) {
      copyFileSync(new URL(name, rootUrl), join(directory, name));
      chmodSync(join(directory, name), name.endsWith('.sh') ? 0o700 : 0o600);
    }
    const applyPath = join(directory, 'apply.mjs');
    writeFileSync(
      applyPath,
      `${readFileSync(applyPath, 'utf8')}\n// https://storage.googleapis.com/upload/storage/v1/b/forbidden\n`,
    );
    assert.throws(
      () => validateRelayImageRoot(pathToFileURL(`${directory}/`)),
      /one-shot private boundary/u,
    );
  });
  temporaryDirectory((directory) => {
    for (const name of RELAY_IMAGE_FILES) {
      copyFileSync(new URL(name, rootUrl), join(directory, name));
      chmodSync(join(directory, name), name.endsWith('.sh') ? 0o700 : 0o600);
    }
    const planPath = join(directory, 'plan.mjs');
    writeFileSync(
      planPath,
      readFileSync(planPath, 'utf8').replace(
        'export const RELAY_IMAGE_OPERATION_CONSUMED = true',
        'export const RELAY_IMAGE_OPERATION_CONSUMED = false',
      ),
    );
    assert.throws(
      () => validateRelayImageRoot(pathToFileURL(`${directory}/`)),
      /one-shot private boundary/u,
    );
  });
  temporaryDirectory((directory) => {
    for (const name of RELAY_IMAGE_FILES) {
      copyFileSync(new URL(name, rootUrl), join(directory, name));
      chmodSync(join(directory, name), name.endsWith('.sh') ? 0o700 : 0o600);
    }
    rmSync(join(directory, 'profile.json'));
    symlinkSync(join(directory, 'README.md'), join(directory, 'profile.json'));
    assert.throws(
      () => validateRelayImageRoot(pathToFileURL(`${directory}/`)),
      /regular file/u,
    );
  });
});

test('fails closed before reading any unreviewed source repository', () => {
  assert.throws(() => buildRelaySourceArchive('relative/source'), /must be absolute/u);
  assert.throws(
    () => buildRelaySourceArchive(fileURLToPath(new URL('../../../', import.meta.url))),
    /outside the Miakapp-V3 repository/u,
  );
});
