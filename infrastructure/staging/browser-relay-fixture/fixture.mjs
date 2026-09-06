import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_ORDER,
  CONTROL_PLANE_ORIGIN,
  HOME_ID,
  PAGE_PRIVATE_INPUT_SCHEMA,
  RELAY_A_URL,
  RELAY_B_URL,
} from '../browser-relay-page/boundary.mjs';
import {
  COORDINATOR_NAME,
  FUNCTION_NAME,
  STATE_EXPECTATION_SCHEMA,
  STATE_PATH,
  SYNTHETIC_UID,
  StagingBrowserRelayFixtureError,
  validateBrowserRelayFixtureProfile,
  validateFixtureAbsence,
  validateStateExpectation,
} from './contract.mjs';

const HOME_KEY_EXCHANGE_ENDPOINT = `${CONTROL_PLANE_ORIGIN}/v1/access-tokens:exchange`;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const HOME_KEY = /^mhk1_([A-Za-z0-9_-]{22})_[A-Za-z0-9_-]{43}$/u;
const KEY_ID = /^[A-Za-z0-9_-]{22}$/u;
const DEPENDENCY_KEYS = Object.freeze([
  'createCoordinator',
  'createFirebaseIdentity',
  'createHome',
  'createHomeKey',
  'createHomeKeyAccessTokenProvider',
  'issueFirebaseCustomToken',
  'patchHomeRelay',
  'removeFixture',
  'verifyFixtureAbsent',
]);

function reject(message) {
  throw new StagingBrowserRelayFixtureError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plainObject(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function validateDependencies(value) {
  if (!exactKeys(value, DEPENDENCY_KEYS)
    || DEPENDENCY_KEYS.some((key) => typeof value[key] !== 'function')) {
    reject('Fixture controller requires the exact injected dependency boundary');
  }
  return value;
}

function validateIdentity(value) {
  if (!exactKeys(value, ['uid', 'id_token'])
    || value.uid !== SYNTHETIC_UID
    || typeof value.id_token !== 'string'
    || value.id_token.length < 64
    || value.id_token.length > 8_192
    || !JWT.test(value.id_token)) {
    reject('Synthetic Firebase identity creation returned an invalid private boundary');
  }
  return value;
}

function validateHome(value, relayUrl) {
  if (!exactKeys(value, ['home_id', 'relay_url'])
    || value.home_id !== HOME_ID
    || value.relay_url !== relayUrl) {
    reject('Synthetic Home creation returned an invalid private boundary');
  }
  return value;
}

function validateHomeKey(value) {
  if (!exactKeys(value, ['key_id', 'home_key'])
    || typeof value.key_id !== 'string'
    || !KEY_ID.test(value.key_id)
    || typeof value.home_key !== 'string'
    || value.home_key.length !== 71) {
    reject('Synthetic Home Key creation returned an invalid private boundary');
  }
  const match = HOME_KEY.exec(value.home_key);
  if (match === null || match[1] !== value.key_id) {
    reject('Synthetic Home Key creation returned mismatched private material');
  }
  return value;
}

function validateProvider(value) {
  if (!plainObject(value) || typeof value.getAccessToken !== 'function') {
    reject('MiakAPI Home Key provider boundary is invalid');
  }
  return value;
}

function validateCoordinator(value) {
  if (value === null || typeof value !== 'object'
    || typeof value.configure !== 'function'
    || typeof value.start !== 'function'
    || typeof value.stop !== 'function'
    || value.state === null || typeof value.state !== 'object'
    || typeof value.state.set !== 'function') {
    reject('MiakAPI coordinator boundary is invalid');
  }
  return value;
}

function validateReadySession(value) {
  if (!plainObject(value)
    || !Number.isSafeInteger(value.sessionId) || value.sessionId < 1
    || !Number.isSafeInteger(value.generation) || value.generation < 1
    || !Number.isSafeInteger(value.connectedAtMs) || value.connectedAtMs < 0) {
    reject('Synthetic coordinator did not reach a reviewed ready session');
  }
}

function validateAppliedReceipt(value) {
  if (!exactKeys(value, ['outcome']) || value.outcome !== 'applied') {
    reject('Synthetic state mutation did not reach an applied outcome');
  }
}

function validTarget(value) {
  return Number.isSafeInteger(value) && value >= -100 && value <= 200;
}

function validateCall(value) {
  if (!plainObject(value)
    || !plainObject(value.source)
    || value.source.kind !== 'user'
    || value.source.id !== SYNTHETIC_UID
    || !exactKeys(value.arguments, ['target'])
    || !validTarget(value.arguments.target)
    || value.idempotencyKey !== `acceptance-${value.arguments.target}`) {
    reject('Synthetic function call crossed an invalid caller boundary');
  }
  return Object.freeze({
    idempotencyKey: value.idempotencyKey,
    target: value.arguments.target,
  });
}

function tokenDigest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stateExpectation(revision, value) {
  return validateStateExpectation(Object.freeze({
    schema: STATE_EXPECTATION_SCHEMA,
    path: STATE_PATH,
    revision,
    value,
  }));
}

export function createSyntheticBrowserRelayFixture(dependenciesValue) {
  validateBrowserRelayFixtureProfile();
  const dependencies = validateDependencies(dependenciesValue);
  let lifecycle = 'idle';
  let cleanupAuthorized = false;
  let identityToken;
  let keyId;
  let coordinator;
  let provider;
  let activeCoordinator = false;
  let relayUrl = RELAY_A_URL;
  let revision = 1;
  let temperature = 20;
  const issuedTokenDigests = new Set();
  const appliedCalls = new Map();
  let nextBrowserIndex = 0;
  let mutationInFlight = false;
  let tokenIssuanceInFlight = false;

  async function stopCoordinator() {
    if (coordinator === undefined || !activeCoordinator) {
      coordinator = undefined;
      provider = undefined;
      activeCoordinator = false;
      return true;
    }
    const selected = coordinator;
    try {
      await selected.stop({ deadlineMs: 2_000 });
    } catch {
      return false;
    }
    coordinator = undefined;
    provider = undefined;
    activeCoordinator = false;
    return true;
  }

  async function mutateTemperature(value) {
    if (!validTarget(value) || coordinator === undefined || !activeCoordinator
      || mutationInFlight) {
      reject('Synthetic state mutation is invalid for the current fixture lifecycle');
    }
    let receipt;
    mutationInFlight = true;
    try {
      receipt = await coordinator.state.set([{ path: STATE_PATH, value }]);
      validateAppliedReceipt(receipt);
    } catch {
      reject('Synthetic state mutation failed at the closed coordinator boundary');
    } finally {
      mutationInFlight = false;
    }
    revision += 1;
    temperature = value;
    return stateExpectation(revision, temperature);
  }

  return Object.freeze({
    async create() {
      if (lifecycle !== 'idle') reject('Synthetic fixture may be created only once');
      lifecycle = 'checking';
      try {
        validateFixtureAbsence(await dependencies.verifyFixtureAbsent());
      } catch {
        lifecycle = 'precondition_failed';
        reject('Synthetic fixture initial absence could not be proven');
      }
      cleanupAuthorized = true;
      lifecycle = 'creating';
      let homeKey;
      try {
        const identity = validateIdentity(await dependencies.createFirebaseIdentity({
          uid: SYNTHETIC_UID,
        }));
        identityToken = identity.id_token;
        validateHome(await dependencies.createHome({
          firebase_id_token: identityToken,
          home_id: HOME_ID,
          name: 'Miakapp V4 staging browser relay',
          icon: 'house',
          relay_url: RELAY_A_URL,
        }), RELAY_A_URL);
        const createdKey = validateHomeKey(await dependencies.createHomeKey({
          firebase_id_token: identityToken,
          home_id: HOME_ID,
          label: 'Browser relay acceptance coordinator',
          scopes: ['relay:coordinator'],
        }));
        keyId = createdKey.key_id;
        homeKey = createdKey.home_key;
        provider = validateProvider(dependencies.createHomeKeyAccessTokenProvider({
          exchangeEndpoint: HOME_KEY_EXCHANGE_ENDPOINT,
          homeKey,
        }));
        homeKey = undefined;
        coordinator = validateCoordinator(dependencies.createCoordinator({
          name: COORDINATOR_NAME,
          accessTokenProvider: provider,
        }));
        const selectedCoordinator = coordinator;
        coordinator.configure({
          state: { [STATE_PATH]: temperature },
          stateAccess: [{ userId: SYNTHETIC_UID, patterns: ['acceptance.*'] }],
          events: [],
          eventAccess: [],
          functions: {
            async [FUNCTION_NAME](call) {
              const { idempotencyKey, target } = validateCall(call);
              const cached = appliedCalls.get(idempotencyKey);
              if (cached !== undefined) return cached;
              if (appliedCalls.size >= 8 || mutationInFlight) {
                reject('Synthetic function call budget or serialization boundary was exceeded');
              }
              let receipt;
              mutationInFlight = true;
              try {
                receipt = await selectedCoordinator.state.set([{ path: STATE_PATH, value: target }]);
                validateAppliedReceipt(receipt);
              } catch {
                reject('Synthetic function state mutation failed');
              } finally {
                mutationInFlight = false;
              }
              revision += 1;
              temperature = target;
              const result = Object.freeze({
                accepted: true,
                arguments: Object.freeze({ target }),
              });
              appliedCalls.set(idempotencyKey, result);
              return result;
            },
          },
        });
        activeCoordinator = true;
        validateReadySession(await coordinator.start());
        lifecycle = 'ready';
        return true;
      } catch {
        homeKey = undefined;
        lifecycle = 'creation_failed';
        reject('Synthetic fixture creation failed; reviewed cleanup is required');
      }
    },

    stateExpectation() {
      if (lifecycle !== 'ready' && lifecycle !== 'rotated') {
        reject('Synthetic state expectation is unavailable before fixture readiness');
      }
      return stateExpectation(revision, temperature);
    },

    setTemperature(value) {
      if (lifecycle !== 'ready' && lifecycle !== 'rotated') {
        reject('Synthetic state mutation is unavailable before fixture readiness');
      }
      return mutateTemperature(value);
    },

    async privateInput(browser, signal) {
      if ((lifecycle !== 'ready' && lifecycle !== 'rotated')
        || browser !== BROWSER_ORDER[nextBrowserIndex]
        || tokenIssuanceInFlight
        || (signal !== undefined && (signal === null || typeof signal !== 'object'
          || typeof signal.aborted !== 'boolean'))) {
        reject('Browser private input request is outside the reviewed sequence');
      }
      if (signal?.aborted === true) {
        reject(`Synthetic custom-token issuance was cancelled for ${browser}`);
      }
      const previousLifecycle = lifecycle;
      tokenIssuanceInFlight = true;
      let customToken;
      try {
        customToken = await dependencies.issueFirebaseCustomToken({
          uid: SYNTHETIC_UID,
          browser,
          sequence: nextBrowserIndex + 1,
          signal,
        });
      } catch {
        lifecycle = 'execution_failed';
        tokenIssuanceInFlight = false;
        reject(`Synthetic custom-token issuance failed for ${browser}`);
      }
      if (typeof customToken !== 'string'
        || customToken.length < 64
        || customToken.length > 8_192
        || !JWT.test(customToken)) {
        customToken = undefined;
        lifecycle = 'execution_failed';
        tokenIssuanceInFlight = false;
        reject(`Synthetic custom-token issuance returned an invalid boundary for ${browser}`);
      }
      const digest = tokenDigest(customToken);
      if (issuedTokenDigests.has(digest)) {
        customToken = undefined;
        lifecycle = 'execution_failed';
        tokenIssuanceInFlight = false;
        reject('Synthetic custom-token reuse was detected');
      }
      issuedTokenDigests.add(digest);
      nextBrowserIndex += 1;
      const result = Object.freeze({
        schema: PAGE_PRIVATE_INPUT_SCHEMA,
        browser,
        firebase_custom_token: customToken,
      });
      customToken = undefined;
      tokenIssuanceInFlight = false;
      lifecycle = previousLifecycle;
      return result;
    },

    async rotateRelayToB() {
      if (lifecycle !== 'ready' || identityToken === undefined || relayUrl !== RELAY_A_URL) {
        reject('Synthetic relay rotation is invalid for the current fixture lifecycle');
      }
      lifecycle = 'rotating';
      try {
        validateHome(await dependencies.patchHomeRelay({
          firebase_id_token: identityToken,
          home_id: HOME_ID,
          relay_url: RELAY_B_URL,
        }), RELAY_B_URL);
      } catch {
        lifecycle = 'rotation_failed';
        reject('Synthetic relay rotation failed; reviewed cleanup is required');
      }
      relayUrl = RELAY_B_URL;
      lifecycle = 'rotated';
      return true;
    },

    async stop() {
      if (!cleanupAuthorized) {
        reject('Synthetic coordinator cleanup is not authorized without initial absence');
      }
      if (lifecycle === 'stopped' || lifecycle === 'removed') return true;
      if (!await stopCoordinator()) {
        lifecycle = 'cleanup_failed';
        reject('Synthetic coordinator cleanup did not converge');
      }
      lifecycle = 'stopped';
      return true;
    },

    async remove() {
      if (!cleanupAuthorized) {
        reject('Synthetic fixture cleanup is not authorized without initial absence');
      }
      if (lifecycle === 'removed') {
        validateFixtureAbsence(await dependencies.verifyFixtureAbsent());
        return true;
      }
      lifecycle = 'removing';
      const coordinatorStopped = await stopCoordinator();
      let fixtureRemoved = false;
      try {
        fixtureRemoved = await dependencies.removeFixture({
          uid: SYNTHETIC_UID,
          firebase_id_token: identityToken,
          home_id: HOME_ID,
          home_key_id: keyId,
        }) === true;
      } catch {}
      identityToken = undefined;
      keyId = undefined;
      issuedTokenDigests.clear();
      appliedCalls.clear();
      nextBrowserIndex = 0;
      let absenceVerified = false;
      try {
        validateFixtureAbsence(await dependencies.verifyFixtureAbsent());
        absenceVerified = true;
      } catch {}
      if (!coordinatorStopped || !fixtureRemoved || !absenceVerified) {
        lifecycle = 'cleanup_failed';
        reject('Synthetic fixture cleanup did not converge to verified absence');
      }
      lifecycle = 'removed';
      return true;
    },

    async verifyAbsent() {
      if (lifecycle !== 'removed') {
        reject('Synthetic fixture final absence is unavailable before cleanup');
      }
      return validateFixtureAbsence(await dependencies.verifyFixtureAbsent());
    },
  });
}
