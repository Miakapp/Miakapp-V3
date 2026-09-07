import { isDeepStrictEqual } from 'node:util';

import {
  MAXIMUM_CHROMIUM_SCENARIO_MILLISECONDS,
  StagingBrowserRelayChromiumScenarioError,
  validateBrowserRelayChromiumScenarioProfile,
} from './contract.mjs';
import { runBrowserRelayChromiumScenarioInternalForTesting } from './internal.mjs';

const OPTION_FIELDS = Object.freeze([
  'clearTimer',
  'clock',
  'maximumMilliseconds',
  'setTimer',
  'signal',
]);

function reject(message) {
  throw new StagingBrowserRelayChromiumScenarioError(message);
}

function validateTestingOptions(value) {
  let prototype;
  let keys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return reject('Chromium scenario testing options must expose the exact testing boundary');
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual(keys.sort(), [...OPTION_FIELDS].sort())
    || OPTION_FIELDS.some((key) => !descriptors[key]?.enumerable
      || !Object.hasOwn(descriptors[key], 'value'))) {
    reject('Chromium scenario testing options must expose the exact testing boundary');
  }
  return Object.freeze({
    signal: descriptors.signal.value,
    timing: Object.freeze({
      clock: descriptors.clock.value,
      setTimer: descriptors.setTimer.value,
      clearTimer: descriptors.clearTimer.value,
      maximumMilliseconds: descriptors.maximumMilliseconds.value
        ?? MAXIMUM_CHROMIUM_SCENARIO_MILLISECONDS,
    }),
  });
}

export function runBrowserRelayChromiumScenarioForTesting(dependencies, options) {
  validateBrowserRelayChromiumScenarioProfile();
  return runBrowserRelayChromiumScenarioInternalForTesting(
    dependencies,
    validateTestingOptions(options),
  );
}
