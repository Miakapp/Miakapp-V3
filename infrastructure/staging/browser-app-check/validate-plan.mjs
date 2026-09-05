import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_API,
  TERRAFORM_VERSION,
} from './contract.mjs';

const MAXIMUM_PLAN_BYTES = 16 * 1024 * 1024;
const MANAGED = Object.freeze({
  'google_project_service.recaptcha_enterprise': 'google_project_service',
  'terraform_data.browser_app_check_guard': 'terraform_data',
});
const DATA = Object.freeze({
  'data.google_firebase_web_app.staging': 'google_firebase_web_app',
  'data.terraform_remote_state.foundation': 'terraform_remote_state',
});
const CREATE_ADDRESSES = Object.freeze(Object.keys(MANAGED).sort());

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
    'Browser App Check API Terraform configuration',
  );
  const root = exactKeys(
    configuration.root_module,
    ['outputs', 'resources'],
    'Browser App Check API root module',
  );
  if (!Array.isArray(root.resources)) reject('Browser App Check API resources are missing');
  const expected = { ...DATA, ...MANAGED };
  const seen = new Set();
  for (const resource of root.resources) {
    if (!plainObject(resource) || seen.has(resource.address) || expected[resource.address] === undefined) {
      reject('Browser App Check API configuration contains an invalid resource');
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
      resource.address === 'google_project_service.recaptcha_enterprise'
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
    } else {
      exact(resource.depends_on, ['terraform_data.browser_app_check_guard'], `${resource.address}.depends_on`);
      exact(resource.expressions, {
        deletion_policy: { constant_value: 'PREVENT' },
        disable_dependent_services: { constant_value: false },
        disable_on_destroy: { constant_value: false },
        project: { references: ['local.project_id'] },
        service: { references: ['local.recaptcha_api'] },
      }, `${resource.address}.expressions`);
    }
  }
  exact([...seen].sort(), Object.keys(expected).sort(), 'Browser App Check API configuration resources');

  const providers = exactKeys(configuration.provider_config, [
    'google',
    'google-beta',
    'terraform',
  ], 'Browser App Check API providers');
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
    ['staging_browser_app_check_api'],
    'Browser App Check API configuration outputs',
  );
  exact(outputs.staging_browser_app_check_api, {
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
  }, 'Browser App Check API output configuration');
}

function validateGuardAfter(value, address) {
  exactKeys(value, ['input', 'triggers_replace'], `${address}.after`);
  exact(value.triggers_replace, null, `${address}.triggers_replace`);
  exact(value.input, {
    foundation: foundation(),
    web_app: {
      app_id: FIREBASE_APP_ID,
      display_name: FIREBASE_APP_DISPLAY_NAME,
      name: `projects/${PROJECT_ID}/webApps/${FIREBASE_APP_ID}`,
    },
  }, `${address}.input`);
}

function validateServiceAfter(value, address) {
  exact(value, {
    deletion_policy: 'PREVENT',
    disable_dependent_services: false,
    disable_on_destroy: false,
    project: PROJECT_ID,
    service: RECAPTCHA_API,
    timeouts: null,
  }, `${address}.after`);
}

function validateChanges(plan) {
  if (!Array.isArray(plan.resource_changes)) reject('Browser App Check API resource changes are missing');
  exact(
    plan.resource_changes.map(({ address }) => address).sort(),
    CREATE_ADDRESSES,
    'Browser App Check API changed resources',
  );
  for (const resource of plan.resource_changes) {
    exact(resource.type, MANAGED[resource.address], `${resource.address}.type`);
    exact(resource.mode, 'managed', `${resource.address}.mode`);
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
    if (!plainObject(change.after)) reject(`${resource.address}.after is missing`);
    if (resource.address === 'terraform_data.browser_app_check_guard') {
      validateGuardAfter(change.after, resource.address);
      exact(change.after_unknown, {
        id: true,
        input: {
          foundation: { secret_ids: [false, false, false, false, false] },
          web_app: {},
        },
        output: true,
      }, `${resource.address}.after_unknown`);
      exact(change.after_sensitive, {
        input: {
          foundation: { secret_ids: [false, false, false, false, false] },
          web_app: {},
        },
        output: {},
      }, `${resource.address}.after_sensitive`);
    } else {
      validateServiceAfter(change.after, resource.address);
      exact(change.after_unknown, { id: true }, `${resource.address}.after_unknown`);
      exact(change.after_sensitive, {}, `${resource.address}.after_sensitive`);
    }
    exact(change.before_sensitive, false, `${resource.address}.before_sensitive`);
  }
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

function validateOutput(plan) {
  const changes = exactKeys(
    plan.output_changes,
    ['staging_browser_app_check_api'],
    'Browser App Check API output changes',
  );
  const change = changes.staging_browser_app_check_api;
  exact(change.actions, ['create'], 'Browser App Check API output actions');
  exact(change.before, null, 'Browser App Check API output before');
  exact(change.after, apiOutput(), 'Browser App Check API output after');
  exact(change.before_sensitive, false, 'Browser App Check API prior output sensitivity');
  exact(change.after_sensitive, false, 'Browser App Check API output sensitivity');
  exact(change.after_unknown, false, 'Browser App Check API output unknown values');
}

function validateChecks(plan) {
  if (!Array.isArray(plan.checks) || plan.checks.length !== 1) {
    reject('Browser App Check API plan must contain the passed state and Web-app guard');
  }
  const check = plan.checks[0];
  exact(check.address?.to_display, 'terraform_data.browser_app_check_guard', 'Browser App Check API guard address');
  exact(check.status, 'pass', 'Browser App Check API guard status');
  if (!Array.isArray(check.instances) || check.instances.length !== 1) {
    reject('Browser App Check API guard instance is missing');
  }
  exact(check.instances[0].address?.to_display, 'terraform_data.browser_app_check_guard', 'Browser App Check API guard instance address');
  exact(check.instances[0].status, 'pass', 'Browser App Check API guard instance status');
}

export function validateBrowserAppCheckApiPlan(plan) {
  if (!plainObject(plan) || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION || plan.applyable !== true
    || plan.complete !== true || plan.errored !== false) {
    reject('Browser App Check API Terraform plan header is invalid');
  }
  validateConfiguration(plan);
  validateChanges(plan);
  validateOutput(plan);
  validateChecks(plan);
  return Object.freeze({
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
    resource_addresses: CREATE_ADDRESSES,
  });
}

export function readAndValidateBrowserAppCheckApiPlan(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Browser App Check API Terraform plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check API Terraform plan is invalid JSON');
  }
  return validateBrowserAppCheckApiPlan(plan);
}
