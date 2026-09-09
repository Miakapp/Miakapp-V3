import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import {
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES,
} from '../contract.mjs';
import {
  createTrustedProviderProcessFrameWriter,
  encodeTrustedProviderProcessFrame,
  readTrustedProviderProcessFrames,
} from '../framed-channel.mjs';

function rawFrame(payload) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([header, bytes]);
}

function collect(stream) {
  const messages = [];
  let resolveOutcome;
  const outcome = new Promise((resolve) => {
    resolveOutcome = resolve;
  });
  readTrustedProviderProcessFrames(stream, {
    onMessage(message) { messages.push(message); },
    onFailure() { resolveOutcome({ state: 'failed', messages }); },
    onEnd() { resolveOutcome({ state: 'ended', messages }); },
  });
  return outcome;
}

test('reads split and coalesced canonical frames in order', async () => {
  const stream = new PassThrough();
  const outcome = collect(stream);
  const first = encodeTrustedProviderProcessFrame({ type: 'one', id: 1 });
  const second = encodeTrustedProviderProcessFrame({ type: 'two', id: 2 });
  stream.write(first.subarray(0, 2));
  stream.write(Buffer.concat([first.subarray(2), second]));
  stream.end();
  assert.deepEqual(await outcome, {
    state: 'ended',
    messages: [{ type: 'one', id: 1 }, { type: 'two', id: 2 }],
  });
});

test('rejects noncanonical, duplicate, malformed and unsafe JSON', async () => {
  const payloads = [
    '{ "type":"one"}',
    '{"type":"one","type":"two"}',
    Buffer.from([0xff]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')]),
    '{"value":"\\ud800"}',
    '{"value":9007199254740992}',
    '{"value":1.5}',
    '{"__proto__":null}',
  ];
  for (const payload of payloads) {
    const stream = new PassThrough();
    const outcome = collect(stream);
    stream.end(rawFrame(payload));
    assert.equal((await outcome).state, 'failed');
  }
});

test('rejects zero, oversized, truncated, closed, deep, token-heavy and flooded input', async () => {
  const zero = new PassThrough();
  const zeroOutcome = collect(zero);
  zero.end(Buffer.alloc(4));
  assert.equal((await zeroOutcome).state, 'failed');

  const oversized = new PassThrough();
  const oversizedOutcome = collect(oversized);
  const oversizedHeader = Buffer.alloc(4);
  oversizedHeader.writeUInt32BE(TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES + 1);
  oversized.end(oversizedHeader);
  assert.equal((await oversizedOutcome).state, 'failed');

  const truncated = new PassThrough();
  const truncatedOutcome = collect(truncated);
  truncated.end(rawFrame('{"value":true}').subarray(0, 8));
  assert.equal((await truncatedOutcome).state, 'failed');

  const closed = new PassThrough();
  const closedOutcome = collect(closed);
  closed.destroy();
  assert.equal((await closedOutcome).state, 'failed');

  let deep = null;
  for (let depth = 0; depth < 33; depth += 1) deep = [deep];
  const deepStream = new PassThrough();
  const deepOutcome = collect(deepStream);
  deepStream.end(rawFrame(JSON.stringify(deep)));
  assert.equal((await deepOutcome).state, 'failed');

  const tokenStream = new PassThrough();
  const tokenOutcome = collect(tokenStream);
  tokenStream.end(rawFrame(JSON.stringify(Array(16_385).fill(null))));
  assert.equal((await tokenOutcome).state, 'failed');

  const floodStream = new PassThrough();
  const floodOutcome = collect(floodStream);
  const empty = encodeTrustedProviderProcessFrame({});
  floodStream.end(Buffer.concat(Array(5).fill(empty)));
  assert.equal((await floodOutcome).state, 'failed');
});

test('serializes writes and waits for backpressure', async () => {
  const chunks = [];
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      setImmediate(callback);
    },
  });
  const writer = createTrustedProviderProcessFrameWriter(stream);
  await Promise.all([
    writer.write({ sequence: 1 }),
    writer.write({ sequence: 2 }),
  ]);
  await writer.end();
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks, [
    encodeTrustedProviderProcessFrame({ sequence: 1 }),
    encodeTrustedProviderProcessFrame({ sequence: 2 }),
  ]);
  await assert.rejects(writer.write({ sequence: 3 }), /closed/u);
});

test('bounds queued writes before stream memory can grow', async () => {
  const stream = new Writable({
    write(_chunk, _encoding, _callback) {
      // Intentionally retain every callback until the writer is destroyed.
    },
  });
  const writer = createTrustedProviderProcessFrameWriter(stream);
  const value = { value: 'a'.repeat(65_536) };
  const pending = [writer.write(value), writer.write(value), writer.write(value)];
  await assert.rejects(writer.write(value), /bound/u);
  writer.destroy();
  await Promise.allSettled(pending);
});

test('collapses stream errors to a bounded transport failure', async () => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('Bearer stream-secret'));
    },
  });
  const writer = createTrustedProviderProcessFrameWriter(stream);
  await assert.rejects(
    writer.write({ value: true }),
    (error) => error.message === 'frame writer failed'
      && !error.message.includes('Bearer'),
  );
});

test('rejects an active backpressured write when the stream closes without error', {
  timeout: 1_000,
}, async () => {
  const stream = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, _callback) {
      // Retain the callback to reproduce a peer closing during backpressure.
    },
  });
  const writer = createTrustedProviderProcessFrameWriter(stream);
  const pending = writer.write({ value: true });
  stream.destroy();
  await assert.rejects(pending, /frame writer failed/u);
});

test('drains queued message dispatch before reporting a later frame failure', async () => {
  const events = [];
  const stream = new PassThrough();
  let resolveOutcome;
  const outcome = new Promise((resolve) => {
    resolveOutcome = resolve;
  });
  readTrustedProviderProcessFrames(stream, {
    async onMessage() {
      events.push('dispatch-start');
      await new Promise((resolve) => setImmediate(resolve));
      events.push('dispatch-end');
    },
    onFailure() {
      events.push('failure');
      resolveOutcome('failed');
    },
    onEnd() {
      resolveOutcome('ended');
    },
  });
  stream.end(Buffer.concat([
    encodeTrustedProviderProcessFrame({ value: true }),
    rawFrame('{'),
  ]));
  assert.equal(await outcome, 'failed');
  assert.deepEqual(events, ['dispatch-start', 'dispatch-end', 'failure']);
});
