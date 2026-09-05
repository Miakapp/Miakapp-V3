import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  CAPABILITY_EXPIRY,
  CLOUD_ASSET_SERVICE,
  CUSTOM_ROLE_ID,
  CUSTOM_ROLE_NAME,
  CUSTOM_ROLE_PERMISSIONS,
  FIRESTORE_ROLE_ID,
  FIRESTORE_ROLE_NAME,
  FIRESTORE_ROLE_PERMISSIONS,
  OPERATOR_USER_SHA256,
  PROBE_ACCOUNT,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  SIGNER_ROLE_ID,
  SIGNER_ROLE_NAME,
  SIGNER_ROLE_PERMISSIONS,
  VERIFIER_ACCOUNT,
  VERIFIER_SERVICE_NAME,
  VERIFIER_SERVICE_URI,
  VERIFIER_SOURCE,
  VERIFIER_SOURCE_SHA256,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_IMAGE,
} from './contract.mjs';
import { gcloudJson, parseJson, run } from './cli.mjs';

const WORKFLOW_RESOURCE = `projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}`;
const PROBE_ACCOUNT_RESOURCE = `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`;
const PROBE_MEMBER = `serviceAccount:${PROBE_ACCOUNT}`;
const VERIFIER_MEMBER = `serviceAccount:${VERIFIER_ACCOUNT}`;
const EXPIRY_EXPRESSION = `request.time < timestamp(\"${CAPABILITY_EXPIRY}\")`;
const FIRESTORE_EXPRESSION = `resource.name == \"projects/${PROJECT_ID}/databases/(default)\" && ${EXPIRY_EXPRESSION}`;
const PROJECT_ROLE_PREFIX = `projects/${PROJECT_ID}/roles/`;
const ROLE_INVOKE_PERMISSION = 'run.routes.invoke';
const IAM_ETAG = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const rolePermissionCache = new Map();

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function optionalGcloudJson(args, description) {
  const result = run('gcloud', [...args, '--quiet', '--format=json'], {
    allowedStatuses: [0, 1],
    description,
  });
  if (result.status === 0) return parseJson(result.stdout, description);
  const diagnostic = Buffer.from(result.stderr ?? '').toString('utf8');
  if (!/NOT_FOUND|not found|does not exist/iu.test(diagnostic)) {
    reject(`${description} failed without an exact absent-resource response`);
  }
  return null;
}

function bindings(policy) {
  if (!plainObject(policy) || (policy.bindings !== undefined && !Array.isArray(policy.bindings))) {
    reject('Auth-probe IAM policy is invalid');
  }
  return policy.bindings ?? [];
}

function noPublicPrincipal(...policies) {
  for (const policy of policies) {
    for (const binding of bindings(policy)) {
      if (!Array.isArray(binding.members)
        || binding.members.some((member) => ['allUsers', 'allAuthenticatedUsers'].includes(member))) {
        reject('Auth-probe IAM policy contains a public or malformed principal');
      }
    }
  }
}

function conditionalBindingPresence(policy, role, member, expectedCondition) {
  const matches = bindings(policy).filter((binding) => binding.role === role);
  if (matches.length === 0) return false;
  if (matches.length !== 1
    || !isDeepStrictEqual(matches[0].members, [member])
    || !isDeepStrictEqual(matches[0].condition, expectedCondition)) {
    reject(`Auth-probe conditional binding ${role} is not exact`);
  }
  return true;
}

export function validateVerifierServicePolicy(policy, expectedBinding) {
  const expected = expectedBinding
    ? [{
      role: 'roles/run.servicesInvoker',
      members: [PROBE_MEMBER],
      condition: VERIFIER_CONDITION,
    }]
    : [];
  exact(bindings(policy), expected, 'Auth-probe verifier service IAM bindings');
  return expectedBinding;
}

function roleIncludesInvokePermission(role) {
  if (rolePermissionCache.has(role)) return rolePermissionCache.get(role);
  let args;
  if (role.startsWith(PROJECT_ROLE_PREFIX)) {
    const roleId = role.slice(PROJECT_ROLE_PREFIX.length);
    if (!/^[A-Za-z0-9_.]{3,64}$/u.test(roleId)) reject('Project IAM role name is invalid');
    args = ['iam', 'roles', 'describe', roleId, `--project=${PROJECT_ID}`];
  } else {
    if (!/^roles\/[A-Za-z0-9_.]+$/u.test(role)) reject('Predefined IAM role name is invalid');
    args = ['iam', 'roles', 'describe', role];
  }
  const value = gcloudJson(args, { description: `auth-probe-role-permissions-${role.replaceAll(/[^a-z0-9]+/giu, '-')}` });
  if (!plainObject(value) || !Array.isArray(value.includedPermissions)
    || value.includedPermissions.some((permission) => typeof permission !== 'string')) {
    reject('Project IAM role permission inventory is invalid');
  }
  const included = value.includedPermissions.includes(ROLE_INVOKE_PERMISSION);
  rolePermissionCache.set(role, included);
  return included;
}

export function validateInheritedVerifierInvokerBindings(
  invokingBindings,
  operatorUserSha256 = OPERATOR_USER_SHA256,
) {
  if (!Array.isArray(invokingBindings)) reject('Inherited verifier invoker inventory is invalid');
  if (!/^[0-9a-f]{64}$/u.test(operatorUserSha256)) reject('Operator identity digest is invalid');
  const ordered = [...invokingBindings].sort((left, right) => left.role.localeCompare(right.role));
  exact(ordered.map(({ role }) => role), [
    'roles/cloudfunctions.standardServiceAgent',
    'roles/editor',
    'roles/owner',
    'roles/run.serviceAgent',
  ], 'Inherited verifier invoker roles');
  for (const binding of ordered) {
    if (!plainObject(binding) || binding.condition !== undefined || !Array.isArray(binding.members)) {
      reject('Inherited verifier invoker binding is malformed or conditional');
    }
    switch (binding.role) {
      case 'roles/cloudfunctions.standardServiceAgent':
        exact(binding.members, [
          `serviceAccount:service-${PROJECT_NUMBER}@gcf-admin-robot.iam.gserviceaccount.com`,
        ], 'Cloud Functions service-agent verifier invocation');
        break;
      case 'roles/editor':
        exact([...binding.members].sort(), [
          `serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com`,
          `serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com`,
        ], 'Default Editor verifier invocation');
        break;
      case 'roles/owner':
        if (binding.members.length !== 1 || !binding.members[0].startsWith('user:')
          || createHash('sha256').update(binding.members[0].slice(5).toLowerCase()).digest('hex') !== operatorUserSha256) {
          reject('Owner verifier invocation boundary does not match the reviewed operator');
        }
        break;
      case 'roles/run.serviceAgent':
        exact(binding.members, [
          `serviceAccount:service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com`,
        ], 'Cloud Run service-agent verifier invocation');
        break;
      default:
        reject('Inherited verifier invoker role is not reviewed');
    }
  }
  return Object.freeze({
    permission: ROLE_INVOKE_PERMISSION,
    workflow_only: false,
    project_level_principals: 5,
    owner_users: 1,
    default_service_accounts: 2,
    managed_service_agents: 2,
    roles: Object.freeze(ordered.map((binding) => Object.freeze({
      role: binding.role,
      principals: binding.members.length,
    }))),
  });
}

function observeInheritedVerifierInvokers(projectPolicy) {
  const invokingBindings = bindings(projectPolicy)
    .filter(({ role }) => typeof role === 'string' && roleIncludesInvokePermission(role));
  return validateInheritedVerifierInvokerBindings(invokingBindings);
}

const FIREBASE_CONDITION = Object.freeze({
  title: 'temporary_user_relay_probe',
  description: 'Expires the user-relay probe Firebase capability independently of cleanup.',
  expression: EXPIRY_EXPRESSION,
});
const SIGNER_CONDITION = Object.freeze({
  title: 'temporary_user_relay_probe',
  description: 'Expires the user-relay probe self-signing capability independently of cleanup.',
  expression: EXPIRY_EXPRESSION,
});
const FIRESTORE_CONDITION = Object.freeze({
  title: 'temporary_user_relay_probe_default_database',
  description: 'Limits the temporary probe fixture capability to the default database and arm window.',
  expression: FIRESTORE_EXPRESSION,
});
const VERIFIER_CONDITION = Object.freeze({
  title: 'temporary_user_relay_probe',
  description: 'Expires invocation of the temporary verifier independently of cleanup.',
  expression: EXPIRY_EXPRESSION,
});
const PROJECT_RESOURCE = `//cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}`;
const PROBE_ACCOUNT_POLICY_RESOURCE = `//iam.googleapis.com/projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`;
const CUSTOM_ROLE_BINDING_BOUNDARIES = Object.freeze({
  'google_project_iam_custom_role.auth_probe': Object.freeze({
    roleName: CUSTOM_ROLE_NAME,
    bindingKey: 'project_role_binding',
    resource: PROJECT_RESOURCE,
    assetType: 'cloudresourcemanager.googleapis.com/Project',
    member: PROBE_MEMBER,
    condition: FIREBASE_CONDITION,
  }),
  'google_project_iam_custom_role.auth_probe_firestore': Object.freeze({
    roleName: FIRESTORE_ROLE_NAME,
    bindingKey: 'firestore_role_binding',
    resource: PROJECT_RESOURCE,
    assetType: 'cloudresourcemanager.googleapis.com/Project',
    member: PROBE_MEMBER,
    condition: FIRESTORE_CONDITION,
  }),
  'google_project_iam_custom_role.auth_probe_signer': Object.freeze({
    roleName: SIGNER_ROLE_NAME,
    bindingKey: 'self_signer_binding',
    resource: PROBE_ACCOUNT_POLICY_RESOURCE,
    assetType: 'iam.googleapis.com/ServiceAccount',
    member: PROBE_MEMBER,
    condition: SIGNER_CONDITION,
  }),
});

export function validateCustomRolePolicySearch(results, expected) {
  if (!Array.isArray(results) || !plainObject(expected)
    || typeof expected.bindingPresent !== 'boolean') {
    reject('Deleted custom-role policy inventory is invalid');
  }
  if (results.length === 0) {
    return Object.freeze({
      role_name: expected.roleName,
      direct_binding_present: expected.bindingPresent,
      indexed_binding_present: false,
      resource: null,
      asset_type: null,
      authoritative: false,
    });
  }
  if (results.length !== 1 || !plainObject(results[0])) {
    reject(`${expected.roleName} retained binding inventory is not exact`);
  }
  const [result] = results;
  exact(result.resource, expected.resource, `${expected.roleName} binding resource`);
  exact(result.assetType, expected.assetType, `${expected.roleName} binding asset type`);
  exact(result.project, `projects/${PROJECT_NUMBER}`, `${expected.roleName} binding project`);
  exact(bindings(result.policy), [{
    role: expected.roleName,
    members: [expected.member],
    condition: expected.condition,
  }], `${expected.roleName} retained binding`);
  return Object.freeze({
    role_name: expected.roleName,
    direct_binding_present: expected.bindingPresent,
    indexed_binding_present: true,
    resource: expected.resource,
    asset_type: expected.assetType,
    authoritative: false,
  });
}

function observeCustomRoleBindings(states) {
  if (!plainObject(states)
    || Object.values(CUSTOM_ROLE_BINDING_BOUNDARIES)
      .some(({ bindingKey }) => typeof states[bindingKey] !== 'boolean')) {
    reject('Auth-probe custom-role binding state is invalid');
  }
  return Object.freeze(Object.fromEntries(Object.entries(CUSTOM_ROLE_BINDING_BOUNDARIES)
    .map(([address, boundary]) => {
      const results = gcloudJson([
        'asset', 'search-all-iam-policies',
        `--scope=projects/${PROJECT_ID}`,
        `--query=roles=${boundary.roleName}`,
        '--order-by=resource',
      ], { description: `auth-probe-${boundary.roleName.split('/').at(-1)}-binding-inventory` });
      return [address, validateCustomRolePolicySearch(results, {
        roleName: boundary.roleName,
        bindingPresent: states[boundary.bindingKey],
        resource: boundary.resource,
        assetType: boundary.assetType,
        member: boundary.member,
        condition: boundary.condition,
      })];
    })));
}

export function observeCustomRole(
  id,
  expected,
  { allowAbsent = false } = {},
  { optionalJson = optionalGcloudJson, json = gcloudJson } = {},
) {
  const role = optionalJson([
    'iam', 'roles', 'describe', id,
    `--project=${PROJECT_ID}`,
  ], `auth-probe-${id}-inventory`);
  if (role === null) {
    const retained = json([
      'iam', 'roles', 'list',
      `--project=${PROJECT_ID}`,
      '--show-deleted',
      `--filter=name=${expected.name}`,
    ], { description: `auth-probe-${id}-retained-inventory` });
    if (!Array.isArray(retained) || retained.length > 1
      || (retained.length === 1 && retained[0]?.name !== expected.name)) {
      reject(`Auth-probe custom role ${id} retained inventory is invalid`);
    }
    if (retained.length === 1) {
      reject(`Auth-probe custom role ${id} remains reserved but its full definition is unavailable`);
    }
    if (allowAbsent) return null;
    reject(`Auth-probe custom role ${id} is absent`);
  }
  if (!plainObject(role)) reject(`Auth-probe custom role ${id} inventory is invalid`);
  exact(role.name, expected.name, `${id} name`);
  exact(role.title, expected.title, `${id} title`);
  exact(role.description, expected.description, `${id} description`);
  const expectedStages = expected.stages ?? ['GA'];
  if (!Array.isArray(expectedStages) || !expectedStages.includes(role.stage)) {
    reject(`${id} stage does not match the reviewed value`);
  }
  const deleted = role.deleted ?? false;
  if (typeof deleted !== 'boolean') reject(`Auth-probe custom role ${id} deletion state is invalid`);
  if (typeof role.etag !== 'string' || role.etag.length === 0 || !IAM_ETAG.test(role.etag)) {
    reject(`Auth-probe custom role ${id} etag is invalid`);
  }
  if (!Array.isArray(role.includedPermissions)) {
    reject(`Auth-probe custom role ${id} permissions are invalid`);
  }
  exact([...role.includedPermissions].sort(), [...expected.permissions].sort(), `${id} permissions`);
  return Object.freeze({
    name: expected.name,
    stage: role.stage,
    deleted,
    etag: role.etag,
    permissions: Object.freeze([...expected.permissions]),
  });
}

function observeCustomRoles({ allowAbsent = false, stages = ['GA'] } = {}) {
  return Object.freeze({
    firebase: observeCustomRole(CUSTOM_ROLE_ID, {
      name: CUSTOM_ROLE_NAME,
      title: 'Miakapp staging Auth probe',
      description: 'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
      permissions: CUSTOM_ROLE_PERMISSIONS,
      stages,
    }, { allowAbsent }),
    firestore: observeCustomRole(FIRESTORE_ROLE_ID, {
      name: FIRESTORE_ROLE_NAME,
      title: 'Miakapp staging probe Firestore access',
      description: 'Dormant database-scoped CRUD role for bounded staging probe fixtures.',
      permissions: FIRESTORE_ROLE_PERMISSIONS,
      stages,
    }, { allowAbsent }),
    signer: observeCustomRole(SIGNER_ROLE_ID, {
      name: SIGNER_ROLE_NAME,
      title: 'Miakapp staging probe signer',
      description: 'Dormant self-scoped signing role for bounded staging probes.',
      permissions: SIGNER_ROLE_PERMISSIONS,
      stages,
    }, { allowAbsent }),
  });
}

export function observeCloudAssetApi({ allowAbsent = false } = {}) {
  const services = gcloudJson([
    'services', 'list', '--enabled',
    `--project=${PROJECT_ID}`,
    `--filter=config.name=${CLOUD_ASSET_SERVICE}`,
  ], { description: 'auth-probe-cloud-asset-api-inventory' });
  if (!Array.isArray(services) || services.length > 1
    || (services.length === 1 && (services[0]?.config?.name !== CLOUD_ASSET_SERVICE
      || services[0]?.state !== 'ENABLED'))) {
    reject('Cloud Asset API inventory is not exact');
  }
  if (services.length === 0 && !allowAbsent) reject('Cloud Asset API is not enabled');
  return services.length === 1;
}

export function validateNoUserManagedKeys(keys, description) {
  if (!Array.isArray(keys) || keys.length !== 0) {
    reject(`${description} identity has a persistent user-managed key`);
  }
  return 0;
}

export function observeProbeIdentity({ json = gcloudJson } = {}) {
  const account = json([
    'iam', 'service-accounts', 'describe', PROBE_ACCOUNT,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-probe-account-inventory' });
  if (!plainObject(account)
    || account.name !== PROBE_ACCOUNT_RESOURCE
    || account.email !== PROBE_ACCOUNT
    || account.displayName !== 'Miakapp V4 staging synthetic probe'
    || account.description !== 'Keyless identity allowed to invoke only the private staging control plane.'
    || account.disabled === true) {
    reject('Auth-probe probe identity is absent, disabled or foreign');
  }
  const keys = json([
    'iam', 'service-accounts', 'keys', 'list',
    `--iam-account=${PROBE_ACCOUNT}`,
    '--managed-by=user',
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-probe-key-inventory' });
  validateNoUserManagedKeys(keys, 'Auth-probe probe');
  return Object.freeze({
    email: PROBE_ACCOUNT,
    disabled: false,
    user_managed_keys: 0,
  });
}

export function observeVerifierIdentity(
  projectPolicy,
  { allowAbsent = false, cloudAssetApi = true } = {},
  { optionalJson = optionalGcloudJson, json = gcloudJson } = {},
) {
  const account = optionalJson([
    'iam', 'service-accounts', 'describe', VERIFIER_ACCOUNT,
    `--project=${PROJECT_ID}`,
  ], 'auth-probe-verifier-account-inventory');
  if (account === null) {
    if (allowAbsent) return null;
    reject('Auth-probe verifier identity is absent');
  }
  if (!plainObject(account)
    || account.name !== `projects/${PROJECT_ID}/serviceAccounts/${VERIFIER_ACCOUNT}`
    || account.email !== VERIFIER_ACCOUNT
    || account.displayName !== 'Miakapp V4 staging probe verifier'
    || account.description !== 'Keyless no-role identity for the temporary internal JWT verifier.'
    || account.disabled === true) {
    reject('Auth-probe verifier identity is absent, disabled or foreign');
  }
  const keys = json([
    'iam', 'service-accounts', 'keys', 'list',
    `--iam-account=${VERIFIER_ACCOUNT}`,
    '--managed-by=user',
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-verifier-key-inventory' });
  validateNoUserManagedKeys(keys, 'Auth-probe verifier');
  const assignments = bindings(projectPolicy)
    .filter((binding) => binding.members?.includes(VERIFIER_MEMBER));
  if (assignments.length !== 0) reject('Auth-probe verifier identity has a project role');
  let allResourceRoles = null;
  if (cloudAssetApi) {
    const allAssignments = json([
      'asset', 'search-all-iam-policies',
      `--scope=projects/${PROJECT_ID}`,
      `--query=policy:\"${VERIFIER_MEMBER}\"`,
    ], { description: 'auth-probe-verifier-all-resource-policy-inventory' });
    if (!Array.isArray(allAssignments) || allAssignments.length !== 0) {
      reject('Auth-probe verifier identity has a project or resource-level role');
    }
    allResourceRoles = 0;
  }
  return Object.freeze({
    email: VERIFIER_ACCOUNT,
    disabled: false,
    user_managed_keys: 0,
    project_roles: 0,
    all_resource_roles: allResourceRoles,
    resource_policy_inventory: cloudAssetApi,
  });
}

function observePolicies(expectedBindings, cloudAssetApi) {
  const projectPolicy = gcloudJson([
    'projects', 'get-iam-policy', PROJECT_ID,
  ], { description: 'auth-probe-project-policy-inventory' });
  const serviceAccountPolicy = gcloudJson([
    'iam', 'service-accounts', 'get-iam-policy', PROBE_ACCOUNT,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-service-account-policy-inventory' });
  const verifierPolicy = gcloudJson([
    'run', 'services', 'get-iam-policy', VERIFIER_SERVICE_NAME,
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-verifier-policy-inventory' });
  noPublicPrincipal(projectPolicy, serviceAccountPolicy, verifierPolicy);
  const verifierInvokerBinding = validateVerifierServicePolicy(verifierPolicy, expectedBindings);
  const states = Object.freeze({
    project_role_binding: conditionalBindingPresence(
      projectPolicy, CUSTOM_ROLE_NAME, PROBE_MEMBER, FIREBASE_CONDITION,
    ),
    firestore_role_binding: conditionalBindingPresence(
      projectPolicy, FIRESTORE_ROLE_NAME, PROBE_MEMBER, FIRESTORE_CONDITION,
    ),
    self_signer_binding: conditionalBindingPresence(
      serviceAccountPolicy, SIGNER_ROLE_NAME, PROBE_MEMBER, SIGNER_CONDITION,
    ),
    verifier_invoker_binding: verifierInvokerBinding,
  });
  if (Object.values(states).some((present) => present !== expectedBindings)) {
    reject('Auth-probe temporary IAM binding inventory is not exact');
  }
  return Object.freeze({
    ...states,
    custom_role_bindings: observeCustomRoleBindings(states),
    public_principals: 0,
    probe_identity: observeProbeIdentity(),
    verifier_inherited_invokers: observeInheritedVerifierInvokers(projectPolicy),
    verifier_identity: observeVerifierIdentity(projectPolicy, { cloudAssetApi }),
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
  if (listedWorkflows().length !== 1) reject('Auth-probe Workflow inventory is not exact');
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
    purpose: 'user-relay-probe',
  }, 'Auth-probe Workflow labels');
  if (typeof value.revisionId !== 'string' || !/^[0-9a-z][0-9a-z-]{0,62}$/u.test(value.revisionId)) {
    reject('Auth-probe Workflow revision is invalid');
  }
  const executions = gcloudJson([
    'workflows', 'executions', 'list', WORKFLOW_NAME,
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
    '--limit=2',
    '--sort-by=~startTime',
  ], { description: 'auth-probe-execution-inventory' });
  if (!Array.isArray(executions) || (expectedExecutions !== null && executions.length !== expectedExecutions)
    || executions.length > 1) {
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

function serviceName(value) {
  return value?.metadata?.name ?? value?.name ?? null;
}

function listedVerifierServices() {
  const values = gcloudJson([
    'run', 'services', 'list',
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-verifier-list' });
  if (!Array.isArray(values)) reject('Auth-probe verifier service list is invalid');
  return values.filter((value) => serviceName(value) === VERIFIER_SERVICE_NAME);
}

function validateVerifierRuntime(spec, templateAnnotations, description) {
  const container = spec?.containers?.[0];
  if (!plainObject(spec) || !plainObject(container) || spec.containers.length !== 1) {
    reject(`${description} runtime configuration is incomplete`);
  }
  exact(spec.serviceAccountName, VERIFIER_ACCOUNT, `${description} identity`);
  exact(spec.containerConcurrency, 1, `${description} concurrency`);
  exact(spec.timeoutSeconds, 30, `${description} timeout`);
  exact(container.name, 'verifier', `${description} container name`);
  exact(container.image, WORKLOAD_IMAGE, `${description} image`);
  exact(container.command, ['node'], `${description} command`);
  exact(container.args, ['--input-type=module', '--eval', `${VERIFIER_SOURCE}\nstart();`], `${description} arguments`);
  exact(container.env ?? [], [], `${description} environment`);
  exact(container.resources?.limits?.memory, '512Mi', `${description} memory`);
  if (!['1', '1000m'].includes(container.resources?.limits?.cpu)) reject(`${description} CPU is not one vCPU`);
  exact(templateAnnotations?.['autoscaling.knative.dev/maxScale'], '1', `${description} maximum instances`);
  if (!['0', undefined].includes(templateAnnotations?.['autoscaling.knative.dev/minScale'])) {
    reject(`${description} minimum instances is not zero`);
  }
}

export function validateVerifierAnnouncedUrls(value) {
  if (!Array.isArray(value) || value.length !== 2 || new Set(value).size !== 2
    || !value.includes(VERIFIER_SERVICE_URI)) {
    reject('Verifier announced URL set is invalid');
  }
  const generated = value.find((url) => url !== VERIFIER_SERVICE_URI);
  let parsed;
  try {
    parsed = new URL(generated);
  } catch {
    return reject('Verifier generated URL is invalid');
  }
  const hostname = parsed.hostname;
  const labels = hostname.split('.');
  if (generated !== `https://${hostname}`
    || parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== ''
    || parsed.port !== '' || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== ''
    || !hostname.endsWith('.run.app') || labels.length < 3
    || labels.slice(0, -2).some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    || hostname.includes('---')) {
    reject('Verifier generated URL is not an untagged Cloud Run URL');
  }
  return Object.freeze([...value]);
}

function observeVerifierService() {
  if (listedVerifierServices().length !== 1) reject('Auth-probe verifier service inventory is not exact');
  const value = gcloudJson([
    'run', 'services', 'describe', VERIFIER_SERVICE_NAME,
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-verifier-service-inventory' });
  if (!plainObject(value) || serviceName(value) !== VERIFIER_SERVICE_NAME) {
    reject('Auth-probe verifier service inventory is invalid');
  }
  const metadata = value.metadata;
  const template = value.spec?.template;
  const spec = template?.spec;
  const status = value.status;
  if (!plainObject(metadata) || !plainObject(template) || !plainObject(spec)
    || !plainObject(status)) {
    reject('Auth-probe verifier service configuration is incomplete');
  }
  exact(metadata.labels?.environment, 'staging', 'Verifier environment label');
  exact(metadata.labels?.['managed-by'], 'terraform', 'Verifier manager label');
  exact(metadata.labels?.product, 'miakapp-v4', 'Verifier product label');
  exact(metadata.labels?.purpose, 'user-relay-jwt-verifier', 'Verifier purpose label');
  exact(metadata.annotations?.['run.googleapis.com/ingress'], 'internal', 'Verifier ingress');
  exact(metadata.annotations?.['run.googleapis.com/ingress-status'], 'internal', 'Verifier effective ingress');
  if (![undefined, 'false'].includes(metadata.annotations?.['run.googleapis.com/invoker-iam-disabled'])) {
    reject('Verifier IAM invocation enforcement is disabled');
  }
  if (!Number.isSafeInteger(metadata.generation) || metadata.generation < 1
    || status.observedGeneration !== metadata.generation) {
    reject('Verifier generation is not fully observed');
  }
  const requiredConditions = ['Ready', 'ConfigurationsReady', 'RoutesReady'];
  if (!Array.isArray(status.conditions)
    || status.conditions.some((condition) => condition?.status !== 'True')
    || requiredConditions.some((type) => status.conditions.filter((item) => item?.type === type).length !== 1)) {
    reject('Verifier readiness conditions are not exact');
  }
  exact(value.spec?.traffic, [{ latestRevision: true, percent: 100 }], 'Verifier requested traffic');
  exact(status.url, VERIFIER_SERVICE_URI, 'Verifier service URI');
  exact(status.address, { url: VERIFIER_SERVICE_URI }, 'Verifier service address');
  let announcedUrls;
  try {
    announcedUrls = JSON.parse(metadata.annotations?.['run.googleapis.com/urls'] ?? '[]');
  } catch {
    return reject('Verifier announced URL set is invalid');
  }
  validateVerifierAnnouncedUrls(announcedUrls);
  if (typeof status.latestReadyRevisionName !== 'string'
    || !status.latestReadyRevisionName.startsWith(`${VERIFIER_SERVICE_NAME}-`)
    || status.latestCreatedRevisionName !== status.latestReadyRevisionName
    || template.metadata?.name !== status.latestReadyRevisionName) {
    reject('Verifier ready revision is invalid');
  }
  exact(status.traffic, [{
    latestRevision: true,
    percent: 100,
    revisionName: status.latestReadyRevisionName,
  }], 'Verifier effective traffic');
  validateVerifierRuntime(spec, template.metadata?.annotations, 'Verifier service template');
  const revision = gcloudJson([
    'run', 'revisions', 'describe', status.latestReadyRevisionName,
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-verifier-revision-inventory' });
  if (!plainObject(revision) || revision.metadata?.name !== status.latestReadyRevisionName) {
    reject('Verifier serving revision inventory is invalid');
  }
  validateVerifierRuntime(
    revision.spec,
    revision.metadata?.annotations,
    'Verifier serving revision',
  );
  return Object.freeze({
    name: VERIFIER_SERVICE_NAME,
    uri: VERIFIER_SERVICE_URI,
    revision: status.latestReadyRevisionName,
    ingress: 'internal-only',
    image: WORKLOAD_IMAGE,
    identity: VERIFIER_ACCOUNT,
    source_sha256: VERIFIER_SOURCE_SHA256,
    minimum_instances: 0,
    maximum_instances: 1,
    concurrency: 1,
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

export function observeAuthProbeArmPreflight() {
  validateWorkflowsApi();
  observeCloudAssetApi();
  if (listedWorkflows().length !== 0 || listedVerifierServices().length !== 0) {
    reject('Auth-probe arm preflight found a live temporary service');
  }
  const projectPolicy = gcloudJson([
    'projects', 'get-iam-policy', PROJECT_ID,
  ], { description: 'auth-probe-arm-project-policy' });
  const serviceAccountPolicy = gcloudJson([
    'iam', 'service-accounts', 'get-iam-policy', PROBE_ACCOUNT,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-arm-service-account-policy' });
  noPublicPrincipal(projectPolicy, serviceAccountPolicy);
  const states = Object.freeze({
    project_role_binding: conditionalBindingPresence(
      projectPolicy, CUSTOM_ROLE_NAME, PROBE_MEMBER, FIREBASE_CONDITION,
    ),
    firestore_role_binding: conditionalBindingPresence(
      projectPolicy, FIRESTORE_ROLE_NAME, PROBE_MEMBER, FIRESTORE_CONDITION,
    ),
    self_signer_binding: conditionalBindingPresence(
      serviceAccountPolicy, SIGNER_ROLE_NAME, PROBE_MEMBER, SIGNER_CONDITION,
    ),
  });
  if (Object.values(states).some(Boolean)) {
    reject('Auth-probe arm preflight found a live temporary IAM binding');
  }
  const customRoles = observeCustomRoles({ allowAbsent: true, stages: ['GA', 'DISABLED'] });
  if (Object.values(customRoles).some((role) => role?.deleted === true)) {
    reject('Auth-probe arm preflight found a soft-deleted custom role');
  }
  if (Object.values(customRoles).some((role) => role?.stage === 'DISABLED')) {
    reject('Auth-probe one-shot role generation has already been retired');
  }
  const supplementalCustomRoleBindings = observeCustomRoleBindings(states);
  const probeIdentity = observeProbeIdentity();
  return Object.freeze({
    schema: 'miakapp.staging-user-relay-probe-arm-preflight/1',
    project_id: PROJECT_ID,
    cloud_asset_api: true,
    probe_identity: probeIdentity,
    custom_roles: customRoles,
    direct_temporary_bindings_present: false,
    supplemental_custom_role_bindings: supplementalCustomRoleBindings,
    temporary_services_present: false,
  });
}

export function observeAuthProbeDeployment({ expectedExecutions = 0 } = {}) {
  validateWorkflowsApi();
  const cloudAssetApi = observeCloudAssetApi();
  const customRoles = observeCustomRoles();
  const iam = observePolicies(true, cloudAssetApi);
  return Object.freeze({
    schema: 'miakapp.staging-user-relay-probe-deployment/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    capability_expiry: CAPABILITY_EXPIRY,
    cloud_asset_api: true,
    custom_roles: customRoles,
    iam,
    verifier: observeVerifierService(),
    workflow: observeWorkflow(expectedExecutions),
    scheduled_triggers: 0,
    recurring_compute: false,
  });
}

export function observeAuthProbeRetirement() {
  validateWorkflowsApi();
  const cloudAssetApi = observeCloudAssetApi();
  if (listedWorkflows().length !== 0) reject('Retired Auth-probe Workflow still exists');
  if (listedVerifierServices().length !== 0) reject('Retired Auth-probe verifier service still exists');
  const projectPolicy = gcloudJson([
    'projects', 'get-iam-policy', PROJECT_ID,
  ], { description: 'auth-probe-retired-project-policy' });
  const serviceAccountPolicy = gcloudJson([
    'iam', 'service-accounts', 'get-iam-policy', PROBE_ACCOUNT,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-retired-service-account-policy' });
  noPublicPrincipal(projectPolicy, serviceAccountPolicy);
  const states = Object.freeze({
    project_role_binding: conditionalBindingPresence(
      projectPolicy, CUSTOM_ROLE_NAME, PROBE_MEMBER, FIREBASE_CONDITION,
    ),
    firestore_role_binding: conditionalBindingPresence(
      projectPolicy, FIRESTORE_ROLE_NAME, PROBE_MEMBER, FIRESTORE_CONDITION,
    ),
    self_signer_binding: conditionalBindingPresence(
      serviceAccountPolicy, SIGNER_ROLE_NAME, PROBE_MEMBER, SIGNER_CONDITION,
    ),
  });
  if (Object.values(states).some(Boolean)) reject('Dormant Auth-probe capability remains assigned');
  const customRoles = observeCustomRoles({ stages: ['DISABLED'] });
  return Object.freeze({
    schema: 'miakapp.staging-user-relay-probe-retirement/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    cloud_asset_api: true,
    custom_roles: customRoles,
    custom_role_bindings: observeCustomRoleBindings(states),
    probe_identity: observeProbeIdentity(),
    verifier_identity: observeVerifierIdentity(projectPolicy, { cloudAssetApi }),
    workflow_present: false,
    verifier_service_present: false,
    temporary_bindings_present: false,
    recurring_compute: false,
  });
}

export function observeAuthProbeTemporaryInventory() {
  validateWorkflowsApi();
  const cloudAssetApi = observeCloudAssetApi({ allowAbsent: true });
  const projectPolicy = gcloudJson([
    'projects', 'get-iam-policy', PROJECT_ID,
  ], { description: 'auth-probe-recovery-project-policy' });
  const serviceAccountPolicy = gcloudJson([
    'iam', 'service-accounts', 'get-iam-policy', PROBE_ACCOUNT,
    `--project=${PROJECT_ID}`,
  ], { description: 'auth-probe-recovery-service-account-policy' });
  const serviceMatches = listedVerifierServices();
  if (serviceMatches.length > 1) reject('Auth-probe recovery found duplicate verifier services');
  const verifierService = serviceMatches.length === 0 ? null : observeVerifierService();
  let verifierInvokerBinding = false;
  if (verifierService !== null) {
    const verifierPolicy = gcloudJson([
      'run', 'services', 'get-iam-policy', VERIFIER_SERVICE_NAME,
      `--region=${REGION}`,
      `--project=${PROJECT_ID}`,
    ], { description: 'auth-probe-recovery-verifier-policy' });
    noPublicPrincipal(verifierPolicy);
    verifierInvokerBinding = validateVerifierServicePolicy(
      verifierPolicy,
      conditionalBindingPresence(
        verifierPolicy, 'roles/run.servicesInvoker', PROBE_MEMBER, VERIFIER_CONDITION,
      ),
    );
  }
  const workflowMatches = listedWorkflows();
  if (workflowMatches.length > 1) reject('Auth-probe recovery found duplicate Workflows');
  const workflow = workflowMatches.length === 0 ? null : observeWorkflow(null);
  const customRoles = observeCustomRoles({ allowAbsent: true, stages: ['GA', 'DISABLED'] });
  const states = Object.freeze({
    project_role_binding: conditionalBindingPresence(
      projectPolicy, CUSTOM_ROLE_NAME, PROBE_MEMBER, FIREBASE_CONDITION,
    ),
    firestore_role_binding: conditionalBindingPresence(
      projectPolicy, FIRESTORE_ROLE_NAME, PROBE_MEMBER, FIRESTORE_CONDITION,
    ),
    self_signer_binding: conditionalBindingPresence(
      serviceAccountPolicy, SIGNER_ROLE_NAME, PROBE_MEMBER, SIGNER_CONDITION,
    ),
  });
  const verifierIdentity = observeVerifierIdentity(projectPolicy, {
    allowAbsent: true,
    cloudAssetApi,
  });
  const customRoleBindings = cloudAssetApi ? observeCustomRoleBindings(states) : null;
  return Object.freeze({
    schema: 'miakapp.staging-user-relay-probe-temporary-inventory/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    cloud_asset_api: cloudAssetApi,
    custom_roles: customRoles,
    custom_role_bindings: customRoleBindings,
    verifier_identity: verifierIdentity,
    persistent_resources: Object.freeze({
      'google_project_iam_custom_role.auth_probe': customRoles.firebase?.deleted === false,
      'google_project_iam_custom_role.auth_probe_firestore': customRoles.firestore?.deleted === false,
      'google_project_iam_custom_role.auth_probe_signer': customRoles.signer?.deleted === false,
      'google_project_service.auth_probe_asset_inventory': cloudAssetApi,
      'google_service_account.auth_probe_verifier': verifierIdentity !== null,
    }),
    ...states,
    verifier_invoker_binding: verifierInvokerBinding,
    verifier_service: verifierService === null ? null : Object.freeze({
      name: verifierService.name,
      revision: verifierService.revision,
      source_sha256: createHash('sha256').update(VERIFIER_SOURCE).digest('hex'),
    }),
    workflow: workflow === null ? null : Object.freeze({
      name: workflow.name,
      revision: workflow.revision,
      source_sha256: workflow.source_sha256,
      executions: workflow.executions.length,
    }),
  });
}
