import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  FIREBASE_APP_DISPLAY_NAME,
  PROJECT_ID,
  REGION,
  SECRET_BINDINGS,
  StagingActivationError,
} from './contract.mjs';

const MAXIMUM_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const FORBIDDEN_ENVIRONMENT_NAMES = new Set([
  'ALL_PROXY',
  'FIREBASE_TOKEN',
  'GCLOUD_KEYFILE_JSON',
  'GCLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_CREDENTIALS',
  'GOOGLE_CLOUD_KEYFILE_JSON',
  'GOOGLE_CREDENTIALS',
  'GRPC_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NO_PROXY',
  'XDG_CONFIG_HOME',
  'all_proxy',
  'grpc_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
]);

function reject(message) {
  throw new StagingActivationError(message);
}

export function assertSafeActivationEnvironment(environment, allowedAuthorizationName) {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || value.length === 0) continue;
    if (FORBIDDEN_ENVIRONMENT_NAMES.has(name)
      || name.startsWith('GOOGLE_')
      || name.startsWith('CLOUDSDK_')
      || (name.startsWith('FIREBASE_') && name !== 'FIREBASE_CLI_DISABLE_UPDATE_CHECK')
      || (name.startsWith('MIAKAPP_') && name !== allowedAuthorizationName)) {
      reject(`Environment override ${name} is forbidden for staging activation`);
    }
  }
  if (typeof environment.HOME !== 'string' || environment.HOME.length === 0
    || typeof environment.PATH !== 'string' || environment.PATH.length === 0) {
    reject('Staging activation requires the normal local HOME and PATH');
  }
}

function commandEnvironment(environment) {
  const selected = {};
  for (const name of [
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOGNAME',
    'PATH',
    'SHELL',
    'TMPDIR',
    'USER',
  ]) {
    if (typeof environment[name] === 'string' && environment[name].length !== 0) {
      selected[name] = environment[name];
    }
  }
  selected.CI = '1';
  selected.FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true';
  return selected;
}

function boundedJson(bytes, kind) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0
    || bytes.byteLength > MAXIMUM_COMMAND_OUTPUT_BYTES) {
    reject(`${kind} returned an invalid response size`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    reject(`${kind} returned invalid JSON`);
  }
}

function firebaseResult(value, kind) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || value.status !== 'success' || !Object.hasOwn(value, 'result')) {
    reject(`${kind} returned an invalid Firebase response`);
  }
  return value.result;
}

export function createActivationCloudClient({
  repositoryRoot,
  workingDirectory,
  environment = process.env,
  spawn = spawnSync,
}) {
  const firebaseCli = join(
    repositoryRoot,
    'control-plane/node_modules/firebase-tools/lib/bin/firebase.js',
  );
  const childEnvironment = commandEnvironment(environment);
  let commandSequence = 0;
  let secretReadSequence = 0;

  const raw = (command, args, { input, allowFailure = false } = {}) => {
    commandSequence += 1;
    const result = spawn(command, args, {
      cwd: workingDirectory,
      env: childEnvironment,
      input,
      maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? '');
    if (result.error !== undefined || result.signal !== null || result.status === null) {
      reject('A staging activation command could not be executed');
    }
    if (result.status !== 0 && !allowFailure) {
      const diagnosticPath = join(
        workingDirectory,
        `command-${process.pid}-${String(commandSequence).padStart(2, '0')}.stderr.log`,
      );
      writeFileSync(diagnosticPath, stderr, { flag: 'wx', mode: 0o600 });
      reject(`A staging activation command failed; private diagnostics were saved as ${diagnosticPath}`);
    }
    return Object.freeze({ status: result.status, stdout, stderr });
  };

  const gcloudJson = (args, kind) => boundedJson(
    raw('gcloud', [...args, '--quiet', '--format=json']).stdout,
    kind,
  );
  const firebaseJson = (args, kind, options) => {
    const response = raw(process.execPath, [
      firebaseCli,
      ...args,
      '--project', PROJECT_ID,
      '--non-interactive',
      '--json',
    ], options);
    return Object.freeze({
      ...response,
      result: response.status === 0
        ? firebaseResult(boundedJson(response.stdout, kind), kind)
        : undefined,
    });
  };

  const reviewedSecretId = (secretId) => {
    if (!SECRET_BINDINGS.some((binding) => binding.secretId === secretId)) {
      reject('Secret target is outside the reviewed staging activation set');
    }
    return secretId;
  };

  const listFirebaseApps = () => {
    const result = firebaseJson(['apps:list', 'WEB'], 'Firebase app inventory').result;
    if (!Array.isArray(result)) reject('Firebase app inventory must be an array');
    return result;
  };

  const listSecretVersions = (secretId) => {
    reviewedSecretId(secretId);
    const result = gcloudJson([
      'secrets',
      'versions',
      'list',
      secretId,
      `--project=${PROJECT_ID}`,
    ], `${secretId} version inventory`);
    if (!Array.isArray(result)) reject(`${secretId} version inventory must be an array`);
    return result;
  };

  return Object.freeze({
    listFirebaseApps,
    listSecretVersions,

    toolVersions() {
      const gcloud = boundedJson(
        raw('gcloud', ['version', '--format=json']).stdout,
        'gcloud version',
      );
      const firebase = raw(process.execPath, [firebaseCli, '--version']).stdout
        .toString('utf8').trim();
      return Object.freeze({
        node: process.versions.node,
        gcloud: gcloud['Google Cloud SDK'],
        firebase,
      });
    },

    observe() {
      const appEngine = raw('gcloud', [
        'app',
        'describe',
        `--project=${PROJECT_ID}`,
        '--quiet',
        '--format=json',
      ], { allowFailure: true });
      let appEngineApplication;
      if (appEngine.status === 0) {
        boundedJson(appEngine.stdout, 'App Engine inventory');
        appEngineApplication = true;
      } else if (/does not contain an App Engine application/.test(appEngine.stderr.toString('utf8'))) {
        appEngineApplication = false;
      } else {
        reject('App Engine inventory could not be verified');
      }
      const secretVersions = Object.fromEntries(SECRET_BINDINGS.map(({ secretId }) => [
        secretId,
        listSecretVersions(secretId),
      ]));
      const functions = gcloudJson([
        'functions',
        'list',
        `--project=${PROJECT_ID}`,
        `--regions=${REGION}`,
        '--v2',
      ], 'Cloud Functions inventory');
      const runServices = gcloudJson([
        'run',
        'services',
        'list',
        `--project=${PROJECT_ID}`,
        `--region=${REGION}`,
      ], 'Cloud Run inventory');
      if (!Array.isArray(functions) || !Array.isArray(runServices)) {
        reject('Workload inventory must be an array');
      }
      return Object.freeze({
        project: gcloudJson([
          'projects',
          'describe',
          PROJECT_ID,
        ], 'Project inventory'),
        firebaseApps: listFirebaseApps(),
        secretVersions,
        kmsVersion: gcloudJson([
          'kms',
          'keys',
          'versions',
          'describe',
          '1',
          `--project=${PROJECT_ID}`,
          `--location=${REGION}`,
          `--keyring=${PROJECT_ID}`,
          '--key=access-token-signing',
        ], 'KMS version inventory'),
        kmsPublicPem: raw('gcloud', [
          'kms',
          'keys',
          'versions',
          'get-public-key',
          '1',
          `--project=${PROJECT_ID}`,
          `--location=${REGION}`,
          `--keyring=${PROJECT_ID}`,
          '--key=access-token-signing',
          '--quiet',
        ]).stdout.toString('utf8'),
        functions,
        runServices,
        appEngineApplication,
      });
    },

    createFirebaseWebApp() {
      return firebaseJson([
        'apps:create',
        'WEB',
        FIREBASE_APP_DISPLAY_NAME,
      ], 'Firebase app creation', { allowFailure: true });
    },

    addSecretVersion(secretId, payload) {
      reviewedSecretId(secretId);
      const bytes = Buffer.from(payload);
      if (bytes.byteLength !== 32) reject('Secret payload must contain exactly 32 bytes');
      return raw('gcloud', [
        'secrets',
        'versions',
        'add',
        secretId,
        `--project=${PROJECT_ID}`,
        '--data-file=-',
        '--quiet',
        '--format=json',
      ], { input: bytes, allowFailure: true });
    },

    accessSecretVersion(secretId, version) {
      reviewedSecretId(secretId);
      if (!Number.isSafeInteger(version) || version < 1) reject('Secret version is invalid');
      secretReadSequence += 1;
      const outputPath = join(
        workingDirectory,
        `.secret-read-${process.pid}-${secretReadSequence}`,
      );
      if (existsSync(outputPath)) reject('Private secret read path already exists');
      try {
        raw('gcloud', [
          'secrets',
          'versions',
          'access',
          String(version),
          `--secret=${secretId}`,
          `--project=${PROJECT_ID}`,
          `--out-file=${outputPath}`,
          '--quiet',
        ]);
        const entry = lstatSync(outputPath);
        if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== 32
          || (entry.mode & 0o077) !== 0
          || (typeof process.getuid === 'function' && entry.uid !== process.getuid())) {
          reject(`${secretId} payload file is not an exact private 32-byte value`);
        }
        return readFileSync(outputPath);
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    },
  });
}
