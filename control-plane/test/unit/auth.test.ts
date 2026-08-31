import { describe, expect, test } from 'bun:test';
import type { DecodedIdToken } from 'firebase-admin/auth';

import {
  authenticateFirebase,
  firebasePrincipalFromDecodedToken,
  requireRecentAuthentication,
  type FirebaseTokenVerifier,
} from '../../src/auth.js';
import { ApiError } from '../../src/errors.js';

const now = 1_788_220_800;

function decoded(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    aud: 'demo-miakapp-v35',
    auth_time: now - 60,
    exp: now + 3_600,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: now - 60,
    iss: 'https://securetoken.google.com/demo-miakapp-v35',
    sub: 'synthetic-owner',
    uid: 'synthetic-owner',
    ...overrides,
  };
}

describe('Firebase owner principal', () => {
  test('derives identity and freshness from verified claims', () => {
    const principal = firebasePrincipalFromDecodedToken(decoded(), now * 1_000);
    expect(principal).toEqual({
      userId: 'synthetic-owner',
      authenticatedAt: now - 60,
      expiresAt: now + 3_600,
    });
    expect(() => requireRecentAuthentication(principal, now * 1_000)).not.toThrow();
  });

  test('rejects stale authentication without trusting a request boolean', () => {
    const principal = firebasePrincipalFromDecodedToken(
      decoded({ auth_time: now - 601 }),
      now * 1_000,
    );
    expect(() => requireRecentAuthentication(principal, now * 1_000)).toThrow(ApiError);
  });

  test('rejects expired or future-authenticated principals', () => {
    expect(() => firebasePrincipalFromDecodedToken(decoded({ exp: now }), now * 1_000)).toThrow(ApiError);
    expect(() => firebasePrincipalFromDecodedToken(
      decoded({ auth_time: now + 31 }),
      now * 1_000,
    )).toThrow(ApiError);
  });

  test('enforces the signed iat profile at its exact skew boundary', () => {
    expect(() => firebasePrincipalFromDecodedToken(
      decoded({ iat: now + 30 }),
      now * 1_000,
    )).not.toThrow();
    expect(() => firebasePrincipalFromDecodedToken(
      decoded({ iat: now + 31 }),
      now * 1_000,
    )).toThrow(ApiError);
    expect(() => firebasePrincipalFromDecodedToken(
      decoded({ iat: undefined as unknown as number }),
      now * 1_000,
    )).toThrow(ApiError);
    expect(() => firebasePrincipalFromDecodedToken(
      decoded({ iat: now + 0.5 }),
      now * 1_000,
    )).toThrow(ApiError);
  });

  test('caps the compact Firebase bearer token at 8192 bytes before verification', async () => {
    let verified = 0;
    const verifier: FirebaseTokenVerifier = {
      verifyIdToken: async () => {
        verified += 1;
        return decoded();
      },
    };
    await expect(authenticateFirebase(
      verifier,
      `Bearer ${'a'.repeat(8_192)}`,
      now * 1_000,
    )).resolves.toEqual(expect.objectContaining({ userId: 'synthetic-owner' }));
    await expect(authenticateFirebase(
      verifier,
      `Bearer ${'a'.repeat(8_193)}`,
      now * 1_000,
    )).rejects.toThrow(ApiError);
    expect(verified).toBe(1);
  });
});
