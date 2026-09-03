import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BOOTSTRAP_STATE_GENERATION,
  BOOTSTRAP_STATE_OBJECT,
  BOOTSTRAP_STATE_SIZE,
  FOUNDATION_STATE_OBJECT,
  PROJECT_DISPLAY_NAME,
  PROJECT_ID,
  PROJECT_NUMBER,
  STATE_BUCKET,
  createPrivateExecutionDirectory,
  fingerprintSavedFoundationPlan,
  foundationStateAuthorization,
  inspectStateBucketInventory,
  reconcileEmptyFoundationStateFiles,
  validateEmptyFoundationPlan,
  validateEmptyFoundationState,
  validateFoundationStateAuthorization,
  verifyProjectObservation,
} from '../terraform/foundation-state.mjs';

const terraformRoot = new URL('../terraform/', import.meta.url);
const initializeStateScript = readFileSync(new URL('initialize-state.sh', terraformRoot), 'utf8');
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const executionCommit = 'b'.repeat(40);
const foundationGeneration = '222';

function emptyPlan() {
  return {
    format_version: '1.2',
    terraform_version: '1.11.3',
    planned_values: { root_module: {} },
    configuration: { root_module: {} },
    timestamp: '2026-09-03T13:04:06Z',
    applyable: false,
    complete: true,
    errored: false,
  };
}

function emptyState(lineage = '12345678-1234-2123-7123-123456789abc') {
  return {
    version: 4,
    terraform_version: '1.11.3',
    serial: 1,
    lineage,
    outputs: {},
    resources: [],
    check_results: null,
  };
}

function stateObject(name, generation, size) {
  return {
    type: 'cloud_object',
    url: `gs://${STATE_BUCKET}/${name}#${generation}`,
    metadata: {
      bucket: STATE_BUCKET,
      generation,
      name,
      size: String(size),
    },
  };
}

function stateBucketInventory({
  generation = foundationGeneration,
  present = false,
  unexpected = false,
  stateSize = 181,
} = {}) {
  const root = `gs://${STATE_BUCKET}/`;
  const inventory = [
    { type: 'unknown', url: root },
    { type: 'prefix', url: `${root}terraform/` },
    { type: 'prefix', url: `${root}terraform/bootstrap/` },
    stateObject(BOOTSTRAP_STATE_OBJECT, BOOTSTRAP_STATE_GENERATION, BOOTSTRAP_STATE_SIZE),
  ];
  if (present) {
    inventory.push(
      { type: 'prefix', url: `${root}terraform/foundation/` },
      stateObject(FOUNDATION_STATE_OBJECT, generation, stateSize),
    );
  }
  if (unexpected) {
    inventory.push({
      type: 'prefix',
      url: `${root}plans/`,
    });
  }
  return inventory;
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o700 });
}

function runSyntheticInitialization({
  applyFails = false,
  dirtyRepository = false,
  divergentObject = false,
  invalidAuthorization = false,
  nonEmptyPlan = false,
  planTamperedBeforeApply = false,
  preexistingState = false,
  stateAppearsBeforeApply = false,
  stateChangesAfterReadback = false,
  stateChangesDuringReconciliation = false,
  unexpectedInventory = false,
} = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-foundation-state-test-'));
  chmodSync(temporary, 0o700);
  const callLog = join(temporary, 'calls.log');
  const remoteMarker = join(temporary, 'remote-present');
  const planPath = join(temporary, 'plan.json');
  const statePath = join(temporary, 'state.json');
  const divergentStatePath = join(temporary, 'divergent-state.json');
  const absentInventoryPath = join(temporary, 'absent-inventory.json');
  const presentInventoryPath = join(temporary, 'present-inventory.json');
  const changedInventoryPath = join(temporary, 'changed-inventory.json');
  const inventoryCountPath = join(temporary, 'inventory-count');
  const savedPlanPathMarker = join(temporary, 'saved-plan-path');
  const stateBytes = JSON.stringify(emptyState());
  const stateSize = Buffer.byteLength(stateBytes);
  const plan = emptyPlan();
  if (nonEmptyPlan) plan.resource_changes = [];
  const divergentState = emptyState();
  divergentState.serial = 2;
  writeFileSync(planPath, JSON.stringify(plan), { mode: 0o600 });
  writeFileSync(statePath, stateBytes, { mode: 0o600 });
  writeFileSync(divergentStatePath, JSON.stringify(divergentState), { mode: 0o600 });
  writeFileSync(
    absentInventoryPath,
    JSON.stringify(stateBucketInventory({ unexpected: unexpectedInventory, stateSize })),
    { mode: 0o600 },
  );
  writeFileSync(
    presentInventoryPath,
    JSON.stringify(stateBucketInventory({ present: true, stateSize })),
    { mode: 0o600 },
  );
  writeFileSync(
    changedInventoryPath,
    JSON.stringify(stateBucketInventory({ generation: '223', present: true, stateSize })),
    { mode: 0o600 },
  );
  if (preexistingState) writeFileSync(remoteMarker, '', { mode: 0o600 });

  writeExecutable(join(temporary, 'git'), String.raw`#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *" rev-parse --show-toplevel "*) printf '%s\n' "$MIAKAPP_FAKE_REPOSITORY_ROOT" ;;
  *" rev-parse HEAD "*) printf '%s\n' "$MIAKAPP_FAKE_EXECUTION_COMMIT" ;;
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
if [[ "$1" == *'/foundation-state.mjs' && "$2" == 'verify-bootstrap-state' ]]; then
  exit 0
fi
exec "$MIAKAPP_REAL_NODE" "$@"
`);
  writeExecutable(join(temporary, 'terraform'), String.raw`#!/usr/bin/env bash
set -euo pipefail
command_name=''
plan_output=''
for argument in "$@"; do
  case "$argument" in
    version|fmt|init|validate|plan|show|apply|state) [[ -z "$command_name" ]] && command_name="$argument" ;;
    -out=*) plan_output="${'${argument#-out=}'}" ;;
  esac
done
printf 'terraform:%s:%s\n' "$command_name" "$*" >>"$MIAKAPP_FAKE_CALL_LOG"
case "$command_name" in
  version) printf '%s\n' '{"terraform_version":"1.11.3"}' ;;
  fmt|init|validate) ;;
  plan)
    printf '%s' 'synthetic-empty-plan' >"$plan_output"
    printf '%s' "$plan_output" >"$MIAKAPP_FAKE_SAVED_PLAN_PATH"
    ;;
  show) command cat "$MIAKAPP_FAKE_PLAN_JSON" ;;
  apply)
    [[ "$MIAKAPP_FAKE_APPLY_FAILS" == true ]] && exit 92
    printf '' >"$MIAKAPP_FAKE_REMOTE_MARKER"
    ;;
  state) command cat "$MIAKAPP_FAKE_STATE_JSON" ;;
  *) exit 93 ;;
esac
`);
  writeExecutable(join(temporary, 'gcloud'), String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'gcloud:%s\n' "$*" >>"$MIAKAPP_FAKE_CALL_LOG"
case " $* " in
  *" projects describe "*)
    printf '%s\n' '{"projectId":"miakapp-v4-staging","projectNumber":"1072737219170","name":"Miakapp V4 Staging","lifecycleState":"ACTIVE"}'
    ;;
  *" storage ls "*)
    inventory_count=0
    if [[ -f "$MIAKAPP_FAKE_INVENTORY_COUNT" ]]; then
      inventory_count="$(command cat "$MIAKAPP_FAKE_INVENTORY_COUNT")"
    fi
    inventory_count=$((inventory_count + 1))
    printf '%s' "$inventory_count" >"$MIAKAPP_FAKE_INVENTORY_COUNT"
    if [[ "$MIAKAPP_FAKE_TAMPER_PLAN" == true \
      && "$inventory_count" -eq 2 \
      && -f "$MIAKAPP_FAKE_SAVED_PLAN_PATH" ]]; then
      saved_plan="$(command cat "$MIAKAPP_FAKE_SAVED_PLAN_PATH")"
      printf '%s' '-tampered' >>"$saved_plan"
    fi
    if [[ -f "$MIAKAPP_FAKE_REMOTE_MARKER" ]]; then
      if [[ "$MIAKAPP_FAKE_STATE_CHANGE_AT" -gt 0 \
        && "$inventory_count" -ge "$MIAKAPP_FAKE_STATE_CHANGE_AT" ]]; then
        command cat "$MIAKAPP_FAKE_CHANGED_INVENTORY"
      else
        command cat "$MIAKAPP_FAKE_PRESENT_INVENTORY"
      fi
    elif [[ "$MIAKAPP_FAKE_STATE_APPEARS_PREAPPLY" == true && "$inventory_count" -ge 2 ]]; then
      command cat "$MIAKAPP_FAKE_PRESENT_INVENTORY"
    else
      command cat "$MIAKAPP_FAKE_ABSENT_INVENTORY"
    fi
    ;;
  *" storage cat "*"terraform/bootstrap/default.tfstate"*)
    printf '%s' 'synthetic-bootstrap-state'
    ;;
  *" storage cat "*"terraform/foundation/default.tfstate"*)
    if [[ "$MIAKAPP_FAKE_DIVERGENT_OBJECT" == true ]]; then
      command cat "$MIAKAPP_FAKE_DIVERGENT_STATE_JSON"
    else
      command cat "$MIAKAPP_FAKE_STATE_JSON"
    fi
    ;;
  *) exit 94 ;;
esac
`);

  const result = spawnSync(
    fileURLToPath(new URL('initialize-state.sh', terraformRoot)),
    [temporary],
    {
      cwd: fileURLToPath(terraformRoot),
      encoding: 'utf8',
      env: {
        HOME: process.env.HOME,
        PATH: `${temporary}:${process.env.PATH}`,
        MIAKAPP_FAKE_ABSENT_INVENTORY: absentInventoryPath,
        MIAKAPP_FAKE_APPLY_FAILS: String(applyFails),
        MIAKAPP_FAKE_CALL_LOG: callLog,
        MIAKAPP_FAKE_CHANGED_INVENTORY: changedInventoryPath,
        MIAKAPP_FAKE_DIRTY_REPOSITORY: String(dirtyRepository),
        MIAKAPP_FAKE_DIVERGENT_OBJECT: String(divergentObject),
        MIAKAPP_FAKE_DIVERGENT_STATE_JSON: divergentStatePath,
        MIAKAPP_FAKE_EXECUTION_COMMIT: executionCommit,
        MIAKAPP_FAKE_INVENTORY_COUNT: inventoryCountPath,
        MIAKAPP_FAKE_PLAN_JSON: planPath,
        MIAKAPP_FAKE_PRESENT_INVENTORY: presentInventoryPath,
        MIAKAPP_FAKE_REMOTE_MARKER: remoteMarker,
        MIAKAPP_FAKE_REPOSITORY_ROOT: repositoryRoot,
        MIAKAPP_FAKE_SAVED_PLAN_PATH: savedPlanPathMarker,
        MIAKAPP_FAKE_STATE_JSON: statePath,
        MIAKAPP_FAKE_STATE_CHANGE_AT: String(
          stateChangesDuringReconciliation
            ? 2
            : stateChangesAfterReadback
              ? (preexistingState ? 3 : 4)
              : 0,
        ),
        MIAKAPP_FAKE_STATE_APPEARS_PREAPPLY: String(stateAppearsBeforeApply),
        MIAKAPP_FAKE_TAMPER_PLAN: String(planTamperedBeforeApply),
        MIAKAPP_REAL_NODE: process.execPath,
        MIAKAPP_STAGING_FOUNDATION_STATE_AUTHORIZATION: invalidAuthorization
          ? PROJECT_ID
          : foundationStateAuthorization(executionCommit),
      },
    },
  );
  return {
    calls: existsSync(callLog) ? readFileSync(callLog, 'utf8') : '',
    executionDirectories: readdirSync(temporary)
      .filter((name) => name.startsWith('miakapp-staging-foundation-state-'))
      .map((name) => join(temporary, name)),
    remoteCreated: existsSync(remoteMarker),
    result,
    temporary,
  };
}

test('binds foundation-state authorization to the bootstrap generation and execution commit', () => {
  const authorization = foundationStateAuthorization(executionCommit);
  assert.equal(
    authorization,
    `initialize-foundation-state:${PROJECT_ID}:${BOOTSTRAP_STATE_GENERATION}:${executionCommit}`,
  );
  assert.equal(validateFoundationStateAuthorization(authorization, executionCommit), authorization);
  assert.throws(
    () => validateFoundationStateAuthorization(PROJECT_ID, executionCommit),
    /exact bootstrap generation and repository-commit authorization/,
  );
  assert.throws(() => foundationStateAuthorization('not-a-commit'), /canonical repository commit/);
});

test('requires private execution material outside the repository', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-foundation-state-private-test-'));
  chmodSync(temporary, 0o700);
  const privateRepositoryDirectory = mkdtempSync(join(repositoryRoot, '.context', 'foundation-state-private-'));
  chmodSync(privateRepositoryDirectory, 0o700);
  try {
    const execution = createPrivateExecutionDirectory(temporary, repositoryRoot);
    assert.equal(
      execution.startsWith(`${realpathSync(temporary)}/miakapp-staging-foundation-state-`),
      true,
    );
    assert.throws(
      () => createPrivateExecutionDirectory(privateRepositoryDirectory, repositoryRoot),
      /outside the repository/,
    );
  } finally {
    rmSync(privateRepositoryDirectory, { recursive: true });
    rmSync(temporary, { recursive: true });
  }
});

test('accepts only the reviewed project and exact current state-bucket boundary', () => {
  assert.equal(verifyProjectObservation({
    projectId: PROJECT_ID,
    projectNumber: PROJECT_NUMBER,
    name: PROJECT_DISPLAY_NAME,
    lifecycleState: 'ACTIVE',
  }).projectId, PROJECT_ID);
  assert.deepEqual(inspectStateBucketInventory(stateBucketInventory()), { state: 'absent' });
  assert.deepEqual(inspectStateBucketInventory(stateBucketInventory({ present: true })), {
    state: 'present',
    generation: foundationGeneration,
    size: 181,
  });
  assert.throws(
    () => inspectStateBucketInventory(stateBucketInventory({ unexpected: true })),
    /unreviewed object or prefix/,
  );
  const foreign = stateBucketInventory();
  foreign[3].metadata.generation = '1';
  assert.throws(() => inspectStateBucketInventory(foreign), /reviewed current state object/);
});

test('accepts only an exact empty Terraform 1.11.3 refresh-only plan', () => {
  assert.deepEqual(validateEmptyFoundationPlan(emptyPlan()), {
    managedResources: 0,
    applyable: false,
  });
  const withChangeShape = emptyPlan();
  withChangeShape.resource_changes = [];
  assert.throws(() => validateEmptyFoundationPlan(withChangeShape), /exactly the reviewed fields/);
  const withResource = emptyPlan();
  withResource.planned_values.root_module.resources = [];
  assert.throws(() => validateEmptyFoundationPlan(withResource), /planned root module/);
  const applyable = emptyPlan();
  applyable.applyable = true;
  assert.throws(() => validateEmptyFoundationPlan(applyable), /exact empty refresh-only plan/);
});

test('accepts and reconciles only the exact canonical empty foundation state', () => {
  assert.equal(validateEmptyFoundationState(emptyState()).serial, 1);
  for (const mutate of [
    (state) => { state.serial = 2; },
    (state) => { state.outputs.unreviewed = { value: true }; },
    (state) => { state.resources.push({ mode: 'managed' }); },
    (state) => { state.check_results = []; },
  ]) {
    const candidate = emptyState();
    mutate(candidate);
    assert.throws(() => validateEmptyFoundationState(candidate), /exact canonical empty state/);
  }

  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-foundation-state-reconcile-test-'));
  chmodSync(temporary, 0o700);
  try {
    const pulled = join(temporary, 'pulled.tfstate');
    const object = join(temporary, 'object.tfstate');
    const plan = join(temporary, 'empty.tfplan');
    writeFileSync(plan, 'synthetic-binary-plan', { mode: 0o600 });
    assert.deepEqual(fingerprintSavedFoundationPlan(plan), {
      sha256: 'fc97d9f8596e939a11f43996541ee92fbd7ae0d2fd68c8b009d9b9c05b7c0505',
      size: 21,
    });
    writeFileSync(pulled, `${JSON.stringify(emptyState())}\n`, { mode: 0o600 });
    writeFileSync(object, JSON.stringify(emptyState()), { mode: 0o600 });
    assert.equal(reconcileEmptyFoundationStateFiles(pulled, object).managedResources, 0);
    writeFileSync(object, JSON.stringify(emptyState('aaaaaaaa-aaaa-2aaa-7aaa-aaaaaaaaaaaa')), {
      mode: 0o600,
    });
    assert.throws(
      () => reconcileEmptyFoundationStateFiles(pulled, object),
      /does not exactly match the current GCS object/,
    );
  } finally {
    rmSync(temporary, { recursive: true });
  }
});

test('Terraform 1.11.3 rejects the saved empty plan if another operation creates state', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-foundation-state-race-test-'));
  chmodSync(temporary, 0o700);
  const root = join(temporary, 'root');
  const data = join(temporary, 'terraform-data');
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(data, { mode: 0o700 });
  writeFileSync(join(root, 'main.tf'), `terraform {
  required_version = "= 1.11.3"

  backend "local" {
    path = "remote.tfstate"
  }
}
`, { mode: 0o600 });
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
    let result = runTerraform(['init', '-input=false', '-no-color']);
    assert.equal(result.status, 0, result.stderr);
    result = runTerraform([
      'plan',
      '-refresh-only',
      '-input=false',
      '-no-color',
      '-out=empty.tfplan',
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = runTerraform([
      'apply',
      '-refresh-only',
      '-auto-approve',
      '-input=false',
      '-no-color',
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = runTerraform(['apply', '-input=false', '-no-color', 'empty.tfplan']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Saved plan is stale/);
  } finally {
    rmSync(temporary, { recursive: true });
  }
});

test('initializes and reconciles an absent state through one verified empty saved plan', () => {
  const execution = runSyntheticInitialization();
  try {
    assert.equal(execution.result.status, 0, execution.result.stderr);
    assert.equal(execution.remoteCreated, true);
    assert.equal(execution.executionDirectories.length, 0);
    assert.match(execution.result.stdout, /initialized and reconciled/);
    assert.match(execution.result.stdout, /managed resources: 0/);
    const planIndex = execution.calls.indexOf('terraform:plan:');
    const showIndex = execution.calls.indexOf('terraform:show:');
    const applyIndex = execution.calls.indexOf('terraform:apply:');
    const pullIndex = execution.calls.indexOf('terraform:state:');
    assert.equal(planIndex >= 0, true);
    assert.equal(showIndex > planIndex, true);
    assert.equal(applyIndex > showIndex, true);
    assert.equal(pullIndex > applyIndex, true);
    assert.match(execution.calls, /terraform:plan:[^\n]*-refresh-only/);
    assert.equal((execution.calls.match(/terraform:apply:/g) ?? []).length, 1);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('reconciles a preexisting exact empty state without plan or mutation', () => {
  const execution = runSyntheticInitialization({ preexistingState: true });
  try {
    assert.equal(execution.result.status, 0, execution.result.stderr);
    assert.match(execution.result.stdout, /reconciled without mutation/);
    assert.doesNotMatch(execution.calls, /terraform:(?:plan|show|apply):/);
    assert.match(execution.calls, /terraform:state:/);
    assert.equal(execution.executionDirectories.length, 0);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('fails closed before apply for an unexpected object or non-empty plan', () => {
  for (const options of [
    { unexpectedInventory: true },
    { nonEmptyPlan: true },
    { planTamperedBeforeApply: true },
  ]) {
    const execution = runSyntheticInitialization(options);
    try {
      assert.equal(execution.result.status, 1);
      assert.equal(execution.remoteCreated, false);
      assert.doesNotMatch(execution.calls, /terraform:apply:/);
      assert.equal(execution.executionDirectories.length, 1);
    } finally {
      rmSync(execution.temporary, { recursive: true });
    }
  }
});

test('fails closed if the current generation changes after object reconciliation', () => {
  const execution = runSyntheticInitialization({ stateChangesAfterReadback: true });
  try {
    assert.equal(execution.result.status, 1);
    assert.equal(execution.remoteCreated, true);
    assert.match(execution.calls, /terraform:apply:/);
    assert.match(execution.result.stderr, /changed during final reconciliation/);
    assert.equal(execution.executionDirectories.length, 1);
  } finally {
    rmSync(execution.temporary, { recursive: true });
  }
});

test('fails closed when state appears before apply or changes during reconciliation', () => {
  for (const options of [
    { stateAppearsBeforeApply: true },
    { preexistingState: true, stateChangesDuringReconciliation: true },
  ]) {
    const execution = runSyntheticInitialization(options);
    try {
      assert.equal(execution.result.status, 1);
      assert.doesNotMatch(execution.calls, /terraform:apply:/);
      assert.equal(execution.executionDirectories.length, 1);
      if (options.stateAppearsBeforeApply) {
        assert.match(execution.result.stderr, /appeared after planning/);
      } else {
        assert.match(execution.result.stderr, /changed during read-only reconciliation/);
      }
    } finally {
      rmSync(execution.temporary, { recursive: true });
    }
  }
});

test('preserves private diagnostics when apply or post-write reconciliation fails', () => {
  for (const options of [{ applyFails: true }, { divergentObject: true }]) {
    const execution = runSyntheticInitialization(options);
    try {
      assert.equal(execution.result.status, 1);
      assert.match(execution.result.stderr, /private diagnostic material was preserved/);
      assert.equal(execution.executionDirectories.length, 1);
      if (options.applyFails) assert.equal(execution.remoteCreated, false);
      else assert.equal(execution.remoteCreated, true);
    } finally {
      rmSync(execution.temporary, { recursive: true });
    }
  }
});

test('rejects authorization, repository, and environment drift before cloud mutation', () => {
  for (const options of [{ invalidAuthorization: true }, { dirtyRepository: true }]) {
    const execution = runSyntheticInitialization(options);
    try {
      assert.equal(execution.result.status, 1);
      assert.equal(execution.remoteCreated, false);
      assert.doesNotMatch(execution.calls, /gcloud:/);
      assert.equal(execution.executionDirectories.length, 0);
    } finally {
      rmSync(execution.temporary, { recursive: true });
    }
  }
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-foundation-state-override-test-'));
  chmodSync(temporary, 0o700);
  try {
    const result = spawnSync(fileURLToPath(new URL('initialize-state.sh', terraformRoot)), [temporary], {
      cwd: fileURLToPath(terraformRoot),
      encoding: 'utf8',
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        MIAKAPP_STAGING_FOUNDATION_STATE_AUTHORIZATION: foundationStateAuthorization(executionCommit),
        TF_VAR_unreviewed: 'value',
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Terraform override environment variables are forbidden/);
  } finally {
    rmSync(temporary, { recursive: true });
  }
});

test('keeps the initializer limited to a verified refresh-only empty-state write', () => {
  assert.match(
    initializeStateScript,
    /approved_foundation_configuration_commit="efa877835dde2f5eedc3d950b2e4c514e606751d"/,
  );
  assert.match(initializeStateScript, /approved_initialization_configuration_commit=/);
  assert.match(initializeStateScript, /verify-authorization/);
  assert.match(initializeStateScript, /requires a clean Git checkout/);
  assert.match(initializeStateScript, /verify-bootstrap-state/);
  assert.match(initializeStateScript, /plan[\s\S]*-refresh-only/);
  assert.match(initializeStateScript, /show -json[\s\S]*verify-empty-plan/);
  assert.match(initializeStateScript, /fingerprint-plan/);
  assert.match(initializeStateScript, /reconcile-empty-states/);
  assert.match(initializeStateScript, /terraform[\s\S]* apply /);
  assert.doesNotMatch(
    initializeStateScript,
    /terraform\s+(?:destroy|import|state\s+push|force-unlock)|gcloud\s+storage\s+(?:cp|rm|mv)/,
  );
});
