import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PROJECT_ID,
  buildPlanMetadata,
  assertSafeWorkloadEnvironment,
  validatePlanMetadata,
  workloadAuthorization,
} from '../workload/contract.mjs';
import { validateWorkloadRoot } from '../workload/guard.mjs';
import { observeDeployedWorkload } from '../workload/inventory.mjs';
import { validateWorkloadPlanAgainstPolicy } from '../workload/validate-plan.mjs';

const COMMIT = '1'.repeat(40);
const SOURCE_SHA256 = '2'.repeat(64);
const OPERATOR_EMAIL = 'operator@example.test';
const OPERATOR_SHA256 = createHash('sha256').update(OPERATOR_EMAIL).digest('hex');
const RUNTIME_CONFIG = readFileSync(new URL('../activation/runtime-config.json', import.meta.url), 'utf8');
const RUNTIME_ACCOUNT = `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`;
const BUILD_ACCOUNT = `miakapp-control-build@${PROJECT_ID}.iam.gserviceaccount.com`;
const PROBE_ACCOUNT = `miakapp-staging-probe@${PROJECT_ID}.iam.gserviceaccount.com`;
const FCM_ROLE = `projects/${PROJECT_ID}/roles/miakapp.controlPlaneFcmSender`;

const MANAGED_RESOURCES = Object.freeze({
  'google_artifact_registry_repository.function': 'google_artifact_registry_repository',
  'google_artifact_registry_repository_iam_member.build_writer': 'google_artifact_registry_repository_iam_member',
  'google_cloud_run_v2_service_iam_member.probe_invoker': 'google_cloud_run_v2_service_iam_member',
  'google_cloudfunctions2_function.control_plane': 'google_cloudfunctions2_function',
  'google_project_iam_custom_role.fcm_sender': 'google_project_iam_custom_role',
  'google_project_iam_member.build_logs': 'google_project_iam_member',
  'google_project_iam_member.runtime_fcm': 'google_project_iam_member',
  'google_service_account.build': 'google_service_account',
  'google_service_account.probe': 'google_service_account',
  'google_service_account_iam_member.probe_operator': 'google_service_account_iam_member',
  'google_storage_bucket.source': 'google_storage_bucket',
  'google_storage_bucket_iam_member.build_source_reader': 'google_storage_bucket_iam_member',
  'google_storage_bucket_object.source': 'google_storage_bucket_object',
  'terraform_data.deployment_guard': 'terraform_data',
});

const DATA_RESOURCES = Object.freeze({
  'data.google_service_account.runtime': 'google_service_account',
  'data.terraform_remote_state.bootstrap': 'terraform_remote_state',
  'data.terraform_remote_state.foundation': 'terraform_remote_state',
});

function plannedValue(address) {
  const common = { project: PROJECT_ID };
  switch (address) {
    case 'google_service_account.build':
      return { ...common, account_id: 'miakapp-control-build' };
    case 'google_service_account.probe':
      return { ...common, account_id: 'miakapp-staging-probe' };
    case 'google_storage_bucket.source':
      return {
        ...common,
        name: 'miakapp-v4-staging-function-source-1072737219170',
        location: 'europe-west9',
        storage_class: 'STANDARD',
        uniform_bucket_level_access: true,
        public_access_prevention: 'enforced',
        force_destroy: false,
      };
    case 'google_artifact_registry_repository.function':
      return {
        ...common,
        location: 'europe-west9',
        repository_id: 'miakapp-control-plane',
        format: 'DOCKER',
      };
    case 'google_storage_bucket_object.source':
      return {
        name: `sources/${SOURCE_SHA256}.zip`,
        content_type: 'application/zip',
        metadata: { sha256: SOURCE_SHA256, 'repository-commit': COMMIT },
      };
    case 'google_project_iam_custom_role.fcm_sender':
      return {
        ...common,
        role_id: 'miakapp.controlPlaneFcmSender',
        permissions: ['cloudmessaging.messages.create'],
        stage: 'GA',
      };
    case 'google_project_iam_member.build_logs':
      return { role: 'roles/logging.logWriter' };
    case 'google_storage_bucket_iam_member.build_source_reader':
      return { role: 'roles/storage.objectViewer' };
    case 'google_artifact_registry_repository_iam_member.build_writer':
      return { role: 'roles/artifactregistry.writer' };
    case 'google_service_account_iam_member.probe_operator':
      return {
        role: 'roles/iam.serviceAccountOpenIdTokenCreator',
        member: `user:${OPERATOR_EMAIL}`,
      };
    case 'google_cloud_run_v2_service_iam_member.probe_invoker':
      return {
        ...common,
        location: 'europe-west9',
        name: 'control-plane',
        role: 'roles/run.invoker',
      };
    case 'google_cloudfunctions2_function.control_plane':
      return {
        ...common,
        name: 'control-plane',
        location: 'europe-west9',
        build_config: [{ runtime: 'nodejs22', entry_point: 'controlPlane' }],
        service_config: [{
          available_memory: '256M',
          available_cpu: '1',
          timeout_seconds: 30,
          min_instance_count: 0,
          max_instance_count: 1,
          max_instance_request_concurrency: 16,
          ingress_settings: 'ALLOW_INTERNAL_ONLY',
          all_traffic_on_latest_revision: true,
          service_account_email: RUNTIME_ACCOUNT,
          environment_variables: {
            MIAKAPP_DEPLOYMENT_COMMIT: COMMIT,
            MIAKAPP_RUNTIME_CONFIG_JSON: RUNTIME_CONFIG,
            MIAKAPP_SOURCE_ARCHIVE_SHA256: SOURCE_SHA256,
          },
        }],
      };
    default:
      return {};
  }
}

function syntheticPlan() {
  const configurationResources = [
    ...Object.entries(DATA_RESOURCES).map(([address, type]) => ({
      address,
      mode: 'data',
      type,
      provider_config_key: type === 'google_service_account' ? 'google' : 'terraform',
    })),
    ...Object.entries(MANAGED_RESOURCES).map(([address, type]) => ({
      address,
      mode: 'managed',
      type,
      provider_config_key: type === 'terraform_data' ? 'terraform' : 'google',
    })),
  ];
  return {
    format_version: '1.2',
    terraform_version: '1.11.3',
    applyable: true,
    complete: true,
    errored: false,
    variables: {
      operator_user_email: { value: OPERATOR_EMAIL },
      repository_commit: { value: COMMIT },
      source_archive_path: { value: '/private/tmp/control-plane.zip' },
      source_archive_sha256: { value: SOURCE_SHA256 },
    },
    configuration: {
      provider_config: {
        google: {
          full_name: 'registry.terraform.io/hashicorp/google',
          version_constraint: '8.1.0',
        },
        'google-beta': {
          full_name: 'registry.terraform.io/hashicorp/google-beta',
          version_constraint: '8.1.0',
        },
        terraform: { full_name: 'terraform.io/builtin/terraform' },
      },
      root_module: { resources: configurationResources },
    },
    resource_changes: Object.entries(MANAGED_RESOURCES).map(([address, type]) => ({
      address,
      mode: 'managed',
      type,
      change: {
        actions: ['create'],
        before: null,
        after: plannedValue(address),
      },
    })),
  };
}

function validateSyntheticPlan(plan = syntheticPlan()) {
  return validateWorkloadPlanAgainstPolicy(plan, {
    repositoryCommit: COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
  }, {
    operatorUserSha256: OPERATOR_SHA256,
  });
}

test('accepts only the reviewed initial workload graph', () => {
  assert.deepEqual(validateSyntheticPlan(), {
    create: 14,
    update: 0,
    delete: 0,
    function: 1,
    minimum_instances: 0,
    maximum_instances: 1,
    ingress: 'internal-only',
    unauthenticated_invokers: 0,
    synthetic_invokers: 1,
    fcm_permissions: 1,
  });
});

test('rejects updates, public principals, foreign resources and wider ingress', () => {
  for (const mutate of [
    (plan) => { plan.resource_changes[0].change.actions = ['update']; },
    (plan) => { plan.resource_changes[0].change.after.member = 'allUsers'; },
    (plan) => { plan.configuration.root_module.resources.push({
      address: 'google_project_service.foreign',
      mode: 'managed',
      type: 'google_project_service',
      provider_config_key: 'google',
    }); },
    (plan) => {
      plannedResource(plan, 'google_cloudfunctions2_function.control_plane')
        .service_config[0].ingress_settings = 'ALLOW_ALL';
    },
  ]) {
    const plan = syntheticPlan();
    mutate(plan);
    assert.throws(() => validateSyntheticPlan(plan));
  }
});

function plannedResource(plan, address) {
  return plan.resource_changes.find((resource) => resource.address === address).change.after;
}

test('binds authorization and expiring metadata to exact private bytes', () => {
  const planBytes = Buffer.from('reviewed-plan');
  assert.equal(
    workloadAuthorization(planBytes, COMMIT),
    `apply-private-workload:${PROJECT_ID}:${createHash('sha256').update(planBytes).digest('hex')}:${COMMIT}`,
  );
  const createdAt = '2026-09-04T12:00:00.000Z';
  const metadata = buildPlanMetadata({
    repositoryCommit: COMMIT,
    createdAt,
    packageResult: {
      archive_sha256: SOURCE_SHA256,
      archive_bytes: 42,
      files: ['package.json', 'lib/production-entrypoint.js'],
    },
    planBytes,
    planJsonBytes: Buffer.from('{}'),
    summary: { create: 14 },
  });
  assert.equal(validatePlanMetadata(metadata, Date.parse(createdAt)), metadata);
  assert.throws(() => validatePlanMetadata(metadata, Date.parse(metadata.expires_at) + 1));
});

test('rejects ambient cloud overrides and accepts only the selected confirmation', () => {
  assert.doesNotThrow(() => assertSafeWorkloadEnvironment({
    HOME: '/tmp/home',
    PATH: '/usr/bin',
    MIAKAPP_STAGING_WORKLOAD_PLAN_CONFIRMATION: PROJECT_ID,
  }, 'MIAKAPP_STAGING_WORKLOAD_PLAN_CONFIRMATION'));
  assert.throws(() => assertSafeWorkloadEnvironment({
    HOME: '/tmp/home',
    PATH: '/usr/bin',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/foreign.json',
  }, 'MIAKAPP_STAGING_WORKLOAD_PLAN_CONFIRMATION'));
});

function inventoryResponses(extraLogWriter = []) {
  const functionName = `projects/${PROJECT_ID}/locations/europe-west9/functions/control-plane`;
  const sourceBucket = 'miakapp-v4-staging-function-source-1072737219170';
  const repository = `projects/${PROJECT_ID}/locations/europe-west9/repositories/miakapp-control-plane`;
  const service = `projects/${PROJECT_ID}/locations/europe-west9/services/control-plane`;
  return [
    {
      name: functionName,
      state: 'ACTIVE',
      environment: 'GEN_2',
      buildConfig: {
        runtime: 'nodejs22',
        entryPoint: 'controlPlane',
        dockerRepository: repository,
        serviceAccount: `projects/${PROJECT_ID}/serviceAccounts/${BUILD_ACCOUNT}`,
        source: { storageSource: { bucket: sourceBucket, object: `sources/${SOURCE_SHA256}.zip`, generation: '1' } },
      },
      serviceConfig: {
        serviceAccountEmail: RUNTIME_ACCOUNT,
        availableMemory: '256M',
        availableCpu: '1',
        timeoutSeconds: 30,
        minInstanceCount: 0,
        maxInstanceCount: 1,
        maxInstanceRequestConcurrency: 16,
        ingressSettings: 'ALLOW_INTERNAL_ONLY',
        allTrafficOnLatestRevision: true,
        uri: 'https://control-plane.invalid',
        service,
        revision: 'control-plane-00001-test',
        environmentVariables: {
          LOG_EXECUTION_ID: 'true',
          MIAKAPP_DEPLOYMENT_COMMIT: COMMIT,
          MIAKAPP_RUNTIME_CONFIG_JSON: RUNTIME_CONFIG,
          MIAKAPP_SOURCE_ARCHIVE_SHA256: SOURCE_SHA256,
        },
      },
    },
    { bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${PROBE_ACCOUNT}`] }] },
    {},
    { name: FCM_ROLE, stage: 'GA', includedPermissions: ['cloudmessaging.messages.create'], deleted: false },
    { email: BUILD_ACCOUNT, name: `projects/${PROJECT_ID}/serviceAccounts/${BUILD_ACCOUNT}`, disabled: false },
    { email: PROBE_ACCOUNT, name: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`, disabled: false },
    [],
    [],
    { bindings: [{ role: 'roles/iam.serviceAccountOpenIdTokenCreator', members: [`user:${OPERATOR_EMAIL}`] }] },
    {
      name: sourceBucket,
      location: 'EUROPE-WEST9',
      default_storage_class: 'STANDARD',
      uniform_bucket_level_access: true,
      public_access_prevention: 'enforced',
    },
    { bindings: [{ role: 'roles/storage.objectViewer', members: [`serviceAccount:${BUILD_ACCOUNT}`] }] },
    { name: repository, format: 'DOCKER' },
    { bindings: [{ role: 'roles/artifactregistry.writer', members: [`serviceAccount:${BUILD_ACCOUNT}`] }] },
    { bindings: [
      {
        role: 'roles/logging.logWriter',
        members: [
          `serviceAccount:${RUNTIME_ACCOUNT}`,
          `serviceAccount:${BUILD_ACCOUNT}`,
          ...extraLogWriter,
        ],
      },
      { role: FCM_ROLE, members: [`serviceAccount:${RUNTIME_ACCOUNT}`] },
    ] },
  ];
}

function inventorySpawn(responses) {
  return () => {
    const value = responses.shift();
    return {
      status: value === undefined ? 1 : 0,
      signal: null,
      stdout: value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value)),
      stderr: Buffer.alloc(0),
    };
  };
}

test('independently accepts the exact private live inventory without making a request', () => {
  const responses = inventoryResponses();
  const result = observeDeployedWorkload({
    repositoryRoot: '/tmp/repository',
    repositoryCommit: COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
    operatorUserSha256: OPERATOR_SHA256,
    spawn: inventorySpawn(responses),
  });
  assert.equal(result.function.ingress, 'ALLOW_INTERNAL_ONLY');
  assert.equal(result.function.minimum_instances, 0);
  assert.equal(result.live_request_performed, false);
  assert.equal(responses.length, 0);
});

test('rejects an unreviewed project log writer', () => {
  const responses = inventoryResponses(['serviceAccount:foreign@example.test']);
  assert.throws(() => observeDeployedWorkload({
    repositoryRoot: '/tmp/repository',
    repositoryCommit: COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
    operatorUserSha256: OPERATOR_SHA256,
    spawn: inventorySpawn(responses),
  }));
});

test('workload root guard accepts only the closed executable inventory', () => {
  assert.doesNotThrow(() => validateWorkloadRoot(new URL('../workload/', import.meta.url)));
});
