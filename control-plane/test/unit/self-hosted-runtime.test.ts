import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initializeProductionSecurity } from '../../src/cloud-security.js';
import { parseProductionSecurityConfig } from '../../src/production-config.js';
import {
  createFileComponentBucket,
  createLocalKmsClient,
  createLocalSecretClient,
} from '../../src/self-hosted-runtime.js';
import { STAGING_SELF_HOSTED_DAC_PROFILE } from '../../src/staging-browser-relay-edge-profile.js';

const PROJECT = 'miakapp-v4-staging';
const SECRETS = ['home-key-pepper', 'component-hmac', 'push-hmac', 'audit-hmac', 'network-hmac'];

function keyDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'miakapp-keys-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(join(directory, 'kms-access-token-signing-3.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }));
  for (const secret of SECRETS) {
    writeFileSync(join(directory, `secret-miakapp-${secret}-2`), randomBytes(32).toString('base64'));
  }
  return { directory, x: publicKey.export({ format: 'jwk' }).x as string };
}

function securityDocument(x: string) {
  const keyring = (secret: string) => ({
    current_version: 'v2',
    versions: [{ logical_version: 'v2', resource_name: `projects/${PROJECT}/secrets/miakapp-${secret}/versions/2` }],
  });
  return {
    schema: 'miakapp.production-security/2',
    environment: 'staging',
    project_id: PROJECT,
    region: 'europe-west9',
    issuer: STAGING_SELF_HOSTED_DAC_PROFILE.issuer,
    signing: {
      current_kid: 'dac-access-token-v3',
      versions: [{
        key_version_name: `projects/${PROJECT}/locations/europe-west9/keyRings/${PROJECT}/cryptoKeys/access-token-signing/cryptoKeyVersions/3`,
        public_jwk: { kty: 'OKP', crv: 'Ed25519', x, use: 'sig', alg: 'EdDSA', kid: 'dac-access-token-v3' },
      }],
      rpc_timeout_ms: 2000,
    },
    secret_manager: {
      rpc_timeout_ms: 1500,
      keyrings: {
        homeKeyPepper: keyring('home-key-pepper'),
        componentHmac: keyring('component-hmac'),
        pushHmac: keyring('push-hmac'),
        auditHmac: keyring('audit-hmac'),
        networkHmac: keyring('network-hmac'),
      },
    },
  };
}

describe('self-hosted security adapters', () => {
  test('mounted keys satisfy the unchanged KMS and Secret Manager checks', async () => {
    const { directory, x } = keyDirectory();
    const config = parseProductionSecurityConfig(securityDocument(x));
    const security = await initializeProductionSecurity(config, {
      kms: createLocalKmsClient(directory),
      secrets: createLocalSecretClient(directory),
    });
    expect(security.secrets.homeKeyPepperForVersion('v2')?.byteLength).toBe(32);
    const signed = await security.signer.sign({
      subjectKind: 'home_key',
      issuedAt: 1_788_220_800,
      tokenId: Buffer.alloc(16, 1).toString('base64url'),
      homeId: 'synthetic-home',
      clientId: Buffer.alloc(16, 2).toString('base64url'),
      label: 'Synthetic coordinator',
      scope: 'relay:coordinator',
      audience: 'wss://miakapp-relay.dac.cclabs.cx/ws',
      role: 'coordinator',
      coordinatorName: 'automation',
    });
    const header = JSON.parse(Buffer.from(signed.token.split('.')[0] as string, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(signed.token.split('.')[1] as string, 'base64url').toString());
    expect(header).toMatchObject({ alg: 'EdDSA', kid: 'dac-access-token-v3' });
    expect(payload.iss).toBe(STAGING_SELF_HOSTED_DAC_PROFILE.issuer);
  });

  test('a key that does not match the pinned public JWK is refused', async () => {
    const { directory } = keyDirectory();
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x as string;
    const config = parseProductionSecurityConfig(securityDocument(other));
    await expect(initializeProductionSecurity(config, {
      kms: createLocalKmsClient(directory),
      secrets: createLocalSecretClient(directory),
    })).rejects.toThrow();
  });
});

describe('file component bucket', () => {
  const options = {
    resumable: false,
    validation: 'crc32c',
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: 'text/javascript; charset=utf-8', cacheControl: 'no-store', metadata: { sha256: 'abc' } },
  } as const;

  test('creates once, reads back bytes and metadata, refuses overwrite', async () => {
    const bucket = createFileComponentBucket(mkdtempSync(join(tmpdir(), 'miakapp-objects-')), 'b');
    const file = bucket.file('artifacts/x.js');
    expect((await file.exists())[0]).toBe(false);
    await expect(file.getMetadata()).rejects.toMatchObject({ code: 404 });
    await file.save(new TextEncoder().encode('export {};'), options as never);
    expect((await file.exists())[0]).toBe(true);
    expect((await file.download())[0].toString()).toBe('export {};');
    expect((await file.getMetadata())[0]).toMatchObject({ size: 10, cacheControl: 'no-store', metadata: { sha256: 'abc' } });
    await expect(file.save(new TextEncoder().encode('other'), options as never)).rejects.toMatchObject({ code: 412 });
    expect((await file.download())[0].toString()).toBe('export {};');
  });
});
