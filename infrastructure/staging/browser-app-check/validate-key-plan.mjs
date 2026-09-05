import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  FIREBASE_APP_NAME,
  HOSTING_DOMAIN,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_API,
  RECAPTCHA_DISPLAY_NAME,
  TERRAFORM_VERSION,
} from './contract.mjs';

const MAXIMUM_PLAN_BYTES = 16 * 1024 * 1024;
const RESOURCE_CHANGES = Object.freeze({
  'google_project_service.recaptcha_enterprise': 'google_project_service',
  'google_recaptcha_enterprise_key.browser_app_check': 'google_recaptcha_enterprise_key',
  'terraform_data.browser_app_check_guard': 'terraform_data',
});
const DATA = Object.freeze({
  'data.google_firebase_web_app.staging': 'google_firebase_web_app',
  'data.terraform_remote_state.foundation': 'terraform_remote_state',
});
const LABELS = Object.freeze({
  environment: 'staging',
  'managed-by': 'terraform',
  product: 'miakapp-v4',
  purpose: 'browser-app-check',
});
const GUARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function exactKeys(value, keys, description) {
  if (!plainObject(value)) reject(`${description} is missing`);
  exact(Object.keys(value).sort(), [...keys].sort(), `${description} fields`);
  return value;
}

function reference(expression, expected, description) {
  if (!plainObject(expression) || !Array.isArray(expression.references)
    || !expected.every((value) => expression.references.includes(value))) {
    reject(`${description} does not reference the reviewed value`);
  }
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

function validateConfiguration(plan) {
  const configuration = exactKeys(
    plan.configuration,
    ['provider_config', 'root_module'],
    'Browser App Check key Terraform configuration',
  );
  const root = exactKeys(
    configuration.root_module,
    ['outputs', 'resources'],
    'Browser App Check key root module',
  );
  if (!Array.isArray(root.resources)) reject('Browser App Check key resources are missing');
  const expected = { ...DATA, ...RESOURCE_CHANGES };
  const seen = new Set();
  for (const resource of root.resources) {
    if (!plainObject(resource) || seen.has(resource.address) || expected[resource.address] === undefined) {
      reject('Browser App Check key configuration contains an invalid resource');
    }
    seen.add(resource.address);
    const baseKeys = [
      'address',
      'mode',
      'type',
      'name',
      'provider_config_key',
      'expressions',
      'schema_version',
    ];
    exactKeys(
      resource,
      resource.address.startsWith('google_') && resource.mode === 'managed'
        ? [...baseKeys, 'depends_on']
        : baseKeys,
      `${resource.address} configuration`,
    );
    exact(resource.type, expected[resource.address], `${resource.address}.type`);
    exact(resource.mode, resource.address.startsWith('data.') ? 'data' : 'managed', `${resource.address}.mode`);
    const expectedProvider = resource.type === 'google_firebase_web_app'
      ? 'google-beta'
      : ['terraform_data', 'terraform_remote_state'].includes(resource.type) ? 'terraform' : 'google';
    exact(resource.provider_config_key, expectedProvider, `${resource.address}.provider`);
    if (resource.address === 'data.terraform_remote_state.foundation') {
      exact(resource.expressions, {
        backend: { constant_value: 'gcs' },
        config: { references: ['local.state_bucket_name', 'local.foundation_prefix'] },
      }, `${resource.address}.expressions`);
    } else if (resource.address === 'data.google_firebase_web_app.staging') {
      exact(resource.expressions, {
        app_id: { references: ['local.firebase_app_id'] },
        project: { references: ['local.project_id'] },
      }, `${resource.address}.expressions`);
    } else if (resource.address === 'terraform_data.browser_app_check_guard') {
      reference(resource.expressions?.input, [
        'data.terraform_remote_state.foundation.outputs.staging_foundation',
        'data.google_firebase_web_app.staging.app_id',
        'data.google_firebase_web_app.staging.display_name',
        'data.google_firebase_web_app.staging.name',
      ], `${resource.address}.input`);
    } else if (resource.address === 'google_project_service.recaptcha_enterprise') {
      exact(resource.depends_on, ['terraform_data.browser_app_check_guard'], `${resource.address}.depends_on`);
      exact(resource.expressions, {
        deletion_policy: { constant_value: 'PREVENT' },
        disable_dependent_services: { constant_value: false },
        disable_on_destroy: { constant_value: false },
        project: { references: ['local.project_id'] },
        service: { references: ['local.recaptcha_api'] },
      }, `${resource.address}.expressions`);
    } else {
      exact(resource.depends_on, ['google_project_service.recaptcha_enterprise'], `${resource.address}.depends_on`);
      exact(resource.expressions, {
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
      }, `${resource.address}.expressions`);
    }
  }
  exact([...seen].sort(), Object.keys(expected).sort(), 'Browser App Check key configuration resources');

  const providers = exactKeys(configuration.provider_config, [
    'google',
    'google-beta',
    'terraform',
  ], 'Browser App Check key providers');
  exact(providers.google, {
    name: 'google',
    full_name: 'registry.terraform.io/hashicorp/google',
    version_constraint: '8.1.0',
    expressions: providerExpressions(),
  }, 'Google provider');
  exact(providers['google-beta'], {
    name: 'google-beta',
    full_name: 'registry.terraform.io/hashicorp/google-beta',
    version_constraint: '8.1.0',
    expressions: providerExpressions(),
  }, 'Google beta provider');
  exact(providers.terraform, {
    name: 'terraform',
    full_name: 'terraform.io/builtin/terraform',
  }, 'Terraform provider');

  const outputs = exactKeys(
    root.outputs,
    ['staging_browser_app_check_key'],
    'Browser App Check key configuration outputs',
  );
  const output = exactKeys(
    outputs.staging_browser_app_check_key,
    ['expression', 'description'],
    'Browser App Check key output configuration',
  );
  exact(
    output.description,
    'Non-secret result of the isolated staging browser App Check key prerequisite.',
    'Browser App Check key output description',
  );
  reference(output.expression, [
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
  ], 'Browser App Check key output');
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

export function browserAppCheckKeyOutput() {
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
    recaptcha_allow_all: false,
    recaptcha_allow_amp: false,
    recaptcha_allowed_domains: [HOSTING_DOMAIN],
    recaptcha_api: RECAPTCHA_API,
    recaptcha_api_enabled: true,
    recaptcha_display_name: RECAPTCHA_DISPLAY_NAME,
    recaptcha_integration: 'SCORE',
    recaptcha_key_created: true,
    recaptcha_testing: false,
    recaptcha_waf: false,
    schema: 'miakapp.staging-browser-app-check-key/1',
  };
}

function validateKeyAfter(value, address) {
  exact(value, {
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
  }, `${address}.after`);
}

function validateNoOp(resource) {
  const change = exactKeys(resource.change, [
    'actions',
    'before',
    'after',
    'after_unknown',
    'before_sensitive',
    'after_sensitive',
  ], `${resource.address}.change`);
  exact(change.actions, ['no-op'], `${resource.address}.actions`);
  exact(change.after, change.before, `${resource.address}.before/after`);
  exact(change.after_unknown, {}, `${resource.address}.after_unknown`);
  if (resource.address === 'google_project_service.recaptcha_enterprise') {
    exact(change.before, {
      deletion_policy: 'PREVENT',
      disable_dependent_services: false,
      disable_on_destroy: false,
      id: `${PROJECT_ID}/${RECAPTCHA_API}`,
      project: PROJECT_ID,
      service: RECAPTCHA_API,
      timeouts: null,
    }, `${resource.address}.before`);
    exact(change.before_sensitive, {}, `${resource.address}.before_sensitive`);
    exact(change.after_sensitive, {}, `${resource.address}.after_sensitive`);
    return;
  }
  if (!plainObject(change.before) || !GUARD_ID.test(change.before.id ?? '')) {
    reject('Browser App Check state guard ID is invalid');
  }
  exact(change.before.input, {
    foundation: foundation(),
    web_app: {
      app_id: FIREBASE_APP_ID,
      display_name: FIREBASE_APP_DISPLAY_NAME,
      name: FIREBASE_APP_NAME,
    },
  }, `${resource.address}.input`);
  exact(change.before.output, change.before.input, `${resource.address}.output`);
  exact(change.before.triggers_replace, null, `${resource.address}.triggers_replace`);
  const sensitivity = {
    input: {
      foundation: { secret_ids: [false, false, false, false, false] },
      web_app: {},
    },
    output: {
      foundation: { secret_ids: [false, false, false, false, false] },
      web_app: {},
    },
  };
  exact(change.before_sensitive, sensitivity, `${resource.address}.before_sensitive`);
  exact(change.after_sensitive, sensitivity, `${resource.address}.after_sensitive`);
}

function validateChanges(plan) {
  if (!Array.isArray(plan.resource_changes)) reject('Browser App Check key resource changes are missing');
  exact(
    plan.resource_changes.map(({ address }) => address).sort(),
    Object.keys(RESOURCE_CHANGES).sort(),
    'Browser App Check key changed resources',
  );
  for (const resource of plan.resource_changes) {
    exact(resource.type, RESOURCE_CHANGES[resource.address], `${resource.address}.type`);
    exact(resource.mode, 'managed', `${resource.address}.mode`);
    if (resource.address !== 'google_recaptcha_enterprise_key.browser_app_check') {
      validateNoOp(resource);
      continue;
    }
    const change = exactKeys(resource.change, [
      'actions',
      'before',
      'after',
      'after_unknown',
      'before_sensitive',
      'after_sensitive',
    ], `${resource.address}.change`);
    exact(change.actions, ['create'], `${resource.address}.actions`);
    exact(change.before, null, `${resource.address}.before`);
    validateKeyAfter(change.after, resource.address);
    exact(change.after_unknown, {
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
    }, `${resource.address}.after_unknown`);
    exact(change.before_sensitive, false, `${resource.address}.before_sensitive`);
    exact(change.after_sensitive, {
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
    }, `${resource.address}.after_sensitive`);
  }
}

function validateOutput(plan) {
  const changes = exactKeys(
    plan.output_changes,
    ['staging_browser_app_check_api', 'staging_browser_app_check_key'],
    'Browser App Check key output changes',
  );
  exact(changes.staging_browser_app_check_api, {
    actions: ['delete'],
    before: apiOutput(),
    after: null,
    after_unknown: false,
    before_sensitive: false,
    after_sensitive: false,
  }, 'Browser App Check API output retirement');
  exact(changes.staging_browser_app_check_key, {
    actions: ['create'],
    before: null,
    after: browserAppCheckKeyOutput(),
    after_unknown: false,
    before_sensitive: false,
    after_sensitive: false,
  }, 'Browser App Check key output creation');
}

function validateChecks(plan) {
  if (!Array.isArray(plan.checks) || plan.checks.length !== 1) {
    reject('Browser App Check key plan must contain the passed state and Web-app guard');
  }
  const check = plan.checks[0];
  exact(check.address?.to_display, 'terraform_data.browser_app_check_guard', 'Browser App Check key guard address');
  exact(check.status, 'pass', 'Browser App Check key guard status');
  if (!Array.isArray(check.instances) || check.instances.length !== 1) {
    reject('Browser App Check key guard instance is missing');
  }
  exact(check.instances[0].address?.to_display, 'terraform_data.browser_app_check_guard', 'Browser App Check key guard instance address');
  exact(check.instances[0].status, 'pass', 'Browser App Check key guard instance status');
}

export function validateBrowserAppCheckKeyPlan(plan) {
  exactKeys(plan, [
    'applyable',
    'checks',
    'complete',
    'configuration',
    'errored',
    'format_version',
    'output_changes',
    'planned_values',
    'prior_state',
    'relevant_attributes',
    'resource_changes',
    'terraform_version',
    'timestamp',
  ], 'Browser App Check key Terraform plan');
  if (plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION || plan.applyable !== true
    || plan.complete !== true || plan.errored !== false
    || !plainObject(plan.planned_values) || !plainObject(plan.prior_state)
    || !Array.isArray(plan.relevant_attributes)
    || typeof plan.timestamp !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(plan.timestamp)
    || !Number.isFinite(Date.parse(plan.timestamp))) {
    reject('Browser App Check key Terraform plan header is invalid');
  }
  validateConfiguration(plan);
  validateChanges(plan);
  validateOutput(plan);
  validateChecks(plan);
  return Object.freeze({
    create: 1,
    update: 0,
    delete: 0,
    replace: 0,
    import: 0,
    recaptcha_keys_created: 1,
    allowed_domains: Object.freeze([HOSTING_DOMAIN]),
    integration_type: 'SCORE',
    testing_options: false,
    waf_settings: false,
    app_check_registration: false,
    app_check_enforcement: false,
    debug_tokens: 0,
    assessments: 0,
    public_ingress: false,
    resource_addresses: Object.freeze(['google_recaptcha_enterprise_key.browser_app_check']),
  });
}

export function readAndValidateBrowserAppCheckKeyPlan(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Browser App Check key Terraform plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check key Terraform plan is invalid JSON');
  }
  return validateBrowserAppCheckKeyPlan(plan);
}
