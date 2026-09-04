import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

import { type JsonValue, parseRequestJson } from './json.js';
import type { SigningPublicJwk } from './types.js';

const ENVIRONMENT_ISSUERS = Object.freeze({
  'demo-miakapp-v4': 'https://control.example.test',
  'miakapp-v4-staging': 'https://control.staging.miakapp.com',
  'miakapp-v4': 'https://control.miakapp.com',
} as const);
const MAX_TOKEN_BYTES = 8_192;
const MAX_AUTHORIZATION_BYTES = MAX_TOKEN_BYTES + 'Bearer '.length;
const MAX_HEADER_BYTES = 2_048;
const MAX_CLAIMS_BYTES = 12_288;
const MAX_SIGNATURE_BYTES = 512;
const MAX_KID_BYTES = 128;
const MAX_SIGNING_KEYS = 16;
const ACCESS_TOKEN_TTL_SECONDS = 300;
const FUTURE_IAT_TOLERANCE_SECONDS = 30;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const GRAPHIC_ASCII = /^[\x21-\x7e]+$/;
const HOME_ID = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;

export interface AccessTokenVerificationClock {
  now(): number;
}

interface AccessTokenVerifierBaseConfig {
  readonly projectId: string;
  readonly issuer: string;
  readonly signingPublicJwks: readonly SigningPublicJwk[];
}

export interface PushAccessTokenVerifierConfig extends AccessTokenVerifierBaseConfig {
  readonly pushAudience: string;
}

export interface ComponentAccessTokenVerifierConfig extends AccessTokenVerifierBaseConfig {
  readonly componentsAudience: string;
}

export interface VerifiedAccessPrincipal {
  readonly homeId: string;
  readonly clientId: string;
  readonly expiresAt: number;
}

export type VerifiedPushAccessPrincipal = VerifiedAccessPrincipal;
export type VerifiedComponentAccessPrincipal = VerifiedAccessPrincipal;

export class AccessTokenVerificationError extends Error {
  readonly code = 'invalid_access_token' as const;

  constructor() {
    super('Authentication failed');
    this.name = 'AccessTokenVerificationError';
  }
}

interface ParsedToken {
  readonly header: { readonly [key: string]: JsonValue };
  readonly claims: { readonly [key: string]: JsonValue };
  readonly signature: Uint8Array;
  readonly signingInput: Buffer;
}

interface ValidatedEd25519Key {
  readonly jwk: JsonWebKey;
  readonly kid: string;
}

function fail(): never {
  throw new AccessTokenVerificationError();
}

function jsonObject(value: JsonValue): { readonly [key: string]: JsonValue } {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail();
  return value;
}

function decodeCanonicalBase64url(value: string, maximumBytes: number): Uint8Array | undefined {
  if (value.length === 0 || !BASE64URL.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength > maximumBytes || decoded.toString('base64url') !== value) return undefined;
  return decoded;
}

function decodeTokenSegment(segment: string, maximumBytes: number): Uint8Array {
  const decoded = decodeCanonicalBase64url(segment, maximumBytes);
  if (decoded === undefined) fail();
  return decoded;
}

function parseToken(token: string): ParsedToken {
  if (token.length === 0
    || Buffer.byteLength(token, 'ascii') > MAX_TOKEN_BYTES
    || !GRAPHIC_ASCII.test(token)) {
    fail();
  }
  const segments = token.split('.');
  if (segments.length !== 3) fail();
  const [headerSegment, claimsSegment, signatureSegment] = segments;
  if (headerSegment === undefined || claimsSegment === undefined || signatureSegment === undefined) fail();

  try {
    return {
      header: jsonObject(parseRequestJson(decodeTokenSegment(headerSegment, MAX_HEADER_BYTES))),
      claims: jsonObject(parseRequestJson(decodeTokenSegment(claimsSegment, MAX_CLAIMS_BYTES))),
      signature: decodeTokenSegment(signatureSegment, MAX_SIGNATURE_BYTES),
      signingInput: Buffer.from(`${headerSegment}.${claimsSegment}`, 'ascii'),
    };
  } catch (error) {
    if (error instanceof AccessTokenVerificationError) throw error;
    fail();
  }
}

function bearerToken(authorization: string | readonly string[] | undefined): string {
  if (typeof authorization !== 'string'
    || Buffer.byteLength(authorization, 'utf8') > MAX_AUTHORIZATION_BYTES) {
    fail();
  }
  const match = /^Bearer ([\x21-\x7e]+)$/.exec(authorization);
  const token = match?.[1];
  if (token === undefined || Buffer.byteLength(token, 'ascii') > MAX_TOKEN_BYTES) fail();
  return token;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validatedClockSeconds(clock: AccessTokenVerificationClock): number {
  const milliseconds = clock.now();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error('Access-token verification clock is invalid');
  }
  return Math.floor(milliseconds / 1_000);
}

function validatedSigningKeys(
  keys: readonly SigningPublicJwk[],
): readonly ValidatedEd25519Key[] {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_SIGNING_KEYS) {
    throw new Error('Access-token verification public keys are invalid');
  }
  const kids = new Set<string>();
  const validated: ValidatedEd25519Key[] = [];
  for (const key of keys) {
    if (key === null
      || typeof key !== 'object'
      || Array.isArray(key)
      || !hasExactKeys(key, ['kty', 'crv', 'x', 'use', 'alg', 'kid'])
      || key.kty !== 'OKP'
      || key.crv !== 'Ed25519'
      || key.use !== 'sig'
      || key.alg !== 'EdDSA'
      || typeof key.x !== 'string'
      || decodeCanonicalBase64url(key.x, 32)?.byteLength !== 32
      || typeof key.kid !== 'string'
      || Buffer.byteLength(key.kid, 'ascii') > MAX_KID_BYTES
      || !GRAPHIC_ASCII.test(key.kid)
      || kids.has(key.kid)) {
      throw new Error('Access-token verification public keys are invalid');
    }
    kids.add(key.kid);
    validated.push({
      kid: key.kid,
      jwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: key.x,
        use: 'sig',
        alg: 'EdDSA',
        kid: key.kid,
      },
    });
  }
  return Object.freeze(validated);
}

export function assertSigningKeyPublication(config: {
  readonly signingPublicJwk: SigningPublicJwk;
  readonly signingPublicJwks: readonly SigningPublicJwk[];
}): void {
  validatedSigningKeys(config.signingPublicJwks);
  const active = config.signingPublicJwk;
  const keyFields = ['kty', 'crv', 'x', 'use', 'alg', 'kid'] as const;
  if (active === null
    || typeof active !== 'object'
    || Array.isArray(active)
    || !hasExactKeys(active, keyFields)
    || config.signingPublicJwks.filter((candidate) => (
      keyFields.every((field) => candidate[field] === active[field])
    )).length !== 1) {
    throw new Error('Access-token signing key publication is invalid');
  }
}

function validateConfig(
  config: AccessTokenVerifierBaseConfig,
  audience: string,
  scope: 'push:send' | 'components:publish',
): readonly ValidatedEd25519Key[] {
  const expectedIssuer = ENVIRONMENT_ISSUERS[
    config.projectId as keyof typeof ENVIRONMENT_ISSUERS
  ];
  if (expectedIssuer === undefined
    || config.issuer !== expectedIssuer
    || Buffer.byteLength(config.issuer, 'utf8') > 2_048
    || !GRAPHIC_ASCII.test(config.issuer)
    || audience !== `${expectedIssuer}${scope === 'push:send' ? '/v1/push' : '/v1/components'}`) {
    throw new Error('Access-token verification configuration is invalid');
  }

  return validatedSigningKeys(config.signingPublicJwks);
}

function verifyAccessToken(
  authorizationHeader: string | readonly string[] | undefined,
  config: AccessTokenVerifierBaseConfig,
  audience: string,
  scope: 'push:send' | 'components:publish',
  clock: AccessTokenVerificationClock,
): VerifiedAccessPrincipal {
  const keys = validateConfig(config, audience, scope);
  const now = validatedClockSeconds(clock);
  const parsed = parseToken(bearerToken(authorizationHeader));

  if (!hasExactKeys(parsed.header, ['alg', 'kid', 'typ'])
    || parsed.header.alg !== 'EdDSA'
    || parsed.header.typ !== 'at+jwt') {
    fail();
  }
  const key = keys.find((candidate) => candidate.kid === parsed.header.kid);
  if (key === undefined) fail();
  verifyTokenSignature(parsed, key);

  const claims = parsed.claims;
  if (!hasExactKeys(claims, ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'client_id', 'scope'])
    || claims.iss !== config.issuer
    || claims.aud !== audience
    || claims.scope !== scope) {
    fail();
  }
  const homeId = claims.sub;
  const clientId = canonicalIdentifier(claims.client_id);
  const tokenId = canonicalIdentifier(claims.jti);
  const issuedAt = claims.iat;
  const expiresAt = claims.exp;
  if (typeof homeId !== 'string'
    || Buffer.byteLength(homeId, 'utf8') > 63
    || !HOME_ID.test(homeId)
    || clientId === undefined
    || tokenId === undefined
    || typeof issuedAt !== 'number'
    || !Number.isSafeInteger(issuedAt)
    || issuedAt < 0
    || typeof expiresAt !== 'number'
    || !Number.isSafeInteger(expiresAt)
    || expiresAt < 0
    || expiresAt <= now
    || issuedAt > now + FUTURE_IAT_TOLERANCE_SECONDS
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > ACCESS_TOKEN_TTL_SECONDS
    || expiresAt > now + ACCESS_TOKEN_TTL_SECONDS) {
    fail();
  }

  return Object.freeze({ homeId, clientId, expiresAt });
}

function verifyTokenSignature(parsed: ParsedToken, key: ValidatedEd25519Key): void {
  if (parsed.signature.byteLength !== 64) fail();
  let accepted = false;
  try {
    accepted = verify(
      null,
      parsed.signingInput,
      createPublicKey({ key: key.jwk, format: 'jwk' }),
      parsed.signature,
    );
  } catch {
    fail();
  }
  if (!accepted) fail();
}

function canonicalIdentifier(value: JsonValue | undefined): string | undefined {
  if (typeof value !== 'string' || value.length !== 22) return undefined;
  return decodeCanonicalBase64url(value, 16)?.byteLength === 16 ? value : undefined;
}

/**
 * Verifies one complete Authorization header against the closed push-token profile.
 */
export function verifyPushAccessToken(
  authorizationHeader: string | readonly string[] | undefined,
  config: PushAccessTokenVerifierConfig,
  clock: AccessTokenVerificationClock,
): VerifiedPushAccessPrincipal {
  return verifyAccessToken(
    authorizationHeader,
    config,
    config.pushAudience,
    'push:send',
    clock,
  );
}

/**
 * Verifies one complete Authorization header against the closed component-publisher profile.
 */
export function verifyComponentAccessToken(
  authorizationHeader: string | readonly string[] | undefined,
  config: ComponentAccessTokenVerifierConfig,
  clock: AccessTokenVerificationClock,
): VerifiedComponentAccessPrincipal {
  return verifyAccessToken(
    authorizationHeader,
    config,
    config.componentsAudience,
    'components:publish',
    clock,
  );
}
