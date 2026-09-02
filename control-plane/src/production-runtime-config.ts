import { CONTROL_PLANE_ADMISSION_PROFILE } from './admission-profile.js';
import type { LoadedProductionSecrets } from './cloud-security.js';
import {
  ProductionConfigurationError,
  parseProductionSecurityConfig,
  type ProductionEnvironment,
  type ProductionSecurityConfig,
} from './production-config.js';
import type { DeploymentConfig } from './types.js';

const MAXIMUM_ORIGINS = 8;
const GRAPHIC_ASCII = /^[\x21-\x7e]+$/;
const FIREBASE_APP_ID = /^1:[1-9][0-9]{0,19}:(?:android|ios|web):[A-Za-z0-9]{16,64}$/;
const COMPONENT_BUCKETS = Object.freeze({
  staging: 'miakapp-v4-staging-components',
  production: 'miakapp-v4-components',
} as const);
const SERVICE_ACCOUNTS = Object.freeze({
  staging: 'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
  production: 'miakapp-control-plane@miakapp-v4.iam.gserviceaccount.com',
} as const);
const EMULATOR_VARIABLES = Object.freeze([
  'FIREBASE_AUTH_EMULATOR_HOST',
  'FIREBASE_DATABASE_EMULATOR_HOST',
  'FIREBASE_FIRESTORE_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
  'FIRESTORE_EMULATOR_HOST',
  'FUNCTIONS_EMULATOR',
  'FUNCTIONS_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST',
] as const);
const CREDENTIAL_AND_ENDPOINT_OVERRIDES = Object.freeze([
  'ALL_PROXY',
  'GCE_METADATA_HOST',
  'GCE_METADATA_IP',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'google_application_credentials',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_CLOUD_UNIVERSE_DOMAIN',
  'GOOGLE_SDK_NODE_LOGGING',
  'GRPC_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'all_proxy',
  'grpc_proxy',
  'http_proxy',
  'https_proxy',
] as const);

export interface ProductionRuntimeConfig {
  readonly schema: 'miakapp.production-runtime/1';
  readonly environment: ProductionEnvironment;
  readonly security: ProductionSecurityConfig;
  readonly allowedOrigins: readonly string[];
  readonly appCheckAppId: string;
  readonly componentBucket: string;
  readonly serviceAccountEmail: string;
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

function origin(value: unknown, environment: ProductionEnvironment): string {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > 2_048
    || !GRAPHIC_ASCII.test(value)) {
    fail();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail();
  }
  const exactOrigin = parsed.origin;
  const stagingHost = parsed.hostname === 'staging.miakapp.com'
    || parsed.hostname.endsWith('.staging.miakapp.com');
  const productionHost = parsed.hostname === 'miakapp.com'
    || parsed.hostname.endsWith('.miakapp.com');
  if (parsed.protocol !== 'https:'
    || value !== exactOrigin
    || parsed.username.length !== 0
    || parsed.password.length !== 0
    || parsed.port.length !== 0
    || (environment === 'staging' ? !stagingHost : !productionHost || stagingHost)) {
    fail();
  }
  return exactOrigin;
}

function origins(value: unknown, environment: ProductionEnvironment): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_ORIGINS) fail();
  const parsed = value.map((entry) => origin(entry, environment));
  if (new Set(parsed).size !== parsed.length) fail();
  return Object.freeze(parsed);
}

function appId(value: unknown): string {
  if (typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') > 128
    || !FIREBASE_APP_ID.test(value)) {
    fail();
  }
  return value;
}

export function parseProductionRuntimeConfig(input: unknown): ProductionRuntimeConfig {
  const candidate = record(input, [
    'schema',
    'security',
    'allowed_origins',
    'app_check_app_id',
    'component_bucket',
  ]);
  if (candidate.schema !== 'miakapp.production-runtime/1') fail();
  const security = parseProductionSecurityConfig(candidate.security);
  const componentBucket = candidate.component_bucket;
  if (typeof componentBucket !== 'string'
    || componentBucket !== COMPONENT_BUCKETS[security.environment]) fail();
  return Object.freeze({
    schema: 'miakapp.production-runtime/1',
    environment: security.environment,
    security,
    allowedOrigins: origins(candidate.allowed_origins, security.environment),
    appCheckAppId: appId(candidate.app_check_app_id),
    componentBucket,
    serviceAccountEmail: SERVICE_ACCOUNTS[security.environment],
  });
}

export function assertProductionRuntimeEnvironment(
  config: ProductionRuntimeConfig,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (EMULATOR_VARIABLES.some((name) => {
    const value = environment[name];
    return value !== undefined && value.length !== 0;
  })
    || CREDENTIAL_AND_ENDPOINT_OVERRIDES.some((name) => {
      const value = environment[name];
      return value !== undefined && value.length !== 0;
    })) {
    fail();
  }
  const projectIds = [environment.GCLOUD_PROJECT, environment.GOOGLE_CLOUD_PROJECT]
    .filter((value): value is string => value !== undefined && value.length !== 0);
  if (projectIds.length === 0 || projectIds.some((value) => value !== config.security.projectId)) {
    fail();
  }
}

export function createProductionDeploymentConfig(
  runtime: ProductionRuntimeConfig,
  secrets: LoadedProductionSecrets,
): DeploymentConfig {
  const { issuer, projectId, region, signing } = runtime.security;
  return Object.freeze({
    projectId,
    region,
    allowedOrigins: new Set(runtime.allowedOrigins),
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    exchangeEndpoint: `${issuer}/v1/access-tokens:exchange`,
    pushAudience: `${issuer}/v1/push`,
    componentsAudience: `${issuer}/v1/components`,
    componentBucket: runtime.componentBucket,
    componentUploadBaseUrl: `${issuer}/v1/component-uploads`,
    componentArtifactBaseUrl: `${issuer}/v1/components`,
    componentKeyVersion: secrets.componentKeyVersion,
    componentHmacKeyForVersion: secrets.componentHmacKeyForVersion,
    verifierKeyVersion: secrets.verifierKeyVersion,
    homeKeyPepperForVersion: secrets.homeKeyPepperForVersion,
    appCheckAppId: runtime.appCheckAppId,
    pushKeyVersion: secrets.pushKeyVersion,
    pushHmacKeyForVersion: secrets.pushHmacKeyForVersion,
    admissionProfile: CONTROL_PLANE_ADMISSION_PROFILE,
    auditKeyVersion: secrets.auditKeyVersion,
    auditHmacKeyForVersion: secrets.auditHmacKeyForVersion,
    networkKeyVersion: secrets.networkKeyVersion,
    networkHmacKeyForVersion: secrets.networkHmacKeyForVersion,
    signingPublicJwk: signing.publicJwk,
  });
}
