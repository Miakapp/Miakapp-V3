import { describe, expect, test } from 'bun:test';
import { createPrivateKey, sign, type JsonWebKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  AccessTokenVerificationError,
  verifyComponentAccessToken,
  verifyPushAccessToken,
  type ComponentAccessTokenVerifierConfig,
  type PushAccessTokenVerifierConfig,
} from '../../src/access-token.js';
import { loadEmulatorConfig } from '../../src/config.js';

const NOW = 1_788_220_800;
const CLOCK = Object.freeze({ now: () => NOW * 1_000 });
const ENVIRONMENT = {
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: 'demo-miakapp-v4',
} as NodeJS.ProcessEnv;
const config = loadEmulatorConfig(ENVIRONMENT);
const baseHeader = Object.freeze({ alg: 'EdDSA', kid: config.signingPublicJwk.kid, typ: 'at+jwt' });
const signingFixture = JSON.parse(readFileSync(
  new URL('../../../control-plane-contract/fixtures/v1/access-tokens.json', import.meta.url),
  'utf8',
)) as {
  readonly test_only_private_keys: {
    readonly warning: string;
    readonly current: JsonWebKey & { readonly kid: string };
  };
};
if (signingFixture.test_only_private_keys.warning
  !== 'SYNTHETIC TEST KEYS. NEVER LOAD IN PRODUCTION.') {
  throw new Error('Access-token unit fixture is not explicitly synthetic');
}
const baseClaims = Object.freeze({
  iss: config.issuer,
  sub: 'synthetic-home',
  aud: config.pushAudience,
  exp: NOW + 300,
  iat: NOW,
  jti: Buffer.alloc(16, 3).toString('base64url'),
  client_id: Buffer.alloc(16, 0).toString('base64url'),
  scope: 'push:send',
});
const componentClaims = Object.freeze({
  ...baseClaims,
  aud: config.componentsAudience,
  scope: 'components:publish',
});

function signRawToken(
  headerJson: string,
  claimsJson: string,
  privateJwk: JsonWebKey = config.signingPrivateJwk,
): string {
  const header = Buffer.from(headerJson, 'utf8').toString('base64url');
  const claims = Buffer.from(claimsJson, 'utf8').toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = sign(
    null,
    Buffer.from(signingInput, 'ascii'),
    createPrivateKey({ key: privateJwk, format: 'jwk' }),
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

function signToken(
  claims: Readonly<Record<string, unknown>> = baseClaims,
  header: Readonly<Record<string, unknown>> = baseHeader,
  privateJwk: JsonWebKey = config.signingPrivateJwk,
): string {
  return signRawToken(JSON.stringify(header), JSON.stringify(claims), privateJwk);
}

function authorization(token = signToken()): string {
  return `Bearer ${token}`;
}

function expectInvalid(
  authorizationHeader: string | readonly string[] | undefined,
  verifierConfig: PushAccessTokenVerifierConfig = config,
): void {
  let thrown: unknown;
  try {
    verifyPushAccessToken(authorizationHeader, verifierConfig, CLOCK);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AccessTokenVerificationError);
  expect(thrown).toMatchObject({
    code: 'invalid_access_token',
    message: 'Authentication failed',
  });
}

function expectInvalidComponent(
  authorizationHeader: string | readonly string[] | undefined,
  verifierConfig: ComponentAccessTokenVerifierConfig = config,
): void {
  let thrown: unknown;
  try {
    verifyComponentAccessToken(authorizationHeader, verifierConfig, CLOCK);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AccessTokenVerificationError);
  expect(thrown).toMatchObject({
    code: 'invalid_access_token',
    message: 'Authentication failed',
  });
}

describe('push-profile access-token verification', () => {
  test('accepts the exact push profile and derives only its authenticated identity', () => {
    expect(verifyPushAccessToken(authorization(), config, CLOCK)).toEqual({
      homeId: 'synthetic-home',
      clientId: baseClaims.client_id,
      expiresAt: NOW + 300,
    });
  });

  test('accepts both retained and active signing keys during publication overlap', () => {
    const currentPrivateJwk = signingFixture.test_only_private_keys.current;
    const currentPublicJwk = config.signingPublicJwks.find(
      (key) => key.kid === currentPrivateJwk.kid,
    );
    if (currentPublicJwk === undefined) throw new Error('Current fixture key is not published');
    const retainedToken = signToken(
      baseClaims,
      { ...baseHeader, kid: currentPublicJwk.kid },
      currentPrivateJwk,
    );
    expect(verifyPushAccessToken(authorization(retainedToken), config, CLOCK)).toEqual({
      homeId: 'synthetic-home',
      clientId: baseClaims.client_id,
      expiresAt: NOW + 300,
    });
    expect(verifyPushAccessToken(authorization(), config, CLOCK).expiresAt).toBe(NOW + 300);
  });

  test('accepts the exact future-iat and remaining-lease boundaries', () => {
    const token = signToken({ ...baseClaims, iat: NOW + 30, exp: NOW + 300 });
    expect(verifyPushAccessToken(authorization(token), config, CLOCK).expiresAt).toBe(NOW + 300);
  });

  test.each([
    ['issuer', { ...baseClaims, iss: 'https://other.example.test' }],
    ['audience', { ...baseClaims, aud: 'https://control.example.test/v1/components' }],
    ['audience type', { ...baseClaims, aud: [config.pushAudience] }],
    ['scope substitution', { ...baseClaims, scope: 'components:publish' }],
    ['multiple scopes', { ...baseClaims, scope: 'push:send components:publish' }],
    ['forbidden role', { ...baseClaims, miakapp_role: 'coordinator' }],
    ['unknown claim', { ...baseClaims, extension: true }],
    ['home ID', { ...baseClaims, sub: 'Synthetic-Home' }],
    ['client ID', { ...baseClaims, client_id: 'A'.repeat(21) }],
    ['token ID', { ...baseClaims, jti: 'A'.repeat(21) }],
    ['expiry', { ...baseClaims, exp: NOW }],
    ['future issue time', { ...baseClaims, iat: NOW + 31 }],
    ['future expiry horizon', { ...baseClaims, exp: NOW + 301 }],
    ['overlong issued lease', { ...baseClaims, iat: NOW - 1, exp: NOW + 300 }],
    ['unsafe time', { ...baseClaims, exp: Number.MAX_SAFE_INTEGER + 1 }],
  ] as Array<[string, Readonly<Record<string, unknown>>]>)('rejects a validly signed token with an invalid %s claim', (_name, claims) => {
    expectInvalid(authorization(signToken(claims)));
  });

  test('rejects a missing required claim even when the token is validly signed', () => {
    const { jti: _jti, ...missingJti } = baseClaims;
    expectInvalid(authorization(signToken(missingJti)));
  });

  test.each([
    ['algorithm', { ...baseHeader, alg: 'RS256' }],
    ['type', { ...baseHeader, typ: 'JWT' }],
    ['key ID', { ...baseHeader, kid: 'unknown-key' }],
    ['embedded key', { ...baseHeader, jwk: config.signingPublicJwk }],
  ] as Array<[string, Readonly<Record<string, unknown>>]>)('rejects a validly signed token with an invalid %s header', (_name, header) => {
    expectInvalid(authorization(signToken(baseClaims, header)));
  });

  test('rejects malformed and ambiguous compact JWTs independently of their claims', () => {
    const duplicateClaims = `{"iss":"${config.issuer}","sub":"synthetic-home",`
      + `"aud":"${config.pushAudience}","exp":${NOW + 300},"iat":${NOW},`
      + `"jti":"${baseClaims.jti}","client_id":"${baseClaims.client_id}",`
      + '"scope":"push:send","scope":"push:send"}';
    expectInvalid(authorization(signRawToken(JSON.stringify(baseHeader), duplicateClaims)));

    const valid = signToken();
    const segments = valid.split('.');
    const header = segments[0];
    const claims = segments[1];
    const signatureSegment = segments[2];
    if (header === undefined || claims === undefined || signatureSegment === undefined) {
      throw new Error('Test token is malformed');
    }
    expectInvalid(authorization(`${header}=.${claims}.${signatureSegment}`));
    const signature = Buffer.from(signatureSegment, 'base64url');
    signature[0] = (signature[0] ?? 0) ^ 1;
    expectInvalid(authorization(`${header}.${claims}.${signature.toString('base64url')}`));
    expectInvalid(`Bearer ${'A'.repeat(8_193)}`);
  });

  test('enforces one exact Authorization bearer-token form', () => {
    const token = signToken();
    expectInvalid(undefined);
    expectInvalid([authorization(token)]);
    expectInvalid(token);
    expectInvalid(`bearer ${token}`);
    expectInvalid(`Bearer  ${token}`);
    expectInvalid(`Bearer ${token} `);
    expectInvalid(`Bearer ${token}\n`);
  });

  test('keeps trusted emulator configuration failures separate from caller failures', () => {
    const header = authorization();
    expect(() => verifyPushAccessToken(
      header,
      { ...config, projectId: 'production-project' },
      CLOCK,
    )).toThrow(/configuration is invalid/);

    const pollutedKey = { ...config.signingPublicJwk, d: 'private-material' };
    expect(() => verifyPushAccessToken(
      header,
      { ...config, signingPublicJwks: [pollutedKey] },
      CLOCK,
    )).toThrow(/public keys are invalid/);

    for (const signingPublicJwks of [
      [],
      [config.signingPublicJwk, config.signingPublicJwk],
      [{ ...config.signingPublicJwk, x: 'invalid' }],
      Array.from({ length: 17 }, (_, index) => ({
        ...config.signingPublicJwk,
        kid: `synthetic-key-${index}`,
      })),
    ]) {
      expect(() => verifyPushAccessToken(
        header,
        { ...config, signingPublicJwks },
        CLOCK,
      )).toThrow(/public keys are invalid/);
    }
  });

  test.each([
    ['staging', 'miakapp-v4-staging', 'https://control.staging.miakapp.com'],
    ['production', 'miakapp-v4', 'https://control.miakapp.com'],
  ] as Array<[string, string, string]>)('accepts the exact %s project, issuer, and audience binding', (
    _environment,
    projectId,
    issuer,
  ) => {
    const productionClaims = {
      ...baseClaims,
      iss: issuer,
      aud: `${issuer}/v1/push`,
    };
    const verifierConfig: PushAccessTokenVerifierConfig = {
      projectId,
      issuer,
      pushAudience: `${issuer}/v1/push`,
      signingPublicJwks: config.signingPublicJwks,
    };
    expect(verifyPushAccessToken(
      authorization(signToken(productionClaims)),
      verifierConfig,
      CLOCK,
    )).toEqual({
      homeId: 'synthetic-home',
      clientId: baseClaims.client_id,
      expiresAt: NOW + 300,
    });
  });

  test('rejects every cross-environment configuration before token verification', () => {
    expect(() => verifyPushAccessToken(authorization(), {
      ...config,
      projectId: 'miakapp-v4-staging',
    }, CLOCK)).toThrow(/configuration is invalid/);
    expect(() => verifyPushAccessToken(authorization(), {
      ...config,
      issuer: 'https://control.staging.miakapp.com',
    }, CLOCK)).toThrow(/configuration is invalid/);
    expect(() => verifyPushAccessToken(authorization(), {
      ...config,
      pushAudience: 'https://control.example.test/v1/components',
    }, CLOCK)).toThrow(/configuration is invalid/);
  });
});

describe('component-publisher access-token verification', () => {
  test('accepts only the exact audience-bound component profile', () => {
    const token = signToken(componentClaims);
    expect(verifyComponentAccessToken(authorization(token), config, CLOCK)).toEqual({
      homeId: 'synthetic-home',
      clientId: baseClaims.client_id,
      expiresAt: NOW + 300,
    });
  });

  test.each([
    ['push scope', baseClaims],
    ['push audience', { ...componentClaims, aud: config.pushAudience }],
    ['relay scope', { ...componentClaims, scope: 'relay:coordinator' }],
    ['multiple scopes', { ...componentClaims, scope: 'components:publish push:send' }],
  ] as Array<[string, Readonly<Record<string, unknown>>]>)('rejects %s without profile fallback', (_name, claims) => {
    expectInvalidComponent(authorization(signToken(claims)));
  });

  test('keeps component verifier configuration failures separate from caller failures', () => {
    expect(() => verifyComponentAccessToken(
      authorization(signToken(componentClaims)),
      { ...config, projectId: 'production-project' },
      CLOCK,
    )).toThrow(/configuration is invalid/);
  });
});
