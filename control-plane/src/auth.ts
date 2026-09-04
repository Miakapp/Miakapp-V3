import type { DecodedIdToken } from 'firebase-admin/auth';

import { apiError } from './errors.js';
import type { FirebasePrincipal } from './types.js';

const MAX_FIREBASE_TOKEN_BYTES = 8_192;
const RECENT_AUTHENTICATION_SECONDS = 600;
const CONTROL_CHARACTER = /\p{Cc}/u;

export interface FirebaseTokenVerifier {
  verifyIdToken(token: string): Promise<DecodedIdToken>;
}

export interface FirebaseAdminAuthClient {
  verifyIdToken(token: string): Promise<DecodedIdToken>;
}

export class FirebaseTokenDependencyError extends Error {
  constructor() {
    super('Firebase authentication dependency is unavailable');
    this.name = 'FirebaseTokenDependencyError';
  }
}

function firebaseErrorCode(error: unknown): string | undefined {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function firebaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function definitiveFirebaseTokenRejection(error: unknown): boolean {
  const code = firebaseErrorCode(error);
  if (code === 'auth/id-token-expired'
    || code === 'auth/id-token-revoked'
    || code === 'auth/invalid-id-token') {
    return true;
  }
  if (code !== 'auth/argument-error') return false;
  const message = firebaseErrorMessage(error);
  return !message.includes('Error fetching public keys for Google certs:')
    && !message.includes('Error while making request:');
}

export class FirebaseAdminAuthVerifier implements FirebaseTokenVerifier {
  readonly #client: FirebaseAdminAuthClient;

  constructor(client: FirebaseAdminAuthClient) {
    this.#client = client;
  }

  async verifyIdToken(token: string): Promise<DecodedIdToken> {
    try {
      return await this.#client.verifyIdToken(token);
    } catch (error) {
      if (definitiveFirebaseTokenRejection(error)) throw error;
      throw new FirebaseTokenDependencyError();
    }
  }
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
  const emailVerified = token.email_verified;
  const now = Math.floor(nowMilliseconds / 1_000);
  if (typeof userId !== 'string'
    || userId.length === 0
    || Buffer.byteLength(userId, 'utf8') > 128
    || CONTROL_CHARACTER.test(userId)
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
  if (emailVerified !== undefined && typeof emailVerified !== 'boolean') {
    throw apiError('invalid_firebase_token');
  }
  let verifiedEmail: string | null = null;
  if (emailVerified === true) {
    const email = token.email;
    if (typeof email !== 'string'
      || email.length === 0
      || Buffer.byteLength(email, 'utf8') > 320
      || CONTROL_CHARACTER.test(email)) {
      throw apiError('invalid_firebase_token');
    }
    verifiedEmail = email;
  }
  return Object.freeze({ userId, verifiedEmail, authenticatedAt, expiresAt });
}

export async function authenticateFirebase(
  verifier: FirebaseTokenVerifier,
  authorization: string | string[] | undefined,
  nowMilliseconds: number,
): Promise<FirebasePrincipal> {
  try {
    const decoded = await verifier.verifyIdToken(bearerToken(authorization));
    return firebasePrincipalFromDecodedToken(decoded, nowMilliseconds);
  } catch (error) {
    if (error instanceof FirebaseTokenDependencyError) {
      throw apiError('temporarily_unavailable');
    }
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
