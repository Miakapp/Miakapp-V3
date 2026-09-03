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
const foundationPlanValidatorPath = fileURLToPath(
  new URL('validate-foundation-plan.mjs', automationRoot),
);
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
  environment.CLOUDSDK_METRICS_ENVIRONMENT = 'github-actions-setup-gcloud';
  environment.CLOUDSDK_METRICS_ENVIRONMENT_VERSION = '3.0.1';
  return environment;
}

const recoveryProject = 'miakapp-v4-staging';
const recoveryProjectNumber = '1072737219170';
const recoveryRegion = 'europe-west9';
const recoveryRuntime = `miakapp-control-plane@${recoveryProject}.iam.gserviceaccount.com`;
const recoveryMember = `serviceAccount:${recoveryRuntime}`;
const recoveryBucket = 'miakapp-v4-staging-components';
const recoveryKeyRing = `projects/${recoveryProject}/locations/${recoveryRegion}/keyRings/${recoveryProject}`;
const recoverySigningKey = `${recoveryKeyRing}/cryptoKeys/access-token-signing`;
const recoveryLabels = {
  environment: 'staging',
  'goog-terraform-provisioned': 'true',
  'managed-by': 'terraform',
  product: 'miakapp-v4',
};
const recoveryServices = [
  'artifactregistry.googleapis.com',
  'cloudbuild.googleapis.com',
  'cloudfunctions.googleapis.com',
  'cloudkms.googleapis.com',
  'eventarc.googleapis.com',
  'fcm.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'firestore.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'pubsub.googleapis.com',
  'run.googleapis.com',
  'secretmanager.googleapis.com',
];
const recoverySecrets = [
  'miakapp-audit-hmac',
  'miakapp-component-hmac',
  'miakapp-home-key-pepper',
  'miakapp-network-hmac',
  'miakapp-push-hmac',
];
const recoveryActivation = {
  apply_provider: `projects/${recoveryProjectNumber}/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply`,
  bootstrap_prefix: 'terraform/bootstrap',
  component_bucket: recoveryBucket,
  deployer_service_account: `miakapp-tf-apply@${recoveryProject}.iam.gserviceaccount.com`,
  foundation_prefix: 'terraform/foundation',
  github_repository_id: '354682190',
  github_repository_owner_id: '83046838',
  plan_provider: `projects/${recoveryProjectNumber}/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan`,
  planner_service_account: `miakapp-tf-plan@${recoveryProject}.iam.gserviceaccount.com`,
  project_id: recoveryProject,
  project_number: recoveryProjectNumber,
  region: recoveryRegion,
  runtime_service_account: recoveryRuntime,
  schema: 'miakapp.staging-bootstrap/1',
  state_bucket: 'miakapp-v4-staging-tfstate-1072737219170',
};

function recoverySensitive(type) {
  if (type === 'google_firestore_database') return { cmek_config: [] };
  if (type === 'google_firestore_field') {
    return { index_config: [{ indexes: [] }], ttl_config: [{}] };
  }
  if (type === 'google_kms_crypto_key') {
    return {
      effective_labels: {},
      labels: {},
      primary: [],
      terraform_labels: {},
      version_template: [{}],
    };
  }
  if (type === 'google_secret_manager_secret') {
    return {
      annotations: {},
      effective_annotations: {},
      effective_labels: {},
      labels: {},
      replication: [{ auto: [{ customer_managed_encryption: [] }], user_managed: [] }],
      rotation: [],
      terraform_labels: {},
      topics: [],
      version_aliases: {},
    };
  }
  if (type === 'terraform_data') return { input: {}, output: {} };
  return {};
}

function noOpRecoveryChange(address, type, name, after, index) {
  const resource = {
    address,
    mode: 'managed',
    type,
    name,
    provider_name: type === 'terraform_data'
      ? 'terraform.io/builtin/terraform'
      : 'registry.terraform.io/hashicorp/google',
    change: {
      actions: ['no-op'],
      before: structuredClone(after),
      after,
      after_unknown: {},
      before_sensitive: recoverySensitive(type),
      after_sensitive: recoverySensitive(type),
    },
  };
  if (index !== undefined) resource.index = index;
  return resource;
}

function createRecoveryChange(address, type, name, after, index) {
  const resource = {
    address,
    mode: 'managed',
    type,
    name,
    provider_name: 'registry.terraform.io/hashicorp/google',
    change: {
      actions: ['create'],
      before: null,
      after,
      after_unknown: { condition: [], etag: true, id: true },
      before_sensitive: false,
      after_sensitive: { condition: [] },
    },
  };
  if (index !== undefined) resource.index = index;
  return resource;
}

function recoveryResourceChanges() {
  const firestore = {
    app_engine_integration_mode: 'DISABLED',
    cmek_config: [],
    concurrency_mode: 'PESSIMISTIC',
    create_time: '2026-09-03T16:08:26Z',
    database_edition: 'STANDARD',
    delete_protection_state: 'DELETE_PROTECTION_ENABLED',
    deletion_policy: 'ABANDON',
    earliest_version_time: '2026-09-03T16:08:26Z',
    etag: 'reviewed_etag_value',
    firestore_data_access_mode: '',
    id: `projects/${recoveryProject}/databases/(default)`,
    key_prefix: '',
    location_id: recoveryRegion,
    mongodb_compatible_data_access_mode: '',
    name: '(default)',
    point_in_time_recovery_enablement: 'POINT_IN_TIME_RECOVERY_DISABLED',
    project: recoveryProject,
    realtime_updates_mode: 'REALTIME_UPDATES_MODE_ENABLED',
    tags: null,
    timeouts: null,
    type: 'FIRESTORE_NATIVE',
    uid: '5165f58b-597a-4cea-af30-d13eb4214111',
    update_time: '2026-09-03T16:08:26Z',
    version_retention_period: '3600s',
  };
  const changes = [
    noOpRecoveryChange(
      'google_firestore_database.default',
      'google_firestore_database',
      'default',
      firestore,
    ),
  ];
  for (const collection of ['controlAdmissionBuckets', 'controlAudit', 'pushChallenges']) {
    const fieldName = [
      `projects/${recoveryProject}/databases/(default)/collectionGroups`,
      `${collection}/fields/expires_at`,
    ].join('/');
    changes.push(noOpRecoveryChange(
      `google_firestore_field.ttl["${collection}"]`,
      'google_firestore_field',
      'ttl',
      {
        collection,
        database: '(default)',
        deletion_policy: 'DELETE',
        field: 'expires_at',
        id: fieldName,
        index_config: [{ indexes: [] }],
        name: fieldName,
        project: recoveryProject,
        skip_wait: false,
        timeouts: null,
        ttl_config: [{ expiration_offset: '', state: 'ACTIVE' }],
      },
      collection,
    ));
  }
  changes.push(
    noOpRecoveryChange(
      'google_kms_crypto_key.access_token_signing',
      'google_kms_crypto_key',
      'access_token_signing',
      {
        crypto_key_backend: '',
        deletion_policy: 'PREVENT',
        destroy_scheduled_duration: '2592000s',
        effective_labels: recoveryLabels,
        id: recoverySigningKey,
        import_only: false,
        key_ring: recoveryKeyRing,
        labels: {},
        name: 'access-token-signing',
        primary: [],
        purpose: 'ASYMMETRIC_SIGN',
        rotation_period: '',
        skip_initial_version_creation: false,
        terraform_labels: recoveryLabels,
        timeouts: null,
        version_template: [{ algorithm: 'EC_SIGN_ED25519', protection_level: 'SOFTWARE' }],
      },
    ),
    createRecoveryChange(
      'google_kms_crypto_key_iam_member.access_token_signer',
      'google_kms_crypto_key_iam_member',
      'access_token_signer',
      {
        condition: [],
        crypto_key_id: recoverySigningKey,
        member: recoveryMember,
        role: 'roles/cloudkms.signerVerifier',
      },
    ),
    noOpRecoveryChange(
      'google_kms_key_ring.access_tokens',
      'google_kms_key_ring',
      'access_tokens',
      {
        id: recoveryKeyRing,
        location: recoveryRegion,
        name: recoveryProject,
        project: recoveryProject,
        timeouts: null,
      },
    ),
  );
  for (const service of recoveryServices) {
    changes.push(noOpRecoveryChange(
      `google_project_service.required["${service}"]`,
      'google_project_service',
      'required',
      {
        deletion_policy: 'PREVENT',
        disable_dependent_services: false,
        disable_on_destroy: false,
        id: `${recoveryProject}/${service}`,
        project: recoveryProject,
        service,
        timeouts: null,
      },
      service,
    ));
  }
  for (const secret of recoverySecrets) {
    changes.push(
      noOpRecoveryChange(
        `google_secret_manager_secret.runtime["${secret}"]`,
        'google_secret_manager_secret',
        'runtime',
        {
          annotations: {},
          create_time: '2026-09-03T16:08:23Z',
          deletion_policy: 'DELETE',
          deletion_protection: true,
          effective_annotations: {},
          effective_labels: recoveryLabels,
          expire_time: '',
          id: `projects/${recoveryProject}/secrets/${secret}`,
          labels: {},
          name: `projects/${recoveryProjectNumber}/secrets/${secret}`,
          project: recoveryProject,
          replication: [{ auto: [{ customer_managed_encryption: [] }], user_managed: [] }],
          rotation: [],
          secret_id: secret,
          tags: null,
          terraform_labels: recoveryLabels,
          timeouts: null,
          topics: [],
          ttl: null,
          version_aliases: {},
          version_destroy_ttl: '',
        },
        secret,
      ),
      createRecoveryChange(
        `google_secret_manager_secret_iam_member.runtime["${secret}"]`,
        'google_secret_manager_secret_iam_member',
        'runtime',
        {
          condition: [],
          member: recoveryMember,
          project: recoveryProject,
          role: 'roles/secretmanager.secretAccessor',
          secret_id: secret,
        },
        secret,
      ),
    );
  }
  for (const role of ['roles/storage.objectCreator', 'roles/storage.objectViewer']) {
    changes.push(createRecoveryChange(
      `google_storage_bucket_iam_member.component_objects["${role}"]`,
      'google_storage_bucket_iam_member',
      'component_objects',
      {
        bucket: recoveryBucket,
        condition: [],
        member: recoveryMember,
        role,
        timeouts: null,
      },
      role,
    ));
  }
  changes.push(noOpRecoveryChange(
    'terraform_data.bootstrap_guard',
    'terraform_data',
    'bootstrap_guard',
    {
      id: 'a4547b36-2f2f-d48b-9f34-e6cb97260306',
      input: recoveryActivation,
      output: recoveryActivation,
      triggers_replace: null,
    },
  ));
  return changes;
}

function recoveryDrifts(resourceChanges) {
  const byAddress = new Map(resourceChanges.map((resource) => [resource.address, resource]));
  const drift = (address, before, beforeSensitive) => {
    const resource = byAddress.get(address);
    const result = {
      address: resource.address,
      mode: resource.mode,
      type: resource.type,
      name: resource.name,
      provider_name: resource.provider_name,
      change: {
        actions: ['update'],
        before,
        after: structuredClone(resource.change.after),
        after_unknown: {},
        before_sensitive: beforeSensitive,
        after_sensitive: structuredClone(resource.change.after_sensitive),
      },
    };
    if (resource.index !== undefined) result.index = resource.index;
    return result;
  };
  const firestoreAddress = 'google_firestore_database.default';
  const firestore = byAddress.get(firestoreAddress);
  const drifts = [drift(
    firestoreAddress,
    { ...structuredClone(firestore.change.after), etag: 'previous_etag_value' },
    { cmek_config: [] },
  )];
  const keyAddress = 'google_kms_crypto_key.access_token_signing';
  const key = byAddress.get(keyAddress);
  const keyBeforeSensitive = structuredClone(key.change.after_sensitive);
  delete keyBeforeSensitive.labels;
  drifts.push(drift(
    keyAddress,
    { ...structuredClone(key.change.after), labels: null },
    keyBeforeSensitive,
  ));
  for (const secret of recoverySecrets) {
    const address = `google_secret_manager_secret.runtime["${secret}"]`;
    const resource = byAddress.get(address);
    const beforeSensitive = structuredClone(resource.change.after_sensitive);
    delete beforeSensitive.annotations;
    delete beforeSensitive.labels;
    delete beforeSensitive.version_aliases;
    drifts.push(drift(address, {
      ...structuredClone(resource.change.after),
      annotations: null,
      labels: null,
      version_aliases: null,
    }, beforeSensitive));
  }
  return drifts;
}

function recoveryPlanUntilPriorState() {
  const outputValue = {
    component_bucket: recoveryBucket,
    firestore_database: '(default)',
    project_id: recoveryProject,
    project_number: recoveryProjectNumber,
    region: recoveryRegion,
    runtime_service_account: recoveryRuntime,
    secret_ids: recoverySecrets,
    signing_key: recoverySigningKey,
  };
  const resourceChanges = recoveryResourceChanges();
  return {
    format_version: '1.2',
    terraform_version: '1.11.3',
    applyable: true,
    complete: true,
    errored: false,
    timestamp: '2026-09-03T16:18:31Z',
    resource_changes: resourceChanges,
    output_changes: {
      staging_foundation: {
        actions: ['create'],
        before: null,
        after: outputValue,
        after_unknown: false,
        before_sensitive: false,
        after_sensitive: false,
      },
    },
    resource_drift: recoveryDrifts(resourceChanges),
    prior_state: {
      format_version: '1.0',
      terraform_version: '1.11.3',
      values: {
        outputs: {
          staging_foundation: {
            sensitive: false,
            value: outputValue,
            type: [
              'object',
              {
                component_bucket: 'string',
                firestore_database: 'string',
                project_id: 'string',
                project_number: 'string',
                region: 'string',
                runtime_service_account: 'string',
                secret_ids: ['list', 'string'],
                signing_key: 'string',
              },
            ],
          },
        },
        root_module: { resources: [] },
      },
    },
    planned_values: {},
    configuration: {},
    relevant_attributes: [],
    checks: [],
  };
}

test('authorizes only the hash-bound manual partial-recovery workflow after verified GitHub posture', () => {
  assert.equal(policy.status, 'manual_keyless_partial_foundation_recovery_authorized');
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
    foundation_apply_authorized: true,
    active_workflow_path: '.github/workflows/staging-terraform.yml',
    blueprint_path: 'infrastructure/staging/automation/staging-terraform.yml',
    workflow_sha256: '701891a221ee949c5b1f0d67e537911fc7fa1476f46c5e670593eb341f2cae2e',
  });
  assert.equal(
    statSync(new URL('../../../.github/workflows/staging-terraform.yml', import.meta.url)).isFile(),
    true,
  );
  assert.equal(activeWorkflow, workflow);
  assert.match(checkScript, /--require-apply-activation/);
  assert.equal(
    verifyInstalledWorkflow(fileURLToPath(repositoryRoot), policy),
    policy.activation.workflow_sha256,
  );
  assert.doesNotThrow(() => validateGitHubPolicy(policy, { requirePlanActivation: true }));
  assert.doesNotThrow(() => validateGitHubPolicy(policy, { requireApplyActivation: true }));
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
  rejects((candidate) => { candidate.activation.foundation_apply_authorized = false; }, /foundation_apply_authorized/);
  rejects((candidate) => { candidate.activation.workflow_sha256 = '0'.repeat(64); }, /workflow_sha256/);
  rejects((candidate) => { candidate.unreviewed = true; }, /must contain exactly/);
});

test('the policy CLI accepts both explicitly activated modes without a stack trace', () => {
  const planResult = spawnSync(process.execPath, [
    fileURLToPath(new URL('validate-policy.mjs', automationRoot)),
    '--require-plan-activation',
    policyPath,
  ], { encoding: 'utf8' });
  assert.equal(planResult.status, 0, planResult.stderr);
  assert.match(planResult.stdout, /manual keyless partial-foundation recovery is authorized/);
  assert.equal(planResult.stderr, '');

  const applyResult = spawnSync(process.execPath, [
    fileURLToPath(new URL('validate-policy.mjs', automationRoot)),
    '--require-apply-activation',
    policyPath,
  ], { encoding: 'utf8' });
  assert.equal(applyResult.status, 0, applyResult.stderr);
  assert.match(applyResult.stdout, /manual keyless partial-foundation recovery is authorized/);
  assert.equal(applyResult.stderr, '');
});

test('keeps the installed partial-recovery workflow manual, reviewed, and least-permission', () => {
  assert.doesNotThrow(() => validateAutomationRoot(automationRoot));
  assert.equal(activeWorkflow, workflow);
  assert.match(workflow, /^name: Staging Terraform foundation recovery/m);
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /pull_request:|\npush:/);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /node infrastructure\/staging\/automation\/validate-policy\.mjs \\\n            --require-apply-activation/);
  assert.match(workflow, /test "\$CONFIRMATION" = 'recover-miakapp-v4-staging'/);
  assert.match(workflow, /environment: miakapp-v4-staging-plan/);
  assert.match(workflow, /environment: miakapp-v4-staging-apply/);
  assert.match(workflow, /MIAKAPP_PLAN_OBJECT: \$\{\{ needs\.plan\.outputs\['plan-object'\] \}\}/);
  assert.match(workflow, /MIAKAPP_PLAN_SHA256: \$\{\{ needs\.plan\.outputs\['plan-sha256'\] \}\}/);
  assert.match(workflow, /run: infrastructure\/staging\/automation\/apply\.sh/);
  assert.equal((workflow.match(/id-token: write/g) ?? []).length, 2);
  assert.equal((workflow.match(/contents: read/g) ?? []).length, 3);
  assert.equal((workflow.match(/version: '541\.0\.0'/g) ?? []).length, 2);
  assert.equal((workflow.match(/terraform_version: 1\.11\.3/g) ?? []).length, 2);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 3);
  assert.equal((workflow.match(/cleanup_credentials: true/g) ?? []).length, 2);
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

test('passes the exact create-only private plan to the separately admitted apply job', () => {
  assert.match(planScript, /plans\/\$\{GITHUB_SHA\}\/\$\{GITHUB_RUN_ID\}\/\$\{GITHUB_RUN_ATTEMPT\}\/foundation\.tfplan/);
  assert.match(planScript, /--if-generation-match=0/);
  assert.match(planScript, /plan-sha256/);
  assert.match(planScript, /foundation-plan\.failure\.log/);
  assert.match(planScript, /private diagnostic/);
  assert.match(planScript, /wc -c/);
  assert.match(planScript, /1048576/);
  assert.equal((planScript.match(/--if-generation-match=0/g) ?? []).length, 2);
  assert.match(planScript, /summarize-plan\.mjs/);
  assert.match(planScript, /validate-foundation-plan\.mjs/);
  assert.match(
    planScript,
    /validate-foundation-plan\.mjs" \\\n    --profile partial-foundation-recovery/,
  );
  assert.ok(
    planScript.indexOf('validate-foundation-plan.mjs') < planScript.indexOf('summarize-plan.mjs'),
  );
  const savedPlanUpload = planScript.indexOf('"$plan_file" \\\n  "$plan_object"');
  assert.notEqual(savedPlanUpload, -1);
  assert.ok(planScript.indexOf('validate-foundation-plan.mjs') < savedPlanUpload);
  assert.doesNotMatch(`${workflow}\n${planScript}\n${applyScript}`, /upload-artifact|download-artifact/);
  assert.match(applyScript, /expected_object="gs:\/\/miakapp-v4-staging-tfstate-1072737219170\/plans/);
  assert.match(applyScript, /actual_sha256/);
  assert.match(applyScript, /\$actual_sha256" != "\$MIAKAPP_PLAN_SHA256/);
  assert.match(applyScript, /terraform -chdir="\$terraform_root" apply/);
  assert.match(applyScript, /-parallelism=1/);
  assert.match(applyScript, /--require-apply-activation/);
  assert.match(applyScript, /validate-foundation-plan\.mjs/);
  assert.match(
    applyScript,
    /validate-foundation-plan\.mjs" \\\n    --profile partial-foundation-recovery/,
  );
  assert.ok(
    applyScript.indexOf('validate-foundation-plan.mjs')
      < applyScript.indexOf('terraform -chdir="$terraform_root" apply'),
  );
  assert.doesNotMatch(planScript, /terraform -chdir="\$terraform_root" apply/);
  assert.match(workflow, /apply\.sh/);
  assert.match(applyScript, /-detailed-exitcode/);
  assert.ok(
    applyScript.indexOf('terraform -chdir="$terraform_root" apply')
      < applyScript.indexOf('-detailed-exitcode'),
  );
  for (const script of [planScript, applyScript]) {
    assert.match(script, /CLOUDSDK_METRICS_ENVIRONMENT:-.*github-actions-setup-gcloud/);
    assert.match(script, /CLOUDSDK_METRICS_ENVIRONMENT_VERSION:-.*3\.0\.1/);
  }
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

test('accepts a canonical apply policy then rejects missing keyless credentials before cloud access', () => {
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
  assert.match(result.stderr, /keyless Google credential file is missing/);
  assert.doesNotMatch(result.stderr, /activation\.foundation_apply_authorized/);
});

test('retains bounded plan failures only in the private create-only prefix', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-staging-plan-failure-'));
  const commands = join(temporary, 'commands');
  const runner = join(temporary, 'runner');
  const output = join(temporary, 'github-output');
  const commandLog = join(temporary, 'gcloud-commands');
  const credential = fileURLToPath(
    new URL(`../../../gha-creds-plan-failure-${process.pid}.json`, import.meta.url),
  );
  mkdirSync(commands, { mode: 0o700 });
  mkdirSync(runner, { mode: 0o700 });
  writeFileSync(output, '', { mode: 0o600 });
  writeFileSync(commandLog, '', { mode: 0o600 });
  writeFileSync(credential, '{}\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(commands, 'terraform'), [
    '#!/usr/bin/env bash',
    'for argument in "$@"; do',
    '  if [[ "$argument" == "plan" ]]; then',
    '    echo "synthetic private provider detail" >&2',
    '    exit 1',
    '  fi',
    'done',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o700 });
  writeFileSync(join(commands, 'gcloud'), [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$*" >>"$COMMAND_LOG"',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o700 });
  try {
    const result = runScript('plan.sh', {
      ...exactGitHubEnvironment('plan'),
      PATH: `${commands}:${process.env.PATH}`,
      RUNNER_TEMP: runner,
      GITHUB_OUTPUT: output,
      COMMAND_LOG: commandLog,
      GOOGLE_APPLICATION_CREDENTIALS: credential,
      CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: credential,
      GOOGLE_GHA_CREDS_PATH: credential,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Terraform plan failed; private diagnostic:/);
    assert.match(
      result.stderr,
      /plans\/a{40}\/123456789\/1\/foundation-plan\.failure\.log/,
    );
    assert.match(result.stderr, /SHA-256: [0-9a-f]{64}/);
    assert.doesNotMatch(result.stderr, /synthetic private provider detail/);
    const gcloudCommands = readFileSync(commandLog, 'utf8');
    assert.match(gcloudCommands, /foundation-plan\.failure\.log/);
    assert.match(gcloudCommands, /--if-generation-match=0/);
    assert.doesNotMatch(gcloudCommands, /foundation\.tfplan/);
    assert.equal(readdirSync(runner).length, 0);
  } finally {
    unlinkSync(credential);
    rmSync(temporary, { recursive: true });
  }
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

test('rejects destructive, altered, and unreviewed initial foundation plans without leaking values', () => {
  const remainingChanges = Array.from({ length: 34 }, (_, index) => ({
    address: `terraform_data.synthetic["${index}"]`,
    mode: 'managed',
    type: 'terraform_data',
    name: 'synthetic',
    provider_name: 'terraform.io/builtin/terraform',
    index: `${index}`,
    change: { actions: ['create'], before: null, after: {} },
  }));
  const planWith = (firstChange) => ({
    format_version: '1.2',
    terraform_version: '1.11.3',
    applyable: true,
    complete: true,
    errored: false,
    resource_changes: [firstChange, ...remainingChanges],
  });
  const runValidator = (plan) => spawnSync(process.execPath, [foundationPlanValidatorPath], {
    input: JSON.stringify(plan),
    encoding: 'utf8',
  });
  const firestoreChange = {
    address: 'google_firestore_database.default',
    mode: 'managed',
    type: 'google_firestore_database',
    name: 'default',
    provider_name: 'registry.terraform.io/hashicorp/google',
    change: { actions: ['delete'], before: { private_value: 'do-not-log' }, after: null },
  };

  const destructive = runValidator(planWith(firestoreChange));
  assert.equal(destructive.status, 1);
  assert.match(destructive.stderr, /change\.actions does not match the reviewed value/);
  assert.doesNotMatch(`${destructive.stdout}${destructive.stderr}`, /do-not-log/);

  const altered = runValidator(planWith({
    ...firestoreChange,
    change: {
      actions: ['create'],
      before: null,
      after: { member: 'allUsers', private_value: 'also-do-not-log' },
    },
  }));
  assert.equal(altered.status, 1);
  assert.match(altered.stderr, /change\.after does not match the reviewed value/);
  assert.doesNotMatch(`${altered.stdout}${altered.stderr}`, /allUsers|also-do-not-log/);

  const unreviewed = runValidator(planWith({
    ...firestoreChange,
    address: 'google_secret_manager_secret_version.unreviewed',
    type: 'google_secret_manager_secret_version',
    name: 'unreviewed',
    change: { actions: ['create'], before: null, after: {} },
  }));
  assert.equal(unreviewed.status, 1);
  assert.match(unreviewed.stderr, /unreviewed resource address/);

  const hostileAddress = runValidator(planWith({
    ...firestoreChange,
    address: 'safe\nprivate-value',
  }));
  assert.equal(hostileAddress.status, 1);
  assert.match(hostileAddress.stderr, /invalid address/);
  assert.doesNotMatch(`${hostileAddress.stdout}${hostileAddress.stderr}`, /private-value/);
});

test('rejects destructive, public, unreviewed, and state-inconsistent recovery plans', () => {
  const runValidator = (plan) => spawnSync(process.execPath, [
    foundationPlanValidatorPath,
    '--profile',
    'partial-foundation-recovery',
  ], {
    input: JSON.stringify(plan),
    encoding: 'utf8',
  });

  const destructivePlan = recoveryPlanUntilPriorState();
  const kmsBinding = destructivePlan.resource_changes.find((resource) => (
    resource.address === 'google_kms_crypto_key_iam_member.access_token_signer'
  ));
  kmsBinding.change.actions = ['delete'];
  const destructive = runValidator(destructivePlan);
  assert.equal(destructive.status, 1);
  assert.match(destructive.stderr, /change\.actions does not match the reviewed value/);

  const publicPlan = recoveryPlanUntilPriorState();
  const publicBinding = publicPlan.resource_changes.find((resource) => (
    resource.address === 'google_kms_crypto_key_iam_member.access_token_signer'
  ));
  publicBinding.change.after.member = 'allUsers';
  const publicResult = runValidator(publicPlan);
  assert.equal(publicResult.status, 1);
  assert.match(publicResult.stderr, /change\.after does not match the reviewed value/);
  assert.doesNotMatch(`${publicResult.stdout}${publicResult.stderr}`, /allUsers/);

  const extraResourcePlan = recoveryPlanUntilPriorState();
  extraResourcePlan.resource_changes[0].address = 'google_compute_network.unreviewed';
  const extraResource = runValidator(extraResourcePlan);
  assert.equal(extraResource.status, 1);
  assert.match(extraResource.stderr, /unreviewed resource address/);

  const wrongPriorInventory = runValidator(recoveryPlanUntilPriorState());
  assert.equal(wrongPriorInventory.status, 1);
  assert.match(wrongPriorInventory.stderr, /prior state must contain exactly 28 resources/);

  const destructiveDriftPlan = recoveryPlanUntilPriorState();
  destructiveDriftPlan.resource_drift[0].change.actions = ['delete'];
  const destructiveDrift = runValidator(destructiveDriftPlan);
  assert.equal(destructiveDrift.status, 1);
  assert.match(destructiveDrift.stderr, /drift .*change\.actions does not match/);

  const extraDriftPlan = recoveryPlanUntilPriorState();
  extraDriftPlan.resource_drift[0].address = 'google_kms_crypto_key_iam_member.access_token_signer';
  const extraDrift = runValidator(extraDriftPlan);
  assert.equal(extraDrift.status, 1);
  assert.match(extraDrift.stderr, /unreviewed resource drift/);
});

test('requires an explicit supported foundation plan profile', () => {
  const result = spawnSync(process.execPath, [
    foundationPlanValidatorPath,
    '--profile',
    'unreviewed-profile',
  ], { input: '{}', encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /partial-foundation-recovery/);
});

test('keeps local plan inspection read-only and scoped to canonical private objects', () => {
  assert.match(inspectScript, /\^gs:\/\/miakapp-v4-staging-tfstate-1072737219170\/plans\//);
  assert.match(inspectScript, /terraform -chdir="\$terraform_root" show -no-color/);
  assert.match(inspectScript, /validate-foundation-plan\.mjs/);
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
