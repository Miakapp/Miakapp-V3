import { createHmac, randomInt } from 'node:crypto';

import { apiError } from './errors.js';

/**
 * A pairing code is the one secret a person carries by hand from their own
 * browser to their agent, so it is shaped for that trip: 25 Crockford base32
 * characters (125 random bits) shown as `MIAK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`.
 *
 * 125 bits is not a compromise. The code lives ten minutes, is single-use and
 * every redemption attempt is admission-limited per source, so the guessing
 * bound comes from entropy alone, not from the throttle.
 */
export const PAIRING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 25;
export const PAIRING_CODE_PREFIX = 'MIAK';
export const PAIRING_CODE_LIFETIME_MILLISECONDS = 10 * 60 * 1_000;
const MAX_PAIRING_CODE_INPUT_BYTES = 64;
const LOOKUP_DOMAIN = 'miakapp.pairing-code/1\0';

/** Draws a fresh code in its canonical, undecorated form. */
export function generatePairingCode(): string {
  let code = '';
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** The grouped form a person reads, copies and pastes. */
export function displayPairingCode(canonical: string): string {
  const groups = canonical.match(/.{5}/g);
  if (canonical.length !== PAIRING_CODE_LENGTH || groups === null) {
    throw new TypeError('Pairing code is not canonical');
  }
  return [PAIRING_CODE_PREFIX, ...groups].join('-');
}

/**
 * Accepts what a person plausibly pastes or types, and nothing else:
 * surrounding whitespace, any case, hyphens or spaces between groups, the
 * optional `MIAK` prefix, and the Crockford look-alikes O→0 and I/L→1. Every
 * other deviation is the same uniform `invalid_pairing_code` a wrong code gets,
 * so syntax never becomes an oracle.
 */
export function normalizePairingCode(input: string): string {
  if (Buffer.byteLength(input, 'utf8') > MAX_PAIRING_CODE_INPUT_BYTES) {
    throw apiError('invalid_pairing_code');
  }
  let compact = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (compact.length === PAIRING_CODE_PREFIX.length + PAIRING_CODE_LENGTH
    && compact.startsWith(PAIRING_CODE_PREFIX)) {
    compact = compact.slice(PAIRING_CODE_PREFIX.length);
  }
  const canonical = compact.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (canonical.length !== PAIRING_CODE_LENGTH
    || [...canonical].some((character) => !PAIRING_CODE_ALPHABET.includes(character))) {
    throw apiError('invalid_pairing_code');
  }
  return canonical;
}

/**
 * The record ID under which a code is stored. It is a keyed, domain-separated
 * HMAC, so the registry never holds the code and a Firestore-only disclosure
 * cannot be searched offline for one.
 */
export function pairingCodeLookup(canonical: string, pepper: Uint8Array): string {
  if (pepper.byteLength !== 32) throw new Error('Pairing pepper must contain 32 bytes');
  if (canonical.length !== PAIRING_CODE_LENGTH) throw new TypeError('Pairing code is not canonical');
  return createHmac('sha256', pepper)
    .update(LOOKUP_DOMAIN, 'utf8')
    .update(canonical, 'ascii')
    .digest('base64url');
}
