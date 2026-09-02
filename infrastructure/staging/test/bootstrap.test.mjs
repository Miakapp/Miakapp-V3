import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
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

import { validateBootstrapRoot } from '../bootstrap/guard.mjs';
import {
  buildSavedPlanMetadata,
  createPrivateBundle,
  inspectPrivateBundle,
  validatePlanAgainstMetadata,
  validateSavedPlanMetadata,
  writeSavedPlanMetadata,
} from '../bootstrap/saved-plan.mjs';

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
const savePlanScript = readFileSync(new URL('save-plan.sh', bootstrapRoot), 'utf8');
const inspectPlanScript = readFileSync(new URL('inspect-plan.sh', bootstrapRoot), 'utf8');
const bootstrapLock = readFileSync(new URL('.terraform.lock.hcl', bootstrapRoot), 'utf8');
const foundationLock = readFileSync(new URL('../terraform/.terraform.lock.hcl', import.meta.url), 'utf8');

const expectedSavedPlanTypes = Object.freeze({
  google_billing_budget: 1,
  google_billing_project_info: 1,
  google_iam_workload_identity_pool: 1,
  google_iam_workload_identity_pool_provider: 2,
  google_project_iam_member: 10,
  google_project_service: 8,
  google_service_account: 3,
  google_service_account_iam_member: 2,
  google_storage_bucket: 2,
  google_storage_bucket_iam_member: 6,
});

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

function guardedSavedPlan(environment) {
  return spawnSync(fileURLToPath(new URL('save-plan.sh', bootstrapRoot)), ['/tmp'], {
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

function syntheticTerraformPlan(secret = 'must-not-appear') {
  const resourceChanges = [];
  for (const [type, count] of Object.entries(expectedSavedPlanTypes)) {
    for (let index = 0; index < count; index += 1) {
      const instanceKey = type === 'google_project_iam_member' ? `roles/viewer-${index}` : `${index}`;
      resourceChanges.push({
        address: `${type}.fixture["${instanceKey}"]`,
        mode: 'managed',
        type,
        change: {
          actions: ['create'],
          before: null,
          after: { secret },
        },
      });
    }
  }
  return { terraform_version: '1.11.3', resource_changes: resourceChanges };
}

function metadataForPlan(planBytes, plan = syntheticTerraformPlan()) {
  return buildSavedPlanMetadata(plan, {
    configurationCommit: 'a'.repeat(40),
    createdAt: '2026-09-03T01:02:03Z',
    planSha256: createHash('sha256').update(planBytes).digest('hex'),
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
  assert.match(savePlanScript, /status --porcelain=v1 --untracked-files=all/);
  assert.match(savePlanScript, /create-bundle/);
  assert.match(savePlanScript, /export TF_DATA_DIR="\$terraform_data_dir"/);
  assert.match(savePlanScript, /rm -rf -- "\$terraform_data_dir"/);
  assert.match(savePlanScript, /-state="\$state_file"/);
  assert.match(savePlanScript, /-out="\$plan_file"/);
  assert.match(savePlanScript, /show -json "\$plan_file"/);
  assert.match(savePlanScript, /sha256/);
  assert.match(savePlanScript, /unexpectedly created local state while planning/);
  assert.doesNotMatch(savePlanScript, /terraform\s+(apply|destroy|import)|firebase\s+deploy/);
  assert.match(inspectPlanScript, /node "\$bundle_helper" verify/);
  assert.match(inspectPlanScript, /export TF_DATA_DIR="\$\{inspection_root\}\/terraform-data"/);
  assert.match(inspectPlanScript, /terraform -chdir="\$bootstrap_root" init/);
  assert.match(inspectPlanScript, /-backend=false/);
  assert.match(inspectPlanScript, /-lockfile=readonly/);
  assert.match(inspectPlanScript, /show -no-color "\$\{bundle\}\/bootstrap\.tfplan"/);
  assert.doesNotMatch(inspectPlanScript, /terraform\s+(apply|destroy|import)|gcloud\s+storage/);
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

    const savedResult = guardedSavedPlan({ [name]: value });
    assert.equal(savedResult.status, 1, `saved ${name}`);
    assert.match(savedResult.stderr, new RegExp(message), `saved ${name}`);
  }
});

test('reduces the exact create-only plan to closed metadata without retaining values', () => {
  const secret = 'AAAAAA-BBBBBB-CCCCCC';
  const metadata = metadataForPlan(Buffer.from('synthetic-plan'), syntheticTerraformPlan(secret));
  assert.equal(metadata.schema, 'miakapp.staging-bootstrap-plan/1');
  assert.deepEqual(metadata.plan.change_summary, { create: 36, update: 0, delete: 0 });
  assert.equal(metadata.authorization.apply_authorized, false);
  assert.equal(metadata.authorization.state_migration_authorized, false);
  assert.doesNotMatch(JSON.stringify(metadata), new RegExp(secret));
  assert.doesNotThrow(() => validateSavedPlanMetadata(metadata));
  assert.doesNotThrow(() => validatePlanAgainstMetadata(syntheticTerraformPlan(), metadata));

  const extraField = structuredClone(metadata);
  extraField.plan.unreviewed = true;
  assert.throws(() => validateSavedPlanMetadata(extraField), /exactly the reviewed fields/);

  const destructive = syntheticTerraformPlan();
  destructive.resource_changes[0].change.actions = ['delete'];
  assert.throws(
    () => metadataForPlan(Buffer.from('synthetic-plan'), destructive),
    /must be create-only/,
  );

  const differentPlan = syntheticTerraformPlan();
  differentPlan.resource_changes[0].address = 'google_billing_budget.different["0"]';
  assert.throws(
    () => validatePlanAgainstMetadata(differentPlan, metadata),
    /do not match the saved metadata/,
  );
});

test('creates and verifies a private exact-inventory bundle and rejects tampering', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-bootstrap-plan-test-'));
  chmodSync(temporary, 0o700);
  try {
    const bundle = createPrivateBundle(temporary, fileURLToPath(new URL('../../../', import.meta.url)));
    const planPath = join(bundle, 'bootstrap.tfplan');
    const metadataPath = join(bundle, 'metadata.json');
    const planBytes = Buffer.from('synthetic-plan-binary');
    writeFileSync(planPath, planBytes, { flag: 'wx', mode: 0o600 });
    writeSavedPlanMetadata(metadataPath, metadataForPlan(planBytes));
    assert.equal(statSync(bundle).mode & 0o777, 0o700);
    assert.equal(statSync(planPath).mode & 0o777, 0o600);
    assert.equal(statSync(metadataPath).mode & 0o777, 0o600);

    const inspected = await inspectPrivateBundle(bundle, 'a'.repeat(40));
    assert.equal(inspected.plan.sha256, createHash('sha256').update(planBytes).digest('hex'));

    chmodSync(planPath, 0o644);
    await assert.rejects(
      () => inspectPrivateBundle(bundle, 'a'.repeat(40)),
      /must not be accessible by group or other users/,
    );
    chmodSync(planPath, 0o600);

    writeFileSync(planPath, 'tampered-plan', { mode: 0o600 });
    await assert.rejects(
      () => inspectPrivateBundle(bundle, 'a'.repeat(40)),
      /Saved Terraform plan SHA-256/,
    );

    writeFileSync(planPath, planBytes, { mode: 0o600 });
    const unexpectedPath = join(bundle, 'unexpected.txt');
    writeFileSync(unexpectedPath, 'unexpected', { mode: 0o600 });
    await assert.rejects(
      () => inspectPrivateBundle(bundle, 'a'.repeat(40)),
      /must contain exactly metadata.json and bootstrap.tfplan/,
    );
  } finally {
    rmSync(temporary, { recursive: true });
  }
});

test('initializes locked providers before rendering an exact saved plan', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-bootstrap-inspection-test-'));
  chmodSync(temporary, 0o700);
  try {
    const bundle = createPrivateBundle(temporary, fileURLToPath(new URL('../../../', import.meta.url)));
    const planPath = join(bundle, 'bootstrap.tfplan');
    const metadataPath = join(bundle, 'metadata.json');
    const planJsonPath = join(temporary, 'plan.json');
    const initMarkerPath = join(temporary, 'terraform-initialized');
    const fakeGitPath = join(temporary, 'git');
    const fakeTerraformPath = join(temporary, 'terraform');
    const planBytes = Buffer.from('synthetic-plan-binary');

    writeFileSync(planPath, planBytes, { flag: 'wx', mode: 0o600 });
    writeSavedPlanMetadata(metadataPath, metadataForPlan(planBytes));
    writeFileSync(planJsonPath, JSON.stringify(syntheticTerraformPlan()), { mode: 0o600 });
    writeFileSync(fakeGitPath, `#!/usr/bin/env bash
set -euo pipefail
for argument in "$@"; do
  if [[ "$argument" == "status" ]]; then
    exit 0
  fi
  if [[ "$argument" == "rev-parse" ]]; then
    printf '%s\\n' '${'a'.repeat(40)}'
    exit 0
  fi
done
exit 1
`, { mode: 0o700 });
    writeFileSync(fakeTerraformPath, `#!/usr/bin/env bash
set -euo pipefail
command_name=''
json_output=false
for argument in "$@"; do
  case "$argument" in
    version|init|show) command_name="$argument" ;;
    -json) json_output=true ;;
  esac
done
case "$command_name" in
  version)
    printf '%s\\n' '{"terraform_version":"1.11.3"}'
    ;;
  init)
    printf '%s\\n' initialized > "$MIAKAPP_FAKE_TERRAFORM_INIT_MARKER"
    ;;
  show)
    [[ -f "$MIAKAPP_FAKE_TERRAFORM_INIT_MARKER" ]] || exit 17
    if [[ "$json_output" == true ]]; then
      command cat "$MIAKAPP_FAKE_TERRAFORM_PLAN_JSON"
    else
      printf '%s\\n' 'synthetic reviewed plan'
    fi
    ;;
  *) exit 18 ;;
esac
`, { mode: 0o700 });

    const result = spawnSync(
      fileURLToPath(new URL('inspect-plan.sh', bootstrapRoot)),
      [bundle],
      {
        cwd: fileURLToPath(bootstrapRoot),
        encoding: 'utf8',
        env: {
          HOME: process.env.HOME,
          PATH: `${temporary}:${process.env.PATH}`,
          MIAKAPP_FAKE_TERRAFORM_INIT_MARKER: initMarkerPath,
          MIAKAPP_FAKE_TERRAFORM_PLAN_JSON: planJsonPath,
          MIAKAPP_STAGING_BOOTSTRAP_INSPECTION_CONFIRMATION: 'miakapp-v4-staging',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(initMarkerPath, 'utf8'), 'initialized\n');
    assert.match(result.stdout, /synthetic reviewed plan/);
  } finally {
    rmSync(temporary, { recursive: true });
  }
});

test('rejects relative, symlinked, and publicly accessible private-plan parents', () => {
  assert.throws(
    () => createPrivateBundle('relative/path', fileURLToPath(new URL('../../../', import.meta.url))),
    /must be an absolute path/,
  );
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-bootstrap-parent-test-'));
  const privateParent = join(temporary, 'private');
  const symlinkParent = join(temporary, 'linked');
  try {
    writeFileSync(privateParent, '', { mode: 0o600 });
    assert.throws(
      () => createPrivateBundle(privateParent, fileURLToPath(new URL('../../../', import.meta.url))),
      /wrong file type/,
    );
    rmSync(privateParent);
    symlinkSync(temporary, symlinkParent);
    assert.throws(
      () => createPrivateBundle(symlinkParent, fileURLToPath(new URL('../../../', import.meta.url))),
      /must not be a symbolic link/,
    );
    chmodSync(temporary, 0o755);
    assert.throws(
      () => createPrivateBundle(temporary, fileURLToPath(new URL('../../../', import.meta.url))),
      /must not be accessible by group or other users/,
    );
  } finally {
    rmSync(temporary, { recursive: true });
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
