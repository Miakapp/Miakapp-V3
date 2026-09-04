import {
  createHmac,
  createPrivateKey,
  randomBytes,
  sign as nodeSign,
  timingSafeEqual,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

import { apiError } from './errors.js';
import {
  HOME_KEY_PATTERN,
  type AccessGrant,
  type SigningPublicJwk,
} from './types.js';

function canonicalBase64url(value: string, bytes: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw apiError('invalid_home_key');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength !== bytes || decoded.toString('base64url') !== value) {
    throw apiError('invalid_home_key');
  }
  return decoded;
}

export function randomIdentifier(): string {
  return randomBytes(16).toString('base64url');
}

export interface GeneratedHomeKey {
  readonly value: string;
  readonly keyId: string;
}

export function generateHomeKey(): GeneratedHomeKey {
  const keyId = randomIdentifier();
  const secret = randomBytes(32).toString('base64url');
  return Object.freeze({ value: `mhk1_${keyId}_${secret}`, keyId });
}

export function parseHomeKey(value: string): { readonly keyId: string } {
  const match = HOME_KEY_PATTERN.exec(value);
  const keyId = match?.[1];
  const secret = match?.[2];
  if (keyId === undefined || secret === undefined) throw apiError('invalid_home_key');
  canonicalBase64url(keyId, 16);
  canonicalBase64url(secret, 32);
  return Object.freeze({ keyId });
}

export function deriveHomeKeyVerifier(homeKey: string, pepper: Uint8Array): string {
  parseHomeKey(homeKey);
  if (pepper.byteLength !== 32) throw new Error('Home Key pepper must contain 32 bytes');
  return createHmac('sha256', pepper).update(homeKey, 'ascii').digest('base64url');
}

export function homeKeyVerifierMatches(
  homeKey: string,
  pepper: Uint8Array,
  expectedVerifier: unknown,
): boolean {
  if (typeof expectedVerifier !== 'string') return false;
  let calculated: Buffer;
  let expected: Buffer;
  try {
    calculated = Buffer.from(deriveHomeKeyVerifier(homeKey, pepper), 'base64url');
    expected = Buffer.from(expectedVerifier, 'base64url');
  } catch {
    return false;
  }
  return calculated.byteLength === expected.byteLength && timingSafeEqual(calculated, expected);
}

export interface SignedAccessToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface AccessTokenSigningConfig {
  readonly issuer: string;
  readonly signingPublicJwk: SigningPublicJwk;
}

export interface LocalAccessTokenSigningConfig extends AccessTokenSigningConfig {
  readonly signingPrivateJwk: JsonWebKey & { readonly kid: string };
}

export interface PreparedAccessToken {
  readonly signingInput: string;
  readonly expiresAtMs: number;
}

export function prepareAccessToken(
  config: AccessTokenSigningConfig,
  grant: AccessGrant,
): PreparedAccessToken {
  const issuedAt = grant.issuedAt;
  const expiresAt = issuedAt + 300;
  const header = {
    alg: 'EdDSA',
    kid: config.signingPublicJwk.kid,
    typ: 'at+jwt',
  };
  let claims: Record<string, string | number>;
  if (grant.subjectKind === 'firebase_user') {
    claims = {
      iss: config.issuer,
      sub: grant.userId,
      aud: grant.audience,
      exp: expiresAt,
      iat: issuedAt,
      jti: grant.tokenId,
      scope: grant.scope,
      miakapp_home: grant.homeId,
      miakapp_role: grant.role,
    };
    if (grant.verifiedEmail !== null) claims.miakapp_verified_email = grant.verifiedEmail;
  } else {
    claims = {
      iss: config.issuer,
      sub: grant.homeId,
      aud: grant.audience,
      exp: expiresAt,
      iat: issuedAt,
      jti: grant.tokenId,
      client_id: grant.clientId,
      scope: grant.scope,
    };
    if (grant.role !== null) claims.miakapp_role = grant.role;
    if (grant.coordinatorName !== null) claims.miakapp_coordinator = grant.coordinatorName;
  }
  const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const encodedClaims = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return Object.freeze({
    signingInput: `${encodedHeader}.${encodedClaims}`,
    expiresAtMs: expiresAt * 1_000,
  });
}

export function serializeAccessToken(
  prepared: PreparedAccessToken,
  signature: Uint8Array,
): SignedAccessToken {
  if (signature.byteLength !== 64) throw new Error('Ed25519 signature must contain 64 bytes');
  return Object.freeze({
    token: `${prepared.signingInput}.${Buffer.from(signature).toString('base64url')}`,
    expiresAtMs: prepared.expiresAtMs,
  });
}

export class AccessTokenSigner {
  readonly #config: AccessTokenSigningConfig;
  readonly #privateKey: KeyObject;

  constructor(config: LocalAccessTokenSigningConfig) {
    this.#config = config;
    this.#privateKey = createPrivateKey({ key: config.signingPrivateJwk, format: 'jwk' });
  }

  sign(grant: AccessGrant): SignedAccessToken {
    const prepared = prepareAccessToken(this.#config, grant);
    const signature = nodeSign(null, Buffer.from(prepared.signingInput, 'ascii'), this.#privateKey);
    return serializeAccessToken(prepared, signature);
  }
}
