import { isDeepStrictEqual } from 'node:util';

import {
  CUSTOM_ROLE_ID,
  CUSTOM_ROLE_NAME,
  CUSTOM_ROLE_PERMISSIONS,
  PROBE_ACCOUNT,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE,
  WORKFLOW_SOURCE_SHA256,
} from './contract.mjs';
import { gcloudJson } from './cli.mjs';

const WORKFLOW_RESOURCE = `projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}`;
const PROBE_ACCOUNT_RESOURCE = `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`;
const PROBE_MEMBER = `serviceAccount:${PROBE_ACCOUNT}`;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function bindings(policy) {
  if (!plainObject(policy) || (policy.bindings !== undefined && !Array.isArray(policy.bindings))) {
    reject('Auth-probe IAM policy is invalid');
  }
  return policy.bindings ?? [];
}

function validateProjectBinding(policy, expected) {
  const present = projectBindingPresence(policy);
  if (present !== expected) {
    reject(expected
      ? 'Auth-probe project role binding is not exact'
      : 'Dormant Auth-probe project role remains assigned');
  }
}

function projectBindingPresence(policy) {
  const matches = bindings(policy).filter(({ role }) => role === CUSTOM_ROLE_NAME);
  if (matches.length === 0) return false;
  if (matches.length !== 1 || matches[0].condition !== undefined
    || !isDeepStrictEqual(matches[0].members, [PROBE_MEMBER])) {
    reject('Auth-probe project role binding is not exact');
  }
  return true;
}

function validateSelfSignerBinding(policy, expected) {
  const present = selfSignerBindingPresence(policy);
  if (present !== expected) reject('Auth-probe self-signing binding is not exact');
}

function selfSignerBindingPresence(policy) {
  const matches = bindings(policy)
    .filter(({ role }) => role === 'roles/iam.serviceAccountTokenCreator');
  if (matches.length === 0) return false;
  if (matches.length !== 1 || matches[0].condition !== undefined
    || !isDeepStrictEqual(matches[0].members, [PROBE_MEMBER])) {
    reject('Auth-probe self-signing binding is not exact');
  }
  return true;
}

function observeCustomRole() {
  const role = gcloudJson([
    'iam', 'roles', 'describe', CUSTOM_ROLE_ID,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-custom-role-inventory' });
  if (!plainObject(role)) reject('Auth-probe custom role inventory is invalid');
  exact(role.name, CUSTOM_ROLE_NAME, 'Auth-probe custom role name');
  exact(role.title, 'Miakapp staging Auth probe', 'Auth-probe custom role title');
  exact(role.stage, 'GA', 'Auth-probe custom role stage');
  exact(role.deleted ?? false, false, 'Auth-probe custom role deletion state');
  exact(
    [...role.includedPermissions].sort(),
    [...CUSTOM_ROLE_PERMISSIONS].sort(),
    'Auth-probe custom role permissions',
  );
  return Object.freeze({
    name: CUSTOM_ROLE_NAME,
    stage: 'GA',
    deleted: false,
    permissions: Object.freeze([...CUSTOM_ROLE_PERMISSIONS]),
  });
}

function observePolicies(expectedBindings) {
  const projectPolicy = gcloudJson([
    'projects', 'get-iam-policy', PROJECT_ID,
  ], { description: 'auth-probe-project-policy-inventory' });
  const serviceAccountPolicy = gcloudJson([
    'iam', 'service-accounts', 'get-iam-policy', PROBE_ACCOUNT,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-service-account-policy-inventory' });
  validateProjectBinding(projectPolicy, expectedBindings);
  validateSelfSignerBinding(serviceAccountPolicy, expectedBindings);
  return Object.freeze({
    project_role_assigned_to_probe: expectedBindings,
    self_signer_assigned_to_probe: expectedBindings,
  });
}

function listedWorkflows() {
  const values = gcloudJson([
    'workflows', 'list',
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-workflow-list' });
  if (!Array.isArray(values)) reject('Auth-probe Workflow list is invalid');
  return values.filter(({ name }) => name === WORKFLOW_RESOURCE);
}

function observeWorkflow(expectedExecutions) {
  const matches = listedWorkflows();
  if (matches.length !== 1) reject('Auth-probe Workflow inventory is not exact');
  const value = gcloudJson([
    'workflows', 'describe', WORKFLOW_NAME,
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-workflow-inventory' });
  if (!plainObject(value)) reject('Auth-probe Workflow inventory is invalid');
  exact(value.name, WORKFLOW_RESOURCE, 'Auth-probe Workflow name');
  exact(value.state, 'ACTIVE', 'Auth-probe Workflow state');
  exact(value.serviceAccount, PROBE_ACCOUNT_RESOURCE, 'Auth-probe Workflow service account');
  exact(value.callLogLevel, 'LOG_NONE', 'Auth-probe Workflow call log level');
  exact(value.executionHistoryLevel, 'EXECUTION_HISTORY_BASIC', 'Auth-probe Workflow history level');
  exact(value.sourceContents, WORKFLOW_SOURCE, 'Auth-probe Workflow source');
  exact(value.labels, {
    environment: 'staging',
    'goog-terraform-provisioned': 'true',
    'managed-by': 'terraform',
    product: 'miakapp-v4',
    purpose: 'auth-app-check-probe',
  }, 'Auth-probe Workflow labels');
  if (typeof value.revisionId !== 'string'
    || !/^[0-9a-z][0-9a-z-]{0,62}$/u.test(value.revisionId)) {
    reject('Auth-probe Workflow revision is invalid');
  }
  const executions = gcloudJson([
    'workflows', 'executions', 'list', WORKFLOW_NAME,
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
    '--limit=2',
    '--sort-by=~startTime',
  ], { description: 'auth-probe-execution-inventory' });
  if (!Array.isArray(executions) || (expectedExecutions !== null
    && executions.length !== expectedExecutions) || executions.length > 1) {
    reject('Auth-probe Workflow execution count is outside the one-shot boundary');
  }
  return Object.freeze({
    name: WORKFLOW_RESOURCE,
    revision: value.revisionId,
    service_account: PROBE_ACCOUNT,
    source_sha256: WORKFLOW_SOURCE_SHA256,
    call_log_level: 'LOG_NONE',
    execution_history_level: 'EXECUTION_HISTORY_BASIC',
    executions,
  });
}

function validateWorkflowsApi() {
  const services = gcloudJson([
    'services', 'list', '--enabled',
    `--project=${PROJECT_ID}`,
    '--filter=config.name=workflows.googleapis.com',
  ], { description: 'auth-probe-workflows-api-inventory' });
  if (!Array.isArray(services) || services.length !== 1
    || services[0]?.config?.name !== 'workflows.googleapis.com'
    || services[0]?.state !== 'ENABLED') {
    reject('Workflows API is not exactly enabled in staging');
  }
}

export function observeAuthProbeDeployment({ expectedExecutions = 0 } = {}) {
  validateWorkflowsApi();
  return Object.freeze({
    schema: 'miakapp.staging-auth-probe-deployment/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    custom_role: observeCustomRole(),
    iam: observePolicies(true),
    workflow: observeWorkflow(expectedExecutions),
    scheduled_triggers: 0,
  });
}

export function observeAuthProbeRetirement() {
  validateWorkflowsApi();
  if (listedWorkflows().length !== 0) reject('Retired Auth-probe Workflow still exists');
  return Object.freeze({
    schema: 'miakapp.staging-auth-probe-retirement/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    custom_role: observeCustomRole(),
    iam: observePolicies(false),
    workflow_present: false,
    temporary_bindings_present: false,
    recurring_compute: false,
  });
}

export function observeAuthProbeTemporaryInventory() {
  validateWorkflowsApi();
  const projectPolicy = gcloudJson([
    'projects', 'get-iam-policy', PROJECT_ID,
  ], { description: 'auth-probe-recovery-project-policy' });
  const serviceAccountPolicy = gcloudJson([
    'iam', 'service-accounts', 'get-iam-policy', PROBE_ACCOUNT,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-recovery-service-account-policy' });
  const workflowMatches = listedWorkflows();
  if (workflowMatches.length > 1) reject('Auth-probe recovery found duplicate Workflows');
  const workflow = workflowMatches.length === 0 ? null : observeWorkflow(null);
  return Object.freeze({
    schema: 'miakapp.staging-auth-probe-temporary-inventory/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    custom_role: observeCustomRole(),
    project_role_binding: projectBindingPresence(projectPolicy),
    self_signer_binding: selfSignerBindingPresence(serviceAccountPolicy),
    workflow: workflow === null ? null : Object.freeze({
      name: workflow.name,
      revision: workflow.revision,
      source_sha256: workflow.source_sha256,
      executions: workflow.executions.length,
    }),
  });
}
