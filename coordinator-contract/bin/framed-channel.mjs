const DEFAULT_MAX_FRAME_BYTES = 4_194_304;
const DEFAULT_MAX_FRAMES = 8_192;
const DEFAULT_MAX_JSON_DEPTH = 64;
const DEFAULT_MAX_JSON_TOKENS = 262_144;

function assertJsonComplexity(payload) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let tokens = 0;
  for (const byte of payload) {
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) {
      inString = true;
      tokens += 1;
    } else if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
      tokens += 1;
      if (depth > DEFAULT_MAX_JSON_DEPTH) {
        throw new RangeError(
          `Worker protocol JSON exceeds depth ${DEFAULT_MAX_JSON_DEPTH}`,
        );
      }
    } else if (byte === 0x7d || byte === 0x5d) {
      depth -= 1;
    } else if (byte === 0x2c || byte === 0x3a) {
      tokens += 1;
    }
    if (tokens > DEFAULT_MAX_JSON_TOKENS) {
      throw new RangeError(
        `Worker protocol JSON exceeds ${DEFAULT_MAX_JSON_TOKENS} structural tokens`,
      );
    }
  }
}

export function encodeFrame(message, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
  const serialized = JSON.stringify(message);
  if (serialized === undefined) throw new TypeError('Worker protocol message is not JSON serializable');
  const payload = Buffer.from(serialized, 'utf8');
  if (payload.byteLength < 1 || payload.byteLength > maxFrameBytes) {
    throw new RangeError(`Worker protocol frame must contain 1 to ${maxFrameBytes} bytes`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.byteLength);
  return Buffer.concat([header, payload], header.byteLength + payload.byteLength);
}

export function writeFrame(stream, message, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
  const frame = encodeFrame(message, maxFrameBytes);
  return new Promise((resolveWrite, rejectWrite) => {
    const onError = (error) => {
      stream.removeListener('error', onError);
      rejectWrite(error);
    };
    stream.once('error', onError);
    stream.write(frame, (error) => {
      stream.removeListener('error', onError);
      if (error === null || error === undefined) resolveWrite();
      else rejectWrite(error);
    });
  });
}

export function readFrames(
  stream,
  onMessage,
  onFailure,
  {
    maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
    maxFrames = DEFAULT_MAX_FRAMES,
  } = {},
) {
  const header = Buffer.allocUnsafe(4);
  let headerBytes = 0;
  let payload;
  let payloadBytes = 0;
  let frames = 0;
  let failed = false;

  const fail = (error) => {
    if (failed) return;
    failed = true;
    onFailure(error);
    stream.destroy();
  };

  const onData = (chunk) => {
    try {
      let offset = 0;
      while (offset < chunk.byteLength) {
        if (payload === undefined) {
          const headerRemaining = header.byteLength - headerBytes;
          const copied = Math.min(headerRemaining, chunk.byteLength - offset);
          chunk.copy(header, headerBytes, offset, offset + copied);
          headerBytes += copied;
          offset += copied;
          if (headerBytes !== header.byteLength) continue;

          const payloadLength = header.readUInt32BE();
          if (payloadLength < 1 || payloadLength > maxFrameBytes) {
            throw new RangeError(
              `Worker protocol frame must contain 1 to ${maxFrameBytes} bytes`,
            );
          }
          payload = Buffer.allocUnsafe(payloadLength);
          payloadBytes = 0;
        }

        const payloadRemaining = payload.byteLength - payloadBytes;
        const copied = Math.min(payloadRemaining, chunk.byteLength - offset);
        chunk.copy(payload, payloadBytes, offset, offset + copied);
        payloadBytes += copied;
        offset += copied;
        if (payloadBytes !== payload.byteLength) continue;

        frames += 1;
        if (frames > maxFrames) {
          throw new RangeError(`Worker protocol exceeded ${maxFrames} frames`);
        }
        assertJsonComplexity(payload);
        const message = JSON.parse(payload.toString('utf8'));
        headerBytes = 0;
        payload = undefined;
        payloadBytes = 0;
        onMessage(message);
      }
    } catch (error) {
      fail(error);
    }
  };

  const onEnd = () => {
    if (headerBytes !== 0 || payload !== undefined) {
      fail(new Error('Worker protocol ended with a truncated frame'));
    }
  };

  stream.on('data', onData);
  stream.once('end', onEnd);
  stream.once('error', fail);
  return () => {
    failed = true;
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
    stream.removeListener('error', fail);
  };
}
