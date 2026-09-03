import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
  APPROVED_PLAN_SHA256,
  BUDGET_DISPLAY_NAME,
  EXECUTION_AUTHORIZATION,
  FOUNDATION_ACTIVATION,
  FOUNDATION_ACTIVATION_TYPE,
  STATE_BUCKET,
  STATE_OBJECT,
  createPrivateExecutionDirectory,
  reconcileBootstrapStates,
  validateExecutionAuthorization,
  verifyAbsentTargetInventory,
  verifyBillingObservation,
  verifyEmptyInventory,
  verifyProjectObservation,
  verifyProvisionedTargetInventory,
  verifyRemoteStateObject,
} from '../bootstrap/bootstrap-execution.mjs';
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
const applyAndMigrateScript = readFileSync(new URL('apply-and-migrate.sh', bootstrapRoot), 'utf8');
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

function metadataForPlan(
  planBytes,
  plan = syntheticTerraformPlan(),
  configurationCommit = 'a'.repeat(40),
) {
  return buildSavedPlanMetadata(plan, {
    configurationCommit,
    createdAt: '2026-09-03T01:02:03Z',
    planSha256: createHash('sha256').update(planBytes).digest('hex'),
  });
}

function syntheticTerraformState(metadata, { complete = true } = {}) {
  const selectedChanges = complete ? metadata.plan.resource_changes : metadata.plan.resource_changes.slice(0, 1);
  const resources = [];
  for (const { address } of selectedChanges) {
    const match = /^([^.]+)\.([^[]+)(?:\[(.+)\])?$/.exec(address);
    assert.notEqual(match, null, address);
    const [, type, name, rawIndex] = match;
    let resource = resources.find((candidate) => candidate.type === type && candidate.name === name);
    if (resource === undefined) {
      resource = {
        mode: 'managed',
        type,
        name,
        provider: `provider[\"registry.terraform.io/hashicorp/${type.startsWith('google_') ? 'google' : 'terraform'}\"]`,
        instances: [],
      };
      resources.push(resource);
    }
    const instance = {
      schema_version: 0,
      attributes: { id: address },
      sensitive_attributes: [],
    };
    if (rawIndex !== undefined) instance.index_key = JSON.parse(rawIndex);
    resource.instances.push(instance);
  }
  return {
    version: 4,
    terraform_version: '1.11.3',
    serial: 1,
    lineage: '12345678-1234-4123-8123-123456789abc',
    outputs: complete
      ? {
          foundation_activation: {
            value: structuredClone(FOUNDATION_ACTIVATION),
            type: structuredClone(FOUNDATION_ACTIVATION_TYPE),
            sensitive: false,
          },
        }
      : {},
    resources,
  };
}

function writeExecutable(path, sourceText) {
  writeFileSync(path, sourceText, { mode: 0o700 });
}

function runSyntheticBootstrapExecution({
  applyStatus = 0,
  budgetApiUnexpectedlyEnabled = false,
  budgetCountAfterApply = 1,
  budgetPostcheckUnavailable = false,
  deferBudgetPreflight = false,
  emergencyState = false,
  lockAlreadyHeld = false,
  migrationFails = false,
  preexistingState = false,
  divergentRemote = false,
} = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-bootstrap-execution-test-'));
  chmodSync(temporary, 0o700);
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const plan = syntheticTerraformPlan();
  const planBytes = Buffer.from('synthetic-reviewed-plan');
  const metadata = metadataForPlan(
    planBytes,
    plan,
    'c192f97959833f53a19d4e6dc50b26292c88b3b5',
  );
  const completeState = syntheticTerraformState(metadata);
  const partialState = syntheticTerraformState(metadata, { complete: false });
  const selectedState = applyStatus === 0 ? completeState : partialState;
  const staleState = structuredClone(partialState);
  staleState.resources = [];
  const divergentState = structuredClone(selectedState);
  divergentState.serial += 1;

  const bundle = createPrivateBundle(temporary, repositoryRoot);
  writeFileSync(join(bundle, 'bootstrap.tfplan'), planBytes, { mode: 0o600 });
  writeSavedPlanMetadata(join(bundle, 'metadata.json'), metadata);
  if (lockAlreadyHeld) mkdirSync(`${bundle}.execution-lock`, { mode: 0o700 });
  const planJsonPath = join(temporary, 'plan.json');
  const statePath = join(temporary, 'state.json');
  const staleStatePath = join(temporary, 'stale-state.json');
  const divergentStatePath = join(temporary, 'divergent-state.json');
  const remoteStatePath = join(temporary, 'remote-state.json');
  const callLogPath = join(temporary, 'calls.log');
  const applyMarkerPath = join(temporary, 'apply.marker');
  const budgetsAfterPath = join(temporary, 'budgets-after.json');
  writeFileSync(planJsonPath, JSON.stringify(plan), { mode: 0o600 });
  writeFileSync(statePath, JSON.stringify(selectedState), { mode: 0o600 });
  writeFileSync(staleStatePath, JSON.stringify(staleState), { mode: 0o600 });
  writeFileSync(divergentStatePath, JSON.stringify(divergentState), { mode: 0o600 });
  writeFileSync(budgetsAfterPath, JSON.stringify(Array.from(
    { length: budgetCountAfterApply },
    (_, index) => ({ displayName: BUDGET_DISPLAY_NAME, name: `budgets/${index + 1}` }),
  )), { mode: 0o600 });

  writeExecutable(join(temporary, 'git'), String.raw`#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *" rev-parse --show-toplevel "*) printf '%s\n' "$MIAKAPP_FAKE_REPOSITORY_ROOT" ;;
  *" rev-parse HEAD "*) printf '%s\n' 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ;;
  *" status "*) exit 0 ;;
  *" merge-base --is-ancestor "*) exit 0 ;;
  *" diff --quiet "*) exit 0 ;;
  *) exit 91 ;;
esac
`);
  writeExecutable(join(temporary, 'node'), String.raw`#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == *'/saved-plan.mjs' && "$2" == 'verify' ]]; then
  exit 0
fi
if [[ "$1" == *'/saved-plan.mjs' && "$2" == 'sha256' ]]; then
  printf '%s' "$MIAKAPP_FAKE_APPROVED_PLAN_SHA256"
  exit 0
fi
if [[ "$1" == *'/bootstrap-execution.mjs' && "$2" == 'verify-billing-link' ]]; then
  command cat >/dev/null
  printf '%s' 'AAAAAA-BBBBBB-CCCCCC'
  exit 0
fi
exec "$MIAKAPP_REAL_NODE" "$@"
`);
  writeExecutable(join(temporary, 'terraform'), String.raw`#!/usr/bin/env bash
set -euo pipefail
command_name=''
working_directory=''
migrate=false
state_path=''
for argument in "$@"; do
  case "$argument" in
    -chdir=*) working_directory="${'${argument#-chdir=}'}" ;;
    version|fmt|init|validate|show|apply|state) [[ -z "$command_name" ]] && command_name="$argument" ;;
    -migrate-state) migrate=true ;;
    -state=*) state_path="${'${argument#-state=}'}" ;;
  esac
done
printf 'terraform:%s:%s\n' "$command_name" "$migrate" >>"$MIAKAPP_FAKE_CALL_LOG"
case "$command_name" in
  version)
    printf '%s\n' '{"terraform_version":"1.11.3"}'
    ;;
  fmt|validate)
    ;;
  show)
    command cat "$MIAKAPP_FAKE_PLAN_JSON"
    ;;
  apply)
    if [[ "$MIAKAPP_FAKE_EMERGENCY_STATE" == true ]]; then
      command cp "$MIAKAPP_FAKE_STALE_STATE" "$state_path"
      command cp "$MIAKAPP_FAKE_LOCAL_STATE" "$working_directory/errored.tfstate"
    else
      command cp "$MIAKAPP_FAKE_LOCAL_STATE" "$state_path"
    fi
    command touch "$MIAKAPP_FAKE_APPLY_MARKER"
    exit "$MIAKAPP_FAKE_APPLY_STATUS"
    ;;
  init)
    if [[ "$migrate" == true ]]; then
      if [[ "$MIAKAPP_FAKE_MIGRATION_FAILS" == true ]]; then
        exit 92
      fi
      command cp "$working_directory/terraform.tfstate" "$MIAKAPP_FAKE_REMOTE_STATE"
    fi
    ;;
  state)
    if [[ "$MIAKAPP_FAKE_DIVERGENT_REMOTE" == true ]]; then
      command cat "$MIAKAPP_FAKE_DIVERGENT_STATE"
    else
      command cat "$MIAKAPP_FAKE_REMOTE_STATE"
    fi
    ;;
  *) exit 93 ;;
esac
`);
  writeExecutable(join(temporary, 'gcloud'), String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'gcloud:%s\n' "$*" >>"$MIAKAPP_FAKE_CALL_LOG"
case " $* " in
  *" billing projects describe "*)
    printf '%s\n' '{"projectId":"miakapp-v4-staging","billingEnabled":true,"billingAccountName":"billingAccounts/AAAAAA-BBBBBB-CCCCCC"}'
    ;;
  *" projects describe "*)
    printf '%s\n' '{"projectId":"miakapp-v4-staging","projectNumber":"1072737219170","name":"Miakapp V4 Staging","lifecycleState":"ACTIVE"}'
    ;;
  *" billing budgets list "*)
    if [[ -e "$MIAKAPP_FAKE_APPLY_MARKER" ]]; then
      if [[ "$MIAKAPP_FAKE_BUDGET_POSTCHECK_UNAVAILABLE" == true ]]; then
        exit 88
      fi
      command cat "$MIAKAPP_FAKE_BUDGETS_AFTER"
    elif [[ "$MIAKAPP_FAKE_DEFER_BUDGET_PREFLIGHT" == true ]]; then
      exit 87
    else
      printf '%s\n' '[]'
    fi
    ;;
  *" services list "*"billingbudgets.googleapis.com"*)
    if [[ "$MIAKAPP_FAKE_BUDGET_API_UNEXPECTEDLY_ENABLED" == true ]]; then
      printf '%s\n' '[{"config":{"name":"billingbudgets.googleapis.com"}}]'
    else
      printf '%s\n' '[]'
    fi
    ;;
  *" storage buckets list "*|*" iam service-accounts list "*|*" iam workload-identity-pools list "*)
    printf '%s\n' '[]'
    ;;
  *" storage ls "*)
    if [[ "$MIAKAPP_FAKE_PREEXISTING_STATE" == true ]]; then
      printf '%s\n' '[{"name":"terraform/bootstrap/default.tfstate"}]'
    else
      printf '%s\n' '[]'
    fi
    ;;
  *" storage objects describe "*)
    printf '%s\n' '{"bucket":"miakapp-v4-staging-tfstate-1072737219170","name":"terraform/bootstrap/default.tfstate","generation":"123","size":"456"}'
    ;;
  *) exit 94 ;;
esac
`);
  writeExecutable(join(temporary, 'sleep'), String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'sleep:%s\n' "$*" >>"$MIAKAPP_FAKE_CALL_LOG"
`);

  const result = spawnSync(
    fileURLToPath(new URL('apply-and-migrate.sh', bootstrapRoot)),
    [bundle],
    {
      cwd: fileURLToPath(bootstrapRoot),
      encoding: 'utf8',
      env: {
        HOME: process.env.HOME,
        PATH: `${temporary}:${process.env.PATH}`,
        MIAKAPP_REAL_NODE: process.execPath,
        MIAKAPP_FAKE_REPOSITORY_ROOT: repositoryRoot,
        MIAKAPP_FAKE_APPROVED_PLAN_SHA256: APPROVED_PLAN_SHA256,
        MIAKAPP_FAKE_PLAN_JSON: planJsonPath,
        MIAKAPP_FAKE_LOCAL_STATE: statePath,
        MIAKAPP_FAKE_STALE_STATE: staleStatePath,
        MIAKAPP_FAKE_DIVERGENT_STATE: divergentStatePath,
        MIAKAPP_FAKE_REMOTE_STATE: remoteStatePath,
        MIAKAPP_FAKE_CALL_LOG: callLogPath,
        MIAKAPP_FAKE_APPLY_MARKER: applyMarkerPath,
        MIAKAPP_FAKE_BUDGETS_AFTER: budgetsAfterPath,
        MIAKAPP_FAKE_APPLY_STATUS: String(applyStatus),
        MIAKAPP_FAKE_BUDGET_API_UNEXPECTEDLY_ENABLED: String(budgetApiUnexpectedlyEnabled),
        MIAKAPP_FAKE_BUDGET_POSTCHECK_UNAVAILABLE: String(budgetPostcheckUnavailable),
        MIAKAPP_FAKE_DEFER_BUDGET_PREFLIGHT: String(deferBudgetPreflight),
        MIAKAPP_FAKE_EMERGENCY_STATE: String(emergencyState),
        MIAKAPP_FAKE_MIGRATION_FAILS: String(migrationFails),
        MIAKAPP_FAKE_PREEXISTING_STATE: String(preexistingState),
        MIAKAPP_FAKE_DIVERGENT_REMOTE: String(divergentRemote),
        MIAKAPP_STAGING_BOOTSTRAP_EXECUTION_AUTHORIZATION: EXECUTION_AUTHORIZATION,
      },
    },
  );
  const calls = existsSync(callLogPath) ? readFileSync(callLogPath, 'utf8') : '';
  const executionDirectories = readdirSync(temporary)
    .filter((name) => name.startsWith('miakapp-staging-bootstrap-execution-'))
    .map((name) => join(temporary, name));
  const executionLocks = readdirSync(temporary)
    .filter((name) => name.endsWith('.execution-lock'))
    .map((name) => join(temporary, name));
  return { bundle, calls, executionDirectories, executionLocks, result, temporary };
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

test('binds bootstrap execution to the exact reviewed plan and closed cloud observations', () => {
  assert.equal(validateExecutionAuthorization(EXECUTION_AUTHORIZATION), EXECUTION_AUTHORIZATION);
  assert.throws(
    () => validateExecutionAuthorization(`apply-and-migrate:miakapp-v4-staging:${'0'.repeat(64)}`),
    /exact reviewed apply-and-migrate authorization/,
  );

  assert.doesNotThrow(() => verifyProjectObservation({
    projectId: 'miakapp-v4-staging',
    projectNumber: '1072737219170',
    name: 'Miakapp V4 Staging',
    lifecycleState: 'ACTIVE',
    ignoredProviderField: true,
  }));
  assert.throws(
    () => verifyProjectObservation({
      projectId: 'miakapp-3',
      projectNumber: '1072737219170',
      name: 'Miakapp V4 Staging',
      lifecycleState: 'ACTIVE',
    }),
    /reviewed active staging project/,
  );

  const syntheticBillingId = 'AAAAAA-BBBBBB-CCCCCC';
  const syntheticBillingFingerprint = createHash('sha256').update(syntheticBillingId).digest('hex');
  assert.equal(
    verifyBillingObservation({
      projectId: 'miakapp-v4-staging',
      billingEnabled: true,
      billingAccountName: `billingAccounts/${syntheticBillingId}`,
    }, syntheticBillingFingerprint),
    syntheticBillingId,
  );
  assert.throws(
    () => verifyBillingObservation({
      projectId: 'miakapp-v4-staging',
      billingEnabled: true,
      billingAccountName: `billingAccounts/${syntheticBillingId}`,
    }, '0'.repeat(64)),
    /different billing account/,
  );

  assert.doesNotThrow(() => verifyEmptyInventory([], 'state-bucket'));
  assert.throws(() => verifyEmptyInventory([{ name: STATE_OBJECT }], 'state-bucket'), /is not empty/);
  assert.doesNotThrow(() => verifyAbsentTargetInventory([
    { email: 'firebase-adminsdk@example.test' },
  ], 'service-accounts'));
  assert.throws(
    () => verifyAbsentTargetInventory([
      { email: 'miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com' },
    ], 'service-accounts'),
    /already contains a bootstrap target/,
  );
  assert.doesNotThrow(() => verifyProvisionedTargetInventory([
    { displayName: BUDGET_DISPLAY_NAME },
    { displayName: 'Unrelated budget' },
  ], 'budgets'));
  assert.throws(
    () => verifyProvisionedTargetInventory([], 'budgets'),
    /must contain exactly one bootstrap target/,
  );
  assert.throws(
    () => verifyProvisionedTargetInventory([
      { displayName: BUDGET_DISPLAY_NAME },
      { displayName: BUDGET_DISPLAY_NAME },
    ], 'budgets'),
    /must contain exactly one bootstrap target/,
  );
  assert.throws(
    () => verifyProvisionedTargetInventory([], 'service-accounts'),
    /label is invalid/,
  );
  assert.doesNotThrow(() => verifyRemoteStateObject({
    bucket: STATE_BUCKET,
    name: STATE_OBJECT,
    generation: '123',
    size: '456',
  }));
  assert.throws(
    () => verifyRemoteStateObject({
      bucket: STATE_BUCKET,
      name: STATE_OBJECT,
      generation: '123',
      size: '456',
      softDeleteTime: '2026-09-03T00:00:00Z',
    }),
    /metadata is invalid/,
  );
});

test('creates recovery material only beside an external private plan bundle', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-bootstrap-execution-parent-test-'));
  chmodSync(temporary, 0o700);
  try {
    const bundle = createPrivateBundle(temporary, fileURLToPath(new URL('../../../', import.meta.url)));
    const execution = createPrivateExecutionDirectory(
      bundle,
      fileURLToPath(new URL('../../../', import.meta.url)),
    );
    assert.equal(statSync(execution).mode & 0o777, 0o700);
    assert.equal(execution.startsWith(`${realpathSync(temporary)}/miakapp-staging-bootstrap-execution-`), true);
  } finally {
    rmSync(temporary, { recursive: true });
  }
});

test('reconciles exact complete or expected partial bootstrap state and rejects divergence', () => {
  const planBytes = Buffer.from('synthetic-plan');
  const metadata = metadataForPlan(planBytes);
  const complete = syntheticTerraformState(metadata);
  const partial = syntheticTerraformState(metadata, { complete: false });

  assert.deepEqual(reconcileBootstrapStates(complete, structuredClone(complete), metadata, 'complete'), {
    mode: 'complete',
    managedResources: 36,
    serial: 1,
  });
  assert.deepEqual(reconcileBootstrapStates(partial, structuredClone(partial), metadata, 'partial'), {
    mode: 'partial',
    managedResources: 1,
    serial: 1,
  });

  const divergent = structuredClone(complete);
  divergent.resources[0].instances[0].attributes.id = 'different';
  assert.throws(
    () => reconcileBootstrapStates(complete, divergent, metadata, 'complete'),
    /does not exactly match local state/,
  );

  const unexpected = structuredClone(partial);
  unexpected.resources[0].type = 'google_storage_bucket_object';
  assert.throws(
    () => reconcileBootstrapStates(unexpected, structuredClone(unexpected), metadata, 'partial'),
    /unexpected managed inventory/,
  );

  const wrongOutputType = structuredClone(complete);
  wrongOutputType.outputs.foundation_activation.type = ['map', 'string'];
  assert.throws(
    () => reconcileBootstrapStates(wrongOutputType, structuredClone(wrongOutputType), metadata, 'complete'),
    /foundation_activation output does not match/,
  );

  const unexpectedOutput = structuredClone(complete);
  unexpectedOutput.outputs.private_value = {
    value: 'must-not-be-accepted',
    type: 'string',
    sensitive: true,
  };
  assert.throws(
    () => reconcileBootstrapStates(unexpectedOutput, structuredClone(unexpectedOutput), metadata, 'complete'),
    /outputs must contain exactly/,
  );
});

test('Terraform 1.11.3 preserves the exact local state across a non-interactive backend migration', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-bootstrap-migration-probe-'));
  chmodSync(temporary, 0o700);
  const root = join(temporary, 'root');
  const data = join(temporary, 'terraform-data');
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(data, { mode: 0o700 });
  const sourceState = join(temporary, 'source.tfstate');
  const planPath = join(temporary, 'probe.tfplan');
  const environment = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TF_DATA_DIR: data,
    TF_IN_AUTOMATION: '1',
  };
  const runTerraform = (args) => spawnSync('terraform', args, {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  });
  try {
    writeFileSync(join(root, 'main.tf'), `terraform {
  required_version = "= 1.11.3"
}

resource "terraform_data" "probe" {
  input = "synthetic-bootstrap-state"
}
`, { mode: 0o600 });
    let result = runTerraform(['init', '-input=false', '-no-color']);
    assert.equal(result.status, 0, result.stderr);
    result = runTerraform([
      'plan',
      '-input=false',
      '-lock=false',
      '-no-color',
      `-state=${sourceState}`,
      `-out=${planPath}`,
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = runTerraform([
      'apply',
      '-input=false',
      '-no-color',
      `-state=${sourceState}`,
      `-state-out=${sourceState}`,
      '-backup=-',
      planPath,
    ]);
    assert.equal(result.status, 0, result.stderr);
    copyFileSync(sourceState, join(root, 'terraform.tfstate'));
    writeFileSync(join(root, 'backend.tf'), `terraform {
  backend "local" {
    path = "remote.tfstate"
  }
}
`, { mode: 0o600 });
    result = runTerraform([
      'init',
      '-migrate-state',
      '-force-copy',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = runTerraform(['state', 'pull']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), JSON.parse(readFileSync(sourceState, 'utf8')));
  } finally {
    rmSync(temporary, { recursive: true });
  }
});

test('keeps the bootstrap execution wrapper dormant and recovery-first', () => {
  assert.match(applyAndMigrateScript, new RegExp(APPROVED_PLAN_SHA256));
  assert.match(applyAndMigrateScript, /verify-authorization/);
  assert.match(applyAndMigrateScript, /mkdir -m 700 -- "\$execution_lock"/);
  assert.match(applyAndMigrateScript, /verify-absent-targets/);
  assert.match(applyAndMigrateScript, /--billing-project=\$\{project_id\}/);
  assert.match(applyAndMigrateScript, /verify-provisioned-targets budgets/);
  assert.match(applyAndMigrateScript, /terraform[\s\S]*apply[\s\S]*-state="\$local_state"/);
  assert.match(applyAndMigrateScript, /terraform -chdir="\$apply_root" apply/);
  assert.doesNotMatch(applyAndMigrateScript, /terraform -chdir="\$bootstrap_root" apply/);
  assert.match(applyAndMigrateScript, /\$\{apply_root\}\/errored\.tfstate/);
  assert.match(applyAndMigrateScript, /init[\s\S]*-migrate-state[\s\S]*-force-copy/);
  assert.match(applyAndMigrateScript, /reconcile-state/);
  assert.match(applyAndMigrateScript, /execution_complete=true/);
  assert.match(applyAndMigrateScript, /private recovery material was preserved/);
  assert.doesNotMatch(applyAndMigrateScript, /terraform\s+(?:destroy|import|state\s+push|force-unlock)/);
  assert.doesNotMatch(applyAndMigrateScript, /firebase\s+deploy|gcloud\s+storage\s+(?:rm|cp|mv)/);
});

test('orchestrates one exact apply, migration, read-back, and verified cleanup without cloud access', () => {
  const execution = runSyntheticBootstrapExecution();
  try {
    assert.equal(execution.result.status, 0, execution.result.stderr);
    assert.match(execution.result.stdout, /state was migrated and reconciled/);
    assert.match(execution.result.stdout, /managed resources: 36/);
    assert.equal(execution.executionDirectories.length, 0);
    assert.equal(execution.executionLocks.length, 0);
    const applyIndex = execution.calls.indexOf('terraform:apply:false');
    const localInitIndex = execution.calls.indexOf('terraform:init:false');
    const migrateIndex = execution.calls.indexOf('terraform:init:true');
    const pullIndex = execution.calls.indexOf('terraform:state:false');
    assert.equal(applyIndex >= 0, true);
    assert.equal(localInitIndex >= 0 && localInitIndex < applyIndex, true);
    assert.equal(migrateIndex > applyIndex, true);
    assert.equal(pullIndex > migrateIndex, true);
    assert.equal((execution.calls.match(/terraform:apply:false/g) ?? []).length, 1);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('defers budget absence only while the Budget API is disabled and verifies it after apply', () => {
  const execution = runSyntheticBootstrapExecution({ deferBudgetPreflight: true });
  try {
    assert.equal(execution.result.status, 0, execution.result.stderr);
    assert.match(execution.result.stdout, /Budget absence was deferred/);
    const apiObservation = execution.calls.indexOf('gcloud:services list --enabled');
    const apply = execution.calls.indexOf('terraform:apply:false');
    const budgetAfter = execution.calls.lastIndexOf('gcloud:billing budgets list');
    assert.equal(apiObservation >= 0 && apiObservation < apply, true);
    assert.equal(budgetAfter > apply, true);
    assert.equal(execution.executionDirectories.length, 0);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('rejects budget preflight deferral when the Budget API is observed as enabled', () => {
  const execution = runSyntheticBootstrapExecution({
    budgetApiUnexpectedlyEnabled: true,
    deferBudgetPreflight: true,
  });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /billing-budget-api inventory is not empty/);
    assert.doesNotMatch(execution.calls, /terraform:apply:false/);
    assert.equal(execution.executionDirectories.length, 1);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('preserves reconciled recovery state when the target budget is absent or duplicated after apply', () => {
  for (const budgetCountAfterApply of [0, 2]) {
    const execution = runSyntheticBootstrapExecution({
      budgetCountAfterApply,
      deferBudgetPreflight: true,
    });
    try {
      assert.equal(execution.result.status, 1);
      assert.match(execution.result.stdout, /managed resources: 36/);
      assert.match(execution.result.stderr, /Exactly one bootstrap budget could not be verified/);
      assert.equal((execution.calls.match(/sleep:5/g) ?? []).length, 11);
      assert.equal(execution.executionDirectories.length, 1);
      assert.equal(existsSync(join(execution.executionDirectories[0], 'remote-bootstrap.tfstate')), true);
    } finally {
      rmSync(execution.temporary, { recursive: true });
    }
  }
});

test('preserves reconciled recovery state when the target budget cannot be inspected after apply', () => {
  const execution = runSyntheticBootstrapExecution({
    budgetPostcheckUnavailable: true,
    deferBudgetPreflight: true,
  });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stdout, /managed resources: 36/);
    assert.match(execution.result.stderr, /Exactly one bootstrap budget could not be verified/);
    assert.equal((execution.calls.match(/sleep:5/g) ?? []).length, 11);
    assert.equal(execution.executionDirectories.length, 1);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('rejects concurrent execution of the same private bundle before cloud access', () => {
  const execution = runSyntheticBootstrapExecution({ lockAlreadyHeld: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /already has an active execution lock/);
    assert.equal(execution.executionDirectories.length, 0);
    assert.equal(execution.executionLocks.length, 1);
    assert.doesNotMatch(execution.calls, /terraform:|gcloud:/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('preserves exact partial state after an apply failure and still migrates it', () => {
  const execution = runSyntheticBootstrapExecution({ applyStatus: 1 });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stdout, /managed resources: 1/);
    assert.match(execution.result.stderr, /partial or failed/);
    assert.equal(execution.executionDirectories.length, 1);
    assert.equal(statSync(join(execution.executionDirectories[0], 'bootstrap.tfstate')).mode & 0o777, 0o600);
    assert.match(execution.calls, /terraform:init:true/);
    assert.match(execution.calls, /terraform:state:false/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('confines Terraform emergency state to the private apply root and migrates it', () => {
  const execution = runSyntheticBootstrapExecution({ applyStatus: 1, emergencyState: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stdout, /managed resources: 1/);
    assert.match(execution.result.stderr, /partial or failed/);
    assert.equal(execution.executionDirectories.length, 1);
    const emergencyState = join(execution.executionDirectories[0], 'apply', 'errored.tfstate');
    assert.equal(statSync(emergencyState).mode & 0o777, 0o600);
    assert.match(execution.calls, /terraform:init:true/);
    assert.match(execution.calls, /terraform:state:false/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('refuses a preexisting remote state and preserves the newly-created local state', () => {
  const execution = runSyntheticBootstrapExecution({ preexistingState: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /state-bucket inventory is not empty/);
    assert.equal(execution.executionDirectories.length, 1);
    assert.equal(statSync(join(execution.executionDirectories[0], 'bootstrap.tfstate')).size > 0, true);
    assert.doesNotMatch(execution.calls, /terraform:init:true/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('preserves local recovery material when migration fails or remote read-back diverges', () => {
  for (const options of [{ migrationFails: true }, { divergentRemote: true }]) {
    const execution = runSyntheticBootstrapExecution(options);
    try {
      assert.equal(execution.result.status, 1);
      assert.equal(execution.executionDirectories.length, 1);
      assert.equal(statSync(join(execution.executionDirectories[0], 'bootstrap.tfstate')).size > 0, true);
      if (options.migrationFails) assert.match(execution.result.stderr, /state migration failed/);
      else assert.match(execution.result.stderr, /does not exactly match local state/);
    } finally {
      rmSync(execution.temporary, { recursive: true });
    }
  }
});

test('rejects a generic bootstrap execution approval before invoking external tools', () => {
  const result = spawnSync(
    fileURLToPath(new URL('apply-and-migrate.sh', bootstrapRoot)),
    ['/private/synthetic-plan'],
    {
      cwd: fileURLToPath(bootstrapRoot),
      encoding: 'utf8',
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        MIAKAPP_STAGING_BOOTSTRAP_EXECUTION_AUTHORIZATION: 'miakapp-v4-staging',
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact reviewed apply-and-migrate authorization/);
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
