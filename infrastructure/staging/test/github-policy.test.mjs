import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
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
import {
  readGitHubPolicy,
  validateGitHubPolicy,
  verifyInstalledWorkflow,
} from '../automation/validate-policy.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);
const automationRoot = new URL('../automation/', import.meta.url);
const policyPath = fileURLToPath(new URL('github-policy.json', automationRoot));
const policy = readGitHubPolicy(policyPath);
const workflow = readFileSync(new URL('staging-terraform.yml', automationRoot), 'utf8');
const activeWorkflow = readFileSync(
  new URL('../../../.github/workflows/staging-terraform.yml', import.meta.url),
  'utf8',
);
const planScript = readFileSync(new URL('plan.sh', automationRoot), 'utf8');
const applyScript = readFileSync(new URL('apply.sh', automationRoot), 'utf8');
const inspectScript = readFileSync(new URL('inspect-plan.sh', automationRoot), 'utf8');
const summaryPath = fileURLToPath(new URL('summarize-plan.mjs', automationRoot));
const checkScript = readFileSync(new URL('../check.sh', import.meta.url), 'utf8');

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
  const environment = {
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
  if (kind === 'plan') {
    environment.CLOUDSDK_METRICS_ENVIRONMENT = 'github-actions-setup-gcloud';
    environment.CLOUDSDK_METRICS_ENVIRONMENT_VERSION = '3.0.1';
  }
  return environment;
}

test('authorizes only the hash-bound manual plan workflow after verified GitHub posture', () => {
  assert.equal(policy.status, 'manual_keyless_plan_workflow_authorized');
  assert.equal(policy.observation_context, 'default_branch_before_this_change');
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
    workflow_install_authorized: true,
    cloud_plan_authorized: true,
    foundation_apply_authorized: false,
    active_workflow_path: '.github/workflows/staging-terraform.yml',
    blueprint_path: 'infrastructure/staging/automation/staging-terraform.yml',
    workflow_sha256: '13fd21ad1fa1fdbfec88cefc4af048643eb7a2078d8f33eb0e840c54a3238336',
  });
  assert.equal(
    statSync(new URL('../../../.github/workflows/staging-terraform.yml', import.meta.url)).isFile(),
    true,
  );
  assert.equal(activeWorkflow, workflow);
  assert.match(checkScript, /--require-plan-activation/);
  assert.equal(
    verifyInstalledWorkflow(fileURLToPath(repositoryRoot), policy),
    policy.activation.workflow_sha256,
  );
  assert.doesNotThrow(() => validateGitHubPolicy(policy, { requirePlanActivation: true }));
  assert.throws(
    () => validateGitHubPolicy(policy, { requireApplyActivation: true }),
    /activation\.foundation_apply_authorized/,
  );
});

test('rejects policy weakening, broader activation, and unknown fields', () => {
  rejects((candidate) => { candidate.observation_context = 'after-installation'; }, /observation_context/);
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
  rejects((candidate) => { candidate.activation.workflow_install_authorized = false; }, /workflow_install_authorized/);
  rejects((candidate) => { candidate.activation.cloud_plan_authorized = false; }, /cloud_plan_authorized/);
  rejects((candidate) => { candidate.activation.foundation_apply_authorized = true; }, /foundation_apply_authorized/);
  rejects((candidate) => { candidate.activation.workflow_sha256 = '0'.repeat(64); }, /workflow_sha256/);
  rejects((candidate) => { candidate.unreviewed = true; }, /must contain exactly/);
});

test('the policy CLI accepts planning and rejects apply without a stack trace', () => {
  const planResult = spawnSync(process.execPath, [
    fileURLToPath(new URL('validate-policy.mjs', automationRoot)),
    '--require-plan-activation',
    policyPath,
  ], { encoding: 'utf8' });
  assert.equal(planResult.status, 0, planResult.stderr);
  assert.match(planResult.stdout, /manual keyless planning is authorized/);
  assert.equal(planResult.stderr, '');

  const applyResult = spawnSync(process.execPath, [
    fileURLToPath(new URL('validate-policy.mjs', automationRoot)),
    '--require-apply-activation',
    policyPath,
  ], { encoding: 'utf8' });
  assert.equal(applyResult.status, 1);
  assert.match(
    applyResult.stderr,
    /^GitHub policy rejected: activation\.foundation_apply_authorized must equal true\n$/,
  );
  assert.equal(applyResult.stdout, '');
});

test('keeps the installed workflow manual, plan-only, and least-permission', () => {
  assert.doesNotThrow(() => validateAutomationRoot(automationRoot));
  assert.equal(activeWorkflow, workflow);
  assert.match(workflow, /^name: Staging Terraform plan/m);
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /pull_request:|\npush:/);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /node infrastructure\/staging\/automation\/validate-policy\.mjs \\\n            --require-plan-activation/);
  assert.match(workflow, /environment: miakapp-v4-staging-plan/);
  assert.doesNotMatch(workflow, /miakapp-v4-staging-apply|plan-and-apply|automation\/apply\.sh/);
  assert.equal((workflow.match(/id-token: write/g) ?? []).length, 1);
  assert.equal((workflow.match(/contents: read/g) ?? []).length, 2);
  assert.equal((workflow.match(/version: '541\.0\.0'/g) ?? []).length, 1);
  assert.equal((workflow.match(/terraform_version: 1\.11\.3/g) ?? []).length, 1);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.equal((workflow.match(/cleanup_credentials: true/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /\bsecrets:|\$\{\{\s*secrets\./);
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

test('stores a create-only private plan and keeps apply dormant behind separate authorization', () => {
  assert.match(planScript, /plans\/\$\{GITHUB_SHA\}\/\$\{GITHUB_RUN_ID\}\/\$\{GITHUB_RUN_ATTEMPT\}\/foundation\.tfplan/);
  assert.match(planScript, /--if-generation-match=0/);
  assert.match(planScript, /plan-sha256/);
  assert.match(planScript, /summarize-plan\.mjs/);
  assert.doesNotMatch(`${workflow}\n${planScript}\n${applyScript}`, /upload-artifact|download-artifact/);
  assert.match(applyScript, /expected_object="gs:\/\/miakapp-v4-staging-tfstate-1072737219170\/plans/);
  assert.match(applyScript, /actual_sha256/);
  assert.match(applyScript, /\$actual_sha256" != "\$MIAKAPP_PLAN_SHA256/);
  assert.match(applyScript, /terraform -chdir="\$terraform_root" apply/);
  assert.match(applyScript, /--require-apply-activation/);
  assert.doesNotMatch(planScript, /terraform -chdir="\$terraform_root" apply/);
  assert.doesNotMatch(workflow, /apply\.sh|plan-and-apply/);
});

test('rejects drift between the active workflow, blueprint, and policy digest', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-workflow-installation-test-'));
  const activeDirectory = join(temporary, '.github', 'workflows');
  const blueprintDirectory = join(temporary, 'infrastructure', 'staging', 'automation');
  mkdirSync(activeDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(blueprintDirectory, { recursive: true, mode: 0o700 });
  const activePath = join(activeDirectory, 'staging-terraform.yml');
  const blueprintPath = join(blueprintDirectory, 'staging-terraform.yml');
  try {
    writeFileSync(activePath, workflow, { mode: 0o600 });
    writeFileSync(blueprintPath, workflow, { mode: 0o600 });
    assert.equal(verifyInstalledWorkflow(temporary, policy), policy.activation.workflow_sha256);
    writeFileSync(activePath, `${workflow}\n# drift\n`, { mode: 0o600 });
    assert.throws(
      () => verifyInstalledWorkflow(temporary, policy),
      /must exactly match the reviewed blueprint/,
    );
    writeFileSync(blueprintPath, `${workflow}\n# drift\n`, { mode: 0o600 });
    assert.throws(
      () => verifyInstalledWorkflow(temporary, policy),
      /active workflow SHA-256/,
    );
  } finally {
    rmSync(temporary, { recursive: true });
  }
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
  const commands = join(temporary, 'commands');
  const output = join(temporary, 'github-output');
  const credential = fileURLToPath(new URL(`../../../gha-creds-test-${process.pid}.json`, import.meta.url));
  mkdirSync(commands, { mode: 0o700 });
  writeFileSync(output, '', { mode: 0o600 });
  writeFileSync(credential, '{}\n', { flag: 'wx', mode: 0o600 });
  for (const command of ['gcloud', 'terraform']) {
    writeFileSync(join(commands, command), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
  }
  writeFileSync(join(commands, 'node'), '#!/usr/bin/env bash\nexit 71\n', { mode: 0o700 });
  const base = {
    ...exactGitHubEnvironment('plan'),
    GITHUB_OUTPUT: output,
    GOOGLE_APPLICATION_CREDENTIALS: credential,
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: credential,
    GOOGLE_GHA_CREDS_PATH: credential,
  };
  try {
    const exactSetupGcloud = runScript('plan.sh', {
      ...base,
      PATH: `${commands}:${process.env.PATH}`,
    });
    assert.equal(exactSetupGcloud.status, 71);
    assert.doesNotMatch(exactSetupGcloud.stderr, /Unreviewed Terraform or Google overrides/);

    for (const [name, value] of [
      ['CLOUDSDK_METRICS_ENVIRONMENT', 'unreviewed-action'],
      ['CLOUDSDK_METRICS_ENVIRONMENT_VERSION', '999.0.0'],
    ]) {
      const result = runScript('plan.sh', { ...base, [name]: value });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, /setup-gcloud identity does not match/);
    }
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

test('rejects a canonical apply request before credential or cloud access', () => {
  const github = exactGitHubEnvironment('apply');
  const planObject = [
    'gs://miakapp-v4-staging-tfstate-1072737219170/plans',
    github.GITHUB_SHA,
    github.GITHUB_RUN_ID,
    github.GITHUB_RUN_ATTEMPT,
    'foundation.tfplan',
  ].join('/');
  const result = runScript('apply.sh', {
    ...github,
    MIAKAPP_PLAN_OBJECT: planObject,
    MIAKAPP_PLAN_SHA256: 'b'.repeat(64),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /activation\.foundation_apply_authorized must equal true/);
  assert.doesNotMatch(result.stderr, /credential file is missing/);
});

test('summarizes only bounded Terraform action metadata', () => {
  const plan = {
    resource_changes: [
      {
        address: 'google_storage_bucket_iam_member.component_objects["roles/storage.objectCreator"]',
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
  assert.match(
    result.stdout,
    /create: google_storage_bucket_iam_member\.component_objects\["roles\/storage\.objectCreator"\]/,
  );
  assert.doesNotMatch(result.stdout, /must-not-appear|also-private|secret_data/);

  const hostile = spawnSync(process.execPath, [summaryPath], {
    input: JSON.stringify({ resource_changes: [{ address: 'safe', change: { actions: ['create\nsecret'] } }] }),
    encoding: 'utf8',
  });
  assert.notEqual(hostile.status, 0);
  assert.doesNotMatch(hostile.stdout, /secret/);

  const hostileAddress = spawnSync(process.execPath, [summaryPath], {
    input: JSON.stringify({
      resource_changes: [{ address: 'safe\nsecret', change: { actions: ['create'] } }],
    }),
    encoding: 'utf8',
  });
  assert.notEqual(hostileAddress.status, 0);
  assert.doesNotMatch(hostileAddress.stdout, /secret/);

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
