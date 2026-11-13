import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getAppCheck } from 'firebase-admin/app-check';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import type { Compute } from 'google-auth-library';
import { GoogleAuth } from 'google-gax';

import {
  crc32c,
  type KmsClient,
  type SecretManagerClient,
} from './cloud-security.js';
import type { ComponentStorageBucket, ComponentStorageFile } from './component-storage.js';
import { FirebaseAdminAuthVerifier } from './auth.js';
import {
  createProductionControlPlane,
  type FirebaseProductionServices,
  type ProductionControlPlane,
  type ProductionRuntimeFactories,
} from './production-runtime.js';
import type { ProductionRuntimeConfig } from './production-runtime-config.js';
import type { ProductionRuntimeIdentity } from './production-identity.js';

/**
 * Self-hosted composition of the production control plane, for clusters that
 * run outside Google Cloud compute (Kubernetes on DAC). Firebase Auth, App
 * Check and Firestore stay on the Firebase project; what Cloud KMS, Secret
 * Manager and Cloud Storage used to provide comes from a mounted key directory
 * and a persistent volume. The runtime document keeps its exact schema: its
 * KMS and Secret Manager resource names become logical names of local files.
 *
 * Key directory layout (all files mode 0400, mounted from a Kubernetes Secret):
 *   kms-<cryptoKey>-<version>.pem   Ed25519 PKCS#8 private key
 *   secret-<secret>-<version>       32 random bytes, base64
 */

const SERVICE_ACCOUNT_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/userinfo.email',
]);

export interface SelfHostedOptions {
  /** Parsed service-account JSON key of the runtime identity. */
  readonly serviceAccount: Readonly<{
    readonly client_email: string;
    readonly private_key: string;
    readonly project_id: string;
  }>;
  readonly keyDirectory: string;
  readonly storageDirectory: string;
}

function kmsFileName(resourceName: string): string {
  const match = /\/cryptoKeys\/([^/]+)\/cryptoKeyVersions\/([1-9][0-9]*)$/.exec(resourceName);
  if (match === null) throw new Error('Unsupported KMS key version name');
  return `kms-${match[1]}-${match[2]}.pem`;
}

function secretFileName(resourceName: string): string {
  const match = /\/secrets\/([^/]+)\/versions\/([1-9][0-9]*)$/.exec(resourceName);
  if (match === null) throw new Error('Unsupported secret version name');
  return `secret-${match[1]}-${match[2]}`;
}

export function createLocalKmsClient(keyDirectory: string): KmsClient {
  const keys = new Map<string, Promise<KeyObject>>();
  const privateKey = (name: string): Promise<KeyObject> => {
    let key = keys.get(name);
    if (key === undefined) {
      key = readFile(join(keyDirectory, kmsFileName(name)), 'utf8')
        .then((pem) => createPrivateKey(pem));
      keys.set(name, key);
    }
    return key;
  };
  return Object.freeze({
    async getPublicKey(request: Readonly<{ readonly name: string }>) {
      const pem = createPublicKey(await privateKey(request.name))
        .export({ format: 'pem', type: 'spki' })
        .toString();
      return [{
        name: request.name,
        algorithm: 'EC_SIGN_ED25519',
        pem,
        pemCrc32c: { value: crc32c(Buffer.from(pem, 'utf8')) },
      }] as const;
    },
    async asymmetricSign(request: Readonly<{
      readonly name: string;
      readonly data: Uint8Array;
      readonly dataCrc32c: Readonly<{ readonly value: number }>;
    }>) {
      const verified = crc32c(request.data) === request.dataCrc32c.value;
      const signature = new Uint8Array(sign(null, request.data, await privateKey(request.name)));
      return [{
        name: request.name,
        signature,
        signatureCrc32c: { value: crc32c(signature) },
        verifiedDataCrc32c: verified,
      }] as const;
    },
  });
}

export function createLocalSecretClient(keyDirectory: string): SecretManagerClient {
  return Object.freeze({
    async accessSecretVersion(request: Readonly<{ readonly name: string }>) {
      const text = (await readFile(join(keyDirectory, secretFileName(request.name)), 'utf8')).trim();
      const data = new Uint8Array(Buffer.from(text, 'base64'));
      return [{
        name: request.name,
        payload: { data, dataCrc32c: crc32c(data) },
      }] as const;
    },
  });
}

class FileStorageObject implements ComponentStorageFile {
  readonly #path: string;
  readonly #metadataPath: string;

  constructor(directory: string, name: string) {
    // Object names are control-plane generated (`staging/<id>`, `artifacts/<sha>.js`);
    // hashing keeps every one of them a single flat, traversal-free file name.
    const id = createHash('sha256').update(name, 'utf8').digest('hex');
    this.#path = join(directory, id);
    this.#metadataPath = join(directory, `${id}.metadata.json`);
  }

  async save(data: Uint8Array, options: Parameters<ComponentStorageFile['save']>[1]): Promise<void> {
    // ifGenerationMatch: 0 — create only, never overwrite. Metadata goes first
    // so that a visible object always has it; link() then publishes the bytes
    // atomically and refuses an existing object.
    const temporary = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, data, { flag: 'wx' });
    try {
      await writeFile(this.#metadataPath, JSON.stringify({
        size: data.byteLength,
        contentType: options.metadata.contentType,
        cacheControl: options.metadata.cacheControl,
        metadata: options.metadata.metadata,
      }), { flag: (await this.exists())[0] ? 'wx' : 'w' });
      await link(temporary, this.#path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw Object.assign(new Error('Object already exists'), { code: 412 });
      throw error;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async exists(): Promise<readonly [boolean]> {
    try {
      await stat(this.#path);
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata() {
    try {
      return [JSON.parse(await readFile(this.#metadataPath, 'utf8'))] as const;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw Object.assign(new Error('Object not found'), { code: 404 });
      }
      throw error;
    }
  }

  async download(): Promise<readonly [Buffer]> {
    try {
      return [await readFile(this.#path)];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw Object.assign(new Error('Object not found'), { code: 404 });
      }
      throw error;
    }
  }
}

export function createFileComponentBucket(directory: string, name: string): ComponentStorageBucket {
  return Object.freeze({
    name,
    file: (objectName: string) => new FileStorageObject(directory, objectName),
  });
}

export function createSelfHostedFactories(options: SelfHostedOptions): ProductionRuntimeFactories {
  const { serviceAccount } = options;
  const credentials = Object.freeze({
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  });
  const identity = (config: ProductionRuntimeConfig): ProductionRuntimeIdentity => Object.freeze({
    firebaseCredential: cert({
      projectId: config.security.projectId,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
    }),
    // Only the Cloud Storage client used this; files replace it here.
    authClient: undefined as unknown as Compute,
    googleAuth: new GoogleAuth({
      credentials,
      projectId: config.security.projectId,
      scopes: [...SERVICE_ACCOUNT_SCOPES],
    }),
    serviceAccountEmail: serviceAccount.client_email,
  });
  const firebase = (
    config: ProductionRuntimeConfig,
    runtimeIdentity: ProductionRuntimeIdentity,
  ): FirebaseProductionServices => {
    const name = `miakapp-control-plane-self-hosted-${config.environment}`;
    const app: App = getApps().find((candidate) => candidate.name === name)
      ?? initializeApp({
        credential: runtimeIdentity.firebaseCredential,
        projectId: config.security.projectId,
      }, name);
    return Object.freeze({
      auth: new FirebaseAdminAuthVerifier(getAuth(app)),
      appCheck: getAppCheck(app),
      firestore: new Firestore({
        credentials,
        databaseId: '(default)',
        projectId: config.security.projectId,
      }),
      identity: runtimeIdentity,
      componentBucket: createFileComponentBucket(options.storageDirectory, config.componentBucket),
    });
  };
  return Object.freeze({
    identity,
    firebase,
    cloudSecurity: () => Object.freeze({
      kms: createLocalKmsClient(options.keyDirectory),
      secrets: createLocalSecretClient(options.keyDirectory),
    }),
  });
}

export async function createSelfHostedControlPlane(
  document: unknown,
  options: SelfHostedOptions,
): Promise<ProductionControlPlane> {
  await mkdir(options.storageDirectory, { recursive: true });
  return createProductionControlPlane(document, {
    // The runtime refuses ambient credential overrides; this composition passes
    // its identity explicitly, so the check runs against a clean environment.
    environment: Object.freeze({ GOOGLE_CLOUD_PROJECT: options.serviceAccount.project_id }),
    factories: createSelfHostedFactories(options),
  });
}
