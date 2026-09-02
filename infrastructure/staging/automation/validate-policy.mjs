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

function validateStatusChecks(value, path) {
  if (!Array.isArray(value)) reject(path, 'must be an array');
  if (value.length !== 1) reject(path, 'must contain exactly 1 entry');
  const check = record(value[0], `${path}[0]`, ['context', 'app_id']);
  exact(check.context, 'Staging manifest safety gate / validate', `${path}[0].context`);
  exact(check.app_id, '15368', `${path}[0].app_id`);
}

function validateMainBranch(value, path) {
  const main = record(value, path, [
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
  ]) exact(main[field], true, `${path}.${field}`);
  exact(main.required_approvals, 0, `${path}.required_approvals`);
  validateStatusChecks(main.required_status_checks, `${path}.required_status_checks`);
  exact(main.force_pushes_allowed, false, `${path}.force_pushes_allowed`);
  exact(main.deletions_allowed, false, `${path}.deletions_allowed`);
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

function validateActions(value, path) {
  const actions = record(value, path, [
    'allowed_actions',
    'sha_pinning_required',
    'default_workflow_permissions',
    'can_approve_pull_request_reviews',
    'github_owned_allowed',
    'verified_allowed',
    'allowed_action_patterns',
  ]);
  exact(actions.allowed_actions, 'selected', `${path}.allowed_actions`);
  exact(actions.sha_pinning_required, true, `${path}.sha_pinning_required`);
  exact(actions.default_workflow_permissions, 'read', `${path}.default_workflow_permissions`);
  exact(actions.can_approve_pull_request_reviews, false, `${path}.can_approve_pull_request_reviews`);
  exact(actions.github_owned_allowed, false, `${path}.github_owned_allowed`);
  exact(actions.verified_allowed, false, `${path}.verified_allowed`);
  exactArray(actions.allowed_action_patterns, [
    'actions/checkout@*',
    'actions/setup-go@*',
    'actions/setup-java@*',
    'actions/setup-node@*',
    'google-github-actions/auth@*',
    'google-github-actions/setup-gcloud@*',
    'hashicorp/setup-terraform@*',
    'oven-sh/setup-bun@*',
  ], `${path}.allowed_action_patterns`);
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
  exact(policy.revision, 2, 'policy.revision');
  exact(policy.status, 'github_security_configured_cloud_inactive', 'policy.status');
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
    'main_branch',
    'environment_names',
    'plan_environment',
    'apply_environment',
    'oidc_uses_default_subject',
    'oidc_uses_immutable_subject',
    'oidc_subject_prefix',
    'actions',
    'active_workflow_installed',
    'cloud_authentication_enabled',
  ]);
  validateMainBranch(observed.main_branch, 'observed.main_branch');
  exactArray(
    observed.environment_names,
    ['miakapi', 'miakapp-v4-staging-apply', 'miakapp-v4-staging-plan'],
    'observed.environment_names',
  );
  validateEnvironment(observed.plan_environment, 'observed.plan_environment', []);
  validateEnvironment(observed.apply_environment, 'observed.apply_environment', ['21021423']);
  exact(observed.oidc_uses_default_subject, true, 'observed.oidc_uses_default_subject');
  exact(observed.oidc_uses_immutable_subject, false, 'observed.oidc_uses_immutable_subject');
  exact(observed.oidc_subject_prefix, 'repo:Miakapp/Miakapp-V3', 'observed.oidc_subject_prefix');
  validateActions(observed.actions, 'observed.actions');
  exact(observed.active_workflow_installed, false, 'observed.active_workflow_installed');
  exact(observed.cloud_authentication_enabled, false, 'observed.cloud_authentication_enabled');

  const required = record(policy.required, 'required', [
    'main_branch',
    'plan_environment',
    'apply_environment',
    'actions',
    'oidc',
  ]);
  validateMainBranch(required.main_branch, 'required.main_branch');

  validateEnvironment(required.plan_environment, 'required.plan_environment', []);
  validateEnvironment(required.apply_environment, 'required.apply_environment', ['21021423']);

  validateActions(required.actions, 'required.actions');

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
  exact(activation.policy_observation_verified, true, 'activation.policy_observation_verified');
  exact(activation.workflow_install_authorized, false, 'activation.workflow_install_authorized');
  exact(activation.cloud_bootstrap_authorized, false, 'activation.cloud_bootstrap_authorized');
  exact(activation.active_workflow_path, '.github/workflows/staging-terraform.yml', 'activation.active_workflow_path');
  exact(
    activation.blueprint_path,
    'infrastructure/staging/automation/staging-terraform.yml',
    'activation.blueprint_path',
  );

  if (options.requireActivation === true) {
    reject('activation', 'still forbids workflow installation and cloud bootstrap');
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
