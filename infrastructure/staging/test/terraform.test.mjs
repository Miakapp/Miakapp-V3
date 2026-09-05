import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateTerraformRoot } from '../terraform/guard.mjs';

const terraformRoot = new URL('../terraform/', import.meta.url);
const terraformFiles = readdirSync(terraformRoot).filter((name) => name.endsWith('.tf')).sort();
const terraformSource = terraformFiles
  .map((name) => readFileSync(new URL(name, terraformRoot), 'utf8'))
  .join('\n');
const bootstrapSource = readFileSync(new URL('bootstrap.tf', terraformRoot), 'utf8');
const foundationSource = readFileSync(new URL('foundation.tf', terraformRoot), 'utf8');
const iamSource = readFileSync(new URL('iam.tf', terraformRoot), 'utf8');
const localsSource = readFileSync(new URL('locals.tf', terraformRoot), 'utf8');
const planScript = readFileSync(new URL('plan.sh', terraformRoot), 'utf8');
const lockFile = readFileSync(new URL('.terraform.lock.hcl', terraformRoot), 'utf8');
const cliConfig = readFileSync(new URL('terraform-cli.tfrc', terraformRoot), 'utf8');
const checkScript = readFileSync(new URL('../check.sh', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../.github/workflows/staging-manifest.yml', import.meta.url), 'utf8');

function providerLockBlock(provider) {
  const start = lockFile.indexOf(`provider "registry.terraform.io/hashicorp/${provider}"`);
  assert.notEqual(start, -1);
  const next = lockFile.indexOf('\nprovider "', start + 1);
  return lockFile.slice(start, next === -1 ? lockFile.length : next);
}

function guardedPlan(environment) {
  return spawnSync(fileURLToPath(new URL('plan.sh', terraformRoot)), [], {
    cwd: fileURLToPath(terraformRoot),
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      MIAKAPP_STAGING_PLAN_CONFIRMATION: 'miakapp-v4-staging',
      ...environment,
    },
  });
}

function localSet(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedName}\\s*=\\s*toset\\(\\[([\\s\\S]*?)\\]\\)`).exec(localsSource);
  assert.notEqual(match, null, name);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((value) => value[1]).sort();
}

test('pins the exact staging target, Paris region, toolchain, and remote state', () => {
  assert.match(terraformSource, /required_version = "= 1\.11\.3"/);
  assert.equal((terraformSource.match(/version = "= 8\.1\.0"/g) ?? []).length, 2);
  assert.match(terraformSource, /project_id\s+= "miakapp-v4-staging"/);
  assert.match(terraformSource, /project_number\s+= "1072737219170"/);
  assert.match(terraformSource, /region\s+= "europe-west9"/);
  assert.doesNotMatch(terraformSource, /europe-west1|europe-west6|\beur3\b/);
  assert.match(terraformSource, /backend "gcs" \{[\s\S]*bucket = "miakapp-v4-staging-tfstate-1072737219170"[\s\S]*prefix = "terraform\/foundation"/);
  assert.match(bootstrapSource, /data "terraform_remote_state" "bootstrap"/);
  assert.match(bootstrapSource, /bucket = local\.state_bucket_name/);
  assert.match(bootstrapSource, /prefix = local\.bootstrap_prefix/);
});

test('requires the exact closed bootstrap identity before the foundation graph', () => {
  for (const field of [
    'schema',
    'project_id',
    'project_number',
    'region',
    'state_bucket',
    'bootstrap_prefix',
    'foundation_prefix',
    'planner_service_account',
    'deployer_service_account',
    'runtime_service_account',
    'component_bucket',
    'plan_provider',
    'apply_provider',
    'github_repository_id',
    'github_repository_owner_id',
  ]) {
    assert.match(bootstrapSource, new RegExp(`foundation_activation\\.${field}`), field);
  }
  assert.match(bootstrapSource, /try\([\s\S]*false,[\s\S]*\)/);
  assert.match(bootstrapSource, /remote bootstrap state is missing or does not match/);
  assert.match(foundationSource, /terraform_data\.bootstrap_guard/);
  assert.match(readFileSync(new URL('services.tf', terraformRoot), 'utf8'), /terraform_data\.bootstrap_guard/);
});

test('contains only the reviewed foundation resource and data types', () => {
  assert.doesNotThrow(() => validateTerraformRoot(terraformRoot));
  assert.doesNotMatch(terraformSource, /^\s*module\s+"/m);
  const resources = [...new Set([...terraformSource.matchAll(/resource\s+"([^"]+)"/g)].map((match) => match[1]))].sort();
  assert.deepEqual(resources, [
    'google_firestore_database',
    'google_firestore_field',
    'google_kms_crypto_key',
    'google_kms_crypto_key_iam_member',
    'google_kms_key_ring',
    'google_project_service',
    'google_secret_manager_secret',
    'google_secret_manager_secret_iam_member',
    'google_storage_bucket_iam_member',
    'terraform_data',
  ]);
  assert.deepEqual(
    [...terraformSource.matchAll(/data\s+"([^"]+)"/g)].map((match) => match[1]).sort(),
    ['google_service_account', 'google_storage_bucket', 'terraform_remote_state'],
  );
  assert.doesNotMatch(terraformSource, /google_(billing|cloudfunctions|cloud_run|app_engine|compute|vpc|service_account_key)/);
  assert.doesNotMatch(terraformSource, /secret_manager_secret_version|secret_data|private_key/);
  assert.doesNotMatch(terraformSource, /provisioner\s+"|local-exec|remote-exec/);
});

test('pins the exact foundation APIs, secrets, and component-object role set', () => {
  assert.deepEqual(localSet('required_service_apis'), [
    'artifactregistry.googleapis.com',
    'cloudbuild.googleapis.com',
    'cloudfunctions.googleapis.com',
    'cloudkms.googleapis.com',
    'containeranalysis.googleapis.com',
    'eventarc.googleapis.com',
    'fcm.googleapis.com',
    'firebaseappcheck.googleapis.com',
    'firestore.googleapis.com',
    'logging.googleapis.com',
    'monitoring.googleapis.com',
    'pubsub.googleapis.com',
    'run.googleapis.com',
    'secretmanager.googleapis.com',
  ]);
  assert.deepEqual(localSet('secret_ids'), [
    'miakapp-audit-hmac',
    'miakapp-component-hmac',
    'miakapp-home-key-pepper',
    'miakapp-network-hmac',
    'miakapp-push-hmac',
  ]);
  assert.deepEqual(localSet('component_storage_roles'), [
    'roles/storage.objectCreator',
    'roles/storage.objectViewer',
  ]);
});

test('keeps Storage, Firestore, KMS, secrets, and runtime IAM fail-closed', () => {
  assert.match(foundationSource, /data "google_service_account" "control_plane"/);
  assert.match(foundationSource, /data "google_storage_bucket" "components"/);
  assert.match(foundationSource, /self\.email == local\.runtime_service_account/);
  assert.match(foundationSource, /self\.disabled == false/);
  assert.match(foundationSource, /self\.uniform_bucket_level_access == true/);
  assert.match(foundationSource, /self\.public_access_prevention == "enforced"/);
  assert.match(foundationSource, /length\(self\.cors\) == 0/);
  assert.match(foundationSource, /self\.soft_delete_policy\[0\]\.retention_duration_seconds == 0/);
  assert.match(terraformSource, /delete_protection_state\s+= "DELETE_PROTECTION_ENABLED"/);
  assert.match(terraformSource, /algorithm\s+= "EC_SIGN_ED25519"/);
  assert.match(terraformSource, /deletion_protection\s+= true/);
  assert.doesNotMatch(terraformSource, /allUsers|allAuthenticatedUsers|roles\/owner|roles\/editor/);
  assert.doesNotMatch(terraformSource, /resource\s+"google_project_iam_(policy|binding)"/);
  assert.doesNotMatch(terraformSource, /resource\s+"google_project_iam_member"/);
  assert.doesNotMatch(terraformSource, /resource\s+"google_(service_account|storage_bucket)"/);
  assert.doesNotMatch(iamSource, /roles\/storage\.objectAdmin/);
  assert.match(iamSource, /data\.google_storage_bucket\.components\.name/);
  assert.match(iamSource, /data\.google_service_account\.control_plane\.member/);
});

test('keeps the local operator plan wrapper non-mutating and uses the real locking backend', () => {
  assert.doesNotMatch(planScript, /terraform\s+(apply|destroy|import)|firebase\s+deploy|\s-out(?:=|\s)/);
  assert.match(planScript, /terraform init -reconfigure -input=false -lockfile=readonly/);
  assert.match(planScript, /terraform plan -input=false -lock-timeout=5m -no-color -detailed-exitcode/);
  assert.match(planScript, /mktemp -d/);
  assert.match(planScript, /export TF_DATA_DIR="\$terraform_data"/);
  assert.match(planScript, /rm -rf -- "\$terraform_data"/);
  assert.match(planScript, /Terraform working data must remain outside the repository/);
  assert.doesNotMatch(planScript, /-lock=false|-backend=false/);
  assert.match(planScript, /Credential-file environment variables are forbidden/);
  assert.match(planScript, /Terraform override environment variables are forbidden/);
  assert.match(planScript, /Google credential and endpoint overrides are forbidden/);
  assert.match(planScript, /node "\$\{terraform_root\}\/guard\.mjs"/);
  assert.equal(cliConfig, 'provider_installation {\n  direct {}\n}\n');
  assert.doesNotMatch(terraformSource, /\bmiakapp-3\b|project_id\s+= "miakapp-v4"|demo-miakapp-v4/);
});

test('rejects ambient Terraform and Google overrides before provider execution', () => {
  for (const [name, value, message] of [
    ['TF_CLI_ARGS_plan', '-out=private.tfplan', 'Terraform override environment variables are forbidden'],
    ['TF_VAR_unreviewed', 'value', 'Terraform override environment variables are forbidden'],
    ['TF_LOG_PATH', '/tmp/private.log', 'Terraform override environment variables are forbidden'],
    ['GOOGLE_OAUTH_ACCESS_TOKEN', 'synthetic-token', 'Google credential and endpoint overrides are forbidden'],
    ['GOOGLE_IMPERSONATE_SERVICE_ACCOUNT', 'unreviewed@example.test', 'Google credential and endpoint overrides are forbidden'],
    ['GOOGLE_FIRESTORE_CUSTOM_ENDPOINT', 'https://attacker.example.test', 'Google credential and endpoint overrides are forbidden'],
    ['CLOUDSDK_CONFIG', '/tmp/unreviewed-gcloud', 'Google credential and endpoint overrides are forbidden'],
    ['GOOGLE_APPLICATION_CREDENTIALS', '/tmp/unreviewed.json', 'Credential-file environment variables are forbidden'],
  ]) {
    const result = guardedPlan({ [name]: value });
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, new RegExp(message), name);
  }
});

test('rejects unreviewed Terraform files that could add resources or overrides', () => {
  const unexpected = new URL('unreviewed.auto.tfvars.json', terraformRoot);
  writeFileSync(unexpected, '{}\n', { flag: 'wx', mode: 0o600 });
  try {
    assert.throws(() => validateTerraformRoot(terraformRoot), /reviewed Terraform inventory/);
  } finally {
    unlinkSync(unexpected);
  }
});

test('locks both providers for macOS ARM64 and Linux AMD64', () => {
  assert.equal((lockFile.match(/provider "registry\.terraform\.io\/hashicorp\/google(?:-beta)?"/g) ?? []).length, 2);
  assert.equal((lockFile.match(/version\s+= "8\.1\.0"/g) ?? []).length, 2);
  for (const provider of ['google', 'google-beta']) {
    assert.equal((providerLockBlock(provider).match(/"h1:/g) ?? []).length, 2, provider);
  }
  assert.match(checkScript, /for terraform_root in bootstrap terraform/);
  assert.match(checkScript, /-platform=darwin_arm64/);
  assert.match(checkScript, /-platform=linux_amd64/);
  assert.doesNotMatch(workflow, /^\s+paths:/m);
  assert.match(workflow, /name: Staging manifest safety gate \/ validate/);
});
