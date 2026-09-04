import { isDeepStrictEqual } from 'node:util';

import {
  FIREBASE_AUTH_CONFIG_NAME,
  FIREBASE_AUTH_IMPORT_ID,
  PROJECT_ID,
  TERRAFORM_VERSION,
  canonicalJson,
  sha256,
} from './contract.mjs';
import { repositoryRoot, run } from './cli.mjs';

export const FIREBASE_AUTH_ADDRESS = 'google_identity_platform_config.firebase_auth';
const MAXIMUM_STATE_BYTES = 32 * 1024 * 1024;
const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const STATE_RESOURCES = Object.freeze({
  'data.terraform_remote_state.foundation': Object.freeze({
    mode: 'data',
    type: 'terraform_remote_state',
    name: 'foundation',
  }),
  'terraform_data.firebase_auth_guard': Object.freeze({
    mode: 'managed',
    type: 'terraform_data',
    name: 'firebase_auth_guard',
  }),
  [FIREBASE_AUTH_ADDRESS]: Object.freeze({
    mode: 'managed',
    type: 'google_identity_platform_config',
    name: 'firebase_auth',
  }),
});
const IDENTITY_PROVIDER_COLLECTIONS = Object.freeze([
  ['defaultSupportedIdpConfigs', 'defaultSupportedIdpConfigs'],
  ['oauthIdpConfigs', 'oauthIdpConfigs'],
  ['inboundSamlConfigs', 'inboundSamlConfigs'],
]);

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function stateAddress(resource) {
  return resource.mode === 'data'
    ? `data.${resource.type}.${resource.name}`
    : `${resource.type}.${resource.name}`;
}

export function inspectFirebaseAuthState(bytes) {
  const raw = Buffer.from(bytes ?? '');
  if (raw.byteLength === 0 || raw.byteLength > MAXIMUM_STATE_BYTES) {
    reject('Firebase Auth Terraform state size is invalid');
  }
  let state;
  try {
    state = JSON.parse(raw.toString('utf8'));
  } catch {
    return reject('Firebase Auth Terraform state is invalid JSON');
  }
  if (!plainObject(state) || state.version !== 4
    || state.terraform_version !== TERRAFORM_VERSION
    || !Number.isSafeInteger(state.serial) || state.serial < 0
    || typeof state.lineage !== 'string' || !/^[0-9a-f-]{36}$/u.test(state.lineage)
    || !plainObject(state.outputs) || !Array.isArray(state.resources)) {
    reject('Firebase Auth Terraform state header is invalid');
  }
  if (Object.keys(state.outputs).some((name) => name !== 'staging_firebase_auth')) {
    reject('Firebase Auth Terraform state contains an unreviewed output');
  }

  const seen = new Set();
  let configStatus = 'absent';
  for (const resource of state.resources) {
    if (!plainObject(resource) || resource.module !== undefined) {
      reject('Firebase Auth Terraform state contains a malformed or nested resource');
    }
    const address = stateAddress(resource);
    const expected = STATE_RESOURCES[address];
    if (expected === undefined || seen.has(address)) {
      reject('Firebase Auth Terraform state contains an unreviewed resource');
    }
    seen.add(address);
    exact(resource.mode, expected.mode, `${address}.mode`);
    exact(resource.type, expected.type, `${address}.type`);
    exact(resource.name, expected.name, `${address}.name`);
    if (!Array.isArray(resource.instances) || resource.instances.length > 1) {
      reject(`${address} must contain at most one state instance`);
    }
    for (const instance of resource.instances) {
      if (!plainObject(instance) || instance.deposed !== undefined
        || (instance.status !== undefined && instance.status !== 'tainted')) {
        reject(`${address} contains an unsupported state instance`);
      }
    }
    if (address === FIREBASE_AUTH_ADDRESS && resource.instances.length === 1) {
      const instance = resource.instances[0];
      const attributes = instance.attributes;
      if (!plainObject(attributes)
        || attributes.id !== FIREBASE_AUTH_IMPORT_ID
        || attributes.name !== FIREBASE_AUTH_CONFIG_NAME
        || attributes.project !== PROJECT_ID) {
        reject('Firebase Auth state points to a foreign configuration');
      }
      configStatus = instance.status === 'tainted' ? 'tainted' : 'managed';
    }
  }
  if (configStatus === 'absent' && state.outputs.staging_firebase_auth !== undefined) {
    reject('Firebase Auth state output exists without its managed configuration');
  }
  return Object.freeze({
    serial: state.serial,
    lineage_sha256: sha256(Buffer.from(state.lineage, 'utf8')),
    sha256: sha256(raw),
    config_status: configStatus,
    recovery_action: configStatus === 'absent'
      ? 'import'
      : configStatus === 'tainted' ? 'untaint' : null,
  });
}

function accessToken() {
  const result = run('gcloud', ['auth', 'print-access-token', '--quiet'], {
    cwd: repositoryRoot,
    description: 'firebase-auth-recovery-token',
  });
  const token = Buffer.from(result.stdout ?? '').toString('utf8').trim();
  if (token.length < 20 || token.length > 16 * 1024 || /\s/u.test(token)) {
    reject('Firebase Auth recovery access token is invalid');
  }
  return token;
}

async function adminRequest(path, token, description) {
  let response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Goog-User-Project': PROJECT_ID,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return reject(`${description} request failed`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    reject(`${description} response size is invalid`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
  return Object.freeze({ status: response.status, value });
}

export function validateLiveFirebaseAuthIdentity(value) {
  if (!plainObject(value) || value.name !== FIREBASE_AUTH_CONFIG_NAME) {
    reject('Live Firebase Auth configuration belongs to a foreign or malformed resource');
  }
  return Object.freeze({
    name: value.name,
    sha256: sha256(Buffer.from(canonicalJson(value), 'utf8')),
    value,
  });
}

export async function observeLiveFirebaseAuth() {
  const token = accessToken();
  const response = await adminRequest(`projects/${PROJECT_ID}/config`, token, 'Firebase Auth configuration');
  if (response.status === 404) return Object.freeze({ exists: false });
  if (response.status !== 200) reject('Firebase Auth configuration inventory failed');
  return Object.freeze({ exists: true, ...validateLiveFirebaseAuthIdentity(response.value) });
}

function falseOrMissing(value, description) {
  if (value !== undefined && value !== false) reject(`${description} must remain disabled`);
}

export function validateClosedLiveFirebaseAuth(value) {
  const live = validateLiveFirebaseAuthIdentity(value);
  const config = live.value;
  if (config.autodeleteAnonymousUsers !== true) {
    reject('Live Firebase Auth anonymous-user autodelete must remain enabled');
  }
  falseOrMissing(config.client?.permissions?.disabledUserDeletion, 'Live user-deletion restriction');
  falseOrMissing(config.client?.permissions?.disabledUserSignup, 'Live user-signup restriction');
  falseOrMissing(config.signIn?.allowDuplicateEmails, 'Live duplicate-email mode');
  falseOrMissing(config.signIn?.anonymous?.enabled, 'Live anonymous sign-in');
  falseOrMissing(config.signIn?.email?.enabled, 'Live email sign-in');
  falseOrMissing(config.signIn?.phoneNumber?.enabled, 'Live phone sign-in');
  if (config.signIn?.email?.passwordRequired !== undefined
    && config.signIn.email.passwordRequired !== true) {
    reject('Live Firebase Auth password policy is not the reviewed baseline');
  }
  if (config.mfa?.state !== undefined && config.mfa.state !== 'DISABLED') {
    reject('Live Firebase Auth MFA must remain disabled');
  }
  falseOrMissing(config.multiTenant?.allowTenants, 'Live Firebase Auth multi-tenancy');
  falseOrMissing(config.monitoring?.requestLogging?.enabled, 'Live Firebase Auth request logging');
  if (config.blockingFunctions?.triggers !== undefined
    && Object.keys(config.blockingFunctions.triggers).length !== 0) {
    reject('Live Firebase Auth blocking functions must remain absent');
  }
  return live;
}

export async function validateNoExternalIdentityProviders() {
  const token = accessToken();
  for (const [collection, field] of IDENTITY_PROVIDER_COLLECTIONS) {
    const response = await adminRequest(
      `projects/${PROJECT_ID}/${collection}?pageSize=100`,
      token,
      'Firebase Auth external-provider inventory',
    );
    if (response.status !== 200 || !plainObject(response.value)
      || Object.keys(response.value).some((key) => ![field, 'nextPageToken'].includes(key))
      || (response.value[field] !== undefined
        && (!Array.isArray(response.value[field]) || response.value[field].length !== 0))
      || (response.value.nextPageToken !== undefined && response.value.nextPageToken !== '')) {
      reject('Firebase Auth has an unreviewed external identity provider');
    }
  }
}
