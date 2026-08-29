import { describe, expect, test } from 'bun:test';
import {
  decodeFrame,
  encodeFrame,
  LIMITS,
  ProtocolError,
  type ProtocolErrorKind,
  type ProtocolObject,
  type ProtocolValue,
} from '../src/codec';

function expectKind(action: () => unknown, kind: ProtocolErrorKind): void {
  try {
    action();
    throw new Error('expected protocol error');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).kind).toBe(kind);
  }
}

function extension(payload: ProtocolValue[]): Uint8Array {
  return encodeFrame({ opcode: 0x80, payload });
}

describe('canonical value profile', () => {
  test('round-trips all allowed value families', () => {
    const value: ProtocolObject = {
      array: [null, true, false, -33, 128, 1.25],
      binary: Uint8Array.of(0, 1, 254, 255),
      object: { nested: 'été 😀' },
    };
    const encoded = extension([value]);
    const decoded = decodeFrame(encoded);
    expect(decoded.opcode).toBe(0x80);
    expect(encodeFrame(decoded)).toEqual(encoded);
  });

  test('supports both safe-integer boundaries', () => {
    const encoded = extension([Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
    const decoded = decodeFrame(encoded);
    expect(decoded.payload).toEqual([Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
  });

  test('sorts map keys by UTF-8 bytes instead of UTF-16 code units', () => {
    const encoded = extension([{ '𐀀': 2, '': 1 }]);
    const hex = Array.from(encoded, (value) => value.toString(16).padStart(2, '0')).join('');
    expect(hex.indexOf('ee8080')).toBeLessThan(hex.indexOf('f0908080'));
    expect(encodeFrame(decodeFrame(encoded))).toEqual(encoded);
  });

  test('rejects unsupported JavaScript values', () => {
    expectKind(() => extension([-0]), 'invalid_value');
    expectKind(() => extension([Number.NaN]), 'invalid_value');
    expectKind(() => extension([Number.POSITIVE_INFINITY]), 'invalid_value');
    expectKind(() => extension([9_007_199_254_740_992]), 'invalid_value');
    expectKind(() => extension([undefined as unknown as ProtocolValue]), 'invalid_value');
    expectKind(() => extension([1n as unknown as ProtocolValue]), 'invalid_value');
    expectKind(() => extension([new Date() as unknown as ProtocolValue]), 'invalid_value');
    expectKind(() => extension(['\ud800']), 'invalid_value');
  });

  test('rejects the reserved prototype map key', () => {
    const value = Object.create(null) as ProtocolObject;
    value.__proto__ = 'blocked';
    expectKind(() => extension([value]), 'invalid_value');
  });
});

describe('resource limits', () => {
  test('rejects a frame before decoding when its byte limit is exceeded', () => {
    expectKind(() => decodeFrame(new Uint8Array(LIMITS.frameBytes + 1)), 'frame_too_large');
  });

  test('accepts the maximum nesting depth and rejects the next level', () => {
    let accepted: ProtocolValue = null;
    for (let depth = 1; depth < LIMITS.depth; depth += 1) accepted = [accepted];
    expect(() => extension(accepted as ProtocolValue[])).not.toThrow();

    let rejected: ProtocolValue = null;
    for (let depth = 0; depth < LIMITS.depth; depth += 1) rejected = [rejected];
    expectKind(() => extension(rejected as ProtocolValue[]), 'limit');
  });

  test('rejects oversized strings, binary values and arrays', () => {
    expectKind(() => extension(['a'.repeat(LIMITS.stringBytes + 1)]), 'limit');
    expectKind(() => extension([new Uint8Array(LIMITS.binaryBytes + 1)]), 'limit');
    expectKind(() => extension([Array.from({ length: LIMITS.arrayItems + 1 }, () => null)]), 'limit');
  });

  test('rejects a payload that exceeds the aggregate value budget', () => {
    const groups = Array.from({ length: 5 }, () => Array.from({ length: LIMITS.arrayItems }, () => null));
    expectKind(() => extension(groups), 'limit');
  });

  test('stops encoding when the frame byte budget is exhausted', () => {
    const values = Array.from({ length: LIMITS.arrayItems }, () => 'x'.repeat(64));
    expectKind(() => extension([values]), 'frame_too_large');
  });
});
