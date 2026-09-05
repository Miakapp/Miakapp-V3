import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import { ProductionConfigurationError } from '../../src/production-config.js';
import { parseRequestJson } from '../../src/json.js';
import { parseProductionRuntimeConfig } from '../../src/production-runtime-config.js';
import {
  buildInitialStagingRuntimeDocument,
  buildStagingRuntimeSchema2MigrationDocument,
  validateInitialStagingRuntimeDocument,
  validateStagingRuntimeSchema2MigrationDocument,
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

  test('migrates the committed staging document to schema 2 without changing its effective key', () => {
    const initial = parseRequestJson(readFileSync(new URL(
      '../../../infrastructure/staging/activation/runtime-config.json',
      import.meta.url,
    )));
    const migratedBytes = readFileSync(new URL(
      '../../../infrastructure/staging/workload/runtime-config-single-key.json',
      import.meta.url,
    ));
    const migrated = parseRequestJson(migratedBytes);

    expect(buildStagingRuntimeSchema2MigrationDocument(initial)).toEqual(migrated);
    const runtime = validateStagingRuntimeSchema2MigrationDocument(initial, migrated);
    expect(runtime.schema).toBe('miakapp.production-runtime/2');
    expect(runtime.security.schema).toBe('miakapp.production-security/2');
    expect(runtime.security.signing.currentKid).toBe('staging-access-token-v1');
    expect(runtime.security.signing.publicJwks).toHaveLength(1);
    expect(runtime.security.signing.publicJwk.x)
      .toBe('eINmaVIFYgARhSMf1pBb9yRstrT_6LfO5d12WFL5Dsw');
    expect(JSON.stringify(migrated)).not.toMatch(/secret_data|private_key|"d"/);
  });

  test('rejects any unrelated change in the schema-2 migration document', () => {
    const initial = buildInitialStagingRuntimeDocument(candidate());
    for (const mutate of [
      (value: Record<string, any>) => { value.allowed_origins = ['https://other.staging.miakapp.com']; },
      (value: Record<string, any>) => { value.security.signing.current_kid = 'future'; },
      (value: Record<string, any>) => { value.security.signing.versions[0].public_jwk.kid = 'future'; },
      (value: Record<string, any>) => { value.security.signing.versions.push(value.security.signing.versions[0]); },
      (value: Record<string, any>) => { value.security.secret_manager.rpc_timeout_ms = 1_501; },
    ]) {
      const migrated = structuredClone(
        buildStagingRuntimeSchema2MigrationDocument(initial),
      ) as Record<string, any>;
      mutate(migrated);
      expect(() => validateStagingRuntimeSchema2MigrationDocument(initial, migrated))
        .toThrow(ProductionConfigurationError);
    }
  });

  test('accepts the exact two-key prepublication target with version 1 current', () => {
    const current = parseRequestJson(readFileSync(new URL(
      '../../../infrastructure/staging/workload/runtime-config-single-key.json',
      import.meta.url,
    ))) as Record<string, any>;
    const targetBytes = readFileSync(new URL(
      '../../../infrastructure/staging/workload/runtime-config.json',
      import.meta.url,
    ));
    expect(createHash('sha256').update(targetBytes).digest('hex'))
      .toBe('c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37');
    const target = parseRequestJson(targetBytes) as Record<string, any>;
    const expected = structuredClone(current) as Record<string, any>;
    expected.security.signing.versions.push({
      key_version_name: 'projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing/cryptoKeyVersions/2',
      public_jwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: 'IjvnOpjvmNbnYrlUiMwlRUYnrEuc8VS5VZ7WHd7t1VE',
        use: 'sig',
        alg: 'EdDSA',
        kid: 'staging-access-token-v2',
      },
    });
    expect(target).toEqual(expected);
    const runtime = parseProductionRuntimeConfig(target);
    expect(runtime.security.signing.currentKid).toBe('staging-access-token-v1');
    expect(runtime.security.signing.publicJwks).toHaveLength(2);
    expect(runtime.security.signing.publicJwk.kid).toBe('staging-access-token-v1');
  });
});
