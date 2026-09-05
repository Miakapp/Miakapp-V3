import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  childEnvironment,
  verifiedOperatorEmail,
  writePrivateFile,
} from './contract.mjs';

export const signingOverlapRoot = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const manifestPath = join(repositoryRoot, 'infrastructure/staging/manifest.json');
const MAXIMUM_TOKEN_BYTES = 16 * 1024;

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
    cwd: options.cwd ?? signingOverlapRoot,
    env: options.env ?? childEnvironment(),
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    timeout: options.timeout ?? 2 * 60 * 1_000,
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

export function parseJson(bytes, description, maximumBytes = 8 * 1024 * 1024) {
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

export function runJson(command, args, options = {}) {
  const result = run(command, args, options);
  return parseJson(result.stdout, options.description ?? command, options.maxBuffer);
}

export async function verifiedOperatorSession() {
  const email = verifiedOperatorEmail(repositoryRoot);
  const impersonation = Buffer.from(run('gcloud', [
    'config',
    'get-value',
    'auth/impersonate_service_account',
    '--quiet',
  ], {
    cwd: repositoryRoot,
    description: 'gcloud-impersonation-configuration',
  }).stdout).toString('utf8').trim();
  if (!['', '(unset)'].includes(impersonation)) {
    throw new Error('Configured Google service-account impersonation is forbidden');
  }
  const accessToken = Buffer.from(run('gcloud', [
    'auth',
    'print-access-token',
    `--account=${email}`,
    '--quiet',
  ], {
    cwd: repositoryRoot,
    description: 'verified-operator-access-token',
  }).stdout).toString('utf8').trim();
  if (accessToken.length < 20 || accessToken.length > MAXIMUM_TOKEN_BYTES
    || /\s/u.test(accessToken)) {
    throw new Error('Verified operator access token is invalid');
  }
  let response;
  try {
    response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Verified operator principal lookup failed');
  }
  const principal = parseJson(
    Buffer.from(await response.arrayBuffer()),
    'Verified operator principal',
    64 * 1024,
  );
  if (response.status !== 200 || principal.email !== email || principal.email_verified !== true) {
    throw new Error('Access token principal does not match the reviewed staging operator');
  }
  return Object.freeze({ email, accessToken });
}

export function validateStagingManifest() {
  run(process.execPath, [
    join(repositoryRoot, 'infrastructure/staging/validate.mjs'),
    manifestPath,
  ], { cwd: repositoryRoot, description: 'staging-manifest-validation' });
}
