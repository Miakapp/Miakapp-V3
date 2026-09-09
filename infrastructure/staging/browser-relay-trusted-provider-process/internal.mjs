import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  StagingBrowserRelayTrustedProviderProcessError,
  TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
  buildTrustedProviderProcessCancel,
  buildTrustedProviderProcessExecute,
  rejectTrustedProviderProcess,
  validateTrustedProviderProcessExecuteInput,
  validateTrustedProviderProcessFailure,
  validateTrustedProviderProcessOptions,
  validateTrustedProviderProcessReady,
  validateTrustedProviderProcessResult,
  validateTrustedProviderProcessStartupFailure,
} from './contract.mjs';
import {
  createTrustedProviderProcessFrameWriter,
  readTrustedProviderProcessFrames,
} from './framed-channel.mjs';

const WORKER_PATH = fileURLToPath(new URL('worker.mjs', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;
const PROCESS_GROUP_SETTLEMENT_TIMEOUT_MILLISECONDS = 1_000;
const PROCESS_GROUP_SETTLEMENT_POLL_MILLISECONDS = 10;

function processFailure(code) {
  return new StagingBrowserRelayTrustedProviderProcessError(code);
}

function signalAborted(signal) {
  try {
    return Reflect.apply(ABORTED_GETTER, signal, []);
  } catch {
    throw processFailure('invalid_configuration');
  }
}

function killProcessGroup(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    try {
      child.kill('SIGKILL');
    } catch {
      // The close/error event remains the sole settlement authority.
    }
  }
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function terminateAndVerifyProcessGroup(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return false;
  killProcessGroup(child);
  const deadline = Date.now() + PROCESS_GROUP_SETTLEMENT_TIMEOUT_MILLISECONDS;
  while (processGroupExists(child.pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => {
      setTimeout(resolve, PROCESS_GROUP_SETTLEMENT_POLL_MILLISECONDS);
    });
  }
  return true;
}

function supportedNodeRuntime() {
  if (process.release?.name !== 'node') return false;
  const match = (process.versions?.node ?? '').match(/^(\d+)\.(\d+)\.(\d+)(?:-|$)/u);
  if (match === null) return false;
  const [, major, minor] = match.map(Number);
  return major === 22 && minor >= 22;
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({ promise, resolve: resolvePromise });
}

async function executeInDedicatedProcess(options, callerSignal, workerPath, exposeCancel) {
  if (process.platform === 'win32' || !supportedNodeRuntime()) {
    rejectTrustedProviderProcess('unsupported_platform');
  }

  let requestIdentifier;
  try {
    requestIdentifier = randomBytes(32).toString('base64url');
  } catch {
    throw processFailure('peer_failed');
  }
  let child;
  try {
    child = spawn(process.execPath, [
      workerPath,
      '--protocol-version',
      String(TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION),
      '--owner-bundle-path',
      options.owner_bundle_path,
      '--owner-bundle-sha256',
      options.owner_bundle_sha256,
    ], {
      cwd: PACKAGE_ROOT,
      detached: true,
      env: Object.create(null),
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    throw processFailure('peer_failed');
  }

  const requestStream = child.stdio[3];
  const responseStream = child.stdio[4];
  if (requestStream === null || responseStream === null) {
    const groupClosed = await terminateAndVerifyProcessGroup(child);
    throw processFailure(groupClosed ? 'peer_failed' : 'cleanup_failed');
  }

  const writer = createTrustedProviderProcessFrameWriter(requestStream);
  const ready = deferred();
  const processClosed = deferred();
  const responseSettled = deferred();
  const requestClosed = deferred();
  const responseClosed = deferred();
  let phase = 'starting';
  let failureCode;
  let result;
  let childExitCode;
  let childExitSignal;
  let terminalReceived = false;
  let cancellationTimer;
  let readyTimer;
  let operationTimer;
  let totalTimer;
  let reader;
  let requestSent = false;
  let cancelSent = false;

  requestStream.once('close', requestClosed.resolve);
  responseStream.once('close', responseClosed.resolve);

  const clearTimers = () => {
    clearTimeout(cancellationTimer);
    clearTimeout(readyTimer);
    clearTimeout(operationTimer);
    clearTimeout(totalTimer);
  };

  const forceTermination = () => {
    killProcessGroup(child);
  };

  const beginShutdown = (code, cooperative) => {
    if (failureCode === undefined
      || (code === 'invalid_protocol' && !['aborted', 'closed'].includes(failureCode))) {
      failureCode = code;
    }
    if (phase === 'closed') return;
    phase = 'cancelling';
    clearTimeout(readyTimer);
    clearTimeout(operationTimer);
    if (cooperative && requestSent && !terminalReceived && !cancelSent) {
      cancelSent = true;
      void writer.write(buildTrustedProviderProcessCancel(requestIdentifier)).catch(() => {});
    }
    if (cancellationTimer === undefined) {
      cancellationTimer = setTimeout(
        forceTermination,
        cooperative ? options.cancellation_grace_milliseconds : 0,
      );
    }
    ready.resolve();
  };

  exposeCancel((code = 'closed') => beginShutdown(code, true));

  const onCallerAbort = () => beginShutdown('aborted', true);
  if (callerSignal !== undefined) {
    Reflect.apply(INTRINSIC_ADD_EVENT_LISTENER, callerSignal, [
      'abort',
      onCallerAbort,
      { once: true },
    ]);
  }

  const handleMessage = async (message) => {
    try {
      if (phase === 'starting') {
        if (message?.type === 'startup_failure') {
          terminalReceived = true;
          beginShutdown(validateTrustedProviderProcessStartupFailure(message), true);
          return;
        }
        validateTrustedProviderProcessReady(message, options.owner_bundle_sha256);
        phase = 'ready';
        clearTimeout(readyTimer);
        ready.resolve();
        return;
      }
      if (phase !== 'executing' && phase !== 'cancelling') {
        beginShutdown('invalid_protocol', false);
        return;
      }
      if (terminalReceived) {
        beginShutdown('invalid_protocol', false);
        return;
      }
      if (message?.type === 'result') {
        const candidate = await validateTrustedProviderProcessResult(
          message,
          requestIdentifier,
        );
        terminalReceived = true;
        if (failureCode === undefined) result = candidate;
      } else if (message?.type === 'failure') {
        const code = validateTrustedProviderProcessFailure(message, requestIdentifier);
        terminalReceived = true;
        beginShutdown(code, true);
      } else {
        beginShutdown('invalid_protocol', false);
        return;
      }
      clearTimeout(operationTimer);
      void writer.end().catch(() => {});
      if (failureCode === undefined) phase = 'settling';
    } catch {
      beginShutdown('invalid_protocol', false);
    }
  };

  reader = readTrustedProviderProcessFrames(responseStream, {
    onMessage: handleMessage,
    onFailure() {
      beginShutdown('invalid_protocol', false);
      responseSettled.resolve();
    },
    onEnd() {
      if (!terminalReceived && phase !== 'closed') beginShutdown('peer_closed', false);
      responseSettled.resolve();
    },
  });

  child.once('error', () => beginShutdown('peer_failed', false));
  child.once('close', (code, signal) => {
    childExitCode = code;
    childExitSignal = signal;
    processClosed.resolve();
    ready.resolve();
  });

  readyTimer = setTimeout(
    () => beginShutdown('ready_timeout', true),
    options.ready_timeout_milliseconds,
  );
  totalTimer = setTimeout(
    () => beginShutdown('operation_timeout', false),
    options.ready_timeout_milliseconds
      + options.operation_timeout_milliseconds
      + options.cancellation_grace_milliseconds
      + 1_000,
  );

  if (callerSignal !== undefined && signalAborted(callerSignal)) {
    beginShutdown('aborted', true);
  }
  await ready.promise;

  if (failureCode === undefined && phase === 'ready') {
    phase = 'executing';
    requestSent = true;
    try {
      await writer.write(buildTrustedProviderProcessExecute(requestIdentifier));
    } catch {
      beginShutdown('invalid_protocol', false);
    }
    if (failureCode === undefined) {
      operationTimer = setTimeout(
        () => beginShutdown('operation_timeout', true),
        options.operation_timeout_milliseconds,
      );
    }
  }

  if (failureCode !== undefined && cancellationTimer === undefined) {
    beginShutdown(failureCode, true);
  }
  await Promise.all([processClosed.promise, responseSettled.promise]);
  phase = 'closed';
  clearTimers();
  if (callerSignal !== undefined) {
    Reflect.apply(INTRINSIC_REMOVE_EVENT_LISTENER, callerSignal, [
      'abort',
      onCallerAbort,
    ]);
  }
  reader.stop();
  writer.destroy();
  responseStream.destroy();
  await Promise.all([requestClosed.promise, responseClosed.promise]);
  const processGroupClosed = await terminateAndVerifyProcessGroup(child);
  requestStream.unref?.();
  responseStream.unref?.();
  child.unref();
  if (!processGroupClosed) failureCode = 'cleanup_failed';
  if (failureCode === undefined
    && (!terminalReceived || result === undefined
      || childExitCode !== 0 || childExitSignal !== null)) {
    failureCode = 'peer_closed';
  }
  if (failureCode !== undefined) throw processFailure(failureCode);
  return result;
}

export function createBrowserRelayTrustedProviderProcessInternal(
  optionsValue,
  workerPath = WORKER_PATH,
) {
  const options = validateTrustedProviderProcessOptions(optionsValue);
  if (typeof workerPath !== 'string' || !workerPath.startsWith('/')) {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  let used = false;
  let closed = false;
  let operationTask;
  let cancelOperation;

  const execute = (inputValue = {}) => {
    if (closed) return Promise.reject(processFailure('closed'));
    if (used) return Promise.reject(processFailure('already_executed'));
    const { signal } = validateTrustedProviderProcessExecuteInput(inputValue);
    used = true;
    if (signal !== undefined && signalAborted(signal)) {
      return Promise.reject(processFailure('aborted'));
    }
    operationTask = executeInDedicatedProcess(
      options,
      signal,
      workerPath,
      (cancel) => {
        cancelOperation = cancel;
      },
    );
    return operationTask;
  };

  const close = async () => {
    if (closed && operationTask === undefined) return;
    closed = true;
    cancelOperation?.('closed');
    try {
      await operationTask;
    } catch {
      // Public close proves settlement and deliberately hides operation outcome.
    } finally {
      cancelOperation = undefined;
      operationTask = undefined;
    }
  };

  return Object.freeze(Object.assign(Object.create(null), { execute, close }));
}
