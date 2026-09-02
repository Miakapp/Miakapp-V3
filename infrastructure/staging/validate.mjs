import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MAX_MANIFEST_BYTES = 64 * 1024;

const SERVICE_IDS = [
  'firebase-auth',
  'firebase-app-check',
  'firestore',
  'cloud-functions-gen2',
  'cloud-storage',
  'cloud-kms',
  'secret-manager',
  'firebase-cloud-messaging',
  'cloud-logging',
  'cloud-monitoring',
];

const ENABLED_SERVICE_APIS = [
  'analyticshub.googleapis.com',
  'appengine.googleapis.com',
  'bigquery.googleapis.com',
  'bigqueryconnection.googleapis.com',
  'bigquerydatapolicy.googleapis.com',
  'bigquerydatatransfer.googleapis.com',
  'bigquerymigration.googleapis.com',
  'bigqueryreservation.googleapis.com',
  'bigquerystorage.googleapis.com',
  'cloudapis.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'cloudtrace.googleapis.com',
  'dataform.googleapis.com',
  'dataplex.googleapis.com',
  'datastore.googleapis.com',
  'fcm.googleapis.com',
  'firebase.googleapis.com',
  'firebasehosting.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseremoteconfig.googleapis.com',
  'firebaseremoteconfigrealtime.googleapis.com',
  'firebaserules.googleapis.com',
  'identitytoolkit.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'pubsub.googleapis.com',
  'runtimeconfig.googleapis.com',
  'securetoken.googleapis.com',
  'servicemanagement.googleapis.com',
  'serviceusage.googleapis.com',
  'sql-component.googleapis.com',
  'storage-api.googleapis.com',
  'storage-component.googleapis.com',
  'storage.googleapis.com',
  'telemetry.googleapis.com',
  'testing.googleapis.com',
];

const SECRET_IDS = [
  'miakapp-home-key-pepper',
  'miakapp-component-hmac',
  'miakapp-push-hmac',
  'miakapp-audit-hmac',
  'miakapp-network-hmac',
];

const IAM_BINDINGS = [
  ['firestore/(default)', 'roles/datastore.user'],
  ['storage/miakapp-v4-staging-components', 'roles/storage.objectCreator'],
  ['storage/miakapp-v4-staging-components', 'roles/storage.objectViewer'],
  ['kms/miakapp-v4-staging/access-token-signing', 'roles/cloudkms.signerVerifier'],
  ['secret-manager/declared-secrets-only', 'roles/secretmanager.secretAccessor'],
  ['firebase-app-check/miakapp-v4-staging', 'roles/firebaseappcheck.tokenVerifier'],
  ['project/miakapp-v4-staging', 'roles/logging.logWriter'],
  ['project/miakapp-v4-staging', 'roles/monitoring.metricWriter'],
];

const REQUIRED_BLOCKERS = [
  'production-config-loader',
  'kms-signer-and-jwks-rotation',
  'firebase-auth-rs256-verifier',
  'app-check-verifier-and-replay-policy',
  'fcm-fid-transport',
  'production-storage-and-readback',
  'relay-token-refresh-integration',
  'trusted-source-and-edge-admission',
  'monitoring-and-billing-alerts',
  'migration-rehearsal',
  'production-function-entrypoint',
  'secret-version-lifecycle',
  'remote-state-bootstrap-not-applied',
  'keyless-plan-and-apply-identities-not-created',
  'github-terraform-workflow-not-installed',
  'live-foundation-plan-not-reviewed',
];

const STAGING_ROWS = [
  'STAGE-01',
  'STAGE-02',
  'STAGE-03',
  'STAGE-04',
  'STAGE-05',
  'STAGE-06',
  'STAGE-07',
  'STAGE-08',
  'STAGE-09',
];

const TEARDOWN_INVENTORY = [
  'cloud-functions-and-cloud-run-revisions',
  'eventarc-triggers',
  'artifact-registry-images',
  'firestore-database-and-ttl-policies',
  'component-storage-live-and-soft-deleted-objects',
  'terraform-state-plan-lock-and-soft-deleted-objects',
  'secret-manager-versions',
  'kms-key-versions-and-non-deletable-key-ring',
  'iam-bindings-service-accounts-and-workload-identity',
  'billing-export-and-late-charges',
];

export class StagingManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StagingManifestError';
  }
}

function reject(path, message) {
  throw new StagingManifestError(`${path} ${message}`);
}

function record(value, path, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject(path, 'must be an object');
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    reject(path, `must contain exactly: ${expected.join(', ')}`);
  }
  return value;
}

function exact(value, expected, path) {
  if (!Object.is(value, expected)) reject(path, `must equal ${JSON.stringify(expected)}`);
}

function exactArray(value, expected, path) {
  if (!Array.isArray(value)) reject(path, 'must be an array');
  if (value.length !== expected.length) reject(path, `must contain exactly ${expected.length} entries`);
  expected.forEach((item, index) => exact(value[index], item, `${path}[${index}]`));
}

function validateProject(value) {
  const project = record(value, 'project', [
    'project_id',
    'project_number',
    'display_name',
    'lifecycle',
    'creation_authorized',
    'billing_link_authorized',
    'deployment_authorized',
    'public_ingress_authorized',
    'explicit_project_required',
    'firebase_alias_allowed',
    'data_policy',
    'forbidden_project_ids',
  ]);
  exact(project.project_id, 'miakapp-v4-staging', 'project.project_id');
  exact(project.project_number, '1072737219170', 'project.project_number');
  exact(project.display_name, 'Miakapp V4 Staging', 'project.display_name');
  if (typeof project.project_id === 'string' && project.project_id.startsWith('demo-')) {
    reject('project.project_id', 'must not use a demo namespace');
  }
  exact(project.lifecycle, 'firebase_enabled_unbilled', 'project.lifecycle');
  exact(project.creation_authorized, false, 'project.creation_authorized');
  exact(project.billing_link_authorized, false, 'project.billing_link_authorized');
  exact(project.deployment_authorized, false, 'project.deployment_authorized');
  exact(project.public_ingress_authorized, false, 'project.public_ingress_authorized');
  exact(project.explicit_project_required, true, 'project.explicit_project_required');
  exact(project.firebase_alias_allowed, false, 'project.firebase_alias_allowed');
  exact(project.data_policy, 'synthetic_only', 'project.data_policy');
  exactArray(
    project.forbidden_project_ids,
    ['miakapp-3', 'miakapp-v4', 'demo-miakapp-v4'],
    'project.forbidden_project_ids',
  );
}

function validateBootstrap(value) {
  const bootstrap = record(value, 'bootstrap', [
    'observed_on',
    'billing_enabled',
    'firebase_apps',
    'hosting_site',
    'app_engine_application',
    'firestore_databases',
    'storage_buckets',
    'cloud_functions',
    'cloud_run_services',
    'kms_key_rings',
    'secrets',
    'project_service_accounts',
    'enabled_service_apis',
  ]);
  exact(bootstrap.observed_on, '2026-09-02', 'bootstrap.observed_on');
  exact(bootstrap.billing_enabled, false, 'bootstrap.billing_enabled');
  exact(bootstrap.firebase_apps, 0, 'bootstrap.firebase_apps');
  exact(bootstrap.hosting_site, 'miakapp-v4-staging', 'bootstrap.hosting_site');
  exact(bootstrap.app_engine_application, false, 'bootstrap.app_engine_application');
  for (const field of [
    'firestore_databases',
    'storage_buckets',
    'cloud_functions',
    'cloud_run_services',
    'kms_key_rings',
    'secrets',
  ]) {
    exactArray(bootstrap[field], [], `bootstrap.${field}`);
  }
  exactArray(
    bootstrap.project_service_accounts,
    ['firebase-adminsdk-fbsvc@miakapp-v4-staging.iam.gserviceaccount.com'],
    'bootstrap.project_service_accounts',
  );
  exactArray(bootstrap.enabled_service_apis, ENABLED_SERVICE_APIS, 'bootstrap.enabled_service_apis');
}

function validateLocations(value) {
  const locations = record(value, 'locations', [
    'topology',
    'primary',
    'functions',
    'firestore',
    'storage',
    'kms',
    'immutable_choice_reviewed',
  ]);
  exact(locations.topology, 'regional', 'locations.topology');
  for (const field of ['primary', 'functions', 'firestore', 'storage', 'kms']) {
    exact(locations[field], 'europe-west9', `locations.${field}`);
  }
  exact(locations.immutable_choice_reviewed, true, 'locations.immutable_choice_reviewed');
}

function validateServices(value) {
  if (!Array.isArray(value)) reject('services', 'must be an array');
  if (value.length !== SERVICE_IDS.length) reject('services', `must contain exactly ${SERVICE_IDS.length} entries`);
  SERVICE_IDS.forEach((id, index) => {
    const service = record(value[index], `services[${index}]`, ['id', 'state']);
    exact(service.id, id, `services[${index}].id`);
    exact(service.state, 'planned', `services[${index}].state`);
  });
}

function validateRuntime(value) {
  const runtime = record(value, 'runtime', [
    'function_name',
    'generation',
    'region',
    'minimum_instances',
    'maximum_instances',
    'concurrency',
    'timeout_seconds',
    'dedicated_service_account',
    'allow_unauthenticated',
    'ingress',
  ]);
  exact(runtime.function_name, 'controlPlane', 'runtime.function_name');
  exact(runtime.generation, 2, 'runtime.generation');
  exact(runtime.region, 'europe-west9', 'runtime.region');
  exact(runtime.minimum_instances, 0, 'runtime.minimum_instances');
  exact(runtime.maximum_instances, 1, 'runtime.maximum_instances');
  exact(runtime.concurrency, 16, 'runtime.concurrency');
  exact(runtime.timeout_seconds, 30, 'runtime.timeout_seconds');
  exact(
    runtime.dedicated_service_account,
    'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
    'runtime.dedicated_service_account',
  );
  exact(runtime.allow_unauthenticated, false, 'runtime.allow_unauthenticated');
  exact(runtime.ingress, 'not_configured', 'runtime.ingress');
}

function validateData(value) {
  const data = record(value, 'data', ['firestore', 'storage']);
  const firestore = record(data.firestore, 'data.firestore', [
    'database_id',
    'edition',
    'location',
    'deletion_protection',
    'point_in_time_recovery',
    'scheduled_backups',
    'ttl_fields',
  ]);
  exact(firestore.database_id, '(default)', 'data.firestore.database_id');
  exact(firestore.edition, 'STANDARD', 'data.firestore.edition');
  exact(firestore.location, 'europe-west9', 'data.firestore.location');
  exact(firestore.deletion_protection, true, 'data.firestore.deletion_protection');
  exact(firestore.point_in_time_recovery, false, 'data.firestore.point_in_time_recovery');
  exact(firestore.scheduled_backups, false, 'data.firestore.scheduled_backups');
  exactArray(firestore.ttl_fields, [
    'pushChallenges.expires_at',
    'controlAdmissionBuckets.expires_at',
    'controlAudit.expires_at',
  ], 'data.firestore.ttl_fields');

  const storage = record(data.storage, 'data.storage', [
    'bucket_name',
    'firebase_default_bucket',
    'location',
    'uniform_bucket_level_access',
    'public_access_prevention',
    'public_read',
    'cors_origins',
    'soft_delete_days',
    'object_versioning',
    'retention_policy_locked',
    'staging_object_ttl_days',
  ]);
  exact(storage.bucket_name, 'miakapp-v4-staging-components', 'data.storage.bucket_name');
  exact(storage.firebase_default_bucket, false, 'data.storage.firebase_default_bucket');
  exact(storage.location, 'europe-west9', 'data.storage.location');
  exact(storage.uniform_bucket_level_access, true, 'data.storage.uniform_bucket_level_access');
  exact(storage.public_access_prevention, 'enforced', 'data.storage.public_access_prevention');
  exact(storage.public_read, false, 'data.storage.public_read');
  exactArray(storage.cors_origins, [], 'data.storage.cors_origins');
  exact(storage.soft_delete_days, 0, 'data.storage.soft_delete_days');
  exact(storage.object_versioning, false, 'data.storage.object_versioning');
  exact(storage.retention_policy_locked, false, 'data.storage.retention_policy_locked');
  exact(storage.staging_object_ttl_days, 1, 'data.storage.staging_object_ttl_days');
}

function validateSecurity(value) {
  const security = record(value, 'security', ['kms', 'secrets', 'iam']);
  const kms = record(security.kms, 'security.kms', [
    'state',
    'location',
    'key_ring',
    'key',
    'protection_level',
    'purpose',
    'algorithm',
    'automatic_rotation',
    'key_ring_deletion_supported',
  ]);
  exact(kms.state, 'not_created', 'security.kms.state');
  exact(kms.location, 'europe-west9', 'security.kms.location');
  exact(kms.key_ring, 'miakapp-v4-staging', 'security.kms.key_ring');
  exact(kms.key, 'access-token-signing', 'security.kms.key');
  exact(kms.protection_level, 'SOFTWARE', 'security.kms.protection_level');
  exact(kms.purpose, 'ASYMMETRIC_SIGN', 'security.kms.purpose');
  exact(kms.algorithm, 'EC_SIGN_ED25519', 'security.kms.algorithm');
  exact(kms.automatic_rotation, false, 'security.kms.automatic_rotation');
  exact(kms.key_ring_deletion_supported, false, 'security.kms.key_ring_deletion_supported');

  if (!Array.isArray(security.secrets)) reject('security.secrets', 'must be an array');
  if (security.secrets.length !== SECRET_IDS.length) {
    reject('security.secrets', `must contain exactly ${SECRET_IDS.length} declarations`);
  }
  SECRET_IDS.forEach((id, index) => {
    const secret = record(security.secrets[index], `security.secrets[${index}]`, [
      'id',
      'state',
      'replication',
      'version_policy_state',
      'maximum_active_versions',
      'consumer',
    ]);
    exact(secret.id, id, `security.secrets[${index}].id`);
    exact(secret.state, 'not_created', `security.secrets[${index}].state`);
    exact(secret.replication, 'automatic', `security.secrets[${index}].replication`);
    exact(secret.version_policy_state, 'not_implemented', `security.secrets[${index}].version_policy_state`);
    exact(secret.maximum_active_versions, 2, `security.secrets[${index}].maximum_active_versions`);
    exact(secret.consumer, 'control-plane-runtime', `security.secrets[${index}].consumer`);
  });

  const iam = record(security.iam, 'security.iam', [
    'runtime_identity_state',
    'broad_project_roles_forbidden',
    'human_runtime_bindings_forbidden',
    'resource_bindings',
    'unresolved_permissions',
  ]);
  exact(iam.runtime_identity_state, 'not_created', 'security.iam.runtime_identity_state');
  exact(iam.broad_project_roles_forbidden, true, 'security.iam.broad_project_roles_forbidden');
  exact(iam.human_runtime_bindings_forbidden, true, 'security.iam.human_runtime_bindings_forbidden');
  if (!Array.isArray(iam.resource_bindings)) reject('security.iam.resource_bindings', 'must be an array');
  if (iam.resource_bindings.length !== IAM_BINDINGS.length) {
    reject('security.iam.resource_bindings', `must contain exactly ${IAM_BINDINGS.length} entries`);
  }
  IAM_BINDINGS.forEach(([resourceName, access], index) => {
    const binding = record(iam.resource_bindings[index], `security.iam.resource_bindings[${index}]`, [
      'resource',
      'access',
    ]);
    exact(binding.resource, resourceName, `security.iam.resource_bindings[${index}].resource`);
    exact(binding.access, access, `security.iam.resource_bindings[${index}].access`);
  });
  exactArray(iam.unresolved_permissions, ['cloudmessaging.messages.create'], 'security.iam.unresolved_permissions');
}

function validateCost(value) {
  const cost = record(value, 'cost', [
    'billing_account',
    'currency',
    'alert_thresholds',
    'alerts_are_not_hard_caps',
    'operator_approval_required',
    'free_tier_assumed',
    'preview_cloud_run_spend_cap_enabled',
    'fixed_cost_services',
  ]);
  const billingAccount = record(cost.billing_account, 'cost.billing_account', [
    'selection_state',
    'identifier_sha256',
    'raw_identifier_committed',
    'link_state',
  ]);
  exact(billingAccount.selection_state, 'approved', 'cost.billing_account.selection_state');
  exact(
    billingAccount.identifier_sha256,
    '4557923f1be719b78ee844b14bfa4654be3eb3fa785a2cb5a2624c3f85d12270',
    'cost.billing_account.identifier_sha256',
  );
  exact(billingAccount.raw_identifier_committed, false, 'cost.billing_account.raw_identifier_committed');
  exact(billingAccount.link_state, 'not_linked', 'cost.billing_account.link_state');
  exact(cost.currency, 'EUR', 'cost.currency');
  exactArray(cost.alert_thresholds, [2, 5, 10], 'cost.alert_thresholds');
  exact(cost.alerts_are_not_hard_caps, true, 'cost.alerts_are_not_hard_caps');
  exact(cost.operator_approval_required, true, 'cost.operator_approval_required');
  exact(cost.free_tier_assumed, false, 'cost.free_tier_assumed');
  exact(cost.preview_cloud_run_spend_cap_enabled, false, 'cost.preview_cloud_run_spend_cap_enabled');
  const fixed = record(cost.fixed_cost_services, 'cost.fixed_cost_services', [
    'minimum_function_instances',
    'external_load_balancer',
    'forwarding_rule',
    'cloud_armor',
    'vpc_connector',
    'cloud_nat',
    'analytics',
  ]);
  for (const field of Object.keys(fixed)) exact(fixed[field], false, `cost.fixed_cost_services.${field}`);
}

function validateTerraform(value) {
  const terraform = record(value, 'terraform', [
    'state',
    'supported_workflow',
    'configuration_apply_capable',
    'active_cloud_workflow',
    'workflow_blueprint_state',
    'bootstrap_root',
    'foundation_root',
    'automation_root',
    'terraform_version',
    'providers',
    'backend',
    'identity',
    'saved_plan',
    'apply_authorized',
    'destroy_authorized',
    'function_deployment_included',
    'offline_check_uses_mock_providers',
    'local_plan_requires_operator_confirmation',
    'local_plan_executed',
  ]);
  exact(terraform.state, 'bootstrap_foundation_and_automation_blueprint', 'terraform.state');
  exact(
    terraform.supported_workflow,
    'credential_free_validation_and_local_plan_only',
    'terraform.supported_workflow',
  );
  exact(terraform.configuration_apply_capable, true, 'terraform.configuration_apply_capable');
  exact(terraform.active_cloud_workflow, 'none', 'terraform.active_cloud_workflow');
  exact(terraform.workflow_blueprint_state, 'dormant_not_installed', 'terraform.workflow_blueprint_state');
  exact(terraform.bootstrap_root, 'bootstrap', 'terraform.bootstrap_root');
  exact(terraform.foundation_root, 'terraform', 'terraform.foundation_root');
  exact(terraform.automation_root, 'automation', 'terraform.automation_root');
  exact(terraform.terraform_version, '1.11.3', 'terraform.terraform_version');
  if (!Array.isArray(terraform.providers)) reject('terraform.providers', 'must be an array');
  if (terraform.providers.length !== 2) reject('terraform.providers', 'must contain exactly 2 entries');
  [
    ['hashicorp/google', '8.1.0'],
    ['hashicorp/google-beta', '8.1.0'],
  ].forEach(([source, version], index) => {
    const provider = record(terraform.providers[index], `terraform.providers[${index}]`, ['source', 'version']);
    exact(provider.source, source, `terraform.providers[${index}].source`);
    exact(provider.version, version, `terraform.providers[${index}].version`);
  });
  const backend = record(terraform.backend, 'terraform.backend', [
    'type',
    'state',
    'bucket',
    'bootstrap_prefix',
    'foundation_prefix',
    'bootstrap_migration_template',
    'bootstrap_migration_state',
    'locking_enabled',
    'object_versioning_enabled',
    'public_access_prevention',
  ]);
  exact(backend.type, 'gcs', 'terraform.backend.type');
  exact(backend.state, 'configured_bucket_not_created', 'terraform.backend.state');
  exact(backend.bucket, 'miakapp-v4-staging-tfstate-1072737219170', 'terraform.backend.bucket');
  exact(backend.bootstrap_prefix, 'terraform/bootstrap', 'terraform.backend.bootstrap_prefix');
  exact(backend.foundation_prefix, 'terraform/foundation', 'terraform.backend.foundation_prefix');
  exact(
    backend.bootstrap_migration_template,
    'bootstrap/backend.gcs.tf.example',
    'terraform.backend.bootstrap_migration_template',
  );
  exact(
    backend.bootstrap_migration_state,
    'template_not_activated',
    'terraform.backend.bootstrap_migration_state',
  );
  exact(backend.locking_enabled, true, 'terraform.backend.locking_enabled');
  exact(backend.object_versioning_enabled, true, 'terraform.backend.object_versioning_enabled');
  exact(backend.public_access_prevention, 'enforced', 'terraform.backend.public_access_prevention');

  const identity = record(terraform.identity, 'terraform.identity', [
    'state',
    'workload_identity_pool',
    'planner_service_account',
    'deployer_service_account',
    'runtime_service_account',
    'component_bucket',
    'service_account_keys_allowed',
    'bootstrap_state_write_allowed',
    'deployer_project_iam_mutation_allowed',
    'deployer_service_account_administration_allowed',
    'deployer_project_wide_storage_administration_allowed',
    'deployer_component_bucket_administration_allowed',
    'planner_initial_foundation_state_creation_allowed',
    'planner_foundation_state_replacement_allowed',
    'planner_foundation_lock_administration_allowed',
    'deployer_foundation_state_replacement_allowed',
    'planner_write_prefixes',
    'deployer_write_prefixes',
    'github_repository_id',
    'github_repository_owner_id',
  ]);
  exact(identity.state, 'configured_not_created', 'terraform.identity.state');
  exact(identity.workload_identity_pool, 'miakapp-github', 'terraform.identity.workload_identity_pool');
  exact(
    identity.planner_service_account,
    'miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com',
    'terraform.identity.planner_service_account',
  );
  exact(
    identity.deployer_service_account,
    'miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com',
    'terraform.identity.deployer_service_account',
  );
  exact(
    identity.runtime_service_account,
    'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
    'terraform.identity.runtime_service_account',
  );
  exact(
    identity.component_bucket,
    'miakapp-v4-staging-components',
    'terraform.identity.component_bucket',
  );
  exact(identity.service_account_keys_allowed, false, 'terraform.identity.service_account_keys_allowed');
  exact(identity.bootstrap_state_write_allowed, false, 'terraform.identity.bootstrap_state_write_allowed');
  exact(
    identity.deployer_project_iam_mutation_allowed,
    false,
    'terraform.identity.deployer_project_iam_mutation_allowed',
  );
  exact(
    identity.deployer_service_account_administration_allowed,
    false,
    'terraform.identity.deployer_service_account_administration_allowed',
  );
  exact(
    identity.deployer_project_wide_storage_administration_allowed,
    false,
    'terraform.identity.deployer_project_wide_storage_administration_allowed',
  );
  exact(
    identity.deployer_component_bucket_administration_allowed,
    true,
    'terraform.identity.deployer_component_bucket_administration_allowed',
  );
  exact(
    identity.planner_initial_foundation_state_creation_allowed,
    false,
    'terraform.identity.planner_initial_foundation_state_creation_allowed',
  );
  exact(
    identity.planner_foundation_state_replacement_allowed,
    false,
    'terraform.identity.planner_foundation_state_replacement_allowed',
  );
  exact(
    identity.planner_foundation_lock_administration_allowed,
    true,
    'terraform.identity.planner_foundation_lock_administration_allowed',
  );
  exact(
    identity.deployer_foundation_state_replacement_allowed,
    true,
    'terraform.identity.deployer_foundation_state_replacement_allowed',
  );
  exactArray(
    identity.planner_write_prefixes,
    ['terraform/foundation/*.tflock', 'plans/'],
    'terraform.identity.planner_write_prefixes',
  );
  exactArray(
    identity.deployer_write_prefixes,
    ['terraform/foundation/'],
    'terraform.identity.deployer_write_prefixes',
  );
  exact(identity.github_repository_id, '354682190', 'terraform.identity.github_repository_id');
  exact(identity.github_repository_owner_id, '83046838', 'terraform.identity.github_repository_owner_id');

  const savedPlan = record(terraform.saved_plan, 'terraform.saved_plan', [
    'state',
    'public_artifacts_allowed',
    'create_only',
    'sha256_verified_before_apply',
    'live_retention_days',
    'archived_retention_days',
    'soft_delete_days',
  ]);
  exact(savedPlan.state, 'private_gcs_blueprint_not_active', 'terraform.saved_plan.state');
  exact(savedPlan.public_artifacts_allowed, false, 'terraform.saved_plan.public_artifacts_allowed');
  exact(savedPlan.create_only, true, 'terraform.saved_plan.create_only');
  exact(savedPlan.sha256_verified_before_apply, true, 'terraform.saved_plan.sha256_verified_before_apply');
  exact(savedPlan.live_retention_days, 2, 'terraform.saved_plan.live_retention_days');
  exact(savedPlan.archived_retention_days, 1, 'terraform.saved_plan.archived_retention_days');
  exact(savedPlan.soft_delete_days, 7, 'terraform.saved_plan.soft_delete_days');

  exact(terraform.apply_authorized, false, 'terraform.apply_authorized');
  exact(terraform.destroy_authorized, false, 'terraform.destroy_authorized');
  exact(terraform.function_deployment_included, false, 'terraform.function_deployment_included');
  exact(terraform.offline_check_uses_mock_providers, true, 'terraform.offline_check_uses_mock_providers');
  exact(
    terraform.local_plan_requires_operator_confirmation,
    true,
    'terraform.local_plan_requires_operator_confirmation',
  );
  exact(terraform.local_plan_executed, false, 'terraform.local_plan_executed');
}

function validateReadiness(value) {
  const readiness = record(value, 'readiness', ['cloud_actions_enabled', 'required_blockers']);
  exact(readiness.cloud_actions_enabled, false, 'readiness.cloud_actions_enabled');
  exactArray(readiness.required_blockers, REQUIRED_BLOCKERS, 'readiness.required_blockers');
}

function validateEvidence(value) {
  const evidence = record(value, 'evidence', [
    'manifest_check_command',
    'local_gate_command',
    'terraform_check_command',
    'bootstrap_plan_script',
    'live_plan_script',
    'automation_blueprint',
    'github_policy',
    'github_policy_observation_verified',
    'cloud_credentials_required',
    'live_plan_cloud_credentials_required',
    'ci_may_authenticate',
    'active_cloud_workflow_present',
    'staging_rows',
    'fault_matrix',
    'production_security_boundary',
    'production_composition_boundary',
    'environment_decision',
  ]);
  exact(evidence.manifest_check_command, 'npm run test:staging-manifest', 'evidence.manifest_check_command');
  exact(evidence.local_gate_command, 'npm run test:control-plane-emulator', 'evidence.local_gate_command');
  exact(evidence.terraform_check_command, 'npm run test:staging-manifest', 'evidence.terraform_check_command');
  exact(evidence.bootstrap_plan_script, 'bootstrap/plan.sh', 'evidence.bootstrap_plan_script');
  exact(evidence.live_plan_script, 'terraform/plan.sh', 'evidence.live_plan_script');
  exact(evidence.automation_blueprint, 'automation/staging-terraform.yml', 'evidence.automation_blueprint');
  exact(evidence.github_policy, 'automation/github-policy.json', 'evidence.github_policy');
  exact(
    evidence.github_policy_observation_verified,
    true,
    'evidence.github_policy_observation_verified',
  );
  exact(evidence.cloud_credentials_required, false, 'evidence.cloud_credentials_required');
  exact(
    evidence.live_plan_cloud_credentials_required,
    true,
    'evidence.live_plan_cloud_credentials_required',
  );
  exact(evidence.ci_may_authenticate, false, 'evidence.ci_may_authenticate');
  exact(evidence.active_cloud_workflow_present, false, 'evidence.active_cloud_workflow_present');
  exactArray(evidence.staging_rows, STAGING_ROWS, 'evidence.staging_rows');
  exact(evidence.fault_matrix, '../../control-plane/FAULT-MATRIX.md', 'evidence.fault_matrix');
  exact(
    evidence.production_security_boundary,
    '../../control-plane/test/unit/cloud-security.test.ts',
    'evidence.production_security_boundary',
  );
  exact(
    evidence.production_composition_boundary,
    '../../control-plane/test/unit/production-runtime.test.ts',
    'evidence.production_composition_boundary',
  );
  exact(
    evidence.environment_decision,
    '../../docs/operations/2026-09-01-miakapp-v4-environments.md',
    'evidence.environment_decision',
  );
}

function validateTeardown(value) {
  const teardown = record(value, 'teardown', [
    'runbook',
    'automated',
    'manual_project_id_confirmation',
    'inventory_after_teardown',
  ]);
  exact(teardown.runbook, 'TEARDOWN.md', 'teardown.runbook');
  exact(teardown.automated, false, 'teardown.automated');
  exact(teardown.manual_project_id_confirmation, true, 'teardown.manual_project_id_confirmation');
  exactArray(teardown.inventory_after_teardown, TEARDOWN_INVENTORY, 'teardown.inventory_after_teardown');
}

export function validateStagingManifest(value) {
  const manifest = record(value, 'manifest', [
    'schema',
    'revision',
    'status',
    'environment',
    'project',
    'bootstrap',
    'locations',
    'services',
    'runtime',
    'data',
    'security',
    'cost',
    'terraform',
    'readiness',
    'evidence',
    'teardown',
  ]);
  exact(manifest.schema, 'miakapp.staging-intent/1', 'manifest.schema');
  exact(manifest.revision, 10, 'manifest.revision');
  exact(
    manifest.status,
    'github_security_configured_keyless_blueprint_unbilled',
    'manifest.status',
  );
  exact(manifest.environment, 'staging', 'manifest.environment');
  validateProject(manifest.project);
  validateBootstrap(manifest.bootstrap);
  validateLocations(manifest.locations);
  validateServices(manifest.services);
  validateRuntime(manifest.runtime);
  validateData(manifest.data);
  validateSecurity(manifest.security);
  validateCost(manifest.cost);
  validateTerraform(manifest.terraform);
  validateReadiness(manifest.readiness);
  validateEvidence(manifest.evidence);
  validateTeardown(manifest.teardown);
  return manifest;
}

export function validateFirebaseRc(value) {
  const firebaseRc = record(value, '.firebaserc', ['projects']);
  const projects = record(firebaseRc.projects, '.firebaserc.projects', ['default']);
  exact(projects.default, 'miakapp-3', '.firebaserc.projects.default');
  return firebaseRc;
}

function readBoundedJson(path, maximumBytes) {
  const size = statSync(path).size;
  if (size > maximumBytes) throw new StagingManifestError(`${path} exceeds ${maximumBytes} bytes`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new StagingManifestError(`${path} is not valid JSON`);
  }
  return parsed;
}

export function validateStagingManifestFile(manifestPath, firebaseRcPath = fileURLToPath(new URL('../../.firebaserc', import.meta.url))) {
  const manifest = readBoundedJson(manifestPath, MAX_MANIFEST_BYTES);
  const firebaseRc = readBoundedJson(firebaseRcPath, 4 * 1024);
  validateStagingManifest(manifest);
  validateFirebaseRc(firebaseRc);
  return manifest;
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node infrastructure/staging/validate.mjs <manifest.json>\n');
    process.exitCode = 2;
  } else {
    try {
      const manifest = validateStagingManifestFile(resolve(process.argv[2]));
      process.stdout.write(`Validated ${manifest.schema} for ${manifest.project.project_id}; cloud actions remain disabled.\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      process.stderr.write(`Staging manifest rejected: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
