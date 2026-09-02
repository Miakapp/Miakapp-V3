import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateBootstrapRoot } from '../bootstrap/guard.mjs';

const bootstrapRoot = new URL('../bootstrap/', import.meta.url);
const terraformFiles = readdirSync(bootstrapRoot).filter((name) => name.endsWith('.tf')).sort();
const source = terraformFiles
  .map((name) => readFileSync(new URL(name, bootstrapRoot), 'utf8'))
  .join('\n');
const billingSource = readFileSync(new URL('billing.tf', bootstrapRoot), 'utf8');
const identitySource = readFileSync(new URL('identity.tf', bootstrapRoot), 'utf8');
const iamSource = readFileSync(new URL('iam.tf', bootstrapRoot), 'utf8');
const localsSource = readFileSync(new URL('locals.tf', bootstrapRoot), 'utf8');
const stateSource = readFileSync(new URL('state.tf', bootstrapRoot), 'utf8');
const backendTemplate = readFileSync(new URL('backend.gcs.tf.example', bootstrapRoot), 'utf8');
const planScript = readFileSync(new URL('plan.sh', bootstrapRoot), 'utf8');
const bootstrapLock = readFileSync(new URL('.terraform.lock.hcl', bootstrapRoot), 'utf8');
const foundationLock = readFileSync(new URL('../terraform/.terraform.lock.hcl', import.meta.url), 'utf8');

function localSet(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedName}\\s*=\\s*toset\\(\\[([\\s\\S]*?)\\]\\)`).exec(localsSource);
  assert.notEqual(match, null, name);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((value) => value[1]).sort();
}

function guardedPlan(environment) {
  return spawnSync(fileURLToPath(new URL('plan.sh', bootstrapRoot)), [], {
    cwd: fileURLToPath(bootstrapRoot),
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      MIAKAPP_STAGING_BILLING_ACCOUNT_ID: 'AAAAAA-BBBBBB-CCCCCC',
      MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION: 'miakapp-v4-staging',
      ...environment,
    },
  });
}

test('keeps the bootstrap root closed and limited to bootstrap resource types', () => {
  assert.doesNotThrow(() => validateBootstrapRoot(bootstrapRoot));
  assert.doesNotMatch(source, /^\s*module\s+"/m);
  const counts = new Map();
  for (const [, type] of source.matchAll(/resource\s+"([^"]+)"/g)) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...counts].sort()), {
    google_billing_budget: 1,
    google_billing_project_info: 1,
    google_iam_workload_identity_pool: 1,
    google_iam_workload_identity_pool_provider: 2,
    google_project_iam_member: 3,
    google_project_service: 1,
    google_service_account: 3,
    google_service_account_iam_member: 2,
    google_storage_bucket: 2,
    google_storage_bucket_iam_member: 5,
  });
  assert.deepEqual(
    [...source.matchAll(/data\s+"([^"]+)"/g)].map((match) => match[1]).sort(),
    ['google_billing_account', 'google_project'],
  );
  assert.doesNotMatch(source, /google_(cloudfunctions|cloud_run|app_engine|compute|vpc|service_account_key)/);
  assert.doesNotMatch(source, /secret_manager_secret_version|secret_data|private_key|provisioner\s+"|local-exec|remote-exec/);
});

test('pins the billing target, bootstrap APIs, budget, and non-secret output', () => {
  assert.match(source, /project_id\s+= "miakapp-v4-staging"/);
  assert.match(source, /project_number\s+= "1072737219170"/);
  assert.match(source, /region\s+= "europe-west9"/);
  assert.match(billingSource, /sha256\(var\.billing_account_id\) == local\.approved_billing_account_sha256/);
  assert.doesNotMatch(source, /\b[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}\b/);
  assert.deepEqual(localSet('bootstrap_service_apis'), [
    'billingbudgets.googleapis.com',
    'cloudbilling.googleapis.com',
    'cloudresourcemanager.googleapis.com',
    'iam.googleapis.com',
    'iamcredentials.googleapis.com',
    'serviceusage.googleapis.com',
    'storage.googleapis.com',
    'sts.googleapis.com',
  ]);
  assert.deepEqual(
    [...billingSource.matchAll(/threshold_percent\s+=\s+([0-9.]+)/g)].map((match) => Number(match[1])),
    [0.2, 0.5, 1],
  );
  assert.match(source, /output "foundation_activation"/);
  assert.doesNotMatch(readFileSync(new URL('outputs.tf', bootstrapRoot), 'utf8'), /sensitive\s+=\s+true|billing_account/);
});

test('creates a private versioned state bucket with bounded private plans', () => {
  assert.match(stateSource, /name\s+= local\.state_bucket_name/);
  assert.match(localsSource, /state_bucket_name = "miakapp-v4-staging-tfstate-1072737219170"/);
  assert.match(stateSource, /uniform_bucket_level_access = true/);
  assert.match(stateSource, /public_access_prevention\s+= "enforced"/);
  assert.match(stateSource, /force_destroy\s+= false/);
  assert.match(stateSource, /versioning \{\s*enabled = true\s*\}/);
  assert.match(stateSource, /retention_duration_seconds = 604800/);
  assert.match(stateSource, /days_since_noncurrent_time = 30/);
  assert.match(stateSource, /num_newer_versions\s+= 10/);
  assert.match(stateSource, /age\s+= 2/);
  assert.equal((stateSource.match(/matches_prefix\s+= \[local\.plan_prefix\]/g) ?? []).length, 2);
  assert.match(stateSource, /days_since_noncurrent_time = 1/);
  assert.match(stateSource, /prevent_destroy = true/);
  assert.doesNotMatch(source, /allUsers|allAuthenticatedUsers/);
});

test('creates the private component bucket outside the deployer trust boundary', () => {
  assert.match(stateSource, /resource "google_storage_bucket" "components"/);
  assert.match(stateSource, /name\s+= local\.component_bucket_name/);
  assert.match(localsSource, /component_bucket_name\s+= "miakapp-v4-staging-components"/);
  assert.match(stateSource, /uniform_bucket_level_access = true/);
  assert.match(stateSource, /public_access_prevention\s+= "enforced"/);
  assert.match(stateSource, /retention_duration_seconds = 0/);
  assert.match(stateSource, /matches_prefix\s+= \["component-staging\/"\]/);
  assert.match(stateSource, /prevent_destroy = true/);
});

test('separates numeric-claim plan and apply federation identities', () => {
  assert.equal((identitySource.match(/resource "google_iam_workload_identity_pool_provider"/g) ?? []).length, 2);
  assert.equal((identitySource.match(/roles\/iam\.workloadIdentityUser/g) ?? []).length, 2);
  for (const claim of [
    'assertion.repository_id',
    'assertion.repository_owner_id',
    'assertion.ref',
    'assertion.environment',
    'assertion.workflow_ref',
  ]) assert.equal((identitySource.match(new RegExp(claim.replace('.', '\\.'), 'g')) ?? []).length >= 2, true, claim);
  assert.match(localsSource, /github_repository_id\s+= "354682190"/);
  assert.match(localsSource, /github_repository_owner_id = "83046838"/);
  assert.match(localsSource, /github_ref\s+= "refs\/heads\/main"/);
  assert.match(localsSource, /github_plan_environment\s+= "miakapp-v4-staging-plan"/);
  assert.match(localsSource, /github_apply_environment\s+= "miakapp-v4-staging-apply"/);
  assert.match(localsSource, /github_workflow_ref\s+= "Miakapp\/Miakapp-V3\/\.github\/workflows\/staging-terraform\.yml@refs\/heads\/main"/);
  assert.match(identitySource, /principalSet:\/\/iam\.googleapis\.com\/\$\{google_iam_workload_identity_pool\.github\.name\}\/attribute\.environment\/\$\{local\.github_plan_environment\}/);
  assert.match(identitySource, /principalSet:\/\/iam\.googleapis\.com\/\$\{google_iam_workload_identity_pool\.github\.name\}\/attribute\.environment\/\$\{local\.github_apply_environment\}/);
});

test('keeps state and project IAM outside the deployer mutation boundary', () => {
  assert.deepEqual(localSet('planner_project_roles'), [
    'roles/iam.securityReviewer',
    'roles/viewer',
  ]);
  assert.deepEqual(localSet('deployer_project_roles'), [
    'roles/cloudkms.admin',
    'roles/datastore.owner',
    'roles/secretmanager.admin',
    'roles/serviceusage.serviceUsageAdmin',
  ]);
  assert.deepEqual(localSet('runtime_project_roles'), [
    'roles/datastore.user',
    'roles/firebaseappcheck.tokenVerifier',
    'roles/logging.logWriter',
    'roles/monitoring.metricWriter',
  ]);
  assert.match(iamSource, /roles\/storage\.objectAdmin/);
  assert.match(iamSource, /roles\/storage\.objectViewer/);
  assert.match(iamSource, /roles\/storage\.objectCreator/);
  assert.match(iamSource, /objects\/\$\{local\.foundation_prefix\}\//);
  assert.match(iamSource, /objects\/\$\{local\.plan_prefix\}/);
  assert.match(iamSource, /resource "google_storage_bucket_iam_member" "terraform_foundation_deployer"[\s\S]*roles\/storage\.objectAdmin[\s\S]*Allow the protected deployer to persist only foundation state and locks/);
  assert.match(iamSource, /resource "google_storage_bucket_iam_member" "terraform_foundation_lock_writer"[\s\S]*roles\/storage\.objectAdmin[\s\S]*resource\.name\.endsWith\('\.tflock'\)/);
  assert.doesNotMatch(iamSource, /foundation_initial_state_creator|resource\.name\.endsWith\('\.tfstate'\)/);
  assert.match(iamSource, /Allow the planner to create, but not replace or delete, saved plan objects/);
  assert.match(iamSource, /resource "google_storage_bucket_iam_member" "component_deployer"/);
  assert.match(iamSource, /bucket = google_storage_bucket\.components\.name/);
  assert.match(iamSource, /role\s+= "roles\/storage\.admin"/);
  assert.match(iamSource, /resource\.name == \\"projects\/\$\{local\.project_id\}\/databases\/\(default\)\\"/);
  assert.doesNotMatch(iamSource, /objects\/\$\{local\.bootstrap_prefix\}\/.*objectAdmin/);
  assert.doesNotMatch(localsSource, /roles\/(?:iam\.serviceAccountAdmin|resourcemanager\.projectIamAdmin|storage\.admin)/);
  assert.doesNotMatch(iamSource, /roles\/(owner|editor)|allUsers|allAuthenticatedUsers/);
  assert.doesNotMatch(source, /google_service_account_key/);
});

test('keeps bootstrap execution plan-only and local-state-only until separately authorized', () => {
  assert.doesNotMatch(source, /backend\s+"/);
  assert.match(backendTemplate, /backend "gcs"/);
  assert.match(backendTemplate, /bucket = "miakapp-v4-staging-tfstate-1072737219170"/);
  assert.match(backendTemplate, /prefix = "terraform\/bootstrap"/);
  assert.doesNotMatch(planScript, /terraform\s+(apply|destroy|import)|firebase\s+deploy|\s-out(?:=|\s)/);
  assert.match(planScript, /terraform init -backend=false -input=false -lockfile=readonly/);
  assert.match(planScript, /terraform plan -input=false -lock=false -no-color -detailed-exitcode/);
  assert.match(planScript, /Credential-file environment variables are forbidden/);
  assert.match(planScript, /approved_fingerprint=/);
  assert.match(planScript, /unset MIAKAPP_STAGING_BILLING_ACCOUNT_ID/);
});

test('rejects bootstrap overrides before Terraform or Google access', () => {
  for (const [name, value, message] of [
    ['TF_CLI_ARGS_plan', '-out=private.tfplan', 'Terraform override environment variables are forbidden'],
    ['TF_VAR_billing_account_id', 'DDDDDD-EEEEEE-FFFFFF', 'Terraform override environment variables are forbidden'],
    ['TF_DATA_DIR', '/tmp/unreviewed', 'Terraform override environment variables are forbidden'],
    ['GOOGLE_OAUTH_ACCESS_TOKEN', 'synthetic-token', 'Google credential and endpoint overrides are forbidden'],
    ['GOOGLE_FIRESTORE_CUSTOM_ENDPOINT', 'https://attacker.example.test', 'Google credential and endpoint overrides are forbidden'],
    ['GOOGLE_APPLICATION_CREDENTIALS', '/tmp/unreviewed.json', 'Credential-file environment variables are forbidden'],
  ]) {
    const result = guardedPlan({ [name]: value });
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, new RegExp(message), name);
  }
});

test('rejects unreviewed bootstrap files and keeps both provider locks identical', () => {
  const unexpected = new URL('unreviewed.auto.tfvars.json', bootstrapRoot);
  writeFileSync(unexpected, '{}\n', { flag: 'wx', mode: 0o600 });
  try {
    assert.throws(() => validateBootstrapRoot(bootstrapRoot), /reviewed bootstrap inventory/);
  } finally {
    unlinkSync(unexpected);
  }
  assert.equal(bootstrapLock, foundationLock);
  assert.equal((bootstrapLock.match(/"h1:/g) ?? []).length, 4);
});
