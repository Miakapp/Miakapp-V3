import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';

import {
  crc32c,
  type KmsClient,
  type SecretManagerClient,
} from '../../src/cloud-security.js';
import type { ComponentStorageBucket } from '../../src/component-storage.js';
import {
  createFirebaseProductionServices,
  createProductionControlPlane,
  type FirebaseProductionServices,
  type ProductionRuntimeFactories,
} from '../../src/production-runtime.js';
import { createProductionRuntimeIdentity } from '../../src/production-identity.js';
import { parseProductionRuntimeConfig } from '../../src/production-runtime-config.js';

const keyPair = generateKeyPairSync('ed25519');
const exportedPublicKey = keyPair.publicKey.export({ format: 'jwk' });
if (exportedPublicKey.x === undefined) throw new Error('Generated Ed25519 key is invalid');
const publicJwk = Object.freeze({
  kty: 'OKP',
  crv: 'Ed25519',
  x: exportedPublicKey.x,
  use: 'sig',
  alg: 'EdDSA',
  kid: 'staging-access-token-v1',
});
const publicPem = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();

function keyring(secretId: string) {
  return {
    current_version: 'v1',
    versions: [{
      logical_version: 'v1',
      resource_name: `projects/miakapp-v4-staging/secrets/${secretId}/versions/1`,
    }],
  };
}

function candidate(): Record<string, unknown> {
  return {
    schema: 'miakapp.production-runtime/1',
    security: {
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
    },
    allowed_origins: ['https://app.staging.miakapp.com'],
    app_check_app_id: '1:1234567890:web:0123456789abcdef',
    component_bucket: 'miakapp-v4-staging-components',
  };
}

function fakeFirebase(
  identity: FirebaseProductionServices['identity'],
): FirebaseProductionServices {
  const bucket: ComponentStorageBucket = {
    name: 'miakapp-v4-staging-components',
    file() {
      throw new Error('Storage must not be touched during composition');
    },
  };
  return {
    auth: {
      verifyIdToken: async () => Promise.reject(new Error('not invoked')),
    },
    appCheck: {
      verifyToken: async () => Promise.reject(new Error('not invoked')),
    },
    firestore: {} as Firestore,
    identity,
    componentBucket: bucket,
  };
}

function fakeCloud(counters: { secretReads: number; publicKeyReads: number }): {
  readonly kms: KmsClient;
  readonly secrets: SecretManagerClient;
} {
  const secret = new Uint8Array(32).fill(7);
  return {
    secrets: {
      async accessSecretVersion(request) {
        counters.secretReads += 1;
        return [{
          name: request.name,
          payload: {
            data: new Uint8Array(secret),
            dataCrc32c: crc32c(secret),
          },
        }];
      },
    },
    kms: {
      async getPublicKey(request) {
        counters.publicKeyReads += 1;
        return [{
          name: request.name,
          algorithm: 'EC_SIGN_ED25519',
          pem: publicPem,
          pemCrc32c: { value: crc32c(Buffer.from(publicPem, 'utf8')) },
        }];
      },
      async asymmetricSign(request) {
        const signature = sign(null, request.data, keyPair.privateKey);
        return [{
          name: request.name,
          signature,
          signatureCrc32c: { value: crc32c(signature) },
          verifiedDataCrc32c: true,
        }];
      },
    },
  };
}

describe('inactive production composition root', () => {
  test('assembles every dependency once with injected offline clients', async () => {
    const counters = {
      identity: 0,
      firebase: 0,
      cloud: 0,
      secretReads: 0,
      publicKeyReads: 0,
    };
    const factories: ProductionRuntimeFactories = {
      identity(runtime) {
        counters.identity += 1;
        return createProductionRuntimeIdentity(runtime);
      },
      firebase(runtime, identity) {
        counters.firebase += 1;
        expect(runtime).toMatchObject({
          environment: 'staging',
          componentBucket: 'miakapp-v4-staging-components',
        });
        return fakeFirebase(identity);
      },
      cloudSecurity(runtime, identity) {
        counters.cloud += 1;
        expect(runtime.security.projectId).toBe('miakapp-v4-staging');
        expect(identity.serviceAccountEmail)
          .toBe('miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com');
        return fakeCloud(counters);
      },
    };

    const composition = await createProductionControlPlane(candidate(), {
      environment: { GCLOUD_PROJECT: 'miakapp-v4-staging' },
      factories,
      clock: { now: () => 1_788_220_800_000 },
    });

    expect(composition.environment).toBe('staging');
    expect(composition.projectId).toBe('miakapp-v4-staging');
    expect(typeof composition.application).toBe('function');
    expect(Object.isFrozen(composition)).toBe(true);
    expect(counters).toEqual({
      identity: 1,
      firebase: 1,
      cloud: 1,
      secretReads: 5,
      publicKeyReads: 1,
    });
  });

  test('rejects configuration and runtime-boundary failures before constructing any SDK client', async () => {
    let constructions = 0;
    const factories: ProductionRuntimeFactories = {
      identity(runtime) {
        constructions += 1;
        return createProductionRuntimeIdentity(runtime);
      },
      firebase(_runtime, identity) {
        constructions += 1;
        return fakeFirebase(identity);
      },
      cloudSecurity() {
        constructions += 1;
        return fakeCloud({ secretReads: 0, publicKeyReads: 0 });
      },
    };

    await expect(createProductionControlPlane(candidate(), {
      environment: { GCLOUD_PROJECT: 'miakapp-v4-staging', FUNCTIONS_EMULATOR: 'true' },
      factories,
    })).rejects.toThrow(/configuration is invalid/);
    await expect(createProductionControlPlane({ schema: 'wrong' }, {
      environment: { GCLOUD_PROJECT: 'miakapp-v4-staging' },
      factories,
    })).rejects.toThrow(/configuration is invalid/);
    expect(constructions).toBe(0);
  });

  test('requires an injected environment and factories to cross the same boundary', async () => {
    await expect(createProductionControlPlane(candidate(), {
      environment: { GCLOUD_PROJECT: 'miakapp-v4-staging' },
    })).rejects.toThrow(/configuration is invalid/);
  });

  test('rejects a same-named Firebase app that was not created by this composition root', async () => {
    const name = 'miakapp-control-plane-staging';
    const foreign = initializeApp({
      projectId: 'miakapp-v4-staging',
      storageBucket: 'miakapp-v4-staging-components',
    }, name);
    try {
      const runtime = parseProductionRuntimeConfig(candidate());
      const identity = createProductionRuntimeIdentity(runtime);
      expect(() => createFirebaseProductionServices(runtime, identity))
        .toThrow(/configuration is invalid/);
    } finally {
      await deleteApp(foreign);
    }
  });
});
