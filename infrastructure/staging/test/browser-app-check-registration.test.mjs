import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_RISK_SCORE,
  FIREBASE_APP_CONFIG_NAME,
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  FIREBASE_APP_NAME,
  HOSTING_DOMAIN,
  OPERATOR_USER_SHA256,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_API,
  RECAPTCHA_DISPLAY_NAME,
  TERRAFORM_VERSION,
  canonicalJson,
  createPrivateBrowserAppCheckBundle,
  sha256,
} from '../browser-app-check/contract.mjs';
import {
  KEY_PREREQUISITE_ATTEMPT_CLAIM,
  KEY_PREREQUISITE_TERRAFORM_STATE,
} from '../browser-app-check/key-contract.mjs';
import {
  APP_CHECK_REGISTRATION_OPERATION,
  APP_CHECK_REGISTRATION_TTL,
  APP_CHECK_SITE_KEY_SHA256,
  browserAppCheckRegistrationAuthorization,
  buildBrowserAppCheckRegistrationPlanMetadata,
  validateBrowserAppCheckRegistrationAuthorization,
  validateBrowserAppCheckRegistrationPlanMetadata,
} from '../browser-app-check/registration-contract.mjs';
import {
  APP_CHECK_REGISTRATION_CONSUMED as APPLY_APP_CHECK_REGISTRATION_CONSUMED,
} from '../browser-app-check/registration-apply.mjs';
import {
  APP_CHECK_REGISTRATION_CONSUMED as PLAN_APP_CHECK_REGISTRATION_CONSUMED,
} from '../browser-app-check/registration-plan.mjs';
import {
  APP_CHECK_REGISTRATION_RECOVERY_RETIRED as APPLY_APP_CHECK_REGISTRATION_RECOVERY_RETIRED,
} from '../browser-app-check/registration-recovery-apply.mjs';
import {
  APP_CHECK_REGISTRATION_RECOVERY_RETIRED as PLAN_APP_CHECK_REGISTRATION_RECOVERY_RETIRED,
} from '../browser-app-check/registration-recovery-plan.mjs';
import {
  BROWSER_APP_CHECK_PROVIDER_ATTEMPT_BUCKET,
  BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
  BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET,
  BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT,
  browserAppCheckProviderAttemptClaimAbsence,
  browserAppCheckRegistrationAttemptClaimAbsence,
  createBrowserAppCheckProviderAttemptClaim,
  createBrowserAppCheckRegistrationAttemptClaim,
  validateBrowserAppCheckProviderAttemptClaimReceipt,
  validateBrowserAppCheckRegistrationAttemptClaimReceipt,
} from '../browser-app-check/registration-claim.mjs';
import {
  BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
  BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID,
  browserAppCheckRegistrationRecoverySourceBundle,
  browserAppCheckRegistrationRecoveryAuthorization,
  buildBrowserAppCheckRegistrationRecoveryMetadata,
  createBrowserAppCheckRegistrationRecoveryBundle,
  inspectBrowserAppCheckRegistrationStateFixture,
  selectBrowserAppCheckRegistrationRecoveryAction,
  validateBrowserAppCheckRegistrationProviderAttemptBoundary,
  validateBrowserAppCheckRegistrationRecoveryAuthorization,
  validateBrowserAppCheckRegistrationRecoveryMetadata,
} from '../browser-app-check/registration-recovery.mjs';
import { browserAppCheckKeyOutput } from '../browser-app-check/validate-key-plan.mjs';
import {
  browserAppCheckRegistrationOutput,
  validateBrowserAppCheckRegistrationPlanFixture,
  validateBrowserAppCheckRegistrationReconciliationPlanFixture,
} from '../browser-app-check/validate-registration-plan.mjs';

const COMMIT = '4'.repeat(40);
const CREATED_AT = '2026-09-05T12:00:00.000Z';
const PLAN_BYTES = Buffer.from('synthetic-registration-plan');
const PLAN_JSON_BYTES = Buffer.from('{"synthetic":"registration"}\n');
const SITE_KEY = 's'.repeat(40);
const KEY_RESOURCE_NAME = `projects/${PROJECT_ID}/keys/${SITE_KEY}`;
const CONTRACT = Object.freeze({
  site_key_sha256: sha256(Buffer.from(SITE_KEY, 'utf8')),
  key_resource_name_sha256: sha256(Buffer.from(KEY_RESOURCE_NAME, 'utf8')),
  key_create_time: '2026-09-05T08:23:36Z',
});
const RECOVERY_CONTRACT = Object.freeze({
  site_key_sha256: CONTRACT.site_key_sha256,
  key_resource_name_sha256: CONTRACT.key_resource_name_sha256,
});
const LABELS = Object.freeze({
  environment: 'staging',
  'managed-by': 'terraform',
  product: 'miakapp-v4',
  purpose: 'browser-app-check',
});
const registrationApplySource = readFileSync(
  new URL('../browser-app-check/registration-apply.mjs', import.meta.url),
  'utf8',
);
const registrationPlanSource = readFileSync(
  new URL('../browser-app-check/registration-plan.mjs', import.meta.url),
  'utf8',
);
const registrationRecoveryApplySource = readFileSync(
  new URL('../browser-app-check/registration-recovery-apply.mjs', import.meta.url),
  'utf8',
);
const registrationRecoveryPlanSource = readFileSync(
  new URL('../browser-app-check/registration-recovery-plan.mjs', import.meta.url),
  'utf8',
);
const terraformSource = [
  'main.tf',
  'outputs.tf',
].map((name) => readFileSync(
  new URL(`../browser-app-check/${name}`, import.meta.url),
  'utf8',
)).join('\n');

function foundation() {
  return {
    component_bucket: 'miakapp-v4-staging-components',
    firestore_database: '(default)',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: 'europe-west9',
    runtime_service_account: `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`,
    secret_ids: [
      'miakapp-audit-hmac',
      'miakapp-component-hmac',
      'miakapp-home-key-pepper',
      'miakapp-network-hmac',
      'miakapp-push-hmac',
    ],
    signing_key: `projects/${PROJECT_ID}/locations/europe-west9/keyRings/${PROJECT_ID}/cryptoKeys/access-token-signing`,
  };
}

function providerExpressions() {
  return {
    add_terraform_attribution_label: { constant_value: false },
    billing_project: { references: ['local.project_id'] },
    default_labels: { references: ['local.labels'] },
    project: { references: ['local.project_id'] },
    region: { references: ['local.region'] },
    user_project_override: { constant_value: true },
  };
}

function guardValue() {
  const input = {
    foundation: foundation(),
    web_app: {
      app_id: FIREBASE_APP_ID,
      display_name: FIREBASE_APP_DISPLAY_NAME,
      name: FIREBASE_APP_NAME,
    },
  };
  return {
    id: '41e73c7b-673c-518a-7e3e-24d22cc239de',
    input,
    output: structuredClone(input),
    triggers_replace: null,
  };
}

function guardSensitivity() {
  return {
    input: {
      foundation: { secret_ids: [false, false, false, false, false] },
      web_app: {},
    },
    output: {
      foundation: { secret_ids: [false, false, false, false, false] },
      web_app: {},
    },
  };
}

function keyValue() {
  return {
    android_settings: [],
    create_time: CONTRACT.key_create_time,
    deletion_policy: 'DELETE',
    display_name: RECAPTCHA_DISPLAY_NAME,
    effective_labels: LABELS,
    id: KEY_RESOURCE_NAME,
    ios_settings: [],
    labels: LABELS,
    name: SITE_KEY,
    project: PROJECT_ID,
    terraform_labels: LABELS,
    testing_options: [],
    timeouts: null,
    waf_settings: [],
    web_settings: [{
      allow_all_domains: false,
      allow_amp_traffic: false,
      allowed_domains: [HOSTING_DOMAIN],
      challenge_security_preference: 'CHALLENGE_SECURITY_PREFERENCE_UNSPECIFIED',
      challenge_settings: [],
      integration_type: 'SCORE',
    }],
  };
}

function keySensitivity() {
  return {
    android_settings: [],
    effective_labels: {},
    ios_settings: [],
    labels: {},
    terraform_labels: {},
    testing_options: [],
    waf_settings: [],
    web_settings: [{
      allowed_domains: [false],
      challenge_settings: [],
    }],
  };
}

function configurationResources() {
  return [
    {
      address: 'data.terraform_remote_state.foundation',
      mode: 'data',
      type: 'terraform_remote_state',
      name: 'foundation',
      provider_config_key: 'terraform',
      expressions: {
        backend: { constant_value: 'gcs' },
        config: { references: ['local.state_bucket_name', 'local.foundation_prefix'] },
      },
      schema_version: 0,
    },
    {
      address: 'data.google_firebase_web_app.staging',
      mode: 'data',
      type: 'google_firebase_web_app',
      name: 'staging',
      provider_config_key: 'google-beta',
      expressions: {
        app_id: { references: ['local.firebase_app_id'] },
        project: { references: ['local.project_id'] },
      },
      schema_version: 0,
    },
    {
      address: 'terraform_data.browser_app_check_guard',
      mode: 'managed',
      type: 'terraform_data',
      name: 'browser_app_check_guard',
      provider_config_key: 'terraform',
      expressions: {
        input: {
          references: [
            'data.terraform_remote_state.foundation.outputs.staging_foundation',
            'data.google_firebase_web_app.staging.app_id',
            'data.google_firebase_web_app.staging.display_name',
            'data.google_firebase_web_app.staging.name',
          ],
        },
      },
      schema_version: 0,
    },
    {
      address: 'google_project_service.recaptcha_enterprise',
      mode: 'managed',
      type: 'google_project_service',
      name: 'recaptcha_enterprise',
      provider_config_key: 'google',
      depends_on: ['terraform_data.browser_app_check_guard'],
      expressions: {
        deletion_policy: { constant_value: 'PREVENT' },
        disable_dependent_services: { constant_value: false },
        disable_on_destroy: { constant_value: false },
        project: { references: ['local.project_id'] },
        service: { references: ['local.recaptcha_api'] },
      },
      schema_version: 0,
    },
    {
      address: 'google_recaptcha_enterprise_key.browser_app_check',
      mode: 'managed',
      type: 'google_recaptcha_enterprise_key',
      name: 'browser_app_check',
      provider_config_key: 'google',
      depends_on: ['google_project_service.recaptcha_enterprise'],
      expressions: {
        deletion_policy: { constant_value: 'DELETE' },
        display_name: { references: ['local.recaptcha_display_name'] },
        labels: { references: ['local.labels'] },
        project: { references: ['local.project_id'] },
        web_settings: [{
          allow_all_domains: { constant_value: false },
          allow_amp_traffic: { constant_value: false },
          allowed_domains: { references: ['local.hosting_domain'] },
          integration_type: { constant_value: 'SCORE' },
        }],
      },
      schema_version: 0,
    },
    {
      address: BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
      mode: 'managed',
      type: 'google_firebase_app_check_recaptcha_enterprise_config',
      name: 'browser_app_check',
      provider_config_key: 'google-beta',
      depends_on: ['google_recaptcha_enterprise_key.browser_app_check'],
      expressions: {
        app_id: {
          references: [
            'data.google_firebase_web_app.staging.app_id',
            'data.google_firebase_web_app.staging',
          ],
        },
        project: { references: ['local.project_id'] },
        site_key: {
          references: [
            'google_recaptcha_enterprise_key.browser_app_check.name',
            'google_recaptcha_enterprise_key.browser_app_check',
          ],
        },
        token_ttl: { constant_value: APP_CHECK_REGISTRATION_TTL },
      },
      schema_version: 0,
    },
  ];
}

function outputReferences() {
  return [
    'data.google_firebase_web_app.staging',
    'data.google_firebase_web_app.staging.app_id',
    'data.google_firebase_web_app.staging.display_name',
    BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
    `${BROWSER_APP_CHECK_REGISTRATION_ADDRESS}.name`,
    `${BROWSER_APP_CHECK_REGISTRATION_ADDRESS}.site_key`,
    `${BROWSER_APP_CHECK_REGISTRATION_ADDRESS}.token_ttl`,
    'google_project_service.recaptcha_enterprise',
    'google_project_service.recaptcha_enterprise.service',
    'google_recaptcha_enterprise_key.browser_app_check',
    'google_recaptcha_enterprise_key.browser_app_check.display_name',
    'google_recaptcha_enterprise_key.browser_app_check.testing_options',
    'google_recaptcha_enterprise_key.browser_app_check.waf_settings',
    'google_recaptcha_enterprise_key.browser_app_check.web_settings',
    'google_recaptcha_enterprise_key.browser_app_check.web_settings[0]',
    'google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allow_all_domains',
    'google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allow_amp_traffic',
    'google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allowed_domains',
    'google_recaptcha_enterprise_key.browser_app_check.web_settings[0].integration_type',
    'local.project_id',
    'local.project_number',
  ];
}

function relevantAttributes() {
  return [
    { resource: 'data.google_firebase_web_app.staging', attribute: ['app_id'] },
    { resource: 'data.google_firebase_web_app.staging', attribute: ['display_name'] },
    { resource: BROWSER_APP_CHECK_REGISTRATION_ADDRESS, attribute: ['name'] },
    { resource: BROWSER_APP_CHECK_REGISTRATION_ADDRESS, attribute: ['site_key'] },
    { resource: BROWSER_APP_CHECK_REGISTRATION_ADDRESS, attribute: ['token_ttl'] },
    { resource: 'google_project_service.recaptcha_enterprise', attribute: ['service'] },
    { resource: 'google_recaptcha_enterprise_key.browser_app_check', attribute: ['display_name'] },
    { resource: 'google_recaptcha_enterprise_key.browser_app_check', attribute: ['name'] },
    { resource: 'google_recaptcha_enterprise_key.browser_app_check', attribute: ['testing_options'] },
    { resource: 'google_recaptcha_enterprise_key.browser_app_check', attribute: ['waf_settings'] },
    { resource: 'google_recaptcha_enterprise_key.browser_app_check', attribute: ['web_settings', 0, 'allow_all_domains'] },
    { resource: 'google_recaptcha_enterprise_key.browser_app_check', attribute: ['web_settings', 0, 'allow_amp_traffic'] },
    { resource: 'google_recaptcha_enterprise_key.browser_app_check', attribute: ['web_settings', 0, 'allowed_domains'] },
    { resource: 'google_recaptcha_enterprise_key.browser_app_check', attribute: ['web_settings', 0, 'integration_type'] },
  ];
}

function resourceChanges() {
  const service = {
    deletion_policy: 'PREVENT',
    disable_dependent_services: false,
    disable_on_destroy: false,
    id: `${PROJECT_ID}/${RECAPTCHA_API}`,
    project: PROJECT_ID,
    service: RECAPTCHA_API,
    timeouts: null,
  };
  const key = keyValue();
  const guard = guardValue();
  return [
    {
      address: BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
      mode: 'managed',
      type: 'google_firebase_app_check_recaptcha_enterprise_config',
      name: 'browser_app_check',
      provider_name: 'registry.terraform.io/hashicorp/google-beta',
      change: {
        actions: ['create'],
        before: null,
        after: {
          app_id: FIREBASE_APP_ID,
          project: PROJECT_ID,
          site_key: SITE_KEY,
          timeouts: null,
          token_ttl: APP_CHECK_REGISTRATION_TTL,
        },
        after_unknown: { id: true, name: true },
        before_sensitive: false,
        after_sensitive: {},
      },
    },
    {
      address: 'google_project_service.recaptcha_enterprise',
      mode: 'managed',
      type: 'google_project_service',
      name: 'recaptcha_enterprise',
      provider_name: 'registry.terraform.io/hashicorp/google',
      change: {
        actions: ['no-op'],
        before: service,
        after: structuredClone(service),
        after_unknown: {},
        before_sensitive: {},
        after_sensitive: {},
      },
    },
    {
      address: 'google_recaptcha_enterprise_key.browser_app_check',
      mode: 'managed',
      type: 'google_recaptcha_enterprise_key',
      name: 'browser_app_check',
      provider_name: 'registry.terraform.io/hashicorp/google',
      change: {
        actions: ['no-op'],
        before: key,
        after: structuredClone(key),
        after_unknown: {},
        before_sensitive: keySensitivity(),
        after_sensitive: keySensitivity(),
      },
    },
    {
      address: 'terraform_data.browser_app_check_guard',
      mode: 'managed',
      type: 'terraform_data',
      name: 'browser_app_check_guard',
      provider_name: 'terraform.io/builtin/terraform',
      change: {
        actions: ['no-op'],
        before: guard,
        after: structuredClone(guard),
        after_unknown: {},
        before_sensitive: guardSensitivity(),
        after_sensitive: guardSensitivity(),
      },
    },
  ];
}

function syntheticPlan() {
  const managedAddresses = [
    BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
    'google_project_service.recaptcha_enterprise',
    'google_recaptcha_enterprise_key.browser_app_check',
    'terraform_data.browser_app_check_guard',
  ];
  const priorAddresses = [
    'data.google_firebase_web_app.staging',
    'data.terraform_remote_state.foundation',
    'google_project_service.recaptcha_enterprise',
    'google_recaptcha_enterprise_key.browser_app_check',
    'terraform_data.browser_app_check_guard',
  ];
  return {
    format_version: '1.2',
    terraform_version: TERRAFORM_VERSION,
    applyable: true,
    complete: true,
    errored: false,
    timestamp: CREATED_AT.replace('.000', ''),
    planned_values: {
      root_module: { resources: managedAddresses.map((address) => ({ address })) },
    },
    resource_changes: resourceChanges(),
    output_changes: {
      staging_browser_app_check_key: {
        actions: ['update'],
        before: browserAppCheckKeyOutput(),
        after: browserAppCheckRegistrationOutput(false, CONTRACT),
        after_unknown: {
          app_check_config_name: true,
          recaptcha_allowed_domains: [false],
        },
        before_sensitive: false,
        after_sensitive: false,
      },
    },
    prior_state: {
      values: { root_module: { resources: priorAddresses.map((address) => ({ address })) } },
    },
    configuration: {
      provider_config: {
        google: {
          name: 'google',
          full_name: 'registry.terraform.io/hashicorp/google',
          version_constraint: '8.1.0',
          expressions: providerExpressions(),
        },
        'google-beta': {
          name: 'google-beta',
          full_name: 'registry.terraform.io/hashicorp/google-beta',
          version_constraint: '8.1.0',
          expressions: providerExpressions(),
        },
        terraform: {
          name: 'terraform',
          full_name: 'terraform.io/builtin/terraform',
        },
      },
      root_module: {
        outputs: {
          staging_browser_app_check_key: {
            expression: { references: outputReferences() },
            description: 'Non-secret result of the isolated staging browser App Check registration prerequisite.',
          },
        },
        resources: configurationResources(),
      },
    },
    relevant_attributes: relevantAttributes(),
    checks: [{
      address: { to_display: 'terraform_data.browser_app_check_guard' },
      status: 'pass',
      instances: [{
        address: { to_display: 'terraform_data.browser_app_check_guard' },
        status: 'pass',
      }],
    }],
  };
}

function syntheticReconciliationPlan() {
  const plan = syntheticPlan();
  const registration = plan.resource_changes.find(
    ({ address }) => address === BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
  );
  const config = {
    app_id: FIREBASE_APP_ID,
    id: BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID,
    name: FIREBASE_APP_CONFIG_NAME,
    project: PROJECT_ID,
    site_key: SITE_KEY,
    timeouts: null,
    token_ttl: APP_CHECK_REGISTRATION_TTL,
  };
  registration.change = {
    actions: ['no-op'],
    before: config,
    after: structuredClone(config),
    after_unknown: {},
    before_sensitive: {},
    after_sensitive: {},
  };
  plan.output_changes.staging_browser_app_check_key = {
    actions: ['update'],
    before: browserAppCheckKeyOutput(),
    after: browserAppCheckRegistrationOutput(true, CONTRACT),
    after_unknown: { recaptcha_allowed_domains: [false] },
    before_sensitive: false,
    after_sensitive: false,
  };
  plan.prior_state.values.root_module.resources.push({
    address: BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
  });
  return plan;
}

function planMetadata() {
  const summary = {
    ...validateBrowserAppCheckRegistrationPlanFixture(syntheticPlan(), CONTRACT),
    app_check_site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
  };
  return buildBrowserAppCheckRegistrationPlanMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    planBytes: PLAN_BYTES,
    planJsonBytes: PLAN_JSON_BYTES,
    summary,
    baseline: {
      key_attempt_claim: { schema: 'pinned-key-claim' },
      registration_attempt_claim: browserAppCheckRegistrationAttemptClaimAbsence(),
      provider_attempt_claim: browserAppCheckProviderAttemptClaimAbsence(),
      inventory: { schema: 'exact-current-key-inventory' },
      terraform_state: KEY_PREREQUISITE_TERRAFORM_STATE,
    },
  });
}

function registrationClaimReceipt(metadata = planMetadata()) {
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-attempt-claim-receipt/1',
    bucket: BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT,
    generation: '1788600000000000',
    size_bytes: 1_024,
    sha256: '8'.repeat(64),
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    operator_user_sha256: OPERATOR_USER_SHA256,
    expires_at: metadata.expires_at,
    firebase_app_id: FIREBASE_APP_ID,
    app_check_config_name: FIREBASE_APP_CONFIG_NAME,
    recaptcha_key_resource_name_sha256:
      KEY_PREREQUISITE_TERRAFORM_STATE.recaptcha_key_name_sha256,
    app_check_site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
    app_check_token_ttl: APP_CHECK_REGISTRATION_TTL,
    app_check_minimum_valid_score: DEFAULT_RISK_SCORE,
    terraform_state_generation: KEY_PREREQUISITE_TERRAFORM_STATE.generation,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

function providerAttemptClaimReceipt(metadata, registrationClaim) {
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-provider-attempt-claim-receipt/1',
    bucket: BROWSER_APP_CHECK_PROVIDER_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
    generation: '1788600000000001',
    size_bytes: 1_024,
    sha256: 'b'.repeat(64),
    repository_commit: metadata.repository_commit,
    terraform_plan_sha256: metadata.terraform_plan_sha256,
    baseline_sha256: metadata.baseline_sha256,
    registration_claim_generation: registrationClaim.generation,
    registration_claim_sha256: registrationClaim.sha256,
    operator_user_sha256: OPERATOR_USER_SHA256,
    firebase_app_id: FIREBASE_APP_ID,
    app_check_config_name: FIREBASE_APP_CONFIG_NAME,
    recaptcha_key_resource_name_sha256:
      KEY_PREREQUISITE_TERRAFORM_STATE.recaptcha_key_name_sha256,
    app_check_site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
    app_check_token_ttl: APP_CHECK_REGISTRATION_TTL,
    app_check_minimum_valid_score: DEFAULT_RISK_SCORE,
    terraform_state_generation: KEY_PREREQUISITE_TERRAFORM_STATE.generation,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

function response(status, value = '') {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return {
    status,
    arrayBuffer: async () => bytes,
  };
}

function syntheticRecoveryState(
  configStatus = 'absent',
  configName = FIREBASE_APP_CONFIG_NAME,
  outputProfile = configStatus === 'absent' ? 'key' : 'registration',
) {
  const resources = [
    {
      mode: 'data',
      type: 'google_firebase_web_app',
      name: 'staging',
      provider: 'provider["registry.terraform.io/hashicorp/google-beta"]',
      instances: [{ schema_version: 0, attributes: {} }],
    },
    {
      mode: 'data',
      type: 'terraform_remote_state',
      name: 'foundation',
      provider: 'provider["terraform.io/builtin/terraform"]',
      instances: [{ schema_version: 0, attributes: {} }],
    },
    {
      mode: 'managed',
      type: 'google_project_service',
      name: 'recaptcha_enterprise',
      provider: 'provider["registry.terraform.io/hashicorp/google"]',
      instances: [{ schema_version: 0, attributes: {} }],
    },
    {
      mode: 'managed',
      type: 'google_recaptcha_enterprise_key',
      name: 'browser_app_check',
      provider: 'provider["registry.terraform.io/hashicorp/google"]',
      instances: [{ schema_version: 0, attributes: keyValue() }],
    },
    {
      mode: 'managed',
      type: 'terraform_data',
      name: 'browser_app_check_guard',
      provider: 'provider["terraform.io/builtin/terraform"]',
      instances: [{ schema_version: 0, attributes: {} }],
    },
  ];
  if (configStatus !== 'absent') {
    resources.push({
      mode: 'managed',
      type: 'google_firebase_app_check_recaptcha_enterprise_config',
      name: 'browser_app_check',
      provider: 'provider["registry.terraform.io/hashicorp/google-beta"]',
      instances: [{
        schema_version: 0,
        ...(configStatus === 'tainted' ? { status: 'tainted' } : {}),
        attributes: {
          app_id: FIREBASE_APP_ID,
          id: BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID,
          name: configName,
          project: PROJECT_ID,
          site_key: SITE_KEY,
          timeouts: null,
          token_ttl: APP_CHECK_REGISTRATION_TTL,
        },
      }],
    });
  }
  return Buffer.from(`${JSON.stringify({
    version: 4,
    terraform_version: TERRAFORM_VERSION,
    serial: configStatus === 'absent' ? 4 : 5,
    lineage: '8193b94a-1d8f-4143-a878-29342f91c0e2',
    outputs: {
      staging_browser_app_check_key: {
        value: outputProfile === 'key'
          ? browserAppCheckKeyOutput()
          : browserAppCheckRegistrationOutput(true, CONTRACT),
        type: ['object', {}],
      },
    },
    resources,
    check_results: [{
      object_kind: 'resource',
      config_addr: 'terraform_data.browser_app_check_guard',
      status: 'pass',
      objects: [{
        object_addr: 'terraform_data.browser_app_check_guard',
        status: 'pass',
      }],
    }],
  })}\n`);
}

test('accepts only one exact non-deletable provider registration', () => {
  const summary = validateBrowserAppCheckRegistrationPlanFixture(syntheticPlan(), CONTRACT);
  assert.deepEqual(summary, {
    create: 1,
    update: 0,
    delete: 0,
    replace: 0,
    import: 0,
    output_updates: 1,
    recaptcha_api_changes: 0,
    recaptcha_key_changes: 0,
    app_check_registrations: 1,
    app_check_registration_deletions: 0,
    app_check_token_ttl: '3600s',
    app_check_minimum_valid_score: DEFAULT_RISK_SCORE,
    app_check_site_key_sha256: CONTRACT.site_key_sha256,
    app_check_enforcement: false,
    debug_tokens: 0,
    browser_requests: 0,
    assessments: 0,
    public_ingress: false,
    fixed_cost_services: 0,
    irreversible_app_check_registration: true,
    resource_addresses: [BROWSER_APP_CHECK_REGISTRATION_ADDRESS],
  });
  assert.match(terraformSource, /prevent_destroy\s+= true/u);
  assert.doesNotMatch(
    terraformSource,
    /google_firebase_app_check_service_config|google_firebase_app_check_debug_token/u,
  );
});

test('accepts only a known-name, output-only registration reconciliation', () => {
  assert.deepEqual(
    validateBrowserAppCheckRegistrationReconciliationPlanFixture(
      syntheticReconciliationPlan(),
      CONTRACT,
    ),
    {
      create: 0,
      update: 0,
      delete: 0,
      replace: 0,
      import: 0,
      output_updates: 1,
      cloud_mutations: 0,
      app_check_registration_no_op: 1,
      recaptcha_api_changes: 0,
      recaptcha_key_changes: 0,
      app_check_enforcement: false,
      debug_tokens: 0,
      browser_requests: 0,
      assessments: 0,
      public_ingress: false,
      fixed_cost_services: 0,
    },
  );
  const unknownName = syntheticReconciliationPlan();
  unknownName.output_changes.staging_browser_app_check_key.after =
    browserAppCheckRegistrationOutput(false, CONTRACT);
  unknownName.output_changes.staging_browser_app_check_key.after_unknown = {
    app_check_config_name: true,
    recaptcha_allowed_domains: [false],
  };
  assert.throws(
    () => validateBrowserAppCheckRegistrationReconciliationPlanFixture(
      unknownName,
      CONTRACT,
    ),
    /reconciliation output/u,
  );
});

test('rejects update, replacement, provider, TTL, site-key and target drift', () => {
  for (const mutate of [
    (plan) => { plan.resource_changes[0].change.actions = ['update']; },
    (plan) => { plan.resource_changes[0].change.actions = ['delete', 'create']; },
    (plan) => { plan.resource_changes[0].provider_name = 'registry.terraform.io/hashicorp/google'; },
    (plan) => { plan.resource_changes[0].change.after.token_ttl = '7200s'; },
    (plan) => { plan.resource_changes[0].change.after.site_key = 'x'.repeat(40); },
    (plan) => { plan.resource_changes[1].change.actions = ['update']; },
    (plan) => { plan.configuration.root_module.resources.push({ address: 'google_project_iam_member.admin' }); },
    (plan) => { plan.output_changes.staging_browser_app_check_key.after.app_check_enforcement = true; },
  ]) {
    const candidate = syntheticPlan();
    mutate(candidate);
    assert.throws(
      () => validateBrowserAppCheckRegistrationPlanFixture(candidate, CONTRACT),
      /Browser App Check|does not match|drifted|reviewed/u,
    );
  }
});

test('binds short-lived authorization and metadata to exact private plan bytes', () => {
  const metadata = planMetadata();
  assert.equal(metadata.operation, APP_CHECK_REGISTRATION_OPERATION);
  assert.equal(metadata.irreversible_app_check_registration, true);
  assert.equal(metadata.app_check_registration_deletion_authorized, false);
  const authorization = browserAppCheckRegistrationAuthorization(
    PLAN_BYTES,
    COMMIT,
    metadata.baseline_sha256,
  );
  validateBrowserAppCheckRegistrationAuthorization(
    authorization,
    PLAN_BYTES,
    COMMIT,
    metadata.baseline_sha256,
  );
  assert.throws(
    () => validateBrowserAppCheckRegistrationAuthorization(
      authorization,
      Buffer.from('different'),
      COMMIT,
      metadata.baseline_sha256,
    ),
    /missing or invalid/u,
  );
  assert.deepEqual(
    validateBrowserAppCheckRegistrationPlanMetadata(metadata, Date.parse(CREATED_AT)),
    metadata,
  );
  assert.throws(
    () => validateBrowserAppCheckRegistrationPlanMetadata(
      metadata,
      Date.parse(metadata.expires_at) + 1,
    ),
    /expired/u,
  );
});

test('creates one atomic, digest-bound registration claim and rejects races', async () => {
  const metadata = planMetadata();
  let claimBytes;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'storage.googleapis.com'
      && parsed.pathname.startsWith('/upload/storage/v1/')) {
      assert.equal(parsed.searchParams.get('ifGenerationMatch'), '0');
      claimBytes = Buffer.from(options.body);
      return response(200, {
        bucket: BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_BUCKET,
        name: BROWSER_APP_CHECK_REGISTRATION_ATTEMPT_OBJECT,
        generation: '1788600000000000',
        size: String(claimBytes.byteLength),
      });
    }
    return response(200, claimBytes);
  };
  const receipt = await createBrowserAppCheckRegistrationAttemptClaim(
    { accessToken: 't'.repeat(40) },
    metadata,
    '2026-09-05T12:01:00.000Z',
    fetchImpl,
  );
  validateBrowserAppCheckRegistrationAttemptClaimReceipt(receipt, metadata);
  assert.equal(receipt.firebase_app_id, FIREBASE_APP_ID);
  assert.equal(receipt.app_check_config_name, FIREBASE_APP_CONFIG_NAME);
  assert.equal(receipt.app_check_token_ttl, APP_CHECK_REGISTRATION_TTL);
  assert.equal(receipt.app_check_minimum_valid_score, DEFAULT_RISK_SCORE);
  assert.equal(receipt.terraform_state_generation, KEY_PREREQUISITE_TERRAFORM_STATE.generation);
  assert.equal(receipt.retry_authorized, false);

  await assert.rejects(
    createBrowserAppCheckRegistrationAttemptClaim(
      { accessToken: 't'.repeat(40) },
      metadata,
      '2026-09-05T12:01:00.000Z',
      async () => response(412, {}),
    ),
    /already acquired/u,
  );
});

test('atomically binds one global provider attempt to the consumed saved plan', async () => {
  const metadata = planMetadata();
  const registrationClaim = registrationClaimReceipt(metadata);
  let claimBytes;
  let occupied = false;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/upload/storage/v1/')) {
      assert.equal(parsed.searchParams.get('name'), BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT);
      assert.equal(parsed.searchParams.get('ifGenerationMatch'), '0');
      if (occupied) return response(412, {});
      occupied = true;
      claimBytes = Buffer.from(options.body);
      return response(200, {
        bucket: BROWSER_APP_CHECK_PROVIDER_ATTEMPT_BUCKET,
        name: BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
        generation: '1788600000000001',
        size: String(claimBytes.byteLength),
      });
    }
    return response(200, claimBytes);
  };
  const receipt = await createBrowserAppCheckProviderAttemptClaim(
    { accessToken: 't'.repeat(40) },
    metadata,
    registrationClaim,
    '2026-09-05T12:01:30.000Z',
    fetchImpl,
  );
  validateBrowserAppCheckProviderAttemptClaimReceipt(
    receipt,
    metadata,
    registrationClaim,
  );
  assert.equal(receipt.registration_claim_generation, registrationClaim.generation);
  assert.equal(receipt.registration_claim_sha256, registrationClaim.sha256);
  assert.equal(receipt.retry_authorized, false);
  await assert.rejects(
    createBrowserAppCheckProviderAttemptClaim(
      { accessToken: 't'.repeat(40) },
      metadata,
      registrationClaim,
      '2026-09-05T12:01:31.000Z',
      fetchImpl,
    ),
    /already acquired/u,
  );
});

test('binds recovery to exact live/state profiles and authorizes only pre-PATCH resume', () => {
  const registrationMetadata = planMetadata();
  const registrationClaim = registrationClaimReceipt(registrationMetadata);
  const providerAttemptClaim = providerAttemptClaimReceipt(
    registrationMetadata,
    registrationClaim,
  );
  for (const [status, action] of [
    ['absent', 'import'],
    ['tainted', 'reimport'],
    ['managed', 'reconcile'],
  ]) {
    const recovery = buildBrowserAppCheckRegistrationRecoveryMetadata({
      registrationMetadata,
      createdAt: CREATED_AT,
      stateGeneration: '1788600000000001',
      state: {
        serial: 5,
        lineage_sha256: KEY_PREREQUISITE_TERRAFORM_STATE.lineage_sha256,
        sha256: '7'.repeat(64),
        size_bytes: 15_000,
        config_status: status,
        output_profile: status === 'absent' ? 'key' : 'registration',
        recovery_action: action,
      },
      liveProviderStatus: 'registered',
      liveInventorySha256: '6'.repeat(64),
      keyAttemptClaim: KEY_PREREQUISITE_ATTEMPT_CLAIM,
      registrationClaim,
      providerAttemptClaim,
    });
    assert.equal(recovery.action, action);
    assert.equal(recovery.cloud_resource_mutation_authorized, false);
    assert.equal(recovery.original_plan_replay_authorized, false);
    assert.equal(recovery.provider_update_authorized, false);
    assert.equal(recovery.provider_deletion_authorized, false);
    assert.equal(recovery.provider_registration_patch_authorized, false);
    assert.equal(recovery.original_saved_plan_resume_authorized, false);
    assert.equal(recovery.provider_attempt_claim_state, 'present');
    assert.equal(
      recovery.provider_attempt_claim_generation,
      providerAttemptClaim.generation,
    );
    assert.equal(recovery.global_provider_attempt_claim_creation_authorized, false);
    validateBrowserAppCheckRegistrationRecoveryMetadata(recovery, Date.parse(CREATED_AT));
    const authorization = browserAppCheckRegistrationRecoveryAuthorization(recovery);
    validateBrowserAppCheckRegistrationRecoveryAuthorization(authorization, recovery);
    assert.throws(
      () => validateBrowserAppCheckRegistrationRecoveryAuthorization(
        authorization.replace(recovery.state_sha256, '0'.repeat(64)),
        recovery,
      ),
      /missing or invalid/u,
    );
  }
  const resume = buildBrowserAppCheckRegistrationRecoveryMetadata({
    registrationMetadata,
    createdAt: CREATED_AT,
    stateGeneration: KEY_PREREQUISITE_TERRAFORM_STATE.generation,
    state: {
      serial: KEY_PREREQUISITE_TERRAFORM_STATE.serial,
      lineage_sha256: KEY_PREREQUISITE_TERRAFORM_STATE.lineage_sha256,
      sha256: KEY_PREREQUISITE_TERRAFORM_STATE.sha256,
      size_bytes: KEY_PREREQUISITE_TERRAFORM_STATE.size_bytes,
      config_status: 'absent',
      output_profile: 'key',
    },
    liveProviderStatus: 'unregistered',
    liveInventorySha256: '5'.repeat(64),
    keyAttemptClaim: KEY_PREREQUISITE_ATTEMPT_CLAIM,
    registrationClaim,
    providerAttemptClaim: browserAppCheckProviderAttemptClaimAbsence(),
  });
  assert.equal(resume.action, 'resume-before-patch');
  assert.equal(resume.cloud_resource_mutation_authorized, true);
  assert.equal(resume.provider_registration_patch_authorized, true);
  assert.equal(resume.original_saved_plan_resume_authorized, true);
  assert.equal(resume.original_plan_replay_authorized, false);
  assert.equal(resume.provider_attempt_claim_state, 'absent');
  assert.equal(resume.provider_attempt_claim_generation, null);
  assert.equal(resume.provider_attempt_claim_sha256, null);
  assert.equal(resume.global_provider_attempt_claim_creation_authorized, true);
  validateBrowserAppCheckRegistrationRecoveryMetadata(resume, Date.parse(CREATED_AT));
  assert.deepEqual(
    validateBrowserAppCheckRegistrationProviderAttemptBoundary('unregistered', 'absent'),
    {
      live_provider_status: 'unregistered',
      provider_attempt_claim_state: 'absent',
      pre_patch_resume_permitted: true,
    },
  );
  assert.throws(
    () => validateBrowserAppCheckRegistrationProviderAttemptBoundary('unregistered', 'present'),
    /ambiguous/u,
  );
  assert.throws(
    () => validateBrowserAppCheckRegistrationProviderAttemptBoundary('registered', 'absent'),
    /global provider-attempt claim/u,
  );
  assert.equal(BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID, `projects/${PROJECT_ID}/apps/${FIREBASE_APP_ID}/recaptchaEnterpriseConfig`);
});

test('routes exact live/state pairs and accepts only reviewed tainted partial state', () => {
  for (const [status, action] of [
    ['absent', 'import'],
    ['tainted', 'reimport'],
    ['managed', 'reconcile'],
  ]) {
    const state = inspectBrowserAppCheckRegistrationStateFixture(
      syntheticRecoveryState(status),
      RECOVERY_CONTRACT,
    );
    assert.equal(state.config_status, status);
    assert.equal(
      selectBrowserAppCheckRegistrationRecoveryAction(state, 'registered'),
      action,
    );
    assert.equal(state.app_check_site_key_sha256, CONTRACT.site_key_sha256);
  }
  const unregistered = inspectBrowserAppCheckRegistrationStateFixture(
    syntheticRecoveryState('absent'),
    RECOVERY_CONTRACT,
  );
  assert.equal(
    selectBrowserAppCheckRegistrationRecoveryAction(unregistered, 'unregistered'),
    'resume-before-patch',
  );
  assert.throws(
    () => selectBrowserAppCheckRegistrationRecoveryAction(
      inspectBrowserAppCheckRegistrationStateFixture(
        syntheticRecoveryState('tainted'),
        RECOVERY_CONTRACT,
      ),
      'unregistered',
    ),
    /incompatible/u,
  );
  const partial = inspectBrowserAppCheckRegistrationStateFixture(
    syntheticRecoveryState('tainted', null),
    RECOVERY_CONTRACT,
  );
  assert.equal(partial.config_status, 'tainted');
  assert.equal(
    selectBrowserAppCheckRegistrationRecoveryAction(partial, 'registered'),
    'reimport',
  );
  const interruptedReimport = inspectBrowserAppCheckRegistrationStateFixture(
    syntheticRecoveryState('absent', FIREBASE_APP_CONFIG_NAME, 'registration'),
    RECOVERY_CONTRACT,
  );
  assert.equal(interruptedReimport.config_status, 'absent');
  assert.equal(interruptedReimport.output_profile, 'registration');
  assert.equal(
    selectBrowserAppCheckRegistrationRecoveryAction(interruptedReimport, 'registered'),
    'import',
  );
  assert.throws(
    () => selectBrowserAppCheckRegistrationRecoveryAction(
      interruptedReimport,
      'unregistered',
    ),
    /incompatible/u,
  );
  assert.throws(
    () => inspectBrowserAppCheckRegistrationStateFixture(
      syntheticRecoveryState('managed', null),
      RECOVERY_CONTRACT,
    ),
    /foreign provider/u,
  );
  const wrongKey = JSON.parse(syntheticRecoveryState('managed').toString('utf8'));
  const config = wrongKey.resources.find(
    ({ type }) => type === 'google_firebase_app_check_recaptcha_enterprise_config',
  );
  config.instances[0].attributes.site_key = 'x'.repeat(40);
  assert.throws(
    () => inspectBrowserAppCheckRegistrationStateFixture(
      Buffer.from(JSON.stringify(wrongKey)),
      RECOVERY_CONTRACT,
    ),
    /foreign provider/u,
  );
  const foreign = JSON.parse(syntheticRecoveryState('managed').toString('utf8'));
  foreign.resources.push({
    mode: 'managed',
    type: 'google_project_iam_member',
    name: 'admin',
    provider: 'provider["registry.terraform.io/hashicorp/google"]',
    instances: [{ schema_version: 0, attributes: {} }],
  });
  assert.throws(
    () => inspectBrowserAppCheckRegistrationStateFixture(
      Buffer.from(JSON.stringify(foreign)),
      RECOVERY_CONTRACT,
    ),
    /unreviewed resource/u,
  );
});

test('creates a fresh immutable child bundle after a failed recovery attempt', () => {
  const privateParent = mkdtempSync(join(tmpdir(), 'miakapp-registration-recovery-test-'));
  const fakeRepository = mkdtempSync(join(tmpdir(), 'miakapp-registration-repository-test-'));
  chmodSync(privateParent, 0o700);
  chmodSync(fakeRepository, 0o700);
  try {
    const source = createPrivateBrowserAppCheckBundle(privateParent, fakeRepository);
    const first = createBrowserAppCheckRegistrationRecoveryBundle(source, fakeRepository);
    const marker = join(first, 'registration-state-recovery-attempted.json');
    writeFileSync(marker, '{}', { mode: 0o400, flag: 'wx' });
    chmodSync(marker, 0o400);
    const second = createBrowserAppCheckRegistrationRecoveryBundle(source, fakeRepository);
    assert.notEqual(first, second);
    assert.equal(browserAppCheckRegistrationRecoverySourceBundle(first, fakeRepository), source);
    assert.equal(browserAppCheckRegistrationRecoverySourceBundle(second, fakeRepository), source);
    assert.equal(readFileSync(marker, 'utf8'), '{}');
  } finally {
    rmSync(privateParent, { recursive: true, force: true });
    rmSync(fakeRepository, { recursive: true, force: true });
  }
});

test('orders the irreversible gate and keeps recovery claim-bound', () => {
  const marker = registrationApplySource.lastIndexOf('writeMutationAttemptMarker(');
  const claim = registrationApplySource.lastIndexOf('createBrowserAppCheckRegistrationAttemptClaim(');
  const secondInventory = registrationApplySource.lastIndexOf('observePrerequisitesAfterClaim(');
  const providerClaim = registrationApplySource.lastIndexOf(
    'createBrowserAppCheckProviderAttemptClaim(',
  );
  const apply = registrationApplySource.lastIndexOf(
    "const applied = run('terraform', applyArguments, applyOptions);",
  );
  assert.ok(marker > 0 && marker < claim && claim < secondInventory
    && secondInventory < providerClaim && providerClaim < apply);
  const providerClaimReadBack = registrationApplySource.indexOf(
    ');',
    providerClaim,
  );
  assert.equal(
    registrationApplySource.slice(providerClaimReadBack + 2, apply).trim(),
    '',
  );
  assert.match(registrationPlanSource, /observeBrowserAppCheckRegistrationBaseline/u);
  assert.match(registrationPlanSource, /postPlanBaseline/u);
  assert.match(registrationRecoveryPlanSource, /createBrowserAppCheckRegistrationRecoveryBundle/u);
  assert.match(registrationRecoveryPlanSource, /observeBrowserAppCheckProviderAttemptClaimState/u);
  assert.match(registrationRecoveryApplySource, /recovery\.action === 'resume-before-patch'/u);
  assert.match(registrationRecoveryApplySource, /createBrowserAppCheckProviderAttemptClaim/u);
  assert.match(registrationRecoveryApplySource, /'state', 'rm', '-lock-timeout=5m'/u);
  assert.match(registrationRecoveryApplySource, /description: 'registration-recovery-reimport'/u);
  assert.match(registrationRecoveryApplySource, /validateBrowserAppCheckRegistrationReconciliationPlan/u);
  assert.doesNotMatch(
    registrationRecoveryApplySource,
    /\['destroy'|force-unlock/u,
  );
  assert.equal(
    BROWSER_APP_CHECK_PROVIDER_ATTEMPT_OBJECT,
    'terraform/browser-app-check/operations/app-check-provider-attempt.json',
  );
  assert.doesNotMatch(
    `${registrationApplySource}\n${registrationRecoveryPlanSource}\n${registrationRecoveryApplySource}`,
    /registration-provider-apply-started|providerApplyMarker/u,
  );
  assert.doesNotMatch(
    `${registrationPlanSource}\n${registrationApplySource}\n${registrationRecoveryApplySource}`,
    /retrievelegacysecretkey|roles\/firebaseappcheck\.(?:admin|serviceAgent)/u,
  );
});

test('keeps public evidence hash-only and enforcement-free', () => {
  const output = browserAppCheckRegistrationOutput(false, CONTRACT);
  assert.equal(output.app_check_registered, true);
  assert.equal(output.app_check_site_key_sha256, CONTRACT.site_key_sha256);
  assert.equal(output.app_check_enforcement, false);
  assert.equal(output.debug_tokens, 0);
  assert.equal(output.public_endpoints_created, 0);
  assert.equal(output.fixed_cost_services, 0);
  assert.equal(canonicalJson(output).includes(SITE_KEY), false);
});

test('consumed registration and unused recovery entrypoints are permanently retired before cloud access', () => {
  assert.equal(PLAN_APP_CHECK_REGISTRATION_CONSUMED, true);
  assert.equal(APPLY_APP_CHECK_REGISTRATION_CONSUMED, true);
  assert.equal(PLAN_APP_CHECK_REGISTRATION_RECOVERY_RETIRED, true);
  assert.equal(APPLY_APP_CHECK_REGISTRATION_RECOVERY_RETIRED, true);
  for (const [entrypoint, message] of [
    ['registration-plan.mjs', 'planner is permanently retired'],
    ['registration-apply.mjs', 'apply path is permanently retired'],
    ['registration-recovery-plan.mjs', 'recovery planner is permanently retired'],
    ['registration-recovery-apply.mjs', 'recovery apply path is permanently retired'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../browser-app-check/${entrypoint}`, import.meta.url))],
      {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)),
        env: {
          PATH: process.env.PATH,
          GOOGLE_APPLICATION_CREDENTIALS: '/must-not-be-read',
          GOOGLE_OAUTH_ACCESS_TOKEN: 'must-not-be-read',
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, new RegExp(message, 'u'));
    assert.doesNotMatch(result.stderr, /gcloud|terraform|credential|token/u);
  }
});
