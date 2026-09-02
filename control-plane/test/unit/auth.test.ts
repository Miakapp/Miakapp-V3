import { describe, expect, test } from 'bun:test';
import type { DecodedIdToken } from 'firebase-admin/auth';

import {
  authenticateFirebase,
  FirebaseAdminAuthVerifier,
  firebasePrincipalFromDecodedToken,
  requireRecentAuthentication,
  type FirebaseTokenVerifier,
} from '../../src/auth.js';
import { ApiError } from '../../src/errors.js';

const now = 1_788_220_800;

function decoded(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    aud: 'demo-miakapp-v4',
    auth_time: now - 60,
    exp: now + 3_600,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: now - 60,
    iss: 'https://securetoken.google.com/demo-miakapp-v4',
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

  test('keeps definitive Firebase rejection separate from key-fetch dependency failure', async () => {
    const verifierFor = (error: Error & { readonly code: string }) => (
      new FirebaseAdminAuthVerifier({
        verifyIdToken: async () => Promise.reject(error),
      })
    );
    const coded = (code: string, message: string): Error & { readonly code: string } => (
      Object.assign(new Error(message), { code })
    );

    await expect(authenticateFirebase(
      verifierFor(coded('auth/invalid-id-token', 'private invalid-token detail')),
      'Bearer signed-token',
      now * 1_000,
    )).rejects.toMatchObject({
      code: 'invalid_firebase_token',
      status: 401,
      retryable: false,
    });

    for (const dependencyError of [
      coded(
        'auth/argument-error',
        'Error fetching public keys for Google certs: private network detail',
      ),
      coded('auth/internal-error', 'private dependency detail'),
    ]) {
      await expect(authenticateFirebase(
        verifierFor(dependencyError),
        'Bearer signed-token',
        now * 1_000,
      )).rejects.toMatchObject({
        code: 'temporarily_unavailable',
        status: 503,
        retryable: true,
      });
    }
  });
});
