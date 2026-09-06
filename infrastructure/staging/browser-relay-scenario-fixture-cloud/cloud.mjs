import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { FIREBASE_APP_ID } from '../browser-app-check/contract.mjs';
import {
  PROJECT_ID,
  PROJECT_NUMBER,
} from '../browser-relay-fixture/contract.mjs';
import { SIGNER_SERVICE_ACCOUNT } from '../browser-relay-fixture-cloud/cloud.mjs';
import {
  REPLACEMENT_ABSENCE_SCHEMA,
  REPLACEMENT_IDENTITY_SCHEMA,
  REPLACEMENT_SYNTHETIC_UID,
} from '../browser-relay-scenario-fixture/contract.mjs';
import {
  StagingBrowserRelayScenarioFixtureCloudError,
  validateBrowserRelayScenarioFixtureCloudProfile,
} from './contract.mjs';

const IDENTITY_ORIGIN = 'https://identitytoolkit.googleapis.com';
const IAM_CREDENTIALS_ORIGIN = 'https://iamcredentials.googleapis.com';
const FIREBASE_MANAGEMENT_ORIGIN = 'https://firebase.googleapis.com';
const CUSTOM_TOKEN_AUDIENCE =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const WEB_CONFIG_URL =
  `${FIREBASE_MANAGEMENT_ORIGIN}/v1beta1/projects/-/webApps/${encodeURIComponent(FIREBASE_APP_ID)}/config`;
const SIGN_JWT_URL =
  `${IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/${SIGNER_SERVICE_ACCOUNT}:signJwt`;
const ACCOUNT_LOOKUP_URL =
  `${IDENTITY_ORIGIN}/v1/projects/${PROJECT_ID}/accounts:lookup`;
const ACCOUNT_DELETE_URL =
  `${IDENTITY_ORIGIN}/v1/projects/${PROJECT_ID}/accounts:delete`;
const REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_INVENTORY_CALLS = 6;
const MAXIMUM_SIGNED_JWTS = 2;
const MAXIMUM_SIGNING_WINDOW_MILLISECONDS = 20 * 60 * 1_000;
const API_KEY = /^AIza[0-9A-Za-z_-]{30,}$/u;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const IMPLEMENTATION_KEYS = Object.freeze(['clock', 'fetch']);

function reject(message) {
  throw new StagingBrowserRelayScenarioFixtureCloudError(message);
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
  if (typeof value !== 'string' || value.length < 64 || value.length > 8_192
    || !JWT.test(value)) {
    reject(`${path} is not a bounded JWT`);
  }
  return value;
}

function validateSession(value) {
  const session = exactKeys(value, ['accessToken'], 'operator_session');
  if (typeof session.accessToken !== 'string'
    || session.accessToken.length < 20
    || session.accessToken.length > 16 * 1024
    || /\s/u.test(session.accessToken)) {
    reject('Replacement adapter requires one verified ephemeral operator session');
  }
  return Object.freeze({ accessToken: session.accessToken });
}

function validateImplementations(value) {
  const implementations = exactKeys(value, IMPLEMENTATION_KEYS, 'implementations');
  if (IMPLEMENTATION_KEYS.some((key) => typeof implementations[key] !== 'function')) {
    reject('Replacement adapter requires the exact injected implementation boundary');
  }
  const boundary = Object.freeze({ clock: implementations.clock, fetch: implementations.fetch });
  let startedAt;
  try {
    startedAt = boundary.clock();
  } catch {
    reject('Replacement adapter clock is unavailable');
  }
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
    reject('Replacement adapter clock returned an invalid instant');
  }
  return Object.freeze({ implementations: boundary, startedAt });
}

function boundedSignal(externalSignal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS);
  if (externalSignal === undefined) return timeout;
  if (!(externalSignal instanceof AbortSignal)) {
    reject('Replacement adapter received an invalid cancellation signal');
  }
  return AbortSignal.any([externalSignal, timeout]);
}

function cancelResponse(response) {
  try {
    response?.body?.cancel()?.catch(() => undefined);
  } catch {}
}

async function responseBytes(response, description, allowEmpty, signal) {
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined
    && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)
      || Number(contentLength) > MAXIMUM_RESPONSE_BYTES)) {
    cancelResponse(response);
    reject(`${description} response size is invalid`);
  }
  let reader;
  try {
    reader = response.body?.getReader();
  } catch {
    reject(`${description} response is unreadable`);
  }
  if (reader === undefined) {
    if (allowEmpty) return Buffer.alloc(0);
    reject(`${description} response is empty`);
  }
  const chunks = [];
  let size = 0;
  let completed = false;
  const cancel = () => { reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) reject(`${description} response was cancelled`);
      const { done, value } = await reader.read();
      if (signal.aborted) reject(`${description} response was cancelled`);
      if (done) break;
      if (!(value instanceof Uint8Array) || size + value.byteLength > MAXIMUM_RESPONSE_BYTES) {
        reject(`${description} response size is invalid`);
      }
      size += value.byteLength;
      if (value.byteLength !== 0) chunks.push(Buffer.from(value));
    }
    if (!allowEmpty && size === 0) reject(`${description} response is empty`);
    completed = true;
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (error instanceof StagingBrowserRelayScenarioFixtureCloudError) throw error;
    reject(`${description} response is unreadable`);
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!completed) cancel();
    reader.releaseLock();
  }
}

async function request(fetchImplementation, url, init, boundary) {
  const signal = boundedSignal(boundary.signal);
  if (signal.aborted) reject(`${boundary.description} was cancelled before dispatch`);
  let response;
  try {
    response = await fetchImplementation(url, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
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
  const bytes = await responseBytes(
    response,
    boundary.description,
    boundary.allowEmpty === true,
    signal,
  );
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

function validateWebConfig(value) {
  allowedKeys(value, [
    'apiKey',
    'appId',
    'authDomain',
    'databaseURL',
    'locationId',
    'measurementId',
    'messagingSenderId',
    'projectId',
    'storageBucket',
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

function validateLookupResponse(value) {
  allowedKeys(value, ['kind', 'users'], 'replacement_user_lookup');
  if (value.kind !== undefined
    && value.kind !== 'identitytoolkit#GetAccountInfoResponse') {
    reject('Replacement Firebase user lookup kind is invalid');
  }
  if (value.users === undefined || (Array.isArray(value.users) && value.users.length === 0)) {
    return null;
  }
  if (!Array.isArray(value.users) || value.users.length !== 1
    || !plainObject(value.users[0])
    || value.users[0].localId !== REPLACEMENT_SYNTHETIC_UID) {
    reject('Replacement Firebase user lookup escaped the fixed synthetic identity');
  }
  return value.users[0];
}

function validateCleanupUser(user) {
  if (user === null) return null;
  for (const forbidden of [
    'dateOfBirth',
    'displayName',
    'email',
    'initialEmail',
    'language',
    'passwordHash',
    'phoneNumber',
    'photoUrl',
    'rawPassword',
    'salt',
    'screenName',
    'tenantId',
    'timeZone',
  ]) {
    if (user[forbidden] !== undefined) {
      reject('Cleanup refused a replacement identity with non-synthetic profile data');
    }
  }
  if (user.emailVerified !== undefined && user.emailVerified !== false) {
    reject('Cleanup refused a verified replacement Firebase profile');
  }
  if (user.disabled !== undefined && user.disabled !== false) {
    reject('Cleanup refused a disabled replacement Firebase profile');
  }
  if (user.customAuth !== undefined && user.customAuth !== true) {
    reject('Cleanup refused a non-custom replacement Firebase profile');
  }
  if (user.providerUserInfo !== undefined
    && (!Array.isArray(user.providerUserInfo) || user.providerUserInfo.length !== 0)) {
    reject('Cleanup refused a replacement Firebase profile linked to a provider');
  }
  if (user.mfaInfo !== undefined
    && (!Array.isArray(user.mfaInfo) || user.mfaInfo.length !== 0)) {
    reject('Cleanup refused a replacement Firebase profile with MFA enrollment');
  }
  if (user.customAttributes !== undefined && user.customAttributes !== '{}') {
    reject('Cleanup refused a replacement Firebase profile with persistent claims');
  }
  exact(user.localId, REPLACEMENT_SYNTHETIC_UID, 'cleanup.replacement_user.localId');
  return user;
}

function tokenDigest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createGoogleBrowserRelayScenarioReplacementDependencies(
  sessionValue,
  implementationValue,
) {
  validateBrowserRelayScenarioFixtureCloudProfile();
  const session = validateSession(sessionValue);
  const { implementations, startedAt } = validateImplementations(implementationValue);
  let initialAbsenceVerified = false;
  let inventoryCalls = 0;
  let signedJwtAttempts = 0;
  let identityCreationAttempted = false;
  let identityExchangeDispatched = false;
  let identityCreated = false;
  let pageTokenIssued = false;
  let identityDeletionAttempted = false;
  let identityOwnershipRejected = false;
  let cleanupStarted = false;
  let cleanupCompleted = false;
  let operationInFlight = false;
  let lastInstant = startedAt;
  let webApiKeyPromise;
  const signedJwtDigests = new Set();

  function currentTime() {
    let value;
    try {
      value = implementations.clock();
    } catch {
      reject('Replacement adapter clock is unavailable');
    }
    if (!Number.isSafeInteger(value) || value < lastInstant) {
      reject('Replacement adapter clock is not monotonic');
    }
    lastInstant = value;
    return value;
  }

  async function exclusive(operation) {
    if (operationInFlight) reject('A replacement identity operation is already in progress');
    operationInFlight = true;
    try {
      return await operation();
    } finally {
      operationInFlight = false;
    }
  }

  function requireInitialAbsence() {
    if (!initialAbsenceVerified) {
      reject('Replacement cloud mutation requires proven initial absence');
    }
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

  async function lookupReplacementUser() {
    if (inventoryCalls >= MAXIMUM_INVENTORY_CALLS) {
      reject('Replacement identity inventory exceeded its reviewed request budget');
    }
    inventoryCalls += 1;
    const { value } = await googleRequest(
      implementations.fetch,
      session.accessToken,
      ACCOUNT_LOOKUP_URL,
      {
        method: 'POST',
        body: { localId: [REPLACEMENT_SYNTHETIC_UID] },
        description: 'Replacement Firebase user lookup',
      },
    );
    return validateLookupResponse(value);
  }

  async function signFirebaseCustomToken(sequence, signal) {
    requireInitialAbsence();
    const now = currentTime();
    if (![0, 2].includes(sequence)
      || sequence !== (signedJwtAttempts === 0 ? 0 : 2)
      || signedJwtAttempts >= MAXIMUM_SIGNED_JWTS
      || cleanupStarted
      || now - startedAt > MAXIMUM_SIGNING_WINDOW_MILLISECONDS) {
      reject('Replacement Firebase signing exceeded its reviewed sequence or window');
    }
    signedJwtAttempts += 1;
    const issuedAt = Math.floor(now / 1_000);
    const payload = {
      aud: CUSTOM_TOKEN_AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + 3_600,
      iss: SIGNER_SERVICE_ACCOUNT,
      sub: SIGNER_SERVICE_ACCOUNT,
      uid: REPLACEMENT_SYNTHETIC_UID,
      claims: {
        miakapp_staging_acceptance_identity: 'replacement',
        miakapp_staging_acceptance_sequence: sequence,
      },
    };
    const { value } = await googleRequest(
      implementations.fetch,
      session.accessToken,
      SIGN_JWT_URL,
      {
        method: 'POST',
        body: { payload: JSON.stringify(payload) },
        description: 'Replacement Firebase custom-token signature',
        signal,
      },
    );
    if (signal?.aborted === true
      || currentTime() - startedAt > MAXIMUM_SIGNING_WINDOW_MILLISECONDS) {
      reject('Replacement Firebase signature arrived outside its reviewed window');
    }
    exactKeys(value, ['keyId', 'signedJwt'], 'replacement_iam_sign_jwt');
    if (typeof value.keyId !== 'string'
      || value.keyId.length < 1 || value.keyId.length > 256) {
      reject('Replacement IAM JWT signature returned an invalid key identifier');
    }
    const token = validJwt(value.signedJwt, 'replacement_iam_sign_jwt.signedJwt');
    const digest = tokenDigest(token);
    if (signedJwtDigests.has(digest)) reject('Replacement IAM JWT signature was reused');
    signedJwtDigests.add(digest);
    return token;
  }

  async function verifyReplacementIdentityAbsent() {
    const user = await lookupReplacementUser();
    if (user !== null) reject('Replacement Firebase identity is not absent');
    if (!identityCreationAttempted) initialAbsenceVerified = true;
    return Object.freeze({
      schema: REPLACEMENT_ABSENCE_SCHEMA,
      state: 'absent',
      firebase_auth_users: 0,
    });
  }

  return Object.freeze({
    async verifyReplacementIdentityAbsent(input) {
      exactKeys(input, ['uid'], 'verify_replacement_identity_absent');
      exact(input.uid, REPLACEMENT_SYNTHETIC_UID,
        'verify_replacement_identity_absent.uid');
      return exclusive(verifyReplacementIdentityAbsent);
    },

    async createReplacementIdentity(input) {
      exactKeys(input, ['uid'], 'create_replacement_identity');
      exact(input.uid, REPLACEMENT_SYNTHETIC_UID, 'create_replacement_identity.uid');
      return exclusive(async () => {
        requireInitialAbsence();
        if (identityCreationAttempted || cleanupStarted) {
          reject('Replacement Firebase identity creation is single-use');
        }
        identityCreationAttempted = true;
        const [apiKey, customToken] = await Promise.all([
          webApiKey(),
          signFirebaseCustomToken(0),
        ]);
        identityExchangeDispatched = true;
        const { value } = await publicIdentityRequest(
          implementations.fetch,
          apiKey,
          '/v1/accounts:signInWithCustomToken',
          { token: customToken, returnSecureToken: true },
          'Replacement Firebase custom-token exchange',
        );
        if (plainObject(value) && value.isNewUser === false) identityOwnershipRejected = true;
        allowedKeys(value, [
          'expiresIn',
          'idToken',
          'isNewUser',
          'kind',
          'localId',
          'refreshToken',
        ], 'replacement_custom_token_exchange');
        if ((value.localId !== undefined && value.localId !== REPLACEMENT_SYNTHETIC_UID)
          || value.isNewUser !== true
          || value.expiresIn !== '3600'
          || (value.kind !== undefined
            && value.kind !== 'identitytoolkit#VerifyCustomTokenResponse')
          || typeof value.refreshToken !== 'string'
          || value.refreshToken.length < 64
          || value.refreshToken.length > 8_192) {
          reject('Custom-token exchange did not create the replacement synthetic identity');
        }
        const idToken = validJwt(value.idToken, 'replacement_custom_token_exchange.idToken');
        const { value: lookup } = await publicIdentityRequest(
          implementations.fetch,
          apiKey,
          '/v1/accounts:lookup',
          { idToken },
          'Replacement Firebase identity binding',
        );
        const user = validateCleanupUser(validateLookupResponse(lookup));
        if (user === null) reject('Replacement Firebase identity binding returned no user');
        identityCreated = true;
        return Object.freeze({
          schema: REPLACEMENT_IDENTITY_SCHEMA,
          state: 'created',
        });
      });
    },

    async issueReplacementFirebaseCustomToken(input) {
      exactKeys(input, [
        'uid',
        'browser',
        'identity_generation',
        'matrix_sequence',
        'signal',
      ], 'issue_replacement_firebase_custom_token');
      exact(input.uid, REPLACEMENT_SYNTHETIC_UID,
        'issue_replacement_firebase_custom_token.uid');
      exact(input.browser, 'chromium',
        'issue_replacement_firebase_custom_token.browser');
      exact(input.identity_generation, 2,
        'issue_replacement_firebase_custom_token.identity_generation');
      exact(input.matrix_sequence, 2,
        'issue_replacement_firebase_custom_token.matrix_sequence');
      if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
        reject('Replacement page custom-token issuance received an invalid signal');
      }
      return exclusive(async () => {
        if (!identityCreated || pageTokenIssued || cleanupStarted) {
          reject('Replacement page custom-token issuance is outside the reviewed sequence');
        }
        pageTokenIssued = true;
        return signFirebaseCustomToken(2, input.signal);
      });
    },

    async removeReplacementIdentity(input) {
      exactKeys(input, ['uid'], 'remove_replacement_identity');
      exact(input.uid, REPLACEMENT_SYNTHETIC_UID, 'remove_replacement_identity.uid');
      return exclusive(async () => {
        requireInitialAbsence();
        if (!identityCreationAttempted) {
          reject('Replacement identity cleanup is outside the reviewed lifecycle');
        }
        cleanupStarted = true;
        const current = await lookupReplacementUser();
        if (current === null) {
          identityCreated = false;
          cleanupCompleted = true;
          return true;
        }
        if (cleanupCompleted) {
          reject('Cleanup refused a replacement identity appearing after completed cleanup');
        }
        if (!identityExchangeDispatched) {
          reject('Cleanup refused a replacement identity without a dispatched creation exchange');
        }
        if (identityOwnershipRejected) {
          reject('Cleanup refused a replacement identity not created by this operation');
        }
        validateCleanupUser(current);
        if (identityDeletionAttempted) {
          reject('Replacement Firebase identity deletion may not be retried');
        }
        identityDeletionAttempted = true;
        try {
          await googleRequest(
            implementations.fetch,
            session.accessToken,
            ACCOUNT_DELETE_URL,
            {
              method: 'POST',
              body: { localId: REPLACEMENT_SYNTHETIC_UID },
              description: 'Replacement Firebase identity deletion',
              allowEmpty: true,
            },
          );
        } catch {}
        const remaining = await lookupReplacementUser();
        if (remaining !== null) {
          reject('Replacement Firebase identity deletion did not converge without retry');
        }
        identityCreated = false;
        cleanupCompleted = true;
        return true;
      });
    },
  });
}
