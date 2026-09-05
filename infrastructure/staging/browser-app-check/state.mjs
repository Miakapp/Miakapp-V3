import { isDeepStrictEqual } from 'node:util';

import {
  INITIAL_TERRAFORM_STATE,
  PROJECT_ID,
  TERRAFORM_VERSION,
  sha256,
} from './contract.mjs';
import { API_PREREQUISITE_TERRAFORM_STATE } from './key-contract.mjs';
import {
  browserAppCheckKeyOutput,
} from './validate-key-plan.mjs';

const STATE_BUCKET = 'miakapp-v4-staging-tfstate-1072737219170';
const STATE_LINEAGE = '8193b94a-1d8f-4143-a878-29342f91c0e2';
const MAXIMUM_STATE_BYTES = 1024 * 1024;
const STATE_RESOURCE_SHAPES = Object.freeze({
  api: Object.freeze([
    'data.google_firebase_web_app.staging@provider["registry.terraform.io/hashicorp/google-beta"]',
    'data.terraform_remote_state.foundation@provider["terraform.io/builtin/terraform"]',
    'managed.google_project_service.recaptcha_enterprise@provider["registry.terraform.io/hashicorp/google"]',
    'managed.terraform_data.browser_app_check_guard@provider["terraform.io/builtin/terraform"]',
  ]),
  key: Object.freeze([
    'data.google_firebase_web_app.staging@provider["registry.terraform.io/hashicorp/google-beta"]',
    'data.terraform_remote_state.foundation@provider["terraform.io/builtin/terraform"]',
    'managed.google_project_service.recaptcha_enterprise@provider["registry.terraform.io/hashicorp/google"]',
    'managed.google_recaptcha_enterprise_key.browser_app_check@provider["registry.terraform.io/hashicorp/google"]',
    'managed.terraform_data.browser_app_check_guard@provider["terraform.io/builtin/terraform"]',
  ]),
});
const PASSED_GUARD_CHECK_RESULTS = Object.freeze([{
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

async function storageRequest(url, accessToken, description) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Goog-User-Project': PROJECT_ID,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return reject(`${description} request failed`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200 || bytes.byteLength === 0
    || bytes.byteLength > MAXIMUM_STATE_BYTES) {
    reject(`${description} returned an unexpected response`);
  }
  return bytes;
}

export function validateInitialBrowserAppCheckState(metadata, bytes) {
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== 'object'
    || metadata.bucket !== STATE_BUCKET
    || metadata.name !== INITIAL_TERRAFORM_STATE.object
    || metadata.generation !== INITIAL_TERRAFORM_STATE.generation
    || metadata.size !== String(INITIAL_TERRAFORM_STATE.size_bytes)
    || !Buffer.isBuffer(bytes)
    || bytes.byteLength !== INITIAL_TERRAFORM_STATE.size_bytes
    || sha256(bytes) !== INITIAL_TERRAFORM_STATE.sha256) {
    reject('Browser App Check initial backend object does not match the reviewed generation');
  }
  let state;
  try {
    state = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser App Check initial backend state is invalid JSON');
  }
  if (!isDeepStrictEqual(state, {
    version: 4,
    terraform_version: TERRAFORM_VERSION,
    serial: 1,
    lineage: STATE_LINEAGE,
    outputs: {},
    resources: [],
    check_results: null,
  })) {
    reject('Browser App Check initial backend state is not the reviewed canonical empty state');
  }
  return INITIAL_TERRAFORM_STATE;
}

function parseState(bytes, description) {
  let state;
  try {
    state = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} is invalid JSON`);
  }
  if (!plainObject(state)
    || !isDeepStrictEqual(Object.keys(state).sort(), [
      'version',
      'terraform_version',
      'serial',
      'lineage',
      'outputs',
      'resources',
      'check_results',
    ].sort())
    || state.version !== 4
    || state.terraform_version !== TERRAFORM_VERSION
    || typeof state.lineage !== 'string'
    || sha256(Buffer.from(state.lineage, 'utf8'))
      !== API_PREREQUISITE_TERRAFORM_STATE.lineage_sha256
    || !Array.isArray(state.resources)
    || !plainObject(state.outputs)) {
    reject(`${description} header does not match the reviewed lineage`);
  }
  return state;
}

function resourceShapes(state, description) {
  const shapes = [];
  let taintedResources = 0;
  for (const resource of state.resources) {
    if (!plainObject(resource) || !['data', 'managed'].includes(resource.mode)
      || typeof resource.type !== 'string' || typeof resource.name !== 'string'
      || typeof resource.provider !== 'string' || !Array.isArray(resource.instances)
      || resource.instances.length !== 1 || !plainObject(resource.instances[0])) {
      reject(`${description} resource inventory is malformed`);
    }
    const instance = resource.instances[0];
    if (instance.schema_version !== 0 || instance.deposed !== undefined
      || (instance.status !== undefined && instance.status !== 'tainted')) {
      reject(`${description} contains a deposed resource instance`);
    }
    if (instance.status === 'tainted') taintedResources += 1;
    shapes.push(`${resource.mode}.${resource.type}.${resource.name}@${resource.provider}`);
  }
  return Object.freeze({
    shapes: Object.freeze(shapes.sort()),
    tainted_resources: taintedResources,
  });
}

function validatePinnedState(metadata, bytes, expected, outputs, shapes, description) {
  if (!plainObject(metadata) || metadata.bucket !== STATE_BUCKET
    || metadata.name !== expected.object || metadata.generation !== expected.generation
    || metadata.size !== String(expected.size_bytes) || !Buffer.isBuffer(bytes)
    || bytes.byteLength !== expected.size_bytes || sha256(bytes) !== expected.sha256) {
    reject(`${description} does not match the reviewed GCS generation`);
  }
  const state = parseState(bytes, description);
  const inventory = resourceShapes(state, description);
  if (state.serial !== expected.serial
    || !isDeepStrictEqual(Object.keys(state.outputs).sort(), [...outputs].sort())
    || !isDeepStrictEqual(inventory.shapes, [...shapes].sort())
    || inventory.tainted_resources !== expected.tainted_resources) {
    reject(`${description} contents do not match the reviewed resource inventory`);
  }
  return expected;
}

export function validateBrowserAppCheckApiState(metadata, bytes) {
  return validatePinnedState(
    metadata,
    bytes,
    API_PREREQUISITE_TERRAFORM_STATE,
    ['staging_browser_app_check_api'],
    STATE_RESOURCE_SHAPES.api,
    'Browser App Check API prerequisite state',
  );
}

export function validateBrowserAppCheckKeyState(metadata, bytes) {
  if (!plainObject(metadata) || metadata.bucket !== STATE_BUCKET
    || metadata.name !== API_PREREQUISITE_TERRAFORM_STATE.object
    || !/^\d+$/u.test(metadata.generation)
    || BigInt(metadata.generation) <= BigInt(API_PREREQUISITE_TERRAFORM_STATE.generation)
    || !/^\d+$/u.test(metadata.size)
    || !Buffer.isBuffer(bytes)
    || Number(metadata.size) !== bytes.byteLength
    || bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_STATE_BYTES) {
    reject('Browser App Check key state metadata is malformed');
  }
  const state = parseState(bytes, 'Browser App Check key state');
  const inventory = resourceShapes(state, 'Browser App Check key state');
  const keyResource = state.resources.find((resource) => resource.mode === 'managed'
    && resource.type === 'google_recaptcha_enterprise_key'
    && resource.name === 'browser_app_check');
  const key = keyResource?.instances?.[0]?.attributes;
  const keyId = typeof key?.id === 'string'
    ? key.id.match(/^projects\/miakapp-v4-staging\/keys\/([A-Za-z0-9_-]{20,128})$/u)
    : null;
  if (!plainObject(key)
    || !isDeepStrictEqual(Object.keys(key).sort(), [
      'android_settings',
      'create_time',
      'deletion_policy',
      'display_name',
      'effective_labels',
      'id',
      'ios_settings',
      'labels',
      'name',
      'project',
      'terraform_labels',
      'testing_options',
      'timeouts',
      'waf_settings',
      'web_settings',
    ].sort())
    || keyId === null
    || key.name !== keyId[1]
    || key.project !== PROJECT_ID
    || key.display_name !== 'Miakapp V4 staging browser App Check'
    || key.deletion_policy !== 'DELETE'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3}|\.\d{6}|\.\d{9})?Z$/u.test(key.create_time ?? '')
    || !isDeepStrictEqual(key.labels, {
      environment: 'staging',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
      purpose: 'browser-app-check',
    })
    || !isDeepStrictEqual(key.effective_labels, key.labels)
    || !isDeepStrictEqual(key.terraform_labels, key.labels)
    || !isDeepStrictEqual(key.android_settings, [])
    || !isDeepStrictEqual(key.ios_settings, [])
    || !isDeepStrictEqual(key.testing_options, [])
    || !isDeepStrictEqual(key.waf_settings, [])
    || !Array.isArray(key.web_settings)
    || key.web_settings.length !== 1) {
    reject('Browser App Check key state resource does not match the exact key boundary');
  }
  const web = key.web_settings[0];
  if (!plainObject(web)
    || Object.keys(web).some((field) => ![
      'allow_all_domains',
      'allow_amp_traffic',
      'allowed_domains',
      'challenge_security_preference',
      'challenge_settings',
      'integration_type',
    ].includes(field))
    || web.allow_all_domains !== false
    || web.allow_amp_traffic !== false
    || !isDeepStrictEqual(web.allowed_domains, ['miakapp-v4-staging.web.app'])
    || ![undefined, '', 'CHALLENGE_SECURITY_PREFERENCE_UNSPECIFIED']
      .includes(web.challenge_security_preference)
    || !isDeepStrictEqual(web.challenge_settings, [])
    || web.integration_type !== 'SCORE') {
    reject('Browser App Check key state Web settings have drifted');
  }
  const output = state.outputs.staging_browser_app_check_key;
  if (!plainObject(output)
    || !isDeepStrictEqual(Object.keys(output).sort(), ['type', 'value'])
    || !isDeepStrictEqual(output.value, browserAppCheckKeyOutput())
    || !Array.isArray(output.type)
    || output.type[0] !== 'object'
    || !plainObject(output.type[1])) {
    reject('Browser App Check key state output does not match the reviewed result');
  }
  const expectedOutputTypes = Object.fromEntries(
    Object.entries(browserAppCheckKeyOutput()).map(([field, value]) => [
      field,
      Array.isArray(value)
        ? ['list', 'string']
        : typeof value === 'boolean' ? 'bool' : typeof value,
    ]),
  );
  const actualOutputTypes = output.type[1];
  if (!isDeepStrictEqual(Object.keys(actualOutputTypes).sort(), Object.keys(expectedOutputTypes).sort())
    || Object.entries(expectedOutputTypes).some(([field, expectedType]) => {
      const actualType = actualOutputTypes[field];
      return Array.isArray(expectedType)
        ? !isDeepStrictEqual(actualType, expectedType)
          && !isDeepStrictEqual(actualType, ['tuple', ['string']])
        : actualType !== expectedType;
    })) {
    reject('Browser App Check key state output type does not match the reviewed result');
  }
  if (!Number.isSafeInteger(state.serial)
    || state.serial <= API_PREREQUISITE_TERRAFORM_STATE.serial
    || !isDeepStrictEqual(state.check_results, PASSED_GUARD_CHECK_RESULTS)
    || !isDeepStrictEqual(Object.keys(state.outputs), ['staging_browser_app_check_key'])
    || !isDeepStrictEqual(inventory.shapes, [...STATE_RESOURCE_SHAPES.key].sort())
    || inventory.tainted_resources !== 0) {
    reject('Browser App Check key state does not match the expected post-apply inventory');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-state/1',
    object: metadata.name,
    generation: metadata.generation,
    size_bytes: bytes.byteLength,
    sha256: sha256(bytes),
    terraform_version: state.terraform_version,
    serial: state.serial,
    lineage_sha256: API_PREREQUISITE_TERRAFORM_STATE.lineage_sha256,
    managed_resources: 3,
    data_resources: 2,
    outputs: 1,
    tainted_resources: 0,
    recaptcha_key_name: key.id,
    recaptcha_key_name_sha256: sha256(Buffer.from(key.id, 'utf8')),
  });
}

async function observeState(session, generation) {
  if (!plainObject(session) || typeof session.accessToken !== 'string') {
    reject('Browser App Check state inventory requires a verified operator session');
  }
  const encodedObject = encodeURIComponent(API_PREREQUISITE_TERRAFORM_STATE.object);
  const baseUrl = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodedObject}`;
  const versionQuery = generation === undefined ? '' : `?generation=${generation}`;
  const metadataBytes = await storageRequest(
    `${baseUrl}${versionQuery}`,
    session.accessToken,
    'Browser App Check state metadata',
  );
  let metadata;
  try {
    metadata = JSON.parse(metadataBytes.toString('utf8'));
  } catch {
    return reject('Browser App Check state metadata is invalid JSON');
  }
  if (!plainObject(metadata) || !/^\d+$/u.test(metadata.generation ?? '')) {
    reject('Browser App Check state metadata is malformed');
  }
  const stateBytes = await storageRequest(
    `${baseUrl}?alt=media&generation=${metadata.generation}`,
    session.accessToken,
    'Browser App Check state content',
  );
  return Object.freeze({ metadata, bytes: stateBytes });
}

export async function observeInitialBrowserAppCheckState(session) {
  const observed = await observeState(session, INITIAL_TERRAFORM_STATE.generation);
  return validateInitialBrowserAppCheckState(observed.metadata, observed.bytes);
}

export async function observeBrowserAppCheckApiState(session) {
  const observed = await observeState(session);
  return validateBrowserAppCheckApiState(observed.metadata, observed.bytes);
}

export async function observeBrowserAppCheckKeyState(session) {
  const observed = await readBrowserAppCheckKeyStateBytes(session);
  return validateBrowserAppCheckKeyState(observed.metadata, observed.bytes);
}

export async function readBrowserAppCheckKeyStateBytes(session) {
  const observed = await observeState(session);
  validateBrowserAppCheckKeyState(observed.metadata, observed.bytes);
  return observed;
}
