import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  FUNCTION_NAME,
  FUNCTION_URI,
  PROJECT_ID,
  PROBE_ACCOUNT,
  REGION,
  TERRAFORM_VERSION,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE,
  WORKFLOW_SOURCE_SHA256,
} from './contract.mjs';

const GOOGLE_PROVIDER = 'registry.terraform.io/hashicorp/google';
const TERRAFORM_PROVIDER = 'terraform.io/builtin/terraform';
const MAXIMUM_PLAN_BYTES = 16 * 1024 * 1024;
const MANAGED_RESOURCES = Object.freeze({
  'google_project_service.workflows': 'google_project_service',
  'google_workflows_workflow.private_probe': 'google_workflows_workflow',
  'terraform_data.probe_guard': 'terraform_data',
});
const DATA_RESOURCES = Object.freeze({
  'data.terraform_remote_state.workload': 'terraform_remote_state',
});
const DEPLOYMENT_PROFILES = Object.freeze([
  Object.freeze({
    name: 'initial',
    actions: Object.freeze({
      'terraform_data.probe_guard': Object.freeze(['create']),
      'google_project_service.workflows': Object.freeze(['create']),
      'google_workflows_workflow.private_probe': Object.freeze(['create']),
    }),
  }),
  Object.freeze({
    name: 'after-guard',
    actions: Object.freeze({
      'terraform_data.probe_guard': Object.freeze(['no-op']),
      'google_project_service.workflows': Object.freeze(['create']),
      'google_workflows_workflow.private_probe': Object.freeze(['create']),
    }),
  }),
  Object.freeze({
    name: 'after-api',
    actions: Object.freeze({
      'terraform_data.probe_guard': Object.freeze(['no-op']),
      'google_project_service.workflows': Object.freeze(['no-op']),
      'google_workflows_workflow.private_probe': Object.freeze(['create']),
    }),
  }),
]);

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
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value)) {
    reject('Terraform private-probe plan contains a forbidden project, principal or credential');
  }
}

function validateConfiguration(plan) {
  const configuration = plan.configuration;
  if (!plainObject(configuration) || !plainObject(configuration.root_module)
    || configuration.root_module.module_calls !== undefined
    || !Array.isArray(configuration.root_module.resources)) {
    reject('Terraform configuration must contain one flat reviewed root module');
  }
  const expected = { ...DATA_RESOURCES, ...MANAGED_RESOURCES };
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
      resource.type === 'terraform_data' || resource.type === 'terraform_remote_state'
        ? 'terraform'
        : 'google',
      `${resource.address}.provider`,
    );
  }
  exact([...seen].sort(), Object.keys(expected).sort(), 'Terraform configuration addresses');
  const providers = configuration.provider_config;
  if (!plainObject(providers)) reject('Terraform provider configuration is missing');
  exact(Object.keys(providers).sort(), ['google', 'terraform'], 'Terraform providers');
  exact(providers.google.full_name, GOOGLE_PROVIDER, 'Google provider');
  exact(providers.google.version_constraint, '8.1.0', 'Google provider version');
  exact(providers.terraform.full_name, TERRAFORM_PROVIDER, 'Terraform built-in provider');
}

function validateGuard(after, address) {
  const input = after.input;
  if (!plainObject(input)) reject(`${address}.input is missing`);
  exact(input.project_id, PROJECT_ID, `${address}.project_id`);
  exact(String(input.project_number), '1072737219170', `${address}.project_number`);
  exact(input.region, REGION, `${address}.region`);
  exact(input.function_name, FUNCTION_NAME, `${address}.function_name`);
  exact(input.function_uri, FUNCTION_URI, `${address}.function_uri`);
  exact(input.probe_service_account, PROBE_ACCOUNT, `${address}.probe_service_account`);
  exact(input.source_sha256, 'd2a9ffae2bd85106f782f9c75a10b6fb398682ead65dada2a1cf8ab5c65b7eb4', `${address}.source_sha256`);
  exact(input.repository_commit, '3f5a94dfcdfc0984487a558d966bbeaa769b18eb', `${address}.repository_commit`);
  exact(input.ingress, 'ALLOW_INTERNAL_ONLY', `${address}.ingress`);
  exact(input.unauthenticated, false, `${address}.unauthenticated`);
  exact(input.minimum_instances, 0, `${address}.minimum_instances`);
  exact(input.maximum_instances, 1, `${address}.maximum_instances`);
  exact(input.workflow_source_sha256, WORKFLOW_SOURCE_SHA256, `${address}.workflow_source_sha256`);
}

function validateChange(change) {
  const address = change.address;
  const after = change.change.after;
  if (!plainObject(after)) reject(`${address} planned value is missing`);
  switch (address) {
    case 'terraform_data.probe_guard':
      validateGuard(after, address);
      break;
    case 'google_project_service.workflows':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.service, 'workflows.googleapis.com', `${address}.service`);
      exact(after.disable_on_destroy, false, `${address}.disable_on_destroy`);
      break;
    case 'google_workflows_workflow.private_probe':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.region, REGION, `${address}.region`);
      exact(after.name, WORKFLOW_NAME, `${address}.name`);
      exact(after.description, 'Single-purpose private discovery probe for the Miakapp V4 staging control plane.', `${address}.description`);
      exact(after.service_account, PROBE_ACCOUNT, `${address}.service_account`);
      exact(after.source_contents, WORKFLOW_SOURCE, `${address}.source_contents`);
      exact(after.call_log_level, 'LOG_NONE', `${address}.call_log_level`);
      exact(after.execution_history_level, 'EXECUTION_HISTORY_BASIC', `${address}.execution_history_level`);
      exact(after.deletion_protection, true, `${address}.deletion_protection`);
      exact(after.labels?.environment, 'staging', `${address}.labels.environment`);
      exact(after.labels?.['managed-by'], 'terraform', `${address}.labels.managed-by`);
      exact(after.labels?.product, 'miakapp-v4', `${address}.labels.product`);
      exact(after.labels?.purpose, 'private-probe', `${address}.labels.purpose`);
      break;
    default:
      reject('Terraform private-probe plan contains an unreviewed resource');
  }
}

export function validateProbePlanAgainstPolicy(plan) {
  if (!plainObject(plan)
    || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION
    || plan.applyable !== true
    || plan.complete !== true
    || plan.errored !== false) {
    reject('Terraform private-probe plan metadata is invalid');
  }
  if (plan.variables !== undefined && (!plainObject(plan.variables) || Object.keys(plan.variables).length !== 0)) {
    reject('Terraform private-probe plan must not accept variables');
  }
  validateConfiguration(plan);
  if (!Array.isArray(plan.resource_changes)) reject('Terraform resource changes are missing');
  const managedChanges = plan.resource_changes.filter((change) => change?.mode === 'managed');
  const profile = DEPLOYMENT_PROFILES.find(({ actions }) => managedChanges.every((change) => (
    isDeepStrictEqual(change?.change?.actions, actions[change.address])
  )));
  if (profile === undefined) reject('Terraform private-probe plan is not a reviewed deployment profile');
  const managedSeen = new Set();
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string' || !plainObject(change.change)) {
      reject('Terraform plan contains an invalid resource change');
    }
    if (change.mode === 'data') {
      if (DATA_RESOURCES[change.address] !== change.type
        || ![['read'], ['no-op']].some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
        reject('Terraform plan contains an unreviewed data read');
      }
      continue;
    }
    if (change.mode !== 'managed' || MANAGED_RESOURCES[change.address] !== change.type
      || managedSeen.has(change.address)) {
      reject('Terraform plan contains an unreviewed managed resource');
    }
    managedSeen.add(change.address);
    exact(change.change.actions, profile.actions[change.address], `${change.address}.actions`);
    if (isDeepStrictEqual(change.change.actions, ['create'])) {
      exact(change.change.before, null, `${change.address}.before`);
    } else {
      if (!plainObject(change.change.before)) reject(`${change.address}.before is missing`);
      exact(change.change.before, change.change.after, `${change.address}.no-op values`);
    }
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject('Terraform private-probe plan must not import or generate configuration');
    }
    validateChange(change);
  }
  exact([...managedSeen].sort(), Object.keys(MANAGED_RESOURCES).sort(), 'Managed private-probe changes');
  rejectForbiddenValues(plan);
  const create = Object.values(profile.actions)
    .filter((actions) => isDeepStrictEqual(actions, ['create'])).length;
  return Object.freeze({
    profile: profile.name,
    create,
    update: 0,
    delete: 0,
    workflows_api: 1,
    workflows: 1,
    scheduled_triggers: 0,
    retries: 0,
    public_invokers: 0,
    workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
  });
}

export function readAndValidateProbePlan(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Terraform private-probe plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Terraform private-probe plan is not valid JSON');
  }
  return validateProbePlanAgainstPolicy(plan);
}
