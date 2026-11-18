import { createHmac, timingSafeEqual } from 'node:crypto';

import { apiError } from './errors.js';

/**
 * Test sessions: a Home Key holder (the home's agent) opens its own home in a
 * browser as a stand-in member, to check the published app for real (relay,
 * coordinator, sandbox) without anyone's account.
 *
 * The ticket is minted from a Home Key that may run the coordinator, lasts at
 * most an hour, and is checked again against that key at every use: revoking
 * the key ends every test session it opened. The browser it is handed to gets
 * a relay identity `test:<role>`; Miakapp gives that identity nothing else.
 * The coordinator decides what `test:<role>` may see and do, like any account.
 *
 * Format: `mkt1.<base64url(JSON claims)>.<base64url(HMAC-SHA256)>`, keyed by a
 * key derived from the current Home Key pepper. Only this control plane ever
 * verifies it; it is never a relay credential.
 */

export const TEST_TICKET_PREFIX = 'mkt1.';
export const TEST_ROLE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
export const TEST_SESSION_MAX_MINUTES = 60;
export const TEST_SESSION_DEFAULT_MINUTES = 30;
const MAX_TICKET_BYTES = 2_048;
const HOME_ID = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/u;
const KEY_ID = /^[A-Za-z0-9_-]{22}$/u;
const DIGEST = /^[A-Za-z0-9_-]{43}$/u;

export interface TestTicketClaims {
  readonly v: string;
  readonly home: string;
  readonly key: string;
  readonly role: string;
  readonly release: string | null;
  readonly iat: number;
  readonly exp: number;
}

export interface TestTicketKeys {
  readonly verifierKeyVersion: string;
  readonly homeKeyPepperForVersion: (version: string) => Uint8Array | undefined;
}

export function testPrincipalId(role: string): string {
  return `test:${role}`;
}

function ticketKey(keys: TestTicketKeys, version: string): Buffer {
  const pepper = keys.homeKeyPepperForVersion(version);
  if (pepper === undefined || pepper.byteLength !== 32) throw apiError('temporarily_unavailable');
  return createHmac('sha256', pepper).update('miakapp.test-session/1').digest();
}

function signature(key: Buffer, payload: string): Buffer {
  return createHmac('sha256', key).update(payload, 'ascii').digest();
}

export function issueTestTicket(
  keys: TestTicketKeys,
  input: {
    readonly homeId: string;
    readonly keyId: string;
    readonly role: string;
    readonly release: string | null;
    readonly minutes: number;
    readonly nowMs: number;
  },
): { readonly ticket: string; readonly claims: TestTicketClaims } {
  const iat = Math.floor(input.nowMs / 1_000);
  const claims: TestTicketClaims = Object.freeze({
    v: keys.verifierKeyVersion,
    home: input.homeId,
    key: input.keyId,
    role: input.role,
    release: input.release,
    iat,
    exp: iat + input.minutes * 60,
  });
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const mac = signature(ticketKey(keys, claims.v), payload).toString('base64url');
  return Object.freeze({ ticket: `${TEST_TICKET_PREFIX}${payload}.${mac}`, claims });
}

/** The bearer value, when an Authorization header carries a test ticket. */
export function testTicketFromAuthorization(authorization: unknown): string | undefined {
  if (typeof authorization !== 'string') return undefined;
  const match = /^Bearer (mkt1\.[A-Za-z0-9_.-]+)$/u.exec(authorization);
  return match?.[1];
}

export function verifyTestTicket(
  keys: TestTicketKeys,
  ticket: string,
  nowMs: number,
): TestTicketClaims {
  const fail = (): never => { throw apiError('invalid_access_token'); };
  if (ticket.length > MAX_TICKET_BYTES || !ticket.startsWith(TEST_TICKET_PREFIX)) fail();
  const [payload, mac, extra] = ticket.slice(TEST_TICKET_PREFIX.length).split('.');
  if (payload === undefined || mac === undefined || extra !== undefined) return fail();
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return fail();
  }
  if (claims === null || typeof claims !== 'object' || typeof claims.v !== 'string') return fail();
  const pepper = keys.homeKeyPepperForVersion(claims.v);
  if (pepper === undefined) return fail();
  const expected = signature(ticketKey(keys, claims.v), payload);
  const given = Buffer.from(mac, 'base64url');
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected)) return fail();
  const now = Math.floor(nowMs / 1_000);
  const { home, key, role, release, iat, exp } = claims;
  if (typeof home !== 'string' || !HOME_ID.test(home)
    || typeof key !== 'string' || !KEY_ID.test(key)
    || typeof role !== 'string' || !TEST_ROLE_PATTERN.test(role)
    || (release !== null && (typeof release !== 'string' || !DIGEST.test(release)))
    || typeof iat !== 'number' || !Number.isSafeInteger(iat)
    || typeof exp !== 'number' || !Number.isSafeInteger(exp)
    || exp - iat > TEST_SESSION_MAX_MINUTES * 60
    || iat > now + 30
    || exp <= now) {
    return fail();
  }
  return Object.freeze({ v: claims.v, home, key, role, release, iat, exp });
}

export interface TestSessionRequest {
  readonly role: string;
  readonly release: string | null;
  readonly minutes: number;
}

export function testSessionRequest(body: unknown): TestSessionRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw apiError('invalid_request');
  const record = body as Record<string, unknown>;
  for (const name of Object.keys(record)) {
    if (name !== 'role' && name !== 'release' && name !== 'minutes') throw apiError('invalid_request');
  }
  const { role, release, minutes } = record;
  if (typeof role !== 'string' || !TEST_ROLE_PATTERN.test(role)) throw apiError('invalid_request');
  if (release !== undefined && release !== null && (typeof release !== 'string' || !DIGEST.test(release))) {
    throw apiError('invalid_request');
  }
  if (minutes !== undefined && (typeof minutes !== 'number' || !Number.isSafeInteger(minutes)
    || minutes < 1 || minutes > TEST_SESSION_MAX_MINUTES)) {
    throw apiError('invalid_request');
  }
  return Object.freeze({
    role,
    release: typeof release === 'string' ? release : null,
    minutes: typeof minutes === 'number' ? minutes : TEST_SESSION_DEFAULT_MINUTES,
  });
}
