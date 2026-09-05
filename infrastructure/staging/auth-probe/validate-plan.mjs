import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  CAPABILITY_EXPIRY,
  CLOUD_ASSET_SERVICE,
  CUSTOM_ROLE_ID,
  CUSTOM_ROLE_NAME,
  CUSTOM_ROLE_PERMISSIONS,
  FIREBASE_APP_ID,
  FIRESTORE_ROLE_ID,
  FIRESTORE_ROLE_NAME,
  FIRESTORE_ROLE_PERMISSIONS,
  FUNCTION_NAME,
  FUNCTION_URI,
  PROBE_ACCOUNT,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  SIGNER_ROLE_ID,
  SIGNER_ROLE_NAME,
  SIGNER_ROLE_PERMISSIONS,
  TERRAFORM_VERSION,
  VERIFIER_ACCOUNT,
  VERIFIER_SERVICE_NAME,
  VERIFIER_SERVICE_URI,
  VERIFIER_SOURCE,
  VERIFIER_SOURCE_SHA256,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_COMMIT,
  WORKLOAD_FUNCTION_REVISION,
  WORKLOAD_IMAGE,
  WORKLOAD_SOURCE_SHA256,
} from './contract.mjs';

const GOOGLE_PROVIDER = 'registry.terraform.io/hashicorp/google';
const TERRAFORM_PROVIDER = 'terraform.io/builtin/terraform';
const MAXIMUM_PLAN_BYTES = 16 * 1024 * 1024;
const REVISION = /^[0-9a-z][0-9a-z-]{0,62}$/u;
const TERRAFORM_DATA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PREVIOUS_WORKLOAD_SOURCE_SHA256 = '86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358';
const PREVIOUS_WORKLOAD_COMMIT = '60322c69c92b8ccf5f3d1bc87ba264a00e5dca05';
const PREVIOUS_WORKFLOW_SOURCE_SHA256 = '525b97d18a2848c1d852b9d117cb20cf464bbc1d7baa85b2d44d457487cd922c';
const PREVIOUS_CUSTOM_ROLE_PERMISSIONS = Object.freeze([
  'firebase.clients.get',
  'firebaseappcheck.tokens.mint',
  'firebaseauth.users.get',
  'serviceusage.services.use',
]);
const DATA_RESOURCES = Object.freeze({
  'data.terraform_remote_state.firebase_auth': Object.freeze({
    type: 'terraform_remote_state', provider: 'terraform', dependsOn: [],
  }),
  'data.terraform_remote_state.workload': Object.freeze({
    type: 'terraform_remote_state', provider: 'terraform', dependsOn: [],
  }),
});
const CONFIGURATION_RESOURCES = Object.freeze({
  'google_cloud_run_v2_service.auth_probe_verifier': Object.freeze({
    type: 'google_cloud_run_v2_service', provider: 'google',
    dependsOn: ['google_service_account.auth_probe_verifier', 'terraform_data.auth_probe_guard'],
  }),
  'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker': Object.freeze({
    type: 'google_cloud_run_v2_service_iam_member', provider: 'google', dependsOn: [],
  }),
  'google_project_iam_custom_role.auth_probe': Object.freeze({
    type: 'google_project_iam_custom_role', provider: 'google',
    dependsOn: ['google_project_service.auth_probe_asset_inventory', 'terraform_data.auth_probe_guard'],
  }),
  'google_project_iam_custom_role.auth_probe_firestore': Object.freeze({
    type: 'google_project_iam_custom_role', provider: 'google',
    dependsOn: ['terraform_data.auth_probe_guard'],
  }),
  'google_project_iam_custom_role.auth_probe_signer': Object.freeze({
    type: 'google_project_iam_custom_role', provider: 'google',
    dependsOn: ['terraform_data.auth_probe_guard'],
  }),
  'google_project_iam_member.auth_probe': Object.freeze({
    type: 'google_project_iam_member', provider: 'google',
    dependsOn: ['google_project_iam_custom_role.auth_probe'],
  }),
  'google_project_iam_member.auth_probe_firestore': Object.freeze({
    type: 'google_project_iam_member', provider: 'google',
    dependsOn: ['google_project_iam_custom_role.auth_probe_firestore'],
  }),
  'google_project_service.auth_probe_asset_inventory': Object.freeze({
    type: 'google_project_service', provider: 'google',
    dependsOn: ['terraform_data.auth_probe_guard'],
  }),
  'google_service_account.auth_probe_verifier': Object.freeze({
    type: 'google_service_account', provider: 'google',
    dependsOn: ['google_project_service.auth_probe_asset_inventory', 'terraform_data.auth_probe_guard'],
  }),
  'google_service_account_iam_member.auth_probe_self_signer': Object.freeze({
    type: 'google_service_account_iam_member', provider: 'google',
    dependsOn: ['google_project_iam_custom_role.auth_probe_signer', 'terraform_data.auth_probe_guard'],
  }),
  'google_workflows_workflow.auth_probe': Object.freeze({
    type: 'google_workflows_workflow', provider: 'google',
    dependsOn: [
      'google_project_iam_member.auth_probe',
      'google_project_iam_member.auth_probe_firestore',
      'google_service_account_iam_member.auth_probe_self_signer',
      'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker',
    ],
  }),
  'terraform_data.auth_probe_guard': Object.freeze({
    type: 'terraform_data', provider: 'terraform', dependsOn: [],
  }),
});
const CHANGE_RESOURCES = Object.freeze({
  'google_cloud_run_v2_service.auth_probe_verifier[0]': 'google_cloud_run_v2_service',
  'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]': 'google_cloud_run_v2_service_iam_member',
  'google_project_iam_custom_role.auth_probe': 'google_project_iam_custom_role',
  'google_project_iam_custom_role.auth_probe_firestore': 'google_project_iam_custom_role',
  'google_project_iam_custom_role.auth_probe_signer': 'google_project_iam_custom_role',
  'google_project_iam_member.auth_probe[0]': 'google_project_iam_member',
  'google_project_iam_member.auth_probe_firestore[0]': 'google_project_iam_member',
  'google_project_service.auth_probe_asset_inventory': 'google_project_service',
  'google_service_account.auth_probe_verifier': 'google_service_account',
  'google_service_account_iam_member.auth_probe_self_signer[0]': 'google_service_account_iam_member',
  'google_workflows_workflow.auth_probe[0]': 'google_workflows_workflow',
  'terraform_data.auth_probe_guard': 'terraform_data',
});
const TEMPORARY_RESOURCES = new Set([
  'google_cloud_run_v2_service.auth_probe_verifier[0]',
  'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]',
  'google_project_iam_member.auth_probe[0]',
  'google_project_iam_member.auth_probe_firestore[0]',
  'google_service_account_iam_member.auth_probe_self_signer[0]',
  'google_workflows_workflow.auth_probe[0]',
]);
const CUSTOM_ROLE_RESOURCES = new Set([
  'google_project_iam_custom_role.auth_probe',
  'google_project_iam_custom_role.auth_probe_firestore',
  'google_project_iam_custom_role.auth_probe_signer',
]);
const ARM_UPDATED_RESOURCES = new Set([
  'terraform_data.auth_probe_guard',
]);
const ARM_NOOP_RESOURCES = new Set([
  'google_project_iam_custom_role.auth_probe',
  'google_project_service.auth_probe_asset_inventory',
]);
const PERSISTENT_RECOVERY_RESOURCES = new Set([
  'google_project_iam_custom_role.auth_probe',
  'google_project_iam_custom_role.auth_probe_firestore',
  'google_project_iam_custom_role.auth_probe_signer',
  'google_project_service.auth_probe_asset_inventory',
  'google_service_account.auth_probe_verifier',
  'terraform_data.auth_probe_guard',
]);
const PLAN_PROFILES = Object.freeze({
  arm: Object.freeze({ complete: true, phase: 'arm' }),
  retire: Object.freeze({ complete: false, phase: 'retire' }),
  'retire-finalize': Object.freeze({ complete: true, phase: 'retire' }),
});

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} does not match the reviewed value`);
}

function sorted(value) {
  return [...value].sort();
}

function isReviewedProductLabel(path, value) {
  return value === 'miakapp-v4' && path.at(-1) === 'product'
    && ['labels', 'effective_labels', 'terraform_labels'].includes(path.at(-2));
}

function referencesProject(value, projectId) {
  return value === projectId
    || value.includes(`projects/${projectId}/`)
    || value.includes(`@${projectId}.`)
    || value.startsWith(`${projectId}.`);
}

function rejectForbiddenValues(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbiddenValues(entry, [...path, index]));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) rejectForbiddenValues(entry, [...path, key]);
    return;
  }
  if (typeof value !== 'string') return;
  if (value === 'allUsers' || value === 'allAuthenticatedUsers'
    || referencesProject(value, 'miakapp-3')
    || referencesProject(value, 'demo-miakapp-v4')
    || (referencesProject(value, 'miakapp-v4') && !isReviewedProductLabel(path, value))
    || /AIza[0-9A-Za-z_-]{30,}/u.test(value)
    || /(?:ya29\.[0-9A-Za-z_-]{20,}|eyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+)/u.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value)) {
    reject('Terraform Auth-probe plan contains a forbidden project, principal or credential');
  }
}

function validateConfiguration(plan) {
  const configuration = plan.configuration;
  if (!plainObject(configuration) || !plainObject(configuration.root_module)
    || configuration.root_module.module_calls !== undefined
    || !Array.isArray(configuration.root_module.resources)) {
    reject('Terraform configuration must contain one flat reviewed root module');
  }
  const expected = { ...DATA_RESOURCES, ...CONFIGURATION_RESOURCES };
  const seen = new Set();
  for (const resource of configuration.root_module.resources) {
    if (!plainObject(resource) || typeof resource.address !== 'string' || seen.has(resource.address)) {
      reject('Terraform configuration contains an invalid or duplicate resource');
    }
    const reviewed = expected[resource.address];
    if (reviewed === undefined) reject('Terraform configuration contains an unreviewed resource');
    seen.add(resource.address);
    exact(resource.type, reviewed.type, `${resource.address}.type`);
    exact(resource.mode, resource.address.startsWith('data.') ? 'data' : 'managed', `${resource.address}.mode`);
    exact(resource.provider_config_key, reviewed.provider, `${resource.address}.provider`);
    exact(sorted(resource.depends_on ?? []), sorted(reviewed.dependsOn), `${resource.address}.depends_on`);
  }
  exact(sorted(seen), sorted(Object.keys(expected)), 'Terraform configuration addresses');
  const providers = configuration.provider_config;
  if (!plainObject(providers)) reject('Terraform provider configuration is missing');
  exact(sorted(Object.keys(providers)), ['google', 'terraform'], 'Terraform providers');
  exact(providers.google.full_name, GOOGLE_PROVIDER, 'Google provider');
  exact(providers.google.version_constraint, '8.1.0', 'Google provider version');
  exact(providers.terraform.full_name, TERRAFORM_PROVIDER, 'Terraform built-in provider');
}

function firebaseAuthGuard(input, address) {
  exact(input.firebase_auth, {
    schema: 'miakapp.staging-firebase-auth/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    config_name: `projects/${PROJECT_NUMBER}/config`,
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
  }, `${address}.firebase_auth`);
}

function validateGuard(value, address, previous = false) {
  const input = value.input;
  if (!plainObject(input)) reject(`${address}.input is missing`);
  const common = {
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    function_name: FUNCTION_NAME,
    function_uri: FUNCTION_URI,
    probe_service_account: PROBE_ACCOUNT,
    source_sha256: previous ? PREVIOUS_WORKLOAD_SOURCE_SHA256 : WORKLOAD_SOURCE_SHA256,
    repository_commit: previous ? PREVIOUS_WORKLOAD_COMMIT : WORKLOAD_COMMIT,
    ingress: 'ALLOW_INTERNAL_ONLY',
    unauthenticated: false,
    minimum_instances: 0,
    maximum_instances: 1,
    firebase_auth: input.firebase_auth,
    firebase_app_id: FIREBASE_APP_ID,
    workflow_source_sha256: previous ? PREVIOUS_WORKFLOW_SOURCE_SHA256 : WORKFLOW_SOURCE_SHA256,
  };
  exact(input, previous ? common : {
    ...common,
    verifier_source_sha256: VERIFIER_SOURCE_SHA256,
    verifier_service_uri: VERIFIER_SERVICE_URI,
    verifier_identity: VERIFIER_ACCOUNT,
    verifier_image: WORKLOAD_IMAGE,
    capability_expiry: CAPABILITY_EXPIRY,
  }, `${address}.input`);
  firebaseAuthGuard(input, address);
}

export function classifyAuthProbeGuardValue(value) {
  try {
    validateGuard(value, 'terraform_data.auth_probe_guard');
    return 'current';
  } catch {
    try {
      validateGuard(value, 'terraform_data.auth_probe_guard', true);
      return 'previous';
    } catch {
      return reject('terraform_data.auth_probe_guard does not match a reviewed generation');
    }
  }
}

function validateGuardTransition(change, address) {
  exact(sorted(Object.keys(change)), [
    'actions', 'after', 'after_sensitive', 'after_unknown', 'before', 'before_sensitive',
  ], `${address}.change fields`);
  const { before, after } = change;
  if (!plainObject(before) || !plainObject(after)
    || typeof before.id !== 'string' || !TERRAFORM_DATA_ID.test(before.id)) {
    reject(`${address} transition identity is invalid`);
  }
  exact(sorted(Object.keys(before)), ['id', 'input', 'output', 'triggers_replace'], `${address}.before fields`);
  exact(sorted(Object.keys(after)), ['id', 'input', 'triggers_replace'], `${address}.after fields`);
  exact(after.id, before.id, `${address}.id continuity`);
  exact(before.output, before.input, `${address}.previous output`);
  exact(before.triggers_replace, null, `${address}.before.triggers_replace`);
  exact(after.triggers_replace, null, `${address}.after.triggers_replace`);
  validateGuard(before, `${address}.before`, true);
  validateGuard(after, `${address}.after`);
  exact(change.after_unknown, { input: { firebase_auth: {} }, output: true }, `${address}.after_unknown`);
  exact(change.before_sensitive, {
    input: { firebase_auth: {} }, output: { firebase_auth: {} },
  }, `${address}.before_sensitive`);
  exact(change.after_sensitive, { input: { firebase_auth: {} }, output: {} }, `${address}.after_sensitive`);
}

function validateRole(value, address, expected, expectedStage = 'GA') {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.role_id, expected.id, `${address}.role_id`);
  exact(value.title, expected.title, `${address}.title`);
  exact(value.description, expected.description, `${address}.description`);
  exact(sorted(value.permissions), sorted(expected.permissions), `${address}.permissions`);
  exact(value.stage, expectedStage, `${address}.stage`);
  if (value.deleted !== undefined) exact(value.deleted, false, `${address}.deleted`);
  if (value.name !== undefined) exact(value.name, expected.name, `${address}.name`);
  if (value.id !== undefined) exact(value.id, expected.name, `${address}.id`);
}

const AUTH_ROLE = Object.freeze({
  id: CUSTOM_ROLE_ID,
  name: CUSTOM_ROLE_NAME,
  title: 'Miakapp staging Auth probe',
  description: 'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
  permissions: CUSTOM_ROLE_PERMISSIONS,
});
const PREVIOUS_AUTH_ROLE = Object.freeze({
  ...AUTH_ROLE,
  description: 'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
  permissions: PREVIOUS_CUSTOM_ROLE_PERMISSIONS,
});
const SIGNER_ROLE = Object.freeze({
  id: SIGNER_ROLE_ID,
  name: SIGNER_ROLE_NAME,
  title: 'Miakapp staging probe signer',
  description: 'Dormant self-scoped signing role for bounded staging probes.',
  permissions: SIGNER_ROLE_PERMISSIONS,
});
const FIRESTORE_ROLE = Object.freeze({
  id: FIRESTORE_ROLE_ID,
  name: FIRESTORE_ROLE_NAME,
  title: 'Miakapp staging probe Firestore access',
  description: 'Dormant database-scoped CRUD role for bounded staging probe fixtures.',
  permissions: FIRESTORE_ROLE_PERMISSIONS,
});

function validateAuthRoleTransition(change, address) {
  exact(sorted(Object.keys(change)), [
    'actions', 'after', 'after_sensitive', 'after_unknown', 'before', 'before_sensitive',
  ], `${address}.change fields`);
  validateRole(change.before, `${address}.before`, PREVIOUS_AUTH_ROLE);
  validateRole(change.after, `${address}.after`, AUTH_ROLE);
  exact(change.after_unknown, {}, `${address}.after_unknown`);
  exact(change.before_sensitive, {
    permissions: PREVIOUS_CUSTOM_ROLE_PERMISSIONS.map(() => false),
  }, `${address}.before_sensitive`);
  exact(change.after_sensitive, {
    permissions: CUSTOM_ROLE_PERMISSIONS.map(() => false),
  }, `${address}.after_sensitive`);
}

function validateRoleDisableTransition(change, address, expected) {
  exact(sorted(Object.keys(change)), [
    'actions', 'after', 'after_sensitive', 'after_unknown', 'before', 'before_sensitive',
  ], `${address}.change fields`);
  validateRole(change.before, `${address}.before`, expected, 'GA');
  validateRole(change.after, `${address}.after`, expected, 'DISABLED');
  exact(change.after_unknown, {}, `${address}.after_unknown`);
  exact(change.before_sensitive, {
    permissions: expected.permissions.map(() => false),
  }, `${address}.before_sensitive`);
  exact(change.after_sensitive, {
    permissions: expected.permissions.map(() => false),
  }, `${address}.after_sensitive`);
}

function expiryCondition(description) {
  return [{
    title: 'temporary_user_relay_probe',
    description,
    expression: `request.time < timestamp(\"${CAPABILITY_EXPIRY}\")`,
  }];
}

function validateAuthBinding(value, address) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.role, CUSTOM_ROLE_NAME, `${address}.role`);
  exact(value.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
  exact(value.condition, expiryCondition(
    'Expires the user-relay probe Firebase capability independently of cleanup.',
  ), `${address}.condition`);
}

function validateFirestoreBinding(value, address) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.role, FIRESTORE_ROLE_NAME, `${address}.role`);
  exact(value.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
  exact(value.condition, [{
    title: 'temporary_user_relay_probe_default_database',
    description: 'Limits the temporary probe fixture capability to the default database and arm window.',
    expression: `resource.name == \"projects/${PROJECT_ID}/databases/(default)\" && request.time < timestamp(\"${CAPABILITY_EXPIRY}\")`,
  }], `${address}.condition`);
}

function validateSignerBinding(value, address) {
  exact(value.service_account_id, `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`, `${address}.service_account_id`);
  exact(value.role, SIGNER_ROLE_NAME, `${address}.role`);
  exact(value.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
  exact(value.condition, expiryCondition(
    'Expires the user-relay probe self-signing capability independently of cleanup.',
  ), `${address}.condition`);
}

function validateVerifierInvoker(value, address) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.location, REGION, `${address}.location`);
  exact(value.name, VERIFIER_SERVICE_NAME, `${address}.name`);
  exact(value.role, 'roles/run.servicesInvoker', `${address}.role`);
  exact(value.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
  exact(value.condition, expiryCondition(
    'Expires invocation of the temporary verifier independently of cleanup.',
  ), `${address}.condition`);
}

function validateVerifierAccount(value, address) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.account_id, 'miakapp-staging-verifier', `${address}.account_id`);
  exact(value.display_name, 'Miakapp V4 staging probe verifier', `${address}.display_name`);
  exact(value.description, 'Keyless no-role identity for the temporary internal JWT verifier.', `${address}.description`);
  exact(value.disabled, false, `${address}.disabled`);
  exact(value.email, VERIFIER_ACCOUNT, `${address}.email`);
  exact(value.member, `serviceAccount:${VERIFIER_ACCOUNT}`, `${address}.member`);
}

function validateAssetInventoryService(value, address) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.service, CLOUD_ASSET_SERVICE, `${address}.service`);
  if (![false, null].includes(value.disable_dependent_services)) {
    reject(`${address}.disable_dependent_services does not match the reviewed value`);
  }
  if (![false, null].includes(value.disable_on_destroy)) {
    reject(`${address}.disable_on_destroy does not match the reviewed value`);
  }
  if (value.id !== undefined) exact(value.id, `${PROJECT_ID}/${CLOUD_ASSET_SERVICE}`, `${address}.id`);
}

function validateLabels(value, purpose, address) {
  exact(value?.environment, 'staging', `${address}.environment`);
  exact(value?.['managed-by'], 'terraform', `${address}.managed-by`);
  exact(value?.product, 'miakapp-v4', `${address}.product`);
  exact(value?.purpose, purpose, `${address}.purpose`);
}

function validateVerifierService(value, address) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.location, REGION, `${address}.location`);
  exact(value.name, VERIFIER_SERVICE_NAME, `${address}.name`);
  exact(value.description, 'Temporary internal verifier for the bounded staging user-relay probe.', `${address}.description`);
  exact(value.ingress, 'INGRESS_TRAFFIC_INTERNAL_ONLY', `${address}.ingress`);
  exact(value.default_uri_disabled, false, `${address}.default_uri_disabled`);
  exact(value.invoker_iam_disabled, false, `${address}.invoker_iam_disabled`);
  exact(value.deletion_protection, false, `${address}.deletion_protection`);
  validateLabels(value.labels, 'user-relay-jwt-verifier', `${address}.labels`);
  exact(value.annotations, null, `${address}.annotations`);
  exact(value.custom_audiences, null, `${address}.custom_audiences`);
  exact(value.iap_enabled, null, `${address}.iap_enabled`);
  exact(value.binary_authorization, [], `${address}.binary_authorization`);
  exact(value.build_config, [], `${address}.build_config`);
  exact(value.template?.length, 1, `${address}.template length`);
  const template = value.template[0];
  exact(template.service_account, VERIFIER_ACCOUNT, `${address}.template.service_account`);
  exact(template.timeout, '30s', `${address}.template.timeout`);
  exact(template.max_instance_request_concurrency, 1, `${address}.template.concurrency`);
  exact(template.execution_environment, 'EXECUTION_ENVIRONMENT_GEN2', `${address}.template.execution_environment`);
  exact(template.annotations, null, `${address}.template.annotations`);
  exact(template.vpc_access, [], `${address}.template.vpc_access`);
  exact(template.volumes, [], `${address}.template.volumes`);
  exact(template.scaling, [{ min_instance_count: 0, max_instance_count: 1 }], `${address}.template.scaling`);
  exact(template.containers?.length, 1, `${address}.container length`);
  const container = template.containers[0];
  exact(container.name, 'verifier', `${address}.container.name`);
  exact(container.image, WORKLOAD_IMAGE, `${address}.container.image`);
  exact(container.command, ['node'], `${address}.container.command`);
  exact(container.args, ['--input-type=module', '--eval', `${VERIFIER_SOURCE}\nstart();`], `${address}.container.args`);
  exact(container.env, [], `${address}.container.env`);
  exact(container.volume_mounts, [], `${address}.container.volume_mounts`);
  exact(container.ports, [{ name: 'http1', container_port: 8080 }], `${address}.container.ports`);
  exact(container.resources, [{
    limits: { cpu: '1', memory: '512Mi' }, cpu_idle: true, startup_cpu_boost: false,
  }], `${address}.container.resources`);
}

function validateWorkflow(value, address, profile) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.region, REGION, `${address}.region`);
  exact(value.name, WORKFLOW_NAME, `${address}.name`);
  exact(value.description, 'One-shot private audience-bound user-relay credential probe for Miakapp V4 staging.', `${address}.description`);
  exact(value.service_account, profile === 'arm'
    ? PROBE_ACCOUNT
    : `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`, `${address}.service_account`);
  exact(value.source_contents, WORKFLOW_SOURCE, `${address}.source_contents`);
  exact(value.call_log_level, 'LOG_NONE', `${address}.call_log_level`);
  exact(value.execution_history_level, 'EXECUTION_HISTORY_BASIC', `${address}.execution_history_level`);
  exact(value.deletion_protection, false, `${address}.deletion_protection`);
  validateLabels(value.labels, 'user-relay-probe', `${address}.labels`);
  if (/^\s*retry:/mu.test(value.source_contents)
    || /events\.create|google_cloud_scheduler|allUsers|allAuthenticatedUsers/u.test(value.source_contents)) {
    reject('Auth-probe Workflow contains scheduling, retry or public-access behavior');
  }
  if (value.revision_id !== undefined && value.revision_id !== null && !REVISION.test(value.revision_id)) {
    reject('Auth-probe Workflow revision is invalid');
  }
  return value.revision_id ?? null;
}

function validateResourceValue(address, value, profile) {
  if (!plainObject(value)) reject(`${address} reviewed value is missing`);
  const customRoleStage = PLAN_PROFILES[profile].phase === 'arm' ? 'GA' : 'DISABLED';
  switch (address) {
    case 'terraform_data.auth_probe_guard': validateGuard(value, address); break;
    case 'google_project_iam_custom_role.auth_probe': validateRole(value, address, AUTH_ROLE, customRoleStage); break;
    case 'google_project_iam_custom_role.auth_probe_firestore': validateRole(value, address, FIRESTORE_ROLE, customRoleStage); break;
    case 'google_project_iam_custom_role.auth_probe_signer': validateRole(value, address, SIGNER_ROLE, customRoleStage); break;
    case 'google_project_iam_member.auth_probe[0]': validateAuthBinding(value, address); break;
    case 'google_project_iam_member.auth_probe_firestore[0]': validateFirestoreBinding(value, address); break;
    case 'google_service_account_iam_member.auth_probe_self_signer[0]': validateSignerBinding(value, address); break;
    case 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]': validateVerifierInvoker(value, address); break;
    case 'google_service_account.auth_probe_verifier': validateVerifierAccount(value, address); break;
    case 'google_project_service.auth_probe_asset_inventory': validateAssetInventoryService(value, address); break;
    case 'google_cloud_run_v2_service.auth_probe_verifier[0]': validateVerifierService(value, address); break;
    case 'google_workflows_workflow.auth_probe[0]': return validateWorkflow(value, address, profile);
    default: reject('Terraform Auth-probe plan contains an unreviewed resource');
  }
  return null;
}

function expectedActions(address, profile) {
  if (PLAN_PROFILES[profile].phase === 'arm') {
    if (ARM_UPDATED_RESOURCES.has(address)) return [['update']];
    return ARM_NOOP_RESOURCES.has(address) ? [['no-op']] : [['create']];
  }
  if (CUSTOM_ROLE_RESOURCES.has(address)) {
    return [['update'], ['no-op']];
  }
  return TEMPORARY_RESOURCES.has(address) ? [['delete']] : [['no-op']];
}

export function validateAuthProbePlanAgainstPolicy(plan, profile) {
  const settings = PLAN_PROFILES[profile];
  if (settings === undefined) reject('Auth-probe plan profile is invalid');
  const { complete, phase } = settings;
  if (!plainObject(plan) || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION || plan.applyable !== true
    || plan.complete !== complete || plan.errored !== false) {
    reject('Terraform Auth-probe plan metadata is invalid');
  }
  exact(plan.variables, { armed: { value: phase === 'arm' ? 'true' : 'false' } }, 'Terraform Auth-probe variables');
  validateConfiguration(plan);
  if (!Array.isArray(plan.resource_changes)) reject('Terraform resource changes are missing');

  const seen = new Set();
  const dataSeen = new Set();
  let create = 0;
  let update = 0;
  let remove = 0;
  let workflowRevision = phase === 'retire' ? 'absent' : null;
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string' || !plainObject(change.change)) {
      reject('Terraform plan contains an invalid resource change');
    }
    if (change.mode === 'data') {
      if (DATA_RESOURCES[change.address]?.type !== change.type || dataSeen.has(change.address)
        || ![['read'], ['no-op']].some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
        reject('Terraform Auth-probe plan contains an unreviewed data read');
      }
      dataSeen.add(change.address);
      continue;
    }
    if (change.mode !== 'managed' || CHANGE_RESOURCES[change.address] !== change.type || seen.has(change.address)) {
      reject('Terraform Auth-probe plan contains an unreviewed managed resource');
    }
    seen.add(change.address);
    if (!expectedActions(change.address, profile)
      .some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
      reject(`${change.address}.actions do not match the reviewed ${phase} phase`);
    }
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject('Terraform Auth-probe plan must not import or generate configuration');
    }
    const actions = change.change.actions;
    if (isDeepStrictEqual(actions, ['create'])) {
      exact(change.change.before, null, `${change.address}.before`);
      validateResourceValue(change.address, change.change.after, profile);
      create += 1;
    } else if (isDeepStrictEqual(actions, ['delete'])) {
      exact(change.change.after, null, `${change.address}.after`);
      const revision = validateResourceValue(change.address, change.change.before, profile);
      if (change.address === 'google_workflows_workflow.auth_probe[0]') {
        if (revision === null) reject('Retired Auth-probe Workflow revision is missing');
        workflowRevision = revision;
      }
      remove += 1;
    } else if (isDeepStrictEqual(actions, ['update'])) {
      if (profile === 'arm' && change.address === 'terraform_data.auth_probe_guard') {
        validateGuardTransition(change.change, change.address);
      } else if (profile === 'arm' && change.address === 'google_project_iam_custom_role.auth_probe') {
        validateAuthRoleTransition(change.change, change.address);
      } else if (phase === 'retire' && CUSTOM_ROLE_RESOURCES.has(change.address)) {
        const expected = {
          'google_project_iam_custom_role.auth_probe': AUTH_ROLE,
          'google_project_iam_custom_role.auth_probe_firestore': FIRESTORE_ROLE,
          'google_project_iam_custom_role.auth_probe_signer': SIGNER_ROLE,
        }[change.address];
        validateRoleDisableTransition(change.change, change.address, expected);
      } else {
        reject(`${change.address} cannot be updated by the reviewed ${profile} profile`);
      }
      update += 1;
    } else {
      validateResourceValue(change.address, change.change.after, profile);
    }
  }
  if (phase === 'arm') exact(sorted(seen), sorted(Object.keys(CHANGE_RESOURCES)), 'Managed Auth-probe changes');
  if (phase === 'retire') {
    for (const address of CUSTOM_ROLE_RESOURCES) {
      if (!seen.has(address)) reject('Terraform Auth-probe retirement omits a capability-closing role');
    }
  }
  if ((phase === 'arm' && (create !== 9 || update !== 1 || remove !== 0))
    || (profile === 'retire'
      && (create !== 0 || update > 3 || remove > 6 || update + remove < 1))
    || (profile === 'retire-finalize' && (create !== 0 || update < 1 || update > 3 || remove !== 0))) {
    reject(`Terraform Auth-probe ${phase} delta is outside the reviewed boundary`);
  }
  rejectForbiddenValues(plan);
  return Object.freeze({
    phase, create, update, delete: remove,
    permanent_custom_roles: 3,
    permanent_project_services: 1,
    permanent_keyless_identities: 1,
    temporary_iam_bindings: 4,
    temporary_services: 1,
    temporary_workflows: 1,
    scheduled_triggers: 0,
    retries: 0,
    public_invokers: 0,
    workload_function_revision: WORKLOAD_FUNCTION_REVISION,
    verifier_source_sha256: VERIFIER_SOURCE_SHA256,
    workflow_revision: workflowRevision,
    workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
  });
}

export function validateAuthProbePersistentRecoveryPlanAgainstPolicy(plan, expectedMutations) {
  if (!plainObject(expectedMutations) || Object.keys(expectedMutations).length === 0
    || Object.entries(expectedMutations).some(([address, action]) => {
      return !PERSISTENT_RECOVERY_RESOURCES.has(address)
        || !['create', 'update'].includes(action)
        || (action === 'update' && address !== 'terraform_data.auth_probe_guard');
    })) {
    reject('Terraform Auth-probe persistent recovery mutations are invalid');
  }
  if (!plainObject(plan) || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION || plan.applyable !== true
    || plan.complete !== false || plan.errored !== false) {
    reject('Terraform Auth-probe persistent recovery plan metadata is invalid');
  }
  exact(plan.variables, { armed: { value: 'false' } }, 'Terraform Auth-probe recovery variables');
  validateConfiguration(plan);
  if (!Array.isArray(plan.resource_changes)) reject('Terraform recovery resource changes are missing');

  const mutationsSeen = new Set();
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string' || !plainObject(change.change)) {
      reject('Terraform persistent recovery plan contains an invalid resource change');
    }
    if (change.mode === 'data') {
      if (DATA_RESOURCES[change.address]?.type !== change.type
        || ![['read'], ['no-op']].some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
        reject('Terraform persistent recovery plan contains an unreviewed data read');
      }
      continue;
    }
    if (change.mode !== 'managed' || CHANGE_RESOURCES[change.address] !== change.type) {
      reject('Terraform persistent recovery plan contains an unreviewed managed resource');
    }
    const expectedAction = expectedMutations[change.address];
    if (expectedAction === undefined) {
      if (!isDeepStrictEqual(change.change.actions, ['no-op'])) {
        reject('Terraform persistent recovery plan contains an unapproved mutation');
      }
      validateResourceValue(change.address, change.change.after, 'retire');
      continue;
    }
    if (mutationsSeen.has(change.address)
      || !isDeepStrictEqual(change.change.actions, [expectedAction])) {
      reject(`${change.address}.actions do not match persistent recovery`);
    }
    mutationsSeen.add(change.address);
    if (expectedAction === 'create') {
      exact(change.change.before, null, `${change.address}.before`);
      validateResourceValue(change.address, change.change.after, 'retire');
    } else if (change.address === 'terraform_data.auth_probe_guard') {
      validateGuardTransition(change.change, change.address);
    } else {
      reject(`${change.address} cannot be updated by persistent recovery`);
    }
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject('Terraform persistent recovery plan must not import or generate configuration');
    }
  }
  exact(sorted(mutationsSeen), sorted(Object.keys(expectedMutations)), 'Persistent recovery mutations');
  rejectForbiddenValues(plan);
  return Object.freeze({
    create: Object.values(expectedMutations).filter((action) => action === 'create').length,
    update: Object.values(expectedMutations).filter((action) => action === 'update').length,
    delete: 0,
  });
}

export function readAndValidateAuthProbePlan(path, profile) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Terraform Auth-probe plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Terraform Auth-probe plan is not valid JSON');
  }
  return validateAuthProbePlanAgainstPolicy(plan, profile);
}

export function readAndValidateAuthProbePersistentRecoveryPlan(path, expectedMutations) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Terraform Auth-probe persistent recovery plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Terraform Auth-probe persistent recovery plan is not valid JSON');
  }
  return validateAuthProbePersistentRecoveryPlanAgainstPolicy(plan, expectedMutations);
}
