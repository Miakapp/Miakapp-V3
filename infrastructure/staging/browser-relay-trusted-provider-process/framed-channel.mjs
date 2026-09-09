import { TextDecoder } from 'node:util';

import {
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAMES_PER_DIRECTION,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_DEPTH,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_TOKENS,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_QUEUED_WRITE_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_STRING_BYTES,
  rejectTrustedProviderProcess,
} from './contract.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function validateUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        rejectTrustedProviderProcess('invalid_protocol');
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      rejectTrustedProviderProcess('invalid_protocol');
    }
  }
  if (Buffer.byteLength(value, 'utf8') > TRUSTED_PROVIDER_PROCESS_MAXIMUM_STRING_BYTES) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
}

function validateJsonTree(value) {
  let tokens = 0;
  const visit = (entry, depth) => {
    tokens += 1;
    if (tokens > TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_TOKENS
      || depth > TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_DEPTH) {
      rejectTrustedProviderProcess('invalid_protocol');
    }
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'string') {
      validateUnicode(entry);
      return;
    }
    if (typeof entry === 'number') {
      if (!Number.isSafeInteger(entry)) rejectTrustedProviderProcess('invalid_protocol');
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item, depth + 1);
      return;
    }
    if (typeof entry !== 'object' || Object.getPrototypeOf(entry) !== Object.prototype) {
      rejectTrustedProviderProcess('invalid_protocol');
    }
    for (const [key, item] of Object.entries(entry)) {
      tokens += 1;
      validateUnicode(key);
      if (FORBIDDEN_OBJECT_KEYS.has(key)
        || tokens > TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_TOKENS) {
        rejectTrustedProviderProcess('invalid_protocol');
      }
      visit(item, depth + 1);
    }
  };
  visit(value, 1);
}

function parseCanonicalPayload(payload) {
  let text;
  let value;
  try {
    text = UTF8.decode(payload);
    value = JSON.parse(text);
  } catch {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  validateJsonTree(value);
  if (JSON.stringify(value) !== text) rejectTrustedProviderProcess('invalid_protocol');
  return value;
}

export function encodeTrustedProviderProcessFrame(message) {
  validateJsonTree(message);
  let text;
  try {
    text = JSON.stringify(message);
  } catch {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  if (text === undefined) rejectTrustedProviderProcess('invalid_protocol');
  const payload = Buffer.from(text, 'utf8');
  if (payload.byteLength < 1
    || payload.byteLength > TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.byteLength);
  return Buffer.concat([header, payload], header.byteLength + payload.byteLength);
}

export function createTrustedProviderProcessFrameWriter(stream) {
  let frames = 0;
  let queuedBytes = 0;
  let closed = false;
  let destroyed = false;
  let streamFailed = false;
  let failActiveWrite;
  let tail = Promise.resolve();
  const onStreamFailure = () => {
    streamFailed = true;
    failActiveWrite?.();
  };
  stream.on('error', onStreamFailure);
  stream.on('close', onStreamFailure);

  const write = (message) => {
    if (closed) return Promise.reject(new Error('frame writer is closed'));
    const frame = encodeTrustedProviderProcessFrame(message);
    frames += 1;
    if (frames > TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAMES_PER_DIRECTION
      || queuedBytes + frame.byteLength
        > TRUSTED_PROVIDER_PROCESS_MAXIMUM_QUEUED_WRITE_BYTES) {
      return Promise.reject(new Error('frame writer exceeded its bound'));
    }
    queuedBytes += frame.byteLength;
    const task = tail.then(() => new Promise((resolveWrite, rejectWrite) => {
      if (destroyed || streamFailed) {
        rejectWrite(new Error('frame writer failed'));
        return;
      }
      let callbackDone = false;
      let drainDone = false;
      let settled = false;
      const cleanup = () => {
        stream.removeListener('drain', onDrain);
        if (failActiveWrite === onError) failActiveWrite = undefined;
      };
      const settle = () => {
        if (settled || !callbackDone || !drainDone) return;
        settled = true;
        cleanup();
        resolveWrite();
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectWrite(new Error('frame writer failed'));
      };
      const onDrain = () => {
        drainDone = true;
        settle();
      };
      failActiveWrite = onError;
      let accepted;
      try {
        accepted = stream.write(frame, (error) => {
          if (error !== null && error !== undefined) {
            onError();
            return;
          }
          callbackDone = true;
          settle();
        });
      } catch {
        onError();
        return;
      }
      if (accepted) drainDone = true;
      else stream.once('drain', onDrain);
      settle();
    })).finally(() => {
      queuedBytes -= frame.byteLength;
    });
    tail = task.catch(() => {});
    return task;
  };

  const end = async () => {
    if (closed) return tail;
    closed = true;
    await tail;
    await new Promise((resolveEnd) => {
      if (stream.destroyed || stream.writableEnded) {
        resolveEnd();
        return;
      }
      stream.end(resolveEnd);
    });
  };

  const destroy = () => {
    closed = true;
    destroyed = true;
    failActiveWrite?.();
    stream.destroy();
  };

  return Object.freeze({ write, end, destroy });
}

export function readTrustedProviderProcessFrames(
  stream,
  { onMessage, onFailure, onEnd },
) {
  const header = Buffer.allocUnsafe(4);
  let headerBytes = 0;
  let payload;
  let payloadBytes = 0;
  let frames = 0;
  let stopped = false;
  let ended = false;
  let failureScheduled = false;
  let dispatch = Promise.resolve();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream.removeListener('data', onData);
    stream.removeListener('end', onStreamEnd);
    stream.removeListener('error', onStreamFailure);
    stream.removeListener('close', onStreamClose);
  };

  const fail = () => {
    if (stopped || failureScheduled) return;
    failureScheduled = true;
    stop();
    stream.destroy();
    const pendingDispatch = dispatch;
    void pendingDispatch.catch(() => {}).then(() => {
      onFailure(new Error('trusted provider process frame channel failed'));
    }).catch(() => {});
  };

  const queueMessage = (message) => {
    dispatch = dispatch.then(() => onMessage(message));
    void dispatch.catch(fail);
  };

  const onData = (chunk) => {
    if (stopped) return;
    try {
      let offset = 0;
      while (offset < chunk.byteLength) {
        if (payload === undefined) {
          const copied = Math.min(4 - headerBytes, chunk.byteLength - offset);
          chunk.copy(header, headerBytes, offset, offset + copied);
          headerBytes += copied;
          offset += copied;
          if (headerBytes !== 4) continue;
          const length = header.readUInt32BE();
          if (length < 1 || length > TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES) {
            rejectTrustedProviderProcess('invalid_protocol');
          }
          payload = Buffer.allocUnsafe(length);
          payloadBytes = 0;
        }
        const copied = Math.min(
          payload.byteLength - payloadBytes,
          chunk.byteLength - offset,
        );
        chunk.copy(payload, payloadBytes, offset, offset + copied);
        payloadBytes += copied;
        offset += copied;
        if (payloadBytes !== payload.byteLength) continue;
        frames += 1;
        if (frames > TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAMES_PER_DIRECTION) {
          rejectTrustedProviderProcess('invalid_protocol');
        }
        const message = parseCanonicalPayload(payload);
        headerBytes = 0;
        payload = undefined;
        payloadBytes = 0;
        queueMessage(message);
      }
    } catch {
      fail();
    }
  };

  const onStreamEnd = () => {
    if (stopped) return;
    ended = true;
    if (headerBytes !== 0 || payload !== undefined) {
      fail();
      return;
    }
    void dispatch.then(() => {
      if (stopped || !ended) return;
      stop();
      onEnd();
    }).catch(fail);
  };

  const onStreamFailure = () => fail();
  const onStreamClose = () => {
    if (!ended) fail();
  };
  stream.on('data', onData);
  stream.once('end', onStreamEnd);
  stream.once('error', onStreamFailure);
  stream.once('close', onStreamClose);
  return Object.freeze({ stop });
}
