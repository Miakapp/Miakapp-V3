import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_ID,
  TERRAFORM_VERSION,
  childEnvironment,
  writePrivateFile,
} from './contract.mjs';
import { validateFirebaseAuthRoot } from '../firebase-auth/guard.mjs';

export const authProbeRoot = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const manifestPath = join(repositoryRoot, 'infrastructure/staging/manifest.json');
export const firebaseAuthRoot = join(repositoryRoot, 'infrastructure/staging/firebase-auth');
export const MAXIMUM_COMMAND_BYTES = 32 * 1024 * 1024;
const IDENTITY_PROVIDER_COLLECTIONS = Object.freeze([
  ['defaultSupportedIdpConfigs', 'defaultSupportedIdpConfigs'],
  ['oauthIdpConfigs', 'oauthIdpConfigs'],
  ['inboundSamlConfigs', 'inboundSamlConfigs'],
]);

function preserveDiagnostics(directory, description, result) {
  if (directory === undefined) return;
  const path = join(directory, `${description}.log`);
  if (existsSync(path)) return;
  const bytes = Buffer.concat([
    Buffer.from(result.stdout ?? ''),
    Buffer.from(result.stderr ?? ''),
  ]);
  writePrivateFile(
    path,
    bytes.length === 0 ? Buffer.from('Command failed without diagnostics\n') : bytes,
  );
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? authProbeRoot,
    env: options.env ?? childEnvironment(),
    maxBuffer: options.maxBuffer ?? MAXIMUM_COMMAND_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const allowedStatuses = options.allowedStatuses ?? [0];
  if (result.error !== undefined || result.signal !== null || result.status === null
    || !allowedStatuses.includes(result.status)) {
    preserveDiagnostics(options.diagnosticDirectory, options.description ?? command, result);
    throw new Error(`${options.description ?? command} failed; private diagnostics were preserved when available`);
  }
  return result;
}

export function parseJson(bytes, description, maximumBytes = MAXIMUM_COMMAND_BYTES) {
  const value = Buffer.from(bytes ?? '');
  if (value.byteLength === 0 || value.byteLength > maximumBytes) {
    throw new Error(`${description} returned an invalid response size`);
  }
  try {
    return JSON.parse(value.toString('utf8'));
  } catch {
    throw new Error(`${description} returned invalid JSON`);
  }
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

async function validateIdentityProviderAbsence() {
  const tokenResult = run('gcloud', ['auth', 'print-access-token', '--quiet'], {
    cwd: repositoryRoot,
    description: 'firebase-auth-provider-inventory-token',
  });
  const accessToken = Buffer.from(tokenResult.stdout ?? '').toString('utf8').trim();
  if (accessToken.length < 20 || accessToken.length > 16 * 1024 || /\s/u.test(accessToken)) {
    throw new Error('Firebase Auth provider inventory token is invalid');
  }
  for (const [collection, field] of IDENTITY_PROVIDER_COLLECTIONS) {
    let response;
    try {
      response = await fetch(
        `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/${collection}?pageSize=100`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'X-Goog-User-Project': PROJECT_ID,
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new Error('Firebase Auth identity-provider inventory request failed');
    }
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error('Firebase Auth identity-provider inventory returned invalid JSON');
    }
    if (response.status !== 200 || !plainObject(value)
      || Object.keys(value).some((key) => ![field, 'nextPageToken'].includes(key))
      || (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].length !== 0))
      || (value.nextPageToken !== undefined && value.nextPageToken !== '')) {
      throw new Error('Firebase Auth has an unreviewed external identity provider');
    }
  }
}

export function runJson(command, args, options = {}) {
  const result = run(command, args, options);
  return parseJson(result.stdout, options.description ?? command, options.maxBuffer);
}

export function gcloudJson(args, options = {}) {
  return runJson('gcloud', [...args, '--quiet', '--format=json'], {
    cwd: repositoryRoot,
    ...options,
  });
}

export function terraformEnvironment(terraformData) {
  return childEnvironment(process.env, {
    TF_CLI_CONFIG_FILE: join(authProbeRoot, 'terraform-cli.tfrc'),
    TF_DATA_DIR: terraformData,
    TF_IN_AUTOMATION: '1',
  });
}

export function createTerraformData(bundle, suffix) {
  const directory = join(bundle, `.terraform-${suffix}-${process.pid}`);
  mkdirSync(directory, { mode: 0o700 });
  return directory;
}

export function validateToolchain() {
  const value = runJson('terraform', ['version', '-json'], {
    description: 'terraform-version',
  });
  if (value.terraform_version !== TERRAFORM_VERSION) {
    throw new Error(`Terraform ${TERRAFORM_VERSION} is required`);
  }
}

export function validateStagingManifest() {
  run(process.execPath, [
    join(repositoryRoot, 'infrastructure/staging/validate.mjs'),
    manifestPath,
  ], {
    cwd: repositoryRoot,
    description: 'staging-manifest-validation',
  });
}

export async function validateFirebaseAuthConvergence(bundle, phase) {
  if (!['plan', 'apply', 'invoke'].includes(phase)) {
    throw new Error('Firebase Auth convergence phase is invalid');
  }
  validateToolchain();
  validateFirebaseAuthRoot(new URL('../firebase-auth/', import.meta.url));
  const terraformData = createTerraformData(bundle, `${phase}-firebase-auth`);
  const environment = childEnvironment(process.env, {
    TF_CLI_CONFIG_FILE: join(firebaseAuthRoot, 'terraform-cli.tfrc'),
    TF_DATA_DIR: terraformData,
    TF_IN_AUTOMATION: '1',
  });
  try {
    run('terraform', [
      'init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color',
    ], {
      cwd: firebaseAuthRoot,
      env: environment,
      diagnosticDirectory: bundle,
      description: `${phase}-firebase-auth-init`,
    });
    const convergence = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
    ], {
      cwd: firebaseAuthRoot,
      env: environment,
      allowedStatuses: [0, 1, 2],
      description: `${phase}-firebase-auth-convergence`,
    });
    if (convergence.status !== 0) {
      const path = join(bundle, `${phase}-firebase-auth-convergence.log`);
      if (!existsSync(path)) {
        const bytes = Buffer.concat([
          Buffer.from(convergence.stdout ?? ''),
          Buffer.from(convergence.stderr ?? ''),
        ]);
        writePrivateFile(
          path,
          bytes.length === 0 ? Buffer.from('Convergence failed without diagnostics\n') : bytes,
        );
      }
      throw new Error('Firebase Auth live configuration is absent, incomplete, or drifted');
    }
    await validateIdentityProviderAbsence();
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

export function privateBundle(path) {
  const bundle = realpathSync(resolve(path));
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, bundle);
  const entry = lstatSync(bundle);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    throw new Error('Auth-probe operation requires an exact private bundle directory');
  }
  return bundle;
}
