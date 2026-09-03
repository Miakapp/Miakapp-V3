import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { createActivationCloudClient, assertSafeActivationEnvironment } from './cloud.mjs';
import {
  PROJECT_ID,
  SECRET_BINDINGS,
  activationAuthorization,
  buildActivationResult,
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
} from './contract.mjs';
import { validateActivationRoot } from './guard.mjs';

const ACTIVATION_AUTHORIZATION = 'MIAKAPP_STAGING_ACTIVATION_AUTHORIZATION';
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const controlPlaneRoot = join(repositoryRoot, 'control-plane');
const runtimeBuilderPath = join(controlPlaneRoot, 'lib/staging-runtime-document-cli.js');

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { HOME: process.env.HOME, PATH: process.env.PATH },
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    throw new Error('Repository state could not be verified');
  }
  return result.stdout.trim();
}

function verifyRepository(expectedCommit) {
  if (git(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    throw new Error('Staging activation requires a clean repository');
  }
  const head = git(['rev-parse', 'HEAD']);
  const main = git(['rev-parse', 'origin/main']);
  if (head !== expectedCommit || main !== expectedCommit) {
    throw new Error('Staging activation requires the exact planned origin/main commit');
  }
}

function localEnvironment() {
  const environment = {};
  for (const name of ['HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PATH', 'TMPDIR']) {
    if (typeof process.env[name] === 'string' && process.env[name].length !== 0) {
      environment[name] = process.env[name];
    }
  }
  environment.CI = '1';
  return environment;
}

function compileRuntimeBuilder(directory) {
  const version = spawnSync('bun', ['--version'], {
    cwd: controlPlaneRoot,
    encoding: 'utf8',
    env: localEnvironment(),
  });
  if (version.status !== 0 || version.stdout.trim() !== '1.2.23') {
    throw new Error('Bun 1.2.23 is required to validate the runtime document');
  }
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: controlPlaneRoot,
    env: localEnvironment(),
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (build.status !== 0 || build.signal !== null || build.error !== undefined) {
    const diagnostics = Buffer.concat([
      Buffer.from(build.stdout ?? ''),
      Buffer.from(build.stderr ?? ''),
    ]);
    writeFileSync(join(directory, `runtime-builder-${process.pid}.stderr.log`), diagnostics, {
      flag: 'wx',
      mode: 0o600,
    });
    throw new Error('Runtime builder compilation failed; private diagnostics were preserved');
  }
}

function runtimeBuilder(mode, input) {
  const inputBytes = Buffer.isBuffer(input)
    ? input
    : Buffer.from(JSON.stringify(input), 'utf8');
  const result = spawnSync(process.execPath, [runtimeBuilderPath, mode], {
    cwd: controlPlaneRoot,
    env: localEnvironment(),
    input: inputBytes,
    maxBuffer: 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    throw new Error('Runtime document failed its production parser and lifecycle gate');
  }
  return Buffer.from(result.stdout);
}

function privateFile(path, expectedBytes) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || entry.size !== expectedBytes
    || (typeof process.getuid === 'function' && entry.uid !== process.getuid())) {
    throw new Error(`${path} is not an exact private activation file`);
  }
  return readFileSync(path);
}

function writeOrVerify(path, bytes) {
  if (existsSync(path)) {
    if (!privateFile(path, bytes.byteLength).equals(bytes)) {
      throw new Error(`${path} conflicts with the resumed activation result`);
    }
    return;
  }
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  chmodSync(path, 0o600);
}

function updatedObservation(observation, field, value) {
  return Object.freeze({ ...observation, [field]: value });
}

function updatedSecretObservation(observation, secretId, versions) {
  return updatedObservation(observation, 'secretVersions', Object.freeze({
    ...observation.secretVersions,
    [secretId]: versions,
  }));
}

export function materializeCloudInputs({ client, initialObservation, seed, mutationJournal }) {
  let observation = initialObservation;
  let normalized = normalizeCloudObservation(observation, 'partial');
  if (normalized.firebaseApps.length === 0) {
    if (mutationJournal.wasAttempted('firebase-web-app')) {
      throw new Error('A prior Firebase Web app creation is not yet visible; refusing a duplicate');
    }
    mutationJournal.recordAttempt('firebase-web-app');
    client.createFirebaseWebApp();
    observation = updatedObservation(observation, 'firebaseApps', client.listFirebaseApps());
    normalized = normalizeCloudObservation(observation, 'partial');
  }
  if (normalized.firebaseApps.length !== 1) {
    throw new Error('Firebase Web app creation could not be reconciled');
  }

  for (const { secretId } of SECRET_BINDINGS) {
    let versions = client.listSecretVersions(secretId);
    observation = updatedSecretObservation(observation, secretId, versions);
    normalized = normalizeCloudObservation(observation, 'partial');
    const expectedPayload = deriveSecretPayload(seed, secretId);
    if (normalized.secretVersions[secretId].length === 0) {
      const action = `secret-version:${secretId}`;
      if (mutationJournal.wasAttempted(action)) {
        throw new Error(`A prior ${secretId} version creation is not yet visible; refusing a duplicate`);
      }
      mutationJournal.recordAttempt(action);
      client.addSecretVersion(secretId, expectedPayload);
      versions = client.listSecretVersions(secretId);
      observation = updatedSecretObservation(observation, secretId, versions);
      normalized = normalizeCloudObservation(observation, 'partial');
    }
    const version = normalized.secretVersions[secretId][0]?.version;
    if (!Number.isSafeInteger(version)
      || !payloadMatches(client.accessSecretVersion(secretId, version), expectedPayload)) {
      throw new Error(`${secretId} could not be reconciled to the exact private payload`);
    }
  }

  observation = client.observe();
  normalized = normalizeCloudObservation(observation, 'complete');
  return Object.freeze({ observation, normalized });
}

function createMutationJournal(directory, planDigest) {
  const filenames = new Map([
    ['firebase-web-app', 'attempt-firebase-web-app.json'],
    ...SECRET_BINDINGS.map(({ secretId }) => [
      `secret-version:${secretId}`,
      `attempt-secret-version-${secretId}.json`,
    ]),
  ]);
  const expectedBytes = (action) => {
    const filename = filenames.get(action);
    if (filename === undefined) throw new Error('Activation mutation action is outside the reviewed journal');
    return {
      path: join(directory, filename),
      bytes: Buffer.from(serializePrivateJson({
        schema: 'miakapp.staging-activation-attempt/1',
        project_id: PROJECT_ID,
        plan_sha256: planDigest,
        action,
      }), 'utf8'),
    };
  };
  return Object.freeze({
    wasAttempted(action) {
      const { path, bytes } = expectedBytes(action);
      if (!existsSync(path)) return false;
      writeOrVerify(path, bytes);
      return true;
    },
    recordAttempt(action) {
      const { path, bytes } = expectedBytes(action);
      writeOrVerify(path, bytes);
    },
  });
}

function parsePrivateResult(path) {
  const bytes = privateFile(path, lstatSync(path).size);
  if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) {
    throw new Error('Private activation result has an invalid size');
  }
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!Buffer.from(serializePrivateJson(value), 'utf8').equals(bytes)) {
      throw new Error('noncanonical result');
    }
    return { bytes, value };
  } catch {
    throw new Error('Private activation result is invalid JSON');
  }
}

function verifyCompletedExecution({
  client,
  directory,
  plan,
  planDigest,
  seedPath,
}) {
  const resultPath = join(directory, 'result.json');
  const runtimePath = join(directory, 'runtime-config.json');
  const result = parsePrivateResult(resultPath).value;
  if (result?.schema !== 'miakapp.staging-activation-result/1'
    || result.project_id !== PROJECT_ID
    || result.repository_commit !== plan.repository_commit
    || result.plan_sha256 !== planDigest
    || typeof result.completed_at !== 'string'
    || typeof result.runtime_config_sha256 !== 'string') {
    throw new Error('Private activation result does not match the reviewed plan');
  }
  const observation = client.observe();
  const normalized = normalizeCloudObservation(observation, 'complete');
  if (!isDeepStrictEqual(normalized.publicJwk, plan.baseline.kms_public_jwk)) {
    throw new Error('KMS public key no longer matches the reviewed plan');
  }
  const runtimeBytes = privateFile(runtimePath, lstatSync(runtimePath).size);
  runtimeBuilder('validate', runtimeBytes);
  const rebuiltRuntime = runtimeBuilder('build', runtimeBuilderInput(observation));
  if (!runtimeBytes.equals(rebuiltRuntime)) {
    throw new Error('Private runtime configuration no longer matches live activation material');
  }
  if (sha256(runtimeBytes) !== result.runtime_config_sha256) {
    throw new Error('Private runtime configuration digest does not match the activation result');
  }
  const expected = buildActivationResult({
    planDigest,
    repositoryCommit: plan.repository_commit,
    completedAt: result.completed_at,
    normalizedObservation: normalized,
    runtimeConfigDigest: result.runtime_config_sha256,
  });
  if (!isDeepStrictEqual(result, expected)) {
    throw new Error('Live activation inventory does not match the private completion record');
  }
  if (existsSync(seedPath)) unlinkSync(seedPath);
  process.stdout.write([
    'Staging activation material is already complete and revalidated.',
    `Firebase app ID: ${normalized.firebaseApps[0].appId}`,
    `Runtime configuration: ${runtimePath}`,
    `Result: ${resultPath}`,
    '',
  ].join('\n'));
}

async function main() {
  process.umask(0o077);
  if (process.argv.length !== 3) {
    throw new Error(`Usage: ${ACTIVATION_AUTHORIZATION}=... ./apply.sh <private-plan.json>`);
  }
  assertSafeActivationEnvironment(process.env, ACTIVATION_AUTHORIZATION);
  validateActivationRoot(new URL('./', import.meta.url));
  const planPath = process.argv[2];
  const initialRead = readPrivatePlan(planPath, repositoryRoot, { allowExpired: true });
  const { bytes: planBytes, plan } = initialRead;
  const directory = dirname(initialRead.path);
  const seedPath = join(directory, 'activation.seed');
  const resultPath = join(directory, 'result.json');
  if (!existsSync(seedPath) && !existsSync(resultPath)) validateActivationPlan(plan);
  verifyRepository(plan.repository_commit);
  validateActivationAuthorization(
    process.env[ACTIVATION_AUTHORIZATION],
    planBytes,
    plan.repository_commit,
  );
  const planDigest = sha256(planBytes);
  if (process.env[ACTIVATION_AUTHORIZATION]
    !== activationAuthorization(planBytes, plan.repository_commit)) {
    throw new Error('Staging activation authorization changed during validation');
  }

  const lockPath = join(directory, '.apply-lock');
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch {
    throw new Error('Another activation execution may be active; the private lock already exists');
  }

  try {
    const client = createActivationCloudClient({
      repositoryRoot,
      workingDirectory: directory,
    });
    if (!isDeepStrictEqual(client.toolVersions(), plan.tool_versions)) {
      throw new Error('Activation toolchain changed after the reviewed plan');
    }
    compileRuntimeBuilder(directory);
    if (existsSync(resultPath)) {
      verifyCompletedExecution({ client, directory, plan, planDigest, seedPath });
      return;
    }

    let observation = client.observe();
    if (!existsSync(seedPath)) {
      const baseline = normalizeCloudObservation(observation, 'baseline');
      if (!isDeepStrictEqual(baseline.publicJwk, plan.baseline.kms_public_jwk)) {
        throw new Error('KMS public key changed after the reviewed plan');
      }
      writeFileSync(seedPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
      chmodSync(seedPath, 0o600);
    } else {
      const resumed = normalizeCloudObservation(observation, 'partial');
      if (!isDeepStrictEqual(resumed.publicJwk, plan.baseline.kms_public_jwk)) {
        throw new Error('KMS public key changed after the reviewed plan');
      }
    }
    const seed = privateFile(seedPath, 32);
    writeOrVerify(join(directory, 'started.json'), Buffer.from(serializePrivateJson({
      schema: 'miakapp.staging-activation-start/1',
      project_id: PROJECT_ID,
      repository_commit: plan.repository_commit,
      plan_sha256: planDigest,
    }), 'utf8'));

    const materialized = materializeCloudInputs({
      client,
      initialObservation: observation,
      seed,
      mutationJournal: createMutationJournal(directory, planDigest),
    });
    observation = materialized.observation;
    const normalized = materialized.normalized;
    if (!isDeepStrictEqual(normalized.publicJwk, plan.baseline.kms_public_jwk)) {
      throw new Error('KMS public key changed after the reviewed plan');
    }
    const builderInput = runtimeBuilderInput(observation);
    const runtimeBytes = runtimeBuilder('build', builderInput);
    runtimeBuilder('validate', runtimeBytes);
    const runtimePath = join(directory, 'runtime-config.json');
    writeOrVerify(runtimePath, runtimeBytes);

    const result = buildActivationResult({
      planDigest,
      repositoryCommit: plan.repository_commit,
      completedAt: new Date().toISOString(),
      normalizedObservation: normalized,
      runtimeConfigDigest: sha256(runtimeBytes),
    });
    writePrivateJson(resultPath, result);
    unlinkSync(seedPath);
    process.stdout.write([
      'Staging activation materialization completed.',
      `Firebase app ID: ${normalized.firebaseApps[0].appId}`,
      'Secret versions: 5 enabled numeric references; payloads were not logged or persisted.',
      `Runtime configuration: ${runtimePath}`,
      `Result: ${resultPath}`,
      'Workloads created: 0.',
      '',
    ].join('\n'));
  } catch (error) {
    if (existsSync(seedPath)) {
      console.error(`Activation did not complete; the resumable private seed remains at ${seedPath}.`);
    }
    throw error;
  } finally {
    rmdirSync(lockPath);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unknown staging activation failure';
    console.error(message);
    process.exitCode = 1;
  });
}
