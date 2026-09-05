import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  OPERATOR_USER_SHA256,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  RUNTIME_CONFIG_SHA256,
  TARGET_RUNTIME_CONFIG_SHA256,
  TERRAFORM_VERSION,
} from './contract.mjs';

const GOOGLE_PROVIDER = 'registry.terraform.io/hashicorp/google';
const TERRAFORM_PROVIDER = 'terraform.io/builtin/terraform';
const MAXIMUM_PLAN_BYTES = 32 * 1024 * 1024;
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
const BUILD_ACCOUNT = `miakapp-control-build@${PROJECT_ID}.iam.gserviceaccount.com`;
const RUNTIME_ACCOUNT = `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`;
const PROBE_ACCOUNT = `miakapp-staging-probe@${PROJECT_ID}.iam.gserviceaccount.com`;
const SOURCE_BUCKET = `${PROJECT_ID}-function-source-${PROJECT_NUMBER}`;
const GCF_SOURCE_BUCKET = `gcf-v2-sources-${PROJECT_NUMBER}-${REGION}`;
const GCF_SOURCE_CONDITION = Object.freeze({
  title: 'miakapp-control-build-gcf-source',
  description: 'Read only the regional Cloud Functions source objects copied by Google.',
  expression: `resource.type == "storage.googleapis.com/Object" && resource.name.startsWith("projects/_/buckets/${GCF_SOURCE_BUCKET}/objects/")`,
});
const REPOSITORY = `projects/${PROJECT_ID}/locations/${REGION}/repositories/miakapp-control-plane`;
const BUILD_ACCOUNT_RESOURCE = `projects/${PROJECT_ID}/serviceAccounts/${BUILD_ACCOUNT}`;
export const PINNED_UPDATE_BASELINE = Object.freeze({
  repositoryCommit: '2bdd1a9e224234318d2ffd77c61b609331ccd044',
  sourceRepositoryCommit: '9f217da102b394734adba7ccef3f8f70d0317306',
  sourceArchiveSha256: 'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8',
  runtimeConfigSha256: RUNTIME_CONFIG_SHA256,
});
const RECOVERY_ACTIONS = Object.freeze({
  ...Object.fromEntries(Object.keys(MANAGED_RESOURCES).map((address) => [address, ['no-op']])),
  'google_cloud_run_v2_service_iam_member.probe_invoker': ['create'],
  'google_cloudfunctions2_function.control_plane': ['update'],
  'google_project_iam_member.build_gcf_source_reader': ['create'],
});
const PINNED_UPDATE_ACTIONS = Object.freeze({
  ...Object.fromEntries(Object.keys(MANAGED_RESOURCES).map((address) => [address, ['no-op']])),
  'google_cloudfunctions2_function.control_plane': ['update'],
  'google_storage_bucket_object.source': ['delete', 'create'],
  'terraform_data.deployment_guard': ['update'],
});
const SIGNING_ACTIVATION_ACTIONS = Object.freeze({
  ...Object.fromEntries(Object.keys(MANAGED_RESOURCES).map((address) => [address, ['no-op']])),
  'google_cloudfunctions2_function.control_plane': ['update'],
  'terraform_data.deployment_guard': ['update'],
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

function sourceRepositoryCommit(input) {
  return input.sourceRepositoryCommit ?? input.repositoryCommit;
}

function runtimeConfigSha256(input) {
  return input.runtimeConfigSha256 ?? RUNTIME_CONFIG_SHA256;
}

function isReviewedProductLabel(path, value) {
  if (value !== 'miakapp-v4' || path.at(-1) !== 'product') return false;
  return ['labels', 'effective_labels', 'terraform_labels'].includes(path.at(-2));
}

function referencesForbiddenProject(value, projectId) {
  return value === projectId
    || value.includes(`projects/${projectId}/`)
    || value.includes(`@${projectId}.`)
    || value.startsWith(`${projectId}.`);
}

function rejectForbiddenIdentities(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbiddenIdentities(entry, [...path, index]));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      rejectForbiddenIdentities(entry, [...path, key]);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (value === 'allUsers' || value === 'allAuthenticatedUsers'
    || referencesForbiddenProject(value, 'miakapp-3')
    || referencesForbiddenProject(value, 'demo-miakapp-v4')
    || (referencesForbiddenProject(value, 'miakapp-v4')
      && !isReviewedProductLabel(path, value))) {
    reject('Terraform workload plan contains a forbidden principal or project');
  }
}

function resourceConfiguration(plan) {
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
    const type = expected[resource.address];
    if (resource.type !== type) reject('Terraform configuration contains an unreviewed resource');
    const data = resource.address.startsWith('data.');
    exact(resource.mode, data ? 'data' : 'managed', `${resource.address}.mode`);
    const provider = type === 'terraform_data' || type === 'terraform_remote_state'
      ? 'terraform'
      : 'google';
    exact(resource.provider_config_key, provider, `${resource.address}.provider`);
  }
  exact([...seen].sort(), Object.keys(expected).sort(), 'Terraform configuration addresses');
  const providers = configuration.provider_config;
  if (!plainObject(providers)) reject('Terraform provider configuration is missing');
  exact(Object.keys(providers).sort(), ['google', 'google-beta', 'terraform'], 'Terraform providers');
  exact(providers.google.full_name, GOOGLE_PROVIDER, 'Google provider');
  exact(providers['google-beta'].full_name, `${GOOGLE_PROVIDER}-beta`, 'Google beta provider');
  exact(providers.google.version_constraint, '8.1.0', 'Google provider version');
  exact(providers['google-beta'].version_constraint, '8.1.0', 'Google beta provider version');
  exact(providers.terraform.full_name, TERRAFORM_PROVIDER, 'Terraform built-in provider');
}

function validateVariables(plan, input, operatorUserSha256) {
  if (!plainObject(plan.variables)) reject('Terraform plan variables are missing');
  exact(Object.keys(plan.variables).sort(), [
    'operator_user_email',
    'repository_commit',
    'source_archive_path',
    'source_archive_sha256',
  ], 'Terraform plan variable names');
  exact(plan.variables.repository_commit?.value, input.repositoryCommit, 'Repository commit variable');
  exact(plan.variables.source_archive_sha256?.value, input.sourceArchiveSha256, 'Source digest variable');
  const operator = plan.variables.operator_user_email?.value;
  if (typeof operator !== 'string'
    || createHash('sha256').update(operator).digest('hex') !== operatorUserSha256) {
    reject('Terraform plan operator variable is not the reviewed private identity');
  }
  const sourcePath = plan.variables.source_archive_path?.value;
  if (typeof sourcePath !== 'string' || !sourcePath.endsWith('/control-plane.zip')) {
    reject('Terraform plan source path is not the private package path');
  }
}

function validateChangeValues(change, input, operatorUserSha256) {
  const after = change.change.after;
  const address = change.address;
  if (!plainObject(after)) reject(`${address} planned value is missing`);
  switch (address) {
    case 'google_service_account.build':
      exact(after.account_id, 'miakapp-control-build', `${address}.account_id`);
      exact(after.project, PROJECT_ID, `${address}.project`);
      break;
    case 'google_service_account.probe':
      exact(after.account_id, 'miakapp-staging-probe', `${address}.account_id`);
      exact(after.project, PROJECT_ID, `${address}.project`);
      break;
    case 'google_storage_bucket.source':
      exact(after.name, SOURCE_BUCKET, `${address}.name`);
      exact(after.location, REGION.toUpperCase(), `${address}.location`);
      exact(after.storage_class, 'STANDARD', `${address}.storage_class`);
      exact(after.uniform_bucket_level_access, true, `${address}.uniform access`);
      exact(after.public_access_prevention, 'enforced', `${address}.public access prevention`);
      exact(after.force_destroy, false, `${address}.force_destroy`);
      break;
    case 'google_artifact_registry_repository.function':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.location, REGION, `${address}.location`);
      exact(after.repository_id, 'miakapp-control-plane', `${address}.repository_id`);
      exact(after.format, 'DOCKER', `${address}.format`);
      break;
    case 'google_storage_bucket_object.source':
      exact(after.bucket, SOURCE_BUCKET, `${address}.bucket`);
      exact(after.name, `sources/${input.sourceArchiveSha256}.zip`, `${address}.name`);
      exact(after.content_type, 'application/zip', `${address}.content_type`);
      exact(after.metadata?.sha256, input.sourceArchiveSha256, `${address}.metadata.sha256`);
      exact(
        after.metadata?.['repository-commit'],
        sourceRepositoryCommit(input),
        `${address}.metadata.commit`,
      );
      if (typeof after.source !== 'string' || !after.source.endsWith('/control-plane.zip')) {
        reject(`${address}.source is not the private deterministic package`);
      }
      break;
    case 'google_project_iam_custom_role.fcm_sender':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.role_id, 'miakapp.controlPlaneFcmSender', `${address}.role_id`);
      exact(after.permissions, ['cloudmessaging.messages.create'], `${address}.permissions`);
      exact(after.stage, 'GA', `${address}.stage`);
      break;
    case 'google_project_iam_member.build_logs':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.role, 'roles/logging.logWriter', `${address}.role`);
      exact(after.member, `serviceAccount:${BUILD_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_project_iam_member.build_gcf_source_reader':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.role, 'roles/storage.objectViewer', `${address}.role`);
      exact(after.condition, [GCF_SOURCE_CONDITION], `${address}.condition`);
      if (after.member === null) {
        exact(change.change.after_unknown?.member, true, `${address}.member unknown state`);
      } else if (after.member !== `serviceAccount:${BUILD_ACCOUNT}`) {
        reject(`${address}.member does not match the reviewed build account`);
      }
      break;
    case 'google_project_iam_member.runtime_fcm':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.role, `projects/${PROJECT_ID}/roles/miakapp.controlPlaneFcmSender`, `${address}.role`);
      exact(after.member, `serviceAccount:${RUNTIME_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_storage_bucket_iam_member.build_source_reader':
      exact(after.role, 'roles/storage.objectViewer', `${address}.role`);
      if (![SOURCE_BUCKET, `b/${SOURCE_BUCKET}`].includes(after.bucket)) {
        reject(`${address}.bucket does not match the reviewed source bucket`);
      }
      exact(after.member, `serviceAccount:${BUILD_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_artifact_registry_repository_iam_member.build_writer':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.location, REGION, `${address}.location`);
      if (!['miakapp-control-plane', REPOSITORY].includes(after.repository)) {
        reject(`${address}.repository does not match the reviewed artifact repository`);
      }
      exact(after.role, 'roles/artifactregistry.writer', `${address}.role`);
      exact(after.member, `serviceAccount:${BUILD_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_service_account_iam_member.probe_operator': {
      exact(after.role, 'roles/iam.serviceAccountOpenIdTokenCreator', `${address}.role`);
      const member = after.member;
      if (typeof member !== 'string' || !member.startsWith('user:')
        || createHash('sha256').update(member.slice(5).toLowerCase()).digest('hex') !== operatorUserSha256) {
        reject(`${address}.member is not the reviewed private operator`);
      }
      break;
    }
    case 'google_cloud_run_v2_service_iam_member.probe_invoker':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.location, REGION, `${address}.location`);
      if (![
        'control-plane',
        `projects/${PROJECT_ID}/locations/${REGION}/services/control-plane`,
      ].includes(after.name)) {
        reject(`${address}.name does not match the reviewed service`);
      }
      exact(after.role, 'roles/run.invoker', `${address}.role`);
      exact(after.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_cloudfunctions2_function.control_plane': {
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.name, 'control-plane', `${address}.name`);
      exact(after.location, REGION, `${address}.location`);
      const build = after.build_config?.[0];
      const service = after.service_config?.[0];
      if (!plainObject(build) || !plainObject(service)) reject('Function build or service config is missing');
      exact(build.runtime, 'nodejs22', 'Function runtime');
      exact(build.entry_point, 'controlPlane', 'Function entry point');
      exact(build.docker_repository, REPOSITORY, 'Function artifact repository');
      exact(build.service_account, BUILD_ACCOUNT_RESOURCE, 'Function build account');
      exact(build.environment_variables, {}, 'Function build environment');
      exact(build.worker_pool, '', 'Function build worker pool');
      const storageSource = build.source?.[0]?.storage_source?.[0];
      if (!plainObject(storageSource)) reject('Function storage source is missing');
      exact(storageSource.bucket, SOURCE_BUCKET, 'Function source bucket');
      exact(storageSource.object, `sources/${input.sourceArchiveSha256}.zip`, 'Function source object');
      exact(service.available_memory, '256M', 'Function memory');
      exact(service.available_cpu, '1', 'Function CPU');
      exact(service.timeout_seconds, 30, 'Function timeout');
      exact(service.min_instance_count, 0, 'Function minimum instances');
      exact(service.max_instance_count, 1, 'Function maximum instances');
      exact(service.max_instance_request_concurrency, 16, 'Function concurrency');
      exact(service.ingress_settings, 'ALLOW_INTERNAL_ONLY', 'Function ingress');
      exact(service.all_traffic_on_latest_revision, true, 'Function traffic');
      exact(service.service_account_email, RUNTIME_ACCOUNT, 'Function runtime account');
      exact(service.vpc_connector, '', 'Function VPC connector');
      exact(service.vpc_connector_egress_settings, '', 'Function VPC egress');
      exact(service.direct_vpc_network_interface, [], 'Function direct VPC interface');
      exact(service.secret_environment_variables, [], 'Function secret environment');
      exact(service.secret_volumes, [], 'Function secret volumes');
      exact(service.binary_authorization_policy, '', 'Function binary authorization policy');
      const environment = service.environment_variables;
      if (!plainObject(environment)) reject('Function environment is missing');
      const expectedEnvironmentNames = [
        'MIAKAPP_DEPLOYMENT_COMMIT',
        'MIAKAPP_RUNTIME_CONFIG_JSON',
        'MIAKAPP_SOURCE_ARCHIVE_SHA256',
      ];
      if (environment.LOG_EXECUTION_ID !== undefined) {
        exact(environment.LOG_EXECUTION_ID, 'true', 'Function execution ID logging');
        expectedEnvironmentNames.push('LOG_EXECUTION_ID');
      }
      exact(Object.keys(environment).sort(), expectedEnvironmentNames.sort(), 'Function environment names');
      exact(environment.MIAKAPP_DEPLOYMENT_COMMIT, input.repositoryCommit, 'Function commit');
      exact(environment.MIAKAPP_SOURCE_ARCHIVE_SHA256, input.sourceArchiveSha256, 'Function source digest');
      if (createHash('sha256').update(environment.MIAKAPP_RUNTIME_CONFIG_JSON).digest('hex')
        !== runtimeConfigSha256(input)) {
        reject('Function runtime document does not match the committed evidence');
      }
      break;
    }
    default:
      break;
  }
}

function validateGuardInput(value, input, path) {
  if (!plainObject(value)) reject(`${path} is missing`);
  exact(Object.keys(value).sort(), [
    'bootstrap',
    'deployment_commit',
    'foundation',
    'runtime_config',
    'source_archive',
    'source_commit',
  ], `${path} fields`);
  exact(value.bootstrap, {
    apply_provider: `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply`,
    bootstrap_prefix: 'terraform/bootstrap',
    component_bucket: `${PROJECT_ID}-components`,
    deployer_service_account: `miakapp-tf-apply@${PROJECT_ID}.iam.gserviceaccount.com`,
    foundation_prefix: 'terraform/foundation',
    github_repository_id: '354682190',
    github_repository_owner_id: '83046838',
    plan_provider: `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan`,
    planner_service_account: `miakapp-tf-plan@${PROJECT_ID}.iam.gserviceaccount.com`,
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    runtime_service_account: RUNTIME_ACCOUNT,
    schema: 'miakapp.staging-bootstrap/1',
    state_bucket: `${PROJECT_ID}-tfstate-${PROJECT_NUMBER}`,
  }, `${path}.bootstrap`);
  exact(value.foundation, {
    component_bucket: `${PROJECT_ID}-components`,
    firestore_database: '(default)',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    runtime_service_account: RUNTIME_ACCOUNT,
    secret_ids: [
      'miakapp-audit-hmac',
      'miakapp-component-hmac',
      'miakapp-home-key-pepper',
      'miakapp-network-hmac',
      'miakapp-push-hmac',
    ],
    signing_key: `projects/${PROJECT_ID}/locations/${REGION}/keyRings/${PROJECT_ID}/cryptoKeys/access-token-signing`,
  }, `${path}.foundation`);
  exact(value.deployment_commit, input.repositoryCommit, `${path}.deployment_commit`);
  exact(value.runtime_config, runtimeConfigSha256(input), `${path}.runtime_config`);
  exact(value.source_archive, input.sourceArchiveSha256, `${path}.source_archive`);
  exact(value.source_commit, sourceRepositoryCommit(input), `${path}.source_commit`);
}

function validatePinnedSourceObjectBaseline(value, input) {
  if (!plainObject(value)) reject('Pinned source object baseline is missing');
  exact(value.bucket, SOURCE_BUCKET, 'Pinned source object bucket');
  exact(value.name, `sources/${input.sourceArchiveSha256}.zip`, 'Pinned source object name');
  exact(value.content_type, 'application/zip', 'Pinned source object content type');
  exact(value.metadata, {
    'repository-commit': sourceRepositoryCommit(input),
    sha256: input.sourceArchiveSha256,
  }, 'Pinned source object metadata');
  exact(value.deletion_policy, 'DELETE', 'Pinned source object deletion policy');
  exact(value.storage_class, 'STANDARD', 'Pinned source object storage class');
  exact(value.event_based_hold, false, 'Pinned source object event hold');
  exact(value.temporary_hold, false, 'Pinned source object temporary hold');
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    reject('Pinned source object generation is invalid');
  }
  if (typeof value.source !== 'string' || !value.source.endsWith('/control-plane.zip')) {
    reject('Pinned source object path is invalid');
  }
}

function validatePinnedActiveFunction(value, input, operatorUserSha256) {
  if (!plainObject(value)) reject('Pinned active Function baseline is missing');
  exact(value.state, 'ACTIVE', 'Pinned Function state');
  exact(value.environment, 'GEN_2', 'Pinned Function generation');
  validateChangeValues({
    address: 'google_cloudfunctions2_function.control_plane',
    change: { after: value },
  }, input, operatorUserSha256);
  const generation = value.build_config?.[0]?.source?.[0]?.storage_source?.[0]?.generation;
  if (!Number.isSafeInteger(generation) || generation < 1) {
    reject('Pinned Function source generation is invalid');
  }
}

function validatePinnedSourceUpdateChanges(plan, input, policy) {
  if (!Array.isArray(plan.resource_changes)) reject('Terraform resource changes are missing');
  const managedSeen = new Set();
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string' || !plainObject(change.change)) {
      reject('Terraform source update plan contains an invalid resource change');
    }
    if (change.mode === 'data') {
      if (DATA_RESOURCES[change.address] !== change.type
        || ![['read'], ['no-op']].some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
        reject('Terraform source update plan contains an unreviewed data read');
      }
      continue;
    }
    if (change.mode !== 'managed' || MANAGED_RESOURCES[change.address] !== change.type
      || managedSeen.has(change.address)) {
      reject('Terraform source update plan contains an unreviewed managed resource');
    }
    managedSeen.add(change.address);
    exact(change.change.actions, PINNED_UPDATE_ACTIONS[change.address], `${change.address}.update actions`);
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject('Terraform source update plan must not import or generate configuration');
    }
    if (isDeepStrictEqual(change.change.actions, ['no-op'])) {
      exact(change.change.before, change.change.after, `${change.address}.update no-op`);
    } else if (change.address === 'google_storage_bucket_object.source') {
      exact(change.change.replace_paths, [['name'], ['metadata']], `${change.address}.replace paths`);
      validatePinnedSourceObjectBaseline(change.change.before, policy.previous);
    } else if (change.address === 'google_cloudfunctions2_function.control_plane') {
      validatePinnedActiveFunction(change.change.before, policy.previous, policy.operatorUserSha256);
      exact(change.change.after.state, 'ACTIVE', 'Updated Function state');
      exact(change.change.after.environment, 'GEN_2', 'Updated Function generation');
    } else if (change.address === 'terraform_data.deployment_guard') {
      const before = change.change.before;
      const after = change.change.after;
      if (!plainObject(before) || !plainObject(after)) reject('Deployment guard update is incomplete');
      validateGuardInput(before.input, policy.previous, 'Deployment guard baseline');
      exact(before.output, before.input, 'Deployment guard baseline output');
      exact(before.triggers_replace, null, 'Deployment guard baseline replacement trigger');
      validateGuardInput(after.input, input, 'Deployment guard update');
      exact(after.id, before.id, 'Deployment guard stable identity');
      exact(after.triggers_replace, null, 'Deployment guard update replacement trigger');
    }
    validateChangeValues(change, input, policy.operatorUserSha256);
  }
  exact([...managedSeen].sort(), Object.keys(MANAGED_RESOURCES).sort(), 'Managed source update changes');
}

function validateSigningActivationChanges(plan, input, policy) {
  if (!Array.isArray(plan.resource_changes)) reject('Terraform resource changes are missing');
  const managedSeen = new Set();
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string' || !plainObject(change.change)) {
      reject('Terraform signing activation plan contains an invalid resource change');
    }
    if (change.mode === 'data') {
      if (DATA_RESOURCES[change.address] !== change.type
        || ![['read'], ['no-op']].some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
        reject('Terraform signing activation plan contains an unreviewed data read');
      }
      continue;
    }
    if (change.mode !== 'managed' || MANAGED_RESOURCES[change.address] !== change.type
      || managedSeen.has(change.address)) {
      reject('Terraform signing activation plan contains an unreviewed managed resource');
    }
    managedSeen.add(change.address);
    exact(
      change.change.actions,
      SIGNING_ACTIVATION_ACTIONS[change.address],
      `${change.address}.signing activation actions`,
    );
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject('Terraform signing activation plan must not import or generate configuration');
    }
    if (isDeepStrictEqual(change.change.actions, ['no-op'])) {
      exact(change.change.before, change.change.after, `${change.address}.signing activation no-op`);
    } else if (change.address === 'google_cloudfunctions2_function.control_plane') {
      validatePinnedActiveFunction(
        change.change.before,
        policy.previous,
        policy.operatorUserSha256,
      );
      exact(change.change.after.state, 'ACTIVE', 'Activated Function state');
      exact(change.change.after.environment, 'GEN_2', 'Activated Function generation');
      exact(
        change.change.after.build_config,
        change.change.before.build_config,
        'Signing activation Function build configuration',
      );
    } else if (change.address === 'terraform_data.deployment_guard') {
      const before = change.change.before;
      const after = change.change.after;
      if (!plainObject(before) || !plainObject(after)) {
        reject('Signing activation guard is incomplete');
      }
      validateGuardInput(before.input, policy.previous, 'Signing activation guard baseline');
      exact(before.output, before.input, 'Signing activation guard baseline output');
      exact(before.triggers_replace, null, 'Signing activation guard baseline replacement trigger');
      validateGuardInput(after.input, input, 'Signing activation guard update');
      exact(after.id, before.id, 'Signing activation guard stable identity');
      exact(after.triggers_replace, null, 'Signing activation guard replacement trigger');
    }
    validateChangeValues(change, input, policy.operatorUserSha256);
  }
  exact(
    [...managedSeen].sort(),
    Object.keys(MANAGED_RESOURCES).sort(),
    'Managed signing activation changes',
  );
}

function validateResourceChanges(plan, input, operatorUserSha256) {
  if (!Array.isArray(plan.resource_changes)) reject('Terraform resource changes are missing');
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
    exact(change.change.actions, ['create'], `${change.address}.actions`);
    exact(change.change.before, null, `${change.address}.before`);
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject('Terraform workload plan must not import or generate configuration');
    }
    validateChangeValues(change, input, operatorUserSha256);
  }
  exact([...managedSeen].sort(), Object.keys(MANAGED_RESOURCES).sort(), 'Managed workload changes');
}

function validateFailedFunction(value, input) {
  if (!plainObject(value)) reject('Failed Function recovery baseline is missing');
  exact(value.project, PROJECT_ID, 'Failed Function project');
  exact(value.name, 'control-plane', 'Failed Function name');
  exact(value.location, REGION, 'Failed Function location');
  exact(value.environment, 'GEN_2', 'Failed Function generation');
  exact(value.state, 'FAILED', 'Failed Function state');
  exact(value.service_config, [], 'Failed Function service config');
  const build = value.build_config?.[0];
  const source = build?.source?.[0]?.storage_source?.[0];
  if (!plainObject(build) || value.build_config.length !== 1 || !plainObject(source)) {
    reject('Failed Function build baseline is incomplete');
  }
  exact(build.runtime, 'nodejs22', 'Failed Function runtime');
  exact(build.entry_point, 'controlPlane', 'Failed Function entry point');
  exact(build.docker_repository, REPOSITORY, 'Failed Function repository');
  exact(build.service_account, BUILD_ACCOUNT_RESOURCE, 'Failed Function build account');
  exact(source.bucket, SOURCE_BUCKET, 'Failed Function source bucket');
  exact(source.object, `sources/${input.sourceArchiveSha256}.zip`, 'Failed Function source object');
  if (!/^[1-9][0-9]*$/u.test(String(source.generation ?? ''))) {
    reject('Failed Function source generation is invalid');
  }
}

function validateRecoveryResourceChanges(plan, input, operatorUserSha256) {
  if (!Array.isArray(plan.resource_changes)) reject('Terraform resource changes are missing');
  const managedSeen = new Set();
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string' || !plainObject(change.change)) {
      reject('Terraform recovery plan contains an invalid resource change');
    }
    if (change.mode === 'data') {
      if (DATA_RESOURCES[change.address] !== change.type
        || ![['read'], ['no-op']].some((actions) => isDeepStrictEqual(actions, change.change.actions))) {
        reject('Terraform recovery plan contains an unreviewed data read');
      }
      continue;
    }
    if (change.mode !== 'managed' || MANAGED_RESOURCES[change.address] !== change.type
      || managedSeen.has(change.address)) {
      reject('Terraform recovery plan contains an unreviewed managed resource');
    }
    managedSeen.add(change.address);
    exact(change.change.actions, RECOVERY_ACTIONS[change.address], `${change.address}.recovery actions`);
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject('Terraform recovery plan must not import or generate configuration');
    }
    if (isDeepStrictEqual(change.change.actions, ['create'])) {
      exact(change.change.before, null, `${change.address}.recovery before`);
    } else if (isDeepStrictEqual(change.change.actions, ['no-op'])) {
      exact(change.change.before, change.change.after, `${change.address}.recovery no-op`);
    } else {
      validateFailedFunction(change.change.before, input);
    }
    validateChangeValues(change, input, operatorUserSha256);
  }
  exact([...managedSeen].sort(), Object.keys(MANAGED_RESOURCES).sort(), 'Managed recovery changes');
}

function validatePlanEnvelope(plan, input, policy) {
  if (!plainObject(plan) || !plainObject(input)) reject('Terraform workload plan is invalid');
  if (!plainObject(policy)
    || !/^[0-9a-f]{64}$/u.test(policy.operatorUserSha256 ?? '')) {
    reject('Terraform workload validation policy is invalid');
  }
  exact(plan.format_version, '1.2', 'Terraform plan format');
  exact(plan.terraform_version, TERRAFORM_VERSION, 'Terraform version');
  exact(plan.applyable, true, 'Terraform plan applyable state');
  exact(plan.complete, true, 'Terraform plan completeness');
  exact(plan.errored, false, 'Terraform plan error state');
  if (typeof input.repositoryCommit !== 'string'
    || !/^[0-9a-f]{40}$/u.test(input.repositoryCommit)
    || typeof input.sourceArchiveSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(input.sourceArchiveSha256)
    || !/^[0-9a-f]{40}$/u.test(sourceRepositoryCommit(input))
    || !/^[0-9a-f]{64}$/u.test(runtimeConfigSha256(input))) {
    reject('Terraform workload validation inputs are invalid');
  }
  validateVariables(plan, input, policy.operatorUserSha256);
  resourceConfiguration(plan);
}

export function validateWorkloadPlanAgainstPolicy(plan, input, policy) {
  validatePlanEnvelope(plan, input, policy);
  validateResourceChanges(plan, input, policy.operatorUserSha256);
  rejectForbiddenIdentities(plan);
  return Object.freeze({
    create: Object.keys(MANAGED_RESOURCES).length,
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
}

export function validateFailedBuildRecoveryPlanAgainstPolicy(plan, input, policy) {
  validatePlanEnvelope(plan, input, policy);
  validateRecoveryResourceChanges(plan, input, policy.operatorUserSha256);
  rejectForbiddenIdentities(plan);
  return Object.freeze({
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
}

export function validatePinnedSourceUpdatePlanAgainstPolicy(plan, input, policy) {
  validatePlanEnvelope(plan, input, policy);
  if (!plainObject(policy.previous)
    || !/^[0-9a-f]{40}$/u.test(policy.previous.repositoryCommit ?? '')
    || !/^[0-9a-f]{64}$/u.test(policy.previous.sourceArchiveSha256 ?? '')
    || input.repositoryCommit === policy.previous.repositoryCommit
    || input.sourceArchiveSha256 === policy.previous.sourceArchiveSha256
    || runtimeConfigSha256(input) !== runtimeConfigSha256(policy.previous)) {
    reject('Terraform source update baseline is invalid or unchanged');
  }
  validatePinnedSourceUpdateChanges(plan, input, policy);
  rejectForbiddenIdentities(plan);
  return Object.freeze({
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
}

export function validatePinnedSigningActivationPlanAgainstPolicy(plan, input, policy) {
  validatePlanEnvelope(plan, input, policy);
  if (!plainObject(policy.previous)
    || !/^[0-9a-f]{40}$/u.test(policy.previous.repositoryCommit ?? '')
    || !/^[0-9a-f]{40}$/u.test(sourceRepositoryCommit(policy.previous))
    || !/^[0-9a-f]{64}$/u.test(policy.previous.sourceArchiveSha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(runtimeConfigSha256(policy.previous))
    || input.repositoryCommit === policy.previous.repositoryCommit
    || sourceRepositoryCommit(input) !== sourceRepositoryCommit(policy.previous)
    || input.sourceArchiveSha256 !== policy.previous.sourceArchiveSha256
    || runtimeConfigSha256(input) !== TARGET_RUNTIME_CONFIG_SHA256
    || runtimeConfigSha256(input) === runtimeConfigSha256(policy.previous)) {
    reject('Terraform signing activation baseline is invalid or unchanged');
  }
  validateSigningActivationChanges(plan, input, policy);
  rejectForbiddenIdentities(plan);
  return Object.freeze({
    create: 0,
    update: 2,
    delete: 0,
    transition: 'activate-version-2-with-version-1-retained',
    function: 1,
    source_replaced: false,
    published_signing_key_versions: 2,
    current_signing_key_version: 2,
    minimum_instances: 0,
    maximum_instances: 1,
    ingress: 'internal-only',
    unauthenticated_invokers: 0,
    synthetic_invokers: 1,
    fcm_permissions: 1,
  });
}

export function validateInitialWorkloadPlan(plan, input) {
  return validateWorkloadPlanAgainstPolicy(plan, input, {
    operatorUserSha256: OPERATOR_USER_SHA256,
  });
}

export function validateFailedBuildRecoveryPlan(plan, input) {
  return validateFailedBuildRecoveryPlanAgainstPolicy(plan, input, {
    operatorUserSha256: OPERATOR_USER_SHA256,
  });
}

export function validatePinnedSourceUpdatePlan(
  plan,
  input,
  operatorUserSha256 = OPERATOR_USER_SHA256,
) {
  return validatePinnedSourceUpdatePlanAgainstPolicy(plan, input, {
    operatorUserSha256,
    previous: PINNED_UPDATE_BASELINE,
  });
}

export function validatePinnedSigningActivationPlan(
  plan,
  input,
  operatorUserSha256 = OPERATOR_USER_SHA256,
) {
  return validatePinnedSigningActivationPlanAgainstPolicy(plan, input, {
    operatorUserSha256,
    previous: PINNED_UPDATE_BASELINE,
  });
}

function readPlan(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Terraform workload plan JSON has an invalid size');
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Terraform workload plan is not valid JSON');
  }
}

export function readAndValidateInitialWorkloadPlan(path, input) {
  return validateInitialWorkloadPlan(readPlan(path), input);
}

export function readAndValidateFailedBuildRecoveryPlan(path, input) {
  return validateFailedBuildRecoveryPlan(readPlan(path), input);
}

export function readAndValidatePinnedSourceUpdatePlan(path, input) {
  return validatePinnedSourceUpdatePlan(readPlan(path), input);
}

export function readAndValidatePinnedSigningActivationPlan(path, input) {
  return validatePinnedSigningActivationPlan(readPlan(path), input);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const recovery = process.argv[2] === '--recover-failed-build';
  const update = process.argv[2] === '--update-pinned-source';
  const signingActivation = process.argv[2] === '--signing-activate';
  const offset = recovery || update || signingActivation ? 1 : 0;
  if (process.argv.length !== 5 + offset) {
    console.error('Usage: node validate-plan.mjs [--recover-failed-build|--update-pinned-source|--signing-activate] <plan.json> <repository-commit> <source-sha256>');
    process.exitCode = 2;
  } else {
    try {
      const validate = recovery
        ? readAndValidateFailedBuildRecoveryPlan
        : update
          ? readAndValidatePinnedSourceUpdatePlan
          : signingActivation
            ? readAndValidatePinnedSigningActivationPlan
            : readAndValidateInitialWorkloadPlan;
      const summary = validate(process.argv[2 + offset], {
        repositoryCommit: process.argv[3 + offset],
        sourceRepositoryCommit: signingActivation
          ? PINNED_UPDATE_BASELINE.sourceRepositoryCommit
          : process.argv[3 + offset],
        sourceArchiveSha256: process.argv[4 + offset],
        runtimeConfigSha256: signingActivation
          ? TARGET_RUNTIME_CONFIG_SHA256
          : RUNTIME_CONFIG_SHA256,
      });
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Terraform workload plan validation failed');
      process.exitCode = 1;
    }
  }
}
