import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { validateFirebaseAuthResult } from '../firebase-auth/apply.mjs';
import {
  PROJECT_ID,
  PROJECT_NUMBER,
  TERRAFORM_VERSION,
  buildFirebaseAuthPlanMetadata,
  buildFirebaseAuthReconciliationMetadata,
  buildFirebaseAuthStateRecoveryMetadata,
  firebaseAuthApplyAuthorization,
  firebaseAuthReconciliationAuthorization,
  firebaseAuthStateRecoveryAuthorization,
  validateFirebaseAuthApplyAuthorization,
  validateFirebaseAuthPlanMetadata,
  validateFirebaseAuthReconciliationAuthorization,
  validateFirebaseAuthReconciliationMetadata,
  validateFirebaseAuthStateRecoveryAuthorization,
  validateFirebaseAuthStateRecoveryMetadata,
} from '../firebase-auth/contract.mjs';
import { validateFirebaseAuthRoot } from '../firebase-auth/guard.mjs';
import {
  inspectFirebaseAuthState,
  validateClosedLiveFirebaseAuth,
  validateLiveFirebaseAuthIdentity,
} from '../firebase-auth/recovery.mjs';
import { validateFirebaseAuthPlanAgainstPolicy } from '../firebase-auth/validate-plan.mjs';

const COMMIT = '1'.repeat(40);
const PLAN = Buffer.from('synthetic-firebase-auth-plan');
const PLAN_JSON = Buffer.from('{"synthetic":true}\n');
const CREATED_AT = '2026-09-05T00:00:00.000Z';
const firebaseAuthRoot = new URL('../firebase-auth/', import.meta.url);
const terraformSource = readdirSync(firebaseAuthRoot)
  .filter((name) => name.endsWith('.tf'))
  .sort()
  .map((name) => readFileSync(new URL(name, firebaseAuthRoot), 'utf8'))
  .join('\n');
const planDriver = readFileSync(new URL('plan.mjs', firebaseAuthRoot), 'utf8');
const applyDriver = readFileSync(new URL('apply.mjs', firebaseAuthRoot), 'utf8');
const recoveryAdoptDriver = readFileSync(new URL('recovery-adopt.mjs', firebaseAuthRoot), 'utf8');
const recoveryApplyDriver = readFileSync(new URL('recovery-apply.mjs', firebaseAuthRoot), 'utf8');

function foundation() {
  return {
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: 'europe-west9',
    runtime_service_account: `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`,
    firestore_database: '(default)',
    component_bucket: 'miakapp-v4-staging-components',
    signing_key: `projects/${PROJECT_ID}/locations/europe-west9/keyRings/${PROJECT_ID}/cryptoKeys/access-token-signing`,
    secret_ids: [
      'miakapp-audit-hmac',
      'miakapp-component-hmac',
      'miakapp-home-key-pepper',
      'miakapp-network-hmac',
      'miakapp-push-hmac',
    ],
  };
}

function firebaseAuthConfiguration() {
  return {
    project: PROJECT_ID,
    autodelete_anonymous_users: true,
    client: [{
      permissions: [{
        disabled_user_deletion: false,
        disabled_user_signup: false,
      }],
    }],
    monitoring: [{ request_logging: [{ enabled: false }] }],
    blocking_functions: [],
    mfa: [{ enabled_providers: null, provider_configs: [], state: 'DISABLED' }],
    multi_tenant: [{ allow_tenants: false, default_tenant_location: null }],
    quota: [],
    sign_in: [{
      allow_duplicate_emails: false,
      anonymous: [{ enabled: false }],
      email: [{ enabled: false, password_required: true }],
      phone_number: [{ enabled: false, test_phone_numbers: null }],
    }],
    timeouts: null,
  };
}

function syntheticPlan() {
  return {
    format_version: '1.2',
    terraform_version: TERRAFORM_VERSION,
    applyable: true,
    complete: true,
    errored: false,
    variables: {},
    configuration: {
      provider_config: {
        google: {
          full_name: 'registry.terraform.io/hashicorp/google',
          version_constraint: '8.1.0',
        },
        terraform: { full_name: 'terraform.io/builtin/terraform' },
      },
      root_module: {
        outputs: {
          staging_firebase_auth: {
            description: 'Non-secret Firebase Auth baseline consumed by bounded staging probes.',
            expression: {
              references: [
                'local.project_id',
                'local.project_number',
                'google_identity_platform_config.firebase_auth.name',
                'google_identity_platform_config.firebase_auth',
                'google_identity_platform_config.firebase_auth.sign_in[0].anonymous[0].enabled',
                'google_identity_platform_config.firebase_auth.sign_in[0].email[0].enabled',
                'google_identity_platform_config.firebase_auth.sign_in[0].phone_number[0].enabled',
                'google_identity_platform_config.firebase_auth.sign_in[0].allow_duplicate_emails',
                'google_identity_platform_config.firebase_auth.client[0].permissions[0].disabled_user_signup',
                'google_identity_platform_config.firebase_auth.client[0].permissions[0].disabled_user_deletion',
                'google_identity_platform_config.firebase_auth.autodelete_anonymous_users',
                'google_identity_platform_config.firebase_auth.multi_tenant[0].allow_tenants',
                'google_identity_platform_config.firebase_auth.mfa[0].state',
                'google_identity_platform_config.firebase_auth.monitoring[0].request_logging[0].enabled',
              ],
            },
          },
        },
        resources: [
          {
            address: 'data.terraform_remote_state.foundation',
            mode: 'data',
            type: 'terraform_remote_state',
            provider_config_key: 'terraform',
            schema_version: 0,
            expressions: {
              backend: { constant_value: 'gcs' },
              config: {
                references: ['local.state_bucket_name', 'local.foundation_prefix'],
              },
            },
          },
          {
            address: 'google_identity_platform_config.firebase_auth',
            mode: 'managed',
            type: 'google_identity_platform_config',
            provider_config_key: 'google',
            schema_version: 0,
            depends_on: ['terraform_data.firebase_auth_guard'],
            expressions: {
              autodelete_anonymous_users: { constant_value: true },
              client: [{
                permissions: [{
                  disabled_user_deletion: { constant_value: false },
                  disabled_user_signup: { constant_value: false },
                }],
              }],
              mfa: [{ state: { constant_value: 'DISABLED' } }],
              monitoring: [{ request_logging: [{ enabled: { constant_value: false } }] }],
              multi_tenant: [{ allow_tenants: { constant_value: false } }],
              project: { references: ['local.project_id'] },
              sign_in: [{
                allow_duplicate_emails: { constant_value: false },
                anonymous: [{ enabled: { constant_value: false } }],
                email: [{
                  enabled: { constant_value: false },
                  password_required: { constant_value: true },
                }],
                phone_number: [{ enabled: { constant_value: false } }],
              }],
            },
          },
          {
            address: 'terraform_data.firebase_auth_guard',
            mode: 'managed',
            type: 'terraform_data',
            provider_config_key: 'terraform',
            schema_version: 0,
            expressions: {
              input: {
                references: [
                  'data.terraform_remote_state.foundation.outputs.staging_foundation',
                  'data.terraform_remote_state.foundation.outputs',
                  'data.terraform_remote_state.foundation',
                ],
              },
            },
          },
        ],
      },
    },
    resource_changes: [
      {
        address: 'terraform_data.firebase_auth_guard',
        mode: 'managed',
        type: 'terraform_data',
        change: {
          actions: ['create'],
          before: null,
          after: { input: foundation() },
          after_unknown: {
            id: true,
            input: { secret_ids: [false, false, false, false, false] },
            output: true,
          },
        },
      },
      {
        address: 'google_identity_platform_config.firebase_auth',
        mode: 'managed',
        type: 'google_identity_platform_config',
        change: {
          actions: ['create'],
          before: null,
          after: firebaseAuthConfiguration(),
          after_unknown: {
            authorized_domains: true,
            blocking_functions: [],
            client: [{
              api_key: true,
              firebase_subdomain: true,
              permissions: [{}],
            }],
            id: true,
            mfa: [{ provider_configs: [] }],
            monitoring: [{ request_logging: [{}] }],
            multi_tenant: [{}],
            name: true,
            quota: [],
            sign_in: [{
              anonymous: [{}],
              email: [{}],
              hash_config: true,
              phone_number: [{}],
            }],
            sms_region_config: true,
          },
        },
      },
    ],
    output_changes: {
      staging_firebase_auth: {
        actions: ['create'],
        before: null,
        after: {
          schema: 'miakapp.staging-firebase-auth/1',
          project_id: PROJECT_ID,
          project_number: PROJECT_NUMBER,
          anonymous_sign_in: false,
          email_sign_in: false,
          phone_sign_in: false,
          duplicate_emails: false,
          user_signup_disabled: false,
          user_deletion_disabled: false,
          anonymous_user_autodelete: true,
          multi_tenant: false,
          mfa: 'DISABLED',
          request_logging: false,
        },
        after_unknown: { config_name: true },
        before_sensitive: false,
        after_sensitive: false,
      },
    },
    planned_values: {
      outputs: {
        staging_firebase_auth: { sensitive: false },
      },
    },
  };
}

function recoveryConfiguration() {
  const value = firebaseAuthConfiguration();
  return {
    ...value,
    authorized_domains: [
      'localhost',
      `${PROJECT_ID}.firebaseapp.com`,
      `${PROJECT_ID}.web.app`,
    ],
    client: [{
      api_key: `AIza${'x'.repeat(35)}`,
      firebase_subdomain: `${PROJECT_ID}.firebaseapp.com`,
      permissions: value.client[0].permissions,
    }],
    id: `projects/${PROJECT_ID}/config`,
    name: `projects/${PROJECT_ID}/config`,
    sign_in: [{ ...value.sign_in[0], hash_config: [] }],
    sms_region_config: null,
  };
}

function syntheticRecoveryPlan() {
  const plan = syntheticPlan();
  const configuration = recoveryConfiguration();
  const before = structuredClone(configuration);
  before.autodelete_anonymous_users = false;
  plan.resource_changes[1].change = {
    actions: ['update'],
    before,
    after: configuration,
    after_unknown: {},
  };
  plan.output_changes.staging_firebase_auth = {
    actions: ['create'],
    before: null,
    after: result(),
    after_unknown: {},
    before_sensitive: false,
    after_sensitive: false,
  };
  plan.planned_values.outputs.staging_firebase_auth = {
    sensitive: false,
    value: result(),
  };
  return plan;
}

function state({ status, includeConfig = true } = {}) {
  const resources = includeConfig ? [{
    mode: 'managed',
    type: 'google_identity_platform_config',
    name: 'firebase_auth',
    provider: 'provider["registry.terraform.io/hashicorp/google"]',
    instances: [{
      ...(status === undefined ? {} : { status }),
      schema_version: 0,
      attributes: {
        id: `projects/${PROJECT_ID}/config`,
        name: `projects/${PROJECT_ID}/config`,
        project: PROJECT_ID,
        client: [{ api_key: `AIza${'x'.repeat(35)}` }],
      },
    }],
  }] : [];
  return Buffer.from(JSON.stringify({
    version: 4,
    terraform_version: TERRAFORM_VERSION,
    serial: 7,
    lineage: '11111111-2222-4333-8444-555555555555',
    outputs: {},
    resources,
  }));
}

function result() {
  return {
    schema: 'miakapp.staging-firebase-auth/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    config_name: `projects/${PROJECT_ID}/config`,
    anonymous_sign_in: false,
    email_sign_in: false,
    phone_sign_in: false,
    duplicate_emails: false,
    user_signup_disabled: false,
    user_deletion_disabled: false,
    anonymous_user_autodelete: true,
    multi_tenant: false,
    mfa: 'DISABLED',
    request_logging: false,
  };
}

test('contains only the guarded non-deletable Firebase Auth baseline', () => {
  assert.doesNotThrow(() => validateFirebaseAuthRoot(firebaseAuthRoot));
  assert.match(terraformSource, /prefix = "terraform\/firebase-auth"/);
  assert.match(terraformSource, /resource "google_identity_platform_config" "firebase_auth"/);
  assert.equal((terraformSource.match(/resource\s+"/g) ?? []).length, 2);
  assert.equal((terraformSource.match(/prevent_destroy = true/g) ?? []).length, 2);
  assert.doesNotMatch(terraformSource, /google_identity_platform_(default_supported_idp_config|inbound_saml_config|oauth_idp_config|tenant)/);
  assert.doesNotMatch(terraformSource, /allUsers|allAuthenticatedUsers|service_account_key|\bmiakapp-3\b/);
});

test('requires a saved create-only plan and an exact irreversible authorization', () => {
  assert.match(planDriver, /-detailed-exitcode/);
  assert.match(planDriver, /allowedStatuses: \[2\]/);
  assert.match(applyDriver, /const applied = run\('terraform', \[\s*'apply'/u);
  assert.match(applyDriver, /terraform-convergence/);
  assert.doesNotMatch(`${planDriver}\n${applyDriver}`, /terraform', \['destroy'/u);
  assert.match(recoveryAdoptDriver, /\['import'/);
  assert.match(recoveryAdoptDriver, /\['untaint'/);
  assert.match(recoveryApplyDriver, /readAndValidateFirebaseAuthPlan\(planJsonPath, 'reconcile'\)/);
  assert.doesNotMatch(`${recoveryAdoptDriver}\n${recoveryApplyDriver}`, /\['destroy'|state', 'rm|force-unlock/u);

  const authorization = firebaseAuthApplyAuthorization(PLAN, COMMIT);
  assert.match(authorization, /^initialize-nondeletable-firebase-auth:miakapp-v4-staging:[0-9a-f]{64}:[0-9a-f]{40}$/);
  assert.doesNotThrow(() => validateFirebaseAuthApplyAuthorization(authorization, PLAN, COMMIT));
  assert.throws(
    () => validateFirebaseAuthApplyAuthorization(`${authorization}x`, PLAN, COMMIT),
    /authorization is missing or invalid/,
  );
});

test('binds recovery state adoption and reconciliation to exact snapshots', () => {
  const absent = inspectFirebaseAuthState(state({ includeConfig: false }));
  assert.equal(absent.recovery_action, 'import');
  const tainted = inspectFirebaseAuthState(state({ status: 'tainted' }));
  assert.equal(tainted.recovery_action, 'untaint');
  const managed = inspectFirebaseAuthState(state());
  assert.equal(managed.recovery_action, null);

  const recovery = buildFirebaseAuthStateRecoveryMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    action: 'import',
    state: absent,
    liveConfigSha256: '2'.repeat(64),
  });
  const recoveryAuthorization = firebaseAuthStateRecoveryAuthorization(recovery);
  assert.match(recoveryAuthorization, /^recover-firebase-auth-state:miakapp-v4-staging:import:/);
  assert.doesNotThrow(() => validateFirebaseAuthStateRecoveryMetadata(
    recovery,
    Date.parse('2026-09-05T01:00:00.000Z'),
  ));
  assert.doesNotThrow(() => validateFirebaseAuthStateRecoveryAuthorization(
    recoveryAuthorization,
    recovery,
  ));

  const summary = validateFirebaseAuthPlanAgainstPolicy(syntheticRecoveryPlan(), 'reconcile');
  const reconciliation = buildFirebaseAuthReconciliationMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    planBytes: PLAN,
    planJsonBytes: PLAN_JSON,
    summary,
    state: managed,
    liveConfigSha256: '3'.repeat(64),
  });
  const reconciliationAuthorization = firebaseAuthReconciliationAuthorization(reconciliation);
  assert.match(reconciliationAuthorization, /^reconcile-firebase-auth:miakapp-v4-staging:/);
  assert.doesNotThrow(() => validateFirebaseAuthReconciliationMetadata(
    reconciliation,
    Date.parse('2026-09-05T01:00:00.000Z'),
  ));
  assert.doesNotThrow(() => validateFirebaseAuthReconciliationAuthorization(
    reconciliationAuthorization,
    reconciliation,
  ));
});

test('validates the exact closed create-only plan', () => {
  const summary = validateFirebaseAuthPlanAgainstPolicy(syntheticPlan());
  assert.deepEqual(summary, {
    create: 2,
    update: 0,
    delete: 0,
    identity_platform_configs: 1,
    sign_in_providers_enabled: 0,
    external_identity_providers: 0,
    public_invokers: 0,
    persistent_credentials_created: 0,
    irreversible_service_initialization: true,
  });

  const unsafe = structuredClone(syntheticPlan());
  unsafe.resource_changes[1].change.after.sign_in[0].email[0].enabled = true;
  assert.throws(() => validateFirebaseAuthPlanAgainstPolicy(unsafe), /email.enabled/);

  const publicPlan = structuredClone(syntheticPlan());
  publicPlan.resource_changes[1].change.after.public_principal = 'allUsers';
  assert.throws(() => validateFirebaseAuthPlanAgainstPolicy(publicPlan), /fields|forbidden/);
});

test('validates only a no-create Firebase Auth reconciliation plan', () => {
  assert.deepEqual(validateFirebaseAuthPlanAgainstPolicy(syntheticRecoveryPlan(), 'reconcile'), {
    create: 1,
    update: 1,
    delete: 0,
    identity_platform_configs: 1,
    sign_in_providers_enabled: 0,
    external_identity_providers: 0,
    public_invokers: 0,
    persistent_credentials_created: 0,
    irreversible_service_initialization: false,
  });

  const create = syntheticRecoveryPlan();
  create.resource_changes[1].change.actions = ['create'];
  create.resource_changes[1].change.before = null;
  assert.throws(
    () => validateFirebaseAuthPlanAgainstPolicy(create, 'reconcile'),
    /unreviewed reconcile action/,
  );

  const changedKey = syntheticRecoveryPlan();
  changedKey.resource_changes[1].change.after.client[0].api_key = `AIza${'y'.repeat(35)}`;
  assert.throws(
    () => validateFirebaseAuthPlanAgainstPolicy(changedKey, 'reconcile'),
    /api_key continuity/,
  );
});

test('binds canonical metadata to the plan, JSON, commit and expiry', () => {
  const summary = validateFirebaseAuthPlanAgainstPolicy(syntheticPlan());
  const metadata = buildFirebaseAuthPlanMetadata({
    repositoryCommit: COMMIT,
    createdAt: CREATED_AT,
    planBytes: PLAN,
    planJsonBytes: PLAN_JSON,
    summary,
  });
  assert.equal(metadata.operation, 'initialize-nondeletable-firebase-auth');
  assert.equal(metadata.irreversible_service_initialization, true);
  assert.doesNotThrow(() => validateFirebaseAuthPlanMetadata(
    metadata,
    Date.parse('2026-09-05T01:00:00.000Z'),
  ));
  assert.throws(
    () => validateFirebaseAuthPlanMetadata(metadata, Date.parse('2026-09-05T03:00:00.000Z')),
    /expired/,
  );
});

test('accepts only the sanitized closed-baseline result', () => {
  assert.deepEqual(validateFirebaseAuthResult(result()), result());
  const changed = result();
  changed.email_sign_in = true;
  assert.throws(() => validateFirebaseAuthResult(changed), /closed baseline/);
  assert.throws(
    () => validateFirebaseAuthResult({ ...result(), api_key: 'AIza'.padEnd(39, 'x') }),
    /closed baseline/,
  );
});

test('recognizes only the exact live staging Auth identity and closed policy', () => {
  const live = {
    name: `projects/${PROJECT_ID}/config`,
    autodeleteAnonymousUsers: true,
    client: { permissions: {} },
    signIn: {
      anonymous: { enabled: false },
      email: { enabled: false, passwordRequired: true },
      phoneNumber: { enabled: false },
    },
    mfa: { state: 'DISABLED' },
  };
  assert.equal(validateLiveFirebaseAuthIdentity(live).name, live.name);
  assert.doesNotThrow(() => validateClosedLiveFirebaseAuth(live));
  assert.throws(
    () => validateClosedLiveFirebaseAuth({
      ...live,
      signIn: { ...live.signIn, email: { enabled: true } },
    }),
    /email sign-in/,
  );
});
