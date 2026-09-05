import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const MAXIMUM_EVIDENCE_BYTES = 32 * 1024;
const EXPECTED_RESULT = Object.freeze({
  schema: 'miakapp.staging-browser-app-check-api-result/1',
  operation: 'enable-recaptcha-enterprise-api-only',
  project_id: 'miakapp-v4-staging',
  project_number: '1072737219170',
  repository_commit: '0e8d5dfc3b5b8dd42d84cb165ae2a4f676f7fcdb',
  terraform_plan_sha256: 'f21835c20d9fe3dd4b2f47ac10f826a3c78b3b3e8a6e35aa4915c485c3058602',
  baseline_sha256: '37c6b4ad32735ea5906e541f44f81d774cb160084332d71bc9ff1a820bed1866',
  final_inventory_sha256: '88957efb77ec18b14fd4daf44a3dfd85ad2e2402366e6e4fad7f0d42940c68d8',
  recaptcha_api_enabled: true,
  authoritative_recaptcha_keys: 0,
  cloud_asset_recaptcha_keys: 0,
  app_check_registered: false,
  app_check_enforcement_records: 0,
  debug_tokens: 0,
  public_endpoints_created: 0,
  fixed_cost_services: 0,
  assessments_initiated_by_driver: 0,
});

function reject(message) {
  throw new Error(message);
}

export function validateBrowserAppCheckApiEvidenceValue(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || !isDeepStrictEqual(value, EXPECTED_RESULT)) {
    reject('Browser App Check API evidence does not match the exact sanitized result');
  }
  return Object.freeze(value);
}

export function validateBrowserAppCheckApiEvidence(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_EVIDENCE_BYTES) {
    reject('Browser App Check API evidence size is invalid');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check API evidence is invalid JSON');
  }
  return validateBrowserAppCheckApiEvidenceValue(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    console.error('Usage: node evidence.mjs <result.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = validateBrowserAppCheckApiEvidence(process.argv[2]);
      process.stdout.write(
        `Validated ${result.schema} for ${result.project_id}; the API prerequisite converged with an authoritative empty key inventory.\n`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Browser App Check API evidence failed');
      process.exitCode = 1;
    }
  }
}
