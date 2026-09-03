import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import { ProductionConfigurationError } from '../../src/production-config.js';
import { parseRequestJson } from '../../src/json.js';
import {
  buildInitialStagingRuntimeDocument,
  validateInitialStagingRuntimeDocument,
} from '../../src/staging-runtime-document.js';

const purposes = [
  'homeKeyPepper',
  'componentHmac',
  'pushHmac',
  'auditHmac',
  'networkHmac',
] as const;

function candidate(): Record<string, any> {
  return {
    schema: 'miakapp.staging-runtime-inputs/1',
    firebase_app_id: '1:1072737219170:web:0123456789abcdef',
    signing_public_key_x: Buffer.alloc(32, 7).toString('base64url'),
    secret_versions: Object.fromEntries(purposes.map((purpose, index) => [purpose, index + 1])),
  };
}

describe('initial staging runtime document', () => {
  test('accepts the exact activated public runtime document committed as evidence', () => {
    const bytes = readFileSync(new URL(
      '../../../infrastructure/staging/activation/runtime-config.json',
      import.meta.url,
    ));
    expect(createHash('sha256').update(bytes).digest('hex'))
      .toBe('b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8');
    const runtime = validateInitialStagingRuntimeDocument(parseRequestJson(bytes));
    expect(runtime.appCheckAppId).toBe('1:1072737219170:web:5053ca93bf25d7373cd73b');
    expect(runtime.security.signing.publicJwk.x)
      .toBe('eINmaVIFYgARhSMf1pBb9yRstrT_6LfO5d12WFL5Dsw');
    expect(runtime.security.secretManager.keyrings.homeKeyPepper.versions[0]?.resourceName)
      .toBe('projects/miakapp-v4-staging/secrets/miakapp-home-key-pepper/versions/1');
  });

  test('builds the exact non-secret production runtime profile with numeric references', () => {
    const document = buildInitialStagingRuntimeDocument(candidate());
    const runtime = validateInitialStagingRuntimeDocument(document);

    expect(runtime).toMatchObject({
      environment: 'staging',
      appCheckAppId: '1:1072737219170:web:0123456789abcdef',
      allowedOrigins: ['https://app.staging.miakapp.com'],
      componentBucket: 'miakapp-v4-staging-components',
      serviceAccountEmail: 'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
      security: {
        projectId: 'miakapp-v4-staging',
        region: 'europe-west9',
        issuer: 'https://control.staging.miakapp.com',
        signing: {
          keyVersionName: 'projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing/cryptoKeyVersions/1',
          rpcTimeoutMilliseconds: 2_000,
        },
        secretManager: { rpcTimeoutMilliseconds: 1_500 },
      },
    });
    for (const [index, purpose] of purposes.entries()) {
      expect(runtime.security.secretManager.keyrings[purpose]).toMatchObject({
        currentVersion: 'v1',
        versions: [{
          logicalVersion: 'v1',
          resourceName: expect.stringContaining(`/versions/${index + 1}`),
        }],
      });
    }
    expect(JSON.stringify(document)).not.toMatch(/secret_data|private_key|"d"/);
  });

  test('rejects alternate projects, unknown fields, invalid app IDs, keys, and versions', () => {
    const mutations: Array<(value: Record<string, any>) => void> = [
      (value) => { value.project_id = 'miakapp-3'; },
      (value) => { value.unreviewed = true; },
      (value) => { value.firebase_app_id = '1:603250078961:web:0123456789abcdef'; },
      (value) => { value.signing_public_key_x = Buffer.alloc(31).toString('base64url'); },
      (value) => { value.secret_versions.homeKeyPepper = 0; },
      (value) => { value.secret_versions.networkHmac = '1'; },
      (value) => { value.secret_versions.secretBytes = 'forbidden'; },
    ];
    for (const mutate of mutations) {
      const value = candidate();
      mutate(value);
      expect(() => buildInitialStagingRuntimeDocument(value)).toThrow(ProductionConfigurationError);
    }
  });

  test('rejects a runtime document outside the exact initialization phase', () => {
    const document = buildInitialStagingRuntimeDocument(candidate()) as Record<string, any>;
    document.allowed_origins = ['https://attacker.example.test'];
    expect(() => validateInitialStagingRuntimeDocument(document))
      .toThrow(ProductionConfigurationError);

    const second = buildInitialStagingRuntimeDocument(candidate()) as Record<string, any>;
    second.security.secret_manager.keyrings.auditHmac.versions.push({
      logical_version: 'v2',
      resource_name: 'projects/miakapp-v4-staging/secrets/miakapp-audit-hmac/versions/2',
    });
    expect(() => validateInitialStagingRuntimeDocument(second))
      .toThrow(ProductionConfigurationError);
  });
});
