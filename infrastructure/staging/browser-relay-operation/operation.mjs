import { isDeepStrictEqual } from 'node:util';

import { runSingleUseEdgeOrchestrator } from '../browser-relay-orchestrator/orchestrator.mjs';
import {
  MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  OPERATION_RESULT_SCHEMA,
  StagingBrowserRelayOperationError,
  WINDOW_RESULT_SCHEMA,
  buildClosedMatrixResult,
  evaluateOperationMonitoringSample,
  operationCaseIds,
  operationWindowCaseIds,
  validateBrowserRelayOperationProfile,
  validateClosedRunnerResult,
  validateFinalCleanup,
  validateOperationResult,
  validateOperationWindowResult,
  validateWindowBaseline,
  validateWindowCleanup,
} from './contract.mjs';

const COMPONENT_KEYS = Object.freeze([
  'acquireClaim',
  'closeRelaysPrivateReady',
  'createSyntheticFixture',
  'edgeClient',
  'executeBrowserMatrix',
  'observeClaimAbsent',
  'observeWindowBaseline',
  'openRelaysPublic',
  'publishRunner',
  'removeRunner',
  'removeSyntheticFixture',
  'removeTemporaryBindings',
  'sampleMonitoring',
  'stopSessions',
  'validateAuthorization',
  'verifyFinalCleanup',
  'verifyRunner',
  'verifyWindowCleanup',
]);

function reject(message) {
  throw new StagingBrowserRelayOperationError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateComponents(value) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...COMPONENT_KEYS].sort())
    || COMPONENT_KEYS.filter((key) => key !== 'edgeClient')
      .some((key) => typeof value[key] !== 'function')
    || !plainObject(value.edgeClient)) {
    reject('Live operation requires the exact closed component interface');
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
  if (!plainObject(options) || Object.keys(options).some((key) => !allowed.includes(key))) {
    reject('Live-operation options exceed the reviewed boundary');
  }
  const maximumPublicWindowMilliseconds = options.maximumPublicWindowMilliseconds
    ?? MAXIMUM_PUBLIC_WINDOW_MILLISECONDS;
  const maximumCallbackExecutionMilliseconds = options.maximumCallbackExecutionMilliseconds
    ?? MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS;
  if (!Number.isSafeInteger(maximumPublicWindowMilliseconds)
    || maximumPublicWindowMilliseconds < 1
    || maximumPublicWindowMilliseconds > MAXIMUM_PUBLIC_WINDOW_MILLISECONDS
    || !Number.isSafeInteger(maximumCallbackExecutionMilliseconds)
    || maximumCallbackExecutionMilliseconds < 1
    || maximumCallbackExecutionMilliseconds > maximumPublicWindowMilliseconds
    || maximumCallbackExecutionMilliseconds > MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS) {
    reject('Live-operation timing options exceed the reviewed boundary');
  }
  return Object.freeze({
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
    ...(options.clearTimer === undefined ? {} : { clearTimer: options.clearTimer }),
    maximumPublicWindowMilliseconds,
    maximumCallbackExecutionMilliseconds,
  });
}

async function requireTrue(operation, message, ...arguments_) {
  let result;
  try {
    result = await operation(...arguments_);
  } catch {
    return reject(message);
  }
  if (result !== true) reject(message);
}

async function attemptCleanup(operation, failures, name) {
  try {
    if (await operation() !== true) failures.push(name);
  } catch {
    failures.push(name);
  }
}

async function runWindow(components, context) {
  let baseline;
  let beforeMonitoring;
  let runnerResult;
  let matrixResult;
  let afterMonitoring;
  let operationFailure = false;
  let windowCleanup;
  try {
    baseline = validateWindowBaseline(await components.observeWindowBaseline(context));
    await requireTrue(
      components.createSyntheticFixture,
      'Synthetic fixture creation failed inside the claimed window',
      context,
    );
    await requireTrue(
      components.publishRunner,
      'Acceptance runner publication failed inside the claimed window',
      context,
    );
    await requireTrue(
      components.verifyRunner,
      'Acceptance runner verification failed inside the claimed window',
      context,
    );
    beforeMonitoring = evaluateOperationMonitoringSample(
      await components.sampleMonitoring('before_matrix', context),
    );
    await requireTrue(
      components.openRelaysPublic,
      'Relay public transition failed inside the claimed window',
      context,
    );
    runnerResult = validateClosedRunnerResult(
      await components.executeBrowserMatrix(context),
    );
    matrixResult = buildClosedMatrixResult(runnerResult);
    afterMonitoring = evaluateOperationMonitoringSample(
      await components.sampleMonitoring('after_matrix', context),
    );
  } catch {
    operationFailure = true;
  }

  const cleanupFailures = [];
  await attemptCleanup(components.removeRunner, cleanupFailures, 'remove_acceptance_runner');
  await attemptCleanup(components.stopSessions, cleanupFailures, 'stop_sessions');
  await attemptCleanup(
    components.closeRelaysPrivateReady,
    cleanupFailures,
    'restore_relays_private_ready',
  );
  try {
    windowCleanup = validateWindowCleanup(await components.verifyWindowCleanup());
  } catch {
    cleanupFailures.push('verify_window_cleanup');
  }
  if (cleanupFailures.length > 0) {
    reject('Live-operation public-window cleanup did not converge');
  }
  if (operationFailure || baseline === undefined || beforeMonitoring === undefined
    || runnerResult === undefined || matrixResult === undefined || afterMonitoring === undefined) {
    reject('Live-operation matrix failed after verified public-window cleanup');
  }

  return validateOperationWindowResult(Object.freeze({
    schema: WINDOW_RESULT_SCHEMA,
    state: 'matrix_succeeded_window_clean',
    baseline,
    monitoring_samples: Object.freeze([beforeMonitoring, afterMonitoring]),
    matrix_result: matrixResult,
    window_cleanup: windowCleanup,
    matrix_executions: 1,
    browser_invocations: runnerResult.browser_invocations,
    completed_case_ids: operationWindowCaseIds,
    credentials_retained: false,
    raw_cloud_responses_retained: false,
    browser_diagnostics_retained: false,
  }));
}

export async function runSingleUseBrowserRelayOperation(componentsValue, optionsValue = {}) {
  validateBrowserRelayOperationProfile();
  const components = validateComponents(componentsValue);
  const options = validateOptions(optionsValue);
  let claimAcquired = false;
  let windowEntered = false;
  let edgeResult;
  let edgeFailure = false;
  try {
    edgeResult = await runSingleUseEdgeOrchestrator({
      acquireClaim: async (attemptedAt) => {
        const receipt = await components.acquireClaim(attemptedAt);
        claimAcquired = true;
        return receipt;
      },
      duringWindow: async (context) => {
        windowEntered = true;
        return runWindow(components, context);
      },
      edgeClient: components.edgeClient,
      observeClaimAbsent: components.observeClaimAbsent,
      validateAuthorization: components.validateAuthorization,
      validateWindowResult: validateOperationWindowResult,
    }, options);
  } catch {
    edgeFailure = true;
  }

  if (!windowEntered) {
    if (!edgeFailure) reject('Live operation ended before its single callback');
    if (claimAcquired) {
      reject('Claimed live operation ended before the window callback; edge cleanup was attempted');
    }
    reject('Live operation stopped before any application mutation');
  }

  const finalCleanupFailures = [];
  await attemptCleanup(
    components.removeSyntheticFixture,
    finalCleanupFailures,
    'remove_synthetic_fixture',
  );
  await attemptCleanup(
    components.removeTemporaryBindings,
    finalCleanupFailures,
    'remove_temporary_bindings',
  );
  let finalCleanup;
  try {
    finalCleanup = validateFinalCleanup(await components.verifyFinalCleanup());
  } catch {
    finalCleanupFailures.push('verify_final_cleanup');
  }
  if (finalCleanupFailures.length > 0 || finalCleanup === undefined) {
    reject('Live operation ended without verified complete cleanup');
  }
  if (edgeFailure || edgeResult === undefined) {
    reject('Live operation failed after verified complete cleanup');
  }

  const windowResult = validateOperationWindowResult(edgeResult.callback_result);
  return validateOperationResult(Object.freeze({
    schema: OPERATION_RESULT_SCHEMA,
    state: 'completed_once_fully_clean',
    claim_creations: edgeResult.claim_creations,
    edge_window_executions: edgeResult.edge_window_executions,
    matrix_executions: windowResult.matrix_executions,
    browser_invocations: windowResult.browser_invocations,
    public_window_milliseconds: edgeResult.public_window_milliseconds,
    maximum_public_window_milliseconds: edgeResult.maximum_public_window_milliseconds,
    rollback_reconciled_failures: edgeResult.rollback_reconciled_failures,
    completed_case_ids: operationCaseIds,
    window_result: windowResult,
    final_cleanup: finalCleanup,
    credentials_retained: false,
    raw_cloud_responses_retained: false,
    browser_diagnostics_retained: false,
  }));
}
