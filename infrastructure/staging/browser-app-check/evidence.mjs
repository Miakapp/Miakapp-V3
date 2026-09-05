import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const MAXIMUM_EVIDENCE_BYTES = 32 * 1024;
const EXPECTED_RESULT = Object.freeze({
  schema: 'miakapp.staging-browser-app-check-key-result/1',
  operation: 'create-domain-restricted-score-key',
  project_id: 'miakapp-v4-staging',
  project_number: '1072737219170',
  repository_commit: 'ec541acce307d32f2816097065f7bff1e3f0f7d0',
  terraform_plan_sha256: 'dd45c80ed38dbe5e681713442ddaa02e1dc78d2a3ce6f9365b7bbc04f96e248b',
  baseline_sha256: '2c48ce0b837881e148a0aa9b9dd42eea66905bf96c41655424ee326fade5d75e',
  global_attempt_claim: {
    schema: 'miakapp.staging-browser-app-check-key-attempt-claim-receipt/1',
    bucket: 'miakapp-v4-staging-tfstate-1072737219170',
    object: 'terraform/browser-app-check/operations/recaptcha-key-create-attempt.json',
    generation: '1788596614949831',
    size_bytes: 665,
    sha256: 'da1e5792f5026f3d5f599d8b6ceb6590be8985a841b3f2c614014979d0871afc',
    repository_commit: 'ec541acce307d32f2816097065f7bff1e3f0f7d0',
    terraform_plan_sha256: 'dd45c80ed38dbe5e681713442ddaa02e1dc78d2a3ce6f9365b7bbc04f96e248b',
    baseline_sha256: '2c48ce0b837881e148a0aa9b9dd42eea66905bf96c41655424ee326fade5d75e',
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  },
  final_inventory_sha256: '15dc000a5a9729c3e9f88a7aba8f5c6807c7207dd08dda3339db567c6bd2dd90',
  terraform_state: {
    schema: 'miakapp.staging-browser-app-check-state/1',
    object: 'terraform/browser-app-check/default.tfstate',
    generation: '1788596623837355',
    size_bytes: 14139,
    sha256: '954c7c6ea4187ee59764cca2d4fb0cf359cc8a580dc1f12d96cad46ae2741f9f',
    terraform_version: '1.11.3',
    serial: 4,
    lineage_sha256: 'f6640c6c40b21a544f3ddc3ee8005f8a1d9d2eaa19dd79ba5fca5709394d9601',
    managed_resources: 3,
    data_resources: 2,
    outputs: 1,
    tainted_resources: 0,
    recaptcha_key_name_sha256: '997f375ee6db0535dd3934dcc6ffb941f10efd5516e29b27c4caa6b8157851fb',
  },
  recaptcha_api_enabled: true,
  authoritative_recaptcha_keys: 1,
  cloud_asset_recaptcha_keys: 1,
  recaptcha_key: {
    name_sha256: '997f375ee6db0535dd3934dcc6ffb941f10efd5516e29b27c4caa6b8157851fb',
    display_name: 'Miakapp V4 staging browser App Check',
    labels: {
      environment: 'staging',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
      purpose: 'browser-app-check',
    },
    create_time: '2026-09-05T08:23:36Z',
    integration_type: 'SCORE',
    allow_all_domains: false,
    allowed_domains: ['miakapp-v4-staging.web.app'],
    allowed_domain_includes_subdomains: true,
    allow_amp_traffic: false,
    testing_options_configured: false,
    waf_settings_configured: false,
  },
  app_check_registered: false,
  app_check_enforcement_records: 0,
  debug_tokens: 0,
  public_site_key_committed: false,
  legacy_secret_retrievals_by_driver: 0,
  public_endpoints_created: 0,
  fixed_cost_services: 0,
  coordination_objects_created: 1,
  browser_requests_initiated_by_driver: 0,
  assessments_initiated_by_driver: 0,
});

function reject(message) {
  throw new Error(message);
}

export function validateBrowserAppCheckEvidenceValue(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || !isDeepStrictEqual(value, EXPECTED_RESULT)) {
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
        `Validated ${result.schema} for ${result.project_id}; one domain-restricted score key converged while App Check registration remains absent.\n`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Browser App Check evidence failed');
      process.exitCode = 1;
    }
  }
}
