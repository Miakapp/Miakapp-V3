import { isDeepStrictEqual } from 'node:util';

import {
  CONTROL_PLANE_ORIGIN,
} from '../browser-relay-page/boundary.mjs';
import {
  COORDINATOR_NAME,
} from '../browser-relay-fixture/contract.mjs';
import { validateBrowserRelayFixtureMiakApiProfile } from './contract.mjs';
import {
  createCoordinator as createVendoredCoordinator,
  createHomeKeyAccessTokenProvider as createVendoredHomeKeyAccessTokenProvider,
} from './vendor/miakapi-node-v4.mjs';

const EXCHANGE_ENDPOINT = `${CONTROL_PLANE_ORIGIN}/v1/access-tokens:exchange`;
const HOME_KEY = /^mhk1_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$/u;
const FACTORY_KEYS = Object.freeze([
  'createCoordinator',
  'createHomeKeyAccessTokenProvider',
]);

export class StagingBrowserRelayFixtureMiakApiError extends Error {
  constructor(message = 'Staging browser-relay MiakAPI binding is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayFixtureMiakApiError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayFixtureMiakApiError(message);
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

function canonicalHomeKey(value) {
  if (typeof value !== 'string' || value.length !== 71) {
    reject('MiakAPI binding received an invalid Home Key');
  }
  const match = HOME_KEY.exec(value);
  if (match === null
    || Buffer.from(match[1], 'base64url').byteLength !== 16
    || Buffer.from(match[1], 'base64url').toString('base64url') !== match[1]
    || Buffer.from(match[2], 'base64url').byteLength !== 32
    || Buffer.from(match[2], 'base64url').toString('base64url') !== match[2]) {
    reject('MiakAPI binding received an invalid Home Key');
  }
  return value;
}

function validateProvider(value) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value), ['getAccessToken'])
    || typeof value.getAccessToken !== 'function') {
    reject('Vendored MiakAPI returned an invalid Home Key provider');
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
    reject('Vendored MiakAPI returned an invalid coordinator');
  }
  return value;
}

function invokeFactory(factory, input, description) {
  try {
    return factory(input);
  } catch {
    return reject(`${description} failed inside the pinned MiakAPI bundle`);
  }
}

export function createPinnedMiakApiFixtureFactories(dependencyValue) {
  validateBrowserRelayFixtureMiakApiProfile();
  const dependencies = exactKeys(dependencyValue, ['fetch'], 'miakapi_binding_dependencies');
  if (typeof dependencies.fetch !== 'function') {
    reject('MiakAPI binding requires one explicit HTTP transport');
  }
  const injectedFetch = (input, init) => dependencies.fetch(input, init);
  let provider;
  let providerAttempted = false;
  let coordinatorAttempted = false;

  const factories = {
    createHomeKeyAccessTokenProvider(input) {
      exactKeys(input, ['exchangeEndpoint', 'homeKey'], 'miakapi_home_key_provider');
      if (providerAttempted || input.exchangeEndpoint !== EXCHANGE_ENDPOINT) {
        reject('MiakAPI Home Key provider creation is outside the reviewed boundary');
      }
      providerAttempted = true;
      canonicalHomeKey(input.homeKey);
      provider = validateProvider(invokeFactory(
        createVendoredHomeKeyAccessTokenProvider,
        {
          exchangeEndpoint: EXCHANGE_ENDPOINT,
          homeKey: input.homeKey,
          fetch: injectedFetch,
        },
        'MiakAPI Home Key provider creation',
      ));
      return provider;
    },

    createCoordinator(input) {
      exactKeys(input, ['accessTokenProvider', 'name'], 'miakapi_coordinator');
      if (coordinatorAttempted
        || provider === undefined
        || input.accessTokenProvider !== provider
        || input.name !== COORDINATOR_NAME) {
        reject('MiakAPI coordinator creation is outside the reviewed boundary');
      }
      coordinatorAttempted = true;
      return validateCoordinator(invokeFactory(
        createVendoredCoordinator,
        {
          name: COORDINATOR_NAME,
          accessTokenProvider: provider,
        },
        'MiakAPI coordinator creation',
      ));
    },
  };
  if (!isDeepStrictEqual(Object.keys(factories).sort(), [...FACTORY_KEYS].sort())) {
    reject('MiakAPI binding factory surface has drifted');
  }
  return Object.freeze(factories);
}
