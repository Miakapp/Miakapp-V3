import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const MAX_POLICY_BYTES = 64 * 1024;

export class GitHubPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitHubPolicyError';
  }
}

function reject(path, message) {
  throw new GitHubPolicyError(`${path} ${message}`);
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

function validateEnvironment(value, path, reviewers) {
  const environment = record(value, path, [
    'name',
    'required_reviewer_ids',
    'prevent_self_review',
    'admin_bypass_allowed',
    'custom_branch_policies',
  ]);
  exact(environment.name, path.endsWith('plan_environment')
    ? 'miakapp-v4-staging-plan'
    : 'miakapp-v4-staging-apply', `${path}.name`);
  exactArray(environment.required_reviewer_ids, reviewers, `${path}.required_reviewer_ids`);
  exact(environment.prevent_self_review, false, `${path}.prevent_self_review`);
  exact(environment.admin_bypass_allowed, false, `${path}.admin_bypass_allowed`);
  exactArray(environment.custom_branch_policies, ['main'], `${path}.custom_branch_policies`);
}

export function validateGitHubPolicy(value, options = {}) {
  const policy = record(value, 'policy', [
    'schema',
    'revision',
    'status',
    'observed_on',
    'repository',
    'observed',
    'required',
    'activation',
  ]);
  exact(policy.schema, 'miakapp.staging-github-policy/1', 'policy.schema');
  exact(policy.revision, 1, 'policy.revision');
  exact(policy.status, 'required_not_configured', 'policy.status');
  exact(policy.observed_on, '2026-09-02', 'policy.observed_on');

  const repository = record(policy.repository, 'repository', [
    'name_with_owner',
    'repository_id',
    'repository_owner_id',
    'visibility',
    'default_branch',
  ]);
  exact(repository.name_with_owner, 'Miakapp/Miakapp-V3', 'repository.name_with_owner');
  exact(repository.repository_id, '354682190', 'repository.repository_id');
  exact(repository.repository_owner_id, '83046838', 'repository.repository_owner_id');
  exact(repository.visibility, 'public', 'repository.visibility');
  exact(repository.default_branch, 'main', 'repository.default_branch');

  const observed = record(policy.observed, 'observed', [
    'main_protected',
    'environment_names',
    'oidc_uses_default_subject',
    'oidc_uses_immutable_subject',
    'oidc_subject_prefix',
    'allowed_actions',
    'sha_pinning_required',
    'default_workflow_permissions',
    'active_workflow_installed',
    'cloud_authentication_enabled',
  ]);
  exact(observed.main_protected, false, 'observed.main_protected');
  exactArray(observed.environment_names, ['miakapi'], 'observed.environment_names');
  exact(observed.oidc_uses_default_subject, true, 'observed.oidc_uses_default_subject');
  exact(observed.oidc_uses_immutable_subject, false, 'observed.oidc_uses_immutable_subject');
  exact(observed.oidc_subject_prefix, 'repo:Miakapp/Miakapp-V3', 'observed.oidc_subject_prefix');
  exact(observed.allowed_actions, 'all', 'observed.allowed_actions');
  exact(observed.sha_pinning_required, false, 'observed.sha_pinning_required');
  exact(observed.default_workflow_permissions, 'write', 'observed.default_workflow_permissions');
  exact(observed.active_workflow_installed, false, 'observed.active_workflow_installed');
  exact(observed.cloud_authentication_enabled, false, 'observed.cloud_authentication_enabled');

  const required = record(policy.required, 'required', [
    'main_branch',
    'plan_environment',
    'apply_environment',
    'actions',
    'oidc',
  ]);
  const main = record(required.main_branch, 'required.main_branch', [
    'protected',
    'enforce_admins',
    'pull_request_required',
    'required_approvals',
    'dismiss_stale_reviews',
    'conversation_resolution_required',
    'strict_status_checks',
    'required_status_checks',
    'force_pushes_allowed',
    'deletions_allowed',
  ]);
  for (const field of [
    'protected',
    'enforce_admins',
    'pull_request_required',
    'dismiss_stale_reviews',
    'conversation_resolution_required',
    'strict_status_checks',
  ]) exact(main[field], true, `required.main_branch.${field}`);
  exact(main.required_approvals, 0, 'required.main_branch.required_approvals');
  exactArray(
    main.required_status_checks,
    ['Staging manifest safety gate / validate'],
    'required.main_branch.required_status_checks',
  );
  exact(main.force_pushes_allowed, false, 'required.main_branch.force_pushes_allowed');
  exact(main.deletions_allowed, false, 'required.main_branch.deletions_allowed');

  validateEnvironment(required.plan_environment, 'required.plan_environment', []);
  validateEnvironment(required.apply_environment, 'required.apply_environment', ['21021423']);

  const actions = record(required.actions, 'required.actions', [
    'allowed_actions',
    'sha_pinning_required',
    'default_workflow_permissions',
    'can_approve_pull_request_reviews',
    'allowed_action_patterns',
  ]);
  exact(actions.allowed_actions, 'selected', 'required.actions.allowed_actions');
  exact(actions.sha_pinning_required, true, 'required.actions.sha_pinning_required');
  exact(actions.default_workflow_permissions, 'read', 'required.actions.default_workflow_permissions');
  exact(actions.can_approve_pull_request_reviews, false, 'required.actions.can_approve_pull_request_reviews');
  exactArray(actions.allowed_action_patterns, [
    'actions/checkout@*',
    'actions/setup-go@*',
    'actions/setup-java@*',
    'actions/setup-node@*',
    'google-github-actions/auth@*',
    'google-github-actions/setup-gcloud@*',
    'hashicorp/setup-terraform@*',
    'oven-sh/setup-bun@*',
  ], 'required.actions.allowed_action_patterns');

  const oidc = record(required.oidc, 'required.oidc', [
    'repository_id_claim',
    'repository_owner_id_claim',
    'ref_claim',
    'workflow_ref_claim',
    'plan_environment_claim',
    'apply_environment_claim',
  ]);
  exact(oidc.repository_id_claim, '354682190', 'required.oidc.repository_id_claim');
  exact(oidc.repository_owner_id_claim, '83046838', 'required.oidc.repository_owner_id_claim');
  exact(oidc.ref_claim, 'refs/heads/main', 'required.oidc.ref_claim');
  exact(
    oidc.workflow_ref_claim,
    'Miakapp/Miakapp-V3/.github/workflows/staging-terraform.yml@refs/heads/main',
    'required.oidc.workflow_ref_claim',
  );
  exact(oidc.plan_environment_claim, 'miakapp-v4-staging-plan', 'required.oidc.plan_environment_claim');
  exact(oidc.apply_environment_claim, 'miakapp-v4-staging-apply', 'required.oidc.apply_environment_claim');

  const activation = record(policy.activation, 'activation', [
    'policy_observation_verified',
    'workflow_install_authorized',
    'cloud_bootstrap_authorized',
    'active_workflow_path',
    'blueprint_path',
  ]);
  exact(activation.policy_observation_verified, false, 'activation.policy_observation_verified');
  exact(activation.workflow_install_authorized, false, 'activation.workflow_install_authorized');
  exact(activation.cloud_bootstrap_authorized, false, 'activation.cloud_bootstrap_authorized');
  exact(activation.active_workflow_path, '.github/workflows/staging-terraform.yml', 'activation.active_workflow_path');
  exact(
    activation.blueprint_path,
    'infrastructure/staging/automation/staging-terraform.yml',
    'activation.blueprint_path',
  );

  if (options.requireActivation === true) {
    reject('activation', 'has not been independently verified and authorized');
  }
  return policy;
}

export function readGitHubPolicy(path) {
  const absolute = resolve(path);
  const metadata = statSync(absolute, { throwIfNoEntry: false });
  if (metadata === undefined || !metadata.isFile()) reject('policy file', 'must be a regular file');
  if (metadata.size > MAX_POLICY_BYTES) reject('policy file', `must be at most ${MAX_POLICY_BYTES} bytes`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    reject('policy file', 'must contain valid JSON');
  }
  return validateGitHubPolicy(parsed);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const requireActivation = args[0] === '--require-activation';
  const path = requireActivation ? args[1] : args[0];
  if (path === undefined || args.length !== (requireActivation ? 2 : 1)) {
    console.error('Usage: node validate-policy.mjs [--require-activation] <github-policy.json>');
    process.exitCode = 2;
  } else {
    try {
      const policy = readGitHubPolicy(path);
      validateGitHubPolicy(policy, { requireActivation });
      console.log(`Validated ${policy.schema}; cloud automation remains inactive.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`GitHub policy rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
