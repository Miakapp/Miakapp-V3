import type { DecodedIdToken } from 'firebase-admin/auth';

import { apiError } from './errors.js';
import type { FirebasePrincipal } from './types.js';

const MAX_FIREBASE_TOKEN_BYTES = 8_192;
const RECENT_AUTHENTICATION_SECONDS = 600;

export interface FirebaseTokenVerifier {
  verifyIdToken(token: string): Promise<DecodedIdToken>;
}

function bearerToken(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_FIREBASE_TOKEN_BYTES + 7) {
    throw apiError('invalid_firebase_token');
  }
  const match = /^Bearer ([\x21-\x7e]+)$/.exec(value);
  const token = match?.[1];
  if (token === undefined || Buffer.byteLength(token, 'ascii') > MAX_FIREBASE_TOKEN_BYTES) {
    throw apiError('invalid_firebase_token');
  }
  return token;
}

export function firebasePrincipalFromDecodedToken(
  token: DecodedIdToken,
  nowMilliseconds: number,
): FirebasePrincipal {
  const userId = token.sub;
  const issuedAt = token.iat;
  const authenticatedAt = token.auth_time;
  const expiresAt = token.exp;
  const now = Math.floor(nowMilliseconds / 1_000);
  if (typeof userId !== 'string'
    || userId.length === 0
    || Buffer.byteLength(userId, 'utf8') > 128
    || !Number.isSafeInteger(issuedAt)
    || !Number.isSafeInteger(authenticatedAt)
    || !Number.isSafeInteger(expiresAt)
    || issuedAt < 0
    || authenticatedAt < 0
    || expiresAt < 0
    || issuedAt > now + 30
    || authenticatedAt > now + 30
    || expiresAt <= now) {
    throw apiError('invalid_firebase_token');
  }
  return Object.freeze({ userId, authenticatedAt, expiresAt });
}

export async function authenticateFirebase(
  verifier: FirebaseTokenVerifier,
  authorization: string | string[] | undefined,
  nowMilliseconds: number,
): Promise<FirebasePrincipal> {
  try {
    const decoded = await verifier.verifyIdToken(bearerToken(authorization));
    return firebasePrincipalFromDecodedToken(decoded, nowMilliseconds);
  } catch {
    throw apiError('invalid_firebase_token');
  }
}

export function requireRecentAuthentication(
  principal: FirebasePrincipal,
  nowMilliseconds: number,
): void {
  const now = Math.floor(nowMilliseconds / 1_000);
  if (now - principal.authenticatedAt > RECENT_AUTHENTICATION_SECONDS) {
    throw apiError('recent_authentication_required');
  }
}
