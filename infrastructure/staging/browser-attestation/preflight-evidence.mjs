import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalJson, sha256 } from './contract.mjs';

const MAXIMUM_EVIDENCE_BYTES = 8 * 1024;
const EXPECTED_RESULT_SHA256 =
  '24746d2dde348ff5703f83a88e35ec45706629dab812a5727f0e97d626d6fce7';

function reject(message) {
  throw new Error(`Browser-attestation preflight evidence ${message}`);
}

export function validatePreflightEvidenceValue(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || sha256(Buffer.from(canonicalJson(value), 'utf8')) !== EXPECTED_RESULT_SHA256) {
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
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    console.error('Usage: node preflight-evidence.mjs <preflight-result.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = validatePreflightEvidence(process.argv[2]);
      process.stdout.write(
        `Validated ${result.schema} for ${result.project_id}; the first Hosting version was finalized and deleted before any release or browser invocation.\n`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Browser-attestation preflight evidence failed');
      process.exitCode = 1;
    }
  }
}
