import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  CUSTOM_ROLE_NAME,
  CUSTOM_ROLE_PERMISSIONS,
  FIREBASE_APP_ID,
  FUNCTION_NAME,
  FUNCTION_URI,
  PROBE_ACCOUNT,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  TERRAFORM_VERSION,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_COMMIT,
  WORKLOAD_FUNCTION_REVISION,
  WORKLOAD_SOURCE_SHA256,
} from './contract.mjs';

const GOOGLE_PROVIDER = 'registry.terraform.io/hashicorp/google';
const TERRAFORM_PROVIDER = 'terraform.io/builtin/terraform';
const MAXIMUM_PLAN_BYTES = 16 * 1024 * 1024;
const REVISION = /^[0-9a-z][0-9a-z-]{0,62}$/u;
const TERRAFORM_DATA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PREVIOUS_WORKFLOW_SOURCE_SHA256 = '67e2f65dc00db84918205911abc0a2b856eac723a676f1ace2a405601f1462e9';
const DATA_RESOURCES = Object.freeze({
  'data.terraform_remote_state.firebase_auth': 'terraform_remote_state',
  'data.terraform_remote_state.workload': 'terraform_remote_state',
});
const CONFIGURATION_RESOURCES = Object.freeze({
  'google_project_iam_custom_role.auth_probe': 'google_project_iam_custom_role',
  'google_project_iam_member.auth_probe': 'google_project_iam_member',
  'google_service_account_iam_member.auth_probe_self_signer': 'google_service_account_iam_member',
  'google_workflows_workflow.auth_probe': 'google_workflows_workflow',
  'terraform_data.auth_probe_guard': 'terraform_data',
});
const CHANGE_RESOURCES = Object.freeze({
  'google_project_iam_custom_role.auth_probe': 'google_project_iam_custom_role',
  'google_project_iam_member.auth_probe[0]': 'google_project_iam_member',
  'google_service_account_iam_member.auth_probe_self_signer[0]': 'google_service_account_iam_member',
  'google_workflows_workflow.auth_probe[0]': 'google_workflows_workflow',
  'terraform_data.auth_probe_guard': 'terraform_data',
});
const TEMPORARY_RESOURCES = new Set([
  'google_project_iam_member.auth_probe[0]',
  'google_service_account_iam_member.auth_probe_self_signer[0]',
  'google_workflows_workflow.auth_probe[0]',
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
    for (const [key, entry] of Object.entries(value)) {
      rejectForbiddenValues(entry, [...path, key]);
    }
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
    seen.add(resource.address);
    exact(resource.type, expected[resource.address], `${resource.address}.type`);
    const data = resource.address.startsWith('data.');
    exact(resource.mode, data ? 'data' : 'managed', `${resource.address}.mode`);
    exact(
      resource.provider_config_key,
      ['terraform_data', 'terraform_remote_state'].includes(resource.type) ? 'terraform' : 'google',
      `${resource.address}.provider`,
    );
    if (resource.address === 'google_service_account_iam_member.auth_probe_self_signer') {
      exact([...resource.depends_on].sort(), [
        'google_project_iam_custom_role.auth_probe',
        'terraform_data.auth_probe_guard',
      ].sort(), `${resource.address}.depends_on`);
    }
  }
  exact([...seen].sort(), Object.keys(expected).sort(), 'Terraform configuration addresses');
  const providers = configuration.provider_config;
  if (!plainObject(providers)) reject('Terraform provider configuration is missing');
  exact(Object.keys(providers).sort(), ['google', 'terraform'], 'Terraform providers');
  exact(providers.google.full_name, GOOGLE_PROVIDER, 'Google provider');
  exact(providers.google.version_constraint, '8.1.0', 'Google provider version');
  exact(providers.terraform.full_name, TERRAFORM_PROVIDER, 'Terraform built-in provider');
}

function validateGuard(value, address, workflowSourceSha256 = WORKFLOW_SOURCE_SHA256) {
  const input = value.input;
  if (!plainObject(input)) reject(`${address}.input is missing`);
  exact(input.project_id, PROJECT_ID, `${address}.project_id`);
  exact(String(input.project_number), PROJECT_NUMBER, `${address}.project_number`);
  exact(input.region, REGION, `${address}.region`);
  exact(input.function_name, FUNCTION_NAME, `${address}.function_name`);
  exact(input.function_uri, FUNCTION_URI, `${address}.function_uri`);
  exact(input.probe_service_account, PROBE_ACCOUNT, `${address}.probe_service_account`);
  exact(input.source_sha256, WORKLOAD_SOURCE_SHA256, `${address}.source_sha256`);
  exact(input.repository_commit, WORKLOAD_COMMIT, `${address}.repository_commit`);
  exact(input.ingress, 'ALLOW_INTERNAL_ONLY', `${address}.ingress`);
  exact(input.unauthenticated, false, `${address}.unauthenticated`);
  exact(input.minimum_instances, 0, `${address}.minimum_instances`);
  exact(input.maximum_instances, 1, `${address}.maximum_instances`);
  const firebaseAuth = input.firebase_auth;
  if (!plainObject(firebaseAuth)) reject(`${address}.firebase_auth is missing`);
  exact(firebaseAuth.schema, 'miakapp.staging-firebase-auth/1', `${address}.firebase_auth.schema`);
  exact(firebaseAuth.project_id, PROJECT_ID, `${address}.firebase_auth.project_id`);
  exact(String(firebaseAuth.project_number), PROJECT_NUMBER, `${address}.firebase_auth.project_number`);
  exact(firebaseAuth.config_name, `projects/${PROJECT_NUMBER}/config`, `${address}.firebase_auth.config_name`);
  exact(firebaseAuth.anonymous_sign_in, false, `${address}.firebase_auth.anonymous_sign_in`);
  exact(firebaseAuth.email_sign_in, false, `${address}.firebase_auth.email_sign_in`);
  exact(firebaseAuth.phone_sign_in, false, `${address}.firebase_auth.phone_sign_in`);
  exact(firebaseAuth.duplicate_emails, false, `${address}.firebase_auth.duplicate_emails`);
  exact(firebaseAuth.user_signup_disabled, false, `${address}.firebase_auth.user_signup_disabled`);
  exact(firebaseAuth.user_deletion_disabled, false, `${address}.firebase_auth.user_deletion_disabled`);
  exact(firebaseAuth.anonymous_user_autodelete, true, `${address}.firebase_auth.anonymous_user_autodelete`);
  exact(firebaseAuth.multi_tenant, false, `${address}.firebase_auth.multi_tenant`);
  exact(firebaseAuth.mfa, 'DISABLED', `${address}.firebase_auth.mfa`);
  exact(firebaseAuth.request_logging, false, `${address}.firebase_auth.request_logging`);
  exact(input.firebase_app_id, FIREBASE_APP_ID, `${address}.firebase_app_id`);
  exact(input.workflow_source_sha256, workflowSourceSha256, `${address}.workflow_source_sha256`);
}

function validateGuardSourceTransition(change, address) {
  exact(Object.keys(change).sort(), [
    'actions',
    'after',
    'after_sensitive',
    'after_unknown',
    'before',
    'before_sensitive',
  ], `${address}.change fields`);
  const { before, after } = change;
  if (!plainObject(before) || !plainObject(after)
    || typeof before.id !== 'string' || !TERRAFORM_DATA_ID.test(before.id)) {
    reject(`${address} source transition identity is invalid`);
  }
  exact(Object.keys(before).sort(), ['id', 'input', 'output', 'triggers_replace'], `${address}.before fields`);
  exact(Object.keys(after).sort(), ['id', 'input', 'triggers_replace'], `${address}.after fields`);
  exact(after.id, before.id, `${address}.id continuity`);
  exact(before.output, before.input, `${address}.previous output`);
  exact(before.triggers_replace, null, `${address}.before.triggers_replace`);
  exact(after.triggers_replace, null, `${address}.after.triggers_replace`);
  validateGuard(before, `${address}.before`, PREVIOUS_WORKFLOW_SOURCE_SHA256);
  validateGuard(after, `${address}.after`);
  exact(change.after_unknown, {
    input: { firebase_auth: {} },
    output: true,
  }, `${address}.after_unknown`);
  exact(change.before_sensitive, {
    input: { firebase_auth: {} },
    output: { firebase_auth: {} },
  }, `${address}.before_sensitive`);
  exact(change.after_sensitive, {
    input: { firebase_auth: {} },
    output: {},
  }, `${address}.after_sensitive`);
}

function validateCustomRole(value, address) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.role_id, 'miakapp.stagingAuthProbe', `${address}.role_id`);
  exact(value.title, 'Miakapp staging Auth probe', `${address}.title`);
  exact(
    value.description,
    'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
    `${address}.description`,
  );
  exact([...value.permissions].sort(), [...CUSTOM_ROLE_PERMISSIONS].sort(), `${address}.permissions`);
  exact(value.stage, 'GA', `${address}.stage`);
}

function validateProjectBinding(value, address) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.role, CUSTOM_ROLE_NAME, `${address}.role`);
  exact(value.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
}

function validateSignerBinding(value, address) {
  exact(
    value.service_account_id,
    `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
    `${address}.service_account_id`,
  );
  exact(value.role, 'roles/iam.serviceAccountTokenCreator', `${address}.role`);
  exact(value.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
}

function validateWorkflow(value, address, profile) {
  exact(value.project, PROJECT_ID, `${address}.project`);
  exact(value.region, REGION, `${address}.region`);
  exact(value.name, WORKFLOW_NAME, `${address}.name`);
  exact(
    value.description,
    'One-shot private Firebase Auth and custom-provider App Check probe for Miakapp V4 staging.',
    `${address}.description`,
  );
  exact(
    value.service_account,
    profile === 'arm'
      ? PROBE_ACCOUNT
      : `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
    `${address}.service_account`,
  );
  exact(value.source_contents, WORKFLOW_SOURCE, `${address}.source_contents`);
  exact(value.call_log_level, 'LOG_NONE', `${address}.call_log_level`);
  exact(value.execution_history_level, 'EXECUTION_HISTORY_BASIC', `${address}.execution_history_level`);
  exact(value.deletion_protection, false, `${address}.deletion_protection`);
  exact(value.labels?.environment, 'staging', `${address}.labels.environment`);
  exact(value.labels?.['managed-by'], 'terraform', `${address}.labels.managed-by`);
  exact(value.labels?.product, 'miakapp-v4', `${address}.labels.product`);
  exact(value.labels?.purpose, 'auth-app-check-probe', `${address}.labels.purpose`);
  if (/^\s*retry:/mu.test(value.source_contents)
    || /events\.create|google_cloud_scheduler|allUsers|allAuthenticatedUsers/u.test(value.source_contents)) {
    reject('Auth-probe Workflow contains scheduling, retry or public-access behavior');
  }
  if (value.revision_id !== undefined && value.revision_id !== null
    && !REVISION.test(value.revision_id)) {
    reject('Auth-probe Workflow revision is invalid');
  }
  return value.revision_id ?? null;
}

function validateResourceValue(address, value, profile) {
  if (!plainObject(value)) reject(`${address} reviewed value is missing`);
  switch (address) {
    case 'terraform_data.auth_probe_guard':
      validateGuard(value, address);
      break;
    case 'google_project_iam_custom_role.auth_probe':
      validateCustomRole(value, address);
      break;
    case 'google_project_iam_member.auth_probe[0]':
      validateProjectBinding(value, address);
      break;
    case 'google_service_account_iam_member.auth_probe_self_signer[0]':
      validateSignerBinding(value, address);
      break;
    case 'google_workflows_workflow.auth_probe[0]':
      return validateWorkflow(value, address, profile);
    default:
      reject('Terraform Auth-probe plan contains an unreviewed resource');
  }
}

function expectedActions(address, profile) {
  const { phase } = PLAN_PROFILES[profile];
  if (phase === 'arm') {
    if (address === 'terraform_data.auth_probe_guard') {
      return [['create'], ['no-op'], ['update']];
    }
    return TEMPORARY_RESOURCES.has(address) ? [['create']] : [['create'], ['no-op']];
  }
  return TEMPORARY_RESOURCES.has(address) ? [['delete']] : [['no-op']];
}

export function validateAuthProbePlanAgainstPolicy(plan, profile) {
  const settings = PLAN_PROFILES[profile];
  if (settings === undefined) reject('Auth-probe plan profile is invalid');
  const { complete, phase } = settings;
  if (!plainObject(plan)
    || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION
    || plan.applyable !== true
    || plan.complete !== complete
    || plan.errored !== false) {
    reject('Terraform Auth-probe plan metadata is invalid');
  }
  exact(
    plan.variables,
    { armed: { value: phase === 'arm' ? 'true' : 'false' } },
    'Terraform Auth-probe variables',
  );
  validateConfiguration(plan);
  if (!Array.isArray(plan.resource_changes)) reject('Terraform resource changes are missing');

  const seen = new Set();
  let create = 0;
  let update = 0;
  let remove = 0;
  let workflowRevision = phase === 'retire' ? 'absent' : null;
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string' || !plainObject(change.change)) {
      reject('Terraform plan contains an invalid resource change');
    }
    if (change.mode === 'data') {
      if (DATA_RESOURCES[change.address] !== change.type
        || ![['read'], ['no-op']].some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
        reject('Terraform Auth-probe plan contains an unreviewed data read');
      }
      continue;
    }
    if (change.mode !== 'managed' || CHANGE_RESOURCES[change.address] !== change.type
      || seen.has(change.address)) {
      reject('Terraform Auth-probe plan contains an unreviewed managed resource');
    }
    seen.add(change.address);
    const allowed = expectedActions(change.address, profile);
    if (!allowed.some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
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
      if (profile !== 'arm' || change.address !== 'terraform_data.auth_probe_guard') {
        reject(`${change.address} cannot be updated by the reviewed ${profile} profile`);
      }
      validateGuardSourceTransition(change.change, change.address);
      update += 1;
    } else {
      validateResourceValue(change.address, change.change.after, profile);
    }
  }
  if (phase === 'arm') {
    exact([...seen].sort(), Object.keys(CHANGE_RESOURCES).sort(), 'Managed Auth-probe changes');
  }
  if ((phase === 'arm' && (create < 3 || update > 1 || remove !== 0))
    || (phase === 'retire' && (create !== 0 || update !== 0 || remove > 3))
    || (profile === 'retire-finalize' && remove !== 0)) {
    reject(`Terraform Auth-probe ${phase} delta is outside the reviewed boundary`);
  }
  rejectForbiddenValues(plan);
  return Object.freeze({
    phase,
    create,
    update,
    delete: remove,
    permanent_custom_roles: 1,
    temporary_iam_bindings: 2,
    temporary_workflows: 1,
    scheduled_triggers: 0,
    retries: 0,
    public_invokers: 0,
    workload_function_revision: WORKLOAD_FUNCTION_REVISION,
    workflow_revision: workflowRevision,
    workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
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
