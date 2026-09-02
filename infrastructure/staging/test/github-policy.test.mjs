import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateAutomationRoot } from '../automation/guard.mjs';
import { readGitHubPolicy, validateGitHubPolicy } from '../automation/validate-policy.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);
const automationRoot = new URL('../automation/', import.meta.url);
const policyPath = fileURLToPath(new URL('github-policy.json', automationRoot));
const policy = readGitHubPolicy(policyPath);
const workflow = readFileSync(new URL('staging-terraform.yml', automationRoot), 'utf8');
const planScript = readFileSync(new URL('plan.sh', automationRoot), 'utf8');
const applyScript = readFileSync(new URL('apply.sh', automationRoot), 'utf8');
const inspectScript = readFileSync(new URL('inspect-plan.sh', automationRoot), 'utf8');
const summaryPath = fileURLToPath(new URL('summarize-plan.mjs', automationRoot));

function clone(value) {
  return structuredClone(value);
}

function rejects(mutator, pattern) {
  const candidate = clone(policy);
  mutator(candidate);
  assert.throws(() => validateGitHubPolicy(candidate), pattern);
}

function runScript(name, environment, args = []) {
  return spawnSync(fileURLToPath(new URL(name, automationRoot)), args, {
    cwd: fileURLToPath(repositoryRoot),
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      ...environment,
    },
  });
}

function exactGitHubEnvironment(kind) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'Miakapp/Miakapp-V3',
    GITHUB_REPOSITORY_ID: '354682190',
    GITHUB_REPOSITORY_OWNER_ID: '83046838',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: 'Miakapp/Miakapp-V3/.github/workflows/staging-terraform.yml@refs/heads/main',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '123456789',
    GITHUB_RUN_ATTEMPT: '1',
    MIAKAPP_GITHUB_ENVIRONMENT: `miakapp-v4-staging-${kind}`,
  };
}

test('records the verified GitHub security posture without treating it as cloud activation', () => {
  assert.equal(policy.status, 'github_security_configured_cloud_inactive');
  assert.deepEqual(policy.observed.main_branch, policy.required.main_branch);
  assert.deepEqual(policy.observed.environment_names, [
    'miakapi',
    'miakapp-v4-staging-apply',
    'miakapp-v4-staging-plan',
  ]);
  assert.deepEqual(policy.observed.plan_environment, policy.required.plan_environment);
  assert.deepEqual(policy.observed.apply_environment, policy.required.apply_environment);
  assert.deepEqual(policy.observed.actions, policy.required.actions);
  assert.equal(policy.observed.active_workflow_installed, false);
  assert.equal(policy.observed.cloud_authentication_enabled, false);
  assert.deepEqual(policy.activation, {
    policy_observation_verified: true,
    workflow_install_authorized: false,
    cloud_bootstrap_authorized: false,
    active_workflow_path: '.github/workflows/staging-terraform.yml',
    blueprint_path: 'infrastructure/staging/automation/staging-terraform.yml',
  });
  assert.equal(statSync(new URL('../../../.github/workflows/staging-terraform.yml', import.meta.url), { throwIfNoEntry: false }), undefined);
});

test('rejects policy weakening, activation self-claims, and unknown fields', () => {
  rejects((candidate) => { candidate.observed.main_branch.protected = false; }, /observed\.main_branch\.protected/);
  rejects((candidate) => {
    candidate.observed.main_branch.required_status_checks[0].app_id = '1';
  }, /observed\.main_branch\.required_status_checks\[0\]\.app_id/);
  rejects((candidate) => { candidate.observed.apply_environment.required_reviewer_ids = []; }, /required_reviewer_ids/);
  rejects((candidate) => { candidate.observed.actions.github_owned_allowed = true; }, /github_owned_allowed/);
  rejects((candidate) => { candidate.required.main_branch.enforce_admins = false; }, /enforce_admins/);
  rejects((candidate) => {
    candidate.required.main_branch.required_status_checks[0].app_id = '1';
  }, /required\.main_branch\.required_status_checks\[0\]\.app_id/);
  rejects((candidate) => { candidate.required.main_branch.force_pushes_allowed = true; }, /force_pushes_allowed/);
  rejects((candidate) => { candidate.required.apply_environment.required_reviewer_ids = []; }, /required_reviewer_ids/);
  rejects((candidate) => { candidate.required.apply_environment.admin_bypass_allowed = true; }, /admin_bypass_allowed/);
  rejects((candidate) => { candidate.required.actions.sha_pinning_required = false; }, /sha_pinning_required/);
  rejects((candidate) => { candidate.required.actions.allowed_actions = 'all'; }, /allowed_actions/);
  rejects((candidate) => { candidate.required.oidc.repository_id_claim = 'Miakapp/Miakapp-V3'; }, /repository_id_claim/);
  rejects((candidate) => { candidate.activation.workflow_install_authorized = true; }, /workflow_install_authorized/);
  rejects((candidate) => { candidate.unreviewed = true; }, /must contain exactly/);
  assert.throws(
    () => validateGitHubPolicy(policy, { requireActivation: true }),
    /still forbids workflow installation and cloud bootstrap/,
  );
});

test('the policy CLI fails closed without a stack trace when activation is absent', () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('validate-policy.mjs', automationRoot)),
    '--require-activation',
    policyPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^GitHub policy rejected: activation still forbids workflow installation and cloud bootstrap\n$/);
  assert.equal(result.stdout, '');
});

test('keeps the workflow dormant, manual, least-permission, and environment-separated', () => {
  assert.doesNotThrow(() => validateAutomationRoot(automationRoot));
  assert.match(workflow, /^name: Staging Terraform activation/m);
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /pull_request:|\npush:/);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /node infrastructure\/staging\/automation\/validate-policy\.mjs \\\n            --require-activation/);
  assert.match(workflow, /environment: miakapp-v4-staging-plan/);
  assert.match(workflow, /environment: miakapp-v4-staging-apply/);
  assert.match(workflow, /if: inputs\.operation == 'plan-and-apply'/);
  assert.equal((workflow.match(/id-token: write/g) ?? []).length, 2);
  assert.equal((workflow.match(/contents: read/g) ?? []).length, 3);
  assert.equal((workflow.match(/version: '541\.0\.0'/g) ?? []).length, 2);
  assert.equal((workflow.match(/terraform_version: 1\.11\.3/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /pull-requests:\s*write|contents:\s*write|actions:\s*write/);
});

test('pins every active or blueprint action and limits action origins to policy', () => {
  const workflowUrls = readdirSync(new URL('../../../.github/workflows/', import.meta.url))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => new URL(`../../../.github/workflows/${name}`, import.meta.url));
  workflowUrls.push(new URL('staging-terraform.yml', automationRoot));
  const allowed = policy.required.actions.allowed_action_patterns.map((pattern) => pattern.slice(0, -2));
  for (const url of workflowUrls) {
    const source = readFileSync(url, 'utf8');
    for (const [, action, revision] of source.matchAll(/uses:\s+([^\s@]+)@([0-9a-f]+)/g)) {
      assert.equal(revision.length, 40, `${url.pathname}: ${action}`);
      assert.equal(allowed.includes(action), true, `${url.pathname}: ${action}`);
    }
    assert.doesNotMatch(source, /uses:\s+[^\s@]+@(main|master|v\d+(?:\.\d+)*)\b/);
  }
});

test('stores a create-only private plan and applies only its same-run digest', () => {
  assert.match(planScript, /plans\/\$\{GITHUB_SHA\}\/\$\{GITHUB_RUN_ID\}\/\$\{GITHUB_RUN_ATTEMPT\}\/foundation\.tfplan/);
  assert.match(planScript, /--if-generation-match=0/);
  assert.match(planScript, /plan-sha256/);
  assert.match(planScript, /summarize-plan\.mjs/);
  assert.doesNotMatch(`${workflow}\n${planScript}\n${applyScript}`, /upload-artifact|download-artifact/);
  assert.match(applyScript, /expected_object="gs:\/\/miakapp-v4-staging-tfstate-1072737219170\/plans/);
  assert.match(applyScript, /actual_sha256/);
  assert.match(applyScript, /\$actual_sha256" != "\$MIAKAPP_PLAN_SHA256/);
  assert.match(applyScript, /terraform -chdir="\$terraform_root" apply/);
  assert.doesNotMatch(planScript, /terraform -chdir="\$terraform_root" apply/);
});

test('rejects wrong GitHub context and non-canonical run identifiers before credentials', () => {
  for (const [name, value] of [
    ['GITHUB_REPOSITORY_ID', '1'],
    ['GITHUB_REPOSITORY_OWNER_ID', '1'],
    ['GITHUB_REF', 'refs/heads/feature'],
    ['GITHUB_WORKFLOW_REF', 'Miakapp/Miakapp-V3/.github/workflows/other.yml@refs/heads/main'],
    ['MIAKAPP_GITHUB_ENVIRONMENT', 'miakapp-v4-staging-apply'],
  ]) {
    const result = runScript('plan.sh', { ...exactGitHubEnvironment('plan'), [name]: value });
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, /plan context does not match/);
  }
  const result = runScript('plan.sh', { ...exactGitHubEnvironment('plan'), GITHUB_SHA: '../escape' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /run identifiers are not canonical/);
});

test('rejects credential symlinks and ambient provider or gcloud overrides', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-staging-automation-'));
  const output = join(temporary, 'github-output');
  const credential = fileURLToPath(new URL(`../../../gha-creds-test-${process.pid}.json`, import.meta.url));
  writeFileSync(output, '', { mode: 0o600 });
  writeFileSync(credential, '{}\n', { flag: 'wx', mode: 0o600 });
  const base = {
    ...exactGitHubEnvironment('plan'),
    GITHUB_OUTPUT: output,
    GOOGLE_APPLICATION_CREDENTIALS: credential,
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: credential,
    GOOGLE_GHA_CREDS_PATH: credential,
  };
  try {
    for (const [name, value] of [
      ['TF_DATA_DIR', '/tmp/unreviewed'],
      ['TF_VAR_unreviewed', 'value'],
      ['GOOGLE_FIRESTORE_CUSTOM_ENDPOINT', 'https://attacker.example.test'],
      ['GOOGLE_OAUTH_ACCESS_TOKEN', 'synthetic-token'],
      ['CLOUDSDK_CONFIG', '/tmp/unreviewed'],
    ]) {
      const result = runScript('plan.sh', { ...base, [name]: value });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, /Unreviewed Terraform or Google overrides are forbidden/);
    }
    const wrongProject = runScript('plan.sh', { ...base, GOOGLE_CLOUD_PROJECT: 'miakapp-3' });
    assert.equal(wrongProject.status, 1);
    assert.match(wrongProject.stderr, /project environment does not match/);
  } finally {
    unlinkSync(credential);
    rmSync(temporary, { recursive: true });
  }

  const target = join(tmpdir(), `miakapp-synthetic-credential-${process.pid}.json`);
  const link = fileURLToPath(new URL(`../../../gha-creds-link-${process.pid}.json`, import.meta.url));
  writeFileSync(target, '{}\n', { flag: 'wx', mode: 0o600 });
  symlinkSync(target, link);
  const secondTemporary = mkdtempSync(join(tmpdir(), 'miakapp-staging-output-'));
  const secondOutput = join(secondTemporary, 'github-output');
  writeFileSync(secondOutput, '', { mode: 0o600 });
  try {
    const result = runScript('plan.sh', {
      ...exactGitHubEnvironment('plan'),
      GITHUB_OUTPUT: secondOutput,
      GOOGLE_APPLICATION_CREDENTIALS: link,
      CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: link,
      GOOGLE_GHA_CREDS_PATH: link,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /credential file is missing/);
  } finally {
    unlinkSync(link);
    unlinkSync(target);
    rmSync(secondTemporary, { recursive: true });
  }
});

test('rejects a foreign plan object before the apply job can use credentials', () => {
  const environment = {
    ...exactGitHubEnvironment('apply'),
    MIAKAPP_PLAN_OBJECT: 'gs://attacker.example/foundation.tfplan',
    MIAKAPP_PLAN_SHA256: 'b'.repeat(64),
  };
  const result = runScript('apply.sh', environment);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact plan produced by this workflow attempt/);
});

test('summarizes only bounded Terraform action metadata', () => {
  const plan = {
    resource_changes: [
      {
        address: 'google_secret_manager_secret.runtime["safe"]',
        change: {
          actions: ['create'],
          before: { secret_data: 'must-not-appear' },
          after: { secret_data: 'also-private' },
        },
      },
      { address: 'google_project.staging', change: { actions: ['read'] } },
    ],
  };
  const result = spawnSync(process.execPath, [summaryPath], {
    input: JSON.stringify(plan),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /create: google_secret_manager_secret\.runtime\["safe"\]/);
  assert.doesNotMatch(result.stdout, /must-not-appear|also-private|secret_data/);

  const hostile = spawnSync(process.execPath, [summaryPath], {
    input: JSON.stringify({ resource_changes: [{ address: 'safe', change: { actions: ['create\nsecret'] } }] }),
    encoding: 'utf8',
  });
  assert.notEqual(hostile.status, 0);
  assert.doesNotMatch(hostile.stdout, /secret/);

  const oversizedCollection = spawnSync(process.execPath, [summaryPath], {
    input: JSON.stringify({
      resource_changes: Array.from({ length: 257 }, (_, index) => ({
        address: `terraform_data.item["${index}"]`,
        change: { actions: ['no-op'] },
      })),
    }),
    encoding: 'utf8',
  });
  assert.notEqual(oversizedCollection.status, 0);
});

test('keeps local plan inspection read-only and scoped to canonical private objects', () => {
  assert.match(inspectScript, /\^gs:\/\/miakapp-v4-staging-tfstate-1072737219170\/plans\//);
  assert.match(inspectScript, /terraform show -no-color/);
  assert.doesNotMatch(inspectScript, /terraform (apply|destroy)|gcloud storage (rm|mv)/);
  const result = runScript('inspect-plan.sh', {}, ['gs://attacker.example/plan', 'a'.repeat(64)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a canonical Miakapp staging plan/);
});

test('rejects unreviewed automation files', () => {
  const unexpected = new URL('unreviewed.yml', automationRoot);
  writeFileSync(unexpected, 'name: unsafe\n', { flag: 'wx', mode: 0o600 });
  try {
    assert.throws(() => validateAutomationRoot(automationRoot), /reviewed blueprint inventory/);
  } finally {
    unlinkSync(unexpected);
  }
});
