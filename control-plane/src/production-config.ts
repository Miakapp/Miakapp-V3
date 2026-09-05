import type { SigningPublicJwk } from './types.js';

const EXPECTED_PROJECTS = Object.freeze({
  staging: 'miakapp-v4-staging',
  production: 'miakapp-v4',
} as const);
const EXPECTED_ISSUERS = Object.freeze({
  staging: 'https://control.staging.miakapp.com',
  production: 'https://control.miakapp.com',
} as const);
export const PRODUCTION_CONTROL_PLANE_REGION = 'europe-west9';
const LOGICAL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESOURCE_PART = /^[a-z][a-z0-9-]{0,62}$/;
const GRAPHIC_ASCII = /^[\x21-\x7e]+$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MINIMUM_RPC_TIMEOUT_MS = 100;
const MAXIMUM_RPC_TIMEOUT_MS = 10_000;
const MAXIMUM_KEYRING_VERSIONS = 2;
const MAXIMUM_SIGNING_VERSIONS = 2;

export const PRODUCTION_SECRET_IDS = Object.freeze({
  homeKeyPepper: 'miakapp-home-key-pepper',
  componentHmac: 'miakapp-component-hmac',
  pushHmac: 'miakapp-push-hmac',
  auditHmac: 'miakapp-audit-hmac',
  networkHmac: 'miakapp-network-hmac',
} as const);

export type ProductionEnvironment = keyof typeof EXPECTED_PROJECTS;
export type ProductionSecretPurpose = keyof typeof PRODUCTION_SECRET_IDS;
export type ProductionSecuritySchema =
  | 'miakapp.production-security/1'
  | 'miakapp.production-security/2';

export interface PinnedSecretVersionReference {
  readonly logicalVersion: string;
  readonly resourceName: string;
}

export interface PinnedSecretKeyringConfig {
  readonly currentVersion: string;
  readonly versions: readonly PinnedSecretVersionReference[];
}

export interface PinnedSigningKeyVersionReference {
  readonly keyVersionName: string;
  readonly publicJwk: SigningPublicJwk;
}

export interface ProductionSecurityConfig {
  readonly schema: ProductionSecuritySchema;
  readonly environment: ProductionEnvironment;
  readonly projectId: string;
  readonly region: typeof PRODUCTION_CONTROL_PLANE_REGION;
  readonly issuer: string;
  readonly signing: Readonly<{
    readonly currentKid: string;
    readonly versions: readonly PinnedSigningKeyVersionReference[];
    keyVersionName: string;
    publicJwk: SigningPublicJwk;
    publicJwks: readonly SigningPublicJwk[];
    rpcTimeoutMilliseconds: number;
  }>;
  readonly secretManager: Readonly<{
    rpcTimeoutMilliseconds: number;
    keyrings: Readonly<Record<ProductionSecretPurpose, PinnedSecretKeyringConfig>>;
  }>;
}

export class ProductionConfigurationError extends Error {
  constructor() {
    super('Production security configuration is invalid');
    this.name = 'ProductionConfigurationError';
  }
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

function boundedString(value: unknown, maximumBytes: number): string {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || !GRAPHIC_ASCII.test(value)) {
    fail();
  }
  return value;
}

function boundedTimeout(value: unknown): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < MINIMUM_RPC_TIMEOUT_MS
    || (value as number) > MAXIMUM_RPC_TIMEOUT_MS) {
    fail();
  }
  return value as number;
}

function canonicalPublicJwk(value: unknown): SigningPublicJwk {
  const jwk = record(value, ['kty', 'crv', 'x', 'use', 'alg', 'kid']);
  if (jwk.kty !== 'OKP'
    || jwk.crv !== 'Ed25519'
    || jwk.use !== 'sig'
    || jwk.alg !== 'EdDSA'
    || typeof jwk.x !== 'string'
    || !BASE64URL.test(jwk.x)
    || Buffer.from(jwk.x, 'base64url').byteLength !== 32
    || Buffer.from(jwk.x, 'base64url').toString('base64url') !== jwk.x) {
    fail();
  }
  const kid = boundedString(jwk.kid, 128);
  return Object.freeze({
    kty: 'OKP',
    crv: 'Ed25519',
    x: jwk.x,
    use: 'sig',
    alg: 'EdDSA',
    kid,
  });
}

function issuer(value: unknown, environment: ProductionEnvironment): string {
  const text = boundedString(value, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return fail();
  }
  if (parsed.protocol !== 'https:'
    || parsed.username.length !== 0
    || parsed.password.length !== 0
    || parsed.search.length !== 0
    || parsed.hash.length !== 0
    || parsed.pathname !== '/'
    || text.endsWith('/')
    || parsed.hostname.endsWith('.test')
    || text !== EXPECTED_ISSUERS[environment]) {
    fail();
  }
  return text;
}

function kmsVersionName(value: unknown, projectId: string): string {
  const name = boundedString(value, 512);
  const match = /^projects\/([^/]+)\/locations\/([^/]+)\/keyRings\/([^/]+)\/cryptoKeys\/([^/]+)\/cryptoKeyVersions\/([1-9][0-9]*)$/.exec(name);
  if (match?.[1] !== projectId
    || match[2] !== PRODUCTION_CONTROL_PLANE_REGION
    || match[3] !== projectId
    || match[4] !== 'access-token-signing'
    || !RESOURCE_PART.test(match[1])
    || !RESOURCE_PART.test(match[3])) {
    fail();
  }
  return name;
}

interface ParsedSigningConfig {
  readonly currentKid: string;
  readonly versions: readonly PinnedSigningKeyVersionReference[];
  readonly keyVersionName: string;
  readonly publicJwk: SigningPublicJwk;
  readonly publicJwks: readonly SigningPublicJwk[];
  readonly rpcTimeoutMilliseconds: number;
}

function legacySigningConfig(value: unknown, projectId: string): ParsedSigningConfig {
  const signing = record(value, [
    'key_version_name',
    'public_jwk',
    'rpc_timeout_ms',
  ]);
  const publicJwk = canonicalPublicJwk(signing.public_jwk);
  const keyVersionName = kmsVersionName(signing.key_version_name, projectId);
  const currentKid = publicJwk.kid;
  const versions = Object.freeze([Object.freeze({
    keyVersionName,
    publicJwk,
  })]);
  return Object.freeze({
    currentKid,
    versions,
    keyVersionName,
    publicJwk,
    publicJwks: Object.freeze([publicJwk]),
    rpcTimeoutMilliseconds: boundedTimeout(signing.rpc_timeout_ms),
  });
}

function rotatingSigningConfig(value: unknown, projectId: string): ParsedSigningConfig {
  const signing = record(value, [
    'current_kid',
    'versions',
    'rpc_timeout_ms',
  ]);
  const currentKid = boundedString(signing.current_kid, 128);
  if (!Array.isArray(signing.versions)
    || signing.versions.length === 0
    || signing.versions.length > MAXIMUM_SIGNING_VERSIONS) {
    fail();
  }
  const keyVersionNames = new Set<string>();
  const keyIds = new Set<string>();
  const publicKeys = new Set<string>();
  const versions = signing.versions.map((entry) => {
    const reference = record(entry, [
      'key_version_name',
      'public_jwk',
    ]);
    const keyVersionName = kmsVersionName(reference.key_version_name, projectId);
    const publicJwk = canonicalPublicJwk(reference.public_jwk);
    if (keyVersionNames.has(keyVersionName)
      || keyIds.has(publicJwk.kid)
      || publicKeys.has(publicJwk.x)) {
      fail();
    }
    keyVersionNames.add(keyVersionName);
    keyIds.add(publicJwk.kid);
    publicKeys.add(publicJwk.x);
    return Object.freeze({ keyVersionName, publicJwk });
  });
  const current = versions.find((version) => version.publicJwk.kid === currentKid);
  if (current === undefined) fail();
  return Object.freeze({
    currentKid,
    versions: Object.freeze(versions),
    keyVersionName: current.keyVersionName,
    publicJwk: current.publicJwk,
    publicJwks: Object.freeze(versions.map((version) => version.publicJwk)),
    rpcTimeoutMilliseconds: boundedTimeout(signing.rpc_timeout_ms),
  });
}

function secretVersionName(value: unknown, projectId: string, secretId: string): string {
  const name = boundedString(value, 512);
  const match = /^projects\/([^/]+)\/secrets\/([^/]+)\/versions\/([1-9][0-9]*)$/.exec(name);
  if (match?.[1] !== projectId || match[2] !== secretId || !RESOURCE_PART.test(match[1])) fail();
  return name;
}

function keyring(
  value: unknown,
  projectId: string,
  secretId: string,
): PinnedSecretKeyringConfig {
  const candidate = record(value, ['current_version', 'versions']);
  const currentVersion = boundedString(candidate.current_version, 64);
  if (!LOGICAL_VERSION.test(currentVersion)
    || !Array.isArray(candidate.versions)
    || candidate.versions.length === 0
    || candidate.versions.length > MAXIMUM_KEYRING_VERSIONS) {
    fail();
  }
  const logicalVersions = new Set<string>();
  const resourceNames = new Set<string>();
  const versions = candidate.versions.map((entry) => {
    const reference = record(entry, ['logical_version', 'resource_name']);
    const logicalVersion = boundedString(reference.logical_version, 64);
    if (!LOGICAL_VERSION.test(logicalVersion) || logicalVersions.has(logicalVersion)) fail();
    const resourceName = secretVersionName(reference.resource_name, projectId, secretId);
    if (resourceNames.has(resourceName)) fail();
    logicalVersions.add(logicalVersion);
    resourceNames.add(resourceName);
    return Object.freeze({ logicalVersion, resourceName });
  });
  if (!logicalVersions.has(currentVersion)) fail();
  return Object.freeze({ currentVersion, versions: Object.freeze(versions) });
}

export function parseProductionSecurityConfig(input: unknown): ProductionSecurityConfig {
  const config = record(input, [
    'schema',
    'environment',
    'project_id',
    'region',
    'issuer',
    'signing',
    'secret_manager',
  ]);
  if ((config.schema !== 'miakapp.production-security/1'
      && config.schema !== 'miakapp.production-security/2')
    || (config.environment !== 'staging' && config.environment !== 'production')) {
    fail();
  }
  const schema = config.schema;
  const environment = config.environment;
  const projectId = boundedString(config.project_id, 63);
  if (projectId !== EXPECTED_PROJECTS[environment]
    || config.region !== PRODUCTION_CONTROL_PLANE_REGION
    || projectId.startsWith('demo-')) {
    fail();
  }

  const signing = schema === 'miakapp.production-security/1'
    ? legacySigningConfig(config.signing, projectId)
    : rotatingSigningConfig(config.signing, projectId);
  const secretManager = record(config.secret_manager, [
    'rpc_timeout_ms',
    'keyrings',
  ]);
  const keyrings = record(secretManager.keyrings, Object.keys(PRODUCTION_SECRET_IDS));

  const parsedKeyrings = Object.fromEntries(
    Object.entries(PRODUCTION_SECRET_IDS).map(([purpose, secretId]) => [
      purpose,
      keyring(keyrings[purpose], projectId, secretId),
    ]),
  ) as unknown as Readonly<Record<ProductionSecretPurpose, PinnedSecretKeyringConfig>>;

  return Object.freeze({
    schema,
    environment,
    projectId,
    region: PRODUCTION_CONTROL_PLANE_REGION,
    issuer: issuer(config.issuer, environment),
    signing,
    secretManager: Object.freeze({
      rpcTimeoutMilliseconds: boundedTimeout(secretManager.rpc_timeout_ms),
      keyrings: Object.freeze(parsedKeyrings),
    }),
  });
}
