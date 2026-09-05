import {
  createPublicKey,
  verify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

import {
  prepareAccessToken,
  serializeAccessToken,
  type SignedAccessToken,
} from './crypto.js';
import {
  type PinnedSigningKeyVersionReference,
  type PinnedSecretKeyringConfig,
  type ProductionSecretPurpose,
  type ProductionSecurityConfig,
} from './production-config.js';
import type { AccessGrant, SigningPublicJwk } from './types.js';

const KMS_ED25519_ALGORITHM = 'EC_SIGN_ED25519';
const MAXIMUM_PEM_BYTES = 8_192;
const SECRET_MANAGER_RESPONSE_PROJECTS = Object.freeze({
  staging: Object.freeze(['miakapp-v4-staging', '1072737219170']),
  production: Object.freeze(['miakapp-v4']),
} as const);

export interface CloudCallOptions {
  readonly timeout: number;
  readonly retry: null;
}

interface WrappedChecksumValue {
  readonly value?: unknown;
}

export interface SecretManagerAccessResponse {
  readonly name?: string | null;
  readonly payload?: Readonly<{
    readonly data?: Uint8Array | string | null;
    readonly dataCrc32c?: unknown;
  }> | null;
}

export interface SecretManagerClient {
  accessSecretVersion(
    request: Readonly<{ readonly name: string }>,
    options: CloudCallOptions,
  ): Promise<readonly [SecretManagerAccessResponse, ...unknown[]]>;
}

export interface KmsPublicKeyResponse {
  readonly name?: string | null;
  readonly algorithm?: string | number | null;
  readonly pem?: string | null;
  readonly pemCrc32c?: WrappedChecksumValue | null;
}

export interface KmsSignResponse {
  readonly name?: string | null;
  readonly signature?: Uint8Array | string | null;
  readonly signatureCrc32c?: WrappedChecksumValue | null;
  readonly verifiedDataCrc32c?: boolean | null;
}

export interface KmsClient {
  getPublicKey(
    request: Readonly<{ readonly name: string }>,
    options: CloudCallOptions,
  ): Promise<readonly [KmsPublicKeyResponse, ...unknown[]]>;
  asymmetricSign(
    request: Readonly<{
      readonly name: string;
      readonly data: Uint8Array;
      readonly dataCrc32c: Readonly<{ readonly value: number }>;
    }>,
    options: CloudCallOptions,
  ): Promise<readonly [KmsSignResponse, ...unknown[]]>;
}

export interface LoadedProductionSecrets {
  readonly verifierKeyVersion: string;
  readonly homeKeyPepperForVersion: (version: string) => Uint8Array | undefined;
  readonly componentKeyVersion: string;
  readonly componentHmacKeyForVersion: (version: string) => Uint8Array | undefined;
  readonly pushKeyVersion: string;
  readonly pushHmacKeyForVersion: (version: string) => Uint8Array | undefined;
  readonly auditKeyVersion: string;
  readonly auditHmacKeyForVersion: (version: string) => Uint8Array | undefined;
  readonly networkKeyVersion: string;
  readonly networkHmacKeyForVersion: (version: string) => Uint8Array | undefined;
}

export interface ProductionSecurityDependencies {
  readonly secrets: LoadedProductionSecrets;
  readonly signer: KmsAccessTokenSigner;
}

export class ProductionDependencyError extends Error {
  constructor() {
    super('Production security dependency is unavailable');
    this.name = 'ProductionDependencyError';
  }
}

function fail(): never {
  throw new ProductionDependencyError();
}

export function crc32c(input: Uint8Array): number {
  let checksum = 0xffff_ffff;
  for (const byte of input) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0x82f6_3b78 & -(checksum & 1));
    }
  }
  return (~checksum) >>> 0;
}

function checksumNumber(value: unknown): number {
  const raw = value !== null
    && typeof value === 'object'
    && Object.hasOwn(value, 'value')
    ? (value as WrappedChecksumValue).value
    : value;
  let parsed: number;
  if (typeof raw === 'number') parsed = raw;
  else if (typeof raw === 'bigint' || typeof raw === 'string') parsed = Number(raw);
  else if (raw !== null && typeof raw === 'object') parsed = Number(String(raw));
  else return fail();
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) fail();
  return parsed;
}

function bytes(value: Uint8Array | string | null | undefined): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return fail();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) fail();
  return new Uint8Array(decoded);
}

function callOptions(timeout: number): CloudCallOptions {
  return Object.freeze({ timeout, retry: null });
}

function firstResponse<Response extends object>(result: unknown): Response {
  if (!Array.isArray(result)
    || result.length === 0
    || result[0] === null
    || Array.isArray(result[0])
    || typeof result[0] !== 'object') {
    fail();
  }
  return result[0] as Response;
}

function secretResolver(keys: ReadonlyMap<string, Uint8Array>): (
  version: string,
) => Uint8Array | undefined {
  return (version: string): Uint8Array | undefined => {
    const key = keys.get(version);
    return key === undefined ? undefined : new Uint8Array(key);
  };
}

function sameSecretVersion(
  actual: unknown,
  requested: string,
  allowedProjects: readonly string[],
): boolean {
  const pattern = /^projects\/([^/]+)\/secrets\/([^/]+)\/versions\/([1-9][0-9]*)$/;
  const actualMatch = typeof actual === 'string' ? pattern.exec(actual) : null;
  const requestedMatch = pattern.exec(requested);
  return actualMatch !== null
    && requestedMatch !== null
    && allowedProjects.includes(actualMatch[1] as string)
    && actualMatch[2] === requestedMatch[2]
    && actualMatch[3] === requestedMatch[3];
}

async function loadKeyring(
  keyring: PinnedSecretKeyringConfig,
  client: SecretManagerClient,
  timeout: number,
  responseProjects: readonly string[],
): Promise<ReadonlyMap<string, Uint8Array>> {
  const entries = await Promise.all(keyring.versions.map(async (reference) => {
    try {
      const response = firstResponse<SecretManagerAccessResponse>(
        await client.accessSecretVersion(
          { name: reference.resourceName },
          callOptions(timeout),
        ),
      );
      const payload = response.payload;
      if (payload === null || Array.isArray(payload) || typeof payload !== 'object') fail();
      const key = bytes(payload.data);
      if (!sameSecretVersion(response.name, reference.resourceName, responseProjects)
        || key.byteLength !== 32
        || checksumNumber(payload.dataCrc32c) !== crc32c(key)) {
        fail();
      }
      return [reference.logicalVersion, key] as const;
    } catch {
      return fail();
    }
  }));
  return new Map(entries);
}

export async function loadProductionSecrets(
  config: ProductionSecurityConfig,
  client: SecretManagerClient,
): Promise<LoadedProductionSecrets> {
  const purposes = [
    'homeKeyPepper',
    'componentHmac',
    'pushHmac',
    'auditHmac',
    'networkHmac',
  ] as const;
  const loaded = new Map<ProductionSecretPurpose, ReadonlyMap<string, Uint8Array>>(
    await Promise.all(purposes.map(async (purpose) => [
      purpose,
      await loadKeyring(
        config.secretManager.keyrings[purpose],
        client,
        config.secretManager.rpcTimeoutMilliseconds,
        SECRET_MANAGER_RESPONSE_PROJECTS[config.environment],
      ),
    ] as const)),
  );

  const resolved = (purpose: ProductionSecretPurpose): ReadonlyMap<string, Uint8Array> => {
    const keyring = loaded.get(purpose);
    if (keyring === undefined) return fail();
    return keyring;
  };
  return Object.freeze({
    verifierKeyVersion: config.secretManager.keyrings.homeKeyPepper.currentVersion,
    homeKeyPepperForVersion: secretResolver(resolved('homeKeyPepper')),
    componentKeyVersion: config.secretManager.keyrings.componentHmac.currentVersion,
    componentHmacKeyForVersion: secretResolver(resolved('componentHmac')),
    pushKeyVersion: config.secretManager.keyrings.pushHmac.currentVersion,
    pushHmacKeyForVersion: secretResolver(resolved('pushHmac')),
    auditKeyVersion: config.secretManager.keyrings.auditHmac.currentVersion,
    auditHmacKeyForVersion: secretResolver(resolved('auditHmac')),
    networkKeyVersion: config.secretManager.keyrings.networkHmac.currentVersion,
    networkHmacKeyForVersion: secretResolver(resolved('networkHmac')),
  });
}

function publicJwkFromPem(pem: string): JsonWebKey {
  try {
    return createPublicKey(pem).export({ format: 'jwk' });
  } catch {
    return fail();
  }
}

function sameEd25519Key(actual: JsonWebKey, expected: SigningPublicJwk): boolean {
  return actual.kty === 'OKP'
    && actual.crv === 'Ed25519'
    && actual.x === expected.x
    && actual.d === undefined;
}

async function loadKmsPublicKey(
  reference: PinnedSigningKeyVersionReference,
  client: KmsClient,
  timeout: number,
): Promise<KeyObject> {
  const response = firstResponse<KmsPublicKeyResponse>(
    await client.getPublicKey(
      { name: reference.keyVersionName },
      callOptions(timeout),
    ),
  );
  const pem = response.pem;
  if (response.name !== reference.keyVersionName
    || (response.algorithm !== KMS_ED25519_ALGORITHM && response.algorithm !== 40)
    || typeof pem !== 'string'
    || pem.length === 0
    || Buffer.byteLength(pem, 'utf8') > MAXIMUM_PEM_BYTES
    || checksumNumber(response.pemCrc32c) !== crc32c(Buffer.from(pem, 'utf8'))) {
    fail();
  }
  const publicJwk = publicJwkFromPem(pem);
  if (!sameEd25519Key(publicJwk, reference.publicJwk)) fail();
  return createPublicKey({ key: reference.publicJwk, format: 'jwk' });
}

export class KmsAccessTokenSigner {
  readonly #client: KmsClient;
  readonly #issuer: string;
  readonly #keyVersionName: string;
  readonly #publicJwk: SigningPublicJwk;
  readonly #publicKey: KeyObject;
  readonly #options: CloudCallOptions;

  private constructor(
    client: KmsClient,
    config: ProductionSecurityConfig,
    publicKey: KeyObject,
  ) {
    this.#client = client;
    this.#issuer = config.issuer;
    this.#keyVersionName = config.signing.keyVersionName;
    this.#publicJwk = config.signing.publicJwk;
    this.#publicKey = publicKey;
    this.#options = callOptions(config.signing.rpcTimeoutMilliseconds);
  }

  static async create(
    config: ProductionSecurityConfig,
    client: KmsClient,
  ): Promise<KmsAccessTokenSigner> {
    try {
      const publicKeys = await Promise.all(config.signing.versions.map(async (reference) => ({
        keyVersionName: reference.keyVersionName,
        publicKey: await loadKmsPublicKey(
          reference,
          client,
          config.signing.rpcTimeoutMilliseconds,
        ),
      })));
      const publicKey = publicKeys.find((entry) => (
        entry.keyVersionName === config.signing.keyVersionName
      ))?.publicKey;
      if (publicKey === undefined) fail();
      return new KmsAccessTokenSigner(client, config, publicKey);
    } catch {
      return fail();
    }
  }

  async sign(grant: AccessGrant): Promise<SignedAccessToken> {
    const prepared = prepareAccessToken({
      issuer: this.#issuer,
      signingPublicJwk: this.#publicJwk,
    }, grant);
    const verificationData = Buffer.from(prepared.signingInput, 'ascii');
    const requestData = new Uint8Array(verificationData);
    try {
      const response = firstResponse<KmsSignResponse>(
        await this.#client.asymmetricSign({
          name: this.#keyVersionName,
          data: requestData,
          dataCrc32c: { value: crc32c(requestData) },
        }, this.#options),
      );
      const signature = bytes(response.signature);
      if (response.name !== this.#keyVersionName
        || response.verifiedDataCrc32c !== true
        || checksumNumber(response.signatureCrc32c) !== crc32c(signature)
        || signature.byteLength !== 64
        || !verify(null, verificationData, this.#publicKey, signature)) {
        fail();
      }
      return serializeAccessToken(prepared, signature);
    } catch {
      return fail();
    }
  }
}

export async function initializeProductionSecurity(
  config: ProductionSecurityConfig,
  clients: Readonly<{ readonly kms: KmsClient; readonly secrets: SecretManagerClient }>,
): Promise<ProductionSecurityDependencies> {
  const secrets = await loadProductionSecrets(config, clients.secrets);
  const signer = await KmsAccessTokenSigner.create(config, clients.kms);
  return Object.freeze({ secrets, signer });
}
