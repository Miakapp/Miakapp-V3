import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  StagingManifestError,
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

test('accepts reconciled state and the reviewed live foundation plan', () => {
  const validated = validateStagingManifest(manifest());
  assert.equal(validated.revision, 26);
  assert.equal(
    validated.status,
    'foundation_live_plan_reviewed_workflow_installation_pending',
  );
  assert.equal(validated.project.project_id, 'miakapp-v4-staging');
  assert.equal(validated.project.project_number, '1072737219170');
  assert.equal(
    validated.project.lifecycle,
    'firebase_enabled_billing_linked_bootstrap_created_undeployed',
  );
  assert.equal(validated.bootstrap.billing_enabled, true);
  assert.equal(validated.bootstrap.firebase_apps, 0);
  assert.equal(validated.bootstrap.hosting_site, 'miakapp-v4-staging');
  assert.deepEqual(validated.bootstrap.storage_buckets, [
    'miakapp-v4-staging-components',
    'miakapp-v4-staging-tfstate-1072737219170',
  ]);
  assert.equal(validated.locations.primary, 'europe-west9');
  assert.equal(validated.locations.immutable_choice_reviewed, true);
  assert.equal(validated.cost.billing_account.selection_state, 'approved');
  assert.equal(validated.cost.billing_account.link_state, 'linked_to_approved_account');
  assert.equal(
    validated.cost.billing_account.terraform_management_state,
    'managed_in_reconciled_remote_bootstrap_state',
  );
  assert.equal(validated.terraform.state, 'foundation_live_plan_reviewed');
  assert.equal(
    validated.terraform.supported_workflow,
    'credential_free_validation_and_guarded_workflow_installation',
  );
  assert.equal(validated.terraform.configuration_apply_capable, true);
  assert.equal(validated.terraform.active_cloud_workflow, 'none');
  assert.equal(validated.terraform.workflow_blueprint_state, 'dormant_not_installed');
  assert.equal(validated.terraform.backend.type, 'gcs');
  assert.equal(validated.terraform.backend.state, 'bootstrap_and_empty_foundation_state_present');
  assert.equal(
    validated.terraform.backend.bootstrap_migration_state,
    'complete_remote_state_reconciled',
  );
  assert.equal(validated.terraform.identity.state, 'created_not_used_by_active_workflow');
  assert.equal(
    validated.terraform.identity.runtime_service_account,
    'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
  );
  assert.equal(validated.terraform.identity.component_bucket, 'miakapp-v4-staging-components');
  assert.equal(validated.terraform.identity.service_account_keys_allowed, false);
  assert.equal(validated.terraform.identity.bootstrap_state_write_allowed, false);
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
    'applied_private_bundle_retained_as_recovery_evidence',
  );
  assert.equal(validated.terraform.saved_plan.public_artifacts_allowed, false);
  const execution = validated.terraform.bootstrap_execution;
  assert.equal(execution.state, 'bootstrap_complete_state_migrated_and_reconciled');
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
  assert.equal(execution.remote_state.state, 'migrated_and_reconciled');
  assert.equal(execution.remote_state.generation, '1788439334043522');
  assert.equal(
    execution.remote_state.sha256,
    '8753dcceaa848ba8734d9892dbec6f2445fbf6b3fbead7da375cc37f0702d3bf',
  );
  assert.equal(execution.remote_state.serial, 40);
  assert.equal(execution.remote_state.managed_resources, 36);
  assert.equal(execution.remote_state.canonical_serial_increment, 1);
  assert.equal(execution.remote_state.check_results_exact_permutation, true);
  assert.equal(execution.remote_state.remainder_exactly_equal, true);
  assert.equal(
    execution.remote_state.initialization_generation.state,
    'noncurrent_recoverable_empty_state',
  );
  assert.equal(execution.remote_state.initialization_generation.size_bytes, 181);
  assert.equal(execution.remote_state.initialization_generation.managed_resources, 0);
  assert.equal(execution.remote_state.raw_contents_committed, false);
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
  assert.equal(foundationPlan.saved_plan_created, false);
  assert.equal(foundationPlan.apply_executed, false);
  assert.equal(foundationPlan.state_generation_before, '1788443136082489');
  assert.equal(foundationPlan.state_generation_after, '1788443136082489');
  assert.equal(foundationPlan.state_unchanged, true);
  assert.equal(foundationPlan.temporary_lock_released, true);
  assert.equal(foundationPlan.full_plan_reviewed, true);
  assert.equal(foundationPlan.raw_planned_values_committed, false);
  assert.equal(validated.terraform.apply_authorized, false);
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
  assert.equal(validated.evidence.active_cloud_workflow_present, false);
  assert.equal(validated.readiness.required_blockers.includes('github-terraform-workflow-not-installed'), true);
  assert.equal(validated.readiness.required_blockers.includes('foundation-state-not-initialized'), false);
  assert.equal(validated.readiness.required_blockers.includes('live-foundation-plan-not-reviewed'), false);
  assert.equal(validated.readiness.required_blockers.includes('remote-bootstrap-state-not-migrated'), false);
  assert.equal(
    validated.readiness.required_blockers.includes('github-branch-environment-and-actions-policy-not-configured'),
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
  assert.equal(validateFirebaseRc(firebaseRc()).projects.default, 'miakapp-3');
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

test('rejects drift from the observed billing-linked undeployed bootstrap inventory', () => {
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
    candidate.bootstrap.firebase_apps = 1;
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
    candidate.bootstrap.unreviewed = true;
  }, /bootstrap must contain exactly/);
});

test('rejects every cloud-action authorization bit and bootstrap completion drift', () => {
  for (const field of [
    'creation_authorized',
    'billing_link_authorized',
    'deployment_authorized',
    'public_ingress_authorized',
  ]) {
    rejects((candidate) => {
      candidate.project[field] = true;
    }, new RegExp(`project\\.${field}`));
  }
  rejects((candidate) => {
    candidate.readiness.cloud_actions_enabled = true;
  }, /readiness\.cloud_actions_enabled/);
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
    candidate.terraform.bootstrap_execution.remote_state.remainder_exactly_equal = false;
  }, /terraform\.bootstrap_execution\.remote_state\.remainder_exactly_equal/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.remote_state.initialization_generation.managed_resources = 1;
  }, /terraform\.bootstrap_execution\.remote_state\.initialization_generation\.managed_resources/);
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
});

test('rejects broad IAM substitution and premature resolution of FCM access', () => {
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
    candidate.security.iam.unresolved_permissions = [];
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
    candidate.terraform.active_cloud_workflow = 'staging-terraform.yml';
  }, /terraform\.active_cloud_workflow/);
  rejects((candidate) => {
    candidate.terraform.workflow_blueprint_state = 'installed';
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
    candidate.terraform.identity.service_account_keys_allowed = true;
  }, /terraform\.identity\.service_account_keys_allowed/);
  rejects((candidate) => {
    candidate.terraform.identity.bootstrap_state_write_allowed = true;
  }, /terraform\.identity\.bootstrap_state_write_allowed/);
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
    candidate.terraform.apply_authorized = true;
  }, /terraform\.apply_authorized/);
  rejects((candidate) => {
    candidate.terraform.destroy_authorized = true;
  }, /terraform\.destroy_authorized/);
  rejects((candidate) => {
    candidate.terraform.function_deployment_included = true;
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

test('requires every production blocker and staging evidence row', () => {
  rejects((candidate) => {
    candidate.readiness.required_blockers.pop();
  }, /readiness\.required_blockers/);
  rejects((candidate) => {
    candidate.evidence.staging_rows.shift();
  }, /evidence\.staging_rows/);
});

test('forbids CI credentials and automated teardown', () => {
  rejects((candidate) => {
    candidate.evidence.cloud_credentials_required = true;
  }, /evidence\.cloud_credentials_required/);
  rejects((candidate) => {
    candidate.evidence.ci_may_authenticate = true;
  }, /evidence\.ci_may_authenticate/);
  rejects((candidate) => {
    candidate.evidence.active_cloud_workflow_present = true;
  }, /evidence\.active_cloud_workflow_present/);
  rejects((candidate) => {
    candidate.evidence.live_plan_cloud_credentials_required = false;
  }, /evidence\.live_plan_cloud_credentials_required/);
  rejects((candidate) => {
    candidate.teardown.automated = true;
  }, /teardown\.automated/);
  rejects((candidate) => {
    candidate.teardown.manual_project_id_confirmation = false;
  }, /teardown\.manual_project_id_confirmation/);
});
