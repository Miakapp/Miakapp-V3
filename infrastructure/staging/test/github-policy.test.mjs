import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateAutomationRoot } from '../automation/guard.mjs';
import { validateRecoveryRelevantAttributes } from '../automation/validate-foundation-plan.mjs';
import {
  readGitHubPolicy,
  validateGitHubPolicy,
  verifyRetiredWorkflow,
} from '../automation/validate-policy.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);
const automationRoot = new URL('../automation/', import.meta.url);
const policyPath = fileURLToPath(new URL('github-policy.json', automationRoot));
const policy = readGitHubPolicy(policyPath);
const workflow = readFileSync(new URL('staging-terraform.yml', automationRoot), 'utf8');
const planScript = readFileSync(new URL('plan.sh', automationRoot), 'utf8');
const applyScript = readFileSync(new URL('apply.sh', automationRoot), 'utf8');
const inspectScript = readFileSync(new URL('inspect-plan.sh', automationRoot), 'utf8');
const summaryPath = fileURLToPath(new URL('summarize-plan.mjs', automationRoot));
const foundationPlanValidatorPath = fileURLToPath(
  new URL('validate-foundation-plan.mjs', automationRoot),
);

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
    earliest_version_time: '2026-09-03T16:08:26.982324Z',
    etag: 'reviewed/etag+value=',
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
    { ...structuredClone(firestore.change.after), etag: 'previous/etag+value=' },
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

const recoveryRelevantAttributes = [
  {
    resource: 'data.google_service_account.control_plane',
    attribute: ['member'],
  },
  {
    resource: 'data.google_storage_bucket.components',
    attribute: ['name'],
  },
  {
    resource: 'data.google_service_account.control_plane',
    attribute: ['email'],
  },
  {
    resource: 'google_kms_crypto_key.access_token_signing',
    attribute: ['id'],
  },
  {
    resource: 'google_firestore_database.default',
    attribute: ['name'],
  },
  {
    resource: 'google_secret_manager_secret.runtime',
    attribute: [],
  },
];

test('treats recovery relevant attributes as an exact order-independent set', () => {
  assert.doesNotThrow(() => validateRecoveryRelevantAttributes({
    relevant_attributes: structuredClone(recoveryRelevantAttributes).reverse(),
  }));

  const duplicate = structuredClone(recoveryRelevantAttributes);
  duplicate[0] = structuredClone(duplicate[1]);
  assert.throws(
    () => validateRecoveryRelevantAttributes({ relevant_attributes: duplicate }),
    /relevant attributes does not match the reviewed value/,
  );

  assert.throws(
    () => validateRecoveryRelevantAttributes({
      relevant_attributes: recoveryRelevantAttributes.slice(1),
    }),
    /must contain exactly the reviewed entries/,
  );

  const extra = structuredClone(recoveryRelevantAttributes);
  extra.push({ resource: 'google_project_iam_member.unreviewed', attribute: ['member'] });
  assert.throws(
    () => validateRecoveryRelevantAttributes({ relevant_attributes: extra }),
    /must contain exactly the reviewed entries/,
  );

  const altered = structuredClone(recoveryRelevantAttributes);
  altered[0].attribute = ['email'];
  assert.throws(
    () => validateRecoveryRelevantAttributes({ relevant_attributes: altered }),
    /relevant attributes does not match the reviewed value/,
  );
});

test('accepts only the retired partial-recovery policy after verified GitHub posture', () => {
  assert.equal(policy.status, 'manual_keyless_partial_foundation_recovery_retired');
  assert.equal(policy.observation_context, 'default_branch_after_this_change');
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
    cloud_plan_authorized: false,
    foundation_apply_authorized: false,
    active_workflow_path: '.github/workflows/staging-terraform.yml',
    blueprint_path: 'infrastructure/staging/automation/staging-terraform.yml',
    workflow_sha256: '701891a221ee949c5b1f0d67e537911fc7fa1476f46c5e670593eb341f2cae2e',
  });
  assert.equal(
    existsSync(new URL('../../../.github/workflows/staging-terraform.yml', import.meta.url)),
    false,
  );
  assert.equal(
    verifyRetiredWorkflow(fileURLToPath(repositoryRoot), policy),
    policy.activation.workflow_sha256,
  );
  assert.doesNotThrow(() => validateGitHubPolicy(policy));
  assert.throws(
    () => validateGitHubPolicy(policy, { requirePlanActivation: true }),
    /workflow_install_authorized/,
  );
  assert.throws(
    () => validateGitHubPolicy(policy, { requireApplyActivation: true }),
    /workflow_install_authorized/,
  );
});

test('rejects policy drift, reactivation, and unknown fields', () => {
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
  rejects((candidate) => { candidate.activation.workflow_install_authorized = true; }, /workflow_install_authorized/);
  rejects((candidate) => { candidate.activation.cloud_plan_authorized = true; }, /cloud_plan_authorized/);
  rejects((candidate) => { candidate.activation.foundation_apply_authorized = true; }, /foundation_apply_authorized/);
  rejects((candidate) => { candidate.activation.workflow_sha256 = '0'.repeat(64); }, /workflow_sha256/);
  rejects((candidate) => { candidate.unreviewed = true; }, /must contain exactly/);
});

test('the policy CLI accepts retirement and rejects both activation modes without a stack trace', () => {
  const retiredResult = spawnSync(process.execPath, [
    fileURLToPath(new URL('validate-policy.mjs', automationRoot)),
    policyPath,
  ], { encoding: 'utf8' });
  assert.equal(retiredResult.status, 0, retiredResult.stderr);
  assert.match(retiredResult.stdout, /manual keyless partial-foundation recovery is retired/);
  assert.equal(retiredResult.stderr, '');

  const planResult = spawnSync(process.execPath, [
    fileURLToPath(new URL('validate-policy.mjs', automationRoot)),
    '--require-plan-activation',
    policyPath,
  ], { encoding: 'utf8' });
  assert.equal(planResult.status, 1);
  assert.equal(planResult.stdout, '');
  assert.match(planResult.stderr, /workflow_install_authorized must equal true/);
  assert.doesNotMatch(planResult.stderr, /\n\s+at /);

  const applyResult = spawnSync(process.execPath, [
    fileURLToPath(new URL('validate-policy.mjs', automationRoot)),
    '--require-apply-activation',
    policyPath,
  ], { encoding: 'utf8' });
  assert.equal(applyResult.status, 1);
  assert.equal(applyResult.stdout, '');
  assert.match(applyResult.stderr, /workflow_install_authorized must equal true/);
  assert.doesNotMatch(applyResult.stderr, /\n\s+at /);
});

test('keeps the retired workflow blueprint as immutable least-permission evidence', () => {
  assert.doesNotThrow(() => validateAutomationRoot(automationRoot));
  assert.equal(
    existsSync(new URL('../../../.github/workflows/staging-terraform.yml', import.meta.url)),
    false,
  );
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

test('pins every active or historical-blueprint action and limits action origins to policy', () => {
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

test('keeps both consumed entrypoints inert before any cloud or tool access', () => {
  for (const [name, source] of [['plan.sh', planScript], ['apply.sh', applyScript]]) {
    assert.match(source, /one-shot staging foundation recovery .* entrypoint is retired/);
    assert.doesNotMatch(source, /\b(?:gcloud|terraform|node|curl|wget)\b/i);

    const result = runScript(name, {
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/must-not-be-read',
      TF_VAR_must_not_be_read: 'synthetic',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /entrypoint is retired/);

    const withArgument = runScript(name, {}, ['unexpected']);
    assert.equal(withArgument.status, 2);
    assert.equal(withArgument.stdout, '');
    assert.match(withArgument.stderr, /Usage: (?:plan|apply)\.sh\n/);
  }
});

test('requires the active workflow to remain absent and preserves the historical digest', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'miakapp-workflow-retirement-test-'));
  const activeDirectory = join(temporary, '.github', 'workflows');
  const blueprintDirectory = join(temporary, 'infrastructure', 'staging', 'automation');
  mkdirSync(activeDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(blueprintDirectory, { recursive: true, mode: 0o700 });
  const activePath = join(activeDirectory, 'staging-terraform.yml');
  const blueprintPath = join(blueprintDirectory, 'staging-terraform.yml');
  try {
    writeFileSync(blueprintPath, workflow, { mode: 0o600 });
    assert.equal(verifyRetiredWorkflow(temporary, policy), policy.activation.workflow_sha256);

    writeFileSync(activePath, workflow, { mode: 0o600 });
    assert.throws(
      () => verifyRetiredWorkflow(temporary, policy),
      /retired workflow must be absent/,
    );
    unlinkSync(activePath);

    writeFileSync(blueprintPath, workflow + '\n# drift\n', { mode: 0o600 });
    assert.throws(
      () => verifyRetiredWorkflow(temporary, policy),
      /historical workflow blueprint SHA-256/,
    );
  } finally {
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

  const advancingFirestoreMetadataPlan = recoveryPlanUntilPriorState();
  advancingFirestoreMetadataPlan.resource_drift[0].change.before.earliest_version_time = (
    '2026-09-03T16:07:26Z'
  );
  const advancingFirestoreMetadata = runValidator(advancingFirestoreMetadataPlan);
  assert.equal(advancingFirestoreMetadata.status, 1);
  assert.match(
    advancingFirestoreMetadata.stderr,
    /prior state must contain exactly 28 resources/,
  );

  const microsecondAdvancePlan = recoveryPlanUntilPriorState();
  microsecondAdvancePlan.resource_drift[0].change.before.earliest_version_time = (
    '2026-09-03T16:08:26.982323Z'
  );
  const microsecondAdvance = runValidator(microsecondAdvancePlan);
  assert.equal(microsecondAdvance.status, 1);
  assert.match(microsecondAdvance.stderr, /prior state must contain exactly 28 resources/);

  const retreatingFirestoreMetadataPlan = recoveryPlanUntilPriorState();
  retreatingFirestoreMetadataPlan.resource_drift[0].change.before.earliest_version_time = (
    '2026-09-03T16:09:26Z'
  );
  const retreatingFirestoreMetadata = runValidator(retreatingFirestoreMetadataPlan);
  assert.equal(retreatingFirestoreMetadata.status, 1);
  assert.match(retreatingFirestoreMetadata.stderr, /earliest_version_time must not move backwards/);

  const microsecondRetreatPlan = recoveryPlanUntilPriorState();
  microsecondRetreatPlan.resource_drift[0].change.before.earliest_version_time = (
    '2026-09-03T16:08:26.982325Z'
  );
  const microsecondRetreat = runValidator(microsecondRetreatPlan);
  assert.equal(microsecondRetreat.status, 1);
  assert.match(microsecondRetreat.stderr, /earliest_version_time must not move backwards/);

  const invalidCalendarDatePlan = recoveryPlanUntilPriorState();
  invalidCalendarDatePlan.resource_drift[0].change.before.earliest_version_time = (
    '2026-02-30T16:08:26.982323Z'
  );
  const invalidCalendarDate = runValidator(invalidCalendarDatePlan);
  assert.equal(invalidCalendarDate.status, 1);
  assert.match(invalidCalendarDate.stderr, /earliest_version_time is not a valid timestamp/);

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
