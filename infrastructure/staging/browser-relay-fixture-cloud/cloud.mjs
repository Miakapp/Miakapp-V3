import { isDeepStrictEqual } from 'node:util';

import { FIREBASE_APP_ID } from '../browser-app-check/contract.mjs';
import {
  BROWSER_ORDER,
  CONTROL_PLANE_ORIGIN,
  HOME_ID,
  RELAY_A_URL,
  RELAY_B_URL,
  TARGET_ORIGIN,
} from '../browser-relay-page/boundary.mjs';
import {
  ABSENCE_SCHEMA,
  COORDINATOR_NAME,
  PROJECT_ID,
  PROJECT_NUMBER,
  SYNTHETIC_UID,
} from '../browser-relay-fixture/contract.mjs';
import { validateBrowserRelayFixtureCloudProfile } from './contract.mjs';

export const SIGNER_SERVICE_ACCOUNT =
  'miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com';

const DATABASE_NAME = `projects/${PROJECT_ID}/databases/(default)`;
const DOCUMENT_ROOT = `${DATABASE_NAME}/documents`;
const FIRESTORE_ORIGIN = 'https://firestore.googleapis.com';
const IDENTITY_ORIGIN = 'https://identitytoolkit.googleapis.com';
const IAM_CREDENTIALS_ORIGIN = 'https://iamcredentials.googleapis.com';
const FIREBASE_MANAGEMENT_ORIGIN = 'https://firebase.googleapis.com';
const CUSTOM_TOKEN_AUDIENCE =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const WEB_CONFIG_URL = `${FIREBASE_MANAGEMENT_ORIGIN}/v1beta1/projects/-/webApps/${encodeURIComponent(FIREBASE_APP_ID)}/config`;
const SIGN_JWT_URL = `${IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/${SIGNER_SERVICE_ACCOUNT}:signJwt`;
const ACCOUNT_LOOKUP_URL = `${IDENTITY_ORIGIN}/v1/projects/${PROJECT_ID}/accounts:lookup`;
const ACCOUNT_DELETE_URL = `${IDENTITY_ORIGIN}/v1/projects/${PROJECT_ID}/accounts:delete`;
const RUN_QUERY_URL = `${FIRESTORE_ORIGIN}/v1/${DATABASE_NAME}/documents:runQuery`;
const COMMIT_URL = `${FIRESTORE_ORIGIN}/v1/${DATABASE_NAME}/documents:commit`;
const REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_INVENTORY_CALLS = 8;
const MAXIMUM_SIGNED_JWTS = 4;
const MAXIMUM_SIGNING_WINDOW_MILLISECONDS = 20 * 60 * 1_000;
const HOME_NAME = 'Miakapp V4 staging browser relay';
const HOME_ICON = 'house';
const HOME_KEY_LABEL = 'Browser relay acceptance coordinator';
const HOME_KEY_SCOPES = Object.freeze(['relay:coordinator']);
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const API_KEY = /^AIza[0-9A-Za-z_-]{30,}$/u;
const KEY_ID = /^[A-Za-z0-9_-]{22}$/u;
const HOME_KEY = /^mhk1_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$/u;
const VERIFIER = /^[A-Za-z0-9_-]{43}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const IMPLEMENTATION_KEYS = Object.freeze([
  'clock',
  'createCoordinator',
  'createHomeKeyAccessTokenProvider',
  'fetch',
]);

export class StagingBrowserRelayFixtureCloudError extends Error {
  constructor(message = 'Staging browser-relay fixture cloud boundary is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayFixtureCloudError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayFixtureCloudError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, path) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function allowedKeys(value, keys, path) {
  if (!plainObject(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    reject(`${path} contains an unreviewed field`);
  }
  return value;
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
}

function validJwt(value, path) {
  if (typeof value !== 'string'
    || value.length < 64
    || value.length > 8_192
    || !JWT.test(value)) {
    reject(`${path} is not a bounded JWT`);
  }
  return value;
}

function validKeyId(value, path) {
  if (typeof value !== 'string'
    || !KEY_ID.test(value)
    || Buffer.from(value, 'base64url').byteLength !== 16
    || Buffer.from(value, 'base64url').toString('base64url') !== value) {
    reject(`${path} is not a canonical key identifier`);
  }
  return value;
}

function validTimestamp(value, path) {
  if (typeof value !== 'string'
    || !TIMESTAMP.test(value)
    || !Number.isFinite(Date.parse(value))) {
    reject(`${path} is not a canonical server timestamp`);
  }
  return value;
}

function validateSession(value) {
  const session = exactKeys(value, ['accessToken'], 'operator_session');
  if (typeof session.accessToken !== 'string'
    || session.accessToken.length < 20
    || session.accessToken.length > 16 * 1024
    || /\s/u.test(session.accessToken)) {
    reject('Cloud adapter requires a verified ephemeral operator session');
  }
  return session;
}

function validateImplementations(value) {
  const implementations = exactKeys(value, IMPLEMENTATION_KEYS, 'implementations');
  if (IMPLEMENTATION_KEYS.some((key) => typeof implementations[key] !== 'function')) {
    reject('Cloud adapter requires the exact injected implementation boundary');
  }
  const now = implementations.clock();
  if (!Number.isSafeInteger(now) || now < 0) {
    reject('Cloud adapter clock returned an invalid instant');
  }
  return Object.freeze({ implementations, startedAt: now });
}

function boundedSignal(externalSignal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS);
  if (externalSignal === undefined) return timeout;
  if (!(externalSignal instanceof AbortSignal)) {
    reject('Cloud adapter received an invalid cancellation signal');
  }
  return AbortSignal.any([externalSignal, timeout]);
}

function cancelResponse(response) {
  try {
    response.body?.cancel()?.catch(() => undefined);
  } catch {}
}

async function responseBytes(response, description, allowEmpty) {
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined
    && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)
      || Number(contentLength) > MAXIMUM_RESPONSE_BYTES)) {
    cancelResponse(response);
    reject(`${description} response size is invalid`);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    reject(`${description} response is unreadable`);
  }
  if (bytes.byteLength > MAXIMUM_RESPONSE_BYTES
    || (!allowEmpty && bytes.byteLength === 0)) {
    reject(`${description} response size is invalid`);
  }
  return bytes;
}

async function request(fetchImplementation, url, init, boundary) {
  let response;
  try {
    response = await fetchImplementation(url, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: boundedSignal(boundary.signal),
    });
  } catch {
    reject(`${boundary.description} outcome is unknown; the operation must not be retried`);
  }
  if (response === null || typeof response !== 'object'
    || !Number.isSafeInteger(response.status)
    || typeof response.arrayBuffer !== 'function'
    || response.redirected === true
    || response.type === 'opaqueredirect') {
    cancelResponse(response);
    reject(`${boundary.description} returned an invalid HTTP boundary`);
  }
  const bytes = await responseBytes(response, boundary.description, boundary.allowEmpty === true);
  let value = null;
  if (bytes.byteLength > 0) {
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      reject(`${boundary.description} returned invalid JSON`);
    }
  }
  if (!boundary.acceptedStatuses.includes(response.status)) {
    reject(`${boundary.description} returned an unexpected status`);
  }
  return Object.freeze({ response, value });
}

function googleHeaders(accessToken, body) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'X-Goog-User-Project': PROJECT_ID,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
  };
}

async function googleRequest(fetchImplementation, accessToken, url, options) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return request(fetchImplementation, url, {
    method: options.method ?? 'GET',
    headers: googleHeaders(accessToken, body),
    body,
  }, {
    description: options.description,
    acceptedStatuses: options.acceptedStatuses ?? [200],
    allowEmpty: options.allowEmpty,
    signal: options.signal,
  });
}

async function publicIdentityRequest(fetchImplementation, apiKey, path, body, description) {
  const url = new URL(`${IDENTITY_ORIGIN}${path}`);
  url.searchParams.set('key', apiKey);
  return request(fetchImplementation, url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      Pragma: 'no-cache',
    },
    body: JSON.stringify(body),
  }, {
    description,
    acceptedStatuses: [200],
  });
}

function validatePrivateControlPlaneResponse(result, expectedStatus, description) {
  if (result.response.status !== expectedStatus
    || result.response.headers?.get?.('cache-control') !== 'no-store'
    || result.response.headers?.get?.('pragma') !== 'no-cache'
    || result.response.headers?.get?.('access-control-allow-origin') !== TARGET_ORIGIN
    || result.response.headers?.get?.('access-control-allow-credentials') !== 'false'
    || result.response.headers?.get?.('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      !== 'application/json') {
    reject(`${description} response headers differ from the reviewed public edge`);
  }
  return result.value;
}

async function controlPlaneRequest(fetchImplementation, firebaseIdToken, path, method, body, status,
  description) {
  const result = await request(fetchImplementation, `${CONTROL_PLANE_ORIGIN}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${firebaseIdToken}`,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      Origin: TARGET_ORIGIN,
      Pragma: 'no-cache',
    },
    body: JSON.stringify(body),
  }, {
    description,
    acceptedStatuses: [status],
  });
  return validatePrivateControlPlaneResponse(result, status, description);
}

function firestoreDocumentName(path) {
  return `${DOCUMENT_ROOT}/${path}`;
}

function firestoreDocumentUrl(path) {
  return `${FIRESTORE_ORIGIN}/v1/${firestoreDocumentName(path)}`;
}

function validateDocumentEnvelope(value, expectedName, path) {
  allowedKeys(value, ['createTime', 'fields', 'name', 'updateTime'], path);
  exact(value.name, expectedName, `${path}.name`);
  if (!plainObject(value.fields)) reject(`${path}.fields is invalid`);
  validTimestamp(value.createTime, `${path}.createTime`);
  validTimestamp(value.updateTime, `${path}.updateTime`);
  return value;
}

async function getFirestoreDocument(fetchImplementation, accessToken, path) {
  const result = await googleRequest(
    fetchImplementation,
    accessToken,
    firestoreDocumentUrl(path),
    {
      description: `Firestore ${path} observation`,
      acceptedStatuses: [200, 404],
    },
  );
  if (result.response.status === 404) return null;
  return validateDocumentEnvelope(result.value, firestoreDocumentName(path), `document.${path}`);
}

async function listHomeKeyDocuments(fetchImplementation, accessToken) {
  const url = new URL(`${FIRESTORE_ORIGIN}/v1/${DOCUMENT_ROOT}/controlHomes/${HOME_ID}/homeKeys`);
  url.searchParams.set('pageSize', '2');
  const { value } = await googleRequest(fetchImplementation, accessToken, url, {
    description: 'Firestore synthetic Home Key inventory',
  });
  allowedKeys(value, ['documents', 'nextPageToken'], 'home_key_inventory');
  if (value.nextPageToken !== undefined && value.nextPageToken !== '') {
    reject('Firestore synthetic Home Key inventory exceeds its reviewed bound');
  }
  const documents = value.documents ?? [];
  if (!Array.isArray(documents) || documents.length > 1) {
    reject('Firestore synthetic Home Key inventory exceeds its reviewed bound');
  }
  return Object.freeze(documents.map((document, index) => {
    if (!plainObject(document) || typeof document.name !== 'string') {
      reject('Firestore synthetic Home Key inventory is malformed');
    }
    const prefix = `${DOCUMENT_ROOT}/controlHomes/${HOME_ID}/homeKeys/`;
    if (!document.name.startsWith(prefix)) {
      reject('Firestore synthetic Home Key inventory escaped the fixed Home');
    }
    const keyId = validKeyId(document.name.slice(prefix.length), `home_key_inventory[${index}]`);
    return validateDocumentEnvelope(
      document,
      `${prefix}${keyId}`,
      `home_key_inventory[${index}]`,
    );
  }));
}

function homeKeyIndexQuery() {
  return Object.freeze({
    structuredQuery: {
      from: [{ collectionId: 'homeKeyIndex' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'home_id' },
          op: 'EQUAL',
          value: { stringValue: HOME_ID },
        },
      },
      limit: 2,
    },
  });
}

async function queryHomeKeyIndexes(fetchImplementation, accessToken) {
  const { value } = await googleRequest(fetchImplementation, accessToken, RUN_QUERY_URL, {
    method: 'POST',
    body: homeKeyIndexQuery(),
    description: 'Firestore synthetic Home Key index inventory',
  });
  if (!Array.isArray(value) || value.length > 2) {
    reject('Firestore synthetic Home Key index inventory exceeds its reviewed bound');
  }
  const documents = [];
  value.forEach((entry, index) => {
    allowedKeys(entry, ['document', 'readTime', 'skippedResults'], `home_key_index_query[${index}]`);
    if (entry.readTime !== undefined) validTimestamp(entry.readTime, `home_key_index_query[${index}].readTime`);
    if (entry.skippedResults !== undefined && entry.skippedResults !== 0) {
      reject('Firestore synthetic Home Key index query skipped results');
    }
    if (entry.document === undefined) return;
    if (typeof entry.document.name !== 'string') {
      reject('Firestore synthetic Home Key index inventory is malformed');
    }
    const prefix = `${DOCUMENT_ROOT}/homeKeyIndex/`;
    if (!entry.document.name.startsWith(prefix)) {
      reject('Firestore synthetic Home Key index inventory escaped the fixed collection');
    }
    const keyId = validKeyId(
      entry.document.name.slice(prefix.length),
      `home_key_index_query[${index}]`,
    );
    documents.push(validateDocumentEnvelope(
      entry.document,
      `${prefix}${keyId}`,
      `home_key_index_query[${index}].document`,
    ));
  });
  if (documents.length > 1) {
    reject('Firestore synthetic Home Key index inventory exceeds its reviewed bound');
  }
  return Object.freeze(documents);
}

function validateLookupResponse(value) {
  allowedKeys(value, ['kind', 'users'], 'firebase_user_lookup');
  if (value.kind !== undefined
    && value.kind !== 'identitytoolkit#GetAccountInfoResponse') {
    reject('Firebase user lookup kind is invalid');
  }
  if (value.users === undefined) return null;
  if (!Array.isArray(value.users) || value.users.length !== 1
    || !plainObject(value.users[0])
    || value.users[0].localId !== SYNTHETIC_UID) {
    reject('Firebase user lookup escaped the fixed synthetic identity');
  }
  return value.users[0];
}

async function lookupFirebaseUser(fetchImplementation, accessToken) {
  const { value } = await googleRequest(fetchImplementation, accessToken, ACCOUNT_LOOKUP_URL, {
    method: 'POST',
    body: { localId: [SYNTHETIC_UID] },
    description: 'Firebase synthetic user lookup',
  });
  return validateLookupResponse(value);
}

async function observeRawFixture(fetchImplementation, accessToken) {
  const [firebaseUser, publicHome, privateHome, controlOwner, homeKeys, homeKeyIndexes] =
    await Promise.all([
      lookupFirebaseUser(fetchImplementation, accessToken),
      getFirestoreDocument(fetchImplementation, accessToken, `homes/${HOME_ID}`),
      getFirestoreDocument(fetchImplementation, accessToken, `controlHomes/${HOME_ID}`),
      getFirestoreDocument(fetchImplementation, accessToken, `controlOwners/${SYNTHETIC_UID}`),
      listHomeKeyDocuments(fetchImplementation, accessToken),
      queryHomeKeyIndexes(fetchImplementation, accessToken),
    ]);
  return Object.freeze({
    firebaseUser,
    publicHome,
    privateHome,
    controlOwner,
    homeKeys,
    homeKeyIndexes,
  });
}

function fixtureAbsence(raw, activeCoordinatorSessions) {
  return Object.freeze({
    schema: ABSENCE_SCHEMA,
    state: 'absent',
    firebase_auth_users: raw.firebaseUser === null ? 0 : 1,
    public_homes: raw.publicHome === null ? 0 : 1,
    private_homes: raw.privateHome === null ? 0 : 1,
    home_key_records: raw.homeKeys.length,
    home_key_indexes: raw.homeKeyIndexes.length,
    control_owners: raw.controlOwner === null ? 0 : 1,
    active_coordinator_sessions: activeCoordinatorSessions,
  });
}

function isAbsent(value) {
  return Object.entries(value).every(([key, entry]) => (
    key === 'schema' || key === 'state' || entry === 0
  ));
}

function firestoreField(fields, name, kind, path) {
  const field = fields[name];
  if (!plainObject(field)
    || !isDeepStrictEqual(Object.keys(field), [kind])) {
    reject(`${path}.${name} has an invalid Firestore type`);
  }
  return field[kind];
}

function stringField(fields, name, path) {
  const value = firestoreField(fields, name, 'stringValue', path);
  if (typeof value !== 'string') reject(`${path}.${name} is invalid`);
  return value;
}

function integerField(fields, name, path) {
  const value = firestoreField(fields, name, 'integerValue', path);
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    reject(`${path}.${name} is invalid`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) reject(`${path}.${name} is invalid`);
  return parsed;
}

function timestampField(fields, name, path) {
  return validTimestamp(firestoreField(fields, name, 'timestampValue', path), `${path}.${name}`);
}

function nullableTimestampField(fields, name, path) {
  const field = fields[name];
  if (plainObject(field) && isDeepStrictEqual(Object.keys(field), ['nullValue'])
    && field.nullValue === null) return null;
  return timestampField(fields, name, path);
}

function nullableStringField(fields, name, path) {
  const field = fields[name];
  if (plainObject(field) && isDeepStrictEqual(Object.keys(field), ['nullValue'])
    && field.nullValue === null) return null;
  return stringField(fields, name, path);
}

function stringArrayField(fields, name, path) {
  const array = firestoreField(fields, name, 'arrayValue', path);
  allowedKeys(array, ['values'], `${path}.${name}.arrayValue`);
  const values = array.values ?? [];
  if (!Array.isArray(values)) reject(`${path}.${name} is invalid`);
  return values.map((entry, index) => {
    if (!plainObject(entry) || !isDeepStrictEqual(Object.keys(entry), ['stringValue'])
      || typeof entry.stringValue !== 'string') {
      reject(`${path}.${name}[${index}] is invalid`);
    }
    return entry.stringValue;
  });
}

function exactFieldNames(document, names, path) {
  if (!isDeepStrictEqual(Object.keys(document.fields).sort(), [...names].sort())) {
    reject(`${path} contains an unreviewed Firestore field`);
  }
}

function validatePublicHome(document) {
  const path = 'cleanup.public_home';
  exactFieldNames(document, [
    'created_at', 'home_id', 'icon', 'name', 'relay_url', 'schema', 'updated_at',
  ], path);
  exact(stringField(document.fields, 'schema', path), 'miakapp.home/1', `${path}.schema`);
  exact(stringField(document.fields, 'home_id', path), HOME_ID, `${path}.home_id`);
  exact(stringField(document.fields, 'name', path), HOME_NAME, `${path}.name`);
  exact(stringField(document.fields, 'icon', path), HOME_ICON, `${path}.icon`);
  const relay = stringField(document.fields, 'relay_url', path);
  if (relay !== RELAY_A_URL && relay !== RELAY_B_URL) reject(`${path}.relay_url has drifted`);
  timestampField(document.fields, 'created_at', path);
  timestampField(document.fields, 'updated_at', path);
  return Object.freeze({ relay, document });
}

function validatePrivateHome(document) {
  const path = 'cleanup.private_home';
  exactFieldNames(document, [
    'active_key_count', 'created_at', 'home_id', 'owner_uid', 'relay_url',
    'retained_key_count', 'schema', 'updated_at',
  ], path);
  exact(stringField(document.fields, 'schema', path), 'miakapp.control-home/1', `${path}.schema`);
  exact(stringField(document.fields, 'home_id', path), HOME_ID, `${path}.home_id`);
  exact(stringField(document.fields, 'owner_uid', path), SYNTHETIC_UID, `${path}.owner_uid`);
  const relay = stringField(document.fields, 'relay_url', path);
  if (relay !== RELAY_A_URL && relay !== RELAY_B_URL) reject(`${path}.relay_url has drifted`);
  const activeKeyCount = integerField(document.fields, 'active_key_count', path);
  const retainedKeyCount = integerField(document.fields, 'retained_key_count', path);
  if (![0, 1].includes(activeKeyCount) || retainedKeyCount !== activeKeyCount) {
    reject('cleanup.private_home key counts have drifted');
  }
  timestampField(document.fields, 'created_at', path);
  timestampField(document.fields, 'updated_at', path);
  return Object.freeze({ activeKeyCount, relay, document });
}

function validateControlOwner(document) {
  const path = 'cleanup.control_owner';
  exactFieldNames(document, ['owned_home_count', 'owner_uid', 'schema', 'updated_at'], path);
  exact(stringField(document.fields, 'schema', path), 'miakapp.control-owner/1', `${path}.schema`);
  exact(stringField(document.fields, 'owner_uid', path), SYNTHETIC_UID, `${path}.owner_uid`);
  exact(integerField(document.fields, 'owned_home_count', path), 1, `${path}.owned_home_count`);
  timestampField(document.fields, 'updated_at', path);
  return document;
}

function validateHomeKeyRecord(document) {
  const path = 'cleanup.home_key_record';
  exactFieldNames(document, [
    'created_at', 'created_by', 'home_id', 'key_id', 'label', 'last_issuance_id',
    'last_used_at', 'revoked_at', 'schema', 'scopes', 'status', 'verifier',
    'verifier_key_version',
  ], path);
  const keyId = validKeyId(stringField(document.fields, 'key_id', path), `${path}.key_id`);
  exact(document.name, `${DOCUMENT_ROOT}/controlHomes/${HOME_ID}/homeKeys/${keyId}`,
    `${path}.name`);
  exact(stringField(document.fields, 'schema', path), 'miakapp.home-key-record/1',
    `${path}.schema`);
  exact(stringField(document.fields, 'home_id', path), HOME_ID, `${path}.home_id`);
  exact(stringField(document.fields, 'created_by', path), SYNTHETIC_UID, `${path}.created_by`);
  exact(stringField(document.fields, 'label', path), HOME_KEY_LABEL, `${path}.label`);
  exact(stringArrayField(document.fields, 'scopes', path), HOME_KEY_SCOPES, `${path}.scopes`);
  exact(stringField(document.fields, 'status', path), 'active', `${path}.status`);
  const verifier = stringField(document.fields, 'verifier', path);
  if (!VERIFIER.test(verifier)
    || Buffer.from(verifier, 'base64url').byteLength !== 32
    || Buffer.from(verifier, 'base64url').toString('base64url') !== verifier) {
    reject(`${path}.verifier is invalid`);
  }
  exact(stringField(document.fields, 'verifier_key_version', path), 'v1',
    `${path}.verifier_key_version`);
  timestampField(document.fields, 'created_at', path);
  exact(nullableTimestampField(document.fields, 'revoked_at', path), null, `${path}.revoked_at`);
  const lastUsedAt = nullableTimestampField(document.fields, 'last_used_at', path);
  const lastIssuanceId = nullableStringField(document.fields, 'last_issuance_id', path);
  if ((lastUsedAt === null) !== (lastIssuanceId === null)) {
    reject('cleanup.home_key_record issuance fields are inconsistent');
  }
  if (lastIssuanceId !== null) validKeyId(lastIssuanceId, `${path}.last_issuance_id`);
  return Object.freeze({ keyId, document });
}

function validateHomeKeyIndex(document) {
  const path = 'cleanup.home_key_index';
  exactFieldNames(document, ['created_at', 'home_id', 'key_id', 'schema', 'status'], path);
  const keyId = validKeyId(stringField(document.fields, 'key_id', path), `${path}.key_id`);
  exact(document.name, `${DOCUMENT_ROOT}/homeKeyIndex/${keyId}`, `${path}.name`);
  exact(stringField(document.fields, 'schema', path), 'miakapp.home-key-index/1', `${path}.schema`);
  exact(stringField(document.fields, 'home_id', path), HOME_ID, `${path}.home_id`);
  exact(stringField(document.fields, 'status', path), 'active', `${path}.status`);
  timestampField(document.fields, 'created_at', path);
  return Object.freeze({ keyId, document });
}

function validateCleanupUser(user) {
  if (user === null) return null;
  for (const forbidden of [
    'dateOfBirth', 'displayName', 'email', 'initialEmail', 'language', 'passwordHash',
    'phoneNumber', 'photoUrl', 'rawPassword', 'salt', 'screenName', 'tenantId', 'timeZone',
  ]) {
    if (user[forbidden] !== undefined) {
      reject('Cleanup refused a Firebase identity with non-synthetic profile data');
    }
  }
  if (user.emailVerified !== undefined && user.emailVerified !== false) {
    reject('Cleanup refused a verified Firebase profile');
  }
  if (user.disabled !== undefined && user.disabled !== false) {
    reject('Cleanup refused a disabled Firebase profile');
  }
  if (user.customAuth !== undefined && user.customAuth !== true) {
    reject('Cleanup refused a non-custom Firebase profile');
  }
  if (user.providerUserInfo !== undefined
    && (!Array.isArray(user.providerUserInfo) || user.providerUserInfo.length !== 0)) {
    reject('Cleanup refused a Firebase profile linked to an identity provider');
  }
  if (user.mfaInfo !== undefined
    && (!Array.isArray(user.mfaInfo) || user.mfaInfo.length !== 0)) {
    reject('Cleanup refused a Firebase profile with MFA enrollment');
  }
  if (user.customAttributes !== undefined && user.customAttributes !== '{}') {
    reject('Cleanup refused a Firebase profile with persistent custom attributes');
  }
  exact(user.localId, SYNTHETIC_UID, 'cleanup.firebase_user.localId');
  return user;
}

function validateCleanupInventory(raw, expectedKeyId) {
  const publicHome = raw.publicHome === null ? null : validatePublicHome(raw.publicHome);
  const privateHome = raw.privateHome === null ? null : validatePrivateHome(raw.privateHome);
  const controlOwner = raw.controlOwner === null ? null : validateControlOwner(raw.controlOwner);
  const homeKey = raw.homeKeys.length === 0 ? null : validateHomeKeyRecord(raw.homeKeys[0]);
  const homeKeyIndex = raw.homeKeyIndexes.length === 0
    ? null
    : validateHomeKeyIndex(raw.homeKeyIndexes[0]);
  validateCleanupUser(raw.firebaseUser);
  const homesPresent = [publicHome, privateHome, controlOwner].filter((entry) => entry !== null).length;
  if (homesPresent !== 0 && homesPresent !== 3) {
    reject('Cleanup refused a partial synthetic Home ownership cluster');
  }
  if ((homeKey === null) !== (homeKeyIndex === null)) {
    reject('Cleanup refused a partial synthetic Home Key registry');
  }
  if (homeKey !== null && (privateHome === null
    || privateHome.activeKeyCount !== 1
    || homeKey.keyId !== homeKeyIndex.keyId)) {
    reject('Cleanup refused an inconsistent synthetic Home Key registry');
  }
  if (homeKey === null && privateHome !== null && privateHome.activeKeyCount !== 0) {
    reject('Cleanup refused inconsistent synthetic Home key counts');
  }
  if (publicHome !== null && publicHome.relay !== privateHome.relay) {
    reject('Cleanup refused divergent public and private relay routing');
  }
  if (expectedKeyId !== undefined
    && (homeKey === null || homeKey.keyId !== expectedKeyId)) {
    reject('Cleanup refused a Home Key different from the controller boundary');
  }
  const documents = [
    homeKey?.document,
    homeKeyIndex?.document,
    publicHome?.document,
    privateHome?.document,
    controlOwner,
  ].filter((entry) => entry !== undefined && entry !== null);
  return Object.freeze({ documents: Object.freeze(documents) });
}

function deleteWrites(documents) {
  return documents.map((document) => Object.freeze({
    delete: document.name,
    currentDocument: { updateTime: document.updateTime },
  }));
}

function validateCommitResponse(value, writeCount) {
  allowedKeys(value, ['commitTime', 'writeResults'], 'firestore_cleanup_commit');
  validTimestamp(value.commitTime, 'firestore_cleanup_commit.commitTime');
  if (!Array.isArray(value.writeResults) || value.writeResults.length !== writeCount) {
    reject('Firestore cleanup commit result count is invalid');
  }
}

function validateWebConfig(value) {
  allowedKeys(value, [
    'apiKey', 'appId', 'authDomain', 'databaseURL', 'locationId', 'measurementId',
    'messagingSenderId', 'projectId', 'storageBucket',
  ], 'firebase_web_config');
  if (value.projectId !== PROJECT_ID
    || value.appId !== FIREBASE_APP_ID
    || value.authDomain !== `${PROJECT_ID}.firebaseapp.com`
    || value.storageBucket !== `${PROJECT_ID}.firebasestorage.app`
    || value.messagingSenderId !== PROJECT_NUMBER
    || typeof value.apiKey !== 'string'
    || !API_KEY.test(value.apiKey)) {
    reject('Firebase Web configuration differs from the reviewed staging app');
  }
  return value.apiKey;
}

function validateHomeRepresentation(value, relayUrl, path) {
  exactKeys(value, [
    'created_at', 'home_id', 'icon', 'name', 'relay_url', 'updated_at',
  ], path);
  exact(value.home_id, HOME_ID, `${path}.home_id`);
  exact(value.name, HOME_NAME, `${path}.name`);
  exact(value.icon, HOME_ICON, `${path}.icon`);
  exact(value.relay_url, relayUrl, `${path}.relay_url`);
  validTimestamp(value.created_at, `${path}.created_at`);
  validTimestamp(value.updated_at, `${path}.updated_at`);
  return value;
}

function validateCoordinator(value) {
  if (value === null || typeof value !== 'object'
    || value.state === null || typeof value.state !== 'object'
    || typeof value.state.set !== 'function'
    || typeof value.configure !== 'function'
    || typeof value.start !== 'function'
    || typeof value.stop !== 'function') {
    reject('Injected MiakAPI coordinator factory returned an invalid boundary');
  }
  return value;
}

function validateProvider(value) {
  if (value === null || typeof value !== 'object'
    || typeof value.getAccessToken !== 'function') {
    reject('Injected MiakAPI Home Key provider factory returned an invalid boundary');
  }
  return value;
}

function collapseFactoryError(description, callback) {
  try {
    return callback();
  } catch {
    return reject(`${description} failed at the injected MiakAPI boundary`);
  }
}

export function createGoogleBrowserRelayFixtureDependencies(sessionValue, implementationValue) {
  validateBrowserRelayFixtureCloudProfile();
  const session = validateSession(sessionValue);
  const { implementations, startedAt } = validateImplementations(implementationValue);
  let initialAbsenceVerified = false;
  let inventoryCalls = 0;
  let signedJwtAttempts = 0;
  let nextBrowserSequence = 1;
  let identityAttempted = false;
  let identityCreated = false;
  let homeAttempted = false;
  let homeCreated = false;
  let homeKeyAttempted = false;
  let homeKeyCreated = false;
  let relayRotationAttempted = false;
  let providerCreated = false;
  let coordinatorCreated = false;
  let activeCoordinatorSessions = 0;
  let firestoreCleanupAttempted = false;
  let firebaseUserCleanupAttempted = false;
  let webApiKeyPromise;

  function requireInitialAbsence() {
    if (!initialAbsenceVerified) {
      reject('Cloud mutation requires a proven initial absence boundary');
    }
  }

  function currentTime() {
    const value = implementations.clock();
    if (!Number.isSafeInteger(value) || value < startedAt) {
      reject('Cloud adapter clock is not monotonic');
    }
    return value;
  }

  async function webApiKey() {
    if (webApiKeyPromise === undefined) {
      webApiKeyPromise = googleRequest(
        implementations.fetch,
        session.accessToken,
        WEB_CONFIG_URL,
        { description: 'Firebase Web configuration read' },
      ).then(({ value }) => validateWebConfig(value));
      webApiKeyPromise.catch(() => undefined);
    }
    return webApiKeyPromise;
  }

  async function signFirebaseCustomToken(sequence, signal) {
    requireInitialAbsence();
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 3
      || signedJwtAttempts >= MAXIMUM_SIGNED_JWTS
      || currentTime() - startedAt > MAXIMUM_SIGNING_WINDOW_MILLISECONDS) {
      reject('Firebase custom-token signing exceeded its reviewed boundary');
    }
    signedJwtAttempts += 1;
    const issuedAt = Math.floor(currentTime() / 1_000);
    const payload = {
      aud: CUSTOM_TOKEN_AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + 3_600,
      iss: SIGNER_SERVICE_ACCOUNT,
      sub: SIGNER_SERVICE_ACCOUNT,
      uid: SYNTHETIC_UID,
      claims: { miakapp_staging_acceptance_sequence: sequence },
    };
    const { value } = await googleRequest(
      implementations.fetch,
      session.accessToken,
      SIGN_JWT_URL,
      {
        method: 'POST',
        body: { payload: JSON.stringify(payload) },
        description: 'Firebase custom-token signature',
        signal,
      },
    );
    exactKeys(value, ['keyId', 'signedJwt'], 'iam_sign_jwt');
    if (typeof value.keyId !== 'string' || value.keyId.length < 1 || value.keyId.length > 256) {
      reject('IAM JWT signature returned an invalid key identifier');
    }
    return validJwt(value.signedJwt, 'iam_sign_jwt.signedJwt');
  }

  async function rawInventory() {
    if (inventoryCalls >= MAXIMUM_INVENTORY_CALLS) {
      reject('Fixture inventory exceeded its reviewed request budget');
    }
    inventoryCalls += 1;
    return observeRawFixture(implementations.fetch, session.accessToken);
  }

  async function verifyFixtureAbsent() {
    const raw = await rawInventory();
    const result = fixtureAbsence(raw, activeCoordinatorSessions);
    if (!initialAbsenceVerified && isAbsent(result)) initialAbsenceVerified = true;
    return result;
  }

  async function inspectCleanupInventory(expectedKeyId) {
    const raw = await rawInventory();
    const absence = fixtureAbsence(raw, activeCoordinatorSessions);
    if (isAbsent(absence)) return Object.freeze({ absent: true, raw, documents: [] });
    if (activeCoordinatorSessions !== 0) {
      reject('Fixture data cleanup requires zero active coordinator sessions');
    }
    const validated = validateCleanupInventory(raw, expectedKeyId);
    return Object.freeze({ absent: false, raw, documents: validated.documents });
  }

  return Object.freeze({
    async verifyFixtureAbsent() {
      return verifyFixtureAbsent();
    },

    async createFirebaseIdentity(input) {
      exactKeys(input, ['uid'], 'create_firebase_identity');
      exact(input.uid, SYNTHETIC_UID, 'create_firebase_identity.uid');
      requireInitialAbsence();
      if (identityAttempted) reject('Synthetic Firebase identity creation is single-use');
      identityAttempted = true;
      const [apiKey, customToken] = await Promise.all([
        webApiKey(),
        signFirebaseCustomToken(0),
      ]);
      const { value } = await publicIdentityRequest(
        implementations.fetch,
        apiKey,
        '/v1/accounts:signInWithCustomToken',
        { token: customToken, returnSecureToken: true },
        'Firebase custom-token exchange',
      );
      allowedKeys(value, [
        'expiresIn', 'idToken', 'isNewUser', 'kind', 'localId', 'refreshToken',
      ], 'firebase_custom_token_exchange');
      if (value.localId !== SYNTHETIC_UID
        || value.isNewUser !== true
        || value.expiresIn !== '3600'
        || (value.kind !== undefined
          && value.kind !== 'identitytoolkit#VerifyCustomTokenResponse')
        || typeof value.refreshToken !== 'string'
        || value.refreshToken.length < 64
        || value.refreshToken.length > 8_192) {
        reject('Firebase custom-token exchange did not create the fixed synthetic identity');
      }
      const idToken = validJwt(value.idToken, 'firebase_custom_token_exchange.idToken');
      identityCreated = true;
      return Object.freeze({ uid: SYNTHETIC_UID, id_token: idToken });
    },

    async createHome(input) {
      exactKeys(input, [
        'firebase_id_token', 'home_id', 'icon', 'name', 'relay_url',
      ], 'create_home');
      const idToken = validJwt(input.firebase_id_token, 'create_home.firebase_id_token');
      exact(input.home_id, HOME_ID, 'create_home.home_id');
      exact(input.name, HOME_NAME, 'create_home.name');
      exact(input.icon, HOME_ICON, 'create_home.icon');
      exact(input.relay_url, RELAY_A_URL, 'create_home.relay_url');
      requireInitialAbsence();
      if (!identityCreated || homeAttempted) {
        reject('Synthetic Home creation is outside the reviewed sequence');
      }
      homeAttempted = true;
      const value = await controlPlaneRequest(
        implementations.fetch,
        idToken,
        '/v1/homes',
        'POST',
        { home_id: HOME_ID, name: HOME_NAME, icon: HOME_ICON, relay_url: RELAY_A_URL },
        201,
        'Synthetic Home creation',
      );
      exactKeys(value, ['home', 'schema'], 'create_home_response');
      exact(value.schema, 'miakapp.home/1', 'create_home_response.schema');
      validateHomeRepresentation(value.home, RELAY_A_URL, 'create_home_response.home');
      homeCreated = true;
      return Object.freeze({ home_id: HOME_ID, relay_url: RELAY_A_URL });
    },

    async createHomeKey(input) {
      exactKeys(input, [
        'firebase_id_token', 'home_id', 'label', 'scopes',
      ], 'create_home_key');
      const idToken = validJwt(input.firebase_id_token, 'create_home_key.firebase_id_token');
      exact(input.home_id, HOME_ID, 'create_home_key.home_id');
      exact(input.label, HOME_KEY_LABEL, 'create_home_key.label');
      exact(input.scopes, HOME_KEY_SCOPES, 'create_home_key.scopes');
      requireInitialAbsence();
      if (!homeCreated || homeKeyAttempted) {
        reject('Synthetic Home Key creation is outside the reviewed sequence');
      }
      homeKeyAttempted = true;
      const value = await controlPlaneRequest(
        implementations.fetch,
        idToken,
        `/v1/homes/${HOME_ID}/home-keys`,
        'POST',
        { label: HOME_KEY_LABEL, scopes: HOME_KEY_SCOPES },
        201,
        'Synthetic Home Key creation',
      );
      exactKeys(value, ['home_key', 'key', 'schema'], 'create_home_key_response');
      exact(value.schema, 'miakapp.home-key-created/1', 'create_home_key_response.schema');
      exactKeys(value.key, [
        'created_at', 'key_id', 'label', 'last_used_at', 'revoked_at', 'scopes',
      ], 'create_home_key_response.key');
      const keyId = validKeyId(value.key.key_id, 'create_home_key_response.key.key_id');
      exact(value.key.label, HOME_KEY_LABEL, 'create_home_key_response.key.label');
      exact(value.key.scopes, HOME_KEY_SCOPES, 'create_home_key_response.key.scopes');
      validTimestamp(value.key.created_at, 'create_home_key_response.key.created_at');
      exact(value.key.revoked_at, null, 'create_home_key_response.key.revoked_at');
      exact(value.key.last_used_at, null, 'create_home_key_response.key.last_used_at');
      if (typeof value.home_key !== 'string'
        || value.home_key.length !== 71
        || HOME_KEY.exec(value.home_key)?.[1] !== keyId) {
        reject('Synthetic Home Key creation returned invalid private material');
      }
      homeKeyCreated = true;
      return Object.freeze({ key_id: keyId, home_key: value.home_key });
    },

    createHomeKeyAccessTokenProvider(input) {
      exactKeys(input, ['exchangeEndpoint', 'homeKey'], 'create_home_key_provider');
      if (!homeKeyCreated || providerCreated
        || typeof input.exchangeEndpoint !== 'string'
        || input.exchangeEndpoint !== `${CONTROL_PLANE_ORIGIN}/v1/access-tokens:exchange`
        || typeof input.homeKey !== 'string'
        || input.homeKey.length !== 71
        || HOME_KEY.exec(input.homeKey) === null) {
        reject('MiakAPI Home Key provider creation is outside the reviewed boundary');
      }
      providerCreated = true;
      return validateProvider(collapseFactoryError(
        'MiakAPI Home Key provider creation',
        () => implementations.createHomeKeyAccessTokenProvider(input),
      ));
    },

    createCoordinator(input) {
      exactKeys(input, ['accessTokenProvider', 'name'], 'create_coordinator');
      exact(input.name, COORDINATOR_NAME, 'create_coordinator.name');
      if (!providerCreated || coordinatorCreated) {
        reject('MiakAPI coordinator creation is outside the reviewed sequence');
      }
      validateProvider(input.accessTokenProvider);
      coordinatorCreated = true;
      const coordinator = validateCoordinator(collapseFactoryError(
        'MiakAPI coordinator creation',
        () => implementations.createCoordinator(input),
      ));
      return Object.freeze({
        state: Object.freeze({
          async set(value) {
            try {
              return await coordinator.state.set(value);
            } catch {
              return reject('MiakAPI coordinator state mutation failed');
            }
          },
        }),
        configure(value) {
          return collapseFactoryError('MiakAPI coordinator configuration', () => (
            coordinator.configure(value)
          ));
        },
        async start() {
          if (activeCoordinatorSessions !== 0) {
            reject('MiakAPI coordinator session is already active');
          }
          activeCoordinatorSessions = 1;
          try {
            return await coordinator.start();
          } catch {
            return reject('MiakAPI coordinator start failed');
          }
        },
        async stop(value) {
          exactKeys(value, ['deadlineMs'], 'coordinator_stop');
          exact(value.deadlineMs, 2_000, 'coordinator_stop.deadlineMs');
          if (activeCoordinatorSessions === 0) return undefined;
          try {
            const result = await coordinator.stop(value);
            activeCoordinatorSessions = 0;
            return result;
          } catch {
            return reject('MiakAPI coordinator stop failed');
          }
        },
      });
    },

    async issueFirebaseCustomToken(input) {
      exactKeys(input, ['browser', 'sequence', 'signal', 'uid'], 'issue_firebase_custom_token');
      exact(input.uid, SYNTHETIC_UID, 'issue_firebase_custom_token.uid');
      if (!homeKeyCreated
        || input.browser !== BROWSER_ORDER[nextBrowserSequence - 1]
        || input.sequence !== nextBrowserSequence) {
        reject('Browser custom-token issuance is outside the reviewed sequence');
      }
      if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
        reject('Browser custom-token issuance received an invalid signal');
      }
      nextBrowserSequence += 1;
      return signFirebaseCustomToken(input.sequence, input.signal);
    },

    async patchHomeRelay(input) {
      exactKeys(input, ['firebase_id_token', 'home_id', 'relay_url'], 'patch_home_relay');
      const idToken = validJwt(input.firebase_id_token, 'patch_home_relay.firebase_id_token');
      exact(input.home_id, HOME_ID, 'patch_home_relay.home_id');
      exact(input.relay_url, RELAY_B_URL, 'patch_home_relay.relay_url');
      requireInitialAbsence();
      if (!homeCreated || relayRotationAttempted) {
        reject('Synthetic relay rotation is outside the reviewed sequence');
      }
      relayRotationAttempted = true;
      const value = await controlPlaneRequest(
        implementations.fetch,
        idToken,
        `/v1/homes/${HOME_ID}`,
        'PATCH',
        { relay_url: RELAY_B_URL },
        200,
        'Synthetic relay rotation',
      );
      exactKeys(value, ['home', 'schema'], 'patch_home_relay_response');
      exact(value.schema, 'miakapp.home/1', 'patch_home_relay_response.schema');
      validateHomeRepresentation(value.home, RELAY_B_URL, 'patch_home_relay_response.home');
      return Object.freeze({ home_id: HOME_ID, relay_url: RELAY_B_URL });
    },

    async removeFixture(input) {
      exactKeys(input, [
        'firebase_id_token', 'home_id', 'home_key_id', 'uid',
      ], 'remove_fixture');
      exact(input.uid, SYNTHETIC_UID, 'remove_fixture.uid');
      exact(input.home_id, HOME_ID, 'remove_fixture.home_id');
      if (input.firebase_id_token !== undefined) {
        validJwt(input.firebase_id_token, 'remove_fixture.firebase_id_token');
      }
      if (input.home_key_id !== undefined) {
        validKeyId(input.home_key_id, 'remove_fixture.home_key_id');
      }
      requireInitialAbsence();
      if (activeCoordinatorSessions !== 0) {
        reject('Fixture data cleanup requires the coordinator to stop first');
      }
      let inventory = await inspectCleanupInventory(input.home_key_id);
      if (inventory.documents.length > 0) {
        if (firestoreCleanupAttempted) {
          reject('Firestore fixture cleanup may not be retried in the same adapter');
        }
        firestoreCleanupAttempted = true;
        const writes = deleteWrites(inventory.documents);
        try {
          const { value } = await googleRequest(
            implementations.fetch,
            session.accessToken,
            COMMIT_URL,
            {
              method: 'POST',
              body: { writes },
              description: 'Atomic Firestore fixture cleanup',
            },
          );
          validateCommitResponse(value, writes.length);
        } catch {}
        inventory = await inspectCleanupInventory(undefined);
        if (inventory.documents.length !== 0
          || inventory.raw.publicHome !== null
          || inventory.raw.privateHome !== null
          || inventory.raw.controlOwner !== null
          || inventory.raw.homeKeys.length !== 0
          || inventory.raw.homeKeyIndexes.length !== 0) {
          reject('Atomic Firestore fixture cleanup did not converge without retry');
        }
      }
      if (inventory.raw.firebaseUser !== null) {
        validateCleanupUser(inventory.raw.firebaseUser);
        if (firebaseUserCleanupAttempted) {
          reject('Firebase user cleanup may not be retried in the same adapter');
        }
        firebaseUserCleanupAttempted = true;
        try {
          await googleRequest(
            implementations.fetch,
            session.accessToken,
            ACCOUNT_DELETE_URL,
            {
              method: 'POST',
              body: { localId: SYNTHETIC_UID },
              description: 'Firebase synthetic user cleanup',
              allowEmpty: true,
            },
          );
        } catch {}
      }
      const final = await verifyFixtureAbsent();
      if (!isAbsent(final)) {
        reject('Fixture cleanup did not converge to independently observed absence');
      }
      return true;
    },
  });
}
