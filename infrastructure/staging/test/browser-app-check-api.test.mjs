import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildBrowserAppCheckApiResult,
  validateBrowserAppCheckTerraformOutput,
} from '../browser-app-check/apply.mjs';
import { run, terraformEnvironment } from '../browser-app-check/cli.mjs';
import {
  FIREBASE_APP_CONFIG_NAME,
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  FIREBASE_APP_NAME,
  INITIAL_TERRAFORM_STATE,
  INTENDED_TOKEN_TTL,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_API,
  TERRAFORM_VERSION,
  browserAppCheckApiAuthorization,
  buildBrowserAppCheckApiPlanMetadata,
  canonicalJson,
  validateBrowserAppCheckApiAuthorization,
  validateBrowserAppCheckApiPlanMetadata,
} from '../browser-app-check/contract.mjs';
import { validateBrowserAppCheckRoot } from '../browser-app-check/guard.mjs';
import {
  validateBrowserAppCheckInventory,
  validateFirebaseWebAppInventory,
  validateUnregisteredAppCheckConfig,
} from '../browser-app-check/inventory.mjs';
import { validateInitialBrowserAppCheckState } from '../browser-app-check/state.mjs';
import { validateBrowserAppCheckApiPlan } from '../browser-app-check/validate-plan.mjs';

const COMMIT = '1'.repeat(40);
const PLAN = Buffer.from('synthetic-browser-app-check-api-plan');
const PLAN_JSON = Buffer.from('{"synthetic":true}\n');
const CREATED_AT = '2026-09-05T06:30:00.000Z';
const browserRoot = new URL('../browser-app-check/', import.meta.url);
const terraformSource = readdirSync(browserRoot)
  .filter((name) => name.endsWith('.tf'))
  .sort()
  .map((name) => readFileSync(new URL(name, browserRoot), 'utf8'))
  .join('\n');
const planDriver = readFileSync(new URL('plan.mjs', browserRoot), 'utf8');
const applyDriver = readFileSync(new URL('apply.mjs', browserRoot), 'utf8');
const inventoryDriver = readFileSync(new URL('inventory.mjs', browserRoot), 'utf8');

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

function inventory(profile = 'before-api') {
  const before = profile === 'before-api';
  return {
    schema: 'miakapp.staging-browser-app-check-inventory/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_web_app: firebaseWebApp(),
    recaptcha_api_enabled: !before,
    recaptcha_key_inventory: before ? 'unavailable_service_disabled' : 'readable',
    recaptcha_keys: before ? null : [],
    recaptcha_asset_inventory: 'readable_eventually_consistent',
    recaptcha_asset_keys: [],
    app_check: appCheck(),
    service_enforcement_records: 0,
    debug_tokens: 0,
  };
}

function apiOutput() {
  return {
    schema: 'miakapp.staging-browser-app-check-api/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_app_id: FIREBASE_APP_ID,
    firebase_app_display_name: FIREBASE_APP_DISPLAY_NAME,
    recaptcha_api: RECAPTCHA_API,
    recaptcha_api_enabled: true,
    recaptcha_keys_created: 0,
    app_check_registered: false,
    app_check_enforcement: false,
    debug_tokens: 0,
    public_endpoints_created: 0,
    fixed_cost_services: 0,
  };
}

function syntheticPlan() {
  return {
    format_version: '1.2',
    terraform_version: TERRAFORM_VERSION,
    applyable: true,
    complete: true,
    errored: false,
    configuration: {
      provider_config: {
        google: {
          name: 'google',
          full_name: 'registry.terraform.io/hashicorp/google',
          version_constraint: '8.1.0',
          expressions: {
            billing_project: { references: ['local.project_id'] },
            default_labels: { references: ['local.labels'] },
            project: { references: ['local.project_id'] },
            region: { references: ['local.region'] },
            user_project_override: { constant_value: true },
          },
        },
        'google-beta': {
          name: 'google-beta',
          full_name: 'registry.terraform.io/hashicorp/google-beta',
          version_constraint: '8.1.0',
          expressions: {
            billing_project: { references: ['local.project_id'] },
            default_labels: { references: ['local.labels'] },
            project: { references: ['local.project_id'] },
            region: { references: ['local.region'] },
            user_project_override: { constant_value: true },
          },
        },
        terraform: {
          name: 'terraform',
          full_name: 'terraform.io/builtin/terraform',
        },
      },
      root_module: {
        outputs: {
          staging_browser_app_check_api: {
            expression: {
              references: [
                'local.project_id',
                'local.project_number',
                'data.google_firebase_web_app.staging.app_id',
                'data.google_firebase_web_app.staging',
                'data.google_firebase_web_app.staging.display_name',
                'data.google_firebase_web_app.staging',
                'google_project_service.recaptcha_enterprise.service',
                'google_project_service.recaptcha_enterprise',
              ],
            },
            description: 'Non-secret result of the isolated staging reCAPTCHA Enterprise API prerequisite.',
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
        ],
      },
    },
    resource_changes: [
      {
        address: 'terraform_data.browser_app_check_guard',
        mode: 'managed',
        type: 'terraform_data',
        change: {
          actions: ['create'],
          before: null,
          before_sensitive: false,
          after: {
            input: {
              foundation: foundation(),
              web_app: {
                app_id: FIREBASE_APP_ID,
                display_name: FIREBASE_APP_DISPLAY_NAME,
                name: FIREBASE_APP_NAME,
              },
            },
            triggers_replace: null,
          },
          after_unknown: {
            id: true,
            input: {
              foundation: { secret_ids: [false, false, false, false, false] },
              web_app: {},
            },
            output: true,
          },
          after_sensitive: {
            input: {
              foundation: { secret_ids: [false, false, false, false, false] },
              web_app: {},
            },
            output: {},
          },
        },
      },
      {
        address: 'google_project_service.recaptcha_enterprise',
        mode: 'managed',
        type: 'google_project_service',
        change: {
          actions: ['create'],
          before: null,
          before_sensitive: false,
          after: {
            deletion_policy: 'PREVENT',
            disable_dependent_services: false,
            disable_on_destroy: false,
            project: PROJECT_ID,
            service: RECAPTCHA_API,
            timeouts: null,
          },
          after_unknown: { id: true },
          after_sensitive: {},
        },
      },
    ],
    output_changes: {
      staging_browser_app_check_api: {
        actions: ['create'],
        before: null,
        after: apiOutput(),
        before_sensitive: false,
        after_sensitive: false,
        after_unknown: false,
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

function metadata() {
  return buildBrowserAppCheckApiPlanMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    planBytes: PLAN,
    planJsonBytes: PLAN_JSON,
    summary: validateBrowserAppCheckApiPlan(syntheticPlan()),
    baseline: {
      inventory: inventory(),
      terraform_state: INITIAL_TERRAFORM_STATE,
    },
  });
}

test('root contains only the guarded API prerequisite implementation', () => {
  validateBrowserAppCheckRoot(browserRoot);
  assert.match(terraformSource, /prefix = "terraform\/browser-app-check"/u);
  assert.match(terraformSource, /resource "google_project_service" "recaptcha_enterprise"/u);
  assert.doesNotMatch(terraformSource, /google_recaptcha_enterprise_key/u);
  assert.doesNotMatch(terraformSource, /google_firebase_app_check_recaptcha_enterprise_config/u);
});

test('root guard rejects extra files and symbolic links', () => {
  const parent = mkdtempSync(join(tmpdir(), 'miakapp-browser-app-check-root-'));
  const copied = join(parent, 'root');
  cpSync(new URL('../browser-app-check/', import.meta.url), copied, {
    recursive: true,
    filter: (source) => !source.includes(`${join('browser-app-check', '.terraform')}`),
  });
  try {
    writeFileSync(join(copied, 'unexpected.txt'), 'unexpected\n');
    assert.throws(
      () => validateBrowserAppCheckRoot(new URL(`file://${copied}/`)),
      /only the reviewed browser App Check inventory/u,
    );
    rmSync(join(copied, 'unexpected.txt'));
    symlinkSync('README.md', join(copied, 'linked-readme'));
    assert.throws(
      () => validateBrowserAppCheckRoot(new URL(`file://${copied}/`)),
      /must not be a symbolic link/u,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('pre-API inventory keeps authoritative key existence unknown', () => {
  assert.deepEqual(validateBrowserAppCheckInventory(inventory(), 'before-api'), inventory());
  const falseAbsence = inventory();
  falseAbsence.recaptcha_keys = [];
  assert.throws(
    () => validateBrowserAppCheckInventory(falseAbsence, 'before-api'),
    /must keep key existence unknown/u,
  );
  const assetDrift = inventory();
  assetDrift.recaptcha_asset_keys = [
    `//recaptchaenterprise.googleapis.com/projects/${PROJECT_NUMBER}/keys/hidden-key`,
  ];
  assert.throws(
    () => validateBrowserAppCheckInventory(assetDrift, 'before-api'),
    /drifted from the reviewed boundary/u,
  );
});

test('post-API inventory requires an authoritative empty key list', () => {
  assert.deepEqual(
    validateBrowserAppCheckInventory(inventory('after-api'), 'after-api'),
    inventory('after-api'),
  );
  const hiddenKey = inventory('after-api');
  hiddenKey.recaptcha_keys = [`projects/${PROJECT_ID}/keys/hidden-key`];
  assert.throws(
    () => validateBrowserAppCheckInventory(hiddenKey, 'after-api'),
    /not authoritatively empty/u,
  );
});

test('Firebase Web app REST records normalize the endpoint-known platform', () => {
  assert.deepEqual(validateFirebaseWebAppInventory([{
    appId: FIREBASE_APP_ID,
    name: FIREBASE_APP_NAME,
    displayName: FIREBASE_APP_DISPLAY_NAME,
    projectId: PROJECT_ID,
    state: 'ACTIVE',
  }]), firebaseWebApp());
  assert.throws(
    () => validateFirebaseWebAppInventory([{
      appId: FIREBASE_APP_ID,
      name: FIREBASE_APP_NAME,
      displayName: 'Foreign app',
      projectId: PROJECT_ID,
      state: 'ACTIVE',
    }]),
    /does not match the reviewed app/u,
  );
});

test('unregistered App Check provider response is closed and exact', () => {
  assert.deepEqual(validateUnregisteredAppCheckConfig({
    name: FIREBASE_APP_CONFIG_NAME,
    tokenTtl: INTENDED_TOKEN_TTL,
    riskAnalysis: { minValidScore: 0.5 },
  }), appCheck());
  assert.throws(() => validateUnregisteredAppCheckConfig({
    name: FIREBASE_APP_CONFIG_NAME,
    tokenTtl: INTENDED_TOKEN_TTL,
    riskAnalysis: { minValidScore: 0.5 },
    siteKey: 'configured',
  }), /exactly the reviewed fields/u);
});

test('canonical initial state accepts only the pinned empty GCS generation', () => {
  const bytes = Buffer.from(`{
  "version": 4,
  "terraform_version": "1.11.3",
  "serial": 1,
  "lineage": "8193b94a-1d8f-4143-a878-29342f91c0e2",
  "outputs": {},
  "resources": [],
  "check_results": null
}
`);
  const storageMetadata = {
    bucket: 'miakapp-v4-staging-tfstate-1072737219170',
    name: INITIAL_TERRAFORM_STATE.object,
    generation: INITIAL_TERRAFORM_STATE.generation,
    size: String(INITIAL_TERRAFORM_STATE.size_bytes),
  };
  assert.equal(validateInitialBrowserAppCheckState(storageMetadata, bytes), INITIAL_TERRAFORM_STATE);
  assert.throws(
    () => validateInitialBrowserAppCheckState(
      { ...storageMetadata, generation: '1788588916588869' },
      bytes,
    ),
    /does not match the reviewed generation/u,
  );
  assert.throws(
    () => validateInitialBrowserAppCheckState(storageMetadata, Buffer.concat([bytes, Buffer.from(' ')])),
    /does not match the reviewed generation/u,
  );
});

test('API plan contract accepts exactly guard plus service enablement', () => {
  assert.deepEqual(validateBrowserAppCheckApiPlan(syntheticPlan()), {
    create: 2,
    update: 0,
    delete: 0,
    replace: 0,
    import: 0,
    recaptcha_keys_created: 0,
    app_check_registration: false,
    app_check_enforcement: false,
    debug_tokens: 0,
    public_ingress: false,
    resource_addresses: [
      'google_project_service.recaptcha_enterprise',
      'terraform_data.browser_app_check_guard',
    ],
  });
});

test('API plan contract rejects keys, action drift, output drift, and failed guards', () => {
  const key = structuredClone(syntheticPlan());
  key.resource_changes.push({
    address: 'google_recaptcha_enterprise_key.browser_app_check',
    mode: 'managed',
    type: 'google_recaptcha_enterprise_key',
    change: { actions: ['create'], before: null, after: {} },
  });
  assert.throws(() => validateBrowserAppCheckApiPlan(key), /changed resources/u);

  const update = structuredClone(syntheticPlan());
  update.resource_changes[0].change.actions = ['update'];
  assert.throws(() => validateBrowserAppCheckApiPlan(update), /actions does not match/u);

  const output = structuredClone(syntheticPlan());
  output.output_changes.staging_browser_app_check_api.after.recaptcha_keys_created = 1;
  assert.throws(() => validateBrowserAppCheckApiPlan(output), /output after does not match/u);

  const guard = structuredClone(syntheticPlan());
  guard.checks[0].status = 'fail';
  assert.throws(() => validateBrowserAppCheckApiPlan(guard), /guard status/u);
});

test('API metadata binds a fresh exact baseline, plan, and main commit', () => {
  const value = metadata();
  assert.equal(
    validateBrowserAppCheckApiPlanMetadata(value, Date.parse(CREATED_AT) + 1_000),
    value,
  );
  assert.equal(value.recaptcha_key_creation_authorized, false);
  assert.equal(value.baseline.inventory.recaptcha_keys, null);
  assert.equal(value.baseline.terraform_state, INITIAL_TERRAFORM_STATE);
  const authorization = browserAppCheckApiAuthorization(
    PLAN,
    COMMIT,
    value.baseline_sha256,
  );
  assert.match(
    authorization,
    /^enable-browser-app-check-prerequisite-api:miakapp-v4-staging:[0-9a-f]{64}:[0-9a-f]{64}:[0-9a-f]{40}$/u,
  );
  validateBrowserAppCheckApiAuthorization(authorization, PLAN, COMMIT, value.baseline_sha256);
  assert.throws(
    () => validateBrowserAppCheckApiAuthorization(
      `${authorization}x`,
      PLAN,
      COMMIT,
      value.baseline_sha256,
    ),
    /authorization is missing or invalid/u,
  );
  assert.throws(
    () => validateBrowserAppCheckApiPlanMetadata(value, Date.parse(value.expires_at) + 1),
    /expired or not yet valid/u,
  );
});

test('Terraform receives only the verified ephemeral operator token', () => {
  const environment = terraformEnvironment('/private/tmp/browser-app-check-data', 'a'.repeat(64));
  assert.equal(environment.GOOGLE_OAUTH_ACCESS_TOKEN, 'a'.repeat(64));
  assert.equal(environment.TF_IN_AUTOMATION, '1');
  assert.equal(environment.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(environment.CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT, undefined);
  assert.throws(
    () => terraformEnvironment('/private/tmp/browser-app-check-data', 'invalid token'),
    /access token is invalid/u,
  );
});

test('API result proves only the bounded prerequisite and zero driver assessments', () => {
  const value = metadata();
  const result = buildBrowserAppCheckApiResult({
    metadata: value,
    output: apiOutput(),
    inventory: inventory('after-api'),
  });
  assert.equal(result.operation, 'enable-recaptcha-enterprise-api-only');
  assert.equal(result.authoritative_recaptcha_keys, 0);
  assert.equal(result.assessments_initiated_by_driver, 0);
  const drift = apiOutput();
  drift.recaptcha_keys_created = 1;
  assert.throws(
    () => validateBrowserAppCheckTerraformOutput(drift),
    /does not match the reviewed value/u,
  );
});

test('drivers enforce immediate pre-mutation revalidation and durable no-retry semantics', () => {
  const marker = applyDriver.indexOf('writeMutationAttemptMarker(bundle, freshMetadata)');
  const apply = applyDriver.indexOf("run('terraform', [\n      'apply'");
  assert.ok(marker > applyDriver.indexOf('const liveBaseline = await observeBaseline(mutationSession)'));
  assert.ok(marker > applyDriver.indexOf('readBrowserAppCheckApiPlanMetadata(metadataPath)'));
  assert.ok(marker > applyDriver.indexOf('verifyExactMain(repositoryRoot, freshMetadata.repository_commit)'));
  assert.ok(marker >= 0 && apply > marker);
  assert.match(applyDriver, /has already attempted a mutation and must never be retried/u);
  assert.match(applyDriver, /Do not retry the saved plan/u);
  assert.match(applyDriver, /authoritative reCAPTCHA key inventory/u);
  assert.match(planDriver, /0 updates, 0 deletes; state guard and API only/u);
  assert.match(inventoryDriver, /unavailable_service_disabled/u);
  assert.doesNotMatch(`${planDriver}\n${applyDriver}`, /terraform', \['destroy'/u);
});

test('abnormal child termination preserves private recovery diagnostics', () => {
  const directory = mkdtempSync(join(tmpdir(), 'miakapp-browser-app-check-diagnostics-'));
  try {
    assert.throws(() => run(process.execPath, [
      '-e',
      'process.kill(process.pid, "SIGTERM")',
    ], {
      diagnosticDirectory: directory,
      description: 'abnormal-child',
    }), /private diagnostics were preserved/u);
    const diagnosticPath = join(directory, 'abnormal-child.log');
    assert.equal(existsSync(diagnosticPath), true);
    assert.match(readFileSync(diagnosticPath, 'utf8'), /Command failed without diagnostics/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the baseline remains canonical JSON without secret or token material', () => {
  const value = metadata();
  const serialized = canonicalJson(value);
  assert.equal(JSON.parse(serialized).baseline.inventory.recaptcha_keys, null);
  assert.doesNotMatch(serialized, /accessToken|Authorization|siteKey/u);
});
