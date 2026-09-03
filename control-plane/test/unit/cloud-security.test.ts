import { describe, expect, test } from 'bun:test';
import {
  generateKeyPairSync,
  sign as nodeSign,
  verify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

import {
  KmsAccessTokenSigner,
  ProductionDependencyError,
  crc32c,
  initializeProductionSecurity,
  loadProductionSecrets,
  type CloudCallOptions,
  type KmsClient,
  type KmsPublicKeyResponse,
  type KmsSignResponse,
  type SecretManagerAccessResponse,
  type SecretManagerClient,
} from '../../src/cloud-security.js';
import { AccessTokenSigner } from '../../src/crypto.js';
import { parseProductionSecurityConfig } from '../../src/production-config.js';
import type { AccessGrant } from '../../src/types.js';

const generated = generateKeyPairSync('ed25519');
const secondKey = generateKeyPairSync('ed25519');
const exportedPublic = generated.publicKey.export({ format: 'jwk' });
const exportedPrivate = generated.privateKey.export({ format: 'jwk' });
if (exportedPublic.x === undefined || exportedPrivate.d === undefined) {
  throw new Error('Generated Ed25519 fixture is invalid');
}
const KID = 'staging-access-token-v1';
const PUBLIC_JWK = Object.freeze({
  kty: 'OKP' as const,
  crv: 'Ed25519' as const,
  x: exportedPublic.x,
  use: 'sig' as const,
  alg: 'EdDSA' as const,
  kid: KID,
});
const PRIVATE_JWK = Object.freeze({ ...exportedPrivate, kid: KID }) as JsonWebKey & { readonly kid: string };
const PEM = generated.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function reference(secretId: string, logicalVersion = 'v1', resourceVersion = '1') {
  return {
    logical_version: logicalVersion,
    resource_name: `projects/miakapp-v4-staging/secrets/${secretId}/versions/${resourceVersion}`,
  };
}

function config() {
  return parseProductionSecurityConfig({
    schema: 'miakapp.production-security/1',
    environment: 'staging',
    project_id: 'miakapp-v4-staging',
    region: 'europe-west9',
    issuer: 'https://control.staging.miakapp.com',
    signing: {
      key_version_name: 'projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing/cryptoKeyVersions/1',
      public_jwk: PUBLIC_JWK,
      rpc_timeout_ms: 2_000,
    },
    secret_manager: {
      rpc_timeout_ms: 1_500,
      keyrings: {
        homeKeyPepper: {
          current_version: 'v2',
          versions: [
            reference('miakapp-home-key-pepper'),
            reference('miakapp-home-key-pepper', 'v2', '2'),
          ],
        },
        componentHmac: { current_version: 'v1', versions: [reference('miakapp-component-hmac')] },
        pushHmac: { current_version: 'v1', versions: [reference('miakapp-push-hmac')] },
        auditHmac: { current_version: 'v1', versions: [reference('miakapp-audit-hmac')] },
        networkHmac: { current_version: 'v1', versions: [reference('miakapp-network-hmac')] },
      },
    },
  });
}

type SecretTransform = (
  response: SecretManagerAccessResponse,
  request: Readonly<{ readonly name: string }>,
) => SecretManagerAccessResponse;

class RecordingSecretManager implements SecretManagerClient {
  readonly calls: Array<{
    readonly request: Readonly<{ readonly name: string }>;
    readonly options: CloudCallOptions;
  }> = [];

  constructor(
    readonly transform: SecretTransform = (response) => response,
    readonly failure: Error | null = null,
  ) {}

  async accessSecretVersion(
    request: Readonly<{ readonly name: string }>,
    options: CloudCallOptions,
  ): Promise<readonly [SecretManagerAccessResponse]> {
    this.calls.push({ request, options });
    if (this.failure !== null) throw this.failure;
    const versionText = request.name.split('/').at(-1);
    const version = Number(versionText);
    const data = new Uint8Array(32).fill(version);
    return [this.transform({
      name: request.name,
      payload: { data, dataCrc32c: crc32c(data) },
    }, request)];
  }
}

type PublicKeyTransform = (response: KmsPublicKeyResponse) => KmsPublicKeyResponse;
type SignatureTransform = (response: KmsSignResponse) => KmsSignResponse;

class RecordingKms implements KmsClient {
  readonly publicKeyCalls: Array<{
    readonly request: Readonly<{ readonly name: string }>;
    readonly options: CloudCallOptions;
  }> = [];
  readonly signCalls: Array<{
    readonly request: Readonly<{
      readonly name: string;
      readonly data: Uint8Array;
      readonly dataCrc32c: Readonly<{ readonly value: number }>;
    }>;
    readonly options: CloudCallOptions;
  }> = [];

  constructor(
    readonly publicKeyTransform: PublicKeyTransform = (response) => response,
    readonly signatureTransform: SignatureTransform = (response) => response,
    readonly failureStage: 'public_key' | 'sign' | null = null,
    readonly signingKey: KeyObject = generated.privateKey,
  ) {}

  async getPublicKey(
    request: Readonly<{ readonly name: string }>,
    options: CloudCallOptions,
  ): Promise<readonly [KmsPublicKeyResponse]> {
    this.publicKeyCalls.push({ request, options });
    if (this.failureStage === 'public_key') throw new Error('private provider failure');
    return [this.publicKeyTransform({
      name: request.name,
      algorithm: 'EC_SIGN_ED25519',
      pem: PEM,
      pemCrc32c: { value: crc32c(Buffer.from(PEM, 'utf8')) },
    })];
  }

  async asymmetricSign(
    request: Readonly<{
      readonly name: string;
      readonly data: Uint8Array;
      readonly dataCrc32c: Readonly<{ readonly value: number }>;
    }>,
    options: CloudCallOptions,
  ): Promise<readonly [KmsSignResponse]> {
    this.signCalls.push({
      request: { ...request, data: new Uint8Array(request.data) },
      options,
    });
    if (this.failureStage === 'sign') throw new Error('private provider failure');
    const signature = nodeSign(null, request.data, this.signingKey);
    return [this.signatureTransform({
      name: request.name,
      signature,
      signatureCrc32c: { value: crc32c(signature) },
      verifiedDataCrc32c: true,
    })];
  }
}

const GRANT: AccessGrant = Object.freeze({
  issuedAt: 1_788_220_800,
  tokenId: Buffer.alloc(16, 1).toString('base64url'),
  homeId: 'synthetic-home',
  clientId: Buffer.alloc(16, 2).toString('base64url'),
  label: 'Synthetic coordinator',
  scope: 'relay:coordinator',
  audience: 'wss://relay.staging.miakapp.com/ws',
  role: 'coordinator',
  coordinatorName: 'automation',
});

async function expectDependencyError(action: () => Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProductionDependencyError);
  expect(thrown).toMatchObject({ message: 'Production security dependency is unavailable' });
  expect(JSON.stringify(thrown)).not.toContain('private provider failure');
}

describe('production cloud security boundaries', () => {
  test('implements the Castagnoli checksum used by both Google APIs', () => {
    expect(crc32c(Buffer.from('123456789', 'ascii'))).toBe(0xe306_9283);
    expect(crc32c(new Uint8Array())).toBe(0);
  });

  test('loads each pinned secret exactly once into immutable in-process keyrings', async () => {
    const client = new RecordingSecretManager();
    const loaded = await loadProductionSecrets(config(), client);
    expect(client.calls).toHaveLength(6);
    expect(client.calls.map((call) => call.request.name)).toEqual([
      'projects/miakapp-v4-staging/secrets/miakapp-home-key-pepper/versions/1',
      'projects/miakapp-v4-staging/secrets/miakapp-home-key-pepper/versions/2',
      'projects/miakapp-v4-staging/secrets/miakapp-component-hmac/versions/1',
      'projects/miakapp-v4-staging/secrets/miakapp-push-hmac/versions/1',
      'projects/miakapp-v4-staging/secrets/miakapp-audit-hmac/versions/1',
      'projects/miakapp-v4-staging/secrets/miakapp-network-hmac/versions/1',
    ]);
    expect(client.calls.every((call) => (
      call.options.timeout === 1_500 && call.options.retry === null
    ))).toBe(true);
    expect(loaded.verifierKeyVersion).toBe('v2');
    const first = loaded.homeKeyPepperForVersion('v1');
    expect(first).toEqual(new Uint8Array(32).fill(1));
    if (first === undefined) throw new Error('Loaded secret disappeared');
    first.fill(99);
    expect(loaded.homeKeyPepperForVersion('v1')).toEqual(new Uint8Array(32).fill(1));
    expect(loaded.homeKeyPepperForVersion('unknown')).toBeUndefined();
  });

  test('accepts the pinned Google Buffer, enum, and Long-like checksum shapes', async () => {
    const checksum = (value: number) => ({
      value: { toString: () => String(value) },
    });
    const secrets = new RecordingSecretManager((response) => {
      const data = Buffer.from(response.payload?.data ?? new Uint8Array());
      return {
        ...response,
        payload: { data, dataCrc32c: checksum(crc32c(data)) },
      };
    });
    const loaded = await loadProductionSecrets(config(), secrets);
    expect(loaded.verifierKeyVersion).toBe('v2');

    const kms = new RecordingKms((response) => ({
      ...response,
      algorithm: 40,
      pemCrc32c: checksum(crc32c(Buffer.from(PEM, 'utf8'))),
    }));
    expect(await KmsAccessTokenSigner.create(config(), kms)).toBeInstanceOf(KmsAccessTokenSigner);
  });

  test('binds one KMS Ed25519 call to the exact JWS input and independently verifies it', async () => {
    const kms = new RecordingKms();
    const signer = await KmsAccessTokenSigner.create(config(), kms);
    const signed = await signer.sign(GRANT);
    expect(kms.publicKeyCalls).toHaveLength(1);
    expect(kms.signCalls).toHaveLength(1);
    expect(kms.publicKeyCalls[0]?.options).toEqual({ timeout: 2_000, retry: null });
    expect(kms.signCalls[0]?.options).toEqual({ timeout: 2_000, retry: null });
    const segments = signed.token.split('.');
    expect(segments).toHaveLength(3);
    const signingInput = `${segments[0]}.${segments[1]}`;
    const call = kms.signCalls[0]?.request;
    if (call === undefined || segments[2] === undefined) throw new Error('KMS call was not recorded');
    expect(Buffer.from(call.data).toString('ascii')).toBe(signingInput);
    expect(call.dataCrc32c.value).toBe(crc32c(call.data));
    expect(call.name).toBe(config().signing.keyVersionName);
    expect(verify(
      null,
      Buffer.from(signingInput, 'ascii'),
      generated.publicKey,
      Buffer.from(segments[2], 'base64url'),
    )).toBe(true);
    const claims = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: config().issuer,
      sub: GRANT.homeId,
      aud: GRANT.audience,
      exp: GRANT.issuedAt + 300,
      iat: GRANT.issuedAt,
      jti: GRANT.tokenId,
      client_id: GRANT.clientId,
      scope: GRANT.scope,
      miakapp_role: GRANT.role,
      miakapp_coordinator: GRANT.coordinatorName,
    });
    expect(signed).toEqual(new AccessTokenSigner({
      issuer: config().issuer,
      signingPublicJwk: PUBLIC_JWK,
      signingPrivateJwk: PRIVATE_JWK,
    }).sign(GRANT));
  });

  test('never trusts a signing client that mutates its request buffer', async () => {
    const backing = new RecordingKms();
    const mutating: KmsClient = {
      getPublicKey: (request, options) => backing.getPublicKey(request, options),
      async asymmetricSign(request, options) {
        backing.signCalls.push({
          request: { ...request, data: new Uint8Array(request.data) },
          options,
        });
        request.data.fill(0);
        const signature = nodeSign(null, request.data, generated.privateKey);
        return [{
          name: request.name,
          signature,
          signatureCrc32c: { value: crc32c(signature) },
          verifiedDataCrc32c: true,
        }];
      },
    };
    const signer = await KmsAccessTokenSigner.create(config(), mutating);
    await expectDependencyError(() => signer.sign(GRANT));
    expect(backing.signCalls).toHaveLength(1);
  });

  test('assembles secrets and signer without exposing a production Function entry point', async () => {
    const secrets = new RecordingSecretManager();
    const kms = new RecordingKms();
    const initialized = await initializeProductionSecurity(config(), { kms, secrets });
    expect(initialized.signer).toBeInstanceOf(KmsAccessTokenSigner);
    expect(initialized.secrets.componentHmacKeyForVersion('v1')).toEqual(new Uint8Array(32).fill(1));
    expect(secrets.calls).toHaveLength(6);
    expect(kms.publicKeyCalls).toHaveLength(1);
    expect(kms.signCalls).toHaveLength(0);
  });

  test.each([
    ['provider failure', (_response: SecretManagerAccessResponse) => { throw new Error('private provider failure'); }],
    ['wrong name', (response: SecretManagerAccessResponse) => ({ ...response, name: 'projects/other/secrets/key/versions/1' })],
    ['wrong size', (response: SecretManagerAccessResponse) => ({ ...response, payload: { ...response.payload, data: new Uint8Array(31) } })],
    ['wrong checksum', (response: SecretManagerAccessResponse) => ({ ...response, payload: { ...response.payload, dataCrc32c: 0 } })],
  ] as Array<[string, SecretTransform]>)('fails closed on a Secret Manager %s', async (_name, transform) => {
    await expectDependencyError(() => loadProductionSecrets(
      config(),
      new RecordingSecretManager(transform),
    ));
  });

  test('normalizes malformed Secret Manager responses and coercion failures', async () => {
    const missingResponse = new RecordingSecretManager(
      () => undefined as unknown as SecretManagerAccessResponse,
    );
    await expectDependencyError(() => loadProductionSecrets(config(), missingResponse));

    const throwingChecksum = new RecordingSecretManager((response) => ({
      ...response,
      payload: {
        ...response.payload,
        dataCrc32c: { value: { toString: () => { throw new Error('private coercion'); } } },
      },
    }));
    await expectDependencyError(() => loadProductionSecrets(config(), throwingChecksum));
  });

  test.each([
    ['provider failure', undefined, 'public_key' as const],
    ['wrong name', (response: KmsPublicKeyResponse) => ({ ...response, name: 'projects/other/keyVersions/1' }), null],
    ['wrong algorithm', (response: KmsPublicKeyResponse) => ({ ...response, algorithm: 'EC_SIGN_P256_SHA256' }), null],
    ['wrong checksum', (response: KmsPublicKeyResponse) => ({ ...response, pemCrc32c: { value: 0 } }), null],
    ['wrong public key', (response: KmsPublicKeyResponse) => {
      const pem = secondKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      return { ...response, pem, pemCrc32c: { value: crc32c(Buffer.from(pem, 'utf8')) } };
    }, null],
  ] as Array<[string, PublicKeyTransform | undefined, 'public_key' | null]>)('fails closed on a KMS public-key %s', async (_name, transform, failure) => {
    const kms = new RecordingKms(transform, undefined, failure);
    await expectDependencyError(() => KmsAccessTokenSigner.create(config(), kms));
    expect(kms.publicKeyCalls).toHaveLength(1);
    expect(kms.signCalls).toHaveLength(0);
  });

  test('normalizes malformed KMS public-key responses and coercion failures', async () => {
    await expectDependencyError(() => KmsAccessTokenSigner.create(
      config(),
      new RecordingKms(() => undefined as unknown as KmsPublicKeyResponse),
    ));
    await expectDependencyError(() => KmsAccessTokenSigner.create(
      config(),
      new RecordingKms((response) => ({
        ...response,
        pemCrc32c: { value: { toString: () => { throw new Error('private coercion'); } } },
      })),
    ));
  });

  test.each([
    ['provider failure', undefined, 'sign' as const, generated.privateKey],
    ['wrong name', (response: KmsSignResponse) => ({ ...response, name: 'projects/other/keyVersions/1' }), null, generated.privateKey],
    ['unverified request checksum', (response: KmsSignResponse) => ({ ...response, verifiedDataCrc32c: false }), null, generated.privateKey],
    ['wrong signature checksum', (response: KmsSignResponse) => ({ ...response, signatureCrc32c: { value: 0 } }), null, generated.privateKey],
    ['wrong key signature', (response: KmsSignResponse) => response, null, secondKey.privateKey],
  ] as Array<[string, SignatureTransform | undefined, 'sign' | null, KeyObject]>)('does not retry or expose a KMS signing %s', async (_name, transform, failure, signingKey) => {
    const kms = new RecordingKms(undefined, transform, failure, signingKey);
    const signer = await KmsAccessTokenSigner.create(config(), kms);
    await expectDependencyError(() => signer.sign(GRANT));
    expect(kms.signCalls).toHaveLength(1);
  });

  test('normalizes malformed KMS signing responses and coercion failures', async () => {
    for (const transform of [
      () => undefined as unknown as KmsSignResponse,
      (response: KmsSignResponse) => ({
        ...response,
        signatureCrc32c: { value: { toString: () => { throw new Error('private coercion'); } } },
      }),
    ]) {
      const kms = new RecordingKms(undefined, transform);
      const signer = await KmsAccessTokenSigner.create(config(), kms);
      await expectDependencyError(() => signer.sign(GRANT));
    }
  });
});
