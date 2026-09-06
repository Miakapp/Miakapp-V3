import { isDeepStrictEqual } from 'node:util';

import {
  sameStaticBoundary,
  validateCanonicalPrivateInventory,
} from '../browser-relay-edge/inventory.mjs';
import {
  runBoundedEdgeWindow,
} from '../browser-relay-edge/window.mjs';
import {
  MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  rejectOrchestratorPrivateMaterial,
  validateBrowserRelayOrchestratorProfile,
} from './contract.mjs';
import { validateOrchestratorClaimReceipt } from './claim.mjs';

const RESULT_SCHEMA = 'miakapp.staging-browser-relay-edge-orchestrator-result/1';
const MAXIMUM_CALLBACK_RESULT_BYTES = 64 * 1024;

export class StagingBrowserRelayOrchestrationError extends Error {
  constructor(message = 'Staging browser-relay edge orchestration failed') {
    super(message);
    this.name = 'StagingBrowserRelayOrchestrationError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayOrchestrationError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateComponents(value) {
  const keys = [
    'acquireClaim',
    'duringWindow',
    'edgeClient',
    'observeClaimAbsent',
    'validateAuthorization',
    'validateWindowResult',
  ];
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), keys)
    || typeof value.acquireClaim !== 'function'
    || typeof value.duringWindow !== 'function'
    || !plainObject(value.edgeClient)
    || typeof value.edgeClient.observe !== 'function'
    || typeof value.observeClaimAbsent !== 'function'
    || typeof value.validateAuthorization !== 'function'
    || typeof value.validateWindowResult !== 'function') {
    reject('Edge orchestrator requires the exact closed component interface');
  }
  return value;
}

function validateOptions(value) {
  const options = value ?? {};
  const allowed = [
    'clearTimer',
    'clock',
    'maximumCallbackExecutionMilliseconds',
    'maximumPublicWindowMilliseconds',
    'setTimer',
  ];
  if (!plainObject(options)
    || Object.keys(options).some((key) => !allowed.includes(key))) {
    reject('Edge orchestrator options exceed the reviewed boundary');
  }
  const clock = options.clock ?? Date.now;
  if (typeof clock !== 'function') reject('Edge orchestrator clock is invalid');
  return Object.freeze({
    clock,
    ...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
    ...(options.clearTimer === undefined ? {} : { clearTimer: options.clearTimer }),
    maximumPublicWindowMilliseconds:
      options.maximumPublicWindowMilliseconds ?? MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
    maximumCallbackExecutionMilliseconds:
      options.maximumCallbackExecutionMilliseconds
        ?? MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS,
  });
}

function instant(clock, path) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) reject(`${path} is invalid`);
  return value;
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (plainObject(value)) {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

function closeCallbackResult(value) {
  if (!plainObject(value)) {
    reject('Edge orchestrator callback result is not a closed object');
  }
  let bytes;
  let closed;
  try {
    const serialized = JSON.stringify(value);
    bytes = Buffer.byteLength(serialized, 'utf8');
    closed = JSON.parse(serialized);
  } catch {
    return reject('Edge orchestrator callback result is not closed JSON');
  }
  if (bytes < 2 || bytes > MAXIMUM_CALLBACK_RESULT_BYTES
    || !isDeepStrictEqual(closed, value)) {
    reject('Edge orchestrator callback result exceeds the closed JSON boundary');
  }
  rejectOrchestratorPrivateMaterial(closed, 'window_result');
  return deepFreeze(closed);
}

function validateClaimAbsence(value) {
  const expected = {
    schema: 'miakapp.staging-browser-relay-orchestrator-claim-observation/1',
    bucket: ORCHESTRATOR_CLAIM_BUCKET,
    object: ORCHESTRATOR_CLAIM_OBJECT,
    state: 'absent',
  };
  if (!isDeepStrictEqual(value, expected)) {
    reject('Atomic orchestrator claim is not exactly absent');
  }
  return value;
}

function sameClaimBaseline(before, after) {
  validateCanonicalPrivateInventory(before);
  validateCanonicalPrivateInventory(after);
  if (!isDeepStrictEqual(after, before)) {
    reject('Canonical private baseline changed while the atomic claim was acquired');
  }
  return after;
}

export async function runSingleUseEdgeOrchestrator(componentsValue, optionsValue = {}) {
  validateBrowserRelayOrchestratorProfile();
  const components = validateComponents(componentsValue);
  const options = validateOptions(optionsValue);
  let authorized;
  try {
    authorized = await components.validateAuthorization();
  } catch {
    return reject('Separate exact edge-operation authorization was rejected');
  }
  if (authorized !== true) reject('Separate exact edge-operation authorization was rejected');

  validateClaimAbsence(await components.observeClaimAbsent());
  const baseline = validateCanonicalPrivateInventory(await components.edgeClient.observe());
  const attemptedAt = new Date(instant(options.clock, 'Edge orchestrator start instant'))
    .toISOString();
  const claimReceipt = validateOrchestratorClaimReceipt(
    await components.acquireClaim(attemptedAt),
  );
  if (claimReceipt.attempted_at !== attemptedAt) {
    reject('Atomic orchestrator claim receipt is not bound to this attempt');
  }
  sameClaimBaseline(baseline, await components.edgeClient.observe());

  let callbackInvocations = 0;
  let callbackResult;
  let windowResult;
  let windowFailure = false;
  try {
    windowResult = await runBoundedEdgeWindow(
      components.edgeClient,
      baseline,
      async (context) => {
        callbackInvocations += 1;
        if (callbackInvocations !== 1) {
          reject('Edge orchestrator callback was invoked more than once');
        }
        const candidate = await components.duringWindow(context);
        callbackResult = closeCallbackResult(components.validateWindowResult(candidate));
      },
      options,
    );
  } catch {
    windowFailure = true;
  }

  let postflight;
  try {
    postflight = validateCanonicalPrivateInventory(await components.edgeClient.observe());
    sameStaticBoundary(postflight, baseline);
  } catch {
    return reject('Edge operation ended without a verified canonical-private postflight');
  }
  if (windowFailure) {
    return reject('Edge operation failed after claim; canonical-private postflight was verified');
  }
  if (callbackInvocations !== 1 || callbackResult === undefined
    || windowResult?.state !== 'completed_canonical_private') {
    reject('Edge operation completed without one closed callback result');
  }

  const result = Object.freeze({
    schema: RESULT_SCHEMA,
    state: 'completed_once_canonical_private',
    claim_generation: claimReceipt.generation,
    claim_sha256: claimReceipt.sha256,
    claim_creations: 1,
    edge_window_executions: 1,
    callback_invocations: callbackInvocations,
    public_window_milliseconds: windowResult.public_window_milliseconds,
    maximum_public_window_milliseconds: windowResult.maximum_public_window_milliseconds,
    maximum_callback_execution_milliseconds:
      windowResult.maximum_callback_execution_milliseconds,
    rollback_reconciled_failures: windowResult.rollback_reconciled_failures,
    postflight_state: postflight.state,
    callback_result: callbackResult,
    credentials_retained: false,
    raw_cloud_responses_retained: false,
    browser_diagnostics_retained: false,
  });
  rejectOrchestratorPrivateMaterial(result, 'orchestrator_result');
  return result;
}
