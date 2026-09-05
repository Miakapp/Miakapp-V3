import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { BOOTSTRAP_RESOURCE_ADDRESSES } from './bootstrap/saved-plan.mjs';
import { validateAuthProbeEvidence } from './auth-probe/evidence.mjs';
import { validateFirebaseAuthEvidence } from './firebase-auth/evidence.mjs';
import { validateProbeEvidence } from './probe/evidence.mjs';
import { validateWorkloadEvidence } from './workload/evidence.mjs';

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
  'cloud-workflows',
];

const SERVICE_STATES = [
  'initialized_closed_custom_token_lifecycle_validated',
  'admin_custom_provider_validated_browser_attestation_pending',
  'foundation_created_no_application_mutation',
  'private_deployment_active_source_verified_user_relay_acceptance_pending',
  'private_bucket_created_no_application_mutation',
  'signing_key_version_enabled_public_key_validated',
  'five_initial_versions_enabled_runtime_access_validated',
  'api_enabled_one_permission_runtime_role_applied_uninvoked',
  'api_enabled_runtime_deployed_no_application_log_validation',
  'api_enabled_runtime_deployed_no_metric_validation',
  'api_enabled_historical_probes_retired_user_relay_acceptance_pending',
];

const ENABLED_SERVICE_APIS = [
  'analyticshub.googleapis.com',
  'appengine.googleapis.com',
  'artifactregistry.googleapis.com',
  'bigquery.googleapis.com',
  'bigqueryconnection.googleapis.com',
  'bigquerydatapolicy.googleapis.com',
  'bigquerydatatransfer.googleapis.com',
  'bigquerymigration.googleapis.com',
  'bigqueryreservation.googleapis.com',
  'bigquerystorage.googleapis.com',
  'billingbudgets.googleapis.com',
  'cloudapis.googleapis.com',
  'cloudbilling.googleapis.com',
  'cloudbuild.googleapis.com',
  'cloudfunctions.googleapis.com',
  'cloudkms.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'cloudtrace.googleapis.com',
  'containerregistry.googleapis.com',
  'dataform.googleapis.com',
  'dataplex.googleapis.com',
  'datastore.googleapis.com',
  'eventarc.googleapis.com',
  'fcm.googleapis.com',
  'firebase.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'firebasehosting.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseremoteconfig.googleapis.com',
  'firebaseremoteconfigrealtime.googleapis.com',
  'firebaserules.googleapis.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'pubsub.googleapis.com',
  'run.googleapis.com',
  'runtimeconfig.googleapis.com',
  'secretmanager.googleapis.com',
  'securetoken.googleapis.com',
  'servicemanagement.googleapis.com',
  'serviceusage.googleapis.com',
  'source.googleapis.com',
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
  'app-check-browser-provider-attestation',
  'audience-bound-user-relay-staging-acceptance',
  'relay-token-refresh-integration',
  'trusted-source-and-edge-admission',
  'live-managed-service-fault-matrix',
  'monitoring-and-billing-alert-validation',
  'secret-and-signing-key-rotation-rehearsal',
  'migration-rehearsal',
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
  'target-budget-present-once',
  'eight-bootstrap-apis-enabled',
  'target-buckets-present-once',
  'target-service-accounts-present-once',
  'workload-identity-pool-and-providers-present-once',
  'complete-local-state-verified',
  'remote-state-object-present-once',
  'remote-state-canonically-reconciled',
];

const TEARDOWN_INVENTORY = [
  'cloud-functions-and-cloud-run-revisions',
  'eventarc-triggers',
  'workflows-probe-executions-schedules-and-api',
  'firebase-app-registrations-and-app-check-providers',
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
  exact(
    project.lifecycle,
    'firebase_auth_initialized_private_control_plane_user_relay_acceptance_pending',
    'project.lifecycle',
  );
  exact(project.creation_authorized, false, 'project.creation_authorized');
  exact(project.billing_link_authorized, false, 'project.billing_link_authorized');
  exact(project.deployment_authorized, true, 'project.deployment_authorized');
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
    'budget_display_names',
    'workload_identity_pools',
    'workload_identity_providers',
    'workload_identity_provider_states',
    'enabled_service_apis',
  ]);
  exact(bootstrap.observed_on, '2026-09-04', 'bootstrap.observed_on');
  exact(bootstrap.billing_enabled, true, 'bootstrap.billing_enabled');
  exact(bootstrap.firebase_apps, 1, 'bootstrap.firebase_apps');
  exact(bootstrap.hosting_site, 'miakapp-v4-staging', 'bootstrap.hosting_site');
  exact(bootstrap.app_engine_application, false, 'bootstrap.app_engine_application');
  for (const field of ['cloud_functions', 'cloud_run_services']) {
    exactArray(bootstrap[field], [], `bootstrap.${field}`);
  }
  exactArray(bootstrap.firestore_databases, ['(default)'], 'bootstrap.firestore_databases');
  exactArray(
    bootstrap.kms_key_rings,
    ['projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging'],
    'bootstrap.kms_key_rings',
  );
  exactArray(
    bootstrap.secrets,
    [
      'miakapp-audit-hmac',
      'miakapp-component-hmac',
      'miakapp-home-key-pepper',
      'miakapp-network-hmac',
      'miakapp-push-hmac',
    ],
    'bootstrap.secrets',
  );
  exactArray(
    bootstrap.storage_buckets,
    ['miakapp-v4-staging-components', 'miakapp-v4-staging-tfstate-1072737219170'],
    'bootstrap.storage_buckets',
  );
  exactArray(
    bootstrap.project_service_accounts,
    [
      'firebase-adminsdk-fbsvc@miakapp-v4-staging.iam.gserviceaccount.com',
      'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
      'miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com',
      'miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com',
    ],
    'bootstrap.project_service_accounts',
  );
  exactArray(
    bootstrap.budget_display_names,
    ['Miakapp V4 staging monthly'],
    'bootstrap.budget_display_names',
  );
  exactArray(
    bootstrap.workload_identity_pools,
    ['projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github'],
    'bootstrap.workload_identity_pools',
  );
  exactArray(
    bootstrap.workload_identity_providers,
    [
      'projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply',
      'projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan',
    ],
    'bootstrap.workload_identity_providers',
  );
  const workloadIdentityProviderStates = record(
    bootstrap.workload_identity_provider_states,
    'bootstrap.workload_identity_provider_states',
    ['staging-apply', 'staging-plan'],
  );
  exact(
    workloadIdentityProviderStates['staging-apply'],
    'disabled',
    'bootstrap.workload_identity_provider_states.staging-apply',
  );
  exact(
    workloadIdentityProviderStates['staging-plan'],
    'disabled',
    'bootstrap.workload_identity_provider_states.staging-plan',
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
    exact(service.state, SERVICE_STATES[index], `services[${index}].state`);
  });
}

function validateRuntime(value) {
  const runtime = record(value, 'runtime', [
    'function_name',
    'resource_name',
    'generation',
    'region',
    'deployment_state',
    'service',
    'revision',
    'uri',
    'minimum_instances',
    'maximum_instances',
    'concurrency',
    'timeout_seconds',
    'dedicated_service_account',
    'allow_unauthenticated',
    'ingress',
    'source_archive_sha256',
    'runtime_config_sha256',
    'user_managed_keys',
    'live_request_performed',
  ]);
  exact(runtime.function_name, 'controlPlane', 'runtime.function_name');
  exact(
    runtime.resource_name,
    'projects/miakapp-v4-staging/locations/europe-west9/functions/control-plane',
    'runtime.resource_name',
  );
  exact(runtime.generation, 2, 'runtime.generation');
  exact(runtime.region, 'europe-west9', 'runtime.region');
  exact(runtime.deployment_state, 'ACTIVE', 'runtime.deployment_state');
  exact(
    runtime.service,
    'projects/miakapp-v4-staging/locations/europe-west9/services/control-plane',
    'runtime.service',
  );
  exact(runtime.revision, 'control-plane-00004-yis', 'runtime.revision');
  exact(runtime.uri, 'https://control-plane-aczhngqraq-od.a.run.app', 'runtime.uri');
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
  exact(runtime.ingress, 'ALLOW_INTERNAL_ONLY', 'runtime.ingress');
  exact(
    runtime.source_archive_sha256,
    '6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e',
    'runtime.source_archive_sha256',
  );
  exact(
    runtime.runtime_config_sha256,
    'b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8',
    'runtime.runtime_config_sha256',
  );
  exact(runtime.user_managed_keys, 0, 'runtime.user_managed_keys');
  exact(runtime.live_request_performed, false, 'runtime.live_request_performed');
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
  exact(kms.state, 'created_initial_version_enabled', 'security.kms.state');
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
      'enabled_versions',
      'replication',
      'version_policy_state',
      'maximum_active_versions',
      'consumer',
    ]);
    exact(secret.id, id, `security.secrets[${index}].id`);
    exact(secret.state, 'initial_version_1_enabled', `security.secrets[${index}].state`);
    exactArray(secret.enabled_versions, [1], `security.secrets[${index}].enabled_versions`);
    exact(secret.replication, 'automatic', `security.secrets[${index}].replication`);
    exact(
      secret.version_policy_state,
      'initialized_rotation_not_implemented',
      `security.secrets[${index}].version_policy_state`,
    );
    exact(secret.maximum_active_versions, 2, `security.secrets[${index}].maximum_active_versions`);
    exact(secret.consumer, 'control-plane-runtime', `security.secrets[${index}].consumer`);
  });

  const iam = record(security.iam, 'security.iam', [
    'runtime_identity_state',
    'foundation_resource_bindings_state',
    'broad_project_roles_forbidden',
    'human_runtime_bindings_forbidden',
    'resource_bindings',
    'unresolved_permissions',
  ]);
  exact(
    iam.runtime_identity_state,
    'private_runtime_deployed_zero_user_managed_keys',
    'security.iam.runtime_identity_state',
  );
  exact(
    iam.foundation_resource_bindings_state,
    'complete_eight_recovery_bindings_present',
    'security.iam.foundation_resource_bindings_state',
  );
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
  exactArray(iam.unresolved_permissions, [], 'security.iam.unresolved_permissions');
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
    'managed_in_reconciled_remote_bootstrap_state',
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
    'workload_root',
    'probe_root',
    'firebase_auth_root',
    'auth_probe_root',
    'terraform_version',
    'providers',
    'backend',
    'identity',
    'saved_plan',
    'bootstrap_execution',
    'foundation_state_initialization',
    'foundation_live_plan_observation',
    'foundation_saved_plan_observation',
    'foundation_apply_observation',
    'foundation_recovery_plan_observation',
    'foundation_recovery_apply_observation',
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
  exact(
    terraform.state,
    'bootstrap_foundation_workload_probe_and_firebase_auth_converged_auth_probe_acceptance_pending',
    'terraform.state',
  );
  exact(
    terraform.supported_workflow,
    'guarded_private_saved_plans_applied_and_converged',
    'terraform.supported_workflow',
  );
  exact(terraform.configuration_apply_capable, true, 'terraform.configuration_apply_capable');
  exact(
    terraform.active_cloud_workflow,
    'unscheduled_private_probe_retained',
    'terraform.active_cloud_workflow',
  );
  exact(
    terraform.workflow_blueprint_state,
    'retired_recovery_blueprint_retained_as_evidence',
    'terraform.workflow_blueprint_state',
  );
  exact(terraform.bootstrap_root, 'bootstrap', 'terraform.bootstrap_root');
  exact(terraform.foundation_root, 'terraform', 'terraform.foundation_root');
  exact(terraform.automation_root, 'automation', 'terraform.automation_root');
  exact(terraform.workload_root, 'workload', 'terraform.workload_root');
  exact(terraform.probe_root, 'probe', 'terraform.probe_root');
  exact(terraform.firebase_auth_root, 'firebase-auth', 'terraform.firebase_auth_root');
  exact(terraform.auth_probe_root, 'auth-probe', 'terraform.auth_probe_root');
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
    'workload_prefix',
    'probe_prefix',
    'firebase_auth_prefix',
    'auth_probe_prefix',
    'bootstrap_migration_template',
    'bootstrap_migration_state',
    'locking_enabled',
    'object_versioning_enabled',
    'public_access_prevention',
  ]);
  exact(backend.type, 'gcs', 'terraform.backend.type');
  exact(
    backend.state,
    'all_six_terraform_state_roots_present',
    'terraform.backend.state',
  );
  exact(backend.bucket, 'miakapp-v4-staging-tfstate-1072737219170', 'terraform.backend.bucket');
  exact(backend.bootstrap_prefix, 'terraform/bootstrap', 'terraform.backend.bootstrap_prefix');
  exact(backend.foundation_prefix, 'terraform/foundation', 'terraform.backend.foundation_prefix');
  exact(backend.workload_prefix, 'terraform/workload', 'terraform.backend.workload_prefix');
  exact(backend.probe_prefix, 'terraform/probe', 'terraform.backend.probe_prefix');
  exact(
    backend.firebase_auth_prefix,
    'terraform/firebase-auth',
    'terraform.backend.firebase_auth_prefix',
  );
  exact(backend.auth_probe_prefix, 'terraform/auth-probe', 'terraform.backend.auth_probe_prefix');
  exact(
    backend.bootstrap_migration_template,
    'bootstrap/backend.gcs.tf.example',
    'terraform.backend.bootstrap_migration_template',
  );
  exact(
    backend.bootstrap_migration_state,
    'complete_remote_state_reconciled',
    'terraform.backend.bootstrap_migration_state',
  );
  exact(backend.locking_enabled, true, 'terraform.backend.locking_enabled');
  exact(backend.object_versioning_enabled, true, 'terraform.backend.object_versioning_enabled');
  exact(backend.public_access_prevention, 'enforced', 'terraform.backend.public_access_prevention');

  const identity = record(terraform.identity, 'terraform.identity', [
    'state',
    'workload_identity_pool',
    'workload_identity_pool_state',
    'plan_provider_state',
    'apply_provider_state',
    'reviewed_github_oidc_exchange_allowed',
    'planner_service_account',
    'deployer_service_account',
    'runtime_service_account',
    'component_bucket',
    'service_account_keys_allowed',
    'bootstrap_state_write_allowed',
    'planner_service_usage_consumer_allowed',
    'planner_service_usage_consumer_state',
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
  exact(
    identity.state,
    'planner_and_deployer_exercised_recovery_wif_providers_disabled',
    'terraform.identity.state',
  );
  exact(identity.workload_identity_pool, 'miakapp-github', 'terraform.identity.workload_identity_pool');
  exact(
    identity.workload_identity_pool_state,
    'enabled_retained',
    'terraform.identity.workload_identity_pool_state',
  );
  exact(identity.plan_provider_state, 'disabled', 'terraform.identity.plan_provider_state');
  exact(identity.apply_provider_state, 'disabled', 'terraform.identity.apply_provider_state');
  exact(
    identity.reviewed_github_oidc_exchange_allowed,
    false,
    'terraform.identity.reviewed_github_oidc_exchange_allowed',
  );
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
    identity.planner_service_usage_consumer_allowed,
    true,
    'terraform.identity.planner_service_usage_consumer_allowed',
  );
  exact(
    identity.planner_service_usage_consumer_state,
    'managed_in_reconciled_remote_bootstrap_state',
    'terraform.identity.planner_service_usage_consumer_state',
  );
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
  exact(
    savedPlan.state,
    'consumed_recovery_plan_soft_deleted_recoverable',
    'terraform.saved_plan.state',
  );
  exact(savedPlan.public_artifacts_allowed, false, 'terraform.saved_plan.public_artifacts_allowed');
  exact(savedPlan.create_only, true, 'terraform.saved_plan.create_only');
  exact(savedPlan.sha256_verified_before_apply, true, 'terraform.saved_plan.sha256_verified_before_apply');
  exact(savedPlan.live_retention_days, 2, 'terraform.saved_plan.live_retention_days');
  exact(savedPlan.archived_retention_days, 1, 'terraform.saved_plan.archived_retention_days');
  exact(savedPlan.soft_delete_days, 7, 'terraform.saved_plan.soft_delete_days');

  const bootstrapExecution = record(terraform.bootstrap_execution, 'terraform.bootstrap_execution', [
    'state',
    'script',
    'retired_apply_script',
    'helper',
    'approved_configuration_commit',
    'approved_plan_sha256',
    'migration_configuration_commit',
    'reconciliation_configuration_commit',
    'exact_authorization_required',
    'repository_commit_bound',
    'cloud_preflight_required',
    'budget_preflight_requires_quota_project',
    'provisioned_target_preflight_required',
    'migration_only',
    'apply_entry_point_retired',
    'recovery_state',
    'remote_state',
    'planner_role_adoption_observation',
    'recovery_federation_retirement_observation',
    'source_state_preserved_on_failure',
    'source_state_preserved_after_reconciliation',
    'authorized_plan_attempted',
    'attempts',
    'migration_attempts',
    'bootstrap_completed',
  ]);
  exact(
    bootstrapExecution.state,
    'bootstrap_complete_state_reconciled_planner_role_adopted_and_recovery_wif_disabled',
    'terraform.bootstrap_execution.state',
  );
  exact(
    bootstrapExecution.script,
    'bootstrap/migrate-recovered-state.sh',
    'terraform.bootstrap_execution.script',
  );
  exact(
    bootstrapExecution.retired_apply_script,
    'bootstrap/apply-and-migrate.sh',
    'terraform.bootstrap_execution.retired_apply_script',
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
    bootstrapExecution.migration_configuration_commit,
    'b2daada96d4f5f669bb80fd3cdfc0e0f9fb48286',
    'terraform.bootstrap_execution.migration_configuration_commit',
  );
  exact(
    bootstrapExecution.reconciliation_configuration_commit,
    '23d80ec55fcac9cd4cef968ce674fe413306319e',
    'terraform.bootstrap_execution.reconciliation_configuration_commit',
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
    bootstrapExecution.provisioned_target_preflight_required,
    true,
    'terraform.bootstrap_execution.provisioned_target_preflight_required',
  );
  exact(bootstrapExecution.migration_only, true, 'terraform.bootstrap_execution.migration_only');
  exact(
    bootstrapExecution.apply_entry_point_retired,
    true,
    'terraform.bootstrap_execution.apply_entry_point_retired',
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
    'preserved_private_complete_local',
    'terraform.bootstrap_execution.recovery_state.state',
  );
  exact(
    recoveryState.sha256,
    'c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2',
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
  exact(recoveryState.serial, 39, 'terraform.bootstrap_execution.recovery_state.serial');
  exact(
    recoveryState.managed_resources,
    36,
    'terraform.bootstrap_execution.recovery_state.managed_resources',
  );
  exactArray(
    recoveryState.managed_addresses,
    BOOTSTRAP_RESOURCE_ADDRESSES,
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
  const remoteState = record(
    bootstrapExecution.remote_state,
    'terraform.bootstrap_execution.remote_state',
    [
      'state',
      'bucket',
      'object',
      'generation',
      'sha256',
      'size_bytes',
      'terraform_version',
      'serial',
      'managed_resources',
      'data_resources',
      'outputs',
      'lineage_sha256',
      'initial_migration_reconciliation',
      'initialization_generation',
      'raw_contents_committed',
    ],
  );
  exact(
    remoteState.state,
    'migrated_reconciled_planner_role_adopted_and_recovery_wif_disabled',
    'terraform.bootstrap_execution.remote_state.state',
  );
  exact(
    remoteState.bucket,
    'miakapp-v4-staging-tfstate-1072737219170',
    'terraform.bootstrap_execution.remote_state.bucket',
  );
  exact(
    remoteState.object,
    'terraform/bootstrap/default.tfstate',
    'terraform.bootstrap_execution.remote_state.object',
  );
  exact(
    remoteState.generation,
    '1788460174191027',
    'terraform.bootstrap_execution.remote_state.generation',
  );
  exact(
    remoteState.sha256,
    '288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d',
    'terraform.bootstrap_execution.remote_state.sha256',
  );
  exact(remoteState.size_bytes, 61864, 'terraform.bootstrap_execution.remote_state.size_bytes');
  exact(remoteState.terraform_version, '1.11.3', 'terraform.bootstrap_execution.remote_state.terraform_version');
  exact(remoteState.serial, 42, 'terraform.bootstrap_execution.remote_state.serial');
  exact(remoteState.managed_resources, 37, 'terraform.bootstrap_execution.remote_state.managed_resources');
  exact(remoteState.data_resources, 2, 'terraform.bootstrap_execution.remote_state.data_resources');
  exact(remoteState.outputs, 1, 'terraform.bootstrap_execution.remote_state.outputs');
  exact(
    remoteState.lineage_sha256,
    '35e52294057979e6191eaa05141a9476261d4b0ea75c9113128f780abda7a9ba',
    'terraform.bootstrap_execution.remote_state.lineage_sha256',
  );
  const initialMigrationPath = 'terraform.bootstrap_execution.remote_state.initial_migration_reconciliation';
  const initialMigration = record(
    remoteState.initial_migration_reconciliation,
    initialMigrationPath,
    [
      'state',
      'generation',
      'sha256',
      'size_bytes',
      'terraform_version',
      'serial',
      'managed_resources',
      'source_recovery_serial',
      'canonical_serial_increment',
      'check_results_exact_permutation',
      'remainder_exactly_equal',
    ],
  );
  const initialMigrationExpectations = {
    state: 'initial_bootstrap_migration_reconciled',
    generation: '1788439334043522',
    sha256: '8753dcceaa848ba8734d9892dbec6f2445fbf6b3fbead7da375cc37f0702d3bf',
    size_bytes: 60909,
    terraform_version: '1.11.3',
    serial: 40,
    managed_resources: 36,
    source_recovery_serial: 39,
    canonical_serial_increment: 1,
    check_results_exact_permutation: true,
    remainder_exactly_equal: true,
  };
  for (const [field, expected] of Object.entries(initialMigrationExpectations)) {
    exact(initialMigration[field], expected, `${initialMigrationPath}.${field}`);
  }
  const initializationGeneration = record(
    remoteState.initialization_generation,
    'terraform.bootstrap_execution.remote_state.initialization_generation',
    [
      'state',
      'generation',
      'sha256',
      'size_bytes',
      'serial',
      'managed_resources',
      'raw_contents_committed',
    ],
  );
  exact(
    initializationGeneration.state,
    'noncurrent_recoverable_empty_state',
    'terraform.bootstrap_execution.remote_state.initialization_generation.state',
  );
  exact(
    initializationGeneration.generation,
    '1788439333248171',
    'terraform.bootstrap_execution.remote_state.initialization_generation.generation',
  );
  exact(
    initializationGeneration.sha256,
    'cdf598e8ed07454850616c5059e7dcf3f0669c5aecd83c6cf224a32fe2a1398e',
    'terraform.bootstrap_execution.remote_state.initialization_generation.sha256',
  );
  exact(
    initializationGeneration.size_bytes,
    181,
    'terraform.bootstrap_execution.remote_state.initialization_generation.size_bytes',
  );
  exact(
    initializationGeneration.serial,
    1,
    'terraform.bootstrap_execution.remote_state.initialization_generation.serial',
  );
  exact(
    initializationGeneration.managed_resources,
    0,
    'terraform.bootstrap_execution.remote_state.initialization_generation.managed_resources',
  );
  exact(
    initializationGeneration.raw_contents_committed,
    false,
    'terraform.bootstrap_execution.remote_state.initialization_generation.raw_contents_committed',
  );
  exact(
    remoteState.raw_contents_committed,
    false,
    'terraform.bootstrap_execution.remote_state.raw_contents_committed',
  );

  const plannerAdoptionPath = 'terraform.bootstrap_execution.planner_role_adoption_observation';
  const plannerAdoption = record(
    bootstrapExecution.planner_role_adoption_observation,
    plannerAdoptionPath,
    [
      'observed_on',
      'configuration_commit',
      'terraform_version',
      'backend',
      'import_address',
      'import_id',
      'private_plan_sha256',
      'private_plan_size_bytes',
      'result',
      'state_before',
      'state_after',
      'project_iam_etag_before',
      'project_iam_etag_after',
      'project_iam_canonical_sha256_before',
      'project_iam_canonical_sha256_after',
      'project_iam_unchanged',
      'set_iam_policy_audit_entries',
      'normalized_state_remainder_sha256_before',
      'normalized_state_remainder_sha256_after',
      'check_results_exact_permutation',
      'state_remainder_exactly_equal',
      'follow_up_plan_exit_code',
      'follow_up_plan_result',
      'temporary_lock_released',
      'raw_plan_committed',
      'raw_state_committed',
    ],
  );
  const plannerAdoptionExpectations = {
    observed_on: '2026-09-03',
    configuration_commit: 'c5ff539af5598f4cc91eef9753ff90bfa5502974',
    terraform_version: '1.11.3',
    backend: 'gcs',
    import_address: 'google_project_iam_member.planner["roles/serviceusage.serviceUsageConsumer"]',
    import_id: 'miakapp-v4-staging roles/serviceusage.serviceUsageConsumer serviceAccount:miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com',
    private_plan_sha256: '0bab71811fa5dc8d084c47e3938accb8cf4421da4264edb8665bee1989895d6f',
    private_plan_size_bytes: 24405,
    project_iam_etag_before: 'BwZalzR1TWY=',
    project_iam_etag_after: 'BwZalzR1TWY=',
    project_iam_canonical_sha256_before: '5aa86bdfc2df0f42627afbd4822f56ad1f7e889a6bcab7271858691421ee6b5d',
    project_iam_canonical_sha256_after: '5aa86bdfc2df0f42627afbd4822f56ad1f7e889a6bcab7271858691421ee6b5d',
    project_iam_unchanged: true,
    set_iam_policy_audit_entries: 0,
    normalized_state_remainder_sha256_before: '1869481d2084c66d3db043d24b0667788ae9c10ffde272c3154bd9f1167e9de3',
    normalized_state_remainder_sha256_after: '1869481d2084c66d3db043d24b0667788ae9c10ffde272c3154bd9f1167e9de3',
    check_results_exact_permutation: true,
    state_remainder_exactly_equal: true,
    follow_up_plan_exit_code: 0,
    follow_up_plan_result: 'no_changes',
    temporary_lock_released: true,
    raw_plan_committed: false,
    raw_state_committed: false,
  };
  for (const [field, expected] of Object.entries(plannerAdoptionExpectations)) {
    exact(plannerAdoption[field], expected, `${plannerAdoptionPath}.${field}`);
  }
  const plannerAdoptionResult = record(
    plannerAdoption.result,
    `${plannerAdoptionPath}.result`,
    ['import', 'add', 'change', 'destroy'],
  );
  for (const [field, expected] of Object.entries({
    import: 1, add: 0, change: 0, destroy: 0,
  })) {
    exact(plannerAdoptionResult[field], expected, `${plannerAdoptionPath}.result.${field}`);
  }
  const adoptionStateKeys = [
    'generation',
    'sha256',
    'size_bytes',
    'serial',
    'managed_resources',
    'data_resources',
    'outputs',
  ];
  const adoptionStateExpectations = {
    state_before: {
      generation: '1788439334043522',
      sha256: '8753dcceaa848ba8734d9892dbec6f2445fbf6b3fbead7da375cc37f0702d3bf',
      size_bytes: 60909,
      serial: 40,
      managed_resources: 36,
      data_resources: 2,
      outputs: 1,
    },
    state_after: {
      generation: '1788457646215552',
      sha256: '7833a4a298ba87c9a116cfcf2c48d4a82b1babd706516e35162d358397136544',
      size_bytes: 61910,
      serial: 41,
      managed_resources: 37,
      data_resources: 2,
      outputs: 1,
    },
  };
  for (const [stateName, expectations] of Object.entries(adoptionStateExpectations)) {
    const statePath = `${plannerAdoptionPath}.${stateName}`;
    const state = record(plannerAdoption[stateName], statePath, adoptionStateKeys);
    for (const [field, expected] of Object.entries(expectations)) {
      exact(state[field], expected, `${statePath}.${field}`);
    }
  }

  const federationRetirementPath = 'terraform.bootstrap_execution.recovery_federation_retirement_observation';
  const federationRetirement = record(
    bootstrapExecution.recovery_federation_retirement_observation,
    federationRetirementPath,
    [
      'observed_on',
      'configuration_commit',
      'terraform_version',
      'backend',
      'private_plan_sha256',
      'private_plan_size_bytes',
      'plan_result',
      'changes',
      'only_disabled_attribute_changed',
      'workload_identity_pool_state_after',
      'apply_completed',
      'apply_result',
      'state_before',
      'state_after',
      'state_lineage_sha256_before',
      'state_lineage_sha256_after',
      'state_lineage_unchanged',
      'iam_hash_profile',
      'project_iam_normalized_sha256_before',
      'project_iam_normalized_sha256_after',
      'planner_service_account_iam_normalized_sha256_before',
      'planner_service_account_iam_normalized_sha256_after',
      'deployer_service_account_iam_normalized_sha256_before',
      'deployer_service_account_iam_normalized_sha256_after',
      'project_iam_unchanged',
      'planner_service_account_iam_unchanged',
      'deployer_service_account_iam_unchanged',
      'follow_up_plan_exit_code',
      'follow_up_plan_result',
      'temporary_lock_released',
      'raw_plan_committed',
      'raw_state_committed',
    ],
  );
  const federationRetirementExpectations = {
    observed_on: '2026-09-03',
    configuration_commit: 'ee457535a64355cd8133410d9c8c43f039608928',
    terraform_version: '1.11.3',
    backend: 'gcs',
    private_plan_sha256: '8f570dfe5450b704112d484f058fc6dfcd39069a92c8bb483c5029027183e888',
    private_plan_size_bytes: 25925,
    only_disabled_attribute_changed: true,
    workload_identity_pool_state_after: 'enabled_retained',
    apply_completed: true,
    state_lineage_sha256_before: '35e52294057979e6191eaa05141a9476261d4b0ea75c9113128f780abda7a9ba',
    state_lineage_sha256_after: '35e52294057979e6191eaa05141a9476261d4b0ea75c9113128f780abda7a9ba',
    state_lineage_unchanged: true,
    iam_hash_profile: 'jq_compact_key_sorted_json_without_etag',
    project_iam_normalized_sha256_before: '7aeffa3819cb67be2a241bdf1e29f04fc3e9a7af9e412786ae7174eb00859f10',
    project_iam_normalized_sha256_after: '7aeffa3819cb67be2a241bdf1e29f04fc3e9a7af9e412786ae7174eb00859f10',
    planner_service_account_iam_normalized_sha256_before: '0123aa229345a8351d737f9e140bd0891c6a6bd5be177df9c93520f9cd3347b4',
    planner_service_account_iam_normalized_sha256_after: '0123aa229345a8351d737f9e140bd0891c6a6bd5be177df9c93520f9cd3347b4',
    deployer_service_account_iam_normalized_sha256_before: 'fe1c653a9602756b3625cc2b34e838bd00217f635acf4adea4b1b98af0e06e8b',
    deployer_service_account_iam_normalized_sha256_after: 'fe1c653a9602756b3625cc2b34e838bd00217f635acf4adea4b1b98af0e06e8b',
    project_iam_unchanged: true,
    planner_service_account_iam_unchanged: true,
    deployer_service_account_iam_unchanged: true,
    follow_up_plan_exit_code: 0,
    follow_up_plan_result: 'no_changes',
    temporary_lock_released: true,
    raw_plan_committed: false,
    raw_state_committed: false,
  };
  for (const [field, expected] of Object.entries(federationRetirementExpectations)) {
    exact(federationRetirement[field], expected, `${federationRetirementPath}.${field}`);
  }
  const federationPlanResult = record(
    federationRetirement.plan_result,
    `${federationRetirementPath}.plan_result`,
    ['no_op', 'import', 'add', 'change', 'destroy'],
  );
  for (const [field, expected] of Object.entries({
    no_op: 35,
    import: 0,
    add: 0,
    change: 2,
    destroy: 0,
  })) {
    exact(federationPlanResult[field], expected, `${federationRetirementPath}.plan_result.${field}`);
  }
  const expectedFederationChanges = [
    'google_iam_workload_identity_pool_provider.apply',
    'google_iam_workload_identity_pool_provider.plan',
  ];
  if (!Array.isArray(federationRetirement.changes)
      || federationRetirement.changes.length !== expectedFederationChanges.length) {
    reject(
      `${federationRetirementPath}.changes`,
      `must contain exactly ${expectedFederationChanges.length} entries`,
    );
  }
  federationRetirement.changes.forEach((value, index) => {
    const path = `${federationRetirementPath}.changes[${index}]`;
    const change = record(value, path, ['address', 'attribute', 'before', 'after']);
    exact(change.address, expectedFederationChanges[index], `${path}.address`);
    exact(change.attribute, 'disabled', `${path}.attribute`);
    exact(change.before, false, `${path}.before`);
    exact(change.after, true, `${path}.after`);
  });
  const federationApplyResult = record(
    federationRetirement.apply_result,
    `${federationRetirementPath}.apply_result`,
    ['add', 'change', 'destroy'],
  );
  for (const [field, expected] of Object.entries({ add: 0, change: 2, destroy: 0 })) {
    exact(federationApplyResult[field], expected, `${federationRetirementPath}.apply_result.${field}`);
  }
  const federationStateExpectations = {
    state_before: {
      generation: '1788457646215552',
      sha256: '7833a4a298ba87c9a116cfcf2c48d4a82b1babd706516e35162d358397136544',
      size_bytes: 61910,
      serial: 41,
      managed_resources: 37,
      data_resources: 2,
      outputs: 1,
    },
    state_after: {
      generation: '1788460174191027',
      sha256: '288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d',
      size_bytes: 61864,
      serial: 42,
      managed_resources: 37,
      data_resources: 2,
      outputs: 1,
    },
  };
  for (const [stateName, expectations] of Object.entries(federationStateExpectations)) {
    const statePath = `${federationRetirementPath}.${stateName}`;
    const state = record(federationRetirement[stateName], statePath, adoptionStateKeys);
    for (const [field, expected] of Object.entries(expectations)) {
      exact(state[field], expected, `${statePath}.${field}`);
    }
  }
  exact(
    bootstrapExecution.source_state_preserved_on_failure,
    true,
    'terraform.bootstrap_execution.source_state_preserved_on_failure',
  );
  exact(
    bootstrapExecution.source_state_preserved_after_reconciliation,
    true,
    'terraform.bootstrap_execution.source_state_preserved_after_reconciliation',
  );
  exact(
    bootstrapExecution.authorized_plan_attempted,
    true,
    'terraform.bootstrap_execution.authorized_plan_attempted',
  );
  if (!Array.isArray(bootstrapExecution.attempts) || bootstrapExecution.attempts.length !== 3) {
    reject('terraform.bootstrap_execution.attempts', 'must contain exactly 3 entries');
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
    {
      configuration_commit: 'e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501',
      execution_commit: 'cbd8b63062b027eca762b0d23f234563760f846a',
      plan_sha256: '12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da',
      attempted_on: '2026-09-03',
      result: 'apply_complete_local_state_validation_mismatch_before_migration',
      managed_resources_recorded: 36,
      enabled_bootstrap_apis_recorded: 8,
      recovery_state_sha256: 'c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2',
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
  const expectedMigrationAttempts = [
    {
      execution_commit: 'd1d6b75e85dc365666479bd90c165ac674b8ba39',
      complete_state_sha256: 'c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2',
      attempted_on: '2026-09-03',
      result: 'empty_bucket_root_marker_schema_mismatch_before_backend_initialization',
      remote_state_migrated: false,
      remote_generation: null,
    },
    {
      execution_commit: '107bb23e8b546aca283105f4a9584343985576f6',
      complete_state_sha256: 'c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2',
      attempted_on: '2026-09-03',
      result: 'remote_state_written_then_canonically_reconciled',
      remote_state_migrated: true,
      remote_generation: '1788439334043522',
    },
  ];
  if (!Array.isArray(bootstrapExecution.migration_attempts)
      || bootstrapExecution.migration_attempts.length !== expectedMigrationAttempts.length) {
    reject(
      'terraform.bootstrap_execution.migration_attempts',
      `must contain exactly ${expectedMigrationAttempts.length} entries`,
    );
  }
  bootstrapExecution.migration_attempts.forEach((value, index) => {
    const path = `terraform.bootstrap_execution.migration_attempts[${index}]`;
    const attempt = record(value, path, Object.keys(expectedMigrationAttempts[index]));
    for (const [field, expected] of Object.entries(expectedMigrationAttempts[index])) {
      exact(attempt[field], expected, `${path}.${field}`);
    }
  });
  exact(
    bootstrapExecution.bootstrap_completed,
    true,
    'terraform.bootstrap_execution.bootstrap_completed',
  );

  const foundationStateInitialization = record(
    terraform.foundation_state_initialization,
    'terraform.foundation_state_initialization',
    [
      'state',
      'script',
      'helper',
      'approved_foundation_configuration_commit',
      'approved_initialization_configuration_commit',
      'exact_authorization_required',
      'authorization_bootstrap_generation',
      'repository_commit_bound',
      'clean_checkout_required',
      'private_execution_parent_required',
      'user_adc_required',
      'cloud_preflight_required',
      'expected_bootstrap_state',
      'observed_foundation_state',
      'initialization_method',
      'backend_initialization_state_write_expected',
      'post_initialization_plan',
      'refresh_only_saved_plan_required',
      'saved_plan_fingerprint_required',
      'saved_plan_apply_allowed',
      'temporary_lock_object_lifecycle_required',
      'manual_state_push_allowed',
      'overwrite_existing_state_allowed',
      'read_only_reconciliation_of_existing_exact_state_allowed',
      'final_generation_recheck_required',
      'initialization_authorized',
      'initialization_executed',
      'reconciliation_executed',
      'attempts',
    ],
  );
  const foundationStatePath = 'terraform.foundation_state_initialization';
  exact(
    foundationStateInitialization.state,
    'initialized_and_reconciled',
    `${foundationStatePath}.state`,
  );
  exact(
    foundationStateInitialization.script,
    'terraform/initialize-state.sh',
    `${foundationStatePath}.script`,
  );
  exact(
    foundationStateInitialization.helper,
    'terraform/foundation-state.mjs',
    `${foundationStatePath}.helper`,
  );
  exact(
    foundationStateInitialization.approved_foundation_configuration_commit,
    'efa877835dde2f5eedc3d950b2e4c514e606751d',
    `${foundationStatePath}.approved_foundation_configuration_commit`,
  );
  exact(
    foundationStateInitialization.approved_initialization_configuration_commit,
    '626dc16637ba843f6d1543156aba99e7b551e705',
    `${foundationStatePath}.approved_initialization_configuration_commit`,
  );
  for (const field of [
    'exact_authorization_required',
    'repository_commit_bound',
    'clean_checkout_required',
    'private_execution_parent_required',
    'user_adc_required',
    'cloud_preflight_required',
    'backend_initialization_state_write_expected',
    'refresh_only_saved_plan_required',
    'saved_plan_fingerprint_required',
    'temporary_lock_object_lifecycle_required',
    'read_only_reconciliation_of_existing_exact_state_allowed',
    'final_generation_recheck_required',
    'initialization_executed',
    'reconciliation_executed',
  ]) {
    exact(foundationStateInitialization[field], true, `${foundationStatePath}.${field}`);
  }
  for (const field of [
    'manual_state_push_allowed',
    'overwrite_existing_state_allowed',
    'saved_plan_apply_allowed',
    'initialization_authorized',
  ]) {
    exact(foundationStateInitialization[field], false, `${foundationStatePath}.${field}`);
  }
  exact(
    foundationStateInitialization.authorization_bootstrap_generation,
    '1788439334043522',
    `${foundationStatePath}.authorization_bootstrap_generation`,
  );
  const expectedBootstrapState = record(
    foundationStateInitialization.expected_bootstrap_state,
    `${foundationStatePath}.expected_bootstrap_state`,
    ['object', 'generation', 'sha256', 'size_bytes', 'serial', 'managed_resources'],
  );
  const bootstrapStateExpectations = {
    object: 'terraform/bootstrap/default.tfstate',
    generation: '1788439334043522',
    sha256: '8753dcceaa848ba8734d9892dbec6f2445fbf6b3fbead7da375cc37f0702d3bf',
    size_bytes: 60909,
    serial: 40,
    managed_resources: 36,
  };
  for (const [field, expected] of Object.entries(bootstrapStateExpectations)) {
    exact(expectedBootstrapState[field], expected, `${foundationStatePath}.expected_bootstrap_state.${field}`);
  }
  const observedFoundationState = record(
    foundationStateInitialization.observed_foundation_state,
    `${foundationStatePath}.observed_foundation_state`,
    [
      'object',
      'generation',
      'sha256',
      'size_bytes',
      'lineage_sha256',
      'terraform_version',
      'serial',
      'managed_resources',
      'outputs',
      'check_results',
      'raw_contents_committed',
    ],
  );
  const foundationStateExpectations = {
    object: 'terraform/foundation/default.tfstate',
    generation: '1788443136082489',
    sha256: '8a69b37495a7d11b1091a03e7659297adcb62ce853475ab032071888530e30cd',
    size_bytes: 181,
    lineage_sha256: '113390906103bdbefa4bac8b5d9549f7d867c38e8e9c4bef989977a12222c7d4',
    terraform_version: '1.11.3',
    serial: 1,
    managed_resources: 0,
    outputs: 0,
    check_results: null,
    raw_contents_committed: false,
  };
  for (const [field, expected] of Object.entries(foundationStateExpectations)) {
    exact(observedFoundationState[field], expected, `${foundationStatePath}.observed_foundation_state.${field}`);
  }
  exact(
    foundationStateInitialization.initialization_method,
    'terraform_init_gcs_backend',
    `${foundationStatePath}.initialization_method`,
  );

  const postInitializationPlan = record(
    foundationStateInitialization.post_initialization_plan,
    `${foundationStatePath}.post_initialization_plan`,
    [
      'execution_commit',
      'validated_with_implementation_commit',
      'sha256',
      'size_bytes',
      'terraform_version',
      'implicit_providers',
      'managed_resources',
      'applyable',
      'apply_executed',
      'raw_contents_committed',
    ],
  );
  const postInitializationPlanExpectations = {
    execution_commit: '2a612d62f16dbed4c05a677c1b7d43c00ed4e46f',
    validated_with_implementation_commit: '626dc16637ba843f6d1543156aba99e7b551e705',
    sha256: '5ef77e9f2107ea3a7b20b7c6dce865c6553cba51396e64e169a4418bb0e93859',
    size_bytes: 2869,
    terraform_version: '1.11.3',
    managed_resources: 0,
    applyable: false,
    apply_executed: false,
    raw_contents_committed: false,
  };
  for (const [field, expected] of Object.entries(postInitializationPlanExpectations)) {
    exact(postInitializationPlan[field], expected, `${foundationStatePath}.post_initialization_plan.${field}`);
  }
  exactArray(
    postInitializationPlan.implicit_providers,
    [
      'registry.terraform.io/hashicorp/google@8.1.0',
      'registry.terraform.io/hashicorp/google-beta@8.1.0',
    ],
    `${foundationStatePath}.post_initialization_plan.implicit_providers`,
  );

  const expectedInitializationAttempts = [
    {
      execution_commit: '2a612d62f16dbed4c05a677c1b7d43c00ed4e46f',
      attempted_on: '2026-09-03',
      result: 'backend_initialized_state_plan_schema_rejected_before_apply',
      remote_generation: '1788443136082489',
      state_reconciled: false,
      plan_applied: false,
    },
    {
      execution_commit: 'ab6f26bd5dd076a79847f989615e7fddf93f2a07',
      attempted_on: '2026-09-03',
      result: 'preexisting_exact_state_reconciled_without_mutation',
      remote_generation: '1788443136082489',
      state_reconciled: true,
      plan_applied: false,
    },
  ];
  if (!Array.isArray(foundationStateInitialization.attempts)
      || foundationStateInitialization.attempts.length !== expectedInitializationAttempts.length) {
    reject(
      `${foundationStatePath}.attempts`,
      `must contain exactly ${expectedInitializationAttempts.length} entries`,
    );
  }
  foundationStateInitialization.attempts.forEach((value, index) => {
    const path = `${foundationStatePath}.attempts[${index}]`;
    const attempt = record(value, path, Object.keys(expectedInitializationAttempts[index]));
    for (const [field, expected] of Object.entries(expectedInitializationAttempts[index])) {
      exact(attempt[field], expected, `${path}.${field}`);
    }
  });

  const foundationLivePlanPath = 'terraform.foundation_live_plan_observation';
  const foundationLivePlan = record(
    terraform.foundation_live_plan_observation,
    foundationLivePlanPath,
    [
      'observed_on',
      'configuration_commit',
      'terraform_version',
      'backend',
      'result',
      'data_reads',
      'resource_counts',
      'contains_workload',
      'contains_public_ingress',
      'contains_secret_versions',
      'contains_billing_resource',
      'saved_plan_created',
      'apply_executed',
      'state_generation_before',
      'state_generation_after',
      'state_sha256_before',
      'state_sha256_after',
      'state_unchanged',
      'temporary_lock_released',
      'full_plan_reviewed',
      'raw_planned_values_committed',
    ],
  );
  const foundationLivePlanExpectations = {
    observed_on: '2026-09-03',
    configuration_commit: '363d017ebdc85af1285e38c5742365fd0a2a4395',
    terraform_version: '1.11.3',
    backend: 'gcs',
    data_reads: 2,
    contains_workload: false,
    contains_public_ingress: false,
    contains_secret_versions: false,
    contains_billing_resource: false,
    saved_plan_created: false,
    apply_executed: false,
    state_generation_before: '1788443136082489',
    state_generation_after: '1788443136082489',
    state_sha256_before: '8a69b37495a7d11b1091a03e7659297adcb62ce853475ab032071888530e30cd',
    state_sha256_after: '8a69b37495a7d11b1091a03e7659297adcb62ce853475ab032071888530e30cd',
    state_unchanged: true,
    temporary_lock_released: true,
    full_plan_reviewed: true,
    raw_planned_values_committed: false,
  };
  for (const [field, expected] of Object.entries(foundationLivePlanExpectations)) {
    exact(foundationLivePlan[field], expected, `${foundationLivePlanPath}.${field}`);
  }
  const foundationLivePlanResult = record(
    foundationLivePlan.result,
    `${foundationLivePlanPath}.result`,
    ['create', 'update', 'delete'],
  );
  for (const [field, expected] of Object.entries({ create: 33, update: 0, delete: 0 })) {
    exact(foundationLivePlanResult[field], expected, `${foundationLivePlanPath}.result.${field}`);
  }
  const foundationLivePlanResourceCounts = record(
    foundationLivePlan.resource_counts,
    `${foundationLivePlanPath}.resource_counts`,
    [
      'bootstrap_guard',
      'service_apis',
      'firestore_database',
      'firestore_ttl_fields',
      'kms_key_ring_and_key',
      'kms_iam_bindings',
      'secret_containers',
      'secret_iam_bindings',
      'component_bucket_iam_bindings',
    ],
  );
  const foundationLivePlanResourceExpectations = {
    bootstrap_guard: 1,
    service_apis: 13,
    firestore_database: 1,
    firestore_ttl_fields: 3,
    kms_key_ring_and_key: 2,
    kms_iam_bindings: 1,
    secret_containers: 5,
    secret_iam_bindings: 5,
    component_bucket_iam_bindings: 2,
  };
  for (const [field, expected] of Object.entries(foundationLivePlanResourceExpectations)) {
    exact(
      foundationLivePlanResourceCounts[field],
      expected,
      `${foundationLivePlanPath}.resource_counts.${field}`,
    );
  }

  const foundationSavedPlanPath = 'terraform.foundation_saved_plan_observation';
  const foundationSavedPlan = record(
    terraform.foundation_saved_plan_observation,
    foundationSavedPlanPath,
    [
      'observed_on',
      'configuration_commit',
      'workflow_run_id',
      'workflow_run_attempt',
      'workflow_result',
      'terraform_version',
      'backend',
      'plan_object',
      'plan_generation',
      'plan_size_bytes',
      'plan_sha256',
      'result',
      'data_reads',
      'resource_counts',
      'contains_workload',
      'contains_public_ingress',
      'contains_secret_versions',
      'contains_billing_resource',
      'saved_plan_created',
      'saved_plan_private',
      'create_only_upload',
      'strict_validation_profile',
      'strict_validation_passed',
      'apply_executed',
      'state_generation_before',
      'state_generation_after',
      'state_sha256_before',
      'state_sha256_after',
      'state_unchanged',
      'temporary_lock_released',
      'full_plan_reviewed',
      'raw_planned_values_committed',
    ],
  );
  const foundationSavedPlanExpectations = {
    observed_on: '2026-09-03',
    configuration_commit: '66869a3564788ba725049cc91326b17eb239ddaf',
    workflow_run_id: '33774848684',
    workflow_run_attempt: 1,
    workflow_result: 'success',
    terraform_version: '1.11.3',
    backend: 'gcs',
    plan_object: 'gs://miakapp-v4-staging-tfstate-1072737219170/plans/66869a3564788ba725049cc91326b17eb239ddaf/33774848684/1/foundation.tfplan',
    plan_generation: '1788450586606804',
    plan_size_bytes: 11000,
    plan_sha256: '5def42ea3f598a5f2c59d9456814646c1b526526c6b96acf20a0db7626bc36da',
    data_reads: 2,
    contains_workload: false,
    contains_public_ingress: false,
    contains_secret_versions: false,
    contains_billing_resource: false,
    saved_plan_created: true,
    saved_plan_private: true,
    create_only_upload: true,
    strict_validation_profile: 'initial-foundation',
    strict_validation_passed: true,
    apply_executed: false,
    state_generation_before: '1788443136082489',
    state_generation_after: '1788443136082489',
    state_sha256_before: '8a69b37495a7d11b1091a03e7659297adcb62ce853475ab032071888530e30cd',
    state_sha256_after: '8a69b37495a7d11b1091a03e7659297adcb62ce853475ab032071888530e30cd',
    state_unchanged: true,
    temporary_lock_released: true,
    full_plan_reviewed: true,
    raw_planned_values_committed: false,
  };
  for (const [field, expected] of Object.entries(foundationSavedPlanExpectations)) {
    exact(foundationSavedPlan[field], expected, `${foundationSavedPlanPath}.${field}`);
  }
  const foundationSavedPlanResult = record(
    foundationSavedPlan.result,
    `${foundationSavedPlanPath}.result`,
    ['create', 'update', 'delete'],
  );
  for (const [field, expected] of Object.entries({ create: 33, update: 0, delete: 0 })) {
    exact(foundationSavedPlanResult[field], expected, `${foundationSavedPlanPath}.result.${field}`);
  }
  const foundationSavedPlanResourceCounts = record(
    foundationSavedPlan.resource_counts,
    `${foundationSavedPlanPath}.resource_counts`,
    Object.keys(foundationLivePlanResourceExpectations),
  );
  for (const [field, expected] of Object.entries(foundationLivePlanResourceExpectations)) {
    exact(
      foundationSavedPlanResourceCounts[field],
      expected,
      `${foundationSavedPlanPath}.resource_counts.${field}`,
    );
  }

  const foundationApplyPath = 'terraform.foundation_apply_observation';
  const foundationApply = record(
    terraform.foundation_apply_observation,
    foundationApplyPath,
    [
      'observed_on',
      'configuration_commit',
      'workflow_run_id',
      'workflow_run_attempt',
      'workflow_result',
      'environment_approval',
      'terraform_version',
      'backend',
      'plan_object',
      'plan_generation',
      'plan_size_bytes',
      'plan_sha256',
      'strict_validation_profile',
      'strict_validation_passed',
      'requested_result',
      'data_reads',
      'resource_counts',
      'contains_workload',
      'contains_public_ingress',
      'contains_secret_versions',
      'contains_billing_resource',
      'apply_attempted',
      'apply_completed',
      'failure_cause_known',
      'detailed_apply_log_retained',
      'state_before',
      'state_after',
      'state_changed',
      'temporary_lock_released',
      'firestore_ttl_operations_successful',
      'recovery_required',
    ],
  );
  const foundationApplyExpectations = {
    observed_on: '2026-09-03',
    configuration_commit: 'fe41490ec978722dabecbe50a183b7994a247648',
    workflow_run_id: '33776569977',
    workflow_run_attempt: 1,
    workflow_result: 'failure',
    environment_approval: 'approved',
    terraform_version: '1.11.3',
    backend: 'gcs',
    plan_object: 'gs://miakapp-v4-staging-tfstate-1072737219170/plans/fe41490ec978722dabecbe50a183b7994a247648/33776569977/1/foundation.tfplan',
    plan_generation: '1788451608568024',
    plan_size_bytes: 11001,
    plan_sha256: 'd7113280cfb86519c3fce4f68734a7733c1b0b766a677a1f50f0fd5fce98bf78',
    strict_validation_profile: 'initial-foundation',
    strict_validation_passed: true,
    data_reads: 2,
    contains_workload: false,
    contains_public_ingress: false,
    contains_secret_versions: false,
    contains_billing_resource: false,
    apply_attempted: true,
    apply_completed: false,
    failure_cause_known: false,
    detailed_apply_log_retained: false,
    state_changed: true,
    temporary_lock_released: true,
    firestore_ttl_operations_successful: true,
    recovery_required: true,
  };
  for (const [field, expected] of Object.entries(foundationApplyExpectations)) {
    exact(foundationApply[field], expected, `${foundationApplyPath}.${field}`);
  }
  const requestedResult = record(
    foundationApply.requested_result,
    `${foundationApplyPath}.requested_result`,
    ['create', 'update', 'delete'],
  );
  for (const [field, expected] of Object.entries({ create: 33, update: 0, delete: 0 })) {
    exact(requestedResult[field], expected, `${foundationApplyPath}.requested_result.${field}`);
  }
  const foundationApplyResourceCounts = record(
    foundationApply.resource_counts,
    `${foundationApplyPath}.resource_counts`,
    Object.keys(foundationLivePlanResourceExpectations),
  );
  for (const [field, expected] of Object.entries(foundationLivePlanResourceExpectations)) {
    exact(
      foundationApplyResourceCounts[field],
      expected,
      `${foundationApplyPath}.resource_counts.${field}`,
    );
  }
  const stateBeforeExpectations = {
    object: 'terraform/foundation/default.tfstate',
    generation: '1788443136082489',
    sha256: '8a69b37495a7d11b1091a03e7659297adcb62ce853475ab032071888530e30cd',
    size_bytes: 181,
    terraform_version: '1.11.3',
    serial: 1,
    managed_resources: 0,
    data_resources: 0,
    outputs: 0,
  };
  const stateBefore = record(
    foundationApply.state_before,
    `${foundationApplyPath}.state_before`,
    Object.keys(stateBeforeExpectations),
  );
  for (const [field, expected] of Object.entries(stateBeforeExpectations)) {
    exact(stateBefore[field], expected, `${foundationApplyPath}.state_before.${field}`);
  }
  const stateAfterExpectations = {
    object: 'terraform/foundation/default.tfstate',
    generation: '1788452068422403',
    sha256: '7729ee35a104ce04f918faa05cd47d4d37731baac96def6e8531b17175f721bb',
    size_bytes: 42621,
    lineage: '43307835-c5c6-d6b0-fdcc-af92fafde3c3',
    terraform_version: '1.11.3',
    serial: 4,
    managed_resources: 25,
    data_resources: 2,
    outputs: 0,
  };
  const stateAfter = record(
    foundationApply.state_after,
    `${foundationApplyPath}.state_after`,
    Object.keys(stateAfterExpectations),
  );
  for (const [field, expected] of Object.entries(stateAfterExpectations)) {
    exact(stateAfter[field], expected, `${foundationApplyPath}.state_after.${field}`);
  }

  const recoveryPlanPath = 'terraform.foundation_recovery_plan_observation';
  const recoveryPlan = record(
    terraform.foundation_recovery_plan_observation,
    recoveryPlanPath,
    [
      'observed_on',
      'configuration_commit',
      'terraform_version',
      'backend',
      'private_plan_sha256',
      'private_plan_size_bytes',
      'result',
      'data_reads',
      'resource_counts',
      'provider_refresh_drift_count',
      'provider_refresh_drift_types',
      'strict_validation_profile',
      'strict_validation_passed',
      'contains_workload',
      'contains_public_ingress',
      'contains_secret_versions',
      'contains_billing_resource',
      'private_saved_plan_created',
      'private_saved_plan_removed_after_validation',
      'apply_executed',
      'state_generation_before',
      'state_generation_after',
      'state_sha256_before',
      'state_sha256_after',
      'state_unchanged',
      'temporary_lock_released',
      'full_plan_reviewed',
      'raw_planned_values_committed',
    ],
  );
  const recoveryPlanExpectations = {
    observed_on: '2026-09-03',
    configuration_commit: 'fe41490ec978722dabecbe50a183b7994a247648',
    terraform_version: '1.11.3',
    backend: 'gcs',
    private_plan_sha256: 'b22920a8fd933ecc05298c9fd8f2565ed01cd5b33b96bf08b223360f3390b54a',
    private_plan_size_bytes: 18893,
    data_reads: 0,
    provider_refresh_drift_count: 7,
    strict_validation_profile: 'partial-foundation-recovery',
    strict_validation_passed: true,
    contains_workload: false,
    contains_public_ingress: false,
    contains_secret_versions: false,
    contains_billing_resource: false,
    private_saved_plan_created: true,
    private_saved_plan_removed_after_validation: true,
    apply_executed: false,
    state_generation_before: '1788452068422403',
    state_generation_after: '1788452068422403',
    state_sha256_before: '7729ee35a104ce04f918faa05cd47d4d37731baac96def6e8531b17175f721bb',
    state_sha256_after: '7729ee35a104ce04f918faa05cd47d4d37731baac96def6e8531b17175f721bb',
    state_unchanged: true,
    temporary_lock_released: true,
    full_plan_reviewed: true,
    raw_planned_values_committed: false,
  };
  for (const [field, expected] of Object.entries(recoveryPlanExpectations)) {
    exact(recoveryPlan[field], expected, `${recoveryPlanPath}.${field}`);
  }
  const recoveryResult = record(
    recoveryPlan.result,
    `${recoveryPlanPath}.result`,
    ['create', 'no_op', 'update', 'delete'],
  );
  for (const [field, expected] of Object.entries({
    create: 8,
    no_op: 25,
    update: 0,
    delete: 0,
  })) {
    exact(recoveryResult[field], expected, `${recoveryPlanPath}.result.${field}`);
  }
  const recoveryResourceCounts = record(
    recoveryPlan.resource_counts,
    `${recoveryPlanPath}.resource_counts`,
    ['kms_iam_bindings', 'secret_iam_bindings', 'component_bucket_iam_bindings'],
  );
  for (const [field, expected] of Object.entries({
    kms_iam_bindings: 1,
    secret_iam_bindings: 5,
    component_bucket_iam_bindings: 2,
  })) {
    exact(recoveryResourceCounts[field], expected, `${recoveryPlanPath}.resource_counts.${field}`);
  }
  exactArray(recoveryPlan.provider_refresh_drift_types, [
    'firestore-etag',
    'kms-empty-label-map',
    'secret-empty-map-normalization',
  ], `${recoveryPlanPath}.provider_refresh_drift_types`);

  const recoveryApplyPath = 'terraform.foundation_recovery_apply_observation';
  const recoveryApply = record(
    terraform.foundation_recovery_apply_observation,
    recoveryApplyPath,
    [
      'observed_on',
      'configuration_commit',
      'workflow_run_id',
      'workflow_run_attempt',
      'workflow_result',
      'environment_approval',
      'terraform_version',
      'backend',
      'plan_object',
      'plan_generation',
      'plan_size_bytes',
      'plan_sha256',
      'strict_validation_profile',
      'strict_validation_passed',
      'requested_result',
      'resource_counts',
      'contains_workload',
      'contains_public_ingress',
      'contains_secret_versions',
      'contains_billing_resource',
      'apply_attempted',
      'apply_completed',
      'workflow_failure_stage',
      'workflow_failure_cause',
      'state_before',
      'state_after',
      'independent_convergence',
      'live_inventory',
      'plan_live_generation_present',
      'plan_soft_deleted_recoverable',
      'temporary_lock_released',
      'raw_planned_values_committed',
      'recovery_required',
    ],
  );
  const recoveryApplyExpectations = {
    observed_on: '2026-09-03',
    configuration_commit: 'd6e2a40064091d803cca79126cf91a75992cec1f',
    workflow_run_id: '33784785967',
    workflow_run_attempt: 1,
    workflow_result: 'failure_after_successful_apply_during_follow_up_plan',
    environment_approval: 'approved',
    terraform_version: '1.11.3',
    backend: 'gcs',
    plan_object: 'gs://miakapp-v4-staging-tfstate-1072737219170/plans/d6e2a40064091d803cca79126cf91a75992cec1f/33784785967/1/foundation.tfplan',
    plan_generation: '1788456590438484',
    plan_size_bytes: 18924,
    plan_sha256: 'd68d4d6748e03691cb1d103a0ab593413110349ba4b39b0ea4efb9be381f1a1f',
    strict_validation_profile: 'partial-foundation-recovery',
    strict_validation_passed: true,
    contains_workload: false,
    contains_public_ingress: false,
    contains_secret_versions: false,
    contains_billing_resource: false,
    apply_attempted: true,
    apply_completed: true,
    workflow_failure_stage: 'post_apply_convergence_plan',
    workflow_failure_cause: 'deployer_identity_lacks_planner_read_surface',
    plan_live_generation_present: false,
    plan_soft_deleted_recoverable: true,
    temporary_lock_released: true,
    raw_planned_values_committed: false,
    recovery_required: false,
  };
  for (const [field, expected] of Object.entries(recoveryApplyExpectations)) {
    exact(recoveryApply[field], expected, `${recoveryApplyPath}.${field}`);
  }
  const recoveryApplyResult = record(
    recoveryApply.requested_result,
    `${recoveryApplyPath}.requested_result`,
    ['create', 'no_op', 'update', 'delete'],
  );
  for (const [field, expected] of Object.entries({
    create: 8, no_op: 25, update: 0, delete: 0,
  })) {
    exact(recoveryApplyResult[field], expected, `${recoveryApplyPath}.requested_result.${field}`);
  }
  const recoveryApplyResources = record(
    recoveryApply.resource_counts,
    `${recoveryApplyPath}.resource_counts`,
    ['kms_iam_bindings', 'secret_iam_bindings', 'component_bucket_iam_bindings'],
  );
  for (const [field, expected] of Object.entries({
    kms_iam_bindings: 1,
    secret_iam_bindings: 5,
    component_bucket_iam_bindings: 2,
  })) {
    exact(recoveryApplyResources[field], expected, `${recoveryApplyPath}.resource_counts.${field}`);
  }
  const recoveryStateExpectations = {
    state_before: {
      object: 'terraform/foundation/default.tfstate',
      generation: '1788452068422403',
      sha256: '7729ee35a104ce04f918faa05cd47d4d37731baac96def6e8531b17175f721bb',
      size_bytes: 42621,
      terraform_version: '1.11.3',
      serial: 4,
      managed_resources: 25,
      data_resources: 2,
      outputs: 0,
    },
    state_after: {
      object: 'terraform/foundation/default.tfstate',
      generation: '1788456706865449',
      sha256: 'e2eca5fc0934a51a4c9a56650665285717772fd350b59e87d18b1ec2da04d8b0',
      size_bytes: 53619,
      lineage_sha256: '113390906103bdbefa4bac8b5d9549f7d867c38e8e9c4bef989977a12222c7d4',
      terraform_version: '1.11.3',
      serial: 6,
      managed_resources: 33,
      data_resources: 3,
      outputs: 1,
    },
  };
  for (const [stateName, expectations] of Object.entries(recoveryStateExpectations)) {
    const statePath = `${recoveryApplyPath}.${stateName}`;
    const state = record(recoveryApply[stateName], statePath, Object.keys(expectations));
    for (const [field, expected] of Object.entries(expectations)) {
      exact(state[field], expected, `${statePath}.${field}`);
    }
  }
  const convergencePath = `${recoveryApplyPath}.independent_convergence`;
  const convergence = record(recoveryApply.independent_convergence, convergencePath, [
    'authentication',
    'plan_sha256',
    'plan_size_bytes',
    'exit_code',
    'result',
    'managed_no_op',
    'applyable',
    'complete',
    'errored',
    'raw_plan_committed',
  ]);
  const convergenceExpectations = {
    authentication: 'user_adc',
    plan_sha256: 'd63373c1c59b7bd6c797a7ff5f94e7f5361bd27552c78ab86f9215727441ef34',
    plan_size_bytes: 20008,
    exit_code: 0,
    result: 'no_changes',
    managed_no_op: 33,
    applyable: false,
    complete: true,
    errored: false,
    raw_plan_committed: false,
  };
  for (const [field, expected] of Object.entries(convergenceExpectations)) {
    exact(convergence[field], expected, `${convergencePath}.${field}`);
  }
  const inventoryPath = `${recoveryApplyPath}.live_inventory`;
  const inventory = record(recoveryApply.live_inventory, inventoryPath, [
    'foundation_resource_iam_bindings',
    'foundation_resource_iam_bindings_exact',
    'secret_containers',
    'secret_versions',
    'firestore_ttl_fields_active',
    'kms_primary_version',
    'kms_primary_version_state',
    'kms_protection_level',
    'kms_algorithm',
    'cloud_run_services',
    'cloud_functions',
  ]);
  const inventoryExpectations = {
    foundation_resource_iam_bindings: 8,
    foundation_resource_iam_bindings_exact: true,
    secret_containers: 5,
    secret_versions: 0,
    firestore_ttl_fields_active: 3,
    kms_primary_version: 1,
    kms_primary_version_state: 'ENABLED',
    kms_protection_level: 'SOFTWARE',
    kms_algorithm: 'EC_SIGN_ED25519',
    cloud_run_services: 0,
    cloud_functions: 0,
  };
  for (const [field, expected] of Object.entries(inventoryExpectations)) {
    exact(inventory[field], expected, `${inventoryPath}.${field}`);
  }

  exact(terraform.apply_authorized, true, 'terraform.apply_authorized');
  exact(terraform.destroy_authorized, false, 'terraform.destroy_authorized');
  exact(terraform.function_deployment_included, true, 'terraform.function_deployment_included');
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
    apply_authorized: true,
    apply_executed: true,
    state_migration_authorized: true,
    state_migration_executed: true,
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
  const readiness = record(value, 'readiness', [
    'manual_read_only_cloud_plan_authorized',
    'foundation_apply_authorized',
    'required_blockers',
  ]);
  exact(
    readiness.manual_read_only_cloud_plan_authorized,
    true,
    'readiness.manual_read_only_cloud_plan_authorized',
  );
  exact(readiness.foundation_apply_authorized, false, 'readiness.foundation_apply_authorized');
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
    'credential_free_validation',
    'manual_live_plan_requires_user_adc',
    'historical_ci_plan_used_keyless_oidc',
    'persistent_ci_credentials_allowed',
    'active_plan_workflow_present',
    'active_apply_workflow_present',
    'recovery_workflow_retired',
    'staging_wif_providers_disabled',
    'activation_material',
    'workload_deployment',
    'private_probe',
    'firebase_auth_baseline',
    'auth_app_check_probe',
    'retired_recovery_workflow',
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
  exact(evidence.credential_free_validation, true, 'evidence.credential_free_validation');
  exact(
    evidence.manual_live_plan_requires_user_adc,
    true,
    'evidence.manual_live_plan_requires_user_adc',
  );
  exact(
    evidence.historical_ci_plan_used_keyless_oidc,
    true,
    'evidence.historical_ci_plan_used_keyless_oidc',
  );
  exact(
    evidence.persistent_ci_credentials_allowed,
    false,
    'evidence.persistent_ci_credentials_allowed',
  );
  exact(evidence.active_plan_workflow_present, false, 'evidence.active_plan_workflow_present');
  exact(evidence.active_apply_workflow_present, false, 'evidence.active_apply_workflow_present');
  exact(evidence.recovery_workflow_retired, true, 'evidence.recovery_workflow_retired');
  exact(
    evidence.staging_wif_providers_disabled,
    true,
    'evidence.staging_wif_providers_disabled',
  );
  const activation = record(evidence.activation_material, 'evidence.activation_material', [
    'state',
    'observed_at',
    'executor_repository_commit',
    'plan_sha256',
    'result_path',
    'result_sha256',
    'runtime_config_path',
    'runtime_config_sha256',
    'firebase_app_id',
    'enabled_secret_versions',
    'secret_payload_bytes_each',
    'runtime_parser',
    'secret_lifecycle_transition',
    'seed_deleted',
    'private_plan_committed',
    'secret_payloads_committed',
    'workloads',
  ]);
  const expectedActivation = {
    state: 'materialized_and_independently_revalidated',
    observed_at: '2026-09-03T22:06:49.000Z',
    executor_repository_commit: '101e4231d452423bafa2ae1efd051e51faeff3c8',
    plan_sha256: 'f3c29e250cca705a76d3337ec2e1fe7aac40ee9d244e9b9b09cbe083778ad87e',
    result_path: 'activation/result.json',
    result_sha256: '290c7cedb500d9f6844b49a45737ed920b3fe2e6ada6ed95b754a795768ccbdf',
    runtime_config_path: 'activation/runtime-config.json',
    runtime_config_sha256: 'b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8',
    firebase_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
    enabled_secret_versions: 5,
    secret_payload_bytes_each: 32,
    runtime_parser: 'production',
    secret_lifecycle_transition: 'initialize',
    seed_deleted: true,
    private_plan_committed: false,
    secret_payloads_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedActivation)) {
    exact(activation[field], expected, `evidence.activation_material.${field}`);
  }
  const workloads = record(activation.workloads, 'evidence.activation_material.workloads', [
    'app_engine_applications',
    'cloud_functions',
    'cloud_run_services',
    'public_ingress',
    'minimum_instances',
  ]);
  for (const field of Object.keys(workloads)) {
    exact(workloads[field], 0, `evidence.activation_material.workloads.${field}`);
  }
  const workload = record(evidence.workload_deployment, 'evidence.workload_deployment', [
    'state',
    'observed_at',
    'inventory_repository_commit',
    'deployed_repository_commit',
    'initial_plan_sha256',
    'initial_plan_result',
    'recovery_configuration_commit',
    'recovery_plan_sha256',
    'recovery_plan_result',
    'output_reconciliation_plan_sha256',
    'output_reconciliation_resource_changes',
    'source_updates',
    'result_path',
    'result_sha256',
    'terraform_state',
    'source_archive_sha256',
    'runtime_config_sha256',
    'function_revision',
    'ingress',
    'unauthenticated_invokers',
    'minimum_instances',
    'maximum_instances',
    'user_managed_keys',
    'copied_source_sha256_verified',
    'terraform_convergence',
    'private_bundle_committed',
    'raw_plan_committed',
    'raw_state_committed',
    'operator_email_committed',
    'live_request_performed',
  ]);
  const expectedWorkload = {
    state: 'active_internal_only_source_verified',
    observed_at: '2026-09-04T21:23:53.111Z',
    inventory_repository_commit: '022f10e2dc15f32a8a6679b38ce7f1a04582e450',
    deployed_repository_commit: '022f10e2dc15f32a8a6679b38ce7f1a04582e450',
    initial_plan_sha256: 'b59167718fdad5edfa440f5d59f6e0eb1dff9277b20e1f829ebbb233296cdf05',
    initial_plan_result: 'failed_build_missing_conditional_source_read',
    recovery_configuration_commit: '488da23cd7eb4c08baa9296724b87b7df34a1122',
    recovery_plan_sha256: '26437631f2d8ea61883762ae854024de5c1142db9182d46e083517af211a192b',
    output_reconciliation_plan_sha256: 'a31bda9269b138b270d58a6bb992ab7902d1fc73074c0f8f2543bdf0c8f09623',
    output_reconciliation_resource_changes: 0,
    result_path: 'workload/result.json',
    result_sha256: 'cfdb18b9dd6604cd92977cbd447dd0684f4b731ca84d2f7aa3f772cbd3bc3056',
    source_archive_sha256: '6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e',
    runtime_config_sha256: 'b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8',
    function_revision: 'control-plane-00004-yis',
    ingress: 'ALLOW_INTERNAL_ONLY',
    unauthenticated_invokers: 0,
    minimum_instances: 0,
    maximum_instances: 1,
    copied_source_sha256_verified: true,
    terraform_convergence: 'no_changes',
    private_bundle_committed: false,
    raw_plan_committed: false,
    raw_state_committed: false,
    operator_email_committed: false,
    live_request_performed: false,
  };
  for (const [field, expected] of Object.entries(expectedWorkload)) {
    exact(workload[field], expected, `evidence.workload_deployment.${field}`);
  }
  const workloadKeys = record(
    workload.user_managed_keys,
    'evidence.workload_deployment.user_managed_keys',
    ['runtime', 'build', 'probe'],
  );
  for (const field of ['runtime', 'build', 'probe']) {
    exact(workloadKeys[field], 0, `evidence.workload_deployment.user_managed_keys.${field}`);
  }
  const recoveryPlanResult = record(
    workload.recovery_plan_result,
    'evidence.workload_deployment.recovery_plan_result',
    ['create', 'update', 'delete', 'function_replaced'],
  );
  exact(recoveryPlanResult.create, 2, 'evidence.workload_deployment.recovery_plan_result.create');
  exact(recoveryPlanResult.update, 1, 'evidence.workload_deployment.recovery_plan_result.update');
  exact(recoveryPlanResult.delete, 0, 'evidence.workload_deployment.recovery_plan_result.delete');
  exact(
    recoveryPlanResult.function_replaced,
    false,
    'evidence.workload_deployment.recovery_plan_result.function_replaced',
  );
  if (!Array.isArray(workload.source_updates) || workload.source_updates.length !== 3) {
    reject('evidence.workload_deployment.source_updates', 'must contain exactly 3 entries');
  }
  const expectedSourceUpdates = [
    {
      purpose: 'secret_manager_canonical_name_compatibility',
      repository_commit: '72bae493e496b7dbaae38bcba92dfcc6d604644d',
      plan_sha256: '650a62e7308aa854fb8ac3ed88bdad987148364ac09860bdef734d9bcd56ecee',
      source_archive_sha256: '6cd045394b24a644d6b1ce9c431bcb73267fb894b7dc0b029d6c0be0488a9433',
      function_revision: 'control-plane-00002-kux',
      terraform_state_generation: '1788486188603490',
      terraform_state_serial: 10,
      terraform_state_sha256: '92e902fb0d54b7daa0b6b468546a31510718730228afa758662cb12326a9c659',
    },
    {
      purpose: 'runtime_environment_and_initialization_diagnostics',
      repository_commit: '60322c69c92b8ccf5f3d1bc87ba264a00e5dca05',
      plan_sha256: 'b66c16e1f7cd540b4708306e17f7e92fe69172ce06b3e2ee1f90fb284636ea07',
      source_archive_sha256: '86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358',
      function_revision: 'control-plane-00003-hum',
      terraform_state_generation: '1788488610045265',
      terraform_state_serial: 12,
      terraform_state_sha256: '3adbde5e684736080d47b239031a2bb469787641ccf0f87c409d2b3a3b180145',
    },
    {
      purpose: 'audience_bound_user_relay_credentials',
      repository_commit: '022f10e2dc15f32a8a6679b38ce7f1a04582e450',
      plan_sha256: 'eeb7bf638d7b46212994513eb2decc8405991e6907b6838caa04f6eba07cffa3',
      source_archive_sha256: '6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e',
      function_revision: 'control-plane-00004-yis',
      terraform_state_generation: '1788557027934706',
      terraform_state_serial: 14,
      terraform_state_sha256: '4f2977ce6e8c736cbdf31d58ba1da81f4291ace4c9d5d0d7d21a727c063cfc6e',
    },
  ];
  workload.source_updates.forEach((value, index) => {
    const update = record(value, `evidence.workload_deployment.source_updates[${index}]`, [
      'purpose',
      'repository_commit',
      'plan_sha256',
      'source_archive_sha256',
      'function_revision',
      'terraform_state_generation',
      'terraform_state_serial',
      'terraform_state_sha256',
    ]);
    for (const [field, expected] of Object.entries(expectedSourceUpdates[index])) {
      exact(update[field], expected, `evidence.workload_deployment.source_updates[${index}].${field}`);
    }
  });
  const workloadState = record(
    workload.terraform_state,
    'evidence.workload_deployment.terraform_state',
    [
      'object',
      'generation',
      'sha256',
      'size_bytes',
      'terraform_version',
      'serial',
      'lineage_sha256',
      'managed_resources',
      'data_resources',
      'outputs',
      'tainted_resources',
      'raw_contents_committed',
    ],
  );
  const expectedWorkloadState = {
    object: 'terraform/workload/default.tfstate',
    generation: '1788557027934706',
    sha256: '4f2977ce6e8c736cbdf31d58ba1da81f4291ace4c9d5d0d7d21a727c063cfc6e',
    size_bytes: 49283,
    terraform_version: '1.11.3',
    serial: 14,
    lineage_sha256: 'aecd871c255da2bb3d30e7a7cc7b76be229e1eccc1fce2c4e41fed5a4a4b4b3a',
    managed_resources: 15,
    data_resources: 3,
    outputs: 1,
    tainted_resources: 0,
    raw_contents_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedWorkloadState)) {
    exact(workloadState[field], expected, `evidence.workload_deployment.terraform_state.${field}`);
  }
  const privateProbe = record(evidence.private_probe, 'evidence.private_probe', [
    'state',
    'observed_at',
    'deployment_repository_commit',
    'recovery_repository_commit',
    'deployment_plan_sha256',
    'deployment_plan_result',
    'workflow_source_sha256',
    'workflow_revision',
    'result_path',
    'result_sha256',
    'terraform_state',
    'executions',
    'response_status',
    'workload_deployment_commit',
    'source_archive_sha256',
    'function_revision',
    'ingress',
    'unauthenticated_invokers',
    'probe_user_managed_keys',
    'five_secret_values_loaded',
    'signing_public_key_validated',
    'firebase_auth_validated',
    'app_check_validated',
    'application_mutation_expected',
    'private_bundle_committed',
    'execution_identifiers_committed',
    'trace_identifiers_committed',
    'raw_diagnostics_committed',
    'terraform_convergence',
    'live_request_performed',
  ]);
  const expectedPrivateProbe = {
    state: 'secure_runtime_discovery_succeeded',
    observed_at: '2026-09-04T02:35:49.645Z',
    deployment_repository_commit: 'c86dbb0b58301ad541307eee2d2fd7013ab947f8',
    recovery_repository_commit: '58b6d8a7427f905b54f26dcb23aae514dac1a1a6',
    deployment_plan_sha256: 'b7ef650d00215db3644de1e76107b3096425022903f83a40071eaff7e984f3d9',
    workflow_source_sha256: '361519966cc628d5b6ec03afd99b1e3ed7f03e05bf941e2cd34bb4aba547dd9f',
    workflow_revision: '000001-7fb',
    result_path: 'probe/result.json',
    result_sha256: 'ea3245756727eaf071f2edc6ef55ba1b730c5e3f61e38746fb7cbf36e8f4ef05',
    response_status: 200,
    workload_deployment_commit: '60322c69c92b8ccf5f3d1bc87ba264a00e5dca05',
    source_archive_sha256: '86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358',
    function_revision: 'control-plane-00003-hum',
    ingress: 'ALLOW_INTERNAL_ONLY',
    unauthenticated_invokers: 0,
    probe_user_managed_keys: 0,
    five_secret_values_loaded: true,
    signing_public_key_validated: true,
    firebase_auth_validated: false,
    app_check_validated: false,
    application_mutation_expected: false,
    private_bundle_committed: false,
    execution_identifiers_committed: false,
    trace_identifiers_committed: false,
    raw_diagnostics_committed: false,
    terraform_convergence: 'no_changes',
    live_request_performed: true,
  };
  for (const [field, expected] of Object.entries(expectedPrivateProbe)) {
    exact(privateProbe[field], expected, `evidence.private_probe.${field}`);
  }
  const probePlanResult = record(
    privateProbe.deployment_plan_result,
    'evidence.private_probe.deployment_plan_result',
    ['create', 'update', 'delete'],
  );
  exact(probePlanResult.create, 3, 'evidence.private_probe.deployment_plan_result.create');
  exact(probePlanResult.update, 0, 'evidence.private_probe.deployment_plan_result.update');
  exact(probePlanResult.delete, 0, 'evidence.private_probe.deployment_plan_result.delete');
  const probeState = record(privateProbe.terraform_state, 'evidence.private_probe.terraform_state', [
    'object',
    'generation',
    'sha256',
    'size_bytes',
    'terraform_version',
    'serial',
    'lineage_sha256',
    'managed_resources',
    'data_resources',
    'outputs',
    'tainted_resources',
    'raw_contents_committed',
  ]);
  const expectedProbeState = {
    object: 'terraform/probe/default.tfstate',
    generation: '1788484287000119',
    sha256: 'af7241b8d72085e0b30b7ca1a093726b2462b83160bd7566f6847d94aeb1cbf5',
    size_bytes: 13596,
    terraform_version: '1.11.3',
    serial: 3,
    lineage_sha256: 'f47e5791c7b957133ed38734bfcd2d6c6f1011d46b5a148b80efe7299e8ca1e7',
    managed_resources: 3,
    data_resources: 1,
    outputs: 1,
    tainted_resources: 0,
    raw_contents_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedProbeState)) {
    exact(probeState[field], expected, `evidence.private_probe.terraform_state.${field}`);
  }
  const executions = record(privateProbe.executions, 'evidence.private_probe.executions', [
    'total',
    'failed',
    'succeeded',
    'workflow_retries',
    'scheduled_triggers',
  ]);
  const expectedExecutions = {
    total: 3,
    failed: 2,
    succeeded: 1,
    workflow_retries: 0,
    scheduled_triggers: 0,
  };
  for (const [field, expected] of Object.entries(expectedExecutions)) {
    exact(executions[field], expected, `evidence.private_probe.executions.${field}`);
  }
  const firebaseAuth = record(evidence.firebase_auth_baseline, 'evidence.firebase_auth_baseline', [
    'state',
    'observed_at',
    'repository_commit',
    'result_path',
    'result_sha256',
    'terraform_state_sha256',
    'live_config_sha256',
    'config_name',
    'external_identity_providers',
    'anonymous_sign_in',
    'email_sign_in',
    'phone_sign_in',
    'mfa',
    'multi_tenant',
    'request_logging',
    'public_endpoints_created',
    'persistent_credentials_created',
  ]);
  const expectedFirebaseAuth = {
    state: 'initialized_closed_and_reconciled',
    observed_at: '2026-09-04T10:42:43.616Z',
    repository_commit: 'e44ce2cde147b19b7e82f89b44e8f3a5233d1942',
    result_path: 'firebase-auth/result.json',
    result_sha256: '25a3c80ccccb89208499b1d0fc2176ac82a04a7fc47ed57af80dfa0371136c87',
    terraform_state_sha256: '94a1eca99e8a793ca1d316a283c43c0a75aeb041a84135ac5084074260fceb69',
    live_config_sha256: '2b274774cdc86caf380f67f611de4d7df66da2bb8ad4d92f111df4d26d37dd50',
    config_name: 'projects/1072737219170/config',
    external_identity_providers: 0,
    anonymous_sign_in: false,
    email_sign_in: false,
    phone_sign_in: false,
    mfa: 'DISABLED',
    multi_tenant: false,
    request_logging: false,
    public_endpoints_created: 0,
    persistent_credentials_created: 0,
  };
  for (const [field, expected] of Object.entries(expectedFirebaseAuth)) {
    exact(firebaseAuth[field], expected, `evidence.firebase_auth_baseline.${field}`);
  }
  const authProbe = record(evidence.auth_app_check_probe, 'evidence.auth_app_check_probe', [
    'state',
    'observed_at',
    'repository_commit',
    'workflow_source_sha256',
    'workflow_revision',
    'result_path',
    'result_sha256',
    'retirement_path',
    'retirement_sha256',
    'execution_duration_milliseconds',
    'execution_count',
    'product_requests',
    'expected_application_writes',
    'missing_app_check_status',
    'missing_app_check_code',
    'first_authenticated_status',
    'replay_authenticated_status',
    'firebase_auth_validated',
    'app_check_validated',
    'app_check_token_consumption',
    'browser_provider_attestation_validated',
    'synthetic_user_created',
    'synthetic_user_deleted',
    'independent_user_absence_verified',
    'workflow_present',
    'temporary_bindings_present',
    'recurring_compute',
    'private_bundle_committed',
    'execution_identifiers_committed',
    'token_material_committed',
    'raw_diagnostics_committed',
  ]);
  const expectedAuthProbe = {
    state: 'succeeded_and_retired',
    observed_at: '2026-09-04T11:33:48.986Z',
    repository_commit: '753601acc160c2214511c3207b9f0c47d3d7e03e',
    workflow_source_sha256: '525b97d18a2848c1d852b9d117cb20cf464bbc1d7baa85b2d44d457487cd922c',
    workflow_revision: '000001-bb4',
    result_path: 'auth-probe/result.json',
    result_sha256: '87af1de1f94bd4f1d070fef430f6e61ee70f7b988ec81fcfb0fb2805a3edc95f',
    retirement_path: 'auth-probe/retirement.json',
    retirement_sha256: '595c994647f181b7f2b7a98e403c9d039b32cde6e57acd9df904d40b568e5b54',
    execution_duration_milliseconds: 7_821,
    execution_count: 1,
    product_requests: 3,
    expected_application_writes: 0,
    missing_app_check_status: 401,
    missing_app_check_code: 'invalid_app_check_token',
    first_authenticated_status: 200,
    replay_authenticated_status: 200,
    firebase_auth_validated: true,
    app_check_validated: true,
    app_check_token_consumption: false,
    browser_provider_attestation_validated: false,
    synthetic_user_created: true,
    synthetic_user_deleted: true,
    independent_user_absence_verified: true,
    workflow_present: false,
    temporary_bindings_present: false,
    recurring_compute: false,
    private_bundle_committed: false,
    execution_identifiers_committed: false,
    token_material_committed: false,
    raw_diagnostics_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedAuthProbe)) {
    exact(authProbe[field], expected, `evidence.auth_app_check_probe.${field}`);
  }
  const retiredRecoveryWorkflow = record(
    evidence.retired_recovery_workflow,
    'evidence.retired_recovery_workflow',
    ['id', 'state', 'active_file_present'],
  );
  exact(retiredRecoveryWorkflow.id, '349440747', 'evidence.retired_recovery_workflow.id');
  exact(
    retiredRecoveryWorkflow.state,
    'deleted',
    'evidence.retired_recovery_workflow.state',
  );
  exact(
    retiredRecoveryWorkflow.active_file_present,
    false,
    'evidence.retired_recovery_workflow.active_file_present',
  );
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
  exact(manifest.revision, 39, 'manifest.revision');
  exact(
    manifest.status,
    'private_control_plane_source_verified_user_relay_acceptance_pending',
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

function validatedEvidenceFile(path, validator, manifestPath) {
  try {
    return validator(path);
  } catch {
    return reject(manifestPath, 'does not match its committed artifact');
  }
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function exactFields(value, expected, path) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    exact(value[field], expectedValue, `${path}.${field}`);
  }
}

function validateHistoricalWorkloadTuple(sourceUpdates, observed, path) {
  const matches = sourceUpdates.filter((update) => (
    update.repository_commit === observed.deployment_commit
    && update.source_archive_sha256 === observed.source_sha256
    && update.function_revision === observed.function_revision
  ));
  if (matches.length !== 1) {
    reject(path, 'must match exactly one recorded workload source update');
  }
}

function committedEvidencePath(stagingRoot, value, expected, manifestPath) {
  exact(value, expected, manifestPath);
  return resolve(stagingRoot, expected);
}

export function validateCommittedEvidence(
  manifest,
  stagingRoot = fileURLToPath(new URL('./', import.meta.url)),
) {
  const workloadManifest = manifest.evidence.workload_deployment;
  const workloadPath = committedEvidencePath(
    stagingRoot,
    workloadManifest.result_path,
    'workload/result.json',
    'evidence.workload_deployment.result_path',
  );
  const workload = validatedEvidenceFile(
    workloadPath,
    validateWorkloadEvidence,
    'evidence.workload_deployment.result_path',
  );
  exact(
    fileSha256(workloadPath),
    workloadManifest.result_sha256,
    'evidence.workload_deployment.result_sha256',
  );
  exactFields(workloadManifest, {
    observed_at: workload.observed_at,
    inventory_repository_commit: workload.repository_commit,
    deployed_repository_commit: workload.repository_commit,
    source_archive_sha256: workload.source_archive_sha256,
    runtime_config_sha256: workload.runtime_config_sha256,
    function_revision: workload.function.revision,
    ingress: workload.function.ingress,
    unauthenticated_invokers: workload.function.unauthenticated_invokers,
    minimum_instances: workload.function.minimum_instances,
    maximum_instances: workload.function.maximum_instances,
    live_request_performed: workload.live_request_performed,
  }, 'evidence.workload_deployment');
  exactFields(
    workloadManifest.user_managed_keys,
    workload.identities.user_managed_keys,
    'evidence.workload_deployment.user_managed_keys',
  );
  exactFields(manifest.runtime, {
    resource_name: workload.function.name,
    generation: workload.function.generation,
    deployment_state: workload.function.state,
    service: workload.function.service,
    revision: workload.function.revision,
    uri: workload.function.uri,
    minimum_instances: workload.function.minimum_instances,
    maximum_instances: workload.function.maximum_instances,
    concurrency: workload.function.concurrency,
    timeout_seconds: workload.function.timeout_seconds,
    ingress: workload.function.ingress,
    source_archive_sha256: workload.source_archive_sha256,
    runtime_config_sha256: workload.runtime_config_sha256,
    live_request_performed: workload.live_request_performed,
  }, 'runtime');

  const probeManifest = manifest.evidence.private_probe;
  const probePath = committedEvidencePath(
    stagingRoot,
    probeManifest.result_path,
    'probe/result.json',
    'evidence.private_probe.result_path',
  );
  const probe = validatedEvidenceFile(
    probePath,
    validateProbeEvidence,
    'evidence.private_probe.result_path',
  );
  exact(fileSha256(probePath), probeManifest.result_sha256, 'evidence.private_probe.result_sha256');
  validateHistoricalWorkloadTuple(
    workloadManifest.source_updates,
    probe.workload,
    'evidence.private_probe.result.workload',
  );
  exactFields(probeManifest, {
    state: probe.claims.secure_runtime_served_discovery
      ? 'secure_runtime_discovery_succeeded'
      : 'secure_runtime_discovery_failed',
    observed_at: probe.observed_at,
    recovery_repository_commit: probe.repository_commit,
    workflow_source_sha256: probe.workflow.source_sha256,
    workflow_revision: probe.workflow.revision,
    response_status: probe.response.status,
    workload_deployment_commit: probe.workload.deployment_commit,
    source_archive_sha256: probe.workload.source_sha256,
    function_revision: probe.workload.function_revision,
    ingress: probe.workload.ingress,
    unauthenticated_invokers: probe.workload.unauthenticated_invokers,
    probe_user_managed_keys: probe.workload.probe_user_managed_keys,
    five_secret_values_loaded: probe.claims.secure_runtime_served_discovery,
    signing_public_key_validated: probe.claims.secure_runtime_served_discovery,
    firebase_auth_validated: probe.claims.firebase_auth_validated,
    app_check_validated: probe.claims.app_check_validated,
    application_mutation_expected: probe.claims.application_mutation_expected,
    live_request_performed:
      probe.recovery_execution.count_after === probe.recovery_execution.count_before + 1,
  }, 'evidence.private_probe');
  exactFields(probeManifest.executions, {
    total: probe.recovery_execution.count_after,
    failed: probe.prior_executions.length,
    succeeded: probe.recovery_execution.state === 'SUCCEEDED' ? 1 : 0,
    workflow_retries: probe.request.workflow_retries,
    scheduled_triggers: probe.workflow.scheduled_triggers,
  }, 'evidence.private_probe.executions');
  const firebaseAuthManifest = manifest.evidence.firebase_auth_baseline;
  const firebaseAuthPath = committedEvidencePath(
    stagingRoot,
    firebaseAuthManifest.result_path,
    'firebase-auth/result.json',
    'evidence.firebase_auth_baseline.result_path',
  );
  const firebaseAuth = validatedEvidenceFile(
    firebaseAuthPath,
    validateFirebaseAuthEvidence,
    'evidence.firebase_auth_baseline.result_path',
  );
  exact(
    fileSha256(firebaseAuthPath),
    firebaseAuthManifest.result_sha256,
    'evidence.firebase_auth_baseline.result_sha256',
  );
  exactFields(firebaseAuthManifest, {
    state: 'initialized_closed_and_reconciled',
    observed_at: firebaseAuth.observed_at,
    repository_commit: firebaseAuth.repository_commit,
    terraform_state_sha256: firebaseAuth.terraform_state_sha256,
    live_config_sha256: firebaseAuth.live_config_sha256,
    config_name: firebaseAuth.firebase_auth.config_name,
    external_identity_providers: firebaseAuth.external_identity_providers,
    anonymous_sign_in: firebaseAuth.firebase_auth.anonymous_sign_in,
    email_sign_in: firebaseAuth.firebase_auth.email_sign_in,
    phone_sign_in: firebaseAuth.firebase_auth.phone_sign_in,
    mfa: firebaseAuth.firebase_auth.mfa,
    multi_tenant: firebaseAuth.firebase_auth.multi_tenant,
    request_logging: firebaseAuth.firebase_auth.request_logging,
    public_endpoints_created: firebaseAuth.public_endpoints_created,
    persistent_credentials_created: firebaseAuth.persistent_credentials_created,
  }, 'evidence.firebase_auth_baseline');

  const authProbeManifest = manifest.evidence.auth_app_check_probe;
  const authProbeResultPath = committedEvidencePath(
    stagingRoot,
    authProbeManifest.result_path,
    'auth-probe/result.json',
    'evidence.auth_app_check_probe.result_path',
  );
  const authProbeRetirementPath = committedEvidencePath(
    stagingRoot,
    authProbeManifest.retirement_path,
    'auth-probe/retirement.json',
    'evidence.auth_app_check_probe.retirement_path',
  );
  let authProbeEvidence;
  try {
    authProbeEvidence = validateAuthProbeEvidence(authProbeResultPath, authProbeRetirementPath);
  } catch {
    reject('evidence.auth_app_check_probe', 'does not match its committed artifacts');
  }
  const { result: authProbe, retirement: authProbeRetirement } = authProbeEvidence;
  exact(
    fileSha256(authProbeResultPath),
    authProbeManifest.result_sha256,
    'evidence.auth_app_check_probe.result_sha256',
  );
  exact(
    fileSha256(authProbeRetirementPath),
    authProbeManifest.retirement_sha256,
    'evidence.auth_app_check_probe.retirement_sha256',
  );
  exactFields(authProbeManifest, {
    state: authProbe.execution.state === 'SUCCEEDED'
      && authProbeRetirement.workflow_present === false
      && authProbeRetirement.temporary_bindings_present === false
      ? 'succeeded_and_retired'
      : 'incomplete',
    observed_at: authProbe.observed_at,
    repository_commit: authProbe.repository_commit,
    workflow_source_sha256: authProbe.workflow.source_sha256,
    workflow_revision: authProbe.workflow.revision,
    execution_duration_milliseconds: authProbe.execution.duration_milliseconds,
    execution_count: authProbe.execution.count_after - authProbe.execution.count_before,
    product_requests: authProbe.request.product_requests,
    expected_application_writes: authProbe.request.expected_application_writes,
    missing_app_check_status: authProbe.responses.missing_app_check.status,
    missing_app_check_code: authProbe.responses.missing_app_check.code,
    first_authenticated_status: authProbe.responses.first_authenticated_read.status,
    replay_authenticated_status: authProbe.responses.replay_authenticated_read.status,
    firebase_auth_validated: authProbe.firebase_auth.synthetic_user_created
      && authProbe.firebase_auth.synthetic_user_deleted
      && authProbe.firebase_auth.independent_absence_verified,
    app_check_validated: authProbe.app_check.first_use_accepted
      && authProbe.app_check.replay_accepted,
    app_check_token_consumption: authProbe.app_check.token_consumption,
    browser_provider_attestation_validated:
      authProbe.app_check.browser_provider_attestation_validated,
    synthetic_user_created: authProbe.firebase_auth.synthetic_user_created,
    synthetic_user_deleted: authProbe.firebase_auth.synthetic_user_deleted,
    independent_user_absence_verified: authProbe.firebase_auth.independent_absence_verified,
    workflow_present: authProbeRetirement.workflow_present,
    temporary_bindings_present: authProbeRetirement.temporary_bindings_present,
    recurring_compute: authProbeRetirement.recurring_compute,
  }, 'evidence.auth_app_check_probe');
  exact(
    authProbe.workload.expected_function_revision,
    authProbe.workload.function_revision,
    'evidence.auth_app_check_probe.result.workload.expected_function_revision',
  );
  validateHistoricalWorkloadTuple(
    workloadManifest.source_updates,
    authProbe.workload,
    'evidence.auth_app_check_probe.result.workload',
  );
  exact(
    authProbe.app_check.firebase_app_id,
    manifest.evidence.activation_material.firebase_app_id,
    'evidence.auth_app_check_probe.result.app_check.firebase_app_id',
  );
  exact(
    firebaseAuth.firebase_auth.project_id,
    authProbe.project_id,
    'evidence.auth_app_check_probe.result.project_id',
  );
  return Object.freeze({
    workload,
    probe,
    firebaseAuth,
    authProbe,
    authProbeRetirement,
  });
}

export function validateStagingManifestFile(manifestPath, firebaseRcPath = fileURLToPath(new URL('../../.firebaserc', import.meta.url))) {
  const resolvedManifestPath = resolve(manifestPath);
  const manifest = readBoundedJson(resolvedManifestPath, MAX_MANIFEST_BYTES);
  const firebaseRc = readBoundedJson(firebaseRcPath, 4 * 1024);
  validateStagingManifest(manifest);
  validateFirebaseRc(firebaseRc);
  validateCommittedEvidence(manifest, dirname(resolvedManifestPath));
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
      process.stdout.write(
        `Validated ${manifest.schema} for ${manifest.project.project_id}; the current private control-plane source is verified, user-relay acceptance is pending, and historical Firebase Auth/App Check evidence remains retired.\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      process.stderr.write(`Staging manifest rejected: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
