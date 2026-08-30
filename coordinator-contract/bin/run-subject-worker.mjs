#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFrames, writeFrame } from './framed-channel.mjs';

const [subjectPath, ...extraArguments] = process.argv.slice(2);
if (subjectPath === undefined || extraArguments.length > 0) {
  throw new Error('Usage: run-subject-worker.mjs <absolute-or-relative-subject-module>');
}

const requestStream = createReadStream(null, { fd: 3, autoClose: false });
const responseStream = createWriteStream(null, { fd: 4, autoClose: false });

function serializedError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'Error', message: String(error) };
}

function sendMessage(message) {
  return writeFrame(responseStream, message);
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

let subjectModule;
let subject;
const controllers = new Map();

async function handleRequest(message) {
  if (hasExactKeys(message, ['type', 'id'])
    && message.type === 'abort'
    && Number.isSafeInteger(message.id)
    && message.id > 0) {
    controllers.get(message.id)?.abort(new Error('External subject hook was cancelled'));
    return;
  }
  if (!hasExactKeys(message, ['type', 'id', 'method', 'arguments'])
    || message.type !== 'request'
    || !Number.isSafeInteger(message.id)
    || message.id < 1
    || !Array.isArray(message.arguments)) {
    throw new TypeError('External subject worker received an invalid request');
  }

  try {
    if (message.method === 'factory') {
      if (message.arguments.length !== 0 || subject !== undefined) {
        throw new Error('Subject factory request is invalid or duplicated');
      }
      subject = await subjectModule.createCoordinatorContractSubject();
      if (subject === null
        || typeof subject !== 'object'
        || typeof subject.reset !== 'function'
        || typeof subject.dispatch !== 'function'
        || typeof subject.observe !== 'function') {
        throw new TypeError(
          'createCoordinatorContractSubject() must return reset, dispatch, and observe hooks',
        );
      }
      await sendMessage({ type: 'response', id: message.id, ok: true });
      return;
    }

    const expectedArguments = message.method === 'observe' ? 0 : 1;
    if (!['reset', 'dispatch', 'observe'].includes(message.method)
      || message.arguments.length !== expectedArguments
      || subject === undefined) {
      throw new TypeError('External subject worker received an invalid hook request');
    }
    const controller = new AbortController();
    controllers.set(message.id, controller);
    try {
      const value = await subject[message.method](...message.arguments, controller.signal);
      await sendMessage({
        type: 'response',
        id: message.id,
        ok: true,
        ...(message.method === 'observe' ? { value } : {}),
      });
    } finally {
      controllers.delete(message.id);
    }
  } catch (error) {
    await sendMessage({
      type: 'response',
      id: message.id,
      ok: false,
      error: serializedError(error),
    });
  }
}

function failProtocol(error) {
  void sendMessage({ type: 'fatal', error: serializedError(error) })
    .catch(() => {})
    .finally(() => {
      process.exitCode = 1;
      requestStream.destroy();
      responseStream.end();
    });
}

readFrames(
  requestStream,
  (message) => {
    void handleRequest(message).catch(failProtocol);
  },
  failProtocol,
);

try {
  const moduleUrl = pathToFileURL(resolve(subjectPath)).href;
  subjectModule = await import(moduleUrl);
  if (typeof subjectModule.createCoordinatorContractSubject !== 'function') {
    throw new TypeError(
      'Subject module must export createCoordinatorContractSubject()',
    );
  }
  await sendMessage({ type: 'imported' });
} catch (error) {
  await sendMessage({ type: 'fatal', error: serializedError(error) }).catch(() => {});
  process.exitCode = 1;
  requestStream.destroy();
  responseStream.end();
}
