import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  ProductionConfigurationError,
  parseProductionSecurityConfig,
} from '../../src/production-config.js';

const publicJwk = (() => {
  const exported = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  if (exported.x === undefined) throw new Error('Generated Ed25519 key is invalid');
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: exported.x,
    use: 'sig',
    alg: 'EdDSA',
    kid: 'staging-access-token-v1',
  };
})();

function keyring(secretId: string) {
  return {
    current_version: 'v1',
    versions: [{
      logical_version: 'v1',
      resource_name: `projects/miakapp-v4-staging/secrets/${secretId}/versions/1`,
    }],
  };
}

function candidate(): Record<string, any> {
  return {
    schema: 'miakapp.production-security/1',
    environment: 'staging',
    project_id: 'miakapp-v4-staging',
    region: 'europe-west1',
    issuer: 'https://control.staging.miakapp.com',
    signing: {
      key_version_name: 'projects/miakapp-v4-staging/locations/europe-west1/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing/cryptoKeyVersions/1',
      public_jwk: publicJwk,
      rpc_timeout_ms: 2_000,
    },
    secret_manager: {
      rpc_timeout_ms: 1_500,
      keyrings: {
        homeKeyPepper: keyring('miakapp-home-key-pepper'),
        componentHmac: keyring('miakapp-component-hmac'),
        pushHmac: keyring('miakapp-push-hmac'),
        auditHmac: keyring('miakapp-audit-hmac'),
        networkHmac: keyring('miakapp-network-hmac'),
      },
    },
  };
}

function expectInvalid(mutator: (value: Record<string, any>) => void): void {
  const input = candidate();
  mutator(input);
  let thrown: unknown;
  try {
    parseProductionSecurityConfig(input);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProductionConfigurationError);
  expect(thrown).toMatchObject({ message: 'Production security configuration is invalid' });
}

describe('production security configuration', () => {
  test('accepts and freezes exact staging references without private key material', () => {
    const parsed = parseProductionSecurityConfig(candidate());
    expect(parsed).toMatchObject({
      environment: 'staging',
      projectId: 'miakapp-v4-staging',
      region: 'europe-west1',
      issuer: 'https://control.staging.miakapp.com',
      signing: {
        rpcTimeoutMilliseconds: 2_000,
        publicJwk,
      },
      secretManager: { rpcTimeoutMilliseconds: 1_500 },
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.signing.publicJwk)).toBe(true);
    expect('signingPrivateJwk' in parsed).toBe(false);
    expect('d' in parsed.signing.publicJwk).toBe(false);
  });

  test('accepts only the explicit project paired with each non-emulator environment', () => {
    const production = candidate();
    production.environment = 'production';
    production.project_id = 'miakapp-v4';
    production.issuer = 'https://control.miakapp.com';
    production.signing.key_version_name = 'projects/miakapp-v4/locations/europe-west1/keyRings/miakapp-v4/cryptoKeys/access-token-signing/cryptoKeyVersions/9';
    for (const [purpose, entry] of Object.entries(production.secret_manager.keyrings)) {
      const typed = entry as ReturnType<typeof keyring>;
      typed.versions[0]!.resource_name = typed.versions[0]!.resource_name
        .replace('miakapp-v4-staging', 'miakapp-v4');
      production.secret_manager.keyrings[purpose] = typed;
    }
    expect(parseProductionSecurityConfig(production).projectId).toBe('miakapp-v4');

    for (const projectId of ['miakapp-3', 'demo-miakapp-v4', 'miakapp-v4']) {
      expectInvalid((value) => { value.project_id = projectId; });
    }
  });

  test('binds each environment to one exact access-token issuer', () => {
    expectInvalid((value) => { value.issuer = 'https://control.miakapp.com'; });

    const production = candidate();
    production.environment = 'production';
    production.project_id = 'miakapp-v4';
    production.issuer = 'https://control.staging.miakapp.com';
    production.signing.key_version_name = production.signing.key_version_name
      .replaceAll('miakapp-v4-staging', 'miakapp-v4');
    for (const entry of Object.values(production.secret_manager.keyrings)) {
      const typed = entry as ReturnType<typeof keyring>;
      typed.versions[0]!.resource_name = typed.versions[0]!.resource_name
        .replace('miakapp-v4-staging', 'miakapp-v4');
    }
    expect(() => parseProductionSecurityConfig(production)).toThrow(ProductionConfigurationError);
  });

  test('rejects unknown fields and embedded private signing material', () => {
    expectInvalid((value) => { value.unreviewed = true; });
    expectInvalid((value) => { value.signing.public_jwk.d = 'secret'; });
    expectInvalid((value) => { value.secret_manager.keyrings.homeKeyPepper.value = 'secret'; });
  });

  test('requires exact numeric KMS and Secret Manager versions in the same project', () => {
    for (const version of ['latest', '0', '01']) {
      expectInvalid((value) => {
        value.signing.key_version_name = value.signing.key_version_name.replace('/1', `/${version}`);
      });
      expectInvalid((value) => {
        value.secret_manager.keyrings.homeKeyPepper.versions[0].resource_name =
          value.secret_manager.keyrings.homeKeyPepper.versions[0].resource_name.replace('/1', `/${version}`);
      });
    }
    expectInvalid((value) => {
      value.signing.key_version_name = value.signing.key_version_name.replace(
        'projects/miakapp-v4-staging',
        'projects/attacker-project',
      );
    });
    expectInvalid((value) => {
      value.secret_manager.keyrings.auditHmac.versions[0].resource_name =
        'projects/miakapp-v4-staging/secrets/miakapp-network-hmac/versions/1';
    });
  });

  test('rejects ambiguous keyrings and unbounded RPC settings', () => {
    expectInvalid((value) => {
      value.secret_manager.keyrings.homeKeyPepper.current_version = 'missing';
    });
    expectInvalid((value) => {
      value.secret_manager.keyrings.homeKeyPepper.versions.push(
        value.secret_manager.keyrings.homeKeyPepper.versions[0],
      );
    });
    expectInvalid((value) => {
      value.secret_manager.keyrings.homeKeyPepper.versions.push(
        { logical_version: 'v2', resource_name: 'projects/miakapp-v4-staging/secrets/miakapp-home-key-pepper/versions/2' },
        { logical_version: 'v3', resource_name: 'projects/miakapp-v4-staging/secrets/miakapp-home-key-pepper/versions/3' },
      );
    });
    for (const timeout of [99, 10_001, 1.5, '2000']) {
      expectInvalid((value) => { value.signing.rpc_timeout_ms = timeout; });
    }
  });

  test('rejects noncanonical keys and issuer shapes', () => {
    for (const issuer of [
      'http://control.staging.miakapp.com',
      'https://control.staging.miakapp.com/',
      'https://control.example.test',
      'https://user@control.staging.miakapp.com',
      'https://control.staging.miakapp.com?key=value',
    ]) {
      expectInvalid((value) => { value.issuer = issuer; });
    }
    expectInvalid((value) => { value.signing.public_jwk.x = 'A'.repeat(42); });
    expectInvalid((value) => { value.signing.public_jwk.alg = 'RS256'; });
  });

  test('keeps the Firebase Function entry point emulator-only', () => {
    const source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    expect(source).toContain('loadEmulatorConfig');
    expect(source).not.toContain('parseProductionSecurityConfig');
    expect(source).not.toContain('initializeProductionSecurity');
    expect(source).not.toContain('createGoogleCloudSecurityClients');
  });
});
