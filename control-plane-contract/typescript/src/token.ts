import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

import {
  ContractViolation,
  type JsonValue,
  objectValue,
  parseBoundedJson,
} from './json.js';
import {
  type AccessIdentity,
  type AccessProfile,
  type AccessTokenFixture,
  type FirebaseIdentity,
  HOME_ID_PATTERN,
  COORDINATOR_NAME_PATTERN,
  type PublicJwk,
  type TokenErrorCode,
  decodeCanonicalBase64url,
} from './profile.js';

export class TokenVerificationError extends Error {
  readonly code: TokenErrorCode;

  constructor(code: TokenErrorCode) {
    super(code);
    this.name = 'TokenVerificationError';
    this.code = code;
  }
}

const TOKEN_JSON_LIMITS = Object.freeze({
  maximumBytes: 16_384,
  maximumDepth: 16,
  maximumValues: 2_048,
  maximumStringBytes: 4_096,
  maximumArrayItems: 256,
  maximumObjectEntries: 256,
});
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

interface ParsedToken {
  header: { [key: string]: JsonValue };
  claims: { [key: string]: JsonValue };
  signature: Uint8Array;
  signingInput: Buffer;
}

function fail(code: TokenErrorCode): never {
  throw new TokenVerificationError(code);
}

function decodeSegment(segment: string, maximumBytes: number): Uint8Array {
  if (segment.length === 0 || !BASE64URL.test(segment)) fail('malformed_token');
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.byteLength > maximumBytes || bytes.toString('base64url') !== segment) {
    fail('malformed_token');
  }
  return bytes;
}

function parseToken(token: string): ParsedToken {
  if (typeof token !== 'string'
    || token.length === 0
    || token.length > 8_192
    || /[^\x21-\x7e]/.test(token)) {
    fail('malformed_token');
  }
  const segments = token.split('.');
  if (segments.length !== 3) fail('malformed_token');
  const headerSegment = segments[0];
  const claimsSegment = segments[1];
  const signatureSegment = segments[2];
  if (headerSegment === undefined || claimsSegment === undefined || signatureSegment === undefined) {
    fail('malformed_token');
  }
  try {
    const header = objectValue(
      parseBoundedJson(decodeSegment(headerSegment, 2_048), TOKEN_JSON_LIMITS),
      'JWT header',
    );
    const claims = objectValue(
      parseBoundedJson(decodeSegment(claimsSegment, 12_288), TOKEN_JSON_LIMITS),
      'JWT claims',
    );
    return {
      header,
      claims,
      signature: decodeSegment(signatureSegment, 512),
      signingInput: Buffer.from(`${headerSegment}.${claimsSegment}`, 'ascii'),
    };
  } catch (error) {
    if (error instanceof TokenVerificationError) throw error;
    fail('malformed_token');
  }
}

function exactKeys(
  value: { [key: string]: JsonValue },
  required: readonly string[],
  optional: readonly string[],
  error: TokenErrorCode,
): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value))) fail(error);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(error);
}

function stringClaim(value: JsonValue | undefined, maximumBytes = 4_096): string {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || CONTROL_CHARACTER.test(value)) {
    fail('invalid_claims');
  }
  return value;
}

function integerClaim(value: JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('invalid_claims');
  return value;
}

function selectKey(keys: readonly PublicJwk[], kid: JsonValue | undefined): PublicJwk {
  if (typeof kid !== 'string' || kid.length === 0 || kid.length > 128) fail('invalid_header');
  const selected = keys.find((key) => key.kid === kid);
  if (selected === undefined) fail('unknown_kid');
  return selected;
}

function verifySignature(parsed: ParsedToken, key: PublicJwk, kind: 'miakapp' | 'firebase'): void {
  if (kind === 'miakapp') {
    if (key.kty !== 'OKP'
      || key.crv !== 'Ed25519'
      || key.use !== 'sig'
      || key.alg !== 'EdDSA'
      || key.x === undefined
      || parsed.signature.byteLength !== 64) {
      fail('invalid_header');
    }
  } else {
    if (key.kty !== 'RSA'
      || key.use !== 'sig'
      || key.alg !== 'RS256'
      || key.n === undefined
      || key.e === undefined) {
      fail('invalid_header');
    }
    let modulusBytes: Uint8Array;
    let exponentBytes: Uint8Array;
    try {
      modulusBytes = decodeCanonicalBase64url(key.n, 'RSA modulus');
      exponentBytes = decodeCanonicalBase64url(key.e, 'RSA exponent');
    } catch {
      fail('invalid_header');
    }
    const firstModulusByte = modulusBytes[0];
    const modulusBits = firstModulusByte === undefined
      ? 0
      : modulusBytes.byteLength * 8 - Math.clz32(firstModulusByte) + 24;
    const exponent = exponentBytes.reduce((value, byte) => value * 256 + byte, 0);
    if (modulusBits < 2_048
      || modulusBits > 4_096
      || firstModulusByte === 0
      || exponentBytes.byteLength === 0
      || exponentBytes.byteLength > 4
      || exponent < 3
      || exponent % 2 === 0
      || parsed.signature.byteLength !== modulusBytes.byteLength) {
      fail('invalid_header');
    }
  }
  let accepted = false;
  try {
    const publicKey: JsonWebKey = key.kty === 'OKP'
      ? {
        kty: key.kty,
        crv: 'Ed25519',
        x: key.x as string,
        use: key.use,
        alg: 'EdDSA',
        kid: key.kid,
      }
      : {
        kty: key.kty,
        n: key.n as string,
        e: key.e as string,
        use: key.use,
        alg: 'RS256',
        kid: key.kid,
      };
    accepted = verify(
      kind === 'miakapp' ? null : 'RSA-SHA256',
      parsed.signingInput,
      createPublicKey({ key: publicKey, format: 'jwk' }),
      parsed.signature,
    );
  } catch {
    fail('invalid_signature');
  }
  if (!accepted) fail('invalid_signature');
}

function validateCommonAccessClaims(
  claims: { [key: string]: JsonValue },
  fixture: AccessTokenFixture,
  profile: AccessProfile,
): {
  homeId: string;
  clientId: string;
  scope: Exclude<AccessIdentity['scope'], 'relay:user'>;
  expiresAt: number;
} {
  const expectedAudience = profile === 'coordinator' || profile === 'cli'
    ? fixture.deployment.relay_audience
    : profile === 'push'
      ? fixture.deployment.push_audience
      : fixture.deployment.components_audience;
  if (claims.iss !== fixture.deployment.issuer) fail('invalid_issuer');
  if (claims.aud !== expectedAudience) fail('invalid_audience');
  const issuedAt = integerClaim(claims.iat);
  const expiresAt = integerClaim(claims.exp);
  if (expiresAt <= fixture.now) fail('expired');
  if (issuedAt > fixture.now + 30
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > 300
    || expiresAt > fixture.now + 300) {
    fail('invalid_time');
  }
  const homeId = stringClaim(claims.sub, 63);
  if (!HOME_ID_PATTERN.test(homeId)) fail('invalid_claims');
  const clientId = stringClaim(claims.client_id, 22);
  const jti = stringClaim(claims.jti, 22);
  try {
    decodeCanonicalBase64url(clientId, 'client_id', 16);
    decodeCanonicalBase64url(jti, 'jti', 16);
  } catch {
    fail('invalid_claims');
  }
  const expectedScope = profile === 'coordinator'
    ? 'relay:coordinator'
    : profile === 'cli'
      ? 'relay:cli'
      : profile === 'push'
        ? 'push:send'
        : 'components:publish';
  if (claims.scope !== expectedScope) {
    if (typeof claims.scope === 'string' && claims.scope.includes(' ')) fail('invalid_scope');
    fail('invalid_profile');
  }
  return { homeId, clientId, scope: expectedScope, expiresAt };
}

function verifyUserAccessClaims(
  claims: { [key: string]: JsonValue },
  fixture: AccessTokenFixture,
): AccessIdentity {
  const common = ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'scope', 'miakapp_home', 'miakapp_role'];
  exactKeys(claims, common, ['miakapp_verified_email'], 'invalid_claims');
  if (claims.iss !== fixture.deployment.issuer) fail('invalid_issuer');
  if (claims.aud !== fixture.deployment.relay_audience) fail('invalid_audience');
  const issuedAt = integerClaim(claims.iat);
  const expiresAt = integerClaim(claims.exp);
  if (expiresAt <= fixture.now) fail('expired');
  if (issuedAt > fixture.now + 30
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > 300
    || expiresAt > fixture.now + 300) {
    fail('invalid_time');
  }
  const tokenId = stringClaim(claims.jti, 22);
  try {
    decodeCanonicalBase64url(tokenId, 'jti', 16);
  } catch {
    fail('invalid_claims');
  }
  if (claims.scope !== 'relay:user') {
    if (typeof claims.scope === 'string' && claims.scope.includes(' ')) fail('invalid_scope');
    fail('invalid_profile');
  }
  if (claims.miakapp_role !== 'user') fail('invalid_profile');
  const homeId = stringClaim(claims.miakapp_home, 63);
  if (!HOME_ID_PATTERN.test(homeId)) fail('invalid_claims');
  const principalId = stringClaim(claims.sub, 128);
  const verifiedEmail = claims.miakapp_verified_email === undefined
    ? null
    : stringClaim(claims.miakapp_verified_email, 320);
  return Object.freeze({
    home_id: homeId,
    principal_id: principalId,
    scope: 'relay:user',
    expires_at: expiresAt,
    role: 'user',
    verified_email: verifiedEmail,
  });
}

export function verifyMiakappAccessToken(
  token: string,
  fixture: AccessTokenFixture,
  profile: AccessProfile,
  keys: readonly PublicJwk[],
): AccessIdentity {
  const parsed = parseToken(token);
  exactKeys(parsed.header, ['alg', 'kid', 'typ'], [], 'invalid_header');
  if (parsed.header.alg !== 'EdDSA' || parsed.header.typ !== 'at+jwt') fail('invalid_header');
  const key = selectKey(keys, parsed.header.kid);
  verifySignature(parsed, key, 'miakapp');

  if (profile === 'user') return verifyUserAccessClaims(parsed.claims, fixture);

  const validated = validateCommonAccessClaims(parsed.claims, fixture, profile);
  const common = ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'client_id', 'scope'];
  if (profile === 'coordinator') {
    exactKeys(parsed.claims, common, ['miakapp_role', 'miakapp_coordinator'], 'invalid_claims');
  } else if (profile === 'cli') {
    exactKeys(parsed.claims, common, ['miakapp_role'], 'invalid_claims');
  } else {
    exactKeys(parsed.claims, common, [], 'invalid_claims');
  }

  let role: AccessIdentity['role'] = null;
  let coordinatorName: string | null = null;
  if (profile === 'coordinator') {
    if (parsed.claims.miakapp_role !== 'coordinator') fail('invalid_profile');
    const candidate = parsed.claims.miakapp_coordinator;
    if (typeof candidate !== 'string'
      || Buffer.byteLength(candidate, 'utf8') > 64
      || CONTROL_CHARACTER.test(candidate)
      || !COORDINATOR_NAME_PATTERN.test(candidate)) fail('invalid_profile');
    coordinatorName = candidate;
    role = 'coordinator';
  } else if (profile === 'cli') {
    if (parsed.claims.miakapp_role !== 'cli') fail('invalid_profile');
    role = 'cli';
  }

  return Object.freeze({
    home_id: validated.homeId,
    principal_id: validated.homeId,
    client_id: validated.clientId,
    scope: validated.scope,
    expires_at: validated.expiresAt,
    role,
    coordinator_name: coordinatorName,
  });
}

export function verifyFirebaseIdToken(
  token: string,
  fixture: AccessTokenFixture,
  keys: readonly PublicJwk[],
): FirebaseIdentity {
  const parsed = parseToken(token);
  exactKeys(parsed.header, ['alg', 'kid'], ['typ'], 'invalid_header');
  if (parsed.header.alg !== 'RS256'
    || ('typ' in parsed.header && parsed.header.typ !== 'JWT')) {
    fail('invalid_header');
  }
  const key = selectKey(keys, parsed.header.kid);
  verifySignature(parsed, key, 'firebase');
  if (parsed.claims.iss !== fixture.firebase.issuer) fail('invalid_issuer');
  if (parsed.claims.aud !== fixture.firebase.project_id) fail('invalid_audience');

  const expiresAt = integerClaim(parsed.claims.exp);
  if (expiresAt <= fixture.now) fail('expired');
  const issuedAt = integerClaim(parsed.claims.iat);
  const authenticatedAt = integerClaim(parsed.claims.auth_time);
  if (issuedAt > fixture.now + 30 || authenticatedAt > fixture.now + 30) fail('invalid_time');
  const userId = stringClaim(parsed.claims.sub, 128);
  let verifiedEmail: string | null = null;
  if (parsed.claims.email_verified === true) {
    verifiedEmail = stringClaim(parsed.claims.email, 320);
  } else if (parsed.claims.email_verified !== undefined
    && parsed.claims.email_verified !== false) {
    fail('invalid_claims');
  }
  return Object.freeze({
    user_id: userId,
    verified_email: verifiedEmail,
    authenticated_at: authenticatedAt,
    expires_at: expiresAt,
  });
}

export function verifyFixtureVector(
  vector: AccessTokenFixture['vectors'][number],
  fixture: AccessTokenFixture,
): AccessIdentity | FirebaseIdentity {
  const keys = fixture.key_sets[vector.key_set].keys;
  const verificationFixture = { ...fixture, now: vector.verification_time };
  if (vector.kind === 'firebase') return verifyFirebaseIdToken(vector.token, verificationFixture, keys);
  return verifyMiakappAccessToken(vector.token, verificationFixture, vector.profile, keys);
}

export function tokenErrorCode(error: unknown): TokenErrorCode | undefined {
  if (error instanceof TokenVerificationError) return error.code;
  if (error instanceof ContractViolation) return 'malformed_token';
  return undefined;
}
