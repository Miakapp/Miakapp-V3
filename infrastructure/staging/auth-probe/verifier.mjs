import {
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { createServer } from 'node:http';
import { isDeepStrictEqual } from 'node:util';

export const VERIFIER_SCHEMA = 'miakapp.staging-user-relay-jwt-verifier/1';
export const VERIFICATION_REQUEST_SCHEMA = 'miakapp.staging-user-relay-jwt-verification-request/1';
export const VERIFICATION_RESULT_SCHEMA = 'miakapp.staging-user-relay-jwt-verification/1';
export const EXPECTED_ISSUER = 'https://control.staging.miakapp.com';
export const EXPECTED_USER_ID = 'miakapp-v4-staging-user-relay-probe-v1';
export const EXPECTED_HOME_ID = 'miakapp-v4-staging-user-relay-probe-v1';
export const EXPECTED_KEY_ID = 'staging-access-token-v1';
export const RELAY_AUDIENCES = Object.freeze([
  'wss://relay-a.probe.invalid/ws',
  'wss://relay-b.probe.invalid/ws',
]);
export const SIGNING_PUBLIC_JWK = Object.freeze({
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'eINmaVIFYgARhSMf1pBb9yRstrT_6LfO5d12WFL5Dsw',
  use: 'sig',
  alg: 'EdDSA',
  kid: EXPECTED_KEY_ID,
});

const ACCESS_TOKEN_TTL_SECONDS = 300;
const MAXIMUM_TOKEN_BYTES = 8_192;
const MAXIMUM_HEADER_BYTES = 2_048;
const MAXIMUM_CLAIMS_BYTES = 12_288;
const MAXIMUM_REQUEST_BYTES = 16 * 1_024;
const MAXIMUM_CLOCK_SKEW_SECONDS = 30;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const GRAPHIC_ASCII = /^[\x21-\x7e]+$/u;
const REQUEST_FIELDS = Object.freeze([
  'schema',
  'token_one',
  'token_two',
]);
const TOKEN_FIELDS = Object.freeze(['access_token', 'expires_at_ms']);
const HEADER_FIELDS = Object.freeze(['alg', 'kid', 'typ']);
const CLAIM_FIELDS = Object.freeze([
  'iss',
  'sub',
  'aud',
  'exp',
  'iat',
  'jti',
  'scope',
  'miakapp_home',
  'miakapp_role',
]);

export class UserRelayVerificationError extends Error {
  constructor() {
    super('User-relay token verification failed');
    this.name = 'UserRelayVerificationError';
  }
}

function fail() {
  throw new UserRelayVerificationError();
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plainObject(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function decodeCanonicalBase64url(value, maximumBytes) {
  if (typeof value !== 'string' || value.length === 0 || !BASE64URL.test(value)) fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.byteLength > maximumBytes || bytes.toString('base64url') !== value) fail();
  return bytes;
}

function parsedObject(segment, maximumBytes) {
  let value;
  try {
    value = JSON.parse(decodeCanonicalBase64url(segment, maximumBytes).toString('utf8'));
  } catch (error) {
    if (error instanceof UserRelayVerificationError) throw error;
    fail();
  }
  if (!plainObject(value)) fail();
  return value;
}

function canonicalIdentifier(value) {
  if (typeof value !== 'string' || value.length !== 22) fail();
  const bytes = decodeCanonicalBase64url(value, 16);
  if (bytes.byteLength !== 16) fail();
  return value;
}

function validatedPolicy(policy) {
  if (!plainObject(policy)
    || typeof policy.issuer !== 'string'
    || typeof policy.userId !== 'string'
    || typeof policy.homeId !== 'string'
    || !Array.isArray(policy.audiences)
    || policy.audiences.length !== 2
    || policy.audiences.some((audience) => typeof audience !== 'string')
    || !exactKeys(policy.jwk, ['kty', 'crv', 'x', 'use', 'alg', 'kid'])
    || policy.jwk.kty !== 'OKP'
    || policy.jwk.crv !== 'Ed25519'
    || policy.jwk.use !== 'sig'
    || policy.jwk.alg !== 'EdDSA'
    || typeof policy.jwk.kid !== 'string'
    || decodeCanonicalBase64url(policy.jwk.x, 32).byteLength !== 32) {
    fail();
  }
  return policy;
}

function verifyOneToken(input, expectedAudience, reviewed, nowMilliseconds) {
  if (!exactKeys(input, TOKEN_FIELDS)
    || !Number.isSafeInteger(input.expires_at_ms)
    || input.expires_at_ms < 0
    || !reviewed.audiences.includes(expectedAudience)
    || typeof input.access_token !== 'string'
    || Buffer.byteLength(input.access_token, 'ascii') > MAXIMUM_TOKEN_BYTES
    || !GRAPHIC_ASCII.test(input.access_token)) {
    fail();
  }

  const segments = input.access_token.split('.');
  if (segments.length !== 3) fail();
  const [headerSegment, claimsSegment, signatureSegment] = segments;
  if (headerSegment === undefined || claimsSegment === undefined || signatureSegment === undefined) fail();
  const header = parsedObject(headerSegment, MAXIMUM_HEADER_BYTES);
  const claims = parsedObject(claimsSegment, MAXIMUM_CLAIMS_BYTES);
  const signature = decodeCanonicalBase64url(signatureSegment, 64);
  if (signature.byteLength !== 64
    || !exactKeys(header, HEADER_FIELDS)
    || header.alg !== 'EdDSA'
    || header.kid !== reviewed.jwk.kid
    || header.typ !== 'at+jwt'
    || !exactKeys(claims, CLAIM_FIELDS)
    || claims.iss !== reviewed.issuer
    || claims.sub !== reviewed.userId
    || claims.aud !== expectedAudience
    || claims.scope !== 'relay:user'
    || claims.miakapp_home !== reviewed.homeId
    || claims.miakapp_role !== 'user'
    || !Number.isSafeInteger(claims.iat)
    || claims.iat < 0
    || !Number.isSafeInteger(claims.exp)
    || claims.exp !== claims.iat + ACCESS_TOKEN_TTL_SECONDS
    || input.expires_at_ms !== claims.exp * 1_000) {
    fail();
  }
  const tokenId = canonicalIdentifier(claims.jti);
  const nowSeconds = Math.floor(nowMilliseconds / 1_000);
  if (claims.iat > nowSeconds + MAXIMUM_CLOCK_SKEW_SECONDS
    || claims.iat < nowSeconds - ACCESS_TOKEN_TTL_SECONDS
    || claims.exp <= nowSeconds
    || claims.exp > nowSeconds + ACCESS_TOKEN_TTL_SECONDS) {
    fail();
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: reviewed.jwk, format: 'jwk' });
  } catch {
    fail();
  }
  const signingInput = Buffer.from(`${headerSegment}.${claimsSegment}`, 'ascii');
  if (!verify(null, signingInput, publicKey, signature)) fail();
  return Object.freeze({ accessToken: input.access_token, tokenId });
}

export function verifyUserRelayTokenPairWithPolicy(input, policy, nowMilliseconds = Date.now()) {
  const reviewed = validatedPolicy(policy);
  if (!exactKeys(input, REQUEST_FIELDS)
    || input.schema !== VERIFICATION_REQUEST_SCHEMA
    || !Number.isSafeInteger(nowMilliseconds)
    || nowMilliseconds < 0) {
    fail();
  }
  const first = verifyOneToken(input.token_one, reviewed.audiences[0], reviewed, nowMilliseconds);
  const second = verifyOneToken(input.token_two, reviewed.audiences[1], reviewed, nowMilliseconds);
  if (safeEqual(first.accessToken, second.accessToken) || safeEqual(first.tokenId, second.tokenId)) fail();
  return Object.freeze({
    schema: VERIFICATION_RESULT_SCHEMA,
    verified: true,
    token_count: 2,
    kid: reviewed.jwk.kid,
  });
}

export function verifyUserRelayTokenPair(input, nowMilliseconds = Date.now()) {
  return verifyUserRelayTokenPairWithPolicy(input, Object.freeze({
    issuer: EXPECTED_ISSUER,
    userId: EXPECTED_USER_ID,
    homeId: EXPECTED_HOME_ID,
    audiences: RELAY_AUDIENCES,
    jwk: SIGNING_PUBLIC_JWK,
  }), nowMilliseconds);
}

function safeEqual(actual, expected) {
  const left = Buffer.from(typeof actual === 'string' ? actual : '', 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function readRequest(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.byteLength;
    if (length > MAXIMUM_REQUEST_BYTES) fail();
    chunks.push(chunk);
  }
  if (length === 0) fail();
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail();
  }
  return value;
}

export function createVerifierServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method !== 'POST'
        || request.url !== '/verify'
        || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? '')) {
        fail();
      }
      send(response, 200, verifyUserRelayTokenPair(await readRequest(request)));
    } catch {
      send(response, 400, {
        schema: VERIFIER_SCHEMA,
        error: 'invalid_verification_request',
      });
    }
  });
}

function start() {
  if (!/^[1-9][0-9]{1,4}$/u.test(process.env.PORT ?? '')) {
    process.exitCode = 1;
    return;
  }
  const port = Number(process.env.PORT);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    process.exitCode = 1;
    return;
  }
  const server = createVerifierServer();
  server.on('error', () => {
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0');
}
