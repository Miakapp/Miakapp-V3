import { describe, expect, test } from 'bun:test';
import {
  decodeFrame,
  encodeFrame,
  Opcode,
  ProtocolError,
  type ProtocolErrorKind,
  type ProtocolObject,
  type ProtocolValue,
} from '../src/codec';

interface Fixture {
  name: string;
  opcode: number;
  payload: unknown[];
  hex: string;
}

interface InvalidWireFixture {
  name: string;
  hex: string;
  error: ProtocolErrorKind;
}

interface InvalidSemanticFixture {
  name: string;
  opcode: number;
  payload: unknown[];
  error: ProtocolErrorKind;
}

interface ErrorCodeFixtures {
  core: number[];
  application: [number, number];
}

interface FixtureFile {
  errorCodes: ErrorCodeFixtures;
  errorCorrelationSources: number[];
  valid: Fixture[];
  invalidWire: InvalidWireFixture[];
  invalidSemantic: InvalidSemanticFixture[];
}

const fixtureUrl = new URL('../../fixtures/v1/frames.json', import.meta.url);
const fixtures = await Bun.file(fixtureUrl).json() as FixtureFile;

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('odd hexadecimal fixture');
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) => (
    Number.parseInt(hex.slice(index * 2, (index * 2) + 2), 16)
  ));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function materialize(value: unknown): ProtocolValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) return value.map(materialize);
  if (typeof value !== 'object') throw new Error(`unsupported fixture value: ${String(value)}`);
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length === 1 && typeof source.$binary === 'string') {
    return fromHex(source.$binary);
  }
  const output: ProtocolObject = {};
  Object.entries(source).forEach(([key, child]) => {
    output[key] = materialize(child);
  });
  return output;
}

function normalize(value: ProtocolValue): unknown {
  if (value instanceof Uint8Array) return { $binary: toHex(value) };
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
  }
  return value;
}

function expectProtocolError(action: () => unknown, kind: ProtocolErrorKind): void {
  try {
    action();
    throw new Error('expected protocol error');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).kind).toBe(kind);
  }
}

describe('shared protocol fixtures', () => {
  for (const fixture of fixtures.valid) {
    test(`encodes ${fixture.name}`, () => {
      const frame = {
        opcode: fixture.opcode,
        payload: fixture.payload.map(materialize),
      };
      expect(toHex(encodeFrame(frame))).toBe(fixture.hex);
    });

    test(`decodes ${fixture.name}`, () => {
      const decoded = decodeFrame(fromHex(fixture.hex));
      expect(decoded.opcode).toBe(fixture.opcode);
      expect(normalize(decoded.payload)).toEqual(fixture.payload);
    });
  }

  for (const fixture of fixtures.invalidWire) {
    test(`rejects wire fixture ${fixture.name}`, () => {
      expectProtocolError(() => decodeFrame(fromHex(fixture.hex)), fixture.error);
    });
  }

  for (const fixture of fixtures.invalidSemantic) {
    test(`rejects semantic fixture ${fixture.name}`, () => {
      expectProtocolError(() => encodeFrame({
        opcode: fixture.opcode,
        payload: fixture.payload.map(materialize),
      }), fixture.error);
    });
  }

  test('covers every core opcode exactly through the shared corpus', () => {
    const expected = new Set<number>(Object.values(Opcode));
    const covered = new Set(fixtures.valid.filter(({ opcode }) => opcode < 0x80).map(({ opcode }) => opcode));
    expect([...covered].sort((left, right) => left - right)).toEqual(
      [...expected].sort((left, right) => left - right),
    );
  });

  test('enforces the shared error code catalogue', () => {
    for (const code of fixtures.errorCodes.core) {
      expect(() => encodeFrame({
        opcode: Opcode.Error,
        payload: [1, Opcode.Event, code, false, 'error'],
      })).not.toThrow();
      expect(() => encodeFrame({
        opcode: Opcode.Fatal,
        payload: [Opcode.Event, code, false, 'error'],
      })).not.toThrow();
      expect(() => encodeFrame({
        opcode: Opcode.CallError,
        payload: [1, code, false, 'error', null],
      })).not.toThrow();
    }

    const [minimum, maximum] = fixtures.errorCodes.application;
    for (let code = minimum; code <= maximum; code += 1) {
      expect(() => encodeFrame({
        opcode: Opcode.CallError,
        payload: [1, code, false, 'error', null],
      })).not.toThrow();
      expectProtocolError(() => encodeFrame({
        opcode: Opcode.Error,
        payload: [1, Opcode.Event, code, false, 'error'],
      }), 'invalid_frame');
      expectProtocolError(() => encodeFrame({
        opcode: Opcode.Fatal,
        payload: [Opcode.Event, code, false, 'error'],
      }), 'invalid_frame');
    }
  });

  test('enforces the shared ERROR correlation source catalogue', () => {
    const allowed = new Set(fixtures.errorCorrelationSources);
    for (let sourceOpcode = 1; sourceOpcode <= 0xff; sourceOpcode += 1) {
      const action = () => encodeFrame({
        opcode: Opcode.Error,
        payload: [1, sourceOpcode, 1200, false, 'error'],
      });
      if (allowed.has(sourceOpcode)) expect(action).not.toThrow();
      else expectProtocolError(action, 'invalid_frame');
    }

    expect(() => encodeFrame({
      opcode: Opcode.Error,
      payload: [0, 0, 1200, false, 'error'],
    })).not.toThrow();
    expectProtocolError(() => encodeFrame({
      opcode: Opcode.Error,
      payload: [1, 0, 1200, false, 'error'],
    }), 'invalid_frame');
  });
});
