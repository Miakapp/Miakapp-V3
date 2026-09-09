import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  StagingBrowserRelayTrustedProviderProcessError,
  TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
  buildTrustedProviderProcessCancel,
  buildTrustedProviderProcessExecute,
  rejectTrustedProviderProcess,
  validateTrustedProviderProcessAuthorityReady,
  validateTrustedProviderProcessExecuteInput,
  validateTrustedProviderProcessFailure,
  validateTrustedProviderProcessOptions,
  validateTrustedProviderProcessReady,
  validateTrustedProviderProcessResult,
  validateTrustedProviderProcessStartupFailure,
} from './contract.mjs';
import {
  writeTrustedProviderEphemeralAuthority,
} from './authority-channel.mjs';
import {
  createTrustedProviderProcessFrameWriter,
  readTrustedProviderProcessFrames,
} from './framed-channel.mjs';

const WORKER_PATH = fileURLToPath(new URL('worker.mjs', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const INTRINSIC_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const INTRINSIC_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const INTRINSIC_BUFFER_FILL = Buffer.prototype.fill;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;
const PROCESS_GROUP_SETTLEMENT_TIMEOUT_MILLISECONDS = 1_000;
const PROCESS_GROUP_SETTLEMENT_POLL_MILLISECONDS = 10;

function processFailure(code) {
  return new StagingBrowserRelayTrustedProviderProcessError(code);
}

function overwriteAuthority(authority) {
  try {
    Reflect.apply(INTRINSIC_BUFFER_FILL, authority, [0]);
  } catch {
    // Every caller receives only the fixed process outcome.
  }
}

function createOwnerWorkspace() {
  let workspace;
  try {
    const temporaryRoot = realpathSync.native(tmpdir());
    workspace = mkdtempSync(join(temporaryRoot, 'miakapp-provider-owner-'));
    chmodSync(workspace, 0o700);
    if (realpathSync.native(workspace) !== workspace) throw new Error('workspace is not canonical');
    return workspace;
  } catch {
    const removed = workspace === undefined || removeOwnerWorkspace(workspace);
    throw processFailure(removed ? 'peer_failed' : 'cleanup_failed');
  }
}

function removeOwnerWorkspace(workspace) {
  try {
    rmSync(workspace, { force: true, recursive: true });
    return !existsSync(workspace);
  } catch {
    return false;
  }
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

async function executeInDedicatedProcess(
  options,
  authority,
  callerSignal,
  workerPath,
  exposeCancel,
) {
  if (process.platform === 'win32' || !supportedNodeRuntime()) {
    rejectTrustedProviderProcess('unsupported_platform');
  }

  let requestIdentifier;
  try {
    requestIdentifier = randomBytes(32).toString('base64url');
  } catch {
    throw processFailure('peer_failed');
  }
  const ownerWorkspace = createOwnerWorkspace();
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
      '--owner-workspace-path',
      ownerWorkspace,
    ], {
      cwd: PACKAGE_ROOT,
      detached: true,
      env: Object.create(null),
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    throw processFailure(removeOwnerWorkspace(ownerWorkspace) ? 'peer_failed' : 'cleanup_failed');
  }

  const requestStream = child.stdio[3];
  const responseStream = child.stdio[4];
  const authorityStream = child.stdio[5];
  if (requestStream === null || requestStream === undefined
    || responseStream === null || responseStream === undefined
    || authorityStream === null || authorityStream === undefined) {
    const groupClosed = await terminateAndVerifyProcessGroup(child);
    const workspaceRemoved = groupClosed && removeOwnerWorkspace(ownerWorkspace);
    throw processFailure(groupClosed && workspaceRemoved ? 'peer_failed' : 'cleanup_failed');
  }

  const writer = createTrustedProviderProcessFrameWriter(requestStream);
  const ready = deferred();
  const authorityReady = deferred();
  const processClosed = deferred();
  const responseSettled = deferred();
  const requestClosed = deferred();
  const responseClosed = deferred();
  const authorityClosed = deferred();
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
  let authorityTransferTask;

  requestStream.once('close', requestClosed.resolve);
  responseStream.once('close', responseClosed.resolve);
  authorityStream.once('close', authorityClosed.resolve);

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
    authorityStream.destroy();
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
    authorityReady.resolve();
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
        phase = 'transferring_authority';
        ready.resolve();
        return;
      }
      if (phase === 'transferring_authority') {
        if (message?.type === 'startup_failure') {
          terminalReceived = true;
          beginShutdown(validateTrustedProviderProcessStartupFailure(message), true);
          return;
        }
        validateTrustedProviderProcessAuthorityReady(message);
        phase = 'authority_ready';
        authorityReady.resolve();
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
    authorityReady.resolve();
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

  if (failureCode === undefined && phase === 'transferring_authority') {
    authorityTransferTask = writeTrustedProviderEphemeralAuthority(
      authorityStream,
      authority,
    );
    try {
      await authorityTransferTask;
    } catch {
      beginShutdown('authority_transfer_failed', false);
    }
    await authorityReady.promise;
  }

  if (failureCode === undefined && phase === 'authority_ready') {
    clearTimeout(readyTimer);
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
  authorityStream.destroy();
  await Promise.all([
    requestClosed.promise,
    responseClosed.promise,
    authorityClosed.promise,
    authorityTransferTask?.catch(() => {}),
  ]);
  const processGroupClosed = await terminateAndVerifyProcessGroup(child);
  requestStream.unref?.();
  responseStream.unref?.();
  authorityStream.unref?.();
  child.unref();
  const workspaceRemoved = processGroupClosed && removeOwnerWorkspace(ownerWorkspace);
  if (!processGroupClosed || !workspaceRemoved) failureCode = 'cleanup_failed';
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

  const execute = (inputValue) => {
    if (closed) return Promise.reject(processFailure('closed'));
    if (used) return Promise.reject(processFailure('already_executed'));
    const { authority, signal } = validateTrustedProviderProcessExecuteInput(inputValue);
    used = true;
    if (signal !== undefined && signalAborted(signal)) {
      overwriteAuthority(authority);
      return Promise.reject(processFailure('aborted'));
    }
    operationTask = executeInDedicatedProcess(
      options,
      authority,
      signal,
      workerPath,
      (cancel) => {
        cancelOperation = cancel;
      },
    );
    void operationTask.then(
      () => overwriteAuthority(authority),
      () => overwriteAuthority(authority),
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
