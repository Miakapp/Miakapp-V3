import { types } from 'node:util';

import {
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_AUTHORITY_BYTES,
  rejectTrustedProviderProcess,
} from './contract.mjs';

const MAGIC = Buffer.from('MIAKAUT1', 'ascii');
const MAGIC_BYTES = 8;
const HEADER_BYTES = MAGIC_BYTES + 4;
const CLAIMED_AUTHORITY_BUFFERS = new WeakSet();
const INTRINSIC_BUFFER_ALLOC = Buffer.alloc;
const INTRINSIC_BUFFER_READ_UINT32_BE = Buffer.prototype.readUInt32BE;
const INTRINSIC_BUFFER_WRITE_UINT32_BE = Buffer.prototype.writeUInt32BE;
const INTRINSIC_IS_BUFFER = Buffer.isBuffer;
const INTRINSIC_IS_PROXY = types.isProxy;
const INTRINSIC_IS_SHARED_ARRAY_BUFFER = types.isSharedArrayBuffer;
const INTRINSIC_WEAK_SET_ADD = WeakSet.prototype.add;
const INTRINSIC_WEAK_SET_HAS = WeakSet.prototype.has;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const INTRINSIC_TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'buffer',
).get;
const INTRINSIC_TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteLength',
).get;

function backingStore(bytes) {
  return Reflect.apply(INTRINSIC_TYPED_ARRAY_BUFFER_GETTER, bytes, []);
}

function byteLength(bytes) {
  return Reflect.apply(INTRINSIC_TYPED_ARRAY_BYTE_LENGTH_GETTER, bytes, []);
}

function copyRange(source, target, targetStart, sourceStart, sourceEnd) {
  for (let sourceIndex = sourceStart, targetIndex = targetStart;
    sourceIndex < sourceEnd;
    sourceIndex += 1, targetIndex += 1) {
    target[targetIndex] = source[sourceIndex];
  }
}

function overwrite(bytes) {
  if (!INTRINSIC_IS_BUFFER(bytes) || INTRINSIC_IS_PROXY(bytes)) return false;
  try {
    const length = byteLength(bytes);
    for (let index = 0; index < length; index += 1) bytes[index] = 0;
    return true;
  } catch {
    return false;
  }
}

function validAuthorityBuffer(value) {
  try {
    return INTRINSIC_IS_BUFFER(value)
      && !INTRINSIC_IS_PROXY(value)
      && !INTRINSIC_IS_SHARED_ARRAY_BUFFER(backingStore(value))
      && byteLength(value) >= 1
      && byteLength(value) <= TRUSTED_PROVIDER_PROCESS_MAXIMUM_AUTHORITY_BYTES;
  } catch {
    return false;
  }
}

export function claimTrustedProviderEphemeralAuthority(value) {
  if (!validAuthorityBuffer(value)
    || Reflect.apply(INTRINSIC_WEAK_SET_HAS, CLAIMED_AUTHORITY_BUFFERS, [value])) {
    if (INTRINSIC_IS_BUFFER(value) && !INTRINSIC_IS_PROXY(value)) overwrite(value);
    rejectTrustedProviderProcess('invalid_configuration');
  }
  Reflect.apply(INTRINSIC_WEAK_SET_ADD, CLAIMED_AUTHORITY_BUFFERS, [value]);
  let authority;
  try {
    authority = Reflect.apply(INTRINSIC_BUFFER_ALLOC, Buffer, [byteLength(value)]);
    copyRange(value, authority, 0, 0, byteLength(value));
    return authority;
  } catch {
    overwrite(authority);
    rejectTrustedProviderProcess('invalid_configuration');
  } finally {
    overwrite(value);
  }
}

function writeChunk(stream, chunk) {
  return new Promise((resolveWrite, rejectWrite) => {
    let callbackDone = false;
    let drainDone = false;
    let settled = false;
    const cleanup = () => {
      stream.removeListener('drain', onDrain);
      stream.removeListener('error', onFailure);
      stream.removeListener('close', onFailure);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectWrite(new Error('ephemeral authority channel failed'));
    };
    const settle = () => {
      if (settled || !callbackDone || !drainDone) return;
      settled = true;
      cleanup();
      resolveWrite();
    };
    const onFailure = () => fail();
    const onDrain = () => {
      drainDone = true;
      settle();
    };
    stream.once('error', onFailure);
    stream.once('close', onFailure);
    let accepted;
    try {
      accepted = stream.write(chunk, (error) => {
        if (error !== null && error !== undefined) {
          fail();
          return;
        }
        callbackDone = true;
        settle();
      });
    } catch {
      fail();
      return;
    }
    if (accepted) drainDone = true;
    else stream.once('drain', onDrain);
    settle();
  });
}

function endAndClose(stream) {
  return new Promise((resolveEnd, rejectEnd) => {
    let finished = stream.writableFinished === true;
    let closed = stream.closed === true;
    let settled = false;
    const cleanup = () => {
      stream.removeListener('finish', onFinish);
      stream.removeListener('close', onClose);
      stream.removeListener('error', onFailure);
    };
    const settle = () => {
      if (settled || !finished || !closed) return;
      settled = true;
      cleanup();
      resolveEnd();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectEnd(new Error('ephemeral authority channel failed'));
    };
    const onFinish = () => {
      finished = true;
      settle();
    };
    const onClose = () => {
      closed = true;
      if (!finished) fail();
      else settle();
    };
    const onFailure = () => fail();
    stream.once('finish', onFinish);
    stream.once('close', onClose);
    stream.once('error', onFailure);
    if ((closed || stream.destroyed) && !finished) {
      fail();
      return;
    }
    try {
      if (!stream.writableEnded) stream.end();
    } catch {
      fail();
      return;
    }
    settle();
  });
}

export async function writeTrustedProviderEphemeralAuthority(stream, authority) {
  let header;
  const swallowDeferredStreamError = () => {};
  try {
    header = Reflect.apply(INTRINSIC_BUFFER_ALLOC, Buffer, [HEADER_BYTES]);
    stream.on('error', swallowDeferredStreamError);
    stream.once('close', () => {
      stream.removeListener('error', swallowDeferredStreamError);
    });
    if (!validAuthorityBuffer(authority)) {
      rejectTrustedProviderProcess('authority_transfer_failed');
    }
    const authorityBytes = byteLength(authority);
    copyRange(MAGIC, header, 0, 0, MAGIC_BYTES);
    Reflect.apply(INTRINSIC_BUFFER_WRITE_UINT32_BE, header, [authorityBytes, MAGIC_BYTES]);
    await writeChunk(stream, header);
    await writeChunk(stream, authority);
    await endAndClose(stream);
  } catch {
    try {
      stream?.destroy?.();
    } catch {
      // The fixed error below is the only public diagnostic.
    }
    rejectTrustedProviderProcess('authority_transfer_failed');
  } finally {
    overwrite(header);
    overwrite(authority);
  }
}

function headerMatches(header) {
  for (let index = 0; index < MAGIC_BYTES; index += 1) {
    if (header[index] !== MAGIC[index]) return false;
  }
  return true;
}

export function readTrustedProviderEphemeralAuthority(stream) {
  return new Promise((resolveRead, rejectRead) => {
    const header = Reflect.apply(INTRINSIC_BUFFER_ALLOC, Buffer, [HEADER_BYTES]);
    let headerBytes = 0;
    let authority;
    let authorityLength = 0;
    let authorityBytes = 0;
    let ended = false;
    let closed = stream.closed === true;
    let settled = false;

    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onFailure);
      stream.removeListener('close', onClose);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      overwrite(header);
      overwrite(authority);
      authority = undefined;
      try {
        stream.destroy();
      } catch {
        // The fixed error below is the only public diagnostic.
      }
      rejectRead(new Error('ephemeral authority channel failed'));
    };
    const finish = () => {
      if (settled || !ended || !closed) return;
      if (headerBytes !== HEADER_BYTES || authority === undefined
        || authorityBytes !== authorityLength) {
        fail();
        return;
      }
      settled = true;
      cleanup();
      overwrite(header);
      const result = authority;
      authority = undefined;
      resolveRead(result);
    };
    const onData = (chunk) => {
      if (settled) {
        overwrite(chunk);
        return;
      }
      try {
        if (!INTRINSIC_IS_BUFFER(chunk) || INTRINSIC_IS_PROXY(chunk)) throw new Error();
        const chunkBytes = byteLength(chunk);
        let offset = 0;
        while (offset < chunkBytes) {
          if (headerBytes < HEADER_BYTES) {
            const copied = Math.min(HEADER_BYTES - headerBytes, chunkBytes - offset);
            copyRange(chunk, header, headerBytes, offset, offset + copied);
            headerBytes += copied;
            offset += copied;
            if (headerBytes !== HEADER_BYTES) continue;
            if (!headerMatches(header)) throw new Error();
            const length = Reflect.apply(
              INTRINSIC_BUFFER_READ_UINT32_BE,
              header,
              [MAGIC_BYTES],
            );
            if (length < 1 || length > TRUSTED_PROVIDER_PROCESS_MAXIMUM_AUTHORITY_BYTES) {
              throw new Error();
            }
            authority = Reflect.apply(INTRINSIC_BUFFER_ALLOC, Buffer, [length]);
            authorityLength = length;
          }
          if (authorityBytes === authorityLength) throw new Error();
          const copied = Math.min(
            authorityLength - authorityBytes,
            chunkBytes - offset,
          );
          copyRange(chunk, authority, authorityBytes, offset, offset + copied);
          authorityBytes += copied;
          offset += copied;
        }
      } catch {
        fail();
      } finally {
        overwrite(chunk);
      }
    };
    const onEnd = () => {
      ended = true;
      finish();
    };
    const onFailure = () => fail();
    const onClose = () => {
      closed = true;
      if (!ended) fail();
      else finish();
    };

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onFailure);
    stream.once('close', onClose);
    if (stream.destroyed && !closed) fail();
    else finish();
  });
}

export function createTrustedProviderEphemeralAuthorityCapability(authority) {
  if (!validAuthorityBuffer(authority)) {
    overwrite(authority);
    rejectTrustedProviderProcess('authority_transfer_failed');
  }
  let state = 'available';
  let violated = false;
  let retained = authority;

  const consume = async (callback) => {
    if (typeof callback !== 'function' || state !== 'available') {
      violated = true;
      rejectTrustedProviderProcess('authority_contract_failed');
    }
    state = 'consuming';
    const value = retained;
    try {
      return await callback(value);
    } finally {
      overwrite(value);
      retained = undefined;
      state = 'consumed';
    }
  };
  const capability = Object.freeze(Object.assign(Object.create(null), { consume }));
  const settle = () => {
    const consumedOnce = state === 'consumed' && !violated;
    overwrite(retained);
    retained = undefined;
    if (state !== 'consumed') state = 'disposed';
    return consumedOnce;
  };
  return Object.freeze({ capability, settle });
}
