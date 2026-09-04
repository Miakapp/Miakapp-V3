import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TERRAFORM_VERSION,
  childEnvironment,
  writePrivateFile,
} from './contract.mjs';

export const firebaseAuthRoot = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const manifestPath = join(repositoryRoot, 'infrastructure/staging/manifest.json');

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
    cwd: options.cwd ?? firebaseAuthRoot,
    env: options.env ?? childEnvironment(),
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const allowedStatuses = options.allowedStatuses ?? [0];
  if (result.error !== undefined || result.signal !== null || result.status === null
    || !allowedStatuses.includes(result.status)) {
    preserveDiagnostics(
      options.diagnosticDirectory,
      options.description ?? command,
      result,
    );
    throw new Error(`${options.description ?? command} failed; private diagnostics were preserved when available`);
  }
  return result;
}

export function terraformEnvironment(terraformData) {
  return childEnvironment(process.env, {
    TF_CLI_CONFIG_FILE: join(firebaseAuthRoot, 'terraform-cli.tfrc'),
    TF_DATA_DIR: terraformData,
    TF_IN_AUTOMATION: '1',
  });
}

export function createTerraformData(bundle, suffix) {
  const directory = join(bundle, `.terraform-${suffix}-${process.pid}`);
  mkdirSync(directory, { mode: 0o700 });
  return directory;
}

export function privateBundle(path) {
  const bundle = realpathSync(resolve(path));
  const repository = realpathSync(repositoryRoot);
  const relation = relative(repository, bundle);
  const entry = lstatSync(bundle);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')) {
    throw new Error('Firebase Auth operation requires an exact private bundle directory');
  }
  return bundle;
}

export function validateToolchain() {
  const result = run('terraform', ['version', '-json'], { description: 'terraform-version' });
  let version;
  try {
    version = JSON.parse(Buffer.from(result.stdout).toString('utf8')).terraform_version;
  } catch {
    throw new Error('Terraform version output is invalid');
  }
  if (version !== TERRAFORM_VERSION) throw new Error(`Terraform ${TERRAFORM_VERSION} is required`);
}

export function validateStagingManifest() {
  run(process.execPath, [
    join(repositoryRoot, 'infrastructure/staging/validate.mjs'),
    manifestPath,
  ], { cwd: repositoryRoot, description: 'staging-manifest-validation' });
}
