import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  TERRAFORM_VERSION,
} from './contract.mjs';

const MAXIMUM_PLAN_BYTES = 16 * 1024 * 1024;
const RESOURCES = Object.freeze({
  'google_identity_platform_config.firebase_auth': 'google_identity_platform_config',
  'terraform_data.firebase_auth_guard': 'terraform_data',
});
const DATA_RESOURCES = Object.freeze({
  'data.terraform_remote_state.foundation': 'terraform_remote_state',
});
const OUTPUT_NAME = 'staging_firebase_auth';
const INITIALIZE_PROFILE = 'initialize';
const RECONCILE_PROFILE = 'reconcile';
const OUTPUT_LEAF_REFERENCES = Object.freeze([
  'google_identity_platform_config.firebase_auth.autodelete_anonymous_users',
  'google_identity_platform_config.firebase_auth.client[0].permissions[0].disabled_user_deletion',
  'google_identity_platform_config.firebase_auth.client[0].permissions[0].disabled_user_signup',
  'google_identity_platform_config.firebase_auth.mfa[0].state',
  'google_identity_platform_config.firebase_auth.monitoring[0].request_logging[0].enabled',
  'google_identity_platform_config.firebase_auth.multi_tenant[0].allow_tenants',
  'google_identity_platform_config.firebase_auth.name',
  'google_identity_platform_config.firebase_auth.sign_in[0].allow_duplicate_emails',
  'google_identity_platform_config.firebase_auth.sign_in[0].anonymous[0].enabled',
  'google_identity_platform_config.firebase_auth.sign_in[0].email[0].enabled',
  'google_identity_platform_config.firebase_auth.sign_in[0].phone_number[0].enabled',
]);

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function exactKeys(value, expected, description) {
  if (!plainObject(value)) reject(`${description} is missing`);
  exact(Object.keys(value).sort(), [...expected].sort(), `${description} fields`);
  return value;
}

function validateConfigurationResource(resource) {
  exact(resource.schema_version, 0, `${resource.address}.schema_version`);
  if (resource.address === 'data.terraform_remote_state.foundation') {
    exact(resource.expressions, {
      backend: { constant_value: 'gcs' },
      config: {
        references: ['local.state_bucket_name', 'local.foundation_prefix'],
      },
    }, `${resource.address}.expressions`);
    return;
  }
  if (resource.address === 'terraform_data.firebase_auth_guard') {
    exact(resource.expressions, {
      input: {
        references: [
          'data.terraform_remote_state.foundation.outputs.staging_foundation',
          'data.terraform_remote_state.foundation.outputs',
          'data.terraform_remote_state.foundation',
        ],
      },
    }, `${resource.address}.expressions`);
    return;
  }
  exact(resource.depends_on, ['terraform_data.firebase_auth_guard'], `${resource.address}.depends_on`);
  exact(resource.expressions, {
    autodelete_anonymous_users: { constant_value: true },
    client: [{
      permissions: [{
        disabled_user_deletion: { constant_value: false },
        disabled_user_signup: { constant_value: false },
      }],
    }],
    mfa: [{ state: { constant_value: 'DISABLED' } }],
    monitoring: [{ request_logging: [{ enabled: { constant_value: false } }] }],
    multi_tenant: [{ allow_tenants: { constant_value: false } }],
    project: { references: ['local.project_id'] },
    sign_in: [{
      allow_duplicate_emails: { constant_value: false },
      anonymous: [{ enabled: { constant_value: false } }],
      email: [{
        enabled: { constant_value: false },
        password_required: { constant_value: true },
      }],
      phone_number: [{ enabled: { constant_value: false } }],
    }],
  }, `${resource.address}.expressions`);
}

function validateConfiguration(plan) {
  const root = plan.configuration?.root_module;
  if (!plainObject(root) || root.module_calls !== undefined || !Array.isArray(root.resources)) {
    reject('Firebase Auth Terraform configuration must be a flat root module');
  }
  const expected = { ...DATA_RESOURCES, ...RESOURCES };
  const seen = new Set();
  for (const resource of root.resources) {
    if (!plainObject(resource) || seen.has(resource.address)) reject('Invalid configuration resource');
    seen.add(resource.address);
    exact(resource.type, expected[resource.address], `${resource.address}.type`);
    exact(resource.mode, resource.address.startsWith('data.') ? 'data' : 'managed', `${resource.address}.mode`);
    exact(
      resource.provider_config_key,
      ['terraform_data', 'terraform_remote_state'].includes(resource.type) ? 'terraform' : 'google',
      `${resource.address}.provider`,
    );
    validateConfigurationResource(resource);
  }
  exact([...seen].sort(), Object.keys(expected).sort(), 'Firebase Auth configuration resources');
  const providers = plan.configuration?.provider_config;
  if (!plainObject(providers)) reject('Firebase Auth provider configuration is missing');
  exact(Object.keys(providers).sort(), ['google', 'terraform'], 'Firebase Auth providers');
  exact(providers.google.full_name, 'registry.terraform.io/hashicorp/google', 'Google provider');
  exact(providers.google.version_constraint, '8.1.0', 'Google provider version');
  exact(providers.terraform.full_name, 'terraform.io/builtin/terraform', 'Terraform provider');
}

function expectedOutputWithoutConfigName() {
  return {
    schema: 'miakapp.staging-firebase-auth/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    anonymous_sign_in: false,
    email_sign_in: false,
    phone_sign_in: false,
    duplicate_emails: false,
    user_signup_disabled: false,
    user_deletion_disabled: false,
    anonymous_user_autodelete: true,
    multi_tenant: false,
    mfa: 'DISABLED',
    request_logging: false,
  };
}

function expectedOutput() {
  return {
    ...expectedOutputWithoutConfigName(),
    config_name: `projects/${PROJECT_ID}/config`,
  };
}

function validateOutputs(plan, profile) {
  const outputs = plan.configuration?.root_module?.outputs;
  exact(Object.keys(exactKeys(outputs, [OUTPUT_NAME], 'Firebase Auth outputs')), [OUTPUT_NAME], 'Firebase Auth outputs');
  const output = exactKeys(outputs[OUTPUT_NAME], ['description', 'expression'], 'Firebase Auth output');
  exact(
    output.description,
    'Non-secret Firebase Auth baseline consumed by bounded staging probes.',
    'Firebase Auth output description',
  );
  const references = output.expression?.references;
  if (!Array.isArray(references)) reject('Firebase Auth output references are missing');
  const allowed = new Set([
    'local.project_id',
    'local.project_number',
    'google_identity_platform_config.firebase_auth',
    ...OUTPUT_LEAF_REFERENCES,
    ...OUTPUT_LEAF_REFERENCES.flatMap((reference) => {
      const parents = [];
      let current = reference;
      while (current.includes('.')) {
        current = current.replace(/(?:\.[^.[]+|\[\d+\])$/u, '');
        if (current.startsWith('google_identity_platform_config.firebase_auth')) parents.push(current);
        else break;
      }
      return parents;
    }),
  ]);
  if (references.some((reference) => typeof reference !== 'string' || !allowed.has(reference))
    || !OUTPUT_LEAF_REFERENCES.every((reference) => references.includes(reference))
    || !references.includes('local.project_id')
    || !references.includes('local.project_number')) {
    reject('Firebase Auth output is not derived from only the reviewed live configuration fields');
  }

  const changes = exactKeys(plan.output_changes, [OUTPUT_NAME], 'Firebase Auth output changes');
  const change = exactKeys(changes[OUTPUT_NAME], [
    'actions',
    'after',
    'after_sensitive',
    'after_unknown',
    'before',
    'before_sensitive',
  ], 'Firebase Auth output change');
  if (profile === INITIALIZE_PROFILE) {
    exact(change.actions, ['create'], 'Firebase Auth output actions');
    exact(change.before, null, 'Firebase Auth output before');
    exact(change.after, expectedOutputWithoutConfigName(), 'Firebase Auth output after');
    exact(change.after_unknown, { config_name: true }, 'Firebase Auth output unknowns');
  } else {
    if (![['create'], ['update'], ['no-op']]
      .some((actions) => isDeepStrictEqual(actions, change.actions))) {
      reject('Firebase Auth reconciliation output action is not reviewed');
    }
    exact(change.after, expectedOutput(), 'Firebase Auth reconciliation output after');
    exact(change.after_unknown, {}, 'Firebase Auth reconciliation output unknowns');
  }
  exact(change.before_sensitive, false, 'Firebase Auth output prior sensitivity');
  exact(change.after_sensitive, false, 'Firebase Auth output sensitivity');
  const plannedOutputs = exactKeys(
    plan.planned_values?.outputs,
    [OUTPUT_NAME],
    'Firebase Auth planned outputs',
  );
  const plannedOutput = plannedOutputs[OUTPUT_NAME];
  if (!plainObject(plannedOutput) || plannedOutput.sensitive !== false
    || Object.keys(plannedOutput).some((key) => !['sensitive', 'type', 'value'].includes(key))) {
    reject('Firebase Auth planned output is invalid');
  }
  if (profile === INITIALIZE_PROFILE) {
    exact(plannedOutput, { sensitive: false }, 'Firebase Auth planned output');
  } else {
    exact(plannedOutput.value, expectedOutput(), 'Firebase Auth planned output value');
  }
}

function validateFoundation(input, address) {
  if (!plainObject(input)) reject(`${address}.input is missing`);
  exact(input.project_id, PROJECT_ID, `${address}.project_id`);
  exact(String(input.project_number), PROJECT_NUMBER, `${address}.project_number`);
  exact(input.region, REGION, `${address}.region`);
  exact(
    input.runtime_service_account,
    `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`,
    `${address}.runtime_service_account`,
  );
  exact(input.firestore_database, '(default)', `${address}.firestore_database`);
  exact(input.component_bucket, 'miakapp-v4-staging-components', `${address}.component_bucket`);
  exact(
    input.signing_key,
    `projects/${PROJECT_ID}/locations/${REGION}/keyRings/${PROJECT_ID}/cryptoKeys/access-token-signing`,
    `${address}.signing_key`,
  );
  exact([...input.secret_ids].sort(), [
    'miakapp-audit-hmac',
    'miakapp-component-hmac',
    'miakapp-home-key-pepper',
    'miakapp-network-hmac',
    'miakapp-push-hmac',
  ].sort(), `${address}.secret_ids`);
}

function single(value, description) {
  if (!Array.isArray(value) || value.length !== 1 || !plainObject(value[0])) {
    reject(`${description} must contain exactly one block`);
  }
  return value[0];
}

function validateFirebaseAuth(value, address, profile) {
  const baseKeys = [
    'autodelete_anonymous_users',
    'blocking_functions',
    'client',
    'mfa',
    'monitoring',
    'multi_tenant',
    'project',
    'quota',
    'sign_in',
    'timeouts',
  ];
  exactKeys(value, profile === INITIALIZE_PROFILE ? baseKeys : [
    ...baseKeys,
    'authorized_domains',
    'id',
    'name',
    'sms_region_config',
  ], address);
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.autodelete_anonymous_users, true, `${address}.autodelete_anonymous_users`);
  exact(value.blocking_functions, [], `${address}.blocking_functions`);
  exact(value.quota, [], `${address}.quota`);
  exact(value.timeouts, null, `${address}.timeouts`);
  const client = single(value.client, `${address}.client`);
  if (profile === RECONCILE_PROFILE) {
    exactKeys(client, ['api_key', 'firebase_subdomain', 'permissions'], `${address}.client`);
    if (typeof client.api_key !== 'string' || !/^AIza[0-9A-Za-z_-]{30,}$/u.test(client.api_key)) {
      reject(`${address}.client.api_key is malformed`);
    }
    exact(client.firebase_subdomain, `${PROJECT_ID}.firebaseapp.com`, `${address}.client.firebase_subdomain`);
    exact(value.id, `projects/${PROJECT_ID}/config`, `${address}.id`);
    exact(value.name, `projects/${PROJECT_ID}/config`, `${address}.name`);
    if (!Array.isArray(value.authorized_domains)
      || value.authorized_domains.some((domain) => ![
        'localhost',
        `${PROJECT_ID}.firebaseapp.com`,
        `${PROJECT_ID}.web.app`,
      ].includes(domain))) {
      reject(`${address}.authorized_domains contains an unreviewed domain`);
    }
  }
  const permissions = single(client.permissions, `${address}.permissions`);
  exact(permissions.disabled_user_deletion, false, `${address}.disabled_user_deletion`);
  exact(permissions.disabled_user_signup, false, `${address}.disabled_user_signup`);
  const mfa = single(value.mfa, `${address}.mfa`);
  exactKeys(mfa, ['enabled_providers', 'provider_configs', 'state'], `${address}.mfa`);
  exact(mfa.enabled_providers, null, `${address}.mfa.enabled_providers`);
  exact(mfa.provider_configs, [], `${address}.mfa.provider_configs`);
  exact(mfa.state, 'DISABLED', `${address}.mfa.state`);
  exact(
    single(single(value.monitoring, `${address}.monitoring`).request_logging, `${address}.request_logging`).enabled,
    false,
    `${address}.request_logging.enabled`,
  );
  const multiTenant = single(value.multi_tenant, `${address}.multi_tenant`);
  exact(multiTenant.allow_tenants, false, `${address}.allow_tenants`);
  exact(multiTenant.default_tenant_location, null, `${address}.default_tenant_location`);
  const signIn = single(value.sign_in, `${address}.sign_in`);
  exact(signIn.allow_duplicate_emails, false, `${address}.allow_duplicate_emails`);
  exact(single(signIn.anonymous, `${address}.anonymous`).enabled, false, `${address}.anonymous.enabled`);
  const email = single(signIn.email, `${address}.email`);
  exact(email.enabled, false, `${address}.email.enabled`);
  exact(email.password_required, true, `${address}.email.password_required`);
  const phone = single(signIn.phone_number, `${address}.phone_number`);
  exact(phone.enabled, false, `${address}.phone.enabled`);
  exact(phone.test_phone_numbers, null, `${address}.phone.test_phone_numbers`);
  if (profile === RECONCILE_PROFILE && value.sms_region_config !== null
    && !isDeepStrictEqual(value.sms_region_config, [])) {
    reject(`${address}.sms_region_config must remain empty`);
  }
}

function validateUnknowns(value, address, profile) {
  if (profile === RECONCILE_PROFILE && address !== 'terraform_data.firebase_auth_guard') {
    exact(value, {}, `${address}.after_unknown`);
    return;
  }
  if (address === 'terraform_data.firebase_auth_guard') {
    exact(value, {
      id: true,
      input: { secret_ids: [false, false, false, false, false] },
      output: true,
    }, `${address}.after_unknown`);
    return;
  }
  exact(value, {
    authorized_domains: true,
    blocking_functions: [],
    client: [{
      api_key: true,
      firebase_subdomain: true,
      permissions: [{}],
    }],
    id: true,
    mfa: [{ provider_configs: [] }],
    monitoring: [{ request_logging: [{}] }],
    multi_tenant: [{}],
    name: true,
    quota: [],
    sign_in: [{
      anonymous: [{}],
      email: [{}],
      hash_config: true,
      phone_number: [{}],
    }],
    sms_region_config: true,
  }, `${address}.after_unknown`);
}

function rejectForbidden(value, profile, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbidden(entry, profile, [...path, index]));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) rejectForbidden(entry, profile, [...path, key]);
    return;
  }
  if (typeof value !== 'string') return;
  const productLabel = value === 'miakapp-v4' && path.at(-1) === 'product'
    && ['labels', 'effective_labels', 'terraform_labels'].includes(path.at(-2));
  const reviewedRecoveryApiKey = profile === RECONCILE_PROFILE
    && path.at(-1) === 'api_key'
    && /^AIza[0-9A-Za-z_-]{30,}$/u.test(value);
  if (value === 'allUsers' || value === 'allAuthenticatedUsers'
    || value.includes('miakapp-3') || value.includes('demo-miakapp-v4')
    || (value.includes('miakapp-v4') && !value.includes('miakapp-v4-staging') && !productLabel)
    || (!reviewedRecoveryApiKey
      && /AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value))) {
    reject('Firebase Auth plan contains a forbidden target, principal or credential');
  }
}

export function validateFirebaseAuthPlanAgainstPolicy(plan, profile = INITIALIZE_PROFILE) {
  if (![INITIALIZE_PROFILE, RECONCILE_PROFILE].includes(profile)) {
    reject('Firebase Auth plan validation profile is invalid');
  }
  if (!plainObject(plan) || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION || plan.applyable !== true
    || plan.complete !== true || plan.errored !== false) {
    reject('Firebase Auth plan metadata is invalid');
  }
  if (plan.variables !== undefined) exact(plan.variables, {}, 'Firebase Auth plan variables');
  validateConfiguration(plan);
  validateOutputs(plan, profile);
  if (!Array.isArray(plan.resource_changes)) reject('Firebase Auth resource changes are missing');
  const seen = new Set();
  let create = 0;
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string' || !plainObject(change.change)) {
      reject('Firebase Auth plan contains an invalid resource change');
    }
    if (change.mode === 'data') {
      if (DATA_RESOURCES[change.address] !== change.type
        || ![['read'], ['no-op']].some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
        reject('Firebase Auth plan contains an unreviewed data read');
      }
      continue;
    }
    if (change.mode !== 'managed' || RESOURCES[change.address] !== change.type
      || seen.has(change.address)) {
      reject('Firebase Auth plan contains an unreviewed managed resource');
    }
    seen.add(change.address);
    const allowedActions = change.address === 'terraform_data.firebase_auth_guard'
      ? [['create'], ['no-op']]
      : profile === INITIALIZE_PROFILE ? [['create']] : [['update'], ['no-op']];
    if (!allowedActions.some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
      reject(`${change.address} has an unreviewed ${profile} action`);
    }
    if (isDeepStrictEqual(change.change.actions, ['create'])) {
      exact(change.change.before, null, `${change.address}.before`);
      create += 1;
    }
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject('Firebase Auth plan must not import or generate configuration');
    }
    const value = change.change.after;
    if (!plainObject(value)) reject(`${change.address}.after is missing`);
    validateUnknowns(change.change.after_unknown, change.address, profile);
    if (change.address === 'terraform_data.firebase_auth_guard') validateFoundation(value.input, change.address);
    else {
      validateFirebaseAuth(value, change.address, profile);
      if (profile === RECONCILE_PROFILE) {
        if (!plainObject(change.change.before)) reject(`${change.address}.before is missing`);
        const beforeClient = single(change.change.before.client, `${change.address}.before.client`);
        const afterClient = single(value.client, `${change.address}.after.client`);
        exact(afterClient.api_key, beforeClient.api_key, `${change.address}.api_key continuity`);
        exact(afterClient.firebase_subdomain, beforeClient.firebase_subdomain, `${change.address}.subdomain continuity`);
        exact(value.authorized_domains, change.change.before.authorized_domains, `${change.address}.domain continuity`);
        exact(value.id, change.change.before.id, `${change.address}.id continuity`);
        exact(value.name, change.change.before.name, `${change.address}.name continuity`);
        exact(
          single(value.sign_in, `${change.address}.after.sign_in`).hash_config,
          single(change.change.before.sign_in, `${change.address}.before.sign_in`).hash_config,
          `${change.address}.hash_config continuity`,
        );
      }
    }
  }
  exact([...seen].sort(), Object.keys(RESOURCES).sort(), 'Firebase Auth managed changes');
  if (profile === INITIALIZE_PROFILE && (create < 1 || create > 2)) {
    reject('Firebase Auth plan must initialize exactly one configuration');
  }
  if (profile === RECONCILE_PROFILE && create > 1) {
    reject('Firebase Auth reconciliation may only create the local state guard');
  }
  rejectForbidden(plan, profile);
  return Object.freeze({
    create,
    update: profile === RECONCILE_PROFILE
      ? plan.resource_changes.filter((change) => isDeepStrictEqual(change.change?.actions, ['update'])).length
      : 0,
    delete: 0,
    identity_platform_configs: 1,
    sign_in_providers_enabled: 0,
    external_identity_providers: 0,
    public_invokers: 0,
    persistent_credentials_created: 0,
    irreversible_service_initialization: profile === INITIALIZE_PROFILE,
  });
}

export function readAndValidateFirebaseAuthPlan(path, profile = INITIALIZE_PROFILE) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Firebase Auth plan JSON size is invalid');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Firebase Auth plan JSON is invalid');
  }
  return validateFirebaseAuthPlanAgainstPolicy(value, profile);
}
