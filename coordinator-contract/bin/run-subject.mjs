#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCoordinatorContractCorpus,
  replayContractCorpus,
} from '../dist/index.js';
import { readFrames, writeFrame } from './framed-channel.mjs';

const ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const UNSAFE_ERROR_CHARACTER = /[\p{Cc}\p{Cs}]/u;
const UTF8 = new TextEncoder();

const [subjectPath, ...extraArguments] = process.argv.slice(2);
if (subjectPath === undefined || extraArguments.length > 0) {
  throw new Error('Usage: run-subject.mjs <absolute-or-relative-subject-module>');
}

const send = process.send?.bind(process);
if (send === undefined) {
  throw new Error('External subject runner requires an IPC channel');
}
const runnerToken = randomBytes(32).toString('base64url');

function sendToChecker(message) {
  return new Promise((resolveSend, rejectSend) => {
    if (!process.connected) {
      rejectSend(new Error('External subject checker IPC channel is closed'));
      return;
    }
    send(message, (error) => {
      if (error === null) resolveSend();
      else rejectSend(error);
    });
  });
}

await sendToChecker({ type: 'bootstrap', token: runnerToken });
Object.defineProperty(process, 'send', {
  configurable: false,
  enumerable: false,
  value: undefined,
  writable: false,
});

function reportStage(stage) {
  return sendToChecker({ type: 'stage', stage, token: runnerToken });
}

class SubjectWorkerExit extends Error {
  constructor(code, signal) {
    super(
      signal === null
        ? `External subject worker exited with code ${code}`
        : `External subject worker terminated by ${signal}`,
    );
    this.name = 'SubjectWorkerExit';
    this.code = code;
    this.signal = signal;
  }
}

function errorFromWorker(value) {
  const message = value !== null
    && typeof value === 'object'
    && typeof value.message === 'string'
    ? value.message
    : 'External subject worker failed';
  const error = new Error(message);
  if (value !== null
    && typeof value === 'object'
    && typeof value.name === 'string') {
    error.name = value.name;
  }
  return error;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, requiredKeys) {
  if (!isPlainRecord(value)) return false;
  return Object.keys(value).length === requiredKeys.length
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}

function isSerializedError(value) {
  return hasExactKeys(value, ['name', 'message'])
    && typeof value.name === 'string'
    && ERROR_NAME.test(value.name)
    && typeof value.message === 'string'
    && !UNSAFE_ERROR_CHARACTER.test(value.message)
    && UTF8.encode(value.message).byteLength <= 4_096;
}

await reportStage('import');
const subjectWorkerPath = fileURLToPath(new URL('./run-subject-worker.mjs', import.meta.url));
const subjectWorker = spawn(process.execPath, [subjectWorkerPath, resolve(subjectPath)], {
  env: process.env,
  stdio: ['ignore', 'inherit', 'inherit', 'pipe', 'pipe'],
});
const requestStream = subjectWorker.stdio[3];
const responseStream = subjectWorker.stdio[4];

let importedSettled = false;
let resolveImported;
let rejectImported;
const imported = new Promise((resolveImport, rejectImport) => {
  resolveImported = resolveImport;
  rejectImported = rejectImport;
});
let workerFailure;
let nextRequestId = 1;
const pendingRequests = new Map();

function failWorker(error) {
  if (workerFailure !== undefined) return;
  workerFailure = error;
  if (!importedSettled) {
    importedSettled = true;
    rejectImported(error);
  }
  for (const { reject, signal, onAbort } of pendingRequests.values()) {
    signal?.removeEventListener('abort', onAbort);
    reject(error);
  }
  pendingRequests.clear();
}

subjectWorker.once('error', failWorker);
subjectWorker.once('exit', (code, signal) => {
  failWorker(new SubjectWorkerExit(code, signal));
});
requestStream.on('error', failWorker);
function handleWorkerMessage(message) {
  if (hasExactKeys(message, ['type']) && message.type === 'imported') {
    if (importedSettled) throw new Error('External subject worker imported more than once');
    importedSettled = true;
    resolveImported();
    return;
  }
  if (hasExactKeys(message, ['type', 'error'])
    && message.type === 'fatal'
    && isSerializedError(message.error)) {
    failWorker(errorFromWorker(message.error));
    return;
  }
  if (!isPlainRecord(message)
    || message.type !== 'response'
    || !Number.isSafeInteger(message.id)
    || message.id < 1
    || typeof message.ok !== 'boolean') {
    throw new TypeError('External subject worker sent an invalid response');
  }
  const request = pendingRequests.get(message.id);
  if (request === undefined) {
    throw new Error('External subject worker responded to an inactive request');
  }
  const validSuccess = message.ok === true
    && (request.method === 'observe'
      ? hasExactKeys(message, ['type', 'id', 'ok', 'value'])
      : hasExactKeys(message, ['type', 'id', 'ok']));
  const validFailure = message.ok === false
    && hasExactKeys(message, ['type', 'id', 'ok', 'error'])
    && isSerializedError(message.error);
  if (!validSuccess && !validFailure) {
    throw new TypeError('External subject worker sent a malformed hook response');
  }
  pendingRequests.delete(message.id);
  request.signal?.removeEventListener('abort', request.onAbort);
  if (message.ok === true) request.resolve(message.value);
  else request.reject(errorFromWorker(message.error));
}

const stopReadingResponses = readFrames(
  responseStream,
  handleWorkerMessage,
  failWorker,
);

function requestWorker(method, arguments_, signal) {
  if (workerFailure !== undefined) return Promise.reject(workerFailure);
  if (signal?.aborted === true) return Promise.reject(signal.reason);
  const id = nextRequestId;
  nextRequestId += 1;
  return new Promise((resolveRequest, rejectRequest) => {
    const onAbort = () => {
      void writeFrame(requestStream, { type: 'abort', id }).catch(() => {
        // The trusted replay timeout remains authoritative if the worker channel
        // closes while cancellation is being forwarded.
      });
    };
    pendingRequests.set(id, {
      onAbort,
      reject: rejectRequest,
      resolve: resolveRequest,
      signal,
      method,
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      void writeFrame(
        requestStream,
        { type: 'request', id, method, arguments: arguments_ },
      ).catch((error) => {
        const request = pendingRequests.get(id);
        if (request === undefined) return;
        pendingRequests.delete(id);
        request.signal?.removeEventListener('abort', request.onAbort);
        request.reject(error);
      });
    } catch (error) {
      pendingRequests.delete(id);
      signal?.removeEventListener('abort', onAbort);
      rejectRequest(error);
    }
  });
}

async function invokeHook(method, arguments_, signal) {
  await reportStage(method);
  return requestWorker(method, arguments_, signal);
}

function terminateSubjectWorker() {
  for (const { reject, signal, onAbort } of pendingRequests.values()) {
    signal?.removeEventListener('abort', onAbort);
    reject(new Error('External subject worker was terminated'));
  }
  pendingRequests.clear();
  stopReadingResponses();
  requestStream.destroy();
  responseStream.destroy();
  if (!subjectWorker.killed) {
    try {
      subjectWorker.kill('SIGKILL');
    } catch {
      // The worker may already have exited between the state check and signal.
    }
  }
  requestStream.unref?.();
  responseStream.unref?.();
  subjectWorker.unref();
}

let earlyCleanExit = false;
try {
  await imported;
  await reportStage('factory');
  await requestWorker('factory', []);

  const corpus = await loadCoordinatorContractCorpus();
  const processBoundedSubject = {
    reset(setup, signal) {
      return invokeHook('reset', [setup], signal);
    },
    dispatch(stimulus, signal) {
      return invokeHook('dispatch', [stimulus], signal);
    },
    observe(signal) {
      return invokeHook('observe', [], signal);
    },
  };

  const results = await replayContractCorpus(corpus, processBoundedSubject);
  terminateSubjectWorker();
  process.stdout.write(`${JSON.stringify({
    schema: corpus.schema,
    scenarios: results.length,
    status: 'conformant',
  })}\n`);
  await sendToChecker({ type: 'complete', token: runnerToken });
} catch (error) {
  if (error instanceof SubjectWorkerExit
    && error.code === 0
    && error.signal === null) {
    earlyCleanExit = true;
  } else {
    throw error;
  }
} finally {
  terminateSubjectWorker();
}

process.disconnect?.();
if (earlyCleanExit) process.exitCode = 0;
