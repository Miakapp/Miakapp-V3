import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalJson, sha256 } from './contract.mjs';

const MAXIMUM_EVIDENCE_BYTES = 8 * 1024;
const EXPECTED_RESULT_SHA256 =
  'b26ccdc1051c60a976578373ae2e36fda0821a9e93a6324de121f0bbed614fbc';

function reject(message) {
  throw new Error(`Staging signing-overlap evidence ${message}`);
}

export function validateSigningOverlapEvidenceValue(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || sha256(Buffer.from(canonicalJson(value), 'utf8')) !== EXPECTED_RESULT_SHA256) {
    reject('does not match the exact sanitized result');
  }
  return Object.freeze(value);
}

export function validateSigningOverlapEvidence(path) {
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
  return validateSigningOverlapEvidenceValue(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    console.error('Usage: node evidence.mjs <result.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = validateSigningOverlapEvidence(process.argv[2]);
      process.stdout.write(
        `Validated ${result.schema} for ${result.project_id}; exact signing-key version 2 is enabled while the runtime remains unchanged.\n`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Signing-overlap evidence failed');
      process.exitCode = 1;
    }
  }
}
