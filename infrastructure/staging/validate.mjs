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
  'billingbudgets.googleapis.com',
  'bigquery.googleapis.com',
  'bigqueryconnection.googleapis.com',
  'bigquerydatapolicy.googleapis.com',
  'bigquerydatatransfer.googleapis.com',
  'bigquerymigration.googleapis.com',
  'bigqueryreservation.googleapis.com',
  'bigquerystorage.googleapis.com',
  'cloudbilling.googleapis.com',
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
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
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
  'sts.googleapis.com',
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

const LOCAL_PLAN_POST_CHECKS = [
  'billing-linked-to-approved-account',
  'enabled-services-unchanged',
  'project-iam-unchanged',
  'bucket-inventory-unchanged',
  'target-buckets-absent',
  'target-service-accounts-absent',
  'workload-identity-pool-absent',
];

const SUPERSEDED_SAVED_PLAN_POST_CHECKS = [
  'billing-linked-to-approved-account',
  'repository-plan-and-state-artifacts-absent',
  'recovery-state-preserved-private',
  'target-budget-absent',
  'eight-bootstrap-apis-enabled',
  'target-buckets-absent',
  'target-service-accounts-absent',
  'workload-identity-pool-absent',
];

const CURRENT_SAVED_PLAN_POST_CHECKS = [
  'billing-linked-to-approved-account',
  'repository-plan-and-state-artifacts-absent',
  'recovery-state-verified-unchanged',
  'target-budget-absent',
  'eight-bootstrap-apis-enabled',
  'target-buckets-absent',
  'target-service-accounts-absent',
  'workload-identity-pool-absent',
  'remote-state-absent',
];

const RECOVERY_MANAGED_ADDRESSES = [
  'google_billing_project_info.staging',
  'google_project_service.bootstrap["billingbudgets.googleapis.com"]',
  'google_project_service.bootstrap["cloudbilling.googleapis.com"]',
  'google_project_service.bootstrap["cloudresourcemanager.googleapis.com"]',
  'google_project_service.bootstrap["iam.googleapis.com"]',
  'google_project_service.bootstrap["iamcredentials.googleapis.com"]',
  'google_project_service.bootstrap["serviceusage.googleapis.com"]',
  'google_project_service.bootstrap["storage.googleapis.com"]',
  'google_project_service.bootstrap["sts.googleapis.com"]',
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
  exact(project.lifecycle, 'firebase_enabled_billing_linked_undeployed', 'project.lifecycle');
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
  exact(bootstrap.observed_on, '2026-09-03', 'bootstrap.observed_on');
  exact(bootstrap.billing_enabled, true, 'bootstrap.billing_enabled');
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
    'terraform_management_state',
  ]);
  exact(billingAccount.selection_state, 'approved', 'cost.billing_account.selection_state');
  exact(
    billingAccount.identifier_sha256,
    '4557923f1be719b78ee844b14bfa4654be3eb3fa785a2cb5a2624c3f85d12270',
    'cost.billing_account.identifier_sha256',
  );
  exact(billingAccount.raw_identifier_committed, false, 'cost.billing_account.raw_identifier_committed');
  exact(
    billingAccount.link_state,
    'linked_to_approved_account',
    'cost.billing_account.link_state',
  );
  exact(
    billingAccount.terraform_management_state,
    'preserved_in_private_local_recovery_state',
    'cost.billing_account.terraform_management_state',
  );
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
    'bootstrap_execution',
    'apply_authorized',
    'destroy_authorized',
    'function_deployment_included',
    'offline_check_uses_mock_providers',
    'local_plan_requires_operator_confirmation',
    'local_plan_executed',
    'local_plan_observation',
    'local_saved_plan_observation',
    'superseded_saved_plan_observation',
  ]);
  exact(terraform.state, 'bootstrap_foundation_and_automation_blueprint', 'terraform.state');
  exact(
    terraform.supported_workflow,
    'credential_free_validation_and_guarded_bootstrap_execution',
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

  const bootstrapExecution = record(terraform.bootstrap_execution, 'terraform.bootstrap_execution', [
    'state',
    'script',
    'helper',
    'approved_configuration_commit',
    'approved_plan_sha256',
    'exact_authorization_required',
    'repository_commit_bound',
    'cloud_preflight_required',
    'budget_preflight_requires_quota_project',
    'budget_postcondition_required',
    'recovery_state',
    'local_recovery_preserved_on_failure',
    'local_state_removed_only_after_reconciliation',
    'authorized_plan_attempted',
    'attempts',
    'bootstrap_completed',
  ]);
  exact(
    bootstrapExecution.state,
    'recovery_plan_reviewed_awaiting_exact_authorization',
    'terraform.bootstrap_execution.state',
  );
  exact(
    bootstrapExecution.script,
    'bootstrap/apply-and-migrate.sh',
    'terraform.bootstrap_execution.script',
  );
  exact(
    bootstrapExecution.helper,
    'bootstrap/bootstrap-execution.mjs',
    'terraform.bootstrap_execution.helper',
  );
  exact(
    bootstrapExecution.approved_configuration_commit,
    'e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501',
    'terraform.bootstrap_execution.approved_configuration_commit',
  );
  exact(
    bootstrapExecution.approved_plan_sha256,
    '12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da',
    'terraform.bootstrap_execution.approved_plan_sha256',
  );
  exact(
    bootstrapExecution.exact_authorization_required,
    true,
    'terraform.bootstrap_execution.exact_authorization_required',
  );
  exact(
    bootstrapExecution.repository_commit_bound,
    true,
    'terraform.bootstrap_execution.repository_commit_bound',
  );
  exact(
    bootstrapExecution.cloud_preflight_required,
    true,
    'terraform.bootstrap_execution.cloud_preflight_required',
  );
  exact(
    bootstrapExecution.budget_preflight_requires_quota_project,
    true,
    'terraform.bootstrap_execution.budget_preflight_requires_quota_project',
  );
  exact(
    bootstrapExecution.budget_postcondition_required,
    true,
    'terraform.bootstrap_execution.budget_postcondition_required',
  );
  const recoveryState = record(
    bootstrapExecution.recovery_state,
    'terraform.bootstrap_execution.recovery_state',
    [
      'state',
      'sha256',
      'lineage_sha256',
      'terraform_version',
      'serial',
      'managed_resources',
      'managed_addresses',
      'path_committed',
      'raw_contents_committed',
    ],
  );
  exact(
    recoveryState.state,
    'preserved_private_local',
    'terraform.bootstrap_execution.recovery_state.state',
  );
  exact(
    recoveryState.sha256,
    '07fc7412e35efaff288e2efd30f786c2871d9fa836fb813a178d247ccb1efe5a',
    'terraform.bootstrap_execution.recovery_state.sha256',
  );
  exact(
    recoveryState.lineage_sha256,
    '35e52294057979e6191eaa05141a9476261d4b0ea75c9113128f780abda7a9ba',
    'terraform.bootstrap_execution.recovery_state.lineage_sha256',
  );
  exact(
    recoveryState.terraform_version,
    '1.11.3',
    'terraform.bootstrap_execution.recovery_state.terraform_version',
  );
  exact(recoveryState.serial, 11, 'terraform.bootstrap_execution.recovery_state.serial');
  exact(
    recoveryState.managed_resources,
    9,
    'terraform.bootstrap_execution.recovery_state.managed_resources',
  );
  exactArray(
    recoveryState.managed_addresses,
    RECOVERY_MANAGED_ADDRESSES,
    'terraform.bootstrap_execution.recovery_state.managed_addresses',
  );
  exact(
    recoveryState.path_committed,
    false,
    'terraform.bootstrap_execution.recovery_state.path_committed',
  );
  exact(
    recoveryState.raw_contents_committed,
    false,
    'terraform.bootstrap_execution.recovery_state.raw_contents_committed',
  );
  exact(
    bootstrapExecution.local_recovery_preserved_on_failure,
    true,
    'terraform.bootstrap_execution.local_recovery_preserved_on_failure',
  );
  exact(
    bootstrapExecution.local_state_removed_only_after_reconciliation,
    true,
    'terraform.bootstrap_execution.local_state_removed_only_after_reconciliation',
  );
  exact(
    bootstrapExecution.authorized_plan_attempted,
    true,
    'terraform.bootstrap_execution.authorized_plan_attempted',
  );
  if (!Array.isArray(bootstrapExecution.attempts) || bootstrapExecution.attempts.length !== 2) {
    reject('terraform.bootstrap_execution.attempts', 'must contain exactly 2 entries');
  }
  const expectedAttempts = [
    {
      configuration_commit: 'c192f97959833f53a19d4e6dc50b26292c88b3b5',
      execution_commit: null,
      plan_sha256: '0918d21c4677ce0958be9ccc43057d8d76a33857fdfbea066120ba953e30b5c1',
      attempted_on: '2026-09-03',
      result: 'billing_association_quota_before_resource_creation',
      managed_resources_recorded: 0,
      enabled_bootstrap_apis_recorded: 0,
      recovery_state_sha256: null,
      remote_state_migrated: false,
    },
    {
      configuration_commit: '6340bffbddcc4797067ef48170fc5c3524345bf2',
      execution_commit: 'c3028c74d582c4f405f93e15ae0cf60898181728',
      plan_sha256: '6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457',
      attempted_on: '2026-09-03',
      result: 'budget_quota_project_missing_after_partial_apply',
      managed_resources_recorded: 9,
      enabled_bootstrap_apis_recorded: 8,
      recovery_state_sha256: '07fc7412e35efaff288e2efd30f786c2871d9fa836fb813a178d247ccb1efe5a',
      remote_state_migrated: false,
    },
  ];
  bootstrapExecution.attempts.forEach((value, index) => {
    const path = `terraform.bootstrap_execution.attempts[${index}]`;
    const attempt = record(value, path, Object.keys(expectedAttempts[index]));
    for (const [field, expected] of Object.entries(expectedAttempts[index])) {
      exact(attempt[field], expected, `${path}.${field}`);
    }
  });
  exact(
    bootstrapExecution.bootstrap_completed,
    false,
    'terraform.bootstrap_execution.bootstrap_completed',
  );

  exact(terraform.apply_authorized, false, 'terraform.apply_authorized');
  exact(terraform.destroy_authorized, false, 'terraform.destroy_authorized');
  exact(terraform.function_deployment_included, false, 'terraform.function_deployment_included');
  exact(terraform.offline_check_uses_mock_providers, true, 'terraform.offline_check_uses_mock_providers');
  exact(
    terraform.local_plan_requires_operator_confirmation,
    true,
    'terraform.local_plan_requires_operator_confirmation',
  );
  exact(terraform.local_plan_executed, true, 'terraform.local_plan_executed');

  const observation = record(terraform.local_plan_observation, 'terraform.local_plan_observation', [
    'observed_on',
    'configuration_commit',
    'result',
    'resource_counts',
    'saved_plan_created',
    'apply_executed',
    'local_state_artifacts_created',
    'post_plan_checks',
  ]);
  exact(observation.observed_on, '2026-09-03', 'terraform.local_plan_observation.observed_on');
  exact(
    observation.configuration_commit,
    '9b3905bb62718b57456b0658386b424ed635e82f',
    'terraform.local_plan_observation.configuration_commit',
  );

  const result = record(observation.result, 'terraform.local_plan_observation.result', [
    'add',
    'change',
    'destroy',
  ]);
  exact(result.add, 36, 'terraform.local_plan_observation.result.add');
  exact(result.change, 0, 'terraform.local_plan_observation.result.change');
  exact(result.destroy, 0, 'terraform.local_plan_observation.result.destroy');

  const resourceCounts = record(
    observation.resource_counts,
    'terraform.local_plan_observation.resource_counts',
    [
      'billing_and_budget',
      'service_apis',
      'storage_buckets',
      'service_accounts',
      'workload_identity_pool_and_providers',
      'iam_bindings',
    ],
  );
  exact(resourceCounts.billing_and_budget, 2, 'terraform.local_plan_observation.resource_counts.billing_and_budget');
  exact(resourceCounts.service_apis, 8, 'terraform.local_plan_observation.resource_counts.service_apis');
  exact(resourceCounts.storage_buckets, 2, 'terraform.local_plan_observation.resource_counts.storage_buckets');
  exact(resourceCounts.service_accounts, 3, 'terraform.local_plan_observation.resource_counts.service_accounts');
  exact(
    resourceCounts.workload_identity_pool_and_providers,
    3,
    'terraform.local_plan_observation.resource_counts.workload_identity_pool_and_providers',
  );
  exact(resourceCounts.iam_bindings, 18, 'terraform.local_plan_observation.resource_counts.iam_bindings');
  exact(observation.saved_plan_created, false, 'terraform.local_plan_observation.saved_plan_created');
  exact(observation.apply_executed, false, 'terraform.local_plan_observation.apply_executed');
  exact(
    observation.local_state_artifacts_created,
    false,
    'terraform.local_plan_observation.local_state_artifacts_created',
  );
  exactArray(
    observation.post_plan_checks,
    LOCAL_PLAN_POST_CHECKS,
    'terraform.local_plan_observation.post_plan_checks',
  );

  const currentSavedPlanPath = 'terraform.local_saved_plan_observation';
  const currentSavedPlan = record(
    terraform.local_saved_plan_observation,
    currentSavedPlanPath,
    [
      'observed_on',
      'created_at',
      'configuration_commit',
      'terraform_version',
      'plan_sha256',
      'backend',
      'recovery_state',
      'result',
      'resource_counts',
      'private_bundle_outside_repository',
      'private_bundle_path_committed',
      'planned_values_committed',
      'raw_billing_account_identifier_committed',
      'binary_digest_verified',
      'binary_plan_matches_metadata',
      'full_plan_reviewed',
      'billing_link_no_op',
      'bootstrap_apis_no_op',
      'planning_state_artifacts_created',
      'recovery_state_unchanged',
      'apply_authorized',
      'apply_executed',
      'state_migration_authorized',
      'state_migration_executed',
      'post_inspection_checks',
    ],
  );
  exact(currentSavedPlan.observed_on, '2026-09-03', `${currentSavedPlanPath}.observed_on`);
  exact(
    currentSavedPlan.created_at,
    '2026-09-03T11:47:02Z',
    `${currentSavedPlanPath}.created_at`,
  );
  exact(
    currentSavedPlan.configuration_commit,
    'e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501',
    `${currentSavedPlanPath}.configuration_commit`,
  );
  exact(currentSavedPlan.terraform_version, '1.11.3', `${currentSavedPlanPath}.terraform_version`);
  exact(
    currentSavedPlan.plan_sha256,
    '12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da',
    `${currentSavedPlanPath}.plan_sha256`,
  );
  exact(currentSavedPlan.backend, 'local', `${currentSavedPlanPath}.backend`);

  const currentRecoveryPath = `${currentSavedPlanPath}.recovery_state`;
  const currentRecovery = record(
    currentSavedPlan.recovery_state,
    currentRecoveryPath,
    ['sha256', 'lineage_sha256', 'serial', 'managed_resources'],
  );
  exact(
    currentRecovery.sha256,
    '07fc7412e35efaff288e2efd30f786c2871d9fa836fb813a178d247ccb1efe5a',
    `${currentRecoveryPath}.sha256`,
  );
  exact(
    currentRecovery.lineage_sha256,
    '35e52294057979e6191eaa05141a9476261d4b0ea75c9113128f780abda7a9ba',
    `${currentRecoveryPath}.lineage_sha256`,
  );
  exact(currentRecovery.serial, 11, `${currentRecoveryPath}.serial`);
  exact(currentRecovery.managed_resources, 9, `${currentRecoveryPath}.managed_resources`);

  const currentResultPath = `${currentSavedPlanPath}.result`;
  const currentResult = record(
    currentSavedPlan.result,
    currentResultPath,
    ['create', 'no_op', 'import', 'update', 'delete'],
  );
  exact(currentResult.create, 27, `${currentResultPath}.create`);
  exact(currentResult.no_op, 9, `${currentResultPath}.no_op`);
  exact(currentResult.import, 0, `${currentResultPath}.import`);
  exact(currentResult.update, 0, `${currentResultPath}.update`);
  exact(currentResult.delete, 0, `${currentResultPath}.delete`);

  const currentCountsPath = `${currentSavedPlanPath}.resource_counts`;
  const currentCounts = record(
    currentSavedPlan.resource_counts,
    currentCountsPath,
    [
      'billing_and_budget',
      'service_apis',
      'storage_buckets',
      'service_accounts',
      'workload_identity_pool_and_providers',
      'iam_bindings',
    ],
  );
  exact(currentCounts.billing_and_budget, 2, `${currentCountsPath}.billing_and_budget`);
  exact(currentCounts.service_apis, 8, `${currentCountsPath}.service_apis`);
  exact(currentCounts.storage_buckets, 2, `${currentCountsPath}.storage_buckets`);
  exact(currentCounts.service_accounts, 3, `${currentCountsPath}.service_accounts`);
  exact(
    currentCounts.workload_identity_pool_and_providers,
    3,
    `${currentCountsPath}.workload_identity_pool_and_providers`,
  );
  exact(currentCounts.iam_bindings, 18, `${currentCountsPath}.iam_bindings`);

  const currentBooleanExpectations = {
    private_bundle_outside_repository: true,
    private_bundle_path_committed: false,
    planned_values_committed: false,
    raw_billing_account_identifier_committed: false,
    binary_digest_verified: true,
    binary_plan_matches_metadata: true,
    full_plan_reviewed: true,
    billing_link_no_op: true,
    bootstrap_apis_no_op: true,
    planning_state_artifacts_created: false,
    recovery_state_unchanged: true,
    apply_authorized: false,
    apply_executed: false,
    state_migration_authorized: false,
    state_migration_executed: false,
  };
  for (const [field, expected] of Object.entries(currentBooleanExpectations)) {
    exact(currentSavedPlan[field], expected, `${currentSavedPlanPath}.${field}`);
  }
  exactArray(
    currentSavedPlan.post_inspection_checks,
    CURRENT_SAVED_PLAN_POST_CHECKS,
    `${currentSavedPlanPath}.post_inspection_checks`,
  );

  const savedObservation = record(
    terraform.superseded_saved_plan_observation,
    'terraform.superseded_saved_plan_observation',
    [
      'observed_on',
      'created_at',
      'configuration_commit',
      'terraform_version',
      'plan_sha256',
      'result',
      'resource_counts',
      'private_bundle_outside_repository',
      'private_bundle_path_committed',
      'planned_values_committed',
      'raw_billing_account_identifier_committed',
      'binary_digest_verified',
      'binary_plan_matches_metadata',
      'full_plan_reviewed',
      'billing_import_preserves_account',
      'billing_update_cloud_api_expected',
      'local_state_artifacts_created',
      'apply_authorized',
      'apply_executed',
      'state_migration_authorized',
      'state_migration_executed',
      'post_inspection_checks',
    ],
  );
  exact(savedObservation.observed_on, '2026-09-03', 'terraform.local_saved_plan_observation.observed_on');
  exact(
    savedObservation.created_at,
    '2026-09-03T01:00:18Z',
    'terraform.local_saved_plan_observation.created_at',
  );
  exact(
    savedObservation.configuration_commit,
    '6340bffbddcc4797067ef48170fc5c3524345bf2',
    'terraform.local_saved_plan_observation.configuration_commit',
  );
  exact(
    savedObservation.terraform_version,
    '1.11.3',
    'terraform.local_saved_plan_observation.terraform_version',
  );
  exact(
    savedObservation.plan_sha256,
    '6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457',
    'terraform.local_saved_plan_observation.plan_sha256',
  );

  const savedResult = record(savedObservation.result, 'terraform.local_saved_plan_observation.result', [
    'create',
    'import',
    'update',
    'delete',
  ]);
  exact(savedResult.create, 35, 'terraform.local_saved_plan_observation.result.create');
  exact(savedResult.import, 1, 'terraform.local_saved_plan_observation.result.import');
  exact(savedResult.update, 1, 'terraform.local_saved_plan_observation.result.update');
  exact(savedResult.delete, 0, 'terraform.local_saved_plan_observation.result.delete');

  const savedResourceCounts = record(
    savedObservation.resource_counts,
    'terraform.local_saved_plan_observation.resource_counts',
    [
      'billing_and_budget',
      'service_apis',
      'storage_buckets',
      'service_accounts',
      'workload_identity_pool_and_providers',
      'iam_bindings',
    ],
  );
  exact(
    savedResourceCounts.billing_and_budget,
    2,
    'terraform.local_saved_plan_observation.resource_counts.billing_and_budget',
  );
  exact(
    savedResourceCounts.service_apis,
    8,
    'terraform.local_saved_plan_observation.resource_counts.service_apis',
  );
  exact(
    savedResourceCounts.storage_buckets,
    2,
    'terraform.local_saved_plan_observation.resource_counts.storage_buckets',
  );
  exact(
    savedResourceCounts.service_accounts,
    3,
    'terraform.local_saved_plan_observation.resource_counts.service_accounts',
  );
  exact(
    savedResourceCounts.workload_identity_pool_and_providers,
    3,
    'terraform.local_saved_plan_observation.resource_counts.workload_identity_pool_and_providers',
  );
  exact(
    savedResourceCounts.iam_bindings,
    18,
    'terraform.local_saved_plan_observation.resource_counts.iam_bindings',
  );
  exact(
    savedObservation.private_bundle_outside_repository,
    true,
    'terraform.local_saved_plan_observation.private_bundle_outside_repository',
  );
  exact(
    savedObservation.private_bundle_path_committed,
    false,
    'terraform.local_saved_plan_observation.private_bundle_path_committed',
  );
  exact(
    savedObservation.planned_values_committed,
    false,
    'terraform.local_saved_plan_observation.planned_values_committed',
  );
  exact(
    savedObservation.raw_billing_account_identifier_committed,
    false,
    'terraform.local_saved_plan_observation.raw_billing_account_identifier_committed',
  );
  exact(
    savedObservation.binary_digest_verified,
    true,
    'terraform.local_saved_plan_observation.binary_digest_verified',
  );
  exact(
    savedObservation.binary_plan_matches_metadata,
    true,
    'terraform.local_saved_plan_observation.binary_plan_matches_metadata',
  );
  exact(
    savedObservation.full_plan_reviewed,
    true,
    'terraform.local_saved_plan_observation.full_plan_reviewed',
  );
  exact(
    savedObservation.billing_import_preserves_account,
    true,
    'terraform.local_saved_plan_observation.billing_import_preserves_account',
  );
  exact(
    savedObservation.billing_update_cloud_api_expected,
    false,
    'terraform.local_saved_plan_observation.billing_update_cloud_api_expected',
  );
  exact(
    savedObservation.local_state_artifacts_created,
    true,
    'terraform.local_saved_plan_observation.local_state_artifacts_created',
  );
  exact(savedObservation.apply_authorized, true, 'terraform.local_saved_plan_observation.apply_authorized');
  exact(savedObservation.apply_executed, true, 'terraform.local_saved_plan_observation.apply_executed');
  exact(
    savedObservation.state_migration_authorized,
    true,
    'terraform.local_saved_plan_observation.state_migration_authorized',
  );
  exact(
    savedObservation.state_migration_executed,
    false,
    'terraform.local_saved_plan_observation.state_migration_executed',
  );
  exactArray(
    savedObservation.post_inspection_checks,
    SUPERSEDED_SAVED_PLAN_POST_CHECKS,
    'terraform.local_saved_plan_observation.post_inspection_checks',
  );
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
  exact(manifest.revision, 20, 'manifest.revision');
  exact(
    manifest.status,
    'bootstrap_recovery_plan_reviewed_awaiting_authorization',
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
