import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  StagingBrowserRelayTrustedProviderProcessError,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES,
  TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
  buildTrustedProviderProcessFailure,
  buildTrustedProviderProcessReady,
  buildTrustedProviderProcessResult,
  buildTrustedProviderProcessStartupFailure,
  cloneValidatedTrustedProviderProcessResult,
  validateTrustedProviderOwner,
  validateTrustedProviderOwnerModule,
  validateTrustedProviderProcessCancel,
  validateTrustedProviderProcessExecute,
} from './contract.mjs';
import {
  createTrustedProviderProcessFrameWriter,
  readTrustedProviderProcessFrames,
} from './framed-channel.mjs';

let requestStream;
let responseStream;
let writer;
let reader;
let state = 'starting';
let requestIdentifier;
let ownerAbortController;
let terminalStarted = false;
let operationTask;
let forcedFailureCode;

function failureCode(error, fallback) {
  if (error instanceof StagingBrowserRelayTrustedProviderProcessError) return error.code;
  return fallback;
}

function sanitizeWorkerEnvironment() {
  const keys = Object.keys(process.env);
  if (keys.length === 1 && keys[0] === '__CF_USER_TEXT_ENCODING') {
    delete process.env.__CF_USER_TEXT_ENCODING;
  }
  return Object.keys(process.env).length === 0;
}

async function finish(message, exitCode) {
  if (terminalStarted) return;
  terminalStarted = true;
  state = 'closing';
  reader?.stop();
  requestStream.destroy();
  try {
    await writer.write(message);
    await writer.end();
  } catch {
    writer.destroy();
    process.exitCode = 1;
    return;
  }
  process.exitCode = exitCode;
}

async function finishStartupFailure(code) {
  await finish(buildTrustedProviderProcessStartupFailure(code), 1);
}

function readOwnerBundle(path, expectedSha256) {
  if (typeof fsConstants.O_NOFOLLOW !== 'number') {
    throw new StagingBrowserRelayTrustedProviderProcessError('unsupported_platform');
  }
  let descriptor;
  try {
    if (realpathSync.native(path) !== path) throw new Error('owner path is not canonical');
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const entry = fstatSync(descriptor);
    if (!entry.isFile() || (entry.mode & 0o111) !== 0
      || entry.size < 1 || entry.size > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES) {
      throw new Error('invalid owner bundle');
    }
    const bytes = Buffer.allocUnsafe(entry.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (read < 1) throw new Error('truncated owner bundle');
      offset += read;
    }
    if (fstatSync(descriptor).size !== entry.size) throw new Error('owner bundle changed');
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== expectedSha256) throw new Error('owner digest mismatch');
    return bytes;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function runOwner(createOwner) {
  let owner;
  let result;
  let code;
  try {
    owner = validateTrustedProviderOwner(await createOwner());
  } catch (error) {
    code = failureCode(error, 'owner_contract_failed');
  }
  if (owner !== undefined) {
    try {
      const context = Object.freeze(Object.assign(Object.create(null), {
        signal: ownerAbortController.signal,
      }));
      result = await cloneValidatedTrustedProviderProcessResult(
        await owner.execute(context),
      );
    } catch (error) {
      code = ownerAbortController.signal.aborted
        ? 'aborted'
        : failureCode(error, 'owner_execution_failed');
    }
    try {
      await owner.close();
    } catch {
      code = 'owner_close_failed';
    }
  }
  if (forcedFailureCode !== undefined) code = forcedFailureCode;
  if (code !== undefined) {
    await finish(buildTrustedProviderProcessFailure(requestIdentifier, code), 1);
    return;
  }
  const resultMessage = await buildTrustedProviderProcessResult(requestIdentifier, result);
  if (forcedFailureCode !== undefined) {
    await finish(
      buildTrustedProviderProcessFailure(requestIdentifier, forcedFailureCode),
      1,
    );
  } else {
    await finish(resultMessage, 0);
  }
}

async function failProtocol() {
  forcedFailureCode = 'invalid_protocol';
  ownerAbortController?.abort();
  if (operationTask !== undefined) return;
  if (requestIdentifier === undefined) {
    await finishStartupFailure('invalid_protocol');
  } else {
    await finish(
      buildTrustedProviderProcessFailure(requestIdentifier, 'invalid_protocol'),
      1,
    );
  }
}

async function handleMessage(message, createOwner) {
  try {
    if (state === 'ready') {
      const request = validateTrustedProviderProcessExecute(message);
      requestIdentifier = request.request_id;
      state = 'executing';
      ownerAbortController = new AbortController();
      operationTask = runOwner(createOwner);
      void operationTask.catch(() => {
        void finish(
          buildTrustedProviderProcessFailure(requestIdentifier, 'owner_execution_failed'),
          1,
        );
      });
      return;
    }
    if (state === 'executing') {
      validateTrustedProviderProcessCancel(message, requestIdentifier);
      state = 'cancelling';
      ownerAbortController.abort();
      return;
    }
    throw new StagingBrowserRelayTrustedProviderProcessError('invalid_protocol');
  } catch {
    await failProtocol();
  }
}

async function start() {
  const [
    protocolFlag,
    protocolVersion,
    ownerPathFlag,
    ownerBundlePath,
    ownerSha256Flag,
    ownerBundleSha256,
    ...extraArguments
  ] = process.argv.slice(2);
  if (protocolFlag !== '--protocol-version'
    || protocolVersion !== String(TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION)
    || ownerPathFlag !== '--owner-bundle-path'
    || typeof ownerBundlePath !== 'string'
    || ownerSha256Flag !== '--owner-bundle-sha256'
    || typeof ownerBundleSha256 !== 'string'
    || extraArguments.length !== 0
    || process.send !== undefined
    || process.channel !== undefined
    || process.connected !== undefined
    || process.execArgv.length !== 0
    || !sanitizeWorkerEnvironment()) {
    await finishStartupFailure('invalid_protocol');
    return;
  }

  let bytes;
  try {
    bytes = readOwnerBundle(ownerBundlePath, ownerBundleSha256);
  } catch (error) {
    await finishStartupFailure(failureCode(error, 'owner_integrity_failed'));
    return;
  }

  let ownerModule;
  try {
    ownerModule = await import(`data:text/javascript;base64,${bytes.toString('base64')}`);
  } catch {
    await finishStartupFailure('owner_import_failed');
    return;
  } finally {
    bytes.fill(0);
    bytes = undefined;
  }

  let createOwner;
  try {
    createOwner = validateTrustedProviderOwnerModule(ownerModule);
  } catch {
    await finishStartupFailure('owner_contract_failed');
    return;
  }
  ownerModule = undefined;

  reader = readTrustedProviderProcessFrames(requestStream, {
    onMessage: (message) => handleMessage(message, createOwner),
    onFailure() {
      void failProtocol();
    },
    onEnd() {
      if (state === 'closing') return;
      ownerAbortController?.abort();
      process.exitCode = 1;
    },
  });
  state = 'ready';
  await writer.write(buildTrustedProviderProcessReady(ownerBundleSha256));
}

export async function runBrowserRelayTrustedProviderWorker() {
  requestStream = createReadStream(null, { autoClose: true, fd: 3 });
  responseStream = createWriteStream(null, { autoClose: true, fd: 4 });
  writer = createTrustedProviderProcessFrameWriter(responseStream);
  try {
    await start();
  } catch {
    await finishStartupFailure('peer_failed').catch(() => {});
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runBrowserRelayTrustedProviderWorker();
}
