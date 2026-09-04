import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const RESULT_SHA256 = '25a3c80ccccb89208499b1d0fc2176ac82a04a7fc47ed57af80dfa0371136c87';
const MAXIMUM_RESULT_BYTES = 8 * 1024;

function reject(message) {
  throw new Error(`Staging Firebase Auth evidence ${message}`);
}

function expectedResult() {
  const projectId = 'miakapp-v4-staging';
  const projectNumber = '1072737219170';
  return {
    schema: 'miakapp.staging-firebase-auth-recovery-result/1',
    project_id: projectId,
    project_number: projectNumber,
    repository_commit: 'e44ce2cde147b19b7e82f89b44e8f3a5233d1942',
    observed_at: '2026-09-04T10:42:43.616Z',
    terraform_state_sha256: '94a1eca99e8a793ca1d316a283c43c0a75aeb041a84135ac5084074260fceb69',
    live_config_sha256: '2b274774cdc86caf380f67f611de4d7df66da2bb8ad4d92f111df4d26d37dd50',
    firebase_auth: {
      anonymous_sign_in: false,
      anonymous_user_autodelete: true,
      config_name: `projects/${projectNumber}/config`,
      duplicate_emails: false,
      email_sign_in: false,
      mfa: 'DISABLED',
      multi_tenant: false,
      phone_sign_in: false,
      project_id: projectId,
      project_number: projectNumber,
      request_logging: false,
      schema: 'miakapp.staging-firebase-auth/1',
      user_deletion_disabled: false,
      user_signup_disabled: false,
    },
    external_identity_providers: 0,
    public_endpoints_created: 0,
    persistent_credentials_created: 0,
  };
}

export function validateFirebaseAuthEvidenceValue(value) {
  if (!isDeepStrictEqual(value, expectedResult())) reject('fields have drifted');
  return Object.freeze(value);
}

export function validateFirebaseAuthEvidence(path) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_RESULT_BYTES) {
    reject('must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== RESULT_SHA256) {
    reject('digest does not match the live recovery result');
  }
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('is not valid JSON');
  }
  if (`${JSON.stringify(result, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('is not in exact canonical JSON form');
  }
  return validateFirebaseAuthEvidenceValue(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: node evidence.mjs <result.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = validateFirebaseAuthEvidence(process.argv[2]);
      console.log([
        `Validated ${result.schema} for ${result.project_id}.`,
        'The non-deletable Firebase Auth baseline is initialized and closed with zero external identity providers.',
      ].join(' '));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging Firebase Auth evidence is invalid');
      process.exitCode = 1;
    }
  }
}
