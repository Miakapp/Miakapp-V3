import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalJson, sha256 } from './contract.mjs';

const MAXIMUM_EVIDENCE_BYTES = 32 * 1024;
const EXPECTED_RESULT_SHA256 =
  '9310b4aea71c11c33efcb5b92059e8424aec0999ea3f2759aeb3d9bec32e6436';

function reject(message) {
  throw new Error(message);
}

export function validateBrowserAppCheckEvidenceValue(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || sha256(Buffer.from(canonicalJson(value), 'utf8')) !== EXPECTED_RESULT_SHA256) {
    reject('Browser App Check evidence does not match the exact sanitized result');
  }
  return Object.freeze(value);
}

export function validateBrowserAppCheckEvidence(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_EVIDENCE_BYTES) {
    reject('Browser App Check evidence size is invalid');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check evidence is invalid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    return reject('Browser App Check evidence is not canonical JSON');
  }
  return validateBrowserAppCheckEvidenceValue(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    console.error('Usage: node evidence.mjs <result.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = validateBrowserAppCheckEvidence(process.argv[2]);
      process.stdout.write(
        `Validated ${result.schema} for ${result.project_id}; one domain-restricted score key and its exact non-deletable App Check provider registration converged with enforcement disabled.\n`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Browser App Check evidence failed');
      process.exitCode = 1;
    }
  }
}
