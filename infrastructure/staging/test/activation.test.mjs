import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FIREBASE_APP_DISPLAY_NAME,
  KMS_VERSION_NAME,
  PROJECT_DISPLAY_NAME,
  PROJECT_ID,
  PROJECT_NUMBER,
  SECRET_BINDINGS,
  activationAuthorization,
  buildActivationPlan,
  createPrivatePlanDirectory,
  deriveSecretPayload,
  normalizeCloudObservation,
  payloadMatches,
  readPrivatePlan,
  runtimeBuilderInput,
  serializePrivateJson,
  sha256,
  validateActivationAuthorization,
  validateActivationPlan,
  writePrivateJson,
} from '../activation/contract.mjs';
import {
  assertSafeActivationEnvironment,
  createActivationCloudClient,
} from '../activation/cloud.mjs';
import { materializeCloudInputs } from '../activation/apply.mjs';
import { validateActivationRoot } from '../activation/guard.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const activationRoot = new URL('../activation/', import.meta.url);
const publicPem = generateKeyPairSync('ed25519').publicKey
  .export({ format: 'pem', type: 'spki' }).toString();

function observation(mode = 'baseline') {
  const complete = mode === 'complete';
  return {
    project: {
      projectId: PROJECT_ID,
      projectNumber: PROJECT_NUMBER,
      name: PROJECT_DISPLAY_NAME,
      lifecycleState: 'ACTIVE',
    },
    firebaseApps: complete ? [{
      appId: '1:1072737219170:web:0123456789abcdef',
      displayName: FIREBASE_APP_DISPLAY_NAME,
      platform: 'WEB',
      state: 'ACTIVE',
    }] : [],
    secretVersions: Object.fromEntries(SECRET_BINDINGS.map(({ secretId }, index) => [
      secretId,
      complete ? [{
        name: `projects/${PROJECT_NUMBER}/secrets/${secretId}/versions/${index + 1}`,
        state: 'ENABLED',
      }] : [],
    ])),
    kmsVersion: {
      name: KMS_VERSION_NAME,
      state: 'ENABLED',
      algorithm: 'EC_SIGN_ED25519',
      protectionLevel: 'SOFTWARE',
    },
    kmsPublicPem: publicPem,
    functions: [],
    runServices: [],
    appEngineApplication: false,
  };
}

function plan() {
  return buildActivationPlan({
    repositoryCommit: 'a'.repeat(40),
    createdAt: '2026-09-03T20:00:00.000Z',
    toolVersions: { node: '22.22.3', gcloud: '583.0.0', firebase: '15.28.2' },
    observation: observation(),
  });
}

function materializationClient({
  seed,
  appExists = false,
  existingSecretIds = [],
  foreignSecretId,
  mutationStatus = 0,
} = {}) {
  const state = observation();
  const calls = { createApp: 0, addSecret: [], accessSecret: [] };
  const payloads = new Map();
  if (appExists) state.firebaseApps = structuredClone(observation('complete').firebaseApps);
  for (const { secretId } of SECRET_BINDINGS) {
    if (existingSecretIds.includes(secretId) || foreignSecretId === secretId) {
      state.secretVersions[secretId] = [{
        name: `projects/${PROJECT_NUMBER}/secrets/${secretId}/versions/1`,
        state: 'ENABLED',
      }];
      payloads.set(
        secretId,
        foreignSecretId === secretId
          ? Buffer.alloc(32, 255)
          : deriveSecretPayload(seed, secretId),
      );
    }
  }

  const snapshot = () => structuredClone(state);
  const client = {
    createFirebaseWebApp() {
      calls.createApp += 1;
      if (state.firebaseApps.length === 0) {
        state.firebaseApps = structuredClone(observation('complete').firebaseApps);
      }
      return { status: mutationStatus };
    },
    listFirebaseApps() {
      return structuredClone(state.firebaseApps);
    },
    listSecretVersions(secretId) {
      return structuredClone(state.secretVersions[secretId]);
    },
    addSecretVersion(secretId, payload) {
      calls.addSecret.push(secretId);
      if (state.secretVersions[secretId].length === 0) {
        state.secretVersions[secretId] = [{
          name: `projects/${PROJECT_NUMBER}/secrets/${secretId}/versions/1`,
          state: 'ENABLED',
        }];
        payloads.set(secretId, Buffer.from(payload));
      }
      return { status: mutationStatus };
    },
    accessSecretVersion(secretId, version) {
      calls.accessSecret.push({ secretId, version });
      return Buffer.from(payloads.get(secretId));
    },
    observe: snapshot,
  };
  return { calls, client, snapshot, state };
}

function mutationJournal(initialAttempts = []) {
  const attempts = new Set(initialAttempts);
  return {
    attempts,
    wasAttempted(action) {
      return attempts.has(action);
    },
    recordAttempt(action) {
      assert.equal(attempts.has(action), false);
      attempts.add(action);
    },
  };
}

test('builds a closed two-hour plan for only one app and five secret versions', () => {
  const value = plan();
  assert.equal(value.expires_at, '2026-09-03T22:00:00.000Z');
  assert.equal(value.actions.firebase_web_app.count, 1);
  assert.equal(value.actions.secret_versions.length, 5);
  assert.ok(value.actions.secret_versions.every((entry) => (
    entry.versions_to_add === 1 && entry.payload_bytes === 32 && entry.final_state === 'ENABLED'
  )));
  assert.deepEqual(value.forbidden_delta, {
    app_engine_application: true,
    cloud_function: true,
    cloud_run_service: true,
    public_ingress: true,
    minimum_instance: true,
    secret_payload_in_plan: true,
  });
  assert.doesNotMatch(JSON.stringify(value), /secret_data|private_key|payload_value/);
  assert.doesNotThrow(() => validateActivationPlan(value, {
    now: Date.parse('2026-09-03T21:00:00.000Z'),
  }));
});

test('binds authorization to exact serialized plan bytes and commit', () => {
  const bytes = Buffer.from(serializePrivateJson(plan()));
  const commit = 'a'.repeat(40);
  const authorization = activationAuthorization(bytes, commit);
  assert.equal(
    authorization,
    `materialize-staging-activation:${PROJECT_ID}:${sha256(bytes)}:${commit}`,
  );
  assert.doesNotThrow(() => validateActivationAuthorization(authorization, bytes, commit));
  assert.throws(
    () => validateActivationAuthorization(authorization, Buffer.concat([bytes, Buffer.from(' ')]), commit),
    /exact plan digest/,
  );
  assert.throws(
    () => validateActivationAuthorization(authorization, bytes, 'b'.repeat(40)),
    /exact plan digest/,
  );
});

test('rejects plan drift, expiry, alternate targets, and pre-existing material', () => {
  const mutations = [
    (value) => { value.project_id = 'miakapp-3'; },
    (value) => { value.region = 'europe-west1'; },
    (value) => { value.actions.secret_versions[0].payload_bytes = 31; },
    (value) => { value.forbidden_delta.cloud_function = false; },
    (value) => { value.unreviewed = true; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(plan());
    mutate(value);
    assert.throws(() => validateActivationPlan(value, {
      now: Date.parse('2026-09-03T21:00:00.000Z'),
    }));
  }
  assert.throws(() => validateActivationPlan(plan(), {
    now: Date.parse('2026-09-03T22:00:00.001Z'),
  }), /execution window/);

  const existingApp = observation();
  existingApp.firebaseApps.push(observation('complete').firebaseApps[0]);
  assert.throws(() => normalizeCloudObservation(existingApp, 'baseline'), /Firebase app inventory/);
  const existingSecret = observation();
  existingSecret.secretVersions['miakapp-audit-hmac'].push({
    name: `projects/${PROJECT_NUMBER}/secrets/miakapp-audit-hmac/versions/1`,
    state: 'ENABLED',
  });
  assert.throws(() => normalizeCloudObservation(existingSecret, 'baseline'), /unreviewed secret version/);
});

test('accepts only the exact partial and complete materialization envelope', () => {
  const complete = observation('complete');
  const normalized = normalizeCloudObservation(complete, 'complete');
  assert.equal(normalized.firebaseApps.length, 1);
  assert.equal(Object.keys(normalized.secretVersions).length, 5);
  assert.deepEqual(runtimeBuilderInput(complete).secret_versions, {
    homeKeyPepper: 1,
    componentHmac: 2,
    pushHmac: 3,
    auditHmac: 4,
    networkHmac: 5,
  });

  const duplicate = observation('complete');
  duplicate.secretVersions['miakapp-push-hmac'].push({
    name: `projects/${PROJECT_NUMBER}/secrets/miakapp-push-hmac/versions/9`,
    state: 'ENABLED',
  });
  assert.throws(() => normalizeCloudObservation(duplicate, 'partial'), /unreviewed secret version/);
  const workload = observation('complete');
  workload.functions.push({ name: 'foreign' });
  assert.throws(() => normalizeCloudObservation(workload, 'complete'), /must remain empty/);
});

test('derives five stable, distinct payloads and compares them without serialization', () => {
  const seed = Buffer.alloc(32, 7);
  const payloads = SECRET_BINDINGS.map(({ secretId }) => deriveSecretPayload(seed, secretId));
  assert.ok(payloads.every((payload) => payload.byteLength === 32));
  assert.equal(new Set(payloads.map((payload) => payload.toString('hex'))).size, 5);
  assert.ok(payloadMatches(payloads[0], deriveSecretPayload(seed, SECRET_BINDINGS[0].secretId)));
  assert.equal(payloadMatches(payloads[0], payloads[1]), false);
  assert.equal(payloadMatches(Buffer.alloc(31), payloads[0]), false);
});

test('materializes exactly one app and one version per secret from a fresh baseline', () => {
  const seed = Buffer.alloc(32, 11);
  const fake = materializationClient({ seed });
  const journal = mutationJournal();
  const result = materializeCloudInputs({
    client: fake.client,
    initialObservation: fake.snapshot(),
    seed,
    mutationJournal: journal,
  });

  assert.equal(fake.calls.createApp, 1);
  assert.deepEqual(fake.calls.addSecret, SECRET_BINDINGS.map(({ secretId }) => secretId));
  assert.equal(fake.calls.accessSecret.length, SECRET_BINDINGS.length);
  assert.equal(journal.attempts.size, 1 + SECRET_BINDINGS.length);
  assert.doesNotThrow(() => normalizeCloudObservation(result.observation, 'complete'));
});

test('reconciles ambiguous successful writes without issuing duplicates', () => {
  const seed = Buffer.alloc(32, 12);
  const fake = materializationClient({ seed, mutationStatus: 1 });
  const journal = mutationJournal();
  const result = materializeCloudInputs({
    client: fake.client,
    initialObservation: fake.snapshot(),
    seed,
    mutationJournal: journal,
  });

  assert.equal(fake.calls.createApp, 1);
  assert.equal(fake.calls.addSecret.length, SECRET_BINDINGS.length);
  assert.equal(fake.state.firebaseApps.length, 1);
  assert.ok(SECRET_BINDINGS.every(({ secretId }) => (
    fake.state.secretVersions[secretId].length === 1
  )));
  assert.doesNotThrow(() => normalizeCloudObservation(result.observation, 'complete'));
});

test('resumes partial materialization using the same seed and creates only missing inputs', () => {
  const seed = Buffer.alloc(32, 13);
  const existingSecretIds = SECRET_BINDINGS.slice(0, 2).map(({ secretId }) => secretId);
  const fake = materializationClient({ seed, appExists: true, existingSecretIds });
  const journal = mutationJournal([
    'firebase-web-app',
    ...existingSecretIds.map((secretId) => `secret-version:${secretId}`),
  ]);
  const result = materializeCloudInputs({
    client: fake.client,
    initialObservation: fake.snapshot(),
    seed,
    mutationJournal: journal,
  });

  assert.equal(fake.calls.createApp, 0);
  assert.deepEqual(
    fake.calls.addSecret,
    SECRET_BINDINGS.slice(2).map(({ secretId }) => secretId),
  );
  assert.equal(fake.calls.accessSecret.length, SECRET_BINDINGS.length);
  assert.doesNotThrow(() => normalizeCloudObservation(result.observation, 'complete'));
});

test('stops on a foreign existing payload without adding a second version', () => {
  const seed = Buffer.alloc(32, 14);
  const foreignSecretId = SECRET_BINDINGS[0].secretId;
  const fake = materializationClient({
    seed,
    appExists: true,
    existingSecretIds: [foreignSecretId],
    foreignSecretId,
  });
  const journal = mutationJournal();

  assert.throws(() => materializeCloudInputs({
    client: fake.client,
    initialObservation: fake.snapshot(),
    seed,
    mutationJournal: journal,
  }), /could not be reconciled to the exact private payload/);
  assert.deepEqual(fake.calls.addSecret, []);
  assert.equal(fake.state.secretVersions[foreignSecretId].length, 1);
});

test('refuses to repeat a journaled mutation that is still absent from inventory', () => {
  const seed = Buffer.alloc(32, 15);
  const fake = materializationClient({ seed });
  const journal = mutationJournal(['firebase-web-app']);

  assert.throws(() => materializeCloudInputs({
    client: fake.client,
    initialObservation: fake.snapshot(),
    seed,
    mutationJournal: journal,
  }), /prior Firebase Web app creation is not yet visible; refusing a duplicate/);
  assert.equal(fake.calls.createApp, 0);
  assert.deepEqual(fake.calls.addSecret, []);
});

test('refuses a second secret write after a journaled attempt remains invisible', () => {
  const seed = Buffer.alloc(32, 16);
  const missingSecretId = SECRET_BINDINGS[2].secretId;
  const existingSecretIds = SECRET_BINDINGS
    .slice(0, 2)
    .map(({ secretId }) => secretId);
  const fake = materializationClient({ seed, appExists: true, existingSecretIds });
  const journal = mutationJournal([
    'firebase-web-app',
    ...existingSecretIds.map((secretId) => `secret-version:${secretId}`),
    `secret-version:${missingSecretId}`,
  ]);

  assert.throws(() => materializeCloudInputs({
    client: fake.client,
    initialObservation: fake.snapshot(),
    seed,
    mutationJournal: journal,
  }), new RegExp(`prior ${missingSecretId} version creation is not yet visible`));
  assert.deepEqual(fake.calls.addSecret, []);
  assert.equal(fake.calls.accessSecret.length, existingSecretIds.length);
});

test('requires private owned paths outside the repository and a fixed source inventory', () => {
  assert.doesNotThrow(() => validateActivationRoot(activationRoot));
  const parent = mkdtempSync(join(tmpdir(), 'miakapp-activation-test-'));
  chmodSync(parent, 0o700);
  try {
    const directory = createPrivatePlanDirectory(parent, repositoryRoot);
    const path = join(directory, 'plan.json');
    writePrivateJson(path, plan(), 0o400);
    const loaded = readPrivatePlan(path, repositoryRoot, {
      now: Date.parse('2026-09-03T21:00:00.000Z'),
    });
    assert.equal(loaded.plan.project_id, PROJECT_ID);

    const link = join(parent, 'linked-plan.json');
    symlinkSync(path, link);
    assert.throws(() => readPrivatePlan(link, repositoryRoot), /symbolic link/);

    const publicParent = join(parent, 'public');
    writeFileSync(publicParent, 'not a directory', { mode: 0o600 });
    assert.throws(
      () => createPrivatePlanDirectory(publicParent, repositoryRoot),
      /wrong file type/,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('rejects credential, endpoint, proxy, and unknown activation overrides before cloud access', () => {
  const base = { HOME: '/tmp/home', PATH: '/usr/bin:/bin' };
  assert.doesNotThrow(() => assertSafeActivationEnvironment({
    ...base,
    MIAKAPP_STAGING_ACTIVATION_PLAN_CONFIRMATION: PROJECT_ID,
  }, 'MIAKAPP_STAGING_ACTIVATION_PLAN_CONFIRMATION'));
  for (const name of [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_IMPERSONATE_SERVICE_ACCOUNT',
    'CLOUDSDK_CONFIG',
    'HTTPS_PROXY',
    'FIREBASE_TOKEN',
    'MIAKAPP_UNREVIEWED',
  ]) {
    assert.throws(() => assertSafeActivationEnvironment({ ...base, [name]: 'value' }, undefined), new RegExp(name));
  }

  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../activation/plan.mjs', import.meta.url)), '/tmp'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      MIAKAPP_STAGING_ACTIVATION_PLAN_CONFIRMATION: PROJECT_ID,
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/forbidden.json',
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GOOGLE_APPLICATION_CREDENTIALS is forbidden/);
});

test('uses explicit cloud targets and passes secret material only through stdin', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-activation-cloud-test-'));
  chmodSync(temporary, 0o700);
  const calls = [];
  const payload = Buffer.alloc(32, 23);
  const response = (status, stdout = '', stderr = '') => ({
    status,
    signal: null,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
  });
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], input: options.input, env: options.env });
    if (args.includes('app') && args.includes('describe')) {
      return response(1, '', 'The project does not contain an App Engine application.');
    }
    if (args.includes('apps:list')) {
      return response(0, JSON.stringify({ status: 'success', result: [] }));
    }
    if (args.includes('apps:create')) {
      return response(0, JSON.stringify({
        status: 'success',
        result: {
          appId: '1:1072737219170:web:0123456789abcdef',
          displayName: FIREBASE_APP_DISPLAY_NAME,
          platform: 'WEB',
          state: 'ACTIVE',
        },
      }));
    }
    if (args.includes('versions') && args.includes('list')) return response(0, '[]');
    if (args.includes('versions') && args.includes('add')) return response(0, '{}');
    if (args.includes('versions') && args.includes('access')) {
      const output = args.find((argument) => argument.startsWith('--out-file='));
      assert.notEqual(output, undefined);
      writeFileSync(output.slice('--out-file='.length), payload, { mode: 0o600 });
      return response(0);
    }
    if (args.includes('functions') || (args.includes('run') && args.includes('services'))) {
      return response(0, '[]');
    }
    if (args.includes('projects') && args.includes('describe')) {
      return response(0, JSON.stringify(observation().project));
    }
    if (args.includes('kms') && args.includes('describe')) {
      return response(0, JSON.stringify(observation().kmsVersion));
    }
    if (args.includes('get-public-key')) return response(0, publicPem);
    throw new Error(`Unexpected fake command: ${command} ${args.join(' ')}`);
  };

  try {
    const client = createActivationCloudClient({
      repositoryRoot,
      workingDirectory: temporary,
      environment: { HOME: '/tmp/home', PATH: '/usr/bin:/bin' },
      spawn,
    });
    assert.doesNotThrow(() => normalizeCloudObservation(client.observe(), 'baseline'));
    client.createFirebaseWebApp();
    client.addSecretVersion('miakapp-audit-hmac', payload);
    assert.ok(payloadMatches(client.accessSecretVersion('miakapp-audit-hmac', 1), payload));
    assert.throws(
      () => client.addSecretVersion('foreign-secret', payload),
      /outside the reviewed staging activation set/,
    );
    assert.throws(
      () => client.addSecretVersion('miakapp-audit-hmac', Buffer.alloc(31)),
      /exactly 32 bytes/,
    );

    const mutating = calls.filter(({ args }) => args.includes('apps:create') || args.includes('add'));
    assert.equal(mutating.length, 2);
    const secretCall = mutating.find(({ args }) => args.includes('add'));
    assert.ok(Buffer.from(secretCall.input).equals(payload));
    assert.equal(secretCall.args.includes('--data-file=-'), true);
    assert.equal(secretCall.args.some((argument) => argument.includes(payload.toString('hex'))), false);
    assert.equal(Object.values(secretCall.env).some((value) => value.includes(payload.toString('hex'))), false);
    for (const { args } of calls.filter(({ args }) => !args.includes('version'))) {
      if (args.includes('apps:list') || args.includes('apps:create')) {
        assert.ok(args.includes('--project'));
        assert.ok(args.includes(PROJECT_ID));
      } else if (args[0] !== '--version') {
        assert.ok(args.some((argument) => argument === PROJECT_ID || argument === `--project=${PROJECT_ID}`));
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('keeps secret bytes on stdin and the legacy Firebase default out of both executors', () => {
  const cloud = readFileSync(new URL('../activation/cloud.mjs', import.meta.url), 'utf8');
  const planner = readFileSync(new URL('../activation/plan.mjs', import.meta.url), 'utf8');
  const apply = readFileSync(new URL('../activation/apply.mjs', import.meta.url), 'utf8');
  assert.equal((cloud.match(/'--data-file=-'/g) ?? []).length, 1);
  assert.match(cloud, /const bytes = Buffer\.from\(payload\)/);
  assert.match(cloud, /input: bytes/);
  assert.match(cloud, /`--out-file=\$\{outputPath\}`/);
  assert.doesNotMatch(cloud, /'--out-file=-'/);
  assert.doesNotMatch(`${planner}\n${apply}`, /\.firebaserc|firebase deploy|gcloud app create/);
  assert.doesNotMatch(`${planner}\n${apply}\n${cloud}`, /\bmiakapp-3\b/);
});
