import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';

import { CONTROL_PLANE_ADMISSION_PROFILE } from '../../src/admission-profile.js';
import type { LoadedProductionSecrets } from '../../src/cloud-security.js';
import { ProductionConfigurationError } from '../../src/production-config.js';
import { createProductionRuntimeIdentity } from '../../src/production-identity.js';
import {
  assertProductionRuntimeEnvironment,
  createProductionDeploymentConfig,
  parseProductionRuntimeConfig,
} from '../../src/production-runtime-config.js';

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

function security() {
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

function candidate(): Record<string, any> {
  return {
    schema: 'miakapp.production-runtime/1',
    security: security(),
    allowed_origins: ['https://app.staging.miakapp.com'],
    app_check_app_id: '1:1234567890:web:0123456789abcdef',
    component_bucket: 'miakapp-v4-staging-components',
  };
}

function productionCandidate(): Record<string, any> {
  const value = candidate();
  const productionSecurity = value.security as ReturnType<typeof security>;
  productionSecurity.environment = 'production';
  productionSecurity.project_id = 'miakapp-v4';
  productionSecurity.issuer = 'https://control.miakapp.com';
  productionSecurity.signing.key_version_name = productionSecurity.signing.key_version_name
    .replaceAll('miakapp-v4-staging', 'miakapp-v4');
  for (const entry of Object.values(productionSecurity.secret_manager.keyrings)) {
    entry.versions[0]!.resource_name = entry.versions[0]!.resource_name
      .replace('miakapp-v4-staging', 'miakapp-v4');
  }
  value.allowed_origins = ['https://app.miakapp.com'];
  value.component_bucket = 'miakapp-v4-components';
  return value;
}

function secrets(): LoadedProductionSecrets {
  const key = new Uint8Array(32).fill(7);
  const resolver = (version: string) => version === 'v1' ? new Uint8Array(key) : undefined;
  return {
    verifierKeyVersion: 'v1',
    homeKeyPepperForVersion: resolver,
    componentKeyVersion: 'v1',
    componentHmacKeyForVersion: resolver,
    pushKeyVersion: 'v1',
    pushHmacKeyForVersion: resolver,
    auditKeyVersion: 'v1',
    auditHmacKeyForVersion: resolver,
    networkKeyVersion: 'v1',
    networkHmacKeyForVersion: resolver,
  };
}

describe('production runtime configuration', () => {
  test('parses a closed staging document and derives the complete deployment config', async () => {
    const runtime = parseProductionRuntimeConfig(candidate());
    const deployment = createProductionDeploymentConfig(runtime, secrets());
    const identity = createProductionRuntimeIdentity(runtime);

    expect(runtime).toMatchObject({
      environment: 'staging',
      componentBucket: 'miakapp-v4-staging-components',
      allowedOrigins: ['https://app.staging.miakapp.com'],
      serviceAccountEmail: 'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
    });
    expect(deployment).toMatchObject({
      projectId: 'miakapp-v4-staging',
      issuer: 'https://control.staging.miakapp.com',
      jwksUri: 'https://control.staging.miakapp.com/.well-known/jwks.json',
      exchangeEndpoint: 'https://control.staging.miakapp.com/v1/access-tokens:exchange',
      pushAudience: 'https://control.staging.miakapp.com/v1/push',
      componentsAudience: 'https://control.staging.miakapp.com/v1/components',
      componentUploadBaseUrl: 'https://control.staging.miakapp.com/v1/component-uploads',
      componentArtifactBaseUrl: 'https://control.staging.miakapp.com/v1/components',
      appCheckAppId: '1:1234567890:web:0123456789abcdef',
    });
    expect(deployment.admissionProfile).toBe(CONTROL_PLANE_ADMISSION_PROFILE);
    expect([...deployment.allowedOrigins]).toEqual(['https://app.staging.miakapp.com']);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(deployment)).toBe(true);
    expect(identity.authClient.serviceAccountEmail).toBe(runtime.serviceAccountEmail);
    expect(identity.authClient.scopes).toContain('https://www.googleapis.com/auth/firebase.messaging');
    const cloudAuthClient = await identity.googleAuth.getClient();
    expect('serviceAccountEmail' in cloudAuthClient
      && cloudAuthClient.serviceAccountEmail).toBe(runtime.serviceAccountEmail);
  });

  test('accepts only the matching production origin and component bucket', () => {
    expect(parseProductionRuntimeConfig(productionCandidate())).toMatchObject({
      environment: 'production',
      componentBucket: 'miakapp-v4-components',
      allowedOrigins: ['https://app.miakapp.com'],
    });
    const wrongBucket = productionCandidate();
    wrongBucket.component_bucket = 'miakapp-v4-staging-components';
    expect(() => parseProductionRuntimeConfig(wrongBucket)).toThrow(ProductionConfigurationError);
  });

  test('rejects unknown fields, unsafe origins, duplicate origins, and malformed app IDs', () => {
    const mutations: Array<(value: Record<string, any>) => void> = [
      (value) => { value.unreviewed = true; },
      (value) => { value.allowed_origins = ['http://app.staging.miakapp.com']; },
      (value) => { value.allowed_origins = ['https://app.miakapp.com']; },
      (value) => { value.allowed_origins = ['https://app.staging.miakapp.com', 'https://app.staging.miakapp.com']; },
      (value) => { value.app_check_app_id = 'demo-app'; },
      (value) => { value.component_bucket = 'attacker-bucket'; },
    ];
    for (const mutate of mutations) {
      const value = candidate();
      mutate(value);
      expect(() => parseProductionRuntimeConfig(value)).toThrow(ProductionConfigurationError);
    }
  });

  test('requires the attached project identity and rejects emulator, credential, and endpoint overrides', () => {
    const runtime = parseProductionRuntimeConfig(candidate());
    expect(() => assertProductionRuntimeEnvironment(runtime, {
      GCLOUD_PROJECT: 'miakapp-v4-staging',
    })).not.toThrow();
    expect(() => assertProductionRuntimeEnvironment(runtime, {
      GOOGLE_CLOUD_PROJECT: 'miakapp-v4-staging',
    })).not.toThrow();

    for (const environment of [
      {},
      { GCLOUD_PROJECT: 'miakapp-v4' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', FUNCTIONS_EMULATOR: 'true' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', GCE_METADATA_HOST: 'attacker.test' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', GCE_METADATA_IP: '127.0.0.1' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', google_application_credentials: '/tmp/key.json' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', GOOGLE_CLOUD_QUOTA_PROJECT: 'foreign-project' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', GOOGLE_CLOUD_UNIVERSE_DOMAIN: 'attacker.test' },
      { GCLOUD_PROJECT: 'miakapp-v4-staging', GOOGLE_SDK_NODE_LOGGING: 'secret-manager' },
    ]) {
      expect(() => assertProductionRuntimeEnvironment(runtime, environment))
        .toThrow(ProductionConfigurationError);
    }
  });
});
