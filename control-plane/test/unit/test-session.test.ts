import { describe, expect, test } from 'bun:test';

import {
  issueTestTicket,
  testSessionRequest,
  testTicketFromAuthorization,
  verifyTestTicket,
} from '../../src/test-session.js';

const pepper = new Uint8Array(32).fill(7);
const keys = {
  verifierKeyVersion: '1',
  homeKeyPepperForVersion: (version: string) => (version === '1' ? pepper : undefined),
};
const now = 1_800_000_000_000;
const base = { homeId: 'colmon', keyId: 'A'.repeat(22), role: 'member', release: null, minutes: 30, nowMs: now };

describe('test session tickets', () => {
  test('round-trip: home, key, role and expiry come back', () => {
    const { ticket } = issueTestTicket(keys, base);
    expect(testTicketFromAuthorization(`Bearer ${ticket}`)).toBe(ticket);
    const claims = verifyTestTicket(keys, ticket, now + 60_000);
    expect(claims).toMatchObject({ home: 'colmon', key: 'A'.repeat(22), role: 'member', release: null });
    expect(claims.exp - claims.iat).toBe(1_800);
  });

  test('expired, tampered or foreign tickets are refused', () => {
    const { ticket } = issueTestTicket(keys, base);
    expect(() => verifyTestTicket(keys, ticket, now + 31 * 60_000)).toThrow();
    const [prefix, payload, mac] = ticket.split('.');
    const forged = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(payload as string, 'base64url').toString()), role: 'owner',
    })).toString('base64url');
    expect(() => verifyTestTicket(keys, `${prefix}.${forged}.${mac}`, now)).toThrow();
    const other = { verifierKeyVersion: '1', homeKeyPepperForVersion: () => new Uint8Array(32).fill(8) };
    expect(() => verifyTestTicket(other, ticket, now)).toThrow();
  });

  test('a Firebase bearer is not a test ticket', () => {
    expect(testTicketFromAuthorization('Bearer eyJhbGciOi.x.y')).toBeUndefined();
    expect(testTicketFromAuthorization(undefined)).toBeUndefined();
  });

  test('requests: a role slug, an optional digest, at most an hour', () => {
    expect(testSessionRequest({ role: 'guest' })).toEqual({ role: 'guest', release: null, minutes: 30 });
    expect(testSessionRequest({ role: 'admin', release: 'a'.repeat(43), minutes: 60 }).release).toBe('a'.repeat(43));
    for (const body of [{ role: 'Owner' }, { role: 'member', minutes: 61 }, { role: 'member', extra: 1 }, { role: 'member', release: 'x' }]) {
      expect(() => testSessionRequest(body)).toThrow();
    }
  });
});
