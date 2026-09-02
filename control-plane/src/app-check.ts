import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

import { type JsonValue, parseRequestJson } from './json.js';

const EMULATOR_PROJECT = 'demo-miakapp-v4';
const MAX_TOKEN_BYTES = 8_192;
const MAX_HEADER_BYTES = 2_048;
const MAX_CLAIMS_BYTES = 12_288;
const MAX_SIGNATURE_BYTES = 512;
const MAX_KID_BYTES = 128;
const MAX_AUDIENCES = 8;
const MAX_AUDIENCE_BYTES = 256;
const MAX_APP_CHECK_TTL_SECONDS = 7 * 24 * 60 * 60;
const FUTURE_IAT_TOLERANCE_SECONDS = 30;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const GRAPHIC_ASCII = /^[\x21-\x7e]+$/;

export interface AppCheckVerificationClock {
  now(): number;
}

export interface SyntheticAppCheckVerifierConfig {
  readonly projectId: string;
  readonly appCheckAppId: string;
  readonly appCheckIssuer: string;
  readonly appCheckAudience: string;
  readonly appCheckPublicJwk: JsonWebKey & { readonly kid: string };
}

export interface VerifiedSyntheticAppCheckPrincipal {
  readonly appId: string;
  readonly expiresAt: number;
}

export type VerifiedAppCheckPrincipal = VerifiedSyntheticAppCheckPrincipal;

export interface AppCheckVerifier {
  verifyToken(
    headerToken: string | readonly string[] | undefined,
  ): Promise<VerifiedAppCheckPrincipal>;
}

export interface FirebaseAdminAppCheckClient {
  verifyToken(token: string): Promise<Readonly<{
    readonly appId?: string;
    readonly token?: Readonly<{ readonly exp?: number }>;
  }>>;
}

export class AppCheckVerificationError extends Error {
  readonly code = 'invalid_app_check_token' as const;

  constructor() {
    super('Application verification failed');
    this.name = 'AppCheckVerificationError';
  }
}

export class AppCheckDependencyError extends Error {
  constructor() {
    super('Application verification dependency is unavailable');
    this.name = 'AppCheckDependencyError';
  }
}

interface ParsedToken {
  readonly header: { readonly [key: string]: JsonValue };
  readonly claims: { readonly [key: string]: JsonValue };
  readonly signature: Uint8Array;
  readonly signingInput: Buffer;
}

interface ValidatedRsaKey {
  readonly jwk: JsonWebKey;
  readonly kid: string;
  readonly modulusBytes: number;
}

function fail(): never {
  throw new AppCheckVerificationError();
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

function parseToken(token: unknown): ParsedToken {
  if (typeof token !== 'string'
    || token.length === 0
    || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES
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
    if (error instanceof AppCheckVerificationError) throw error;
    fail();
  }
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validatedClockSeconds(clock: AppCheckVerificationClock): number {
  const milliseconds = clock.now();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error('Synthetic App Check verification clock is invalid');
  }
  return Math.floor(milliseconds / 1_000);
}

function validateConfig(config: SyntheticAppCheckVerifierConfig): ValidatedRsaKey {
  if (config.projectId !== EMULATOR_PROJECT) {
    throw new Error('Synthetic App Check verification is restricted to the demo Firebase Emulator project');
  }
  if (typeof config.appCheckIssuer !== 'string'
    || !/^https:\/\/firebaseappcheck\.googleapis\.com\/[1-9][0-9]{0,19}$/.test(config.appCheckIssuer)
    || typeof config.appCheckAudience !== 'string'
    || !/^projects\/[1-9][0-9]{0,19}$/.test(config.appCheckAudience)
    || config.appCheckAudience.slice('projects/'.length)
      !== config.appCheckIssuer.slice(config.appCheckIssuer.lastIndexOf('/') + 1)
    || typeof config.appCheckAppId !== 'string'
    || Buffer.byteLength(config.appCheckAppId, 'utf8') > 128
    || !GRAPHIC_ASCII.test(config.appCheckAppId)) {
    throw new Error('Synthetic App Check verification configuration is invalid');
  }

  const key = config.appCheckPublicJwk;
  if (!hasExactKeys(key, ['kty', 'n', 'e', 'use', 'alg', 'kid'])
    || key.kty !== 'RSA'
    || key.use !== 'sig'
    || key.alg !== 'RS256'
    || typeof key.n !== 'string'
    || typeof key.e !== 'string'
    || typeof key.kid !== 'string'
    || Buffer.byteLength(key.kid, 'ascii') > MAX_KID_BYTES
    || !GRAPHIC_ASCII.test(key.kid)) {
    throw new Error('Synthetic App Check public key is invalid');
  }
  const modulus = decodeCanonicalBase64url(key.n, MAX_SIGNATURE_BYTES);
  const exponentBytes = decodeCanonicalBase64url(key.e, 4);
  const firstModulusByte = modulus?.[0];
  const modulusBits = modulus === undefined || firstModulusByte === undefined
    ? 0
    : (modulus.byteLength - 1) * 8 + 32 - Math.clz32(firstModulusByte);
  const exponent = exponentBytes?.reduce((value, byte) => value * 256 + byte, 0);
  if (modulus === undefined
    || firstModulusByte === undefined
    || firstModulusByte === 0
    || modulusBits < 2_048
    || modulusBits > 4_096
    || exponentBytes === undefined
    || exponentBytes.byteLength === 0
    || exponent === undefined
    || exponent < 3
    || exponent % 2 === 0) {
    throw new Error('Synthetic App Check public key is invalid');
  }

  return {
    kid: key.kid,
    modulusBytes: modulus.byteLength,
    jwk: {
      kty: 'RSA',
      n: key.n,
      e: key.e,
      use: 'sig',
      alg: 'RS256',
      kid: key.kid,
    },
  };
}

function verifyTokenSignature(parsed: ParsedToken, key: ValidatedRsaKey): void {
  if (parsed.signature.byteLength !== key.modulusBytes) fail();
  let accepted = false;
  try {
    accepted = verify(
      'RSA-SHA256',
      parsed.signingInput,
      createPublicKey({ key: key.jwk, format: 'jwk' }),
      parsed.signature,
    );
  } catch {
    fail();
  }
  if (!accepted) fail();
}

function validAudience(value: JsonValue | undefined, expected: string): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AUDIENCES) return false;
  const audiences = new Set<string>();
  for (const audience of value) {
    if (typeof audience !== 'string'
      || Buffer.byteLength(audience, 'utf8') > MAX_AUDIENCE_BYTES
      || !GRAPHIC_ASCII.test(audience)
      || audiences.has(audience)) {
      return false;
    }
    audiences.add(audience);
  }
  return audiences.has(expected);
}

/**
 * Verifies one raw X-Firebase-AppCheck header value against the emulator-only key.
 */
export function verifySyntheticAppCheckToken(
  headerToken: string | readonly string[] | undefined,
  config: SyntheticAppCheckVerifierConfig,
  clock: AppCheckVerificationClock,
): VerifiedSyntheticAppCheckPrincipal {
  const key = validateConfig(config);
  const now = validatedClockSeconds(clock);
  const parsed = parseToken(headerToken);

  if (!hasExactKeys(parsed.header, ['alg', 'kid', 'typ'])
    || parsed.header.alg !== 'RS256'
    || parsed.header.typ !== 'JWT'
    || parsed.header.kid !== key.kid) {
    fail();
  }
  verifyTokenSignature(parsed, key);

  const issuedAt = parsed.claims.iat;
  const expiresAt = parsed.claims.exp;
  if (parsed.claims.iss !== config.appCheckIssuer
    || parsed.claims.sub !== config.appCheckAppId
    || !validAudience(parsed.claims.aud, config.appCheckAudience)
    || typeof issuedAt !== 'number'
    || !Number.isSafeInteger(issuedAt)
    || issuedAt < 0
    || typeof expiresAt !== 'number'
    || !Number.isSafeInteger(expiresAt)
    || expiresAt < 0
    || expiresAt <= now
    || issuedAt > now + FUTURE_IAT_TOLERANCE_SECONDS
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_APP_CHECK_TTL_SECONDS
    || expiresAt > now + MAX_APP_CHECK_TTL_SECONDS) {
    fail();
  }

  return Object.freeze({ appId: config.appCheckAppId, expiresAt });
}

export class SyntheticAppCheckVerifier implements AppCheckVerifier {
  readonly #config: SyntheticAppCheckVerifierConfig;
  readonly #clock: AppCheckVerificationClock;

  constructor(config: SyntheticAppCheckVerifierConfig, clock: AppCheckVerificationClock) {
    this.#config = config;
    this.#clock = clock;
  }

  async verifyToken(
    headerToken: string | readonly string[] | undefined,
  ): Promise<VerifiedAppCheckPrincipal> {
    return verifySyntheticAppCheckToken(headerToken, this.#config, this.#clock);
  }
}

export class FirebaseAdminAppCheckVerifier implements AppCheckVerifier {
  readonly #client: FirebaseAdminAppCheckClient;
  readonly #expectedAppId: string;

  constructor(client: FirebaseAdminAppCheckClient, expectedAppId: string) {
    if (expectedAppId.length === 0
      || Buffer.byteLength(expectedAppId, 'utf8') > 128
      || !GRAPHIC_ASCII.test(expectedAppId)) {
      throw new Error('Firebase App Check verification configuration is invalid');
    }
    this.#client = client;
    this.#expectedAppId = expectedAppId;
  }

  async verifyToken(
    headerToken: string | readonly string[] | undefined,
  ): Promise<VerifiedAppCheckPrincipal> {
    if (typeof headerToken !== 'string'
      || headerToken.length === 0
      || Buffer.byteLength(headerToken, 'utf8') > MAX_TOKEN_BYTES
      || !GRAPHIC_ASCII.test(headerToken)) {
      fail();
    }
    let result: Awaited<ReturnType<FirebaseAdminAppCheckClient['verifyToken']>>;
    try {
      result = await this.#client.verifyToken(headerToken);
    } catch (error) {
      const code = error !== null
        && typeof error === 'object'
        && 'code' in error
        && typeof error.code === 'string'
        ? error.code
        : undefined;
      const causeCode = error !== null
        && typeof error === 'object'
        && 'cause' in error
        && error.cause !== null
        && typeof error.cause === 'object'
        && 'code' in error.cause
        && typeof error.cause.code === 'string'
        ? error.cause.code
        : undefined;
      if ((code === 'app-check/invalid-argument'
          || code === 'app-check/app-check-token-expired')
        && causeCode !== 'key-fetch-error') {
        return fail();
      }
      throw new AppCheckDependencyError();
    }
    const expiresAt = result.token?.exp;
    if (result.appId !== this.#expectedAppId) return fail();
    if (typeof expiresAt !== 'number'
      || !Number.isSafeInteger(expiresAt)
      || expiresAt < 0) {
      throw new AppCheckDependencyError();
    }
    return Object.freeze({ appId: result.appId, expiresAt });
  }
}
