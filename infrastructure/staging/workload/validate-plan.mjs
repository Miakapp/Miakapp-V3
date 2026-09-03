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

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} does not match the reviewed value`);
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
      exact(after.location, REGION, `${address}.location`);
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
      exact(after.name, `sources/${input.sourceArchiveSha256}.zip`, `${address}.name`);
      exact(after.content_type, 'application/zip', `${address}.content_type`);
      exact(after.metadata?.sha256, input.sourceArchiveSha256, `${address}.metadata.sha256`);
      exact(after.metadata?.['repository-commit'], input.repositoryCommit, `${address}.metadata.commit`);
      break;
    case 'google_project_iam_custom_role.fcm_sender':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.role_id, 'miakapp.controlPlaneFcmSender', `${address}.role_id`);
      exact(after.permissions, ['cloudmessaging.messages.create'], `${address}.permissions`);
      exact(after.stage, 'GA', `${address}.stage`);
      break;
    case 'google_project_iam_member.build_logs':
      exact(after.role, 'roles/logging.logWriter', `${address}.role`);
      break;
    case 'google_project_iam_member.runtime_fcm':
      break;
    case 'google_storage_bucket_iam_member.build_source_reader':
      exact(after.role, 'roles/storage.objectViewer', `${address}.role`);
      break;
    case 'google_artifact_registry_repository_iam_member.build_writer':
      exact(after.role, 'roles/artifactregistry.writer', `${address}.role`);
      break;
    case 'google_service_account_iam_member.probe_operator': {
      exact(after.role, 'roles/iam.serviceAccountOpenIdTokenCreator', `${address}.role`);
      const member = after.member;
      if (typeof member !== 'string' || !member.startsWith('user:')
        || createHash('sha256').update(member.slice(5)).digest('hex') !== operatorUserSha256) {
        reject(`${address}.member is not the reviewed private operator`);
      }
      break;
    }
    case 'google_cloud_run_v2_service_iam_member.probe_invoker':
      exact(after.project, PROJECT_ID, `${address}.project`);
      exact(after.location, REGION, `${address}.location`);
      exact(after.name, 'control-plane', `${address}.name`);
      exact(after.role, 'roles/run.invoker', `${address}.role`);
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
      exact(service.available_memory, '256M', 'Function memory');
      exact(service.available_cpu, '1', 'Function CPU');
      exact(service.timeout_seconds, 30, 'Function timeout');
      exact(service.min_instance_count, 0, 'Function minimum instances');
      exact(service.max_instance_count, 1, 'Function maximum instances');
      exact(service.max_instance_request_concurrency, 16, 'Function concurrency');
      exact(service.ingress_settings, 'ALLOW_INTERNAL_ONLY', 'Function ingress');
      exact(service.all_traffic_on_latest_revision, true, 'Function traffic');
      exact(service.service_account_email, RUNTIME_ACCOUNT, 'Function runtime account');
      const environment = service.environment_variables;
      if (!plainObject(environment)) reject('Function environment is missing');
      exact(Object.keys(environment).sort(), [
        'MIAKAPP_DEPLOYMENT_COMMIT',
        'MIAKAPP_RUNTIME_CONFIG_JSON',
        'MIAKAPP_SOURCE_ARCHIVE_SHA256',
      ], 'Function environment names');
      exact(environment.MIAKAPP_DEPLOYMENT_COMMIT, input.repositoryCommit, 'Function commit');
      exact(environment.MIAKAPP_SOURCE_ARCHIVE_SHA256, input.sourceArchiveSha256, 'Function source digest');
      if (createHash('sha256').update(environment.MIAKAPP_RUNTIME_CONFIG_JSON).digest('hex')
        !== RUNTIME_CONFIG_SHA256) {
        reject('Function runtime document does not match the committed evidence');
      }
      break;
    }
    default:
      break;
  }
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

export function validateWorkloadPlanAgainstPolicy(plan, input, policy) {
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
    || typeof input.sourceArchiveSha256 !== 'string') {
    reject('Terraform workload validation inputs are invalid');
  }
  validateVariables(plan, input, policy.operatorUserSha256);
  resourceConfiguration(plan);
  validateResourceChanges(plan, input, policy.operatorUserSha256);
  const serialized = JSON.stringify(plan);
  for (const forbidden of ['allUsers', 'allAuthenticatedUsers', 'miakapp-3', '"miakapp-v4"']) {
    if (serialized.includes(forbidden)) reject('Terraform workload plan contains a forbidden principal or project');
  }
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

export function validateInitialWorkloadPlan(plan, input) {
  return validateWorkloadPlanAgainstPolicy(plan, input, {
    operatorUserSha256: OPERATOR_USER_SHA256,
  });
}

export function readAndValidateInitialWorkloadPlan(path, input) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Terraform workload plan JSON has an invalid size');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Terraform workload plan is not valid JSON');
  }
  return validateInitialWorkloadPlan(plan, input);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) {
    console.error('Usage: node validate-plan.mjs <plan.json> <repository-commit> <source-sha256>');
    process.exitCode = 2;
  } else {
    try {
      const summary = readAndValidateInitialWorkloadPlan(process.argv[2], {
        repositoryCommit: process.argv[3],
        sourceArchiveSha256: process.argv[4],
      });
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Terraform workload plan validation failed');
      process.exitCode = 1;
    }
  }
}
