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
const RUNTIME_MEMBER = `serviceAccount:${RUNTIME_SERVICE_ACCOUNT}`;
const COMPONENT_BUCKET = 'miakapp-v4-staging-components';
const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
const KMS_KEY_RING = `projects/${PROJECT_ID}/locations/${REGION}/keyRings/${PROJECT_ID}`;
const SIGNING_KEY = `${KMS_KEY_RING}/cryptoKeys/access-token-signing`;
const ADDRESS_PATTERN = /^[A-Za-z0-9_./[\]"-]{1,256}$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ETAG_PATTERN = /^[A-Za-z0-9_+/=-]{8,128}$/;

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

const FOUNDATION_OUTPUT_VALUE = Object.freeze({
  component_bucket: COMPONENT_BUCKET,
  firestore_database: '(default)',
  project_id: PROJECT_ID,
  project_number: PROJECT_NUMBER,
  region: REGION,
  runtime_service_account: RUNTIME_SERVICE_ACCOUNT,
  secret_ids: SECRET_IDS,
  signing_key: SIGNING_KEY,
});

const FOUNDATION_OUTPUT_TYPE = Object.freeze([
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
]);

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

function matches(value, pattern, path) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    reject(`${path} does not match the reviewed format`);
  }
}

function withoutKeys(value, excludedKeys) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excludedKeys.includes(key)),
  );
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

const EXPECTED_MANAGED_CHANGES = new Map(
  [...EXPECTED_CHANGES].filter(([, change]) => change.mode === 'managed'),
);

const RECOVERY_CREATE_ADDRESSES = new Set([
  'google_kms_crypto_key_iam_member.access_token_signer',
  ...SECRET_IDS.map((secretId) => (
    `google_secret_manager_secret_iam_member.runtime["${secretId}"]`
  )),
  ...COMPONENT_STORAGE_ROLES.map((role) => (
    `google_storage_bucket_iam_member.component_objects["${role}"]`
  )),
]);

const RECOVERY_NO_OP_ADDRESSES = new Set(
  [...EXPECTED_MANAGED_CHANGES.keys()].filter((address) => (
    !RECOVERY_CREATE_ADDRESSES.has(address)
  )),
);

const RECOVERY_DRIFT_ADDRESSES = new Set([
  'google_firestore_database.default',
  'google_kms_crypto_key.access_token_signing',
  ...SECRET_IDS.map((secretId) => (
    `google_secret_manager_secret.runtime["${secretId}"]`
  )),
]);

const RECOVERY_DATA_RESOURCES = Object.freeze({
  'data.google_service_account.control_plane': [
    'data',
    'google_service_account',
    'control_plane',
    GOOGLE_PROVIDER,
  ],
  'data.google_storage_bucket.components': [
    'data',
    'google_storage_bucket',
    'components',
    GOOGLE_PROVIDER,
  ],
  'data.terraform_remote_state.bootstrap': [
    'data',
    'terraform_remote_state',
    'bootstrap',
    TERRAFORM_PROVIDER,
  ],
});

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

function expectedRecoveryCreateAfter(expected) {
  if (expected.address === 'google_kms_crypto_key_iam_member.access_token_signer') {
    return {
      condition: [],
      crypto_key_id: SIGNING_KEY,
      member: RUNTIME_MEMBER,
      role: 'roles/cloudkms.signerVerifier',
    };
  }
  if (expected.type === 'google_secret_manager_secret_iam_member') {
    return {
      condition: [],
      member: RUNTIME_MEMBER,
      project: PROJECT_ID,
      role: 'roles/secretmanager.secretAccessor',
      secret_id: expected.index,
    };
  }
  if (expected.type === 'google_storage_bucket_iam_member') {
    return {
      bucket: COMPONENT_BUCKET,
      condition: [],
      member: RUNTIME_MEMBER,
      role: expected.index,
      timeouts: null,
    };
  }
  reject(`Terraform recovery create ${expected.address} is not reviewed`);
}

function expectedRecoverySensitiveValue(expected) {
  switch (expected.type) {
    case 'google_firestore_database':
      return { cmek_config: [] };
    case 'google_firestore_field':
      return { index_config: [{ indexes: [] }], ttl_config: [{}] };
    case 'google_kms_crypto_key':
      return {
        effective_labels: {},
        labels: {},
        primary: [],
        terraform_labels: {},
        version_template: [{}],
      };
    case 'google_secret_manager_secret':
      return {
        annotations: {},
        effective_annotations: {},
        effective_labels: {},
        labels: {},
        replication: [{
          auto: [{ customer_managed_encryption: [] }],
          user_managed: [],
        }],
        rotation: [],
        terraform_labels: {},
        topics: [],
        version_aliases: {},
      };
    case 'terraform_data':
      return { input: {}, output: {} };
    default:
      return {};
  }
}

function expectedRecoveryDependsOn(expected) {
  const bootstrap = 'data.terraform_remote_state.bootstrap';
  const services = 'google_project_service.required';
  const guard = 'terraform_data.bootstrap_guard';
  switch (expected.type) {
    case 'google_firestore_database':
      return [bootstrap, services, guard];
    case 'google_firestore_field':
      return [bootstrap, 'google_firestore_database.default', services, guard];
    case 'google_kms_crypto_key':
      return [bootstrap, 'google_kms_key_ring.access_tokens', services, guard];
    case 'google_kms_key_ring':
    case 'google_secret_manager_secret':
      return [bootstrap, services, guard];
    case 'google_project_service':
      return [bootstrap, guard];
    case 'terraform_data':
      return [bootstrap];
    default:
      reject(`Terraform recovery dependency graph for ${expected.address} is not reviewed`);
  }
}

function expectedSchemaVersion(expected) {
  return expected.type === 'google_kms_crypto_key' ? 1 : 0;
}

function validateTimestamp(value, path) {
  if (typeof value !== 'string') reject(`${path} must match the reviewed format`);
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null) reject(`${path} must match the reviewed format`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ''] = match;
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, 0);
  if (year === 0
      || instant.getUTCFullYear() !== year
      || instant.getUTCMonth() !== month - 1
      || instant.getUTCDate() !== day
      || instant.getUTCHours() !== hour
      || instant.getUTCMinutes() !== minute
      || instant.getUTCSeconds() !== second) {
    reject(`${path} is not a valid timestamp`);
  }
  const wholeSecondNanos = BigInt(instant.getTime()) * 1_000_000n;
  const fractionalNanos = BigInt(fraction.padEnd(9, '0'));
  return wholeSecondNanos + fractionalNanos;
}

function validateRecoveryValue(expected, value, path) {
  if (!isPlainObject(value)) reject(`${path} must be an object`);
  switch (expected.type) {
    case 'google_firestore_database': {
      exactDeep(withoutKeys(value, [
        'create_time',
        'earliest_version_time',
        'etag',
        'uid',
        'update_time',
      ]), {
        app_engine_integration_mode: 'DISABLED',
        cmek_config: [],
        concurrency_mode: 'PESSIMISTIC',
        database_edition: 'STANDARD',
        delete_protection_state: 'DELETE_PROTECTION_ENABLED',
        deletion_policy: 'ABANDON',
        firestore_data_access_mode: '',
        id: `projects/${PROJECT_ID}/databases/(default)`,
        key_prefix: '',
        location_id: REGION,
        mongodb_compatible_data_access_mode: '',
        name: '(default)',
        point_in_time_recovery_enablement: 'POINT_IN_TIME_RECOVERY_DISABLED',
        project: PROJECT_ID,
        realtime_updates_mode: 'REALTIME_UPDATES_MODE_ENABLED',
        tags: null,
        timeouts: null,
        type: 'FIRESTORE_NATIVE',
        version_retention_period: '3600s',
      }, path);
      validateTimestamp(value.create_time, `${path}.create_time`);
      validateTimestamp(value.earliest_version_time, `${path}.earliest_version_time`);
      validateTimestamp(value.update_time, `${path}.update_time`);
      matches(value.etag, ETAG_PATTERN, `${path}.etag`);
      matches(value.uid, UUID_PATTERN, `${path}.uid`);
      break;
    }
    case 'google_firestore_field': {
      const collection = expected.index;
      const fieldName = [
        `projects/${PROJECT_ID}/databases/(default)/collectionGroups`,
        `${collection}/fields/expires_at`,
      ].join('/');
      exactDeep(value, {
        collection,
        database: '(default)',
        deletion_policy: 'DELETE',
        field: 'expires_at',
        id: fieldName,
        index_config: [{ indexes: [] }],
        name: fieldName,
        project: PROJECT_ID,
        skip_wait: false,
        timeouts: null,
        ttl_config: [{ expiration_offset: '', state: 'ACTIVE' }],
      }, path);
      break;
    }
    case 'google_kms_crypto_key':
      exactDeep(value, {
        crypto_key_backend: '',
        deletion_policy: 'PREVENT',
        destroy_scheduled_duration: '2592000s',
        effective_labels: LABELS,
        id: SIGNING_KEY,
        import_only: false,
        key_ring: KMS_KEY_RING,
        labels: {},
        name: 'access-token-signing',
        primary: [],
        purpose: 'ASYMMETRIC_SIGN',
        rotation_period: '',
        skip_initial_version_creation: false,
        terraform_labels: LABELS,
        timeouts: null,
        version_template: [{
          algorithm: 'EC_SIGN_ED25519',
          protection_level: 'SOFTWARE',
        }],
      }, path);
      break;
    case 'google_kms_key_ring':
      exactDeep(value, {
        id: KMS_KEY_RING,
        location: REGION,
        name: PROJECT_ID,
        project: PROJECT_ID,
        timeouts: null,
      }, path);
      break;
    case 'google_project_service':
      exactDeep(value, {
        deletion_policy: 'PREVENT',
        disable_dependent_services: false,
        disable_on_destroy: false,
        id: `${PROJECT_ID}/${expected.index}`,
        project: PROJECT_ID,
        service: expected.index,
        timeouts: null,
      }, path);
      break;
    case 'google_secret_manager_secret':
      exactDeep(withoutKeys(value, ['create_time']), {
        annotations: {},
        deletion_policy: 'DELETE',
        deletion_protection: true,
        effective_annotations: {},
        effective_labels: LABELS,
        expire_time: '',
        id: `projects/${PROJECT_ID}/secrets/${expected.index}`,
        labels: {},
        name: `projects/${PROJECT_NUMBER}/secrets/${expected.index}`,
        project: PROJECT_ID,
        replication: [{
          auto: [{ customer_managed_encryption: [] }],
          user_managed: [],
        }],
        rotation: [],
        secret_id: expected.index,
        tags: null,
        terraform_labels: LABELS,
        timeouts: null,
        topics: [],
        ttl: null,
        version_aliases: {},
        version_destroy_ttl: '',
      }, path);
      validateTimestamp(value.create_time, `${path}.create_time`);
      break;
    case 'terraform_data':
      exactKeys(value, ['id', 'input', 'output', 'triggers_replace'], path);
      matches(value.id, UUID_PATTERN, `${path}.id`);
      exactDeep(value.input, BOOTSTRAP_ACTIVATION, `${path}.input`);
      exactDeep(value.output, BOOTSTRAP_ACTIVATION, `${path}.output`);
      exact(value.triggers_replace, null, `${path}.triggers_replace`);
      break;
    default:
      reject(`Terraform recovery no-op ${expected.address} is not reviewed`);
  }
}

function validateRecoveryResourceIdentity(resource, expected, path, extraKeys = []) {
  const keys = ['address', 'mode', 'type', 'name', 'provider_name', ...extraKeys];
  if (expected.index !== undefined) keys.push('index');
  exactKeys(resource, keys, path);
  exact(resource.address, expected.address, `${path}.address`);
  exact(resource.mode, expected.mode, `${path}.mode`);
  exact(resource.type, expected.type, `${path}.type`);
  exact(resource.name, expected.name, `${path}.name`);
  exact(resource.provider_name, expected.providerName, `${path}.provider_name`);
  if (expected.index !== undefined) exact(resource.index, expected.index, `${path}.index`);
}

function validateRecoveryResourceChanges(plan) {
  if (!Array.isArray(plan.resource_changes)
      || plan.resource_changes.length !== EXPECTED_MANAGED_CHANGES.size) {
    reject(
      `Terraform recovery plan must contain exactly ${EXPECTED_MANAGED_CHANGES.size} resource changes`,
    );
  }
  const changes = new Map();
  for (const [index, resourceChange] of plan.resource_changes.entries()) {
    if (!isPlainObject(resourceChange) || typeof resourceChange.address !== 'string'
        || !ADDRESS_PATTERN.test(resourceChange.address)) {
      reject(`Terraform recovery resource change ${index} has an invalid address`);
    }
    if (changes.has(resourceChange.address)) {
      reject('Terraform recovery plan contains a duplicate resource address');
    }
    const expected = EXPECTED_MANAGED_CHANGES.get(resourceChange.address);
    if (expected === undefined) {
      reject('Terraform recovery plan contains an unreviewed resource address');
    }
    validateRecoveryResourceIdentity(
      resourceChange,
      expected,
      `Terraform recovery resource change ${resourceChange.address}`,
      ['change'],
    );
    const changePath = `Terraform recovery resource change ${resourceChange.address}.change`;
    const change = exactKeys(resourceChange.change, [
      'actions',
      'before',
      'after',
      'after_unknown',
      'before_sensitive',
      'after_sensitive',
    ], changePath);
    if (RECOVERY_CREATE_ADDRESSES.has(resourceChange.address)) {
      exactDeep(change.actions, ['create'], `${changePath}.actions`);
      exact(change.before, null, `${changePath}.before`);
      exactDeep(
        change.after,
        expectedRecoveryCreateAfter(expected),
        `${changePath}.after`,
      );
      exactDeep(
        change.after_unknown,
        { condition: [], etag: true, id: true },
        `${changePath}.after_unknown`,
      );
      exact(change.before_sensitive, false, `${changePath}.before_sensitive`);
      exactDeep(change.after_sensitive, { condition: [] }, `${changePath}.after_sensitive`);
    } else if (RECOVERY_NO_OP_ADDRESSES.has(resourceChange.address)) {
      exactDeep(change.actions, ['no-op'], `${changePath}.actions`);
      exactDeep(change.before, change.after, `${changePath}.before`);
      exactDeep(change.after_unknown, {}, `${changePath}.after_unknown`);
      const sensitive = expectedRecoverySensitiveValue(expected);
      exactDeep(change.before_sensitive, sensitive, `${changePath}.before_sensitive`);
      exactDeep(change.after_sensitive, sensitive, `${changePath}.after_sensitive`);
      validateRecoveryValue(expected, change.after, `${changePath}.after`);
    } else {
      reject(`Terraform recovery action for ${resourceChange.address} is not reviewed`);
    }
    changes.set(resourceChange.address, resourceChange);
  }
  for (const address of EXPECTED_MANAGED_CHANGES.keys()) {
    if (!changes.has(address)) {
      reject('Terraform recovery plan is missing a reviewed resource address');
    }
  }
  return changes;
}

function validateRecoveryOutputChanges(plan) {
  exactDeep(plan.output_changes, {
    staging_foundation: {
      actions: ['create'],
      before: null,
      after: FOUNDATION_OUTPUT_VALUE,
      after_unknown: false,
      before_sensitive: false,
      after_sensitive: false,
    },
  }, 'Terraform recovery output changes');
}

function validateRecoveryDataResource(resource, path) {
  switch (resource.address) {
    case 'data.google_service_account.control_plane':
      exactDeep(withoutKeys(resource.values, ['unique_id']), {
        account_id: RUNTIME_SERVICE_ACCOUNT_ID,
        disabled: false,
        display_name: 'Miakapp V4 staging control plane',
        email: RUNTIME_SERVICE_ACCOUNT,
        id: `projects/${PROJECT_ID}/serviceAccounts/${RUNTIME_SERVICE_ACCOUNT}`,
        member: RUNTIME_MEMBER,
        name: `projects/${PROJECT_ID}/serviceAccounts/${RUNTIME_SERVICE_ACCOUNT}`,
        project: PROJECT_ID,
      }, `${path}.values`);
      matches(resource.values.unique_id, /^\d{21}$/, `${path}.values.unique_id`);
      exactDeep(resource.sensitive_values, {}, `${path}.sensitive_values`);
      break;
    case 'data.google_storage_bucket.components':
      exactDeep(withoutKeys(resource.values, ['time_created', 'updated']), {
        autoclass: [],
        cors: [],
        custom_placement_config: [],
        default_event_based_hold: false,
        deletion_policy: 'DELETE',
        effective_labels: LABELS,
        enable_object_retention: false,
        encryption: [],
        force_destroy: null,
        hierarchical_namespace: [{ enabled: false }],
        id: COMPONENT_BUCKET,
        ip_filter: [],
        labels: {},
        lifecycle_rule: [{
          action: [{ storage_class: '', type: 'Delete' }],
          condition: [{
            age: 1,
            created_before: '',
            custom_time_before: '',
            days_since_custom_time: 0,
            days_since_noncurrent_time: 0,
            matches_prefix: ['component-staging/'],
            matches_storage_class: [],
            matches_suffix: [],
            noncurrent_time_before: '',
            num_newer_versions: 0,
            send_age_if_zero: false,
            send_days_since_custom_time_if_zero: false,
            send_days_since_noncurrent_time_if_zero: false,
            send_num_newer_versions_if_zero: false,
            size_above_bytes: 0,
            size_below_bytes: 0,
            with_state: 'ANY',
          }],
        }],
        location: 'EUROPE-WEST9',
        logging: [],
        name: COMPONENT_BUCKET,
        project: PROJECT_ID,
        project_number: Number(PROJECT_NUMBER),
        public_access_prevention: 'enforced',
        requester_pays: false,
        retention_policy: [],
        rpo: null,
        self_link: `https://www.googleapis.com/storage/v1/b/${COMPONENT_BUCKET}`,
        soft_delete_policy: [{ effective_time: '', retention_duration_seconds: 0 }],
        storage_class: 'STANDARD',
        terraform_labels: {},
        uniform_bucket_level_access: true,
        url: `gs://${COMPONENT_BUCKET}`,
        versioning: [{ enabled: false }],
        website: [],
      }, `${path}.values`);
      validateTimestamp(resource.values.time_created, `${path}.values.time_created`);
      validateTimestamp(resource.values.updated, `${path}.values.updated`);
      exactDeep(resource.sensitive_values, {
        autoclass: [],
        cors: [],
        custom_placement_config: [],
        effective_labels: {},
        encryption: [],
        hierarchical_namespace: [{}],
        ip_filter: [],
        labels: {},
        lifecycle_rule: [{
          action: [{}],
          condition: [{
            matches_prefix: [false],
            matches_storage_class: [],
            matches_suffix: [],
          }],
        }],
        logging: [],
        retention_policy: [],
        soft_delete_policy: [{}],
        terraform_labels: {},
        versioning: [{}],
        website: [],
      }, `${path}.sensitive_values`);
      break;
    case 'data.terraform_remote_state.bootstrap':
      exactDeep(resource.values, {
        backend: 'gcs',
        config: { bucket: STATE_BUCKET, prefix: 'terraform/bootstrap' },
        defaults: null,
        outputs: { foundation_activation: BOOTSTRAP_ACTIVATION },
        workspace: null,
      }, `${path}.values`);
      exactDeep(resource.sensitive_values, {
        config: {},
        outputs: { foundation_activation: {} },
      }, `${path}.sensitive_values`);
      break;
    default:
      reject('Terraform recovery prior state contains an unreviewed data resource');
  }
}

function validateRecoveryPriorState(plan, changes) {
  const priorState = exactKeys(
    plan.prior_state,
    ['format_version', 'terraform_version', 'values'],
    'Terraform recovery prior state',
  );
  exact(priorState.format_version, '1.0', 'Terraform recovery prior-state format version');
  exact(priorState.terraform_version, TERRAFORM_VERSION, 'Terraform recovery prior-state version');
  const values = exactKeys(
    priorState.values,
    ['outputs', 'root_module'],
    'Terraform recovery prior-state values',
  );
  exactDeep(values.outputs, {
    staging_foundation: {
      sensitive: false,
      value: FOUNDATION_OUTPUT_VALUE,
      type: FOUNDATION_OUTPUT_TYPE,
    },
  }, 'Terraform recovery prior-state outputs');
  const rootModule = exactKeys(
    values.root_module,
    ['resources'],
    'Terraform recovery prior-state root module',
  );
  const expectedCount = RECOVERY_NO_OP_ADDRESSES.size
    + Object.keys(RECOVERY_DATA_RESOURCES).length;
  if (!Array.isArray(rootModule.resources) || rootModule.resources.length !== expectedCount) {
    reject(`Terraform recovery prior state must contain exactly ${expectedCount} resources`);
  }
  const seen = new Set();
  for (const [index, resource] of rootModule.resources.entries()) {
    if (!isPlainObject(resource) || typeof resource.address !== 'string'
        || !ADDRESS_PATTERN.test(resource.address)) {
      reject(`Terraform recovery prior-state resource ${index} has an invalid address`);
    }
    if (seen.has(resource.address)) {
      reject('Terraform recovery prior state contains a duplicate resource address');
    }
    seen.add(resource.address);
    if (Object.hasOwn(RECOVERY_DATA_RESOURCES, resource.address)) {
      const [mode, type, name, providerName] = RECOVERY_DATA_RESOURCES[resource.address];
      const expected = {
        address: resource.address,
        mode,
        type,
        name,
        providerName,
      };
      validateRecoveryResourceIdentity(
        resource,
        expected,
        `Terraform recovery prior-state resource ${resource.address}`,
        ['schema_version', 'sensitive_values', 'values'],
      );
      exact(
        resource.schema_version,
        0,
        `Terraform recovery prior-state resource ${resource.address}.schema_version`,
      );
      validateRecoveryDataResource(
        resource,
        `Terraform recovery prior-state resource ${resource.address}`,
      );
      continue;
    }
    const expected = EXPECTED_MANAGED_CHANGES.get(resource.address);
    if (expected === undefined || !RECOVERY_NO_OP_ADDRESSES.has(resource.address)) {
      reject('Terraform recovery prior state contains an unreviewed managed resource');
    }
    const path = `Terraform recovery prior-state resource ${resource.address}`;
    validateRecoveryResourceIdentity(resource, expected, path, [
      'depends_on',
      'schema_version',
      'sensitive_values',
      'values',
    ]);
    exactDeep(resource.depends_on, expectedRecoveryDependsOn(expected), `${path}.depends_on`);
    exact(resource.schema_version, expectedSchemaVersion(expected), `${path}.schema_version`);
    const resourceChange = changes.get(resource.address);
    exactDeep(resource.values, resourceChange.change.before, `${path}.values`);
    exactDeep(
      resource.sensitive_values,
      resourceChange.change.before_sensitive,
      `${path}.sensitive_values`,
    );
  }
  for (const address of [
    ...RECOVERY_NO_OP_ADDRESSES,
    ...Object.keys(RECOVERY_DATA_RESOURCES),
  ]) {
    if (!seen.has(address)) {
      reject('Terraform recovery prior state is missing a reviewed resource address');
    }
  }
}

function validateRecoveryPlannedValues(plan, changes) {
  const plannedValues = exactKeys(
    plan.planned_values,
    ['outputs', 'root_module'],
    'Terraform recovery planned values',
  );
  exactDeep(plannedValues.outputs, {
    staging_foundation: {
      sensitive: false,
      type: FOUNDATION_OUTPUT_TYPE,
      value: FOUNDATION_OUTPUT_VALUE,
    },
  }, 'Terraform recovery planned outputs');
  const rootModule = exactKeys(
    plannedValues.root_module,
    ['resources'],
    'Terraform recovery planned root module',
  );
  if (!Array.isArray(rootModule.resources)
      || rootModule.resources.length !== EXPECTED_MANAGED_CHANGES.size) {
    reject(
      `Terraform recovery planned values must contain exactly ${EXPECTED_MANAGED_CHANGES.size} resources`,
    );
  }
  const seen = new Set();
  for (const [index, resource] of rootModule.resources.entries()) {
    if (!isPlainObject(resource) || typeof resource.address !== 'string'
        || !ADDRESS_PATTERN.test(resource.address)) {
      reject(`Terraform recovery planned resource ${index} has an invalid address`);
    }
    if (seen.has(resource.address)) {
      reject('Terraform recovery planned values contain a duplicate resource address');
    }
    seen.add(resource.address);
    const expected = EXPECTED_MANAGED_CHANGES.get(resource.address);
    if (expected === undefined) {
      reject('Terraform recovery planned values contain an unreviewed resource address');
    }
    const path = `Terraform recovery planned resource ${resource.address}`;
    validateRecoveryResourceIdentity(resource, expected, path, [
      'schema_version',
      'sensitive_values',
      'values',
    ]);
    exact(resource.schema_version, expectedSchemaVersion(expected), `${path}.schema_version`);
    const resourceChange = changes.get(resource.address);
    exactDeep(resource.values, resourceChange.change.after, `${path}.values`);
    exactDeep(
      resource.sensitive_values,
      resourceChange.change.after_sensitive,
      `${path}.sensitive_values`,
    );
  }
  for (const address of EXPECTED_MANAGED_CHANGES.keys()) {
    if (!seen.has(address)) {
      reject('Terraform recovery planned values are missing a reviewed resource address');
    }
  }
}

function validateRecoveryDrift(plan, changes) {
  if (!Array.isArray(plan.resource_drift)
      || plan.resource_drift.length !== RECOVERY_DRIFT_ADDRESSES.size) {
    reject(
      `Terraform recovery plan must contain exactly ${RECOVERY_DRIFT_ADDRESSES.size} reviewed refresh drifts`,
    );
  }
  const seen = new Set();
  for (const [index, drift] of plan.resource_drift.entries()) {
    if (!isPlainObject(drift) || typeof drift.address !== 'string'
        || !ADDRESS_PATTERN.test(drift.address)) {
      reject(`Terraform recovery drift ${index} has an invalid address`);
    }
    if (seen.has(drift.address)) reject('Terraform recovery plan contains duplicate drift');
    seen.add(drift.address);
    const expected = EXPECTED_MANAGED_CHANGES.get(drift.address);
    if (expected === undefined || !RECOVERY_DRIFT_ADDRESSES.has(drift.address)) {
      reject('Terraform recovery plan contains unreviewed resource drift');
    }
    const path = `Terraform recovery drift ${drift.address}`;
    validateRecoveryResourceIdentity(drift, expected, path, ['change']);
    const change = exactKeys(drift.change, [
      'actions',
      'before',
      'after',
      'after_unknown',
      'before_sensitive',
      'after_sensitive',
    ], `${path}.change`);
    exactDeep(change.actions, ['update'], `${path}.change.actions`);
    exactDeep(change.after_unknown, {}, `${path}.change.after_unknown`);
    const noOpChange = changes.get(drift.address).change;
    exactDeep(change.after, noOpChange.before, `${path}.change.after`);
    validateRecoveryValue(expected, change.after, `${path}.change.after`);
    if (expected.type === 'google_firestore_database') {
      matches(change.before.etag, ETAG_PATTERN, `${path}.change.before.etag`);
      if (change.before.etag === change.after.etag) {
        reject(`${path}.change.etag must contain the reviewed refresh-only difference`);
      }
      const beforeEarliestVersionTime = validateTimestamp(
        change.before.earliest_version_time,
        `${path}.change.before.earliest_version_time`,
      );
      const afterEarliestVersionTime = validateTimestamp(
        change.after.earliest_version_time,
        `${path}.change.after.earliest_version_time`,
      );
      if (beforeEarliestVersionTime > afterEarliestVersionTime) {
        reject(`${path}.change.earliest_version_time must not move backwards`);
      }
      exactDeep(
        {
          ...change.before,
          earliest_version_time: change.after.earliest_version_time,
          etag: change.after.etag,
        },
        change.after,
        `${path}.change.before`,
      );
      exactDeep(change.before_sensitive, { cmek_config: [] }, `${path}.change.before_sensitive`);
      exactDeep(change.after_sensitive, { cmek_config: [] }, `${path}.change.after_sensitive`);
    } else if (expected.type === 'google_kms_crypto_key') {
      exact(change.before.labels, null, `${path}.change.before.labels`);
      exactDeep(change.after.labels, {}, `${path}.change.after.labels`);
      exactDeep(
        { ...change.before, labels: {} },
        change.after,
        `${path}.change.before`,
      );
      exactDeep(change.before_sensitive, {
        effective_labels: {},
        primary: [],
        terraform_labels: {},
        version_template: [{}],
      }, `${path}.change.before_sensitive`);
      exactDeep(
        change.after_sensitive,
        expectedRecoverySensitiveValue(expected),
        `${path}.change.after_sensitive`,
      );
    } else {
      for (const field of ['annotations', 'labels', 'version_aliases']) {
        exact(change.before[field], null, `${path}.change.before.${field}`);
        exactDeep(change.after[field], {}, `${path}.change.after.${field}`);
      }
      exactDeep({
        ...change.before,
        annotations: {},
        labels: {},
        version_aliases: {},
      }, change.after, `${path}.change.before`);
      exactDeep(change.before_sensitive, {
        effective_annotations: {},
        effective_labels: {},
        replication: [{
          auto: [{ customer_managed_encryption: [] }],
          user_managed: [],
        }],
        rotation: [],
        terraform_labels: {},
        topics: [],
      }, `${path}.change.before_sensitive`);
      exactDeep(
        change.after_sensitive,
        expectedRecoverySensitiveValue(expected),
        `${path}.change.after_sensitive`,
      );
    }
  }
  for (const address of RECOVERY_DRIFT_ADDRESSES) {
    if (!seen.has(address)) reject('Terraform recovery plan is missing reviewed resource drift');
  }
}

function validateRecoveryChecks(plan) {
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
        status: 'pass',
      }],
      status: 'pass',
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
        status: 'pass',
      }],
      status: 'pass',
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
  ], 'Terraform recovery checks');
}

export function validateRecoveryRelevantAttributes(plan) {
  const expected = [
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
  if (!Array.isArray(plan.relevant_attributes)
      || plan.relevant_attributes.length !== expected.length) {
    reject('Terraform recovery relevant attributes must contain exactly the reviewed entries');
  }
  const canonical = (entry, index) => {
    exactKeys(
      entry,
      ['resource', 'attribute'],
      `Terraform recovery relevant attribute ${index}`,
    );
    if (typeof entry.resource !== 'string' || !ADDRESS_PATTERN.test(entry.resource)
        || !Array.isArray(entry.attribute)) {
      reject(`Terraform recovery relevant attribute ${index} is invalid`);
    }
    return JSON.stringify([entry.resource, entry.attribute]);
  };
  const actualEntries = plan.relevant_attributes.map(canonical).sort();
  const expectedEntries = expected.map(canonical).sort();
  exactDeep(actualEntries, expectedEntries, 'Terraform recovery relevant attributes');
}

export function validatePartialFoundationRecoveryPlan(plan) {
  if (!isPlainObject(plan)) reject('Terraform plan must be a JSON object');
  exactKeys(plan, [
    'format_version',
    'terraform_version',
    'planned_values',
    'resource_changes',
    'resource_drift',
    'prior_state',
    'configuration',
    'relevant_attributes',
    'checks',
    'timestamp',
    'applyable',
    'complete',
    'errored',
    'output_changes',
  ], 'Terraform recovery plan');
  exact(plan.format_version, PLAN_FORMAT_VERSION, 'Terraform recovery plan format version');
  exact(plan.terraform_version, TERRAFORM_VERSION, 'Terraform recovery plan version');
  exact(plan.applyable, true, 'Terraform recovery plan applyable');
  exact(plan.complete, true, 'Terraform recovery plan complete');
  exact(plan.errored, false, 'Terraform recovery plan errored');
  validateTimestamp(plan.timestamp, 'Terraform recovery plan timestamp');
  const changes = validateRecoveryResourceChanges(plan);
  validateRecoveryOutputChanges(plan);
  validateRecoveryDrift(plan, changes);
  validateRecoveryPriorState(plan, changes);
  validateRecoveryPlannedValues(plan, changes);
  validateConfiguration(plan);
  validateRecoveryChecks(plan);
  validateRecoveryRelevantAttributes(plan);
  return Object.freeze({
    profile: 'partial-foundation-recovery',
    create: RECOVERY_CREATE_ADDRESSES.size,
    read: 0,
    noOp: RECOVERY_NO_OP_ADDRESSES.size,
    update: 0,
    delete: 0,
  });
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
  const args = process.argv.slice(2);
  const profile = args.length === 0
    ? 'initial-foundation'
    : args[0] === '--profile' && args.length === 2
      ? args[1]
      : undefined;
  const validators = {
    'initial-foundation': validateInitialFoundationPlan,
    'partial-foundation-recovery': validatePartialFoundationRecoveryPlan,
  };
  if (profile === undefined || !Object.hasOwn(validators, profile)) {
    console.error(
      'Usage: terraform show -json <plan> | node validate-foundation-plan.mjs '
      + '[--profile initial-foundation|partial-foundation-recovery]',
    );
    process.exitCode = 2;
  } else {
    try {
      const result = validators[profile](await readPlanJson());
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
