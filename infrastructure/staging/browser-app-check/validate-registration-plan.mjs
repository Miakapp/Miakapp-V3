import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  DEFAULT_RISK_SCORE,
  FIREBASE_APP_CONFIG_NAME,
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  FIREBASE_APP_NAME,
  HOSTING_DOMAIN,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_API,
  RECAPTCHA_DISPLAY_NAME,
  TERRAFORM_VERSION,
  canonicalJson,
  sha256,
} from './contract.mjs';
import {
  APP_CHECK_REGISTRATION_TTL,
  APP_CHECK_SITE_KEY_SHA256,
  RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
} from './registration-contract.mjs';
import { browserAppCheckKeyOutput } from './validate-key-plan.mjs';

const MAXIMUM_PLAN_BYTES = 16 * 1024 * 1024;
const REGISTRATION_ADDRESS =
  'google_firebase_app_check_recaptcha_enterprise_config.browser_app_check';
const RESOURCE_CHANGES = Object.freeze({
  [REGISTRATION_ADDRESS]: 'google_firebase_app_check_recaptcha_enterprise_config',
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
const SITE_KEY = /^[A-Za-z0-9_-]{20,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GUARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CONFIGURATION_OUTPUT_REFERENCES = Object.freeze([
  'data.google_firebase_web_app.staging',
  'data.google_firebase_web_app.staging.app_id',
  'data.google_firebase_web_app.staging.display_name',
  'google_firebase_app_check_recaptcha_enterprise_config.browser_app_check',
  'google_firebase_app_check_recaptcha_enterprise_config.browser_app_check.name',
  'google_firebase_app_check_recaptcha_enterprise_config.browser_app_check.site_key',
  'google_firebase_app_check_recaptcha_enterprise_config.browser_app_check.token_ttl',
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
]);
const RELEVANT_ATTRIBUTES = Object.freeze([
  ['data.google_firebase_web_app.staging', ['app_id']],
  ['data.google_firebase_web_app.staging', ['display_name']],
  [REGISTRATION_ADDRESS, ['name']],
  [REGISTRATION_ADDRESS, ['site_key']],
  [REGISTRATION_ADDRESS, ['token_ttl']],
  ['google_project_service.recaptcha_enterprise', ['service']],
  ['google_recaptcha_enterprise_key.browser_app_check', ['display_name']],
  ['google_recaptcha_enterprise_key.browser_app_check', ['name']],
  ['google_recaptcha_enterprise_key.browser_app_check', ['testing_options']],
  ['google_recaptcha_enterprise_key.browser_app_check', ['waf_settings']],
  ['google_recaptcha_enterprise_key.browser_app_check', ['web_settings', 0, 'allow_all_domains']],
  ['google_recaptcha_enterprise_key.browser_app_check', ['web_settings', 0, 'allow_amp_traffic']],
  ['google_recaptcha_enterprise_key.browser_app_check', ['web_settings', 0, 'allowed_domains']],
  ['google_recaptcha_enterprise_key.browser_app_check', ['web_settings', 0, 'integration_type']],
]);
const PRODUCTION_PLAN_CONTRACT = Object.freeze({
  site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
  key_resource_name_sha256: RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
  key_create_time: '2026-09-05T08:23:36Z',
});

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

function planContract(value) {
  exactKeys(value, [
    'site_key_sha256', 'key_resource_name_sha256', 'key_create_time',
  ], 'Browser App Check registration plan contract');
  if (!SHA256.test(value.site_key_sha256)
    || !SHA256.test(value.key_resource_name_sha256)
    || typeof value.key_create_time !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3}|\.\d{6}|\.\d{9})?Z$/u.test(value.key_create_time)
    || !Number.isFinite(Date.parse(value.key_create_time))) {
    reject('Browser App Check registration plan contract is invalid');
  }
  return value;
}

function siteKey(value, description, contract) {
  if (typeof value !== 'string' || !SITE_KEY.test(value)
    || sha256(Buffer.from(value, 'utf8')) !== contract.site_key_sha256) {
    reject(`${description} is not the exact reviewed public site key`);
  }
  return value;
}

export function validateBrowserAppCheckRegistrationConfiguration(plan) {
  const configuration = exactKeys(
    plan.configuration,
    ['provider_config', 'root_module'],
    'Browser App Check registration Terraform configuration',
  );
  const root = exactKeys(
    configuration.root_module,
    ['outputs', 'resources'],
    'Browser App Check registration root module',
  );
  if (!Array.isArray(root.resources)) reject('Browser App Check registration resources are missing');
  const expected = { ...DATA, ...RESOURCE_CHANGES };
  const seen = new Set();
  for (const resource of root.resources) {
    if (!plainObject(resource) || seen.has(resource.address) || expected[resource.address] === undefined) {
      reject('Browser App Check registration configuration contains an invalid resource');
    }
    seen.add(resource.address);
    const baseKeys = [
      'address', 'mode', 'type', 'name', 'provider_config_key', 'expressions', 'schema_version',
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
      || resource.type === 'google_firebase_app_check_recaptcha_enterprise_config'
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
      const references = resource.expressions?.input?.references;
      if (!Array.isArray(references) || references.some((entry) => typeof entry !== 'string')
        || ![
          'data.terraform_remote_state.foundation.outputs.staging_foundation',
          'data.google_firebase_web_app.staging.app_id',
          'data.google_firebase_web_app.staging.display_name',
          'data.google_firebase_web_app.staging.name',
        ].every((entry) => references.includes(entry))) {
        reject(`${resource.address}.input does not reference the reviewed guard values`);
      }
    } else if (resource.address === 'google_project_service.recaptcha_enterprise') {
      exact(resource.depends_on, ['terraform_data.browser_app_check_guard'], `${resource.address}.depends_on`);
      exact(resource.expressions, {
        deletion_policy: { constant_value: 'PREVENT' },
        disable_dependent_services: { constant_value: false },
        disable_on_destroy: { constant_value: false },
        project: { references: ['local.project_id'] },
        service: { references: ['local.recaptcha_api'] },
      }, `${resource.address}.expressions`);
    } else if (resource.address === 'google_recaptcha_enterprise_key.browser_app_check') {
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
    } else {
      exact(resource.depends_on, ['google_recaptcha_enterprise_key.browser_app_check'], `${resource.address}.depends_on`);
      exact(resource.expressions, {
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
      }, `${resource.address}.expressions`);
    }
  }
  exact([...seen].sort(), Object.keys(expected).sort(), 'Browser App Check registration configuration resources');

  const providers = exactKeys(configuration.provider_config, [
    'google', 'google-beta', 'terraform',
  ], 'Browser App Check registration providers');
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
    'Browser App Check registration configuration outputs',
  );
  const output = exactKeys(
    outputs.staging_browser_app_check_key,
    ['expression', 'description'],
    'Browser App Check registration output configuration',
  );
  exact(
    output.description,
    'Non-secret result of the isolated staging browser App Check registration prerequisite.',
    'Browser App Check registration output description',
  );
  const outputReferences = output.expression?.references;
  if (!Array.isArray(outputReferences)
    || outputReferences.some((entry) => typeof entry !== 'string')
    || !isDeepStrictEqual(
      [...new Set(outputReferences)].sort(),
      [...CONFIGURATION_OUTPUT_REFERENCES].sort(),
    )) {
    reject('Browser App Check registration output references have drifted');
  }
}

export function browserAppCheckRegistrationOutput(
  includeConfigName = true,
  contract = PRODUCTION_PLAN_CONTRACT,
) {
  const checkedContract = planContract(contract);
  return {
    app_check_enforcement: false,
    ...(includeConfigName ? { app_check_config_name: FIREBASE_APP_CONFIG_NAME } : {}),
    app_check_registered: true,
    app_check_site_key_sha256: checkedContract.site_key_sha256,
    app_check_token_ttl: APP_CHECK_REGISTRATION_TTL,
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
    schema: 'miakapp.staging-browser-app-check-registration/1',
  };
}

function validateKeyValue(value, description, contract) {
  exactKeys(value, [
    'android_settings', 'create_time', 'deletion_policy', 'display_name',
    'effective_labels', 'id', 'ios_settings', 'labels', 'name', 'project',
    'terraform_labels', 'testing_options', 'timeouts', 'waf_settings', 'web_settings',
  ], description);
  const shortName = siteKey(value.name, `${description}.name`, contract);
  if (value.id !== `projects/${PROJECT_ID}/keys/${shortName}`
    || sha256(Buffer.from(value.id, 'utf8')) !== contract.key_resource_name_sha256) {
    reject(`${description}.id is not the exact reviewed key resource name`);
  }
  exact({
    android_settings: value.android_settings,
    create_time: value.create_time,
    deletion_policy: value.deletion_policy,
    display_name: value.display_name,
    effective_labels: value.effective_labels,
    ios_settings: value.ios_settings,
    labels: value.labels,
    project: value.project,
    terraform_labels: value.terraform_labels,
    testing_options: value.testing_options,
    timeouts: value.timeouts,
    waf_settings: value.waf_settings,
    web_settings: value.web_settings,
  }, {
    android_settings: [],
    create_time: contract.key_create_time,
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
      challenge_security_preference: 'CHALLENGE_SECURITY_PREFERENCE_UNSPECIFIED',
      challenge_settings: [],
      integration_type: 'SCORE',
    }],
  }, description);
}

function validateNoOp(resource, contract) {
  const change = exactKeys(resource.change, [
    'actions', 'before', 'after', 'after_unknown', 'before_sensitive', 'after_sensitive',
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
  } else if (resource.address === 'google_recaptcha_enterprise_key.browser_app_check') {
    validateKeyValue(change.before, `${resource.address}.before`, contract);
    const sensitivity = {
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
    exact(change.before_sensitive, sensitivity, `${resource.address}.before_sensitive`);
    exact(change.after_sensitive, sensitivity, `${resource.address}.after_sensitive`);
  } else {
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
}

function validateChanges(plan, contract) {
  if (!Array.isArray(plan.resource_changes)) {
    reject('Browser App Check registration resource changes are missing');
  }
  exact(
    plan.resource_changes.map(({ address }) => address).sort(),
    Object.keys(RESOURCE_CHANGES).sort(),
    'Browser App Check registration changed resources',
  );
  for (const resource of plan.resource_changes) {
    exactKeys(resource, [
      'address', 'mode', 'type', 'name', 'provider_name', 'change',
    ], `${resource.address} resource change`);
    exact(resource.type, RESOURCE_CHANGES[resource.address], `${resource.address}.type`);
    exact(resource.mode, 'managed', `${resource.address}.mode`);
    const expectedProvider = resource.address === REGISTRATION_ADDRESS
      ? 'registry.terraform.io/hashicorp/google-beta'
      : resource.type === 'terraform_data'
        ? 'terraform.io/builtin/terraform'
        : 'registry.terraform.io/hashicorp/google';
    exact(resource.provider_name, expectedProvider, `${resource.address}.provider_name`);
    if (resource.address !== REGISTRATION_ADDRESS) {
      validateNoOp(resource, contract);
      continue;
    }
    const change = exactKeys(resource.change, [
      'actions', 'before', 'after', 'after_unknown', 'before_sensitive', 'after_sensitive',
    ], `${resource.address}.change`);
    exact(change.actions, ['create'], `${resource.address}.actions`);
    exact(change.before, null, `${resource.address}.before`);
    exactKeys(change.after, ['app_id', 'project', 'site_key', 'timeouts', 'token_ttl'], `${resource.address}.after`);
    exact(change.after.app_id, FIREBASE_APP_ID, `${resource.address}.app_id`);
    exact(change.after.project, PROJECT_ID, `${resource.address}.project`);
    siteKey(change.after.site_key, `${resource.address}.site_key`, contract);
    exact(change.after.timeouts, null, `${resource.address}.timeouts`);
    exact(change.after.token_ttl, APP_CHECK_REGISTRATION_TTL, `${resource.address}.token_ttl`);
    exact(change.after_unknown, { id: true, name: true }, `${resource.address}.after_unknown`);
    exact(change.before_sensitive, false, `${resource.address}.before_sensitive`);
    exact(change.after_sensitive, {}, `${resource.address}.after_sensitive`);
    if (change.importing !== undefined || change.generated_config !== undefined) {
      reject('Browser App Check registration must not import or generate configuration');
    }
  }
}

function validateCreateOutput(plan, contract) {
  const changes = exactKeys(
    plan.output_changes,
    ['staging_browser_app_check_key'],
    'Browser App Check registration output changes',
  );
  exact(changes.staging_browser_app_check_key, {
    actions: ['update'],
    before: browserAppCheckKeyOutput(),
    after: browserAppCheckRegistrationOutput(false, contract),
    after_unknown: {
      app_check_config_name: true,
      recaptcha_allowed_domains: [false],
    },
    before_sensitive: false,
    after_sensitive: false,
  }, 'Browser App Check registration output update');
}

function validateReconciliationOutput(plan, contract) {
  const changes = exactKeys(
    plan.output_changes,
    ['staging_browser_app_check_key'],
    'Browser App Check registration reconciliation output changes',
  );
  exact(changes.staging_browser_app_check_key, {
    actions: ['update'],
    before: browserAppCheckKeyOutput(),
    after: browserAppCheckRegistrationOutput(true, contract),
    after_unknown: {
      recaptcha_allowed_domains: [false],
    },
    before_sensitive: false,
    after_sensitive: false,
  }, 'Browser App Check registration reconciliation output update');
}

function validateRegistrationNoOp(resource, contract) {
  exact(resource.address, REGISTRATION_ADDRESS, 'Registration reconciliation address');
  exact(resource.mode, 'managed', `${REGISTRATION_ADDRESS}.mode`);
  exact(resource.type, RESOURCE_CHANGES[REGISTRATION_ADDRESS], `${REGISTRATION_ADDRESS}.type`);
  exact(
    resource.provider_name,
    'registry.terraform.io/hashicorp/google-beta',
    `${REGISTRATION_ADDRESS}.provider_name`,
  );
  const change = exactKeys(resource.change, [
    'actions', 'before', 'after', 'after_unknown', 'before_sensitive', 'after_sensitive',
  ], `${REGISTRATION_ADDRESS}.change`);
  exact(change.actions, ['no-op'], `${REGISTRATION_ADDRESS}.actions`);
  exact(change.after, change.before, `${REGISTRATION_ADDRESS}.before/after`);
  exactKeys(change.before, [
    'app_id', 'id', 'name', 'project', 'site_key', 'timeouts', 'token_ttl',
  ], `${REGISTRATION_ADDRESS}.before`);
  exact(change.before.app_id, FIREBASE_APP_ID, `${REGISTRATION_ADDRESS}.app_id`);
  exact(
    change.before.id,
    `projects/${PROJECT_ID}/apps/${FIREBASE_APP_ID}/recaptchaEnterpriseConfig`,
    `${REGISTRATION_ADDRESS}.id`,
  );
  exact(change.before.name, FIREBASE_APP_CONFIG_NAME, `${REGISTRATION_ADDRESS}.name`);
  exact(change.before.project, PROJECT_ID, `${REGISTRATION_ADDRESS}.project`);
  siteKey(change.before.site_key, `${REGISTRATION_ADDRESS}.site_key`, contract);
  exact(change.before.timeouts, null, `${REGISTRATION_ADDRESS}.timeouts`);
  exact(change.before.token_ttl, APP_CHECK_REGISTRATION_TTL, `${REGISTRATION_ADDRESS}.token_ttl`);
  exact(change.after_unknown, {}, `${REGISTRATION_ADDRESS}.after_unknown`);
  exact(change.before_sensitive, {}, `${REGISTRATION_ADDRESS}.before_sensitive`);
  exact(change.after_sensitive, {}, `${REGISTRATION_ADDRESS}.after_sensitive`);
}

function validateChecks(plan) {
  if (!Array.isArray(plan.checks) || plan.checks.length !== 1) {
    reject('Browser App Check registration plan must contain the passed state and Web-app guard');
  }
  const check = plan.checks[0];
  exact(check.address?.to_display, 'terraform_data.browser_app_check_guard', 'Browser App Check registration guard address');
  exact(check.status, 'pass', 'Browser App Check registration guard status');
  if (!Array.isArray(check.instances) || check.instances.length !== 1) {
    reject('Browser App Check registration guard instance is missing');
  }
  exact(check.instances[0].address?.to_display, 'terraform_data.browser_app_check_guard', 'Browser App Check registration guard instance address');
  exact(check.instances[0].status, 'pass', 'Browser App Check registration guard instance status');
}

function validateRelevantAttributes(value) {
  if (!Array.isArray(value)) reject('Browser App Check registration relevant attributes are missing');
  const actual = value.map((entry) => {
    if (!plainObject(entry) || typeof entry.resource !== 'string' || !Array.isArray(entry.attribute)) {
      reject('Browser App Check registration relevant attribute is malformed');
    }
    return canonicalJson([entry.resource, entry.attribute]);
  }).sort();
  exact(
    actual,
    RELEVANT_ATTRIBUTES.map((entry) => canonicalJson(entry)).sort(),
    'Browser App Check registration relevant attributes',
  );
}

function rejectForbidden(value, contract, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbidden(entry, contract, [...path, index]));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      rejectForbidden(entry, contract, [...path, key]);
    }
    return;
  }
  if (typeof value !== 'string') return;
  const allowedSiteKey = path.at(-1) === 'site_key'
    && SITE_KEY.test(value)
    && sha256(Buffer.from(value, 'utf8')) === contract.site_key_sha256;
  if (value === 'allUsers' || value === 'allAuthenticatedUsers'
    || value.includes('miakapp-3') || value.includes('demo-miakapp-v4')
    || (value.includes('miakapp-v4') && !value.includes(PROJECT_ID)
      && value !== 'miakapp-v4')
    || (!allowedSiteKey
      && /AIza[0-9A-Za-z_-]{20,}|ya29\.|-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value))) {
    reject('Browser App Check registration plan contains a forbidden target, principal or credential');
  }
}

function validatePlannedAndPriorValues(plan) {
  const plannedResources = plan.planned_values?.root_module?.resources;
  if (!Array.isArray(plannedResources)
    || !isDeepStrictEqual(
      plannedResources.map(({ address }) => address).sort(),
      Object.keys(RESOURCE_CHANGES).sort(),
    )) {
    reject('Browser App Check registration planned resource inventory has drifted');
  }
  const priorResources = plan.prior_state?.values?.root_module?.resources;
  if (!Array.isArray(priorResources)
    || !isDeepStrictEqual(
      priorResources.map(({ address }) => address).sort(),
      [...Object.keys(DATA), ...Object.keys(RESOURCE_CHANGES).filter(
        (address) => address !== REGISTRATION_ADDRESS,
      )].sort(),
    )) {
    reject('Browser App Check registration prior resource inventory has drifted');
  }
}

function validateRegistrationPlanWithContract(plan, contract) {
  const checkedContract = planContract(contract);
  exactKeys(plan, [
    'applyable', 'checks', 'complete', 'configuration', 'errored', 'format_version',
    'output_changes', 'planned_values', 'prior_state', 'relevant_attributes',
    'resource_changes', 'terraform_version', 'timestamp',
  ], 'Browser App Check registration Terraform plan');
  if (plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION
    || plan.applyable !== true
    || plan.complete !== true
    || plan.errored !== false
    || typeof plan.timestamp !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(plan.timestamp)
    || !Number.isFinite(Date.parse(plan.timestamp))) {
    reject('Browser App Check registration Terraform plan header is invalid');
  }
  validateBrowserAppCheckRegistrationConfiguration(plan);
  validateChanges(plan, checkedContract);
  validateCreateOutput(plan, checkedContract);
  validateChecks(plan);
  validateRelevantAttributes(plan.relevant_attributes);
  validatePlannedAndPriorValues(plan);
  rejectForbidden(plan, checkedContract);
  return Object.freeze({
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
    app_check_token_ttl: APP_CHECK_REGISTRATION_TTL,
    app_check_minimum_valid_score: DEFAULT_RISK_SCORE,
    app_check_site_key_sha256: checkedContract.site_key_sha256,
    app_check_enforcement: false,
    debug_tokens: 0,
    browser_requests: 0,
    assessments: 0,
    public_ingress: false,
    fixed_cost_services: 0,
    irreversible_app_check_registration: true,
    resource_addresses: Object.freeze([REGISTRATION_ADDRESS]),
  });
}

export function validateBrowserAppCheckRegistrationPlan(plan) {
  return validateRegistrationPlanWithContract(plan, PRODUCTION_PLAN_CONTRACT);
}

export function validateBrowserAppCheckRegistrationPlanFixture(plan, contract) {
  return validateRegistrationPlanWithContract(plan, contract);
}

function validateRegistrationReconciliationPlanWithContract(plan, contract) {
  const checkedContract = planContract(contract);
  exactKeys(plan, [
    'applyable', 'checks', 'complete', 'configuration', 'errored', 'format_version',
    'output_changes', 'planned_values', 'prior_state', 'relevant_attributes',
    'resource_changes', 'terraform_version', 'timestamp',
  ], 'Browser App Check registration reconciliation Terraform plan');
  if (plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION
    || plan.applyable !== true
    || plan.complete !== true
    || plan.errored !== false
    || typeof plan.timestamp !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(plan.timestamp)
    || !Number.isFinite(Date.parse(plan.timestamp))) {
    reject('Browser App Check registration reconciliation plan header is invalid');
  }
  validateBrowserAppCheckRegistrationConfiguration(plan);
  if (!Array.isArray(plan.resource_changes)) {
    reject('Browser App Check registration reconciliation resource changes are missing');
  }
  const addresses = plan.resource_changes.map(({ address }) => address);
  if (!addresses.includes(REGISTRATION_ADDRESS)
    || new Set(addresses).size !== addresses.length
    || addresses.some((address) => RESOURCE_CHANGES[address] === undefined)) {
    reject('Browser App Check registration reconciliation resource inventory has drifted');
  }
  for (const resource of plan.resource_changes) {
    exactKeys(resource, [
      'address', 'mode', 'type', 'name', 'provider_name', 'change',
    ], `${resource.address} reconciliation resource change`);
    const expectedProvider = resource.address === REGISTRATION_ADDRESS
      ? 'registry.terraform.io/hashicorp/google-beta'
      : resource.type === 'terraform_data'
        ? 'terraform.io/builtin/terraform'
        : 'registry.terraform.io/hashicorp/google';
    exact(resource.provider_name, expectedProvider, `${resource.address}.provider_name`);
    if (resource.address === REGISTRATION_ADDRESS) {
      validateRegistrationNoOp(resource, checkedContract);
    } else validateNoOp(resource, checkedContract);
  }
  validateReconciliationOutput(plan, checkedContract);
  validateChecks(plan);
  validateRelevantAttributes(plan.relevant_attributes);
  const plannedResources = plan.planned_values?.root_module?.resources;
  const priorResources = plan.prior_state?.values?.root_module?.resources;
  const allAddresses = [...Object.keys(DATA), ...Object.keys(RESOURCE_CHANGES)].sort();
  if (!Array.isArray(plannedResources)
    || !isDeepStrictEqual(
      plannedResources.map(({ address }) => address).sort(),
      Object.keys(RESOURCE_CHANGES).sort(),
    )
    || !Array.isArray(priorResources)
    || !isDeepStrictEqual(priorResources.map(({ address }) => address).sort(), allAddresses)) {
    reject('Browser App Check registration reconciliation state inventory has drifted');
  }
  rejectForbidden(plan, checkedContract);
  return Object.freeze({
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
  });
}

export function validateBrowserAppCheckRegistrationReconciliationPlan(plan) {
  return validateRegistrationReconciliationPlanWithContract(plan, PRODUCTION_PLAN_CONTRACT);
}

export function validateBrowserAppCheckRegistrationReconciliationPlanFixture(plan, contract) {
  return validateRegistrationReconciliationPlanWithContract(plan, contract);
}

export function readAndValidateBrowserAppCheckRegistrationPlan(path) {
  const bytes = readFileSync(path);
  return validateBrowserAppCheckRegistrationPlanBytes(bytes);
}

export function validateBrowserAppCheckRegistrationPlanBytes(bytes) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Browser App Check registration plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check registration plan is invalid JSON');
  }
  return validateBrowserAppCheckRegistrationPlan(plan);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) {
      throw new Error('Usage: node validate-registration-plan.mjs [plan.json]');
    }
    const bytes = readFileSync(process.argv[2] ?? 0);
    process.stdout.write(`${canonicalJson(validateBrowserAppCheckRegistrationPlanBytes(bytes))}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Plan validation failed');
    process.exitCode = 1;
  }
}
