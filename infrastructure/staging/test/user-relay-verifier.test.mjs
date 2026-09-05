import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import test from 'node:test';

import {
  EXPECTED_HOME_ID,
  EXPECTED_ISSUER,
  EXPECTED_USER_ID,
  RELAY_AUDIENCES,
  VERIFICATION_REQUEST_SCHEMA,
  VERIFICATION_RESULT_SCHEMA,
  verifyUserRelayTokenPair,
  verifyUserRelayTokenPairWithPolicy,
} from '../auth-probe/verifier.mjs';

const NOW_SECONDS = 1_788_563_400;
const NOW_MILLISECONDS = NOW_SECONDS * 1_000;
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const exported = publicKey.export({ format: 'jwk' });
const TEST_JWK = Object.freeze({
  kty: 'OKP',
  crv: 'Ed25519',
  x: exported.x,
  use: 'sig',
  alg: 'EdDSA',
  kid: 'test-user-relay-key',
});
const TEST_POLICY = Object.freeze({
  issuer: EXPECTED_ISSUER,
  userId: EXPECTED_USER_ID,
  homeId: EXPECTED_HOME_ID,
  audiences: RELAY_AUDIENCES,
  jwk: TEST_JWK,
});

function encoded(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function token(audience, tokenByte, overrides = {}) {
  const issuedAt = overrides.iat ?? NOW_SECONDS - 1;
  const claims = {
    iss: EXPECTED_ISSUER,
    sub: EXPECTED_USER_ID,
    aud: audience,
    exp: overrides.exp ?? issuedAt + 300,
    iat: issuedAt,
    jti: Buffer.alloc(16, tokenByte).toString('base64url'),
    scope: 'relay:user',
    miakapp_home: EXPECTED_HOME_ID,
    miakapp_role: 'user',
    ...(overrides.claims ?? {}),
  };
  const header = {
    alg: 'EdDSA',
    kid: TEST_JWK.kid,
    typ: 'at+jwt',
    ...(overrides.header ?? {}),
  };
  const signingInput = `${encoded(header)}.${encoded(claims)}`;
  const signature = sign(null, Buffer.from(signingInput, 'ascii'), privateKey).toString('base64url');
  return {
    access_token: `${signingInput}.${signature}`,
    expires_at_ms: claims.exp * 1_000,
  };
}

function request(overrides = {}) {
  return {
    schema: VERIFICATION_REQUEST_SCHEMA,
    token_one: token(RELAY_AUDIENCES[0], 1),
    token_two: token(RELAY_AUDIENCES[1], 2),
    ...overrides,
  };
}

test('verifies the ordered two-token handoff and returns only sanitized facts', () => {
  const result = verifyUserRelayTokenPairWithPolicy(request(), TEST_POLICY, NOW_MILLISECONDS);
  assert.deepEqual(result, {
    schema: VERIFICATION_RESULT_SCHEMA,
    verified: true,
    token_count: 2,
    kid: TEST_JWK.kid,
  });
  assert.doesNotMatch(JSON.stringify(result), /miakapp-v4-staging-user|relay-a|token_sha|jti/iu);
});

test('keeps the production wrapper pinned to the deployed KMS public key', () => {
  assert.throws(
    () => verifyUserRelayTokenPair(request(), NOW_MILLISECONDS),
    /verification failed/u,
  );
});

test('rejects substituted policy, swapped audiences and duplicate identities', () => {
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(
    request(),
    { ...TEST_POLICY, audiences: [...RELAY_AUDIENCES].reverse() },
    NOW_MILLISECONDS,
  ));
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(request({
    token_one: token(RELAY_AUDIENCES[1], 1),
  }), TEST_POLICY, NOW_MILLISECONDS));
  const duplicate = token(RELAY_AUDIENCES[0], 1);
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(request({
    token_one: duplicate,
    token_two: { ...duplicate },
  }), { ...TEST_POLICY, audiences: [RELAY_AUDIENCES[0], RELAY_AUDIENCES[0]] }, NOW_MILLISECONDS));
});

test('rejects unknown claims, noncanonical headers and a future expiry ceiling', () => {
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(request({
    token_one: token(RELAY_AUDIENCES[0], 1, {
      claims: { miakapp_verified_email: 'probe@example.invalid' },
    }),
  }), TEST_POLICY, NOW_MILLISECONDS));
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(request({
    token_one: token(RELAY_AUDIENCES[0], 1, { header: { extra: true } }),
  }), TEST_POLICY, NOW_MILLISECONDS));
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(request({
    token_one: token(RELAY_AUDIENCES[0], 1, {
      iat: NOW_SECONDS + 1,
      exp: NOW_SECONDS + 301,
    }),
  }), TEST_POLICY, NOW_MILLISECONDS));
});

test('rejects tampering, malformed request shapes and oversized credentials', () => {
  const valid = request();
  const replacement = valid.token_one.access_token.endsWith('A') ? 'B' : 'A';
  const tampered = {
    ...valid.token_one,
    access_token: `${valid.token_one.access_token.slice(0, -1)}${replacement}`,
  };
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(
    request({ token_one: tampered }),
    TEST_POLICY,
    NOW_MILLISECONDS,
  ));
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(
    { ...request(), extra: true },
    TEST_POLICY,
    NOW_MILLISECONDS,
  ));
  assert.throws(() => verifyUserRelayTokenPairWithPolicy(request({
    token_one: { access_token: 'x'.repeat(8_193), expires_at_ms: 0 },
  }), TEST_POLICY, NOW_MILLISECONDS));
});
