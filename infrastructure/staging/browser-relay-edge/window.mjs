import {
  sameStaticBoundary,
  validateCanonicalPrivateInventory,
  validateEdgeInventoryState,
} from './inventory.mjs';
import { EDGE_PROFILE } from './runtime.mjs';

export const MAXIMUM_PUBLIC_WINDOW_MILLISECONDS = 1_200_000;
export const MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS = 900_000;

export class StagingBrowserRelayEdgeWindowError extends Error {
  constructor(message = 'Staging browser-relay edge window failed') {
    super(message);
    this.name = 'StagingBrowserRelayEdgeWindowError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayEdgeWindowError(message);
}

function validateClient(client) {
  if (client === null || typeof client !== 'object'
    || typeof client.observe !== 'function'
    || typeof client.setRuntimeProfile !== 'function'
    || typeof client.setIngress !== 'function'
    || typeof client.setPublicInvoker !== 'function'
    || typeof client.closeIngress !== 'function') {
    reject('Browser-relay edge window requires the closed Cloud client interface');
  }
  return client;
}

function validateClock(clock) {
  if (typeof clock !== 'function') reject('Browser-relay edge window clock is invalid');
  return clock;
}

function now(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) {
    reject('Browser-relay edge window clock returned an invalid instant');
  }
  return value;
}

function validateStaticState(value, baseline) {
  sameStaticBoundary(value, baseline);
  return value;
}

export async function transitionEdgeToPublic(clientValue, baselineValue, options = {}) {
  const client = validateClient(clientValue);
  const baseline = validateCanonicalPrivateInventory(baselineValue);
  const clock = validateClock(options.clock ?? Date.now);
  const observed = await client.observe();
  validateCanonicalPrivateInventory(observed);
  validateStaticState(observed, baseline);
  if (observed.function.revision !== baseline.function.revision
    || observed.function.update_time !== baseline.function.update_time
    || observed.iam.etag !== baseline.iam.etag) {
    reject('Canonical edge baseline changed after planning');
  }

  const edgePrivate = validateStaticState(
    await client.setRuntimeProfile(observed, EDGE_PROFILE),
    baseline,
  );
  validateEdgeInventoryState(edgePrivate, 'edge_private');

  const ingressReady = validateStaticState(
    await client.setIngress(edgePrivate, 'ALLOW_ALL'),
    baseline,
  );
  validateEdgeInventoryState(ingressReady, 'edge_ingress_ready');

  const openedAtMilliseconds = now(clock);
  const publicState = validateStaticState(
    await client.setPublicInvoker(ingressReady, true),
    baseline,
  );
  validateEdgeInventoryState(publicState, 'edge_public');
  return Object.freeze({
    baseline,
    public_state: publicState,
    opened_at_milliseconds: openedAtMilliseconds,
  });
}

async function refresh(client, baseline, options = {}) {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3
    || typeof sleep !== 'function') {
    return reject('Browser-relay edge rollback observation policy is invalid');
  }
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await client.observe();
      return validateStaticState(value, baseline);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(2_000);
    }
  }
  throw lastError;
}

export async function rollbackEdgeToCanonical(clientValue, baselineValue, options = {}) {
  const client = validateClient(clientValue);
  const baseline = validateCanonicalPrivateInventory(baselineValue);
  const reconciledFailures = [];
  const refreshOptions = {
    attempts: options.observationAttempts ?? 3,
    sleep: options.sleep,
  };
  const emergencyClose = async () => {
    try {
      await client.closeIngress();
      reconciledFailures.push('emergency-private-ingress');
    } catch {
      reconciledFailures.push('emergency-private-ingress-failed');
    }
  };
  let current;
  try {
    current = await refresh(client, baseline, refreshOptions);
  } catch {
    reconciledFailures.push('initial-inventory-observation');
    await emergencyClose();
    current = await refresh(client, baseline, refreshOptions);
  }

  const attempt = async (stage, operation) => {
    try {
      current = validateStaticState(await operation(current), baseline);
    } catch {
      reconciledFailures.push(stage);
      try {
        current = await refresh(client, baseline, refreshOptions);
      } catch {
        await emergencyClose();
        current = await refresh(client, baseline, refreshOptions);
      }
    }
  };

  if (current.iam.unauthenticated_invokers === 1) {
    await attempt('public-invoker-removal-first-pass', (expected) => (
      client.setPublicInvoker(expected, false)
    ));
  }
  if (current.function.ingress === 'ALLOW_ALL') {
    await attempt('private-ingress-restoration', (expected) => (
      client.setIngress(expected, 'ALLOW_INTERNAL_ONLY')
    ));
  }
  if (current.iam.unauthenticated_invokers === 1) {
    await attempt('public-invoker-removal-second-pass', (expected) => (
      client.setPublicInvoker(expected, false)
    ));
  }
  if (current.function.runtime_profile === EDGE_PROFILE) {
    if (current.function.ingress !== 'ALLOW_INTERNAL_ONLY') {
      return reject('Edge runtime cannot roll back before private ingress converges');
    }
    await attempt('canonical-runtime-restoration', (expected) => (
      client.setRuntimeProfile(expected, 'canonical')
    ));
  }

  current = await refresh(client, baseline, refreshOptions);
  validateCanonicalPrivateInventory(current);
  return Object.freeze({
    state: 'canonical_private',
    final_inventory: current,
    reconciled_failures: Object.freeze([...reconciledFailures]),
  });
}

export async function runBoundedEdgeWindow(
  clientValue,
  baselineValue,
  duringWindow,
  options = {},
) {
  const client = validateClient(clientValue);
  const baseline = validateCanonicalPrivateInventory(baselineValue);
  if (typeof duringWindow !== 'function') {
    reject('Browser-relay edge window requires one bounded callback');
  }
  const clock = validateClock(options.clock ?? Date.now);
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const maximum = options.maximumPublicWindowMilliseconds
    ?? MAXIMUM_PUBLIC_WINDOW_MILLISECONDS;
  const callbackMaximum = options.maximumCallbackExecutionMilliseconds
    ?? Math.min(maximum, MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS);
  if (!Number.isSafeInteger(maximum) || maximum <= 0
    || maximum > MAXIMUM_PUBLIC_WINDOW_MILLISECONDS
    || !Number.isSafeInteger(callbackMaximum) || callbackMaximum <= 0
    || callbackMaximum > maximum
    || callbackMaximum > MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS
    || typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    reject('Browser-relay edge public-window bound is invalid');
  }

  let transition;
  try {
    transition = await transitionEdgeToPublic(client, baseline, { clock });
  } catch {
    try {
      await rollbackEdgeToCanonical(client, baseline);
    } catch {
      return reject('Edge transition failed and automatic rollback did not converge');
    }
    return reject('Edge transition failed and automatic rollback restored the canonical boundary');
  }

  const deadlineMilliseconds = transition.opened_at_milliseconds + maximum;
  const callbackDeadlineMilliseconds = transition.opened_at_milliseconds + callbackMaximum;
  const controller = new AbortController();
  let timer;
  let windowFailure = null;
  try {
    const remaining = Math.max(0, callbackDeadlineMilliseconds - now(clock));
    const deadline = new Promise((_, rejectDeadline) => {
      timer = setTimer(() => {
        controller.abort(new StagingBrowserRelayEdgeWindowError(
          'Browser-relay edge callback reached its execution deadline',
        ));
        rejectDeadline(new StagingBrowserRelayEdgeWindowError(
          'Browser-relay edge callback reached its execution deadline',
        ));
      }, remaining);
    });
    await Promise.race([
      Promise.resolve(duringWindow(Object.freeze({
        signal: controller.signal,
        opened_at_milliseconds: transition.opened_at_milliseconds,
        deadline_milliseconds: deadlineMilliseconds,
        callback_deadline_milliseconds: callbackDeadlineMilliseconds,
      }))),
      deadline,
    ]);
  } catch (error) {
    windowFailure = error;
  } finally {
    if (timer !== undefined) clearTimer(timer);
    if (!controller.signal.aborted) controller.abort();
  }

  let rollback;
  try {
    rollback = await rollbackEdgeToCanonical(client, baseline);
  } catch {
    return reject('Browser-relay edge rollback did not restore the canonical private boundary');
  }
  if (windowFailure !== null) {
    return reject('Browser-relay edge callback failed or expired; rollback restored the canonical boundary');
  }
  const closedAtMilliseconds = now(clock);
  const publicWindowMilliseconds = Math.max(
    0,
    closedAtMilliseconds - transition.opened_at_milliseconds,
  );
  if (publicWindowMilliseconds > maximum) {
    return reject('Browser-relay edge exceeded its public deadline; rollback restored the canonical boundary');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-edge-window-result/1',
    state: 'completed_canonical_private',
    opened_at_milliseconds: transition.opened_at_milliseconds,
    closed_at_milliseconds: closedAtMilliseconds,
    public_window_milliseconds: publicWindowMilliseconds,
    maximum_public_window_milliseconds: maximum,
    maximum_callback_execution_milliseconds: callbackMaximum,
    rollback_reconciled_failures: rollback.reconciled_failures.length,
  });
}
