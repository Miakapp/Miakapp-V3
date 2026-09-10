import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import {
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_AUTHORITY_BYTES,
} from '../contract.mjs';
import {
  claimTrustedProviderEphemeralAuthority,
  createTrustedProviderEphemeralAuthorityCapability,
  readTrustedProviderEphemeralAuthority,
  writeTrustedProviderEphemeralAuthority,
} from '../authority-channel.mjs';

const MAGIC = Buffer.from('MIAKAUT1', 'ascii');

function errorCode(code) {
  return (error) => error?.code === code && !error.message.includes('Bearer');
}

function allZero(bytes) {
  return bytes.every((byte) => byte === 0);
}

function envelope(payload, { length = payload.byteLength, magic = MAGIC } = {}) {
  const header = Buffer.alloc(12);
  magic.copy(header);
  header.writeUInt32BE(length, 8);
  return Buffer.concat([header, payload]);
}

test('claims one private copy and immediately overwrites the caller Buffer', () => {
  const source = Buffer.from([0, 1, 2, 3, 254, 255]);
  const expected = Buffer.from(source);
  const authority = claimTrustedProviderEphemeralAuthority(source);
  assert.deepEqual(authority, expected);
  assert.notEqual(authority, source);
  assert.equal(allZero(source), true);
  assert.throws(
    () => claimTrustedProviderEphemeralAuthority(source),
    errorCode('invalid_configuration'),
  );
  authority.fill(0);

  const shadowed = Buffer.from([4, 5, 6, 7]);
  Object.defineProperty(shadowed, 'byteLength', { value: 0 });
  Object.defineProperty(shadowed, 'length', { value: 0 });
  const shadowedAuthority = claimTrustedProviderEphemeralAuthority(shadowed);
  assert.deepEqual([...shadowedAuthority], [4, 5, 6, 7]);
  assert.equal(allZero(shadowed), true);
  shadowedAuthority.fill(0);
});

test('rejects invalid authority storage and clears owned invalid Buffer views', () => {
  assert.throws(
    () => claimTrustedProviderEphemeralAuthority('Bearer caller-secret'),
    errorCode('invalid_configuration'),
  );
  const empty = Buffer.alloc(0);
  Object.defineProperty(empty, 'byteLength', { value: 32 });
  const oversized = Buffer.alloc(TRUSTED_PROVIDER_PROCESS_MAXIMUM_AUTHORITY_BYTES + 1, 0xa5);
  Object.defineProperty(oversized, 'byteLength', { value: 1 });
  Object.defineProperty(oversized, 'length', { value: 0 });
  for (const source of [empty, oversized]) {
    assert.throws(
      () => claimTrustedProviderEphemeralAuthority(source),
      errorCode('invalid_configuration'),
    );
    assert.equal(allZero(source), true);
  }
  if (typeof SharedArrayBuffer === 'function') {
    const shared = Buffer.from(new SharedArrayBuffer(32));
    shared.fill(0xa5);
    Object.defineProperty(shared, 'buffer', { value: new ArrayBuffer(32) });
    Object.defineProperty(shared, 'length', { value: 0 });
    const sharedArrayBufferDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'SharedArrayBuffer',
    );
    try {
      Object.defineProperty(globalThis, 'SharedArrayBuffer', {
        configurable: true,
        value: class ShadowedSharedArrayBuffer {},
      });
      assert.throws(
        () => claimTrustedProviderEphemeralAuthority(shared),
        errorCode('invalid_configuration'),
      );
    } finally {
      Object.defineProperty(globalThis, 'SharedArrayBuffer', sharedArrayBufferDescriptor);
    }
    assert.equal(allZero(shared), true);
  }
  const backing = Buffer.alloc(32, 0xa5);
  const proxied = new Proxy(backing, {});
  assert.throws(
    () => claimTrustedProviderEphemeralAuthority(proxied),
    errorCode('invalid_configuration'),
  );
});

test('transfers arbitrary binary authority once and closes both stream ends', async () => {
  const channel = new PassThrough({ highWaterMark: 1 });
  const source = Buffer.from([0, 255, 1, 128, 2, 127]);
  const expected = Buffer.from(source);
  const readTask = readTrustedProviderEphemeralAuthority(channel);
  await writeTrustedProviderEphemeralAuthority(channel, source);
  const received = await readTask;
  assert.deepEqual(received, expected);
  assert.equal(allZero(source), true);
  assert.equal(channel.closed, true);
  received.fill(0);
});

test('reads every envelope boundary and overwrites incoming chunks', async () => {
  const expected = Buffer.alloc(TRUSTED_PROVIDER_PROCESS_MAXIMUM_AUTHORITY_BYTES);
  for (let index = 0; index < expected.byteLength; index += 1) {
    expected[index] = index % 251;
  }
  const frame = envelope(expected);
  const channel = new PassThrough();
  const readTask = readTrustedProviderEphemeralAuthority(channel);
  for (let offset = 0; offset < frame.byteLength; offset += 1) {
    const chunk = Buffer.from(frame.subarray(offset, offset + 1));
    channel.write(chunk);
    assert.equal(allZero(chunk), true);
  }
  channel.end();
  const received = await readTask;
  assert.deepEqual(received, expected);
  received.fill(0);
  expected.fill(0);
  frame.fill(0);
});

test('rejects malformed, empty, oversized, truncated and trailing envelopes', async () => {
  const cases = [
    envelope(Buffer.from([1]), { magic: Buffer.from('BADMAGC1', 'ascii') }),
    envelope(Buffer.alloc(0)),
    envelope(Buffer.from([1]), {
      length: TRUSTED_PROVIDER_PROCESS_MAXIMUM_AUTHORITY_BYTES + 1,
    }),
    envelope(Buffer.from([1, 2]), { length: 3 }),
    envelope(Buffer.from([1, 2]), { length: 1 }),
    Buffer.alloc(7, 0xa5),
  ];
  for (const bytes of cases) {
    const channel = new PassThrough();
    const task = readTrustedProviderEphemeralAuthority(channel);
    channel.end(bytes);
    await assert.rejects(task, /ephemeral authority channel failed/u);
    assert.equal(allZero(bytes), true);
  }
});

test('rejects premature read closure with fixed non-secret diagnostics', async () => {
  const channel = new PassThrough();
  const task = readTrustedProviderEphemeralAuthority(channel);
  channel.destroy(new Error('Bearer stream-secret'));
  await assert.rejects(
    task,
    (error) => error.message === 'ephemeral authority channel failed'
      && !error.message.includes('Bearer'),
  );
});

test('rejects failed writes and overwrites the parent authority', async () => {
  const channel = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('Bearer stream-secret'));
    },
  });
  const authority = Buffer.alloc(32, 0xa5);
  await assert.rejects(
    writeTrustedProviderEphemeralAuthority(channel, authority),
    errorCode('authority_transfer_failed'),
  );
  assert.equal(allZero(authority), true);

  const invalidStreamAuthority = Buffer.alloc(32, 0x5a);
  await assert.rejects(
    writeTrustedProviderEphemeralAuthority(Object.freeze({}), invalidStreamAuthority),
    errorCode('authority_transfer_failed'),
  );
  assert.equal(allZero(invalidStreamAuthority), true);
});

test('rejects a close between the final write and end without hanging', async () => {
  class ClosingStream extends EventEmitter {
    constructor() {
      super();
      this.closed = false;
      this.destroyed = false;
      this.writableEnded = false;
      this.writableFinished = false;
      this.writeCount = 0;
    }

    write(_chunk, callback) {
      const writeNumber = this.writeCount += 1;
      queueMicrotask(() => {
        callback();
        if (writeNumber === 2) {
          this.closed = true;
          this.destroyed = true;
          this.emit('close');
        }
      });
      return true;
    }

    end() {
      throw new Error('end must not run after terminal close');
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const authority = Buffer.alloc(32, 0xa5);
  let timeout;
  const outcome = await Promise.race([
    writeTrustedProviderEphemeralAuthority(new ClosingStream(), authority).then(
      () => ({ state: 'resolved' }),
      (error) => ({ state: 'rejected', error }),
    ),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ state: 'timeout' }), 250);
    }),
  ]);
  clearTimeout(timeout);
  assert.equal(outcome.state, 'rejected');
  assert.equal(errorCode('authority_transfer_failed')(outcome.error), true);
  assert.equal(allZero(authority), true);
});

test('runs the authority callback once and overwrites bytes after settlement', async () => {
  const authority = Buffer.from([1, 2, 3, 4]);
  const settlement = createTrustedProviderEphemeralAuthorityCapability(authority);
  assert.deepEqual(Object.keys(settlement.capability), ['consume']);
  assert.equal(Object.isFrozen(settlement.capability), true);
  assert.equal(Object.getPrototypeOf(settlement.capability), null);
  const outcome = await settlement.capability.consume(async (bytes) => {
    assert.equal(bytes, authority);
    assert.deepEqual(bytes, Buffer.from([1, 2, 3, 4]));
    await new Promise((resolve) => setImmediate(resolve));
    return 'complete';
  });
  assert.equal(outcome, 'complete');
  assert.equal(allZero(authority), true);
  assert.equal(settlement.settle(), true);
  assert.equal(settlement.settle(), true);
});

test('records ignored, invalid and caught repeated consumption as contract failures', async () => {
  const ignoredBytes = Buffer.alloc(16, 0xa5);
  const ignored = createTrustedProviderEphemeralAuthorityCapability(ignoredBytes);
  assert.equal(ignored.settle(), false);
  assert.equal(allZero(ignoredBytes), true);

  const invalidBytes = Buffer.alloc(16, 0xa5);
  const invalid = createTrustedProviderEphemeralAuthorityCapability(invalidBytes);
  await assert.rejects(
    invalid.capability.consume('Bearer callback-secret'),
    errorCode('authority_contract_failed'),
  );
  assert.equal(invalid.settle(), false);
  assert.equal(allZero(invalidBytes), true);

  const repeatedBytes = Buffer.alloc(16, 0xa5);
  const repeated = createTrustedProviderEphemeralAuthorityCapability(repeatedBytes);
  await repeated.capability.consume(async () => undefined);
  await assert.rejects(
    repeated.capability.consume(async () => undefined),
    errorCode('authority_contract_failed'),
  );
  assert.equal(repeated.settle(), false);
  assert.equal(allZero(repeatedBytes), true);
});

test('overwrites authority when the consume callback rejects', async () => {
  const authority = Buffer.alloc(16, 0xa5);
  const settlement = createTrustedProviderEphemeralAuthorityCapability(authority);
  await assert.rejects(
    settlement.capability.consume(async () => {
      throw new Error('Bearer callback-secret');
    }),
    /Bearer callback-secret/u,
  );
  assert.equal(allZero(authority), true);
  assert.equal(settlement.settle(), true);
});
