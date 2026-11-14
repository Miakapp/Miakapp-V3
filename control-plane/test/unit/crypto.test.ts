import { describe, expect, test } from 'bun:test';

import { loadEmulatorConfig } from '../fixture-config.js';
import {
  deriveHomeKeyVerifier,
  generateHomeKey,
  homeKeyVerifierMatches,
  parseHomeKey,
} from '../../src/crypto.js';

const environment = {
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: 'demo-miakapp-v4',
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
    expect(homeKeyVerifierMatches(generated.value, pepper, verifier)).toBe(true);
    expect(homeKeyVerifierMatches(generated.value, pepper, 'A'.repeat(43))).toBe(false);
  });

  test('refuses to load synthetic signing material outside the exact demo emulator', () => {
    expect(() => loadEmulatorConfig({
      FUNCTIONS_EMULATOR: 'true',
      GCLOUD_PROJECT: 'miakapp-3',
    } as NodeJS.ProcessEnv)).toThrow(/restricted to the demo Firebase Emulator project/);
    expect(() => loadEmulatorConfig({
      GCLOUD_PROJECT: 'demo-miakapp-v4',
    } as NodeJS.ProcessEnv)).toThrow(/restricted to the demo Firebase Emulator project/);
  });
});
