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

interface FixtureFile {
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
});
