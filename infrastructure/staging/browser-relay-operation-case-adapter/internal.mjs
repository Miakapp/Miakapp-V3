import { isDeepStrictEqual } from 'node:util';

import {
  validateClosedRunnerResult,
  validateOperationResult,
} from '../browser-relay-operation/contract.mjs';
import {
  validateOrchestratorClaimReceipt,
} from '../browser-relay-orchestrator/claim.mjs';
import {
  MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS,
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS,
  OPERATION_CASE_ADAPTER_CLAIM_RECEIPT_FIELDS,
  OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS,
  OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS,
  OPERATION_CASE_ADAPTER_ROOT_COMPONENT_FIELDS,
  OPERATION_CASE_ADAPTER_WINDOW_CONTEXT_FIELDS,
  StagingBrowserRelayOperationCaseAdapterError,
  validateBrowserRelayOperationCaseAdapterProfile,
} from './contract.mjs';

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;
const INTERNAL_ERRORS = new WeakSet();

function reject(message = 'Claim-bound browser-relay operation failed closed') {
  const error = new StagingBrowserRelayOperationCaseAdapterError(message);
  INTERNAL_ERRORS.add(error);
  throw error;
}

function adapterError(error) {
  try {
    return INTERNAL_ERRORS.has(error);
  } catch {
    return false;
  }
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function directRecord(value, fields, path) {
  try {
    if (!plainObject(value)) reject(`${path} must be one plain object`);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')
      || !isDeepStrictEqual([...keys].sort(), [...fields].sort())) {
      reject(`${path} must contain exactly the reviewed fields`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (fields.some((field) => !descriptors[field]?.enumerable
      || !Object.hasOwn(descriptors[field], 'value'))) {
      reject(`${path} fields must be direct and enumerable`);
    }
    return descriptors;
  } catch (error) {
    if (adapterError(error)) throw error;
    return reject(`${path} validation failed closed`);
  }
}

function bindMethods(value, fields, path, passthrough = []) {
  const descriptors = directRecord(value, fields, path);
  return Object.freeze(Object.fromEntries(fields.map((field) => {
    const candidate = descriptors[field].value;
    if (passthrough.includes(field)) return [field, candidate];
    if (typeof candidate !== 'function') reject(`${path}.${field} must be one function`);
    return [field, Function.prototype.bind.call(candidate, value)];
  })));
}

function validateComponents(value) {
  const root = directRecord(value, OPERATION_CASE_ADAPTER_ROOT_COMPONENT_FIELDS,
    'Claim-bound operation components');
  const operation = bindMethods(
    root.operation.value,
    OPERATION_CASE_ADAPTER_OPERATION_COMPONENT_FIELDS,
    'Claim-bound operation component surface',
    ['edgeClient'],
  );
  if (!plainObject(operation.edgeClient)) {
    reject('Claim-bound operation edge client must be one plain object');
  }
  const matrixValue = root.matrix.value;
  const matrixDescriptors = directRecord(
    matrixValue,
    OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS,
    'Claim-bound matrix component surface',
  );
  const matrix = Object.freeze(Object.fromEntries(
    OPERATION_CASE_ADAPTER_MATRIX_COMPONENT_FIELDS.map((field) => {
      const candidate = matrixDescriptors[field].value;
      if (['openChromiumPage', 'openSecondaryPage', 'prepareChromiumPhase'].includes(field)) {
        if (typeof candidate !== 'function') {
          reject(`Claim-bound matrix component ${field} must be one function`);
        }
        return [field, Function.prototype.bind.call(candidate, matrixValue)];
      }
      return [field, candidate];
    }),
  ));
  return Object.freeze({ operation, matrix });
}

function validateRunner(value, path) {
  if (typeof value !== 'function') reject(`${path} must be one function`);
  return value;
}

function signalAborted(signal) {
  try {
    if (!(signal instanceof AbortSignal)) {
      reject('Claim-bound operation context requires a genuine AbortSignal');
    }
    return ABORTED_GETTER.call(signal);
  } catch (error) {
    if (adapterError(error)) throw error;
    return reject('Claim-bound operation signal validation failed closed');
  }
}

function snapshotClaimReceipt(value, attemptedAt) {
  const descriptors = directRecord(
    value,
    OPERATION_CASE_ADAPTER_CLAIM_RECEIPT_FIELDS,
    'Claim-bound operation claim receipt',
  );
  const snapshot = Object.freeze(Object.fromEntries(
    OPERATION_CASE_ADAPTER_CLAIM_RECEIPT_FIELDS.map((field) => [
      field,
      descriptors[field].value,
    ]),
  ));
  validateOrchestratorClaimReceipt(snapshot);
  if (snapshot.attempted_at !== attemptedAt) {
    reject('Claim-bound operation receipt is not tied to this acquisition attempt');
  }
  return Object.freeze({
    generation: snapshot.generation,
    sha256: snapshot.sha256,
    attempted_at: snapshot.attempted_at,
    expires_at: snapshot.expires_at,
  });
}

function validateWindowContext(value, lineage) {
  const descriptors = directRecord(
    value,
    OPERATION_CASE_ADAPTER_WINDOW_CONTEXT_FIELDS,
    'Claim-bound operation window context',
  );
  if (!Object.isFrozen(value)) {
    reject('Claim-bound operation window context must be frozen');
  }
  const signal = descriptors.signal.value;
  const opened = descriptors.opened_at_milliseconds.value;
  const deadline = descriptors.deadline_milliseconds.value;
  const callbackDeadline = descriptors.callback_deadline_milliseconds.value;
  const attempted = Date.parse(lineage.attempted_at);
  const expires = Date.parse(lineage.expires_at);
  if ([opened, deadline, callbackDeadline, attempted, expires].some(
    (instant) => !Number.isSafeInteger(instant) || instant < 0,
  )
    || opened < attempted
    || deadline <= opened
    || callbackDeadline <= opened
    || callbackDeadline > deadline
    || deadline - opened > MAXIMUM_PUBLIC_WINDOW_MILLISECONDS
    || callbackDeadline - opened > MAXIMUM_CALLBACK_EXECUTION_MILLISECONDS
    || deadline > expires
    || callbackDeadline > expires) {
    reject('Claim-bound operation window is outside the canonical claim lifetime');
  }
  if (signalAborted(signal)) {
    reject('Claim-bound operation window was already aborted');
  }
  return Object.freeze({
    identity: value,
    signal,
    opened_at_milliseconds: opened,
    deadline_milliseconds: deadline,
    callback_deadline_milliseconds: callbackDeadline,
  });
}

function nonSerializable(target, onViolation) {
  Object.defineProperty(target, 'toJSON', {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      onViolation();
      reject('Claim-bound operation capability cannot be serialized');
    },
  });
  return Object.freeze(target);
}

function createClaimCapability(receipt) {
  const identity = Symbol('browser-relay-operation-claim');
  let activeIdentity = identity;
  let lineage = receipt;
  let window;
  let state = 'ready';
  receipt = undefined;

  function revoke() {
    activeIdentity = undefined;
    lineage = undefined;
    window = undefined;
    state = 'revoked';
  }

  function requireState(expected) {
    if (activeIdentity !== identity || lineage === undefined || state !== expected) {
      revoke();
      reject('Claim-bound operation capability is outside its reviewed lifetime');
    }
  }

  const capability = nonSerializable({
    open(context) {
      requireState('ready');
      try {
        window = validateWindowContext(context, lineage);
        state = 'window_open';
        return window.signal;
      } catch {
        revoke();
        return reject('Claim-bound operation callback context failed closed');
      }
    },
    enter(context) {
      requireState('window_open');
      try {
        const candidate = validateWindowContext(context, lineage);
        if (candidate.identity !== window.identity
          || candidate.signal !== window.signal
          || candidate.opened_at_milliseconds !== window.opened_at_milliseconds
          || candidate.deadline_milliseconds !== window.deadline_milliseconds
          || candidate.callback_deadline_milliseconds
            !== window.callback_deadline_milliseconds) {
          reject('Claim-bound operation window context identity changed before the matrix');
        }
        state = 'running';
        return window.signal;
      } catch {
        revoke();
        return reject('Claim-bound operation matrix context failed closed');
      }
    },
    complete() {
      requireState('running');
      state = 'completed';
      activeIdentity = undefined;
      lineage = undefined;
      window = undefined;
      return true;
    },
  }, revoke);

  return Object.freeze({
    capability,
    completed: () => state === 'completed' && activeIdentity === undefined
      && lineage === undefined && window === undefined,
    revoke,
  });
}

export async function runBrowserRelayClaimBoundOperationWithRunners(
  operationRunnerValue,
  matrixRunnerValue,
  componentsValue,
  optionsValue = {},
) {
  if (arguments.length < 3 || arguments.length > 4) {
    reject('Internal claim-bound operation requires its exact reviewed inputs');
  }
  let operationRunner;
  let matrixRunner;
  let components;
  try {
    validateBrowserRelayOperationCaseAdapterProfile();
    operationRunner = validateRunner(operationRunnerValue, 'Operation runner');
    matrixRunner = validateRunner(matrixRunnerValue, 'Matrix runner');
    components = validateComponents(componentsValue);
  } catch (error) {
    if (adapterError(error)) throw error;
    return reject('Claim-bound operation initialization failed closed');
  }

  let active = true;
  let protocolViolated = false;
  let claimAttempts = 0;
  let claimAcquisitions = 0;
  let windowEntries = 0;
  let matrixInvocations = 0;
  let matrixSettled = false;
  let binding;

  function failBinding(message) {
    protocolViolated = true;
    binding?.revoke();
    return reject(message);
  }

  const wrappedOperation = Object.freeze({
    ...components.operation,
    async acquireClaim(attemptedAt) {
      if (!active || protocolViolated || claimAttempts !== 0 || binding !== undefined) {
        return failBinding('Claim-bound operation permits one claim acquisition attempt');
      }
      claimAttempts += 1;
      let candidate;
      try {
        candidate = await components.operation.acquireClaim(attemptedAt);
        if (!active || protocolViolated) {
          reject('Claim acquisition settled outside the operation lifetime');
        }
        binding = createClaimCapability(snapshotClaimReceipt(candidate, attemptedAt));
        claimAcquisitions += 1;
        return candidate;
      } catch {
        return failBinding('Claim-bound operation claim acquisition failed closed');
      }
    },
    async observeWindowBaseline(context) {
      if (!active || protocolViolated || binding === undefined || claimAcquisitions !== 1
        || windowEntries !== 0) {
        return failBinding('Claim-bound operation permits one post-claim window entry');
      }
      windowEntries += 1;
      let signal;
      try {
        signal = binding.capability.open(context);
        const result = await components.operation.observeWindowBaseline(context);
        if (!active || protocolViolated || signalAborted(signal)) {
          reject('Claim-bound operation window baseline settled outside its lifetime');
        }
        return result;
      } catch {
        return failBinding('Claim-bound operation window entry failed closed');
      }
    },
    async executeBrowserMatrix(context) {
      if (!active || protocolViolated || binding === undefined || claimAcquisitions !== 1
        || windowEntries !== 1 || matrixInvocations !== 0) {
        return failBinding('Claim-bound operation permits one post-claim matrix invocation');
      }
      matrixInvocations += 1;
      let signal;
      try {
        signal = binding.capability.enter(context);
        const result = validateClosedRunnerResult(
          await matrixRunner(components.matrix, Object.freeze({ signal })),
        );
        if (!active || protocolViolated || signalAborted(signal)) {
          reject('Claim-bound browser matrix settled outside its operation lifetime');
        }
        binding.capability.complete();
        matrixSettled = true;
        return result;
      } catch {
        return failBinding('Claim-bound browser matrix failed closed');
      }
    },
  });

  try {
    const result = await operationRunner(wrappedOperation, optionsValue);
    if (!active || protocolViolated || claimAttempts !== 1 || claimAcquisitions !== 1
      || windowEntries !== 1 || matrixInvocations !== 1 || !matrixSettled
      || !binding?.completed()) {
      return failBinding('Claim-bound operation ended without one consumed matrix binding');
    }
    return validateOperationResult(result);
  } catch {
    return failBinding('Claim-bound browser-relay operation failed closed');
  } finally {
    active = false;
    binding?.revoke();
    binding = undefined;
  }
}
