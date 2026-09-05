import { timingSafeEqual } from 'node:crypto';
import { basename, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  FIREBASE_APP_CONFIG_NAME,
  FIREBASE_APP_ID,
  HOSTING_DOMAIN,
  PLAN_TTL_MILLISECONDS,
  PROJECT_ID,
  PROJECT_NUMBER,
  TERRAFORM_VERSION,
  canonicalJson,
  createPrivateBrowserAppCheckBundle,
  privateBrowserAppCheckBundle,
  readPrivateFile,
  sha256,
} from './contract.mjs';
import {
  KEY_PREREQUISITE_ATTEMPT_CLAIM,
  KEY_PREREQUISITE_TERRAFORM_STATE,
} from './key-contract.mjs';
import {
  APP_CHECK_REGISTRATION_TTL,
  APP_CHECK_SITE_KEY_SHA256,
  RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
} from './registration-contract.mjs';
import {
  browserAppCheckProviderAttemptClaimAbsence,
  validateBrowserAppCheckProviderAttemptClaimReceipt,
  validateBrowserAppCheckRegistrationAttemptClaimReceipt,
} from './registration-claim.mjs';
import { browserAppCheckKeyOutput } from './validate-key-plan.mjs';
import { browserAppCheckRegistrationOutput } from './validate-registration-plan.mjs';

export const BROWSER_APP_CHECK_REGISTRATION_ADDRESS =
  'google_firebase_app_check_recaptcha_enterprise_config.browser_app_check';
export const BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID =
  `projects/${PROJECT_ID}/apps/${FIREBASE_APP_ID}/recaptchaEnterpriseConfig`;
export const BROWSER_APP_CHECK_REGISTRATION_CONFIG_NAME = FIREBASE_APP_CONFIG_NAME;
export const BROWSER_APP_CHECK_REGISTRATION_RECOVERY_BUNDLE_PREFIX =
  'miakapp-staging-browser-app-check-recovery-';

const STATE_LINEAGE_SHA256 =
  'f6640c6c40b21a544f3ddc3ee8005f8a1d9d2eaa19dd79ba5fca5709394d9601';
const MAXIMUM_STATE_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PRODUCTION_RECOVERY_CONTRACT = Object.freeze({
  site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
  key_resource_name_sha256: RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
});
const EXPECTED_RESOURCES = Object.freeze({
  'data.google_firebase_web_app.staging': Object.freeze({
    mode: 'data',
    type: 'google_firebase_web_app',
    name: 'staging',
    provider: 'provider["registry.terraform.io/hashicorp/google-beta"]',
  }),
  'data.terraform_remote_state.foundation': Object.freeze({
    mode: 'data',
    type: 'terraform_remote_state',
    name: 'foundation',
    provider: 'provider["terraform.io/builtin/terraform"]',
  }),
  'google_project_service.recaptcha_enterprise': Object.freeze({
    mode: 'managed',
    type: 'google_project_service',
    name: 'recaptcha_enterprise',
    provider: 'provider["registry.terraform.io/hashicorp/google"]',
  }),
  'google_recaptcha_enterprise_key.browser_app_check': Object.freeze({
    mode: 'managed',
    type: 'google_recaptcha_enterprise_key',
    name: 'browser_app_check',
    provider: 'provider["registry.terraform.io/hashicorp/google"]',
  }),
  'terraform_data.browser_app_check_guard': Object.freeze({
    mode: 'managed',
    type: 'terraform_data',
    name: 'browser_app_check_guard',
    provider: 'provider["terraform.io/builtin/terraform"]',
  }),
  [BROWSER_APP_CHECK_REGISTRATION_ADDRESS]: Object.freeze({
    mode: 'managed',
    type: 'google_firebase_app_check_recaptcha_enterprise_config',
    name: 'browser_app_check',
    provider: 'provider["registry.terraform.io/hashicorp/google-beta"]',
  }),
});
const REQUIRED_ADDRESSES = Object.freeze(Object.keys(EXPECTED_RESOURCES)
  .filter((address) => address !== BROWSER_APP_CHECK_REGISTRATION_ADDRESS));
const PASSED_GUARD = Object.freeze([{
  object_kind: 'resource',
  config_addr: 'terraform_data.browser_app_check_guard',
  status: 'pass',
  objects: [{
    object_addr: 'terraform_data.browser_app_check_guard',
    status: 'pass',
  }],
}]);

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exactKeys(value, keys, description) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${description} must contain exactly the reviewed fields`);
  }
  return value;
}

function timestamp(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    reject(`${description} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

function stateAddress(resource) {
  return resource.mode === 'data'
    ? `data.${resource.type}.${resource.name}`
    : `${resource.type}.${resource.name}`;
}

function recoveryContract(value) {
  exactKeys(value, [
    'site_key_sha256', 'key_resource_name_sha256',
  ], 'Browser App Check registration recovery contract');
  if (!SHA256.test(value.site_key_sha256)
    || !SHA256.test(value.key_resource_name_sha256)) {
    reject('Browser App Check registration recovery contract is invalid');
  }
  return value;
}

function validateKey(attributes, contract) {
  if (!plainObject(attributes)
    || typeof attributes.id !== 'string'
    || sha256(Buffer.from(attributes.id, 'utf8')) !== contract.key_resource_name_sha256
    || typeof attributes.name !== 'string'
    || sha256(Buffer.from(attributes.name, 'utf8')) !== contract.site_key_sha256
    || attributes.id !== `projects/${PROJECT_ID}/keys/${attributes.name}`
    || attributes.project !== PROJECT_ID
    || attributes.display_name !== 'Miakapp V4 staging browser App Check'
    || attributes.deletion_policy !== 'DELETE'
    || !isDeepStrictEqual(attributes.labels, {
      environment: 'staging',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
      purpose: 'browser-app-check',
    })
    || !Array.isArray(attributes.web_settings)
    || attributes.web_settings.length !== 1
    || attributes.web_settings[0].integration_type !== 'SCORE'
    || attributes.web_settings[0].allow_all_domains !== false
    || attributes.web_settings[0].allow_amp_traffic !== false
    || !isDeepStrictEqual(attributes.web_settings[0].allowed_domains, [HOSTING_DOMAIN])
    || !isDeepStrictEqual(attributes.testing_options, [])
    || !isDeepStrictEqual(attributes.waf_settings, [])) {
    reject('Browser App Check recovery state contains a foreign reCAPTCHA key');
  }
  return attributes.name;
}

function validateConfigFields(attributes, siteKey, contract, allowIncompleteName) {
  exactKeys(attributes, [
    'app_id', 'id', 'name', 'project', 'site_key', 'timeouts', 'token_ttl',
  ], 'Browser App Check recovery provider state');
  if (attributes.app_id !== FIREBASE_APP_ID
    || attributes.id !== BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID
    || !(allowIncompleteName
      ? [FIREBASE_APP_CONFIG_NAME, '', null].includes(attributes.name)
      : attributes.name === FIREBASE_APP_CONFIG_NAME)
    || attributes.project !== PROJECT_ID
    || attributes.site_key !== siteKey
    || sha256(Buffer.from(attributes.site_key, 'utf8')) !== contract.site_key_sha256
    || attributes.timeouts !== null
    || attributes.token_ttl !== APP_CHECK_REGISTRATION_TTL) {
    reject('Browser App Check recovery state contains a foreign provider configuration');
  }
}

export function createBrowserAppCheckRegistrationRecoveryBundle(
  originalBundle,
  repositoryRoot,
) {
  const source = privateBrowserAppCheckBundle(originalBundle, repositoryRoot);
  return createPrivateBrowserAppCheckBundle(
    source,
    repositoryRoot,
    BROWSER_APP_CHECK_REGISTRATION_RECOVERY_BUNDLE_PREFIX,
  );
}

export function browserAppCheckRegistrationRecoverySourceBundle(
  recoveryBundle,
  repositoryRoot,
) {
  const recovery = privateBrowserAppCheckBundle(recoveryBundle, repositoryRoot);
  const name = basename(recovery);
  if (!new RegExp(
    `^${BROWSER_APP_CHECK_REGISTRATION_RECOVERY_BUNDLE_PREFIX}[A-Za-z0-9]{6}$`,
    'u',
  ).test(name)) {
    reject('Browser App Check registration recovery bundle name is invalid');
  }
  const source = privateBrowserAppCheckBundle(dirname(recovery), repositoryRoot);
  if (dirname(recovery) !== source) {
    reject('Browser App Check registration recovery bundle parent is invalid');
  }
  return source;
}

function inspectRegistrationStateWithContract(bytes, contract) {
  const checkedContract = recoveryContract(contract);
  const raw = Buffer.from(bytes ?? '');
  if (raw.byteLength === 0 || raw.byteLength > MAXIMUM_STATE_BYTES) {
    reject('Browser App Check recovery Terraform state size is invalid');
  }
  let state;
  try {
    state = JSON.parse(raw.toString('utf8'));
  } catch {
    return reject('Browser App Check recovery Terraform state is invalid JSON');
  }
  if (!plainObject(state)
    || !isDeepStrictEqual(Object.keys(state).sort(), [
      'version', 'terraform_version', 'serial', 'lineage', 'outputs', 'resources', 'check_results',
    ].sort())
    || state.version !== 4
    || state.terraform_version !== TERRAFORM_VERSION
    || !Number.isSafeInteger(state.serial) || state.serial < 4
    || typeof state.lineage !== 'string'
    || sha256(Buffer.from(state.lineage, 'utf8')) !== STATE_LINEAGE_SHA256
    || !plainObject(state.outputs)
    || !Array.isArray(state.resources)
    || !isDeepStrictEqual(state.check_results, PASSED_GUARD)) {
    reject('Browser App Check recovery Terraform state header is invalid');
  }

  const seen = new Set();
  let siteKey;
  let configStatus = 'absent';
  for (const resource of state.resources) {
    if (!plainObject(resource) || resource.module !== undefined) {
      reject('Browser App Check recovery state contains a malformed or nested resource');
    }
    const address = stateAddress(resource);
    const expected = EXPECTED_RESOURCES[address];
    if (expected === undefined || seen.has(address)) {
      reject('Browser App Check recovery state contains an unreviewed resource');
    }
    seen.add(address);
    for (const field of ['mode', 'type', 'name', 'provider']) {
      if (resource[field] !== expected[field]) reject(`${address}.${field} has drifted`);
    }
    if (!Array.isArray(resource.instances) || resource.instances.length > 1) {
      reject(`${address} must contain at most one state instance`);
    }
    for (const instance of resource.instances) {
      if (!plainObject(instance) || instance.deposed !== undefined
        || (instance.status !== undefined && instance.status !== 'tainted')) {
        reject(`${address} contains an unsupported state instance`);
      }
    }
    if (address !== BROWSER_APP_CHECK_REGISTRATION_ADDRESS
      && resource.instances.length !== 1) {
      reject(`${address} is missing its required state instance`);
    }
    if (address === 'google_recaptcha_enterprise_key.browser_app_check') {
      siteKey = validateKey(resource.instances[0].attributes, checkedContract);
    }
  }
  if (!REQUIRED_ADDRESSES.every((address) => seen.has(address)) || siteKey === undefined) {
    reject('Browser App Check recovery state is missing a prerequisite resource');
  }
  const config = state.resources.find(
    (resource) => stateAddress(resource) === BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
  );
  if (config?.instances.length === 0) {
    reject('Browser App Check recovery state contains an empty provider resource');
  }
  if (config?.instances.length === 1) {
    configStatus = config.instances[0].status === 'tainted' ? 'tainted' : 'managed';
    validateConfigFields(
      config.instances[0].attributes,
      siteKey,
      checkedContract,
      configStatus === 'tainted',
    );
  }

  const output = state.outputs.staging_browser_app_check_key;
  const expectedRegistrationOutput = browserAppCheckRegistrationOutput(true, {
    site_key_sha256: checkedContract.site_key_sha256,
    key_resource_name_sha256: checkedContract.key_resource_name_sha256,
    key_create_time: '2026-09-05T08:23:36Z',
  });
  if (!plainObject(output) || !plainObject(output.value)
    || ![
      canonicalJson(browserAppCheckKeyOutput()),
      canonicalJson(expectedRegistrationOutput),
    ].includes(canonicalJson(output.value))) {
    reject('Browser App Check recovery state output is not a reviewed value');
  }
  const outputProfile = isDeepStrictEqual(output.value, expectedRegistrationOutput)
    ? 'registration'
    : 'key';
  return Object.freeze({
    serial: state.serial,
    lineage_sha256: STATE_LINEAGE_SHA256,
    sha256: sha256(raw),
    size_bytes: raw.byteLength,
    config_status: configStatus,
    output_profile: outputProfile,
    recaptcha_key_resource_name_sha256: checkedContract.key_resource_name_sha256,
    app_check_site_key_sha256: checkedContract.site_key_sha256,
  });
}

export function inspectBrowserAppCheckRegistrationState(bytes) {
  return inspectRegistrationStateWithContract(bytes, PRODUCTION_RECOVERY_CONTRACT);
}

export function inspectBrowserAppCheckRegistrationStateFixture(bytes, contract) {
  return inspectRegistrationStateWithContract(bytes, contract);
}

export function selectBrowserAppCheckRegistrationRecoveryAction(state, liveProviderStatus) {
  if (!plainObject(state)
    || !['absent', 'tainted', 'managed'].includes(state.config_status)
    || !['key', 'registration'].includes(state.output_profile)
    || !['unregistered', 'registered'].includes(liveProviderStatus)) {
    reject('Browser App Check registration recovery profile is invalid');
  }
  if (liveProviderStatus === 'unregistered') {
    if (state.config_status !== 'absent' || state.output_profile !== 'key') {
      reject('An unregistered live provider is incompatible with the Terraform state');
    }
    return 'resume-before-patch';
  }
  if (state.config_status === 'absent') return 'import';
  if (state.config_status === 'tainted') return 'reimport';
  return 'reconcile';
}

export function validateBrowserAppCheckRegistrationProviderAttemptBoundary(
  liveProviderStatus,
  providerAttemptClaimState,
) {
  if (!['unregistered', 'registered'].includes(liveProviderStatus)
    || !['absent', 'present'].includes(providerAttemptClaimState)) {
    reject('Browser App Check provider attempt boundary is invalid');
  }
  if (liveProviderStatus === 'unregistered' && providerAttemptClaimState === 'present') {
    reject('An earlier provider PATCH attempt is ambiguous and cannot be resumed');
  }
  if (liveProviderStatus === 'registered' && providerAttemptClaimState === 'absent') {
    reject('Registered provider recovery requires the global provider-attempt claim');
  }
  return Object.freeze({
    live_provider_status: liveProviderStatus,
    provider_attempt_claim_state: providerAttemptClaimState,
    pre_patch_resume_permitted: liveProviderStatus === 'unregistered',
  });
}

function safeEqual(actual, expected) {
  const actualBytes = Buffer.from(typeof actual === 'string' ? actual : '', 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes);
}

export function buildBrowserAppCheckRegistrationRecoveryMetadata({
  registrationMetadata,
  createdAt,
  stateGeneration,
  state,
  liveProviderStatus,
  liveInventorySha256,
  keyAttemptClaim,
  registrationClaim,
  providerAttemptClaim,
}) {
  const checkedRegistrationClaim = validateBrowserAppCheckRegistrationAttemptClaimReceipt(
    registrationClaim,
    registrationMetadata,
  );
  const providerAttemptClaimAbsent = browserAppCheckProviderAttemptClaimAbsence();
  const providerAttemptClaimState = isDeepStrictEqual(
    providerAttemptClaim,
    providerAttemptClaimAbsent,
  ) ? 'absent' : 'present';
  const checkedProviderAttemptClaim = providerAttemptClaimState === 'absent'
    ? providerAttemptClaimAbsent
    : validateBrowserAppCheckProviderAttemptClaimReceipt(
      providerAttemptClaim,
      registrationMetadata,
      checkedRegistrationClaim,
    );
  validateBrowserAppCheckRegistrationProviderAttemptBoundary(
    liveProviderStatus,
    providerAttemptClaimState,
  );
  const action = selectBrowserAppCheckRegistrationRecoveryAction(state, liveProviderStatus);
  if (!plainObject(registrationMetadata)
    || !COMMIT.test(registrationMetadata.repository_commit ?? '')
    || !/^\d+$/u.test(stateGeneration)
    || !plainObject(state) || !SHA256.test(state.sha256 ?? '')
    || !SHA256.test(liveInventorySha256)
    || !isDeepStrictEqual(keyAttemptClaim, KEY_PREREQUISITE_ATTEMPT_CLAIM)) {
    reject('Browser App Check registration recovery metadata inputs are invalid');
  }
  if (action === 'resume-before-patch'
    && (stateGeneration !== KEY_PREREQUISITE_TERRAFORM_STATE.generation
      || state.serial !== KEY_PREREQUISITE_TERRAFORM_STATE.serial
      || state.sha256 !== KEY_PREREQUISITE_TERRAFORM_STATE.sha256
      || state.size_bytes !== KEY_PREREQUISITE_TERRAFORM_STATE.size_bytes
      || state.lineage_sha256 !== KEY_PREREQUISITE_TERRAFORM_STATE.lineage_sha256)) {
    reject('Pre-PATCH recovery requires the exact pinned prerequisite state');
  }
  const created = timestamp(createdAt, 'created_at');
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-registration-recovery/3',
    operation: 'recover-browser-app-check-registration',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_app_id: FIREBASE_APP_ID,
    app_check_config_name: FIREBASE_APP_CONFIG_NAME,
    terraform_address: BROWSER_APP_CHECK_REGISTRATION_ADDRESS,
    terraform_import_id: BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID,
    repository_commit: registrationMetadata.repository_commit,
    created_at: createdAt,
    expires_at: new Date(created + PLAN_TTL_MILLISECONDS).toISOString(),
    action,
    state_generation: stateGeneration,
    state_serial: state.serial,
    state_lineage_sha256: state.lineage_sha256,
    state_sha256: state.sha256,
    state_size_bytes: state.size_bytes,
    state_config_status: state.config_status,
    state_output_profile: state.output_profile,
    live_provider_status: liveProviderStatus,
    live_inventory_sha256: liveInventorySha256,
    key_attempt_claim_receipt_sha256: sha256(Buffer.from(
      canonicalJson(KEY_PREREQUISITE_ATTEMPT_CLAIM),
      'utf8',
    )),
    registration_claim_generation: checkedRegistrationClaim.generation,
    registration_claim_sha256: checkedRegistrationClaim.sha256,
    registration_plan_sha256: checkedRegistrationClaim.terraform_plan_sha256,
    registration_baseline_sha256: checkedRegistrationClaim.baseline_sha256,
    provider_attempt_claim_state: providerAttemptClaimState,
    provider_attempt_claim_generation: providerAttemptClaimState === 'present'
      ? checkedProviderAttemptClaim.generation
      : null,
    provider_attempt_claim_sha256: providerAttemptClaimState === 'present'
      ? checkedProviderAttemptClaim.sha256
      : null,
    recaptcha_key_resource_name_sha256: RECAPTCHA_KEY_RESOURCE_NAME_SHA256,
    app_check_site_key_sha256: APP_CHECK_SITE_KEY_SHA256,
    app_check_token_ttl: APP_CHECK_REGISTRATION_TTL,
    app_check_minimum_valid_score: 0.5,
    cloud_resource_mutation_authorized: action === 'resume-before-patch',
    state_import_or_reimport_authorized: ['import', 'reimport'].includes(action),
    output_only_reconciliation_authorized: true,
    original_saved_plan_resume_authorized: action === 'resume-before-patch',
    original_plan_replay_authorized: false,
    provider_registration_patch_authorized: action === 'resume-before-patch',
    global_provider_attempt_claim_creation_authorized: action === 'resume-before-patch',
    global_provider_attempt_claim_deletion_authorized: false,
    provider_update_authorized: false,
    provider_deletion_authorized: false,
    raw_state_committed: false,
    raw_provider_config_committed: false,
  });
}

export function validateBrowserAppCheckRegistrationRecoveryMetadata(value, now = Date.now()) {
  const metadata = exactKeys(value, [
    'schema', 'operation', 'project_id', 'project_number', 'firebase_app_id',
    'app_check_config_name', 'terraform_address', 'terraform_import_id',
    'repository_commit', 'created_at', 'expires_at', 'action', 'state_generation',
    'state_serial', 'state_lineage_sha256', 'state_sha256', 'state_size_bytes',
    'state_config_status', 'state_output_profile', 'live_provider_status',
    'live_inventory_sha256', 'key_attempt_claim_receipt_sha256',
    'registration_claim_generation', 'registration_claim_sha256',
    'registration_plan_sha256', 'registration_baseline_sha256',
    'provider_attempt_claim_state', 'provider_attempt_claim_generation',
    'provider_attempt_claim_sha256',
    'recaptcha_key_resource_name_sha256', 'app_check_site_key_sha256',
    'app_check_token_ttl', 'app_check_minimum_valid_score',
    'cloud_resource_mutation_authorized', 'state_import_or_reimport_authorized',
    'output_only_reconciliation_authorized', 'original_saved_plan_resume_authorized',
    'original_plan_replay_authorized', 'provider_registration_patch_authorized',
    'global_provider_attempt_claim_creation_authorized',
    'global_provider_attempt_claim_deletion_authorized',
    'provider_update_authorized', 'provider_deletion_authorized',
    'raw_state_committed', 'raw_provider_config_committed',
  ], 'Browser App Check registration recovery metadata');
  const created = timestamp(metadata.created_at, 'created_at');
  const expires = timestamp(metadata.expires_at, 'expires_at');
  const expectedAction = metadata.live_provider_status === 'unregistered'
    ? 'resume-before-patch'
    : metadata.state_config_status === 'absent'
      ? 'import'
      : metadata.state_config_status === 'tainted' ? 'reimport' : 'reconcile';
  const resume = metadata.action === 'resume-before-patch';
  if (metadata.schema !== 'miakapp.staging-browser-app-check-registration-recovery/3'
    || metadata.operation !== 'recover-browser-app-check-registration'
    || metadata.project_id !== PROJECT_ID
    || metadata.project_number !== PROJECT_NUMBER
    || metadata.firebase_app_id !== FIREBASE_APP_ID
    || metadata.app_check_config_name !== FIREBASE_APP_CONFIG_NAME
    || metadata.terraform_address !== BROWSER_APP_CHECK_REGISTRATION_ADDRESS
    || metadata.terraform_import_id !== BROWSER_APP_CHECK_REGISTRATION_IMPORT_ID
    || !COMMIT.test(metadata.repository_commit)
    || !['resume-before-patch', 'import', 'reimport', 'reconcile'].includes(metadata.action)
    || !/^\d+$/u.test(metadata.state_generation)
    || !Number.isSafeInteger(metadata.state_serial) || metadata.state_serial < 4
    || metadata.state_lineage_sha256 !== STATE_LINEAGE_SHA256
    || !SHA256.test(metadata.state_sha256)
    || !Number.isSafeInteger(metadata.state_size_bytes) || metadata.state_size_bytes <= 0
    || !['absent', 'tainted', 'managed'].includes(metadata.state_config_status)
    || !['key', 'registration'].includes(metadata.state_output_profile)
    || !['unregistered', 'registered'].includes(metadata.live_provider_status)
    || metadata.action !== expectedAction
    || metadata.live_provider_status === 'unregistered'
      && (metadata.state_config_status !== 'absent'
        || metadata.state_output_profile !== 'key'
        || metadata.state_generation !== KEY_PREREQUISITE_TERRAFORM_STATE.generation
        || metadata.state_serial !== KEY_PREREQUISITE_TERRAFORM_STATE.serial
        || metadata.state_sha256 !== KEY_PREREQUISITE_TERRAFORM_STATE.sha256
        || metadata.state_size_bytes !== KEY_PREREQUISITE_TERRAFORM_STATE.size_bytes)
    || !SHA256.test(metadata.live_inventory_sha256)
    || metadata.key_attempt_claim_receipt_sha256 !== sha256(Buffer.from(
      canonicalJson(KEY_PREREQUISITE_ATTEMPT_CLAIM),
      'utf8',
    ))
    || !/^\d+$/u.test(metadata.registration_claim_generation)
    || !SHA256.test(metadata.registration_claim_sha256)
    || !SHA256.test(metadata.registration_plan_sha256)
    || !SHA256.test(metadata.registration_baseline_sha256)
    || !['absent', 'present'].includes(metadata.provider_attempt_claim_state)
    || (metadata.provider_attempt_claim_state === 'absent'
      && (metadata.provider_attempt_claim_generation !== null
        || metadata.provider_attempt_claim_sha256 !== null))
    || (metadata.provider_attempt_claim_state === 'present'
      && (!/^\d+$/u.test(metadata.provider_attempt_claim_generation ?? '')
        || metadata.provider_attempt_claim_generation === '0'
        || !SHA256.test(metadata.provider_attempt_claim_sha256 ?? '')))
    || (metadata.live_provider_status === 'unregistered')
      !== (metadata.provider_attempt_claim_state === 'absent')
    || metadata.recaptcha_key_resource_name_sha256 !== RECAPTCHA_KEY_RESOURCE_NAME_SHA256
    || metadata.app_check_site_key_sha256 !== APP_CHECK_SITE_KEY_SHA256
    || metadata.app_check_token_ttl !== APP_CHECK_REGISTRATION_TTL
    || metadata.app_check_minimum_valid_score !== 0.5
    || metadata.cloud_resource_mutation_authorized !== resume
    || metadata.state_import_or_reimport_authorized
      !== ['import', 'reimport'].includes(metadata.action)
    || metadata.output_only_reconciliation_authorized !== true
    || metadata.original_saved_plan_resume_authorized !== resume
    || metadata.original_plan_replay_authorized !== false
    || metadata.provider_registration_patch_authorized !== resume
    || metadata.global_provider_attempt_claim_creation_authorized !== resume
    || metadata.global_provider_attempt_claim_deletion_authorized !== false
    || metadata.provider_update_authorized !== false
    || metadata.provider_deletion_authorized !== false
    || metadata.raw_state_committed !== false
    || metadata.raw_provider_config_committed !== false
    || expires - created !== PLAN_TTL_MILLISECONDS
    || now < created - 60_000 || now > expires) {
    reject('Browser App Check registration recovery metadata has drifted');
  }
  return Object.freeze(metadata);
}

export function browserAppCheckRegistrationRecoveryAuthorization(metadata) {
  const checked = validateBrowserAppCheckRegistrationRecoveryMetadata(
    metadata,
    Date.parse(metadata.created_at),
  );
  return [
    checked.operation,
    PROJECT_ID,
    checked.action,
    checked.state_sha256,
    checked.live_inventory_sha256,
    checked.registration_claim_sha256,
    checked.provider_attempt_claim_state,
    checked.provider_attempt_claim_sha256 ?? 'absent',
    checked.repository_commit,
  ].join(':');
}

export function validateBrowserAppCheckRegistrationRecoveryAuthorization(value, metadata) {
  if (!safeEqual(value, browserAppCheckRegistrationRecoveryAuthorization(metadata))) {
    reject('Exact browser App Check registration recovery authorization is missing or invalid');
  }
}

export function readBrowserAppCheckRegistrationRecoveryMetadata(path, now = Date.now()) {
  const bytes = readPrivateFile(path, 1024 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check registration recovery metadata is invalid JSON');
  }
  if (canonicalJson(value) !== bytes.toString('utf8')) {
    reject('Browser App Check registration recovery metadata is not canonical JSON');
  }
  return Object.freeze({
    bytes,
    value: validateBrowserAppCheckRegistrationRecoveryMetadata(value, now),
  });
}
