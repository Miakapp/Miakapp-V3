import {
  ProductionConfigurationError,
  PRODUCTION_SECRET_IDS,
  type ProductionSecretPurpose,
} from './production-config.js';
import { isDeepStrictEqual } from 'node:util';

import {
  parseProductionRuntimeConfig,
  type ProductionRuntimeConfig,
} from './production-runtime-config.js';
import { classifyProductionSecretKeyringsTransition } from './production-secret-lifecycle.js';
import type { JsonValue } from './json.js';

const PROJECT_ID = 'miakapp-v4-staging';
const REGION = 'europe-west9';
const ISSUER = 'https://control.staging.miakapp.com';
const ALLOWED_ORIGIN = 'https://app.staging.miakapp.com';
const COMPONENT_BUCKET = 'miakapp-v4-staging-components';
const SIGNING_KEY_VERSION = `projects/${PROJECT_ID}/locations/${REGION}/keyRings/${PROJECT_ID}/cryptoKeys/access-token-signing/cryptoKeyVersions/1`;
const FIREBASE_APP_ID = /^1:1072737219170:web:[A-Za-z0-9]{16,64}$/;
const BASE64URL = /^[A-Za-z0-9_-]{43}$/;
const SECRET_PURPOSES = Object.freeze(
  Object.keys(PRODUCTION_SECRET_IDS) as ProductionSecretPurpose[],
);

export interface InitialStagingRuntimeInputs {
  readonly schema: 'miakapp.staging-runtime-inputs/1';
  readonly firebase_app_id: string;
  readonly signing_public_key_x: string;
  readonly secret_versions: Readonly<Record<ProductionSecretPurpose, number>>;
}

function fail(): never {
  throw new ProductionConfigurationError();
}

function record(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail();
  return value as Readonly<Record<string, unknown>>;
}

function publicKeyX(value: unknown): string {
  if (typeof value !== 'string'
    || !BASE64URL.test(value)
    || Buffer.from(value, 'base64url').byteLength !== 32
    || Buffer.from(value, 'base64url').toString('base64url') !== value) {
    fail();
  }
  return value;
}

function versionNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail();
  return value as number;
}

export function buildInitialStagingRuntimeDocument(input: unknown): JsonValue {
  const candidate = record(input, [
    'schema',
    'firebase_app_id',
    'signing_public_key_x',
    'secret_versions',
  ]);
  if (candidate.schema !== 'miakapp.staging-runtime-inputs/1'
    || typeof candidate.firebase_app_id !== 'string'
    || !FIREBASE_APP_ID.test(candidate.firebase_app_id)) {
    fail();
  }
  const versions = record(candidate.secret_versions, SECRET_PURPOSES);
  const keyrings = Object.fromEntries(SECRET_PURPOSES.map((purpose) => {
    const version = versionNumber(versions[purpose]);
    return [purpose, {
      current_version: 'v1',
      versions: [{
        logical_version: 'v1',
        resource_name: `projects/${PROJECT_ID}/secrets/${PRODUCTION_SECRET_IDS[purpose]}/versions/${version}`,
      }],
    }];
  }));
  const document: JsonValue = {
    schema: 'miakapp.production-runtime/1',
    security: {
      schema: 'miakapp.production-security/1',
      environment: 'staging',
      project_id: PROJECT_ID,
      region: REGION,
      issuer: ISSUER,
      signing: {
        key_version_name: SIGNING_KEY_VERSION,
        public_jwk: {
          kty: 'OKP',
          crv: 'Ed25519',
          x: publicKeyX(candidate.signing_public_key_x),
          use: 'sig',
          alg: 'EdDSA',
          kid: 'staging-access-token-v1',
        },
        rpc_timeout_ms: 2_000,
      },
      secret_manager: {
        rpc_timeout_ms: 1_500,
        keyrings,
      },
    },
    allowed_origins: [ALLOWED_ORIGIN],
    app_check_app_id: candidate.firebase_app_id,
    component_bucket: COMPONENT_BUCKET,
  };
  validateInitialStagingRuntimeDocument(document);
  return document;
}

export function validateInitialStagingRuntimeDocument(
  document: unknown,
): ProductionRuntimeConfig {
  try {
    const runtime = parseProductionRuntimeConfig(document);
    if (runtime.environment !== 'staging'
      || runtime.security.projectId !== PROJECT_ID
      || runtime.security.region !== REGION
      || runtime.security.issuer !== ISSUER
      || runtime.componentBucket !== COMPONENT_BUCKET
      || runtime.allowedOrigins.length !== 1
      || runtime.allowedOrigins[0] !== ALLOWED_ORIGIN
      || !FIREBASE_APP_ID.test(runtime.appCheckAppId)
      || runtime.security.signing.keyVersionName !== SIGNING_KEY_VERSION
      || runtime.security.signing.publicJwk.kid !== 'staging-access-token-v1'
      || runtime.security.signing.rpcTimeoutMilliseconds !== 2_000
      || runtime.security.secretManager.rpcTimeoutMilliseconds !== 1_500) {
      fail();
    }
    const classification = classifyProductionSecretKeyringsTransition(
      undefined,
      runtime.security.secretManager.keyrings,
    );
    if (classification.transition !== 'initialize'
      || classification.purposes.length !== SECRET_PURPOSES.length) {
      fail();
    }
    for (const purpose of SECRET_PURPOSES) {
      const keyring = runtime.security.secretManager.keyrings[purpose];
      const reference = keyring.versions[0];
      const resourceBase = `projects/${PROJECT_ID}/secrets/${PRODUCTION_SECRET_IDS[purpose]}/versions/`;
      if (keyring.currentVersion !== 'v1'
        || keyring.versions.length !== 1
        || reference?.logicalVersion !== 'v1'
        || !reference.resourceName.startsWith(resourceBase)
        || !/^[1-9][0-9]*$/.test(reference.resourceName.slice(resourceBase.length))) {
        fail();
      }
    }
    return runtime;
  } catch {
    throw new ProductionConfigurationError();
  }
}

export function buildStagingRuntimeSchema2MigrationDocument(
  initialDocument: unknown,
): JsonValue {
  const initial = validateInitialStagingRuntimeDocument(initialDocument);
  const signing = initial.security.signing;
  const keyrings = Object.fromEntries(SECRET_PURPOSES.map((purpose) => [purpose, {
    current_version: initial.security.secretManager.keyrings[purpose].currentVersion,
    versions: initial.security.secretManager.keyrings[purpose].versions.map((reference) => ({
      logical_version: reference.logicalVersion,
      resource_name: reference.resourceName,
    })),
  }]));
  const document: JsonValue = {
    schema: 'miakapp.production-runtime/2',
    security: {
      schema: 'miakapp.production-security/2',
      environment: 'staging',
      project_id: PROJECT_ID,
      region: REGION,
      issuer: ISSUER,
      signing: {
        current_kid: signing.currentKid,
        versions: [{
          key_version_name: signing.keyVersionName,
          public_jwk: {
            kty: 'OKP',
            crv: 'Ed25519',
            x: signing.publicJwk.x,
            use: 'sig',
            alg: 'EdDSA',
            kid: signing.publicJwk.kid,
          },
        }],
        rpc_timeout_ms: signing.rpcTimeoutMilliseconds,
      },
      secret_manager: {
        rpc_timeout_ms: initial.security.secretManager.rpcTimeoutMilliseconds,
        keyrings,
      },
    },
    allowed_origins: [...initial.allowedOrigins],
    app_check_app_id: initial.appCheckAppId,
    component_bucket: initial.componentBucket,
  };
  parseProductionRuntimeConfig(document);
  return document;
}

export function validateStagingRuntimeSchema2MigrationDocument(
  initialDocument: unknown,
  migratedDocument: unknown,
): ProductionRuntimeConfig {
  try {
    const expected = buildStagingRuntimeSchema2MigrationDocument(initialDocument);
    if (!isDeepStrictEqual(migratedDocument, expected)) fail();
    const runtime = parseProductionRuntimeConfig(migratedDocument);
    if (runtime.schema !== 'miakapp.production-runtime/2'
      || runtime.security.schema !== 'miakapp.production-security/2'
      || runtime.security.signing.versions.length !== 1
      || runtime.security.signing.currentKid !== 'staging-access-token-v1'
      || runtime.security.signing.keyVersionName !== SIGNING_KEY_VERSION) {
      fail();
    }
    return runtime;
  } catch {
    throw new ProductionConfigurationError();
  }
}
