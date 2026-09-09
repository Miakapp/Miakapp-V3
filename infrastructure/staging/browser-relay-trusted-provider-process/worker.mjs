import {
  createReadStream,
  createWriteStream,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { findPackageJSON, registerHooks } from 'node:module';
import { sep } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

import {
  StagingBrowserRelayTrustedProviderProcessError,
  TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
  buildTrustedProviderProcessFailure,
  buildTrustedProviderProcessReady,
  buildTrustedProviderProcessResult,
  buildTrustedProviderProcessStartupFailure,
  cloneValidatedTrustedProviderProcessResult,
  preloadTrustedProviderProcessResultContract,
  rejectTrustedProviderProcess,
  validateTrustedProviderOwner,
  validateTrustedProviderOwnerModule,
  validateTrustedProviderProcessCancel,
  validateTrustedProviderProcessExecute,
} from './contract.mjs';
import {
  createTrustedProviderProcessFrameWriter,
  readTrustedProviderProcessFrames,
} from './framed-channel.mjs';
import { materializeTrustedProviderOwnerBundle } from './owner-bundle.mjs';

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

function registerOwnerModuleBoundary(workspace) {
  const workspacePrefix = `${workspace}${sep}`;
  const requireWorkspaceFile = (path) => {
    const canonicalPath = realpathSync.native(path);
    const entry = lstatSync(path);
    if (canonicalPath !== path || !path.startsWith(workspacePrefix)
      || !entry.isFile() || entry.isSymbolicLink()
      || (entry.mode & 0o777) !== 0o400) {
      rejectTrustedProviderProcess('owner_integrity_failed');
    }
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolution = nextResolve(specifier, context);
      if (typeof resolution?.url === 'string' && resolution.url.startsWith('node:')) {
        return resolution;
      }
      try {
        if (typeof resolution?.url !== 'string' || !resolution.url.startsWith('file:')) {
          rejectTrustedProviderProcess('owner_integrity_failed');
        }
        const moduleUrl = new URL(resolution.url);
        if (moduleUrl.search !== '' || moduleUrl.hash !== '') {
          rejectTrustedProviderProcess('owner_integrity_failed');
        }
        const modulePath = fileURLToPath(moduleUrl);
        requireWorkspaceFile(modulePath);
        const packageManifestPath = findPackageJSON(resolution.url);
        if (packageManifestPath !== undefined) requireWorkspaceFile(packageManifestPath);
      } catch {
        rejectTrustedProviderProcess('owner_integrity_failed');
      }
      return resolution;
    },
  });
}

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
    ownerWorkspaceFlag,
    ownerWorkspacePath,
    ...extraArguments
  ] = process.argv.slice(2);
  if (protocolFlag !== '--protocol-version'
    || protocolVersion !== String(TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION)
    || ownerPathFlag !== '--owner-bundle-path'
    || typeof ownerBundlePath !== 'string'
    || ownerSha256Flag !== '--owner-bundle-sha256'
    || typeof ownerBundleSha256 !== 'string'
    || ownerWorkspaceFlag !== '--owner-workspace-path'
    || typeof ownerWorkspacePath !== 'string'
    || extraArguments.length !== 0
    || process.send !== undefined
    || process.channel !== undefined
    || process.connected !== undefined
    || process.execArgv.length !== 0
    || !sanitizeWorkerEnvironment()) {
    await finishStartupFailure('invalid_protocol');
    return;
  }

  try {
    await preloadTrustedProviderProcessResultContract();
  } catch {
    await finishStartupFailure('peer_failed');
    return;
  }

  let materialized;
  try {
    materialized = materializeTrustedProviderOwnerBundle({
      owner_bundle_path: ownerBundlePath,
      owner_bundle_sha256: ownerBundleSha256,
      owner_workspace_path: ownerWorkspacePath,
    });
  } catch (error) {
    await finishStartupFailure(failureCode(error, 'owner_integrity_failed'));
    return;
  }

  let ownerModule;
  try {
    registerOwnerModuleBoundary(ownerWorkspacePath);
    ownerModule = await import(materialized.entry_url);
  } catch {
    await finishStartupFailure('owner_import_failed');
    return;
  }
  materialized = undefined;

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
