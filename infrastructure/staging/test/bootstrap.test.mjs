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
  APPROVED_CONFIGURATION_COMMIT,
  APPROVED_MIGRATION_CONFIGURATION_COMMIT,
  APPROVED_PLAN_SHA256,
  BUDGET_DISPLAY_NAME,
  COMPLETED_STATE_SERIAL,
  COMPLETED_STATE_SHA256,
  FOUNDATION_ACTIVATION,
  FOUNDATION_ACTIVATION_TYPE,
  STATE_BUCKET,
  STATE_OBJECT,
  classifyStateBucket,
  createPrivateExecutionDirectory,
  executionAuthorization,
  migrationAuthorization,
  reconcileBootstrapStates,
  validateCompletedBootstrapState,
  validateExecutionAuthorization,
  validateMigrationAuthorization,
  verifyAbsentTargetInventory,
  verifyBillingObservation,
  verifyEnabledBootstrapServices,
  verifyEmptyInventory,
  verifyEmptyStateBucketInventory,
  verifyProjectObservation,
  verifyProvisionedTargetInventory,
  verifyRecoverableLocalStateFile,
  verifyRecoveryStateFile,
  verifyRemoteStateObject,
  validateRecoveryDescendantState,
  validateRecoveryState,
} from '../bootstrap/bootstrap-execution.mjs';
import {
  BOOTSTRAP_RESOURCE_ADDRESSES,
  RECOVERY_MANAGED_ADDRESSES,
  RECOVERY_STATE_SERIAL,
  RECOVERY_STATE_SHA256,
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
const importsSource = readFileSync(new URL('imports.tf', bootstrapRoot), 'utf8');
const providersSource = readFileSync(new URL('providers.tf', bootstrapRoot), 'utf8');
const iamSource = readFileSync(new URL('iam.tf', bootstrapRoot), 'utf8');
const localsSource = readFileSync(new URL('locals.tf', bootstrapRoot), 'utf8');
const stateSource = readFileSync(new URL('state.tf', bootstrapRoot), 'utf8');
const backendTemplate = readFileSync(new URL('backend.gcs.tf.example', bootstrapRoot), 'utf8');
const planScript = readFileSync(new URL('plan.sh', bootstrapRoot), 'utf8');
const savePlanScript = readFileSync(new URL('save-plan.sh', bootstrapRoot), 'utf8');
const inspectPlanScript = readFileSync(new URL('inspect-plan.sh', bootstrapRoot), 'utf8');
const applyAndMigrateScript = readFileSync(new URL('apply-and-migrate.sh', bootstrapRoot), 'utf8');
const migrateRecoveredStateScript = readFileSync(
  new URL('migrate-recovered-state.sh', bootstrapRoot),
  'utf8',
);
const bootstrapLock = readFileSync(new URL('.terraform.lock.hcl', bootstrapRoot), 'utf8');
const foundationLock = readFileSync(new URL('../terraform/.terraform.lock.hcl', import.meta.url), 'utf8');
const SYNTHETIC_BILLING_ACCOUNT_ID = 'AAAAAA-BBBBBB-CCCCCC';
const SYNTHETIC_BILLING_ACCOUNT_SHA256 = createHash('sha256')
  .update(SYNTHETIC_BILLING_ACCOUNT_ID)
  .digest('hex');

function localSet(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedName}\\s*=\\s*toset\\(\\[([\\s\\S]*?)\\]\\)`).exec(localsSource);
  assert.notEqual(match, null, name);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((value) => value[1]).sort();
}

function guardedPlan(environment) {
  return spawnSync(fileURLToPath(new URL('plan.sh', bootstrapRoot)), ['/tmp/recovery.tfstate'], {
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
  return spawnSync(fileURLToPath(new URL('save-plan.sh', bootstrapRoot)), [
    '/tmp',
    '/tmp/recovery.tfstate',
  ], {
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
  const recoveryAddresses = new Set(RECOVERY_MANAGED_ADDRESSES);
  const resourceChanges = BOOTSTRAP_RESOURCE_ADDRESSES.map((address) => ({
    address,
    mode: 'managed',
    type: address.split('.')[0],
    change: recoveryAddresses.has(address)
      ? {
          actions: ['no-op'],
          before: { id: address },
          after: { id: address },
          before_sensitive: {},
          after_sensitive: {},
          after_unknown: {},
        }
      : {
          actions: ['create'],
          before: null,
          after: { secret },
          before_sensitive: false,
          after_sensitive: { secret: true },
          after_unknown: {},
        },
  }));
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
    recoveryStateSha256: RECOVERY_STATE_SHA256,
  });
}

function syntheticTerraformState(metadata, { additionalAddresses = [], complete = true } = {}) {
  const selectedChanges = complete
    ? metadata.plan.resource_changes
    : metadata.plan.resource_changes.filter(({ address }) => (
        RECOVERY_MANAGED_ADDRESSES.includes(address) || additionalAddresses.includes(address)
      ));
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
        provider: `provider[\"registry.terraform.io/hashicorp/${type === 'google_billing_project_info' ? 'google-beta' : 'google'}\"]`,
        instances: [],
      };
      resources.push(resource);
    }
    let attributes = { id: address };
    if (address === 'google_billing_project_info.staging') {
      attributes = {
        billing_account: SYNTHETIC_BILLING_ACCOUNT_ID,
        deletion_policy: 'PREVENT',
        id: 'projects/miakapp-v4-staging',
        project: 'miakapp-v4-staging',
        timeouts: null,
      };
    } else if (type === 'google_project_service') {
      const service = JSON.parse(rawIndex);
      attributes = {
        deletion_policy: 'PREVENT',
        disable_dependent_services: false,
        disable_on_destroy: false,
        id: `miakapp-v4-staging/${service}`,
        project: 'miakapp-v4-staging',
        service,
        timeouts: null,
      };
    }
    const instance = {
      schema_version: 0,
      attributes,
      sensitive_attributes: [],
    };
    if (rawIndex !== undefined) instance.index_key = JSON.parse(rawIndex);
    resource.instances.push(instance);
  }
  return {
    version: 4,
    terraform_version: '1.11.3',
    serial: complete ? COMPLETED_STATE_SERIAL : RECOVERY_STATE_SERIAL,
    lineage: '12345678-1234-4123-8123-123456789abc',
    outputs: complete
      ? {
          foundation_activation: {
            value: structuredClone(FOUNDATION_ACTIVATION),
            type: structuredClone(FOUNDATION_ACTIVATION_TYPE),
          },
        }
      : {},
    resources,
  };
}

function writeExecutable(path, sourceText) {
  writeFileSync(path, sourceText, { mode: 0o700 });
}

function runSyntheticBootstrapMigration({
  budgetMissing = false,
  dirtyRepository = false,
  divergentRemote = false,
  migrationFails = false,
  missingRecoveredService = false,
  missingServiceAccount = false,
  planLockAlreadyHeld = false,
  preexistingState = false,
  stateLockAlreadyHeld = false,
} = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-bootstrap-migration-test-'));
  chmodSync(temporary, 0o700);
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const plan = syntheticTerraformPlan();
  const planBytes = Buffer.from('synthetic-reviewed-plan');
  const metadata = metadataForPlan(
    planBytes,
    plan,
    APPROVED_CONFIGURATION_COMMIT,
  );
  const completeState = syntheticTerraformState(metadata);
  const divergentState = structuredClone(completeState);
  divergentState.serial += 1;

  const bundle = createPrivateBundle(temporary, repositoryRoot);
  const completedStatePath = join(temporary, 'completed.tfstate');
  writeFileSync(join(bundle, 'bootstrap.tfplan'), planBytes, { mode: 0o600 });
  writeSavedPlanMetadata(join(bundle, 'metadata.json'), metadata);
  const completedStateBytes = JSON.stringify(completeState);
  writeFileSync(completedStatePath, completedStateBytes, { mode: 0o600 });
  if (planLockAlreadyHeld) mkdirSync(`${bundle}.migration-lock`, { mode: 0o700 });
  if (stateLockAlreadyHeld) mkdirSync(`${completedStatePath}.migration-lock`, { mode: 0o700 });
  const planJsonPath = join(temporary, 'plan.json');
  const divergentStatePath = join(temporary, 'divergent-state.json');
  const remoteStatePath = join(temporary, 'remote-state.json');
  const callLogPath = join(temporary, 'calls.log');
  const budgetsPath = join(temporary, 'budgets.json');
  writeFileSync(planJsonPath, JSON.stringify(plan), { mode: 0o600 });
  writeFileSync(divergentStatePath, JSON.stringify(divergentState), { mode: 0o600 });
  writeFileSync(budgetsPath, JSON.stringify(budgetMissing ? [] : [{
    displayName: BUDGET_DISPLAY_NAME,
    name: 'budgets/1',
  }]), { mode: 0o600 });

  writeExecutable(join(temporary, 'git'), String.raw`#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *" rev-parse --show-toplevel "*) printf '%s\n' "$MIAKAPP_FAKE_REPOSITORY_ROOT" ;;
  *" rev-parse HEAD "*) printf '%s\n' 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ;;
  *" status "*)
    [[ "$MIAKAPP_FAKE_DIRTY_REPOSITORY" == true ]] && printf '%s\n' ' M synthetic'
    exit 0
    ;;
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
if [[ "$1" == *'/bootstrap-execution.mjs' && "$2" == 'verify-completed-state' ]]; then
  exit 0
fi
if [[ "$1" == *'/bootstrap-execution.mjs' && "$2" == 'reconcile-state' ]]; then
  if [[ "$MIAKAPP_FAKE_DIVERGENT_REMOTE" == true ]]; then
    printf '%s\n' 'Bootstrap execution rejected: Remote bootstrap state does not exactly match local state' >&2
    exit 1
  fi
  printf '%s\n' 'Bootstrap state reconciled: complete; managed resources: 36; serial: 39'
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
for argument in "$@"; do
  case "$argument" in
    -chdir=*) working_directory="${'${argument#-chdir=}'}" ;;
    version|fmt|init|validate|show|apply|state) [[ -z "$command_name" ]] && command_name="$argument" ;;
    -migrate-state) migrate=true ;;
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
  apply) exit 96 ;;
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
    command cat "$MIAKAPP_FAKE_BUDGETS"
    ;;
  *" services list --enabled "*)
    if [[ "$MIAKAPP_FAKE_MISSING_RECOVERED_SERVICE" == true ]]; then
      printf '%s\n' '[{"config":{"name":"billingbudgets.googleapis.com"}}]'
    else
      printf '%s\n' '[{"config":{"name":"billingbudgets.googleapis.com"}},{"config":{"name":"cloudbilling.googleapis.com"}},{"config":{"name":"cloudresourcemanager.googleapis.com"}},{"config":{"name":"iam.googleapis.com"}},{"config":{"name":"iamcredentials.googleapis.com"}},{"config":{"name":"serviceusage.googleapis.com"}},{"config":{"name":"storage.googleapis.com"}},{"config":{"name":"sts.googleapis.com"}}]'
    fi
    ;;
  *" storage buckets list "*)
    printf '%s\n' '[{"name":"miakapp-v4-staging-components"},{"name":"miakapp-v4-staging-tfstate-1072737219170"}]'
    ;;
  *" iam service-accounts list "*)
    if [[ "$MIAKAPP_FAKE_MISSING_SERVICE_ACCOUNT" == true ]]; then
      printf '%s\n' '[{"email":"miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com"},{"email":"miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com"}]'
    else
      printf '%s\n' '[{"email":"miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com"},{"email":"miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com"},{"email":"miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"}]'
    fi
    ;;
  *" iam workload-identity-pools providers list "*)
    printf '%s\n' '[{"name":"projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan"},{"name":"projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply"}]'
    ;;
  *" iam workload-identity-pools list "*)
    printf '%s\n' '[{"name":"projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github"}]'
    ;;
  *" storage ls "*)
    if [[ "$MIAKAPP_FAKE_PREEXISTING_STATE" == true ]]; then
      printf '%s\n' '[{"url":"gs://miakapp-v4-staging-tfstate-1072737219170/terraform/bootstrap/default.tfstate"}]'
    else
      printf '%s\n' '[{"url":"gs://miakapp-v4-staging-tfstate-1072737219170/"}]'
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
    fileURLToPath(new URL('migrate-recovered-state.sh', bootstrapRoot)),
    [bundle, completedStatePath],
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
        MIAKAPP_FAKE_DIVERGENT_STATE: divergentStatePath,
        MIAKAPP_FAKE_REMOTE_STATE: remoteStatePath,
        MIAKAPP_FAKE_CALL_LOG: callLogPath,
        MIAKAPP_FAKE_BUDGETS: budgetsPath,
        MIAKAPP_FAKE_DIRTY_REPOSITORY: String(dirtyRepository),
        MIAKAPP_FAKE_MIGRATION_FAILS: String(migrationFails),
        MIAKAPP_FAKE_MISSING_RECOVERED_SERVICE: String(missingRecoveredService),
        MIAKAPP_FAKE_MISSING_SERVICE_ACCOUNT: String(missingServiceAccount),
        MIAKAPP_FAKE_PREEXISTING_STATE: String(preexistingState),
        MIAKAPP_FAKE_DIVERGENT_REMOTE: String(divergentRemote),
        MIAKAPP_STAGING_BOOTSTRAP_MIGRATION_AUTHORIZATION: migrationAuthorization('b'.repeat(40)),
      },
    },
  );
  const calls = existsSync(callLogPath) ? readFileSync(callLogPath, 'utf8') : '';
  const executionDirectories = readdirSync(temporary)
    .filter((name) => name.startsWith('miakapp-staging-bootstrap-execution-'))
    .map((name) => join(temporary, name));
  const executionLocks = readdirSync(temporary)
    .filter((name) => name.endsWith('.migration-lock'))
    .map((name) => join(temporary, name));
  return {
    bundle,
    calls,
    completedStateBytes,
    completedStatePath,
    executionDirectories,
    executionLocks,
    result,
    temporary,
  };
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
  assert.equal((providersSource.match(/billing_project\s+= local\.project_id/g) ?? []).length, 2);
  assert.equal((providersSource.match(/user_project_override\s+= true/g) ?? []).length, 2);
  assert.match(billingSource, /sha256\(var\.billing_account_id\) == local\.approved_billing_account_sha256/);
  assert.doesNotMatch(source, /\b[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}\b/);
  assert.match(importsSource, /to = google_billing_project_info\.staging/);
  assert.match(importsSource, /id = "projects\/miakapp-v4-staging"/);
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
  assert.match(planScript, /terraform plan[\s\S]*-input=false[\s\S]*-lock=false[\s\S]*-no-color[\s\S]*-detailed-exitcode[\s\S]*-state="\$recovery_state"/);
  assert.match(planScript, /Credential-file environment variables are forbidden/);
  assert.match(planScript, /approved_fingerprint=/);
  assert.match(planScript, /unset MIAKAPP_STAGING_BILLING_ACCOUNT_ID/);
  assert.match(savePlanScript, /status --porcelain=v1 --untracked-files=all/);
  assert.match(savePlanScript, /create-bundle/);
  assert.match(savePlanScript, /export TF_DATA_DIR="\$terraform_data_dir"/);
  assert.match(savePlanScript, /rm -rf -- "\$terraform_data_dir"/);
  assert.match(savePlanScript, /-state="\$recovery_state"/);
  assert.match(savePlanScript, /-out="\$plan_file"/);
  assert.match(savePlanScript, /show -json "\$plan_file"/);
  assert.match(savePlanScript, /sha256/);
  assert.match(savePlanScript, /verify-recovery-state/);
  assert.match(savePlanScript, /Terraform changed the preserved recovery state while planning/);
  assert.doesNotMatch(savePlanScript, /terraform\s+(apply|destroy|import)|firebase\s+deploy/);
  assert.match(inspectPlanScript, /node "\$bundle_helper" verify/);
  assert.match(inspectPlanScript, /verify-recovery-state/);
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

test('reduces the exact partial-state recovery plan to closed metadata without retaining values', () => {
  const secret = 'AAAAAA-BBBBBB-CCCCCC';
  const metadata = metadataForPlan(Buffer.from('synthetic-plan'), syntheticTerraformPlan(secret));
  assert.equal(metadata.schema, 'miakapp.staging-bootstrap-plan/3');
  assert.equal(metadata.recovery.state_sha256, RECOVERY_STATE_SHA256);
  assert.equal(metadata.recovery.managed_resources, 9);
  assert.deepEqual(metadata.plan.change_summary, {
    create: 27,
    no_op: 9,
    import: 0,
    update: 0,
    delete: 0,
  });
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
    /must be create/,
  );

  const baselineMutation = syntheticTerraformPlan();
  const billingChange = baselineMutation.resource_changes.find(
    ({ address }) => address === 'google_billing_project_info.staging',
  );
  billingChange.change.actions = ['create'];
  assert.throws(
    () => metadataForPlan(Buffer.from('synthetic-plan'), baselineMutation),
    /must be no-op/,
  );

  const unexpectedAddress = syntheticTerraformPlan();
  unexpectedAddress.resource_changes[0].address = 'google_billing_budget.different';
  assert.throws(
    () => metadataForPlan(Buffer.from('synthetic-plan'), unexpectedAddress),
    /not in the reviewed bootstrap inventory/,
  );

  const differentPlan = syntheticTerraformPlan();
  differentPlan.resource_changes.find(
    ({ address }) => address === 'google_billing_budget.staging',
  ).change.actions = ['delete'];
  assert.throws(
    () => validatePlanAgainstMetadata(differentPlan, metadata),
    /must be create/,
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

    const inspected = await inspectPrivateBundle(bundle, 'a'.repeat(40), RECOVERY_STATE_SHA256);
    assert.equal(inspected.plan.sha256, createHash('sha256').update(planBytes).digest('hex'));

    chmodSync(planPath, 0o644);
    await assert.rejects(
      () => inspectPrivateBundle(bundle, 'a'.repeat(40), RECOVERY_STATE_SHA256),
      /must not be accessible by group or other users/,
    );
    chmodSync(planPath, 0o600);

    writeFileSync(planPath, 'tampered-plan', { mode: 0o600 });
    await assert.rejects(
      () => inspectPrivateBundle(bundle, 'a'.repeat(40), RECOVERY_STATE_SHA256),
      /Saved Terraform plan SHA-256/,
    );

    writeFileSync(planPath, planBytes, { mode: 0o600 });
    const unexpectedPath = join(bundle, 'unexpected.txt');
    writeFileSync(unexpectedPath, 'unexpected', { mode: 0o600 });
    await assert.rejects(
      () => inspectPrivateBundle(bundle, 'a'.repeat(40), RECOVERY_STATE_SHA256),
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
    const recoveryStatePath = join(temporary, 'recovery.tfstate');
    const initMarkerPath = join(temporary, 'terraform-initialized');
    const fakeGitPath = join(temporary, 'git');
    const fakeNodePath = join(temporary, 'node');
    const fakeTerraformPath = join(temporary, 'terraform');
    const planBytes = Buffer.from('synthetic-plan-binary');

    writeFileSync(planPath, planBytes, { flag: 'wx', mode: 0o600 });
    writeSavedPlanMetadata(metadataPath, metadataForPlan(planBytes));
    writeFileSync(planJsonPath, JSON.stringify(syntheticTerraformPlan()), { mode: 0o600 });
    writeFileSync(recoveryStatePath, 'synthetic recovery state', { mode: 0o600 });
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
    writeFileSync(fakeNodePath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == *'/bootstrap-execution.mjs' && "$2" == 'verify-recovery-state' ]]; then
  exit 0
fi
if [[ "$1" == *'/saved-plan.mjs' && "$2" == 'sha256' ]]; then
  printf '%s' '${RECOVERY_STATE_SHA256}'
  exit 0
fi
exec "$MIAKAPP_REAL_NODE" "$@"
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
      [bundle, recoveryStatePath],
      {
        cwd: fileURLToPath(bootstrapRoot),
        encoding: 'utf8',
        env: {
          HOME: process.env.HOME,
          PATH: `${temporary}:${process.env.PATH}`,
          MIAKAPP_REAL_NODE: process.execPath,
          MIAKAPP_FAKE_RECOVERY_STATE: recoveryStatePath,
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
  const repositoryCommit = 'b'.repeat(40);
  const authorization = executionAuthorization(repositoryCommit);
  assert.equal(validateExecutionAuthorization(authorization, repositoryCommit), authorization);
  assert.throws(
    () => validateExecutionAuthorization(
      `apply-and-migrate:miakapp-v4-staging:${'f'.repeat(64)}:${repositoryCommit}`,
      repositoryCommit,
    ),
    /exact reviewed plan and repository-commit authorization/,
  );
  assert.throws(
    () => validateExecutionAuthorization(
      `apply-and-migrate:miakapp-v4-staging:0918d21c4677ce0958be9ccc43057d8d76a33857fdfbea066120ba953e30b5c1:${repositoryCommit}`,
      repositoryCommit,
    ),
    /exact reviewed plan and repository-commit authorization/,
  );
  assert.throws(
    () => validateExecutionAuthorization(authorization, 'c'.repeat(40)),
    /exact reviewed plan and repository-commit authorization/,
  );
  assert.throws(
    () => executionAuthorization('not-a-commit'),
    /canonical repository commit/,
  );
  const migration = migrationAuthorization(repositoryCommit);
  assert.equal(validateMigrationAuthorization(migration, repositoryCommit), migration);
  assert.equal(
    migration,
    `migrate-bootstrap-state:miakapp-v4-staging:${COMPLETED_STATE_SHA256}:${repositoryCommit}`,
  );
  assert.throws(
    () => validateMigrationAuthorization(migration, 'c'.repeat(40)),
    /exact preserved state and repository-commit authorization/,
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
  assert.doesNotThrow(() => verifyEmptyStateBucketInventory([]));
  assert.doesNotThrow(() => verifyEmptyStateBucketInventory([
    { url: `gs://${STATE_BUCKET}/` },
  ]));
  assert.throws(
    () => verifyEmptyStateBucketInventory([{ url: `gs://${STATE_BUCKET}/${STATE_OBJECT}` }]),
    /is not empty/,
  );
  assert.throws(
    () => verifyEmptyStateBucketInventory([{ url: `gs://${STATE_BUCKET}/`, size: '0' }]),
    /is not empty/,
  );
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
    /must contain exactly one of every bootstrap target/,
  );
  assert.throws(
    () => verifyProvisionedTargetInventory([
      { displayName: BUDGET_DISPLAY_NAME },
      { displayName: BUDGET_DISPLAY_NAME },
    ], 'budgets'),
    /must contain exactly one of every bootstrap target/,
  );
  assert.throws(
    () => verifyProvisionedTargetInventory([], 'service-accounts'),
    /exactly one of every bootstrap target/,
  );
  assert.doesNotThrow(() => verifyProvisionedTargetInventory([
    { name: STATE_BUCKET },
    { name: 'miakapp-v4-staging-components' },
  ], 'storage-buckets'));
  assert.doesNotThrow(() => verifyProvisionedTargetInventory([
    { email: 'miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com' },
    { email: 'miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com' },
    { email: 'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com' },
  ], 'service-accounts'));
  const bootstrapServices = [
    'billingbudgets.googleapis.com',
    'cloudbilling.googleapis.com',
    'cloudresourcemanager.googleapis.com',
    'iam.googleapis.com',
    'iamcredentials.googleapis.com',
    'serviceusage.googleapis.com',
    'storage.googleapis.com',
    'sts.googleapis.com',
  ].map((name) => ({ config: { name } }));
  assert.deepEqual(verifyEnabledBootstrapServices(bootstrapServices), {
    bootstrapServices: 8,
  });
  assert.throws(
    () => verifyEnabledBootstrapServices(bootstrapServices.slice(1)),
    /missing a recovered bootstrap API/,
  );
  assert.equal(classifyStateBucket([]), 'absent');
  assert.equal(classifyStateBucket([{ name: STATE_BUCKET }]), 'present');
  assert.throws(
    () => classifyStateBucket([{ name: STATE_BUCKET }, { name: STATE_BUCKET }]),
    /duplicate target/,
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
    const bundleSymlink = join(temporary, 'bundle-link');
    symlinkSync(bundle, bundleSymlink);
    assert.throws(
      () => createPrivateExecutionDirectory(
        bundleSymlink,
        fileURLToPath(new URL('../../../', import.meta.url)),
      ),
      /must not be a symbolic link/,
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
  const lineageSha256 = createHash('sha256').update(complete.lineage).digest('hex');

  assert.deepEqual(reconcileBootstrapStates(
    complete,
    structuredClone(complete),
    metadata,
    'complete',
    lineageSha256,
    SYNTHETIC_BILLING_ACCOUNT_SHA256,
  ), {
    mode: 'complete',
    managedResources: 36,
    serial: COMPLETED_STATE_SERIAL,
  });

  assert.deepEqual(validateCompletedBootstrapState(
    complete,
    metadata,
    SYNTHETIC_BILLING_ACCOUNT_SHA256,
    lineageSha256,
  ), {
    mode: 'complete',
    managedResources: 36,
    serial: COMPLETED_STATE_SERIAL,
  });

  const unexpectedSensitiveFlag = structuredClone(complete);
  unexpectedSensitiveFlag.outputs.foundation_activation.sensitive = false;
  assert.throws(
    () => validateCompletedBootstrapState(
      unexpectedSensitiveFlag,
      metadata,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
      lineageSha256,
    ),
    /must contain exactly the reviewed fields/,
  );
  assert.deepEqual(reconcileBootstrapStates(
    partial,
    structuredClone(partial),
    metadata,
    'partial',
    lineageSha256,
    SYNTHETIC_BILLING_ACCOUNT_SHA256,
  ), {
    mode: 'partial',
    managedResources: 9,
    serial: RECOVERY_STATE_SERIAL,
  });

  const divergent = structuredClone(complete);
  divergent.resources[0].instances[0].attributes.id = 'different';
  assert.throws(
    () => reconcileBootstrapStates(
      complete,
      divergent,
      metadata,
      'complete',
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /does not exactly match local state/,
  );

  const unexpected = structuredClone(partial);
  unexpected.resources.push({
    mode: 'managed',
    type: 'google_storage_bucket_object',
    name: 'unexpected',
    provider: 'provider["registry.terraform.io/hashicorp/google"]',
    instances: [{
      schema_version: 0,
      attributes: { id: 'unexpected' },
      sensitive_attributes: [],
    }],
  });
  assert.throws(
    () => reconcileBootstrapStates(
      unexpected,
      structuredClone(unexpected),
      metadata,
      'partial',
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /lost recovery resources or contains unexpected inventory/,
  );

  const wrongOutputType = structuredClone(complete);
  wrongOutputType.outputs.foundation_activation.type = ['map', 'string'];
  assert.throws(
    () => reconcileBootstrapStates(
      wrongOutputType,
      structuredClone(wrongOutputType),
      metadata,
      'complete',
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /foundation_activation output does not match/,
  );

  const unexpectedOutput = structuredClone(complete);
  unexpectedOutput.outputs.private_value = {
    value: 'must-not-be-accepted',
    type: 'string',
    sensitive: true,
  };
  assert.throws(
    () => reconcileBootstrapStates(
      unexpectedOutput,
      structuredClone(unexpectedOutput),
      metadata,
      'complete',
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /outputs must contain exactly/,
  );

  const missingBaseline = structuredClone(partial);
  missingBaseline.resources.shift();
  assert.throws(
    () => reconcileBootstrapStates(
      missingBaseline,
      structuredClone(missingBaseline),
      metadata,
      'partial',
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /billing-link identity is invalid/,
  );

  const stale = structuredClone(partial);
  stale.serial = RECOVERY_STATE_SERIAL - 1;
  assert.throws(
    () => reconcileBootstrapStates(
      stale,
      structuredClone(stale),
      metadata,
      'partial',
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /does not descend from the reviewed recovery state/,
  );

  assert.throws(
    () => reconcileBootstrapStates(partial, structuredClone(partial), metadata, 'partial'),
    /does not retain the reviewed recovery lineage/,
  );

  const prematureActivation = structuredClone(partial);
  prematureActivation.outputs = structuredClone(complete.outputs);
  assert.throws(
    () => reconcileBootstrapStates(
      prematureActivation,
      structuredClone(prematureActivation),
      metadata,
      'partial',
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /Partial Terraform state outputs must contain exactly/,
  );
});

test('validates the exact recovery baseline and only bounded descendants', () => {
  const metadata = metadataForPlan(Buffer.from('synthetic-plan'));
  const recovery = syntheticTerraformState(metadata, { complete: false });
  const lineageSha256 = createHash('sha256').update(recovery.lineage).digest('hex');
  assert.deepEqual(validateRecoveryState(
    recovery,
    lineageSha256,
    SYNTHETIC_BILLING_ACCOUNT_SHA256,
  ), {
    managedResources: 9,
    serial: RECOVERY_STATE_SERIAL,
  });
  assert.deepEqual(validateRecoveryDescendantState(
    recovery,
    lineageSha256,
    SYNTHETIC_BILLING_ACCOUNT_SHA256,
  ), {
    managedResources: 9,
    serial: RECOVERY_STATE_SERIAL,
  });

  const unexpected = structuredClone(recovery);
  unexpected.resources.push({
    mode: 'managed',
    type: 'google_storage_bucket_object',
    name: 'unexpected',
    provider: 'provider["registry.terraform.io/hashicorp/google"]',
    instances: [{
      schema_version: 0,
      attributes: { id: 'unexpected' },
      sensitive_attributes: [],
    }],
  });
  assert.throws(
    () => validateRecoveryDescendantState(
      unexpected,
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /does not descend from the exact preserved recovery state/,
  );
  const missing = structuredClone(recovery);
  missing.resources.at(-1).instances.pop();
  assert.throws(
    () => validateRecoveryDescendantState(
      missing,
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /does not descend from the exact preserved recovery state/,
  );

  const wrongBilling = structuredClone(recovery);
  wrongBilling.resources.find(({ type }) => type === 'google_billing_project_info')
    .instances[0].attributes.project = 'miakapp-3';
  assert.throws(
    () => validateRecoveryState(
      wrongBilling,
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /billing-link attributes are invalid/,
  );

  const wrongService = structuredClone(recovery);
  wrongService.resources.find(({ type }) => type === 'google_project_service')
    .instances[0].attributes.disable_on_destroy = true;
  assert.throws(
    () => validateRecoveryState(
      wrongService,
      lineageSha256,
      SYNTHETIC_BILLING_ACCOUNT_SHA256,
    ),
    /service attributes are invalid/,
  );

  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-recovery-digest-test-'));
  chmodSync(temporary, 0o700);
  try {
    const statePath = join(temporary, 'recovery.tfstate');
    const stateSymlinkPath = join(temporary, 'recovery-link.tfstate');
    writeFileSync(statePath, JSON.stringify(recovery), { mode: 0o600 });
    symlinkSync(statePath, stateSymlinkPath);
    assert.throws(
      () => verifyRecoveryStateFile(
        stateSymlinkPath,
        fileURLToPath(new URL('../../../', import.meta.url)),
      ),
      /must not be a symbolic link/,
    );
    assert.throws(
      () => verifyRecoveryStateFile(
        statePath,
        fileURLToPath(new URL('../../../', import.meta.url)),
      ),
      /does not match the preserved state SHA-256/,
    );
    assert.throws(
      () => verifyRecoveryStateFile(
        'relative.tfstate',
        fileURLToPath(new URL('../../../', import.meta.url)),
      ),
      /must be an absolute path/,
    );
    assert.throws(
      () => verifyRecoveryStateFile(
        fileURLToPath(new URL('../bootstrap/bootstrap-execution.mjs', import.meta.url)),
        fileURLToPath(new URL('../../../', import.meta.url)),
      ),
      /must remain outside the repository/,
    );
  } finally {
    rmSync(temporary, { recursive: true });
  }
});

test('requires failed local state to contain a managed resource before migration', () => {
  const planBytes = Buffer.from('synthetic-plan');
  const metadata = metadataForPlan(planBytes);
  const partial = syntheticTerraformState(metadata, { complete: false });
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-bootstrap-state-test-'));
  chmodSync(temporary, 0o700);
  try {
    const statePath = join(temporary, 'state.json');
    writeFileSync(statePath, JSON.stringify(partial), { mode: 0o600 });
    assert.deepEqual(verifyRecoverableLocalStateFile(statePath), {
      managedResources: 9,
      serial: RECOVERY_STATE_SERIAL,
    });
    partial.lineage = '12345678-1234-2123-7123-123456789abc';
    writeFileSync(statePath, JSON.stringify(partial), { mode: 0o600 });
    assert.deepEqual(verifyRecoverableLocalStateFile(statePath), {
      managedResources: 9,
      serial: RECOVERY_STATE_SERIAL,
    });
    partial.lineage = 'not-a-terraform-lineage';
    writeFileSync(statePath, JSON.stringify(partial), { mode: 0o600 });
    assert.throws(
      () => verifyRecoverableLocalStateFile(statePath),
      /not a canonical Terraform 1\.11\.3 state/,
    );
    const empty = structuredClone(partial);
    empty.lineage = '12345678-1234-2123-7123-123456789abc';
    empty.resources = [];
    writeFileSync(statePath, JSON.stringify(empty), { mode: 0o600 });
    assert.throws(
      () => verifyRecoverableLocalStateFile(statePath),
      /contains no managed resources to migrate/,
    );
  } finally {
    rmSync(temporary, { recursive: true });
  }
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

test('retires the consumed apply path and keeps migration recovery dormant', () => {
  assert.match(applyAndMigrateScript, /permanently retired/);
  assert.doesNotMatch(applyAndMigrateScript, /terraform|gcloud/);
  assert.match(migrateRecoveredStateScript, new RegExp(APPROVED_PLAN_SHA256));
  assert.match(migrateRecoveredStateScript, new RegExp(COMPLETED_STATE_SHA256));
  assert.match(migrateRecoveredStateScript, new RegExp(APPROVED_MIGRATION_CONFIGURATION_COMMIT));
  assert.match(migrateRecoveredStateScript, /verify-migration-authorization/);
  assert.match(migrateRecoveredStateScript, /mkdir -m 700 -- "\$bundle_lock"/);
  assert.match(migrateRecoveredStateScript, /mkdir -m 700 -- "\$state_lock"/);
  assert.match(migrateRecoveredStateScript, /verify-provisioned-targets/);
  assert.match(migrateRecoveredStateScript, /verify-empty-state-bucket/);
  assert.match(migrateRecoveredStateScript, /--billing-project=\$\{project_id\}/);
  assert.match(migrateRecoveredStateScript, /init[\s\S]*-migrate-state[\s\S]*-force-copy/);
  assert.match(migrateRecoveredStateScript, /reconcile-state/);
  assert.match(migrateRecoveredStateScript, /verify-completed-state/);
  assert.match(migrateRecoveredStateScript, /execution_complete=true/);
  assert.match(migrateRecoveredStateScript, /source state remains unchanged/);
  assert.doesNotMatch(migrateRecoveredStateScript, /terraform\s+(?:apply|destroy|import|state\s+push|force-unlock)/);
  assert.doesNotMatch(migrateRecoveredStateScript, /firebase\s+deploy|gcloud\s+storage\s+(?:rm|cp|mv)/);
});

test('orchestrates migration-only read-back and verified cleanup without cloud access', () => {
  const execution = runSyntheticBootstrapMigration();
  try {
    assert.equal(execution.result.status, 0, execution.result.stderr);
    assert.match(execution.result.stdout, /state was migrated and reconciled/);
    assert.match(execution.result.stdout, /managed resources: 36/);
    assert.equal(execution.executionDirectories.length, 0);
    assert.equal(execution.executionLocks.length, 0);
    const localInitIndex = execution.calls.indexOf('terraform:init:false');
    const migrateIndex = execution.calls.indexOf('terraform:init:true');
    const pullIndex = execution.calls.indexOf('terraform:state:false');
    assert.equal(localInitIndex >= 0, true);
    assert.equal(migrateIndex > localInitIndex, true);
    assert.equal(pullIndex > migrateIndex, true);
    assert.doesNotMatch(execution.calls, /terraform:apply/);
    assert.equal(
      readFileSync(execution.completedStatePath, 'utf8'),
      execution.completedStateBytes,
    );
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('requires the provisioned bootstrap budget before migration', () => {
  const execution = runSyntheticBootstrapMigration({ budgetMissing: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /budgets must contain exactly one of every bootstrap target/);
    assert.doesNotMatch(execution.calls, /terraform:init:true/);
    assert.equal(execution.executionDirectories.length, 1);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('requires all eight preserved bootstrap APIs before migration', () => {
  const execution = runSyntheticBootstrapMigration({ missingRecoveredService: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /missing a recovered bootstrap API/);
    assert.doesNotMatch(execution.calls, /terraform:init:true/);
    assert.equal(execution.executionDirectories.length, 1);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('requires all three bootstrap service accounts before migration', () => {
  const execution = runSyntheticBootstrapMigration({ missingServiceAccount: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /service-accounts must contain exactly one of every bootstrap target/);
    assert.doesNotMatch(execution.calls, /terraform:init:true/);
    assert.equal(execution.executionDirectories.length, 1);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('rejects a dirty repository before cloud access', () => {
  const execution = runSyntheticBootstrapMigration({ dirtyRepository: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /requires a clean Git checkout/);
    assert.equal(execution.executionDirectories.length, 0);
    assert.doesNotMatch(execution.calls, /gcloud:/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('rejects concurrent migration of the same private bundle before cloud access', () => {
  const execution = runSyntheticBootstrapMigration({ planLockAlreadyHeld: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /already has an active migration lock/);
    assert.equal(execution.executionDirectories.length, 0);
    assert.equal(execution.executionLocks.length, 1);
    assert.doesNotMatch(execution.calls, /terraform:|gcloud:/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('rejects concurrent migration of the completed state and releases the bundle lock', () => {
  const execution = runSyntheticBootstrapMigration({ stateLockAlreadyHeld: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /completed bootstrap state already has an active migration lock/);
    assert.equal(execution.executionDirectories.length, 0);
    assert.equal(execution.executionLocks.length, 1);
    assert.equal(execution.executionLocks[0].endsWith('completed.tfstate.migration-lock'), true);
    assert.doesNotMatch(execution.calls, /terraform:|gcloud:/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('preserves the authoritative source state when cloud preflight fails', () => {
  const execution = runSyntheticBootstrapMigration({ budgetMissing: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /private recovery material was preserved/);
    assert.equal(execution.executionDirectories.length, 1);
    assert.equal(readFileSync(execution.completedStatePath, 'utf8'), execution.completedStateBytes);
    assert.equal(execution.executionLocks.length, 0);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('preserves the authoritative source state when backend migration fails', () => {
  const execution = runSyntheticBootstrapMigration({ migrationFails: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /state migration failed/);
    assert.equal(execution.executionDirectories.length, 1);
    assert.equal(readFileSync(execution.completedStatePath, 'utf8'), execution.completedStateBytes);
    assert.match(execution.calls, /terraform:init:true/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('preserves the authoritative source state when remote read-back diverges', () => {
  const execution = runSyntheticBootstrapMigration({ divergentRemote: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /does not exactly match local state/);
    assert.match(execution.result.stderr, /private recovery material was preserved/);
    assert.equal(execution.executionDirectories.length, 1);
    assert.equal(readFileSync(execution.completedStatePath, 'utf8'), execution.completedStateBytes);
    assert.match(execution.calls, /terraform:state:false/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('never invokes an infrastructure apply during state recovery', () => {
  const execution = runSyntheticBootstrapMigration();
  try {
    assert.equal(execution.result.status, 0, execution.result.stderr);
    assert.doesNotMatch(execution.calls, /terraform:apply/);
    assert.match(execution.calls, /terraform:init:true/);
    assert.match(execution.calls, /terraform:state:false/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('refuses a preexisting remote state object and preserves the complete local state', () => {
  const execution = runSyntheticBootstrapMigration({ preexistingState: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.match(execution.result.stderr, /State-bucket inventory is not empty/);
    assert.equal(execution.executionDirectories.length, 1);
    assert.equal(readFileSync(execution.completedStatePath, 'utf8'), execution.completedStateBytes);
    assert.doesNotMatch(execution.calls, /terraform:init:true/);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('releases migration locks after migration or reconciliation failures', () => {
  for (const options of [{ migrationFails: true }, { divergentRemote: true }]) {
    const execution = runSyntheticBootstrapMigration(options);
    try {
      assert.equal(execution.result.status, 1);
      assert.equal(execution.executionDirectories.length, 1);
      assert.equal(execution.executionLocks.length, 0);
      if (options.migrationFails) assert.match(execution.result.stderr, /state migration failed/);
      else assert.match(execution.result.stderr, /does not exactly match local state/);
    } finally {
      rmSync(execution.temporary, { recursive: true });
    }
  }
});

test('rejects a generic bootstrap migration approval before cloud access', () => {
  const result = spawnSync(
    fileURLToPath(new URL('migrate-recovered-state.sh', bootstrapRoot)),
    ['/private/synthetic-plan', '/private/synthetic-complete.tfstate'],
    {
      cwd: fileURLToPath(bootstrapRoot),
      encoding: 'utf8',
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        MIAKAPP_STAGING_BOOTSTRAP_MIGRATION_AUTHORIZATION: 'miakapp-v4-staging',
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact preserved state and repository-commit authorization/);
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
