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

test('accepts the reviewed import recovery plan without deployment authorization', () => {
  const validated = validateStagingManifest(manifest());
  assert.equal(validated.revision, 17);
  assert.equal(
    validated.status,
    'bootstrap_import_plan_reviewed_billing_linked_undeployed',
  );
  assert.equal(validated.project.project_id, 'miakapp-v4-staging');
  assert.equal(validated.project.project_number, '1072737219170');
  assert.equal(validated.project.lifecycle, 'firebase_enabled_billing_linked_undeployed');
  assert.equal(validated.bootstrap.billing_enabled, true);
  assert.equal(validated.bootstrap.firebase_apps, 0);
  assert.equal(validated.bootstrap.hosting_site, 'miakapp-v4-staging');
  assert.deepEqual(validated.bootstrap.storage_buckets, []);
  assert.equal(validated.locations.primary, 'europe-west9');
  assert.equal(validated.locations.immutable_choice_reviewed, true);
  assert.equal(validated.cost.billing_account.selection_state, 'approved');
  assert.equal(validated.cost.billing_account.link_state, 'linked_to_approved_account');
  assert.equal(
    validated.cost.billing_account.terraform_management_state,
    'active_outside_terraform_state',
  );
  assert.equal(validated.terraform.state, 'bootstrap_foundation_and_automation_blueprint');
  assert.equal(
    validated.terraform.supported_workflow,
    'credential_free_validation_and_guarded_bootstrap_execution',
  );
  assert.equal(validated.terraform.configuration_apply_capable, true);
  assert.equal(validated.terraform.active_cloud_workflow, 'none');
  assert.equal(validated.terraform.workflow_blueprint_state, 'dormant_not_installed');
  assert.equal(validated.terraform.backend.type, 'gcs');
  assert.equal(validated.terraform.backend.state, 'configured_bucket_not_created');
  assert.equal(validated.terraform.backend.bootstrap_migration_state, 'template_not_activated');
  assert.equal(validated.terraform.identity.state, 'configured_not_created');
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
  assert.equal(validated.terraform.saved_plan.state, 'private_gcs_blueprint_not_active');
  assert.equal(validated.terraform.saved_plan.public_artifacts_allowed, false);
  assert.deepEqual(validated.terraform.bootstrap_execution, {
    state: 'guarded_import_wrapper_committed_inactive',
    script: 'bootstrap/apply-and-migrate.sh',
    helper: 'bootstrap/bootstrap-execution.mjs',
    approved_configuration_commit: '6340bffbddcc4797067ef48170fc5c3524345bf2',
    approved_plan_sha256: '6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457',
    exact_authorization_required: true,
    cloud_preflight_required: true,
    budget_preflight_deferred_only_when_api_disabled: true,
    budget_postcondition_required: true,
    partial_state_migration_attempted: true,
    local_recovery_preserved_on_failure: true,
    local_state_removed_only_after_reconciliation: true,
    authorized_plan_attempted: false,
    prior_attempt: {
      configuration_commit: 'c192f97959833f53a19d4e6dc50b26292c88b3b5',
      plan_sha256: '0918d21c4677ce0958be9ccc43057d8d76a33857fdfbea066120ba953e30b5c1',
      attempted_on: '2026-09-03',
      result: 'billing_association_quota_before_resource_creation',
      cloud_resources_created: 0,
      remote_state_migrated: false,
    },
    executed: false,
  });
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
    '6340bffbddcc4797067ef48170fc5c3524345bf2',
  );
  assert.equal(
    validated.terraform.local_saved_plan_observation.plan_sha256,
    '6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457',
  );
  assert.deepEqual(validated.terraform.local_saved_plan_observation.result, {
    create: 35,
    import: 1,
    update: 1,
    delete: 0,
  });
  assert.equal(validated.terraform.local_saved_plan_observation.private_bundle_outside_repository, true);
  assert.equal(validated.terraform.local_saved_plan_observation.private_bundle_path_committed, false);
  assert.equal(validated.terraform.local_saved_plan_observation.planned_values_committed, false);
  assert.equal(
    validated.terraform.local_saved_plan_observation.raw_billing_account_identifier_committed,
    false,
  );
  assert.equal(validated.terraform.local_saved_plan_observation.binary_digest_verified, true);
  assert.equal(validated.terraform.local_saved_plan_observation.binary_plan_matches_metadata, true);
  assert.equal(validated.terraform.local_saved_plan_observation.full_plan_reviewed, true);
  assert.equal(validated.terraform.local_saved_plan_observation.billing_import_preserves_account, true);
  assert.equal(validated.terraform.local_saved_plan_observation.billing_update_cloud_api_expected, false);
  assert.equal(validated.terraform.local_saved_plan_observation.local_state_artifacts_created, false);
  assert.equal(validated.terraform.local_saved_plan_observation.apply_authorized, false);
  assert.equal(validated.terraform.local_saved_plan_observation.apply_executed, false);
  assert.equal(validated.terraform.local_saved_plan_observation.state_migration_authorized, false);
  assert.equal(validated.terraform.local_saved_plan_observation.state_migration_executed, false);
  assert.equal(validated.evidence.github_policy_observation_verified, true);
  assert.equal(validated.evidence.active_cloud_workflow_present, false);
  assert.equal(validated.readiness.required_blockers.includes('github-terraform-workflow-not-installed'), true);
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

test('rejects every cloud-action authorization bit', () => {
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
    candidate.terraform.bootstrap_execution.executed = true;
  }, /terraform\.bootstrap_execution\.executed/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.state = 'authorized';
  }, /terraform\.bootstrap_execution\.state/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.approved_plan_sha256 = '0'.repeat(64);
  }, /terraform\.bootstrap_execution\.approved_plan_sha256/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.local_recovery_preserved_on_failure = false;
  }, /terraform\.bootstrap_execution\.local_recovery_preserved_on_failure/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.budget_preflight_deferred_only_when_api_disabled = false;
  }, /terraform\.bootstrap_execution\.budget_preflight_deferred_only_when_api_disabled/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.budget_postcondition_required = false;
  }, /terraform\.bootstrap_execution\.budget_postcondition_required/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.prior_attempt.cloud_resources_created = 1;
  }, /terraform\.bootstrap_execution\.prior_attempt\.cloud_resources_created/);
  rejects((candidate) => {
    candidate.terraform.bootstrap_execution.prior_attempt.remote_state_migrated = true;
  }, /terraform\.bootstrap_execution\.prior_attempt\.remote_state_migrated/);
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
    candidate.terraform.local_saved_plan_observation.result.delete = 1;
  }, /terraform\.local_saved_plan_observation\.result\.delete/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.private_bundle_path_committed = true;
  }, /terraform\.local_saved_plan_observation\.private_bundle_path_committed/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.raw_billing_account_identifier_committed = true;
  }, /terraform\.local_saved_plan_observation\.raw_billing_account_identifier_committed/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.full_plan_reviewed = false;
  }, /terraform\.local_saved_plan_observation\.full_plan_reviewed/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.billing_import_preserves_account = false;
  }, /terraform\.local_saved_plan_observation\.billing_import_preserves_account/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.billing_update_cloud_api_expected = true;
  }, /terraform\.local_saved_plan_observation\.billing_update_cloud_api_expected/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.apply_authorized = true;
  }, /terraform\.local_saved_plan_observation\.apply_authorized/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.state_migration_executed = true;
  }, /terraform\.local_saved_plan_observation\.state_migration_executed/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.post_inspection_checks.pop();
  }, /terraform\.local_saved_plan_observation\.post_inspection_checks/);
  rejects((candidate) => {
    candidate.terraform.local_saved_plan_observation.secret = 'must-not-be-accepted';
  }, /terraform\.local_saved_plan_observation must contain exactly/);
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
