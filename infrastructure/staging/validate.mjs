import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { BOOTSTRAP_RESOURCE_ADDRESSES } from './bootstrap/saved-plan.mjs';
import { validateAuthProbeEvidence } from './auth-probe/evidence.mjs';
import { validatePreflightEvidence } from './browser-attestation/preflight-evidence.mjs';
import {
  BROWSER_RELAY_PLAN_PATH,
  BROWSER_RELAY_PLAN_SHA256,
  BROWSER_RELAY_PAGE_CI_MERGE_COMMIT,
  BROWSER_RELAY_V8_PLAN_PATH,
  BROWSER_RELAY_V8_PLAN_SHA256,
  BROWSER_RELAY_V9_PLAN_PATH,
  BROWSER_RELAY_V9_PLAN_SHA256,
  BROWSER_RELAY_V10_PLAN_PATH,
  BROWSER_RELAY_V10_PLAN_SHA256,
  BROWSER_RELAY_V11_PLAN_PATH,
  BROWSER_RELAY_V11_PLAN_SHA256,
  BROWSER_RELAY_V12_PLAN_PATH,
  BROWSER_RELAY_V12_PLAN_SHA256,
  BROWSER_RELAY_V13_PLAN_PATH,
  BROWSER_RELAY_V13_PLAN_SHA256,
  BROWSER_RELAY_V14_PLAN_PATH,
  BROWSER_RELAY_V14_PLAN_SHA256,
  validateBrowserRelayPlan,
  validateBrowserRelayV10Plan,
  validateBrowserRelayV11Plan,
  validateBrowserRelayV12Plan,
  validateBrowserRelayV13Plan,
  validateBrowserRelayV14Plan,
  validateBrowserRelayV8Plan,
  validateBrowserRelayV9Plan,
} from './browser-relay/contract.mjs';
import {
  BROWSER_RELAY_RUNNER_PROFILE_PATH,
  BROWSER_RELAY_RUNNER_PROFILE_SHA256,
  validateBrowserRelayRunnerProfile,
} from './browser-relay-runner/contract.mjs';
import {
  BROWSER_RELAY_PAGE_PROFILE_PATH,
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
  BROWSER_RELAY_PAGE_V2_PROFILE_PATH,
  BROWSER_RELAY_PAGE_V2_PROFILE_SHA256,
  CI_WORKFLOW_SHA256 as BROWSER_RELAY_PAGE_CI_WORKFLOW_SHA256,
  DEPENDENCY_LOCK_SHA256 as BROWSER_RELAY_PAGE_DEPENDENCY_LOCK_SHA256,
  MIAKAPI_BUNDLE_SHA256 as BROWSER_RELAY_PAGE_MIAKAPI_BUNDLE_SHA256,
  OFFLINE_BFCACHE_ENTRY_SHA256 as BROWSER_RELAY_PAGE_OFFLINE_BFCACHE_ENTRY_SHA256,
  OFFLINE_NODE_TEST_SHA256 as BROWSER_RELAY_PAGE_OFFLINE_NODE_TEST_SHA256,
  OFFLINE_PAGE_HARNESS_SHA256 as BROWSER_RELAY_PAGE_OFFLINE_PAGE_HARNESS_SHA256,
  OFFLINE_SMOKE_SHA256 as BROWSER_RELAY_PAGE_OFFLINE_SMOKE_SHA256,
  validateBrowserRelayPageProfile,
  validateBrowserRelayPageV2Profile,
} from './browser-relay-page/contract.mjs';
import {
  FIXTURE_IMPLEMENTATION_BASE_COMMIT,
  FIXTURE_PROFILE_PATH,
  FIXTURE_PROFILE_SHA256,
  FIXTURE_SOURCE_SHA256,
  validateBrowserRelayFixtureProfile,
} from './browser-relay-fixture/contract.mjs';
import {
  FIXTURE_CLOUD_IMPLEMENTATION_BASE_COMMIT,
  FIXTURE_CLOUD_PROFILE_PATH,
  FIXTURE_CLOUD_PROFILE_SHA256,
  FIXTURE_CLOUD_SOURCE_SHA256,
  FIXTURE_SIGNER_SERVICE_ACCOUNT,
  validateBrowserRelayFixtureCloudProfile,
} from './browser-relay-fixture-cloud/contract.mjs';
import {
  FIXTURE_MIAKAPI_BINDING_SOURCE_SHA256,
  FIXTURE_MIAKAPI_IMPLEMENTATION_BASE_COMMIT,
  FIXTURE_MIAKAPI_PROFILE_PATH,
  FIXTURE_MIAKAPI_PROFILE_SHA256,
  MIAKAPI_LICENSE_SHA256,
  MIAKAPI_NODE_BUNDLE_SHA256,
  MIAKAPI_NODE_ENTRY_SHA256,
  validateBrowserRelayFixtureMiakApiProfile,
} from './browser-relay-fixture-miakapi/contract.mjs';
import {
  AGGREGATOR_IMPLEMENTATION_BASE_COMMIT,
  AGGREGATOR_PROFILE_PATH,
  AGGREGATOR_PROFILE_SHA256,
  AGGREGATOR_SOURCE_SHA256,
  COUNTER_OWNERS as AGGREGATOR_COUNTER_OWNERS,
  SOURCE_ASSERTIONS as AGGREGATOR_SOURCE_ASSERTIONS,
  SOURCE_ORDER_BY_BROWSER as AGGREGATOR_SOURCE_ORDER_BY_BROWSER,
  validateBrowserRelayAggregatorProfile,
} from './browser-relay-aggregator/contract.mjs';
import {
  PAGE_FACT_ORDER_BY_BROWSER,
  PAGE_RECEIPT_IMPLEMENTATION_BASE_COMMIT,
  PAGE_RECEIPT_PROFILE_PATH,
  PAGE_RECEIPT_PROFILE_SHA256,
  PAGE_RECEIPT_SOURCE_SHA256,
  REQUIRED_MATRIX_PRIVATE_INPUTS,
  validateBrowserRelayPageReceiptProfile,
} from './browser-relay-page-receipt/contract.mjs';
import {
  SCENARIO_FIXTURE_IMPLEMENTATION_BASE_COMMIT,
  SCENARIO_FIXTURE_PROFILE_PATH,
  SCENARIO_FIXTURE_PROFILE_SHA256,
  SCENARIO_FIXTURE_SOURCE_SHA256,
  SCENARIO_INPUT_ORDER,
  validateBrowserRelayScenarioFixtureProfile,
} from './browser-relay-scenario-fixture/contract.mjs';
import {
  SCENARIO_FIXTURE_CLOUD_IMPLEMENTATION_BASE_COMMIT,
  SCENARIO_FIXTURE_CLOUD_PROFILE_PATH,
  SCENARIO_FIXTURE_CLOUD_PROFILE_SHA256,
  SCENARIO_FIXTURE_CLOUD_SOURCE_SHA256,
  validateBrowserRelayScenarioFixtureCloudProfile,
} from './browser-relay-scenario-fixture-cloud/contract.mjs';
import {
  ROLLBACK_IMPLEMENTATION_COMMIT,
  ROLLBACK_PREFLIGHT_RESULT_PATH,
  ROLLBACK_PREFLIGHT_RESULT_SHA256,
  ROLLBACK_PROFILE_PATH,
  ROLLBACK_PROFILE_SHA256,
  validateBrowserRelayRollbackProfile,
  validateRollbackPreflightResult,
} from './browser-relay-rollback/contract.mjs';
import {
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
  ORCHESTRATOR_IMPLEMENTATION_COMMIT,
  ORCHESTRATOR_PREFLIGHT_RESULT_PATH,
  ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
  ORCHESTRATOR_PROFILE_PATH,
  ORCHESTRATOR_PROFILE_SHA256,
  validateBrowserRelayOrchestratorProfile,
  validateOrchestratorPreflightResult,
} from './browser-relay-orchestrator/contract.mjs';
import {
  OPERATION_IMPLEMENTATION_BASE_COMMIT,
  OPERATION_IMPLEMENTATION_COMMIT,
  OPERATION_PREFLIGHT_RESULT_PATH,
  OPERATION_PREFLIGHT_RESULT_SHA256,
  OPERATION_PROFILE_PATH,
  OPERATION_PROFILE_SHA256,
  validateBrowserRelayOperationProfile,
  validateOperationPreflightResult,
} from './browser-relay-operation/contract.mjs';
import {
  BROWSER_RELAY_V10_PLAN_SHA256 as MONITORING_BROWSER_RELAY_PLAN_SHA256,
  MONITORING_IMPLEMENTATION_COMMIT,
  MONITORING_PREFLIGHT_RESULT_PATH,
  MONITORING_PREFLIGHT_RESULT_SHA256,
  MONITORING_PROFILE_PATH,
  MONITORING_PROFILE_SHA256,
  validateBrowserRelayMonitoringProfile,
  validateMonitoringPreflightResult,
} from './browser-relay-monitoring/contract.mjs';
import {
  RELAY_SERVICES_PROFILE_PATH,
  RELAY_SERVICES_PROFILE_SHA256,
  RELAY_SERVICES_BOOTSTRAP_FAILURE_PATH,
  RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
  RELAY_SERVICES_V1_PROFILE_PATH,
  RELAY_SERVICES_V1_PROFILE_SHA256,
  RELAY_SERVICES_V2_PROFILE_PATH,
  RELAY_SERVICES_V2_PROFILE_SHA256,
  RELAY_SERVICES_V3_PROFILE_PATH,
  RELAY_SERVICES_V3_PROFILE_SHA256,
  RELAY_SERVICES_V4_PROFILE_PATH,
  RELAY_SERVICES_V4_PROFILE_SHA256,
  RELAY_SERVICES_V5_PROFILE_PATH,
  RELAY_SERVICES_V5_PROFILE_SHA256,
  RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_PATH,
  RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256,
  RELAY_SERVICES_PRIVATE_READY_RESULT_PATH,
  RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
  validateRelayServicesBootstrapFailure,
  validateRelayServicesMemoryRecoveryFailure,
  validateRelayServicesPrivateReadyResult,
  validateRelayServicesProfile,
  validateRelayServicesV1Profile,
  validateRelayServicesV2Profile,
  validateRelayServicesV3Profile,
  validateRelayServicesV4Profile,
  validateRelayServicesV5Profile,
} from './browser-relay-services/contract.mjs';
import {
  RELAY_IMAGE_PROFILE_PATH,
  RELAY_IMAGE_PROFILE_SHA256,
  validateRelayImageProfile,
} from './browser-relay-image/contract.mjs';
import {
  RELAY_IMAGE_V1_PROFILE_PATH,
  RELAY_IMAGE_V1_PROFILE_SHA256,
  RELAY_IMAGE_V1_RESULT_PATH,
  RELAY_IMAGE_V1_RESULT_SHA256,
  RELAY_IMAGE_V2_RESULT_PATH,
  RELAY_IMAGE_V2_RESULT_SHA256,
  validateRelayImageV1Profile,
  validateRelayImageV1Result,
  validateRelayImageV2Result,
} from './browser-relay-image/result.mjs';
import { validateBrowserAppCheckEvidence } from './browser-app-check/evidence.mjs';
import { validateFirebaseAuthEvidence } from './firebase-auth/evidence.mjs';
import { validateProbeEvidence } from './probe/evidence.mjs';
import { validateSigningOverlapEvidence } from './signing-overlap/evidence.mjs';
import { validateWorkloadEvidence } from './workload/evidence.mjs';

const MAX_MANIFEST_BYTES = 128 * 1024;

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
  'admin_custom_provider_and_system_browser_attestation_validated_enforcement_disabled',
  'private_fixture_lifecycle_validated_no_persistent_application_data',
  'private_schema_2_two_key_version_1_rehearsal_entry_edge_profile_runtime_active_user_relay_acceptance_succeeded',
  'private_bucket_created_no_application_mutation',
  'two_signing_key_versions_enabled_runtime_two_keys_published_version_1_rehearsal_entry',
  'five_initial_versions_enabled_runtime_access_validated',
  'api_enabled_one_permission_runtime_role_applied_uninvoked',
  'api_enabled_runtime_deployed_no_application_log_validation',
  'api_enabled_runtime_deployed_no_metric_validation',
  'api_enabled_user_relay_probe_succeeded_and_retired',
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
  'containeranalysis.googleapis.com',
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
    'firebase_auth_initialized_private_control_plane_signing_key_version_1_rehearsal_entry_user_relay_acceptance_succeeded_private_relays_ready',
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
    'runtime_schema',
    'security_schema',
    'published_signing_keys',
    'current_signing_key_version',
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
  exact(runtime.revision, 'control-plane-00010-vop', 'runtime.revision');
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
    '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e',
    'runtime.source_archive_sha256',
  );
  exact(
    runtime.runtime_config_sha256,
    'c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37',
    'runtime.runtime_config_sha256',
  );
  exact(runtime.runtime_schema, 'miakapp.production-runtime/2', 'runtime.runtime_schema');
  exact(runtime.security_schema, 'miakapp.production-security/2', 'runtime.security_schema');
  exact(runtime.published_signing_keys, 2, 'runtime.published_signing_keys');
  exact(runtime.current_signing_key_version, 1, 'runtime.current_signing_key_version');
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
    'enabled_versions',
    'maximum_active_versions',
    'runtime_published_versions',
    'current_runtime_version',
    'key_ring_deletion_supported',
  ]);
  exact(
    kms.state,
    'two_versions_enabled_runtime_both_published_version_1_rehearsal_entry',
    'security.kms.state',
  );
  exact(kms.location, 'europe-west9', 'security.kms.location');
  exact(kms.key_ring, 'miakapp-v4-staging', 'security.kms.key_ring');
  exact(kms.key, 'access-token-signing', 'security.kms.key');
  exact(kms.protection_level, 'SOFTWARE', 'security.kms.protection_level');
  exact(kms.purpose, 'ASYMMETRIC_SIGN', 'security.kms.purpose');
  exact(kms.algorithm, 'EC_SIGN_ED25519', 'security.kms.algorithm');
  exact(kms.automatic_rotation, false, 'security.kms.automatic_rotation');
  exactArray(kms.enabled_versions, [1, 2], 'security.kms.enabled_versions');
  exact(kms.maximum_active_versions, 2, 'security.kms.maximum_active_versions');
  exactArray(
    kms.runtime_published_versions,
    [1, 2],
    'security.kms.runtime_published_versions',
  );
  exact(kms.current_runtime_version, 1, 'security.kms.current_runtime_version');
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
    'browser_app_check_root',
    'browser_relay_services_root',
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
    'seven_roots_converged_relay_services_private_ready_succeeded_verified',
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
  exact(
    terraform.browser_app_check_root,
    'browser-app-check',
    'terraform.browser_app_check_root',
  );
  exact(
    terraform.browser_relay_services_root,
    'browser-relay-services',
    'terraform.browser_relay_services_root',
  );
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
    'browser_app_check_prefix',
    'browser_relay_services_prefix',
    'bootstrap_migration_template',
    'bootstrap_migration_state',
    'locking_enabled',
    'object_versioning_enabled',
    'public_access_prevention',
  ]);
  exact(backend.type, 'gcs', 'terraform.backend.type');
  exact(
    backend.state,
    'all_eight_terraform_state_roots_present',
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
    backend.browser_app_check_prefix,
    'terraform/browser-app-check',
    'terraform.backend.browser_app_check_prefix',
  );
  exact(
    backend.browser_relay_services_prefix,
    'terraform/browser-relay-services',
    'terraform.backend.browser_relay_services_prefix',
  );
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
    'foundation_container_analysis_adoption',
    'activation_material',
    'workload_deployment',
    'private_probe',
    'firebase_auth_baseline',
    'user_relay_probe',
    'browser_relay_plan',
    'browser_relay_runner',
    'browser_relay_page',
    'browser_relay_fixture',
    'browser_relay_fixture_cloud',
    'browser_relay_fixture_miakapi',
    'browser_relay_aggregator',
    'browser_relay_page_receipt',
    'browser_relay_scenario_fixture',
    'browser_relay_scenario_fixture_cloud',
    'browser_relay_monitoring',
    'browser_relay_rollback',
    'browser_relay_orchestrator',
    'browser_relay_operation',
    'browser_relay_image',
    'browser_app_check_prerequisite',
    'browser_app_check_attestation',
    'signing_key_overlap_prerequisite',
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
  const containerAnalysisAdoption = record(
    evidence.foundation_container_analysis_adoption,
    'evidence.foundation_container_analysis_adoption',
    [
      'state',
      'observed_at',
      'terraform_root',
      'configuration_commit',
      'terraform_version',
      'private_plan_sha256',
      'resource_address',
      'service',
      'deletion_policy',
      'result',
      'state_before',
      'state_after',
      'container_analysis_api_enabled',
      'container_scanning_api_enabled',
      'convergence_plan_no_changes',
      'new_fixed_cost_services',
      'apply_succeeded',
      'raw_plan_committed',
      'raw_state_committed',
    ],
  );
  const expectedContainerAnalysisAdoption = {
    state: 'container_analysis_enabled_foundation_converged_scanning_disabled',
    observed_at: '2026-09-05T23:33:50.000Z',
    terraform_root: 'terraform',
    configuration_commit: '9feaae67f6e72a32a8df2d5b8d8f777f4f7640f7',
    terraform_version: '1.11.3',
    private_plan_sha256: 'e0163206d78ad293f6d6c2e0067401858e27a50fcbe33984597205f81c16c297',
    resource_address: 'google_project_service.required["containeranalysis.googleapis.com"]',
    service: 'containeranalysis.googleapis.com',
    deletion_policy: 'PREVENT',
    container_analysis_api_enabled: true,
    container_scanning_api_enabled: false,
    convergence_plan_no_changes: true,
    new_fixed_cost_services: 0,
    apply_succeeded: true,
    raw_plan_committed: false,
    raw_state_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedContainerAnalysisAdoption)) {
    exact(
      containerAnalysisAdoption[field],
      expected,
      `evidence.foundation_container_analysis_adoption.${field}`,
    );
  }
  const containerAnalysisResult = record(
    containerAnalysisAdoption.result,
    'evidence.foundation_container_analysis_adoption.result',
    ['create', 'update', 'delete'],
  );
  for (const [field, expected] of Object.entries({ create: 1, update: 0, delete: 0 })) {
    exact(
      containerAnalysisResult[field],
      expected,
      `evidence.foundation_container_analysis_adoption.result.${field}`,
    );
  }
  const foundationStateKeys = [
    'generation',
    'sha256',
    'size_bytes',
    'serial',
    'managed_resources',
    'data_resources',
    'outputs',
    'lineage_sha256',
  ];
  const foundationStateExpectations = {
    state_before: {
      generation: '1788456706865449',
      sha256: 'e2eca5fc0934a51a4c9a56650665285717772fd350b59e87d18b1ec2da04d8b0',
      size_bytes: 53619,
      serial: 6,
      managed_resources: 33,
      data_resources: 3,
      outputs: 1,
      lineage_sha256: '113390906103bdbefa4bac8b5d9549f7d867c38e8e9c4bef989977a12222c7d4',
    },
    state_after: {
      generation: '1788650355101579',
      sha256: 'd02467774f19e3bbd0a596113d843e4dac99b14558c3655cd370104d3e04c32d',
      size_bytes: 54484,
      serial: 7,
      managed_resources: 34,
      data_resources: 3,
      outputs: 1,
      lineage_sha256: '113390906103bdbefa4bac8b5d9549f7d867c38e8e9c4bef989977a12222c7d4',
    },
  };
  for (const [name, expectations] of Object.entries(foundationStateExpectations)) {
    const state = record(
      containerAnalysisAdoption[name],
      `evidence.foundation_container_analysis_adoption.${name}`,
      foundationStateKeys,
    );
    for (const [field, expected] of Object.entries(expectations)) {
      exact(
        state[field],
        expected,
        `evidence.foundation_container_analysis_adoption.${name}.${field}`,
      );
    }
  }
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
    'deployed_source_repository_commit',
    'initial_plan_sha256',
    'initial_plan_result',
    'recovery_configuration_commit',
    'recovery_plan_sha256',
    'recovery_plan_result',
    'output_reconciliation_plan_sha256',
    'output_reconciliation_resource_changes',
    'source_updates',
    'runtime_migrations',
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
    state: 'active_internal_only_schema_2_two_key_version_1_rehearsal_entry_edge_profile_source_verified',
    observed_at: '2026-09-05T19:49:07.829Z',
    inventory_repository_commit: 'ba4fc9caed566fa39fc66371192fb1821b4232ff',
    deployed_repository_commit: 'ba4fc9caed566fa39fc66371192fb1821b4232ff',
    deployed_source_repository_commit: 'ba4fc9caed566fa39fc66371192fb1821b4232ff',
    initial_plan_sha256: 'b59167718fdad5edfa440f5d59f6e0eb1dff9277b20e1f829ebbb233296cdf05',
    initial_plan_result: 'failed_build_missing_conditional_source_read',
    recovery_configuration_commit: '488da23cd7eb4c08baa9296724b87b7df34a1122',
    recovery_plan_sha256: '26437631f2d8ea61883762ae854024de5c1142db9182d46e083517af211a192b',
    output_reconciliation_plan_sha256: 'a31bda9269b138b270d58a6bb992ab7902d1fc73074c0f8f2543bdf0c8f09623',
    output_reconciliation_resource_changes: 0,
    result_path: 'workload/result.json',
    result_sha256: '7aa7f4ec4b5d5bcd2b272f472361975c84dbc974dfdf24f154290d20c95b7266',
    source_archive_sha256: '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e',
    runtime_config_sha256: 'c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37',
    function_revision: 'control-plane-00010-vop',
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
  if (!Array.isArray(workload.source_updates) || workload.source_updates.length !== 5) {
    reject('evidence.workload_deployment.source_updates', 'must contain exactly 5 entries');
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
    {
      purpose: 'bounded_signing_key_overlap_runtime_bridge',
      repository_commit: '9f217da102b394734adba7ccef3f8f70d0317306',
      plan_sha256: 'ee98468a4ed92196109ac6f646030dca582068c6e2f2b5c1889e347322b1e3a6',
      source_archive_sha256: 'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8',
      function_revision: 'control-plane-00005-biq',
      terraform_state_generation: '1788581270106628',
      terraform_state_serial: 16,
      terraform_state_sha256: 'd765cceffc696905f045a34805f9c6f1a6c45e9ba3f2224754a90a157c89b428',
    },
    {
      purpose: 'bounded_staging_browser_relay_edge_profile',
      repository_commit: 'ba4fc9caed566fa39fc66371192fb1821b4232ff',
      plan_sha256: '346dd483045090c31e6bf7da715bfb2d71a3c4672a85aa16aa92992058a71393',
      source_archive_sha256: '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e',
      function_revision: 'control-plane-00010-vop',
      terraform_state_generation: '1788637742341649',
      terraform_state_serial: 26,
      terraform_state_sha256: 'e948862e0638bca565bba5a46841162fa4757c6e477f63d859c8aa47a6b8aab7',
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
  if (!Array.isArray(workload.runtime_migrations) || workload.runtime_migrations.length !== 4) {
    reject('evidence.workload_deployment.runtime_migrations', 'must contain exactly 4 entries');
  }
  const commonRuntimeMigrationFields = [
    'purpose',
    'repository_commit',
    'source_repository_commit',
    'plan_sha256',
    'from_runtime_config_sha256',
    'to_runtime_config_sha256',
    'source_archive_sha256',
    'plan_result',
    'function_revision',
    'copied_source_generation',
    'terraform_state_generation',
    'terraform_state_serial',
    'terraform_state_sha256',
    'live_request_performed',
  ];
  const expectedRuntimeMigrations = [
    {
      purpose: 'single_key_schema_1_to_schema_2',
      repository_commit: 'e42cdd70f812580a6070f0e850daa04dbe0cee42',
      source_repository_commit: '9f217da102b394734adba7ccef3f8f70d0317306',
      plan_sha256: 'f9531f2ccde649b9f4b27d63b9c2228812d7deb5101515d1572d81851ad30560',
      from_runtime_config_sha256: 'b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8',
      to_runtime_config_sha256: '20be750358ffbc2136bab26bca6338b430ea6480ae9874f3fe5e7132c5e0db10',
      source_archive_sha256: 'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8',
      function_revision: 'control-plane-00006-wid',
      copied_source_generation: '1788584317247647',
      terraform_state_generation: '1788584368457557',
      terraform_state_serial: 18,
      terraform_state_sha256: '746dcf402b9c6735175af9b46d9dda5f53f1788217f2b342c617838b6e2a8242',
      live_request_performed: false,
    },
    {
      purpose: 'signing_key_version_2_prepublication',
      repository_commit: '2bdd1a9e224234318d2ffd77c61b609331ccd044',
      source_repository_commit: '9f217da102b394734adba7ccef3f8f70d0317306',
      plan_sha256: '0ff816d86e0b391da341703744663d4d0efb2a5478c4e17fed2c7b23ca5e2e24',
      plan_metadata_sha256: '278a6aadfa0866c1e6ec8668731167c9156c413e14cccaceb535f6955bb683d0',
      plan_json_sha256: '9c8e83767293848fd1bdd398e428fb0c22f18bf3a00e228f3f89be560d3ab233',
      from_runtime_config_sha256: '20be750358ffbc2136bab26bca6338b430ea6480ae9874f3fe5e7132c5e0db10',
      to_runtime_config_sha256: 'c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37',
      source_archive_sha256: 'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8',
      function_revision: 'control-plane-00007-deb',
      function_updated_at: '2026-09-05T11:59:31.953152089Z',
      copied_source_generation: '1788609527738009',
      terraform_state_generation: '1788609578813791',
      terraform_state_serial: 20,
      terraform_state_sha256: '7233518baa49e38cbe846e148b498024c288e81222a8ed9f3cbf0cce4edab6dd',
      live_request_performed: false,
    },
    {
      purpose: 'signing_key_version_2_activation_with_version_1_retained',
      repository_commit: '6a9db97deb59b6c8e919d451c922ddb246eb54b2',
      source_repository_commit: '9f217da102b394734adba7ccef3f8f70d0317306',
      plan_sha256: '252a404d50b891cdb49e379ff8f88b598effbee13f59b7065f44b754b84ac124',
      plan_metadata_sha256: '4bab6d00b2d82d0f232dcfbbf14120957f53da43725f552adfa51cc3a556a6c9',
      plan_json_sha256: 'fd385f4216af57d810f128ccca4e44176149d2985083d21eecc8aa62d2d3608e',
      from_runtime_config_sha256: 'c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37',
      to_runtime_config_sha256: '40e2f83fbe8e3d27b7e53c4a666f424519fc6972ef19a7598ab9e093be0c70f7',
      source_archive_sha256: 'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8',
      function_revision: 'control-plane-00008-saz',
      function_updated_at: '2026-09-05T12:52:52.140270744Z',
      copied_source_generation: '1788612724252705',
      terraform_state_generation: '1788612775466023',
      terraform_state_serial: 22,
      terraform_state_sha256: '59fc885f69378118b972b76c5ae570890251215b5d232330c380d4d293ff6fd2',
      live_request_performed: false,
    },
    {
      purpose: 'browser_relay_rotation_rehearsal_entry',
      repository_commit: 'eaa7bb46ed06206fcd0c0dec100a069c54b259cf',
      source_repository_commit: '9f217da102b394734adba7ccef3f8f70d0317306',
      plan_sha256: 'e0dec2a8b92545a0fdb89ac4f0e449bbac25f6332111dfd705921eaf6ceb5e29',
      plan_metadata_sha256: 'a63c66c6787ea4b619fedf7237fef265389f167a7492089eedcc23e7cb8a8619',
      plan_json_sha256: '857d3b2cfbc779d9a67413a2367f23eb86db6ab9261d62b9a34eafea66c13254',
      from_runtime_config_sha256: '40e2f83fbe8e3d27b7e53c4a666f424519fc6972ef19a7598ab9e093be0c70f7',
      to_runtime_config_sha256: 'c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37',
      source_archive_sha256: 'd1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8',
      function_revision: 'control-plane-00009-kur',
      function_updated_at: '2026-09-05T19:04:13.514360614Z',
      copied_source_generation: '1788635007869418',
      terraform_state_generation: '1788635059003671',
      terraform_state_serial: 24,
      terraform_state_sha256: '07c0c7ef2d3130e440282a8923c15723deca39cf2d150c742bd7da4767d59283',
      live_request_performed: false,
    },
  ];
  workload.runtime_migrations.forEach((value, index) => {
    const path = `evidence.workload_deployment.runtime_migrations[${index}]`;
    const additionalFields = index >= 1
      ? ['plan_metadata_sha256', 'plan_json_sha256', 'function_updated_at']
      : [];
    const runtimeMigration = record(value, path, [
      ...commonRuntimeMigrationFields,
      ...additionalFields,
    ]);
    const runtimeMigrationPlanResult = record(
      runtimeMigration.plan_result,
      `${path}.plan_result`,
      ['create', 'update', 'delete', 'source_replaced', 'function_replaced'],
    );
    for (const [field, expected] of Object.entries(expectedRuntimeMigrations[index])) {
      exact(runtimeMigration[field], expected, `${path}.${field}`);
    }
    for (const [field, expected] of Object.entries({
      create: 0,
      update: 2,
      delete: 0,
      source_replaced: false,
      function_replaced: false,
    })) {
      exact(runtimeMigrationPlanResult[field], expected, `${path}.plan_result.${field}`);
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
    generation: '1788637742341649',
    sha256: 'e948862e0638bca565bba5a46841162fa4757c6e477f63d859c8aa47a6b8aab7',
    size_bytes: 49898,
    terraform_version: '1.11.3',
    serial: 26,
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
  const userRelayProbe = record(evidence.user_relay_probe, 'evidence.user_relay_probe', [
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
    'negative_controls',
    'successful_exchanges',
    'invalid_firebase_status',
    'invalid_firebase_code',
    'missing_app_check_status',
    'missing_app_check_code',
    'missing_home_status',
    'missing_home_code',
    'first_exchange_status',
    'second_exchange_status',
    'firebase_auth_validated',
    'app_check_validated',
    'app_check_token_consumption',
    'browser_provider_attestation_validated',
    'token_signatures_validated',
    'token_audiences_changed',
    'synthetic_user_created',
    'synthetic_user_deleted',
    'independent_user_absence_verified',
    'synthetic_home_created',
    'synthetic_home_deleted',
    'independent_home_absence_verified',
    'relay_rotated',
    'public_home_written',
    'owner_matches_authenticated_user',
    'workflow_present',
    'verifier_service_present',
    'temporary_bindings_present',
    'retained_disabled_custom_roles',
    'recurring_compute',
    'private_bundle_committed',
    'execution_identifiers_committed',
    'token_material_committed',
    'raw_diagnostics_committed',
  ]);
  const expectedUserRelayProbe = {
    state: 'succeeded_and_retired',
    observed_at: '2026-09-05T02:00:51.901Z',
    repository_commit: '3f90549156148496702edfa657d5dd5c6394a32f',
    workflow_source_sha256: 'b77c484f3ffb8a81fb4bf5bebfecc420ab33604e99559518fc354a4e0dcc4d56',
    workflow_revision: '000001-34e',
    result_path: 'auth-probe/result.json',
    result_sha256: '62734e6418e44cef68c60fc686a456643a908098c1fff6f8d52505dbfe9c01ce',
    retirement_path: 'auth-probe/retirement.json',
    retirement_sha256: 'b2f3977b83bee7e8427a5a90a04e3c3ab04b28fcb8fcfa26a9c449fef4de42ac',
    execution_duration_milliseconds: 10_786,
    execution_count: 1,
    product_requests: 5,
    negative_controls: 3,
    successful_exchanges: 2,
    invalid_firebase_status: 401,
    invalid_firebase_code: 'invalid_firebase_token',
    missing_app_check_status: 401,
    missing_app_check_code: 'invalid_app_check_token',
    missing_home_status: 404,
    missing_home_code: 'home_not_found',
    first_exchange_status: 200,
    second_exchange_status: 200,
    firebase_auth_validated: true,
    app_check_validated: true,
    app_check_token_consumption: false,
    browser_provider_attestation_validated: false,
    token_signatures_validated: true,
    token_audiences_changed: true,
    synthetic_user_created: true,
    synthetic_user_deleted: true,
    independent_user_absence_verified: true,
    synthetic_home_created: true,
    synthetic_home_deleted: true,
    independent_home_absence_verified: true,
    relay_rotated: true,
    public_home_written: false,
    owner_matches_authenticated_user: false,
    workflow_present: false,
    verifier_service_present: false,
    temporary_bindings_present: false,
    retained_disabled_custom_roles: 9,
    recurring_compute: false,
    private_bundle_committed: false,
    execution_identifiers_committed: false,
    token_material_committed: false,
    raw_diagnostics_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedUserRelayProbe)) {
    exact(userRelayProbe[field], expected, `evidence.user_relay_probe.${field}`);
  }
  const browserRelayPlan = record(
    evidence.browser_relay_plan,
    'evidence.browser_relay_plan',
    [
      'state',
      'path',
      'sha256',
      'page_profile_sha256',
      'baseline_observed_at',
      'baseline_control_plane_revision',
      'baseline_published_signing_keys',
      'baseline_current_signing_key_version',
      'browser_attestation_validated',
      'firebase_auth_users',
      'application_fixture_collections',
      'open_preconditions',
      'cloud_mutation_authorized_by_plan',
      'acceptance_executed',
      'public_ingress_active',
      'relay_services',
      'runner_present',
      'completed_cases',
    ],
  );
  const expectedBrowserRelayPlan = {
    state:
      'page_three_engine_ci_pinned_operation_preflighted_edge_orchestrator_preflighted_rollback_preflighted_monitoring_observed_runner_implemented_private_relays_ready_plan_rebased_not_deployed',
    path: BROWSER_RELAY_PLAN_PATH,
    sha256: BROWSER_RELAY_PLAN_SHA256,
    page_profile_sha256: BROWSER_RELAY_PAGE_V2_PROFILE_SHA256,
    baseline_observed_at: '2026-09-06T09:15:20.386Z',
    baseline_control_plane_revision: 'control-plane-00010-vop',
    baseline_published_signing_keys: 2,
    baseline_current_signing_key_version: 1,
    browser_attestation_validated: true,
    firebase_auth_users: 0,
    application_fixture_collections: 0,
    open_preconditions: 0,
    cloud_mutation_authorized_by_plan: false,
    acceptance_executed: false,
    public_ingress_active: false,
    relay_services: 2,
    runner_present: false,
    completed_cases: 0,
  };
  for (const [field, expected] of Object.entries(expectedBrowserRelayPlan)) {
    exact(browserRelayPlan[field], expected, `evidence.browser_relay_plan.${field}`);
  }
  const browserRelayRunner = record(
    evidence.browser_relay_runner,
    'evidence.browser_relay_runner',
    [
      'state',
      'profile_path',
      'profile_sha256',
      'browser_relay_plan_sha256',
      'miakapi_commit',
      'playwright_version',
      'browser_engines',
      'maximum_invocations',
      'sequential',
      'maximum_total_milliseconds',
      'chromium_deadline_milliseconds',
      'secondary_browser_deadline_milliseconds',
      'output_assertions',
      'cloud_compute_resources',
      'three_engine_ci_gate_present',
      'cloud_mutation_authorized',
      'public_ingress_authorized',
      'live_execution_authorized',
      'live_execution_count',
      'result_present',
      'credentials_committed',
      'raw_diagnostics_committed',
    ],
  );
  const expectedBrowserRelayRunner = {
    state: 'three_engine_closed_runner_implemented_not_executed',
    profile_path: BROWSER_RELAY_RUNNER_PROFILE_PATH,
    profile_sha256: BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    browser_relay_plan_sha256: BROWSER_RELAY_V9_PLAN_SHA256,
    miakapi_commit: 'a798a746847ba3d5c16128a08b33353269e770a4',
    playwright_version: '1.62.1',
    browser_engines: 3,
    maximum_invocations: 3,
    sequential: true,
    maximum_total_milliseconds: 840_000,
    chromium_deadline_milliseconds: 720_000,
    secondary_browser_deadline_milliseconds: 60_000,
    output_assertions: 40,
    cloud_compute_resources: 0,
    three_engine_ci_gate_present: true,
    cloud_mutation_authorized: false,
    public_ingress_authorized: false,
    live_execution_authorized: false,
    live_execution_count: 0,
    result_present: false,
    credentials_committed: false,
    raw_diagnostics_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserRelayRunner)) {
    exact(browserRelayRunner[field], expected, `evidence.browser_relay_runner.${field}`);
  }
  const browserRelayMonitoring = record(
    evidence.browser_relay_monitoring,
    'evidence.browser_relay_monitoring',
    [
      'state',
      'profile_path',
      'profile_sha256',
      'preflight_result_path',
      'preflight_result_sha256',
      'implementation_commit',
      'browser_relay_plan_sha256',
      'observed_at',
      'control_plane_state',
      'control_plane_revision',
      'control_plane_public_invokers',
      'relay_phase',
      'relay_services',
      'relay_public_invokers',
      'metric_descriptors_observed',
      'allowlisted_queries_succeeded',
      'series_headers_observed',
      'budget_state',
      'budget_amount_eur',
      'budget_thresholds_eur',
      'budget_project_level_recipients',
      'cloud_mutations',
      'public_ingress_changes',
      'acceptance_executions',
      'credentials_committed',
      'raw_cloud_responses_committed',
    ],
  );
  const expectedBrowserRelayMonitoring = {
    state: 'allowlisted_monitoring_observed_at_private_boundary',
    profile_path: MONITORING_PROFILE_PATH,
    profile_sha256: MONITORING_PROFILE_SHA256,
    preflight_result_path: MONITORING_PREFLIGHT_RESULT_PATH,
    preflight_result_sha256: MONITORING_PREFLIGHT_RESULT_SHA256,
    implementation_commit: MONITORING_IMPLEMENTATION_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_V10_PLAN_SHA256,
    observed_at: '2026-09-06T06:09:31.222Z',
    control_plane_state: 'canonical_private',
    control_plane_revision: 'control-plane-00010-vop',
    control_plane_public_invokers: 0,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    metric_descriptors_observed: 6,
    allowlisted_queries_succeeded: 6,
    series_headers_observed: 0,
    budget_state: 'configured',
    budget_amount_eur: 10,
    budget_thresholds_eur: [2, 5, 10],
    budget_project_level_recipients: true,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserRelayMonitoring)) {
    if (Array.isArray(expected)) {
      exactArray(
        browserRelayMonitoring[field],
        expected,
        `evidence.browser_relay_monitoring.${field}`,
      );
    } else {
      exact(
        browserRelayMonitoring[field],
        expected,
        `evidence.browser_relay_monitoring.${field}`,
      );
    }
  }
  const browserRelayRollback = record(
    evidence.browser_relay_rollback,
    'evidence.browser_relay_rollback',
    [
      'state',
      'profile_path',
      'profile_sha256',
      'preflight_result_path',
      'preflight_result_sha256',
      'implementation_commit',
      'browser_relay_plan_sha256',
      'observed_at',
      'control_plane_state',
      'control_plane_revision',
      'control_plane_ingress',
      'control_plane_public_invokers',
      'relay_phase',
      'relay_services',
      'relay_public_invokers',
      'relay_service_account_user_managed_keys',
      'relay_inventory_sha256',
      'runner_route_present',
      'runner_route_status',
      'firebase_auth_users',
      'application_fixture_collections',
      'temporary_iam_bindings',
      'minimum_instances',
      'terraform_convergence',
      'terraform_managed_resource_noops',
      'rollback_steps',
      'cloud_mutations',
      'public_ingress_changes',
      'acceptance_executions',
      'credentials_committed',
      'raw_cloud_responses_committed',
      'terraform_plan_committed',
    ],
  );
  const expectedBrowserRelayRollback = {
    state: 'rollback_target_preflighted_private_and_converged',
    profile_path: ROLLBACK_PROFILE_PATH,
    profile_sha256: ROLLBACK_PROFILE_SHA256,
    preflight_result_path: ROLLBACK_PREFLIGHT_RESULT_PATH,
    preflight_result_sha256: ROLLBACK_PREFLIGHT_RESULT_SHA256,
    implementation_commit: ROLLBACK_IMPLEMENTATION_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_V11_PLAN_SHA256,
    observed_at: '2026-09-06T07:06:13.282Z',
    control_plane_state: 'canonical_private',
    control_plane_revision: 'control-plane-00010-vop',
    control_plane_ingress: 'ALLOW_INTERNAL_ONLY',
    control_plane_public_invokers: 0,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    relay_service_account_user_managed_keys: 0,
    relay_inventory_sha256:
      '421338fec676c1fccd0e6747d3e8837d4151b147c95b343172639800779b64d1',
    runner_route_present: false,
    runner_route_status: 404,
    firebase_auth_users: 0,
    application_fixture_collections: 0,
    temporary_iam_bindings: 0,
    minimum_instances: 0,
    terraform_convergence: 'no_changes',
    terraform_managed_resource_noops: 4,
    rollback_steps: 6,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
    terraform_plan_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserRelayRollback)) {
    exact(
      browserRelayRollback[field],
      expected,
      `evidence.browser_relay_rollback.${field}`,
    );
  }
  const browserRelayOrchestrator = record(
    evidence.browser_relay_orchestrator,
    'evidence.browser_relay_orchestrator',
    [
      'state',
      'profile_path',
      'profile_sha256',
      'preflight_result_path',
      'preflight_result_sha256',
      'implementation_base_commit',
      'implementation_commit',
      'browser_relay_plan_sha256',
      'satisfied_input_preconditions',
      'closed_precondition',
      'observed_at',
      'claim_bucket',
      'claim_object',
      'claim_state',
      'claim_if_generation_match',
      'maximum_claim_creations',
      'claim_precedes_first_cloud_mutation',
      'baseline_reobserved_after_claim',
      'ambiguous_claim_stops_before_edge_mutation',
      'claim_retained',
      'retry_authorized',
      'deletion_authorized',
      'maximum_edge_window_executions',
      'maximum_public_window_milliseconds',
      'maximum_callback_execution_milliseconds',
      'orchestration_stages',
      'automatic_edge_rollback',
      'control_plane_state',
      'control_plane_revision',
      'control_plane_public_invokers',
      'relay_phase',
      'relay_services',
      'relay_public_invokers',
      'terraform_convergence',
      'terraform_managed_resource_noops',
      'live_preflight_count',
      'live_execution_count',
      'claim_creations',
      'cloud_mutations',
      'public_ingress_changes',
      'acceptance_executions',
      'credentials_committed',
      'raw_cloud_responses_committed',
      'terraform_plan_committed',
      'browser_diagnostics_committed',
    ],
  );
  const expectedBrowserRelayOrchestrator = {
    state: 'single_use_edge_orchestrator_preflight_succeeded_private_and_unclaimed',
    profile_path: ORCHESTRATOR_PROFILE_PATH,
    profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    preflight_result_path: ORCHESTRATOR_PREFLIGHT_RESULT_PATH,
    preflight_result_sha256: ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    implementation_base_commit: ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
    implementation_commit: ORCHESTRATOR_IMPLEMENTATION_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_V12_PLAN_SHA256,
    satisfied_input_preconditions: 8,
    closed_precondition: 'EDGE-01',
    observed_at: '2026-09-06T08:06:38.345Z',
    claim_bucket: ORCHESTRATOR_CLAIM_BUCKET,
    claim_object: ORCHESTRATOR_CLAIM_OBJECT,
    claim_state: 'absent',
    claim_if_generation_match: 0,
    maximum_claim_creations: 1,
    claim_precedes_first_cloud_mutation: true,
    baseline_reobserved_after_claim: true,
    ambiguous_claim_stops_before_edge_mutation: true,
    claim_retained: true,
    retry_authorized: false,
    deletion_authorized: false,
    maximum_edge_window_executions: 1,
    maximum_public_window_milliseconds: 1_200_000,
    maximum_callback_execution_milliseconds: 900_000,
    orchestration_stages: 7,
    automatic_edge_rollback: true,
    control_plane_state: 'canonical_private',
    control_plane_revision: 'control-plane-00010-vop',
    control_plane_public_invokers: 0,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    terraform_convergence: 'no_changes',
    terraform_managed_resource_noops: 4,
    live_preflight_count: 1,
    live_execution_count: 0,
    claim_creations: 0,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
    terraform_plan_committed: false,
    browser_diagnostics_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserRelayOrchestrator)) {
    exact(
      browserRelayOrchestrator[field],
      expected,
      `evidence.browser_relay_orchestrator.${field}`,
    );
  }
  const browserRelayOperation = record(
    evidence.browser_relay_operation,
    'evidence.browser_relay_operation',
    [
      'state',
      'profile_path',
      'profile_sha256',
      'preflight_result_path',
      'preflight_result_sha256',
      'implementation_base_commit',
      'implementation_commit',
      'browser_relay_plan_sha256',
      'orchestrator_profile_sha256',
      'orchestrator_preflight_result_sha256',
      'runner_profile_sha256',
      'monitoring_profile_sha256',
      'monitoring_preflight_result_sha256',
      'rollback_profile_sha256',
      'rollback_preflight_result_sha256',
      'relay_services_private_ready_result_sha256',
      'maximum_operation_executions',
      'maximum_claim_creations',
      'maximum_edge_window_executions',
      'maximum_matrix_executions',
      'maximum_browser_invocations',
      'maximum_public_window_milliseconds',
      'maximum_callback_execution_milliseconds',
      'window_stages',
      'window_cleanup_stages',
      'post_edge_cleanup_stages',
      'relay_public_transition_is_last_before_matrix',
      'observed_at',
      'claim_bucket',
      'claim_object',
      'claim_state',
      'control_plane_state',
      'control_plane_revision',
      'control_plane_ingress',
      'control_plane_public_invokers',
      'relay_phase',
      'relay_services',
      'relay_public_invokers',
      'relay_service_account_user_managed_keys',
      'relay_inventory_sha256',
      'runner_route_present',
      'runner_route_status',
      'firebase_auth_users',
      'application_fixture_collections',
      'temporary_iam_bindings',
      'minimum_instances',
      'terraform_convergence',
      'terraform_managed_resource_noops',
      'cloud_compute_resources',
      'cloud_mutation_authorized',
      'public_ingress_authorized',
      'live_execution_authorized',
      'live_preflight_count',
      'live_execution_count',
      'claim_creations',
      'cloud_mutations',
      'public_ingress_changes',
      'acceptance_executions',
      'result_present',
      'credentials_committed',
      'raw_cloud_responses_committed',
      'terraform_plan_committed',
      'browser_diagnostics_committed',
    ],
  );
  const operationProfile = validateBrowserRelayOperationProfile();
  const operationResult = validateOperationPreflightResult();
  const expectedBrowserRelayOperation = {
    state: operationResult.state,
    profile_path: OPERATION_PROFILE_PATH,
    profile_sha256: OPERATION_PROFILE_SHA256,
    preflight_result_path: OPERATION_PREFLIGHT_RESULT_PATH,
    preflight_result_sha256: OPERATION_PREFLIGHT_RESULT_SHA256,
    implementation_base_commit: OPERATION_IMPLEMENTATION_BASE_COMMIT,
    implementation_commit: OPERATION_IMPLEMENTATION_COMMIT,
    browser_relay_plan_sha256: BROWSER_RELAY_V13_PLAN_SHA256,
    orchestrator_profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    orchestrator_preflight_result_sha256: ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    runner_profile_sha256: BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    monitoring_profile_sha256: MONITORING_PROFILE_SHA256,
    monitoring_preflight_result_sha256: MONITORING_PREFLIGHT_RESULT_SHA256,
    rollback_profile_sha256: ROLLBACK_PROFILE_SHA256,
    rollback_preflight_result_sha256: ROLLBACK_PREFLIGHT_RESULT_SHA256,
    relay_services_private_ready_result_sha256:
      RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    maximum_operation_executions: operationProfile.execution.maximum_operation_executions,
    maximum_claim_creations: operationProfile.execution.maximum_claim_creations,
    maximum_edge_window_executions:
      operationProfile.execution.maximum_edge_window_executions,
    maximum_matrix_executions: operationProfile.execution.maximum_matrix_executions,
    maximum_browser_invocations: operationProfile.execution.maximum_browser_invocations,
    maximum_public_window_milliseconds:
      operationProfile.execution.maximum_public_window_milliseconds,
    maximum_callback_execution_milliseconds:
      operationProfile.execution.maximum_callback_execution_milliseconds,
    window_stages: operationProfile.execution.window_stages.length,
    window_cleanup_stages: operationProfile.recovery.window_cleanup_order.length,
    post_edge_cleanup_stages: operationProfile.recovery.post_edge_cleanup_order.length,
    relay_public_transition_is_last_before_matrix:
      operationProfile.execution.relay_public_transition_is_last_before_matrix,
    observed_at: operationResult.observed_at,
    claim_bucket: operationResult.claim_bucket,
    claim_object: operationResult.claim_object,
    claim_state: operationResult.claim_state,
    control_plane_state: operationResult.control_plane_state,
    control_plane_revision: operationResult.control_plane_revision,
    control_plane_ingress: operationResult.control_plane_ingress,
    control_plane_public_invokers: operationResult.control_plane_public_invokers,
    relay_phase: operationResult.relay_phase,
    relay_services: operationResult.relay_services,
    relay_public_invokers: operationResult.relay_public_invokers,
    relay_service_account_user_managed_keys:
      operationResult.relay_service_account_user_managed_keys,
    relay_inventory_sha256: operationResult.relay_inventory_sha256,
    runner_route_present: operationResult.runner_route_present,
    runner_route_status: operationResult.runner_route_status,
    firebase_auth_users: operationResult.firebase_auth_users,
    application_fixture_collections: operationResult.application_fixture_collections,
    temporary_iam_bindings: operationResult.temporary_iam_bindings,
    minimum_instances: operationResult.minimum_instances,
    terraform_convergence: operationResult.terraform_convergence,
    terraform_managed_resource_noops: operationResult.terraform_managed_resource_noops,
    cloud_compute_resources: operationProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      operationProfile.target.cloud_mutation_authorized_by_profile,
    public_ingress_authorized:
      operationProfile.target.public_ingress_authorized_by_profile,
    live_execution_authorized:
      operationProfile.target.acceptance_execution_authorized_by_profile,
    live_preflight_count: 1,
    live_execution_count: operationProfile.evidence.live_execution_count,
    claim_creations: operationProfile.evidence.claim_creations,
    cloud_mutations: operationResult.cloud_mutations,
    public_ingress_changes: operationResult.public_ingress_changes,
    acceptance_executions: operationResult.acceptance_executions,
    result_present: true,
    credentials_committed: operationResult.credential_material_retained,
    raw_cloud_responses_committed: operationResult.raw_cloud_responses_retained,
    terraform_plan_committed: operationResult.terraform_plan_retained,
    browser_diagnostics_committed:
      operationProfile.evidence.browser_diagnostics_committed,
  };
  for (const [field, expected] of Object.entries(expectedBrowserRelayOperation)) {
    exact(
      browserRelayOperation[field],
      expected,
      `evidence.browser_relay_operation.${field}`,
    );
  }
  const browserRelayImage = record(
    evidence.browser_relay_image,
    'evidence.browser_relay_image',
    [
      'state',
      'profile_path',
      'profile_sha256',
      'v1_profile_path',
      'v1_profile_sha256',
      'v1_result_path',
      'v1_result_sha256',
      'v2_result_path',
      'v2_result_sha256',
      'v2_result_observed_at',
      'browser_relay_plan_sha256',
      'relay_services_profile_path',
      'relay_services_profile_sha256',
      'relay_services_v1_profile_path',
      'relay_services_v1_profile_sha256',
      'relay_services_v2_profile_path',
      'relay_services_v2_profile_sha256',
      'relay_services_v3_profile_path',
      'relay_services_v3_profile_sha256',
      'relay_services_v4_profile_path',
      'relay_services_v4_profile_sha256',
      'relay_services_v5_profile_path',
      'relay_services_v5_profile_sha256',
      'relay_services_bootstrap_failure_path',
      'relay_services_bootstrap_failure_sha256',
      'relay_services_memory_recovery_failure_path',
      'relay_services_memory_recovery_failure_sha256',
      'relay_services_private_ready_result_path',
      'relay_services_private_ready_result_sha256',
      'relay_services_bootstrap_attempted',
      'relay_services_bootstrap_failure_category',
      'relay_services_memory_recovery_attempted',
      'relay_services_memory_recovery_failure_category',
      'relay_services_original_claim_generation',
      'relay_services_original_claim_sha256',
      'relay_services_memory_recovery_claim_generation',
      'relay_services_memory_recovery_claim_sha256',
      'relay_services_private_ready_attempted',
      'relay_services_private_ready_claim_generation',
      'relay_services_private_ready_claim_sha256',
      'relay_services_partial_state_generation',
      'relay_services_partial_state_sha256',
      'relay_services_partial_state_serial',
      'relay_services_recovered_state_generation',
      'relay_services_recovered_state_sha256',
      'relay_services_recovered_state_serial',
      'relay_services_private_ready_state_generation',
      'relay_services_private_ready_state_sha256',
      'relay_services_private_ready_state_serial',
      'relay_services_original_entrypoints_retired',
      'relay_services_recovery_entrypoints_retired',
      'relay_services_private_ready_entrypoints_retired',
      'relay_services_private_ready_entrypoint_present',
      'relay_services_image_bound',
      'relay_services_operator_entrypoint_present',
      'source_repository',
      'source_commit',
      'source_tree',
      'source_archive_sha256',
      'source_archive_bytes',
      'source_object_generation',
      'source_reuse_required',
      'source_reused',
      'source_upload_authorized',
      'source_upload_performed',
      'builder_digest',
      'machine_type',
      'requested_verify_option',
      'maximum_builds',
      'v1_attempted_builds',
      'v2_attempted_builds',
      'v2_claim_present',
      'v2_claim_generation',
      'v2_claim_sha256',
      'v2_build_id',
      'v2_operation_name_sha256',
      'v1_private_image_present',
      'verified_image_present',
      'verified_image_digest',
      'verified_image_config_digest',
      'verified_image_compressed_bytes',
      'deployment_authorized_by_image_operation',
      'entrypoints_retired',
      'container_analysis_api_enabled',
      'container_scanning_api_enabled',
      'relay_services',
      'relay_services_cloud_run_ready',
      'relay_services_private_ready',
      'relay_services_network_ingress',
      'relay_services_public_iam_members',
      'unauthenticated_public_invocation_active',
      'new_fixed_cost_services',
      'maximum_incremental_eur',
    ],
  );
  const expectedBrowserRelayImage = {
    state:
      'v1_failed_container_analysis_converged_v2_recovery_succeeded_verified_private_relay_services_private_ready_succeeded_verified_entrypoints_retired_public_window_not_authorized',
    profile_path: RELAY_IMAGE_PROFILE_PATH,
    profile_sha256: RELAY_IMAGE_PROFILE_SHA256,
    v1_profile_path: RELAY_IMAGE_V1_PROFILE_PATH,
    v1_profile_sha256: RELAY_IMAGE_V1_PROFILE_SHA256,
    v1_result_path: RELAY_IMAGE_V1_RESULT_PATH,
    v1_result_sha256: RELAY_IMAGE_V1_RESULT_SHA256,
    v2_result_path: RELAY_IMAGE_V2_RESULT_PATH,
    v2_result_sha256: RELAY_IMAGE_V2_RESULT_SHA256,
    v2_result_observed_at: '2026-09-06T00:00:34.396Z',
    browser_relay_plan_sha256: BROWSER_RELAY_V8_PLAN_SHA256,
    relay_services_profile_path: RELAY_SERVICES_PROFILE_PATH,
    relay_services_profile_sha256: RELAY_SERVICES_PROFILE_SHA256,
    relay_services_v1_profile_path: RELAY_SERVICES_V1_PROFILE_PATH,
    relay_services_v1_profile_sha256: RELAY_SERVICES_V1_PROFILE_SHA256,
    relay_services_v2_profile_path: RELAY_SERVICES_V2_PROFILE_PATH,
    relay_services_v2_profile_sha256: RELAY_SERVICES_V2_PROFILE_SHA256,
    relay_services_v3_profile_path: RELAY_SERVICES_V3_PROFILE_PATH,
    relay_services_v3_profile_sha256: RELAY_SERVICES_V3_PROFILE_SHA256,
    relay_services_v4_profile_path: RELAY_SERVICES_V4_PROFILE_PATH,
    relay_services_v4_profile_sha256: RELAY_SERVICES_V4_PROFILE_SHA256,
    relay_services_v5_profile_path: RELAY_SERVICES_V5_PROFILE_PATH,
    relay_services_v5_profile_sha256: RELAY_SERVICES_V5_PROFILE_SHA256,
    relay_services_bootstrap_failure_path: RELAY_SERVICES_BOOTSTRAP_FAILURE_PATH,
    relay_services_bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    relay_services_memory_recovery_failure_path: RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_PATH,
    relay_services_memory_recovery_failure_sha256:
      RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256,
    relay_services_private_ready_result_path: RELAY_SERVICES_PRIVATE_READY_RESULT_PATH,
    relay_services_private_ready_result_sha256: RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    relay_services_bootstrap_attempted: true,
    relay_services_bootstrap_failure_category: 'cloud_run_gen2_memory_below_minimum',
    relay_services_memory_recovery_attempted: true,
    relay_services_memory_recovery_failure_category:
      'cloud_run_binary_authorization_false_not_round_tripped',
    relay_services_original_claim_generation: '1788658024634812',
    relay_services_original_claim_sha256:
      '92b94cce96d70d9d55482ae4612f2192cd4686d8d5ee160270cbeb2d74773ac4',
    relay_services_memory_recovery_claim_generation: '1788661237671763',
    relay_services_memory_recovery_claim_sha256:
      '9f8d46aea073062fce6334dcb8c5b3f128d880624878908e4c9b09db06ed61b1',
    relay_services_private_ready_attempted: true,
    relay_services_private_ready_claim_generation: '1788664144376292',
    relay_services_private_ready_claim_sha256:
      'db90861c9ad7fbbbb66a19d75f2fd67c37ad55e86f309529e4a77cec0feb5ef5',
    relay_services_partial_state_generation: '1788658040492801',
    relay_services_partial_state_sha256:
      'c703ae655eb8b6292ae73ffa76d0746809190e312311fa5171e7bf5977fc27fc',
    relay_services_partial_state_serial: 2,
    relay_services_recovered_state_generation: '1788661250283535',
    relay_services_recovered_state_sha256:
      'a91d739f31a01854183b98a8fdc36c58365d166d8c721471ca12b27251596e76',
    relay_services_recovered_state_serial: 3,
    relay_services_private_ready_state_generation: '1788664157688934',
    relay_services_private_ready_state_sha256:
      '401101ec2a802fb61171fd4446f7be718c5fa912b64b18d3c738ba4c36919ac0',
    relay_services_private_ready_state_serial: 4,
    relay_services_original_entrypoints_retired: true,
    relay_services_recovery_entrypoints_retired: true,
    relay_services_private_ready_entrypoints_retired: true,
    relay_services_private_ready_entrypoint_present: false,
    relay_services_image_bound: true,
    relay_services_operator_entrypoint_present: false,
    source_repository: 'https://github.com/Miakapp/Miakapp-Server.git',
    source_commit: 'df10674e034f30eec80760f5ec94bc108cff026f',
    source_tree: '0468ea08cd2d51b3e656c4adea9bb09b4a8a6ea1',
    source_archive_sha256: '93fd720736453e3555be625bbb993194f48a5388821169c939674b04088f158e',
    source_archive_bytes: 53098,
    source_object_generation: '1788648564283151',
    source_reuse_required: true,
    source_reused: true,
    source_upload_authorized: false,
    source_upload_performed: false,
    builder_digest: 'sha256:3d00b6c1a9b862621c30fc74d4f2abfc62bcbdee631ed3febd31e7edbdf6252c',
    machine_type: 'E2_MEDIUM',
    requested_verify_option: 'VERIFIED',
    maximum_builds: 1,
    v1_attempted_builds: 1,
    v2_attempted_builds: 1,
    v2_claim_present: true,
    v2_claim_generation: '1788652620212083',
    v2_claim_sha256: 'ac1f6a326b54306737f3e4d885f55aec4e43fe3ecf6144324e51e2199dca1b03',
    v2_build_id: '70e25c75-3c30-497a-982a-f7bebe71c4ee',
    v2_operation_name_sha256:
      '06805ae5a324a35b13963c1b5d6f30a839513c1e94b48eba845adca6582ecf19',
    v1_private_image_present: true,
    verified_image_present: true,
    verified_image_digest:
      'sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1',
    verified_image_config_digest:
      'sha256:344314bad3b6f6f1f280737b3d010cdcafb2ead6cf868c8b97e2c367401001a9',
    verified_image_compressed_bytes: 4024536,
    deployment_authorized_by_image_operation: false,
    entrypoints_retired: true,
    container_analysis_api_enabled: true,
    container_scanning_api_enabled: false,
    relay_services: 2,
    relay_services_cloud_run_ready: 2,
    relay_services_private_ready: 2,
    relay_services_network_ingress: 'INGRESS_TRAFFIC_ALL',
    relay_services_public_iam_members: 0,
    unauthenticated_public_invocation_active: false,
    new_fixed_cost_services: 0,
    maximum_incremental_eur: 1,
  };
  for (const [field, expected] of Object.entries(expectedBrowserRelayImage)) {
    exact(browserRelayImage[field], expected, `evidence.browser_relay_image.${field}`);
  }
  const browserAppCheck = record(
    evidence.browser_app_check_prerequisite,
    'evidence.browser_app_check_prerequisite',
    [
      'state',
      'observed_at',
      'terraform_root',
      'repository_commit',
      'result_path',
      'result_sha256',
      'terraform_plan_sha256',
      'baseline_sha256',
      'terraform_apply_reported_success',
      'state_recovery',
      'final_inventory_sha256',
      'global_key_attempt_claim',
      'global_registration_attempt_claim',
      'global_provider_attempt_claim',
      'terraform_state',
      'recaptcha_api_enabled',
      'direct_key_inventory',
      'authoritative_recaptcha_keys',
      'cloud_asset_inventory',
      'cloud_asset_recaptcha_keys',
      'recaptcha_keys_created',
      'recaptcha_key',
      'app_check_provider',
      'app_check_enforcement_records',
      'debug_tokens',
      'public_site_key_committed',
      'raw_provider_config_committed',
      'legacy_secret_retrievals_by_driver',
      'public_endpoints_created',
      'fixed_cost_services',
      'coordination_objects_created',
      'browser_requests_initiated_by_driver',
      'assessments_initiated_by_driver',
      'apply_executed',
      'entrypoints_retired',
      'recovery_entrypoints_retired',
      'private_bundle_committed',
      'raw_plan_committed',
      'raw_state_committed',
    ],
  );
  const expectedBrowserAppCheck = {
    state: 'nondeletable_app_check_provider_registered_enforcement_disabled',
    observed_at: '2026-09-05T10:21:22.000Z',
    terraform_root: 'browser-app-check',
    repository_commit: '67c6947231c2b4a515e74a3b7a27ea972f1dcd15',
    result_path: 'browser-app-check/result.json',
    result_sha256: '9310b4aea71c11c33efcb5b92059e8424aec0999ea3f2759aeb3d9bec32e6436',
    terraform_plan_sha256: '9af7eaf470ce1a65f3737823135604a31ea6cbbd2575bd1afcc17d00033dfee7',
    baseline_sha256: '4545f379199b8b41d6dbabd24fb073f63ae6863cbbf88cdc4c65bd6658e445ef',
    terraform_apply_reported_success: true,
    state_recovery: null,
    final_inventory_sha256: '9ca5fd3ba22c4238024a8db82613053f86b2f53c47b3197844b0c4300fdd5ad3',
    recaptcha_api_enabled: true,
    direct_key_inventory: 'readable',
    authoritative_recaptcha_keys: 1,
    cloud_asset_inventory: 'readable_eventually_consistent',
    cloud_asset_recaptcha_keys: 1,
    recaptcha_keys_created: 1,
    app_check_enforcement_records: 0,
    debug_tokens: 0,
    public_site_key_committed: false,
    raw_provider_config_committed: false,
    legacy_secret_retrievals_by_driver: 0,
    public_endpoints_created: 0,
    fixed_cost_services: 0,
    coordination_objects_created: 3,
    browser_requests_initiated_by_driver: 0,
    assessments_initiated_by_driver: 0,
    apply_executed: true,
    entrypoints_retired: true,
    recovery_entrypoints_retired: true,
    private_bundle_committed: false,
    raw_plan_committed: false,
    raw_state_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAppCheck)) {
    exact(
      browserAppCheck[field],
      expected,
      `evidence.browser_app_check_prerequisite.${field}`,
    );
  }
  const browserAppCheckState = record(
    browserAppCheck.terraform_state,
    'evidence.browser_app_check_prerequisite.terraform_state',
    [
      'schema',
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
      'recaptcha_key_name_sha256',
      'app_check_config_name',
      'app_check_config_id',
      'app_check_site_key_sha256',
      'app_check_token_ttl',
      'raw_contents_committed',
    ],
  );
  const expectedBrowserAppCheckState = {
    schema: 'miakapp.staging-browser-app-check-registration-state/1',
    object: 'terraform/browser-app-check/default.tfstate',
    generation: '1788603682439071',
    sha256: 'e05629171f5efd2bfe68657a5fd1567de0b5e0769948ef751ff0a3aba26f41dc',
    size_bytes: 15925,
    terraform_version: '1.11.3',
    serial: 5,
    lineage_sha256: 'f6640c6c40b21a544f3ddc3ee8005f8a1d9d2eaa19dd79ba5fca5709394d9601',
    managed_resources: 4,
    data_resources: 2,
    outputs: 1,
    tainted_resources: 0,
    recaptcha_key_name_sha256: '997f375ee6db0535dd3934dcc6ffb941f10efd5516e29b27c4caa6b8157851fb',
    app_check_config_name: 'projects/1072737219170/apps/1:1072737219170:web:5053ca93bf25d7373cd73b/recaptchaEnterpriseConfig',
    app_check_config_id: 'projects/miakapp-v4-staging/apps/1:1072737219170:web:5053ca93bf25d7373cd73b/recaptchaEnterpriseConfig',
    app_check_site_key_sha256: '8a76f0f2cc0e0b002ed66c7f7d01ac28a6d44cb74ad2d33c3a7b0f0203e58546',
    app_check_token_ttl: '3600s',
    raw_contents_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAppCheckState)) {
    exact(
      browserAppCheckState[field],
      expected,
      `evidence.browser_app_check_prerequisite.terraform_state.${field}`,
    );
  }
  const browserAppCheckKeyClaim = record(
    browserAppCheck.global_key_attempt_claim,
    'evidence.browser_app_check_prerequisite.global_key_attempt_claim',
    [
      'schema',
      'bucket',
      'object',
      'generation',
      'size_bytes',
      'sha256',
      'repository_commit',
      'terraform_plan_sha256',
      'baseline_sha256',
      'retry_authorized',
      'deletion_authorized',
      'raw_contents_committed',
    ],
  );
  const expectedBrowserAppCheckKeyClaim = {
    schema: 'miakapp.staging-browser-app-check-key-attempt-claim-receipt/1',
    bucket: 'miakapp-v4-staging-tfstate-1072737219170',
    object: 'terraform/browser-app-check/operations/recaptcha-key-create-attempt.json',
    generation: '1788596614949831',
    size_bytes: 665,
    sha256: 'da1e5792f5026f3d5f599d8b6ceb6590be8985a841b3f2c614014979d0871afc',
    repository_commit: 'ec541acce307d32f2816097065f7bff1e3f0f7d0',
    terraform_plan_sha256: 'dd45c80ed38dbe5e681713442ddaa02e1dc78d2a3ce6f9365b7bbc04f96e248b',
    baseline_sha256: '2c48ce0b837881e148a0aa9b9dd42eea66905bf96c41655424ee326fade5d75e',
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAppCheckKeyClaim)) {
    exact(
      browserAppCheckKeyClaim[field],
      expected,
      `evidence.browser_app_check_prerequisite.global_key_attempt_claim.${field}`,
    );
  }
  const browserAppCheckRegistrationClaim = record(
    browserAppCheck.global_registration_attempt_claim,
    'evidence.browser_app_check_prerequisite.global_registration_attempt_claim',
    [
      'schema',
      'bucket',
      'object',
      'generation',
      'size_bytes',
      'sha256',
      'repository_commit',
      'terraform_plan_sha256',
      'baseline_sha256',
      'operator_user_sha256',
      'expires_at',
      'firebase_app_id',
      'app_check_config_name',
      'recaptcha_key_resource_name_sha256',
      'app_check_site_key_sha256',
      'app_check_token_ttl',
      'app_check_minimum_valid_score',
      'terraform_state_generation',
      'retry_authorized',
      'deletion_authorized',
      'raw_contents_committed',
    ],
  );
  const expectedBrowserAppCheckRegistrationClaim = {
    schema: 'miakapp.staging-browser-app-check-registration-attempt-claim-receipt/1',
    bucket: 'miakapp-v4-staging-tfstate-1072737219170',
    object: 'terraform/browser-app-check/operations/app-check-registration-attempt.json',
    generation: '1788603676767807',
    size_bytes: 1355,
    sha256: 'efa002afdd53d3a33417dbcf0b16215ed14d6711a8a1d666afde664dc95e65b5',
    repository_commit: '67c6947231c2b4a515e74a3b7a27ea972f1dcd15',
    terraform_plan_sha256: '9af7eaf470ce1a65f3737823135604a31ea6cbbd2575bd1afcc17d00033dfee7',
    baseline_sha256: '4545f379199b8b41d6dbabd24fb073f63ae6863cbbf88cdc4c65bd6658e445ef',
    operator_user_sha256: 'd1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c',
    expires_at: '2026-09-05T12:20:35.739Z',
    firebase_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
    app_check_config_name: 'projects/1072737219170/apps/1:1072737219170:web:5053ca93bf25d7373cd73b/recaptchaEnterpriseConfig',
    recaptcha_key_resource_name_sha256: '997f375ee6db0535dd3934dcc6ffb941f10efd5516e29b27c4caa6b8157851fb',
    app_check_site_key_sha256: '8a76f0f2cc0e0b002ed66c7f7d01ac28a6d44cb74ad2d33c3a7b0f0203e58546',
    app_check_token_ttl: '3600s',
    app_check_minimum_valid_score: 0.5,
    terraform_state_generation: '1788596623837355',
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAppCheckRegistrationClaim)) {
    exact(
      browserAppCheckRegistrationClaim[field],
      expected,
      `evidence.browser_app_check_prerequisite.global_registration_attempt_claim.${field}`,
    );
  }
  const browserAppCheckProviderClaim = record(
    browserAppCheck.global_provider_attempt_claim,
    'evidence.browser_app_check_prerequisite.global_provider_attempt_claim',
    [
      'schema',
      'bucket',
      'object',
      'generation',
      'size_bytes',
      'sha256',
      'repository_commit',
      'terraform_plan_sha256',
      'baseline_sha256',
      'registration_claim_generation',
      'registration_claim_sha256',
      'operator_user_sha256',
      'firebase_app_id',
      'app_check_config_name',
      'recaptcha_key_resource_name_sha256',
      'app_check_site_key_sha256',
      'app_check_token_ttl',
      'app_check_minimum_valid_score',
      'terraform_state_generation',
      'retry_authorized',
      'deletion_authorized',
      'raw_contents_committed',
    ],
  );
  const expectedBrowserAppCheckProviderClaim = {
    schema: 'miakapp.staging-browser-app-check-provider-attempt-claim-receipt/1',
    bucket: 'miakapp-v4-staging-tfstate-1072737219170',
    object: 'terraform/browser-app-check/operations/app-check-provider-attempt.json',
    generation: '1788603679291215',
    size_bytes: 1452,
    sha256: '8d20e8da6ce315ba9f5ef062547dac56bea19ad20323a983f4b7bbfe2f415d12',
    repository_commit: '67c6947231c2b4a515e74a3b7a27ea972f1dcd15',
    terraform_plan_sha256: '9af7eaf470ce1a65f3737823135604a31ea6cbbd2575bd1afcc17d00033dfee7',
    baseline_sha256: '4545f379199b8b41d6dbabd24fb073f63ae6863cbbf88cdc4c65bd6658e445ef',
    registration_claim_generation: '1788603676767807',
    registration_claim_sha256: 'efa002afdd53d3a33417dbcf0b16215ed14d6711a8a1d666afde664dc95e65b5',
    operator_user_sha256: 'd1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c',
    firebase_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
    app_check_config_name: 'projects/1072737219170/apps/1:1072737219170:web:5053ca93bf25d7373cd73b/recaptchaEnterpriseConfig',
    recaptcha_key_resource_name_sha256: '997f375ee6db0535dd3934dcc6ffb941f10efd5516e29b27c4caa6b8157851fb',
    app_check_site_key_sha256: '8a76f0f2cc0e0b002ed66c7f7d01ac28a6d44cb74ad2d33c3a7b0f0203e58546',
    app_check_token_ttl: '3600s',
    app_check_minimum_valid_score: 0.5,
    terraform_state_generation: '1788596623837355',
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAppCheckProviderClaim)) {
    exact(
      browserAppCheckProviderClaim[field],
      expected,
      `evidence.browser_app_check_prerequisite.global_provider_attempt_claim.${field}`,
    );
  }
  const browserAppCheckKey = record(
    browserAppCheck.recaptcha_key,
    'evidence.browser_app_check_prerequisite.recaptcha_key',
    [
      'name_sha256',
      'display_name',
      'labels',
      'create_time',
      'integration_type',
      'allow_all_domains',
      'allowed_domains',
      'allowed_domain_includes_subdomains',
      'allow_amp_traffic',
      'testing_options_configured',
      'waf_settings_configured',
    ],
  );
  const expectedBrowserAppCheckKey = {
    name_sha256: '997f375ee6db0535dd3934dcc6ffb941f10efd5516e29b27c4caa6b8157851fb',
    display_name: 'Miakapp V4 staging browser App Check',
    create_time: '2026-09-05T08:23:36Z',
    integration_type: 'SCORE',
    allow_all_domains: false,
    allowed_domain_includes_subdomains: true,
    allow_amp_traffic: false,
    testing_options_configured: false,
    waf_settings_configured: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAppCheckKey)) {
    exact(
      browserAppCheckKey[field],
      expected,
      `evidence.browser_app_check_prerequisite.recaptcha_key.${field}`,
    );
  }
  const browserAppCheckLabels = record(
    browserAppCheckKey.labels,
    'evidence.browser_app_check_prerequisite.recaptcha_key.labels',
    ['environment', 'managed-by', 'product', 'purpose'],
  );
  const expectedBrowserAppCheckLabels = {
    environment: 'staging',
    'managed-by': 'terraform',
    product: 'miakapp-v4',
    purpose: 'browser-app-check',
  };
  for (const [field, expected] of Object.entries(expectedBrowserAppCheckLabels)) {
    exact(
      browserAppCheckLabels[field],
      expected,
      `evidence.browser_app_check_prerequisite.recaptcha_key.labels.${field}`,
    );
  }
  exactArray(
    browserAppCheckKey.allowed_domains,
    ['miakapp-v4-staging.web.app'],
    'evidence.browser_app_check_prerequisite.recaptcha_key.allowed_domains',
  );
  exact(
    browserAppCheckState.recaptcha_key_name_sha256,
    browserAppCheckKey.name_sha256,
    'evidence.browser_app_check_prerequisite.recaptcha_key.name_sha256',
  );
  const browserAppCheckProvider = record(
    browserAppCheck.app_check_provider,
    'evidence.browser_app_check_prerequisite.app_check_provider',
    [
      'name',
      'firebase_app_id',
      'token_ttl',
      'minimum_valid_score',
      'site_key_sha256',
      'registered',
      'deletion_api_available',
    ],
  );
  const expectedBrowserAppCheckProvider = {
    name: 'projects/1072737219170/apps/1:1072737219170:web:5053ca93bf25d7373cd73b/recaptchaEnterpriseConfig',
    firebase_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
    token_ttl: '3600s',
    minimum_valid_score: 0.5,
    site_key_sha256: '8a76f0f2cc0e0b002ed66c7f7d01ac28a6d44cb74ad2d33c3a7b0f0203e58546',
    registered: true,
    deletion_api_available: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAppCheckProvider)) {
    exact(
      browserAppCheckProvider[field],
      expected,
      `evidence.browser_app_check_prerequisite.app_check_provider.${field}`,
    );
  }
  exact(
    browserAppCheckProviderClaim.registration_claim_generation,
    browserAppCheckRegistrationClaim.generation,
    'evidence.browser_app_check_prerequisite.global_provider_attempt_claim.registration_claim_generation',
  );
  exact(
    browserAppCheckProviderClaim.registration_claim_sha256,
    browserAppCheckRegistrationClaim.sha256,
    'evidence.browser_app_check_prerequisite.global_provider_attempt_claim.registration_claim_sha256',
  );
  for (const [claim, path] of [
    [browserAppCheckRegistrationClaim, 'global_registration_attempt_claim'],
    [browserAppCheckProviderClaim, 'global_provider_attempt_claim'],
  ]) {
    exact(
      claim.app_check_config_name,
      browserAppCheckProvider.name,
      `evidence.browser_app_check_prerequisite.${path}.app_check_config_name`,
    );
    exact(
      claim.firebase_app_id,
      browserAppCheckProvider.firebase_app_id,
      `evidence.browser_app_check_prerequisite.${path}.firebase_app_id`,
    );
    exact(
      claim.app_check_site_key_sha256,
      browserAppCheckProvider.site_key_sha256,
      `evidence.browser_app_check_prerequisite.${path}.app_check_site_key_sha256`,
    );
    exact(
      claim.app_check_token_ttl,
      browserAppCheckProvider.token_ttl,
      `evidence.browser_app_check_prerequisite.${path}.app_check_token_ttl`,
    );
    exact(
      claim.app_check_minimum_valid_score,
      browserAppCheckProvider.minimum_valid_score,
      `evidence.browser_app_check_prerequisite.${path}.app_check_minimum_valid_score`,
    );
  }
  exact(
    browserAppCheckState.app_check_config_name,
    browserAppCheckProvider.name,
    'evidence.browser_app_check_prerequisite.terraform_state.app_check_config_name',
  );
  exact(
    browserAppCheckState.app_check_site_key_sha256,
    browserAppCheckProvider.site_key_sha256,
    'evidence.browser_app_check_prerequisite.terraform_state.app_check_site_key_sha256',
  );
  exact(
    browserAppCheckState.app_check_token_ttl,
    browserAppCheckProvider.token_ttl,
    'evidence.browser_app_check_prerequisite.terraform_state.app_check_token_ttl',
  );
  const browserAttestation = record(
    evidence.browser_app_check_attestation,
    'evidence.browser_app_check_attestation',
    [
      'state',
      'observed_at',
      'repository_commit',
      'result_path',
      'result_sha256',
      'firebase_sdk_version',
      'firebase_app_id',
      'hosting_origin',
      'operation_claim',
      'browser_session',
      'browser_invocations',
      'loopback_observations',
      'force_refresh_requested',
      'provider_token_obtained',
      'jwt_shape_validated',
      'configured_token_ttl',
      'local_post_validation',
      'hosting_version_status',
      'hosting_releases_created',
      'hosting_site_disabled',
      'runner_http_status_after_cleanup',
      'public_window_milliseconds',
      'app_check_enforcement_records',
      'debug_tokens',
      'firebase_auth_used',
      'control_plane_invoked',
      'app_check_token_committed',
      'raw_browser_error_committed',
      'entrypoints_retired',
    ],
  );
  const expectedBrowserAttestation = {
    state: 'real_system_browser_provider_token_obtained_and_retired',
    observed_at: '2026-09-05T18:01:23.632Z',
    repository_commit: 'e5ec8d97b051ee6c942ad2574cca24b679509876',
    result_path: 'browser-attestation/preflight-v6-result.json',
    result_sha256: 'cd4a750c3f2be1985b84dacfb8f76ea117dc1651a91d197c915c0c1dc43bfed2',
    firebase_sdk_version: '12.18.0',
    firebase_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
    hosting_origin: 'https://miakapp-v4-staging.web.app',
    browser_session: 'macos-default-system-browser',
    browser_invocations: 1,
    loopback_observations: 1,
    force_refresh_requested: true,
    provider_token_obtained: true,
    jwt_shape_validated: true,
    configured_token_ttl: '3600s',
    hosting_version_status: 'DELETED',
    hosting_releases_created: 2,
    hosting_site_disabled: true,
    runner_http_status_after_cleanup: 404,
    public_window_milliseconds: 8749,
    app_check_enforcement_records: 0,
    debug_tokens: 0,
    firebase_auth_used: false,
    control_plane_invoked: false,
    app_check_token_committed: false,
    raw_browser_error_committed: false,
    entrypoints_retired: true,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAttestation)) {
    exact(
      browserAttestation[field],
      expected,
      `evidence.browser_app_check_attestation.${field}`,
    );
  }
  const browserAttestationClaim = record(
    browserAttestation.operation_claim,
    'evidence.browser_app_check_attestation.operation_claim',
    [
      'object',
      'generation',
      'size_bytes',
      'sha256',
      'retry_authorized',
      'deletion_authorized',
    ],
  );
  const expectedBrowserAttestationClaim = {
    object: 'terraform/browser-attestation/operations/live-browser-attestation-v6.json',
    generation: '1788631267013181',
    size_bytes: 686,
    sha256: '9e9716a1aa9247c196125ab355c2c413a733dbc3d54a7d4fe203dbf12dffeb7b',
    retry_authorized: false,
    deletion_authorized: false,
  };
  for (const [field, expected] of Object.entries(expectedBrowserAttestationClaim)) {
    exact(
      browserAttestationClaim[field],
      expected,
      `evidence.browser_app_check_attestation.operation_claim.${field}`,
    );
  }
  const browserAttestationPostValidation = record(
    browserAttestation.local_post_validation,
    'evidence.browser_app_check_attestation.local_post_validation',
    ['state', 'stage', 'code', 'cause'],
  );
  const expectedBrowserAttestationPostValidation = {
    state: 'rejected_after_provider_success',
    stage: 'token-ttl-validation',
    code: 'token-ttl-rejected',
    cause: 'public_get_token_result_contains_token_only',
  };
  for (const [field, expected] of Object.entries(expectedBrowserAttestationPostValidation)) {
    exact(
      browserAttestationPostValidation[field],
      expected,
      `evidence.browser_app_check_attestation.local_post_validation.${field}`,
    );
  }
  const signingOverlap = record(
    evidence.signing_key_overlap_prerequisite,
    'evidence.signing_key_overlap_prerequisite',
    [
      'state',
      'observed_at',
      'repository_commit',
      'result_path',
      'result_sha256',
      'reviewed_plan_sha256',
      'plan_metadata_sha256',
      'baseline_sha256',
      'final_inventory_sha256',
      'created_version_name',
      'created_version',
      'created_version_state',
      'created_version_algorithm',
      'created_version_protection_level',
      'created_public_jwk_sha256',
      'enabled_versions',
      'runtime_published_versions',
      'runtime_current_version',
      'kms_version_creations',
      'coordination_objects_created',
      'runtime_changed',
      'terraform_state_changed',
      'existing_version_changed',
      'public_ingress_changed',
      'live_requests_performed',
      'signatures_performed',
      'automatic_retry_performed',
      'entrypoints_retired',
      'private_bundle_committed',
      'credential_material_committed',
    ],
  );
  const expectedSigningOverlap = {
    state: 'version_2_enabled_runtime_unchanged_entrypoints_retired',
    observed_at: '2026-09-05T11:16:51.365507792Z',
    repository_commit: 'f4d4cec280355e3577609e1d305984a8462e585a',
    result_path: 'signing-overlap/result.json',
    result_sha256: 'b26ccdc1051c60a976578373ae2e36fda0821a9e93a6324de121f0bbed614fbc',
    reviewed_plan_sha256: '0bf8ef54a508e93cab1f61c6e8f70c5f52d01e85da37d6fadd69efdb1ca636f1',
    plan_metadata_sha256: 'efccbd0fbaf5a01f95dafa8cf6c6e71f0bdbc3f6cf19c16ba53c1c14c0424d87',
    baseline_sha256: 'f7dfa9b3aab59ea40c9ecd23b8ffbea4db2111534dd37502430e2596d1c994da',
    final_inventory_sha256: '4916ee41795f23a67babd52700c6ac6316d63ef49fa1ae02b3bcaf1b3e2a673d',
    created_version_name: 'projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing/cryptoKeyVersions/2',
    created_version: 2,
    created_version_state: 'ENABLED',
    created_version_algorithm: 'EC_SIGN_ED25519',
    created_version_protection_level: 'SOFTWARE',
    created_public_jwk_sha256: '865c164dcea8df825ec5ebec8def049925d94cc955284c45b5a66747ab1ff4ea',
    runtime_current_version: 1,
    kms_version_creations: 1,
    coordination_objects_created: 2,
    runtime_changed: false,
    terraform_state_changed: false,
    existing_version_changed: false,
    public_ingress_changed: false,
    live_requests_performed: 0,
    signatures_performed: 0,
    automatic_retry_performed: false,
    entrypoints_retired: true,
    private_bundle_committed: false,
    credential_material_committed: false,
  };
  for (const [field, expected] of Object.entries(expectedSigningOverlap)) {
    exact(
      signingOverlap[field],
      expected,
      `evidence.signing_key_overlap_prerequisite.${field}`,
    );
  }
  exactArray(
    signingOverlap.enabled_versions,
    [1, 2],
    'evidence.signing_key_overlap_prerequisite.enabled_versions',
  );
  exactArray(
    signingOverlap.runtime_published_versions,
    [1],
    'evidence.signing_key_overlap_prerequisite.runtime_published_versions',
  );
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
  exact(manifest.revision, 89, 'manifest.revision');
  exact(
    manifest.status,
    'private_control_plane_two_key_version_1_rehearsal_entry_converged_user_relay_acceptance_succeeded_system_browser_app_check_attestation_succeeded_browser_relay_plan_page_ci_pinned_all_preconditions_preflighted_monitoring_observed_runner_implemented_private_relays_ready_rebased_browser_relay_runner_three_engine_implemented_not_executed_browser_relay_page_three_engine_dormant_scenario_host_implemented_not_wired_not_published_not_executed_browser_relay_fixture_closed_single_controller_implemented_not_wired_not_executed_browser_relay_fixture_cloud_closed_google_firebase_adapter_implemented_not_wired_not_executed_browser_relay_fixture_miakapi_closed_pinned_factory_binding_implemented_not_wired_not_executed_browser_relay_aggregator_closed_independent_source_implemented_not_wired_not_executed_browser_relay_page_receipt_closed_producer_implemented_not_wired_not_executed_browser_relay_scenario_fixture_closed_four_input_two_identity_controller_implemented_cloud_extension_not_wired_not_executed_browser_relay_scenario_fixture_cloud_closed_replacement_identity_google_firebase_adapter_implemented_not_wired_not_executed_browser_relay_monitoring_allowlisted_preflight_succeeded_browser_relay_rollback_preflight_succeeded_browser_relay_orchestrator_single_use_edge_preflight_succeeded_private_unclaimed_browser_relay_operation_single_use_envelope_preflight_succeeded_private_unclaimed_bounded_relay_root_reviewed_private_relay_image_v1_verification_failed_not_deployable_container_analysis_converged_v2_recovery_succeeded_verified_private_relay_services_private_ready_succeeded_verified_entrypoints_retired_public_window_not_authorized_enforcement_disabled',
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

  const userRelayProbeManifest = manifest.evidence.user_relay_probe;
  const authProbeResultPath = committedEvidencePath(
    stagingRoot,
    userRelayProbeManifest.result_path,
    'auth-probe/result.json',
    'evidence.user_relay_probe.result_path',
  );
  const authProbeRetirementPath = committedEvidencePath(
    stagingRoot,
    userRelayProbeManifest.retirement_path,
    'auth-probe/retirement.json',
    'evidence.user_relay_probe.retirement_path',
  );
  let authProbeEvidence;
  try {
    authProbeEvidence = validateAuthProbeEvidence(authProbeResultPath, authProbeRetirementPath);
  } catch {
    reject('evidence.user_relay_probe', 'does not match its committed artifacts');
  }
  const { result: authProbe, retirement: authProbeRetirement } = authProbeEvidence;
  exact(
    fileSha256(authProbeResultPath),
    userRelayProbeManifest.result_sha256,
    'evidence.user_relay_probe.result_sha256',
  );
  exact(
    fileSha256(authProbeRetirementPath),
    userRelayProbeManifest.retirement_sha256,
    'evidence.user_relay_probe.retirement_sha256',
  );
  exactFields(userRelayProbeManifest, {
    state: authProbe.execution.state === 'SUCCEEDED'
      && authProbeRetirement.workflow_present === false
      && authProbeRetirement.verifier_service_present === false
      && authProbeRetirement.temporary_bindings_present === false
      && authProbeRetirement.recurring_compute === false
      ? 'succeeded_and_retired'
      : 'incomplete',
    observed_at: authProbe.observed_at,
    repository_commit: authProbe.repository_commit,
    workflow_source_sha256: authProbe.workflow.source_sha256,
    workflow_revision: authProbe.workflow.revision,
    execution_duration_milliseconds: authProbe.execution.duration_milliseconds,
    execution_count: authProbe.execution.count_after - authProbe.execution.count_before,
    product_requests: authProbe.request.product_requests,
    negative_controls: authProbe.request.negative_controls,
    successful_exchanges: authProbe.request.successful_exchanges,
    invalid_firebase_status: authProbe.responses.invalid_firebase.status,
    invalid_firebase_code: authProbe.responses.invalid_firebase.code,
    missing_app_check_status: authProbe.responses.missing_app_check.status,
    missing_app_check_code: authProbe.responses.missing_app_check.code,
    missing_home_status: authProbe.responses.missing_home.status,
    missing_home_code: authProbe.responses.missing_home.code,
    first_exchange_status: authProbe.responses.first_exchange.status,
    second_exchange_status: authProbe.responses.second_exchange.status,
    firebase_auth_validated: authProbe.firebase_auth.synthetic_user_created
      && authProbe.firebase_auth.synthetic_user_deleted
      && authProbe.firebase_auth.independent_absence_verified,
    app_check_validated: authProbe.app_check.replay_accepted
      && authProbe.responses.first_exchange.status === 200
      && authProbe.responses.second_exchange.status === 200,
    app_check_token_consumption: authProbe.app_check.token_consumption,
    browser_provider_attestation_validated:
      authProbe.app_check.browser_provider_attestation_validated,
    token_signatures_validated: authProbe.tokens.signatures_valid,
    token_audiences_changed: authProbe.tokens.audiences_changed,
    synthetic_user_created: authProbe.firebase_auth.synthetic_user_created,
    synthetic_user_deleted: authProbe.firebase_auth.synthetic_user_deleted,
    independent_user_absence_verified: authProbe.firebase_auth.independent_absence_verified,
    synthetic_home_created: authProbe.firestore.synthetic_home_created,
    synthetic_home_deleted: authProbe.firestore.synthetic_home_deleted,
    independent_home_absence_verified: authProbe.firestore.independent_absence_verified,
    relay_rotated: authProbe.firestore.relay_rotated,
    public_home_written: authProbe.firestore.public_home_written,
    owner_matches_authenticated_user: authProbe.firestore.owner_matches_authenticated_user,
    workflow_present: authProbeRetirement.workflow_present,
    verifier_service_present: authProbeRetirement.verifier_service_present,
    temporary_bindings_present: authProbeRetirement.temporary_bindings_present,
    retained_disabled_custom_roles: Object.values(authProbeRetirement.custom_roles).filter(
      (role) => role.stage === 'DISABLED' && role.deleted === false,
    ).length,
    recurring_compute: authProbeRetirement.recurring_compute,
  }, 'evidence.user_relay_probe');
  exact(
    authProbe.workload.expected_function_revision,
    authProbe.workload.function_revision,
    'evidence.user_relay_probe.result.workload.expected_function_revision',
  );
  validateHistoricalWorkloadTuple(
    workloadManifest.source_updates,
    authProbe.workload,
    'evidence.user_relay_probe.result.workload',
  );
  exact(
    authProbe.app_check.firebase_app_id,
    manifest.evidence.activation_material.firebase_app_id,
    'evidence.user_relay_probe.result.app_check.firebase_app_id',
  );
  exact(
    firebaseAuth.firebase_auth.project_id,
    authProbe.project_id,
    'evidence.user_relay_probe.result.project_id',
  );
  const browserRelayPlanManifest = manifest.evidence.browser_relay_plan;
  const browserRelayPlanPath = committedEvidencePath(
    stagingRoot,
    browserRelayPlanManifest.path,
    BROWSER_RELAY_PLAN_PATH,
    'evidence.browser_relay_plan.path',
  );
  const browserRelayPlan = validatedEvidenceFile(
    browserRelayPlanPath,
    validateBrowserRelayPlan,
    'evidence.browser_relay_plan.path',
  );
  exact(
    fileSha256(browserRelayPlanPath),
    browserRelayPlanManifest.sha256,
    'evidence.browser_relay_plan.sha256',
  );
  const browserRelayV8PlanPath = resolve(stagingRoot, BROWSER_RELAY_V8_PLAN_PATH);
  validatedEvidenceFile(
    browserRelayV8PlanPath,
    validateBrowserRelayV8Plan,
    'browser-relay/plan-v8.json',
  );
  exact(
    fileSha256(browserRelayV8PlanPath),
    BROWSER_RELAY_V8_PLAN_SHA256,
    'browser-relay/plan-v8.json',
  );
  const browserRelayV9PlanPath = resolve(stagingRoot, BROWSER_RELAY_V9_PLAN_PATH);
  const browserRelayV9Plan = validatedEvidenceFile(
    browserRelayV9PlanPath,
    validateBrowserRelayV9Plan,
    'browser-relay/plan-v9.json',
  );
  exact(
    fileSha256(browserRelayV9PlanPath),
    BROWSER_RELAY_V9_PLAN_SHA256,
    'browser-relay/plan-v9.json',
  );
  const browserRelayV10PlanPath = resolve(stagingRoot, BROWSER_RELAY_V10_PLAN_PATH);
  const browserRelayV10Plan = validatedEvidenceFile(
    browserRelayV10PlanPath,
    validateBrowserRelayV10Plan,
    'browser-relay/plan-v10.json',
  );
  exact(
    fileSha256(browserRelayV10PlanPath),
    BROWSER_RELAY_V10_PLAN_SHA256,
    'browser-relay/plan-v10.json',
  );
  const browserRelayV11PlanPath = resolve(stagingRoot, BROWSER_RELAY_V11_PLAN_PATH);
  const browserRelayV11Plan = validatedEvidenceFile(
    browserRelayV11PlanPath,
    validateBrowserRelayV11Plan,
    'browser-relay/plan-v11.json',
  );
  exact(
    fileSha256(browserRelayV11PlanPath),
    BROWSER_RELAY_V11_PLAN_SHA256,
    'browser-relay/plan-v11.json',
  );
  const browserRelayV12PlanPath = resolve(stagingRoot, BROWSER_RELAY_V12_PLAN_PATH);
  const browserRelayV12Plan = validatedEvidenceFile(
    browserRelayV12PlanPath,
    validateBrowserRelayV12Plan,
    'browser-relay/plan-v12.json',
  );
  exact(
    fileSha256(browserRelayV12PlanPath),
    BROWSER_RELAY_V12_PLAN_SHA256,
    'browser-relay/plan-v12.json',
  );
  const browserRelayV13PlanPath = resolve(stagingRoot, BROWSER_RELAY_V13_PLAN_PATH);
  const browserRelayV13Plan = validatedEvidenceFile(
    browserRelayV13PlanPath,
    validateBrowserRelayV13Plan,
    'browser-relay/plan-v13.json',
  );
  exact(
    fileSha256(browserRelayV13PlanPath),
    BROWSER_RELAY_V13_PLAN_SHA256,
    'browser-relay/plan-v13.json',
  );
  const browserRelayV14PlanPath = resolve(stagingRoot, BROWSER_RELAY_V14_PLAN_PATH);
  const browserRelayV14Plan = validatedEvidenceFile(
    browserRelayV14PlanPath,
    validateBrowserRelayV14Plan,
    'browser-relay/plan-v14.json',
  );
  exact(
    fileSha256(browserRelayV14PlanPath),
    BROWSER_RELAY_V14_PLAN_SHA256,
    'browser-relay/plan-v14.json',
  );
  exactFields(browserRelayPlanManifest, {
    state: browserRelayPlan.state,
    page_profile_sha256: browserRelayPlan.pins.browser_relay_page_profile_sha256,
    baseline_observed_at: browserRelayPlan.baseline.observed_at,
    baseline_control_plane_revision: browserRelayPlan.baseline.control_plane.revision,
    baseline_published_signing_keys:
      browserRelayPlan.baseline.control_plane.published_signing_keys,
    baseline_current_signing_key_version:
      browserRelayPlan.baseline.control_plane.current_signing_key_version,
    browser_attestation_validated:
      browserRelayPlan.baseline.app_check.browser_attestation_validated,
    firebase_auth_users: browserRelayPlan.baseline.application_data.firebase_auth_users,
    application_fixture_collections:
      browserRelayPlan.baseline.application_data.application_fixture_collections,
    open_preconditions:
      browserRelayPlan.preconditions.filter(({ state }) => state === 'open').length,
    cloud_mutation_authorized_by_plan:
      browserRelayPlan.target.cloud_mutation_authorized_by_document,
    acceptance_executed: browserRelayPlan.target.acceptance_executed,
    public_ingress_active: browserRelayPlan.target.public_ingress_currently_active,
    relay_services: browserRelayPlan.baseline.relay_services,
    runner_present: browserRelayPlan.baseline.browser_runner_present,
    completed_cases: browserRelayPlan.evidence.completed_case_ids.length,
  }, 'evidence.browser_relay_plan');
  const browserRelayRunnerManifest = manifest.evidence.browser_relay_runner;
  const browserRelayRunnerProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayRunnerManifest.profile_path,
    BROWSER_RELAY_RUNNER_PROFILE_PATH,
    'evidence.browser_relay_runner.profile_path',
  );
  const browserRelayRunnerProfile = validatedEvidenceFile(
    browserRelayRunnerProfilePath,
    validateBrowserRelayRunnerProfile,
    'evidence.browser_relay_runner.profile_path',
  );
  exact(
    fileSha256(browserRelayRunnerProfilePath),
    browserRelayRunnerManifest.profile_sha256,
    'evidence.browser_relay_runner.profile_sha256',
  );
  exact(
    browserRelayPlan.pins.browser_relay_runner_profile_sha256,
    browserRelayRunnerManifest.profile_sha256,
    'evidence.browser_relay_plan runner profile pin',
  );
  exact(
    browserRelayPlan.preconditions.find(({ id }) => id === 'RUNNER-01')?.state,
    'satisfied',
    'evidence.browser_relay_plan RUNNER-01 precondition',
  );
  exactFields(browserRelayRunnerManifest, {
    state: browserRelayRunnerProfile.state,
    browser_relay_plan_sha256:
      browserRelayRunnerProfile.pins.browser_relay_plan_sha256,
    miakapi_commit: browserRelayRunnerProfile.pins.miakapi_commit,
    playwright_version: browserRelayRunnerProfile.pins.playwright_version,
    browser_engines: browserRelayRunnerProfile.execution.browser_order.length,
    maximum_invocations: browserRelayRunnerProfile.execution.maximum_invocations,
    sequential: browserRelayRunnerProfile.execution.sequential,
    maximum_total_milliseconds:
      browserRelayRunnerProfile.execution.maximum_total_milliseconds,
    chromium_deadline_milliseconds:
      browserRelayRunnerProfile.execution.browser_deadlines_milliseconds.chromium,
    secondary_browser_deadline_milliseconds:
      browserRelayRunnerProfile.execution.browser_deadlines_milliseconds.firefox,
    output_assertions: Object.values(browserRelayRunnerProfile.assertions)
      .reduce((total, assertions) => total + assertions.length, 0),
    cloud_compute_resources: browserRelayRunnerProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayRunnerProfile.target.cloud_mutation_authorized_by_profile,
    public_ingress_authorized:
      browserRelayRunnerProfile.target.public_ingress_authorized_by_profile,
    live_execution_authorized:
      browserRelayRunnerProfile.target.live_execution_authorized_by_profile,
    live_execution_count: browserRelayRunnerProfile.evidence.live_execution_count,
    result_present: browserRelayRunnerProfile.evidence.result_path !== null,
    credentials_committed: browserRelayRunnerProfile.evidence.credentials_committed,
    raw_diagnostics_committed: browserRelayRunnerProfile.evidence.raw_diagnostics_committed,
  }, 'evidence.browser_relay_runner');
  exact(
    browserRelayRunnerProfile.pins.browser_relay_plan_sha256,
    BROWSER_RELAY_V9_PLAN_SHA256,
    'evidence.browser_relay_runner historical browser-relay plan pin',
  );
  const browserMatrix = new Map(browserRelayV9Plan.matrix.map((entry) => [entry.id, entry]));
  exactArray(
    browserRelayRunnerProfile.assertions.chromium,
    ['LIVE-02', 'LIVE-03', 'LIVE-04', 'LIVE-05', 'LIVE-06', 'LIVE-07', 'LIVE-08',
      'LIVE-09', 'LIVE-11'].flatMap((id) => browserMatrix.get(id).assertions),
    'evidence.browser_relay_runner Chromium assertions',
  );
  exactArray(browserRelayRunnerProfile.assertions.firefox, [
    browserMatrix.get('LIVE-10').assertions[0],
    browserMatrix.get('LIVE-10').assertions[2],
  ], 'evidence.browser_relay_runner Firefox assertions');
  exactArray(browserRelayRunnerProfile.assertions.webkit, [
    browserMatrix.get('LIVE-10').assertions[1],
    browserMatrix.get('LIVE-10').assertions[2],
  ], 'evidence.browser_relay_runner WebKit assertions');
  exactArray(
    browserRelayRunnerProfile.output.allowed_observations,
    browserRelayV9Plan.evidence.allowed_observations,
    'evidence.browser_relay_runner allowed observations',
  );
  exactArray(
    browserRelayRunnerProfile.output.forbidden_observations,
    browserRelayV9Plan.evidence.forbidden_observations,
    'evidence.browser_relay_runner forbidden observations',
  );
  exact(
    browserRelayRunnerProfile.execution.maximum_invocations,
    browserRelayV9Plan.topology.runner.maximum_invocations,
    'evidence.browser_relay_runner invocation budget',
  );
  exact(
    browserRelayRunnerProfile.execution.browser_deadlines_milliseconds.firefox,
    browserRelayRunnerProfile.execution.browser_deadlines_milliseconds.webkit,
    'evidence.browser_relay_runner secondary browser deadlines',
  );
  exact(
    browserRelayRunnerProfile.output.maximum_app_check_assessments,
    browserRelayV9Plan.budgets.maximum_recaptcha_assessments,
    'evidence.browser_relay_runner App Check budget',
  );
  exact(
    browserRelayRunnerProfile.output.maximum_control_plane_exchanges,
    browserRelayV9Plan.budgets.maximum_control_plane_exchanges,
    'evidence.browser_relay_runner control-plane budget',
  );
  exact(
    browserRelayRunnerProfile.output.maximum_kms_signatures,
    browserRelayV9Plan.budgets.maximum_kms_signatures,
    'evidence.browser_relay_runner KMS budget',
  );
  exact(
    browserRelayRunnerProfile.output.maximum_firestore_writes,
    browserRelayV9Plan.budgets.maximum_firestore_writes,
    'evidence.browser_relay_runner Firestore budget',
  );
  const rootPackage = readBoundedJson(resolve(stagingRoot, '../../package.json'), 8 * 1024);
  exact(
    rootPackage.devDependencies?.playwright,
    browserRelayRunnerProfile.pins.playwright_version,
    'browser-relay runner Playwright dependency',
  );
  const runnerDriverPath = resolve(stagingRoot, 'browser-relay-runner/driver.mjs');
  const runnerSmokePath = resolve(stagingRoot, 'test/browser-relay-runner-browser.mjs');
  const runnerWorkflowPath = resolve(
    stagingRoot,
    '../../.github/workflows/browser-relay-runner.yml',
  );
  const dependencyLockPath = resolve(stagingRoot, '../../bun.lock');
  exact(fileSha256(runnerDriverPath), browserRelayRunnerProfile.pins.runner_driver_sha256,
    'evidence.browser_relay_runner driver digest');
  exact(fileSha256(runnerSmokePath), browserRelayRunnerProfile.pins.offline_smoke_sha256,
    'evidence.browser_relay_runner offline smoke digest');
  exact(fileSha256(runnerWorkflowPath), browserRelayRunnerProfile.pins.ci_workflow_sha256,
    'evidence.browser_relay_runner CI workflow digest');
  exact(fileSha256(dependencyLockPath), browserRelayRunnerProfile.pins.dependency_lock_sha256,
    'evidence.browser_relay_runner dependency lock digest');
  const runnerWorkflow = readFileSync(runnerWorkflowPath, 'utf8');
  if (!runnerWorkflow.includes('playwright install --with-deps chromium firefox webkit')
    || !runnerWorkflow.includes('browser-relay-runner-browser.mjs')) {
    reject('evidence.browser_relay_runner.three_engine_ci_gate_present', 'has drifted');
  }
  exact(
    browserRelayRunnerManifest.three_engine_ci_gate_present,
    true,
    'evidence.browser_relay_runner.three_engine_ci_gate_present',
  );
  const browserRelayPageManifest = manifest.evidence.browser_relay_page;
  const browserRelayPageV2ProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayPageManifest.v2_profile_path,
    BROWSER_RELAY_PAGE_V2_PROFILE_PATH,
    'evidence.browser_relay_page.v2_profile_path',
  );
  const browserRelayPageV2Profile = validatedEvidenceFile(
    browserRelayPageV2ProfilePath,
    validateBrowserRelayPageV2Profile,
    'evidence.browser_relay_page.v2_profile_path',
  );
  exact(
    browserRelayPageV2Profile.pins.browser_relay_plan_sha256,
    BROWSER_RELAY_V14_PLAN_SHA256,
    'evidence.browser_relay_page historical revision-2 plan pin',
  );
  const browserRelayPageProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayPageManifest.profile_path,
    BROWSER_RELAY_PAGE_PROFILE_PATH,
    'evidence.browser_relay_page.profile_path',
  );
  const browserRelayPageProfile = validatedEvidenceFile(
    browserRelayPageProfilePath,
    validateBrowserRelayPageProfile,
    'evidence.browser_relay_page.profile_path',
  );
  exact(
    fileSha256(browserRelayPageProfilePath),
    BROWSER_RELAY_PAGE_PROFILE_SHA256,
    'evidence.browser_relay_page.profile_sha256',
  );
  exact(
    browserRelayPageProfile.pins.browser_relay_plan_sha256,
    BROWSER_RELAY_PLAN_SHA256,
    'evidence.browser_relay_page current revision-15 plan pin',
  );
  exact(
    browserRelayPageProfile.pins.browser_relay_runner_profile_sha256,
    BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    'evidence.browser_relay_page runner pin',
  );
  exact(
    browserRelayPageProfile.pins.miakapi_bundle_sha256,
    BROWSER_RELAY_PAGE_MIAKAPI_BUNDLE_SHA256,
    'evidence.browser_relay_page MiakAPI bundle pin',
  );
  for (const [field, relativePath] of [
    ['boundary_source_sha256', 'browser-relay-page/boundary.mjs'],
    ['runtime_source_sha256', 'browser-relay-page/runtime.mjs'],
    ['page_source_sha256', 'browser-relay-page/page.mjs'],
    ['artifact_source_sha256', 'browser-relay-page/artifact.mjs'],
    ['index_sha256', 'browser-relay-page/index.html'],
  ]) {
    exact(
      fileSha256(resolve(stagingRoot, relativePath)),
      browserRelayPageProfile.pins[field],
      `evidence.browser_relay_page ${field}`,
    );
  }
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-page/vendor/miakapi-browser-v4.mjs')),
    browserRelayPageProfile.pins.miakapi_bundle_sha256,
    'evidence.browser_relay_page vendored MiakAPI digest',
  );
  exact(
    rootPackage.dependencies?.firebase,
    browserRelayPageProfile.pins.firebase_sdk_version,
    'evidence.browser_relay_page Firebase dependency',
  );
  exact(
    rootPackage.devDependencies?.vite,
    browserRelayPageProfile.pins.vite_version,
    'evidence.browser_relay_page Vite dependency',
  );
  exact(
    rootPackage.devDependencies?.playwright,
    browserRelayPageProfile.pins.playwright_version,
    'evidence.browser_relay_page Playwright dependency',
  );
  const pageSmokePath = resolve(stagingRoot, 'test/browser-relay-page-browser.mjs');
  const pageWorkflowPath = resolve(
    stagingRoot,
    '../../.github/workflows/browser-relay-page.yml',
  );
  exact(fileSha256(pageSmokePath), BROWSER_RELAY_PAGE_OFFLINE_SMOKE_SHA256,
    'evidence.browser_relay_page offline smoke digest');
  for (const [relativePath, expectedDigest] of [
    ['test/browser-relay-page.test.mjs', BROWSER_RELAY_PAGE_OFFLINE_NODE_TEST_SHA256],
    ['test/helpers/browser-relay-page-bfcache-entry.mjs', BROWSER_RELAY_PAGE_OFFLINE_BFCACHE_ENTRY_SHA256],
    ['test/helpers/browser-relay-page-harness.mjs', BROWSER_RELAY_PAGE_OFFLINE_PAGE_HARNESS_SHA256],
  ]) {
    const helperPath = committedEvidencePath(
      stagingRoot, relativePath, relativePath, 'evidence.browser_relay_page offline helper',
    );
    exact(fileSha256(helperPath), expectedDigest,
      `evidence.browser_relay_page ${relativePath} digest`);
  }
  exact(fileSha256(pageWorkflowPath), BROWSER_RELAY_PAGE_CI_WORKFLOW_SHA256,
    'evidence.browser_relay_page CI workflow digest');
  exact(fileSha256(dependencyLockPath), BROWSER_RELAY_PAGE_DEPENDENCY_LOCK_SHA256,
    'evidence.browser_relay_page dependency lock digest');
  const pageWorkflow = readFileSync(pageWorkflowPath, 'utf8');
  if (!pageWorkflow.includes('playwright install --with-deps chromium firefox webkit')
    || !pageWorkflow.includes('browser-relay-page-browser.mjs')) {
    reject('evidence.browser_relay_page.three_engine_ci_gate_present', 'has drifted');
  }
  const expectedBrowserRelayPageManifest = {
    state: browserRelayPageProfile.state,
    profile_revision: browserRelayPageProfile.revision,
    profile_sha256: BROWSER_RELAY_PAGE_PROFILE_SHA256,
    v2_profile_sha256: BROWSER_RELAY_PAGE_V2_PROFILE_SHA256,
    browser_relay_plan_sha256: browserRelayPageProfile.pins.browser_relay_plan_sha256,
    runner_profile_sha256:
      browserRelayPageProfile.pins.browser_relay_runner_profile_sha256,
    miakapi_commit: browserRelayPageProfile.pins.miakapi_commit,
    miakapi_bundle_sha256: browserRelayPageProfile.pins.miakapi_bundle_sha256,
    firebase_sdk_version: browserRelayPageProfile.pins.firebase_sdk_version,
    vite_version: browserRelayPageProfile.pins.vite_version,
    playwright_version: browserRelayPageProfile.pins.playwright_version,
    page_api_methods: browserRelayPageProfile.page.api.length,
    lifecycle_observation_schema: browserRelayPageProfile.lifecycle.observation_schema,
    lifecycle_observation_fields:
      browserRelayPageProfile.lifecycle.observation_fields.length,
    native_lifecycle_wiring_implemented:
      browserRelayPageProfile.lifecycle.native_lifecycle_wiring_implemented,
    trusted_lifecycle_events_only:
      browserRelayPageProfile.lifecycle.trusted_events_only,
    serialized_lifecycle_operations:
      browserRelayPageProfile.lifecycle.serialized_operations.length,
    typed_call_outcomes_implemented:
      browserRelayPageProfile.lifecycle.typed_call_outcomes_implemented,
    offline_validation_browser_engines:
      browserRelayPageProfile.offline_validation.browser_order.length,
    offline_dormant_artifact_proven:
      browserRelayPageProfile.offline_validation.dormant_artifact_proven,
    offline_native_non_persisted_pagehide_terminal_fence_proven:
      browserRelayPageProfile.offline_validation.native_non_persisted_pagehide_terminal_fence_proven,
    offline_native_non_persisted_async_firebase_cleanup_proven:
      browserRelayPageProfile.offline_validation.native_non_persisted_async_firebase_cleanup_proven,
    offline_explicit_terminal_cleanup_before_sequential_replacement_proven:
      browserRelayPageProfile.offline_validation
        .explicit_terminal_cleanup_before_sequential_replacement_proven,
    offline_sequential_identity_replacement_proven:
      browserRelayPageProfile.offline_validation.sequential_identity_replacement_proven,
    offline_lifecycle_dependency_mode:
      browserRelayPageProfile.offline_validation.lifecycle_dependency_mode,
    pinned_playwright_bfcache_testing_supported:
      browserRelayPageProfile.offline_validation.pinned_playwright_bfcache_testing_supported,
    native_persisted_bfcache_restoration_proven:
      browserRelayPageProfile.offline_validation.native_persisted_bfcache_restoration_proven,
    native_persisted_bfcache_state:
      browserRelayPageProfile.offline_validation.native_persisted_bfcache_state,
    simulated_trusted_persisted_unit_test:
      browserRelayPageProfile.offline_validation.simulated_trusted_persisted_unit_test,
    simulated_persisted_test_is_native_bfcache_proof:
      browserRelayPageProfile.offline_validation.simulated_persisted_test_is_native_bfcache_proof,
    live_cloud_acceptance_proven:
      browserRelayPageProfile.offline_validation.live_cloud_acceptance_proven,
    three_engine_ci_gate_present:
      browserRelayPageProfile.page.three_engine_dormant_artifact_ci,
    runner_compatible: browserRelayPageProfile.page.runner_compatible,
    firebase_auth_persistence: browserRelayPageProfile.page.firebase_auth_persistence,
    app_check_provider: browserRelayPageProfile.page.app_check_provider,
    app_check_auto_refresh: browserRelayPageProfile.page.app_check_auto_refresh,
    app_check_persistence: browserRelayPageProfile.page.app_check_persistence,
    source_credentials_on_websocket:
      browserRelayPageProfile.page.source_credentials_on_websocket,
    raw_websocket_frames_retained:
      browserRelayPageProfile.page.raw_websocket_frames_retained,
    maximum_runner_milliseconds:
      browserRelayPageProfile.timing.maximum_runner_milliseconds,
    maximum_chromium_milliseconds:
      browserRelayPageProfile.timing.maximum_chromium_milliseconds,
    callback_cleanup_reserve_milliseconds:
      browserRelayPageProfile.timing.callback_cleanup_reserve_milliseconds,
    edge_rollback_reserve_milliseconds:
      browserRelayPageProfile.timing.edge_rollback_reserve_milliseconds,
    maximum_artifact_files: browserRelayPageProfile.artifact.maximum_files,
    source_maps: browserRelayPageProfile.artifact.source_maps,
    content_addressed_gzip: browserRelayPageProfile.artifact.content_addressed_gzip,
    cloud_compute_resources: browserRelayPageProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayPageProfile.authority.cloud_mutation_authorized,
    hosting_publication_authorized:
      browserRelayPageProfile.authority.hosting_publication_authorized,
    public_ingress_authorized:
      browserRelayPageProfile.authority.public_ingress_authorized,
    live_execution_authorized:
      browserRelayPageProfile.authority.live_execution_authorized,
    live_artifact_builds: browserRelayPageProfile.evidence.live_artifact_builds,
    hosting_publications: browserRelayPageProfile.evidence.hosting_publications,
    live_execution_count: browserRelayPageProfile.evidence.live_execution_count,
    credentials_committed: false,
    raw_diagnostics_committed: false,
  };
  record(browserRelayPageManifest, 'evidence.browser_relay_page', [
    'profile_path', 'v2_profile_path', ...Object.keys(expectedBrowserRelayPageManifest),
  ]);
  exactFields(browserRelayPageManifest, expectedBrowserRelayPageManifest,
    'evidence.browser_relay_page');
  const browserRelayFixtureManifest = manifest.evidence.browser_relay_fixture;
  const browserRelayFixtureProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayFixtureManifest.profile_path,
    FIXTURE_PROFILE_PATH,
    'evidence.browser_relay_fixture.profile_path',
  );
  const browserRelayFixtureProfile = validatedEvidenceFile(
    browserRelayFixtureProfilePath,
    validateBrowserRelayFixtureProfile,
    'evidence.browser_relay_fixture.profile_path',
  );
  exact(
    fileSha256(browserRelayFixtureProfilePath),
    FIXTURE_PROFILE_SHA256,
    'evidence.browser_relay_fixture.profile_sha256',
  );
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-fixture/fixture.mjs')),
    FIXTURE_SOURCE_SHA256,
    'evidence.browser_relay_fixture.fixture_source_sha256',
  );
  exactFields(browserRelayFixtureManifest, {
    state: browserRelayFixtureProfile.state,
    profile_sha256: FIXTURE_PROFILE_SHA256,
    implementation_base_commit: FIXTURE_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256:
      browserRelayFixtureProfile.pins.browser_relay_plan_sha256,
    browser_relay_page_profile_sha256:
      browserRelayFixtureProfile.pins.browser_relay_page_profile_sha256,
    miakapi_commit: browserRelayFixtureProfile.pins.miakapi_commit,
    fixture_source_sha256: FIXTURE_SOURCE_SHA256,
    fixed_homes: 1,
    coordinator_sessions: browserRelayFixtureProfile.fixture.coordinator_sessions,
    maximum_browser_custom_tokens:
      browserRelayFixtureProfile.fixture.maximum_browser_custom_tokens,
    maximum_function_calls: browserRelayFixtureProfile.fixture.maximum_function_calls,
    preexisting_fixture_must_be_absent:
      browserRelayFixtureProfile.lifecycle.preexisting_fixture_must_be_absent,
    cleanup_authority_requires_observed_initial_absence:
      browserRelayFixtureProfile.lifecycle.cleanup_authority_requires_observed_initial_absence,
    coordinator_stop_precedes_data_cleanup:
      browserRelayFixtureProfile.lifecycle.coordinator_stop_precedes_data_cleanup,
    final_absence_must_be_observed:
      browserRelayFixtureProfile.lifecycle.final_absence_must_be_observed,
    cloud_compute_resources: browserRelayFixtureProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayFixtureProfile.authority.cloud_mutation_authorized,
    public_ingress_authorized:
      browserRelayFixtureProfile.authority.public_ingress_authorized,
    live_execution_authorized:
      browserRelayFixtureProfile.authority.live_execution_authorized,
    live_fixture_creations:
      browserRelayFixtureProfile.evidence.live_fixture_creations,
    live_custom_tokens_issued:
      browserRelayFixtureProfile.evidence.live_custom_tokens_issued,
    live_coordinator_sessions:
      browserRelayFixtureProfile.evidence.live_coordinator_sessions,
    live_cleanup_executions:
      browserRelayFixtureProfile.evidence.live_cleanup_executions,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  }, 'evidence.browser_relay_fixture');
  const browserRelayFixtureCloudManifest = manifest.evidence.browser_relay_fixture_cloud;
  const browserRelayFixtureCloudProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayFixtureCloudManifest.profile_path,
    FIXTURE_CLOUD_PROFILE_PATH,
    'evidence.browser_relay_fixture_cloud.profile_path',
  );
  const browserRelayFixtureCloudProfile = validatedEvidenceFile(
    browserRelayFixtureCloudProfilePath,
    validateBrowserRelayFixtureCloudProfile,
    'evidence.browser_relay_fixture_cloud.profile_path',
  );
  exact(
    fileSha256(browserRelayFixtureCloudProfilePath),
    FIXTURE_CLOUD_PROFILE_SHA256,
    'evidence.browser_relay_fixture_cloud.profile_sha256',
  );
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-fixture-cloud/cloud.mjs')),
    FIXTURE_CLOUD_SOURCE_SHA256,
    'evidence.browser_relay_fixture_cloud.cloud_source_sha256',
  );
  exactFields(browserRelayFixtureCloudManifest, {
    state: browserRelayFixtureCloudProfile.state,
    profile_sha256: FIXTURE_CLOUD_PROFILE_SHA256,
    implementation_base_commit: FIXTURE_CLOUD_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_fixture_profile_sha256:
      browserRelayFixtureCloudProfile.pins.browser_relay_fixture_profile_sha256,
    browser_relay_fixture_source_sha256:
      browserRelayFixtureCloudProfile.pins.browser_relay_fixture_source_sha256,
    browser_relay_page_profile_sha256:
      browserRelayFixtureCloudProfile.pins.browser_relay_page_profile_sha256,
    deployed_control_plane_source_sha256:
      browserRelayFixtureCloudProfile.pins.deployed_control_plane_source_sha256,
    miakapi_commit: browserRelayFixtureCloudProfile.pins.miakapi_commit,
    cloud_source_sha256: FIXTURE_CLOUD_SOURCE_SHA256,
    signer_service_account: FIXTURE_SIGNER_SERVICE_ACCOUNT,
    maximum_inventory_cycles:
      browserRelayFixtureCloudProfile.request_budget.maximum_inventory_cycles,
    maximum_signed_firebase_jwts:
      browserRelayFixtureCloudProfile.request_budget.maximum_signed_firebase_jwts,
    firebase_identity_binding_reads:
      browserRelayFixtureCloudProfile.request_budget.firebase_identity_binding_reads,
    mutation_retries: browserRelayFixtureCloudProfile.request_budget.mutation_retries,
    firestore_cleanup_commits:
      browserRelayFixtureCloudProfile.request_budget.firestore_cleanup_commits,
    firebase_identity_deletions:
      browserRelayFixtureCloudProfile.request_budget.firebase_identity_deletions,
    initial_absence_required_before_mutation:
      browserRelayFixtureCloudProfile.cleanup.initial_absence_required_before_mutation,
    coordinator_stop_required_before_data_cleanup:
      browserRelayFixtureCloudProfile.cleanup.coordinator_stop_required_before_data_cleanup,
    firestore_update_time_preconditions:
      browserRelayFixtureCloudProfile.cleanup.firestore_update_time_preconditions,
    final_absence_independently_observed:
      browserRelayFixtureCloudProfile.cleanup.final_absence_independently_observed,
    cloud_compute_resources: browserRelayFixtureCloudProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayFixtureCloudProfile.authority.cloud_mutation_authorized_by_artifact,
    public_ingress_authorized:
      browserRelayFixtureCloudProfile.authority.public_ingress_authorized,
    hosting_publication_authorized:
      browserRelayFixtureCloudProfile.authority.hosting_publication_authorized,
    live_execution_authorized:
      browserRelayFixtureCloudProfile.authority.live_execution_authorized,
    live_http_requests: browserRelayFixtureCloudProfile.evidence.live_http_requests,
    live_fixture_creations: browserRelayFixtureCloudProfile.evidence.live_fixture_creations,
    live_cleanup_executions:
      browserRelayFixtureCloudProfile.evidence.live_cleanup_executions,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  }, 'evidence.browser_relay_fixture_cloud');
  const browserRelayFixtureMiakApiManifest = manifest.evidence.browser_relay_fixture_miakapi;
  const browserRelayFixtureMiakApiProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayFixtureMiakApiManifest.profile_path,
    FIXTURE_MIAKAPI_PROFILE_PATH,
    'evidence.browser_relay_fixture_miakapi.profile_path',
  );
  const browserRelayFixtureMiakApiProfile = validatedEvidenceFile(
    browserRelayFixtureMiakApiProfilePath,
    validateBrowserRelayFixtureMiakApiProfile,
    'evidence.browser_relay_fixture_miakapi.profile_path',
  );
  exact(
    fileSha256(browserRelayFixtureMiakApiProfilePath),
    FIXTURE_MIAKAPI_PROFILE_SHA256,
    'evidence.browser_relay_fixture_miakapi.profile_sha256',
  );
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-fixture-miakapi/binding.mjs')),
    FIXTURE_MIAKAPI_BINDING_SOURCE_SHA256,
    'evidence.browser_relay_fixture_miakapi.binding_source_sha256',
  );
  exact(
    fileSha256(resolve(
      stagingRoot,
      'browser-relay-fixture-miakapi/vendor/miakapi-node-v4.mjs',
    )),
    MIAKAPI_NODE_BUNDLE_SHA256,
    'evidence.browser_relay_fixture_miakapi.miakapi_node_bundle_sha256',
  );
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-fixture-miakapi/vendor/LICENSE.miakapi')),
    MIAKAPI_LICENSE_SHA256,
    'evidence.browser_relay_fixture_miakapi.miakapi_license_sha256',
  );
  exactFields(browserRelayFixtureMiakApiManifest, {
    state: browserRelayFixtureMiakApiProfile.state,
    profile_sha256: FIXTURE_MIAKAPI_PROFILE_SHA256,
    implementation_base_commit: FIXTURE_MIAKAPI_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_fixture_profile_sha256:
      browserRelayFixtureMiakApiProfile.pins.browser_relay_fixture_profile_sha256,
    browser_relay_fixture_cloud_profile_sha256:
      browserRelayFixtureMiakApiProfile.pins.browser_relay_fixture_cloud_profile_sha256,
    browser_relay_fixture_cloud_source_sha256:
      browserRelayFixtureMiakApiProfile.pins.browser_relay_fixture_cloud_source_sha256,
    miakapi_commit: browserRelayFixtureMiakApiProfile.pins.miakapi_commit,
    miakapi_source_archive_sha256:
      browserRelayFixtureMiakApiProfile.pins.miakapi_source_archive_sha256,
    miakapi_package_sha256: browserRelayFixtureMiakApiProfile.pins.miakapi_package_sha256,
    miakapi_bun_lock_sha256: browserRelayFixtureMiakApiProfile.pins.miakapi_bun_lock_sha256,
    miakapi_node_entry_sha256: MIAKAPI_NODE_ENTRY_SHA256,
    miakapi_node_bundle_sha256: MIAKAPI_NODE_BUNDLE_SHA256,
    miakapi_license_sha256: MIAKAPI_LICENSE_SHA256,
    binding_source_sha256: FIXTURE_MIAKAPI_BINDING_SOURCE_SHA256,
    bundle_bytes: browserRelayFixtureMiakApiProfile.runtime.bundle_bytes,
    vendored_modules: browserRelayFixtureMiakApiProfile.runtime.vendored_modules,
    factory_calls_per_kind:
      browserRelayFixtureMiakApiProfile.boundary.factory_calls_per_kind,
    injected_transport_only:
      browserRelayFixtureMiakApiProfile.boundary.home_key_exchange_transport
        === 'explicit_injected_only',
    ambient_fetch_fallback_reachable:
      browserRelayFixtureMiakApiProfile.boundary.ambient_fetch_fallback_reachable,
    construction_http_requests:
      browserRelayFixtureMiakApiProfile.boundary.construction_http_requests,
    construction_websocket_connections:
      browserRelayFixtureMiakApiProfile.boundary.construction_websocket_connections,
    coordinator_sessions_started:
      browserRelayFixtureMiakApiProfile.boundary.coordinator_sessions_started,
    cloud_compute_resources:
      browserRelayFixtureMiakApiProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayFixtureMiakApiProfile.authority.cloud_mutation_authorized,
    public_ingress_authorized:
      browserRelayFixtureMiakApiProfile.authority.public_ingress_authorized,
    live_execution_authorized:
      browserRelayFixtureMiakApiProfile.authority.live_execution_authorized,
    live_http_requests: browserRelayFixtureMiakApiProfile.evidence.live_http_requests,
    live_websocket_connections:
      browserRelayFixtureMiakApiProfile.evidence.live_websocket_connections,
    live_coordinator_sessions:
      browserRelayFixtureMiakApiProfile.evidence.live_coordinator_sessions,
    cloud_mutations: browserRelayFixtureMiakApiProfile.evidence.cloud_mutations,
    credentials_committed: false,
    raw_cloud_responses_committed: false,
  }, 'evidence.browser_relay_fixture_miakapi');
  const browserRelayAggregatorManifest = manifest.evidence.browser_relay_aggregator;
  const browserRelayAggregatorProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayAggregatorManifest.profile_path,
    AGGREGATOR_PROFILE_PATH,
    'evidence.browser_relay_aggregator.profile_path',
  );
  const browserRelayAggregatorProfile = validatedEvidenceFile(
    browserRelayAggregatorProfilePath,
    validateBrowserRelayAggregatorProfile,
    'evidence.browser_relay_aggregator.profile_path',
  );
  exact(
    fileSha256(browserRelayAggregatorProfilePath),
    AGGREGATOR_PROFILE_SHA256,
    'evidence.browser_relay_aggregator.profile_sha256',
  );
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-aggregator/aggregator.mjs')),
    AGGREGATOR_SOURCE_SHA256,
    'evidence.browser_relay_aggregator.aggregator_source_sha256',
  );
  const aggregatorAssertionCount = Object.values(AGGREGATOR_SOURCE_ASSERTIONS)
    .flatMap((sources) => Object.values(sources))
    .reduce((total, assertions) => total + assertions.length, 0);
  exactFields(browserRelayAggregatorManifest, {
    state: browserRelayAggregatorProfile.state,
    profile_sha256: AGGREGATOR_PROFILE_SHA256,
    implementation_base_commit: AGGREGATOR_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256:
      browserRelayAggregatorProfile.pins.browser_relay_plan_sha256,
    browser_relay_runner_profile_sha256:
      browserRelayAggregatorProfile.pins.browser_relay_runner_profile_sha256,
    browser_relay_page_profile_sha256:
      browserRelayAggregatorProfile.pins.browser_relay_page_profile_sha256,
    browser_relay_fixture_profile_sha256:
      browserRelayAggregatorProfile.pins.browser_relay_fixture_profile_sha256,
    browser_relay_fixture_cloud_profile_sha256:
      browserRelayAggregatorProfile.pins.browser_relay_fixture_cloud_profile_sha256,
    browser_relay_fixture_miakapi_profile_sha256:
      browserRelayAggregatorProfile.pins.browser_relay_fixture_miakapi_profile_sha256,
    aggregator_source_sha256: AGGREGATOR_SOURCE_SHA256,
    source_receipt_schema:
      browserRelayAggregatorProfile.aggregation.source_receipt_schema,
    engine_result_schema: browserRelayAggregatorProfile.aggregation.engine_result_schema,
    receipts_per_matrix: browserRelayAggregatorProfile.aggregation.receipts_per_matrix,
    chromium_source_receipts: AGGREGATOR_SOURCE_ORDER_BY_BROWSER.chromium.length,
    secondary_source_receipts: AGGREGATOR_SOURCE_ORDER_BY_BROWSER.firefox.length,
    assertions_owned: aggregatorAssertionCount,
    assertion_source_overlap:
      browserRelayAggregatorProfile.aggregation.assertion_source_overlap,
    independent_sources:
      browserRelayAggregatorProfile.aggregation.independent_sources.length,
    counter_owners: Object.keys(AGGREGATOR_COUNTER_OWNERS).length,
    single_use: browserRelayAggregatorProfile.aggregation.single_use,
    receipt_order_exact:
      browserRelayAggregatorProfile.aggregation.receipt_order_exact,
    receipt_retries: browserRelayAggregatorProfile.aggregation.receipt_retries,
    browser_self_attested_cloud_assertions:
      browserRelayAggregatorProfile.aggregation.browser_self_attested_cloud_assertions,
    raw_receipts_retained:
      browserRelayAggregatorProfile.aggregation.raw_receipts_retained,
    cloud_compute_resources:
      browserRelayAggregatorProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayAggregatorProfile.authority.cloud_mutation_authorized,
    hosting_publication_authorized:
      browserRelayAggregatorProfile.authority.hosting_publication_authorized,
    public_ingress_authorized:
      browserRelayAggregatorProfile.authority.public_ingress_authorized,
    live_execution_authorized:
      browserRelayAggregatorProfile.authority.live_execution_authorized,
    live_receipts_aggregated:
      browserRelayAggregatorProfile.evidence.live_receipts_aggregated,
    live_engine_results: browserRelayAggregatorProfile.evidence.live_engine_results,
    cloud_mutations: browserRelayAggregatorProfile.evidence.cloud_mutations,
    live_execution_count: browserRelayAggregatorProfile.evidence.live_execution_count,
    credentials_committed: browserRelayAggregatorProfile.evidence.credentials_committed,
    raw_receipts_committed:
      browserRelayAggregatorProfile.evidence.raw_receipts_committed,
  }, 'evidence.browser_relay_aggregator');
  const browserRelayPageReceiptManifest = manifest.evidence.browser_relay_page_receipt;
  const browserRelayPageReceiptProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayPageReceiptManifest.profile_path,
    PAGE_RECEIPT_PROFILE_PATH,
    'evidence.browser_relay_page_receipt.profile_path',
  );
  const browserRelayPageReceiptProfile = validatedEvidenceFile(
    browserRelayPageReceiptProfilePath,
    validateBrowserRelayPageReceiptProfile,
    'evidence.browser_relay_page_receipt.profile_path',
  );
  exact(
    fileSha256(browserRelayPageReceiptProfilePath),
    PAGE_RECEIPT_PROFILE_SHA256,
    'evidence.browser_relay_page_receipt.profile_sha256',
  );
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-page-receipt/producer.mjs')),
    PAGE_RECEIPT_SOURCE_SHA256,
    'evidence.browser_relay_page_receipt.producer_source_sha256',
  );
  const pageReceiptAssertionCount = [
    'chromium_assertions',
    'firefox_assertions',
    'webkit_assertions',
  ].reduce(
    (total, field) => total + browserRelayPageReceiptProfile.output[field].length,
    0,
  );
  exactFields(browserRelayPageReceiptManifest, {
    state: browserRelayPageReceiptProfile.state,
    profile_sha256: PAGE_RECEIPT_PROFILE_SHA256,
    implementation_base_commit: PAGE_RECEIPT_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256:
      browserRelayPageReceiptProfile.pins.browser_relay_plan_sha256,
    browser_relay_page_profile_sha256:
      browserRelayPageReceiptProfile.pins.browser_relay_page_profile_sha256,
    browser_relay_aggregator_profile_sha256:
      browserRelayPageReceiptProfile.pins.browser_relay_aggregator_profile_sha256,
    producer_source_sha256: PAGE_RECEIPT_SOURCE_SHA256,
    page_fact_schema: browserRelayPageReceiptProfile.producer.page_fact_schema,
    source_receipt_schema: browserRelayPageReceiptProfile.producer.source_receipt_schema,
    chromium_facts: PAGE_FACT_ORDER_BY_BROWSER.chromium.length,
    secondary_browser_facts: PAGE_FACT_ORDER_BY_BROWSER.firefox.length,
    page_instances: Object.values(
      browserRelayPageReceiptProfile.producer.page_instances_by_browser,
    ).reduce((total, count) => total + count, 0),
    required_matrix_private_inputs: REQUIRED_MATRIX_PRIVATE_INPUTS,
    current_fixture_private_inputs:
      browserRelayPageReceiptProfile.compatibility.current_fixture_private_inputs,
    fixture_capacity_satisfied:
      browserRelayPageReceiptProfile.compatibility.fixture_capacity_satisfied,
    current_page_chromium_milliseconds:
      browserRelayPageReceiptProfile.compatibility.current_page_chromium_milliseconds,
    required_page_chromium_milliseconds:
      browserRelayPageReceiptProfile.compatibility.required_page_chromium_milliseconds,
    page_timing_capacity_satisfied:
      browserRelayPageReceiptProfile.compatibility.page_timing_capacity_satisfied,
    page_host_api_scenario_complete:
      browserRelayPageReceiptProfile.compatibility.page_host_api_scenario_complete,
    playwright_bridge_present:
      browserRelayPageReceiptProfile.compatibility.playwright_bridge_present,
    aggregator_wired: browserRelayPageReceiptProfile.compatibility.aggregator_wired,
    assertions_owned: pageReceiptAssertionCount,
    single_use: browserRelayPageReceiptProfile.producer.single_use,
    fact_order_exact: browserRelayPageReceiptProfile.producer.fact_order_exact,
    fact_retries: browserRelayPageReceiptProfile.producer.fact_retries,
    raw_facts_retained: browserRelayPageReceiptProfile.producer.raw_facts_retained,
    native_pagehide_pageshow_persisted_required:
      browserRelayPageReceiptProfile.producer.native_pagehide_pageshow_persisted_required,
    identity_generation_change_required:
      browserRelayPageReceiptProfile.producer.identity_generation_change_required,
    maximum_active_websockets:
      browserRelayPageReceiptProfile.producer.maximum_active_websockets,
    source_credentials_on_websocket:
      browserRelayPageReceiptProfile.producer.source_credentials_on_websocket,
    browser_credential_persistence_events:
      browserRelayPageReceiptProfile.producer.browser_credential_persistence_events,
    cloud_compute_resources:
      browserRelayPageReceiptProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayPageReceiptProfile.authority.cloud_mutation_authorized,
    hosting_publication_authorized:
      browserRelayPageReceiptProfile.authority.hosting_publication_authorized,
    public_ingress_authorized:
      browserRelayPageReceiptProfile.authority.public_ingress_authorized,
    live_execution_authorized:
      browserRelayPageReceiptProfile.authority.live_execution_authorized,
    live_page_facts: browserRelayPageReceiptProfile.evidence.live_page_facts,
    live_receipts: browserRelayPageReceiptProfile.evidence.live_receipts,
    cloud_mutations: browserRelayPageReceiptProfile.evidence.cloud_mutations,
    live_execution_count:
      browserRelayPageReceiptProfile.evidence.live_execution_count,
    credentials_committed:
      browserRelayPageReceiptProfile.evidence.credentials_committed,
    raw_facts_committed:
      browserRelayPageReceiptProfile.evidence.raw_facts_committed,
  }, 'evidence.browser_relay_page_receipt');
  const browserRelayScenarioFixtureManifest =
    manifest.evidence.browser_relay_scenario_fixture;
  const browserRelayScenarioFixtureProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayScenarioFixtureManifest.profile_path,
    SCENARIO_FIXTURE_PROFILE_PATH,
    'evidence.browser_relay_scenario_fixture.profile_path',
  );
  const browserRelayScenarioFixtureProfile = validatedEvidenceFile(
    browserRelayScenarioFixtureProfilePath,
    validateBrowserRelayScenarioFixtureProfile,
    'evidence.browser_relay_scenario_fixture.profile_path',
  );
  exact(
    fileSha256(browserRelayScenarioFixtureProfilePath),
    SCENARIO_FIXTURE_PROFILE_SHA256,
    'evidence.browser_relay_scenario_fixture.profile_sha256',
  );
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-scenario-fixture/fixture.mjs')),
    SCENARIO_FIXTURE_SOURCE_SHA256,
    'evidence.browser_relay_scenario_fixture.fixture_source_sha256',
  );
  exactFields(browserRelayScenarioFixtureManifest, {
    state: browserRelayScenarioFixtureProfile.state,
    profile_sha256: SCENARIO_FIXTURE_PROFILE_SHA256,
    implementation_base_commit: SCENARIO_FIXTURE_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_plan_sha256:
      browserRelayScenarioFixtureProfile.pins.browser_relay_plan_sha256,
    browser_relay_page_profile_sha256:
      browserRelayScenarioFixtureProfile.pins.browser_relay_page_profile_sha256,
    browser_relay_fixture_profile_sha256:
      browserRelayScenarioFixtureProfile.pins.browser_relay_fixture_profile_sha256,
    browser_relay_fixture_source_sha256:
      browserRelayScenarioFixtureProfile.pins.browser_relay_fixture_source_sha256,
    browser_relay_fixture_cloud_profile_sha256:
      browserRelayScenarioFixtureProfile.pins.browser_relay_fixture_cloud_profile_sha256,
    browser_relay_page_receipt_profile_sha256:
      browserRelayScenarioFixtureProfile.pins.browser_relay_page_receipt_profile_sha256,
    fixture_source_sha256: SCENARIO_FIXTURE_SOURCE_SHA256,
    firebase_identities:
      browserRelayScenarioFixtureProfile.scenario.firebase_identities,
    coordinator_state_access_users:
      browserRelayScenarioFixtureProfile.scenario.coordinator_state_access_users,
    page_private_inputs: SCENARIO_INPUT_ORDER.length,
    primary_identity_page_inputs:
      browserRelayScenarioFixtureProfile.scenario.primary_identity_page_inputs,
    replacement_identity_page_inputs:
      browserRelayScenarioFixtureProfile.scenario.replacement_identity_page_inputs,
    custom_token_reuse:
      browserRelayScenarioFixtureProfile.scenario.custom_token_reuse,
    fixture_capacity_satisfied:
      browserRelayScenarioFixtureProfile.compatibility.fixture_capacity_satisfied,
    identity_generation_capacity_satisfied:
      browserRelayScenarioFixtureProfile.compatibility.identity_generation_capacity_satisfied,
    current_cloud_adapter_firebase_identities:
      browserRelayScenarioFixtureProfile.compatibility
        .current_cloud_adapter_firebase_identities,
    replacement_cloud_adapter_present:
      browserRelayScenarioFixtureProfile.compatibility.replacement_cloud_adapter_present,
    page_timing_capacity_satisfied:
      browserRelayScenarioFixtureProfile.compatibility.page_timing_capacity_satisfied,
    page_host_api_scenario_complete:
      browserRelayScenarioFixtureProfile.compatibility.page_host_api_scenario_complete,
    playwright_bridge_present:
      browserRelayScenarioFixtureProfile.compatibility.playwright_bridge_present,
    aggregator_wired:
      browserRelayScenarioFixtureProfile.compatibility.aggregator_wired,
    both_identities_absent_before_mutation:
      browserRelayScenarioFixtureProfile.lifecycle.both_identities_absent_before_mutation,
    coordinator_stop_precedes_all_data_cleanup:
      browserRelayScenarioFixtureProfile.lifecycle
        .coordinator_stop_precedes_all_data_cleanup,
    both_identities_absent_after_cleanup:
      browserRelayScenarioFixtureProfile.lifecycle.both_identities_absent_after_cleanup,
    cleanup_attempts_both_ownership_domains:
      browserRelayScenarioFixtureProfile.lifecycle.cleanup_attempts_both_ownership_domains,
    cloud_compute_resources:
      browserRelayScenarioFixtureProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayScenarioFixtureProfile.authority.cloud_mutation_authorized,
    hosting_publication_authorized:
      browserRelayScenarioFixtureProfile.authority.hosting_publication_authorized,
    public_ingress_authorized:
      browserRelayScenarioFixtureProfile.authority.public_ingress_authorized,
    live_execution_authorized:
      browserRelayScenarioFixtureProfile.authority.live_execution_authorized,
    live_fixture_creations:
      browserRelayScenarioFixtureProfile.evidence.live_fixture_creations,
    live_replacement_identities:
      browserRelayScenarioFixtureProfile.evidence.live_replacement_identities,
    live_page_custom_tokens_issued:
      browserRelayScenarioFixtureProfile.evidence.live_page_custom_tokens_issued,
    live_cleanup_executions:
      browserRelayScenarioFixtureProfile.evidence.live_cleanup_executions,
    cloud_mutations: browserRelayScenarioFixtureProfile.evidence.cloud_mutations,
    credentials_committed:
      browserRelayScenarioFixtureProfile.evidence.credentials_committed,
    raw_cloud_responses_committed:
      browserRelayScenarioFixtureProfile.evidence.raw_cloud_responses_committed,
  }, 'evidence.browser_relay_scenario_fixture');
  const browserRelayScenarioFixtureCloudManifest =
    manifest.evidence.browser_relay_scenario_fixture_cloud;
  if (browserRelayScenarioFixtureCloudManifest === null
    || typeof browserRelayScenarioFixtureCloudManifest !== 'object'
    || Array.isArray(browserRelayScenarioFixtureCloudManifest)) {
    reject('evidence.browser_relay_scenario_fixture_cloud', 'must be an object');
  }
  const browserRelayScenarioFixtureCloudProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayScenarioFixtureCloudManifest.profile_path,
    SCENARIO_FIXTURE_CLOUD_PROFILE_PATH,
    'evidence.browser_relay_scenario_fixture_cloud.profile_path',
  );
  const browserRelayScenarioFixtureCloudProfile = validatedEvidenceFile(
    browserRelayScenarioFixtureCloudProfilePath,
    validateBrowserRelayScenarioFixtureCloudProfile,
    'evidence.browser_relay_scenario_fixture_cloud.profile_path',
  );
  exact(
    fileSha256(browserRelayScenarioFixtureCloudProfilePath),
    SCENARIO_FIXTURE_CLOUD_PROFILE_SHA256,
    'evidence.browser_relay_scenario_fixture_cloud.profile_sha256',
  );
  exact(
    fileSha256(resolve(stagingRoot, 'browser-relay-scenario-fixture-cloud/cloud.mjs')),
    SCENARIO_FIXTURE_CLOUD_SOURCE_SHA256,
    'evidence.browser_relay_scenario_fixture_cloud.cloud_source_sha256',
  );
  const browserRelayScenarioFixtureCloudExpected = {
    state: browserRelayScenarioFixtureCloudProfile.state,
    profile_sha256: SCENARIO_FIXTURE_CLOUD_PROFILE_SHA256,
    implementation_base_commit: SCENARIO_FIXTURE_CLOUD_IMPLEMENTATION_BASE_COMMIT,
    browser_relay_fixture_cloud_profile_sha256:
      browserRelayScenarioFixtureCloudProfile.pins.browser_relay_fixture_cloud_profile_sha256,
    browser_relay_fixture_cloud_source_sha256:
      browserRelayScenarioFixtureCloudProfile.pins.browser_relay_fixture_cloud_source_sha256,
    browser_relay_scenario_fixture_profile_sha256:
      browserRelayScenarioFixtureCloudProfile.pins.browser_relay_scenario_fixture_profile_sha256,
    browser_relay_scenario_fixture_source_sha256:
      browserRelayScenarioFixtureCloudProfile.pins.browser_relay_scenario_fixture_source_sha256,
    cloud_source_sha256: SCENARIO_FIXTURE_CLOUD_SOURCE_SHA256,
    signer_service_account: browserRelayScenarioFixtureCloudProfile.target.signer_service_account,
    explicit_injected_transport:
      browserRelayScenarioFixtureCloudProfile.request_budget.explicit_injected_transport,
    ambient_credentials:
      browserRelayScenarioFixtureCloudProfile.credential_boundary.ambient_credentials,
    persistent_credentials:
      browserRelayScenarioFixtureCloudProfile.credential_boundary.persistent_credentials,
    service_account_private_keys:
      browserRelayScenarioFixtureCloudProfile.credential_boundary.service_account_private_keys,
    maximum_inventory_cycles:
      browserRelayScenarioFixtureCloudProfile.request_budget.maximum_inventory_cycles,
    maximum_signed_firebase_jwts:
      browserRelayScenarioFixtureCloudProfile.request_budget.maximum_signed_firebase_jwts,
    firebase_identity_binding_reads:
      browserRelayScenarioFixtureCloudProfile.request_budget.firebase_identity_binding_reads,
    maximum_signing_window_seconds:
      browserRelayScenarioFixtureCloudProfile.request_budget.maximum_signing_window_seconds,
    firebase_identity_creations:
      browserRelayScenarioFixtureCloudProfile.request_budget.firebase_identity_creations,
    firebase_page_custom_tokens:
      browserRelayScenarioFixtureCloudProfile.request_budget.firebase_page_custom_tokens,
    firebase_identity_deletions:
      browserRelayScenarioFixtureCloudProfile.request_budget.firebase_identity_deletions,
    mutation_retries: browserRelayScenarioFixtureCloudProfile.request_budget.mutation_retries,
    ...browserRelayScenarioFixtureCloudProfile.cleanup,
    ...browserRelayScenarioFixtureCloudProfile.compatibility,
    cloud_compute_resources: browserRelayScenarioFixtureCloudProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayScenarioFixtureCloudProfile.authority.cloud_mutation_authorized_by_artifact,
    public_ingress_authorized:
      browserRelayScenarioFixtureCloudProfile.authority.public_ingress_authorized,
    hosting_publication_authorized:
      browserRelayScenarioFixtureCloudProfile.authority.hosting_publication_authorized,
    live_execution_authorized:
      browserRelayScenarioFixtureCloudProfile.authority.live_execution_authorized,
    iam_binding_mutation_authorized:
      browserRelayScenarioFixtureCloudProfile.authority.iam_binding_mutation_authorized,
    live_http_requests: browserRelayScenarioFixtureCloudProfile.evidence.live_http_requests,
    live_replacement_identity_creations:
      browserRelayScenarioFixtureCloudProfile.evidence.live_replacement_identity_creations,
    live_page_custom_tokens_issued:
      browserRelayScenarioFixtureCloudProfile.evidence.live_page_custom_tokens_issued,
    live_replacement_identity_deletions:
      browserRelayScenarioFixtureCloudProfile.evidence.live_replacement_identity_deletions,
    live_execution_count: browserRelayScenarioFixtureCloudProfile.evidence.live_execution_count,
    credentials_committed: browserRelayScenarioFixtureCloudProfile.evidence.credentials_committed,
    raw_cloud_responses_committed:
      browserRelayScenarioFixtureCloudProfile.evidence.raw_cloud_responses_committed,
  };
  record(browserRelayScenarioFixtureCloudManifest, 'evidence.browser_relay_scenario_fixture_cloud', [
    'profile_path',
    ...Object.keys(browserRelayScenarioFixtureCloudExpected),
  ]);
  exactFields(
    browserRelayScenarioFixtureCloudManifest,
    browserRelayScenarioFixtureCloudExpected,
    'evidence.browser_relay_scenario_fixture_cloud',
  );
  const browserRelayMonitoringManifest = manifest.evidence.browser_relay_monitoring;
  const monitoringProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayMonitoringManifest.profile_path,
    MONITORING_PROFILE_PATH,
    'evidence.browser_relay_monitoring.profile_path',
  );
  const monitoringProfile = validatedEvidenceFile(
    monitoringProfilePath,
    validateBrowserRelayMonitoringProfile,
    'evidence.browser_relay_monitoring.profile_path',
  );
  exact(
    fileSha256(monitoringProfilePath),
    browserRelayMonitoringManifest.profile_sha256,
    'evidence.browser_relay_monitoring.profile_sha256',
  );
  const monitoringResultPath = committedEvidencePath(
    stagingRoot,
    browserRelayMonitoringManifest.preflight_result_path,
    MONITORING_PREFLIGHT_RESULT_PATH,
    'evidence.browser_relay_monitoring.preflight_result_path',
  );
  const monitoringResult = validatedEvidenceFile(
    monitoringResultPath,
    validateMonitoringPreflightResult,
    'evidence.browser_relay_monitoring.preflight_result_path',
  );
  exact(
    fileSha256(monitoringResultPath),
    browserRelayMonitoringManifest.preflight_result_sha256,
    'evidence.browser_relay_monitoring.preflight_result_sha256',
  );
  exact(
    monitoringProfile.pins.browser_relay_plan_sha256,
    MONITORING_BROWSER_RELAY_PLAN_SHA256,
    'evidence.browser_relay_monitoring historical plan pin',
  );
  exact(
    monitoringResult.browser_relay_plan_sha256,
    BROWSER_RELAY_V10_PLAN_SHA256,
    'evidence.browser_relay_monitoring result historical plan pin',
  );
  exact(
    browserRelayV10Plan.pins.browser_relay_runner_profile_sha256,
    BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    'browser-relay revision 10 runner pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_monitoring_profile_sha256,
    MONITORING_PROFILE_SHA256,
    'evidence.browser_relay_plan monitoring profile pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_monitoring_preflight_result_sha256,
    MONITORING_PREFLIGHT_RESULT_SHA256,
    'evidence.browser_relay_plan monitoring result pin',
  );
  exact(
    browserRelayV11Plan.pins.miakapp_v3_commit,
    MONITORING_IMPLEMENTATION_COMMIT,
    'browser-relay revision 11 monitoring implementation pin',
  );
  exact(
    browserRelayPlan.preconditions.find(({ id }) => id === 'MONITORING-01')?.state,
    'satisfied',
    'evidence.browser_relay_plan MONITORING-01 precondition',
  );
  exact(
    monitoringProfile.enforcement.maximum_public_window_seconds,
    browserRelayV10Plan.budgets.maximum_public_window_seconds,
    'evidence.browser_relay_monitoring public-window budget',
  );
  exact(
    monitoringProfile.enforcement.maximum_recaptcha_assessments,
    browserRelayV10Plan.budgets.maximum_recaptcha_assessments,
    'evidence.browser_relay_monitoring reCAPTCHA budget',
  );
  exact(
    monitoringProfile.enforcement.maximum_control_plane_exchanges,
    browserRelayV10Plan.budgets.maximum_control_plane_exchanges,
    'evidence.browser_relay_monitoring exchange budget',
  );
  exact(
    monitoringProfile.enforcement.maximum_kms_signatures,
    browserRelayV10Plan.budgets.maximum_kms_signatures,
    'evidence.browser_relay_monitoring signing budget',
  );
  exact(
    monitoringProfile.enforcement.maximum_firestore_writes,
    browserRelayV10Plan.budgets.maximum_firestore_writes,
    'evidence.browser_relay_monitoring Firestore budget',
  );
  exactArray(
    monitoringProfile.output.forbidden_observations,
    browserRelayV10Plan.evidence.forbidden_observations,
    'evidence.browser_relay_monitoring forbidden observations',
  );
  exactFields(browserRelayMonitoringManifest, {
    state: monitoringResult.state,
    profile_sha256: monitoringResult.profile_sha256,
    preflight_result_sha256: MONITORING_PREFLIGHT_RESULT_SHA256,
    implementation_commit: monitoringResult.implementation_commit,
    browser_relay_plan_sha256: monitoringResult.browser_relay_plan_sha256,
    observed_at: monitoringResult.observed_at,
    control_plane_state: monitoringResult.control_plane_state,
    control_plane_revision: monitoringResult.control_plane_revision,
    control_plane_public_invokers: monitoringResult.control_plane_public_invokers,
    relay_phase: monitoringResult.relay_phase,
    relay_services: monitoringResult.relay_services,
    relay_public_invokers: monitoringResult.relay_public_invokers,
    metric_descriptors_observed: monitoringResult.metric_descriptors_observed,
    allowlisted_queries_succeeded: monitoringResult.allowlisted_queries_succeeded,
    series_headers_observed: monitoringResult.series_headers_observed,
    budget_state: monitoringResult.budget_state,
    budget_amount_eur: monitoringResult.budget_amount_eur,
    budget_project_level_recipients:
      monitoringResult.budget_project_level_recipients,
    cloud_mutations: monitoringResult.cloud_mutations,
    public_ingress_changes: monitoringResult.public_ingress_changes,
    acceptance_executions: monitoringResult.acceptance_executions,
    credentials_committed: monitoringResult.credential_material_retained,
    raw_cloud_responses_committed: monitoringResult.raw_cloud_responses_retained,
  }, 'evidence.browser_relay_monitoring');
  exactArray(
    browserRelayMonitoringManifest.budget_thresholds_eur,
    monitoringResult.budget_thresholds_eur,
    'evidence.browser_relay_monitoring.budget_thresholds_eur',
  );
  const browserRelayRollbackManifest = manifest.evidence.browser_relay_rollback;
  const browserRelayRollbackProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayRollbackManifest.profile_path,
    ROLLBACK_PROFILE_PATH,
    'evidence.browser_relay_rollback.profile_path',
  );
  const browserRelayRollbackProfile = validatedEvidenceFile(
    browserRelayRollbackProfilePath,
    validateBrowserRelayRollbackProfile,
    'evidence.browser_relay_rollback.profile_path',
  );
  exact(
    fileSha256(browserRelayRollbackProfilePath),
    browserRelayRollbackManifest.profile_sha256,
    'evidence.browser_relay_rollback.profile_sha256',
  );
  const browserRelayRollbackResultPath = committedEvidencePath(
    stagingRoot,
    browserRelayRollbackManifest.preflight_result_path,
    ROLLBACK_PREFLIGHT_RESULT_PATH,
    'evidence.browser_relay_rollback.preflight_result_path',
  );
  const browserRelayRollbackResult = validatedEvidenceFile(
    browserRelayRollbackResultPath,
    validateRollbackPreflightResult,
    'evidence.browser_relay_rollback.preflight_result_path',
  );
  exact(
    fileSha256(browserRelayRollbackResultPath),
    browserRelayRollbackManifest.preflight_result_sha256,
    'evidence.browser_relay_rollback.preflight_result_sha256',
  );
  exact(
    browserRelayRollbackProfile.pins.browser_relay_plan_sha256,
    BROWSER_RELAY_V11_PLAN_SHA256,
    'evidence.browser_relay_rollback historical plan pin',
  );
  exact(
    browserRelayRollbackProfile.pins.monitoring_preflight_result_sha256,
    MONITORING_PREFLIGHT_RESULT_SHA256,
    'evidence.browser_relay_rollback monitoring result pin',
  );
  exact(
    browserRelayRollbackProfile.pins.runner_profile_sha256,
    BROWSER_RELAY_RUNNER_PROFILE_SHA256,
    'evidence.browser_relay_rollback runner profile pin',
  );
  exact(
    browserRelayRollbackProfile.pins.relay_services_profile_sha256,
    RELAY_SERVICES_PROFILE_SHA256,
    'evidence.browser_relay_rollback relay profile pin',
  );
  exact(
    browserRelayRollbackProfile.pins.relay_services_converged_profile_sha256,
    RELAY_SERVICES_V5_PROFILE_SHA256,
    'evidence.browser_relay_rollback converged relay profile pin',
  );
  exact(
    browserRelayRollbackProfile.pins.relay_services_private_ready_result_sha256,
    RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    'evidence.browser_relay_rollback relay result pin',
  );
  exactArray(
    browserRelayRollbackProfile.rollback.ordered_steps,
    browserRelayV11Plan.rollback.ordered_steps,
    'evidence.browser_relay_rollback historical ordered plan steps',
  );
  exactFields(
    browserRelayRollbackProfile.required_final_state,
    browserRelayV11Plan.rollback.required_final_state,
    'evidence.browser_relay_rollback historical final plan state',
  );
  exactArray(
    browserRelayPlan.rollback.ordered_steps,
    browserRelayRollbackProfile.rollback.ordered_steps,
    'evidence.browser_relay_plan retained rollback steps',
  );
  exactFields(
    browserRelayPlan.rollback.required_final_state,
    browserRelayRollbackProfile.required_final_state,
    'evidence.browser_relay_plan retained rollback final state',
  );
  exact(
    browserRelayV12Plan.pins.miakapp_v3_commit,
    ROLLBACK_IMPLEMENTATION_COMMIT,
    'evidence.browser_relay_plan historical rollback implementation pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_rollback_profile_sha256,
    ROLLBACK_PROFILE_SHA256,
    'evidence.browser_relay_plan rollback profile pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_rollback_preflight_result_sha256,
    ROLLBACK_PREFLIGHT_RESULT_SHA256,
    'evidence.browser_relay_plan rollback result pin',
  );
  exact(
    browserRelayRollbackResult.browser_relay_plan_sha256,
    BROWSER_RELAY_V11_PLAN_SHA256,
    'evidence.browser_relay_rollback result historical plan pin',
  );
  exact(
    browserRelayPlan.preconditions.find(({ id }) => id === 'ROLLBACK-01')?.state,
    'satisfied',
    'evidence.browser_relay_plan ROLLBACK-01 precondition',
  );
  exactFields(browserRelayRollbackManifest, {
    state: browserRelayRollbackResult.state,
    profile_sha256: browserRelayRollbackResult.profile_sha256,
    preflight_result_sha256: ROLLBACK_PREFLIGHT_RESULT_SHA256,
    implementation_commit: browserRelayRollbackResult.implementation_commit,
    browser_relay_plan_sha256: browserRelayRollbackResult.browser_relay_plan_sha256,
    observed_at: browserRelayRollbackResult.observed_at,
    control_plane_state: browserRelayRollbackResult.control_plane_state,
    control_plane_revision: browserRelayRollbackResult.control_plane_revision,
    control_plane_ingress: browserRelayRollbackResult.control_plane_ingress,
    control_plane_public_invokers:
      browserRelayRollbackResult.control_plane_public_invokers,
    relay_phase: browserRelayRollbackResult.relay_phase,
    relay_services: browserRelayRollbackResult.relay_services,
    relay_public_invokers: browserRelayRollbackResult.relay_public_invokers,
    relay_service_account_user_managed_keys:
      browserRelayRollbackResult.relay_service_account_user_managed_keys,
    relay_inventory_sha256: browserRelayRollbackResult.relay_inventory_sha256,
    runner_route_present: browserRelayRollbackResult.runner_route_present,
    runner_route_status: browserRelayRollbackResult.runner_route_status,
    firebase_auth_users: browserRelayRollbackResult.firebase_auth_users,
    application_fixture_collections:
      browserRelayRollbackResult.application_fixture_collections,
    temporary_iam_bindings: browserRelayRollbackResult.temporary_iam_bindings,
    minimum_instances: browserRelayRollbackResult.minimum_instances,
    terraform_convergence: browserRelayRollbackResult.terraform_convergence,
    terraform_managed_resource_noops:
      browserRelayRollbackResult.terraform_managed_resource_noops,
    rollback_steps: browserRelayRollbackResult.rollback_steps,
    cloud_mutations: browserRelayRollbackResult.cloud_mutations,
    public_ingress_changes: browserRelayRollbackResult.public_ingress_changes,
    acceptance_executions: browserRelayRollbackResult.acceptance_executions,
    credentials_committed: browserRelayRollbackResult.credential_material_retained,
    raw_cloud_responses_committed:
      browserRelayRollbackResult.raw_cloud_responses_retained,
    terraform_plan_committed: browserRelayRollbackResult.terraform_plan_retained,
  }, 'evidence.browser_relay_rollback');
  const browserRelayOrchestratorManifest = manifest.evidence.browser_relay_orchestrator;
  const browserRelayOrchestratorProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayOrchestratorManifest.profile_path,
    ORCHESTRATOR_PROFILE_PATH,
    'evidence.browser_relay_orchestrator.profile_path',
  );
  const browserRelayOrchestratorProfile = validatedEvidenceFile(
    browserRelayOrchestratorProfilePath,
    validateBrowserRelayOrchestratorProfile,
    'evidence.browser_relay_orchestrator.profile_path',
  );
  exact(
    fileSha256(browserRelayOrchestratorProfilePath),
    browserRelayOrchestratorManifest.profile_sha256,
    'evidence.browser_relay_orchestrator.profile_sha256',
  );
  const browserRelayOrchestratorResultPath = committedEvidencePath(
    stagingRoot,
    browserRelayOrchestratorManifest.preflight_result_path,
    ORCHESTRATOR_PREFLIGHT_RESULT_PATH,
    'evidence.browser_relay_orchestrator.preflight_result_path',
  );
  const browserRelayOrchestratorResult = validatedEvidenceFile(
    browserRelayOrchestratorResultPath,
    validateOrchestratorPreflightResult,
    'evidence.browser_relay_orchestrator.preflight_result_path',
  );
  exact(
    fileSha256(browserRelayOrchestratorResultPath),
    browserRelayOrchestratorManifest.preflight_result_sha256,
    'evidence.browser_relay_orchestrator.preflight_result_sha256',
  );
  exact(
    browserRelayOrchestratorProfile.pins.browser_relay_plan_sha256,
    BROWSER_RELAY_V12_PLAN_SHA256,
    'evidence.browser_relay_orchestrator historical plan pin',
  );
  exact(
    browserRelayOrchestratorResult.browser_relay_plan_sha256,
    BROWSER_RELAY_V12_PLAN_SHA256,
    'evidence.browser_relay_orchestrator result historical plan pin',
  );
  exact(
    browserRelayV13Plan.pins.miakapp_v3_commit,
    ORCHESTRATOR_IMPLEMENTATION_COMMIT,
    'evidence.browser_relay_plan historical orchestrator implementation pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_orchestrator_profile_sha256,
    ORCHESTRATOR_PROFILE_SHA256,
    'evidence.browser_relay_plan orchestrator profile pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_orchestrator_preflight_result_sha256,
    ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    'evidence.browser_relay_plan orchestrator result pin',
  );
  exact(
    browserRelayPlan.preconditions.find(({ id }) => id === 'EDGE-01')?.state,
    'satisfied',
    'evidence.browser_relay_plan EDGE-01 precondition',
  );
  exactFields(browserRelayOrchestratorManifest, {
    state: browserRelayOrchestratorResult.state,
    profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    preflight_result_sha256: ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    implementation_base_commit:
      browserRelayOrchestratorProfile.pins.implementation_base_commit,
    implementation_commit: browserRelayOrchestratorResult.implementation_commit,
    browser_relay_plan_sha256:
      browserRelayOrchestratorResult.browser_relay_plan_sha256,
    satisfied_input_preconditions:
      browserRelayOrchestratorProfile.preflight.required_satisfied_preconditions.length,
    closed_precondition:
      browserRelayOrchestratorProfile.preflight.required_open_precondition,
    observed_at: browserRelayOrchestratorResult.observed_at,
    claim_bucket: browserRelayOrchestratorProfile.claim.bucket,
    claim_object: browserRelayOrchestratorProfile.claim.object,
    claim_state: browserRelayOrchestratorResult.claim_state,
    claim_if_generation_match:
      browserRelayOrchestratorProfile.claim.if_generation_match,
    maximum_claim_creations:
      browserRelayOrchestratorProfile.claim.maximum_creations,
    claim_precedes_first_cloud_mutation:
      browserRelayOrchestratorProfile.claim.claim_precedes_first_cloud_mutation,
    baseline_reobserved_after_claim:
      browserRelayOrchestratorProfile.claim.baseline_reobserved_after_claim,
    ambiguous_claim_stops_before_edge_mutation:
      browserRelayOrchestratorProfile.recovery.ambiguous_claim_stops_before_edge_mutation,
    claim_retained: browserRelayOrchestratorProfile.claim.retained,
    retry_authorized: browserRelayOrchestratorProfile.claim.retry_authorized,
    deletion_authorized: browserRelayOrchestratorProfile.claim.deletion_authorized,
    maximum_edge_window_executions:
      browserRelayOrchestratorProfile.execution.maximum_edge_window_executions,
    maximum_public_window_milliseconds:
      browserRelayOrchestratorProfile.execution.maximum_public_window_milliseconds,
    maximum_callback_execution_milliseconds:
      browserRelayOrchestratorProfile.execution.maximum_callback_execution_milliseconds,
    orchestration_stages: browserRelayOrchestratorProfile.execution.stages.length,
    automatic_edge_rollback:
      browserRelayOrchestratorProfile.recovery.automatic_edge_rollback,
    control_plane_state: browserRelayOrchestratorResult.control_plane_state,
    control_plane_revision: browserRelayOrchestratorResult.control_plane_revision,
    control_plane_public_invokers:
      browserRelayOrchestratorResult.control_plane_public_invokers,
    relay_phase: browserRelayOrchestratorResult.relay_phase,
    relay_services: browserRelayOrchestratorResult.relay_services,
    relay_public_invokers: browserRelayOrchestratorResult.relay_public_invokers,
    terraform_convergence: browserRelayOrchestratorResult.terraform_convergence,
    terraform_managed_resource_noops:
      browserRelayOrchestratorResult.terraform_managed_resource_noops,
    live_preflight_count: 1,
    live_execution_count:
      browserRelayOrchestratorProfile.evidence.live_execution_count,
    claim_creations: browserRelayOrchestratorProfile.evidence.claim_creations,
    cloud_mutations: browserRelayOrchestratorResult.cloud_mutations,
    public_ingress_changes:
      browserRelayOrchestratorResult.public_ingress_changes,
    acceptance_executions:
      browserRelayOrchestratorResult.acceptance_executions,
    credentials_committed:
      browserRelayOrchestratorResult.credential_material_retained,
    raw_cloud_responses_committed:
      browserRelayOrchestratorResult.raw_cloud_responses_retained,
    terraform_plan_committed: browserRelayOrchestratorResult.terraform_plan_retained,
    browser_diagnostics_committed:
      browserRelayOrchestratorProfile.evidence.browser_diagnostics_committed,
  }, 'evidence.browser_relay_orchestrator');
  const browserRelayOperationManifest = manifest.evidence.browser_relay_operation;
  const browserRelayOperationProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayOperationManifest.profile_path,
    OPERATION_PROFILE_PATH,
    'evidence.browser_relay_operation.profile_path',
  );
  const browserRelayOperationProfile = validatedEvidenceFile(
    browserRelayOperationProfilePath,
    validateBrowserRelayOperationProfile,
    'evidence.browser_relay_operation.profile_path',
  );
  exact(
    fileSha256(browserRelayOperationProfilePath),
    browserRelayOperationManifest.profile_sha256,
    'evidence.browser_relay_operation.profile_sha256',
  );
  exact(
    browserRelayOperationProfile.pins.browser_relay_plan_sha256,
    BROWSER_RELAY_V13_PLAN_SHA256,
    'evidence.browser_relay_operation historical plan pin',
  );
  exact(
    browserRelayOperationProfile.pins.orchestrator_profile_sha256,
    ORCHESTRATOR_PROFILE_SHA256,
    'evidence.browser_relay_operation orchestrator profile pin',
  );
  exact(
    browserRelayOperationProfile.pins.orchestrator_preflight_result_sha256,
    ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    'evidence.browser_relay_operation orchestrator result pin',
  );
  const browserRelayOperationResultPath = committedEvidencePath(
    stagingRoot,
    browserRelayOperationManifest.preflight_result_path,
    OPERATION_PREFLIGHT_RESULT_PATH,
    'evidence.browser_relay_operation.preflight_result_path',
  );
  const browserRelayOperationResult = validatedEvidenceFile(
    browserRelayOperationResultPath,
    validateOperationPreflightResult,
    'evidence.browser_relay_operation.preflight_result_path',
  );
  exact(
    fileSha256(browserRelayOperationResultPath),
    browserRelayOperationManifest.preflight_result_sha256,
    'evidence.browser_relay_operation.preflight_result_sha256',
  );
  exact(
    browserRelayOperationResult.profile_sha256,
    browserRelayOperationManifest.profile_sha256,
    'evidence.browser_relay_operation result profile pin',
  );
  exact(
    browserRelayOperationResult.browser_relay_plan_sha256,
    BROWSER_RELAY_V13_PLAN_SHA256,
    'evidence.browser_relay_operation result historical plan pin',
  );
  exact(
    browserRelayV14Plan.pins.miakapp_v3_commit,
    OPERATION_IMPLEMENTATION_COMMIT,
    'evidence.browser_relay_plan historical operation implementation pin',
  );
  exact(
    browserRelayV14Plan.pins.browser_relay_operation_profile_sha256,
    browserRelayOperationManifest.profile_sha256,
    'evidence.browser_relay_plan historical operation profile pin',
  );
  exact(
    browserRelayV14Plan.pins.browser_relay_operation_preflight_result_sha256,
    browserRelayOperationManifest.preflight_result_sha256,
    'evidence.browser_relay_plan historical operation preflight result pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_operation_profile_sha256,
    browserRelayOperationManifest.profile_sha256,
    'evidence.browser_relay_plan operation profile pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_operation_preflight_result_sha256,
    browserRelayOperationManifest.preflight_result_sha256,
    'evidence.browser_relay_plan operation preflight result pin',
  );
  exact(
    browserRelayPlan.pins.miakapp_v3_commit,
    BROWSER_RELAY_PAGE_CI_MERGE_COMMIT,
    'evidence.browser_relay_plan page CI merge pin',
  );
  exact(
    browserRelayPlan.pins.browser_relay_page_profile_sha256,
    BROWSER_RELAY_PAGE_V2_PROFILE_SHA256,
    'evidence.browser_relay_plan historical page revision-2 CI pin',
  );
  exactFields(browserRelayOperationManifest, {
    state: browserRelayOperationResult.state,
    profile_sha256: OPERATION_PROFILE_SHA256,
    preflight_result_sha256: OPERATION_PREFLIGHT_RESULT_SHA256,
    implementation_base_commit:
      browserRelayOperationProfile.pins.implementation_base_commit,
    implementation_commit: browserRelayOperationResult.implementation_commit,
    browser_relay_plan_sha256:
      browserRelayOperationProfile.pins.browser_relay_plan_sha256,
    orchestrator_profile_sha256:
      browserRelayOperationProfile.pins.orchestrator_profile_sha256,
    orchestrator_preflight_result_sha256:
      browserRelayOperationProfile.pins.orchestrator_preflight_result_sha256,
    runner_profile_sha256:
      browserRelayOperationProfile.pins.runner_profile_sha256,
    monitoring_profile_sha256:
      browserRelayOperationProfile.pins.monitoring_profile_sha256,
    monitoring_preflight_result_sha256:
      browserRelayOperationProfile.pins.monitoring_preflight_result_sha256,
    rollback_profile_sha256:
      browserRelayOperationProfile.pins.rollback_profile_sha256,
    rollback_preflight_result_sha256:
      browserRelayOperationProfile.pins.rollback_preflight_result_sha256,
    relay_services_private_ready_result_sha256:
      browserRelayOperationProfile.pins.relay_services_private_ready_result_sha256,
    maximum_operation_executions:
      browserRelayOperationProfile.execution.maximum_operation_executions,
    maximum_claim_creations:
      browserRelayOperationProfile.execution.maximum_claim_creations,
    maximum_edge_window_executions:
      browserRelayOperationProfile.execution.maximum_edge_window_executions,
    maximum_matrix_executions:
      browserRelayOperationProfile.execution.maximum_matrix_executions,
    maximum_browser_invocations:
      browserRelayOperationProfile.execution.maximum_browser_invocations,
    maximum_public_window_milliseconds:
      browserRelayOperationProfile.execution.maximum_public_window_milliseconds,
    maximum_callback_execution_milliseconds:
      browserRelayOperationProfile.execution.maximum_callback_execution_milliseconds,
    window_stages: browserRelayOperationProfile.execution.window_stages.length,
    window_cleanup_stages:
      browserRelayOperationProfile.recovery.window_cleanup_order.length,
    post_edge_cleanup_stages:
      browserRelayOperationProfile.recovery.post_edge_cleanup_order.length,
    relay_public_transition_is_last_before_matrix:
      browserRelayOperationProfile.execution.relay_public_transition_is_last_before_matrix,
    observed_at: browserRelayOperationResult.observed_at,
    claim_bucket: browserRelayOperationResult.claim_bucket,
    claim_object: browserRelayOperationResult.claim_object,
    claim_state: browserRelayOperationResult.claim_state,
    control_plane_state: browserRelayOperationResult.control_plane_state,
    control_plane_revision: browserRelayOperationResult.control_plane_revision,
    control_plane_ingress: browserRelayOperationResult.control_plane_ingress,
    control_plane_public_invokers:
      browserRelayOperationResult.control_plane_public_invokers,
    relay_phase: browserRelayOperationResult.relay_phase,
    relay_services: browserRelayOperationResult.relay_services,
    relay_public_invokers: browserRelayOperationResult.relay_public_invokers,
    relay_service_account_user_managed_keys:
      browserRelayOperationResult.relay_service_account_user_managed_keys,
    relay_inventory_sha256: browserRelayOperationResult.relay_inventory_sha256,
    runner_route_present: browserRelayOperationResult.runner_route_present,
    runner_route_status: browserRelayOperationResult.runner_route_status,
    firebase_auth_users: browserRelayOperationResult.firebase_auth_users,
    application_fixture_collections:
      browserRelayOperationResult.application_fixture_collections,
    temporary_iam_bindings: browserRelayOperationResult.temporary_iam_bindings,
    minimum_instances: browserRelayOperationResult.minimum_instances,
    terraform_convergence: browserRelayOperationResult.terraform_convergence,
    terraform_managed_resource_noops:
      browserRelayOperationResult.terraform_managed_resource_noops,
    cloud_compute_resources:
      browserRelayOperationProfile.target.cloud_compute_resources,
    cloud_mutation_authorized:
      browserRelayOperationProfile.target.cloud_mutation_authorized_by_profile,
    public_ingress_authorized:
      browserRelayOperationProfile.target.public_ingress_authorized_by_profile,
    live_execution_authorized:
      browserRelayOperationProfile.target.acceptance_execution_authorized_by_profile,
    live_preflight_count: 1,
    live_execution_count:
      browserRelayOperationProfile.evidence.live_execution_count,
    claim_creations: browserRelayOperationProfile.evidence.claim_creations,
    cloud_mutations: browserRelayOperationResult.cloud_mutations,
    public_ingress_changes: browserRelayOperationResult.public_ingress_changes,
    acceptance_executions: browserRelayOperationResult.acceptance_executions,
    result_present: true,
    credentials_committed:
      browserRelayOperationResult.credential_material_retained,
    raw_cloud_responses_committed:
      browserRelayOperationResult.raw_cloud_responses_retained,
    terraform_plan_committed: browserRelayOperationResult.terraform_plan_retained,
    browser_diagnostics_committed:
      browserRelayOperationProfile.evidence.browser_diagnostics_committed,
  }, 'evidence.browser_relay_operation');
  const browserRelayImageManifest = manifest.evidence.browser_relay_image;
  const relayServicesProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_profile_path,
    RELAY_SERVICES_PROFILE_PATH,
    'evidence.browser_relay_image.relay_services_profile_path',
  );
  const relayServicesProfile = validatedEvidenceFile(
    relayServicesProfilePath,
    validateRelayServicesProfile,
    'browser-relay-services/profile.json',
  );
  exact(
    fileSha256(relayServicesProfilePath),
    browserRelayImageManifest.relay_services_profile_sha256,
    'evidence.browser_relay_image.relay_services_profile_sha256',
  );
  const relayServicesV1ProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_v1_profile_path,
    RELAY_SERVICES_V1_PROFILE_PATH,
    'evidence.browser_relay_image.relay_services_v1_profile_path',
  );
  const relayServicesV1Profile = validatedEvidenceFile(
    relayServicesV1ProfilePath,
    validateRelayServicesV1Profile,
    'evidence.browser_relay_image.relay_services_v1_profile_path',
  );
  exact(
    fileSha256(relayServicesV1ProfilePath),
    browserRelayImageManifest.relay_services_v1_profile_sha256,
    'evidence.browser_relay_image.relay_services_v1_profile_sha256',
  );
  const relayServicesV2ProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_v2_profile_path,
    RELAY_SERVICES_V2_PROFILE_PATH,
    'evidence.browser_relay_image.relay_services_v2_profile_path',
  );
  const relayServicesV2Profile = validatedEvidenceFile(
    relayServicesV2ProfilePath,
    validateRelayServicesV2Profile,
    'evidence.browser_relay_image.relay_services_v2_profile_path',
  );
  exact(
    fileSha256(relayServicesV2ProfilePath),
    browserRelayImageManifest.relay_services_v2_profile_sha256,
    'evidence.browser_relay_image.relay_services_v2_profile_sha256',
  );
  const relayServicesV3ProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_v3_profile_path,
    RELAY_SERVICES_V3_PROFILE_PATH,
    'evidence.browser_relay_image.relay_services_v3_profile_path',
  );
  const relayServicesV3Profile = validatedEvidenceFile(
    relayServicesV3ProfilePath,
    validateRelayServicesV3Profile,
    'evidence.browser_relay_image.relay_services_v3_profile_path',
  );
  exact(
    fileSha256(relayServicesV3ProfilePath),
    browserRelayImageManifest.relay_services_v3_profile_sha256,
    'evidence.browser_relay_image.relay_services_v3_profile_sha256',
  );
  const relayServicesV4ProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_v4_profile_path,
    RELAY_SERVICES_V4_PROFILE_PATH,
    'evidence.browser_relay_image.relay_services_v4_profile_path',
  );
  const relayServicesV4Profile = validatedEvidenceFile(
    relayServicesV4ProfilePath,
    validateRelayServicesV4Profile,
    'evidence.browser_relay_image.relay_services_v4_profile_path',
  );
  exact(
    fileSha256(relayServicesV4ProfilePath),
    browserRelayImageManifest.relay_services_v4_profile_sha256,
    'evidence.browser_relay_image.relay_services_v4_profile_sha256',
  );
  const relayServicesV5ProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_v5_profile_path,
    RELAY_SERVICES_V5_PROFILE_PATH,
    'evidence.browser_relay_image.relay_services_v5_profile_path',
  );
  const relayServicesV5Profile = validatedEvidenceFile(
    relayServicesV5ProfilePath,
    validateRelayServicesV5Profile,
    'evidence.browser_relay_image.relay_services_v5_profile_path',
  );
  exact(
    fileSha256(relayServicesV5ProfilePath),
    browserRelayImageManifest.relay_services_v5_profile_sha256,
    'evidence.browser_relay_image.relay_services_v5_profile_sha256',
  );
  const relayServicesBootstrapFailurePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_bootstrap_failure_path,
    RELAY_SERVICES_BOOTSTRAP_FAILURE_PATH,
    'evidence.browser_relay_image.relay_services_bootstrap_failure_path',
  );
  const relayServicesBootstrapFailure = validatedEvidenceFile(
    relayServicesBootstrapFailurePath,
    validateRelayServicesBootstrapFailure,
    'evidence.browser_relay_image.relay_services_bootstrap_failure_path',
  );
  exact(
    fileSha256(relayServicesBootstrapFailurePath),
    browserRelayImageManifest.relay_services_bootstrap_failure_sha256,
    'evidence.browser_relay_image.relay_services_bootstrap_failure_sha256',
  );
  const relayServicesMemoryRecoveryFailurePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_memory_recovery_failure_path,
    RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_PATH,
    'evidence.browser_relay_image.relay_services_memory_recovery_failure_path',
  );
  const relayServicesMemoryRecoveryFailure = validatedEvidenceFile(
    relayServicesMemoryRecoveryFailurePath,
    validateRelayServicesMemoryRecoveryFailure,
    'evidence.browser_relay_image.relay_services_memory_recovery_failure_path',
  );
  exact(
    fileSha256(relayServicesMemoryRecoveryFailurePath),
    browserRelayImageManifest.relay_services_memory_recovery_failure_sha256,
    'evidence.browser_relay_image.relay_services_memory_recovery_failure_sha256',
  );
  const relayServicesPrivateReadyResultPath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.relay_services_private_ready_result_path,
    RELAY_SERVICES_PRIVATE_READY_RESULT_PATH,
    'evidence.browser_relay_image.relay_services_private_ready_result_path',
  );
  const relayServicesPrivateReadyResult = validatedEvidenceFile(
    relayServicesPrivateReadyResultPath,
    validateRelayServicesPrivateReadyResult,
    'evidence.browser_relay_image.relay_services_private_ready_result_path',
  );
  exact(
    fileSha256(relayServicesPrivateReadyResultPath),
    browserRelayImageManifest.relay_services_private_ready_result_sha256,
    'evidence.browser_relay_image.relay_services_private_ready_result_sha256',
  );
  exact(
    browserRelayPlan.pins.relay_services_profile_sha256,
    RELAY_SERVICES_PROFILE_SHA256,
    'browser-relay/plan.json pins.relay_services_profile_sha256',
  );
  exact(
    browserRelayPlan.pins.relay_services_converged_profile_sha256,
    RELAY_SERVICES_V5_PROFILE_SHA256,
    'browser-relay/plan.json pins.relay_services_converged_profile_sha256',
  );
  exact(
    browserRelayPlan.pins.relay_services_private_ready_result_sha256,
    RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    'browser-relay/plan.json pins.relay_services_private_ready_result_sha256',
  );
  exact(
    browserRelayPlan.pins.relay_services_live_inventory_sha256,
    relayServicesPrivateReadyResult.final_inventory_sha256,
    'browser-relay/plan.json pins.relay_services_live_inventory_sha256',
  );
  exact(
    browserRelayPlan.pins.miakapp_server_commit,
    relayServicesProfile.pins.miakapp_server_commit,
    'browser-relay/plan.json pins.miakapp_server_commit',
  );
  const browserRelayImageProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.profile_path,
    RELAY_IMAGE_PROFILE_PATH,
    'evidence.browser_relay_image.profile_path',
  );
  const browserRelayImageProfile = validatedEvidenceFile(
    browserRelayImageProfilePath,
    validateRelayImageProfile,
    'evidence.browser_relay_image.profile_path',
  );
  exact(
    fileSha256(browserRelayImageProfilePath),
    browserRelayImageManifest.profile_sha256,
    'evidence.browser_relay_image.profile_sha256',
  );
  const browserRelayImageV1ProfilePath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.v1_profile_path,
    RELAY_IMAGE_V1_PROFILE_PATH,
    'evidence.browser_relay_image.v1_profile_path',
  );
  const browserRelayImageV1Profile = validatedEvidenceFile(
    browserRelayImageV1ProfilePath,
    validateRelayImageV1Profile,
    'evidence.browser_relay_image.v1_profile_path',
  );
  exact(
    fileSha256(browserRelayImageV1ProfilePath),
    browserRelayImageManifest.v1_profile_sha256,
    'evidence.browser_relay_image.v1_profile_sha256',
  );
  const browserRelayImageV1ResultPath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.v1_result_path,
    RELAY_IMAGE_V1_RESULT_PATH,
    'evidence.browser_relay_image.v1_result_path',
  );
  const browserRelayImageV1Result = validatedEvidenceFile(
    browserRelayImageV1ResultPath,
    validateRelayImageV1Result,
    'evidence.browser_relay_image.v1_result_path',
  );
  exact(
    fileSha256(browserRelayImageV1ResultPath),
    browserRelayImageManifest.v1_result_sha256,
    'evidence.browser_relay_image.v1_result_sha256',
  );
  const browserRelayImageV2ResultPath = committedEvidencePath(
    stagingRoot,
    browserRelayImageManifest.v2_result_path,
    RELAY_IMAGE_V2_RESULT_PATH,
    'evidence.browser_relay_image.v2_result_path',
  );
  const browserRelayImageV2Result = validatedEvidenceFile(
    browserRelayImageV2ResultPath,
    validateRelayImageV2Result,
    'evidence.browser_relay_image.v2_result_path',
  );
  exact(
    fileSha256(browserRelayImageV2ResultPath),
    browserRelayImageManifest.v2_result_sha256,
    'evidence.browser_relay_image.v2_result_sha256',
  );
  exactFields(browserRelayImageManifest, {
    state:
      'v1_failed_container_analysis_converged_v2_recovery_succeeded_verified_private_relay_services_private_ready_succeeded_verified_entrypoints_retired_public_window_not_authorized',
    profile_sha256: RELAY_IMAGE_PROFILE_SHA256,
    v1_profile_sha256: RELAY_IMAGE_V1_PROFILE_SHA256,
    v1_result_sha256: RELAY_IMAGE_V1_RESULT_SHA256,
    v2_result_sha256: RELAY_IMAGE_V2_RESULT_SHA256,
    v2_result_observed_at: browserRelayImageV2Result.observed_at,
    browser_relay_plan_sha256:
      browserRelayImageProfile.contracts.browser_relay_plan_sha256,
    relay_services_profile_sha256: RELAY_SERVICES_PROFILE_SHA256,
    relay_services_v1_profile_sha256:
      browserRelayImageProfile.contracts.relay_services_profile_sha256,
    relay_services_v2_profile_sha256: RELAY_SERVICES_V2_PROFILE_SHA256,
    relay_services_v3_profile_sha256: RELAY_SERVICES_V3_PROFILE_SHA256,
    relay_services_v4_profile_sha256: RELAY_SERVICES_V4_PROFILE_SHA256,
    relay_services_v5_profile_sha256: RELAY_SERVICES_V5_PROFILE_SHA256,
    relay_services_bootstrap_failure_sha256: RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    relay_services_memory_recovery_failure_sha256:
      RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256,
    relay_services_private_ready_result_sha256:
      RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    relay_services_bootstrap_attempted: true,
    relay_services_bootstrap_failure_category:
      relayServicesBootstrapFailure.failure.category,
    relay_services_memory_recovery_attempted: true,
    relay_services_memory_recovery_failure_category:
      relayServicesMemoryRecoveryFailure.failure.category,
    relay_services_original_claim_generation:
      relayServicesBootstrapFailure.claim.generation,
    relay_services_original_claim_sha256: relayServicesBootstrapFailure.claim.sha256,
    relay_services_memory_recovery_claim_generation:
      relayServicesMemoryRecoveryFailure.claim.generation,
    relay_services_memory_recovery_claim_sha256:
      relayServicesMemoryRecoveryFailure.claim.sha256,
    relay_services_private_ready_attempted: true,
    relay_services_private_ready_claim_generation:
      relayServicesPrivateReadyResult.claim_generation,
    relay_services_private_ready_claim_sha256:
      relayServicesPrivateReadyResult.claim_sha256,
    relay_services_partial_state_generation:
      relayServicesBootstrapFailure.terraform_state.generation,
    relay_services_partial_state_sha256:
      relayServicesBootstrapFailure.terraform_state.sha256,
    relay_services_partial_state_serial: relayServicesBootstrapFailure.terraform_state.serial,
    relay_services_recovered_state_generation:
      relayServicesMemoryRecoveryFailure.terraform_state.generation,
    relay_services_recovered_state_sha256:
      relayServicesMemoryRecoveryFailure.terraform_state.sha256,
    relay_services_recovered_state_serial:
      relayServicesMemoryRecoveryFailure.terraform_state.serial,
    relay_services_private_ready_state_generation:
      relayServicesPrivateReadyResult.terraform_state_generation,
    relay_services_private_ready_state_sha256:
      relayServicesPrivateReadyResult.terraform_state_sha256,
    relay_services_private_ready_state_serial: 4,
    relay_services_original_entrypoints_retired: true,
    relay_services_recovery_entrypoints_retired: true,
    relay_services_private_ready_entrypoints_retired: true,
    relay_services_private_ready_entrypoint_present: false,
    relay_services_image_bound: true,
    relay_services_operator_entrypoint_present: false,
    source_repository: browserRelayImageProfile.source.repository,
    source_commit: browserRelayImageProfile.source.commit,
    source_tree: browserRelayImageProfile.source.tree,
    source_archive_sha256: browserRelayImageProfile.source.archive_sha256,
    source_archive_bytes: browserRelayImageProfile.source.archive_bytes,
    source_object_generation: browserRelayImageProfile.source.object_generation,
    source_reuse_required: browserRelayImageProfile.recovery.source_reuse_required,
    source_reused: browserRelayImageV2Result.recovery.source_reused,
    source_upload_authorized: browserRelayImageProfile.operation.source_upload_authorized,
    source_upload_performed: browserRelayImageV2Result.recovery.source_upload_performed,
    builder_digest: browserRelayImageProfile.build.builder_image.split('@')[1],
    machine_type: browserRelayImageProfile.build.machine_type,
    requested_verify_option: browserRelayImageProfile.build.requested_verify_option,
    maximum_builds: browserRelayImageProfile.build.maximum_builds,
    v1_attempted_builds: browserRelayImageV1Result.effects.cloud_builds_submitted,
    v2_attempted_builds: browserRelayImageV2Result.effects.recovery_builds_submitted,
    v2_claim_present: true,
    v2_claim_generation: browserRelayImageV2Result.claim.generation,
    v2_claim_sha256: browserRelayImageV2Result.claim.sha256,
    v2_build_id: browserRelayImageV2Result.build.id,
    v2_operation_name_sha256: browserRelayImageV2Result.build.operation_name_sha256,
    v1_private_image_present: browserRelayImageV1Result.build.image_push_observed,
    verified_image_present: browserRelayImageV2Result.build.status === 'SUCCESS',
    verified_image_digest: browserRelayImageV2Result.image.digest,
    verified_image_config_digest: browserRelayImageV2Result.image.config_digest,
    verified_image_compressed_bytes: browserRelayImageV2Result.image.compressed_bytes,
    deployment_authorized_by_image_operation: false,
    entrypoints_retired: true,
    container_analysis_api_enabled: browserRelayImageV2Result.effects.container_analysis_enabled,
    container_scanning_api_enabled: browserRelayImageV2Result.effects.container_scanning_enabled,
    relay_services: relayServicesMemoryRecoveryFailure.effects.relay_services_created,
    relay_services_cloud_run_ready:
      relayServicesMemoryRecoveryFailure.effects.relay_services_ready,
    relay_services_private_ready: relayServicesPrivateReadyResult.relays.length,
    relay_services_network_ingress: relayServicesProfile.cloud_run.ingress,
    relay_services_public_iam_members: relayServicesPrivateReadyResult.public_iam_members,
    unauthenticated_public_invocation_active:
      relayServicesPrivateReadyResult.public_iam_members !== 0,
    new_fixed_cost_services: browserRelayImageProfile.cost.new_fixed_cost_services,
    maximum_incremental_eur: browserRelayImageProfile.cost.maximum_incremental_eur,
  }, 'evidence.browser_relay_image');
  exact(
    browserRelayImageProfile.contracts.browser_relay_plan_sha256,
    BROWSER_RELAY_V8_PLAN_SHA256,
    'browser-relay-image/profile.json contracts.browser_relay_plan_sha256',
  );
  exact(
    browserRelayImageProfile.contracts.relay_services_profile_sha256,
    RELAY_SERVICES_V1_PROFILE_SHA256,
    'browser-relay-image/profile.json contracts.relay_services_profile_sha256',
  );
  exact(
    browserRelayImageProfile.contracts.v1_profile_sha256,
    RELAY_IMAGE_V1_PROFILE_SHA256,
    'browser-relay-image/profile.json contracts.v1_profile_sha256',
  );
  exact(
    browserRelayImageProfile.contracts.v1_result_sha256,
    RELAY_IMAGE_V1_RESULT_SHA256,
    'browser-relay-image/profile.json contracts.v1_result_sha256',
  );
  exact(
    browserRelayImageV1Result.profile_sha256,
    RELAY_IMAGE_V1_PROFILE_SHA256,
    'browser-relay-image/result-v1.json profile_sha256',
  );
  exact(
    browserRelayImageV2Result.profile_sha256,
    RELAY_IMAGE_PROFILE_SHA256,
    'browser-relay-image/result-v2.json profile_sha256',
  );
  exact(
    browserRelayImageV2Result.recovery.v1_result_sha256,
    RELAY_IMAGE_V1_RESULT_SHA256,
    'browser-relay-image/result-v2.json recovery.v1_result_sha256',
  );
  for (const field of ['repository', 'commit', 'tree', 'archive_sha256', 'archive_bytes']) {
    exact(
      browserRelayImageProfile.source[field],
      browserRelayImageV1Profile.source[field],
      `browser-relay-image/profile.json source.${field}`,
    );
    exact(
      browserRelayImageProfile.source[field],
      browserRelayImageV2Result.source[field],
      `browser-relay-image/result-v2.json source.${field}`,
    );
  }
  exact(
    browserRelayImageProfile.source.object_generation,
    browserRelayImageV1Result.source.object_generation,
    'browser-relay-image/profile.json source.object_generation',
  );
  exact(
    browserRelayImageProfile.source.object_generation,
    browserRelayImageV2Result.source.object_generation,
    'browser-relay-image/result-v2.json source.object_generation',
  );
  exact(
    browserRelayImageProfile.image.tag_reference,
    browserRelayImageV2Result.image.tag_reference,
    'browser-relay-image/result-v2.json image.tag_reference',
  );
  exact(
    browserRelayImageProfile.build.builder_image.split('@')[1],
    browserRelayImageV2Result.build.builder_digest,
    'browser-relay-image/result-v2.json build.builder_digest',
  );
  exact(
    relayServicesProfile.contracts.historical_profile_path,
    RELAY_SERVICES_V1_PROFILE_PATH,
    'browser-relay-services/profile.json contracts.historical_profile_path',
  );
  exact(
    relayServicesProfile.contracts.historical_profile_sha256,
    RELAY_SERVICES_V1_PROFILE_SHA256,
    'browser-relay-services/profile.json contracts.historical_profile_sha256',
  );
  exact(
    relayServicesProfile.contracts.digest_bound_profile_path,
    RELAY_SERVICES_V2_PROFILE_PATH,
    'browser-relay-services/profile.json contracts.digest_bound_profile_path',
  );
  exact(
    relayServicesProfile.contracts.digest_bound_profile_sha256,
    RELAY_SERVICES_V2_PROFILE_SHA256,
    'browser-relay-services/profile.json contracts.digest_bound_profile_sha256',
  );
  exact(
    relayServicesProfile.contracts.bootstrap_profile_path,
    RELAY_SERVICES_V3_PROFILE_PATH,
    'browser-relay-services/profile.json contracts.bootstrap_profile_path',
  );
  exact(
    relayServicesProfile.contracts.bootstrap_profile_sha256,
    RELAY_SERVICES_V3_PROFILE_SHA256,
    'browser-relay-services/profile.json contracts.bootstrap_profile_sha256',
  );
  exact(
    relayServicesProfile.contracts.memory_recovery_profile_path,
    RELAY_SERVICES_V4_PROFILE_PATH,
    'browser-relay-services/profile.json contracts.memory_recovery_profile_path',
  );
  exact(
    relayServicesProfile.contracts.memory_recovery_profile_sha256,
    RELAY_SERVICES_V4_PROFILE_SHA256,
    'browser-relay-services/profile.json contracts.memory_recovery_profile_sha256',
  );
  exact(
    relayServicesProfile.contracts.bootstrap_failure_path,
    RELAY_SERVICES_BOOTSTRAP_FAILURE_PATH,
    'browser-relay-services/profile.json contracts.bootstrap_failure_path',
  );
  exact(
    relayServicesProfile.contracts.bootstrap_failure_sha256,
    RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    'browser-relay-services/profile.json contracts.bootstrap_failure_sha256',
  );
  exact(
    relayServicesProfile.contracts.memory_recovery_failure_path,
    RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_PATH,
    'browser-relay-services/profile.json contracts.memory_recovery_failure_path',
  );
  exact(
    relayServicesProfile.contracts.memory_recovery_failure_sha256,
    RELAY_SERVICES_MEMORY_RECOVERY_FAILURE_SHA256,
    'browser-relay-services/profile.json contracts.memory_recovery_failure_sha256',
  );
  exact(
    relayServicesProfile.contracts.private_ready_profile_path,
    RELAY_SERVICES_V5_PROFILE_PATH,
    'browser-relay-services/profile.json contracts.private_ready_profile_path',
  );
  exact(
    relayServicesProfile.contracts.private_ready_profile_sha256,
    RELAY_SERVICES_V5_PROFILE_SHA256,
    'browser-relay-services/profile.json contracts.private_ready_profile_sha256',
  );
  exact(
    relayServicesProfile.contracts.private_ready_result_path,
    RELAY_SERVICES_PRIVATE_READY_RESULT_PATH,
    'browser-relay-services/profile.json contracts.private_ready_result_path',
  );
  exact(
    relayServicesProfile.contracts.private_ready_result_sha256,
    RELAY_SERVICES_PRIVATE_READY_RESULT_SHA256,
    'browser-relay-services/profile.json contracts.private_ready_result_sha256',
  );
  exact(
    relayServicesV3Profile.contracts.previous_profile_sha256,
    RELAY_SERVICES_V2_PROFILE_SHA256,
    'browser-relay-services/profile-v3.json contracts.previous_profile_sha256',
  );
  exact(
    relayServicesV4Profile.contracts.previous_profile_sha256,
    RELAY_SERVICES_V3_PROFILE_SHA256,
    'browser-relay-services/profile-v4.json contracts.previous_profile_sha256',
  );
  exact(
    relayServicesV4Profile.contracts.bootstrap_failure_sha256,
    RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
    'browser-relay-services/profile-v4.json contracts.bootstrap_failure_sha256',
  );
  exact(
    relayServicesBootstrapFailure.profile_sha256,
    RELAY_SERVICES_V3_PROFILE_SHA256,
    'browser-relay-services/bootstrap-failure-v1.json profile_sha256',
  );
  exact(
    relayServicesMemoryRecoveryFailure.profile_sha256,
    RELAY_SERVICES_V4_PROFILE_SHA256,
    'browser-relay-services/memory-recovery-failure-v1.json profile_sha256',
  );
  exact(
    relayServicesBootstrapFailure.claim.sha256,
    relayServicesProfile.operation.original_claim_sha256,
    'browser-relay-services/profile.json operation.original_claim_sha256',
  );
  exact(
    relayServicesMemoryRecoveryFailure.claim.sha256,
    relayServicesV5Profile.operation.memory_recovery_claim_sha256,
    'browser-relay-services/profile-v5.json operation.memory_recovery_claim_sha256',
  );
  exact(
    relayServicesMemoryRecoveryFailure.terraform_state.sha256,
    relayServicesV5Profile.operation.initial_state_sha256,
    'browser-relay-services/profile-v5.json operation.initial_state_sha256',
  );
  exact(
    relayServicesPrivateReadyResult.profile_sha256,
    RELAY_SERVICES_V5_PROFILE_SHA256,
    'browser-relay-services/private-ready-result-v1.json profile_sha256',
  );
  exact(
    relayServicesPrivateReadyResult.claim_sha256,
    relayServicesProfile.operation.claim_sha256,
    'browser-relay-services/profile.json operation.claim_sha256',
  );
  exact(
    relayServicesPrivateReadyResult.terraform_state_sha256,
    relayServicesProfile.operation.converged_state_sha256,
    'browser-relay-services/profile.json operation.converged_state_sha256',
  );
  exact(
    relayServicesV2Profile.contracts.relay_image_result_sha256,
    relayServicesProfile.contracts.relay_image_result_sha256,
    'browser-relay-services/profile-v2.json contracts.relay_image_result_sha256',
  );
  exact(
    relayServicesV2Profile.terraform_source_sha256,
    relayServicesV4Profile.terraform_source_sha256,
    'browser-relay-services/profile-v2.json and profile-v4.json terraform_source_sha256',
  );
  exact(
    relayServicesProfile.contracts.relay_image_result_path,
    RELAY_IMAGE_V2_RESULT_PATH,
    'browser-relay-services/profile.json contracts.relay_image_result_path',
  );
  exact(
    relayServicesProfile.contracts.relay_image_result_sha256,
    RELAY_IMAGE_V2_RESULT_SHA256,
    'browser-relay-services/profile.json contracts.relay_image_result_sha256',
  );
  exact(
    relayServicesProfile.pins.miakapp_server_commit,
    browserRelayImageV2Result.source.commit,
    'browser-relay-services/profile.json pins.miakapp_server_commit',
  );
  for (const field of ['digest', 'digest_reference', 'config_digest']) {
    exact(
      relayServicesProfile.image[field],
      browserRelayImageV2Result.image[field],
      `browser-relay-services/profile.json image.${field}`,
    );
  }
  exact(
    relayServicesProfile.image.source_archive_sha256,
    browserRelayImageV2Result.source.archive_sha256,
    'browser-relay-services/profile.json image.source_archive_sha256',
  );
  exact(
    relayServicesProfile.image.source_object_generation,
    browserRelayImageV2Result.source.object_generation,
    'browser-relay-services/profile.json image.source_object_generation',
  );
  exact(
    relayServicesProfile.image.build_id,
    browserRelayImageV2Result.build.id,
    'browser-relay-services/profile.json image.build_id',
  );
  if (browserRelayImageProfile.operation.claim_object
      === browserRelayImageV1Profile.operation.claim_object
    || browserRelayImageProfile.build.build_tag === browserRelayImageV1Profile.build.build_tag
    || browserRelayImageProfile.image.tag_reference
      === browserRelayImageV1Profile.image.tag_reference) {
    reject(
      'browser-relay-image/profile.json',
      'v2 claim, build tag and image tag must all differ from v1',
    );
  }
  exact(
    browserRelayImageProfile.prerequisites.foundation_state_generation,
    manifest.evidence.foundation_container_analysis_adoption.state_after.generation,
    'browser-relay-image/profile.json prerequisites.foundation_state_generation',
  );
  exact(
    browserRelayImageProfile.prerequisites.foundation_state_sha256,
    manifest.evidence.foundation_container_analysis_adoption.state_after.sha256,
    'browser-relay-image/profile.json prerequisites.foundation_state_sha256',
  );
  const browserAppCheckManifest = manifest.evidence.browser_app_check_prerequisite;
  const browserAppCheckPath = committedEvidencePath(
    stagingRoot,
    browserAppCheckManifest.result_path,
    'browser-app-check/result.json',
    'evidence.browser_app_check_prerequisite.result_path',
  );
  const browserAppCheck = validatedEvidenceFile(
    browserAppCheckPath,
    validateBrowserAppCheckEvidence,
    'evidence.browser_app_check_prerequisite.result_path',
  );
  exact(
    fileSha256(browserAppCheckPath),
    browserAppCheckManifest.result_sha256,
    'evidence.browser_app_check_prerequisite.result_sha256',
  );
  exactFields(browserAppCheckManifest, {
    repository_commit: browserAppCheck.repository_commit,
    terraform_plan_sha256: browserAppCheck.terraform_plan_sha256,
    baseline_sha256: browserAppCheck.baseline_sha256,
    terraform_apply_reported_success: browserAppCheck.terraform_apply_reported_success,
    state_recovery: browserAppCheck.state_recovery,
    final_inventory_sha256: browserAppCheck.final_inventory_sha256,
    recaptcha_api_enabled: browserAppCheck.recaptcha_api_enabled,
    authoritative_recaptcha_keys: browserAppCheck.authoritative_recaptcha_keys,
    cloud_asset_recaptcha_keys: browserAppCheck.cloud_asset_recaptcha_keys,
    app_check_enforcement_records: browserAppCheck.app_check_enforcement_records,
    debug_tokens: browserAppCheck.debug_tokens,
    public_site_key_committed: browserAppCheck.public_site_key_committed,
    raw_provider_config_committed: browserAppCheck.raw_provider_config_committed,
    legacy_secret_retrievals_by_driver: browserAppCheck.legacy_secret_retrievals_by_driver,
    public_endpoints_created: browserAppCheck.public_endpoints_created,
    fixed_cost_services: browserAppCheck.fixed_cost_services,
    coordination_objects_created: browserAppCheck.coordination_objects_created,
    browser_requests_initiated_by_driver:
      browserAppCheck.browser_requests_initiated_by_driver,
    assessments_initiated_by_driver: browserAppCheck.assessments_initiated_by_driver,
  }, 'evidence.browser_app_check_prerequisite');
  exactFields(
    browserAppCheckManifest.global_key_attempt_claim,
    browserAppCheck.global_key_attempt_claim,
    'evidence.browser_app_check_prerequisite.global_key_attempt_claim',
  );
  exactFields(
    browserAppCheckManifest.global_registration_attempt_claim,
    browserAppCheck.global_registration_attempt_claim,
    'evidence.browser_app_check_prerequisite.global_registration_attempt_claim',
  );
  exactFields(
    browserAppCheckManifest.global_provider_attempt_claim,
    browserAppCheck.global_provider_attempt_claim,
    'evidence.browser_app_check_prerequisite.global_provider_attempt_claim',
  );
  exactFields(
    browserAppCheckManifest.terraform_state,
    browserAppCheck.terraform_state,
    'evidence.browser_app_check_prerequisite.terraform_state',
  );
  exactFields(browserAppCheckManifest.recaptcha_key, {
    name_sha256: browserAppCheck.recaptcha_key.name_sha256,
    display_name: browserAppCheck.recaptcha_key.display_name,
    create_time: browserAppCheck.recaptcha_key.create_time,
    integration_type: browserAppCheck.recaptcha_key.integration_type,
    allow_all_domains: browserAppCheck.recaptcha_key.allow_all_domains,
    allowed_domain_includes_subdomains:
      browserAppCheck.recaptcha_key.allowed_domain_includes_subdomains,
    allow_amp_traffic: browserAppCheck.recaptcha_key.allow_amp_traffic,
    testing_options_configured: browserAppCheck.recaptcha_key.testing_options_configured,
    waf_settings_configured: browserAppCheck.recaptcha_key.waf_settings_configured,
  }, 'evidence.browser_app_check_prerequisite.recaptcha_key');
  exactFields(
    browserAppCheckManifest.recaptcha_key.labels,
    browserAppCheck.recaptcha_key.labels,
    'evidence.browser_app_check_prerequisite.recaptcha_key.labels',
  );
  exactArray(
    browserAppCheckManifest.recaptcha_key.allowed_domains,
    browserAppCheck.recaptcha_key.allowed_domains,
    'evidence.browser_app_check_prerequisite.recaptcha_key.allowed_domains',
  );
  exactFields(
    browserAppCheckManifest.app_check_provider,
    browserAppCheck.app_check_provider,
    'evidence.browser_app_check_prerequisite.app_check_provider',
  );
  const browserAttestationManifest = manifest.evidence.browser_app_check_attestation;
  const browserAttestationPath = committedEvidencePath(
    stagingRoot,
    browserAttestationManifest.result_path,
    'browser-attestation/preflight-v6-result.json',
    'evidence.browser_app_check_attestation.result_path',
  );
  const browserAttestation = validatedEvidenceFile(
    browserAttestationPath,
    validatePreflightEvidence,
    'evidence.browser_app_check_attestation.result_path',
  );
  exact(
    fileSha256(browserAttestationPath),
    browserAttestationManifest.result_sha256,
    'evidence.browser_app_check_attestation.result_sha256',
  );
  exact(
    browserAttestation.state,
    'provider_token_obtained_after_verified_publication',
    'evidence.browser_app_check_attestation.state',
  );
  exactFields(browserAttestationManifest, {
    observed_at: browserAttestation.completed_at,
    repository_commit: browserAttestation.repository_commit,
    firebase_sdk_version: browserAttestation.firebase_sdk_version,
    firebase_app_id: browserAttestation.app_check.firebase_app_id,
    browser_session: browserAttestation.browser.session,
    browser_invocations: browserAttestation.browser.invocations,
    loopback_observations: browserAttestation.browser.loopback_observations,
    force_refresh_requested: browserAttestation.app_check.force_refresh_requested,
    provider_token_obtained: browserAttestation.app_check.provider_token_obtained,
    jwt_shape_validated: browserAttestation.browser.jwt_three_segments_validated,
    configured_token_ttl: browserAttestation.app_check.configured_token_ttl,
    hosting_version_status: browserAttestation.hosting.version_status,
    hosting_releases_created: browserAttestation.hosting.releases_created,
    hosting_site_disabled: browserAttestation.hosting.site_disabled,
    runner_http_status_after_cleanup:
      browserAttestation.hosting.runner_http_status_after_cleanup,
    public_window_milliseconds: browserAttestation.hosting.public_window_milliseconds,
    app_check_enforcement_records: browserAttestation.app_check.enforcement_records,
    debug_tokens: browserAttestation.app_check.debug_tokens,
    firebase_auth_used: browserAttestation.firebase_auth_used,
    control_plane_invoked: browserAttestation.control_plane_invoked,
    app_check_token_committed: browserAttestation.credential_material_committed,
    raw_browser_error_committed: browserAttestation.browser.raw_browser_error_retained,
    entrypoints_retired: browserAttestation.entrypoints_retired,
  }, 'evidence.browser_app_check_attestation');
  exactFields(browserAttestationManifest.operation_claim, {
    object: browserAttestation.operation_claim.object,
    generation: browserAttestation.operation_claim.generation,
    size_bytes: browserAttestation.operation_claim.size_bytes,
    sha256: browserAttestation.operation_claim.sha256,
    retry_authorized: browserAttestation.operation_claim.retry_authorized,
    deletion_authorized: browserAttestation.operation_claim.deletion_authorized,
  }, 'evidence.browser_app_check_attestation.operation_claim');
  exactFields(browserAttestationManifest.local_post_validation, {
    state: 'rejected_after_provider_success',
    stage: browserAttestation.browser.local_failure_stage,
    code: browserAttestation.browser.local_failure_code,
    cause: browserAttestation.browser.local_failure_cause,
  }, 'evidence.browser_app_check_attestation.local_post_validation');
  exact(
    browserAttestation.app_check.real_browser_attestation,
    true,
    'evidence.browser_app_check_attestation.provider_token_obtained',
  );
  exact(
    browserAttestation.browser.app_check_token_retained,
    false,
    'evidence.browser_app_check_attestation.app_check_token_committed',
  );
  exact(
    browserAttestationManifest.firebase_app_id,
    browserAppCheckManifest.app_check_provider.firebase_app_id,
    'evidence.browser_app_check_attestation.firebase_app_id',
  );
  exact(
    browserAttestationManifest.configured_token_ttl,
    browserAppCheckManifest.app_check_provider.token_ttl,
    'evidence.browser_app_check_attestation.configured_token_ttl',
  );
  const signingOverlapManifest = manifest.evidence.signing_key_overlap_prerequisite;
  const signingOverlapPath = committedEvidencePath(
    stagingRoot,
    signingOverlapManifest.result_path,
    'signing-overlap/result.json',
    'evidence.signing_key_overlap_prerequisite.result_path',
  );
  const signingOverlap = validatedEvidenceFile(
    signingOverlapPath,
    validateSigningOverlapEvidence,
    'evidence.signing_key_overlap_prerequisite.result_path',
  );
  exact(
    fileSha256(signingOverlapPath),
    signingOverlapManifest.result_sha256,
    'evidence.signing_key_overlap_prerequisite.result_sha256',
  );
  exactFields(signingOverlapManifest, {
    observed_at: signingOverlap.created_version.generate_time,
    repository_commit: signingOverlap.repository_commit,
    reviewed_plan_sha256: signingOverlap.reviewed_plan_sha256,
    plan_metadata_sha256: signingOverlap.plan_metadata_sha256,
    baseline_sha256: signingOverlap.baseline_sha256,
    final_inventory_sha256: signingOverlap.final_inventory_sha256,
    created_version_name: signingOverlap.created_version.name,
    created_version: signingOverlap.created_version.version,
    created_version_state: signingOverlap.created_version.state,
    created_version_algorithm: signingOverlap.created_version.algorithm,
    created_version_protection_level: signingOverlap.created_version.protection_level,
    created_public_jwk_sha256: createHash('sha256')
      .update(`${JSON.stringify(signingOverlap.created_version.public_jwk, null, 2)}\n`)
      .digest('hex'),
    kms_version_creations: signingOverlap.kms_version_creations,
    coordination_objects_created: signingOverlap.coordination_objects_created,
    runtime_changed: signingOverlap.runtime_changed,
    terraform_state_changed: signingOverlap.terraform_state_changed,
    existing_version_changed: signingOverlap.existing_version_changed,
    public_ingress_changed: signingOverlap.public_ingress_changed,
    live_requests_performed: signingOverlap.live_requests_performed,
    signatures_performed: signingOverlap.signatures_performed,
    automatic_retry_performed: signingOverlap.automatic_retry_performed,
    private_bundle_committed: signingOverlap.private_bundle_committed,
    credential_material_committed: signingOverlap.credential_material_committed,
  }, 'evidence.signing_key_overlap_prerequisite');
  exactArray(
    signingOverlapManifest.enabled_versions,
    manifest.security.kms.enabled_versions,
    'evidence.signing_key_overlap_prerequisite.enabled_versions',
  );
  exact(
    manifest.runtime.published_signing_keys,
    manifest.security.kms.runtime_published_versions.length,
    'runtime.published_signing_keys',
  );
  exact(
    manifest.runtime.current_signing_key_version,
    manifest.security.kms.current_runtime_version,
    'runtime.current_signing_key_version',
  );
  exact(manifest.runtime.live_request_performed, false, 'runtime.live_request_performed');
  return Object.freeze({
    workload,
    probe,
    firebaseAuth,
    userRelayProbe: authProbe,
    userRelayProbeRetirement: authProbeRetirement,
    browserRelayPlan,
    browserRelayV11Plan,
    browserRelayV12Plan,
    browserRelayV13Plan,
    browserRelayV14Plan,
    browserRelayRunnerProfile,
    browserRelayPageProfile,
    browserRelayPageV2Profile,
    browserRelayAggregatorProfile,
    browserRelayPageReceiptProfile,
    browserRelayScenarioFixtureCloudProfile,
    browserRelayRollbackProfile,
    browserRelayRollbackResult,
    browserRelayOrchestratorProfile,
    browserRelayOrchestratorResult,
    browserRelayOperationProfile,
    browserRelayOperationResult,
    relayServicesProfile,
    relayServicesV1Profile,
    relayServicesV2Profile,
    relayServicesV3Profile,
    relayServicesV4Profile,
    relayServicesV5Profile,
    relayServicesBootstrapFailure,
    relayServicesMemoryRecoveryFailure,
    relayServicesPrivateReadyResult,
    browserRelayImageProfile,
    browserRelayImageV1Profile,
    browserRelayImageV1Result,
    browserRelayImageV2Result,
    browserAppCheck,
    browserAttestation,
    signingOverlap,
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
        `Validated ${manifest.schema} for ${manifest.project.project_id}; the dormant page, two-identity scenario fixture, replacement-identity cloud adapter, independent-source aggregator and browser-page receipt producer are digest-pinned without live authority, the single-use operation remains privately preflighted and unexecuted, both exact-audience relays remain private-ready, unauthenticated invocation remains absent, and App Check enforcement is disabled.\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      process.stderr.write(`Staging manifest rejected: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
