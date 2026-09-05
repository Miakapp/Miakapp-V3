import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  StagingManifestError,
  validateCommittedEvidence,
  validateFirebaseRc,
  validateStagingManifest,
} from '../validate.mjs';

const manifestFixture = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const firebaseRcFixture = JSON.parse(readFileSync(new URL('../../../.firebaserc', import.meta.url), 'utf8'));

function manifest() {
  return structuredClone(manifestFixture);
}

function firebaseRc() {
  return structuredClone(firebaseRcFixture);
}

function rejects(mutator, pattern) {
  const candidate = manifest();
  mutator(candidate);
  assert.throws(
    () => validateStagingManifest(candidate),
    (error) => error instanceof StagingManifestError && pattern.test(error.message),
  );
}

test('accepts the successful and retired private user-relay probe', () => {
  const validated = validateStagingManifest(manifest());
  assert.equal(validated.revision, 56);
  assert.equal(
    validated.status,
    'private_control_plane_two_key_version_2_current_runtime_deployed_signing_overlap_active_user_relay_acceptance_succeeded_system_browser_app_check_attestation_succeeded_browser_relay_plan_rebased_enforcement_disabled',
  );
  assert.equal(validated.project.project_id, 'miakapp-v4-staging');
  assert.equal(validated.project.project_number, '1072737219170');
  assert.equal(
    validated.project.lifecycle,
    'firebase_auth_initialized_private_control_plane_signing_key_version_2_current_user_relay_acceptance_succeeded',
  );
  assert.equal(validated.bootstrap.billing_enabled, true);
  assert.equal(validated.bootstrap.firebase_apps, 1);
  assert.equal(validated.bootstrap.hosting_site, 'miakapp-v4-staging');
  assert.deepEqual(validated.bootstrap.storage_buckets, [
    'miakapp-v4-staging-components',
    'miakapp-v4-staging-tfstate-1072737219170',
  ]);
  assert.deepEqual(validated.bootstrap.firestore_databases, ['(default)']);
  assert.deepEqual(validated.bootstrap.workload_identity_provider_states, {
    'staging-apply': 'disabled',
    'staging-plan': 'disabled',
  });
  assert.equal(validated.bootstrap.kms_key_rings.length, 1);
  assert.deepEqual(validated.bootstrap.secrets, [
    'miakapp-audit-hmac',
    'miakapp-component-hmac',
    'miakapp-home-key-pepper',
    'miakapp-network-hmac',
    'miakapp-push-hmac',
  ]);
  assert.equal(
    validated.security.kms.state,
    'two_versions_enabled_runtime_both_published_version_2_current',
  );
  assert.deepEqual(validated.security.kms.enabled_versions, [1, 2]);
  assert.deepEqual(validated.security.kms.runtime_published_versions, [1, 2]);
  assert.equal(validated.security.kms.current_runtime_version, 2);
  assert.equal(
    validated.security.secrets.every((secret) => (
      secret.state === 'initial_version_1_enabled'
      && secret.version_policy_state === 'initialized_rotation_not_implemented'
      && JSON.stringify(secret.enabled_versions) === '[1]'
    )),
    true,
  );
  assert.deepEqual(validated.services.map(({ state }) => state), [
    'initialized_closed_custom_token_lifecycle_validated',
    'admin_custom_provider_and_system_browser_attestation_validated_enforcement_disabled',
    'private_fixture_lifecycle_validated_no_persistent_application_data',
    'private_schema_2_two_key_version_2_current_runtime_active_user_relay_acceptance_succeeded',
    'private_bucket_created_no_application_mutation',
    'two_signing_key_versions_enabled_runtime_two_keys_published_version_2_current',
    'five_initial_versions_enabled_runtime_access_validated',
    'api_enabled_one_permission_runtime_role_applied_uninvoked',
    'api_enabled_runtime_deployed_no_application_log_validation',
    'api_enabled_runtime_deployed_no_metric_validation',
    'api_enabled_user_relay_probe_succeeded_and_retired',
  ]);
  assert.equal(
    validated.security.iam.foundation_resource_bindings_state,
    'complete_eight_recovery_bindings_present',
  );
  assert.equal(validated.locations.primary, 'europe-west9');
  assert.equal(validated.locations.immutable_choice_reviewed, true);
  assert.equal(validated.cost.billing_account.selection_state, 'approved');
  assert.equal(validated.cost.billing_account.link_state, 'linked_to_approved_account');
  assert.equal(
    validated.cost.billing_account.terraform_management_state,
    'managed_in_reconciled_remote_bootstrap_state',
  );
  assert.equal(validated.runtime.deployment_state, 'ACTIVE');
  assert.equal(validated.runtime.revision, 'control-plane-00008-saz');
  assert.equal(validated.runtime.runtime_schema, 'miakapp.production-runtime/2');
  assert.equal(validated.runtime.security_schema, 'miakapp.production-security/2');
  assert.equal(validated.runtime.published_signing_keys, 2);
  assert.equal(validated.runtime.current_signing_key_version, 2);
  assert.equal(validated.runtime.ingress, 'ALLOW_INTERNAL_ONLY');
  assert.equal(validated.runtime.user_managed_keys, 0);
  assert.equal(validated.runtime.live_request_performed, false);
  assert.equal(
    validated.security.iam.runtime_identity_state,
    'private_runtime_deployed_zero_user_managed_keys',
  );
  assert.deepEqual(validated.security.iam.unresolved_permissions, []);
  assert.equal(
    validated.terraform.state,
    'all_seven_roots_converged_browser_app_check_provider_registered',
  );
  assert.equal(
    validated.terraform.supported_workflow,
    'guarded_private_saved_plans_applied_and_converged',
  );
  assert.equal(validated.terraform.configuration_apply_capable, true);
  assert.equal(validated.terraform.active_cloud_workflow, 'unscheduled_private_probe_retained');
  assert.equal(
    validated.terraform.workflow_blueprint_state,
    'retired_recovery_blueprint_retained_as_evidence',
  );
  assert.equal(validated.terraform.backend.type, 'gcs');
  assert.equal(validated.terraform.probe_root, 'probe');
  assert.equal(validated.terraform.firebase_auth_root, 'firebase-auth');
  assert.equal(validated.terraform.auth_probe_root, 'auth-probe');
  assert.equal(validated.terraform.browser_app_check_root, 'browser-app-check');
  assert.equal(
    validated.terraform.backend.state,
    'all_seven_terraform_state_roots_present',
  );
  assert.equal(validated.terraform.backend.probe_prefix, 'terraform/probe');
  assert.equal(validated.terraform.backend.firebase_auth_prefix, 'terraform/firebase-auth');
  assert.equal(validated.terraform.backend.auth_probe_prefix, 'terraform/auth-probe');
  assert.equal(
    validated.terraform.backend.browser_app_check_prefix,
    'terraform/browser-app-check',
  );
  assert.equal(
    validated.terraform.backend.bootstrap_migration_state,
    'complete_remote_state_reconciled',
  );
  assert.equal(
    validated.terraform.identity.state,
    'planner_and_deployer_exercised_recovery_wif_providers_disabled',
  );
  assert.equal(validated.terraform.identity.workload_identity_pool_state, 'enabled_retained');
  assert.equal(validated.terraform.identity.plan_provider_state, 'disabled');
  assert.equal(validated.terraform.identity.apply_provider_state, 'disabled');
  assert.equal(validated.terraform.identity.reviewed_github_oidc_exchange_allowed, false);
  assert.equal(
    validated.terraform.identity.runtime_service_account,
    'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
  );
  assert.equal(validated.terraform.identity.component_bucket, 'miakapp-v4-staging-components');
  assert.equal(validated.terraform.identity.service_account_keys_allowed, false);
  assert.equal(validated.terraform.identity.bootstrap_state_write_allowed, false);
  assert.equal(validated.terraform.identity.planner_service_usage_consumer_allowed, true);
  assert.equal(
    validated.terraform.identity.planner_service_usage_consumer_state,
    'managed_in_reconciled_remote_bootstrap_state',
  );
  assert.equal(validated.terraform.identity.deployer_project_iam_mutation_allowed, false);
  assert.equal(validated.terraform.identity.deployer_service_account_administration_allowed, false);
  assert.equal(validated.terraform.identity.deployer_project_wide_storage_administration_allowed, false);
  assert.equal(validated.terraform.identity.deployer_component_bucket_administration_allowed, true);
  assert.equal(validated.terraform.identity.planner_initial_foundation_state_creation_allowed, false);
  assert.equal(validated.terraform.identity.planner_foundation_state_replacement_allowed, false);
  assert.equal(validated.terraform.identity.planner_foundation_lock_administration_allowed, true);
  assert.equal(validated.terraform.identity.deployer_foundation_state_replacement_allowed, true);
  assert.deepEqual(validated.terraform.identity.planner_write_prefixes, ['terraform/foundation/*.tflock', 'plans/']);
  assert.deepEqual(validated.terraform.identity.deployer_write_prefixes, ['terraform/foundation/']);
  assert.equal(
    validated.terraform.saved_plan.state,
    'consumed_recovery_plan_soft_deleted_recoverable',
  );
  assert.equal(validated.terraform.saved_plan.public_artifacts_allowed, false);
  const execution = validated.terraform.bootstrap_execution;
  assert.equal(
    execution.state,
    'bootstrap_complete_state_reconciled_planner_role_adopted_and_recovery_wif_disabled',
  );
  assert.equal(
    execution.approved_configuration_commit,
    'e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501',
  );
  assert.equal(
    execution.approved_plan_sha256,
    '12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da',
  );
  assert.equal(execution.budget_preflight_requires_quota_project, true);
  assert.equal(execution.authorized_plan_attempted, true);
  assert.equal(execution.bootstrap_completed, true);
  assert.equal(execution.recovery_state.state, 'preserved_private_complete_local');
  assert.equal(
    execution.recovery_state.sha256,
    'c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2',
  );
  assert.equal(execution.recovery_state.serial, 39);
  assert.equal(execution.recovery_state.managed_resources, 36);
  assert.equal(execution.recovery_state.managed_addresses.length, 36);
  assert.equal(execution.recovery_state.path_committed, false);
  assert.equal(execution.recovery_state.raw_contents_committed, false);
  assert.equal(
    execution.remote_state.state,
    'migrated_reconciled_planner_role_adopted_and_recovery_wif_disabled',
  );
  assert.equal(execution.remote_state.generation, '1788460174191027');
  assert.equal(
    execution.remote_state.sha256,
    '288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d',
  );
  assert.equal(execution.remote_state.size_bytes, 61864);
  assert.equal(execution.remote_state.serial, 42);
  assert.equal(execution.remote_state.managed_resources, 37);
  assert.equal(execution.remote_state.data_resources, 2);
  assert.equal(execution.remote_state.outputs, 1);
  assert.equal(execution.remote_state.initial_migration_reconciliation.serial, 40);
  assert.equal(execution.remote_state.initial_migration_reconciliation.managed_resources, 36);
  assert.equal(execution.remote_state.initial_migration_reconciliation.canonical_serial_increment, 1);
  assert.equal(execution.remote_state.initial_migration_reconciliation.check_results_exact_permutation, true);
  assert.equal(execution.remote_state.initial_migration_reconciliation.remainder_exactly_equal, true);
  assert.equal(
    execution.remote_state.initialization_generation.state,
    'noncurrent_recoverable_empty_state',
  );
  assert.equal(execution.remote_state.initialization_generation.size_bytes, 181);
  assert.equal(execution.remote_state.initialization_generation.managed_resources, 0);
  assert.equal(execution.remote_state.raw_contents_committed, false);
  const plannerAdoption = execution.planner_role_adoption_observation;
  assert.equal(plannerAdoption.configuration_commit, 'c5ff539af5598f4cc91eef9753ff90bfa5502974');
  assert.equal(
    plannerAdoption.import_address,
    'google_project_iam_member.planner["roles/serviceusage.serviceUsageConsumer"]',
  );
  assert.equal(
    plannerAdoption.private_plan_sha256,
    '0bab71811fa5dc8d084c47e3938accb8cf4421da4264edb8665bee1989895d6f',
  );
  assert.deepEqual(plannerAdoption.result, {
    import: 1, add: 0, change: 0, destroy: 0,
  });
  assert.equal(plannerAdoption.state_before.serial, 40);
  assert.equal(plannerAdoption.state_before.managed_resources, 36);
  assert.equal(plannerAdoption.state_after.serial, 41);
  assert.equal(plannerAdoption.state_after.managed_resources, 37);
  assert.equal(plannerAdoption.project_iam_etag_before, 'BwZalzR1TWY=');
  assert.equal(plannerAdoption.project_iam_etag_after, 'BwZalzR1TWY=');
  assert.equal(plannerAdoption.project_iam_unchanged, true);
  assert.equal(plannerAdoption.set_iam_policy_audit_entries, 0);
  assert.equal(plannerAdoption.state_remainder_exactly_equal, true);
  assert.equal(plannerAdoption.follow_up_plan_result, 'no_changes');
  assert.equal(plannerAdoption.temporary_lock_released, true);
  assert.equal(plannerAdoption.raw_plan_committed, false);
  assert.equal(plannerAdoption.raw_state_committed, false);
  const federationRetirement = execution.recovery_federation_retirement_observation;
  assert.equal(
    federationRetirement.configuration_commit,
    'ee457535a64355cd8133410d9c8c43f039608928',
  );
  assert.equal(
    federationRetirement.private_plan_sha256,
    '8f570dfe5450b704112d484f058fc6dfcd39069a92c8bb483c5029027183e888',
  );
  assert.deepEqual(federationRetirement.plan_result, {
    no_op: 35,
    import: 0,
    add: 0,
    change: 2,
    destroy: 0,
  });
  assert.deepEqual(federationRetirement.changes, [
    {
      address: 'google_iam_workload_identity_pool_provider.apply',
      attribute: 'disabled',
      before: false,
      after: true,
    },
    {
      address: 'google_iam_workload_identity_pool_provider.plan',
      attribute: 'disabled',
      before: false,
      after: true,
    },
  ]);
  assert.equal(federationRetirement.only_disabled_attribute_changed, true);
  assert.equal(federationRetirement.workload_identity_pool_state_after, 'enabled_retained');
  assert.equal(federationRetirement.apply_completed, true);
  assert.deepEqual(federationRetirement.apply_result, { add: 0, change: 2, destroy: 0 });
  assert.equal(federationRetirement.state_before.serial, 41);
  assert.equal(federationRetirement.state_after.serial, 42);
  assert.equal(federationRetirement.state_after.managed_resources, 37);
  assert.equal(federationRetirement.state_lineage_unchanged, true);
  assert.equal(federationRetirement.project_iam_unchanged, true);
  assert.equal(federationRetirement.planner_service_account_iam_unchanged, true);
  assert.equal(federationRetirement.deployer_service_account_iam_unchanged, true);
  assert.equal(federationRetirement.follow_up_plan_result, 'no_changes');
  assert.equal(federationRetirement.temporary_lock_released, true);
  assert.equal(federationRetirement.raw_plan_committed, false);
  assert.equal(federationRetirement.raw_state_committed, false);
  assert.equal(execution.attempts.length, 3);
  assert.equal(execution.attempts[2].execution_commit, 'cbd8b63062b027eca762b0d23f234563760f846a');
  assert.equal(execution.attempts[2].managed_resources_recorded, 36);
  assert.equal(execution.attempts[2].enabled_bootstrap_apis_recorded, 8);
  assert.equal(execution.attempts[2].remote_state_migrated, false);
  assert.equal(execution.migration_attempts.length, 2);
  assert.equal(
    execution.migration_attempts[1].execution_commit,
    '107bb23e8b546aca283105f4a9584343985576f6',
  );
  assert.equal(execution.migration_attempts[1].remote_state_migrated, true);
  const initialization = validated.terraform.foundation_state_initialization;
  assert.equal(initialization.state, 'initialized_and_reconciled');
  assert.equal(initialization.script, 'terraform/initialize-state.sh');
  assert.equal(initialization.helper, 'terraform/foundation-state.mjs');
  assert.equal(
    initialization.approved_foundation_configuration_commit,
    'efa877835dde2f5eedc3d950b2e4c514e606751d',
  );
  assert.equal(
    initialization.approved_initialization_configuration_commit,
    '626dc16637ba843f6d1543156aba99e7b551e705',
  );
  assert.equal(initialization.authorization_bootstrap_generation, '1788439334043522');
  assert.equal(initialization.expected_bootstrap_state.serial, 40);
  assert.equal(initialization.expected_bootstrap_state.managed_resources, 36);
  assert.equal(initialization.observed_foundation_state.generation, '1788443136082489');
  assert.equal(
    initialization.observed_foundation_state.sha256,
    '8a69b37495a7d11b1091a03e7659297adcb62ce853475ab032071888530e30cd',
  );
  assert.equal(initialization.observed_foundation_state.size_bytes, 181);
  assert.equal(
    initialization.observed_foundation_state.lineage_sha256,
    '113390906103bdbefa4bac8b5d9549f7d867c38e8e9c4bef989977a12222c7d4',
  );
  assert.equal(initialization.observed_foundation_state.serial, 1);
  assert.equal(initialization.observed_foundation_state.managed_resources, 0);
  assert.equal(initialization.initialization_method, 'terraform_init_gcs_backend');
  assert.equal(initialization.backend_initialization_state_write_expected, true);
  assert.equal(
    initialization.post_initialization_plan.execution_commit,
    '2a612d62f16dbed4c05a677c1b7d43c00ed4e46f',
  );
  assert.equal(
    initialization.post_initialization_plan.validated_with_implementation_commit,
    '626dc16637ba843f6d1543156aba99e7b551e705',
  );
  assert.equal(
    initialization.post_initialization_plan.sha256,
    '5ef77e9f2107ea3a7b20b7c6dce865c6553cba51396e64e169a4418bb0e93859',
  );
  assert.deepEqual(initialization.post_initialization_plan.implicit_providers, [
    'registry.terraform.io/hashicorp/google@8.1.0',
    'registry.terraform.io/hashicorp/google-beta@8.1.0',
  ]);
  assert.equal(initialization.post_initialization_plan.applyable, false);
  assert.equal(initialization.post_initialization_plan.apply_executed, false);
  assert.equal(initialization.refresh_only_saved_plan_required, true);
  assert.equal(initialization.saved_plan_fingerprint_required, true);
  assert.equal(initialization.saved_plan_apply_allowed, false);
  assert.equal(initialization.temporary_lock_object_lifecycle_required, true);
  assert.equal(initialization.manual_state_push_allowed, false);
  assert.equal(initialization.overwrite_existing_state_allowed, false);
  assert.equal(initialization.final_generation_recheck_required, true);
  assert.equal(initialization.initialization_authorized, false);
  assert.equal(initialization.initialization_executed, true);
  assert.equal(initialization.reconciliation_executed, true);
  assert.equal(initialization.attempts.length, 2);
  assert.equal(initialization.attempts[0].state_reconciled, false);
  assert.equal(initialization.attempts[0].plan_applied, false);
  assert.equal(
    initialization.attempts[1].execution_commit,
    'ab6f26bd5dd076a79847f989615e7fddf93f2a07',
  );
  assert.equal(initialization.attempts[1].state_reconciled, true);
  assert.equal(initialization.attempts[1].plan_applied, false);
  const foundationPlan = validated.terraform.foundation_live_plan_observation;
  assert.equal(foundationPlan.configuration_commit, '363d017ebdc85af1285e38c5742365fd0a2a4395');
  assert.deepEqual(foundationPlan.result, { create: 33, update: 0, delete: 0 });
  assert.equal(foundationPlan.data_reads, 2);
  assert.deepEqual(foundationPlan.resource_counts, {
    bootstrap_guard: 1,
    service_apis: 13,
    firestore_database: 1,
    firestore_ttl_fields: 3,
    kms_key_ring_and_key: 2,
    kms_iam_bindings: 1,
    secret_containers: 5,
    secret_iam_bindings: 5,
    component_bucket_iam_bindings: 2,
  });
  assert.equal(foundationPlan.contains_workload, false);
  assert.equal(foundationPlan.contains_public_ingress, false);
  assert.equal(foundationPlan.contains_secret_versions, false);
  assert.equal(foundationPlan.contains_billing_resource, false);
  const savedFoundationPlan = validated.terraform.foundation_saved_plan_observation;
  assert.equal(savedFoundationPlan.workflow_run_id, '33774848684');
  assert.equal(savedFoundationPlan.configuration_commit, '66869a3564788ba725049cc91326b17eb239ddaf');
  assert.equal(
    savedFoundationPlan.plan_sha256,
    '5def42ea3f598a5f2c59d9456814646c1b526526c6b96acf20a0db7626bc36da',
  );
  assert.deepEqual(savedFoundationPlan.result, { create: 33, update: 0, delete: 0 });
  assert.equal(savedFoundationPlan.saved_plan_created, true);
  assert.equal(savedFoundationPlan.saved_plan_private, true);
  assert.equal(savedFoundationPlan.strict_validation_profile, 'initial-foundation');
  assert.equal(savedFoundationPlan.strict_validation_passed, true);
  assert.equal(savedFoundationPlan.apply_executed, false);
  assert.equal(savedFoundationPlan.state_unchanged, true);
  assert.equal(foundationPlan.saved_plan_created, false);
  assert.equal(foundationPlan.apply_executed, false);
  assert.equal(foundationPlan.state_generation_before, '1788443136082489');
  assert.equal(foundationPlan.state_generation_after, '1788443136082489');
  assert.equal(foundationPlan.state_unchanged, true);
  assert.equal(foundationPlan.temporary_lock_released, true);
  assert.equal(foundationPlan.full_plan_reviewed, true);
  assert.equal(foundationPlan.raw_planned_values_committed, false);
  const foundationApply = validated.terraform.foundation_apply_observation;
  assert.equal(foundationApply.workflow_run_id, '33776569977');
  assert.equal(foundationApply.workflow_result, 'failure');
  assert.equal(foundationApply.environment_approval, 'approved');
  assert.equal(foundationApply.strict_validation_profile, 'initial-foundation');
  assert.equal(foundationApply.strict_validation_passed, true);
  assert.deepEqual(foundationApply.requested_result, { create: 33, update: 0, delete: 0 });
  assert.equal(foundationApply.apply_attempted, true);
  assert.equal(foundationApply.apply_completed, false);
  assert.equal(foundationApply.failure_cause_known, false);
  assert.equal(foundationApply.detailed_apply_log_retained, false);
  assert.equal(foundationApply.state_before.serial, 1);
  assert.equal(foundationApply.state_before.managed_resources, 0);
  assert.equal(foundationApply.state_after.generation, '1788452068422403');
  assert.equal(foundationApply.state_after.serial, 4);
  assert.equal(foundationApply.state_after.managed_resources, 25);
  assert.equal(foundationApply.state_after.data_resources, 2);
  assert.equal(foundationApply.state_changed, true);
  assert.equal(foundationApply.temporary_lock_released, true);
  assert.equal(foundationApply.firestore_ttl_operations_successful, true);
  assert.equal(foundationApply.recovery_required, true);
  const recoveryPlan = validated.terraform.foundation_recovery_plan_observation;
  assert.equal(recoveryPlan.configuration_commit, 'fe41490ec978722dabecbe50a183b7994a247648');
  assert.deepEqual(recoveryPlan.result, {
    create: 8, no_op: 25, update: 0, delete: 0,
  });
  assert.deepEqual(recoveryPlan.resource_counts, {
    kms_iam_bindings: 1,
    secret_iam_bindings: 5,
    component_bucket_iam_bindings: 2,
  });
  assert.equal(recoveryPlan.provider_refresh_drift_count, 7);
  assert.equal(recoveryPlan.strict_validation_profile, 'partial-foundation-recovery');
  assert.equal(recoveryPlan.strict_validation_passed, true);
  assert.equal(recoveryPlan.private_saved_plan_removed_after_validation, true);
  assert.equal(recoveryPlan.apply_executed, false);
  assert.equal(recoveryPlan.state_unchanged, true);
  const recoveryApply = validated.terraform.foundation_recovery_apply_observation;
  assert.equal(recoveryApply.configuration_commit, 'd6e2a40064091d803cca79126cf91a75992cec1f');
  assert.equal(recoveryApply.workflow_run_id, '33784785967');
  assert.equal(
    recoveryApply.workflow_result,
    'failure_after_successful_apply_during_follow_up_plan',
  );
  assert.deepEqual(recoveryApply.requested_result, {
    create: 8,
    no_op: 25,
    update: 0,
    delete: 0,
  });
  assert.equal(recoveryApply.apply_attempted, true);
  assert.equal(recoveryApply.apply_completed, true);
  assert.equal(recoveryApply.workflow_failure_stage, 'post_apply_convergence_plan');
  assert.equal(recoveryApply.state_before.managed_resources, 25);
  assert.equal(recoveryApply.state_after.generation, '1788456706865449');
  assert.equal(recoveryApply.state_after.serial, 6);
  assert.equal(recoveryApply.state_after.managed_resources, 33);
  assert.equal(recoveryApply.state_after.data_resources, 3);
  assert.equal(recoveryApply.state_after.outputs, 1);
  assert.equal(recoveryApply.independent_convergence.result, 'no_changes');
  assert.equal(recoveryApply.independent_convergence.managed_no_op, 33);
  assert.equal(recoveryApply.independent_convergence.applyable, false);
  assert.equal(recoveryApply.live_inventory.foundation_resource_iam_bindings_exact, true);
  assert.equal(recoveryApply.live_inventory.secret_versions, 0);
  assert.equal(recoveryApply.live_inventory.firestore_ttl_fields_active, 3);
  assert.equal(recoveryApply.live_inventory.kms_algorithm, 'EC_SIGN_ED25519');
  assert.equal(recoveryApply.live_inventory.cloud_run_services, 0);
  assert.equal(recoveryApply.live_inventory.cloud_functions, 0);
  assert.equal(recoveryApply.plan_live_generation_present, false);
  assert.equal(recoveryApply.plan_soft_deleted_recoverable, true);
  assert.equal(recoveryApply.temporary_lock_released, true);
  assert.equal(recoveryApply.recovery_required, false);
  assert.equal(validated.terraform.apply_authorized, true);
  assert.equal(validated.terraform.function_deployment_included, true);
  assert.equal(validated.terraform.workload_root, 'workload');
  assert.equal(validated.terraform.backend.workload_prefix, 'terraform/workload');
  assert.equal(validated.terraform.local_plan_executed, true);
  assert.deepEqual(validated.terraform.local_plan_observation.result, {
    add: 36,
    change: 0,
    destroy: 0,
  });
  assert.deepEqual(validated.terraform.local_plan_observation.resource_counts, {
    billing_and_budget: 2,
    service_apis: 8,
    storage_buckets: 2,
    service_accounts: 3,
    workload_identity_pool_and_providers: 3,
    iam_bindings: 18,
  });
  assert.equal(validated.terraform.local_plan_observation.saved_plan_created, false);
  assert.equal(validated.terraform.local_plan_observation.apply_executed, false);
  assert.equal(validated.terraform.local_plan_observation.local_state_artifacts_created, false);
  assert.equal(validated.terraform.local_plan_observation.observed_on, '2026-09-03');
  assert.equal(
    validated.terraform.local_plan_observation.configuration_commit,
    '9b3905bb62718b57456b0658386b424ed635e82f',
  );
  assert.equal(
    validated.terraform.local_plan_observation.post_plan_checks[0],
    'billing-linked-to-approved-account',
  );
  assert.equal(
    validated.terraform.local_saved_plan_observation.configuration_commit,
    'e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501',
  );
  assert.equal(
    validated.terraform.local_saved_plan_observation.plan_sha256,
    '12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da',
  );
  assert.deepEqual(validated.terraform.local_saved_plan_observation.result, {
    create: 27,
    no_op: 9,
    import: 0,
    update: 0,
    delete: 0,
  });
  assert.equal(validated.terraform.local_saved_plan_observation.full_plan_reviewed, true);
  assert.equal(validated.terraform.local_saved_plan_observation.recovery_state_unchanged, true);
  assert.equal(validated.terraform.local_saved_plan_observation.apply_authorized, true);
  assert.equal(validated.terraform.local_saved_plan_observation.apply_executed, true);
  assert.equal(validated.terraform.local_saved_plan_observation.state_migration_authorized, true);
  assert.equal(validated.terraform.local_saved_plan_observation.state_migration_executed, true);
  assert.equal(
    validated.terraform.superseded_saved_plan_observation.plan_sha256,
    '6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457',
  );
  assert.deepEqual(validated.terraform.superseded_saved_plan_observation.result, {
    create: 35,
    import: 1,
    update: 1,
    delete: 0,
  });
  assert.equal(validated.terraform.superseded_saved_plan_observation.apply_authorized, true);
  assert.equal(validated.terraform.superseded_saved_plan_observation.apply_executed, true);
  assert.equal(validated.terraform.superseded_saved_plan_observation.local_state_artifacts_created, true);
  assert.equal(validated.terraform.superseded_saved_plan_observation.state_migration_executed, false);
  assert.equal(validated.evidence.github_policy_observation_verified, true);
  assert.equal(validated.readiness.manual_read_only_cloud_plan_authorized, true);
  assert.equal(validated.readiness.foundation_apply_authorized, false);
  assert.equal(validated.evidence.credential_free_validation, true);
  assert.equal(validated.evidence.manual_live_plan_requires_user_adc, true);
  assert.equal(validated.evidence.historical_ci_plan_used_keyless_oidc, true);
  assert.equal(validated.evidence.persistent_ci_credentials_allowed, false);
  assert.equal(validated.evidence.active_plan_workflow_present, false);
  assert.equal(validated.evidence.active_apply_workflow_present, false);
  assert.equal(validated.evidence.recovery_workflow_retired, true);
  assert.equal(validated.evidence.staging_wif_providers_disabled, true);
  assert.deepEqual(validated.evidence.activation_material, {
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
    workloads: {
      app_engine_applications: 0,
      cloud_functions: 0,
      cloud_run_services: 0,
      public_ingress: 0,
      minimum_instances: 0,
    },
  });
  assert.equal(
    validated.evidence.workload_deployment.state,
    'active_internal_only_schema_2_two_key_version_2_current_source_verified',
  );
  assert.equal(
    validated.evidence.workload_deployment.result_sha256,
    'bab093e5f070039c3e8f482f83bb00927406ca9284c639ca62bc69c4ae997713',
  );
  assert.deepEqual(validated.evidence.workload_deployment.recovery_plan_result, {
    create: 2,
    update: 1,
    delete: 0,
    function_replaced: false,
  });
  assert.equal(validated.evidence.workload_deployment.source_updates.length, 4);
  assert.equal(
    validated.evidence.workload_deployment.source_updates[3].function_revision,
    'control-plane-00005-biq',
  );
  assert.equal(validated.evidence.workload_deployment.runtime_migrations.length, 3);
  assert.deepEqual(
    validated.evidence.workload_deployment.runtime_migrations[0].plan_result,
    {
      create: 0,
      update: 2,
      delete: 0,
      source_replaced: false,
      function_replaced: false,
    },
  );
  assert.equal(
    validated.evidence.workload_deployment.runtime_migrations[0].function_revision,
    'control-plane-00006-wid',
  );
  assert.deepEqual(
    validated.evidence.workload_deployment.runtime_migrations[1].plan_result,
    {
      create: 0,
      update: 2,
      delete: 0,
      source_replaced: false,
      function_replaced: false,
    },
  );
  assert.equal(
    validated.evidence.workload_deployment.runtime_migrations[1].function_revision,
    'control-plane-00007-deb',
  );
  assert.equal(
    validated.evidence.workload_deployment.runtime_migrations[1].function_updated_at,
    '2026-09-05T11:59:31.953152089Z',
  );
  assert.deepEqual(
    validated.evidence.workload_deployment.runtime_migrations[2].plan_result,
    {
      create: 0,
      update: 2,
      delete: 0,
      source_replaced: false,
      function_replaced: false,
    },
  );
  assert.equal(
    validated.evidence.workload_deployment.runtime_migrations[2].function_revision,
    'control-plane-00008-saz',
  );
  assert.equal(
    validated.evidence.workload_deployment.runtime_migrations[2].function_updated_at,
    '2026-09-05T12:52:52.140270744Z',
  );
  assert.equal(validated.evidence.workload_deployment.terraform_state.serial, 22);
  assert.equal(validated.evidence.workload_deployment.terraform_state.managed_resources, 15);
  assert.equal(validated.evidence.workload_deployment.terraform_state.tainted_resources, 0);
  assert.equal(validated.evidence.workload_deployment.terraform_state.raw_contents_committed, false);
  assert.equal(validated.evidence.workload_deployment.terraform_convergence, 'no_changes');
  assert.deepEqual(validated.evidence.workload_deployment.user_managed_keys, {
    runtime: 0,
    build: 0,
    probe: 0,
  });
  assert.equal(validated.evidence.workload_deployment.private_bundle_committed, false);
  assert.equal(validated.evidence.workload_deployment.live_request_performed, false);
  assert.equal(validated.evidence.private_probe.state, 'secure_runtime_discovery_succeeded');
  assert.equal(validated.evidence.private_probe.workflow_revision, '000001-7fb');
  assert.equal(
    validated.evidence.private_probe.result_sha256,
    'ea3245756727eaf071f2edc6ef55ba1b730c5e3f61e38746fb7cbf36e8f4ef05',
  );
  assert.deepEqual(validated.evidence.private_probe.executions, {
    total: 3,
    failed: 2,
    succeeded: 1,
    workflow_retries: 0,
    scheduled_triggers: 0,
  });
  assert.equal(validated.evidence.private_probe.terraform_state.serial, 3);
  assert.equal(validated.evidence.private_probe.response_status, 200);
  assert.equal(validated.evidence.private_probe.five_secret_values_loaded, true);
  assert.equal(validated.evidence.private_probe.signing_public_key_validated, true);
  assert.equal(validated.evidence.private_probe.firebase_auth_validated, false);
  assert.equal(validated.evidence.private_probe.app_check_validated, false);
  assert.equal(validated.evidence.private_probe.application_mutation_expected, false);
  assert.equal(validated.evidence.private_probe.execution_identifiers_committed, false);
  assert.equal(validated.evidence.private_probe.trace_identifiers_committed, false);
  assert.equal(validated.evidence.private_probe.raw_diagnostics_committed, false);
  assert.equal(validated.evidence.private_probe.live_request_performed, true);
  assert.equal(validated.evidence.firebase_auth_baseline.state, 'initialized_closed_and_reconciled');
  assert.equal(validated.evidence.firebase_auth_baseline.external_identity_providers, 0);
  assert.equal(validated.evidence.firebase_auth_baseline.anonymous_sign_in, false);
  assert.equal(validated.evidence.firebase_auth_baseline.email_sign_in, false);
  assert.equal(validated.evidence.firebase_auth_baseline.phone_sign_in, false);
  assert.equal(validated.evidence.firebase_auth_baseline.public_endpoints_created, 0);
  assert.equal(validated.evidence.firebase_auth_baseline.persistent_credentials_created, 0);
  const userRelayProbe = validated.evidence.user_relay_probe;
  assert.equal(userRelayProbe.state, 'succeeded_and_retired');
  assert.equal(userRelayProbe.firebase_auth_validated, true);
  assert.equal(userRelayProbe.app_check_validated, true);
  assert.equal(userRelayProbe.invalid_firebase_status, 401);
  assert.equal(userRelayProbe.missing_app_check_status, 401);
  assert.equal(userRelayProbe.missing_home_status, 404);
  assert.equal(userRelayProbe.first_exchange_status, 200);
  assert.equal(userRelayProbe.second_exchange_status, 200);
  assert.equal(userRelayProbe.successful_exchanges, 2);
  assert.equal(userRelayProbe.token_signatures_validated, true);
  assert.equal(userRelayProbe.token_audiences_changed, true);
  assert.equal(userRelayProbe.synthetic_user_deleted, true);
  assert.equal(userRelayProbe.independent_user_absence_verified, true);
  assert.equal(userRelayProbe.synthetic_home_deleted, true);
  assert.equal(userRelayProbe.independent_home_absence_verified, true);
  assert.equal(userRelayProbe.relay_rotated, true);
  assert.equal(userRelayProbe.workflow_present, false);
  assert.equal(userRelayProbe.verifier_service_present, false);
  assert.equal(userRelayProbe.temporary_bindings_present, false);
  assert.equal(userRelayProbe.retained_disabled_custom_roles, 9);
  assert.equal(userRelayProbe.token_material_committed, false);
  assert.equal(userRelayProbe.raw_diagnostics_committed, false);
  assert.deepEqual(validated.evidence.browser_relay_plan, {
    state: 'rebased_reviewed_not_deployed',
    path: 'browser-relay/plan.json',
    sha256: '51fc7b8031da8fbd6162aacfc8e39a2bf25b1c96e496851a6d6847d4588e0b23',
    baseline_observed_at: '2026-09-05T18:28:41.130Z',
    baseline_control_plane_revision: 'control-plane-00008-saz',
    baseline_published_signing_keys: 2,
    baseline_current_signing_key_version: 2,
    browser_attestation_validated: true,
    firebase_auth_users: 0,
    application_fixture_collections: 0,
    open_preconditions: 6,
    cloud_mutation_authorized_by_plan: false,
    acceptance_executed: false,
    public_ingress_active: false,
    relay_services: 0,
    runner_present: false,
    completed_cases: 0,
  });
  assert.deepEqual(validated.evidence.browser_app_check_prerequisite, {
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
    global_key_attempt_claim: {
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
    },
    global_registration_attempt_claim: {
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
    },
    global_provider_attempt_claim: {
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
    },
    terraform_state: {
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
    },
    recaptcha_api_enabled: true,
    direct_key_inventory: 'readable',
    authoritative_recaptcha_keys: 1,
    cloud_asset_inventory: 'readable_eventually_consistent',
    cloud_asset_recaptcha_keys: 1,
    recaptcha_keys_created: 1,
    recaptcha_key: {
      name_sha256: '997f375ee6db0535dd3934dcc6ffb941f10efd5516e29b27c4caa6b8157851fb',
      display_name: 'Miakapp V4 staging browser App Check',
      labels: {
        environment: 'staging',
        'managed-by': 'terraform',
        product: 'miakapp-v4',
        purpose: 'browser-app-check',
      },
      create_time: '2026-09-05T08:23:36Z',
      integration_type: 'SCORE',
      allow_all_domains: false,
      allowed_domains: ['miakapp-v4-staging.web.app'],
      allowed_domain_includes_subdomains: true,
      allow_amp_traffic: false,
      testing_options_configured: false,
      waf_settings_configured: false,
    },
    app_check_provider: {
      name: 'projects/1072737219170/apps/1:1072737219170:web:5053ca93bf25d7373cd73b/recaptchaEnterpriseConfig',
      firebase_app_id: '1:1072737219170:web:5053ca93bf25d7373cd73b',
      token_ttl: '3600s',
      minimum_valid_score: 0.5,
      site_key_sha256: '8a76f0f2cc0e0b002ed66c7f7d01ac28a6d44cb74ad2d33c3a7b0f0203e58546',
      registered: true,
      deletion_api_available: false,
    },
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
  });
  assert.equal(
    validated.evidence.browser_app_check_attestation.state,
    'real_system_browser_provider_token_obtained_and_retired',
  );
  assert.equal(validated.evidence.browser_app_check_attestation.provider_token_obtained, true);
  assert.equal(validated.evidence.browser_app_check_attestation.jwt_shape_validated, true);
  assert.equal(validated.evidence.browser_app_check_attestation.hosting_site_disabled, true);
  assert.equal(validated.evidence.browser_app_check_attestation.runner_http_status_after_cleanup, 404);
  assert.equal(validated.evidence.browser_app_check_attestation.app_check_token_committed, false);
  assert.equal(validated.evidence.browser_app_check_attestation.raw_browser_error_committed, false);
  assert.deepEqual(validated.evidence.browser_app_check_attestation.local_post_validation, {
    state: 'rejected_after_provider_success',
    stage: 'token-ttl-validation',
    code: 'token-ttl-rejected',
    cause: 'public_get_token_result_contains_token_only',
  });
  assert.equal(
    validated.readiness.required_blockers.includes('app-check-browser-provider-attestation'),
    false,
  );
  assert.equal(
    validated.readiness.required_blockers.includes('audience-bound-user-relay-staging-acceptance'),
    false,
  );
  assert.equal(
    validated.readiness.required_blockers.includes('app-check-live-provider-and-replay-policy'),
    false,
  );
  assert.deepEqual(validated.evidence.retired_recovery_workflow, {
    id: '349440747',
    state: 'deleted',
    active_file_present: false,
  });
  assert.equal(
    validated.readiness.required_blockers.includes('staging-foundation-recovery-not-applied'),
    false,
  );
  assert.equal(validated.readiness.required_blockers.includes('staging-foundation-not-applied'), false);
  assert.equal(validated.readiness.required_blockers.includes('private-foundation-plan-not-reviewed'), false);
  assert.equal(validated.readiness.required_blockers.includes('github-terraform-workflow-not-installed'), false);
  assert.equal(validated.readiness.required_blockers.includes('foundation-state-not-initialized'), false);
  assert.equal(validated.readiness.required_blockers.includes('live-foundation-plan-not-reviewed'), false);
  assert.equal(validated.readiness.required_blockers.includes('remote-bootstrap-state-not-migrated'), false);
  assert.equal(
    validated.readiness.required_blockers.includes('github-branch-environment-and-actions-policy-not-configured'),
    false,
  );
  assert.equal(
    validated.readiness.required_blockers.includes('private-function-synthetic-invocation'),
    false,
  );
  assert.equal(
    validated.readiness.required_blockers.includes('private-production-function-deployment'),
    false,
  );
  assert.equal(
    validated.readiness.required_blockers.includes('fcm-least-privilege-runtime-iam'),
    false,
  );
  assert.equal(
    validated.evidence.production_security_boundary,
    '../../control-plane/test/unit/cloud-security.test.ts',
  );
  assert.equal(
    validated.evidence.production_composition_boundary,
    '../../control-plane/test/unit/production-runtime.test.ts',
  );
  assert.equal(
    validated.teardown.inventory_after_teardown.includes(
      'firebase-app-registrations-and-app-check-providers',
    ),
    true,
  );
  assert.equal(
    validated.teardown.inventory_after_teardown.includes(
      'workflows-probe-executions-schedules-and-api',
    ),
    true,
  );
  assert.equal(validateFirebaseRc(firebaseRc()).projects.default, 'miakapp-3');
});

test('cross-checks manifest claims against all committed evidence artifacts', () => {
  const evidence = validateCommittedEvidence(manifest());
  assert.equal(evidence.workload.function.revision, 'control-plane-00008-saz');
  assert.equal(evidence.probe.workload.function_revision, 'control-plane-00003-hum');
  assert.equal(evidence.userRelayProbe.workload.function_revision, 'control-plane-00004-yis');
  assert.equal(evidence.probe.response.status, 200);
  assert.equal(evidence.firebaseAuth.external_identity_providers, 0);
  assert.equal(evidence.userRelayProbe.execution.state, 'SUCCEEDED');
  assert.equal(evidence.userRelayProbeRetirement.workflow_present, false);
  assert.equal(evidence.userRelayProbeRetirement.verifier_service_present, false);
  assert.equal(evidence.browserRelayPlan.state, 'rebased_reviewed_not_deployed');
  assert.equal(evidence.browserRelayPlan.evidence.state, 'absent');

  const workloadDigestDrift = manifest();
  workloadDigestDrift.evidence.workload_deployment.result_sha256 = '0'.repeat(64);
  assert.throws(
    () => validateCommittedEvidence(workloadDigestDrift),
    (error) => error instanceof StagingManifestError
      && /evidence\.workload_deployment\.result_sha256/.test(error.message),
  );

  const probeCountDrift = manifest();
  probeCountDrift.evidence.private_probe.executions.total = 4;
  assert.throws(
    () => validateCommittedEvidence(probeCountDrift),
    (error) => error instanceof StagingManifestError
      && /evidence\.private_probe\.executions\.total/.test(error.message),
  );

  const probePathDrift = manifest();
  probePathDrift.evidence.private_probe.result_path = '../../private-result.json';
  assert.throws(
    () => validateCommittedEvidence(probePathDrift),
    (error) => error instanceof StagingManifestError
      && /evidence\.private_probe\.result_path/.test(error.message),
  );

  const authProbeDigestDrift = manifest();
  authProbeDigestDrift.evidence.user_relay_probe.result_sha256 = '0'.repeat(64);
  assert.throws(
    () => validateCommittedEvidence(authProbeDigestDrift),
    (error) => error instanceof StagingManifestError
      && /evidence\.user_relay_probe\.result_sha256/.test(error.message),
  );

  const authProbeRetirementPathDrift = manifest();
  authProbeRetirementPathDrift.evidence.user_relay_probe.retirement_path = '../../private.json';
  assert.throws(
    () => validateCommittedEvidence(authProbeRetirementPathDrift),
    (error) => error instanceof StagingManifestError
      && /evidence\.user_relay_probe\.retirement_path/.test(error.message),
  );

  const firebaseAuthDigestDrift = manifest();
  firebaseAuthDigestDrift.evidence.firebase_auth_baseline.result_sha256 = '0'.repeat(64);
  assert.throws(
    () => validateCommittedEvidence(firebaseAuthDigestDrift),
    (error) => error instanceof StagingManifestError
      && /evidence\.firebase_auth_baseline\.result_sha256/.test(error.message),
  );

  const browserRelayPlanDigestDrift = manifest();
  browserRelayPlanDigestDrift.evidence.browser_relay_plan.sha256 = '0'.repeat(64);
  assert.throws(
    () => validateCommittedEvidence(browserRelayPlanDigestDrift),
    (error) => error instanceof StagingManifestError
      && /evidence\.browser_relay_plan\.sha256/.test(error.message),
  );

  const browserRelayPlanPathDrift = manifest();
  browserRelayPlanPathDrift.evidence.browser_relay_plan.path = '../../private-plan.json';
  assert.throws(
    () => validateCommittedEvidence(browserRelayPlanPathDrift),
    (error) => error instanceof StagingManifestError
      && /evidence\.browser_relay_plan\.path/.test(error.message),
  );
});

test('rejects unknown fields including embedded secret material', () => {
  rejects((candidate) => {
    candidate.security.secrets[0].value = 'must-never-enter-the-manifest';
  }, /security\.secrets\[0\] must contain exactly/);
  rejects((candidate) => {
    candidate.unreviewed = true;
  }, /manifest must contain exactly/);
});

test('rejects legacy, production, and demo project targets', () => {
  for (const target of ['miakapp-3', 'miakapp-v4', 'demo-miakapp-v4', 'demo-unreviewed']) {
    rejects((candidate) => {
      candidate.project.project_id = target;
    }, /project\.project_id/);
  }
});

test('rejects drift from the historical billing-linked bootstrap inventory', () => {
  rejects((candidate) => {
    candidate.project.project_number = '000000000000';
  }, /project\.project_number/);
  rejects((candidate) => {
    candidate.project.lifecycle = 'firebase_enabled_unbilled';
  }, /project\.lifecycle/);
  rejects((candidate) => {
    candidate.bootstrap.billing_enabled = false;
  }, /bootstrap\.billing_enabled/);
  rejects((candidate) => {
    candidate.bootstrap.firebase_apps = 0;
  }, /bootstrap\.firebase_apps/);
  rejects((candidate) => {
    candidate.bootstrap.storage_buckets.push('unexpected-bucket');
  }, /bootstrap\.storage_buckets/);
  rejects((candidate) => {
    candidate.bootstrap.cloud_functions.push('projects/miakapp-v4-staging/locations/europe-west9/functions/unreviewed');
  }, /bootstrap\.cloud_functions/);
  rejects((candidate) => {
    candidate.bootstrap.enabled_service_apis.pop();
  }, /bootstrap\.enabled_service_apis/);
  rejects((candidate) => {
    candidate.bootstrap.workload_identity_provider_states['staging-plan'] = 'enabled';
  }, /bootstrap\.workload_identity_provider_states\.staging-plan/);
  rejects((candidate) => {
    candidate.bootstrap.unreviewed = true;
  }, /bootstrap must contain exactly/);
});

test('rejects authorization and bootstrap completion drift', () => {
  for (const field of [
    'creation_authorized',
    'billing_link_authorized',
    'public_ingress_authorized',
  ]) {
    rejects((candidate) => {
      candidate.project[field] = true;
    }, new RegExp(`project\\.${field}`));
  }
  rejects((candidate) => {
    candidate.project.deployment_authorized = false;
  }, /project\.deployment_authorized/);
  rejects((candidate) => {
    candidate.readiness.manual_read_only_cloud_plan_authorized = false;
  }, /readiness\.manual_read_only_cloud_plan_authorized/);
  rejects((candidate) => {
    candidate.readiness.foundation_apply_authorized = true;
  }, /readiness\.foundation_apply_authorized/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.bootstrap_completed = false;
  }, /terraform\.bootstrap_execution\.bootstrap_completed/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.state = 'authorized';
  }, /terraform\.bootstrap_execution\.state/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.approved_plan_sha256 = '0'.repeat(64);
  }, /terraform\.bootstrap_execution\.approved_plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.repository_commit_bound = false;
  }, /terraform\.bootstrap_execution\.repository_commit_bound/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.source_state_preserved_on_failure = false;
  }, /terraform\.bootstrap_execution\.source_state_preserved_on_failure/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.source_state_preserved_after_reconciliation = false;
  }, /terraform\.bootstrap_execution\.source_state_preserved_after_reconciliation/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.budget_preflight_requires_quota_project = false;
  }, /terraform\.bootstrap_execution\.budget_preflight_requires_quota_project/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.provisioned_target_preflight_required = false;
  }, /terraform\.bootstrap_execution\.provisioned_target_preflight_required/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.attempts[2].managed_resources_recorded = 35;
  }, /terraform\.bootstrap_execution\.attempts\[2\]\.managed_resources_recorded/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.attempts[1].remote_state_migrated = true;
  }, /terraform\.bootstrap_execution\.attempts\[1\]\.remote_state_migrated/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_state.serial = 38;
  }, /terraform\.bootstrap_execution\.recovery_state\.serial/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.remote_state.generation = '1788439334043523';
  }, /terraform\.bootstrap_execution\.remote_state\.generation/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.remote_state.initial_migration_reconciliation.remainder_exactly_equal = false;
  }, /terraform\.bootstrap_execution\.remote_state\.initial_migration_reconciliation\.remainder_exactly_equal/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.remote_state.initialization_generation.managed_resources = 1;
  }, /terraform\.bootstrap_execution\.remote_state\.initialization_generation\.managed_resources/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.private_plan_sha256 = '0'.repeat(64);
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.private_plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.import_address = 'wrong';
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.import_address/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.result.import = 0;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.result\.import/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.state_after.managed_resources = 36;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.state_after\.managed_resources/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.state_before.generation = '1';
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.state_before\.generation/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.project_iam_etag_after = 'changed';
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.project_iam_etag_after/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.project_iam_canonical_sha256_after = '0'.repeat(64);
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.project_iam_canonical_sha256_after/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.set_iam_policy_audit_entries = 1;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.set_iam_policy_audit_entries/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.project_iam_unchanged = false;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.project_iam_unchanged/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.normalized_state_remainder_sha256_after = '0'.repeat(64);
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.normalized_state_remainder_sha256_after/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.check_results_exact_permutation = false;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.check_results_exact_permutation/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.state_remainder_exactly_equal = false;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.state_remainder_exactly_equal/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.follow_up_plan_result = 'changes';
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.follow_up_plan_result/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.follow_up_plan_exit_code = 2;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.follow_up_plan_exit_code/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.temporary_lock_released = false;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.temporary_lock_released/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.raw_state_committed = true;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.raw_state_committed/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.planner_role_adoption_observation.raw_plan_committed = true;
  }, /terraform\.bootstrap_execution\.planner_role_adoption_observation\.raw_plan_committed/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.private_plan_sha256 = '0'.repeat(64);
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.private_plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.private_plan_size_bytes = 1;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.private_plan_size_bytes/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.plan_result.change = 1;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.plan_result\.change/);
  rejects((candidate) => {
    const observation = candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation;
    observation.changes.reverse();
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.changes\[0\]\.address/);
  rejects((candidate) => {
    const observation = candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation;
    observation.changes[0].attribute = 'attribute_condition';
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.changes\[0\]\.attribute/);
  rejects((candidate) => {
    const observation = candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation;
    observation.changes[0].before = true;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.changes\[0\]\.before/);
  rejects((candidate) => {
    const observation = candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation;
    observation.workload_identity_pool_state_after = 'disabled';
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.workload_identity_pool_state_after/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.apply_completed = false;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.apply_completed/);
  rejects((candidate) => {
    const observation = candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation;
    observation.state_before.generation = '1';
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.state_before\.generation/);
  rejects((candidate) => {
    const observation = candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation;
    observation.state_after.sha256 = '0'.repeat(64);
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.state_after\.sha256/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.state_lineage_unchanged = false;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.state_lineage_unchanged/);
  rejects((candidate) => {
    const observation = candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation;
    observation.iam_hash_profile = 'unspecified';
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.iam_hash_profile/);
  rejects((candidate) => {
    const observation = candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation;
    observation.planner_service_account_iam_normalized_sha256_after = '0'.repeat(64);
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.planner_service_account_iam_normalized_sha256_after/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.project_iam_unchanged = false;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.project_iam_unchanged/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.follow_up_plan_exit_code = 2;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.follow_up_plan_exit_code/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.temporary_lock_released = false;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.temporary_lock_released/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.recovery_federation_retirement_observation.raw_plan_committed = true;
  }, /terraform\.bootstrap_execution\.recovery_federation_retirement_observation\.raw_plan_committed/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.migration_attempts[1].remote_state_migrated = false;
  }, /terraform\.bootstrap_execution\.migration_attempts\[1\]\.remote_state_migrated/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.initialization_authorized = true;
  }, /terraform\.foundation_state_initialization\.initialization_authorized/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.manual_state_push_allowed = true;
  }, /terraform\.foundation_state_initialization\.manual_state_push_allowed/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.saved_plan_fingerprint_required = false;
  }, /terraform\.foundation_state_initialization\.saved_plan_fingerprint_required/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.saved_plan_apply_allowed = true;
  }, /terraform\.foundation_state_initialization\.saved_plan_apply_allowed/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.final_generation_recheck_required = false;
  }, /terraform\.foundation_state_initialization\.final_generation_recheck_required/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.expected_bootstrap_state.generation = '1';
  }, /terraform\.foundation_state_initialization\.expected_bootstrap_state\.generation/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.observed_foundation_state.generation = '1';
  }, /terraform\.foundation_state_initialization\.observed_foundation_state\.generation/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.observed_foundation_state.sha256 = '0'.repeat(64);
  }, /terraform\.foundation_state_initialization\.observed_foundation_state\.sha256/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.observed_foundation_state.managed_resources = 1;
  }, /terraform\.foundation_state_initialization\.observed_foundation_state\.managed_resources/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.post_initialization_plan.apply_executed = true;
  }, /terraform\.foundation_state_initialization\.post_initialization_plan\.apply_executed/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.post_initialization_plan.applyable = true;
  }, /terraform\.foundation_state_initialization\.post_initialization_plan\.applyable/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.post_initialization_plan.implicit_providers.push(
      'registry.terraform.io/hashicorp/random@3.7.2',
    );
  }, /terraform\.foundation_state_initialization\.post_initialization_plan\.implicit_providers/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.reconciliation_executed = false;
  }, /terraform\.foundation_state_initialization\.reconciliation_executed/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.attempts[1].state_reconciled = false;
  }, /terraform\.foundation_state_initialization\.attempts\[1\]\.state_reconciled/);
  rejects((candidate) => {
    candidate.terraform.foundation_state_initialization.attempts[1].remote_generation = '1';
  }, /terraform\.foundation_state_initialization\.attempts\[1\]\.remote_generation/);
  rejects((candidate) => {
    candidate.terraform.foundation_live_plan_observation.result.create = 32;
  }, /terraform\.foundation_live_plan_observation\.result\.create/);
  rejects((candidate) => {
    candidate.terraform.foundation_live_plan_observation.resource_counts.service_apis = 12;
  }, /terraform\.foundation_live_plan_observation\.resource_counts\.service_apis/);
  rejects((candidate) => {
    candidate.terraform.foundation_live_plan_observation.contains_public_ingress = true;
  }, /terraform\.foundation_live_plan_observation\.contains_public_ingress/);
  rejects((candidate) => {
    candidate.terraform.foundation_live_plan_observation.contains_billing_resource = true;
  }, /terraform\.foundation_live_plan_observation\.contains_billing_resource/);
  rejects((candidate) => {
    candidate.terraform.foundation_live_plan_observation.apply_executed = true;
  }, /terraform\.foundation_live_plan_observation\.apply_executed/);
  rejects((candidate) => {
    candidate.terraform.foundation_live_plan_observation.state_generation_after = '1';
  }, /terraform\.foundation_live_plan_observation\.state_generation_after/);
  rejects((candidate) => {
    candidate.terraform.foundation_live_plan_observation.temporary_lock_released = false;
  }, /terraform\.foundation_live_plan_observation\.temporary_lock_released/);
  rejects((candidate) => {
    candidate.terraform.foundation_saved_plan_observation.plan_sha256 = '0'.repeat(64);
  }, /terraform\.foundation_saved_plan_observation\.plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.foundation_saved_plan_observation.result.delete = 1;
  }, /terraform\.foundation_saved_plan_observation\.result\.delete/);
  rejects((candidate) => {
    candidate.terraform.foundation_saved_plan_observation.saved_plan_private = false;
  }, /terraform\.foundation_saved_plan_observation\.saved_plan_private/);
  rejects((candidate) => {
    candidate.terraform.foundation_saved_plan_observation.strict_validation_passed = false;
  }, /terraform\.foundation_saved_plan_observation\.strict_validation_passed/);
  rejects((candidate) => {
    candidate.terraform.foundation_apply_observation.apply_completed = true;
  }, /terraform\.foundation_apply_observation\.apply_completed/);
  rejects((candidate) => {
    candidate.terraform.foundation_apply_observation.failure_cause_known = true;
  }, /terraform\.foundation_apply_observation\.failure_cause_known/);
  rejects((candidate) => {
    candidate.terraform.foundation_apply_observation.state_after.managed_resources = 33;
  }, /terraform\.foundation_apply_observation\.state_after\.managed_resources/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_plan_observation.result.delete = 1;
  }, /terraform\.foundation_recovery_plan_observation\.result\.delete/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_plan_observation.resource_counts.secret_iam_bindings = 4;
  }, /terraform\.foundation_recovery_plan_observation\.resource_counts\.secret_iam_bindings/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_plan_observation.contains_public_ingress = true;
  }, /terraform\.foundation_recovery_plan_observation\.contains_public_ingress/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_plan_observation.strict_validation_passed = false;
  }, /terraform\.foundation_recovery_plan_observation\.strict_validation_passed/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.plan_sha256 = '0'.repeat(64);
  }, /terraform\.foundation_recovery_apply_observation\.plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.plan_generation = '1';
  }, /terraform\.foundation_recovery_apply_observation\.plan_generation/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.requested_result.delete = 1;
  }, /terraform\.foundation_recovery_apply_observation\.requested_result\.delete/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.resource_counts.secret_iam_bindings = 4;
  }, /terraform\.foundation_recovery_apply_observation\.resource_counts\.secret_iam_bindings/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.apply_completed = false;
  }, /terraform\.foundation_recovery_apply_observation\.apply_completed/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.state_after.sha256 = '0'.repeat(64);
  }, /terraform\.foundation_recovery_apply_observation\.state_after\.sha256/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.state_after.managed_resources = 32;
  }, /terraform\.foundation_recovery_apply_observation\.state_after\.managed_resources/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.independent_convergence.result = 'changes';
  }, /terraform\.foundation_recovery_apply_observation\.independent_convergence\.result/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.independent_convergence.plan_sha256 = '0'.repeat(64);
  }, /terraform\.foundation_recovery_apply_observation\.independent_convergence\.plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.independent_convergence.exit_code = 2;
  }, /terraform\.foundation_recovery_apply_observation\.independent_convergence\.exit_code/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.independent_convergence.applyable = true;
  }, /terraform\.foundation_recovery_apply_observation\.independent_convergence\.applyable/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.live_inventory.foundation_resource_iam_bindings_exact = false;
  }, /terraform\.foundation_recovery_apply_observation\.live_inventory\.foundation_resource_iam_bindings_exact/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.live_inventory.secret_versions = 1;
  }, /terraform\.foundation_recovery_apply_observation\.live_inventory\.secret_versions/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.live_inventory.firestore_ttl_fields_active = 2;
  }, /terraform\.foundation_recovery_apply_observation\.live_inventory\.firestore_ttl_fields_active/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.live_inventory.kms_algorithm = 'GOOGLE_SYMMETRIC_ENCRYPTION';
  }, /terraform\.foundation_recovery_apply_observation\.live_inventory\.kms_algorithm/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.live_inventory.cloud_run_services = 1;
  }, /terraform\.foundation_recovery_apply_observation\.live_inventory\.cloud_run_services/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.plan_live_generation_present = true;
  }, /terraform\.foundation_recovery_apply_observation\.plan_live_generation_present/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.plan_soft_deleted_recoverable = false;
  }, /terraform\.foundation_recovery_apply_observation\.plan_soft_deleted_recoverable/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.temporary_lock_released = false;
  }, /terraform\.foundation_recovery_apply_observation\.temporary_lock_released/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.raw_planned_values_committed = true;
  }, /terraform\.foundation_recovery_apply_observation\.raw_planned_values_committed/);
  rejects((candidate) => {
    candidate.terraform.foundation_recovery_apply_observation.recovery_required = true;
  }, /terraform\.foundation_recovery_apply_observation\.recovery_required/);
});

test('requires explicit targeting and forbids a staging Firebase alias', () => {
  rejects((candidate) => {
    candidate.project.explicit_project_required = false;
  }, /project\.explicit_project_required/);
  rejects((candidate) => {
    candidate.project.firebase_alias_allowed = true;
  }, /project\.firebase_alias_allowed/);

  const aliased = firebaseRc();
  aliased.projects.staging = 'miakapp-v4-staging';
  assert.throws(() => validateFirebaseRc(aliased), StagingManifestError);
});

test('keeps the root Firebase default on untouched legacy production', () => {
  const candidate = firebaseRc();
  candidate.projects.default = 'miakapp-v4-staging';
  assert.throws(
    () => validateFirebaseRc(candidate),
    /\.firebaserc\.projects\.default must equal "miakapp-3"/,
  );
});

test('locks every regional resource to the reviewed Paris location', () => {
  for (const field of ['primary', 'functions', 'firestore', 'storage', 'kms']) {
    for (const location of ['europe-west1', 'europe-west6', 'eur3']) {
      rejects((candidate) => {
        candidate.locations[field] = location;
      }, new RegExp(`locations\\.${field}`));
    }
  }
  rejects((candidate) => {
    candidate.locations.immutable_choice_reviewed = false;
  }, /locations\.immutable_choice_reviewed/);
});

test('enforces scale-to-zero, one maximum instance, and private ingress', () => {
  rejects((candidate) => {
    candidate.runtime.deployment_state = 'FAILED';
  }, /runtime\.deployment_state/);
  rejects((candidate) => {
    candidate.runtime.revision = 'control-plane-00002-unreviewed';
  }, /runtime\.revision/);
  rejects((candidate) => {
    candidate.runtime.minimum_instances = 1;
  }, /runtime\.minimum_instances/);
  rejects((candidate) => {
    candidate.runtime.maximum_instances = 2;
  }, /runtime\.maximum_instances/);
  rejects((candidate) => {
    candidate.runtime.allow_unauthenticated = true;
  }, /runtime\.allow_unauthenticated/);
  rejects((candidate) => {
    candidate.runtime.ingress = 'all';
  }, /runtime\.ingress/);
  rejects((candidate) => {
    candidate.runtime.source_archive_sha256 = '0'.repeat(64);
  }, /runtime\.source_archive_sha256/);
  rejects((candidate) => {
    candidate.runtime.runtime_config_sha256 = '0'.repeat(64);
  }, /runtime\.runtime_config_sha256/);
  rejects((candidate) => {
    candidate.runtime.runtime_schema = 'miakapp.production-runtime/1';
  }, /runtime\.runtime_schema/);
  rejects((candidate) => {
    candidate.runtime.security_schema = 'miakapp.production-security/1';
  }, /runtime\.security_schema/);
  rejects((candidate) => {
    candidate.runtime.published_signing_keys = 1;
  }, /runtime\.published_signing_keys/);
  rejects((candidate) => {
    candidate.runtime.current_signing_key_version = 1;
  }, /runtime\.current_signing_key_version/);
  rejects((candidate) => {
    candidate.runtime.user_managed_keys = 1;
  }, /runtime\.user_managed_keys/);
  rejects((candidate) => {
    candidate.runtime.live_request_performed = true;
  }, /runtime\.live_request_performed/);
});

test('rejects public, default-bucket, retained, or cross-origin Storage drift', () => {
  rejects((candidate) => {
    candidate.data.storage.firebase_default_bucket = true;
  }, /data\.storage\.firebase_default_bucket/);
  rejects((candidate) => {
    candidate.data.storage.public_read = true;
  }, /data\.storage\.public_read/);
  rejects((candidate) => {
    candidate.data.storage.cors_origins = ['https://app.miakapp.com'];
  }, /data\.storage\.cors_origins/);
  rejects((candidate) => {
    candidate.data.storage.soft_delete_days = 7;
  }, /data\.storage\.soft_delete_days/);
  rejects((candidate) => {
    candidate.data.storage.retention_policy_locked = true;
  }, /data\.storage\.retention_policy_locked/);
});

test('keeps KMS manual, software-backed, and explicitly non-deletable', () => {
  rejects((candidate) => {
    candidate.security.kms.automatic_rotation = true;
  }, /security\.kms\.automatic_rotation/);
  rejects((candidate) => {
    candidate.security.kms.protection_level = 'HSM';
  }, /security\.kms\.protection_level/);
  rejects((candidate) => {
    candidate.security.kms.key_ring_deletion_supported = true;
  }, /security\.kms\.key_ring_deletion_supported/);
  rejects((candidate) => {
    candidate.security.kms.enabled_versions.push(3);
  }, /security\.kms\.enabled_versions/);
  rejects((candidate) => {
    candidate.security.kms.runtime_published_versions.push(2);
  }, /security\.kms\.runtime_published_versions/);
});

test('rejects broad IAM substitution and resolved FCM access drift', () => {
  rejects((candidate) => {
    candidate.security.iam.resource_bindings[0].access = 'roles/owner';
  }, /security\.iam\.resource_bindings\[0\]\.access/);
  rejects((candidate) => {
    candidate.security.iam.broad_project_roles_forbidden = false;
  }, /security\.iam\.broad_project_roles_forbidden/);
  rejects((candidate) => {
    candidate.security.iam.human_runtime_bindings_forbidden = false;
  }, /security\.iam\.human_runtime_bindings_forbidden/);
  rejects((candidate) => {
    candidate.security.secrets[0].version_policy_state = 'implemented';
  }, /security\.secrets\[0\]\.version_policy_state/);
  rejects((candidate) => {
    candidate.security.iam.unresolved_permissions = ['cloudmessaging.messages.create'];
  }, /security\.iam\.unresolved_permissions/);
});

test('rejects fixed-cost services and budget safety drift', () => {
  for (const field of Object.keys(manifestFixture.cost.fixed_cost_services)) {
    rejects((candidate) => {
      candidate.cost.fixed_cost_services[field] = true;
    }, new RegExp(`cost\\.fixed_cost_services\\.${field}`));
  }
  rejects((candidate) => {
    candidate.cost.billing_account.identifier_sha256 = '0'.repeat(64);
  }, /cost\.billing_account\.identifier_sha256/);
  rejects((candidate) => {
    candidate.cost.billing_account.raw_identifier_committed = true;
  }, /cost\.billing_account\.raw_identifier_committed/);
  rejects((candidate) => {
    candidate.cost.billing_account.link_state = 'not_linked';
  }, /cost\.billing_account\.link_state/);
  rejects((candidate) => {
    candidate.cost.billing_account.terraform_management_state = 'managed';
  }, /cost\.billing_account\.terraform_management_state/);
  rejects((candidate) => {
    candidate.cost.free_tier_assumed = true;
  }, /cost\.free_tier_assumed/);
});

test('rejects Terraform activation, identity, state, provider, and deployment drift', () => {
  rejects((candidate) => {
    candidate.terraform.supported_workflow = 'apply';
  }, /terraform\.supported_workflow/);
  rejects((candidate) => {
    candidate.terraform.configuration_apply_capable = false;
  }, /terraform\.configuration_apply_capable/);
  rejects((candidate) => {
    candidate.terraform.active_cloud_workflow = '.github/workflows/staging-terraform.yml';
  }, /terraform\.active_cloud_workflow/);
  rejects((candidate) => {
    candidate.terraform.workflow_blueprint_state = 'dormant_not_installed';
  }, /terraform\.workflow_blueprint_state/);
  rejects((candidate) => {
    candidate.terraform.backend.state = 'created';
  }, /terraform\.backend\.state/);
  rejects((candidate) => {
    candidate.terraform.backend.type = 'local';
  }, /terraform\.backend\.type/);
  rejects((candidate) => {
    candidate.terraform.backend.bootstrap_migration_state = 'migrated';
  }, /terraform\.backend\.bootstrap_migration_state/);
  rejects((candidate) => {
    candidate.terraform.identity.state = 'created';
  }, /terraform\.identity\.state/);
  rejects((candidate) => {
    candidate.terraform.identity.workload_identity_pool_state = 'disabled';
  }, /terraform\.identity\.workload_identity_pool_state/);
  rejects((candidate) => {
    candidate.terraform.identity.plan_provider_state = 'enabled';
  }, /terraform\.identity\.plan_provider_state/);
  rejects((candidate) => {
    candidate.terraform.identity.apply_provider_state = 'enabled';
  }, /terraform\.identity\.apply_provider_state/);
  rejects((candidate) => {
    candidate.terraform.identity.reviewed_github_oidc_exchange_allowed = true;
  }, /terraform\.identity\.reviewed_github_oidc_exchange_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.service_account_keys_allowed = true;
  }, /terraform\.identity\.service_account_keys_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.bootstrap_state_write_allowed = true;
  }, /terraform\.identity\.bootstrap_state_write_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.planner_service_usage_consumer_allowed = false;
  }, /terraform\.identity\.planner_service_usage_consumer_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.planner_service_usage_consumer_state = 'unmanaged';
  }, /terraform\.identity\.planner_service_usage_consumer_state/);
  rejects((candidate) => {
    candidate.terraform.identity.deployer_project_iam_mutation_allowed = true;
  }, /terraform\.identity\.deployer_project_iam_mutation_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.deployer_service_account_administration_allowed = true;
  }, /terraform\.identity\.deployer_service_account_administration_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.deployer_project_wide_storage_administration_allowed = true;
  }, /terraform\.identity\.deployer_project_wide_storage_administration_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.deployer_component_bucket_administration_allowed = false;
  }, /terraform\.identity\.deployer_component_bucket_administration_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.planner_initial_foundation_state_creation_allowed = true;
  }, /terraform\.identity\.planner_initial_foundation_state_creation_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.planner_foundation_state_replacement_allowed = true;
  }, /terraform\.identity\.planner_foundation_state_replacement_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.planner_foundation_lock_administration_allowed = false;
  }, /terraform\.identity\.planner_foundation_lock_administration_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.deployer_foundation_state_replacement_allowed = false;
  }, /terraform\.identity\.deployer_foundation_state_replacement_allowed/);
  rejects((candidate) => {
    candidate.terraform.saved_plan.public_artifacts_allowed = true;
  }, /terraform\.saved_plan\.public_artifacts_allowed/);
  rejects((candidate) => {
    candidate.terraform.saved_plan.create_only = false;
  }, /terraform\.saved_plan\.create_only/);
  rejects((candidate) => {
    candidate.terraform.apply_authorized = false;
  }, /terraform\.apply_authorized/);
  rejects((candidate) => {
    candidate.terraform.destroy_authorized = true;
  }, /terraform\.destroy_authorized/);
  rejects((candidate) => {
    candidate.terraform.function_deployment_included = false;
  }, /terraform\.function_deployment_included/);
  rejects((candidate) => {
    candidate.terraform.providers[0].version = 'latest';
  }, /terraform\.providers\[0\]\.version/);
  rejects((candidate) => {
    candidate.terraform.offline_check_uses_mock_providers = false;
  }, /terraform\.offline_check_uses_mock_providers/);
  rejects((candidate) => {
    candidate.terraform.local_plan_executed = false;
  }, /terraform\.local_plan_executed/);
});

test('rejects incomplete or mutated bootstrap plan evidence', () => {
  rejects((candidate) => {
    candidate.terraform.local_plan_observation.configuration_commit = '0'.repeat(40);
  }, /terraform\.local_plan_observation\.configuration_commit/);
  rejects((candidate) => {
    candidate.terraform.local_plan_observation.result.add = 35;
  }, /terraform\.local_plan_observation\.result\.add/);
  rejects((candidate) => {
    candidate.terraform.local_plan_observation.resource_counts.iam_bindings = 17;
  }, /terraform\.local_plan_observation\.resource_counts\.iam_bindings/);
  rejects((candidate) => {
    candidate.terraform.local_plan_observation.saved_plan_created = true;
  }, /terraform\.local_plan_observation\.saved_plan_created/);
  rejects((candidate) => {
    candidate.terraform.local_plan_observation.apply_executed = true;
  }, /terraform\.local_plan_observation\.apply_executed/);
  rejects((candidate) => {
    candidate.terraform.local_plan_observation.local_state_artifacts_created = true;
  }, /terraform\.local_plan_observation\.local_state_artifacts_created/);
  rejects((candidate) => {
    candidate.terraform.local_plan_observation.post_plan_checks.pop();
  }, /terraform\.local_plan_observation\.post_plan_checks/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.plan_sha256 = '0'.repeat(64);
  }, /terraform\.local_saved_plan_observation\.plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.recovery_state.serial = 12;
  }, /terraform\.local_saved_plan_observation\.recovery_state\.serial/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.result.no_op = 8;
  }, /terraform\.local_saved_plan_observation\.result\.no_op/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.full_plan_reviewed = false;
  }, /terraform\.local_saved_plan_observation\.full_plan_reviewed/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.billing_link_no_op = false;
  }, /terraform\.local_saved_plan_observation\.billing_link_no_op/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.apply_authorized = false;
  }, /terraform\.local_saved_plan_observation\.apply_authorized/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.post_inspection_checks.pop();
  }, /terraform\.local_saved_plan_observation\.post_inspection_checks/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.secret = 'must-not-be-accepted';
  }, /terraform\.local_saved_plan_observation must contain exactly/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.plan_sha256 = '0'.repeat(64);
  }, /terraform\.local_saved_plan_observation\.plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.result.delete = 1;
  }, /terraform\.local_saved_plan_observation\.result\.delete/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.private_bundle_path_committed = true;
  }, /terraform\.local_saved_plan_observation\.private_bundle_path_committed/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.raw_billing_account_identifier_committed = true;
  }, /terraform\.local_saved_plan_observation\.raw_billing_account_identifier_committed/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.full_plan_reviewed = false;
  }, /terraform\.local_saved_plan_observation\.full_plan_reviewed/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.billing_import_preserves_account = false;
  }, /terraform\.local_saved_plan_observation\.billing_import_preserves_account/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.billing_update_cloud_api_expected = true;
  }, /terraform\.local_saved_plan_observation\.billing_update_cloud_api_expected/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.apply_authorized = false;
  }, /terraform\.local_saved_plan_observation\.apply_authorized/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.state_migration_executed = true;
  }, /terraform\.local_saved_plan_observation\.state_migration_executed/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.post_inspection_checks.pop();
  }, /terraform\.local_saved_plan_observation\.post_inspection_checks/);
  rejects((candidate) => {
    candidate.terraform.superseded_saved_plan_observation.secret = 'must-not-be-accepted';
  }, /terraform\.superseded_saved_plan_observation must contain exactly/);
});

test('requires every remaining blocker and staging evidence row', () => {
  rejects((candidate) => {
    candidate.readiness.required_blockers.pop();
  }, /readiness\.required_blockers/);
  rejects((candidate) => {
    candidate.evidence.staging_rows.shift();
  }, /evidence\.staging_rows/);
  rejects((candidate) => {
    candidate.evidence.browser_relay_plan.acceptance_executed = true;
  }, /evidence\.browser_relay_plan\.acceptance_executed/);
  rejects((candidate) => {
    candidate.evidence.browser_relay_plan.public_ingress_active = true;
  }, /evidence\.browser_relay_plan\.public_ingress_active/);
  rejects((candidate) => {
    candidate.evidence.browser_relay_plan.relay_services = 2;
  }, /evidence\.browser_relay_plan\.relay_services/);
  rejects((candidate) => {
    candidate.evidence.browser_relay_plan.completed_cases = 1;
  }, /evidence\.browser_relay_plan\.completed_cases/);
  rejects((candidate) => {
    candidate.evidence.browser_relay_plan.browser_attestation_validated = false;
  }, /evidence\.browser_relay_plan\.browser_attestation_validated/);
  rejects((candidate) => {
    candidate.evidence.browser_relay_plan.baseline_current_signing_key_version = 1;
  }, /evidence\.browser_relay_plan\.baseline_current_signing_key_version/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_prerequisite.recaptcha_api_enabled = false;
  }, /evidence\.browser_app_check_prerequisite\.recaptcha_api_enabled/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_prerequisite.terraform_state.generation = '1';
  }, /evidence\.browser_app_check_prerequisite\.terraform_state\.generation/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_prerequisite.global_provider_attempt_claim.retry_authorized = true;
  }, /evidence\.browser_app_check_prerequisite\.global_provider_attempt_claim\.retry_authorized/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_prerequisite.recaptcha_key.allow_all_domains = true;
  }, /evidence\.browser_app_check_prerequisite\.recaptcha_key\.allow_all_domains/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_prerequisite.app_check_provider.registered = false;
  }, /evidence\.browser_app_check_prerequisite\.app_check_provider\.registered/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_prerequisite.public_site_key_committed = true;
  }, /evidence\.browser_app_check_prerequisite\.public_site_key_committed/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_prerequisite.raw_provider_config_committed = true;
  }, /evidence\.browser_app_check_prerequisite\.raw_provider_config_committed/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_prerequisite.recovery_entrypoints_retired = false;
  }, /evidence\.browser_app_check_prerequisite\.recovery_entrypoints_retired/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_attestation.provider_token_obtained = false;
  }, /evidence\.browser_app_check_attestation\.provider_token_obtained/);
  rejects((candidate) => {
    candidate.evidence.browser_app_check_attestation.entrypoints_retired = false;
  }, /evidence\.browser_app_check_attestation\.entrypoints_retired/);
  rejects((candidate) => {
    candidate.evidence.signing_key_overlap_prerequisite.kms_version_creations = 2;
  }, /evidence\.signing_key_overlap_prerequisite\.kms_version_creations/);
  rejects((candidate) => {
    candidate.evidence.signing_key_overlap_prerequisite.runtime_changed = true;
  }, /evidence\.signing_key_overlap_prerequisite\.runtime_changed/);
  rejects((candidate) => {
    candidate.evidence.signing_key_overlap_prerequisite.entrypoints_retired = false;
  }, /evidence\.signing_key_overlap_prerequisite\.entrypoints_retired/);
});

test('rejects drift from the public activation evidence and initialized versions', () => {
  rejects((candidate) => {
    candidate.evidence.activation_material.result_sha256 = '0'.repeat(64);
  }, /evidence\.activation_material\.result_sha256/);
  rejects((candidate) => {
    candidate.evidence.activation_material.seed_deleted = false;
  }, /evidence\.activation_material\.seed_deleted/);
  rejects((candidate) => {
    candidate.evidence.activation_material.workloads.cloud_functions = 1;
  }, /evidence\.activation_material\.workloads\.cloud_functions/);
  rejects((candidate) => {
    candidate.security.secrets[0].enabled_versions.push(2);
  }, /security\.secrets\[0\]\.enabled_versions/);
  rejects((candidate) => {
    candidate.services[6].state = 'planned';
  }, /services\[6\]\.state/);
});

test('rejects drift from the public workload deployment evidence', () => {
  rejects((candidate) => {
    candidate.evidence.workload_deployment.result_sha256 = '0'.repeat(64);
  }, /evidence\.workload_deployment\.result_sha256/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.recovery_plan_result.function_replaced = true;
  }, /evidence\.workload_deployment\.recovery_plan_result\.function_replaced/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.source_updates[2].plan_sha256 = '0'.repeat(64);
  }, /evidence\.workload_deployment\.source_updates\[2\]\.plan_sha256/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.runtime_migrations[0].plan_result.update = 3;
  }, /evidence\.workload_deployment\.runtime_migrations\[0\]\.plan_result\.update/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.runtime_migrations[0].plan_result.source_replaced = true;
  }, /evidence\.workload_deployment\.runtime_migrations\[0\]\.plan_result\.source_replaced/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.runtime_migrations[1].plan_metadata_sha256 =
      '0'.repeat(64);
  }, /evidence\.workload_deployment\.runtime_migrations\[1\]\.plan_metadata_sha256/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.runtime_migrations[1].function_updated_at =
      '2026-09-05T11:59:32.000000000Z';
  }, /evidence\.workload_deployment\.runtime_migrations\[1\]\.function_updated_at/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.terraform_state.tainted_resources = 1;
  }, /evidence\.workload_deployment\.terraform_state\.tainted_resources/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.user_managed_keys.runtime = 1;
  }, /evidence\.workload_deployment\.user_managed_keys\.runtime/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.operator_email_committed = true;
  }, /evidence\.workload_deployment\.operator_email_committed/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.private_bundle_committed = true;
  }, /evidence\.workload_deployment\.private_bundle_committed/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.live_request_performed = true;
  }, /evidence\.workload_deployment\.live_request_performed/);
  rejects((candidate) => {
    candidate.evidence.workload_deployment.private_detail = 'must-not-be-accepted';
  }, /evidence\.workload_deployment must contain exactly/);
});

test('rejects drift or private telemetry claims in the public probe evidence', () => {
  rejects((candidate) => {
    candidate.evidence.private_probe.result_sha256 = '0'.repeat(64);
  }, /evidence\.private_probe\.result_sha256/);
  rejects((candidate) => {
    candidate.evidence.private_probe.deployment_plan_result.create = 4;
  }, /evidence\.private_probe\.deployment_plan_result\.create/);
  rejects((candidate) => {
    candidate.evidence.private_probe.terraform_state.tainted_resources = 1;
  }, /evidence\.private_probe\.terraform_state\.tainted_resources/);
  rejects((candidate) => {
    candidate.evidence.private_probe.executions.succeeded = 2;
  }, /evidence\.private_probe\.executions\.succeeded/);
  rejects((candidate) => {
    candidate.evidence.private_probe.execution_identifiers_committed = true;
  }, /evidence\.private_probe\.execution_identifiers_committed/);
  rejects((candidate) => {
    candidate.evidence.private_probe.trace_identifiers_committed = true;
  }, /evidence\.private_probe\.trace_identifiers_committed/);
  rejects((candidate) => {
    candidate.evidence.private_probe.raw_diagnostics_committed = true;
  }, /evidence\.private_probe\.raw_diagnostics_committed/);
  rejects((candidate) => {
    candidate.evidence.private_probe.private_detail = 'must-not-be-accepted';
  }, /evidence\.private_probe must contain exactly/);
});

test('rejects drift or private material claims in user-relay evidence', () => {
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.result_sha256 = '0'.repeat(64);
  }, /evidence\.user_relay_probe\.result_sha256/);
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.missing_app_check_status = 200;
  }, /evidence\.user_relay_probe\.missing_app_check_status/);
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.browser_provider_attestation_validated = true;
  }, /evidence\.user_relay_probe\.browser_provider_attestation_validated/);
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.workflow_present = true;
  }, /evidence\.user_relay_probe\.workflow_present/);
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.verifier_service_present = true;
  }, /evidence\.user_relay_probe\.verifier_service_present/);
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.temporary_bindings_present = true;
  }, /evidence\.user_relay_probe\.temporary_bindings_present/);
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.execution_identifiers_committed = true;
  }, /evidence\.user_relay_probe\.execution_identifiers_committed/);
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.token_material_committed = true;
  }, /evidence\.user_relay_probe\.token_material_committed/);
  rejects((candidate) => {
    candidate.evidence.user_relay_probe.private_detail = 'must-not-be-accepted';
  }, /evidence\.user_relay_probe must contain exactly/);
});

test('rejects drift from the initialized closed Firebase Auth evidence', () => {
  rejects((candidate) => {
    candidate.evidence.firebase_auth_baseline.external_identity_providers = 1;
  }, /evidence\.firebase_auth_baseline\.external_identity_providers/);
  rejects((candidate) => {
    candidate.evidence.firebase_auth_baseline.email_sign_in = true;
  }, /evidence\.firebase_auth_baseline\.email_sign_in/);
  rejects((candidate) => {
    candidate.evidence.firebase_auth_baseline.public_endpoints_created = 1;
  }, /evidence\.firebase_auth_baseline\.public_endpoints_created/);
  rejects((candidate) => {
    candidate.evidence.firebase_auth_baseline.persistent_credentials_created = 1;
  }, /evidence\.firebase_auth_baseline\.persistent_credentials_created/);
  rejects((candidate) => {
    candidate.evidence.firebase_auth_baseline.private_detail = 'must-not-be-accepted';
  }, /evidence\.firebase_auth_baseline must contain exactly/);
});

test('keeps historical CI keyless, recovery retired, and credentials ephemeral', () => {
  rejects((candidate) => {
    candidate.evidence.credential_free_validation = false;
  }, /evidence\.credential_free_validation/);
  rejects((candidate) => {
    candidate.evidence.manual_live_plan_requires_user_adc = false;
  }, /evidence\.manual_live_plan_requires_user_adc/);
  rejects((candidate) => {
    candidate.evidence.historical_ci_plan_used_keyless_oidc = false;
  }, /evidence\.historical_ci_plan_used_keyless_oidc/);
  rejects((candidate) => {
    candidate.evidence.persistent_ci_credentials_allowed = true;
  }, /evidence\.persistent_ci_credentials_allowed/);
  rejects((candidate) => {
    candidate.evidence.active_plan_workflow_present = true;
  }, /evidence\.active_plan_workflow_present/);
  rejects((candidate) => {
    candidate.evidence.active_apply_workflow_present = true;
  }, /evidence\.active_apply_workflow_present/);
  rejects((candidate) => {
    candidate.evidence.recovery_workflow_retired = false;
  }, /evidence\.recovery_workflow_retired/);
  rejects((candidate) => {
    candidate.evidence.staging_wif_providers_disabled = false;
  }, /evidence\.staging_wif_providers_disabled/);
  rejects((candidate) => {
    candidate.evidence.retired_recovery_workflow.id = '1';
  }, /evidence\.retired_recovery_workflow\.id/);
  rejects((candidate) => {
    candidate.evidence.retired_recovery_workflow.state = 'active';
  }, /evidence\.retired_recovery_workflow\.state/);
  rejects((candidate) => {
    candidate.evidence.retired_recovery_workflow.active_file_present = true;
  }, /evidence\.retired_recovery_workflow\.active_file_present/);
  rejects((candidate) => {
    candidate.teardown.automated = true;
  }, /teardown\.automated/);
  rejects((candidate) => {
    candidate.teardown.manual_project_id_confirmation = false;
  }, /teardown\.manual_project_id_confirmation/);
  rejects((candidate) => {
    candidate.teardown.inventory_after_teardown.splice(2, 1);
  }, /teardown\.inventory_after_teardown/);
});
