import { describe, expect, test } from 'bun:test';

import { ApiError } from '../../src/errors.js';
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  displayPairingCode,
  generatePairingCode,
  normalizePairingCode,
  pairingCodeLookup,
} from '../../src/pairing-code.js';

const PEPPER = new Uint8Array(32).fill(7);
const CANONICAL = '0123456789ABCDEFGHJKMNPQR';

function expectInvalid(input: string): void {
  try {
    normalizePairingCode(input);
    throw new Error(`Expected ${JSON.stringify(input)} to be rejected`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_pairing_code');
    expect((error as ApiError).status).toBe(401);
  }
}

describe('pairing codes', () => {
  test('draws 25 Crockford characters from the full alphabet', () => {
    const seen = new Set<string>();
    const codes = new Set<string>();
    for (let index = 0; index < 2_000; index += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      for (const character of code) {
        expect(PAIRING_CODE_ALPHABET.includes(character)).toBe(true);
        seen.add(character);
      }
      codes.add(code);
    }
    // 50 000 draws over 32 symbols: every symbol appears, and no two codes
    // collide, which a short or biased generator would fail.
    expect(seen.size).toBe(32);
    expect(codes.size).toBe(2_000);
    expect(Math.log2(PAIRING_CODE_ALPHABET.length) * PAIRING_CODE_LENGTH).toBe(125);
  });

  test('displays a grouped, prefixed form that normalizes back exactly', () => {
    const display = displayPairingCode(CANONICAL);
    expect(display).toBe('MIAK-01234-56789-ABCDE-FGHJK-MNPQR');
    expect(normalizePairingCode(display)).toBe(CANONICAL);
    for (let index = 0; index < 200; index += 1) {
      const code = generatePairingCode();
      expect(normalizePairingCode(displayPairingCode(code))).toBe(code);
    }
    expect(() => displayPairingCode('SHORT')).toThrow('not canonical');
  });

  test('accepts what a person plausibly pastes or types', () => {
    for (const input of [
      CANONICAL,
      CANONICAL.toLowerCase(),
      '  MIAK-01234-56789-ABCDE-FGHJK-MNPQR\n',
      'miak 01234 56789 abcde fghjk mnpqr',
      '01234-56789-ABCDE-FGHJK-MNPQR',
      // Crockford look-alikes: O is zero, I and L are one.
      'O1234-56789-ABCDE-FGHJK-MNPQR'.replace('1', 'I'),
      'O1234-56789-ABCDE-FGHJK-MNPQR'.replace('1', 'L'),
    ]) {
      expect(normalizePairingCode(input)).toBe(CANONICAL);
    }
  });

  test('rejects every other shape with the same uniform error', () => {
    for (const input of [
      '',
      'MIAK',
      CANONICAL.slice(1),
      `${CANONICAL}0`,
      `${CANONICAL.slice(0, 24)}U`,
      `${CANONICAL.slice(0, 24)}!`,
      `${CANONICAL.slice(0, 24)}é`,
      `XXXX${CANONICAL}`,
      `MIAK-${CANONICAL}-0`,
      `${CANONICAL}${' '.repeat(64)}`,
      'mhk1_AAAAAAAAAAAAAAAAAAAAAA_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ]) {
      expectInvalid(input);
    }
  });

  test('stores only a keyed, domain-separated lookup', () => {
    const lookup = pairingCodeLookup(CANONICAL, PEPPER);
    expect(lookup).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(lookup).toBe(pairingCodeLookup(CANONICAL, PEPPER));
    expect(lookup).not.toContain(CANONICAL);
    expect(pairingCodeLookup(CANONICAL, new Uint8Array(32).fill(8))).not.toBe(lookup);
    expect(pairingCodeLookup('0123456789ABCDEFGHJKMNPQS', PEPPER)).not.toBe(lookup);
    expect(() => pairingCodeLookup(CANONICAL, new Uint8Array(31))).toThrow('32 bytes');
    expect(() => pairingCodeLookup('SHORT', PEPPER)).toThrow('not canonical');
  });
});
