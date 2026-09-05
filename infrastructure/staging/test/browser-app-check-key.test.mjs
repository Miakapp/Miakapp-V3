import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FIREBASE_APP_CONFIG_NAME,
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  FIREBASE_APP_NAME,
  HOSTING_DOMAIN,
  INTENDED_TOKEN_TTL,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_API,
  RECAPTCHA_DISPLAY_NAME,
  TERRAFORM_VERSION,
  canonicalJson,
  sha256,
} from '../browser-app-check/contract.mjs';
import {
  BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET,
  BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT,
  browserAppCheckKeyAttemptClaimAbsence,
  createBrowserAppCheckKeyAttemptClaim,
  observeBrowserAppCheckKeyAttemptClaimAbsent,
  validateBrowserAppCheckKeyAttemptClaimReceipt,
} from '../browser-app-check/attempt-claim.mjs';
import {
  KEY_PREREQUISITE_CONSUMED as APPLY_KEY_PREREQUISITE_CONSUMED,
  buildBrowserAppCheckKeyResult,
  validateBrowserAppCheckKeyTerraformOutput,
} from '../browser-app-check/key-apply.mjs';
import {
  API_PREREQUISITE_TERRAFORM_STATE,
  browserAppCheckKeyAuthorization,
  buildBrowserAppCheckKeyPlanMetadata,
  validateBrowserAppCheckKeyAuthorization,
  validateBrowserAppCheckKeyPlanMetadata,
} from '../browser-app-check/key-contract.mjs';
import {
  validateBrowserAppCheckEvidence,
  validateBrowserAppCheckEvidenceValue,
} from '../browser-app-check/evidence.mjs';
import {
  validateBrowserAppCheckKeyInventory,
  validateNormalizedRecaptchaKey,
  validateRecaptchaKeyRecord,
} from '../browser-app-check/inventory.mjs';
import {
  validateBrowserAppCheckKeyState,
} from '../browser-app-check/state.mjs';
import {
  KEY_PREREQUISITE_CONSUMED as PLAN_KEY_PREREQUISITE_CONSUMED,
} from '../browser-app-check/key-plan.mjs';
import {
  browserAppCheckKeyOutput,
  validateBrowserAppCheckKeyPlan,
} from '../browser-app-check/validate-key-plan.mjs';

const COMMIT = '2'.repeat(40);
const PLAN = Buffer.from('synthetic-browser-app-check-key-plan');
const PLAN_JSON = Buffer.from('{"synthetic":"key"}\n');
const CREATED_AT = '2026-09-05T08:00:00.000Z';
const KEY_ID = 'a'.repeat(40);
const KEY_NAME = `projects/${PROJECT_ID}/keys/${KEY_ID}`;
const LABELS = Object.freeze({
  environment: 'staging',
  'managed-by': 'terraform',
  product: 'miakapp-v4',
  purpose: 'browser-app-check',
});
const keyApplyDriver = readFileSync(
  new URL('../browser-app-check/key-apply.mjs', import.meta.url),
  'utf8',
);
const keyPlanDriver = readFileSync(
  new URL('../browser-app-check/key-plan.mjs', import.meta.url),
  'utf8',
);
const committedResultPath = new URL('../browser-app-check/result.json', import.meta.url);

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

function firebaseWebApp() {
  return {
    app_id: FIREBASE_APP_ID,
    name: FIREBASE_APP_NAME,
    display_name: FIREBASE_APP_DISPLAY_NAME,
    platform: 'WEB',
    state: 'ACTIVE',
  };
}

function appCheck() {
  return {
    name: FIREBASE_APP_CONFIG_NAME,
    token_ttl: INTENDED_TOKEN_TTL,
    minimum_valid_score: 0.5,
    site_key_configured: false,
  };
}

function emptyInventory() {
  return {
    schema: 'miakapp.staging-browser-app-check-inventory/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_web_app: firebaseWebApp(),
    recaptcha_api_enabled: true,
    recaptcha_key_inventory: 'readable',
    recaptcha_keys: [],
    recaptcha_asset_inventory: 'readable_eventually_consistent',
    recaptcha_asset_keys: [],
    app_check: appCheck(),
    service_enforcement_records: 0,
    debug_tokens: 0,
  };
}

function rawKey() {
  return {
    name: KEY_NAME,
    displayName: RECAPTCHA_DISPLAY_NAME,
    labels: LABELS,
    createTime: '2026-09-05T08:15:00.123456Z',
    webSettings: {
      allowedDomains: [HOSTING_DOMAIN],
      integrationType: 'SCORE',
    },
  };
}

function normalizedKey() {
  return validateRecaptchaKeyRecord(rawKey());
}

function keyInventory(assetKeys = []) {
  return {
    schema: 'miakapp.staging-browser-app-check-key-inventory/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_web_app: firebaseWebApp(),
    recaptcha_api_enabled: true,
    recaptcha_key_inventory: 'readable',
    recaptcha_keys: [normalizedKey()],
    recaptcha_asset_inventory: 'readable_eventually_consistent',
    recaptcha_asset_keys: assetKeys,
    app_check: appCheck(),
    service_enforcement_records: 0,
    debug_tokens: 0,
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

function keyAfter() {
  return {
    android_settings: [],
    deletion_policy: 'DELETE',
    display_name: RECAPTCHA_DISPLAY_NAME,
    effective_labels: LABELS,
    ios_settings: [],
    labels: LABELS,
    project: PROJECT_ID,
    terraform_labels: LABELS,
    testing_options: [],
    timeouts: null,
    waf_settings: [],
    web_settings: [{
      allow_all_domains: false,
      allow_amp_traffic: false,
      allowed_domains: [HOSTING_DOMAIN],
      challenge_settings: [],
      integration_type: 'SCORE',
    }],
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

function apiOutput() {
  return {
    app_check_enforcement: false,
    app_check_registered: false,
    debug_tokens: 0,
    firebase_app_display_name: FIREBASE_APP_DISPLAY_NAME,
    firebase_app_id: FIREBASE_APP_ID,
    fixed_cost_services: 0,
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    public_endpoints_created: 0,
    recaptcha_api: RECAPTCHA_API,
    recaptcha_api_enabled: true,
    recaptcha_keys_created: 0,
    schema: 'miakapp.staging-browser-app-check-api/1',
  };
}

function syntheticKeyPlan() {
  const guard = guardValue();
  const service = {
    deletion_policy: 'PREVENT',
    disable_dependent_services: false,
    disable_on_destroy: false,
    id: `${PROJECT_ID}/${RECAPTCHA_API}`,
    project: PROJECT_ID,
    service: RECAPTCHA_API,
    timeouts: null,
  };
  return {
    format_version: '1.2',
    terraform_version: TERRAFORM_VERSION,
    applyable: true,
    complete: true,
    errored: false,
    timestamp: CREATED_AT.replace('.000', ''),
    planned_values: {},
    prior_state: {},
    relevant_attributes: [],
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
            expression: {
              references: [
                'local.project_id',
                'local.project_number',
                'data.google_firebase_web_app.staging.app_id',
                'data.google_firebase_web_app.staging.display_name',
                'google_project_service.recaptcha_enterprise.service',
                'google_recaptcha_enterprise_key.browser_app_check.display_name',
                'google_recaptcha_enterprise_key.browser_app_check.web_settings[0].integration_type',
                'google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allowed_domains',
                'google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allow_all_domains',
                'google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allow_amp_traffic',
                'google_recaptcha_enterprise_key.browser_app_check.testing_options',
                'google_recaptcha_enterprise_key.browser_app_check.waf_settings',
              ],
            },
            description: 'Non-secret result of the isolated staging browser App Check key prerequisite.',
          },
        },
        resources: [
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
        ],
      },
    },
    resource_changes: [
      {
        address: 'google_project_service.recaptcha_enterprise',
        mode: 'managed',
        type: 'google_project_service',
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
        change: {
          actions: ['create'],
          before: null,
          after: keyAfter(),
          after_unknown: {
            android_settings: [],
            create_time: true,
            effective_labels: {},
            id: true,
            ios_settings: [],
            labels: {},
            name: true,
            terraform_labels: {},
            testing_options: [],
            waf_settings: [],
            web_settings: [{
              allowed_domains: [false],
              challenge_security_preference: true,
              challenge_settings: [],
            }],
          },
          before_sensitive: false,
          after_sensitive: {
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
          },
        },
      },
      {
        address: 'terraform_data.browser_app_check_guard',
        mode: 'managed',
        type: 'terraform_data',
        change: {
          actions: ['no-op'],
          before: guard,
          after: structuredClone(guard),
          after_unknown: {},
          before_sensitive: guardSensitivity(),
          after_sensitive: guardSensitivity(),
        },
      },
    ],
    output_changes: {
      staging_browser_app_check_api: {
        actions: ['delete'],
        before: apiOutput(),
        after: null,
        after_unknown: false,
        before_sensitive: false,
        after_sensitive: false,
      },
      staging_browser_app_check_key: {
        actions: ['create'],
        before: null,
        after: browserAppCheckKeyOutput(),
        after_unknown: false,
        before_sensitive: false,
        after_sensitive: false,
      },
    },
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

function outputType() {
  return ['object', Object.fromEntries(
    Object.entries(browserAppCheckKeyOutput()).map(([field, value]) => [
      field,
      Array.isArray(value)
        ? ['list', 'string']
        : typeof value === 'boolean' ? 'bool' : typeof value,
    ]),
  )];
}

function syntheticKeyState() {
  const keyAttributes = {
    ...keyAfter(),
    create_time: rawKey().createTime,
    id: KEY_NAME,
    name: KEY_ID,
  };
  const state = {
    version: 4,
    terraform_version: TERRAFORM_VERSION,
    serial: 4,
    lineage: '8193b94a-1d8f-4143-a878-29342f91c0e2',
    outputs: {
      staging_browser_app_check_key: {
        value: browserAppCheckKeyOutput(),
        type: outputType(),
      },
    },
    resources: [
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
        instances: [{ schema_version: 0, attributes: keyAttributes }],
      },
      {
        mode: 'managed',
        type: 'terraform_data',
        name: 'browser_app_check_guard',
        provider: 'provider["terraform.io/builtin/terraform"]',
        instances: [{ schema_version: 0, attributes: {} }],
      },
    ],
    check_results: [{
      object_kind: 'resource',
      config_addr: 'terraform_data.browser_app_check_guard',
      status: 'pass',
      objects: [{
        object_addr: 'terraform_data.browser_app_check_guard',
        status: 'pass',
      }],
    }],
  };
  const bytes = Buffer.from(`${JSON.stringify(state)}\n`);
  return {
    metadata: {
      bucket: 'miakapp-v4-staging-tfstate-1072737219170',
      name: API_PREREQUISITE_TERRAFORM_STATE.object,
      generation: '1788592000000000',
      size: String(bytes.byteLength),
    },
    bytes,
  };
}

function metadata() {
  return buildBrowserAppCheckKeyPlanMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    planBytes: PLAN,
    planJsonBytes: PLAN_JSON,
    summary: validateBrowserAppCheckKeyPlan(syntheticKeyPlan()),
    baseline: {
      attempt_claim: browserAppCheckKeyAttemptClaimAbsence(),
      inventory: emptyInventory(),
      terraform_state: API_PREREQUISITE_TERRAFORM_STATE,
    },
  });
}

function attemptClaimReceipt(value = metadata()) {
  return {
    schema: 'miakapp.staging-browser-app-check-key-attempt-claim-receipt/1',
    bucket: BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET,
    object: BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT,
    generation: '1788591900000000',
    size_bytes: 777,
    sha256: '3'.repeat(64),
    repository_commit: value.repository_commit,
    terraform_plan_sha256: value.terraform_plan_sha256,
    baseline_sha256: value.baseline_sha256,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  };
}

function response(status, value = '') {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return {
    status,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function atomicClaimTransport() {
  let contents;
  const generation = '1788591900000000';
  let insertCalls = 0;
  const transport = async (input, options = {}) => {
    const url = new URL(input);
    if (options.method === 'POST') {
      insertCalls += 1;
      assert.equal(url.pathname, `/upload/storage/v1/b/${BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET}/o`);
      assert.equal(url.searchParams.get('uploadType'), 'media');
      assert.equal(url.searchParams.get('name'), BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT);
      assert.equal(url.searchParams.get('ifGenerationMatch'), '0');
      if (contents !== undefined) return response(412, { error: { code: 412 } });
      contents = Buffer.from(options.body);
      return response(200, {
        bucket: BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET,
        name: BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT,
        generation,
        size: String(contents.byteLength),
      });
    }
    if (contents === undefined) return response(404, { error: { code: 404 } });
    if (url.searchParams.get('alt') === 'media') {
      assert.equal(url.searchParams.get('generation'), generation);
      return response(200, contents);
    }
    return response(200, {
      bucket: BROWSER_APP_CHECK_KEY_ATTEMPT_BUCKET,
      name: BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT,
      generation,
      size: String(contents.byteLength),
    });
  };
  return Object.freeze({
    fetch: transport,
    insertCalls: () => insertCalls,
  });
}

test('key plan accepts exactly one domain-restricted SCORE key create', () => {
  assert.deepEqual(validateBrowserAppCheckKeyPlan(syntheticKeyPlan()), {
    create: 1,
    update: 0,
    delete: 0,
    replace: 0,
    import: 0,
    recaptcha_keys_created: 1,
    allowed_domains: [HOSTING_DOMAIN],
    integration_type: 'SCORE',
    testing_options: false,
    waf_settings: false,
    app_check_registration: false,
    app_check_enforcement: false,
    debug_tokens: 0,
    assessments: 0,
    public_ingress: false,
    resource_addresses: ['google_recaptcha_enterprise_key.browser_app_check'],
  });
});

test('key plan rejects action, domain, platform, provider-label and output drift', () => {
  for (const mutate of [
    (plan) => { plan.resource_changes[1].change.actions = ['delete', 'create']; },
    (plan) => { plan.resource_changes[1].change.after.web_settings[0].allowed_domains = ['example.com']; },
    (plan) => { plan.resource_changes[1].change.after.android_settings = [{}]; },
    (plan) => { plan.configuration.provider_config.google.expressions.add_terraform_attribution_label.constant_value = true; },
    (plan) => { plan.output_changes.staging_browser_app_check_key.after.app_check_registered = true; },
    (plan) => { plan.resource_drift = []; },
  ]) {
    const plan = structuredClone(syntheticKeyPlan());
    mutate(plan);
    assert.throws(() => validateBrowserAppCheckKeyPlan(plan), /does not match|invalid/u);
  }
});

test('key plan metadata and authorization bind exact private bytes, baseline and commit', () => {
  const value = metadata();
  assert.equal(
    validateBrowserAppCheckKeyPlanMetadata(value, Date.parse(CREATED_AT) + 1_000),
    value,
  );
  assert.equal(value.recaptcha_key_creation_authorized, true);
  assert.equal(value.recaptcha_key_deletion_authorized, false);
  assert.equal(value.global_attempt_claim_creation_authorized, true);
  assert.equal(value.global_attempt_claim_deletion_authorized, false);
  assert.deepEqual(value.baseline.attempt_claim, browserAppCheckKeyAttemptClaimAbsence());
  assert.equal(value.baseline.terraform_state, API_PREREQUISITE_TERRAFORM_STATE);
  assert.deepEqual(API_PREREQUISITE_TERRAFORM_STATE, {
    schema: 'miakapp.staging-browser-app-check-state/1',
    object: 'terraform/browser-app-check/default.tfstate',
    generation: '1788591686695870',
    size_bytes: 11057,
    sha256: '4c2ac56a22e2ba11e6a4dd5c195910c1a0f1e749a009660294ea05bcd8c48aa7',
    terraform_version: '1.11.3',
    serial: 3,
    lineage_sha256: 'f6640c6c40b21a544f3ddc3ee8005f8a1d9d2eaa19dd79ba5fca5709394d9601',
    managed_resources: 2,
    data_resources: 2,
    outputs: 1,
    tainted_resources: 0,
  });
  const authorization = browserAppCheckKeyAuthorization(PLAN, COMMIT, value.baseline_sha256);
  assert.match(
    authorization,
    /^create-browser-app-check-recaptcha-key:miakapp-v4-staging:[0-9a-f]{64}:[0-9a-f]{64}:[0-9a-f]{40}$/u,
  );
  validateBrowserAppCheckKeyAuthorization(authorization, PLAN, COMMIT, value.baseline_sha256);
  assert.throws(
    () => validateBrowserAppCheckKeyAuthorization(
      authorization,
      Buffer.concat([PLAN, Buffer.from('drift')]),
      COMMIT,
      value.baseline_sha256,
    ),
    /authorization is missing or invalid/u,
  );
});

test('one global atomic claim serializes independent key bundles after an ambiguous failure', async () => {
  const operator = { accessToken: 'a'.repeat(40) };
  const planMetadata = metadata();
  const cloud = atomicClaimTransport();
  assert.deepEqual(
    await observeBrowserAppCheckKeyAttemptClaimAbsent(operator, cloud.fetch),
    browserAppCheckKeyAttemptClaimAbsence(),
  );
  let downstreamKeyCreates = 0;
  const runBundle = async (attemptedAt) => {
    const receipt = await createBrowserAppCheckKeyAttemptClaim(
      operator,
      planMetadata,
      attemptedAt,
      cloud.fetch,
    );
    validateBrowserAppCheckKeyAttemptClaimReceipt(receipt, planMetadata);
    downstreamKeyCreates += 1;
    throw new Error('synthetic key state persistence failure');
  };
  await assert.rejects(
    runBundle('2026-09-05T08:01:00.000Z'),
    /synthetic key state persistence failure/u,
  );
  await assert.rejects(
    runBundle('2026-09-05T08:02:00.000Z'),
    /global browser App Check key attempt claim was already acquired/u,
  );
  await assert.rejects(
    observeBrowserAppCheckKeyAttemptClaimAbsent(operator, cloud.fetch),
    /global browser App Check key attempt claim already exists/u,
  );
  assert.equal(cloud.insertCalls(), 2);
  assert.equal(downstreamKeyCreates, 1);
});

test('authoritative key inventory validates the complete key and eventual Asset lag', () => {
  const key = normalizedKey();
  assert.equal(validateNormalizedRecaptchaKey(key), key);
  assert.equal(validateBrowserAppCheckKeyInventory(keyInventory()).recaptcha_keys.length, 1);
  assert.equal(validateBrowserAppCheckKeyInventory(keyInventory([
    `//recaptchaenterprise.googleapis.com/projects/${PROJECT_NUMBER}/keys/${KEY_ID}`,
  ])).recaptcha_asset_keys.length, 1);
  const numericProjectName = rawKey();
  numericProjectName.name = `projects/${PROJECT_NUMBER}/keys/${KEY_ID}`;
  assert.equal(validateRecaptchaKeyRecord(numericProjectName).name, KEY_NAME);

  const publicDomain = structuredClone(keyInventory());
  publicDomain.recaptcha_keys[0].allow_all_domains = true;
  assert.throws(
    () => validateBrowserAppCheckKeyInventory(publicDomain),
    /Normalized reCAPTCHA key does not match/u,
  );
  const testing = rawKey();
  testing.testingOptions = { testingScore: 1 };
  assert.throws(() => validateRecaptchaKeyRecord(testing), /exactly the reviewed fields/u);
  const unspecifiedChallenge = rawKey();
  unspecifiedChallenge.webSettings.challengeSecurityPreference =
    'CHALLENGE_SECURITY_PREFERENCE_UNSPECIFIED';
  assert.equal(
    validateRecaptchaKeyRecord(unspecifiedChallenge).integration_type,
    'SCORE',
  );
  const challenged = rawKey();
  challenged.webSettings.challengeSecurityPreference = 'SECURITY';
  assert.throws(
    () => validateRecaptchaKeyRecord(challenged),
    /Web settings do not match/u,
  );
  const foreignAsset = keyInventory([
    `//recaptchaenterprise.googleapis.com/projects/${PROJECT_NUMBER}/keys/${'b'.repeat(40)}`,
  ]);
  assert.throws(
    () => validateBrowserAppCheckKeyInventory(foreignAsset),
    /does not corroborate/u,
  );
});

test('post-apply state cross-links the exact key resource and sanitized output', () => {
  const state = syntheticKeyState();
  const summary = validateBrowserAppCheckKeyState(state.metadata, state.bytes);
  assert.equal(summary.recaptcha_key_name, KEY_NAME);
  assert.equal(summary.recaptcha_key_name_sha256, sha256(Buffer.from(KEY_NAME)));
  assert.equal(summary.tainted_resources, 0);

  const drift = JSON.parse(state.bytes.toString('utf8'));
  const keyResource = drift.resources.find(({ type }) => type === 'google_recaptcha_enterprise_key');
  keyResource.instances[0].attributes.web_settings[0].allow_all_domains = true;
  const driftBytes = Buffer.from(`${JSON.stringify(drift)}\n`);
  assert.throws(
    () => validateBrowserAppCheckKeyState({
      ...state.metadata,
      size: String(driftBytes.byteLength),
    }, driftBytes),
    /Web settings have drifted/u,
  );
});

test('result omits the site key while binding Terraform state to direct inventory', () => {
  const state = syntheticKeyState();
  const result = buildBrowserAppCheckKeyResult({
    metadata: metadata(),
    attemptClaim: attemptClaimReceipt(),
    output: browserAppCheckKeyOutput(),
    inventory: keyInventory(),
    terraformState: state,
  });
  assert.equal(result.authoritative_recaptcha_keys, 1);
  assert.equal(result.recaptcha_key.name_sha256, sha256(Buffer.from(KEY_NAME)));
  assert.equal(result.legacy_secret_retrievals_by_driver, 0);
  assert.equal(result.assessments_initiated_by_driver, 0);
  assert.equal(result.coordination_objects_created, 1);
  assert.equal(result.global_attempt_claim.object, BROWSER_APP_CHECK_KEY_ATTEMPT_OBJECT);
  assert.doesNotMatch(canonicalJson(result), new RegExp(KEY_ID, 'u'));
  assert.equal(validateBrowserAppCheckKeyTerraformOutput(browserAppCheckKeyOutput()).recaptcha_testing, false);
});

test('committed browser App Check evidence is exact, cross-linked, sanitized, and immutable', () => {
  const result = validateBrowserAppCheckEvidence(committedResultPath);
  assert.equal(result.repository_commit, '67c6947231c2b4a515e74a3b7a27ea972f1dcd15');
  assert.equal(result.terraform_plan_sha256, '9af7eaf470ce1a65f3737823135604a31ea6cbbd2575bd1afcc17d00033dfee7');
  assert.equal(result.authoritative_recaptcha_keys, 1);
  assert.equal(result.cloud_asset_recaptcha_keys, 1);
  assert.equal(result.app_check_provider.registered, true);
  assert.equal(result.app_check_enforcement_records, 0);
  assert.equal(result.global_key_attempt_claim.retry_authorized, false);
  assert.equal(result.global_registration_attempt_claim.retry_authorized, false);
  assert.equal(result.global_provider_attempt_claim.retry_authorized, false);
  assert.equal(
    result.terraform_state.recaptcha_key_name_sha256,
    result.recaptcha_key.name_sha256,
  );
  assert.equal(
    result.terraform_state.app_check_config_name,
    result.app_check_provider.name,
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /accessToken|Authorization|siteKey|legacySecretKey|projects\/miakapp-v4-staging\/keys\//u,
  );
  const drift = structuredClone(result);
  drift.recaptcha_key.allow_all_domains = true;
  assert.throws(
    () => validateBrowserAppCheckEvidenceValue(drift),
    /does not match the exact sanitized result/u,
  );
});

test('key drivers revalidate immediately, claim globally, preserve fallback state and forbid replay', () => {
  const marker = keyApplyDriver.indexOf('writeMutationAttemptMarker(bundle, freshMetadata)');
  const globalClaim = keyApplyDriver.indexOf('createBrowserAppCheckKeyAttemptClaim(\n      mutationSession');
  const apply = keyApplyDriver.indexOf("run('terraform', [\n      'apply'");
  assert.ok(marker > keyApplyDriver.indexOf('const liveBaseline = await observeBaseline(mutationSession)'));
  assert.ok(marker > keyApplyDriver.indexOf('verifyExactMain(repositoryRoot, freshMetadata.repository_commit)'));
  assert.ok(marker >= 0 && globalClaim > marker && apply > globalClaim);
  assert.match(keyApplyDriver, /must never be retried/u);
  assert.match(keyApplyDriver, /fsyncSync\(descriptor\)/u);
  assert.match(keyApplyDriver, /preserveFallbackState/u);
  assert.match(keyApplyDriver, /Do not retry this saved plan/u);
  assert.ok(
    keyApplyDriver.indexOf("['uncertain-key-records.json', observeRecaptchaKeyRecords]")
      < keyApplyDriver.indexOf("['uncertain-inventory.json', observeBrowserAppCheckInventory]"),
  );
  assert.match(keyPlanDriver, /postPlanBaseline/u);
  assert.match(keyPlanDriver, /observeBrowserAppCheckKeyAttemptClaimAbsent/u);
  assert.doesNotMatch(`${keyPlanDriver}\n${keyApplyDriver}`, /retrieveLegacySecretKey|legacySecretKey/u);
  assert.doesNotMatch(`${keyPlanDriver}\n${keyApplyDriver}`, /terraform', \['destroy'/u);
});

test('consumed key plan and apply entrypoints are permanently retired before cloud access', () => {
  assert.equal(PLAN_KEY_PREREQUISITE_CONSUMED, true);
  assert.equal(APPLY_KEY_PREREQUISITE_CONSUMED, true);
  for (const [entrypoint, message] of [
    ['key-plan.mjs', 'planner is permanently retired'],
    ['key-apply.mjs', 'apply path is permanently retired'],
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
