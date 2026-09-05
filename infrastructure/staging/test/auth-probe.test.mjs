import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

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
  FUNCTION_URI,
  PROJECT_ID,
  PROJECT_NUMBER,
  PROBE_ACCOUNT,
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
  authProbeApplyAuthorization,
  authProbeInvokeAuthorization,
  authProbeRetireAuthorization,
  authProbeRetirementRecoveryAuthorization,
  buildAuthProbePlanMetadata,
  buildAuthProbeRetirementRecoveryMetadata,
  validateAuthProbeApplyAuthorization,
  validateAuthProbeInvokeAuthorization,
  validateAuthProbePlanMetadata,
  validateAuthProbeRetireAuthorization,
  validateAuthProbeRetirementRecoveryAuthorization,
  validateAuthProbeRetirementRecoveryMetadata,
} from '../auth-probe/contract.mjs';
import { validateAuthProbeRoot } from '../auth-probe/guard.mjs';
import {
  observeCustomRole,
  observeProbeIdentity,
  observeVerifierIdentity,
  validateCustomRolePolicySearch,
  validateInheritedVerifierInvokerBindings,
  validateVerifierAnnouncedUrls,
  validateVerifierServiceEndpoints,
  validateVerifierServicePolicy,
} from '../auth-probe/inventory.mjs';
import {
  validateAuthProbeEvidence,
  validateAuthProbeEvidenceValues,
} from '../auth-probe/evidence.mjs';
import {
  validateAuthProbeWorkflowResult,
  validateSuccessfulAuthProbeExecution,
} from '../auth-probe/invoke.mjs';
import {
  validateAuthProbePersistentRecoveryPlanAgainstPolicy,
  validateAuthProbePlanAgainstPolicy,
} from '../auth-probe/validate-plan.mjs';
import {
  AUTH_PROBE_RETIRED_STATE_ADDRESSES,
  PERSISTENT_RESOURCE_IMPORTS,
  buildAuthProbeRetirementRecoveryInventory,
  inspectAuthProbeState,
  requiresAuthProbeRetirementRecovery,
  validateAuthProbeRetirementRecoveryInventory,
} from '../auth-probe/retirement-recovery.mjs';

const COMMIT = '1'.repeat(40);
const PLAN = Buffer.from('synthetic-user-relay-probe-plan');
const PLAN_JSON = Buffer.from('{"synthetic":true}\n');
const CREATED_AT = '2026-09-05T00:00:00.000Z';
const WORKFLOW_REVISION = '000001-abc';
const PREVIOUS_WORKLOAD_SOURCE_SHA256 = '86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358';
const PREVIOUS_WORKLOAD_COMMIT = '60322c69c92b8ccf5f3d1bc87ba264a00e5dca05';
const PREVIOUS_WORKFLOW_SOURCE_SHA256 = '525b97d18a2848c1d852b9d117cb20cf464bbc1d7baa85b2d44d457487cd922c';
const VERIFIER_SERVICE_RESOURCE = `projects/${PROJECT_ID}/locations/${REGION}/services/${VERIFIER_SERVICE_NAME}`;
const PREVIOUS_CUSTOM_ROLE_PERMISSIONS = [
  'firebase.clients.get',
  'firebaseappcheck.tokens.mint',
  'firebaseauth.users.get',
  'serviceusage.services.use',
];
const probeRoot = new URL('../auth-probe/', import.meta.url);
const terraformFiles = readdirSync(probeRoot).filter((name) => name.endsWith('.tf')).sort();
const terraformSource = terraformFiles
  .map((name) => readFileSync(new URL(name, probeRoot), 'utf8'))
  .join('\n');
const planDriver = readFileSync(new URL('plan.mjs', probeRoot), 'utf8');
const applyDriver = readFileSync(new URL('apply.mjs', probeRoot), 'utf8');
const invokeDriver = readFileSync(new URL('invoke.mjs', probeRoot), 'utf8');
const retirementDrivers = [
  readFileSync(new URL('retire-plan.mjs', probeRoot), 'utf8'),
  readFileSync(new URL('retire-apply.mjs', probeRoot), 'utf8'),
].join('\n');
const retirementRecoveryDrivers = [
  readFileSync(new URL('retire-recovery-plan.mjs', probeRoot), 'utf8'),
  readFileSync(new URL('retire-recovery-apply.mjs', probeRoot), 'utf8'),
].join('\n');
const checkSource = readFileSync(new URL('../check.sh', import.meta.url), 'utf8');
const committedResultPath = new URL('../auth-probe/result.json', import.meta.url);
const committedRetirementPath = new URL('../auth-probe/retirement.json', import.meta.url);

function workflowResult() {
  return {
    schema: 'miakapp.staging-user-relay-workflow-result/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_app_id: FIREBASE_APP_ID,
    route: {
      method: 'POST',
      path: '/v1/user-relay-tokens:exchange',
      product_requests: 5,
      successful_exchanges: 2,
      negative_controls: 3,
      retries: 0,
    },
    cloud_run: {
      authentication_header: 'X-Serverless-Authorization',
      verifier_uri: VERIFIER_SERVICE_URI,
      verifier_ingress: 'internal-only',
    },
    firebase_auth: {
      token_source: 'execution-scoped-custom-token',
      synthetic_user_created: true,
      synthetic_user_deleted: true,
      synthetic_user_absence_verified: true,
      verified_email_present: false,
    },
    app_check: {
      token_source: 'admin-custom-provider',
      token_consumption: false,
      replay_accepted: true,
    },
    firestore: {
      collection: 'controlHomes',
      synthetic_home_created: true,
      relay_rotated: true,
      synthetic_home_deleted: true,
      synthetic_home_absence_verified: true,
      public_home_written: false,
      owner_matches_authenticated_user: false,
    },
    metadata: { discovery_valid: true, jwks_valid: true },
    responses: {
      invalid_firebase: { status: 401, code: 'invalid_firebase_token' },
      missing_app_check: { status: 401, code: 'invalid_app_check_token' },
      missing_home: { status: 404, code: 'home_not_found' },
      first_exchange: { status: 200, relay_url: 'wss://relay-a.probe.invalid/ws' },
      second_exchange: { status: 200, relay_url: 'wss://relay-b.probe.invalid/ws' },
    },
    tokens: {
      algorithm: 'EdDSA',
      key_id: 'staging-access-token-v1',
      type: 'at+jwt',
      ttl_seconds: 300,
      signatures_valid: true,
      audiences_changed: true,
      distinct_tokens: true,
      distinct_jti: true,
      scope: 'relay:user',
      role: 'user',
      verified_email_present: false,
      client_id_present: false,
      coordinator_present: false,
    },
  };
}

function firebaseAuthGuard() {
  return {
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
  };
}

function guardInput(previous = false) {
  const value = {
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    function_name: 'control-plane',
    function_uri: FUNCTION_URI,
    probe_service_account: PROBE_ACCOUNT,
    source_sha256: previous ? PREVIOUS_WORKLOAD_SOURCE_SHA256 : WORKLOAD_SOURCE_SHA256,
    repository_commit: previous ? PREVIOUS_WORKLOAD_COMMIT : WORKLOAD_COMMIT,
    ingress: 'ALLOW_INTERNAL_ONLY',
    unauthenticated: false,
    minimum_instances: 0,
    maximum_instances: 1,
    firebase_auth: firebaseAuthGuard(),
    firebase_app_id: FIREBASE_APP_ID,
    workflow_source_sha256: previous ? PREVIOUS_WORKFLOW_SOURCE_SHA256 : WORKFLOW_SOURCE_SHA256,
  };
  return previous ? value : {
    ...value,
    verifier_source_sha256: VERIFIER_SOURCE_SHA256,
    verifier_service_uri: VERIFIER_SERVICE_URI,
    verifier_identity: VERIFIER_ACCOUNT,
    verifier_image: WORKLOAD_IMAGE,
    capability_expiry: CAPABILITY_EXPIRY,
  };
}

function roleValue({ id, name, title, description, permissions }, stage = 'GA') {
  return { project: PROJECT_ID, role_id: id, name, id: name, deleted: false, title, description, permissions: [...permissions], stage };
}

const authRole = (stage = 'GA') => roleValue({
  id: CUSTOM_ROLE_ID,
  name: CUSTOM_ROLE_NAME,
  title: 'Miakapp staging Auth probe',
  description: 'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
  permissions: CUSTOM_ROLE_PERMISSIONS,
}, stage);
const previousAuthRole = () => roleValue({
  id: CUSTOM_ROLE_ID,
  name: CUSTOM_ROLE_NAME,
  title: 'Miakapp staging Auth probe',
  description: 'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
  permissions: PREVIOUS_CUSTOM_ROLE_PERMISSIONS,
});

function expiryCondition(description) {
  return [{ title: 'temporary_user_relay_probe', description, expression: `request.time < timestamp(\"${CAPABILITY_EXPIRY}\")` }];
}

function resourceValue(address, profile = 'arm') {
  const roleStage = profile === 'arm' ? 'GA' : 'DISABLED';
  switch (address) {
    case 'terraform_data.auth_probe_guard': return { input: guardInput() };
    case 'google_project_iam_custom_role.auth_probe': return authRole(roleStage);
    case 'google_project_iam_custom_role.auth_probe_firestore':
      return roleValue({
        id: FIRESTORE_ROLE_ID,
        name: FIRESTORE_ROLE_NAME,
        title: 'Miakapp staging probe Firestore access',
        description: 'Dormant database-scoped CRUD role for bounded staging probe fixtures.',
        permissions: FIRESTORE_ROLE_PERMISSIONS,
      }, roleStage);
    case 'google_project_iam_custom_role.auth_probe_signer':
      return roleValue({
        id: SIGNER_ROLE_ID,
        name: SIGNER_ROLE_NAME,
        title: 'Miakapp staging probe signer',
        description: 'Dormant self-scoped signing role for bounded staging probes.',
        permissions: SIGNER_ROLE_PERMISSIONS,
      }, roleStage);
    case 'google_project_iam_member.auth_probe[0]':
      return {
        project: PROJECT_ID,
        role: CUSTOM_ROLE_NAME,
        member: `serviceAccount:${PROBE_ACCOUNT}`,
        condition: expiryCondition('Expires the user-relay probe Firebase capability independently of cleanup.'),
      };
    case 'google_project_iam_member.auth_probe_firestore[0]':
      return {
        project: PROJECT_ID,
        role: FIRESTORE_ROLE_NAME,
        member: `serviceAccount:${PROBE_ACCOUNT}`,
        condition: [{
          title: 'temporary_user_relay_probe_default_database',
          description: 'Limits the temporary probe fixture capability to the default database and arm window.',
          expression: `resource.name == \"projects/${PROJECT_ID}/databases/(default)\" && request.time < timestamp(\"${CAPABILITY_EXPIRY}\")`,
        }],
      };
    case 'google_project_service.auth_probe_asset_inventory':
      return {
        project: PROJECT_ID,
        service: CLOUD_ASSET_SERVICE,
        disable_dependent_services: false,
        disable_on_destroy: false,
      };
    case 'google_service_account_iam_member.auth_probe_self_signer[0]':
      return {
        service_account_id: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
        role: SIGNER_ROLE_NAME,
        member: `serviceAccount:${PROBE_ACCOUNT}`,
        condition: expiryCondition('Expires the user-relay probe self-signing capability independently of cleanup.'),
      };
    case 'google_service_account.auth_probe_verifier':
      return {
        project: PROJECT_ID,
        account_id: 'miakapp-staging-verifier',
        display_name: 'Miakapp V4 staging probe verifier',
        description: 'Keyless no-role identity for the temporary internal JWT verifier.',
        disabled: false,
        email: VERIFIER_ACCOUNT,
        member: `serviceAccount:${VERIFIER_ACCOUNT}`,
      };
    case 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]':
      return {
        project: PROJECT_ID,
        location: REGION,
        name: VERIFIER_SERVICE_NAME,
        role: 'roles/run.servicesInvoker',
        member: `serviceAccount:${PROBE_ACCOUNT}`,
        condition: expiryCondition('Expires invocation of the temporary verifier independently of cleanup.'),
      };
    case 'google_cloud_run_v2_service.auth_probe_verifier[0]':
      return {
        project: PROJECT_ID,
        location: REGION,
        name: VERIFIER_SERVICE_NAME,
        description: 'Temporary internal verifier for the bounded staging user-relay probe.',
        ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
        default_uri_disabled: false,
        invoker_iam_disabled: false,
        deletion_protection: false,
        labels: { environment: 'staging', 'managed-by': 'terraform', product: 'miakapp-v4', purpose: 'user-relay-jwt-verifier' },
        annotations: null,
        custom_audiences: null,
        iap_enabled: null,
        binary_authorization: [],
        build_config: [],
        template: [{
          service_account: VERIFIER_ACCOUNT,
          timeout: '30s',
          max_instance_request_concurrency: 1,
          execution_environment: 'EXECUTION_ENVIRONMENT_GEN2',
          annotations: null,
          vpc_access: [],
          volumes: [],
          scaling: [{ min_instance_count: 0, max_instance_count: 1 }],
          containers: [{
            name: 'verifier',
            image: WORKLOAD_IMAGE,
            command: ['node'],
            args: ['--input-type=module', '--eval', `${VERIFIER_SOURCE}\nstart();`],
            env: [],
            volume_mounts: [],
            ports: [{ name: 'http1', container_port: 8080 }],
            resources: [{ limits: { cpu: '1', memory: '512Mi' }, cpu_idle: true, startup_cpu_boost: false }],
          }],
        }],
      };
    case 'google_workflows_workflow.auth_probe[0]':
      return {
        project: PROJECT_ID,
        region: REGION,
        name: WORKFLOW_NAME,
        description: 'One-shot private audience-bound user-relay credential probe for Miakapp V4 staging.',
        service_account: profile === 'arm' ? PROBE_ACCOUNT : `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
        source_contents: WORKFLOW_SOURCE,
        call_log_level: 'LOG_NONE',
        execution_history_level: 'EXECUTION_HISTORY_BASIC',
        deletion_protection: false,
        labels: { environment: 'staging', 'managed-by': 'terraform', product: 'miakapp-v4', purpose: 'user-relay-probe' },
        ...(profile === 'arm' ? {} : { revision_id: WORKFLOW_REVISION }),
      };
    default: throw new Error(`Unknown test resource ${address}`);
  }
}

const configurationResources = Object.freeze({
  'google_cloud_run_v2_service.auth_probe_verifier': ['google_cloud_run_v2_service', ['google_service_account.auth_probe_verifier', 'terraform_data.auth_probe_guard']],
  'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker': ['google_cloud_run_v2_service_iam_member', []],
  'google_project_iam_custom_role.auth_probe': ['google_project_iam_custom_role', ['google_project_service.auth_probe_asset_inventory', 'terraform_data.auth_probe_guard']],
  'google_project_iam_custom_role.auth_probe_firestore': ['google_project_iam_custom_role', ['terraform_data.auth_probe_guard']],
  'google_project_iam_custom_role.auth_probe_signer': ['google_project_iam_custom_role', ['terraform_data.auth_probe_guard']],
  'google_project_iam_member.auth_probe': ['google_project_iam_member', ['google_project_iam_custom_role.auth_probe']],
  'google_project_iam_member.auth_probe_firestore': ['google_project_iam_member', ['google_project_iam_custom_role.auth_probe_firestore']],
  'google_project_service.auth_probe_asset_inventory': ['google_project_service', ['terraform_data.auth_probe_guard']],
  'google_service_account.auth_probe_verifier': ['google_service_account', ['google_project_service.auth_probe_asset_inventory', 'terraform_data.auth_probe_guard']],
  'google_service_account_iam_member.auth_probe_self_signer': ['google_service_account_iam_member', ['google_project_iam_custom_role.auth_probe_signer', 'terraform_data.auth_probe_guard']],
  'google_workflows_workflow.auth_probe': ['google_workflows_workflow', ['google_project_iam_member.auth_probe', 'google_project_iam_member.auth_probe_firestore', 'google_service_account_iam_member.auth_probe_self_signer', 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker']],
  'terraform_data.auth_probe_guard': ['terraform_data', []],
});
const changeResources = Object.freeze({
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
const temporaryAddresses = new Set(Object.keys(changeResources).filter((address) => address.endsWith('[0]')));

function updateChange(address) {
  if (address === 'terraform_data.auth_probe_guard') {
    const beforeInput = guardInput(true);
    return {
      actions: ['update'],
      before: { id: 'bd5471f4-d4d8-609b-5621-a84204953f4d', input: beforeInput, output: structuredClone(beforeInput), triggers_replace: null },
      after: { id: 'bd5471f4-d4d8-609b-5621-a84204953f4d', input: guardInput(), triggers_replace: null },
      after_unknown: { input: { firebase_auth: {} }, output: true },
      before_sensitive: { input: { firebase_auth: {} }, output: { firebase_auth: {} } },
      after_sensitive: { input: { firebase_auth: {} }, output: {} },
    };
  }
  if (address.startsWith('google_project_iam_custom_role.')) {
    const before = resourceValue(address, 'arm');
    const after = resourceValue(address, 'retire');
    return {
      actions: ['update'],
      before,
      after,
      after_unknown: {},
      before_sensitive: { permissions: before.permissions.map(() => false) },
      after_sensitive: { permissions: after.permissions.map(() => false) },
    };
  }
  return {
    actions: ['update'],
    before: previousAuthRole(),
    after: authRole(),
    after_unknown: {},
    before_sensitive: { permissions: PREVIOUS_CUSTOM_ROLE_PERMISSIONS.map(() => false) },
    after_sensitive: { permissions: CUSTOM_ROLE_PERMISSIONS.map(() => false) },
  };
}

function syntheticPlan(profile) {
  const arm = profile === 'arm';
  const finalization = profile === 'retire-finalize';
  const updates = new Set(['terraform_data.auth_probe_guard']);
  const noOps = new Set([
    'google_project_iam_custom_role.auth_probe',
    'google_project_service.auth_probe_asset_inventory',
  ]);
  return {
    format_version: '1.2',
    terraform_version: TERRAFORM_VERSION,
    applyable: true,
    complete: profile !== 'retire',
    errored: false,
    variables: { armed: { value: arm ? 'true' : 'false' } },
    configuration: {
      provider_config: {
        google: { full_name: 'registry.terraform.io/hashicorp/google', version_constraint: '8.1.0' },
        terraform: { full_name: 'terraform.io/builtin/terraform' },
      },
      root_module: {
        resources: [
          { address: 'data.terraform_remote_state.firebase_auth', mode: 'data', type: 'terraform_remote_state', provider_config_key: 'terraform' },
          { address: 'data.terraform_remote_state.workload', mode: 'data', type: 'terraform_remote_state', provider_config_key: 'terraform' },
          ...Object.entries(configurationResources).map(([address, [type, depends_on]]) => ({
            address,
            mode: 'managed',
            type,
            provider_config_key: type === 'terraform_data' ? 'terraform' : 'google',
            ...(depends_on.length === 0 ? {} : { depends_on }),
          })),
        ],
      },
    },
    resource_changes: Object.entries(changeResources)
      .filter(([address]) => !finalization || !temporaryAddresses.has(address))
      .map(([address, type]) => {
        if (arm && updates.has(address)) return { address, mode: 'managed', type, change: updateChange(address) };
        if (!arm && address.startsWith('google_project_iam_custom_role.')) {
          return { address, mode: 'managed', type, change: updateChange(address) };
        }
        const value = resourceValue(address, arm ? 'arm' : 'retire');
        const actions = arm && !noOps.has(address)
          ? ['create']
          : (temporaryAddresses.has(address) ? ['delete'] : ['no-op']);
        return {
          address,
          mode: 'managed',
          type,
          change: {
            actions,
            before: arm && !noOps.has(address) ? null : value,
            after: arm ? value : (temporaryAddresses.has(address) ? null : value),
          },
        };
      }),
  };
}

function syntheticPersistentRecoveryPlan(expectedMutations) {
  const plan = syntheticPlan('retire-finalize');
  plan.complete = false;
  plan.resource_changes = Object.entries(expectedMutations).map(([address, action]) => ({
    address,
    mode: 'managed',
    type: changeResources[address],
    change: action === 'update'
      ? updateChange(address)
      : {
        actions: ['create'],
        before: null,
        after: resourceValue(address, 'retire'),
      },
  }));
  return plan;
}

function terraformDynamicType(value) {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return ['tuple', value.map(terraformDynamicType)];
  return ['object', Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, terraformDynamicType(entry)]),
  )];
}

function authProbeState(addresses, taintedAddresses = [], { previousGuard = false } = {}) {
  const resource = (address) => {
    const counted = address.endsWith('[0]');
    const base = counted ? address.slice(0, -3) : address;
    const [type, name] = base.startsWith('data.') ? base.slice(5).split('.') : base.split('.');
    const attributes = {};
    if (address === 'terraform_data.auth_probe_guard') {
      const value = guardInput(previousGuard);
      const wrapped = { value, type: terraformDynamicType(value) };
      Object.assign(attributes, {
        id: 'bd5471f4-d4d8-609b-5621-a84204953f4d',
        input: structuredClone(wrapped),
        output: structuredClone(wrapped),
        triggers_replace: null,
      });
    }
    if (address === 'google_project_iam_custom_role.auth_probe') Object.assign(attributes, { name: CUSTOM_ROLE_NAME, project: PROJECT_ID });
    if (address === 'google_project_iam_custom_role.auth_probe_firestore') Object.assign(attributes, { name: FIRESTORE_ROLE_NAME, project: PROJECT_ID });
    if (address === 'google_project_iam_custom_role.auth_probe_signer') Object.assign(attributes, { name: SIGNER_ROLE_NAME, project: PROJECT_ID });
    if (address === 'google_project_iam_member.auth_probe[0]') Object.assign(attributes, { project: PROJECT_ID, role: CUSTOM_ROLE_NAME, member: `serviceAccount:${PROBE_ACCOUNT}` });
    if (address === 'google_project_iam_member.auth_probe_firestore[0]') Object.assign(attributes, { project: PROJECT_ID, role: FIRESTORE_ROLE_NAME, member: `serviceAccount:${PROBE_ACCOUNT}` });
    if (address === 'google_project_service.auth_probe_asset_inventory') Object.assign(attributes, { project: PROJECT_ID, service: CLOUD_ASSET_SERVICE });
    if (address === 'google_service_account_iam_member.auth_probe_self_signer[0]') Object.assign(attributes, { service_account_id: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`, role: SIGNER_ROLE_NAME, member: `serviceAccount:${PROBE_ACCOUNT}` });
    if (address === 'google_service_account.auth_probe_verifier') Object.assign(attributes, { project: PROJECT_ID, email: VERIFIER_ACCOUNT });
    if (address === 'google_cloud_run_v2_service.auth_probe_verifier[0]') Object.assign(attributes, { project: PROJECT_ID, location: REGION, name: VERIFIER_SERVICE_NAME });
    if (address === 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]') Object.assign(attributes, { project: PROJECT_ID, location: REGION, name: VERIFIER_SERVICE_NAME, role: 'roles/run.servicesInvoker', member: `serviceAccount:${PROBE_ACCOUNT}` });
    if (address === 'google_workflows_workflow.auth_probe[0]') Object.assign(attributes, { project: PROJECT_ID, region: REGION, name: WORKFLOW_NAME });
    return { mode: base.startsWith('data.') ? 'data' : 'managed', type, name, instances: [{ ...(counted ? { index_key: 0 } : {}), ...(taintedAddresses.includes(address) ? { status: 'tainted' } : {}), attributes }] };
  };
  return Buffer.from(JSON.stringify({
    version: 4,
    terraform_version: TERRAFORM_VERSION,
    serial: 9,
    lineage: '11111111-2222-4333-8444-555555555555',
    outputs: {},
    resources: addresses.map(resource),
  }));
}

function recoveryLiveInventory() {
  return {
    schema: 'miakapp.staging-user-relay-probe-temporary-inventory/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    cloud_asset_api: true,
    custom_roles: {
      firebase: {
        name: CUSTOM_ROLE_NAME,
        stage: 'GA',
        deleted: false,
        etag: 'BwAAAA==',
        permissions: [...CUSTOM_ROLE_PERMISSIONS],
      },
      firestore: {
        name: FIRESTORE_ROLE_NAME,
        stage: 'GA',
        deleted: false,
        etag: 'BwAAAg==',
        permissions: [...FIRESTORE_ROLE_PERMISSIONS],
      },
      signer: {
        name: SIGNER_ROLE_NAME,
        stage: 'GA',
        deleted: false,
        etag: 'BwAABA==',
        permissions: [...SIGNER_ROLE_PERMISSIONS],
      },
    },
    custom_role_bindings: {
      'google_project_iam_custom_role.auth_probe': {
        role_name: CUSTOM_ROLE_NAME,
        direct_binding_present: true,
        indexed_binding_present: true,
        resource: `//cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}`,
        asset_type: 'cloudresourcemanager.googleapis.com/Project',
        authoritative: false,
      },
      'google_project_iam_custom_role.auth_probe_firestore': {
        role_name: FIRESTORE_ROLE_NAME,
        direct_binding_present: true,
        indexed_binding_present: true,
        resource: `//cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}`,
        asset_type: 'cloudresourcemanager.googleapis.com/Project',
        authoritative: false,
      },
      'google_project_iam_custom_role.auth_probe_signer': {
        role_name: SIGNER_ROLE_NAME,
        direct_binding_present: true,
        indexed_binding_present: true,
        resource: `//iam.googleapis.com/projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
        asset_type: 'iam.googleapis.com/ServiceAccount',
        authoritative: false,
      },
    },
    verifier_identity: {
      email: VERIFIER_ACCOUNT,
      disabled: false,
      user_managed_keys: 0,
      project_roles: 0,
      all_resource_roles: 0,
      resource_policy_inventory: true,
    },
    persistent_resources: {
      'google_project_iam_custom_role.auth_probe': true,
      'google_project_iam_custom_role.auth_probe_firestore': true,
      'google_project_iam_custom_role.auth_probe_signer': true,
      'google_project_service.auth_probe_asset_inventory': true,
      'google_service_account.auth_probe_verifier': true,
    },
    project_role_binding: true,
    firestore_role_binding: true,
    self_signer_binding: true,
    verifier_invoker_binding: true,
    verifier_service: { name: VERIFIER_SERVICE_NAME, revision: `${VERIFIER_SERVICE_NAME}-00001-abc`, source_sha256: VERIFIER_SOURCE_SHA256 },
    workflow: { name: `projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}`, revision: WORKFLOW_REVISION, source_sha256: WORKFLOW_SOURCE_SHA256, executions: 0 },
  };
}

function finalizationLiveInventory(stages = ['GA', 'GA', 'GA']) {
  const live = structuredClone(recoveryLiveInventory());
  [
    live.custom_roles.firebase,
    live.custom_roles.firestore,
    live.custom_roles.signer,
  ].forEach((role, index) => {
    role.stage = stages[index];
  });
  live.project_role_binding = false;
  live.firestore_role_binding = false;
  live.self_signer_binding = false;
  live.verifier_invoker_binding = false;
  live.verifier_service = null;
  live.workflow = null;
  for (const binding of Object.values(live.custom_role_bindings)) {
    binding.direct_binding_present = false;
    binding.indexed_binding_present = false;
    binding.resource = null;
    binding.asset_type = null;
  }
  return live;
}

test('contains only the reviewed dormant and temporary user-relay probe graph', () => {
  assert.doesNotThrow(() => validateAuthProbeRoot(probeRoot));
  assert.match(terraformSource, /prefix = "terraform\/auth-probe"/);
  assert.match(terraformSource, /firebase_auth_prefix\s+= "terraform\/firebase-auth"/);
  assert.match(terraformSource, /count = var\.armed \? 1 : 0/);
  assert.match(terraformSource, /INGRESS_TRAFFIC_INTERNAL_ONLY/);
  assert.match(terraformSource, /max_instance_count = 1/);
  assert.match(terraformSource, /call_log_level\s+= "LOG_NONE"/);
  assert.match(terraformSource, /execution_history_level\s+= "EXECUTION_HISTORY_BASIC"/);
  assert.match(terraformSource, /prevent_destroy = true/);
  assert.equal((terraformSource.match(/stage = var\.armed \? "GA" : "DISABLED"/g) ?? []).length, 3);
  assert.equal((terraformSource.match(/resource\s+"/g) ?? []).length, 12);
  assert.doesNotMatch(terraformSource, /google_(cloudfunctions|compute|scheduler|service_account_key)/);
  assert.doesNotMatch(terraformSource, /allUsers|allAuthenticatedUsers|roles\/owner|roles\/editor|\bmiakapp-3\b/);
  assert.match(retirementDrivers, /-target=google_cloud_run_v2_service\.auth_probe_verifier/);
  assert.match(retirementDrivers, /-target=google_project_iam_custom_role\.auth_probe_signer/);
  assert.match(retirementDrivers, /-target=google_project_iam_member\.auth_probe_firestore/);
  assert.match(retirementRecoveryDrivers, /run', 'services', 'delete'/);
  assert.match(retirementRecoveryDrivers, /remove-iam-policy-binding/);
  assert.doesNotMatch(retirementRecoveryDrivers, /allUsers|allAuthenticatedUsers|force-unlock/);
  assert.deepEqual(AUTH_PROBE_RETIRED_STATE_ADDRESSES, [
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    'google_project_iam_custom_role.auth_probe',
    'google_project_iam_custom_role.auth_probe_firestore',
    'google_project_iam_custom_role.auth_probe_signer',
    'google_project_service.auth_probe_asset_inventory',
    'google_service_account.auth_probe_verifier',
    'terraform_data.auth_probe_guard',
  ]);
});

test('accepts the real two-URL Cloud Run shape and closes the verifier IAM boundary', () => {
  const generatedUri = 'https://miakapp-user-relay-verifier-3jgucqdh7a-od.a.run.app';
  const announcedUris = [generatedUri, VERIFIER_SERVICE_URI];
  assert.deepEqual(
    validateVerifierAnnouncedUrls(announcedUris),
    announcedUris,
  );
  assert.deepEqual(
    validateVerifierServiceEndpoints(
      { url: generatedUri, address: { url: generatedUri } },
      JSON.stringify(announcedUris),
    ),
    announcedUris,
  );
  assert.throws(() => validateVerifierServiceEndpoints(
    { url: VERIFIER_SERVICE_URI, address: { url: VERIFIER_SERVICE_URI } },
    JSON.stringify(announcedUris),
  ), /service URI/u);
  assert.throws(() => validateVerifierServiceEndpoints(
    { url: generatedUri, address: { url: 'https://unreviewed.example.invalid' } },
    JSON.stringify(announcedUris),
  ), /service address/u);
  for (const invalid of [
    [VERIFIER_SERVICE_URI],
    [VERIFIER_SERVICE_URI, 'https://verifier.example.com'],
    [VERIFIER_SERVICE_URI, 'https://tag---identifier.run.app'],
    [VERIFIER_SERVICE_URI, generatedUri, 'https://another-id.run.app'],
  ]) {
    assert.throws(() => validateVerifierAnnouncedUrls(invalid), /URL/u);
  }

  const condition = {
    title: 'temporary_user_relay_probe',
    description: 'Expires invocation of the temporary verifier independently of cleanup.',
    expression: `request.time < timestamp(\"${CAPABILITY_EXPIRY}\")`,
  };
  const exactPolicy = {
    bindings: [{
      role: 'roles/run.servicesInvoker',
      members: [`serviceAccount:${PROBE_ACCOUNT}`],
      condition,
    }],
  };
  assert.equal(validateVerifierServicePolicy(exactPolicy, true), true);
  assert.equal(validateVerifierServicePolicy({}, false), false);
  assert.throws(() => validateVerifierServicePolicy({
    bindings: [...exactPolicy.bindings, { role: 'roles/run.viewer', members: ['group:private@example.invalid'] }],
  }, true), /bindings/u);

  const fakeOperator = 'Operator@Example.invalid';
  const inherited = validateInheritedVerifierInvokerBindings([
    {
      role: 'roles/run.serviceAgent',
      members: [`serviceAccount:service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com`],
    },
    {
      role: 'roles/editor',
      members: [
        `serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com`,
        `serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com`,
      ],
    },
    { role: 'roles/owner', members: [`user:${fakeOperator}`] },
    {
      role: 'roles/cloudfunctions.standardServiceAgent',
      members: [`serviceAccount:service-${PROJECT_NUMBER}@gcf-admin-robot.iam.gserviceaccount.com`],
    },
  ], createHash('sha256').update(fakeOperator.toLowerCase()).digest('hex'));
  assert.equal(inherited.workflow_only, false);
  assert.equal(inherited.project_level_principals, 5);
  assert.throws(() => validateInheritedVerifierInvokerBindings([
    { role: 'roles/run.admin', members: ['user:another@example.invalid'] },
  ], createHash('sha256').update(fakeOperator.toLowerCase()).digest('hex')), /roles/u);
});

test('observes the verifier identity without Cloud Asset and routes an API-only prerequisite', () => {
  const calls = [];
  const identity = observeVerifierIdentity({}, {
    allowAbsent: true,
    cloudAssetApi: false,
  }, {
    optionalJson: () => ({
      name: `projects/${PROJECT_ID}/serviceAccounts/${VERIFIER_ACCOUNT}`,
      email: VERIFIER_ACCOUNT,
      displayName: 'Miakapp V4 staging probe verifier',
      description: 'Keyless no-role identity for the temporary internal JWT verifier.',
      disabled: false,
    }),
    json: (args) => {
      calls.push(args);
      if (args.includes('keys')) return [];
      throw new Error('Cloud Asset must not be queried while its API is disabled');
    },
  });
  assert.equal(identity.resource_policy_inventory, false);
  assert.equal(identity.all_resource_roles, null);
  assert.equal(calls.length, 1);

  const live = structuredClone(recoveryLiveInventory());
  live.cloud_asset_api = false;
  live.custom_role_bindings = null;
  live.persistent_resources['google_project_service.auth_probe_asset_inventory'] = false;
  live.verifier_identity.resource_policy_inventory = false;
  live.verifier_identity.all_resource_roles = null;
  const state = inspectAuthProbeState(authProbeState([
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    ...Object.keys(PERSISTENT_RESOURCE_IMPORTS),
    'terraform_data.auth_probe_guard',
  ]));
  const inventory = buildAuthProbeRetirementRecoveryInventory(state, live);
  assert.equal(inventory.recovery_phase, 'cloud_asset_api_prerequisite');
  assert.deepEqual(inventory.persistent_state_actions, [{
    address: 'google_project_service.auth_probe_asset_inventory',
    action: 'enable_reimport',
    import_id: `${PROJECT_ID}/${CLOUD_ASSET_SERVICE}`,
  }]);
  assert.deepEqual(inventory.missing_temporaries, []);
  assert.deepEqual(inventory.absent_remote_temporaries, []);
  assert.equal(inventory.guard_state_action, null);
  assert.equal(inventory.retirement_finalization_required, false);
  const metadata = buildAuthProbeRetirementRecoveryMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    inventory,
  });
  assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryMetadata(
    metadata,
    Date.parse(CREATED_AT) + 1,
  ));
});

test('requires the reused probe identity to remain keyless before temporary privilege grant', () => {
  const account = {
    name: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
    email: PROBE_ACCOUNT,
    displayName: 'Miakapp V4 staging synthetic probe',
    description: 'Keyless identity allowed to invoke only the private staging control plane.',
    disabled: false,
  };
  const observe = (keys) => observeProbeIdentity({
    json: (args) => args.includes('describe') ? account : keys,
  });
  assert.deepEqual(observe([]), {
    email: PROBE_ACCOUNT,
    disabled: false,
    user_managed_keys: 0,
  });
  assert.throws(() => observe([{ name: 'projects/example/keys/stale' }]), /user-managed key/u);
  assert.match(
    applyDriver,
    /observeAuthProbeArmPreflight\(\);[\s\S]+?mutationAttempted = true;[\s\S]+?'apply'/u,
  );
});

test('inventories exact role bindings but refuses automatic soft-deleted role recovery', () => {
  const etag = 'BwAACA==';
  const role = observeCustomRole(CUSTOM_ROLE_ID, {
    name: CUSTOM_ROLE_NAME,
    title: 'Miakapp staging Auth probe',
    description: 'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
    permissions: CUSTOM_ROLE_PERMISSIONS,
  }, { allowAbsent: true }, {
    optionalJson: () => ({
      name: CUSTOM_ROLE_NAME,
      title: 'Miakapp staging Auth probe',
      description: 'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
      includedPermissions: [...CUSTOM_ROLE_PERMISSIONS],
      stage: 'GA',
      deleted: true,
      etag,
    }),
    json: () => { throw new Error('Deleted role was available through the exact describe'); },
  });
  assert.equal(role.deleted, true);
  assert.equal(role.etag, etag);

  const live = structuredClone(recoveryLiveInventory());
  live.custom_roles.firebase.deleted = true;
  live.custom_roles.firebase.etag = etag;
  live.persistent_resources['google_project_iam_custom_role.auth_probe'] = false;
  const addresses = [
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    ...Object.keys(PERSISTENT_RESOURCE_IMPORTS),
    ...Object.values({
      verifier_service: 'google_cloud_run_v2_service.auth_probe_verifier[0]',
      verifier_binding: 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]',
      project_binding: 'google_project_iam_member.auth_probe[0]',
      firestore_binding: 'google_project_iam_member.auth_probe_firestore[0]',
      signer_binding: 'google_service_account_iam_member.auth_probe_self_signer[0]',
      workflow: 'google_workflows_workflow.auth_probe[0]',
    }),
    'terraform_data.auth_probe_guard',
  ];
  assert.throws(() => buildAuthProbeRetirementRecoveryInventory(
    inspectAuthProbeState(authProbeState(addresses)), live,
  ), /soft-deleted.*manual recovery/u);

  const expectedRoleBinding = {
    roleName: CUSTOM_ROLE_NAME,
    bindingPresent: true,
    resource: `//cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}`,
    assetType: 'cloudresourcemanager.googleapis.com/Project',
    member: `serviceAccount:${PROBE_ACCOUNT}`,
    condition: {
      title: 'temporary_user_relay_probe',
      description: 'Expires the user-relay probe Firebase capability independently of cleanup.',
      expression: `request.time < timestamp(\"${CAPABILITY_EXPIRY}\")`,
    },
  };
  const policyResult = {
    resource: expectedRoleBinding.resource,
    assetType: expectedRoleBinding.assetType,
    project: `projects/${PROJECT_NUMBER}`,
    policy: { bindings: [{
      role: CUSTOM_ROLE_NAME,
      members: [expectedRoleBinding.member],
      condition: expectedRoleBinding.condition,
    }] },
  };
  assert.equal(
    validateCustomRolePolicySearch([policyResult], expectedRoleBinding).indexed_binding_present,
    true,
  );
  assert.throws(() => validateCustomRolePolicySearch([{
    ...policyResult,
    resource: `//firestore.googleapis.com/projects/${PROJECT_ID}/databases/(default)`,
    assetType: 'firestore.googleapis.com/Database',
  }], expectedRoleBinding), /resource/u);
  assert.deepEqual(validateCustomRolePolicySearch([], {
    ...expectedRoleBinding,
    bindingPresent: false,
  }), {
    role_name: CUSTOM_ROLE_NAME,
    direct_binding_present: false,
    indexed_binding_present: false,
    resource: null,
    asset_type: null,
    authoritative: false,
  });
  assert.deepEqual(validateCustomRolePolicySearch([], expectedRoleBinding), {
    role_name: CUSTOM_ROLE_NAME,
    direct_binding_present: true,
    indexed_binding_present: false,
    resource: null,
    asset_type: null,
    authoritative: false,
  });
  assert.doesNotMatch(retirementRecoveryDrivers, /undelete|print-access-token/u);
});

test('routes every non-current state-only guard through retirement recovery', () => {
  for (const action of ['create', 'update', 'untaint', 'untaint_then_update']) {
    assert.equal(requiresAuthProbeRetirementRecovery({
      missing_temporaries: [],
      absent_remote_temporaries: [],
      persistent_state_actions: [],
      guard_state_action: { address: 'terraform_data.auth_probe_guard', action },
      retirement_finalization_required: false,
    }), true);
  }
  assert.equal(requiresAuthProbeRetirementRecovery({
    missing_temporaries: [],
    absent_remote_temporaries: [],
    persistent_state_actions: [],
    guard_state_action: null,
    retirement_finalization_required: false,
  }), false);
  assert.match(retirementDrivers, /requiresAuthProbeRetirementRecovery\(recovery\)/u);
});

test('accepts only the exact canonical Cloud Run IAM target in imported state', () => {
  const state = JSON.parse(authProbeState([
    'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]',
  ]).toString('utf8'));
  const invoker = state.resources[0].instances[0].attributes;
  invoker.name = VERIFIER_SERVICE_RESOURCE;
  assert.doesNotThrow(() => inspectAuthProbeState(Buffer.from(JSON.stringify(state))));

  invoker.name = `projects/${PROJECT_ID}/locations/${REGION}/services/unreviewed`;
  assert.throws(
    () => inspectAuthProbeState(Buffer.from(JSON.stringify(state))),
    /name does not match/u,
  );
});

test('authorizes exact no-temporary retirement finalization and evidence recovery', () => {
  const state = inspectAuthProbeState(authProbeState(AUTH_PROBE_RETIRED_STATE_ADDRESSES));
  for (const stages of [
    ['GA', 'GA', 'GA'],
    ['GA', 'DISABLED', 'DISABLED'],
    ['DISABLED', 'DISABLED', 'DISABLED'],
  ]) {
    const inventory = buildAuthProbeRetirementRecoveryInventory(
      state,
      finalizationLiveInventory(stages),
    );
    assert.deepEqual(inventory.missing_temporaries, []);
    assert.deepEqual(inventory.absent_remote_temporaries, []);
    assert.deepEqual(inventory.persistent_state_actions, []);
    assert.equal(inventory.guard_state_action, null);
    assert.equal(inventory.retirement_finalization_required, true);
    assert.equal(requiresAuthProbeRetirementRecovery(inventory), true);

    const metadata = buildAuthProbeRetirementRecoveryMetadata({
      repositoryCommit: COMMIT,
      createdAt: CREATED_AT,
      inventory,
    });
    const authorization = authProbeRetirementRecoveryAuthorization(metadata);
    assert.equal(metadata.retirement_finalization_required, true);
    assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryMetadata(
      metadata,
      Date.parse(CREATED_AT) + 1,
    ));
    assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryAuthorization(
      authorization,
      metadata,
    ));
    assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryInventory(
      inventory,
      metadata,
    ));
    assert.throws(() => validateAuthProbeRetirementRecoveryAuthorization(
      authorization,
      { ...metadata, retirement_finalization_required: false },
    ));
    assert.throws(() => validateAuthProbeRetirementRecoveryMetadata({
      ...metadata,
      state_addresses: [
        ...metadata.state_addresses,
        'google_workflows_workflow.auth_probe[0]',
      ].sort(),
    }, Date.parse(CREATED_AT) + 1), /does not match/u);
  }

  const workflowTrackedState = inspectAuthProbeState(authProbeState([
    ...AUTH_PROBE_RETIRED_STATE_ADDRESSES,
    'google_workflows_workflow.auth_probe[0]',
  ]));
  const workflowPresent = finalizationLiveInventory();
  workflowPresent.workflow = recoveryLiveInventory().workflow;
  const normalRetirement = buildAuthProbeRetirementRecoveryInventory(
    workflowTrackedState,
    workflowPresent,
  );
  assert.equal(normalRetirement.retirement_finalization_required, false);
  assert.equal(requiresAuthProbeRetirementRecovery(normalRetirement), false);

  const softDeleted = finalizationLiveInventory();
  softDeleted.custom_roles.firebase.deleted = true;
  softDeleted.persistent_resources['google_project_iam_custom_role.auth_probe'] = false;
  assert.throws(() => buildAuthProbeRetirementRecoveryInventory(
    state,
    softDeleted,
  ), /soft-deleted.*manual recovery/u);
});

test('binds orphan retirement recovery to all six temporary resources', () => {
  const state = inspectAuthProbeState(authProbeState([
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    'terraform_data.auth_probe_guard',
  ]));
  const inventory = buildAuthProbeRetirementRecoveryInventory(state, recoveryLiveInventory());
  assert.deepEqual(inventory.missing_temporaries, [
    'firestore_role_binding',
    'project_role_binding',
    'self_signer_binding',
    'verifier_invoker_binding',
    'verifier_service',
    'workflow',
  ]);
  assert.deepEqual(inventory.persistent_state_actions.map(({ address, action }) => ({ address, action })), [
    { address: 'google_project_iam_custom_role.auth_probe', action: 'import' },
    { address: 'google_project_iam_custom_role.auth_probe_firestore', action: 'import' },
    { address: 'google_project_iam_custom_role.auth_probe_signer', action: 'import' },
    { address: 'google_project_service.auth_probe_asset_inventory', action: 'import' },
    { address: 'google_service_account.auth_probe_verifier', action: 'import' },
  ]);
  const metadata = buildAuthProbeRetirementRecoveryMetadata({ repositoryCommit: COMMIT, createdAt: CREATED_AT, inventory });
  const authorization = authProbeRetirementRecoveryAuthorization(metadata);
  assert.match(authorization, /^recover-user-relay-probe-retirement:miakapp-v4-staging:/);
  assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryMetadata(metadata, Date.parse(CREATED_AT) + 1));
  assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryAuthorization(authorization, metadata));
  assert.throws(() => validateAuthProbeRetirementRecoveryAuthorization(`${authorization}x`, metadata));
  assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryInventory(inventory, metadata));

  const tracked = inspectAuthProbeState(authProbeState(Object.values({
    project: 'google_project_iam_member.auth_probe[0]',
    firestore: 'google_project_iam_member.auth_probe_firestore[0]',
    signer: 'google_service_account_iam_member.auth_probe_self_signer[0]',
    verifier: 'google_cloud_run_v2_service.auth_probe_verifier[0]',
    invoker: 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]',
    workflow: 'google_workflows_workflow.auth_probe[0]',
  })));
  const absentLive = {
    ...recoveryLiveInventory(),
    project_role_binding: false,
    firestore_role_binding: false,
    self_signer_binding: false,
    verifier_invoker_binding: false,
    verifier_service: null,
    workflow: null,
    custom_role_bindings: Object.fromEntries(
      Object.entries(recoveryLiveInventory().custom_role_bindings).map(([address, binding]) => [
        address,
        {
          ...binding,
          direct_binding_present: false,
          indexed_binding_present: false,
          resource: null,
          asset_type: null,
        },
      ]),
    ),
  };
  const inverse = buildAuthProbeRetirementRecoveryInventory(tracked, absentLive);
  assert.deepEqual(inverse.missing_temporaries, []);
  assert.deepEqual(inverse.absent_remote_temporaries, [
    'firestore_role_binding',
    'project_role_binding',
    'self_signer_binding',
    'verifier_invoker_binding',
    'verifier_service',
    'workflow',
  ]);
});

test('recovers every live persistent probe resource from missing or tainted state', () => {
  const baseAddresses = [
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    ...Object.keys(PERSISTENT_RESOURCE_IMPORTS),
    'terraform_data.auth_probe_guard',
  ];
  for (const [address, importId] of Object.entries(PERSISTENT_RESOURCE_IMPORTS)) {
    const absent = inspectAuthProbeState(authProbeState(
      baseAddresses.filter((candidate) => candidate !== address),
    ));
    const absentInventory = buildAuthProbeRetirementRecoveryInventory(
      absent,
      recoveryLiveInventory(),
    );
    assert.deepEqual(absentInventory.persistent_state_actions, [{
      address,
      action: 'import',
      import_id: importId,
    }]);

    const tainted = inspectAuthProbeState(authProbeState(baseAddresses, [address]));
    const taintedInventory = buildAuthProbeRetirementRecoveryInventory(
      tainted,
      recoveryLiveInventory(),
    );
    assert.deepEqual(taintedInventory.persistent_state_actions, [{
      address,
      action: 'untaint',
      import_id: importId,
    }]);

    const partialLive = structuredClone(recoveryLiveInventory());
    partialLive.persistent_resources[address] = false;
    const customRoleKey = {
      'google_project_iam_custom_role.auth_probe': 'firebase',
      'google_project_iam_custom_role.auth_probe_firestore': 'firestore',
      'google_project_iam_custom_role.auth_probe_signer': 'signer',
    }[address];
    if (customRoleKey !== undefined) partialLive.custom_roles[customRoleKey] = null;
    if (address === 'google_project_service.auth_probe_asset_inventory') {
      partialLive.cloud_asset_api = false;
      partialLive.custom_role_bindings = null;
      partialLive.verifier_identity.resource_policy_inventory = false;
      partialLive.verifier_identity.all_resource_roles = null;
    }
    if (address === 'google_service_account.auth_probe_verifier') {
      partialLive.verifier_identity = null;
    }
    const partial = buildAuthProbeRetirementRecoveryInventory(absent, partialLive);
    assert.deepEqual(partial.persistent_state_actions, [{
      address,
      action: address === 'google_project_service.auth_probe_asset_inventory'
        ? 'enable_import'
        : 'create',
      import_id: importId,
    }]);

    for (const state of [
      inspectAuthProbeState(authProbeState(baseAddresses)),
      inspectAuthProbeState(authProbeState(baseAddresses, [address])),
    ]) {
      if (customRoleKey !== undefined) {
        assert.throws(
          () => buildAuthProbeRetirementRecoveryInventory(state, partialLive),
          /not verifiably reusable/u,
        );
      } else {
        const missing = buildAuthProbeRetirementRecoveryInventory(state, partialLive);
        assert.deepEqual(missing.persistent_state_actions, [{
          address,
          action: address === 'google_project_service.auth_probe_asset_inventory'
            ? 'enable_reimport'
            : 'recreate',
          import_id: importId,
        }]);
      }
    }
  }
});

test('recovers every missing, stale, or tainted state-only guard generation', () => {
  const baseAddresses = [
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    ...Object.keys(PERSISTENT_RESOURCE_IMPORTS),
  ];
  const scenarios = [
    { addresses: baseAddresses, expectedStatus: 'absent', expectedAction: 'create' },
    {
      addresses: [...baseAddresses, 'terraform_data.auth_probe_guard'],
      tainted: ['terraform_data.auth_probe_guard'],
      expectedStatus: 'tainted_current',
      expectedAction: 'untaint',
    },
    {
      addresses: [...baseAddresses, 'terraform_data.auth_probe_guard'],
      previousGuard: true,
      expectedStatus: 'previous',
      expectedAction: 'update',
    },
    {
      addresses: [...baseAddresses, 'terraform_data.auth_probe_guard'],
      tainted: ['terraform_data.auth_probe_guard'],
      previousGuard: true,
      expectedStatus: 'tainted_previous',
      expectedAction: 'untaint_then_update',
    },
  ];
  for (const scenario of scenarios) {
    const state = inspectAuthProbeState(authProbeState(
      scenario.addresses,
      scenario.tainted ?? [],
      { previousGuard: scenario.previousGuard ?? false },
    ));
    const inventory = buildAuthProbeRetirementRecoveryInventory(state, recoveryLiveInventory());
    assert.equal(inventory.guard_state_status, scenario.expectedStatus);
    assert.deepEqual(inventory.guard_state_action, {
      address: 'terraform_data.auth_probe_guard',
      action: scenario.expectedAction,
    });
    const metadata = buildAuthProbeRetirementRecoveryMetadata({
      repositoryCommit: COMMIT,
      createdAt: CREATED_AT,
      inventory,
    });
    assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryMetadata(
      metadata,
      Date.parse(CREATED_AT) + 1,
    ));
  }
  const malformed = JSON.parse(authProbeState([
    ...baseAddresses,
    'terraform_data.auth_probe_guard',
  ]).toString('utf8'));
  const guard = malformed.resources.find(({ type }) => type === 'terraform_data');
  guard.instances[0].attributes.input = guard.instances[0].attributes.input.value;
  assert.throws(
    () => inspectAuthProbeState(Buffer.from(JSON.stringify(malformed))),
    /wrapper/u,
  );
});

test('allows only exact saved-plan recreation of dormant persistent resources', () => {
  for (const address of [
    ...Object.keys(PERSISTENT_RESOURCE_IMPORTS),
    'terraform_data.auth_probe_guard',
  ]) {
    const expected = { [address]: 'create' };
    assert.deepEqual(
      validateAuthProbePersistentRecoveryPlanAgainstPolicy(
        syntheticPersistentRecoveryPlan(expected),
        expected,
      ),
      { create: 1, update: 0, delete: 0 },
    );
  }
  const guardUpdate = { 'terraform_data.auth_probe_guard': 'update' };
  assert.deepEqual(
    validateAuthProbePersistentRecoveryPlanAgainstPolicy(
      syntheticPersistentRecoveryPlan(guardUpdate),
      guardUpdate,
    ),
    { create: 0, update: 1, delete: 0 },
  );
  const broadened = syntheticPersistentRecoveryPlan({
    'google_project_service.auth_probe_asset_inventory': 'create',
  });
  broadened.resource_changes.push({
    address: 'google_project_iam_member.auth_probe[0]',
    mode: 'managed',
    type: 'google_project_iam_member',
    change: {
      actions: ['create'],
      before: null,
      after: resourceValue('google_project_iam_member.auth_probe[0]'),
    },
  });
  assert.throws(() => validateAuthProbePersistentRecoveryPlanAgainstPolicy(
    broadened,
    { 'google_project_service.auth_probe_asset_inventory': 'create' },
  ), /unapproved mutation/u);
});

test('pins a no-secret one-shot audience-bound user-relay Workflow', () => {
  const stages = [
    'initialize', 'web_config', 'initial_home', 'initial_user', 'auth_custom_token',
    'auth_exchange', 'app_check_custom_token', 'app_check_exchange', 'cloud_run_identity',
    'discovery', 'jwks', 'invalid_firebase', 'missing_app_check', 'missing_home',
    'home_create', 'first_exchange', 'home_rotation', 'second_exchange',
    'token_verification', 'success',
  ];
  assert.deepEqual(
    [...WORKFLOW_SOURCE.matchAll(/- probe_stage: ([a-z_]+)/gu)].map((match) => match[1]),
    stages,
  );
  assert.equal((WORKFLOW_SOURCE.match(/url: \$\{function_uri \+ exchange_path\}/g) ?? []).length, 5);
  assert.equal((WORKFLOW_SOURCE.match(/X-Serverless-Authorization:/g) ?? []).length, 7);
  assert.equal((WORKFLOW_SOURCE.match(/url: \$\{function_uri \+ (?:discovery_path|jwks_path)\}/g) ?? []).length, 2);
  assert.match(WORKFLOW_SOURCE, /accounts:signInWithCustomToken/);
  assert.match(WORKFLOW_SOURCE, /:exchangeCustomToken/);
  assert.match(WORKFLOW_SOURCE, /controlHomes/);
  assert.match(WORKFLOW_SOURCE, /documents\/homes\/miakapp-v4-staging-user-relay-probe-v1/);
  assert.match(WORKFLOW_SOURCE, /currentDocument\.updateTime/);
  assert.match(WORKFLOW_SOURCE, /verifier_uri \+ "\/verify"/);
  assert.match(WORKFLOW_SOURCE, /owner_matches_authenticated_user: false/);
  assert.match(WORKFLOW_SOURCE, /public_home_written: \$\{not\(public_home_absence_before_verified and public_home_absence_after_verified\)\}/);
  assert.match(WORKFLOW_SOURCE, /url: https:\/\/identitytoolkit\.googleapis\.com\/v1\/accounts:delete/);
  assert.match(WORKFLOW_SOURCE, /idToken: \$\{firebase_id_token\}/);
  assert.doesNotMatch(WORKFLOW_SOURCE, /projects\/miakapp-v4-staging\/accounts:delete/);
  assert.doesNotMatch(terraformSource, /firebaseauth\.users\.delete/);
  assert.match(WORKFLOW_SOURCE, /len\(jwks_response\.body\) != 1/);
  assert.match(WORKFLOW_SOURCE, /len\(jwks_response\.body\.keys\[0\]\) != 6/);
  const expressions = WORKFLOW_SOURCE.split('\n').flatMap((line, index) => {
    const start = line.indexOf('${');
    if (start < 0) return [];
    const end = line.lastIndexOf('}');
    assert.ok(end > start, `Workflow expression on line ${index + 1} is not closed`);
    return [{ line: index + 1, source: line.slice(start + 2, end) }];
  });
  for (const expression of expressions) {
    assert.ok(expression.source.length <= 400, `Workflow expression on line ${expression.line} exceeds 400 characters`);
  }
  assert.doesNotMatch(WORKFLOW_SOURCE, /^\s*retry:/mu);
  assert.doesNotMatch(WORKFLOW_SOURCE, /AIza[0-9A-Za-z_-]{30,}|debugToken|private[_ -]?key/iu);
  assert.doesNotMatch(WORKFLOW_SOURCE, /allUsers|allAuthenticatedUsers|\bmiakapp-3\b/);
});

test('retains valid historical Auth/App Check evidence until superseded by live relay evidence', () => {
  const validated = validateAuthProbeEvidence(committedResultPath, committedRetirementPath);
  assert.equal(validated.result.execution.state, 'SUCCEEDED');
  assert.equal(validated.retirement.workflow_present, false);
  const leaked = structuredClone(validated.result);
  leaked.execution.execution_id = 'e13810a0-3b6d-4e5f-8a7b-0123456789ab';
  assert.throws(() => validateAuthProbeEvidenceValues(leaked, validated.retirement), /private telemetry or credential field|private execution, trace or credential value/u);
});

test('validates the exact arm and retirement plans and rejects privilege drift', () => {
  const armed = validateAuthProbePlanAgainstPolicy(syntheticPlan('arm'), 'arm');
  assert.equal(armed.create, 9);
  assert.equal(armed.update, 1);
  assert.equal(armed.temporary_iam_bindings, 4);
  assert.equal(armed.temporary_services, 1);
  const foreignTransition = structuredClone(syntheticPlan('arm'));
  const foreignGuard = foreignTransition.resource_changes.find(({ address }) => address === 'terraform_data.auth_probe_guard');
  foreignGuard.change.before.input.workflow_source_sha256 = '0'.repeat(64);
  foreignGuard.change.before.output.workflow_source_sha256 = '0'.repeat(64);
  assert.throws(() => validateAuthProbePlanAgainstPolicy(foreignTransition, 'arm'), /before\.input/u);
  const broaderRole = structuredClone(syntheticPlan('arm'));
  broaderRole.resource_changes.find(({ address }) => address === 'google_project_iam_custom_role.auth_probe_signer').change.after.permissions.push('iam.serviceAccountKeys.create');
  assert.throws(() => validateAuthProbePlanAgainstPolicy(broaderRole, 'arm'), /permissions/u);
  const publicPlan = structuredClone(syntheticPlan('arm'));
  publicPlan.resource_changes.find(({ address }) => address === 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]').change.after.member = 'allUsers';
  assert.throws(() => validateAuthProbePlanAgainstPolicy(publicPlan, 'arm'), /reviewed value|forbidden/u);
  const publicIngress = structuredClone(syntheticPlan('arm'));
  publicIngress.resource_changes.find(({ address }) => address === 'google_cloud_run_v2_service.auth_probe_verifier[0]').change.after.ingress = 'INGRESS_TRAFFIC_ALL';
  assert.throws(() => validateAuthProbePlanAgainstPolicy(publicIngress, 'arm'), /ingress/u);
  const importedCloudAsset = structuredClone(syntheticPlan('arm'));
  const importedCloudAssetChange = importedCloudAsset.resource_changes.find(({ address }) => (
    address === 'google_project_service.auth_probe_asset_inventory'
  ));
  for (const value of [importedCloudAssetChange.change.before, importedCloudAssetChange.change.after]) {
    value.disable_dependent_services = null;
    value.disable_on_destroy = null;
  }
  assert.doesNotThrow(() => validateAuthProbePlanAgainstPolicy(importedCloudAsset, 'arm'));
  importedCloudAssetChange.change.after.disable_on_destroy = true;
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(importedCloudAsset, 'arm'),
    /disable_on_destroy/u,
  );

  const retired = validateAuthProbePlanAgainstPolicy(syntheticPlan('retire'), 'retire');
  assert.equal(retired.delete, 6);
  assert.equal(retired.update, 3);
  assert.equal(retired.workflow_revision, WORKFLOW_REVISION);
  const canonicalInvokerRetirement = syntheticPlan('retire');
  canonicalInvokerRetirement.resource_changes.find(({ address }) => (
    address === 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]'
  )).change.before.name = VERIFIER_SERVICE_RESOURCE;
  assert.doesNotThrow(() => validateAuthProbePlanAgainstPolicy(
    canonicalInvokerRetirement,
    'retire',
  ));
  canonicalInvokerRetirement.resource_changes.find(({ address }) => (
    address === 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]'
  )).change.before.name = `projects/${PROJECT_ID}/locations/${REGION}/services/unreviewed`;
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(canonicalInvokerRetirement, 'retire'),
    /name does not match/u,
  );
  const finalized = validateAuthProbePlanAgainstPolicy(syntheticPlan('retire-finalize'), 'retire-finalize');
  assert.equal(finalized.delete, 0);
  assert.equal(finalized.update, 3);
  assert.equal(finalized.workflow_revision, 'absent');
  const partialRetirement = syntheticPlan('retire');
  partialRetirement.resource_changes = partialRetirement.resource_changes.filter(({ address }) => (
    address.startsWith('google_project_iam_custom_role.')
      || address === 'google_cloud_run_v2_service.auth_probe_verifier[0]'
  ));
  assert.equal(validateAuthProbePlanAgainstPolicy(partialRetirement, 'retire').delete, 1);
  const roleOnlyRetirement = syntheticPlan('retire');
  roleOnlyRetirement.resource_changes = roleOnlyRetirement.resource_changes.filter(({ address }) => (
    address.startsWith('google_project_iam_custom_role.')
  ));
  assert.deepEqual(
    validateAuthProbePlanAgainstPolicy(roleOnlyRetirement, 'retire'),
    {
      phase: 'retire',
      create: 0,
      update: 3,
      delete: 0,
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
      workflow_revision: 'absent',
      workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
    },
  );
  const oneRoleDisable = structuredClone(roleOnlyRetirement);
  for (const address of [
    'google_project_iam_custom_role.auth_probe_firestore',
    'google_project_iam_custom_role.auth_probe_signer',
  ]) {
    const disabled = resourceValue(address, 'retire');
    oneRoleDisable.resource_changes.find((change) => change.address === address).change = {
      actions: ['no-op'], before: disabled, after: disabled,
    };
  }
  assert.equal(validateAuthProbePlanAgainstPolicy(oneRoleDisable, 'retire').update, 1);
  const noOpRetirement = structuredClone(oneRoleDisable);
  const disabledAuth = resourceValue('google_project_iam_custom_role.auth_probe', 'retire');
  noOpRetirement.resource_changes.find(({ address }) => (
    address === 'google_project_iam_custom_role.auth_probe'
  )).change = { actions: ['no-op'], before: disabledAuth, after: disabledAuth };
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(noOpRetirement, 'retire'),
    /delta is outside/u,
  );
  const partlyDisabled = syntheticPlan('retire');
  const disabledSigner = resourceValue('google_project_iam_custom_role.auth_probe_signer', 'retire');
  partlyDisabled.resource_changes.find(({ address }) => (
    address === 'google_project_iam_custom_role.auth_probe_signer'
  )).change = { actions: ['no-op'], before: disabledSigner, after: disabledSigner };
  assert.equal(validateAuthProbePlanAgainstPolicy(partlyDisabled, 'retire').update, 2);
  const omittedRole = structuredClone(partialRetirement);
  omittedRole.resource_changes = omittedRole.resource_changes.filter(({ address }) => (
    address !== 'google_project_iam_custom_role.auth_probe_signer'
  ));
  assert.throws(() => validateAuthProbePlanAgainstPolicy(omittedRole, 'retire'), /omits/u);
  const incompleteArm = syntheticPlan('arm');
  incompleteArm.complete = false;
  assert.throws(() => validateAuthProbePlanAgainstPolicy(incompleteArm, 'arm'), /metadata/u);
});

test('binds authorization and short-lived metadata to exact plans, sources and revisions', () => {
  const apply = authProbeApplyAuthorization(PLAN, COMMIT);
  assert.doesNotThrow(() => validateAuthProbeApplyAuthorization(apply, PLAN, COMMIT));
  assert.throws(() => validateAuthProbeApplyAuthorization(`${apply}x`, PLAN, COMMIT));
  const invoke = authProbeInvokeAuthorization(WORKFLOW_REVISION, COMMIT);
  assert.doesNotThrow(() => validateAuthProbeInvokeAuthorization(invoke, WORKFLOW_REVISION, COMMIT));
  assert.match(invoke, new RegExp(`${WORKFLOW_SOURCE_SHA256}:${VERIFIER_SOURCE_SHA256}`));
  const retire = authProbeRetireAuthorization(PLAN, WORKFLOW_REVISION, COMMIT);
  assert.doesNotThrow(() => validateAuthProbeRetireAuthorization(retire, PLAN, WORKFLOW_REVISION, COMMIT));

  const arm = buildAuthProbePlanMetadata({ phase: 'arm', repositoryCommit: COMMIT, createdAt: CREATED_AT, planBytes: PLAN, planJsonBytes: PLAN_JSON, summary: { create: 9, update: 1, delete: 0 } });
  assert.equal(arm.verifier_source_sha256, VERIFIER_SOURCE_SHA256);
  assert.doesNotThrow(() => validateAuthProbePlanMetadata(arm, 'arm', Date.parse(CREATED_AT) + 1));
  const retireMetadata = buildAuthProbePlanMetadata({ phase: 'retire', repositoryCommit: COMMIT, createdAt: CREATED_AT, planBytes: PLAN, planJsonBytes: PLAN_JSON, summary: { create: 0, update: 3, delete: 6 }, workflowRevision: WORKFLOW_REVISION });
  assert.doesNotThrow(() => validateAuthProbePlanMetadata(retireMetadata, 'retire', Date.parse(CREATED_AT) + 1));
});

test('accepts only the closed sanitized successful user-relay Workflow result', () => {
  const value = workflowResult();
  assert.doesNotThrow(() => validateAuthProbeWorkflowResult(value));
  assert.throws(() => validateAuthProbeWorkflowResult({ ...value, token: 'secret' }), /fields/u);
  assert.throws(() => validateAuthProbeWorkflowResult({ ...value, tokens: { ...value.tokens, signatures_valid: false } }), /token/u);
  assert.throws(() => validateAuthProbeWorkflowResult({ ...value, firestore: { ...value.firestore, public_home_written: true } }), /Firestore/u);
  assert.throws(() => validateAuthProbeWorkflowResult({ ...value, responses: { ...value.responses, second_exchange: { ...value.responses.second_exchange, relay_url: 'wss://relay-a.probe.invalid/ws' } } }), /responses/u);
});

test('validates one successful execution without retaining its identifier', () => {
  const name = `projects/${PROJECT_NUMBER}/locations/${REGION}/workflows/${WORKFLOW_NAME}/executions/00000000-0000-4000-8000-000000000000`;
  const execution = validateSuccessfulAuthProbeExecution({
    name,
    state: 'SUCCEEDED',
    workflowRevisionId: WORKFLOW_REVISION,
    startTime: '2026-09-05T00:00:00.000000001Z',
    endTime: '2026-09-05T00:00:10.000000001Z',
    result: JSON.stringify(workflowResult()),
  }, WORKFLOW_REVISION);
  assert.equal(execution.duration_milliseconds, 10_000);
  assert.equal(execution.result.tokens.signatures_valid, true);
  assert.throws(() => validateSuccessfulAuthProbeExecution({
    name,
    state: 'FAILED',
    error: { context: 'RuntimeError: "User-relay probe failed at bounded stage token_verification"\nin step "require_cleanup"' },
  }, WORKFLOW_REVISION), /bounded stage token_verification/u);
});

test('drivers require exact plans, two-fixture cleanup and a separate retirement gate', () => {
  assert.match(planDriver, /-var=armed=true/);
  assert.match(planDriver, /-detailed-exitcode/);
  assert.match(planDriver, /observeCloudAssetApi\(\)/);
  assert.match(applyDriver, /validateAuthProbeApplyAuthorization/);
  assert.match(applyDriver, /arm-convergence/);
  assert.match(invokeDriver, /expectedExecutions: 0/);
  assert.match(invokeDriver, /requireSyntheticFixturesAbsent\(\{ cleanup: true \}\)/);
  assert.match(retirementDrivers, /-var=armed=false/);
  assert.match(retirementDrivers, /validateAuthProbeRetireAuthorization/);
  assert.match(retirementDrivers, /observeAuthProbeRetirement/);
  assert.match(checkSource, /user-relay-verifier\.test\.mjs/);
  assert.equal(WORKLOAD_FUNCTION_REVISION, 'control-plane-00004-yis');
});
