import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const MAX_PLAN_JSON_BYTES = 16 * 1024 * 1024;
const TERRAFORM_VERSION = '1.11.3';
const PLAN_FORMAT_VERSION = '1.2';
const GOOGLE_PROVIDER = 'registry.terraform.io/hashicorp/google';
const TERRAFORM_PROVIDER = 'terraform.io/builtin/terraform';
const PROJECT_ID = 'miakapp-v4-staging';
const PROJECT_NUMBER = '1072737219170';
const REGION = 'europe-west9';
const RUNTIME_SERVICE_ACCOUNT_ID = 'miakapp-control-plane';
const RUNTIME_SERVICE_ACCOUNT = `${RUNTIME_SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com`;
const COMPONENT_BUCKET = 'miakapp-v4-staging-components';
const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
const ADDRESS_PATTERN = /^[A-Za-z0-9_./[\]"-]{1,256}$/;

const LABELS = Object.freeze({
  environment: 'staging',
  'goog-terraform-provisioned': 'true',
  'managed-by': 'terraform',
  product: 'miakapp-v4',
});

const SERVICE_APIS = Object.freeze([
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
]);

const SECRET_IDS = Object.freeze([
  'miakapp-audit-hmac',
  'miakapp-component-hmac',
  'miakapp-home-key-pepper',
  'miakapp-network-hmac',
  'miakapp-push-hmac',
]);

const TTL_COLLECTIONS = Object.freeze([
  'controlAdmissionBuckets',
  'controlAudit',
  'pushChallenges',
]);

const COMPONENT_STORAGE_ROLES = Object.freeze([
  'roles/storage.objectCreator',
  'roles/storage.objectViewer',
]);

const BOOTSTRAP_ACTIVATION = Object.freeze({
  apply_provider: `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply`,
  bootstrap_prefix: 'terraform/bootstrap',
  component_bucket: COMPONENT_BUCKET,
  deployer_service_account: `miakapp-tf-apply@${PROJECT_ID}.iam.gserviceaccount.com`,
  foundation_prefix: 'terraform/foundation',
  github_repository_id: '354682190',
  github_repository_owner_id: '83046838',
  plan_provider: `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan`,
  planner_service_account: `miakapp-tf-plan@${PROJECT_ID}.iam.gserviceaccount.com`,
  project_id: PROJECT_ID,
  project_number: PROJECT_NUMBER,
  region: REGION,
  runtime_service_account: RUNTIME_SERVICE_ACCOUNT,
  schema: 'miakapp.staging-bootstrap/1',
  state_bucket: STATE_BUCKET,
});

function reject(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, expected, path) {
  if (!Object.is(value, expected)) reject(`${path} does not match the reviewed value`);
}

function exactDeep(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} does not match the reviewed value`);
}

function exactKeys(value, expected, path) {
  if (!isPlainObject(value)) reject(`${path} must be an object`);
  const actual = Object.keys(value).sort();
  const reviewed = [...expected].sort();
  if (!isDeepStrictEqual(actual, reviewed)) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function googleChange(address, type, name, after, index) {
  return {
    address,
    mode: 'managed',
    type,
    name,
    providerName: GOOGLE_PROVIDER,
    action: 'create',
    after,
    index,
  };
}

function dataChange(address, type, name, after) {
  return {
    address,
    mode: 'data',
    type,
    name,
    providerName: GOOGLE_PROVIDER,
    action: 'read',
    actionReason: 'read_because_dependency_pending',
    after,
  };
}

function secretAfter(secretId) {
  return {
    annotations: null,
    deletion_policy: 'DELETE',
    deletion_protection: true,
    effective_labels: LABELS,
    labels: null,
    project: PROJECT_ID,
    replication: [{ auto: [{ customer_managed_encryption: [] }], user_managed: [] }],
    rotation: [],
    secret_id: secretId,
    tags: null,
    terraform_labels: LABELS,
    timeouts: null,
    topics: [],
    ttl: null,
    version_aliases: null,
    version_destroy_ttl: null,
  };
}

function expectedChanges() {
  const changes = [
    dataChange(
      'data.google_service_account.control_plane',
      'google_service_account',
      'control_plane',
      { account_id: RUNTIME_SERVICE_ACCOUNT_ID, project: PROJECT_ID },
    ),
    dataChange(
      'data.google_storage_bucket.components',
      'google_storage_bucket',
      'components',
      { name: COMPONENT_BUCKET, project: null },
    ),
    googleChange(
      'google_firestore_database.default',
      'google_firestore_database',
      'default',
      {
        app_engine_integration_mode: 'DISABLED',
        cmek_config: [],
        database_edition: 'STANDARD',
        delete_protection_state: 'DELETE_PROTECTION_ENABLED',
        deletion_policy: 'ABANDON',
        location_id: REGION,
        name: '(default)',
        point_in_time_recovery_enablement: 'POINT_IN_TIME_RECOVERY_DISABLED',
        project: PROJECT_ID,
        tags: null,
        timeouts: null,
        type: 'FIRESTORE_NATIVE',
      },
    ),
    googleChange(
      'google_kms_crypto_key.access_token_signing',
      'google_kms_crypto_key',
      'access_token_signing',
      {
        deletion_policy: 'PREVENT',
        effective_labels: LABELS,
        labels: null,
        name: 'access-token-signing',
        purpose: 'ASYMMETRIC_SIGN',
        rotation_period: null,
        skip_initial_version_creation: null,
        terraform_labels: LABELS,
        timeouts: null,
        version_template: [{ algorithm: 'EC_SIGN_ED25519', protection_level: 'SOFTWARE' }],
      },
    ),
    googleChange(
      'google_kms_crypto_key_iam_member.access_token_signer',
      'google_kms_crypto_key_iam_member',
      'access_token_signer',
      { condition: [], role: 'roles/cloudkms.signerVerifier' },
    ),
    googleChange(
      'google_kms_key_ring.access_tokens',
      'google_kms_key_ring',
      'access_tokens',
      { location: REGION, name: PROJECT_ID, project: PROJECT_ID, timeouts: null },
    ),
  ];

  for (const collection of TTL_COLLECTIONS) {
    changes.push(googleChange(
      `google_firestore_field.ttl["${collection}"]`,
      'google_firestore_field',
      'ttl',
      {
        collection,
        database: '(default)',
        deletion_policy: 'DELETE',
        field: 'expires_at',
        index_config: [{ indexes: null }],
        project: PROJECT_ID,
        skip_wait: false,
        timeouts: null,
        ttl_config: [{}],
      },
      collection,
    ));
  }

  for (const service of SERVICE_APIS) {
    changes.push(googleChange(
      `google_project_service.required["${service}"]`,
      'google_project_service',
      'required',
      {
        deletion_policy: 'PREVENT',
        disable_dependent_services: false,
        disable_on_destroy: false,
        project: PROJECT_ID,
        service,
        timeouts: null,
      },
      service,
    ));
  }

  for (const secretId of SECRET_IDS) {
    changes.push(
      googleChange(
        `google_secret_manager_secret.runtime["${secretId}"]`,
        'google_secret_manager_secret',
        'runtime',
        secretAfter(secretId),
        secretId,
      ),
      googleChange(
        `google_secret_manager_secret_iam_member.runtime["${secretId}"]`,
        'google_secret_manager_secret_iam_member',
        'runtime',
        {
          condition: [],
          project: PROJECT_ID,
          role: 'roles/secretmanager.secretAccessor',
          secret_id: secretId,
        },
        secretId,
      ),
    );
  }

  for (const role of COMPONENT_STORAGE_ROLES) {
    changes.push(googleChange(
      `google_storage_bucket_iam_member.component_objects["${role}"]`,
      'google_storage_bucket_iam_member',
      'component_objects',
      { bucket: COMPONENT_BUCKET, condition: [], role, timeouts: null },
      role,
    ));
  }

  changes.push({
    address: 'terraform_data.bootstrap_guard',
    mode: 'managed',
    type: 'terraform_data',
    name: 'bootstrap_guard',
    providerName: TERRAFORM_PROVIDER,
    action: 'create',
    after: { input: BOOTSTRAP_ACTIVATION, triggers_replace: null },
  });

  return new Map(changes.map((change) => [change.address, Object.freeze(change)]));
}

const EXPECTED_CHANGES = expectedChanges();

const EXPECTED_OUTPUT_CHANGES = Object.freeze({
  staging_foundation: {
    actions: ['create'],
    before: null,
    after: {
      component_bucket: COMPONENT_BUCKET,
      firestore_database: '(default)',
      project_id: PROJECT_ID,
      project_number: PROJECT_NUMBER,
      region: REGION,
      secret_ids: SECRET_IDS,
    },
    after_unknown: {
      runtime_service_account: true,
      secret_ids: [false, false, false, false, false],
      signing_key: true,
    },
    before_sensitive: false,
    after_sensitive: false,
  },
});

const EXPECTED_CONFIGURATION_RESOURCES = Object.freeze({
  'data.google_service_account.control_plane': ['data', 'google_service_account', 'google'],
  'data.google_storage_bucket.components': ['data', 'google_storage_bucket', 'google'],
  'data.terraform_remote_state.bootstrap': ['data', 'terraform_remote_state', 'terraform'],
  'google_firestore_database.default': ['managed', 'google_firestore_database', 'google'],
  'google_firestore_field.ttl': ['managed', 'google_firestore_field', 'google'],
  'google_kms_crypto_key.access_token_signing': ['managed', 'google_kms_crypto_key', 'google'],
  'google_kms_crypto_key_iam_member.access_token_signer': ['managed', 'google_kms_crypto_key_iam_member', 'google'],
  'google_kms_key_ring.access_tokens': ['managed', 'google_kms_key_ring', 'google'],
  'google_project_service.required': ['managed', 'google_project_service', 'google'],
  'google_secret_manager_secret.runtime': ['managed', 'google_secret_manager_secret', 'google'],
  'google_secret_manager_secret_iam_member.runtime': ['managed', 'google_secret_manager_secret_iam_member', 'google'],
  'google_storage_bucket_iam_member.component_objects': ['managed', 'google_storage_bucket_iam_member', 'google'],
  'terraform_data.bootstrap_guard': ['managed', 'terraform_data', 'terraform'],
});

function validateResourceChanges(plan) {
  if (!Array.isArray(plan.resource_changes) || plan.resource_changes.length !== EXPECTED_CHANGES.size) {
    reject(`Terraform foundation plan must contain exactly ${EXPECTED_CHANGES.size} resource changes`);
  }
  const seen = new Set();
  for (const [index, change] of plan.resource_changes.entries()) {
    if (!isPlainObject(change)) reject(`Terraform resource change ${index} must be an object`);
    if (typeof change.address !== 'string' || !ADDRESS_PATTERN.test(change.address)) {
      reject(`Terraform resource change ${index} has an invalid address`);
    }
    if (seen.has(change.address)) reject('Terraform foundation plan contains a duplicate resource address');
    seen.add(change.address);
    const expected = EXPECTED_CHANGES.get(change.address);
    if (expected === undefined) reject('Terraform foundation plan contains an unreviewed resource address');
    exact(change.mode, expected.mode, `Terraform resource change ${change.address}.mode`);
    exact(change.type, expected.type, `Terraform resource change ${change.address}.type`);
    exact(change.name, expected.name, `Terraform resource change ${change.address}.name`);
    exact(
      change.provider_name,
      expected.providerName,
      `Terraform resource change ${change.address}.provider_name`,
    );
    if (expected.index === undefined) {
      if (change.index !== undefined) reject(`Terraform resource change ${change.address}.index is not reviewed`);
    } else {
      exact(change.index, expected.index, `Terraform resource change ${change.address}.index`);
    }
    if (expected.actionReason === undefined) {
      if (change.action_reason !== undefined) {
        reject(`Terraform resource change ${change.address}.action_reason is not reviewed`);
      }
    } else {
      exact(
        change.action_reason,
        expected.actionReason,
        `Terraform resource change ${change.address}.action_reason`,
      );
    }
    if (!isPlainObject(change.change)) {
      reject(`Terraform resource change ${change.address}.change must be an object`);
    }
    exactDeep(
      change.change.actions,
      [expected.action],
      `Terraform resource change ${change.address}.change.actions`,
    );
    exact(change.change.before, null, `Terraform resource change ${change.address}.change.before`);
    exactDeep(
      change.change.after,
      expected.after,
      `Terraform resource change ${change.address}.change.after`,
    );
    if (change.change.importing !== undefined || change.change.generated_config !== undefined) {
      reject(`Terraform resource change ${change.address} must not import or generate configuration`);
    }
  }
  for (const address of EXPECTED_CHANGES.keys()) {
    if (!seen.has(address)) reject('Terraform foundation plan is missing a reviewed resource address');
  }
}

function validatePriorState(plan) {
  const priorState = exactKeys(
    plan.prior_state,
    ['format_version', 'terraform_version', 'values'],
    'Terraform prior state',
  );
  exact(priorState.format_version, '1.0', 'Terraform prior-state format version');
  exact(priorState.terraform_version, TERRAFORM_VERSION, 'Terraform prior-state version');
  const priorValues = exactKeys(priorState.values, ['root_module'], 'Terraform prior-state values');
  const rootModule = exactKeys(
    priorValues.root_module,
    ['resources'],
    'Terraform prior-state root module',
  );
  if (!Array.isArray(rootModule.resources) || rootModule.resources.length !== 1) {
    reject('Terraform foundation prior state must contain only the bootstrap remote-state data source');
  }
  const remoteState = rootModule.resources[0];
  if (!isPlainObject(remoteState)) reject('Terraform foundation prior state resource must be an object');
  exact(remoteState.address, 'data.terraform_remote_state.bootstrap', 'Terraform prior-state address');
  exact(remoteState.mode, 'data', 'Terraform prior-state mode');
  exact(remoteState.type, 'terraform_remote_state', 'Terraform prior-state type');
  exact(remoteState.provider_name, TERRAFORM_PROVIDER, 'Terraform prior-state provider');
  exactDeep(remoteState.values, {
    backend: 'gcs',
    config: { bucket: STATE_BUCKET, prefix: 'terraform/bootstrap' },
    defaults: null,
    outputs: { foundation_activation: BOOTSTRAP_ACTIVATION },
    workspace: null,
  }, 'Terraform prior-state bootstrap values');
}

function validateProviderConfiguration(configuration) {
  const providers = exactKeys(
    configuration.provider_config,
    ['google', 'google-beta', 'terraform'],
    'Terraform provider configuration',
  );
  for (const name of ['google', 'google-beta']) {
    const expectedFullName = name === 'google' ? GOOGLE_PROVIDER : `${GOOGLE_PROVIDER}-beta`;
    exact(providers[name].full_name, expectedFullName, `Terraform provider ${name}.full_name`);
    exact(providers[name].name, name, `Terraform provider ${name}.name`);
    exact(providers[name].version_constraint, '8.1.0', `Terraform provider ${name}.version_constraint`);
    exactDeep(providers[name].expressions, {
      billing_project: { references: ['local.project_id'] },
      default_labels: { references: ['local.labels'] },
      project: { references: ['local.project_id'] },
      region: { references: ['local.region'] },
      user_project_override: { constant_value: true },
    }, `Terraform provider ${name}.expressions`);
  }
  exactDeep(providers.terraform, {
    full_name: TERRAFORM_PROVIDER,
    name: 'terraform',
  }, 'Terraform built-in provider configuration');
}

function validateCriticalReferences(resourcesByAddress) {
  const exactExpressions = (address, expected) => {
    const resource = resourcesByAddress.get(address);
    exactDeep(resource.expressions, expected, `Terraform configuration ${address}.expressions`);
  };

  exactExpressions('data.google_service_account.control_plane', {
    account_id: { references: ['local.runtime_service_account_id'] },
    project: { references: ['local.project_id'] },
  });
  exactExpressions('data.google_storage_bucket.components', {
    name: { references: ['local.component_bucket_name'] },
  });
  exactExpressions('data.terraform_remote_state.bootstrap', {
    backend: { constant_value: 'gcs' },
    config: { references: ['local.state_bucket_name', 'local.bootstrap_prefix'] },
  });
  exactExpressions('terraform_data.bootstrap_guard', {
    input: {
      references: [
        'data.terraform_remote_state.bootstrap.outputs.foundation_activation',
        'data.terraform_remote_state.bootstrap.outputs',
        'data.terraform_remote_state.bootstrap',
      ],
    },
  });
  exactExpressions('google_firestore_database.default', {
    app_engine_integration_mode: { constant_value: 'DISABLED' },
    database_edition: { constant_value: 'STANDARD' },
    delete_protection_state: { constant_value: 'DELETE_PROTECTION_ENABLED' },
    deletion_policy: { constant_value: 'ABANDON' },
    location_id: { references: ['local.region'] },
    name: { constant_value: '(default)' },
    point_in_time_recovery_enablement: {
      constant_value: 'POINT_IN_TIME_RECOVERY_DISABLED',
    },
    project: { references: ['local.project_id'] },
    type: { constant_value: 'FIRESTORE_NATIVE' },
  });
  exactExpressions('google_firestore_field.ttl', {
    collection: { references: ['each.key'] },
    database: {
      references: [
        'google_firestore_database.default.name',
        'google_firestore_database.default',
      ],
    },
    field: { references: ['each.value'] },
    index_config: [{}],
    project: { references: ['local.project_id'] },
    ttl_config: [{}],
  });
  exactExpressions('google_kms_crypto_key.access_token_signing', {
    deletion_policy: { constant_value: 'PREVENT' },
    key_ring: {
      references: [
        'google_kms_key_ring.access_tokens.id',
        'google_kms_key_ring.access_tokens',
      ],
    },
    name: { references: ['local.kms_signing_key_name'] },
    purpose: { constant_value: 'ASYMMETRIC_SIGN' },
    version_template: [{
      algorithm: { constant_value: 'EC_SIGN_ED25519' },
      protection_level: { constant_value: 'SOFTWARE' },
    }],
  });
  exactExpressions('google_kms_crypto_key_iam_member.access_token_signer', {
    crypto_key_id: {
      references: [
        'google_kms_crypto_key.access_token_signing.id',
        'google_kms_crypto_key.access_token_signing',
      ],
    },
    member: {
      references: [
        'data.google_service_account.control_plane.member',
        'data.google_service_account.control_plane',
      ],
    },
    role: { constant_value: 'roles/cloudkms.signerVerifier' },
  });
  exactExpressions('google_kms_key_ring.access_tokens', {
    location: { references: ['local.region'] },
    name: { references: ['local.kms_key_ring_name'] },
    project: { references: ['local.project_id'] },
  });
  exactExpressions('google_project_service.required', {
    deletion_policy: { constant_value: 'PREVENT' },
    disable_dependent_services: { constant_value: false },
    disable_on_destroy: { constant_value: false },
    project: { references: ['local.project_id'] },
    service: { references: ['each.value'] },
  });
  exactExpressions('google_secret_manager_secret.runtime', {
    deletion_protection: { constant_value: true },
    project: { references: ['local.project_id'] },
    replication: [{ auto: [{}] }],
    secret_id: { references: ['each.value'] },
  });
  exactExpressions('google_secret_manager_secret_iam_member.runtime', {
    member: {
      references: [
        'data.google_service_account.control_plane.member',
        'data.google_service_account.control_plane',
      ],
    },
    project: { references: ['local.project_id'] },
    role: { constant_value: 'roles/secretmanager.secretAccessor' },
    secret_id: { references: ['each.value.secret_id', 'each.value'] },
  });
  exactExpressions('google_storage_bucket_iam_member.component_objects', {
    bucket: {
      references: [
        'data.google_storage_bucket.components.name',
        'data.google_storage_bucket.components',
      ],
    },
    member: {
      references: [
        'data.google_service_account.control_plane.member',
        'data.google_service_account.control_plane',
      ],
    },
    role: { references: ['each.value'] },
  });
}

function validateConfiguration(plan) {
  const configuration = exactKeys(
    plan.configuration,
    ['provider_config', 'root_module'],
    'Terraform configuration',
  );
  validateProviderConfiguration(configuration);
  const rootModule = exactKeys(
    configuration.root_module,
    ['outputs', 'resources'],
    'Terraform root module',
  );
  if (!Array.isArray(rootModule.resources)
      || rootModule.resources.length !== Object.keys(EXPECTED_CONFIGURATION_RESOURCES).length) {
    reject('Terraform configuration must contain exactly the reviewed resource templates');
  }
  const resourcesByAddress = new Map();
  for (const [index, resource] of rootModule.resources.entries()) {
    if (!isPlainObject(resource) || typeof resource.address !== 'string'
        || !ADDRESS_PATTERN.test(resource.address)) {
      reject(`Terraform configuration resource ${index} is invalid`);
    }
    if (resourcesByAddress.has(resource.address)) {
      reject('Terraform configuration contains a duplicate resource template');
    }
    const expected = EXPECTED_CONFIGURATION_RESOURCES[resource.address];
    if (expected === undefined) reject('Terraform configuration contains an unreviewed resource template');
    exact(resource.mode, expected[0], `Terraform configuration ${resource.address}.mode`);
    exact(resource.type, expected[1], `Terraform configuration ${resource.address}.type`);
    exact(
      resource.provider_config_key,
      expected[2],
      `Terraform configuration ${resource.address}.provider_config_key`,
    );
    resourcesByAddress.set(resource.address, resource);
  }
  for (const address of Object.keys(EXPECTED_CONFIGURATION_RESOURCES)) {
    if (!resourcesByAddress.has(address)) {
      reject('Terraform configuration is missing a reviewed resource template');
    }
  }
  validateCriticalReferences(resourcesByAddress);
  exactDeep(rootModule.outputs, {
    staging_foundation: {
      description: 'Non-secret identifiers for review; this output is not deployment evidence.',
      expression: {
        references: [
          'local.project_id',
          'local.project_number',
          'local.region',
          'data.google_service_account.control_plane.email',
          'data.google_service_account.control_plane',
          'google_firestore_database.default.name',
          'google_firestore_database.default',
          'data.google_storage_bucket.components.name',
          'data.google_storage_bucket.components',
          'google_kms_crypto_key.access_token_signing.id',
          'google_kms_crypto_key.access_token_signing',
          'local.secret_ids',
        ],
      },
    },
  }, 'Terraform configuration outputs');
}

function validateChecks(plan) {
  exactDeep(plan.checks, [
    {
      address: {
        kind: 'resource',
        mode: 'data',
        name: 'control_plane',
        to_display: 'data.google_service_account.control_plane',
        type: 'google_service_account',
      },
      instances: [{
        address: { to_display: 'data.google_service_account.control_plane' },
        status: 'unknown',
      }],
      status: 'unknown',
    },
    {
      address: {
        kind: 'resource',
        mode: 'data',
        name: 'components',
        to_display: 'data.google_storage_bucket.components',
        type: 'google_storage_bucket',
      },
      instances: [{
        address: { to_display: 'data.google_storage_bucket.components' },
        status: 'unknown',
      }],
      status: 'unknown',
    },
    {
      address: {
        kind: 'resource',
        mode: 'managed',
        name: 'bootstrap_guard',
        to_display: 'terraform_data.bootstrap_guard',
        type: 'terraform_data',
      },
      instances: [{
        address: { to_display: 'terraform_data.bootstrap_guard' },
        status: 'pass',
      }],
      status: 'pass',
    },
  ], 'Terraform plan checks');
}

export function validateInitialFoundationPlan(plan) {
  if (!isPlainObject(plan)) reject('Terraform plan must be a JSON object');
  exact(plan.format_version, PLAN_FORMAT_VERSION, 'Terraform plan format version');
  exact(plan.terraform_version, TERRAFORM_VERSION, 'Terraform plan version');
  exact(plan.applyable, true, 'Terraform plan applyable');
  exact(plan.complete, true, 'Terraform plan complete');
  exact(plan.errored, false, 'Terraform plan errored');
  validateResourceChanges(plan);
  exactDeep(plan.output_changes, EXPECTED_OUTPUT_CHANGES, 'Terraform output changes');
  validatePriorState(plan);
  validateConfiguration(plan);
  validateChecks(plan);
  return Object.freeze({
    profile: 'initial-foundation',
    create: 33,
    read: 2,
    update: 0,
    delete: 0,
  });
}

async function readPlanJson() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, 'utf8') > MAX_PLAN_JSON_BYTES) {
      reject('Terraform plan JSON exceeds the validation limit');
    }
  }
  try {
    return JSON.parse(input);
  } catch {
    reject('Terraform plan is not valid JSON');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: terraform show -json <plan> | node validate-foundation-plan.mjs');
    process.exitCode = 2;
  } else {
    try {
      const result = validateInitialFoundationPlan(await readPlanJson());
      console.log(
        `Validated ${result.profile} plan: ${result.create} create, ${result.read} read, ${result.update} update, ${result.delete} delete.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation error';
      console.error(`Terraform foundation plan rejected: ${message}`);
      process.exitCode = 1;
    }
  }
}
