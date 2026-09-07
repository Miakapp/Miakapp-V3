import { isDeepStrictEqual } from 'node:util';

import {
  MAXIMUM_CHROMIUM_SCENARIO_MILLISECONDS,
  StagingBrowserRelayChromiumScenarioError,
  validateBrowserRelayChromiumScenarioProfile,
} from './contract.mjs';
import { runBrowserRelayChromiumScenarioInternal } from './internal.mjs';

const MONOTONIC_ORIGIN = process.hrtime.bigint();

function reject(message) {
  throw new StagingBrowserRelayChromiumScenarioError(message);
}

function validateOptions(value) {
  if (value === undefined) return Object.freeze({ signal: undefined });
  let prototype;
  let keys;
  let descriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptor = Object.getOwnPropertyDescriptor(value, 'signal');
  } catch {
    return reject('Chromium scenario options are invalid');
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')
    || (keys.length !== 0 && !isDeepStrictEqual(keys, ['signal']))
    || (descriptor !== undefined
      && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')))) {
    reject('Chromium scenario options exceed the reviewed boundary');
  }
  return Object.freeze({ signal: descriptor?.value });
}

function monotonicMilliseconds() {
  const elapsed = (process.hrtime.bigint() - MONOTONIC_ORIGIN) / 1_000_000n;
  if (elapsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    reject('Chromium scenario monotonic clock exceeded its reviewed range');
  }
  return Number(elapsed);
}

function run(dependencies, pageProjectionPort, options) {
  validateBrowserRelayChromiumScenarioProfile();
  const reviewed = validateOptions(options);
  return runBrowserRelayChromiumScenarioInternal(dependencies, {
    pageProjectionPort,
    signal: reviewed.signal,
    timing: Object.freeze({
      clock: monotonicMilliseconds,
      setTimer: globalThis.setTimeout.bind(globalThis),
      clearTimer: globalThis.clearTimeout.bind(globalThis),
      maximumMilliseconds: MAXIMUM_CHROMIUM_SCENARIO_MILLISECONDS,
    }),
  });
}

export function runBrowserRelayChromiumScenario(dependencies, options) {
  return run(dependencies, undefined, options);
}

export function runBrowserRelayChromiumScenarioWithPageProjectionPort(
  dependencies,
  pageProjectionPort,
  options,
) {
  if (arguments.length < 2 || arguments.length > 3) {
    reject('Chromium scenario projection entry point has invalid arguments');
  }
  return run(dependencies, pageProjectionPort, options);
}
