import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalJson, sha256 } from './contract.mjs';

const MAXIMUM_EVIDENCE_BYTES = 8 * 1024;
const EXPECTED_RESULT_SHA256 = Object.freeze({
  'miakapp.staging-browser-attestation-preflight-result/1':
    '24746d2dde348ff5703f83a88e35ec45706629dab812a5727f0e97d626d6fce7',
  'miakapp.staging-browser-attestation-preflight-result/2':
    'c758873bb1c632531aa358a4cf8526e7e05c991b8f0329f27353494ad909f17a',
  'miakapp.staging-browser-attestation-preflight-result/3':
    '6e5ad639da6dc94075dc30d0f0f0839806e1e7ba944ececbff57ac2d2e821386',
});

function reject(message) {
  throw new Error(`Browser-attestation preflight evidence ${message}`);
}

export function validatePreflightEvidenceValue(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || sha256(Buffer.from(canonicalJson(value), 'utf8')) !== EXPECTED_RESULT_SHA256[value.schema]) {
    reject('does not match the exact sanitized result');
  }
  return Object.freeze(value);
}

export function validatePreflightEvidence(path) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_EVIDENCE_BYTES) {
    reject('must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('is invalid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    return reject('is not canonical JSON');
  }
  return validatePreflightEvidenceValue(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) {
    console.error('Usage: node preflight-evidence.mjs <preflight-result.json> [...]');
    process.exitCode = 2;
  } else {
    try {
      for (const path of process.argv.slice(2)) {
        const result = validatePreflightEvidence(path);
        process.stdout.write(
          `Validated ${result.schema} for ${result.project_id}; its Hosting version was deleted before any release or browser invocation.\n`,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Browser-attestation preflight evidence failed');
      process.exitCode = 1;
    }
  }
}
