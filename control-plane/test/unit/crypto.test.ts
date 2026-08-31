import { describe, expect, test } from 'bun:test';

import { loadEmulatorConfig } from '../../src/config.js';
import {
  AccessTokenSigner,
  deriveHomeKeyVerifier,
  generateHomeKey,
  homeKeyVerifierMatches,
  parseHomeKey,
} from '../../src/crypto.js';
import type { AccessGrant } from '../../src/types.js';
import {
  deriveHomeKeyVerifier as contractVerifier,
  loadAccessTokenFixture,
} from '../../../control-plane-contract/typescript/src/profile.js';
import { verifyMiakappAccessToken } from '../../../control-plane-contract/typescript/src/token.js';

const environment = {
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: 'demo-miakapp-v35',
} as NodeJS.ProcessEnv;

describe('control-plane cryptography', () => {
  test('generates exact Home Keys and compares HMAC verifiers in constant-time form', () => {
    const config = loadEmulatorConfig(environment);
    const pepper = config.homeKeyPepperForVersion(config.verifierKeyVersion);
    if (pepper === undefined) throw new Error('Synthetic pepper version is unavailable');
    const generated = generateHomeKey();
    expect(generated.value).toMatch(/^mhk1_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/);
    expect(parseHomeKey(generated.value).keyId).toBe(generated.keyId);
    const verifier = deriveHomeKeyVerifier(generated.value, pepper);
    expect(verifier).toBe(contractVerifier(generated.value, pepper));
    expect(homeKeyVerifierMatches(generated.value, pepper, verifier)).toBe(true);
    expect(homeKeyVerifierMatches(generated.value, pepper, 'A'.repeat(43))).toBe(false);
  });

  test('issues a five-minute coordinator token accepted by the independent contract verifier', async () => {
    const fixture = await loadAccessTokenFixture();
    const config = loadEmulatorConfig(environment);
    const signer = new AccessTokenSigner(config);
    const grant: AccessGrant = {
      issuedAt: fixture.now,
      tokenId: Buffer.alloc(16, 15).toString('base64url'),
      homeId: 'synthetic-home',
      clientId: fixture.home_key.key_id,
      label: 'Synthetic coordinator',
      scope: 'relay:coordinator',
      audience: fixture.deployment.relay_audience,
      role: 'coordinator',
      coordinatorName: 'automation',
    };
    const signed = signer.sign(grant);
    expect(signed.expiresAtMs).toBe((fixture.now + 300) * 1_000);
    const identity = verifyMiakappAccessToken(
      signed.token,
      fixture,
      'coordinator',
      fixture.key_sets.rotated.keys,
    );
    expect(identity).toEqual({
      home_id: 'synthetic-home',
      principal_id: 'synthetic-home',
      client_id: fixture.home_key.key_id,
      scope: 'relay:coordinator',
      expires_at: fixture.now + 300,
      role: 'coordinator',
      coordinator_name: 'automation',
    });
  });

  test('refuses to load synthetic signing material outside the exact demo emulator', () => {
    expect(() => loadEmulatorConfig({
      FUNCTIONS_EMULATOR: 'true',
      GCLOUD_PROJECT: 'miakapp-3',
    } as NodeJS.ProcessEnv)).toThrow(/restricted to the demo Firebase Emulator project/);
    expect(() => loadEmulatorConfig({
      GCLOUD_PROJECT: 'demo-miakapp-v35',
    } as NodeJS.ProcessEnv)).toThrow(/restricted to the demo Firebase Emulator project/);
  });
});
