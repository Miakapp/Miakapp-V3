import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PROJECT_ID,
  TARGET_RUNTIME_CONFIG_SHA256,
  buildPlanMetadata,
  buildWorkloadRuntimeMigrationPlanMetadata,
  buildWorkloadUpdatePlanMetadata,
  assertSafeWorkloadEnvironment,
  validatePlanMetadata,
  validateWorkloadRuntimeMigrationPlanMetadata,
  validateWorkloadUpdatePlanMetadata,
  workloadAuthorization,
  workloadRuntimeMigrationAuthorization,
  workloadUpdateAuthorization,
} from '../workload/contract.mjs';
import { validateWorkloadRoot } from '../workload/guard.mjs';
import { validateWorkloadEvidence } from '../workload/evidence.mjs';
import { observeDeployedWorkload } from '../workload/inventory.mjs';
import {
  PINNED_UPDATE_BASELINE,
  validateFailedBuildRecoveryPlanAgainstPolicy,
  validatePinnedRuntimeMigrationPlan,
  validatePinnedRuntimeMigrationPlanAgainstPolicy,
  validatePinnedSourceUpdatePlan,
  validatePinnedSourceUpdatePlanAgainstPolicy,
  validateWorkloadPlanAgainstPolicy,
} from '../workload/validate-plan.mjs';

const COMMIT = '1'.repeat(40);
const SOURCE_BYTES = Buffer.from('synthetic-function-source');
const SOURCE_SHA256 = createHash('sha256').update(SOURCE_BYTES).digest('hex');
const PREVIOUS_COMMIT = '2'.repeat(40);
const PREVIOUS_SOURCE_SHA256 = '3'.repeat(64);
const OPERATOR_EMAIL = 'operator@example.test';
const OPERATOR_SHA256 = createHash('sha256').update(OPERATOR_EMAIL).digest('hex');
const RUNTIME_CONFIG = readFileSync(new URL('../activation/runtime-config.json', import.meta.url), 'utf8');
const TARGET_RUNTIME_CONFIG = readFileSync(new URL('../workload/runtime-config.json', import.meta.url), 'utf8');
const RUNTIME_ACCOUNT = `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`;
const BUILD_ACCOUNT = `miakapp-control-build@${PROJECT_ID}.iam.gserviceaccount.com`;
const PROBE_ACCOUNT = `miakapp-staging-probe@${PROJECT_ID}.iam.gserviceaccount.com`;
const FCM_ROLE = `projects/${PROJECT_ID}/roles/miakapp.controlPlaneFcmSender`;
const GCF_SOURCE_BUCKET = 'gcf-v2-sources-1072737219170-europe-west9';
const SOURCE_BUCKET = 'miakapp-v4-staging-function-source-1072737219170';
const REPOSITORY = `projects/${PROJECT_ID}/locations/europe-west9/repositories/miakapp-control-plane`;

const MANAGED_RESOURCES = Object.freeze({
  'google_artifact_registry_repository.function': 'google_artifact_registry_repository',
  'google_artifact_registry_repository_iam_member.build_writer': 'google_artifact_registry_repository_iam_member',
  'google_cloud_run_v2_service_iam_member.probe_invoker': 'google_cloud_run_v2_service_iam_member',
  'google_cloudfunctions2_function.control_plane': 'google_cloudfunctions2_function',
  'google_project_iam_custom_role.fcm_sender': 'google_project_iam_custom_role',
  'google_project_iam_member.build_gcf_source_reader': 'google_project_iam_member',
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
        location: 'EUROPE-WEST9',
        storage_class: 'STANDARD',
        uniform_bucket_level_access: true,
        public_access_prevention: 'enforced',
        force_destroy: false,
        effective_labels: { product: 'miakapp-v4' },
        terraform_labels: { product: 'miakapp-v4' },
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
        bucket: SOURCE_BUCKET,
        name: `sources/${SOURCE_SHA256}.zip`,
        content_type: 'application/zip',
        metadata: { sha256: SOURCE_SHA256, 'repository-commit': COMMIT },
        source: '/private/tmp/control-plane.zip',
      };
    case 'google_project_iam_custom_role.fcm_sender':
      return {
        ...common,
        role_id: 'miakapp.controlPlaneFcmSender',
        permissions: ['cloudmessaging.messages.create'],
        stage: 'GA',
      };
    case 'google_project_iam_member.build_logs':
      return {
        ...common,
        role: 'roles/logging.logWriter',
        member: `serviceAccount:${BUILD_ACCOUNT}`,
      };
    case 'google_project_iam_member.build_gcf_source_reader':
      return {
        ...common,
        role: 'roles/storage.objectViewer',
        member: `serviceAccount:${BUILD_ACCOUNT}`,
        condition: [{
          title: 'miakapp-control-build-gcf-source',
          description: 'Read only the regional Cloud Functions source objects copied by Google.',
          expression: `resource.type == "storage.googleapis.com/Object" && resource.name.startsWith("projects/_/buckets/${GCF_SOURCE_BUCKET}/objects/")`,
        }],
      };
    case 'google_project_iam_member.runtime_fcm':
      return {
        ...common,
        role: FCM_ROLE,
        member: `serviceAccount:${RUNTIME_ACCOUNT}`,
      };
    case 'google_storage_bucket_iam_member.build_source_reader':
      return {
        bucket: SOURCE_BUCKET,
        role: 'roles/storage.objectViewer',
        member: `serviceAccount:${BUILD_ACCOUNT}`,
      };
    case 'google_artifact_registry_repository_iam_member.build_writer':
      return {
        ...common,
        location: 'europe-west9',
        repository: 'miakapp-control-plane',
        role: 'roles/artifactregistry.writer',
        member: `serviceAccount:${BUILD_ACCOUNT}`,
      };
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
        member: `serviceAccount:${PROBE_ACCOUNT}`,
      };
    case 'google_cloudfunctions2_function.control_plane':
      return {
        ...common,
        name: 'control-plane',
        location: 'europe-west9',
        build_config: [{
          runtime: 'nodejs22',
          entry_point: 'controlPlane',
          docker_repository: REPOSITORY,
          service_account: `projects/${PROJECT_ID}/serviceAccounts/${BUILD_ACCOUNT}`,
          environment_variables: {},
          worker_pool: '',
          source: [{
            storage_source: [{
              bucket: SOURCE_BUCKET,
              object: `sources/${SOURCE_SHA256}.zip`,
            }],
          }],
        }],
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
          vpc_connector: '',
          vpc_connector_egress_settings: '',
          direct_vpc_network_interface: [],
          secret_environment_variables: [],
          secret_volumes: [],
          binary_authorization_policy: '',
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

function syntheticRecoveryPlan() {
  const plan = syntheticPlan();
  for (const resource of plan.resource_changes) {
    resource.change.actions = ['no-op'];
    resource.change.before = structuredClone(resource.change.after);
  }
  const probeOperator = plan.resource_changes.find(
    ({ address }) => address === 'google_service_account_iam_member.probe_operator',
  );
  probeOperator.change.before.member = 'user:Operator@Example.test';
  probeOperator.change.after.member = 'user:Operator@Example.test';
  for (const address of [
    'google_cloud_run_v2_service_iam_member.probe_invoker',
    'google_project_iam_member.build_gcf_source_reader',
  ]) {
    const resource = plan.resource_changes.find((entry) => entry.address === address);
    resource.change.actions = ['create'];
    resource.change.before = null;
  }
  const functionResource = plan.resource_changes.find(
    ({ address }) => address === 'google_cloudfunctions2_function.control_plane',
  );
  functionResource.change.actions = ['update'];
  functionResource.change.before = {
    project: PROJECT_ID,
    name: 'control-plane',
    location: 'europe-west9',
    state: 'FAILED',
    environment: 'GEN_2',
    build_config: [{
      runtime: 'nodejs22',
      entry_point: 'controlPlane',
      docker_repository: `projects/${PROJECT_ID}/locations/europe-west9/repositories/miakapp-control-plane`,
      service_account: `projects/${PROJECT_ID}/serviceAccounts/${BUILD_ACCOUNT}`,
      source: [{
        storage_source: [{
          bucket: 'miakapp-v4-staging-function-source-1072737219170',
          object: `sources/${SOURCE_SHA256}.zip`,
          generation: '1',
        }],
      }],
    }],
    service_config: [],
  };
  return plan;
}

function validateSyntheticRecoveryPlan(plan = syntheticRecoveryPlan()) {
  return validateFailedBuildRecoveryPlanAgainstPolicy(plan, {
    repositoryCommit: COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
  }, {
    operatorUserSha256: OPERATOR_SHA256,
  });
}

function guardInput(repositoryCommit, sourceArchiveSha256, options = {}) {
  const sourceCommit = options.sourceRepositoryCommit ?? repositoryCommit;
  const runtimeConfig = options.runtimeConfig ?? RUNTIME_CONFIG;
  const input = {
    bootstrap: {
      apply_provider: 'projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply',
      bootstrap_prefix: 'terraform/bootstrap',
      component_bucket: 'miakapp-v4-staging-components',
      deployer_service_account: 'miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com',
      foundation_prefix: 'terraform/foundation',
      github_repository_id: '354682190',
      github_repository_owner_id: '83046838',
      plan_provider: 'projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan',
      planner_service_account: 'miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com',
      project_id: PROJECT_ID,
      project_number: '1072737219170',
      region: 'europe-west9',
      runtime_service_account: RUNTIME_ACCOUNT,
      schema: 'miakapp.staging-bootstrap/1',
      state_bucket: 'miakapp-v4-staging-tfstate-1072737219170',
    },
    foundation: {
      component_bucket: 'miakapp-v4-staging-components',
      firestore_database: '(default)',
      project_id: PROJECT_ID,
      project_number: '1072737219170',
      region: 'europe-west9',
      runtime_service_account: RUNTIME_ACCOUNT,
      secret_ids: [
        'miakapp-audit-hmac',
        'miakapp-component-hmac',
        'miakapp-home-key-pepper',
        'miakapp-network-hmac',
        'miakapp-push-hmac',
      ],
      signing_key: `projects/${PROJECT_ID}/locations/europe-west9/keyRings/${PROJECT_ID}/cryptoKeys/access-token-signing`,
    },
    runtime_config: createHash('sha256').update(runtimeConfig).digest('hex'),
    source_archive: sourceArchiveSha256,
    source_commit: sourceCommit,
  };
  if (options.legacy !== true) input.deployment_commit = repositoryCommit;
  return input;
}

function sourceObjectValue(repositoryCommit, sourceArchiveSha256, generation) {
  return {
    bucket: SOURCE_BUCKET,
    name: `sources/${sourceArchiveSha256}.zip`,
    content_type: 'application/zip',
    metadata: {
      'repository-commit': repositoryCommit,
      sha256: sourceArchiveSha256,
    },
    source: `/private/tmp/${sourceArchiveSha256}/control-plane.zip`,
    deletion_policy: 'DELETE',
    storage_class: 'STANDARD',
    event_based_hold: false,
    temporary_hold: false,
    ...(generation === undefined ? {} : { generation }),
  };
}

function functionValue(
  repositoryCommit,
  sourceArchiveSha256,
  generation,
  runtimeConfig = RUNTIME_CONFIG,
) {
  const value = structuredClone(plannedValue('google_cloudfunctions2_function.control_plane'));
  value.build_config[0].source[0].storage_source[0].object = `sources/${sourceArchiveSha256}.zip`;
  if (generation !== undefined) {
    value.build_config[0].source[0].storage_source[0].generation = generation;
  }
  value.service_config[0].environment_variables = {
    LOG_EXECUTION_ID: 'true',
    MIAKAPP_DEPLOYMENT_COMMIT: repositoryCommit,
    MIAKAPP_RUNTIME_CONFIG_JSON: runtimeConfig,
    MIAKAPP_SOURCE_ARCHIVE_SHA256: sourceArchiveSha256,
  };
  return value;
}

function syntheticPinnedSourceUpdatePlan() {
  const plan = syntheticPlan();
  for (const resource of plan.resource_changes) {
    resource.change.actions = ['no-op'];
    resource.change.before = structuredClone(resource.change.after);
  }

  const source = plan.resource_changes.find(
    ({ address }) => address === 'google_storage_bucket_object.source',
  );
  source.change = {
    actions: ['delete', 'create'],
    before: sourceObjectValue(PREVIOUS_COMMIT, PREVIOUS_SOURCE_SHA256, 123),
    after: sourceObjectValue(COMMIT, SOURCE_SHA256),
    replace_paths: [['source'], ['name'], ['metadata']],
  };

  const functionResource = plan.resource_changes.find(
    ({ address }) => address === 'google_cloudfunctions2_function.control_plane',
  );
  functionResource.change = {
    actions: ['update'],
    before: {
      ...functionValue(PREVIOUS_COMMIT, PREVIOUS_SOURCE_SHA256, 123),
      state: 'ACTIVE',
      environment: 'GEN_2',
    },
    after: {
      ...functionValue(COMMIT, SOURCE_SHA256),
      state: 'ACTIVE',
      environment: 'GEN_2',
    },
  };

  const deploymentGuard = plan.resource_changes.find(
    ({ address }) => address === 'terraform_data.deployment_guard',
  );
  const previousGuardInput = guardInput(PREVIOUS_COMMIT, PREVIOUS_SOURCE_SHA256);
  deploymentGuard.change = {
    actions: ['update'],
    before: {
      id: 'stable-guard-id',
      input: previousGuardInput,
      output: structuredClone(previousGuardInput),
      triggers_replace: null,
    },
    after: {
      id: 'stable-guard-id',
      input: guardInput(COMMIT, SOURCE_SHA256),
      triggers_replace: null,
    },
  };
  return plan;
}

function validateSyntheticPinnedSourceUpdatePlan(plan = syntheticPinnedSourceUpdatePlan()) {
  return validatePinnedSourceUpdatePlanAgainstPolicy(plan, {
    repositoryCommit: COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
  }, {
    operatorUserSha256: OPERATOR_SHA256,
    previous: {
      repositoryCommit: PREVIOUS_COMMIT,
      sourceArchiveSha256: PREVIOUS_SOURCE_SHA256,
    },
  });
}

function syntheticPinnedRuntimeMigrationPlan() {
  const plan = syntheticPlan();
  for (const resource of plan.resource_changes) {
    resource.change.actions = ['no-op'];
    resource.change.before = structuredClone(resource.change.after);
  }

  const source = plan.resource_changes.find(
    ({ address }) => address === 'google_storage_bucket_object.source',
  );
  source.change = {
    actions: ['no-op'],
    before: sourceObjectValue(PREVIOUS_COMMIT, SOURCE_SHA256, 123),
    after: sourceObjectValue(PREVIOUS_COMMIT, SOURCE_SHA256, 123),
  };

  const functionResource = plan.resource_changes.find(
    ({ address }) => address === 'google_cloudfunctions2_function.control_plane',
  );
  const beforeFunction = {
    ...functionValue(PREVIOUS_COMMIT, SOURCE_SHA256, 123, RUNTIME_CONFIG),
    state: 'ACTIVE',
    environment: 'GEN_2',
  };
  functionResource.change = {
    actions: ['update'],
    before: beforeFunction,
    after: {
      ...functionValue(COMMIT, SOURCE_SHA256, 123, TARGET_RUNTIME_CONFIG),
      state: 'ACTIVE',
      environment: 'GEN_2',
    },
  };

  const deploymentGuard = plan.resource_changes.find(
    ({ address }) => address === 'terraform_data.deployment_guard',
  );
  const previousGuardInput = guardInput(PREVIOUS_COMMIT, SOURCE_SHA256, {
    sourceRepositoryCommit: PREVIOUS_COMMIT,
    runtimeConfig: RUNTIME_CONFIG,
    legacy: true,
  });
  deploymentGuard.change = {
    actions: ['update'],
    before: {
      id: 'stable-guard-id',
      input: previousGuardInput,
      output: structuredClone(previousGuardInput),
      triggers_replace: null,
    },
    after: {
      id: 'stable-guard-id',
      input: guardInput(COMMIT, SOURCE_SHA256, {
        sourceRepositoryCommit: PREVIOUS_COMMIT,
        runtimeConfig: TARGET_RUNTIME_CONFIG,
      }),
      triggers_replace: null,
    },
  };
  return plan;
}

function validateSyntheticPinnedRuntimeMigrationPlan(
  plan = syntheticPinnedRuntimeMigrationPlan(),
) {
  return validatePinnedRuntimeMigrationPlanAgainstPolicy(plan, {
    repositoryCommit: COMMIT,
    sourceRepositoryCommit: PREVIOUS_COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
    runtimeConfigSha256: TARGET_RUNTIME_CONFIG_SHA256,
  }, {
    operatorUserSha256: OPERATOR_SHA256,
    previous: {
      repositoryCommit: PREVIOUS_COMMIT,
      sourceRepositoryCommit: PREVIOUS_COMMIT,
      sourceArchiveSha256: SOURCE_SHA256,
      runtimeConfigSha256: createHash('sha256').update(RUNTIME_CONFIG).digest('hex'),
      legacyGuard: true,
    },
  });
}

test('accepts only the reviewed initial workload graph', () => {
  assert.deepEqual(validateSyntheticPlan(), {
    create: 15,
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

test('accepts only the bounded in-place recovery from the failed first build', () => {
  assert.deepEqual(validateSyntheticRecoveryPlan(), {
    create: 2,
    update: 1,
    delete: 0,
    recovery: 'failed-build-in-place',
    function: 1,
    minimum_instances: 0,
    maximum_instances: 1,
    ingress: 'internal-only',
    unauthenticated_invokers: 0,
    synthetic_invokers: 1,
    fcm_permissions: 1,
  });
  for (const mutate of [
    (plan) => {
      plannedChange(plan, 'google_cloudfunctions2_function.control_plane').actions = ['delete', 'create'];
    },
    (plan) => {
      plannedChange(plan, 'google_cloudfunctions2_function.control_plane').before.state = 'ACTIVE';
    },
    (plan) => {
      plannedChange(plan, 'google_project_iam_member.build_gcf_source_reader')
        .after.member = 'allUsers';
    },
  ]) {
    const plan = syntheticRecoveryPlan();
    mutate(plan);
    assert.throws(() => validateSyntheticRecoveryPlan(plan));
  }
});

test('accepts only the next update from the pinned active source', () => {
  assert.deepEqual(PINNED_UPDATE_BASELINE, {
    repositoryCommit: '9f217da102b394734adba7ccef3f8f70d0317306',
    sourceRepositoryCommit: '9f217da102b394734adba7ccef3f8f70d0317306',
    sourceArchiveSha256: 'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8',
    runtimeConfigSha256: 'b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8',
    legacyGuard: true,
  });
  assert.deepEqual(validateSyntheticPinnedSourceUpdatePlan(), {
    create: 1,
    update: 2,
    delete: 1,
    replacement: 'deterministic-source-object',
    function: 1,
    minimum_instances: 0,
    maximum_instances: 1,
    ingress: 'internal-only',
    unauthenticated_invokers: 0,
    synthetic_invokers: 1,
    fcm_permissions: 1,
  });
  for (const mutate of [
    (plan) => { plannedChange(plan, 'google_cloudfunctions2_function.control_plane').actions = ['delete', 'create']; },
    (plan) => { plannedChange(plan, 'google_cloudfunctions2_function.control_plane').before.state = 'FAILED'; },
    (plan) => { plannedResource(plan, 'google_cloudfunctions2_function.control_plane').service_config[0].ingress_settings = 'ALLOW_ALL'; },
    (plan) => { plannedChange(plan, 'google_storage_bucket_object.source').replace_paths.push(['bucket']); },
    (plan) => { plannedChange(plan, 'google_storage_bucket_object.source').before.metadata.sha256 = '4'.repeat(64); },
    (plan) => { plannedChange(plan, 'google_project_iam_member.runtime_fcm').actions = ['update']; },
    (plan) => { plannedChange(plan, 'terraform_data.deployment_guard').after.input.foundation.project_id = 'foreign-project'; },
  ]) {
    const plan = syntheticPinnedSourceUpdatePlan();
    mutate(plan);
    assert.throws(() => validateSyntheticPinnedSourceUpdatePlan(plan));
  }

  assert.throws(() => validatePinnedSourceUpdatePlan(syntheticPinnedSourceUpdatePlan(), {
    repositoryCommit: COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
  }, OPERATOR_SHA256), /baseline/);
});

test('accepts only the pinned single-key schema-2 runtime migration', () => {
  assert.deepEqual(validateSyntheticPinnedRuntimeMigrationPlan(), {
    create: 0,
    update: 2,
    delete: 0,
    migration: 'single-key-schema-1-to-schema-2',
    function: 1,
    source_replaced: false,
    signing_key_versions: 1,
    minimum_instances: 0,
    maximum_instances: 1,
    ingress: 'internal-only',
    unauthenticated_invokers: 0,
    synthetic_invokers: 1,
    fcm_permissions: 1,
  });
  for (const mutate of [
    (plan) => { plannedChange(plan, 'google_cloudfunctions2_function.control_plane').actions = ['delete', 'create']; },
    (plan) => { plannedChange(plan, 'google_cloudfunctions2_function.control_plane').after.build_config[0].source[0].storage_source[0].generation = 124; },
    (plan) => { plannedChange(plan, 'google_cloudfunctions2_function.control_plane').after.service_config[0].ingress_settings = 'ALLOW_ALL'; },
    (plan) => { plannedChange(plan, 'google_cloudfunctions2_function.control_plane').after.service_config[0].environment_variables.MIAKAPP_RUNTIME_CONFIG_JSON = RUNTIME_CONFIG; },
    (plan) => { plannedChange(plan, 'google_storage_bucket_object.source').actions = ['delete', 'create']; },
    (plan) => { plannedChange(plan, 'terraform_data.deployment_guard').after.input.source_commit = COMMIT; },
    (plan) => { plannedChange(plan, 'google_project_iam_member.runtime_fcm').actions = ['update']; },
  ]) {
    const plan = syntheticPinnedRuntimeMigrationPlan();
    mutate(plan);
    assert.throws(() => validateSyntheticPinnedRuntimeMigrationPlan(plan));
  }
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

test('allows the reviewed product label but rejects production project references elsewhere', () => {
  assert.doesNotThrow(() => validateSyntheticPlan());
  for (const forbidden of [
    'miakapp-v4',
    'projects/miakapp-v4/locations/europe-west9',
    'service-account@miakapp-v4.iam.gserviceaccount.com',
    'projects/miakapp-3/locations/europe-west9',
    'projects/demo-miakapp-v4/locations/europe-west9',
  ]) {
    const plan = syntheticPlan();
    plannedResource(plan, 'google_storage_bucket.source').unreviewed_reference = forbidden;
    assert.throws(() => validateSyntheticPlan(plan), /forbidden principal or project/);
  }
});

function plannedResource(plan, address) {
  return plan.resource_changes.find((resource) => resource.address === address).change.after;
}

function plannedChange(plan, address) {
  return plan.resource_changes.find((resource) => resource.address === address).change;
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
    summary: { create: 15 },
  });
  assert.equal(validatePlanMetadata(metadata, Date.parse(createdAt)), metadata);
  assert.throws(() => validatePlanMetadata(metadata, Date.parse(metadata.expires_at) + 1));

  assert.equal(
    workloadUpdateAuthorization(planBytes, COMMIT),
    `update-private-workload:${PROJECT_ID}:${createHash('sha256').update(planBytes).digest('hex')}:${COMMIT}`,
  );
  const updateMetadata = buildWorkloadUpdatePlanMetadata({
    repositoryCommit: COMMIT,
    createdAt,
    packageResult: {
      archive_sha256: SOURCE_SHA256,
      archive_bytes: 42,
      files: ['package.json', 'lib/production-entrypoint.js'],
    },
    planBytes,
    planJsonBytes: Buffer.from('{}'),
    summary: { create: 1, update: 2, delete: 1 },
  });
  assert.equal(
    validateWorkloadUpdatePlanMetadata(updateMetadata, Date.parse(createdAt)),
    updateMetadata,
  );
  assert.throws(() => validatePlanMetadata(updateMetadata, Date.parse(createdAt)));

  assert.equal(
    workloadRuntimeMigrationAuthorization(planBytes, COMMIT),
    `migrate-private-runtime:${PROJECT_ID}:${createHash('sha256').update(planBytes).digest('hex')}:${COMMIT}`,
  );
  const runtimeMetadata = buildWorkloadRuntimeMigrationPlanMetadata({
    repositoryCommit: COMMIT,
    sourceRepositoryCommit: PREVIOUS_COMMIT,
    createdAt,
    packageResult: {
      archive_sha256: SOURCE_SHA256,
      archive_bytes: 42,
      files: ['package.json', 'lib/production-entrypoint.js'],
    },
    planBytes,
    planJsonBytes: Buffer.from('{}'),
    summary: { create: 0, update: 2, delete: 0 },
  });
  assert.equal(runtimeMetadata.source_repository_commit, PREVIOUS_COMMIT);
  assert.equal(runtimeMetadata.runtime_config_sha256, TARGET_RUNTIME_CONFIG_SHA256);
  assert.equal(
    validateWorkloadRuntimeMigrationPlanMetadata(runtimeMetadata, Date.parse(createdAt)),
    runtimeMetadata,
  );
  assert.throws(() => validateWorkloadUpdatePlanMetadata(
    runtimeMetadata,
    Date.parse(createdAt),
  ));
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
        source: {
          storageSource: {
            bucket: GCF_SOURCE_BUCKET,
            object: 'control-plane/function-source.zip',
            generation: '1',
          },
        },
        sourceProvenance: {
          resolvedStorageSource: {
            bucket: GCF_SOURCE_BUCKET,
            object: 'control-plane/function-source.zip',
            generation: '1',
          },
        },
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
    { email: RUNTIME_ACCOUNT, name: `projects/${PROJECT_ID}/serviceAccounts/${RUNTIME_ACCOUNT}`, disabled: false },
    { email: PROBE_ACCOUNT, name: `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`, disabled: false },
    [],
    [],
    [],
    { bindings: [{ role: 'roles/iam.serviceAccountOpenIdTokenCreator', members: ['user:Operator@Example.test'] }] },
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
      {
        role: 'roles/storage.objectViewer',
        members: [`serviceAccount:${BUILD_ACCOUNT}`],
        condition: {
          title: 'miakapp-control-build-gcf-source',
          description: 'Read only the regional Cloud Functions source objects copied by Google.',
          expression: `resource.type == "storage.googleapis.com/Object" && resource.name.startsWith("projects/_/buckets/${GCF_SOURCE_BUCKET}/objects/")`,
        },
      },
    ] },
    SOURCE_BYTES,
  ];
}

function inventorySpawn(responses) {
  return () => {
    const value = responses.shift();
    return {
      status: value === undefined ? 1 : 0,
      signal: null,
      stdout: value === undefined
        ? Buffer.alloc(0)
        : (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))),
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

test('independently validates the target runtime document during migration inventory', () => {
  const responses = inventoryResponses();
  responses[0].serviceConfig.environmentVariables.MIAKAPP_RUNTIME_CONFIG_JSON =
    TARGET_RUNTIME_CONFIG;
  const result = observeDeployedWorkload({
    repositoryRoot: '/tmp/repository',
    repositoryCommit: COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
    runtimeConfigSha256: TARGET_RUNTIME_CONFIG_SHA256,
    operatorUserSha256: OPERATOR_SHA256,
    spawn: inventorySpawn(responses),
  });
  assert.equal(result.runtime_config_sha256, TARGET_RUNTIME_CONFIG_SHA256);
  assert.equal(result.live_request_performed, false);
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

test('rejects copied Function source bytes that differ from the deterministic package', () => {
  const responses = inventoryResponses();
  responses[responses.length - 1] = Buffer.from('foreign-function-source');
  assert.throws(() => observeDeployedWorkload({
    repositoryRoot: '/tmp/repository',
    repositoryCommit: COMMIT,
    sourceArchiveSha256: SOURCE_SHA256,
    operatorUserSha256: OPERATOR_SHA256,
    spawn: inventorySpawn(responses),
  }), /copied source bytes/);
});

test('workload root guard accepts only the closed executable inventory', () => {
  assert.doesNotThrow(() => validateWorkloadRoot(new URL('../workload/', import.meta.url)));
});

test('keeps the pinned source updater on a saved Terraform plan without live requests', () => {
  const planSource = readFileSync(new URL('../workload/update-plan.mjs', import.meta.url), 'utf8');
  const applySource = readFileSync(new URL('../workload/update-apply.mjs', import.meta.url), 'utf8');
  const runtimePlanSource = readFileSync(new URL('../workload/runtime-plan.sh', import.meta.url), 'utf8');
  const runtimeApplySource = readFileSync(new URL('../workload/runtime-apply.sh', import.meta.url), 'utf8');
  const localsSource = readFileSync(new URL('../workload/locals.tf', import.meta.url), 'utf8');
  const workloadSource = readFileSync(new URL('../workload/workload.tf', import.meta.url), 'utf8');
  assert.match(planSource, /readAndValidatePinnedSourceUpdatePlan/);
  assert.match(planSource, /buildWorkloadUpdatePlanMetadata/);
  assert.match(applySource, /readAndValidatePinnedSourceUpdatePlan/);
  assert.match(applySource, /validateWorkloadUpdateAuthorization/);
  assert.match(applySource, /'apply', '-input=false', '-auto-approve', '-no-color', planPath/);
  assert.match(applySource, /observeDeployedWorkload/);
  assert.match(planSource, /readAndValidatePinnedRuntimeMigrationPlan/);
  assert.match(applySource, /validateWorkloadRuntimeMigrationAuthorization/);
  assert.match(runtimePlanSource, /--runtime-migration/);
  assert.match(runtimeApplySource, /--runtime-migration/);
  assert.match(planSource, /guarded runtime migration must converge/);
  assert.match(
    localsSource,
    /source_repository_commit\s+= "9f217da102b394734adba7ccef3f8f70d0317306"/,
  );
  assert.match(
    localsSource,
    /runtime_config_sha256\s+= "20be750358ffbc2136bab26bca6338b430ea6480ae9874f3fe5e7132c5e0db10"/,
  );
  assert.match(workloadSource, /repository-commit = local\.source_repository_commit/);
  assert.match(
    workloadSource,
    /ignore_changes = \[\s*detect_md5hash,\s*source,\s*\]/,
  );
  assert.doesNotMatch(
    `${planSource}\n${applySource}\n${runtimePlanSource}\n${runtimeApplySource}`,
    /\b(?:curl|destroy)\b|functions deploy|run deploy|executions run/u,
  );
});

test('pins the exact non-secret live workload result', () => {
  const result = validateWorkloadEvidence(
    new URL('../workload/result.json', import.meta.url),
  );
  assert.equal(result.function.state, 'ACTIVE');
  assert.equal(result.repository_commit, '9f217da102b394734adba7ccef3f8f70d0317306');
  assert.equal(
    result.source_archive_sha256,
    'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8',
  );
  assert.equal(result.function.revision, 'control-plane-00005-biq');
  assert.equal(result.function.ingress, 'ALLOW_INTERNAL_ONLY');
  assert.equal(result.function.unauthenticated_invokers, 0);
  assert.equal(result.function.minimum_instances, 0);
  assert.equal(result.function.maximum_instances, 1);
  assert.deepEqual(result.identities.user_managed_keys, {
    runtime: 0,
    build: 0,
    probe: 0,
  });
  assert.equal(result.live_request_performed, false);
});
