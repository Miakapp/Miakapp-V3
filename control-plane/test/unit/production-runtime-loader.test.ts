import { describe, expect, test } from 'bun:test';

import { ProductionConfigurationError } from '../../src/production-config.js';
import {
  MAXIMUM_PRODUCTION_RUNTIME_CONFIG_BYTES,
  PRODUCTION_RUNTIME_CONFIG_VARIABLE,
  loadProductionRuntimeConfig,
} from '../../src/production-runtime-loader.js';

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
    schema: 'miakapp.production-runtime/1',
    security: {
      schema: 'miakapp.production-security/1',
      environment: 'staging',
      project_id: 'miakapp-v4-staging',
      region: 'europe-west9',
      issuer: 'https://control.staging.miakapp.com',
      signing: {
        key_version_name: 'projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing/cryptoKeyVersions/1',
        public_jwk: {
          kty: 'OKP',
          crv: 'Ed25519',
          x: Buffer.alloc(32, 7).toString('base64url'),
          use: 'sig',
          alg: 'EdDSA',
          kid: 'staging-access-token-v1',
        },
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
    },
    allowed_origins: ['https://app.staging.miakapp.com'],
    app_check_app_id: '1:1234567890:web:0123456789abcdef',
    component_bucket: 'miakapp-v4-staging-components',
  };
}

function environment(document: string): Readonly<Record<string, string>> {
  return { [PRODUCTION_RUNTIME_CONFIG_VARIABLE]: document };
}

function expectInvalid(document: string | undefined, expectedEnvironment: 'staging' | 'production' = 'staging'): void {
  let thrown: unknown;
  try {
    loadProductionRuntimeConfig(
      expectedEnvironment,
      document === undefined ? {} : environment(document),
    );
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProductionConfigurationError);
  expect(thrown).toMatchObject({ message: 'Production security configuration is invalid' });
}

describe('production runtime configuration loader', () => {
  test('loads and freezes exactly one bounded non-secret staging document', () => {
    const loaded = loadProductionRuntimeConfig('staging', environment(JSON.stringify(candidate())));

    expect(loaded.config).toMatchObject({
      environment: 'staging',
      componentBucket: 'miakapp-v4-staging-components',
      security: {
        projectId: 'miakapp-v4-staging',
        region: 'europe-west9',
      },
    });
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.document)).toBe(true);
    expect(JSON.stringify(loaded.document)).not.toContain('private_key');
  });

  test('rejects absent, empty, oversized, malformed, and duplicate-key input generically', () => {
    expectInvalid(undefined);
    expectInvalid('');
    expectInvalid('   ');
    expectInvalid('x'.repeat(MAXIMUM_PRODUCTION_RUNTIME_CONFIG_BYTES + 1));
    expectInvalid('{');

    const duplicate = JSON.stringify(candidate()).replace(
      '"schema":',
      '"schema":"miakapp.production-runtime/1","schema":',
    );
    expectInvalid(duplicate);
  });

  test('rejects an unknown field, wrong environment, secret bytes, and private signing key', () => {
    const unknown = candidate();
    unknown.unreviewed = true;
    expectInvalid(JSON.stringify(unknown));

    expectInvalid(JSON.stringify(candidate()), 'production');

    const secret = candidate();
    secret.security.secret_manager.keyrings.homeKeyPepper.value = Buffer.alloc(32, 1).toString('base64');
    expectInvalid(JSON.stringify(secret));

    const privateJwk = candidate();
    privateJwk.security.signing.public_jwk.d = Buffer.alloc(32, 2).toString('base64url');
    expectInvalid(JSON.stringify(privateJwk));
  });

  test('rejects mutable or noncanonical cloud resource versions', () => {
    for (const version of ['latest', '0', '01']) {
      const input = candidate();
      input.security.secret_manager.keyrings.networkHmac.versions[0].resource_name =
        input.security.secret_manager.keyrings.networkHmac.versions[0].resource_name
          .replace('/1', `/${version}`);
      expectInvalid(JSON.stringify(input));
    }

    const alternateOnly = { MIAKAPP_RUNTIME_CONFIG: JSON.stringify(candidate()) };
    expect(() => loadProductionRuntimeConfig('staging', alternateOnly))
      .toThrow(ProductionConfigurationError);
  });
});
