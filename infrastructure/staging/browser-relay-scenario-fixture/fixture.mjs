import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  BROWSER_ORDER,
  PAGE_PRIVATE_INPUT_SCHEMA,
  validatePagePrivateInput,
} from '../browser-relay-page/boundary.mjs';
import {
  FUNCTION_NAME,
  STATE_PATH,
  SYNTHETIC_UID,
  validateFixtureAbsence,
} from '../browser-relay-fixture/contract.mjs';
import { createSyntheticBrowserRelayFixture } from '../browser-relay-fixture/fixture.mjs';
import {
  REPLACEMENT_IDENTITY_SCHEMA,
  REPLACEMENT_SYNTHETIC_UID,
  SCENARIO_ABSENCE_SCHEMA,
  SCENARIO_INPUT_ORDER,
  StagingBrowserRelayScenarioFixtureError,
  validateBrowserRelayScenarioFixtureProfile,
  validateReplacementAbsence,
  validateReplacementIdentity,
  validateScenarioAbsence,
} from './contract.mjs';

const BASE_DEPENDENCY_KEYS = Object.freeze([
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
const REPLACEMENT_DEPENDENCY_KEYS = Object.freeze([
  'createReplacementIdentity',
  'issueReplacementFirebaseCustomToken',
  'removeReplacementIdentity',
  'verifyReplacementIdentityAbsent',
]);
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

function reject(message) {
  throw new StagingBrowserRelayScenarioFixtureError(message);
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

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
}

function validateFunctionDependencies(value, keys, path) {
  const dependencies = exactKeys(value, keys, path);
  if (keys.some((key) => typeof dependencies[key] !== 'function')) {
    reject(`${path} requires the exact injected function boundary`);
  }
  return dependencies;
}

function validateCoordinator(value) {
  if (value === null || typeof value !== 'object'
    || value.state === null || typeof value.state !== 'object'
    || typeof value.state.set !== 'function'
    || typeof value.configure !== 'function'
    || typeof value.start !== 'function'
    || typeof value.stop !== 'function') {
    reject('Scenario coordinator boundary is invalid');
  }
  return value;
}

function validateBaseCoordinatorConfiguration(value) {
  const configuration = exactKeys(value, [
    'state',
    'stateAccess',
    'events',
    'eventAccess',
    'functions',
  ], 'coordinator_configuration');
  exact(configuration.state, { [STATE_PATH]: 20 }, 'coordinator_configuration.state');
  exact(configuration.stateAccess, [{
    userId: SYNTHETIC_UID,
    patterns: ['acceptance.*'],
  }], 'coordinator_configuration.stateAccess');
  exact(configuration.events, [], 'coordinator_configuration.events');
  exact(configuration.eventAccess, [], 'coordinator_configuration.eventAccess');
  if (!plainObject(configuration.functions)
    || !isDeepStrictEqual(Object.keys(configuration.functions), [FUNCTION_NAME])
    || typeof configuration.functions[FUNCTION_NAME] !== 'function') {
    reject('coordinator_configuration.functions has drifted');
  }
  return configuration;
}

function scenarioAbsence() {
  return validateScenarioAbsence({
    schema: SCENARIO_ABSENCE_SCHEMA,
    state: 'absent',
    firebase_auth_users: 0,
    public_homes: 0,
    private_homes: 0,
    home_key_records: 0,
    home_key_indexes: 0,
    control_owners: 0,
    active_coordinator_sessions: 0,
  });
}

function validateSignal(value) {
  if (value !== undefined
    && (value === null || typeof value !== 'object'
      || typeof value.aborted !== 'boolean')) {
    reject('Scenario private input received an invalid cancellation signal');
  }
  if (value?.aborted === true) reject('Scenario private input was cancelled before issuance');
}

function tokenDigest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateReplacementToken(value, browser) {
  if (typeof value !== 'string' || value.length < 64 || value.length > 8_192
    || !JWT.test(value)) {
    reject('Replacement identity returned an invalid private custom-token boundary');
  }
  return validatePagePrivateInput({
    schema: PAGE_PRIVATE_INPUT_SCHEMA,
    browser,
    firebase_custom_token: value,
  });
}

export function createSyntheticBrowserRelayScenarioFixture(
  baseDependenciesValue,
  replacementDependenciesValue,
) {
  validateBrowserRelayScenarioFixtureProfile();
  const baseDependencies = validateFunctionDependencies(
    baseDependenciesValue,
    BASE_DEPENDENCY_KEYS,
    'base_dependencies',
  );
  const replacementDependencies = validateFunctionDependencies(
    replacementDependenciesValue,
    REPLACEMENT_DEPENDENCY_KEYS,
    'replacement_dependencies',
  );
  let lifecycle = 'idle';
  let baseCleanupAuthorized = false;
  let replacementCleanupAuthorized = false;
  let replacementCreationAttempted = false;
  let nextInputIndex = 0;
  let inputIssuanceInFlight = false;
  const pageTokenDigests = new Set();

  const wrappedBaseDependencies = Object.freeze({
    ...baseDependencies,
    async verifyFixtureAbsent() {
      const result = validateFixtureAbsence(await baseDependencies.verifyFixtureAbsent());
      baseCleanupAuthorized = true;
      return result;
    },
    createCoordinator(input) {
      const coordinator = validateCoordinator(baseDependencies.createCoordinator(input));
      return Object.freeze({
        state: coordinator.state,
        configure(value) {
          const configuration = validateBaseCoordinatorConfiguration(value);
          return coordinator.configure({
            ...configuration,
            stateAccess: [
              configuration.stateAccess[0],
              {
                userId: REPLACEMENT_SYNTHETIC_UID,
                patterns: ['acceptance.*'],
              },
            ],
          });
        },
        start: (...arguments_) => coordinator.start(...arguments_),
        stop: (...arguments_) => coordinator.stop(...arguments_),
      });
    },
  });
  const baseFixture = createSyntheticBrowserRelayFixture(wrappedBaseDependencies);

  async function observeReplacementAbsence() {
    return validateReplacementAbsence(
      await replacementDependencies.verifyReplacementIdentityAbsent({
        uid: REPLACEMENT_SYNTHETIC_UID,
      }),
    );
  }

  async function verifyBothAbsent() {
    validateFixtureAbsence(await baseFixture.verifyAbsent());
    await observeReplacementAbsence();
    return scenarioAbsence();
  }

  function requiresReady() {
    if (lifecycle !== 'ready' && lifecycle !== 'rotated') {
      reject('Scenario fixture is not ready');
    }
  }

  return Object.freeze({
    async create() {
      if (lifecycle !== 'idle') reject('Scenario fixture may be created only once');
      lifecycle = 'checking';
      try {
        await observeReplacementAbsence();
      } catch {
        lifecycle = 'precondition_failed';
        reject('Replacement identity initial absence could not be proven');
      }
      replacementCleanupAuthorized = true;
      lifecycle = 'creating';
      try {
        await baseFixture.create();
        replacementCreationAttempted = true;
        validateReplacementIdentity(
          await replacementDependencies.createReplacementIdentity({
            uid: REPLACEMENT_SYNTHETIC_UID,
          }),
        );
        lifecycle = 'ready';
        return true;
      } catch {
        lifecycle = 'creation_failed';
        reject('Scenario fixture creation failed; reviewed cleanup is required');
      }
    },

    stateExpectation() {
      requiresReady();
      return baseFixture.stateExpectation();
    },

    async setTemperature(value) {
      requiresReady();
      try {
        return await baseFixture.setTemperature(value);
      } catch {
        lifecycle = 'execution_failed';
        reject('Scenario fixture state mutation failed');
      }
    },

    async privateInput(browser, identityGeneration, signal) {
      requiresReady();
      validateSignal(signal);
      const expected = SCENARIO_INPUT_ORDER[nextInputIndex];
      if (expected === undefined
        || browser !== expected.browser
        || identityGeneration !== expected.identity_generation
        || inputIssuanceInFlight) {
        reject('Scenario private input request is outside the reviewed sequence');
      }
      inputIssuanceInFlight = true;
      let input;
      try {
        if (identityGeneration === 1) {
          input = validatePagePrivateInput(await baseFixture.privateInput(browser, signal));
        } else {
          const customToken = await replacementDependencies
            .issueReplacementFirebaseCustomToken({
              uid: REPLACEMENT_SYNTHETIC_UID,
              browser,
              identity_generation: identityGeneration,
              matrix_sequence: nextInputIndex + 1,
              signal,
            });
          input = validateReplacementToken(customToken, browser);
        }
        const digest = tokenDigest(input.firebase_custom_token);
        if (pageTokenDigests.has(digest)) {
          reject('Scenario page custom-token reuse was detected');
        }
        pageTokenDigests.add(digest);
        nextInputIndex += 1;
        return input;
      } catch {
        lifecycle = 'execution_failed';
        reject('Scenario private input issuance failed at the closed boundary');
      } finally {
        input = undefined;
        inputIssuanceInFlight = false;
      }
    },

    async rotateRelayToB() {
      if (lifecycle !== 'ready') {
        reject('Scenario relay rotation is invalid for the current lifecycle');
      }
      try {
        await baseFixture.rotateRelayToB();
        lifecycle = 'rotated';
        return true;
      } catch {
        lifecycle = 'execution_failed';
        reject('Scenario relay rotation failed; reviewed cleanup is required');
      }
    },

    async stop() {
      if (!baseCleanupAuthorized && !replacementCleanupAuthorized) {
        reject('Scenario cleanup is not authorized without observed initial absence');
      }
      if (lifecycle === 'stopped' || lifecycle === 'removed') return true;
      if (baseCleanupAuthorized) {
        try {
          await baseFixture.stop();
        } catch {
          lifecycle = 'cleanup_failed';
          reject('Scenario coordinator cleanup did not converge');
        }
      }
      lifecycle = 'stopped';
      return true;
    },

    async remove() {
      if (!baseCleanupAuthorized && !replacementCleanupAuthorized) {
        reject('Scenario cleanup is not authorized without observed initial absence');
      }
      if (lifecycle === 'removed') return verifyBothAbsent();
      lifecycle = 'removing';
      let coordinatorStopped = !baseCleanupAuthorized;
      if (baseCleanupAuthorized) {
        try {
          coordinatorStopped = await baseFixture.stop() === true;
        } catch {}
      }
      let replacementRemoved = !replacementCreationAttempted;
      if (replacementCreationAttempted && replacementCleanupAuthorized && coordinatorStopped) {
        try {
          replacementRemoved = await replacementDependencies.removeReplacementIdentity({
            uid: REPLACEMENT_SYNTHETIC_UID,
          }) === true;
        } catch {}
      }
      let baseRemoved = !baseCleanupAuthorized;
      if (baseCleanupAuthorized && coordinatorStopped) {
        try {
          baseRemoved = await baseFixture.remove() === true;
        } catch {}
      }
      let replacementAbsent = false;
      try {
        await observeReplacementAbsence();
        replacementAbsent = true;
      } catch {}
      pageTokenDigests.clear();
      nextInputIndex = 0;
      if (!coordinatorStopped || !replacementRemoved || !baseRemoved || !replacementAbsent) {
        lifecycle = 'cleanup_failed';
        reject('Scenario fixture cleanup did not converge to verified absence');
      }
      try {
        await baseFixture.verifyAbsent();
      } catch {
        lifecycle = 'cleanup_failed';
        reject('Scenario fixture cleanup did not converge to verified absence');
      }
      lifecycle = 'removed';
      return scenarioAbsence();
    },

    async verifyAbsent() {
      if (lifecycle !== 'removed') {
        reject('Scenario fixture final absence is unavailable before cleanup');
      }
      return verifyBothAbsent();
    },
  });
}

export const browserRelayScenarioInputOrder = SCENARIO_INPUT_ORDER;
export const browserRelayScenarioBrowsers = BROWSER_ORDER;
export const browserRelayReplacementIdentitySchema = REPLACEMENT_IDENTITY_SCHEMA;
