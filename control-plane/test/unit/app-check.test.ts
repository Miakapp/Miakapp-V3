import { describe, expect, test } from 'bun:test';
import { createPrivateKey, sign, type JsonWebKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  AppCheckVerificationError,
  verifySyntheticAppCheckToken,
  type SyntheticAppCheckVerifierConfig,
} from '../../src/app-check.js';
import { loadEmulatorConfig } from '../../src/config.js';

const NOW = 1_788_220_800;
const CLOCK = Object.freeze({ now: () => NOW * 1_000 });
const ENVIRONMENT = {
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: 'demo-miakapp-v4',
} as NodeJS.ProcessEnv;
const FIXTURE_URL = new URL(
  '../../../control-plane-contract/fixtures/v1/access-tokens.json',
  import.meta.url,
);

type RsaPrivateJwk = JsonWebKey & {
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
  readonly kid: string;
};

interface SigningFixture {
  readonly test_only_private_keys: {
    readonly firebase: RsaPrivateJwk;
    readonly firebase3072: RsaPrivateJwk;
  };
}

const signingFixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as SigningFixture;
const config = loadEmulatorConfig(ENVIRONMENT);
const baseHeader = Object.freeze({ alg: 'RS256', kid: signingFixture.test_only_private_keys.firebase.kid, typ: 'JWT' });
const baseClaims = Object.freeze({
  iss: config.appCheckIssuer,
  sub: config.appCheckAppId,
  aud: [config.appCheckAudience],
  iat: NOW,
  exp: NOW + 3_600,
});

function signRawToken(headerJson: string, claimsJson: string, privateKey: RsaPrivateJwk): string {
  const header = Buffer.from(headerJson, 'utf8').toString('base64url');
  const claims = Buffer.from(claimsJson, 'utf8').toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput, 'ascii'),
    createPrivateKey({ key: privateKey, format: 'jwk' }),
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

function signToken(
  claims: Readonly<Record<string, unknown>> = baseClaims,
  header: Readonly<Record<string, unknown>> = baseHeader,
  privateKey: RsaPrivateJwk = signingFixture.test_only_private_keys.firebase,
): string {
  return signRawToken(JSON.stringify(header), JSON.stringify(claims), privateKey);
}

function expectInvalid(
  token: string | readonly string[] | undefined,
  verifierConfig: SyntheticAppCheckVerifierConfig = config,
): void {
  let thrown: unknown;
  try {
    verifySyntheticAppCheckToken(token, verifierConfig, CLOCK);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppCheckVerificationError);
  expect(thrown).toMatchObject({
    code: 'invalid_app_check_token',
    message: 'Application verification failed',
  });
}

function publicKey(privateKey: RsaPrivateJwk): JsonWebKey & { readonly kid: string } {
  return Object.freeze({
    kty: 'RSA',
    n: privateKey.n,
    e: privateKey.e,
    use: 'sig',
    alg: 'RS256',
    kid: privateKey.kid,
  });
}

describe('synthetic App Check verification', () => {
  test('accepts a signed token bound to the exact project and app', () => {
    const token = signToken({ ...baseClaims, aud: [config.appCheckAudience, config.projectId] });
    expect(verifySyntheticAppCheckToken(token, config, CLOCK)).toEqual({
      appId: config.appCheckAppId,
      expiresAt: NOW + 3_600,
    });
  });

  test('accepts the documented seven-day and 30-second skew boundaries', () => {
    const token = signToken({ ...baseClaims, iat: NOW + 30, exp: NOW + 7 * 24 * 60 * 60 });
    expect(verifySyntheticAppCheckToken(token, config, CLOCK).expiresAt)
      .toBe(NOW + 7 * 24 * 60 * 60);
  });

  test('accepts a bounded 3072-bit synthetic Firebase signing key', () => {
    const privateKey = signingFixture.test_only_private_keys.firebase3072;
    const verifierConfig = {
      ...config,
      appCheckPublicJwk: publicKey(privateKey),
    };
    const token = signToken(baseClaims, { ...baseHeader, kid: privateKey.kid }, privateKey);
    expect(verifySyntheticAppCheckToken(token, verifierConfig, CLOCK).appId)
      .toBe(config.appCheckAppId);
  });

  test.each([
    ['issuer', { ...baseClaims, iss: 'https://firebaseappcheck.googleapis.com/999' }],
    ['subject/app ID', { ...baseClaims, sub: '1:1234567890:web:ffffffffffffffff' }],
    ['scalar audience', { ...baseClaims, aud: config.appCheckAudience }],
    ['wrong audience', { ...baseClaims, aud: ['projects/999'] }],
    ['duplicate audience', { ...baseClaims, aud: [config.appCheckAudience, config.appCheckAudience] }],
    ['expiry', { ...baseClaims, exp: NOW }],
    ['future issue time', { ...baseClaims, iat: NOW + 31 }],
    ['inverted lease', { ...baseClaims, iat: NOW, exp: NOW }],
    ['overlong lease', { ...baseClaims, exp: NOW + 7 * 24 * 60 * 60 + 1 }],
    ['unsafe time', { ...baseClaims, exp: Number.MAX_SAFE_INTEGER + 1 }],
  ] as Array<[string, Readonly<Record<string, unknown>>]>)('rejects a validly signed token with an invalid %s claim', (_name, claims) => {
    expectInvalid(signToken(claims));
  });

  test.each([
    ['algorithm', { ...baseHeader, alg: 'HS256' }],
    ['type', { ...baseHeader, typ: 'at+jwt' }],
    ['key ID', { ...baseHeader, kid: 'unknown-key' }],
    ['embedded remote-key hint', { ...baseHeader, jku: 'https://attacker.example.test/jwks' }],
  ] as Array<[string, Readonly<Record<string, unknown>>]>)('rejects a validly signed token with an invalid %s header', (_name, header) => {
    expectInvalid(signToken(baseClaims, header));
  });

  test('rejects duplicate claims, non-canonical segments, bad signatures, and bounded-input violations', () => {
    const duplicateClaims = `{"iss":"${config.appCheckIssuer}","iss":"${config.appCheckIssuer}",`
      + `"sub":"${config.appCheckAppId}","aud":["${config.appCheckAudience}"],`
      + `"iat":${NOW},"exp":${NOW + 3_600}}`;
    expectInvalid(signRawToken(JSON.stringify(baseHeader), duplicateClaims, signingFixture.test_only_private_keys.firebase));

    const valid = signToken();
    const segments = valid.split('.');
    const header = segments[0];
    const claims = segments[1];
    const signatureSegment = segments[2];
    if (header === undefined || claims === undefined || signatureSegment === undefined) {
      throw new Error('Test token is malformed');
    }
    expectInvalid(`${header}=.${claims}.${signatureSegment}`);
    const signature = Buffer.from(signatureSegment, 'base64url');
    signature[0] = (signature[0] ?? 0) ^ 1;
    expectInvalid(`${header}.${claims}.${signature.toString('base64url')}`);
    expectInvalid('A'.repeat(8_193));
    expectInvalid(undefined);
    expectInvalid([valid]);
  });

  test('keeps trusted emulator configuration failures separate from caller failures', () => {
    const token = signToken();
    expect(() => verifySyntheticAppCheckToken(
      token,
      { ...config, projectId: 'production-project' },
      CLOCK,
    )).toThrow(/restricted to the demo Firebase Emulator project/);
    expect(() => verifySyntheticAppCheckToken(
      token,
      { ...config, appCheckPublicJwk: signingFixture.test_only_private_keys.firebase },
      CLOCK,
    )).toThrow(/public key is invalid/);
  });
});
