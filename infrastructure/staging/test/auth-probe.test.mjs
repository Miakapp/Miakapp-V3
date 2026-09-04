import assert from 'node:assert/strict';
import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import test from 'node:test';

import {
  CUSTOM_ROLE_NAME,
  CUSTOM_ROLE_PERMISSIONS,
  FIREBASE_APP_ID,
  FUNCTION_URI,
  PROJECT_ID,
  PROJECT_NUMBER,
  PROBE_ACCOUNT,
  REGION,
  TERRAFORM_VERSION,
  WORKFLOW_NAME,
  WORKFLOW_SOURCE,
  WORKFLOW_SOURCE_SHA256,
  WORKLOAD_COMMIT,
  WORKLOAD_FUNCTION_REVISION,
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
  validateAuthProbeWorkflowResult,
  validateSuccessfulAuthProbeExecution,
} from '../auth-probe/invoke.mjs';
import { validateAuthProbePlanAgainstPolicy } from '../auth-probe/validate-plan.mjs';
import {
  buildAuthProbeRetirementRecoveryInventory,
  inspectAuthProbeState,
  validateAuthProbeRetirementRecoveryInventory,
} from '../auth-probe/retirement-recovery.mjs';

const COMMIT = '1'.repeat(40);
const PLAN = Buffer.from('synthetic-auth-probe-plan');
const PLAN_JSON = Buffer.from('{"synthetic":true}\n');
const CREATED_AT = '2026-09-05T00:00:00.000Z';
const WORKFLOW_REVISION = '000001-abc';
const PREVIOUS_WORKFLOW_SOURCE_SHA256 = 'afafd6bbfa15d1b9fc238e84644075857e3d32520c88ba8c3b2f4094aa3d83ca';
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
const cliDriver = readFileSync(new URL('cli.mjs', probeRoot), 'utf8');
const checkSource = readFileSync(new URL('../check.sh', import.meta.url), 'utf8');

function workflowResult() {
  return {
    schema: 'miakapp.staging-auth-app-check-workflow-result/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_app_id: FIREBASE_APP_ID,
    route: {
      method: 'GET',
      path: '/v1/push-destinations',
      product_requests: 3,
      successful_reads: 2,
      expected_application_writes: 0,
      retries: 0,
    },
    cloud_run: { authentication_header: 'X-Serverless-Authorization' },
    firebase_auth: {
      token_source: 'execution-scoped-custom-token',
      missing_app_check_reached: true,
      synthetic_user_created: true,
      synthetic_user_deleted: true,
      synthetic_user_absence_verified: true,
    },
    app_check: {
      token_source: 'admin-custom-provider',
      token_consumption: false,
      first_use_accepted: true,
      replay_accepted: true,
    },
    responses: {
      missing_app_check: { status: 401, code: 'invalid_app_check_token' },
      first_authenticated_read: {
        status: 200,
        schema: 'miakapp.push-destination-list/1',
        destination_count: 0,
      },
      replay_authenticated_read: {
        status: 200,
        schema: 'miakapp.push-destination-list/1',
        destination_count: 0,
      },
    },
  };
}

function resourceValue(address) {
  switch (address) {
    case 'terraform_data.auth_probe_guard':
      return {
        input: {
          project_id: PROJECT_ID,
          project_number: PROJECT_NUMBER,
          region: REGION,
          function_name: 'control-plane',
          function_uri: FUNCTION_URI,
          probe_service_account: PROBE_ACCOUNT,
          source_sha256: WORKLOAD_SOURCE_SHA256,
          repository_commit: WORKLOAD_COMMIT,
          ingress: 'ALLOW_INTERNAL_ONLY',
          unauthenticated: false,
          minimum_instances: 0,
          maximum_instances: 1,
          firebase_auth: {
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
          },
          firebase_app_id: FIREBASE_APP_ID,
          workflow_source_sha256: WORKFLOW_SOURCE_SHA256,
        },
      };
    case 'google_project_iam_custom_role.auth_probe':
      return {
        project: PROJECT_ID,
        role_id: 'miakapp.stagingAuthProbe',
        title: 'Miakapp staging Auth probe',
        description: 'Dormant least-privilege role for the bounded staging Auth and App Check probe.',
        permissions: [...CUSTOM_ROLE_PERMISSIONS],
        stage: 'GA',
      };
    case 'google_project_iam_member.auth_probe[0]':
      return {
        project: PROJECT_ID,
        role: CUSTOM_ROLE_NAME,
        member: `serviceAccount:${PROBE_ACCOUNT}`,
      };
    case 'google_service_account_iam_member.auth_probe_self_signer[0]':
      return {
        service_account_id: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
        role: 'roles/iam.serviceAccountTokenCreator',
        member: `serviceAccount:${PROBE_ACCOUNT}`,
      };
    case 'google_workflows_workflow.auth_probe[0]':
      return {
        project: PROJECT_ID,
        region: REGION,
        name: WORKFLOW_NAME,
        description: 'One-shot private Firebase Auth and custom-provider App Check probe for Miakapp V4 staging.',
        service_account: PROBE_ACCOUNT,
        source_contents: WORKFLOW_SOURCE,
        call_log_level: 'LOG_NONE',
        execution_history_level: 'EXECUTION_HISTORY_BASIC',
        deletion_protection: false,
        labels: {
          environment: 'staging',
          'managed-by': 'terraform',
          product: 'miakapp-v4',
          purpose: 'auth-app-check-probe',
        },
      };
    default:
      throw new Error(`Unknown test resource ${address}`);
  }
}

function syntheticPlan(profile) {
  const phase = profile === 'arm' ? 'arm' : 'retire';
  const finalization = profile === 'retire-finalize';
  const configurationResources = {
    'google_project_iam_custom_role.auth_probe': 'google_project_iam_custom_role',
    'google_project_iam_member.auth_probe': 'google_project_iam_member',
    'google_service_account_iam_member.auth_probe_self_signer': 'google_service_account_iam_member',
    'google_workflows_workflow.auth_probe': 'google_workflows_workflow',
    'terraform_data.auth_probe_guard': 'terraform_data',
  };
  const changeResources = {
    'google_project_iam_custom_role.auth_probe': 'google_project_iam_custom_role',
    'google_project_iam_member.auth_probe[0]': 'google_project_iam_member',
    'google_service_account_iam_member.auth_probe_self_signer[0]': 'google_service_account_iam_member',
    'google_workflows_workflow.auth_probe[0]': 'google_workflows_workflow',
    'terraform_data.auth_probe_guard': 'terraform_data',
  };
  const temporary = (address) => address.endsWith('[0]');
  return {
    format_version: '1.2',
    terraform_version: TERRAFORM_VERSION,
    applyable: true,
    complete: profile !== 'retire',
    errored: false,
    variables: { armed: { value: phase === 'arm' ? 'true' : 'false' } },
    configuration: {
      provider_config: {
        google: {
          full_name: 'registry.terraform.io/hashicorp/google',
          version_constraint: '8.1.0',
        },
        terraform: { full_name: 'terraform.io/builtin/terraform' },
      },
      root_module: {
        resources: [
          {
            address: 'data.terraform_remote_state.firebase_auth',
            mode: 'data',
            type: 'terraform_remote_state',
            provider_config_key: 'terraform',
          },
          {
            address: 'data.terraform_remote_state.workload',
            mode: 'data',
            type: 'terraform_remote_state',
            provider_config_key: 'terraform',
          },
          ...Object.entries(configurationResources).map(([address, type]) => ({
            address,
            mode: 'managed',
            type,
            provider_config_key: type === 'terraform_data' ? 'terraform' : 'google',
            ...(address === 'google_service_account_iam_member.auth_probe_self_signer' ? {
              depends_on: [
                'google_project_iam_custom_role.auth_probe',
                'terraform_data.auth_probe_guard',
              ],
            } : {}),
          })),
        ],
      },
    },
    resource_changes: Object.entries(changeResources)
      .filter(([address]) => !finalization || !temporary(address))
      .map(([address, type]) => {
      const actions = phase === 'arm'
        ? ['create']
        : (temporary(address) ? ['delete'] : ['no-op']);
      const baseValue = resourceValue(address);
      const value = phase === 'retire' && address === 'google_workflows_workflow.auth_probe[0]'
        ? {
          ...baseValue,
          revision_id: WORKFLOW_REVISION,
          service_account: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
        }
        : baseValue;
      return {
        address,
        mode: 'managed',
        type,
        change: {
          actions,
          before: phase === 'arm' ? null : value,
          after: phase === 'arm' ? value : (temporary(address) ? null : value),
        },
      };
      }),
  };
}

function authProbeState(addresses) {
  const resource = (address) => {
    const counted = address.endsWith('[0]');
    const base = counted ? address.slice(0, -3) : address;
    const [type, name] = base.startsWith('data.')
      ? base.slice(5).split('.')
      : base.split('.');
    const attributes = {};
    if (address === 'google_project_iam_custom_role.auth_probe') {
      Object.assign(attributes, { name: CUSTOM_ROLE_NAME, project: PROJECT_ID });
    } else if (address === 'google_project_iam_member.auth_probe[0]') {
      Object.assign(attributes, {
        project: PROJECT_ID,
        role: CUSTOM_ROLE_NAME,
        member: `serviceAccount:${PROBE_ACCOUNT}`,
      });
    } else if (address === 'google_service_account_iam_member.auth_probe_self_signer[0]') {
      Object.assign(attributes, {
        service_account_id: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
        role: 'roles/iam.serviceAccountTokenCreator',
        member: `serviceAccount:${PROBE_ACCOUNT}`,
      });
    } else if (address === 'google_workflows_workflow.auth_probe[0]') {
      Object.assign(attributes, {
        project: PROJECT_ID,
        region: REGION,
        name: WORKFLOW_NAME,
      });
    }
    return {
      mode: base.startsWith('data.') ? 'data' : 'managed',
      type,
      name,
      instances: [{ ...(counted ? { index_key: 0 } : {}), attributes }],
    };
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
    schema: 'miakapp.staging-auth-probe-temporary-inventory/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    custom_role: {
      name: CUSTOM_ROLE_NAME,
      stage: 'GA',
      deleted: false,
      permissions: [...CUSTOM_ROLE_PERMISSIONS],
    },
    project_role_binding: true,
    self_signer_binding: true,
    workflow: {
      name: `projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}`,
      revision: WORKFLOW_REVISION,
      source_sha256: WORKFLOW_SOURCE_SHA256,
      executions: 0,
    },
  };
}

test('contains only the reviewed dormant and temporary Auth-probe graph', () => {
  assert.doesNotThrow(() => validateAuthProbeRoot(probeRoot));
  assert.match(terraformSource, /prefix = "terraform\/auth-probe"/);
  assert.match(terraformSource, /firebase_auth_prefix\s+= "terraform\/firebase-auth"/);
  assert.match(terraformSource, /staging_firebase_auth\.email_sign_in == false/);
  assert.match(terraformSource, /variable "armed"/);
  assert.match(terraformSource, /default\s+= false/);
  assert.match(terraformSource, /count = var\.armed \? 1 : 0/);
  assert.match(terraformSource, /call_log_level\s+= "LOG_NONE"/);
  assert.match(terraformSource, /execution_history_level\s+= "EXECUTION_HISTORY_BASIC"/);
  assert.match(terraformSource, /deletion_protection\s+= false/);
  assert.match(terraformSource, /prevent_destroy = true/);
  assert.match(
    terraformSource,
    /resource "google_service_account_iam_member" "auth_probe_self_signer"[\s\S]*depends_on = \[[\s\S]*google_project_iam_custom_role\.auth_probe/,
  );
  assert.equal((terraformSource.match(/resource\s+"/g) ?? []).length, 5);
  assert.doesNotMatch(terraformSource, /google_(cloudfunctions|cloud_run|compute|scheduler|service_account_key)/);
  assert.doesNotMatch(terraformSource, /allUsers|allAuthenticatedUsers|roles\/owner|roles\/editor|\bmiakapp-3\b/);
  assert.match(cliDriver, /validateFirebaseAuthConvergence/);
  assert.match(cliDriver, /-detailed-exitcode/);
  assert.match(cliDriver, /convergence\.status !== 0/);
  assert.match(cliDriver, /defaultSupportedIdpConfigs/);
  assert.match(cliDriver, /oauthIdpConfigs/);
  assert.match(cliDriver, /inboundSamlConfigs/);
  assert.match(cliDriver, /'X-Goog-User-Project': PROJECT_ID/);
  assert.match(invokeDriver, /'X-Goog-User-Project': PROJECT_ID/);
  assert.match(planDriver, /validateFirebaseAuthConvergence\(bundle, 'plan'\)/);
  assert.match(applyDriver, /validateFirebaseAuthConvergence\(bundle, 'apply'\)/);
  assert.match(invokeDriver, /validateFirebaseAuthConvergence\(bundle, 'invoke'\)/);
  assert.match(retirementDrivers, /buildAuthProbeRetirementRecoveryInventory/);
  assert.match(retirementRecoveryDrivers, /remove-iam-policy-binding/);
  assert.match(retirementRecoveryDrivers, /workflows', 'delete'/);
  assert.match(retirementRecoveryDrivers, /'state', 'rm', '-lock-timeout=5m', TEMPORARY_ADDRESS_BY_KIND\[kind\]/);
  assert.doesNotMatch(retirementRecoveryDrivers, /allUsers|allAuthenticatedUsers|force-unlock/);
});

test('binds orphan retirement recovery to exact live and state inventories', () => {
  const state = inspectAuthProbeState(authProbeState([
    'data.terraform_remote_state.firebase_auth',
    'data.terraform_remote_state.workload',
    'terraform_data.auth_probe_guard',
  ]));
  const inventory = buildAuthProbeRetirementRecoveryInventory(state, recoveryLiveInventory());
  assert.deepEqual(inventory.missing_temporaries, [
    'project_role_binding',
    'self_signer_binding',
    'workflow',
  ]);
  assert.equal(inventory.custom_role_state_action, 'import');
  const metadata = buildAuthProbeRetirementRecoveryMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    inventory,
  });
  const authorization = authProbeRetirementRecoveryAuthorization(metadata);
  assert.match(authorization, /^recover-auth-app-check-probe-retirement:miakapp-v4-staging:/);
  assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryMetadata(
    metadata,
    Date.parse(CREATED_AT) + 1,
  ));
  assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryAuthorization(
    authorization,
    metadata,
  ));
  assert.throws(() => validateAuthProbeRetirementRecoveryAuthorization(
    `${authorization}x`,
    metadata,
  ));
  assert.doesNotThrow(() => validateAuthProbeRetirementRecoveryInventory(inventory, metadata));
  const authorizationTampering = {
    repository_commit: '2'.repeat(40),
    inventory_sha256: '2'.repeat(64),
    state_sha256: '3'.repeat(64),
    state_lineage_sha256: '4'.repeat(64),
    state_serial: metadata.state_serial + 1,
    state_addresses: metadata.state_addresses.slice(1),
    missing_temporaries: metadata.missing_temporaries.slice(1),
    absent_remote_temporaries: ['workflow'],
    custom_role_state_action: 'untaint',
    workflow_revision: '000002-def',
  };
  for (const [field, value] of Object.entries(authorizationTampering)) {
    assert.throws(() => validateAuthProbeRetirementRecoveryAuthorization(
      authorization,
      { ...metadata, [field]: value },
    ), undefined, field);
  }
  for (const [field, value] of Object.entries(authorizationTampering)
    .filter(([name]) => name !== 'repository_commit')) {
    const tampered = { ...metadata, [field]: value };
    assert.throws(
      () => validateAuthProbeRetirementRecoveryInventory(inventory, tampered),
      undefined,
      field,
    );
  }

  const taintedValue = JSON.parse(authProbeState([
    'google_project_iam_custom_role.auth_probe',
  ]).toString('utf8'));
  taintedValue.resources[0].instances[0].status = 'tainted';
  const tainted = inspectAuthProbeState(Buffer.from(JSON.stringify(taintedValue)));
  assert.equal(tainted.custom_role_status, 'tainted');
  assert.equal(
    buildAuthProbeRetirementRecoveryInventory(tainted, recoveryLiveInventory())
      .custom_role_state_action,
    'untaint',
  );

  const tracked = inspectAuthProbeState(authProbeState([
    'google_project_iam_custom_role.auth_probe',
    'google_project_iam_member.auth_probe[0]',
    'google_service_account_iam_member.auth_probe_self_signer[0]',
    'google_workflows_workflow.auth_probe[0]',
  ]));
  const absentLive = {
    ...recoveryLiveInventory(),
    project_role_binding: false,
    self_signer_binding: false,
    workflow: null,
  };
  const inverse = buildAuthProbeRetirementRecoveryInventory(tracked, absentLive);
  assert.deepEqual(inverse.missing_temporaries, []);
  assert.deepEqual(inverse.absent_remote_temporaries, [
    'project_role_binding',
    'self_signer_binding',
    'workflow',
  ]);
  assert.equal(inverse.custom_role_state_action, null);
});

test('pins a no-secret one-shot Auth and App Check Workflow', () => {
  const stages = [
    'initialize',
    'web_config',
    'initial_user',
    'auth_custom_token',
    'auth_exchange',
    'auth_exchange_invalid_custom_token',
    'auth_exchange_credential_mismatch',
    'auth_exchange_bad_request',
    'auth_exchange_forbidden',
    'auth_exchange_http_error',
    'auth_exchange_validation',
    'app_check_custom_token',
    'app_check_exchange',
    'cloud_run_identity',
    'missing_app_check',
    'first_authenticated_read',
    'replay_authenticated_read',
    'success',
  ];
  assert.equal((WORKFLOW_SOURCE.match(/- probe_stage:/gu) ?? []).length, stages.length);
  assert.deepEqual(
    [...WORKFLOW_SOURCE.matchAll(/- probe_stage: ([a-z_]+)/gu)].map((match) => match[1]),
    stages,
  );
  assert.equal((WORKFLOW_SOURCE.match(/url: \$\{function_uri \+ destination_path\}/g) ?? []).length, 3);
  assert.equal((WORKFLOW_SOURCE.match(/X-Serverless-Authorization:/g) ?? []).length, 3);
  assert.equal((WORKFLOW_SOURCE.match(/X-Firebase-AppCheck:/g) ?? []).length, 2);
  assert.match(WORKFLOW_SOURCE, /accounts:signInWithCustomToken/);
  assert.match(WORKFLOW_SOURCE, /:exchangeCustomToken/);
  assert.match(WORKFLOW_SOURCE, /limitedUse: false/);
  assert.match(WORKFLOW_SOURCE, /accounts:delete/);
  assert.match(WORKFLOW_SOURCE, /synthetic_user_absence_verified: true/);
  assert.match(WORKFLOW_SOURCE, /raise: \$\{"Auth probe failed at bounded stage " \+ probe_stage\}/u);
  assert.doesNotMatch(WORKFLOW_SOURCE, /probe_error\.(?:body|code|message|tags)/u);
  assert.match(WORKFLOW_SOURCE, /- auth_exchange_error: null/u);
  assert.doesNotMatch(WORKFLOW_SOURCE, /raise:.*auth_exchange_error/u);
  assert.doesNotMatch(WORKFLOW_SOURCE, /^\s*retry:/mu);
  assert.doesNotMatch(WORKFLOW_SOURCE, /AIza[0-9A-Za-z_-]{30,}|debugToken|private[_ -]?key/iu);
  assert.doesNotMatch(WORKFLOW_SOURCE, /allUsers|allAuthenticatedUsers|\bmiakapp-3\b/);
});

test('validates exact arm and retirement plans and rejects privilege drift', () => {
  const armed = validateAuthProbePlanAgainstPolicy(syntheticPlan('arm'), 'arm');
  assert.equal(armed.create, 5);
  assert.equal(armed.delete, 0);
  assert.equal(armed.public_invokers, 0);
  const sourceTransition = syntheticPlan('arm');
  const customRoleChange = sourceTransition.resource_changes
    .find(({ address }) => address === 'google_project_iam_custom_role.auth_probe');
  customRoleChange.change.actions = ['no-op'];
  customRoleChange.change.before = structuredClone(customRoleChange.change.after);
  const guardChange = sourceTransition.resource_changes
    .find(({ address }) => address === 'terraform_data.auth_probe_guard');
  const currentInput = structuredClone(guardChange.change.after.input);
  const previousInput = {
    ...structuredClone(currentInput),
    workflow_source_sha256: PREVIOUS_WORKFLOW_SOURCE_SHA256,
  };
  guardChange.change = {
    actions: ['update'],
    before: {
      id: 'bd5471f4-d4d8-609b-5621-a84204953f4d',
      input: previousInput,
      output: structuredClone(previousInput),
      triggers_replace: null,
    },
    after: {
      id: 'bd5471f4-d4d8-609b-5621-a84204953f4d',
      input: currentInput,
      triggers_replace: null,
    },
    after_unknown: { input: { firebase_auth: {} }, output: true },
    before_sensitive: {
      input: { firebase_auth: {} },
      output: { firebase_auth: {} },
    },
    after_sensitive: { input: { firebase_auth: {} }, output: {} },
  };
  const transitioned = validateAuthProbePlanAgainstPolicy(sourceTransition, 'arm');
  assert.equal(transitioned.create, 3);
  assert.equal(transitioned.update, 1);
  const foreignTransition = structuredClone(sourceTransition);
  const foreignGuard = foreignTransition.resource_changes
    .find(({ address }) => address === 'terraform_data.auth_probe_guard');
  foreignGuard.change.before.input.workflow_source_sha256 = '0'.repeat(64);
  foreignGuard.change.before.output.workflow_source_sha256 = '0'.repeat(64);
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(foreignTransition, 'arm'),
    /workflow_source_sha256/u,
  );
  const retired = validateAuthProbePlanAgainstPolicy(syntheticPlan('retire'), 'retire');
  assert.equal(retired.create, 0);
  assert.equal(retired.delete, 3);
  assert.equal(retired.workflow_revision, WORKFLOW_REVISION);
  const finalized = validateAuthProbePlanAgainstPolicy(
    syntheticPlan('retire-finalize'),
    'retire-finalize',
  );
  assert.equal(finalized.create, 0);
  assert.equal(finalized.delete, 0);
  assert.equal(finalized.workflow_revision, 'absent');

  const partialRetirement = syntheticPlan('retire');
  partialRetirement.resource_changes = partialRetirement.resource_changes.filter(({ address }) => (
    address === 'google_service_account_iam_member.auth_probe_self_signer[0]'
  ));
  const partial = validateAuthProbePlanAgainstPolicy(partialRetirement, 'retire');
  assert.equal(partial.delete, 1);
  assert.equal(partial.workflow_revision, 'absent');

  const publicPlan = structuredClone(syntheticPlan('arm'));
  publicPlan.resource_changes
    .find(({ address }) => address === 'google_project_iam_member.auth_probe[0]')
    .change.after.member = 'allUsers';
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(publicPlan, 'arm'),
    /reviewed value|forbidden/u,
  );
  const changedFirebaseAuth = structuredClone(syntheticPlan('arm'));
  changedFirebaseAuth.resource_changes
    .find(({ address }) => address === 'terraform_data.auth_probe_guard')
    .change.after.input.firebase_auth.email_sign_in = true;
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(changedFirebaseAuth, 'arm'),
    /firebase_auth\.email_sign_in/u,
  );
  const projectIdConfigName = structuredClone(syntheticPlan('arm'));
  projectIdConfigName.resource_changes
    .find(({ address }) => address === 'terraform_data.auth_probe_guard')
    .change.after.input.firebase_auth.config_name = `projects/${PROJECT_ID}/config`;
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(projectIdConfigName, 'arm'),
    /firebase_auth\.config_name/u,
  );
  const armedAsRetirement = syntheticPlan('arm');
  armedAsRetirement.complete = false;
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(armedAsRetirement, 'retire'),
    /variables|phase/u,
  );
  const incompleteArm = syntheticPlan('arm');
  incompleteArm.complete = false;
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(incompleteArm, 'arm'),
    /metadata/u,
  );
  const completeRetirement = syntheticPlan('retire');
  completeRetirement.complete = true;
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(completeRetirement, 'retire'),
    /metadata/u,
  );
  const mutatingFinalization = syntheticPlan('retire');
  mutatingFinalization.complete = true;
  assert.throws(
    () => validateAuthProbePlanAgainstPolicy(mutatingFinalization, 'retire-finalize'),
    /outside the reviewed boundary/u,
  );
});

test('binds authorization values to exact plans, revisions and commits', () => {
  const apply = authProbeApplyAuthorization(PLAN, COMMIT);
  assert.doesNotThrow(() => validateAuthProbeApplyAuthorization(apply, PLAN, COMMIT));
  assert.throws(() => validateAuthProbeApplyAuthorization(`${apply}x`, PLAN, COMMIT));

  const invoke = authProbeInvokeAuthorization(WORKFLOW_REVISION, COMMIT);
  assert.doesNotThrow(() => validateAuthProbeInvokeAuthorization(
    invoke,
    WORKFLOW_REVISION,
    COMMIT,
  ));
  assert.throws(() => validateAuthProbeInvokeAuthorization(invoke, '000002-def', COMMIT));

  const retire = authProbeRetireAuthorization(PLAN, WORKFLOW_REVISION, COMMIT);
  assert.doesNotThrow(() => validateAuthProbeRetireAuthorization(
    retire,
    PLAN,
    WORKFLOW_REVISION,
    COMMIT,
  ));
  assert.throws(() => validateAuthProbeRetireAuthorization(
    retire,
    Buffer.from('changed'),
    WORKFLOW_REVISION,
    COMMIT,
  ));
});

test('builds closed short-lived metadata for both lifecycle phases', () => {
  const arm = buildAuthProbePlanMetadata({
    phase: 'arm',
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    planBytes: PLAN,
    planJsonBytes: PLAN_JSON,
    summary: { create: 5, delete: 0 },
  });
  assert.equal(arm.workflow_revision, null);
  assert.doesNotThrow(() => validateAuthProbePlanMetadata(
    arm,
    'arm',
    Date.parse(CREATED_AT) + 1,
  ));
  const retire = buildAuthProbePlanMetadata({
    phase: 'retire',
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    planBytes: PLAN,
    planJsonBytes: PLAN_JSON,
    summary: { create: 0, delete: 3 },
    workflowRevision: WORKFLOW_REVISION,
  });
  assert.equal(retire.workflow_revision, WORKFLOW_REVISION);
  assert.doesNotThrow(() => validateAuthProbePlanMetadata(
    retire,
    'retire',
    Date.parse(CREATED_AT) + 1,
  ));
  assert.throws(() => validateAuthProbePlanMetadata(
    { ...retire, private_bundle_committed: true },
    'retire',
    Date.parse(CREATED_AT) + 1,
  ));
});

test('accepts only the closed sanitized successful Workflow result', () => {
  const value = workflowResult();
  assert.doesNotThrow(() => validateAuthProbeWorkflowResult(value));
  assert.throws(() => validateAuthProbeWorkflowResult({ ...value, token: 'secret' }), /fields/u);
  assert.throws(() => validateAuthProbeWorkflowResult({
    ...value,
    app_check: { ...value.app_check, token_consumption: true },
  }), /App Check/u);
  assert.throws(() => validateAuthProbeWorkflowResult({
    ...value,
    responses: {
      ...value.responses,
      replay_authenticated_read: {
        ...value.responses.replay_authenticated_read,
        status: 401,
      },
    },
  }), /Replay/u);
});

test('validates the one successful execution without retaining its identifier', () => {
  const execution = validateSuccessfulAuthProbeExecution({
    name: `projects/${PROJECT_NUMBER}/locations/${REGION}/workflows/${WORKFLOW_NAME}/executions/00000000-0000-4000-8000-000000000000`,
    state: 'SUCCEEDED',
    workflowRevisionId: WORKFLOW_REVISION,
    startTime: '2026-09-05T00:00:00.000000001Z',
    endTime: '2026-09-05T00:00:10.000000001Z',
    result: JSON.stringify(workflowResult()),
  }, WORKFLOW_REVISION);
  assert.equal(execution.duration_milliseconds, 10_000);
  assert.equal(execution.result.responses.missing_app_check.status, 401);
  assert.throws(() => validateSuccessfulAuthProbeExecution({
    name: 'foreign',
    state: 'SUCCEEDED',
    workflowRevisionId: WORKFLOW_REVISION,
    startTime: '2026-09-05T00:00:00Z',
    endTime: '2026-09-05T00:00:01Z',
    result: JSON.stringify(workflowResult()),
  }, WORKFLOW_REVISION), /foreign/u);
  const executionName = `projects/${PROJECT_NUMBER}/locations/${REGION}/workflows/${WORKFLOW_NAME}/executions/00000000-0000-4000-8000-000000000000`;
  assert.throws(() => validateSuccessfulAuthProbeExecution({
    name: executionName,
    state: 'FAILED',
    error: {
      context: 'RuntimeError: "Auth probe failed at bounded stage auth_exchange_invalid_custom_token"\nin step "require_cleanup"',
    },
  }, WORKFLOW_REVISION), /bounded stage auth_exchange_invalid_custom_token/u);
  assert.throws(() => validateSuccessfulAuthProbeExecution({
    name: executionName,
    state: 'FAILED',
    error: {
      context: 'RuntimeError: "Auth probe failed at bounded stage bearer_token"\nin step "require_cleanup"',
    },
  }, WORKFLOW_REVISION), /state does not match/u);
});

test('drivers require exact plans and preserve the separate retirement gate', () => {
  assert.match(planDriver, /-var=armed=true/);
  assert.match(planDriver, /-detailed-exitcode/);
  assert.match(applyDriver, /validateAuthProbeApplyAuthorization/);
  assert.match(applyDriver, /arm-convergence/);
  assert.match(invokeDriver, /expectedExecutions: 0/);
  assert.match(invokeDriver, /requireSyntheticUserAbsent\(\{ cleanup: true \}\)/);
  assert.match(retirementDrivers, /-var=armed=false/);
  assert.match(retirementDrivers, /validateAuthProbeRetireAuthorization/);
  assert.match(retirementDrivers, /observeAuthProbeRetirement/);
  assert.match(checkSource, /auth-probe/);
  assert.equal(WORKLOAD_FUNCTION_REVISION, 'control-plane-00003-hum');
});
